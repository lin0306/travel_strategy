# 03 · 地图交互设计（腾讯地图 JavaScript API GL · 用户自选底图 + 三级下钻）

> **决策变更记录**
> 1. 早期方案的「自绘 SVG 底图（零 key）」已否决 —— 自绘只有区界轮廓，没有街道/建筑/水系，缩放到街区级就失去参考价值，且手势、命中测试、marker 缩放全要手写，隐性成本远高于收益。
> 2. 引擎曾定为**腾讯 GL JS** → 上一版**改为高德 JS API 2.0**（当时认为腾讯缺少批量距离测量接口）。
> 3. **当前版：换回腾讯 GL JS**。理由是上一版的论据被证伪 —— **腾讯有 `/ws/distance/v1/matrix`（25×25=625 对/次，且驾车/步行/骑行三种方式都支持批量）**，能力反而强于高德。完整论证与纠正过程见 [07 文档第 0 节](./07-map-provider.md)。
> 4. **本轮新增**：① 三级地图下钻（全国 → 省 → 市）所需的行政区划图层；② 行程规划页的通勤连线与多方案展示。
>
> **现方案**：单一引擎**腾讯 GL JS**，**底图由用户自选**（类型 × 详细度开关，选择持久化），默认矢量图。同时**明说做不到什么**：按 POI 类别（地铁站 / 超市 / 区划）单独控制做不到，见 2.2.1。
> **不再按缩放自动降级**（2026-09-19 改，见第二节）。只需**一把 key**（无安全密钥）。

---

## 一、引擎选型与坐标一致性

```
                    components/map/MapCanvas.tsx
                              │
                              ▼
                    map/tencent/loader.ts（SDK 单例加载 · key 解析 · 降级）
                              │
                              ▼
                    TMap.Map 实例 + 图层
                    ├─ MultiMarker + MultiLabel    点位与标注（★ 避让需自研，见第三节）
                    ├─ MultiPolygon                行政区划边界（三级下钻，见第十一节）
                    ├─ MultiPolyline               通勤连线（行程规划页，见第五节）
                    ├─ InfoWindow                  选中气泡（桌面端）
                    ├─ MarkerCluster               移动端点聚合
                    └─ basemap.ts                  底图类型 + 详细度开关 + 偏好持久化（用户自选）

                    「缩放 → 显示」这条链（见 3.4，四件必须同源的事）
                    ├─ viewport.ts                 读视野（唯一读法）+ 视野判据
                    ├─ zoomTiers.ts                阈值与档位表（只看数字）
                    ├─ reveal.ts                   这一屏铺哪一级（看内容、逐级回流）
                    ├─ dotBudget.ts                这一屏撒哪几枚（看屏幕像素）
                    └─ useTMap.ts                  视野稳定检测 → 广播（取景是动画，不是到位）
```

> 引擎调用统一收在 `map/provider/tmapProvider.ts` 一层薄适配后（三个接口契约见 [07](./07-map-provider.md) 第九节），业务代码不直接 import `TMap`。现在只写腾讯一套实现，接口存在的意义是"将来换平台不用重写 UI"。

**坐标一致性（关键）**：腾讯底图、腾讯地理编码、腾讯路线规划、腾讯区划**全部使用 GCJ-02**。整条链路同源，**不需要任何坐标转换**。

> ✅ **现有数据可直接复用**：46 个成都 POI 坐标本来就由腾讯地点搜索产出，**从头到尾都是腾讯**，零改动。

**⚠️ 一个必须记住的格式差异**：腾讯所有接口与 SDK 的坐标都是 **`纬度,经度`（lat 在前）**：

```ts
new TMap.LatLng(lat, lng)          // ★ 纬度在前
// WebService: from=39.98,116.30   ← 也是纬度在前
```

这与绝大多数 WebGIS 习惯（GeoJSON 是 `[lng, lat]`、高德文案是 `lng,lat`）**相反**。写反了不报错，只是点位跑到地球另一边。所有跨边界的地方都要显式转换并写注释。

> ❌ 反面案例：若坐标来自 OSM（WGS-84）或百度（BD-09），整张图会偏 **300–600 米**。这类混用一律禁止。

`center` / `defaultZoom` 字段由此获得明确语义：`center` 喂给 `TMap.LatLng`，`defaultZoom` 直接喂给构造函数（腾讯 GL 的缩放范围是 **3–20**）。

---

## 二、底图策略：**一个类型 + 一组详细度开关**（2026-09-19 立，2026-09-25 改）

### 2.1 先说一个必须讲清的产品判断

**影像图是城市级视野下最好的底图，但它在街区级会失效。** 这个断层不是"画质问题"，而是"信息类型不匹配"——影像给的是**地表材质**，用户找路需要的是**建筑语义**。

| 视野层级 | 影像图表现 | 更适合的底图 |
|---------|-----------|---------|
| 城市全貌（zoom 10–13） | ✅ **最强场景**。海岸线、山海地形、城市肌理、河流走向一目了然 | 影像图 |
| 城区级（zoom 14–15） | ⚠️ 开始吃力。屋顶、道路、绿地混成灰绿色块 | 影像图可接受 |
| 街区级（zoom 15.5–17） | ❌ 明显变差。建筑只看到屋顶，认不出入口/门脸 | **矢量图** |
| 单点定位（zoom 18+） | ❌ 完全不可用。找不到"从哪个地铁口出、门在哪" | **矢量图** |

另外三个现实约束：

- **时效性**：国内商业卫星影像更新周期通常 1–3 年。新开业的网红店、刚通的地铁口在影像上可能还是空地 —— 这对「网红打卡」分类是硬伤
- **色彩冲突**：影像图色彩天然杂乱，叠加高饱和 marker 后对比度会崩，必须给 marker 加白色描边
- **流量**：影像瓦片是矢量瓦片的 5–10 倍（实测同一视野：影像 2.0MB / 矢量 0.74MB）

**结论**：

> 两端统一默认**矢量图（全量要素）** —— 首页要读的信息是**省界与省名**，而影像图上边界只有一条极淡的线、也没有地名，用户看到的是一张"没有行政信息的卫星照片"；何况影像瓦片体积是矢量的 5–10 倍，移动端 4G 下首帧代价太高。
> 顶栏右侧给一个**底图菜单**（类型 × 详细度开关），**用户选什么就渲染什么**，选择持久化到 `localStorage`。
> **不再按缩放自动降级** —— 旧版的「zoom ≥ 15.5 自动切矢量 + 迟滞 + 一次性说明 + 锁定开关」已整体删除。

### 2.1.1 为什么要删掉「自动降级」（这是本轮最重要的决策）

用户原话：**「改成下拉选择，让用户自行选择用什么图层展示」**。三条理由：

1. **它把用户的选择静默改掉**，于是不得不额外补两处 UI 来解释（"已临时降级"文案 + 锁定开关）—— 一处设计需要两处补丁，说明设计本身是错的。
2. **街区级该用矢量这件事，一行说明就够了**：预设的 `hint` 里写清"地表影像叠路网与地名"，用户自己会判断。信息代替强制。
3. **主流做法也是如此**：Google Maps 等产品里，用户选了卫星图就是卫星图，放大不会自己变。

**代价（要认）**：放大到街区级时，选了影像的用户看到的是屋顶而不是门脸。这个代价由**说明**来平衡，不再由**替用户改**来"平衡"。

> ⚠️ 若将来重新引入任何"系统自动改用户选择"的行为，**必须同时给出它的退出机制**（像旧版那样），否则会重演这段历史。这条写在文档里的作用就是拦住下一次"顺手加个自动"。

### 2.2 底图配置（腾讯的 `setBaseMap` 模型）+ **实测的要素白名单**

腾讯与高德的底图 API **形态完全不同** —— 腾讯是**一个底图对象带特性开关**，高德是**图层叠加**：

| | **腾讯 GL JS** | 高德 JS API 2.0 |
|---|---|---|
| 矢量底图 | `setBaseMap({ type: 'vector', features: [...] })` | `AMap.createDefaultLayer()` |
| 卫星底图 | `setBaseMap({ type: 'satellite', features: [...] })` | `new AMap.TileLayer.Satellite()` |
| 路网注记 | **`features` 数组里的 `'road'`**（仅卫星） | 独立 `TileLayer.RoadNet()` 图层 |
| 切换方式 | `map.setBaseMap(...)` 一行搞定 | `map.add/remove(layer)` 或 `setLayers([...])` |

🚨 **`features` 的合法取值只能靠实测**（2026-09-19 `_tmp/cdp_layers.mjs`；
2026-09-25 `_tmp/cdp_layer_matrix.mjs` —— hook `Map.prototype.setBaseMap` 拿到实例，
逐配置截图 + **按字节数逐张比对** + `getBaseMap()` 回读）：

| 底图 | 合法要素 | 实测是否有效 |
|------|----------|------------|
| `vector` | `base`（底面：**道路/绿地/水域/地铁线/区划边界与省名**） | ✅ 永远在 |
| | `building2d`（建筑物平面） | ✅ **zoom ≥ 16.5 才出现**（zoom 16.2 测不出差异） |
| | `building3d`（建筑物立体） | ⚠️ 2D 视图下有效，但画面与 `building2d` 不同（178KB vs 162KB）→ 本项目用平面那档 |
| | `point`（**全部** POI 文字） | ✅ |
| | `label`（道路文字） | ⚠️ **全国视野下零内容**（zoom 4.6 时与不加是同一张图），街区级才出现 |
| | `arrow`（道路箭头） | ❌ **完全无效** —— 文档里有、三个视野都测不出任何变化，**不入白名单** |
| `satellite` | `base`（影像） | ✅ |
| | `road`（路网 + 地名注记） | ✅（+211KB） |

- 🚨 **白名单外的名字被静默忽略**：不抛错、不警告，而 `getBaseMap()` 会把配置**原样回读**。
  所以「回读到了」**不等于**「生效了」—— 这一点差点骗过我们：
  旧代码写的是 `['base', 'road', 'building']`，其中 `road`（那是卫星的要素）与
  `building`（真实名字是 `building2d` / `building3d`）**双双被丢掉**，实际等于 `['base']`，
  矢量图**几乎没有地名**（实测同一视野截图：552KB vs 全量 740KB，差别就是满屏 POI 名字）。
  当时 tsc 干净、控制台零报错、`getBaseMap()` 还回读得一模一样。
- 静态护栏：`check_app.py` 的 **U 项**按白名单校验 `BASEMAP_DETAILS` —— 矢量里出现 `road`、
  卫星里出现 `building2d`、或把底面 `base` 混进可开关项，都会被拦下。
  **新增检查项必须反证**，这一项已用"故意写错的 feature"喂进去确认过会 FAIL。

#### 2.2.1 用户问过的那件事：能不能单独控制「地铁 / 超市 / 区划」

**不能。** 腾讯的 `features` 是**图层级**开关，不是 **POI 类别级**（高德 GeoHUB 有 42 类元素，
腾讯没有对应的运行时 API）。实测归属：

| 想单独控制的东西 | 实际归谁管 | 能否单独关 |
|----------------|-----------|-----------|
| 道路 / 绿地 / 水域 / **地铁线** / **区划边界与省名** | `base` | ❌ 全在底面里，关掉就没有地图 |
| 地铁站名、超市、商场、餐厅、医院、小区名… | `point` | ❌ **只有一个总开关** |
| 道路名称 | `label` | ✅ |
| 建筑物 | `building2d` | ✅（zoom ≥ 16.5） |
| 影像图上的路网与地名 | `road` | ✅ |

> ★ 一个**好消息**：省界与省名都在 `base` 里（实测 `features: ['base']` 时省界省名俱在，
> `point` 只管市级地名与水域名）。所以用户把「地点文字」全关掉，首页仍是一张可读的中国地图
> —— 这正是"简略"档敢做成"全关"的依据。
> 想按 POI 类别控制只能走腾讯控制台的**个性化样式**（生成 `styleId` 绑定 key），不是运行时
> 能力，本项目没有接。

- `setBaseMap` 也收**数组**（多图层叠加，实测 `[{type:'vector'}, {type:'traffic'}]` 生效）。
  但 `type: 'traffic'`（实时路况）**单用是一张 213KB 的白板**，叠加到矢量上视觉差异也不明显
  → **不收录**（另见 2.6 的"不要做的事"）。所以"底图类型"只有 `vector` / `satellite` 两种，
  没有 `terrain`（腾讯 GL 不提供地形底图）。

### 2.3 状态模型 —— 「用哪张图」的唯一出处

**2026-09-25 改**：从"四档平铺预设"改成「**一个类型 + 一组详细度开关**」。用户原话：

> 「现在矢量图影像图，你现在都是有两个选项的，应该是改成一个选项，让增加一个开关，
>  控制显示简略还是详细（先这样做，后期有些应该是可以单独控制的）」

旧的四档（矢量 / 矢量·简洁 / 影像 / 影像·无注记）把**两个正交的维度压成了一条清单**：
类型（矢量/影像）与详细度（要不要注记）本来是两个问题，用户却要在四个平级选项里挑组合，
而且组合会随维度相乘 —— 再加一档就没法看了。现在拆回两个维度：

```ts
// app/map/tencent/basemap.ts
export type BasemapKind = 'vector' | 'satellite'          // 腾讯只有这两类（见 2.2）
export type BasemapLevel = 'plain' | 'full'               // 那个「简略 / 详细」开关
export type BasemapDetailId = 'place' | 'roadName' | 'building' | 'roadNet'

/** 逐项开关表：UI 的开关只能来自这里，写死会与引擎层漂移（U 项拦） */
export const BASEMAP_DETAILS = [
  { id: 'place',    kind: 'vector',    feature: 'point',      label: '地点名称', hint: '…' },
  { id: 'roadName', kind: 'vector',    feature: 'label',      label: '道路名称', hint: '…' },
  { id: 'building', kind: 'vector',    feature: 'building2d', label: '建筑',     hint: '…' },
  { id: 'roadNet',  kind: 'satellite', feature: 'road',       label: '路网与地名', hint: '…' },
]

export interface BasemapState {
  kind: BasemapKind
  /** ★ 按类分开存：切到影像看一眼再切回来，矢量的开关不该被抹掉 */
  details: Record<BasemapKind, readonly BasemapDetailId[]>
}

/** 状态 → setBaseMap 配置。底面恒在，后面才挂用户勾的项 */
export function basemapConfig(s: BasemapState): TMap.BaseMapOptions {
  const feats = BASEMAP_DETAILS.filter((d) => d.kind === s.kind && s.details[s.kind].includes(d.id))
    .map((d) => d.feature)
  return { type: s.kind, features: [BASEMAP_BASE_FEATURE, ...feats] }   // = ['base', …]
}
```

- **"简略 / 详细"就是这套开关的两个快捷档**：详细 = 全开，简略 = 全关（只剩底面）。
  中间状态由用户自己勾 —— 这正是用户说的「后期有些应该是可以单独控制的」，
  只不过结构上本来就是一回事，分开做反而要改两次，所以一次做到位。
- 界面的**三段**（底图类型 / 详细度 / 逐项开关）全部由 `BASEMAP_KINDS` + `BASEMAP_DETAILS` +
  `BASEMAP_LEVEL_LABEL` 派生，组件里一个硬编码都不许有 —— U 项会拦。
- 面板底部有一行**产品事实**（不是免责声明）：「道路、地铁线与区划边界属于底面，腾讯不提供
  单独开关」—— 依据是 2.2.1 那张归属表。不写这一行，用户会一直以为是我们没做。
- **旧值迁移**：这个 localStorage 键历史上存过两代值 —— 最早是底图**类型**（`'vector'`），
  上一版是四档**预设 id**（`'vector-plain'` …）。`migrate()` 把旧 id 映射回等价的状态，
  且**保住语义**（`vector-plain` 当年是"只留路网与路名"，映射成「矢量 + 只开道路名称」，
  而不是"全关"）。不认旧值的话，老用户的显式选择会静默回到默认。

### 2.3.1 按钮文案与缩略图（2026-09-25 用户提的三点）

> 「那个矢量图右侧那个自定义的文字能不能去掉，地图选项左侧，能不能显示一个缩略图」

| 决定 | 理由 |
|------|------|
| 触发器**只写类型名**（「矢量图」/「影像图」），不带 `· 简略/详细/自定义` 后缀 | 按钮回答的问题只有一个：**我用的是哪张底图**。后缀要么在说"你处于某个中间状态"，要么在复述面板里已经显示过的档位。档位在面板第二段，那里才有上下文 |
| 类型行左侧加**自绘 SVG 缩略图**（40×28） | "这两种底图差在哪"看图比读说明快。**不用真实瓦片**：那会给纯静态站引入新的网络失败点（腾讯静态图还要单独开通权限），收益只是"更像真的"；自绘还能把色板故意拉开（矢量冷灰白 / 影像暗橄榄），一眼可辨 |

缩略图组件是 `common/ui/BasemapThumb.tsx`（`BasemapThumb kind=…`，两张内联 SVG）。
⚠️ 它**不是地图预览**，不要拿它去对齐真实底图的配色 —— 那样只会两头不像；
也因此它的颜色是硬编码 hex（画的是"地图外观的示意图"，不该跟随主题 token）。

### 2.4 取消「三重保护」（它们全是自动降级的配套）

| 旧设计 | 现状 | 原因 |
|--------|------|------|
| 迟滞区 `HYSTERESIS = 0.5` | **删除** | 不再有按缩放切换，"临界抖动"的前提消失 |
| 一次性降级说明 | **删除** | 改为预设里的 `hint` 常驻说明 |
| 锁定开关 | **删除** | 已经没有自动行为，逃生舱门失去意义 |

### 2.5 地图样式（腾讯的路径）

腾讯的个性化样式在**控制台**编辑，生成 `styleId` 后绑定：

```ts
const map = new TMap.Map('container', {
  center: new TMap.LatLng(30.5723, 104.0665),
  zoom: 11,
  styleId: '<控制台生成的个性化样式 id>',
})
// 运行时也可切换
map.setStyleId('<another-style-id>')
```

**推荐策略**：先用默认样式跑通，样式微调放到最后 —— 目标是「低饱和暖调 + 弱化 POI 文字，让 marker 成为唯一视觉焦点」。

> ⚠️ **相比高德的差距**：高德 GeoHUB 免费版可改 **42 类地图元素**，粒度更细。腾讯的个性化控制在元素粒度上略粗。判断：本项目的需求（低饱和暖调、弱化底图 POI）腾讯完全能做到，差距落在极致定制上。

### 2.6 底图默认与性能代价

| 项 | 矢量瓦片 | 影像瓦片 |
|----|---------|---------|
| 瓦片格式 | PBF（压缩矢量） | JPG |
| 单屏流量 | 约 1x | **约 5–10x**（实测同一视野：0.74MB vs 2.0MB） |
| 首帧速度 | 快（十几 KB） | 慢（数百 KB） |

| 端 | 默认底图 | 理由 |
|----|---------|------|
| 桌面（L / XL） | **矢量图 · 详细** | 首屏是"看全国收录情况"，判据是省界与省名；影像图上这些信息几乎为零 |
| 移动（S / M） | **矢量图 · 详细** | 同上，且影像瓦片体积是矢量的 5–10 倍，4G 下首帧明显更慢 |

```ts
// app/map/tencent/basemap.ts
export const DEFAULT_BASEMAP: BasemapState = {
  kind: 'vector',
  details: { vector: […全部开关], satellite: […全部开关] },
}
// 首次初始化：用户存过的选择优先，否则用它
export function initialBasemap(): BasemapState {
  return loadBasemapPreference() ?? DEFAULT_BASEMAP
}
```

> 两端一致，**没有分端默认**了 —— 旧版的 `DEFAULT_BASEMAP_BY_VIEWPORT`（桌面影像 / 移动矢量）
> 建立在"影像第一眼冲击力强"的判断上，但那与首页要读的信息（省界、省名）相悖；
> 影像的优势场景是城市级视野，而那时用户自己会去下拉里选。

**不要**做的事：
- ❌ 不要叠加实时路况图层 —— 实测 `{type:'traffic'}` 单用是一张白板（截图 213KB），叠加到矢量上视觉差异也不明显；
  额外瓦片开销 + 与 marker 抢视觉（**行程规划里的路况是路线规划接口返回的 `duration` 与 `get_speed`，不是靠路况图层**）
- ❌ 不要写死 `features` 里的要素名 —— 只能从白名单里取，且必须过 U 项护栏（见 2.2）
- ❌ 不要再引入任何"按缩放自动切换底图"的行为（见 2.1.1）

### 2.7 可选增强：3D 俯仰

腾讯 GL 支持 `viewMode: '3D'` + `pitch`（0–70）+ `rotation`。影像图配 `pitch: 55`，能做出"上帝视角看城市"的效果 —— 对**重庆**这种 8D 地形城市尤其抓人。

```ts
const map = new TMap.Map('container', {
  viewMode: '3D',
  pitch: 55,
  rotation: 0,
  baseMap: { type: 'satellite', features: ['base', 'road'] },
})
```

建议放在**城市页顶部的一次性引导**里（用户主动点"3D 视角"才启用），不要默认开启 —— 3D 下拖拽定位更费劲。

**移动端默认关闭 3D**：单指拖拽时极易误触发倾斜，且斜视视角下的触控命中判断会变差（详见 [08](./08-mobile-adaptation.md) 5.3）。

---

## 三、图层设计

| 图层 | 类 | 用途 |
|------|-----|------|
| **POI 点位** | `TMap.MultiMarker` | 点位图标，按 `subtype` 分色（见 02 文档的两级类型体系） |
| **POI 标注** | `TMap.MultiLabel` | 点位名称文字。**腾讯无原生避让 → 自研分层避让**，见 3.2 |
| 选中气泡 | `TMap.InfoWindow` | 摘要卡：缩略图 + 名称 + 类型 + "查看详情"（**仅桌面端**） |
| 点聚合 | `TMap.MarkerCluster` | **移动端必开**；桌面端点位 > 80 才启用。见 3.3 |
| **行政区划** | `TMap.MultiPolygon` | 三级下钻的省/市边界填充 + 点击热区。见第十一节 |
| **通勤连线** | `TMap.MultiPolyline` | 行程规划页：按天绘制「住宿点 → 各点位 → 住宿点」的连线。见第五节 |

### 3.1 为什么点位用 `MultiMarker` + `MultiLabel` 两件套

腾讯没有高德那种 `LabelsLayer` + `LabelMarker` 的"海量标注一体化"能力。本项目的做法是：

- **`MultiMarker`** 负责图标（分类色针尖，`anchor: {x: 0.5, y: 1}` 让焦点落在针尖）
- **`MultiLabel`** 负责文字（独立图层，可单独控制显隐 → **这正是自研避让的抓手**）

```ts
// app/map/tencent/poiLayer.ts
const markerStyles: Record<string, TMap.MarkerStyle> = {}
SUB_TYPES.forEach((s) => {
  markerStyles[s.key]        = new TMap.MarkerStyle({ width: 52, height: 66, anchor: { x: 0.5, y: 1 }, src: pinSVG(34, s.color, false) })
  markerStyles[s.key + '_A'] = new TMap.MarkerStyle({ width: 52, height: 66, anchor: { x: 0.5, y: 1 }, src: pinSVG(46, s.color, true) })
})

const markers = new TMap.MultiMarker({ map, styles: markerStyles, geometries: [] })
const labels  = new TMap.MultiLabel({ map, styles: labelStyles, geometries: [] })

markers.setGeometries(pois.map((p) => ({
  id: p.id,
  styleId: p.subtype + (p.id === selectedId ? '_A' : ''),
  position: new TMap.LatLng(p.location.point.lat, p.location.point.lng),   // ★ 纬度在前
})))
```

**图层 diff**：腾讯的 `MultiMarker` / `MultiLabel` **有 `setGeometries()` 原地更新**（不像高德只有 `add`/`remove`/`clear`），筛选变化时直接整体替换即可，几十个点位耗时 < 5ms。

> **marker 样式**：图标用内联 SVG data URI（**禁止引用官方 demo 图片路径**），分类色取自 `subtype` 的色板。
> 卫星底图色彩杂乱，marker 必须有**白色描边**，否则在深绿/深灰区域会糊掉。

### 3.2 ★ 自研标注避让（腾讯唯一的能力短板）

**问题**：高德有 `LabelsLayer({ collision: true })` 开箱即用的避让，**腾讯没有**。46 个 POI 在 zoom 12–14 会出现大面积叠字。

**方案：分层密度控制 + 本地贪心碰撞检测**。核心洞察是 —— **避让只需要管文字，图标本身可以重叠**（用户能看出有两个点就够了，文字糊成一团才是真的读不了）。

```ts
// app/map/tencent/labelAvoidance.ts

interface PlacedRect { x: number; y: number; w: number; h: number }

/**
 * 计算当前视野内应该显示哪些标注。
 *
 * 两个手段叠加：
 *   ① 密度控制：按 zoom 档位限制同时显示的标注数量上限（低 zoom 只显示高热度点）
 *   ② 贪心避让：按热度降序遍历，逐个做矩形相交检测，撞了就跳过该标注
 *
 * 用本地 Web Mercator 数学算像素坐标，不依赖任何未验证的 SDK 投影 API。
 */
export function pickVisibleLabels(
  pois: Poi[],
  view: { centerLng: number; centerLat: number; zoom: number },
  viewport: { w: number; h: number },
): Poi[] {
  // ① 密度上限：zoom 越低，允许的标注越少
  const cap = view.zoom < 11 ? 0          // 城市全貌：完全不显示文字，避免糊成一片
            : view.zoom < 13 ? 12         // 只显示最热的 12 个
            : view.zoom < 15 ? 28
            : Infinity                    // 街区级：全部显示

  if (cap === 0) return []

  // ② 贪心避让：热度降序，逐个检测矩形相交
  const placed: PlacedRect[] = []
  const result: Poi[] = []

  for (const p of [...pois].sort((a, b) => b.popularity - a.popularity)) {
    if (result.length >= cap) break

    const { x, y } = projectToPixel(p.location.point, view, viewport)
    const rect = { x, y, w: p.name.length * 12 + 8, h: 18 }   // 估算文字宽度

    if (placed.some((r) => intersects(r, rect))) continue      // 撞了就跳过
    placed.push(rect)
    result.push(p)
  }
  return result
}

/** 矩形相交检测（含 4px 呼吸间距，避免文字紧贴） */
function intersects(a: PlacedRect, b: PlacedRect): boolean {
  const pad = 4
  return !(a.x + a.w + pad < b.x || b.x + b.w + pad < a.x ||
           a.y + a.h + pad < b.y || b.y + b.h + pad < a.y)
}
```

**触发时机**：`zoom` 事件（防抖 80ms）+ 拖动结束（`map.on('moveend')`）。**不要**在 `move`（拖动过程中）重算 —— 每帧都算会掉帧。

> ⚠️ **热度字段是必需的**：`pickVisibleLabels` 依赖 `popularity` 排序。如果某个 POI 没有热度数据，它会在低 zoom 下**永远不显示标注**。因此 `popularity` 在 schema 里必须是**必填**（见 02 文档）。

**验收标准**（写进 03 文档 M 系列任务）：缩放全区间实测，确认无严重叠字；低 zoom 下高热度点必须优先出现。

### 3.3 点聚合

小屏上 46 个点必然大面积重叠，移动端必须开聚合：

```ts
// app/map/tencent/cluster.ts
const cluster = new TMap.MarkerCluster({
  id: 'poi-cluster',
  map,
  geometries: pois.map((p) => ({
    position: new TMap.LatLng(p.location.point.lat, p.location.point.lng),
    properties: { subtype: p.subtype },
  })),
  gridSize: isMobile ? 60 : 40,        // 聚合半径（px）
  minimumClusterSize: 2,
  maxZoom: 16,                          // 超过该级别全部展开
  zoomOnClick: true,                    // 点簇自动放大展开
})
```

- **移动端聚合、桌面端不聚合**（同一个 `LayerManager`，聚合开关按端配置）
- 聚合簇样式按**簇内主导 subtype** 着色；簇内多类型时用中性色 + 数字
- ⚠️ 聚合开启时**聚合层与 `MultiMarker` 会重复渲染** —— 二选一：移动端用聚合层，桌面端用 `MultiMarker`，**不要同时挂**

★ **聚合只负责屏幕聚合，不负责"显示什么"**（2026-09-20 改）。两端先过**同一份预算**
（`dotBudget.pickDots`），聚合拿到的是同一个点集。修复前移动端 `repaint()` 首行
就因 `cluster` 返回，整条分档链路被跳过，于是"缩放决定显示什么"在两端是两套实现
（桌面看 `zoomTiers`、移动看 `gridSize`），而 `zoomTiers` 自称唯一出处。

---

### 3.4 ★★ 「缩放 → 显示」这条链的分工（2026-09-20 全量修复）

**判断"要不要显示"的代码只能住在引擎层的四个文件里**，页面与组件一律不做这个判断。
修复前它散在四处（揭示钩子 / 撒点 / 徽标 / 每个页面各一份），于是同一个决定
有四种算法、四种视野读法、四种取景写法。

```
viewport.ts   读视野（唯一读法）        ← 输入
     ↓
zoomTiers.ts  阈值与档位表（只看数字）   ← 该揭示到哪一级的**门槛**
     ↓
reveal.ts     这一屏铺哪一级（看内容、逐级回流）   dotBudget.ts  这一屏撒哪几枚（看屏幕像素）
     ↓
districtLayer.ts / poiLayer.ts  画出来（桌面圆点+名字 / 移动聚合）
```

**四件必须同源的事，修复前各有几份：**

| 事 | 修复前 | 现在 |
|----|--------|------|
| 读视野 | **3 份**（揭示 / 撒点 / 徽标各一份，同一帧可能读到不同的中心） | `viewport.readViewport()` |
| 该铺哪一级 | 1 份，但**只看缩放不看内容**，且回流只做了一半 | `reveal.decideReveal()`，逐级下降+逐级回流+`trace` |
| 该撒几枚 | 1 份，但**移动端一次都没跑过** | `dotBudget.pickDots()`，两端共用 |
| 怎么取景 | **4 个页面四种写法**（只有 1 个做了记账） | `hooks/useFitOnce.ts` |

**三个关键约束：**

1. **判据必须与上屏集合同源，而且更严**。上屏集合按视野**外扩**（区划 1.0 / 点位 0.6，
   为了平移不闪），判据用**严格视野**（`pad = 0`）—— 外扩集合里可能有贴着屏幕外沿的点，
   它们会被标注避让裁掉，判据说"有"、用户看到的是空的。
2. **`fit()` 是动画，不是"镜头到位"**。页面在 `fit()` 之后紧接着读视野，读到的是
   **第 0 帧**（于是先按旧缩放错铺一次、动画结束再铺一次）。现在由 `useTMap` 的
   **稳定检测**兜住：采样视野签名，连续两次相同即认定停稳，再广播一次。
   页面**不再需要也不该**补调 `shell.refreshView()`（`check_app.py` 的 V 项守这条）。
3. **取景只做一次，且与 `shell` 换不换对象无关**。`shell` 是每次地图上下文变化就换新的
   对象 —— 换底图、地图刚 ready、浮层增删都会换。把 `shell` 放进取景 effect 的依赖里，
   后果是**换一次底图，镜头被拉回全城**（用户正看的点位被甩出屏幕，且不报错）。
   记账统一由 `useFitOnce` 管：`key` 相同就不再取景，`ready` 单独拿出来管重试。

---

## 四、交互清单

| # | 交互 | 行为 |
|---|------|------|
| I1 | 初次进入 | 把全部点位框进**未被浮层遮挡的空区**（见 4.1） |
| I2 | 点 marker | 选中 + 列表滚动到该项 + 打开 InfoWindow（桌面端摘要） |
| I3 | 点列表卡片 | 选中 + `easeTo` 居中（但不改 zoom，避免视野跳变） |
| I4 | hover 卡片 / marker | 高亮，**不移动地图**（避免晕） |
| I5 | 切分类 / 细类 / 适游群体 | 过滤 → `setGeometries` → `autoFit` 为真时重新框选 |
| I6 | 搜索 | 名称 / tags / 描述模糊匹配，防抖 300ms，空结果给引导文案（**纯本地匹配，不调 POI 搜索接口**） |
| I7 | 手动拖动地图 | `autoFit = false`，出现"回到全览"按钮 |
| I8 | 底图选择 | 顶栏**菜单**：①底图类型（矢量/影像）②详细度（简略/详细）③逐项开关（地点名称/道路名称/建筑/路网与地名）。**用户选择**持久化到 `localStorage`；选什么渲染什么（见 2.3） |
| I9 | 放大到街区级 | **不做任何自动切换**。选影像的用户看到的仍是影像（预设的 `hint` 已说明差别，见 2.1.1） |
| I10 | ~~锁定底图~~ | **已删除**（旧版为自动降级的逃生舱，随自动降级一并移除） |
| I11 | 移动端布局 | **地图铺满视口（app-shell）+ 底部 Sheet 三档吸附**；移动端默认矢量底图；点选不弹 InfoWindow，改「Sheet 升档 + 卡片高亮」。见 [08](./08-mobile-adaptation.md) |
| I12 | 移动端点位密集 | `MarkerCluster` 聚合（`gridSize` 60 / `maxZoom` 16） |
| I13 | 移动端控件 | 缩放按钮移除（双指代替）；底图切换 / 回到全览 / 定位收进右下悬浮圆钮（≥ 44px） |
| I14 | **行程连线绘制** | 行程页按天绘制 `MultiPolyline`；切换交通方式高亮对应连线；见第五节 |
| I15 | **区划下钻** | 点省/市边界多边形 → 下钻到下一级。见第十一节 |
| I16 | **标注避让** | zoom 变化与拖动结束后重算可见标注集合。见 3.2 |

### 4.1 视野适配：把点位框进「没被浮层盖住的地方」

这是本项目从原型阶段就确立的关键设计，**在真实腾讯地图上已通过原型验证**。

**问题**：地图是 100% 视口，但浮层（左面板 348px / 右卡 326px / 详情抽屉 620px / 移动端 Sheet）会盖住地图的一部分。如果直接把点位 `fitBounds` 到整个视口，被浮层盖住的那部分点位用户根本看不见 —— 点位"在视野内"但"被面板压着"。

**做法**：从 DOM 实测所有可见浮层的包围盒，反推出「未被遮挡的空闲矩形」，再把矩形转成 `fitBounds` 的 padding。

```ts
// app/map/tencent/fitView.ts

/**
 * 浮层占位 → fitBounds 的 padding
 * ★ 腾讯的 padding 支持对象形式 {top, bottom, left, right}，已实测可用
 */
function freeRectToPadding(): TMap.PaddingOptions {
  const r = freeRect()            // 实测所有可见浮层的包围盒，反推空闲矩形
  const W = vp.clientWidth, H = vp.clientHeight
  return { top: r.y0, bottom: H - r.y1, left: r.x0, right: W - r.x1 }
}

const box = new TMap.LatLngBounds(
  new TMap.LatLng(90, 180),       // 先建一个"空"的全球范围
  new TMap.LatLng(-90, -180),
)
pois.forEach((p) => box.extend(new TMap.LatLng(p.location.point.lat, p.location.point.lng)))

map.fitBounds(box, { padding: freeRectToPadding(), duration: 600 })
```

> ⚠️ **`freeRect()` 的三个实现坑**（前两个是原型阶段踩的，第三个是 2026-09-19 实测发现的）：
> 1. **缩放必须用实测值**：`vp.getBoundingClientRect().width / vp.offsetWidth`，**不能用 state 里的缩放值** —— 页面缩放动画（transform 过渡）尚未生效的那一帧，state 与真实渲染不一致，会算错空区。
> 2. **可见性判定只按 `display` / `visibility`，不能按 `opacity` 过滤** —— 浮层入场动画从 `opacity: 0` 起步，按 opacity 过滤会把正在入场的浮层漏掉，导致空区算大、点位被压。
> 3. 🚨 **"贴边方向"必须先分「通栏」还是「角落」**。旧实现只有"到四边距离取最小"这一步，它在**通栏浮层**上必然判错：
>    顶栏（`left/right = 16, top = 16, height = 52`）到四边的距离是 `16 / 16 / 16 / 832` ——
>    最小值并列在 left / right / top 上，而代码用 `min === dLeft` 先命中 → **只收缩了 x**，y 一动不动；
>    紧接着 x 又触发"可用区过窄"兜底被重置回全宽 → **最终 padding 变成 0**，
>    顶栏白占 52px，`fitBounds` 出来的内容被它压住。
>    实测证据：首页取景后中国最北点（漠河）投影到 **y=41**，而顶栏底边在 **y=68** —— 那块国土就压在顶栏底下。
>    现在分两步判：跨度 ≥ 80% 容器宽/高 → 它是通栏（横向通栏压上下、纵向通栏压左右）；否则按最近边收缩。
>    修完复测：首页 / 省级页 / 城市页（桌面）**被浮层遮挡的点位均为 0**（探针 `_tmp/cdp_fitregress.mjs`）。

**浮层档位变化时要重算**：详情抽屉打开（620px）时，空闲区会明显收窄，此时应重新调一次 `fitBounds`。**但不要在地图拖动时反复调** —— 只在浮层显隐/换档的那一次重算。

> 💡 **换引擎的代价**：高德有 `setBounds(bounds, immediately, avoid)` 的 `avoid` 参数直接对应这个语义；**腾讯没有 `avoid`，只能走 `padding`**。所以原型阶段手写的那套 `freeRect()` 逻辑，在腾讯这边**是必需的，不是过渡方案** —— 它是正式实现，直接移植到 `app/map/tencent/fitView.ts`。

### 4.1.1 ★ 点景点 → 把**那个点**搬到可视区中心（2026-09-28 用户复报后收口）

> 用户原话：「我之前提的，点景点的时候，要偏移地图，把景点放到地图中间，这个你没做，重新加一下」

与 §4.1 的分工：那里是**一串点** fit 进空闲区（进某一级 / 点徽标），这里是**一个点**
平移到空闲区中心、**不动缩放**（用户调好的级别不该被"看一个景点"这件事抢走）。
落点同样是**扣除浮层之后**的中心 —— 左边的点被 620px 详情面板盖住是用户 2026-09-26
报过的原话（「点左侧的点，会出现被景点详情弹窗盖住的情况」）。

**为什么第一版"做了却没生效"**：「打开一枚景点的详情」有**四个入口** ——
① 地图点圆点（走图层 `onSelect`，那里内联 `setSelectedId`，**绕过了页面的 `openPoi`**）；
② 左侧清单行（走 `openPoi`）；③ 顶栏搜索命中；④ 「挑景点」浮层 + 地图上的序号标记
（后两者都走 `searchPick` 信道）。第一版把平移写进了**城市页的 `openPoi`** ⇒ 只有 ② 生效。
改前基线（`_tmp/cdp_centering_verify.mjs`）：四个入口里只有「城市页 · 清单行」偏差 **0px**，
其余三个全是 **121px** —— 用户看到的"没做"就是这个。

**收口**：平移写进 `common/logic/useSearchPick.ts` 的 effect —— 那是
**"生效的是哪一枚"的唯一出处**（`pick?.poi ?? page.poi`），于是四入口 × 三页自动全覆盖。
城市页 `openPoi` 里那段删掉（"同一件事两处实现"正是上一版漏掉三条路的形状）。

三条时序 / 边界（都踩过）：

| | 规矩 | 踩过的样子 |
|---|---|---|
| 1 | **等两帧**（`rAF(rAF(…))`）再动镜头 | 详情浮层是这次选中才挂上的，只等一帧时 `freeRect` 还算不到它 ⇒ 中心差 ~140px，点落在面板边上 |
| 2 | **同一枚不重复搬**（ref 记 id） | 否则每次重渲染都搬一次，会把用户中途的手动拖动打回去 |
| 3 | **收起（`null`）不动镜头** | 合上卡片时地图自己跳一下 = "我没点它啊" |

验收：`_tmp/cdp_centering_verify.mjs` —— 五个入口全部走**真鼠标**（首页 / 省级页 / 城市页的
地图圆点、城市页清单行、顶栏搜索命中），判据是"点最终落在**我自己独立算的** `freeRect`
中心 ±40px"（`__mapPan` 只有真的动过镜头才会被写）。规划详情态下点**序号标记**同样走这条路
（`_tmp/cdp_planclaim_verify.mjs` 的 ③）。护栏 **Y⑱**（调用点唯一 + 依赖 `effectiveId` +
两帧 + 收起不动镜头），反证 `falsify_y.py` 的 Y⑱a / Y⑱b。

### 4.2 移动端手势

**先纠正早期方案的一个前提**：原先写「单指滚页面、双指缩放地图 + 点击激活遮罩」，是因为地图嵌在一个**可滚动的页面**里，两者抢同一个单指手势。

改成 **app-shell（页面本身不滚动，地图是主视图）后，这个冲突源直接消失** —— 单指可以直接拖动地图，不需要激活遮罩。

```css
/* 地图容器：单指拖动 + 双指缩放全归地图（app-shell 下页面不滚，不会冲突） */
.tmap-container { touch-action: none; }

/* 阻止滚动链穿透到页面 */
.sheet__scroller { overscroll-behavior: contain; }
```

剩余**唯一真实的**手势冲突在 Sheet 内部：列表滚到顶部后继续下拉，应该触发 Sheet 降档，而不是被滚动手势吃掉。

```
Sheet 拖拽判定（松手时按位置 30% + 速度 70% 加权）：
  ├ 列表 scrollTop > 0              → 手势归列表，Sheet 不动
  ├ 列表 scrollTop = 0 且向下拖      → 手势交给 Sheet，允许降档
  └ 把手区域                         → 始终归 Sheet，可上可下
```

> ⚠️ **唯一例外**：独立详情页是**可滚动页面**，其中若放地图预览小图，那里**仍需要**激活遮罩模式。

---

## 五、行程规划页的地图表达

行程规划页是「地图即画布 + 连线 + 时间轴」三者的组合。地图侧需要四件事。

### 5.1 按天连线

```
住宿点（▲ 独立图标，点位类型之外的另一种标记）
  ↓ 第 1 段（出行方式 A）
POI 1
  ↓ 第 2 段（出行方式 B）
POI 2
  ...
  ↓ 末段
回到住宿点
```

| 元素 | 类 | 表达 |
|------|-----|------|
| 连线 | `TMap.MultiPolyline` | 按天分色；**步行用虚线**，其余实线 |
| 段上标签 | `TMap.MultiLabel` | 显示「时长 · 距离」，如「23 分钟 · 5.2 km」 |
| 序号 | `MultiMarker` 的 `styleId` 内嵌数字 | 点位按行程顺序显示 1/2/3…，而不是分类色图标 |
| 住宿点 | `MultiMarker`（自定义 icon） | 用区别于 POI 的形状（房子图标 + 中性深色） |

```ts
// 一条 Leg 的折线：path 优先用路线规划返回的真实路径点，缺失时退化为两点直连
const line = {
  id: `leg-${i}`,
  styleId: dayStyleId(dayIndex),
  paths: decodePolyline(leg.polyline) || [fromLatLng, toLatLng],
}
```

> ⚠️ **`polyline` 是压缩的坐标点串**，不能直接用 —— 腾讯返回的 `polyline` 需要按官方算法解压。**预计算矩阵只存 `distance` + `duration`，不存路径点**（否则体积暴涨），所以矩阵命中时连线是**直连**；只有运行时真正调了路线规划（公交 / 住宿点相关 / 用户展开多方案）才拿到 `polyline` 并画成真实折线。
> 这个取舍要写在 UI 上：直连的段标注「直线示意 · 实际走 <方式>」，避免用户以为路线是错的。

### 5.2 多方案路线展示（"多种路线可选"）

这是本轮的核心交互增量。腾讯驾车接口 `get_mp=1` 返回**最多 3 条**备选方案，UI 要把它们并列出来。

```
┌─ 第 2 段 · 驾车 ────────────────────────────────┐
│ ● 方案 A  23 分钟 · 5.2 km   [少红绿灯]  ← 选中  │
│ ● 方案 B  28 分钟 · 6.8 km   [少收费]           │
│ ● 方案 C  31 分钟 · 4.1 km   [避堵]  ↑过路费 ¥10 │
│                                                 │
│ 打车约 ¥18 · 路况：2 处缓行                       │
└─────────────────────────────────────────────────┘
```

| 展示项 | 来源字段 |
|--------|---------|
| 时长 | `routes[i].duration`（**单位是分钟**，注意与矩阵的秒不同） |
| 距离 | `routes[i].distance`（米） |
| 方案标签 | `routes[i].tags`（如 `LEAST_LIGHT`） |
| 过路费 | `routes[i].toll`（元） |
| 打车费 | 顶层 `taxi_fare.fare`（元） |
| 拥堵 | `get_speed=1` 返回的道路速度 → 标记出缓行路段 |

**交互**：点某条方案 → 地图高亮该条 `MultiPolyline`，其余降到 30% 不透明度；被选中的方案写入该 Leg 的 `chosenRouteIndex`。

> ⚠️ **多方案只在"展开该段"时才请求**，不要一进页面就把所有段的 3 条方案都拉了 —— 那是 3 倍调用量。默认先用矩阵里的时长做汇总，用户点开某段才拉方案。

### 5.3 视野：把「一天的点位」框进空区

```ts
const dayPoints = [stay, ...day.items.map((i) => i.point)]
const box = new TMap.LatLngBounds(new TMap.LatLng(90, 180), new TMap.LatLng(-90, -180))
dayPoints.forEach((p) => box.extend(new TMap.LatLng(p.lat, p.lng)))
map.fitBounds(box, { padding: freeRectToPadding(), duration: 600 })
```

### 5.4 与列表的联动

| 动作 | 地图响应 |
|------|---------|
| hover 时间轴上的一段 Leg | 对应折线**加粗 + 提亮**，其余段降到 40% 不透明度 |
| 点时间轴上的一段 Leg | 视野收窄到该段两端点，并高亮；**展开多方案卡片** |
| 拖拽调整点位顺序 | 连线**实时重绘**（按新顺序），段时长重新查表 |
| 切换某段的出行方式 | 该段线型切换 + 时长重新解析（可能触发一次实时接口，见 09 文档第四节） |
| 切换「第 N 天」 | 只显示该天的连线与点位，其余天隐藏 |

---

## 六、状态与联动

```ts
// app/store/useExploreStore.ts
interface ExploreStore {
  // ── 下钻层级（见 10 文档）─────────────────────
  level: 'nation' | 'province' | 'city'
  activeAdcode: string | null       // 当前省/市的 adcode
  drillPath: string[]               // 地区路径（全国 → 省 → 市），供顶栏地区选择器展示「我在哪」

  // ── 筛选 ────────────────────────────────────
  activeCategories: Category[]      // 四大类
  activeSubtypes: SubType[]         // 细类（颜色维度）
  activeAudiences: Audience[]       // 适游群体
  accessibilityOnly: boolean        // 只看无障碍友好
  keyword: string

  selectedPoiId: string | null
  hoveredPoiId: string | null
  autoFit: boolean                  // 用户手动拖动后置 false
  mapReady: boolean
  mapError: string | null           // key 缺失 / SDK 加载失败

  // ── 底图（见 2.3）───────────────────────────
  basemap: BasemapState                      // { kind: 'vector' | 'satellite', details: {...} }
}

// ★ 底图状态从"一个 id"扩成"类型 + 一组开关"（2026-09-25）：四档平铺预设把
//   「类型」与「详细度」两个正交维度压成了一条清单，维度相乘后没法再加档。见 2.3。
// ★ 更早从"三态"简化为"一个 id"（2026-09-19）：basemapEffective（被 zoom 自动降级的实际渲染）
//   与 basemapLocked / basemapHintShown（自动降级的配套）全部删除 —— 没有自动切换，
//   就没有"意图 vs 实际"的分裂，也没有需要解锁的逃生舱。用户选中的那一档就是渲染出来的那一档。
//   偏好持久化到 localStorage（STORAGE_KEYS.basemapPreference），下次打开沿用。

// app/store/useItineraryStore.ts —— 行程规划页独立 store
interface ItineraryStore {
  stays: Stay[]
  days: ItineraryDay[]
  activeDayIndex: number
  activeLegIndex: number | null
  travelModeDefault: TravelMode
  legCache: Record<string, LegEstimate>          // 运行时算过的段 → localStorage
  routeOptions: Record<string, RouteResult[]>    // 展开过的段 → 多方案
}
```

**数据流单向**：store 驱动地图；地图只回写 `selectedPoiId` / `hoveredPoiId` / `autoFit` / `level` / `activeAdcode`，不直接操作 React 树。

---

## 七、key 策略与「关于 key 泄露」

### 7.1 先把事实说清楚

> **用 Netlify 不能让前端 key 免于暴露。**
> Netlify 官方论坛的原话：*"It's not possible to hide environment variables in client-side code. This is not a Netlify limitation. This is how browsers and JavaScript works."*
> `VITE_` 前缀本身就是一条指令 —— 让构建工具把值**静态替换进 bundle**。

腾讯官方也明确提示过 WebService API 在浏览器端调用的风险。护城河只有两样：**Referer 域名白名单 + 配额告警**。

> ✅ **相比高德，腾讯少一层暴露面**：不需要 `securityJsCode`。高德是"key + 安全密钥"两个值一起明文暴露，且服务端调用不受 Referer 约束 —— 腾讯只有一个 key 要保护。

### 7.2 实际要做的五件事

| # | 动作 | 说明 |
|---|------|------|
| 1 | 控制台配 **域名白名单** | 加上 `你的站点.netlify.app` 与自定义域名（白名单支持子域） |
| 2 | 开 **配额告警** | 关注 `/ws/distance/v1/matrix` 与 `/ws/geocoder/v1` 两个采集期高频接口 |
| 3 | key **只从环境变量读**，代码里禁止硬编码 | 便于换 key、便于开源时不留痕 |
| 4 | 实现**用户自备 key 覆盖** | `localStorage` 优先，见 07 文档第八节。**只需一个输入框**（无安全密钥） |
| 5 | **Deploy Preview 环境单独处理** | 预览域名不在白名单会直接报错；或把预览域名加进白名单 |

### 7.3 申请步骤（写进 README）

1. 打开 <https://lbs.qq.com> → 注册 → 完善**个人开发者**信息
2. 应用管理 → 创建应用 → 添加 Key
   - **Web 端（JavaScript API GL）**：无需勾选产品权限，直接创建
   - **必填域名白名单**
3. 再建一个 Key，勾选「**WebService API**」，给构建期脚本用（配 IP 白名单或 SN 签名）
4. 复制到环境变量 `VITE_TMAP_KEY` / `TMAP_WEB_KEY`

### 7.4 key 缺失或加载失败时的降级（不能让页面白屏）

```ts
// app/map/tencent/loader.ts
let sdkPromise: Promise<typeof TMap> | null = null

export function loadTMapSdk(): Promise<typeof TMap> {
  if (sdkPromise) return sdkPromise                       // 单例：重复调用不重复加载

  const key = resolveTmapKey()                            // 用户自备 > 构建期注入 > null
  if (!key) return Promise.reject(new MapConfigError('未配置地图 key'))

  sdkPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = `https://map.qq.com/api/gljs?v=1.exp&key=${key}&libraries=geometry`
    s.onload  = () => resolve(window.TMap)
    s.onerror = () => reject(new MapConfigError('地图 SDK 加载失败'))
    document.head.appendChild(s)
    // 超时兜底：10s 未加载完就当失败
    setTimeout(() => reject(new MapConfigError('地图 SDK 加载超时')), 10_000)
  })
  return sdkPromise
}
```

| 场景 | 表现 |
|------|------|
| key 未配置 / 是占位符 | 地图区域显示**引导卡片**：「配置地图 key 后解锁地图」（附申请链接）+ **「使用我自己的 Key」入口**，下方**列表正常可用** |
| key 无效 / 域名不在白名单 | 腾讯返回错误码。捕获后显示「地图配置有误，请检查域名白名单」+ 重试按钮，控制台输出完整错误 |
| SDK 加载失败 / 超时（> 10s） | 显示"地图加载失败"+ 重试按钮，列表兜底 |

**核心原则：地图挂掉绝不能导致页面不可用。** 列表、筛选、详情、**三级下钻的区划列表**、**以及行程规划的时间计算**都是底线功能，必须独立于地图存活。

> ⚠️ 特别注意最后一条：行程规划页的**通勤时间来自预计算矩阵**，因此**地图挂了时间轴照样能用**。这个解耦要在实现时守住 —— 不要把矩阵计算写成依赖地图实例的代码。

---

## 八、踩坑清单（腾讯 GL JS 专属）

1. ⚠️ **缩放事件名是 `zoom`**。不是 `zoom_changed`（Google 风格），也不是 `zoomchange`/`zoomend`（高德风格）。写错**不报错、只是永远不触发**。
2. ⚠️ **所有坐标都是 `纬度,经度`（lat 在前）** —— `new TMap.LatLng(lat, lng)`、WebService 的 `from=lat,lng` 都是。与 GeoJSON 的 `[lng, lat]` **相反**，跨边界处必须显式转换并写注释。
3. **`map.on(name, fn)` 返回的是 map 实例，不是取消订阅函数** → 解绑要用 `map.off(name, fn)`。组件卸载时忘记 `off` 会导致缩放一次触发多次回调。
4. ⚠️ **`features` 的要素名必须取自实测白名单**：矢量是 `base` / `building2d` / `building3d` / `point` / `label`，卫星是 `base` / `road`。
   **写错的名字被静默忽略**（不报错，`getBaseMap()` 还原样回读）—— 旧代码的 `['base','road','building']` 实际上等于 `['base']`，
   矢量图因此**几乎没有地名**（详见 2.2 与 `check_app.py` 的 U 项）。
   卫星图**必须带 `road`**，否则是一张没有任何路名地名的影像图。
5. **`setBaseMap` 接收的是配置对象**，不是图层实例（这是与高德最大的心智差异）。**不存在"图层句柄要自己留住"的问题**。
6. **`setMaxZoom` / `setMinZoom` 只接受 3~20**，不是 22。
7. **`LatLngBounds` 的构造需要一个初始范围** —— 先建一个"空"的全球 box（`LatLng(90,180)` → `LatLng(-90,-180)`），再 `.extend()` 逐点扩展。直接 `new LatLngBounds(sw, ne)` 会得到一个固定范围而不是空集。
8. **`fitBounds` 的 `padding` 支持对象形式** `{top, bottom, left, right}`（已在原型验证）。
9. ⚠️ **`polyline` 是压缩点串**，必须按官方算法解压才能画线。不要把它当作 `[{lat,lng}]` 数组直接用。
10. **`MultiMarker` / `MultiLabel` / `MultiPolyline` / `MultiPolygon` 都有 `setGeometries()`** —— 筛选用它做原地更新，不要 `new` 一个新的。
11. **`TMap.MarkerStyle` 的 `anchor` 是比例值**（`{x: 0.5, y: 1}` = 底部中心），不是像素偏移。
12. **聚合层与 `MultiMarker` 会重复渲染** —— 移动端用聚合层、桌面端用 `MultiMarker`，**不要同时挂**。
13. **`MarkerCluster` 中坐标完全相同的点会互相顶掉** —— 若两个 POI 锚点重合，先做坐标去重（微调 ~1e-5 度）或合并，否则会「少一个点」且不报错。
14. **`MarkerCluster` 的更新用 `setData()`**，**不要重新 `new`**。
15. **预渲染时不能挂地图** —— SSG 阶段没有 `window`。用 `useIsMounted()` 门控，未挂载先渲染骨架。
16. **切换底图后 `InfoWindow` 可能被顶到底层**，需要 `setPosition()` 重新定位。
17. **`styleId` 不存在或未发布时，地图会静默变回默认样式**（不报错），很容易误判成"样式没生效"。先用默认样式跑通。
18. ⚠️ **腾讯没有原生标注避让** —— 必须自研（见 3.2）。这是换回腾讯**唯一**需要额外付出的能力。
19. **并发限制 5 次/秒** —— 构建期脚本不能并发轰炸，要串行 + 退避。
20. **日配额 10,000 次/接口，按接口独立**，且距离矩阵按**"计算次数"**计量（一次 25×25 请求 = 625 次计算），不能按请求数估。
21. **距离矩阵的单个元素可能失败** —— 起终点附近 5km 内无道路时该元素 `status: 4`，`distance` 退化为**直线距离**且**不返回 `duration`**。必须逐元素判 `status`。
22. **`duration` 单位不一致** —— 距离矩阵是**秒**，路线规划是**分钟**。混用会差 60 倍。
23. ⚠️ **区划边界数据只能来自腾讯 District 服务** —— 禁止第三方 GeoJSON。见第十一节与 10 文档。

---

## 九、合规红线

| 项 | 要求 |
|----|------|
| 底图 | 只用腾讯 / 高德 / 百度 / 天地图；**禁止** Google、Apple、Bing 海外、Mapbox、Leaflet+OSM 直连 |
| **行政区划边界** | 🚨 **只能使用腾讯 District 服务返回的边界数据**；**禁止**引入任何第三方 GeoJSON 或自制中国地图轮廓。这是国家版图完整性问题（台湾、藏南、南海诸岛的完整表达），违反《地图管理条例》 |
| 影像图 | 使用服务商提供的合规影像服务；**不得**截图后加工、二次分发、作为自有地图数据 |
| **版权署名** | 腾讯要求在地图图面保留版权信息位（形如「© 腾讯地图」+ 审图号）。**由 SDK 自己渲染在左下角**（实测元素 `.logo-text`），本项目**不再自绘**（自绘那份是纯重复、且没有审图号）——但**不得遮挡或移除** SDK 那份（静态检查 Q 项守这条） |
| 敏感地物 | 不标注军事管理区、涉密单位、私人住宅坐标；描述中不出现敏感地名 |
| 个人信息 | 不采集、不上传用户位置；"我附近"若实现，只在浏览器本地计算，坐标不出网 |
| 正式发布 | 若对外商用或需完整行政区划展示，应使用自然资源部**标准地图服务**（带审图号）或走商业授权 |

---

## 十、落地任务拆解

| # | 任务 | 产出 | 依赖 |
|---|------|------|------|
| M1 | 申请腾讯 JS key（配域名白名单）+ WebService key（配 IP 白名单 / SN 签名） | `VITE_TMAP_KEY` / `TMAP_WEB_KEY` | — |
| M2 | SDK 单例加载器（key 解析 + 超时 + key 缺失/SDK 失败降级 + 用户自备 key 覆盖） | `map/tencent/loader.ts` | M1 |
| M3 | 地图实例 hook（生命周期 + `off` 解绑 + destroy） | `map/tencent/useTMap.ts` | M2 |
| M4 | **底图类型 + 详细度开关 + 偏好持久化**（类型单选 × 逐项开关，"简略/详细"是快捷档；`features` 白名单校验 + `localStorage` 读写 + 两代旧值迁移 + `setBaseMap`） | `map/tencent/basemap.ts` | M3 |
| M5 | POI 图层（`MultiMarker` + `MultiLabel`，按 subtype 分色 + `setGeometries` 更新） | `map/tencent/poiLayer.ts` | M3 |
| M6 | ★ **自研标注避让**（密度控制 + 贪心碰撞检测 + zoom/moveend 触发） | `map/tencent/labelAvoidance.ts` | M5 |
| M7 | **视野适配**：浮层实测 → `freeRectToPadding()` → `fitBounds` | `map/tencent/fitView.ts` | M3 |
| M8 | InfoWindow + 列表双向联动（桌面端） | `hooks/useMapSync.ts` | M5/M7 |
| M9 | 地图样式落地（控制台个性化样式） | — | M4 |
| M10 | **移动端点位密集**：`MarkerCluster` 接入（`gridSize` 60 / `maxZoom` 16） | `map/tencent/cluster.ts` | M5 |
| M11 | **底图菜单组件**（顶栏右侧；三段：类型单选 / 详细度快捷档 / 逐项开关；底部写明"地铁与区划不可单独关"；点外·Esc 关闭 / 未就绪禁用） | `components/overlays/BasemapMenu.tsx` | M4 |
| M12 | **落点比对与影像实测**（07 文档 T9/T11） | 结论写入 README | M1 |
| M13 | **通勤连线图层**（`MultiPolyline` 分天分色 + 段标签 + 住宿点图标 + 顺序变更重绘） | `map/tencent/routeLayer.ts` | M5/M7 |
| M14 | **多方案路线展示**（`get_mp=1` → 方案卡片列表 → 选中高亮 + `get_speed` 拥堵标记） | `map/tencent/routeOptions.ts` | M13 |
| M15 | **区划边界图层**（`MultiPolygon` 填充/描边/hover/点击热区 + 层级切换） | `map/tencent/districtLayer.ts` | M3 |
| M16 | **移动端交互**：app-shell 骨架 / Sheet 三档吸附 / 手势边界 / `MapControlStack` | 见 08 文档 T1–T3、T6 | M8 |
| M17 | **移动端兼容**：微信毛玻璃降级 / 分享卡片 / 真机测试矩阵 | 见 08 文档 T10、T12 | M16 |
| M18 | **避让效果实测**（M6 的验收：全 zoom 区间无严重叠字） | 结论回填踩坑清单 | M6 |

---

## 十一、行政区划图层（三级下钻的地图侧）

三级下钻的完整产品设计见 [10 文档](./10-map-drilldown.md)。这里只写地图侧的实现要点。

### 11.1 图层结构

```ts
// app/map/tencent/districtLayer.ts
const districtLayer = new TMap.MultiPolygon({
  map,
  styles: {
    base:      new TMap.PolygonStyle({ color: 'rgba(24,95,165,0.10)', borderColor: '#185FA5', borderWidth: 1 }),
    hover:     new TMap.PolygonStyle({ color: 'rgba(24,95,165,0.22)', borderColor: '#0C447C', borderWidth: 2 }),
    active:    new TMap.PolygonStyle({ color: 'rgba(15,110,86,0.20)', borderColor: '#0F6E56', borderWidth: 2 }),
    noData:    new TMap.PolygonStyle({ color: 'rgba(136,135,128,0.06)', borderColor: '#B4B2A9', borderWidth: 1, borderDash: [4, 3] }),
  },
  geometries: [],
})
```

**填色按 POI 数分级**：不是简单的有/无二分，而是用 4 档梯度表达"这个省有多少内容"，让全国图一眼能看出内容密度。

| 档位 | POI 数 | 填充 |
|------|-------|------|
| 待收录 | 0 | 灰色 + **虚线描边**（见 11.3 空态设计） |
| 稀疏 | 1–20 | 最浅蓝 |
| 中等 | 21–60 | 中蓝 |
| 密集 | 61+ | 较深蓝 |

### 11.2 点击热区与层级切换

```ts
districtLayer.on('click', (evt) => {
  const adcode = evt.geometry?.id
  if (!adcode) return
  const node = districtTree.find(adcode)
  if (node.childCount === 0) return           // 没有下级 → 不下钻，改为直接筛该区划的点位
  drillDown(adcode)                            // 更新 URL + 重新拉子级边界 + 重算视野
})
```

**过渡动画**：层级切换时做 `fitBounds` 到目标区划的边界范围（`duration: 600`），并让旧层多边形淡出 —— 让用户感知到"我进入了这个区域"，而不是画面突变。

⚠️ **边界拉取要缓存**：全国省级边界一次约几百 KB；市级边界按需拉。**不要每次下钻都重新拉**。缓存策略见 [04 文档](./04-content-pipeline.md)。

### 11.3 空态：没有数据的省份怎么画

这是本轮最容易做丑的地方。用户选了「先跑通链路」，意味着**首批只有四川有数据，其余 33 个省级区划都是 0**。

**不能用**的处理方式：

| ❌ 做法 | 为什么不行 |
|---------|-----------|
| 显示「0 个景点」 | 用户会以为"这个地方没有景点"，而事实是"我们还没收录"。**信息是错的** |
| 完全不画这个省 | 中国地图出现空洞，触发版图完整性问题 |
| 用和其他省一样的实色 | 用户点了发现没数据，产生挫败 |

**要用的处理方式**：

```
待收录省份：灰色填充（极低透明度）+ 灰色虚线描边 + 中心标注「待收录」
有数据省份：蓝色梯度填充 + 实线描边 + 中心标注「N 个景点」
```

**两个关键设计点**：

1. **虚线描边是"待收录"的视觉语言** —— 虚线在中国地图语境里天然表达"未完成/规划中"，且不破坏版图完整性（边界依然清晰可见）
2. **点击待收录省份不给死路** —— 弹出一个卡片：「四川 · 待收录 / 我们正在陆续补充全国城市，先看看已上线的成都？」+ 跳转按钮。**把空态变成导流，而不是断头路**

> 💡 这个空态设计是「先跑通链路」这个决策能成立的前提。没有它，首屏 33 个灰省份会显得项目很空;有了它，"待收录"反而变成了一个**进度感**的表达 —— 用户能看到项目在长大。

## ★ 浮层数量：**每类各最多一块**（2026-09-26 修订）

原来这里的判据是"点景点弹出来的东西**总共只有一块**"（Y⑧）。规划功能落地后，
屏幕上合法地会同时存在**两块**：

| 位置 | 是什么 | 宽度 |
|------|--------|------|
| 左 | 景点详情（`PoiDetailOverlay`） | `--panel-detail` 620px |
| 右 | 路线规划面板（桌面 `Overlay` / 移动底部 Sheet） | `--panel-plan` 360px |

所以规则要写成「**同类只能有一块**」，而不是"全屏只能有一块"：

- 景点详情的**简卡 / 位置卡**不许回来（那是同一类里的第二块，已删过一次）；
- 规划面板的列表态与详情态必须**装在同一块容器里**（两块都锚右侧 ⇒ 互相盖住，
  看起来像"点了没反应"）；
- 面板的**内容**（`RoutePlanPanelBody`）自己不许再包一层浮层；
- 瞬时提示（取点提示 / 操作 toast）**不带 `data-overlay`** —— 否则 `fitView`
  会为一条 3 秒后消失的提示白让一块地图位置。

⇒ 判定落在**每类各一块 + 内容层零浮层**上，见 `check_app.py` 的 Y⑧ 与它的注释。

---

## ★ 点区取景：先把景点框进屏幕，再谈放多大（2026-09-29 定稿）

用户第一条：「点区的标签得再放大一个级别，**现在点区放大后看不到景点信息**」
→ 当时的修法是"框景点 + 落点钉 14"。

用户第二条（同一天，把上一条推翻了一半）：「有些区可能就一个景点，放大后我都不知道
景点在哪，**景点在当前展示的地图之外**」。

### 关键认识：`minZoom` 只在「框装不下」时生效 ⇒ 钉得越高，丢的景点越多

`shrinkForMinZoom` 的语义是"**以锚点为心、把跨度缩到 `minZoom` 对应的跨度**"，
而且**只在框浅于 `minZoom` 时才动手**。所以"钉 14"**从来不会让画面更清楚**
（框装得下时它不生效），**只会让装不下的那些区丢景点**。

复刻整条链路跑 17 城全量（`_tmp/sim_district_focus.py`：四份真实数据 + 两段前端算法）：

| 落点 | 会丢景点的区 | 丢掉的景点 |
|------|-------------|-----------|
| 14（上一版） | 54 个 | 353 个（49%） |
| 12 | 14 个 | 23 个 |
| **11.5（现在）** | **4 个** | **7 个（1%）** |

真浏览器实测与之吻合（`_tmp/cdp_districtfocus_verify.mjs`：真鼠标点徽标 + 墨卡托投影
逐点判"在不在屏内"）：钉 14 时都江堰（4 个点）只看得见 **1** 个、青羊区（19 个）只看得见 **2** 个。

### 改了三处

| | 改前 | 改后 | 为什么 |
|---|------|------|--------|
| 框什么 | 区的**行政外接框** | 先问"这个区**里面**有哪些景点"，有就框景点，没有才退回行政框 | 行政框常跨 0.5°（都江堰、广州从化），fit ≈ z10.5；而景点往往不在框中心（都江堰那 4 个点在西北景区）⇒ 落点钉住后屏幕上**一个点位都没有**（实测日志"点 0"） |
| 落点 | `DISTRICT_FOCUS_ZOOM`(14) | **`POI_ADMIT_MIN_ZOOM`(11.5)** —— 点位层真的会铺的那一档 | 低于它 `poiTierForZoom` 判 `admitsPoints: false` ⇒ 屏幕上只剩区徽标，"点区"等于什么都没发生。**且不能再高**（见上表） |
| 锚点 | 框的**几何中心** | **`densestPoint`（medoid：离其余景点最近的那一枚）** | 景点散在四周时几何中心是**一片空地** ⇒ 收缩之后一个都看不见。实测重庆渝中（24 个点在半岛 3km 内 + 1 个 93km 外的错数据）：「几何中心锚点 → 看得见 **0** 个」「medoid 锚点 → 看得见 **24** 个」 |

★ `POI_ADMIT_MIN_ZOOM = POI_REVEAL_ZOOM - 0.5`，**只有一份**（`zoomTiers.ts`）：
`poiTierForZoom` 与点区取景都引用它 —— 两处各写一个 11.5 会静默分叉。

★ `FocusTarget.anchor` 经 `FitOptions.anchor` 传到 `shrinkForMinZoom` 的**第四个参数**，
四个调用点（城市页区图层 / 省级页 / 首页 / 搜索命中地区）都要把 `t.anchor` 交下去 ——
算出来了不传等于没算（收缩仍以框几何中心为锚）。护栏 **AE** 直接盯这一条。

### 顺带修掉的静默失效：同一个区，两处写的名字不一样

而 `===` 在普通地级市上**完全有效**（"锦江区" === "锦江区"），**只有直辖市会恒 false**：

| 来源 | 北京 | 上海 | 天津 | 重庆 |
|------|------|------|------|------|
| 区划树（徽标 `name`） | `东城` | `黄浦` | `和平` | `渝中` |
| 点位 `location.district` | `东城区` | `黄浦区` | `和平区` | `渝中区` |

⇒ 4 个直辖市共 **228 个点位**永远走"行政框"那一支（锚点是行政中心，不是景点），
而且**没有任何报错**。现在统一走 `districtFocus.sameDistrict()`（剥掉行政后缀再比）。

★ 「这个区里面的景点」怎么找：`poi.location.district`（构建期归区写进去的，
见 `pipeline/districts.py`）+ `parentCityOf(区 adcode, rows)` —— 用 adcode **前 4 位**
定位到所属的市（adcode 本身就是"省 2 + 市 2 + 区 2"的段式编码，不必按名字猜，
"城关区"这类重名满国都是）。

★ **城市页原来自己一份**（只框行政框），与省级页 / 首页分叉 ⇒ 现在三页都走
`focusPointsFor`（城市页的 `poisOf` 从本页 `city.pois` 按区名筛）。

护栏 **AE**（6 条断言：`fitPoints` 真的认 `minZoom` · 地板唯一出处 · 城市页走
`focusPointsFor` · 落点钉地板 · 锚点给 medoid · 区名宽容 + 四处都传 anchor），
反证见 `_tmp/falsify_ae.py`（11 个变异，全被拦住）。

### 2026-09-30 追加：徽标上说几个，就是几个

用户：「你这偏移的逻辑不对啊，我点西安未央区，这个区都没有景点，
点了之后直接跳到咸阳的汉景帝陵去了」。

**根因是两套口径打架**：

| 口径 | 来源 | 谁在用 |
|------|------|--------|
| `subdistricts/*.json` 的 `poiCount` | `step8` **按几何**归区算的 | **地图徽标上的数字**（用户唯一看得见的那句话） |
| `poi.location.district` | **采编稿里手写的 `dist`** | `poisOf` 筛"这个区里有哪些景点" |

西安「汉景帝阳陵」的稿子写着 `dist="未央区"`，而几何归区在**高陵区**
（陵园地跨咸阳渭城区 / 泾阳县 / 西安市高陵区，我们有边界的那一段落在高陵）
⇒ 未央区徽标 **0**，按名字筛却筛得出这 1 条 ⇒ 框住它、锚点就是它自己 ⇒ **镜头飞走 20km**。

**两处都修了**：

1. **数据**：`dist` → `高陵区`（与几何归区一致；已核实陵园东段确实属高陵）；
   顺手把 `addr` 从误导的"西安市咸阳国际机场附近（西咸新区）"改成实际位置。
2. **判据**：`focusPointsFor` 里 `node.poiCount === 0` 就**不去筛景点**，直接框行政框。
   ★ 为什么以 `poiCount` 为准：它是**屏幕上给用户看的那句话**；两套口径再打架时按它走，
   至少"屏幕上说什么就是什么"。代价是 `poiCount` 过期（写 0、其实刚新增了景点）时会
   退回行政框 —— 但那些景点就在这个区里，行政框照样看得见。**丢景点比飞错地方轻。**

实测（未央区）：落点 **z=12.04**、中心 **(108.9183, 34.3425)** —— 正落在未央区，
而不是 20km 外的高陵。护栏 **AE** 又加两条断言（`poiCount === 0` 短路 + 城市页必须传
`poiCount`），反证 `_tmp/falsify_ae.py` **13/13 全被拦住**。

★ 顺带记下：**AC 护栏抓不到这类不一致** —— 它只对 `subdistricts` 内部求和
（`sum(poiCount) == 该城 POI 数`），**不看 POI 的 `district` 字段**。
（全仓还有约 90 个区的 `poiCount` 与 POI 的 `district` 分组对不上，根因是点位改过但
没重跑 `step8`；因为判据已经改成以 `poiCount` 为准，这类不一致**不再造成取景错误**，
只会让"徽标数字"与"清单条数"差一点。）

### 还没解决的（**数据侧**，不是取景逻辑）

- 修复后仍丢的 4 个区，都是**景点真散在 40km 量级**的超大市辖区：青岛黄岛、上海浦东、
  长沙浏阳、重庆渝中。前三个是地理事实 —— 落 11.5 已是"点位层还铺"的最浅一档。
- 重庆渝中那 1 个是**归错区的数据**：`万州烤鱼` 的坐标落在 93km 外的万州，
  `location.district` 却写着 `渝中区`。
- 另有 **90 个区**的 `poiCount`（地图徽标上的数字）与当前点位数据对不上 ——
  点位改过但没重跑 `step8`（`pipeline/districts.py`）。
- **搜索命中"区"时框的是全市**：`search.indexFocusSources` 既没有 `boxOf`，
  `poisOf` 又按 `cityId` 返回全市点位 ⇒ 走不到"区"那一支，落点 ≈ 市尺度
  （且不带 `minZoom`），结果多半是"飞过去只看到区徽标"。**待修**。

★ **三个「缩放」现在是两件事**：`POI_REVEAL_ZOOM`(12) = 景点开始出现 ·
`POI_ADMIT_MIN_ZOOM`(11.5) = 点区取景的落点地板（= 点位层准入下界）·
`STOP_FOCUS_ZOOM`(15) = 看一个站点。原来那个 `DISTRICT_FOCUS_ZOOM`(14) **已删除**。

