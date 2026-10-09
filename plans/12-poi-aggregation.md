# 12 · 密集点位的聚合

> **状态：2026-09-22 已落地。** 用户原话：
> 「有些地方的景点很密集，一下全撒了就会密密麻麻。有些密集的情况应该显示 x 个景点，
> 点击后再放大地图；如果放大之后还是密，就还是显示 x 个，再点再放大。」
>
> 结论：**不自研 —— 用腾讯 GL 内置的 `MarkerCluster`**（本项目移动端 2020-09-20 起就在用，
> 这不是引新依赖）。用户描述的三件事全是它的默认行为。
>
> ★ 第二轮（读 SDK 真源码 + 真机实测）推翻了三条来自文档的说法，并把 `maxZoom` 定成 16。
> ★ 第三轮落地：抽稀去重整体删除、两端统一聚合、名字只挂独立点、**结算改轮询**（见 §九）。
>
> **落地后的实测（成都，1440×900，镜头压天府广场）**：
>
> | zoom | 11 | 12 | 13 | 14 | 15 | 16 | 17 |
> |---|---|---|---|---|---|---|---|
> | 视野内点 | 44 | 43 | 40 | 35 | 19 | 9 | 3 |
> | 簇 | 13 | 15 | 20 | 23 | 17 | 7 | 3 |
> | **其中气泡** | 4 | 7 | 9 | 10 | 6 | 2 | **0** |
> | 独立点（有名字） | 9 | 8 | 11 | 13 | 11 | 5 | 3 |
> | 名字上屏 | 9 | 8 | 10 | 13 | 10 | 5 | 2 |
>
> 气泡随放大逐级减少、`z>16` 归零；名字从不超过独立点数（无幽灵标注）。


---

## 一、现在错在哪：我们做的是「抽稀丢弃」，用户要的是「聚合计数」

`dotBudget.pickDots` 是「这一屏撒哪几枚点」的**唯一**算法，四道闸门：

```
① 投影（一次）
② 网格抽稀   每 DOT_MIN_GAP_PX(18px) 见方的格子里只留最热的一枚
③ 总量闸门   按缩放档位取前 N（zoomTiers.poiTierForZoom）
④ 像素去重   贪心欧氏距离，最终保证两枚圆点不重叠
```

②④ 两步的语义是**把多出来的点扔掉**。于是屏幕上「这一片只有 3 个景点」，
而数据里有 12 个 —— 这不是可读性，这是**无声的信息丢失**：用户既不知道
少显示了，也没法把那 9 个找回来（只能去左侧列表翻）。

用户要的是**聚合**：密处的点合并成**一个计数气泡**，点它放大，逐级展开。
「有多少」这件事必须被如实说出来。

---

## 二、为什么不自研：业界现成的就是它

### 2.1 它早就在项目里了

`poiLayer.ts` 的 `cluster: isMobile` 分支 2026-09-20 起就在用 `TMap.MarkerCluster`
（当时只给移动端）。也就是说这不是"引一个新依赖"，是**把已经跑着的东西推广到两端**。

### 2.2 用户描述的三件事，全部是它的默认行为

| 用户原话 | MarkerCluster 对应能力 | 参数 |
|---|---|---|
| 「显示 x 个景点」 | 默认样式就是**数字气泡**：40px 圆、文字**就是数字本身** | `enableDefaultStyle: true`（默认） |
| 「点击后再放大地图」 | 点一下 → `fitBounds(簇的 bounds)`（**不是 +1 级**，见 §2.3） | `zoomOnClick`（默认 true，**我们要改成 false**） |
| 「放大之后还是密，就还是显示 x 个，再点再放大」 | 聚合算法的固有行为：`zoom ≤ maxZoom` 之内，簇内 > 1 就继续是气泡 | `maxZoom` |
| 「这个密集算法你看怎么计算」 | **距离聚类**：与已有簇心距离 < `gridSize` 就并入（不是网格） | `gridSize`（默认 60px） |
| — | 形成簇的最小点数（1 个点不该变气泡） | `minimumClusterSize`（默认 2） |
| — | 簇心取成员平均 | `averageCenter`（**默认就是 true**，不必传） |

自研要重做的是：聚类、屏幕命中、气泡渲染、点击放大、簇心计算 ——
**这五样现成的都已经验证可用**。所以本节就是结论：用它。

### 2.3 读真源码得到的四条硬事实（2026-09-22）

★ `tmap.d.ts` 是我们自己手写的（骨架 16 号坑：**手写声明只证明"声明与调用一致"，
不证明"声明与 SDK 一致"**）。所以这轮直接把 SDK 源码抓下来读
（`_tmp/tmap_gl.js`，2.37MB，`_tmp/_sdk_ctx.mjs` 按符号打印上下文窗口）。

| # | 事实 | 源码证据 | 对我们的影响 |
|---|---|---|---|
| 1 | **单个点也走默认样式**：`count === 1` 时插一张 `<img height=32>`（腾讯自带的水滴图标），`count > 1` 才是数字气泡 | `_updateContent`：`if(1===this.count){ … createElement("img") … } else { … textContent=this.count }` | ★ **我们自己的细类配色圆点在图上会消失** —— 见 §七 |
| 2 | **给 geometries 传 `styleId` 是无效的** | `_checkGeometries` 里 `e.styleId && t[e.styleId] \|\| (e.styleId="default")`，而构造时 `_checkGeometries(i.geometries)` **只传了一个参数** → styles 表恒为空 → 每个 styleId 都被改写成 `"default"` | 想保配色只能自绘（`enableDefaultStyle: false`） |
| 3 | **`click` 事件里 `evt.geometry` 永远不会出现，永远是 `evt.cluster`** | `_constructOverlay`：`t.geometries ? e.cluster = t : e.geometry = t`，而 `normalizeClusterInfo` **给每个簇都带 `geometries` 数组**（单点簇 = 长度 1） | 判断"点的是气泡还是单点"要读 `evt.cluster.geometries.length`，不是看有没有 `evt.geometry` |
| 4 | **`zoomOnClick` 是 `fitBounds(簇的 bounds)`，不是"放大一级"**；且**单点也会触发** | ① tap 处理器：`t.instance.geometries && t.visible && t.zoomOnClick && t.map.fitBounds(t.instance.bounds)`；② 簇的 `bounds = _getExtendedBounds(Rect(center,center), zoom)` = 以簇心为中心、**向外扩 `gridSize`** 的框 | 单点被点会连带跳 3~4 级 → **必须改成 `zoomOnClick: false` + 自己接**（见 §3.5） |

★ 顺带纠正两处**文档不等于实现**：`enableDefaultStyle: false` 时 `_repaint` **整个不渲染**
（源码里没有 else 分支），所以"自绘"不是配一下样式，而是自己写渲染 + 自己接点击。
`averageCenter` 的默认值是 **true**（`false !== i.averageCenter`），先前写"默认 false"是错的。


### 2.4 运行时实测取证（CDP 探针 `_tmp/cdp_click_cluster.mjs`，2026-09-22）

不查记忆、不抄博客，直接从运行时原型 + 真实例读：

```
原型方法:
  constructor, setMap, setGeometries, updateGeometries, _bindEventHandler,
  _removeEventHander, getMap, _createLayer, _removeLayer, _resetViewport,
  _redraw, _repaint, _constructOverlay, _checkClusterChange, _checkGeometries,
  getClusters, zoomInCluster, setVisible, getVisible, destroy

getClusters() → 10 个簇（成都 46 个点 / gridSize 60 / z=11.19）
  每簇 = { center: LatLng, geometries: PointGeometry[], bounds: {_sw, _ne} }
  每个 geometry 带 properties.id · styleId:'default' · hasCluster:true
     ↑ 这里就是 §2.3 事实 2 的现场证据：我们传进去的 styleId 已被改写成 'default'
```

★ `getClusters()` 是**异步**的 —— 聚类跑在 worker 里（`map.addSource(type: geoTask,
workerOptions:{gridSize, minimumClusterSize, averageCenter})`），结果通过回调落到
`this.clusters`，再 `emit('cluster_changed')`。所以**"哪些点是独立点"不能在
`setGeometries()` 之后的下一行读**，必须等 `cluster_changed`。方案 A 的名字层依赖这一点（§3.3）。

★ 从中读出两条**决定实现方案**的事实：

1. **独立点也是一个簇**（`geometries.length === 1`）——
   "哪些点没被聚合"是**可以直接问出来的**，不必猜。这决定了桌面端名字层能不能保住（见 3.3）。
2. **`zoomOnClick` 与 `click` 事件只对默认样式生效**（官方文档原话）。
   想要自定义气泡外观，必须 `enableDefaultStyle: false` 并继承 `DOMOverlay` 自绘 ——
   代价是"点击放大"和"点中簇"两件事也都得自己做。

---

## 三、要改的三处（均已落地，见 §九）

> 落点：`dotBudget.ts` **整个删除**；`zoomTiers.PoiTier.dots` → **`admitsPoints: boolean`**；
> 聚合层新建 `poiCluster.ts`；`poiLayer.ts` 重写成「聚合 + 选中 + 名字」三层。

### 3.1 `pickDots` 降级为「护栏」（本方案的核心改动）

聚合与抽稀**不能共存**：抽稀先把点扔了，聚合再对剩下的点计数 ——
气泡上的数字是**抽稀后的数字**（12 个点抽剩 3 个，气泡写「3」）。
那不是"如实计数"，是把原来的问题换了个样子。

所以：

| 闸门 | 现在 | 改后 | 理由 |
|---|---|---|---|
| ② 网格抽稀 | 18px 格留最热一枚 | **关掉** | 丢弃点 = 计数失真，与聚合的语义直接冲突 |
| ③ 总量闸门 | 按档位取前 N（`zoomTiers`） | **保留但改性质**：只防"数据爆炸"（如 z<8 仍归零 / 上限抬到几百） | 46 个点不需要截断，但将来某个城市 2000 个点需要 |
| ④ 像素去重 | 贪心欧氏 ≥18px | **关掉** | 完全重合的点正是**最该被聚合**的，不该互相顶掉 |

`zoomTiers.poiTierForZoom().dots` 的语义随之变化：从"这一档撒几枚"变成
"这一档最多允许多少个点进入图层"。`< 8 → 0`（离开本城全部收起）**保持不变**，
理由是它解决的不是密度问题，而是"这一级的内容离开了这一级的地盘"。

> ⚠️ 连带影响：`DOT_MIN_GAP_PX` 这个常量只在抽稀/去重里用。关掉两步之后它
> 要么删掉，要么改作 `MarkerCluster.gridSize` 的推导来源 —— 二者是同一个念头
> （"两个点多近算一个"），不该留两套数字。

### 3.2 两端统一开聚合

现在 `cluster: isMobile`（移动端聚合 / 桌面端圆点+名字），而 `zoomTiers` 的注释
已经写过"同一句话两端只有一个答案"。聚合也该如此：

```ts
// 改前：cluster: isMobile
// 改后：两端都交给 MarkerCluster
```

### 3.3 桌面端的名字层怎么办（唯一需要取舍的地方）

聚合成气泡之后，**气泡没有名字**（这是所有地图产品的通行代价）。桌面端现有的
「圆点 + 白底名字标签」会失去一半。

三条路：

| 方案 | 做法 | 代价 |
|---|---|---|
| **A（推荐）** | 用 `getClusters()` 挑出 `geometries.length === 1` 的**独立簇**，只给这些点挂名字 | 实现上多一次读取；密集处的点放大前没有名字 |
| B | 完全不要名字层，放大到 `maxZoom` 以上才见名字 | 桌面端的可读性优势没了 |
| C | 桌面端不聚合，维持现状 | 两端两个答案；且桌面依旧是"抽稀丢弃"，用户的问题没解决 |

选 **A** 的理由：它**不会产生幽灵标注**（名字绝不可能落在已被聚合的点上 ——
因为名字的候选集就是从"独立簇"来的）。这正是项目一直在守的红线
（"有名字没有点"是踩过的坑）。

### 3.4 选中项必须排除在聚合之外

现在 `pickDots` 有一条"选中项**先占位**、不受档位淘汰"的规矩：
用户在左侧列表点了一个点，地图上就必须能看见它。

**聚合会让这条规矩失效** —— 被聚合进气泡的点，地图上没有它自己的位置。

做法：**选中项单独画一层**（不进 `MarkerCluster`），复用现成的 `sub-<subtype>_A`
样式（28px 白环 + 彩色圆心）。它本来就是为了"在一堆同色点里把这枚衬出来"而设计的。
其余点进聚合层。

### 3.5 点击必须自己接（`zoomOnClick: false`）

§2.3 事实 4 说清了 SDK 默认行为：**点什么都 `fitBounds(簇的 bounds)`**，
而那个 bounds 是以簇心为中心、向外扩 `gridSize`（60）的框 ——
于是一个 1440px 宽的地图去 fit 一个 120px 宽的框，**缩放直接跳 ≈ 3.6 级**。

- 点**气泡**：跳 3.6 级 → 正是用户要的"点击后放大地图" ✔
- 点**单个点**：也跳 3.6 级 ✘ —— 用户点一枚景点是为了看详情（预览卡），
  结果镜头同时被推走，卡底下的地图整个换了。

所以 `zoomOnClick` 关掉，点击由我们分派：

```ts
cluster.on('click', (evt) => {
  const c = evt.cluster            // ★ 永远是这个，见 §2.3 事实 3
  if (!c) return
  suppressMapClickUntil = performance.now() + MAP_CLICK_SUPPRESS_MS   // 空白点击的抑制窗，照旧
  if (c.geometries.length > 1) cluster.zoomInCluster(c)               // 气泡 → 放大（SDK 自己的方法）
  else opts.onSelect?.(c.geometries[0].properties.id)                 // 单点 → 开详情，不动镜头
})
```

★ `zoomOnClick: false` **不影响 `click` 事件**（源码里两条语句并列，
缩放那句带 `&& t.zoomOnClick`，`emit('click')` 那句不带）。

---

## 四、参数取值（第二版，`maxZoom` 已实测）

| 参数 | 取值 | 理由 |
|---|---|---|
| `enableDefaultStyle` | `true`（默认） | 默认样式才有 `click` 事件与气泡渲染；自绘＝自己写渲染（§2.3 末） |
| `gridSize` | `60` | 官方默认。★ 它就是 `DOT_MIN_GAP_PX` 的像素级同义词 → 只留一个数（§3.1） |
| `minimumClusterSize` | `2` | 一个点不该变成气泡 |
| `maxZoom` | **16** | 见下表，**不是 15** |
| `averageCenter` | `true`（默认） | 不必显式传 |
| `zoomOnClick` | **`false`** | 见 §3.5 —— 单点被点不该跳镜头 |
| `id` | `'poi-cluster'` | 已有 |

### 4.1 `maxZoom` 实测（用户问题 ③「得你去验证才能知道效果」）

探针 `_tmp/cdp_cluster_zoom.mjs`：真机造一个 `MarkerCluster`，喂成都**全部 46 个真实点位**，
镜头压在点位质心（30.6751, 104.0371），逐档 `setZoom` 后读 `getClusters()`：

| zoom | 簇数 | 其中多成员簇 | 最大簇 | 成员数 | 视野内点 |
|---|---|---|---|---|---|
| 11（桌面城市取景 11.02） | 8 | **3** | **30** | 44 | 44 |
| 12 | 12 | 7 | 11 | 43 | 43 |
| 13 | 17 | 8 | 9 | 41 | 38 |
| 14 | 17 | **10** | 4 | 31 | 28 |
| 15 | 9 | **2** | 3 | 12 | 10 |
| 16 | 1 | 0 | 1 | 1 | 0 |
| 17 及以上 | 0 | 0 | 0 | 0 | 0 |

**三条结论：**

1. **`maxZoom` 取 16，不取 15。** `maxZoom` 的语义是 `zoom ≤ maxZoom` 才聚合
   （实测：`maxZoom=14` 时 z=15 已经 0 个多成员簇，`maxZoom=15/16/20` 时 z=15 都还有 2 个）。
   而 z=15 时**还剩 2 组 3 点簇** —— 这正是用户说的「放大之后还是密」。
   取 15 会**早一档停**，把这两组散成 6 个互相重叠的图标；取 16 让该聚的聚到自然消失。
   （z=16 那一档「视野内 0 个点」是因为视野已经缩到 2km 以内，配得上"聚不聚都无所谓"。）
2. **`maxZoom` 的下限是城市取景缩放**（桌面 11.02 / 移动 9.74）：低于它，一进城市页就没有聚合。
   15 / 16 都满足，但这条约束要写进注释 —— 它是"取景值会随容器变"的那类数。
3. **不需要自己按视野预筛点位**：实测 `成员数 == 视野内点数`（z=11/12 精确相等，
   z=13/14 因簇的边界外扩多带进 2~3 个框外的点）。SDK 自己只聚 `mapBounds` 内的点
   （`_getExtendedBounds(mapBounds)` + `isInBounds`）。所以 `pickDots` 里那道
   **屏幕投影闸门也可以去掉** —— 自己筛一遍只会和 SDK 的边界打架。


---

## 五、与现有机制的关系

- **reveal（缩放揭示）与聚合是正交的两件事**：reveal 管"层级之间"（省 → 市 → 点），
  聚合管"同一层级内部"（这一级的点太密）。首页/省级页放大到 `POI_REVEAL_ZOOM=8.5`
  之后才可能出现点位，那时才轮到聚合生效。
- **护栏 T / V 项不受影响**：`pickDots(` 仍在 `repaint()` 函数体内（T 项的判据是
  调用形式），V 项要求"先 `pickDots(` 再分端"也仍然成立。但**内部行为变了**，
  所以需要**新增判据**（见下）。
- **`describeTierRules()`**（开机打的那张规则表）要跟着改口径 —— 它现在写着
  "圆点：z<9 → 8 枚"，改后应读作"进入图层的上限"。

---

## 六、验收判据（落地时要逐条实测）

| # | 判据 | 怎么测 |
|---|---|---|
| 1 | 成都在 z≈11 时屏幕上是**气泡**，不是一个个人圆点 | CDP 截图 + `getClusters().length` |
| 2 | 点气泡 → 缩放**增大** | 点前点后读 `__tmap.getZoom()` |
| 3 | 一路点下去，最终**全展开**为单点（跨过 `maxZoom`） | 连续点击直到 `getClusters()` 里不再有 `length > 1` 的簇 |
| 4 | 独立点**仍有名字**；被聚合的点**没有**名字 | 读图层 `stats().labelNames` 与 `getClusters()` 对账 |
| 5 | 左侧列表选中的点在地图上**可见**（不被气泡吞掉） | 点列表项 → 截图 / 数圆点 |
| 6 | **点单个点 → 开详情，且镜头不动**（`zoomOnClick: false` 的落点） | 点前点后 `getZoom()` 必须相等 |
| 7 | 两端同一个 zoom 下气泡数一致 | 1440 与 390 两个宽度各跑一次 |
| 8 | 0 运行时/水合报错 | `window.__errs` |

**新增的静态判据**（`tools/check_app.py`，落地时加、且**必须反证**）：

- `poiLayer.ts` 里 `map.on('click'` 必须配一条 `map.off('click'`（腾讯 `on()` **不返回取消函数**，
  漏掉就是切页后旧图层的空白点击还在生效 —— 不报错、只是"多点一次"）；
- `MarkerCluster` 的构造参数必须是 `setGeometries`（**没有 `setData`**，踩过一次）；
- **`zoomOnClick` 必须是 `false`**，且 `cluster.on('click'` 里必须调 `zoomInCluster(`；
- **源码里不得出现 `evt.geometry`**（§2.3 事实 3：它永远不会被赋值，写了就是死分支）；
- `gridSize` 的取值只能有一处出处（不许再留 `DOT_MIN_GAP_PX` 的第二份数字）；
- 若采用 3.3 方案 A：`getClusters(` 必须出现在 `repaint()` 附近（名字层的候选集来源），
  且**必须在 `cluster_changed` 里读**（§2.4：聚类是 worker 异步算的）。


> ⚠️ **验收环境的硬限制（2026-09-22 实测，已记进 `TRAPS.md`）**：
> headless Chrome 下腾讯 GL 的**覆盖物层完全不渲染** —— 连手动
> `new TMap.MultiMarker` 打 3 个大红点都不显示，而**同一张 canvas 上的底图正常**。
> 去掉 `--disable-gpu` 也一样。
>
> 所以上表里 1 / 2 / 3 / 5 这几条**无法用 CDP 验**（它们全依赖"屏幕上真的画出来了"），
> 只能在真实浏览器里看。CDP 能自动化验的是**数据面**：
> `getClusters()` 的簇数、图层 `stats()` 的读数、`__mapLog` 的日志 —— 这三样在
> headless 里都正常（实测成都 46 点 / gridSize 60 / z=11.19 → 10 个簇）。
>
> 这一条值得单独记住：**"CDP 里看不见圆点"不等于"圆点没画"** ——
> 本项目上一轮的三块重构验收里，城市页截图**一直都是没有圆点的**，
> 但那不是 bug。判断"屏幕上有没有"必须靠 `stats()` / `__mapLog`，不能靠截图。

---

## 七、决定记录

| # | 问题 | 结论 | 时间 |
|---|---|---|---|
| 1 | 桌面端名字 | **方案 A** —— 只有独立点有名字，密集处放大后才见名 | 2026-09-22 用户：「1 可以」 |
| 2 | 气泡外观 | **用 SDK 默认样式**（数字圆气泡） | 2026-09-22 用户：「2 就用默认的」 |
| 3 | `maxZoom` | **16**（实测见 §4.1；原建议 15 会早一档停止聚合） | 2026-09-22 实测后定 |

### 7.1 默认样式下"单个点"没有我们的配色 —— 已按 ② 落地

读源码时发现的（§2.3 事实 1、2）：**`enableDefaultStyle: true` 时，
`count === 1` 的点会用腾讯自带的水滴图标（`<img height=32>`），
而我们传的 `styleId` 会被 SDK 改写成 `'default'`。**

也就是说，"用默认气泡"这个选择会连带产生一个副作用：
**地图上所有普通点位失去细类配色**（红线 11「细类定色」在图上失效）。

用户听完这段后的答复是「那就开始改吧」—— 与已定的 1、2 条合并起来，唯一自洽的读法是 **②**：
**接受默认样式，但把「选中项」画在我们自己的层上**（它本来就必须单独一层，
否则点了列表里的点、地图上会被气泡吞掉）。
所以现在地图上**只有"当前选中的那个点"还带细类配色**（28px 白环 + 彩色圆心），
点位详情页也因此没塌。若将来要**全部**配色，走 ③（自绘渲染），改动只落在渲染层。

## 八、明确不做

- **不引第三方聚类库**（supercluster / kdbush 等）：腾讯 GL 已内置等效能力，
  引进来还要自己写图层适配，且失去 `click` 事件。
- **不做聚簇展开动画**（点气泡时逐个散开）—— 它不是需求的一部分，且要接管渲染。
- **不保留"抽稀丢弃"作为降级路径**：两套语义并存必然导致"有时候计数对、有时候不对"。
- **不用 CSS 去藏 SDK 画出来的水滴**（"单点换成我们自己的点"那种小聪明）：
  SDK 渲染在它自己的 DOM 里，靠选择器去命中等于赌它的内部结构（版本一升就静默失效）。
  要保配色就走 ③ 的正路。


---

## 九、落地实录（2026-09-22）

### 9.1 改了什么

| 文件 | 动作 |
|---|---|
| `common/map/tencent/dotBudget.ts` | **删除**。它整份职责（抽稀 + 总量闸门 + 像素去重）就是"把点扔掉"，与"气泡数字要如实"直接冲突 |
| `common/map/tencent/poiCluster.ts` | **新增**：聚合层封装（参数 / 点击分派 / 落地结算 / 读数）。不对外导出 —— 绕过它建聚合层就没有档位准入 |
| `common/map/tencent/poiLayer.ts` | **重写**成三层：聚合 + 选中 + 名字；文件从 468 行拆到 ~370 行（G 项上限 420） |
| `common/map/tencent/zoomTiers.ts` | `PoiTier.dots` → **`admitsPoints`**（"给几枚"这件事没有了）；新增 `POI_CLUSTER_MAX_ZOOM = 16` |
| `common/map/tencent/tmap.d.ts` | `MarkerCluster` 补 `zIndex` / `enableDefaultStyle` / `averageCenter` / `ClusterInfo` / `ClusterEvent`；`MultiOverlay` 补 `destroy()` |
| `common/logic/{useCityView,useMapReveal,usePoiView}.ts` | `cluster: isMobile` → **`names: !isMobile`**（两端聚合一致，只差"独立点挂不挂名字"）；日志改由 `onSettled` 记 |
| `common/logic/mapLog.ts` + `ui/MapLogPanel.tsx` | 日志字段 `dots/cluster` → **`aTotal` / `clusters` / `bubbles`**；新增"名字多于独立点（幽灵标注）"判据 |
| `tools/check_app.py` | T 项重写（准入 + 死符号全树绝迹）、V④ 换判据、**新增 Z 项**（聚合接线五条） |

### 9.2 落地时踩到的三件事（都写进 TRAPS 了）

1. **`setGeometries()` 会同步清空 `clusters`** —— 紧接着读 `getClusters()` 恒为 0。
2. **SDK 自己也会重聚类**（视野一变就 `_resetViewport` + `_redraw`），所以
   `cluster_changed` 会来**不是我们那次**的；按它结算会把旧缩放的簇数记到新缩放上，
   而日志的内容去重会把那条正确记录吃掉 —— 表现为"某一档没有记录"。
3. **"多久出结果"不能猜**：独立小实验 47ms，真实城市页（瓦片正在加载）**300ms 都还没出**。
   第一版按固定时长结算 → 日志里 z≥12 稳定全是「簇 0」，而屏幕上明明有气泡。

⇒ 最终实现（`poiCluster.trySettle`）三道条件 + 轮询：是我们那次 · 真拿到结果 · 或真没有点/等到上限（2s）。

### 9.3 验收

* `check_app.py` **A–Z ALL_CLEAN**（含真 `tsc`）；**13 条反证全过**（`_tmp/_falsify_z.py`）。
* `_tmp/cdp_agg_verify.mjs` **ALL_PASS**：
  * 逐档扫（见文首表）：气泡随放大减少、`z>16` 归零、名字从不超过独立点；
  * 两个**同坐标**点合成 1 个簇、2 个成员（去掉旧的 jitter 是安全的）；
  * **DOM 覆盖物可点**：点气泡 `zoom 11 → 13.74`；点单点 zoom 不变**且预览卡打开**；
  * 城市页 → 首页 → 城市页来回，地图正常、**零运行时错误**（新加的 `destroy()` 没搞坏卸载）。
* `pnpm build` ✓（390 个预渲染页；收尾 `dist/server` 的 EPERM 是既有的沙箱行为）。
* ★ **canvas 覆盖物仍然无法在 headless 里验**（圆点/名字），只有 DOM 覆盖物（气泡）能 —— 细则见 TRAPS。

---

## 十、落地后修的两个问题（2026-09-23，用户报的回归）

用户原话：「你现在撒点的逻辑有问题，现在就显示了个景点标签，点不显示了，
点标签也不显示景点信息」。两句是**同一个渲染选择**带出来的两个后果，
但都不在"聚合逻辑"里。

### 10.1 单点整个看不见 —— Tailwind Preflight 把 SDK 的标记图压成 0×0

| | |
|---|---|
| 现象 | **数字气泡正常**，**单个点完全不可见**，名字却挂在图上。高缩放（`> maxZoom 16`）全部展开成单点时，屏幕上只剩一串名字 |
| 根因 | 默认单点标记是 **DOM `<img>`**（源码 `var i=document.createElement("img"); i.height=32; i.src=Ud; i.style.cssText="position:absolute;bottom:16px"`），而 Preflight 的 `img{display:block;max-width:100%;height:auto}` 里 `height:auto` 覆盖掉 `height` **属性**、`max-width:100%` 又对着"宽度由内容决定"的宿主（`position:absolute` + 无宽度）解析 → 循环依赖 → **0×0** |
| 取证 | `_tmp/cdp_preflight.mjs`：9 张标记图 rect 全 `0x0`，计算样式 `width:0px; height:0px; max-width:100%`；就地抬掉这三条 → 全部 `22×32` |
| 修法 | `app.css` 新增 `.map-layer img[height] { height:32px; width:32px; object-fit:contain; max-width:none }` |

为什么是这四条（每一条都是**量出来**的，不是凑的）：

* `height: 32px` —— 把属性救回来。**只抬 `max-width` 不行**：实测会变成 `32×47`
  （按原始 68×100 的比例铺开），比目标高一截。
* `width: 32px` + `object-fit: contain` —— SDK 给单点留的盒子是 **32×32**（源码
  `"width: 32px;", "height: 32px;"`），而默认图是 **68×100 的水滴**（不是方的）。
  只写 `height` 时图宽 22px、贴盒子左边放 → 水滴**整体偏左 9px**
  （`_tmp/cdp_align.mjs`：点位投影 x=1249、标记中心 x=1240）。补上后 9px → 4px。
* `max-width: none` —— 那个"对着无宽宿主解析"的元凶。

★ 剩下的 **4px 偏移是 SDK 自己的**，我们不抹：`updateDOM` 里写死
`projectToContainer(position) - 20`，而 `-20` 是给 **40px 气泡**（`Gd`）留的半宽；
单点的盒子只有 32 → 水滴整体偏上左 4px。抹掉它只能写魔数 `translate(4px, 4px)`，
那会跟着 SDK 的常量一起坏。实测数据留在 `_tmp/cdp_align.mjs`，判据留在 Z⑦。

★★ 这一条属于**"我们的全局 CSS 重置会静默改写第三方注入的 DOM"**：
类型干净、控制台干净、**气泡还正常** —— 只有单点不见。所以静态判据只能守
"那条恢复规则还在不在"，"真的画出来了"只能运行时量 rect。

### 10.2 点名字没反应 —— 名字层是画布层，默认不接受点击

`MultiLabel` 不接受任何点击，于是"屏幕上有名字却点不动"。
本轮补上 `onLabelClick`（`poiLayer.ts`）：推 300ms 抑制窗 + `opts.onSelect(id)`，
`destroy()` 里 `labels?.off('click', …)`。

★ 两层的 click 载荷**正好相反**（写反都是静默失效）：

| 层 | 源码 | 载荷 |
|---|---|---|
| `MarkerCluster` | `_constructOverlay`: `t.geometries ? e.cluster = t : e.geometry = t`（每个簇都带 `geometries`） | **只有 `evt.cluster`** |
| `MultiMarker` / `MultiLabel` | `MultiOverlay._emitGeoEvent(t, geometry, extra)` | **只有 `evt.geometry`** |

所以 Z 项**分头守**：③ 聚合层禁 `geometry` · ⑥ 名字层要求 `geometry`。
合成一条"两个文件都不许有"会把名字层判成错。

### 10.3 验收

* `check_app.py` **A–Z ALL_CLEAN**（含真 `tsc`）；`_tmp/_falsify_z.py` **20 条反证全过**（新增 5 条）。
* `_tmp/cdp_fix_verify.mjs` **ALL_PASS（6 项）**，其中两条是**能切开路径**的实验：
  * A4 反证：只抬 `max-width` → `32×47`（证明 `height` 那行不是多余的）；
  * B：**先把聚合层的 DOM 覆盖物 `display:none`**（此后点击**不可能**命中圆点），
    再在名字位置派发真实鼠标事件 → 预览卡打开 ⇒ 只可能是名字层接的；
    随后点空白仍能收卡 ⇒ 抑制窗没有把空白点击一起吞掉。
* `pnpm build` ✓（423 页）；产物 CSS 里确认带上那条规则（压缩后仍完整）。

---

## 十一、第二轮修正（2026-09-23 下午，用户报的两条）

用户原话：「点景点的标签和图标，不应该是打开景点详情吗，怎么缩放地图了，你他娘的，
不会都用的同一套逻辑吧……还有标签和图标重叠了，这个图标大了点，得缩小一点，
然后标签应该是展示在图标的上方，而不是和图标重叠在一起」

两句话各指出一个真问题。**第一句是我上一轮改错的**：把"点地图上的东西只放大"
（那一条本来是针对**徽标**的）错误地推广到了**景点**。

### 11.1 地图点击的三条分工（定稿）

| 点的是 | 做什么 | 为什么不是别的 |
|--------|--------|----------------|
| 省 / 市**徽标** | 放大到对应的取景（`shell.fit` + `districtFocus`） | 徽标表达的是"这一级有什么"，点它就该看得更清 |
| 景点**图标 / 名字** | **选中它** → 桌面浮出预览卡 + 地图高亮；移动端进详情页 | 点一枚景点是为了看它是什么，**镜头不该动** —— 否则用户想看的那一枚会被甩出屏幕 |
| 地图**空白** | 收起详情 | 没有出口的浮层 = 用户觉得"关不掉" |

三者都**不换路由**。改动：

| 文件 | 动作 |
|---|---|
| `desktop/ui/PoiCard.tsx` | **新增**：预览卡浮层（`Overlay` + `PoiPreviewCard`），三个页面共用一份 |
| `desktop/ui/{CityView,ProvinceView}.tsx` · `routes/home.tsx` | 都渲染 `PoiCard`（城市页原来内联的那段收进来） |
| `common/logic/{useHomeView,useProvinceView}.ts` | `onSelectPoi` 由 `shell.fit(...)` 改成"桌面 `setSelectedId` / 移动 `openPoi`"；新增 `onBlank`、把 `selectedId` 传给揭示钩子；点位数据从 `PoiPoint[]` 改成保留完整 `City[]`（卡片要封面/摘要，光有坐标画不出来） |
| `common/logic/useMapReveal.ts` | 新增 `onBlank` / `selectedId` 两个选项并透传给图层（原先只传 `names` / `onSelect`） |
| `common/map/tencent/poiCluster.ts` | 点击分派加**指针距离过滤**（见 11.3） |
| `common/map/tencent/poiStyles.ts` · `app.css` | 图标 32 → 24、标签移到图标上方（见 11.2） |
| `tools/check_app.py` | Y⑤ 拆成"徽标段 / 景点段"两条 · 新增 Y⑥ · Z⑦ 扩展 · 新增 Z⑧ |

### 11.2 图标缩小 + 标签移到图标上方

* **图标 32 → 24**（`.map-layer img[height]` 与 `poiStyles.POI_ICON_PX` 同一个数，Z⑦ 钉住一致性）。
* **标签移到图标上方**：`offset.y = -(POI_ICON_PX + LABEL_GAP_PX + LABEL_BOX_PX / 2)`。

★ 顺便把 SDK 的定位错位一起抵消了（`transform: translate(calc(-50% + 20px), 4px)`）：
现在水滴**水平居中在坐标上、针尖正好压在坐标上**（实测偏差恒为 `(0, -12)`，
即盒中心在点位上方 12px）。不抵消的话，图标一改尺寸就会换个方向偏 ——
而标签是按"图标高"算位置的，两者一起动才不会看起来错位。

★★ 但这里踩了一个**必须记住的坑**：我原以为可以改用
`verticalAlignment: 'bottom'`（让 offset 锚在标签底边，就不必知道标签自己多高）。
实测（`_tmp/cdp_label_hitbox.mjs`：在点位周围**逐格点**，看哪些位置能开出卡）：

| 锚点 | 画出来的框 | 能点中的范围 |
|---|---|---|
| `bottom` | dy `-48..-34` | dy `-36..-24` |
| `middle` | = 命中范围 | dy `-48..-36`（中心 = offset） |

⇒ `bottom` 时**画与命中差约 11px**，两者只在边角重叠 —— 表现是
**"看得见的名字点不动"**（用户报的第一句里就有这条）。所以锚点必须留在 `middle`，
代价是要自己写一个 `LABEL_BOX_PX = 22`（字号 + 内边距 + 边框算出来，实测命中区高 20–22）。
`middle` 时 offset 就是盒中心，画与命中重合，点名字/点图标都稳。

### 11.3 SDK 的一个点击载荷坑：一次点击会来**多条**

**症状**：点一枚单点图标 → 预览卡开了（对），但**镜头同时被推走**（错）。

**取证**（打点 `MarkerCluster.prototype.emit`，`_tmp/cdp_payload.mjs`）：

```
emit 到的 click 载荷:
  [{"n":1,"ids":["gangguanchang-xiaojungan"],"center":["104.09498","30.70501"]},
   {"n":2,"ids":["jianshelu-snack-street","mingting-restaurant"],"center":["104.09382","30.67450"]}]
```

第二条是一个中心在 **3.4km 之外**（屏幕坐标差约 95px）的 2 成员气泡。
而 `_tmp/cdp_dom_events.mjs` 证明 **DOM 事件只给了那枚单点的 `<img>`**
（mousedown / mouseup / click 三个事件的 `target` 全是它）。
⇒ SDK 的 finger 判定在这里不可信，「点的是哪一个」必须我们自己裁。

**解法**（`poiCluster.ts`，三条纪律）：
1. **按指针位置裁**：捕获阶段在容器上监听 `mousedown/pointerdown` 记下坐标，
   簇心离指针 > `CLUSTER_CLICK_SLOP_PX`（32px）的载荷一律丢弃。
   32 的来历：气泡盒 40×40（半对角 28.3）、单点盒 24×24（半对角 17），取 32 两者都容得下。
2. **一次按下只做一个动作**：两个覆盖物叠在一起时，不要"又选中又缩放"。
3. 拿不到指针/投影时**不裁**（退化成旧行为）—— 宁可偶尔多推一次镜头，也不要整个点不动。

★ 回归验证（`_tmp/cdp_bubble_click.mjs`）：点气泡仍然放大（z 12 → 14.74）、不会开卡。

### 11.4 验收

* `check_app.py` **A–Z ALL_CLEAN**（含真 `tsc`）；`_tmp/_falsify_z.py` **29 条反证全过**。
* `_tmp/cdp_poi_click.mjs`（首页）**ALL_PASS（11 项）**：
  点徽标 → 放大且 URL 不变 · 点图标/名字 → 卡片打开 + **zoom 不变 + URL 不变** ·
  点空白 → 收卡 · 再点同一个 → 收起 · 标记图全 24×24 · 偏差恒为 `(0, -12)`。
* `_tmp/cdp_fix_verify.mjs`（城市页）**ALL_PASS（6 项）**：点名字开卡（把聚合层 DOM 覆盖物
  `display:none` 后再点，所以只可能是名字层接的）。
* `_tmp/cdp_label_hitbox.mjs`：命中区与绘制区一致、中间那条 `dy=-30` 的空带正是 6px 间隙。
* `pnpm build` ✓（423 页）；产物 CSS 里确认带着 `map-layer img[height]{…height:24px…
  transform:translate(calc(20px - 50%),4px)}`（压缩后仍完整）。

### 11.5 遗留

* **气泡与单点重叠时**由谁接这一下，目前按"指针距离最近的先到先得"；
  更细的仲裁（比如按覆盖物 z 序）没做，因为还没遇到真实病例。

---

## 十二、第三轮：点景点**就地看完整详情**（2026-09-23 晚）

用户原话：「现在点景点，右侧是会显示一个景点的简要信息，这个不需要，点击直接看详情就行，
点那个看详情，会触发跳转，这个跳转不需要，url 不需要有任何变化，
点击地图没有任何标点的地方，关闭弹窗」

第三句是在**确认**已经做好的事（点空白收起），前两句是新要求：**把"简要信息 + 看详情跳转"
两段合并成一段 —— 点景点直接看完整详情，且 URL 一动不动。**

### 12.1 删掉的东西

| 文件 | 动作 |
|---|---|
| `desktop/ui/PoiPreviewCard.tsx` | **删除**（326px 简卡，用户明确说"这个不需要"） |
| `desktop/ui/PoiCard.tsx` | **删除**（它的浮层封装被 `PoiDetailOverlay` 取代） |

### 12.2 新增 / 改动

| 文件 | 动作 |
|---|---|
| `desktop/ui/PoiDetailOverlay.tsx` | **新增**：就地详情（620px 面板 + 300px 位置卡）。标题行放「加进行程」与 ✕（这一层用的是地图顶栏，动作收进面板自己） |
| `mobile/ui/PoiDetailSheet.tsx` | **新增**：移动端的同一件事（底部 Sheet，页脚 = 关闭 + 加进行程） |
| `common/logic/{useHomeView,useProvinceView}.ts` | `onSelectPoi` 两端统一成 `setSelectedId`（**删掉移动端那条 `openPoi` 跳转**）；`poiCity` → `poiMeta`（顺带带出城市名）；暴露 `selectedCityName` |
| `common/logic/useCityView.ts` | `openPoi` 由 `navigate(...)` 改成 `setSelectedId(id)` —— 清单里那个「详情」按钮也不再换 URL |
| `desktop/ui/{CityView,ProvinceView}.tsx` · `routes/home.tsx` | 渲染 `PoiDetailOverlay` |
| `mobile/ui/{CityView,ProvinceView}.tsx` | **选中时详情顶替列表**（一块抽屉放不下两块），关掉回到列表 |
| `tools/check_app.py` | Y⑤ 的景点段加"禁 `openPoi(`"；**新增 Y⑦**（城市页 `openPoi` 不许 `navigate(`） |

### 12.3 三条设计约定（写在代码里，别改回去）

1. **详情页只留给外链 / SEO / 分享** —— 任何"看某个景点"的**点击**都不再进入它。
2. **面板必须有关闭出口**：右上角 ✕ + 点地图空白（`onBlank`，判定在图层里）。
3. **换点位要复位** `gallery` 与"溯源展开"（否则"点 A 看了第 3 张图，点 B 还停在第 3 张"）。

★ 顺带量了一件事：620px 面板在**左**、位置卡在**右**，实测被点的那个景点
**不会被面板盖住**（`elementFromPoint` 返回的不是面板，`_tmp/cdp_poi_click.mjs`）。
⚠️ 但也正因为面板变大，**验收探针不能再"往左挪 220px"当作空白点** ——
那一块已经被面板吃掉，点下去命中的是面板、地图 `click` 根本不派发，
第一版探针就是这么误报"点空白没收起"的。现在改成扫描出一个
"不在任何 `data-overlay` 里、且离每张标记图 ≥60px"的点。

### 12.4 验收

* `check_app.py` **A–Z ALL_CLEAN**；`_tmp/_falsify_z.py` **31 条反证全过**。
* `_tmp/cdp_poi_click.mjs`（首页）**ALL_PASS（14 项）**：点图标 / 名字 → **620px 详情面板**
  （内容含「实用信息 + 溯源」）· **没有「看详情」按钮** · zoom 不变 · **URL 不变** ·
  点空白收起 · 再点同一个收起。
* `_tmp/cdp_city_list_detail.mjs`（城市页清单）**ALL_PASS（5 项）**：
  点「详情」就地开 620px 面板且 **URL 仍是 `/city/chengdu`** · 点整行同样 · 点空白收起。
* `_tmp/cdp_fix_verify.mjs`（城市页地图）**ALL_PASS（6 项）**；`cdp_bubble_click.mjs`：气泡仍放大。
* `pnpm build` ✓。


---

## 十三、第四轮：一套形状 + 一块浮层（2026-09-23 深夜）

用户原话（连发两条）：
> 「点景点的标签和图标，不应该是打开景点详情吗，怎么缩放地图了……还有标签和图标重叠了」
> 「而且你这撒点逻辑，怎么整了两套，我点地图上的标签，显示变成了另外一套点位样式，位置也偏了」

定方向的一句话是**「全部用腾讯的，一套逻辑，别搞两套逻辑」**。三件事一起做：

### 13.1 单点形状：全世界只剩腾讯那张水滴

| | 之前 | 现在 |
|---|---|---|
| 未点中的单点 | SDK 内置的红水滴（DOM `<img>`） | 同左（**改不了，也不改了**） |
| 点中的那一枚 | 我们自绘的"白环 + 彩色圆心"（`dotSVG`/`dotActiveSVG`） | **同一张腾讯水滴** + 一圈白盘 |

★ **为什么要"抄"那张图**：`MarkerCluster` 既不给单点用自定义样式
（`_createLayer` 不接 `styles`），也不能用 `enableDefaultStyle: false` 绕开
（`_repaint` 里 `if(this.enableDefaultStyle&&this.layer.visible){…}` **没有 else**，
传 false 是整个不出点）。所以把 SDK 那张 PNG（webpack 模块 `30933`、68×100）
**原样内联**进 `common/map/tencent/poiPin.ts`，选中层用 `<image href={TENCENT_POI_PIN}>`
引用同一串 base64 —— 运行时探针验证过：**内联那份与 SDK 真正在用的逐字节相同**。

代价（要认）：**单点不再有细类配色**。细类色只在清单、气泡与详情里体现。

### 13.2 `anchor` 是像素不是比例 —— "位置也偏了"的真因

`iconAnchor: [t.anchor && t.anchor.x || 17, t.anchor && t.anchor.y || 50]`，
默认 17/50 是**像素**。我们一直写 `{ x: 0.5, y: 1 }`（比例）→ 锚点落到左上角 → 往右下挂 17px。
标定表与复核命令在 `TRAPS.md`（4 个纯色方块 × 4 个 anchor，逐个量质心）。

### 13.3 详情：只剩一块浮层

* `PoiLocation` **砌进 `PoiDetail` 正文末尾**（一处装配点），三处外壳都只渲染一块 620px 面板。
* 删掉右侧 300px 位置卡（`--panel-locate`）与 326px 简卡（`--panel-preview`）两个 token。
* 点景点 → 就地开详情；**URL 全程不动**（城市页清单的「详情」也一样）。

| 文件 | 动作 |
|---|---|
| `common/map/tencent/poiPin.ts` | **新增**：内联腾讯那张单点水滴（base64 分段写，附出处与复核命令） |
| `common/map/tencent/poiStyles.ts` | 删 `dotSVG`/`dotActiveSVG`/`DOT_*`/`ACTIVE_*`；新增 `activePinSVG()`（白盘 + `<image>` 同一张图）；三处 `anchor` 改像素 |
| `common/map/tencent/poiLayer.ts` | 选中层 `styleId` 改 `poiActive` |
| `common/ui/city/PoiDetail.tsx` | 正文末尾加「位置与交通」 |
| `desktop/ui/{PoiDetailOverlay,PoiView}.tsx` · `mobile/ui/{PoiDetailSheet,PoiView}.tsx` | 去掉各自那块位置卡 / 位置段 |
| `app.css` | 删两个死 token；补"这张图是谁的、**一套**是怎么回事" |
| `tools/check_app.py` | C2 改宽匹配 + 反向查死 token；Z⑦ 改判 `LABEL_LIFT_PX`、加"必须用腾讯那张图 / 禁自绘圆点 / anchor 像素"；**新增 Y⑧**；label 更新 |

### 13.4 验收

* `check_app.py` **A–Z ALL_CLEAN**（含真 tsc）；`_tmp/_falsify_z.py` **40 条反证全过**（新增 10 条）。
* `_tmp/cdp_unify_verify.mjs` **12/12**：
  620px 详情 + 正文含「位置与交通」+ 没有「看详情」+ zoom/URL 不变 ·
  **620px 浮层恰好 1 块、无 300/326 的旧卡** · 内联图与 SDK 那张**逐字节相同** ·
  选中后聚合层少一枚（改由我们画）· 点空白收起。
* `_tmp/calib_marker_anchor.mjs`：4 个 anchor 的偏移表（见 TRAPS）。
* `pnpm build` ✓。

---

## 十四、第五轮：点位按**细类**分色（2026-09-24 凌晨）

用户先说「我想改那个水滴，因为现在都是同一种样式，之前的设计是每一种类型的样式展示
都是不一样的」，又定下方向「**我还是想用腾讯的sdk的算法，这样我不需要重复造轮子**」。

### 14.1 先量清楚：SDK 到底吃不吃样式

`_tmp/cdp_cluster_style.mjs`（页面里挂三个 `MarkerCluster`，各 3 个点，逐像素数色）：

| 配置 | 屏幕上出现什么 |
|---|---|
| 默认渲染 + 传自定义样式表 | 3 枚红水滴，我们的颜色 **0 像素** |
| 关掉默认渲染 + 传样式表 | **0 枚** |
| 关掉默认渲染，不传样式表 | **0 枚** |

⇒ 它的样式表**永远不生效**，关掉默认渲染又**一枚都不画**。**"藏"是唯一的路。**

### 14.2 分工（算法归腾讯，画面归我们）

| 谁 | 负责 |
|---|---|
| `MarkerCluster`（腾讯） | **聚类计算** + **气泡渲染** + 气泡点击（`evt.cluster`） |
| `poiCluster.markSingles()` | 把 SDK 画的**独立点**藏掉（class + 样式表 + `MutationObserver`） |
| `poiLayer` 的 `dots` 层 | 独立点按 `sub-<subtype>` **细类色**重画 + 接点击（`evt.geometry`） |

★ 藏的三条纪律：**class 不是内联**（内联会被 `setVisible(true)` 清空）·
**每次重画后重标**（实测那些 `<img>` 是移除重建的）· **按位置配对、找不到就不藏**。
详见 `TRAPS.md`。

### 14.3 改动

| 文件 | 动作 |
|---|---|
| `common/map/tencent/poiStyles.ts` | 恢复 `dotSVG` / `dotActiveSVG`（12 细类 × 2 档）；`anchor` 全用像素，圆点取画布中心 |
| `common/map/tencent/poiCluster.ts` | 新增 `markSingles()` + `MutationObserver`；结算时先藏再通知 |
| `common/map/tencent/poiLayer.ts` | 新增单点层 `dots` + `repaintSingles()` + `onDotClick`；选中层改回 `sub-<subtype>_A` |
| `common/map/tencent/poiTypes.ts` | **新增**：`PoiPoint` / `toPoiPoints` / `PoiLayerStats`（poiLayer 曾涨到 452 行，超 G 项） |
| `common/map/tencent/poiPin.ts` | **删除**（不再需要内联腾讯那张 PNG） |
| `app.css` | `.map-layer img[height]` 改成**防御性**规则（正常看不见了）；新增 `.poi-single-hidden` |
| `tools/check_app.py` | Z⑨ 改判"按细类生成两档"；**新增 Z⑩**（藏干净 + 观察者 + 单点层自接点击）；Z⑦ 的 anchor 判据改成画布中心 |

### 14.4 验收

* `check_app.py` **A–Z ALL_CLEAN**（含真 tsc）；`_tmp/_falsify_z.py` **41 条反证全过**。
* `_tmp/cdp_subtype_verify.mjs` **9/9**：SDK 标记 10 枚全被藏（可见 0）· 屏幕上有细类色像素 ·
  点"成都博物馆"（最近邻 224px，必是独立点）→ 620px 详情打开、zoom/URL 不变 ·
  **缩放两次之后仍全部藏住** · 点空白收起。
* 截图 `_tmp/subtype_dot.png`（紫点 = museum）/ `subtype_selected.png`（白底座 + 紫圆心，位置不动）。
* `pnpm build` ✓。

### 14.5 落地后修的两处（同一天）

**① 缩放时偶现 SDK 的红水滴**（用户报的）。第一版的藏法是"SDK 建完元素 → 我们补一个
`.poi-single-hidden` class + `MutationObserver` 重标"，看起来能追平 —— **实际追不平**：
逐帧采样（`_tmp/cdp_leak_probe.mjs`，每帧数一次"可见的 SDK 标记图"）**484 帧里 17 帧
看得到红水滴、单帧最多 13 枚**（整批一起漏）。

改成**一条静态 CSS** 之后：**511 帧里 0 帧**。原理很直白 —— 元素一插入就命中规则，
不存在时间窗；而 `img[height]` 也精确命中独立点（气泡是 `<div>`，不受影响）。
⇒ `markSingles()` + `MutationObserver` + class 常量全删，`poiCluster.ts` 348 → **255 行**。

**② 点太小、选中与未选中差距太大**。`DOT_SIZE` **8 → 11**（8px 叠上白描边只剩 6px 左右，
在影像底图上发虚）；选中态的彩色圆心**改成与 `DOT_SIZE` 同一个常量** ——
选中只是垫一圈 **18px** 白底座，**点本身不放大**，视觉差只剩底座那一圈。

---

## 十五、第六轮：取消选中后**标签卡在选中态**（2026-09-24）

用户原话：「这个标签的颜色样式有问题，我正常点那个点，打开景点详情的时候，可以正常打开，
点样式也会变，标签的样式也会变，点其他地方，样式也都能恢复，**但是当我点开详情之后，
拖动地图，再点地图其他位置，那个点的标注会恢复，但是那个标签不会恢复**」。

★ 复现要点全在最后半句里：**"先拖一下地图"** 不是偶然的动作，它是唯一的触发条件。

### 15.1 根因：异步落地的重算拿着**过期**的 `selectedId`

`poiLayer` 里有一份"最近一次生效的参数" `lastOpts`，供两处**迟到**的重算复原上下文：
`refreshView()` 与聚合落地后的 `onSettled`。而它**只在 `update()` 里赋值**，
`refreshView()` 当时只做了 merge、没有落盘：

```ts
refreshView(env) { repaint({ ...lastOpts, ...env }) }   // ← lastOpts 没有跟着更新
```

于是这条链成立：

| # | 发生了什么 | 结果 |
|---|---|---|
| 1 | 点开一个景点 → 只走 `refreshView` | `lastOpts.selectedId` 仍是最初的 `null` |
| 2 | **拖动地图** → `d.pois` 按视野外扩 0.6 粗筛，点集签名一变 → `paint()` 走 `update(pois, {selectedId:'x'})` | **`'x'` 被固化进 `lastOpts`** |
| 3 | 点空白 → `setSelectedId(null)` → 只走 `refreshView` → 圆点层清空、标签算成 `poi` | 看起来对了 |
| 4 | 约 20~150ms 后聚合在 worker 里落地 → `onSettled` → `repaintLabels(lastOpts)` | **拿着第 2 步固化的 `'x'`，把名字又画回 `poiActive`** |

⇒ 用户看到的正是"圆点恢复了、标签不恢复"。而且它**不会自己恢复** ——
之后没人再调 `update()`，脏值一直赖着，直到下次视野变化真正改了点集。

**取证（不改一行应用代码）**：在页面里 monkey-patch `TMap.MultiLabel / MultiMarker /
MarkerCluster` 的 `setGeometries`，把"谁在什么时候要画什么"记下来
（`_tmp/cdp_label_stale.mjs`）。修复前的稳态日志：

```
聚合层: {"t":20123,"n":14,"has":true}                                   ← 取消选中已生效
标签层: {"t":20123,"n":0,"act":[]}, {"t":20143,"n":8,"act":["chengdu-museum"]}  ← 20ms 后又被画成选中态
单点层: {"t":20143,"n":7,"act":[]}                                      ← 圆点已恢复
```

**修法**（`poiLayer.refreshView`）：把合并结果**落盘**，再重画。

```ts
refreshView(env) {
  lastOpts = { ...lastOpts, ...env }
  repaint(lastOpts)
}
```

顺带修掉同一处的第二个隐患：`update()` 收到的只有 `{selectedId}`（没有容器/浮层），
所以落地那一刻的标注避让是按**一张缺失的浮层表**算的 —— 名字会落到面板底下。
落盘之后 `container` / `overlays` 也跟着是最新的。

### 15.2 同一根因族的第二个毛病：每次平移/缩放，点和名字**整批消失一拍**

`poiCluster.setDots()` → `MarkerCluster.setGeometries()` 会**同步清空** `getClusters()`
（`_resetViewport()`），而 `poiLayer.repaint()` 里紧跟其后的 `repaintSingles()` /
`repaintLabels()` 正是读它 —— 那一瞬间"独立点"集合是**空的**。
`poiLayer` 的注释写着"先用上一次落地的簇算一次，保住上一屏的点不闪"，
但按现在的实现拿不到上一次的答案，注释与代码不符。

实测空窗 **2ms ~ 146ms**（日志里 `n:0` 与随后 `n:N` 的间隔）。146ms 已经是一眼可见的闪白。

**修法**：`poiCluster` 记住**上一次落地**的独立点集合，只在"已清空且我们正等新答案"时顶上。

```ts
singleIds() {
  const list = cluster.getClusters()
  if (list.length === 0 && waiting) return lastSingles
  ...
  lastSingles = out
  return out
}
```

★ `waiting` 这个条件不能省：`sentCount === 0`（这一屏本来就不该有点）那一路会**立刻结算**，
那时必须交出**真空集**，否则上一屏的点会赖在屏幕上不走。

### 15.3 复现时踩的坑：**先证明触发条件真的发生了**

第一版探针跑**城市页**，日志里 `act` 一直是 `[]`，看起来"复现不出来"。真实原因是
成都 57 个点在 z16 时**全部落在**外扩框内 —— 拖着走点集签名也不变 ⇒ 第 2 步的 `update()`
根本没跑。换到**首页**（9 城 513 个点，视野一动必变）立刻复现。

⇒ 纪律：**时序类 bug 的复现，要先有一条"我确实触发了它"的读数**。
本次就是聚合层打点的 `n` 恒定在 56/57 —— 那是"`update()` 没跑"的直接证据，
比"看现象有没有出现"可靠得多。

### 15.4 改动

| 文件 | 动作 |
|---|---|
| `common/map/tencent/poiLayer.ts` | `refreshView()` 把合并结果落盘到 `lastOpts`（并同步更新注释：它现在的语义是"最近一次生效的参数"） |
| `common/map/tencent/poiCluster.ts` | 新增 `lastSingles`；`singleIds()` 在"等 worker 回话"期间顶上它 |
| `tools/check_app.py` | **新增 Z⑪**（`refreshView` 必须落盘 + 必须用落盘后的参数重画）· **新增 Z⑫**（等回话期间必须顶上上一次落地）· 顺带更正 ⑦ 段里两处过时描述（"救活那张图" / 锚点 `bottom`） |
| `_tmp/_falsify_z.py` | **+3 条反证**（共 42 条） |

### 15.5 验收

* `check_app.py` **A–Z ALL_CLEAN**（含真 `tsc`）；`_tmp/_falsify_z.py` **42 条反证全过**。
* `_tmp/cdp_label_stale.mjs home`（同一场景，前后对照）：

| | 拖地图之后的稳态 |
|---|---|
| 修复前 | 标签层最后一次调用 `act: ["chengdu-museum"]` ⇒ 卡在选中态（圆点已恢复） |
| 修复后 | 标签层最后一次调用 `act: []`；打点后 2.8s 内一直如此 |

* 像素级人眼判据（裁在靶子的**真实投影**位置，±)：点击前 `dark=30`（浅底）→ 点中
  `dark=3116`（深底）→ 点空白之后 **`dark=30` 并保持**。截图：
  `_tmp/label_before.png` / `label_active.png` / `label_after_2800.png`。
* 回归：`cdp_subtype_verify`（细类色 + 藏 SDK 点）· `cdp_poi_click`（点景点开详情）·
  `cdp_bubble_click`（气泡仍放大）· `cdp_leak_probe`（红水滴不闪）全绿。

---

## 十六、第七轮：间距 · "标签不显示" · 双击景点不放大（2026-09-24）

用户一次报了三件：

> 「标签和点之间的间距得缩小一点，现在偏大，还有有时候点那个点，展开详情，那个标签不会显示，
> 还有一个问题是正常双击地图不是会放大吗，现在双击点和标签，也会触发地图放大，
> 这两个能不能不放大地图，**景点，不包括区域和那个聚合点**」

### 16.1 间距 15px → 6px：让开距离一直按**画布半径**算

圆点的画布是 24px，但**看得见的圆点只有 11px**（`DOT_SIZE`）—— 画布多出来的部分只是**命中区**
（手机上要够 24px 才好点）。而 `LABEL_LIFT_PX` 原来是

```ts
-(POI_ICON_PX / 2 + LABEL_GAP_PX + LABEL_BOX_PX / 2)   // 12 + 6 + 11 = -29
```

`POI_ICON_PX / 2 = 12` 比真正的圆点半径（5.5）多出 **6.5px**，于是标签白白高了一截。
实测（`_tmp/cdp_gap_dblclick.mjs`：裁一条竖带、**逐行分类** —— 与"圆心像素颜色"匹配的行是圆点，
深色像素够多的行是标签）**间距 15px**。

改成按可见半径算 + 空隙 6 → 3：

```ts
const LABEL_LIFT_PX = -(Math.ceil(DOT_SIZE / 2) + LABEL_GAP_PX + LABEL_BOX_PX / 2)  // -(6+3+11) = -20
```

实测 **15px → 6px**。★ 取整是刻意的：`DOT_SIZE / 2 = 5.5`，带小数会让画布上的文字发虚。

### 16.2 「点开了标签却不显示」—— 与 §15 **同一个根因**

它不是新 bug：§15 里那个"落地重算拿过期 `selectedId`"有**两个相反的后果**，取决于脏值是哪一个：

| 脏值 | 现象 |
|---|---|
| 固化成了某个已选中的 id | 取消选中后标签**卡在选中态**（§15，用户上一轮报的） |
| 固化成了 `null`（初始值） | 点开详情后标签**根本不显示**（本轮用户报的） |

第二种的成因：`setDots(admitted, selectedId)` 会把**选中项从聚合里排除**，
于是 `singleIds()`（`getClusters()` 里"只有自己一个"的那些）**永远不含选中项** ——
`repaintLabels` 里那句 `|| c.id === selectedId` 是它唯一的保命符。
脏值是 `null` 时这句不成立 ⇒ 标签被从列表里丢掉。

**取证**（`_tmp/_revert_exp.py` 把修复临时改回旧写法，同一场景跑 `cdp_label_stale.mjs home`）：

| | 点中后**落地那一刻**的标签请求 | 像素（裁标签+圆点） |
|---|---|---|
| 旧写法 | `{"n":4,"act":[]}` —— 列表里**没有**那枚景点 | 深色 121（标签不在） |
| 修复后 | `{"n":4,"act":["chengdu-museum"]}` —— 在，且是选中态 | 深色 **3219** |

★★ 顺带解开一个一直没想通的事：**为什么城市页怎么试都复现不出来**。
两个页面驱动图层的方式**不同**：

| 页面 | 谁驱动 | `update(pois, {selectedId})` 的时机 |
|---|---|---|
| 城市页 | `useCityView` | **选中变化就会调**（`useEffect` 依赖里有 `selectedId`）→ `lastOpts` 永远新鲜 |
| 首页 / 省级页 | `useMapReveal` | 只在**点集签名**变化时调 → 旧写法下会停在最初那一刻 |

⇒ 同一个图层、两套驱动方式，bug 只在其中一套上出现。§15 的修复（`refreshView` 落盘）
让图层**对两种驱动都成立** —— 这也是它该待在图层里的理由，而不是去改某一个页面。

### 16.3 双击景点不放大（空白 / 徽标 / 气泡照旧）

地图的双击放大是 SDK 内部挂在 `dblclick` 上的一个 handler（Leaflet 那一套），
所以只有两种关法：建图时关掉整张图，或者**临时卸掉**（`map.setDoubleClickZoom(false)`）。
用户要的是后者（原话：「景点，不包括区域和那个聚合点」）。

**时序刚好够用**：一次双击 = 按下/抬起/click ×2，最后才 `dblclick` ——
在**第一下 click**（图层派发的）里卸掉，`dblclick` 到时已经不在了。
装回的时机是"下一次**没点到景点**的地图 click"（空白 / 徽标 / 气泡都走这条路），
另外 `destroy()` 也必须装回（地图实例**跨页面复用**）。

★ 还有一个必须一起处理的：**双击的两次 click 会到两次**，第一下选中、第二下又切掉 ——
用户看到的是"双击之后详情自己关了"。所以双击窗口（400ms）内**同一个 id 只当一个动作**。
（实测：只卸放大不改这个，双击景点会先开卡再关掉。）

### 16.4 拆文件：`poiLayer` 416 → 400 行

新逻辑放不下（G 项上限 420），于是把**点击的时序语义**拆成 `common/map/tencent/poiClicks.ts`：
抑制窗 · 双击窗口 · 双击放大的装卸 · 点空白回调。它们与 `poiLayer` 的耦合只有两个回调，
而"时序"与"这一屏画什么"本来就是两种知识。

| 文件 | 动作 |
|---|---|
| `common/map/tencent/poiClicks.ts` | **新增**（134 行）：`createPoiClicks({map, onSelect, onBlank})` → `poi(id)` / `overlay()` / `destroy()` |
| `common/map/tencent/poiLayer.ts` | 点击处理改为 `clicks.poi(id)`；`onOverlayClick` → `clicks.overlay()`；`destroy()` → `clicks.destroy()` |
| `common/map/tencent/poiStyles.ts` | `LABEL_GAP_PX` 6 → 3；`LABEL_LIFT_PX` 改按 `DOT_SIZE` 算 |
| `common/map/tencent/tmap.d.ts` | 补 `setDoubleClickZoom?` / `getDoubleClickZoom?`（实测存在） |
| `tools/check_app.py` | 新增 **Y⑨**；Y①②（地图 click 的注册/注销、抑制窗）改指向 `poiClicks`；Z⑦ 的算式判据改成 `DOT_SIZE` |

### 16.5 护栏与反证

* **Y⑨**：双击放大的"卸 / 装回 / 销毁时装回 / 建图时不许整个关掉"四条，都落在**真的调 SDK** 上
  （只写个状态位不算数）。
* Y② 那条反证第一版**没抓住**：我改的是常量名，而**使用处**还留着那个字符串 ——
  判据要是只查名字就永远放行。改成查**执行**（`if (now < suppressUntil) return`）之后抓住了。
  那条只改名字的用例撤掉了（它只能被 `tsc` 抓到，交给 L 项）。
* `check_app.py` **A–Z ALL_CLEAN**；`_tmp/_falsify_z.py` **全过**（新增 Y⑨ 五条 + 搬迁三条 + Z⑦ 一条）。

### 16.6 验收

* `_tmp/cdp_gap_dblclick.mjs` **10/10**：间距 6px · 点一次开详情 · 1.6s 内标签一直在 ·
  双击景点**不放大**且详情仍开着 · 双击标签**不放大** · 双击空白**仍放大** ·
  双击气泡**仍放大**且 `dblZoom` 已装回 · 单击两次（间隔 800ms）仍"选中 ⇄ 取消"。
* `_tmp/cdp_label_stale.mjs home`：落地那次请求 `act:["chengdu-museum"]`（修复前是 `act:[]`）。
* 回归：`cdp_subtype_verify` 9/9 · `cdp_poi_click` 13/13 · `cdp_bubble_click` ✓ ·
  `cdp_leak_probe` 0 漏帧 · `pnpm build` ✓。
