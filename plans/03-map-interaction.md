# 03 · 地图交互设计（腾讯地图 JavaScript API GL · 分端默认底图 + 自动降级 + 三级下钻）

> **决策变更记录**
> 1. 早期方案的「自绘 SVG 底图（零 key）」已否决 —— 自绘只有区界轮廓，没有街道/建筑/水系，缩放到街区级就失去参考价值，且手势、命中测试、marker 缩放全要手写，隐性成本远高于收益。
> 2. 引擎曾定为**腾讯 GL JS** → 上一版**改为高德 JS API 2.0**（当时认为腾讯缺少批量距离测量接口）。
> 3. **当前版：换回腾讯 GL JS**。理由是上一版的论据被证伪 —— **腾讯有 `/ws/distance/v1/matrix`（25×25=625 对/次，且驾车/步行/骑行三种方式都支持批量）**，能力反而强于高德。完整论证与纠正过程见 [07 文档第 0 节](./07-map-provider.md)。
> 4. **本轮新增**：① 三级地图下钻（全国 → 省 → 市）所需的行政区划图层；② 行程规划页的通勤连线与多方案展示。
>
> **现方案**：单一引擎**腾讯 GL JS**，**分端默认底图**（移动矢量 / 桌面影像），`zoom ≥ 15.5` 自动切矢量，带迟滞与可锁定开关。只需**一把 key**（无安全密钥）。

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
                    └─ basemap.ts                  底图状态机（分端默认 · 自动降级）
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

## 二、底图策略：分端默认（移动矢量 / 桌面影像）+ 按缩放自动降级

### 2.1 先说一个必须讲清的产品判断

**影像图是城市级视野下最好的底图，但它在街区级会失效。** 这个断层不是"画质问题"，而是"信息类型不匹配"——影像给的是**地表材质**，用户找路需要的是**建筑语义**。

| 视野层级 | 影像图表现 | 推荐底图 |
|---------|-----------|---------|
| 城市全貌（zoom 10–13） | ✅ **最强场景**。海岸线、山海地形、城市肌理、河流走向一目了然 | **影像图** |
| 城区级（zoom 14–15） | ⚠️ 开始吃力。屋顶、道路、绿地混成灰绿色块 | 影像图可接受 |
| 街区级（zoom 15.5–17） | ❌ 明显变差。建筑只看到屋顶，认不出入口/门脸 | **矢量图** |
| 单点定位（zoom 18+） | ❌ 完全不可用。找不到"从哪个地铁口出、门在哪" | **矢量图** |

另外三个现实约束：

- **时效性**：国内商业卫星影像更新周期通常 1–3 年。新开业的网红店、刚通的地铁口在影像上可能还是空地 —— 这对「网红打卡」分类是硬伤
- **色彩冲突**：影像图色彩天然杂乱，叠加高饱和 marker 后对比度会崩，必须给 marker 加白色描边
- **流量**：影像瓦片是矢量瓦片的 5–10 倍

**结论**：

> 桌面端默认**影像底图** —— 第一眼价值在"这是座什么样的城市"。
> 移动端默认**矢量底图** —— 影像瓦片体积是矢量的 5–10 倍，4G 下首帧代价太高。
> `zoom ≥ 15.5` **自动降级为矢量图** —— 此时用户目标已从"感受城市"切换为"找到这个点"。
> 自动切换配三重保护：**迟滞区 + 一次性说明 + 锁定开关**（见 2.4）。

### 2.2 底图配置（腾讯的 `setBaseMap` 模型）

腾讯与高德的底图 API **形态完全不同** —— 腾讯是**一个底图对象带特性开关**，高德是**图层叠加**：

| | **腾讯 GL JS** | 高德 JS API 2.0 |
|---|---|---|
| 矢量底图 | `setBaseMap({ type: 'vector', features: [...] })` | `AMap.createDefaultLayer()` |
| 卫星底图 | `setBaseMap({ type: 'satellite', features: [...] })` | `new AMap.TileLayer.Satellite()` |
| 路网注记 | **`features` 数组里的 `'road'`** | 独立 `TileLayer.RoadNet()` 图层 |
| 切换方式 | `map.setBaseMap(...)` 一行搞定 | `map.add/remove(layer)` 或 `setLayers([...])` |

```ts
// app/map/tencent/basemap.ts

/**
 * 腾讯底图 = 一个对象 + features 特性开关
 * ⚠️ 卫星图必须带 'road'，否则得到一张没有路名地名的影像图，用户完全失去参照
 */
export function baseMapConfig(kind: BaseMapKind): TMap.BaseMapOptions {
  return kind === 'satellite'
    ? { type: 'satellite', features: ['base', 'road'] }
    : { type: 'vector',    features: ['base', 'road', 'building'] }
}

export type BaseMapKind = 'vector' | 'satellite'
```

> ⚠️ **裸卫星图不要用** —— `features` 只给 `['base']` 会得到**没有任何路名与地名标注**的影像图。**必须带 `'road'`**。
>
> 💡 这比高德省事：高德要 `map.add/remove` 两个图层对象且**必须自己留住句柄**；腾讯只是改一个配置对象，不存在"句柄管理"问题。

### 2.3 自动降级实现（核心逻辑）

关键设计：**区分「用户意图」与「实际渲染底图」**。

这是自动切换最容易做错的地方 —— 用户意图是"我要影像图"，系统根据 zoom 临时降级渲染。两者必须分开存，否则用户一缩放就感觉"我的选择被改了"。

```ts
// app/map/tencent/basemap.ts
const SWITCH_AT  = 15.5     // 越过此级别 → 切矢量
const HYSTERESIS = 0.5      // 迟滞宽度：跌回 15.0 以下才切回影像

/**
 * 底图状态机
 * preference — 用户意图，持久化到 localStorage，只有用户能改
 * locked     — 用户锁定后，停用一切自动切换
 * effective  — 实际渲染的底图，由 preference + zoom 共同决定
 */
export function resolveBaseMap(
  preference: BaseMapKind,
  locked: boolean,
  zoom: number,
  prevEffective: BaseMapKind,
): BaseMapKind {
  if (locked || preference === 'vector') return preference

  // 迟滞：已处于矢量时，要跌回 SWITCH_AT - HYSTERESIS 才允许切回影像
  const threshold = prevEffective === 'vector' ? SWITCH_AT - HYSTERESIS : SWITCH_AT
  return zoom >= threshold ? 'vector' : 'satellite'
}
```

**迟滞区为什么必须有**：没有它，用户在 15.5 边界轻微缩放会让底图疯狂闪烁 —— 每缩放 0.1 就重发一整屏瓦片，既费流量又像是故障。

监听 zoom 事件（⚠️ 腾讯的事件名就是 **`zoom`**，见第八节踩坑 1）：

```ts
let effective: BaseMapKind = 'satellite'

function applyBaseMap(map: TMap.Map, kind: BaseMapKind) {
  map.setBaseMap(baseMapConfig(kind))
  // 顺带同步底图署名：影像与矢量的版权文案不同，别残留上一个
}

const onZoom = () => {
  const next = resolveBaseMap(pref, locked, map.getZoom(), effective)
  if (next === effective) return               // 没变就不动，避免无谓重绘
  effective = next
  applyBaseMap(map, next)
}
map.on('zoom', onZoom)
// ★ 腾讯 map.on() 返回的是 map 实例，不是取消订阅函数 → 解绑必须 map.off
map.off('zoom', onZoom)
```

> 💡 **比高德简单**：腾讯不需要管理图层句柄（高德 `map.remove(layer)` 必须传入当时 `new` 出来的那个对象），一个 `setBaseMap(config)` 就够了。

### 2.4 三重保护（自动切换不能"夺权"）

| # | 保护 | 实现 |
|---|------|------|
| 1 | **迟滞区** | 见 2.3，防临界抖动闪烁 |
| 2 | **一次性说明** | 首次触发时底部弹轻提示：「已自动切换为矢量图 · 放大后影像难以辨认建筑入口」+ `[知道了]` `[以后不要自动切]`。同一浏览器仅提示一次（`localStorage` 记位） |
| 3 | **锁定开关** | 地图控件组里底图开关旁加锁定图标。锁定后不再自动切换，只跟随用户意图 |

**降级期间的 UI 表达**：底图开关显示为「影像图（已临时降级）」，**不要直接显示成「矢量图」** —— 否则用户会以为自己的选择丢了。

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

### 2.6 底图分端默认与性能代价

| 项 | 矢量瓦片 | 影像瓦片 |
|----|---------|---------|
| 瓦片格式 | PBF（压缩矢量） | JPG |
| 单屏流量 | 约 1x | **约 5–10x** |
| 首帧速度 | 快（十几 KB） | 慢（数百 KB） |

| 端 | 默认底图 | 理由 |
|----|---------|------|
| 桌面（L / XL） | **影像图** | 带宽充裕，城市肌理 / 海岸线 / 山海地形是第一眼冲击力 |
| 移动（S / M） | **矢量图** | 影像瓦片体积是矢量的 5–10 倍，4G 下首帧明显更慢 |

```ts
// app/map/tencent/basemap.ts
export const DEFAULT_BASEMAP_BY_VIEWPORT = {
  mobile: 'vector',
  desktop: 'satellite',
} as const

// 只在首次初始化时取默认值；之后一律以用户意图（localStorage）为准
const initialBasemap =
  storedPreference ??
  DEFAULT_BASEMAP_BY_VIEWPORT[isMobileViewport() ? 'mobile' : 'desktop']
```

> 迟滞自动降级状态机**两端共用**。移动端默认就在矢量档，实际只在用户手动切到影像后才可能触发降级。

**不要**做的事：
- ❌ 不要叠加实时路况图层 —— 额外瓦片开销 + 与 marker 抢视觉（**行程规划里的路况是路线规划接口返回的 `duration` 与 `get_speed`，不是靠路况图层**）
- ❌ 不要在移动端做「矢量打底 → 影像淡入」的渐进升级 —— 移动端默认已是矢量

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
| I8 | 底图切换 | 矢量 ↔ 影像（`setBaseMap`），**用户意图**持久化；降级期间显示「影像图（已临时降级）」 |
| I9 | 放大到街区级（zoom ≥ 15.5） | **自动降级为矢量图** + 迟滞 + 一次性说明（见 2.4） |
| I10 | 锁定底图 | 锁定后停用自动降级，只跟随用户意图 |
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

> ⚠️ **`freeRect()` 的两个实现坑**（原型阶段踩过，务必照抄）：
> 1. **缩放必须用实测值**：`vp.getBoundingClientRect().width / vp.offsetWidth`，**不能用 state 里的缩放值** —— 页面缩放动画（transform 过渡）尚未生效的那一帧，state 与真实渲染不一致，会算错空区。
> 2. **可见性判定只按 `display` / `visibility`，不能按 `opacity` 过滤** —— 浮层入场动画从 `opacity: 0` 起步，按 opacity 过滤会把正在入场的浮层漏掉，导致空区算大、点位被压。

**浮层档位变化时要重算**：详情抽屉打开（620px）时，空闲区会明显收窄，此时应重新调一次 `fitBounds`。**但不要在地图拖动时反复调** —— 只在浮层显隐/换档的那一次重算。

> 💡 **换引擎的代价**：高德有 `setBounds(bounds, immediately, avoid)` 的 `avoid` 参数直接对应这个语义；**腾讯没有 `avoid`，只能走 `padding`**。所以原型阶段手写的那套 `freeRect()` 逻辑，在腾讯这边**是必需的，不是过渡方案** —— 它是正式实现，直接移植到 `app/map/tencent/fitView.ts`。

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
  drillPath: string[]               // 面包屑路径

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

  // ── 底图三态（见 2.3 / 2.4）─────────────────
  basemapPreference: 'vector' | 'satellite'  // 用户意图，持久化到 localStorage
  basemapEffective:  'vector' | 'satellite'  // 实际渲染，可被 zoom 自动降级
  basemapLocked: boolean                     // 锁定后停用自动降级
  basemapHintShown: boolean                  // 一次性说明是否已展示
}

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
4. ⚠️ **卫星底图必须带 `features: ['base', 'road']`** —— 只给 `['base']` 会得到一张**没有任何路名地名**的影像图，用户完全失去参照。
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
| **版权署名** | 腾讯要求在地图图面保留版权信息位（形如「© 腾讯地图」+ 审图号）。**不得遮挡或移除**；切换底图时署名文案要跟着变 |
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
| M4 | 底图状态机（**分端默认** + 自动降级 + 迟滞 + 锁定 + `setBaseMap`） | `map/tencent/basemap.ts` | M3 |
| M5 | POI 图层（`MultiMarker` + `MultiLabel`，按 subtype 分色 + `setGeometries` 更新） | `map/tencent/poiLayer.ts` | M3 |
| M6 | ★ **自研标注避让**（密度控制 + 贪心碰撞检测 + zoom/moveend 触发） | `map/tencent/labelAvoidance.ts` | M5 |
| M7 | **视野适配**：浮层实测 → `freeRectToPadding()` → `fitBounds` | `map/tencent/fitView.ts` | M3 |
| M8 | InfoWindow + 列表双向联动（桌面端） | `hooks/useMapSync.ts` | M5/M7 |
| M9 | 地图样式落地（控制台个性化样式） | — | M4 |
| M10 | **移动端点位密集**：`MarkerCluster` 接入（`gridSize` 60 / `maxZoom` 16） | `map/tencent/cluster.ts` | M5 |
| M11 | 自动降级的一次性说明 + 锁定开关 | — | M4 |
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
