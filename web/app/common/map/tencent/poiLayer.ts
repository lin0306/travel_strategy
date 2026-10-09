/**
 * POI 点位图层 —— **聚合层 + 选中层 + 名字层**（2026-09-22 重写）。
 *
 * ## 三层各管什么
 * | 层 | 类 | 里面装什么 |
 * |----|----|-----------|
 * | 聚合层 | `MarkerCluster` | 准入的**全部**点位。密的合成数字气泡，孤立的原样显示 |
 * | 单点层 | `MultiMarker` | **独立点**（没被聚合的点）按**细类色**画 —— SDK 画的那一枚被 `poiCluster` 藏了 |
 * | 选中层 | `MultiMarker` | **只有当前选中项**（`sub-<subtype>_A` = 白底座 + 细类色圆心） |
 * | 名字层 | `MultiLabel` | **只给独立点**（没被聚合的点）+ 选中项挂名字 |
 *
 * 聚合层本身封装在 `poiCluster.ts` —— 那边写了三条来自 SDK 真源码的约束、以及
 * "聚类是异步的"这件事。**改聚合行为先读它。**
 *
 * ## 为什么改成聚合（用户的原始需求）
 * 「有些地方的景点很密集，一下全撒了就密密麻麻。有些密集的情况应该显示 x 个景点，
 *  点击后再放大地图；如果放大之后还是密，就还是显示 x 个，再点再放大。」
 *
 * 原来做的是**抽稀 + 像素去重**：密集处把多出来的点**扔掉**（成都 46 个候选最后上屏 20 枚）——
 * 那不是"保护可读性"，是**无声的信息丢失**（用户既不知道少显示了，也找不回来）。
 * 现在密集处出一个带**真实数字**的气泡，点它放大逐级展开。方案与实测见
 * `plans/12-poi-aggregation.md`。
 *
 * ## 两条不能丢的旧纪律
 * - **腾讯的 `on()` 返回实例、不是取消函数** → `destroy()` 里必须用同一个引用 `off()`。
 * - **点中覆盖物时地图自己的 `click` 照样派发** → 用抑制窗隔开，否则"点圆点"会被判成
 *   "点了空白"，刚打开的预览卡立刻被自己关掉（见 `MAP_CLICK_SUPPRESS_MS`）。
 */

import { paintPoiLabels } from './poiLabels'
import { Z_LAYER } from './zLayers'
import { createPoiClicks } from './poiClicks'
import { createPoiCluster, type PoiClusterHandle } from './poiCluster'
import { createTapGuard } from './tapGuard'
import { buildLabelStyles, buildMarkerStyles } from './poiStyles'
import {
  mergePoiEnv,
  type PoiLayerHandle,
  type PoiLayerOptions,
  type PoiPoint,
  type PoiUpdateOptions,
  type PoiViewEnv,
} from './poiTypes'
import { readViewport } from './viewport'
import { poiTierForZoom } from './zoomTiers'

/* ────────────────────────────────────────────────
 * 契约（选项 / 句柄）住在 `poiTypes.ts` —— 本文件只放"怎么画"
 * ────────────────────────────────────────────── */

export type {
  PoiLayerHandle,
  PoiLayerOptions,
  PoiUpdateOptions,
  PoiViewEnv,
} from './poiTypes'

export function createPoiLayer(map: TMap.Map, opts: PoiLayerOptions): PoiLayerHandle {
  const labelStyles = buildLabelStyles()
  const markerStyles = buildMarkerStyles()

  let cluster: PoiClusterHandle | null = null
  /** 独立点（细类色）—— SDK 自己画的那一枚由 `poiCluster` 藏掉了 */
  let dots: TMap.MultiMarker | null = null
  let labels: TMap.MultiLabel | null = null
  let selectedMarker: TMap.MultiMarker | null = null

  /** `update()` 进来的全部候选（**未过准入** —— 准入在 `repaint` 里做） */
  let points: PoiPoint[] = []
  let byId = new Map<string, PoiPoint>()
  /**
   * **最近一次生效的参数** —— `refreshView` / 聚合落地后的重算都从它复原上下文。
   *
   * ★★ 必须由 `refreshView()` **一起落盘**（2026-09-24 修）：只在 `update()` 里赋值
   *   的话，它会**停在"点下那个景点的那一刻"**，而聚合落地是**异步**的 ——
   *   `onSettled` 里那次重算会拿着旧 `selectedId` 把名字**又画回选中态**，
   *   用户看到「圆点恢复了、标签不恢复」。触发条件就是"**先拖一下地图**"：
   *   `d.pois` 按视野粗筛，视野一动点集签名就变 → `update()` 跑一次 → 旧值被固化。
   *   同理 `container` / `overlays` 也要更新，否则落地那一刻的避让按过期浮层表算。
   *   复现与取证：`_tmp/cdp_label_stale.mjs`；来龙去脉：`plans/12` §15。
   */
  let lastOpts: PoiUpdateOptions = {}
  /** 最近一次重刷的读数（给 `stats()`） */
  let lastZoom = 0
  let lastAdmitted = 0
  let lastShown: string[] = []

  /**
   * 选中项要画的那一枚 —— **先在候选里找，找不到就看 `picked`**。
   *
   * ★ 这一句就是"搜到别的城的景点时地图上不画点"的修复点（2026-09-24，用户报的）：
   *   `byId` 只由**本页候选集**构成（城市页 = 本城、省级页 = 本省已收录城市），
   *   而搜索能在任意一级命中任何一座城的景点。少了这个兜底，
   *   选中层与名字层都解析不出坐标 ⇒ 镜头飞到了、详情开了，**图上却是空的**。
   */
  function selectedPoint(o: PoiUpdateOptions): PoiPoint | null {
    const id = o.selectedId ?? null
    if (!id) return null
    const inPage = byId.get(id)
    if (inPage) return inPage
    return o.picked && o.picked.id === id ? o.picked : null
  }

  /**
   * 点到景点的**动作语义**（选中 · 双击不放大 · 点空白收起）全在这里，
   * 本文件只负责"告诉它点到了哪一枚" —— 理由与时序细节见 `poiClicks.ts` 文件头。
   */
  const clicks = createPoiClicks({
    map,
    onSelect: (id) => opts.onSelect?.(id),
    onBlank: () => opts.onBlank?.(),
  })

  /**
   * 点到**名字** → 与点到那个点位同义。
   *
   * ## 为什么必须有
   * 名字层是 `MultiLabel`（画布），**默认不接受任何点击**。屏幕上摆着一个名字
   * 却点不动，用户只会当成"这个站坏了" —— 用户原话：「点标签也不显示景点信息」。
   *
   * ## 载荷与聚合层**正好相反**（别照抄那边的写法）
   * `MultiOverlay._emitGeoEvent(t, geometry, extra)` → 这里读 `evt.geometry`；
   * 而聚合层 `_constructOverlay` 里 `t.geometries ? e.cluster = t : e.geometry = t`
   * 永远走前一支 → 那边只有 `evt.cluster`（见 `poiCluster.ts` 文件头第 2 条）。
   * 两边的判据也分开：聚合层禁 `geometry`（Z③），本文件要求 `geometry`（Z⑥）。
   */
/**
 * ★★ **拖地图不算点击** —— 判据与聚合层同源（`createTapGuard`）。
 * 拖动是"按在某个东西上开始"的：起点压在景点/徽标上时，SDK 照样把这一下
 * 当成"点中了它"。用户 2026-07-05 报的就是这个（拖一下地图，被选中的东西冒出来）。
 * ⚠️ 每个图层各持一个实例，但它们读的是**同一个判据**（阈值只在 tapGuard 里定义）——
 *   各写一份阈值必然会漂移，而这种错不报错，只表现为"偶尔点不准"。
 */
  const tap = createTapGuard(map)

  const onLabelClick: TMap.EventHandler = (evt) => {
    if (!tap.isTap()) return
    const id = evt.geometry?.id
    if (typeof id !== 'string') return
    // 交给 `poiClicks`：推抑制窗 + 拦双击放大 + 挡掉双击的后半下（把这几件事收在一处）
    if (clicks.poi(id)) opts.onSelect?.(id)
  }

  /**
   * 点到**独立点** → 与点到它的名字同义。
   *
   * ★ 为什么这一下得由我们接：SDK 画的那枚独立点被藏了（`display:none` 的元素收不到
   *   pointer 事件），所以"点单点开详情"只能挂在我们自己的 `dots` 层上。
   *   **气泡不在这里** —— 气泡仍是 SDK 画的，点击仍走 `poiCluster` 的 `evt.cluster` 分派。
   *   ⇒ 两边的载荷字段不同（那边只有 `cluster`、这边只有 `geometry`），别互相照抄。
   */
  const onDotClick: TMap.EventHandler = (evt) => {
    if (!tap.isTap()) return
    const id = evt.geometry?.id
    if (typeof id !== 'string') return
    if (clicks.poi(id)) opts.onSelect?.(id)
  }

  function ensureLayers() {
    if (cluster) return
    cluster = createPoiCluster(map, {
      // 单成员的簇（理论上轮不到 —— SDK 那枚已藏、独立点归我们的 `dots` 层）也当"点到景点"
      onSelectPoi: (id) => {
        if (clicks.poi(id)) opts.onSelect?.(id)
      },
      // 气泡被点到：推抑制窗要在动作**之前**（`onSelect` 里可能同步地碰地图状态），
      // 但**不卸双击放大** —— 用户明说"不包括那个聚合点"
      onOverlayClick: () => clicks.overlay(),
      // 聚合落地 → 重算独立点与名字，并让页面重记一条日志（此刻的读数才是真数）
      onSettled: () => {
        repaintSingles()
        lastShown = repaintLabels(lastOpts)
        opts.onSettled?.()
      },
    })
    // 单点层：独立点按**细类色**画 —— SDK 自己画的那一枚由 `poiCluster` 藏起来
    dots = new TMap.MultiMarker({
      map,
      styles: markerStyles,
      geometries: [],
      zIndex: Z_LAYER.poiDot,
    })
    // 独立点可点（SDK 那枚藏了，点击得由我们接）—— 见 `onDotClick`
    dots.on('click', onDotClick)
    labels = new TMap.MultiLabel({
      map,
      styles: labelStyles,
      geometries: [],
      zIndex: Z_LAYER.poiLabel,
    })
    // 名字可点（与点圆点同义）—— 见 `onLabelClick`
    labels.on('click', onLabelClick)
    // 选中层 zIndex 高于名字层：白底座不该被任何文字盖住
    selectedMarker = new TMap.MultiMarker({
      map,
      styles: markerStyles,
      geometries: [],
      zIndex: Z_LAYER.poiSelected,
    })
  }

  /**
   * 单点层：**独立点**按细类色画。
   *
   * ## 为什么这批点要我们自己画
   * `MarkerCluster` 只有一套渲染样式（内置红水滴），**分不了细类色** ——
   * 实测它既不吃自定义样式表，关掉默认渲染又整个不画（`_tmp/cdp_cluster_style.mjs`）。
   * 所以"聚类算它的、画面归我们"：SDK 画的那一枚由 `poiCluster.markSingles()` 藏掉，
   * 这里用同一批坐标按 `sub-<subtype>` 重画。
   *
   * ★ "谁是独立点"必须问聚合器（`cluster.singleIds()`）—— 那是它自己的结论；
   *   自己拿距离再算一遍必然与它分叉（它按屏幕像素、按簇心距离、还在 worker 里算）。
   * ★ 与名字层共用同一个候选集：名字只给独立点，点也只画独立点。
   */
  function repaintSingles(): string[] {
    if (!dots) return []
    const ids = [...(cluster?.singleIds() ?? [])]
    const geoms = ids
      .map((id) => byId.get(id))
      .filter((p): p is PoiPoint => p !== undefined)
      .map((p) => ({
        id: p.id,
        styleId: `sub-${p.subtype}`,
        position: new TMap.LatLng(p.lat, p.lng),
      }))
    dots.setGeometries(geoms)
    return ids
  }

  /**
   * 名字层：只给**独立点** + **被规划认领的点** + **选中项**挂名字。
   * ★ 判据（候选怎么来、怎么避让、裁到几个）全在 `poiLabels.paintPoiLabels` ——
   *   2026-10-05 从本文件拆出去（这里已顶到 420 行上限，理由见那个文件头）。
   */
  function repaintLabels(o: PoiUpdateOptions): string[] {
    if (!labels) return []
    return paintPoiLabels({
      map,
      labels,
      byId,
      names: opts.names,
      // ★「谁是独立点」问聚合器 —— 唯一出处，别在这里另算一遍
      singleIds: cluster?.singleIds() ?? [],
      selected: selectedPoint(o),
      env: o,
    })
  }

  /**
   * 一次重刷：**定准入 → 交给聚合 → 补选中层 → 挂名字**。
   * 缩放 / 拖动结束后由外壳触发，**不要每帧调**。
   */
  function repaint(o: PoiUpdateOptions = {}) {
    const view = readViewport(map, o.container)
    // ① 准入：这一档到底铺不铺。**没有数量上限** —— 给多少由聚合决定，
    //    气泡上的数字就是真实点数（见 plans/12 §3.1）
    //    ★ 还要扣掉**被别的图层认领的**（规划详情态下的停靠点，见 `PoiUpdateOptions.claimed`）：
    //      那里改由规划那枚序号圆点代表，本层既不该画点、也不该把它们交给聚合 ——
    //      否则气泡的数字会把它们算进去，展开之后又是一枚重复的点
    const claimed = o.claimed
    /**
     * ★★ **规划详情态：一个圆点都不铺**（用户 2026-10-05，见 `PoiUpdateOptions.planFocus`）。
     *
     * 两个方向合起来才是"只留这条行程"：
     * · 行程里的停靠点 —— 本来就由序号圆点代表（`claimed` 那条分支），本层不该再画；
     * · **行程之外**的景点 —— 收起来，它们会被误读成"我要去的地方"。
     *
     * ⚠️ 走空数组而不是"只留 `claimed`"：`claimed` 的点**也必须**让位，
     *   否则序号圆点和景点圆点会在同一坐标上叠两层（那正是 2026-09-28 报的 bug）。
     * ⚠️ 名字不受影响：`repaintLabels` 仍会把 `claimed` 的点补进候选。
     */
    const admitted = !poiTierForZoom(view.zoom).admitsPoints
      ? []
      : o.planFocus
        ? []
        : claimed && claimed.size > 0
          ? points.filter((p) => !claimed.has(p.id))
          : points
    const selectedId = o.selectedId ?? null
    // ★ 走 `selectedPoint`：搜索命中的那一枚可能**不在本页候选集**里（见 `PoiUpdateOptions.picked`）
    const selected = selectedPoint(o)

    ensureLayers()

    // ② 聚合层：全量交出去，**扣掉选中项** —— 它有自己的那一层，不能被气泡吞掉。
    //    视野不用自己筛：聚合器只算 `mapBounds` 内的点（实测"成员数 == 视野内点数"）
    cluster?.setDots(admitted, selectedId)

    // ③ 单点层：独立点按**细类色**画（SDK 画的那一枚已被 `poiCluster` 藏掉）。
    //    这里先用**上一次落地**的簇算一次，保住上一屏的点不闪；聚合落地后 `onSettled` 再算一次
    repaintSingles()

    // ④ 选中层：只有这一枚，用 `sub-<subtype>_A`（白底座 + 细类色圆心）——
    //    与未点中的那批**同一个形状、同一个锚点**（画布中心），所以点中前后不换样、不跳位
    selectedMarker?.setGeometries(
      selected
        ? [
            {
              id: selected.id,
              styleId: `sub-${selected.subtype}_A`,
              position: new TMap.LatLng(selected.lat, selected.lng),
            },
          ]
        : [],
    )

    // ⑤ 名字层：先用**当前已落地**的簇算一次（旧的也没关系，保住上一次的名字不闪），
    //    聚合落地后 `onSettled` 会用新簇再算一次
    lastShown = repaintLabels(o)

    lastZoom = view.zoom
    lastAdmitted = admitted.length
  }

  function update(next: PoiPoint[], o: PoiUpdateOptions = {}) {
    points = next
    // 供 repaintLabels 从 id 反查名字/热度 —— 必须在 repaint 之前建好
    byId = new Map(next.map((p) => [p.id, p]))
    // 供 refreshView / 聚合落地后复用；★ 环境字段"没给就沿用"（见 `poiTypes.mergePoiEnv`）
    lastOpts = mergePoiEnv(lastOpts, o)
    repaint(lastOpts)
  }

  return {
    update,
    refreshView(env) {
      // ★ 先**落盘**再重画（2026-09-24 修）：聚合落地后的 `onSettled` 是异步的，
      //   它靠 `lastOpts` 复原上下文 —— 不落盘就会拿"上一次 `update()` 那一刻"的
      //   `selectedId` 去重算，把已经取消选中的那个名字又画成选中态。
      //   合并顺序与 `repaint` 用的是同一份，不两处各算一遍。
      lastOpts = { ...lastOpts, ...env }
      repaint(lastOpts)
    },
    setNames(next) {
      if (opts.names === next) return
      opts.names = next
      // 只影响名字层 → 就地重算一次，不必等下一次视野广播
      lastShown = repaintLabels(lastOpts)
    },
    stats() {
      const { clusters, bubbles } = cluster?.counts() ?? { clusters: 0, bubbles: 0 }
      return {
        zoom: lastZoom,
        candidates: points.length,
        admitted: lastAdmitted,
        clusters,
        bubbles,
        labels: lastShown.length,
        labelNames: lastShown.slice(0, 12),
      }
    },
    destroy() {
      // ★ 首行注销点击链（含地图 click 与"装回双击放大"）—— 地图实例**跨页面复用**，
      //   漏了就是"新页面的空白点击被处理两次"或"双击再也放不大"，都不报错。
      clicks.destroy()
      cluster?.destroy()
      cluster = null
      // ★ 腾讯的 `on()` 不返回取消函数 → 这两处也必须用**同一个引用** `off()`
      labels?.off('click', onLabelClick)
      dots?.off('click', onDotClick)
      // ★ MultiOverlay 也有 destroy（实测存在）—— 必须调，否则每换一次页就往地图上
      //   多挂几个空图层（旧注释写的"用 setGeometries([]) 清空即可"是错的）
      labels?.destroy()
      labels = null
      dots?.destroy()
      dots = null
      selectedMarker?.destroy()
      selectedMarker = null
      // ★ 判据的监听也要解（捕获阶段的六个事件，见 `tapGuard`）
      tap.destroy()
    },
  }
}
