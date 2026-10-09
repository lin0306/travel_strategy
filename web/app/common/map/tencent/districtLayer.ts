/**
 * 行政区划图层（三级下钻的地图侧）。
 *
 * ## 🚨 合规红线（本文件是它的落点）
 * 这里画的每一条边界**只能**来自腾讯 District 服务。**绝对禁止**任何第三方 GeoJSON、
 * 自制中国地图轮廓、或 Wikipedia / Natural Earth 之类的数据集。
 *
 * 原因：中国地图的行政区划边界涉及**国家版图完整性** ——
 * 台湾省、藏南地区、南海诸岛、阿克赛钦的表达。第三方数据常把台湾单独成"国家"、
 * 按错误实控线绘制藏南、或完全缺失南海诸岛。这类错误违反《地图管理条例》。
 *
 * 另外两条：
 * - **不得修改 API 返回的边界形状**（不简化到失真、不"修补"凹陷）
 * - 全国图必须覆盖 **34 个省级单位**（含港澳台）
 *
 * ## 空态是本章最重要的体验决策
 * | 档位 | POI 数 | 填充 | 描边 |
 * |------|-------|------|------|
 * | **待收录** | 0 / null | 极浅灰 | 灰**虚线** |
 * | 稀疏 | 1–20 | 浅蓝 | 蓝实线 |
 * | 中等 | 21–60 | 中蓝 | 蓝实线 |
 * | 密集 | 61+ | 较深蓝 | 深蓝实线 |
 *
 * 虚线是关键：它在中国地图语境里天然表达"未完成/规划中"，
 * 且**不破坏版图完整性** —— 边界依然清晰可见，只是用线型区分了状态。
 */

import type { DistrictBoundsFile } from '~/common/data/data'
import { Z_LAYER } from './zLayers'
import { createTapGuard } from './tapGuard'

import { visibleBadges } from './districtBadges'
import { createGeometryStore } from './districtGeometry'
import { readViewport } from './viewport'
import {
  badgeStyleIdOf,
  badgeText,
  buildBadgeStyles,
  buildDistrictStyles,
  type BadgeStyleId,
  type DistrictGeoNode,
} from './districtStyles'

/* 样式表与文案已拆到 `districtStyles.ts` —— 那里管"面与牌子长什么样"，本文件管"铺哪一级、几点可点" */

/* ────────────────────────────────────────────────
 * 图层句柄
 * ────────────────────────────────────────────── */

/**
 * 图层模式。
 *
 * | 模式 | 面 | 徽标 | 可点 / 可悬停 | 什么时候用 |
 * |------|----|------|--------------|-----------|
 * | `full` | ✓ | ✓ | ✓ | 省 / 市 / 区**徽标档** —— 徽标是这一档的主角（点它进去） |
 * | `reference` | ✓ | ✗ | ✗ | **点位档**（`zoom ≥ POI_REVEAL_ZOOM`）—— 面只作"我在哪个区"的参考底 |
 *
 * ★★ 为什么点位档要留面（2026-10-02 用户：「区的轮廓能不能一直都显示，现在区在放大到
 *   显示景点的时候就不会显示了，就不知道这个到底在哪个区」）：面消失之后，屏幕上只剩
 *   一堆圆点，**看不出这些景点属于哪个区** —— 而"这一片是什么区"正是选景点时的关键上下文。
 *
 * ★★ 为什么 `reference` 必须**同时**关掉徽标与点击（不能只关一半）：
 *   · 徽标：点位档的徽标会**挡住景点名字**，而且它没有可点进去的下一级；
 *   · 点击：面是**大块填充**，几乎覆盖整屏。留着 `click` ⇒ 用户点景点附近时命中面，
 *     触发"飞到该区" —— 他想点景点，镜头却飞走。这条是 `reference` 模式存在的**主要理由**。
 *   · 悬停：同理，划过一片就整块高亮，在点位档只是干扰。
 *
 *   ⚠️ 关掉面的事件**不影响**"点空白收起详情"：那个判定在点位层（`poiClicks`），
 *      它只看有没有命中点位 —— 见 `poiClicks.ts` 的抑制窗。
 */
export type DistrictLayerMode = 'full' | 'reference'

export interface DistrictLayerHandle {
  /**
   * 铺上某一级的区划：多边形 + 计数徽标。
   * `file` 缺席时**只撒徽标** —— 边界是可选增强，不是前置条件。
   * `mode` 默认 `'full'`（见 `DistrictLayerMode`）。
   */
  setNodes(nodes: DistrictGeoNode[], file?: DistrictBoundsFile, mode?: DistrictLayerMode): void
  /**
   * 缩放 / 平移结束后重算**徽标可见集合**。
   *
   * 徽标要不要显示取决于像素间距（见 `visibleBadges`），所以视野一变就得重算。
   * 外壳在缩放/平移结束后广播一次，页面转手调这里 —— 不接这条线的话，
   * 徽标只会按"数据到达那一刻"的视野算一次，之后永远不动。
   */
  refreshView(): void
  clear(): void
  setActive(adcode: string | null): void
  /**
   * 这一刻**实际**挂在地图上的东西 —— 不是"打算挂什么"。
   *
   * 供诊断日志（`lib/mapLog.ts`）。徽标上屏前要过**像素避让**
   * （见 `visibleBadges`），候选 165 个可能只留 40 个 —— 只记候选会得出
   * "明明铺了却看不到"的错觉，而那正是要排查的现象本身。
   */
  stats(): DistrictLayerStats
  destroy(): void
}

/** `stats()` 的返回值。全部是**读数**，不是意图 */
export interface DistrictLayerStats {
  /** 最近一次重刷时的缩放 */
  zoom: number
  /** 这一级一共挂在图层里的区划节点数（候选） */
  total: number
  /** 实际挂上地图的徽标数（过完避让与视口裁剪） */
  badges: number
  /** 实际挂上地图的徽标文字（最多 12 条） */
  badgeTexts: string[]
  /** 实际挂上地图的行政面数 */
  polygons: number
}

export interface DistrictLayerOptions {
  onSelect: (node: DistrictGeoNode) => void
  onHover?: (node: DistrictGeoNode | null) => void
}

/**
 * 建区划图层。
 *
 * ⚠️ 过渡动画的正确做法（10 文档 5.3）：**旧层保持可见，新层直接铺上，然后旧层淡出**。
 *    **不要**做"旧层淡出 + 新层淡入同时进行" —— 中间会有一段两层都半透明的混沌期，
 *    看起来像渲染错误。
 */
export function createDistrictLayer(map: TMap.Map, opts: DistrictLayerOptions): DistrictLayerHandle {
  const styles = buildDistrictStyles()
  const badgeStyles = buildBadgeStyles()

  const polygons = new TMap.MultiPolygon({
    map,
    styles,
    geometries: [],
    zIndex: Z_LAYER.districtFace,
  })
  const badges = new TMap.MultiLabel({
    map,
    styles: badgeStyles,
    geometries: [],
    zIndex: Z_LAYER.districtBadge,
  })

  let nodeByAdcode = new Map<string, DistrictGeoNode>()
  let hovered: string | null = null
  let active: string | null = null
  /** 当前模式（见 `DistrictLayerMode`）。`reference` = 只画参考面，不画徽标也不接事件 */
  let mode: DistrictLayerMode = 'full'
  /**
   * 上一次真正交给 `badges.setGeometries()` 的**内容签名**（adcode + 样式）。
   * 拖拽只改投影、不改地理坐标 ⇒ 内容不变时重设纯属白做（见 `repaintBadges`）。
   */
  let badgeSig = ''
  /** 最近一次的**实际**读数（供 `stats()`）。每次重绘覆盖，不累积 */
  let stats: DistrictLayerStats = {
    zoom: 0,
    total: 0,
    badges: 0,
    badgeTexts: [],
    polygons: 0,
  }

  /**
   * adcode → 已解码的环列表（每个环是一串 `TMap.LatLng`）。
   *
   * 这个形状**直接就是** `MultiPolygon` geometry 的 `paths`，不需要再加工。
   */
  const polygonPaths = new Map<string, TMap.LatLng[][]>()
  /** 解码 + 缓存（`districtGeometry.ts`）。拖出屏幕再拖回来时不重复解码 */
  const geo = createGeometryStore()

  /**
   * 面用的样式 id。
   *
   * 现在只会返回两个值（`face` / `reference`）—— 面的**颜色区分已经全部取消**：
   * 不按收录数量分档、不填充、不因悬浮/选中变色。
   * ★ **不许**拿它去设徽标 —— 见 `badgeStyleOf`。
   */
  function styleIdOf(node: DistrictGeoNode): string {
    // ★ 点位档的面与普通面唯一的分歧：**边框深一点**。
    //   那不是"颜色区分"，是底图不同 —— 点位档落在 z≥12 的街道底图上，
    //   0.65 的淡线会被浅色路网吃掉。见 `buildDistrictStyles.reference`。
    if (mode === 'reference') return 'reference'
    // ★★ 2026-10-03 用户：「这个轮廓的悬浮高亮去掉，会卡」。
    //   这里原来还有一条 `if (node.adcode === hovered) return 'hover'`。**问题不在这一行**，
    //   而在它背后的路径：`onHover` 每次变化都调 `repaint()`，而 `repaint()` 是
    //   **全量** `polygons.setGeometries(geo)`（面**没有**内容签名短路，只有徽标有，
    //   见 `repaint` 与 `repaintBadges` 的对比）。区这一级一屏几百个面、每个面几百到
    //   上千个顶点 ⇒ 鼠标每划过一条边界就重建整批多边形。这就是"卡"的来源。
    //
    //   ⚠️ **不要**想着"给面加个签名短路再把 hover 加回来"：面的签名要覆盖
    //      全部 adcode + 样式 + 几何，而 hover 恰好只改**其中一个** adcode 的样式 ——
    //      签名必然变化 ⇒ 还是全量重建。要真做就得按 id 做**增量**更新，SDK 没这 API。
    //   ⇒ 面的 hover 档就此取消。`hovered` 变量仍保留，它现在**只**服务徽标联动。
    //
    // ★★ 2026-10-03 另一条：**面不再按收录数量分档**（用户「轮廓的不同数量显示不同的
    //   颜色区分也去掉，标签已经有做区分了」）⇒ 普通面一律返回 `'face'`，
    //   详见 `buildDistrictStyles` 里 `face` 那段。
    //
    // ★★ 2026-10-03 第三条：**`active` 档也删了**（用户「所有颜色区分都去掉，
    //   背景色不需要，只需要边框」「不需要整个轮廓都高亮」）。
    //   "我选中了哪个区"由徽标（`badgeActive`）说明。连带好处：`setActive()` 不再
    //   需要全量 `repaint()` —— 见那边。
    return 'face'
  }

  /**
   * 徽标用的样式 id。★ 与 `styleIdOf` **必须分开** ——
   * 2026-10-02 用户报「标签的背景色没了」就是这两个混用造成的：
   * 面用的 `sparse/medium/…` 在徽标样式表里一个都没有，SDK 不报错，
   * 只让每个牌子退回默认样式（白底圆角全丢）。详见 `BadgeStyleId`。
   */
  function badgeStyleOf(node: DistrictGeoNode): BadgeStyleId {
    return badgeStyleIdOf(node, active, hovered)
  }

  function repaintBadges() {
    // ★ `reference`（点位档）：徽标不画 —— 它会挡住景点名字，而且这一档没有可点进去的
    //   下一级。**必须在这里早退而不是"生成但透明"**：透明几何依然可点（同下面那条注释）。
    if (mode === 'reference') {
      badges.setGeometries([])
      // ★ 签名跟着作废：几何已经清空，切回 `full` 时必须重设一次（否则徽标永远不回来）
      badgeSig = ''
      stats = { ...stats, zoom: readViewport(map).zoom, total: nodeByAdcode.size, badges: 0, badgeTexts: [] }
      return
    }

    const visible = visibleBadges([...nodeByAdcode.values()], readViewport(map))
    // ★ 被避让裁掉的徽标**不生成几何**，而不是"生成但设成透明" ——
    //   透明几何依然可点，会出现"点到看不见的东西"。
    //   这里先算出**实际要上屏的那一批**：`stats()` 要如实报它，而不是
    //   "这一级有几个节点" —— 避让 + 视口裁剪会削掉一大半（实测 165 → 40）
    const shown = [...nodeByAdcode.values()].filter((n) => visible.has(n.adcode))

    /**
     * ★★ **内容没变就不重设**（2026-10-02 · 用户：「拖拽时如果渲染过了就不需要再
     *   重复计算了吧」）。拖拽只改**投影**，不改地理坐标 —— 所以同一批 adcode + 同一批
     *   样式 ⇒ 交给 `setGeometries` 的内容**逐字节相同**，重设纯属白做
     *   （实测每轮拖拽会跑 4~5 次，每次 0.1~0.6ms，真正贵的是 SDK 内部的几何重建）。
     *
     * ⚠️ 位置（`LatLng`）不进签名是对的，但**必须**带上样式 id —— 激活 / 悬浮
     *   高亮是同一个 adcode 换了样式，漏了它 hover 就不再变色。
     */
    const contentSig = shown.map((n) => `${n.adcode}|${badgeStyleOf(n)}`).join(',')
    const didSet = contentSig !== badgeSig
    if (didSet) {
      badgeSig = contentSig
      badges.setGeometries(
        shown.map((n) => ({
          id: n.adcode,
          // ★ 激活与悬浮共用「高亮」语义（"当前关注的那个"），但样式 id 各有一枚
          //   —— 面的绿 / 徽标的绿同色系（见 `buildBadgeStyles`）
          styleId: badgeStyleOf(n),
          // ⚠️ 腾讯 LatLng 是（纬度, 经度）—— 与 GeoJSON 的 [lng, lat] 相反
          position: new TMap.LatLng(n.lat, n.lng),
          // 🚨 徽标文字必须放在 **`content`** —— 这是本文件踩过的最隐蔽的一个坑：
          //    写成 `style: { text: '北京 3' }` 不报任何错，几何也被正常收下，
          //    但 SDK 只读 `content`，于是 34 个省**一个徽标都渲染不出来**，
          //    表现成"地图上光秃秃的、好像标注功能没做"。
          //    判据（CDP 实测）：`getGeometries()[i].content` 会得到 '' 而不是文字。
          content: badgeText(n),
        })),
      )
    }
    // ★ 记**实际**读数。`refreshView()` 只刷徽标、不动面，所以面数用 `...stats` 带过来
    stats = {
      ...stats,
      zoom: readViewport(map).zoom,
      total: nodeByAdcode.size,
      badges: shown.length,
      badgeTexts: shown.map(badgeText).slice(0, 12),
    }
  }

  function repaint() {
    // ★ 没有边界几何的节点**不能**塞给 MultiPolygon —— 传 `paths: []` 时 SDK 会对
    //   每个节点刷一条「第 N 元素的 paths 属性无效」的 console.error（34 个省就是 34 条），
    //   把真正的错误淹没掉。边界是可选增强，缺席时只撒徽标即可。
    const geo = [...nodeByAdcode.values()]
      .map((n) => ({
        id: n.adcode,
        styleId: styleIdOf(n),
        // 环在 setNodes 时已解码好，这里靠 geometry id 复用；腾讯按 id 更新样式
        paths: polygonPaths.get(n.adcode) ?? [],
      }))
      .filter((g) => g.paths.length > 0)

    polygons.setGeometries(geo)
    // 面数与徽标分两步记：`repaintBadges` 里用 `...stats` 合并，不会把这里覆盖掉
    stats = { ...stats, polygons: geo.length }
    // ★ 徽标必须跟着一起重刷 —— 只刷多边形会出现「面高亮了、牌子还是灰的」
    repaintBadges()
  }

  // ★ 徽标与多边形**都要能点** —— 小省份（上海、澳门）的多边形命中率很低，
  //   徽标提供了一个"最小点击面积"的兜底
  //
  // ★★ 但 `reference`（点位档）下**面和徽标都不接事件**：面是大块填充、几乎覆盖整屏，
  //    留着 click 会让"点景点附近"命中面 ⇒ 触发飞到该区（用户想点景点，镜头却飞走）。
  //    关掉这里不影响"点空白收起详情" —— 那个判定在点位层（`poiClicks`）。
/**
 * ★★ **拖地图不算点击** —— 判据与聚合层同源（`createTapGuard`）。
 * 拖动是"按在某个东西上开始"的：起点压在景点/徽标上时，SDK 照样把这一下
 * 当成"点中了它"。用户 2026-07-05 报的就是这个（拖一下地图，被选中的东西冒出来）。
 * ⚠️ 每个图层各持一个实例，但它们读的是**同一个判据**（阈值只在 tapGuard 里定义）——
 *   各写一份阈值必然会漂移，而这种错不报错，只表现为"偶尔点不准"。
 */
  const tap = createTapGuard(map)

  polygons.on('click', (evt) => {
    if (mode === 'reference' || !tap.isTap()) return
    const adcode = evt.geometry?.id
    const node = adcode ? nodeByAdcode.get(adcode) : undefined
    if (node) opts.onSelect(node)
  })
  badges.on('click', (evt) => {
    if (mode === 'reference' || !tap.isTap()) return
    const adcode = evt.geometry?.id
    const node = adcode ? nodeByAdcode.get(adcode) : undefined
    if (node) opts.onSelect(node)
  })

  /**
   * ⚠️ GL 版的悬停事件名是 **`hover`**，**不是** `mouseover` / `mouseout`。
   *    写成后者不会报错，只是**永远不触发** —— 本项目已经因为同类原因踩过坑。
   *
   * 另一个特性：**移出图形时同一个事件也会触发，此时 `evt.geometry` 为 `null`**。
   * 所以离开态不需要单独监听，一个 handler 就够。
   */
  function onHover(evt: TMap.MapEvent) {
    // `reference` 下不接悬停：划过一大片就整块高亮，在点位档只是干扰
    if (mode === 'reference') return
    const adcode = evt.geometry?.id ?? null
    if (adcode === hovered) return
    hovered = adcode
    if (opts.onHover) opts.onHover(adcode ? (nodeByAdcode.get(adcode) ?? null) : null)
    // ★★ 2026-10-03：这里原来是 `repaint()` —— 一次 hover 变化就把**所有**面的几何
    //   重新交给 SDK（`polygons.setGeometries`，区级几百个多边形），
    //   用户的原话是「这个轮廓的悬浮高亮去掉，会卡」。
    //   面的 hover 档已经取消（见 `styleIdOf`），所以**面不需要重设**；
    //   只留徽标的联动 —— 徽标几何少（避让后几十个点）、且 `repaintBadges` 自带内容
    //   签名短路，重设很便宜。这两者的差价就是"卡"与"不卡"的区别。
    repaintBadges()
  }

  polygons.on('hover', onHover)
  badges.on('hover', onHover)

  return {
    setNodes(nodes, file, nextMode) {
      mode = nextMode ?? 'full'
      nodeByAdcode = new Map(nodes.map((n) => [n.adcode, n]))
      polygonPaths.clear()

      // ★ 按 **adcode 索引**取几何，不做"文件里的第 i 个多边形对应第 i 个节点"这种顺序约定 ——
      //   顺序耦合是隐患：构建脚本一改排序，34 个省的位置就会整体错位，而且**不会报错**。
      //   adcode 是稳定标识，用它能保证"面"永远落在自己的区划上。
      for (const [adcode, rings] of Object.entries(file?.polygons ?? {})) {
        // ★ 命中缓存直接复用（"拖出去再拖回来"走的就是这一支，零解码）——
        //   解码与缓存在 `districtGeometry.ts`，本文件不再自己 `new TMap.LatLng`
        const paths = geo.pathsOf(adcode, rings)
        if (paths) polygonPaths.set(adcode, paths)
      }

      // 换级时清掉悬浮态：上一级的 adcode 不会出现在新一级里，
      // 留着只会让 styleIdOf 白比较一次（无害但会让"悬浮中"的语义变脏）
      hovered = null
      repaint()
    },

    refreshView() {
      // 只重刷徽标：多边形与缩放无关（它按几何画，本来就会被地图自己缩放）
      repaintBadges()
    },

    clear() {
      polygons.setGeometries([])
      badges.setGeometries([])
      nodeByAdcode.clear()
      polygonPaths.clear()
      hovered = null
      active = null
      // zoom 保留 —— 地图还停在那个缩放上，清掉的只是内容
      stats = { ...stats, total: 0, badges: 0, badgeTexts: [], polygons: 0 }
    },

    setActive(adcode) {
      active = adcode
      // ★★ 2026-10-03：原来是 `repaint()`（**全量** `polygons.setGeometries()`）。
      //   面已经没有 `active` 档了（"选中"由徽标 `badgeActive` 表达）⇒ 面**不需要重设**，
      //   只重刷徽标。与 `onHover` 同一个道理，见那边。
      repaintBadges()
    },

    stats: () => stats,

    destroy() {
      // ★ 真的**摘掉**（不是 `setGeometries([])` 那种"清空"）—— 地图实例跨页复用，
      //   不摘就会每换一次页多挂两个空覆盖物。`destroy()` 在基类 `MultiOverlay` 上。
      polygons.destroy()
      badges.destroy()
      // ★ 判据的监听也要解（捕获阶段的六个事件，见 `tapGuard`）
      tap.destroy()
    },
  }
}
