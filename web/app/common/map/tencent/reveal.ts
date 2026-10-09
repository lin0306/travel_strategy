/**
 * 揭示决策 —— 「这一屏到底铺哪一级」的**唯一**判据。
 *
 * ## 修复前的样子（2026-09-20 前）
 * 判据是一句 `deepestLevel(zoom, base)`：只看缩放，不看内容。于是有四个漏点：
 *
 * | 漏点 | 现象 |
 * |------|------|
 * | **判据与内容脱钩** | 视野落在"一个市都没有"的地方时，`next === 'city'` 这一格**没有任何判据**回答"视野里有没有市徽标"，于是铺了个空 —— 而它也不会退回省徽标。用户看到一张什么都没有的地图 |
 * | **回流只做了一半** | 只有 点位 → 市徽标 这一段有回流（`showPois`），市徽标 → 省徽标 没有 |
 * | **层级语义混淆** | 返回的是"判据说该到哪一级"，不是"屏幕上实际铺的是哪一级"。页面拿它做懒加载判断，于是**没铺出来的层级也在请求数据** |
 * | **数据未就绪 = 没有** | 点位还没加载时 `pois()` 返回空数组，与"这里确实没有点位"无法区分 |
 *
 * ## 现在的样子：一条**逐级下降 + 逐级回流**的判定
 * ```
 * 缩放 → deepestLevel → 从最深的候选级往回走：
 *     这一级的候选在视野里够不够看？
 *       够   → 采用，停
 *       不够 → 退回上一级（记进 trace）
 *     直到 base 级（base 无条件采用 —— 那是这一页的立身之本）
 * ```
 *
 * 于是"铺哪一级"这件事**第一次由内容自己回答**：不是"缩放到 6.5 就该有市徽标"，
 * 而是"缩放到 6.5，且视野里**真的有**市徽标，才铺"。
 *
 * ## 两个视野的差异是刻意的（别统一）
 * | 用途 | pad | 为什么 |
 * |------|-----|--------|
 * | **判据**（够不够看） | 点位级用 `0`（严格） | 外扩集合里可能有贴着屏幕外沿的点，它们会被标注避让裁掉 —— 判据说"有"，用户看到的却是空的 |
 * | **上屏集合** | 外扩（区划 1.0 / 点位 0.6） | 贴边的内容在平移时才不会忽现忽隐 |
 *
 * ★★ 这一条踩过一次大坑：判据曾是「**所属城市的中心点**在不在视野里」，
 *    而集合是「该城市的全部点位」。放大到都江堰（市域内、离市中心 50km）时
 *    市中心移出屏幕 → 判据判空 → 连点位带徽标一起消失。用户的原话是
 *    "放大到一定级别，连热门景点也不显示了"。修法就是现在这样：**判据看内容自己**。
 *
 * ## `pending` —— 「未就绪」不是「没有」
 * `pois(level)` 返回 `null` 表示数据还没加载，`[]` 表示确定没有。这两件事必须分开：
 *   · 前者要**乐观通过**（外层据 `revealed` 去读数据），但**不许 clear 现有图层**
 *     —— 用空数组铺一帧再铺回来，用户看到的是"放大时地图闪一下白"；
 *   · 后者要**退回上一级**。
 * 修复前两者都是 `[]`，于是懒加载与回流互相锁死（不铺就不加载、不加载就永远判空）。
 *
 * ## ★★ 面与徽标在**点位档分家**（2026-10-02）
 * 返回值里的 `districts`（徽标）与 `faces`（面）在这一档**不是同一个集合**：
 *
 * | 档 | `districts` | `faces` / `faceLevel` |
 * |----|-------------|----------------------|
 * | 省 / 市 / 区 | 该级节点 | 同一批（`faceLevel = level`） |
 * | **点位** | **空**（徽标必须退场） | **区级节点**（`faceLevel = 'district'`） |
 *
 * 用户原话：「区的轮廓，能不能一直都显示，现在区在放大到显示景点的时候就不会显示了，
 * **就不知道这个到底在哪个区**」。
 *
 * 为什么徽标必须退场、面却必须留下：
 *   · 徽标在点位档**挡景点名字**，而且这一档没有可点进去的下一级 ⇒ 它是纯干扰；
 *   · 面是"这一片属于哪个区"的**唯一视觉答案** ⇒ 它是上下文，不是干扰。
 * 两者的诉求在这一点上正好相反，所以不能用一个集合表达。
 *
 * ★ 面**不接事件**（`reference` 模式）：面是大块填充、几乎覆盖整屏，留着 `click`
 *   会让"点景点附近"命中面 ⇒ 镜头飞到区中心。见 `districtLayer.DistrictLayerMode`。
 * ★ 同一档的 `faces` 为空 ⇒ **保持上一屏的面不动**，别清屏（区数据可能还在路上）。
 *
 * ## trace 是给谁看的
 * 每一级的「视野内候选数 / 有没有被采用」都记在返回值的 `trace` 里。
 * 它只有一个消费者：**探针**。以前排查"为什么这一级没出来"要靠读代码推演，
 * 现在探针能把这条链直接打出来。
 */

import type { DistrictGeoNode } from './districtStyles'
import type { PoiPoint } from './poiTypes'
import { deepestLevel, LEVEL_ORDER, type MapLevel } from './zoomTiers'
import { containsPoint, type Viewport } from './viewport'

/**
 * 上屏集合的视野外扩比例（视野宽/高的倍数，四边各外扩这么多）。
 *
 * 为什么要外扩、又为什么两级不同：屏幕外的几何挂上去只有开销没有收益，
 * 但**必须外扩一圈**，否则贴边的内容在平移时会忽现忽隐。区划徽标外扩得多
 * （1.0）是因为它们稀疏且要跟面一起出现；点位外扩 0.6 意味着要平移两屏才会重算。
 */
export const DISTRICT_VIEW_PAD = 1
export const POI_VIEW_PAD = 0.6

/**
 * **「面」专用的外扩** —— 比 `DISTRICT_VIEW_PAD` 更宽。
 *
 * ★★ 两条理由（2026-10-02 · 用户：「拖拽到屏幕之外后再拖拽进来，会重新渲染，
 *   不过还得考虑一下离屏渲染的情况会不会有问题」）：
 *
 * 1. **"拖出去一点点"不该让面消失**。面回答的是"这一片属于哪个区"，它是**上下文** ——
 *    视野刚越过区界时整片区变空白，比"多画一圈"要糟得多。徽标相反（它要点、要读），
 *    少给几个反而清爽。
 * 2. **集合更稳定 ⇒ 更少的 `setNodes`**。`setNodes` 会重建全部几何（含解码），
 *    而它在"视野内节点集合变了"时才触发 —— 外扩越宽，平移时集合越不容易变。
 *
 * ★ 离屏的面**不会有渲染问题**：腾讯的几何走 GPU，视口外的部分不栅格化，
 *   成本只在"几何上传"（一次性，且已被 `decodeCache` 缓存）。真正要防的是
 *   **无界保留**（比如"把全国 2894 个区都挂在图层上"），所以这里只是**多留一圈**，
 *   不是"保留所有走过的"。
 */
export const FACE_VIEW_PAD = 2

/** 某一级的诊断行。**只给探针用**，不影响渲染 */
export interface RevealTraceRow {
  level: MapLevel
  /** 该级在视野内的候选数。`-1` = 数据未就绪，没判 */
  inView: number
  /** 是否采用了这一级 */
  taken: boolean
}

export interface RevealDecision {
  /** 屏幕上**实际**该铺哪一级。可能比 `revealed` 更浅（内容不够看而回流） */
  level: MapLevel
  /**
   * 缩放判据说**该到**哪一级（`≥ level`）。
   *
   * ★ 页面拿它触发**数据懒加载**，不要拿 `level`：数据没到齐时 `level` 会停在
   *   浅一级，用它判就等于"不铺就不加载、不加载就永远不铺"。
   */
  revealed: MapLevel
  /** 该级要铺的区划徽标（已按视野外扩粗筛）。非空 ⇔ 这一级是区划级 */
  districts: DistrictGeoNode[]
  /**
   * 这一屏要画的**面**用哪些节点，以及它们属于哪一级。
   *
   * ★★ 它与 `districts` **可以不同级** —— 这正是这一对字段存在的理由：
   *
   * | 档 | `districts`（徽标） | `faces`（面） |
   * |----|-------------------|--------------|
   * | 省 / 市 / 区 | 该级节点 | **同一批** |
   * | **点位** | **空**（徽标退场） | **区级节点**（面继续留着） |
   *
   * 用户原话（2026-10-02）：「区的轮廓，能不能一直都显示，现在区在放大到显示景点的时候
   * 就不会显示了，**就不知道这个到底在哪个区**」。
   *
   * ★ 徽标在点位档**必须**退场（它会挡住景点名字，而且这一档没有可点进去的下一级）；
   *   但面不能跟着走 —— 它是"这一片属于哪个区"的唯一视觉答案。所以两者在这一档分家。
   *
   * ★ 空数组 = **保持上一屏的面不动**（不是"清空"）—— 见 `useMapReveal` 里的消费方式：
   *   区数据还没到时 `faces` 为空，此时清屏会让轮廓闪一下白。
   */
  faces: DistrictGeoNode[]
  /** `faces` 属于哪一级 —— 决定 `loadBoundsForLevel` 传什么（点位档传 `'district'`） */
  faceLevel: MapLevel
  /** 该级要铺的点位候选（已按视野外扩粗筛）。**给多少由渲染层的聚合决定**，见 `poiLayer` */
  pois: PoiPoint[]
  /** 数据未就绪：保持屏幕上现有的内容，别用空数组去 clear（会闪一帧白图） */
  pending: boolean
  trace: RevealTraceRow[]
}

/**
 * 候选数据源。两个函数都必须是**纯查询**（返回该级的全部候选，不要自己按视野筛）
 * —— 视野筛选的 `pad` 必须与判据同源，两处各筛一次就会得到
 * "判据说有点、集合里没有"这种半空状态。
 */
export interface RevealSources {
  districts(level: MapLevel): DistrictGeoNode[] | null
  /** `null` = 数据尚未就绪；`[]` = 确定没有 */
  pois?(level: MapLevel): PoiPoint[] | null
}

/**
 * 判定这一屏铺哪一级。
 *
 * @param base 本页路由对应的基准层级：`/` → `province`、`/province/:adcode` → `city`。
 *             **无条件采用** —— 那是这一页的立身之本，哪怕视野里一个徽标都没有。
 */
export function decideReveal(base: MapLevel, view: Viewport, src: RevealSources): RevealDecision {
  const revealed = deepestLevel(view.zoom, base)

  const from = Math.max(0, LEVEL_ORDER.indexOf(base))
  const to = Math.max(from, LEVEL_ORDER.indexOf(revealed))

  const trace: RevealTraceRow[] = []

  // 从最深往回走：第一个"够看"的层级就是答案
  for (let i = to; i >= from; i--) {
    // `LEVEL_ORDER` 是 `readonly MapLevel[]`，开 `noUncheckedIndexedAccess` 后
    // 取值类型带 `undefined`。索引由 `from`/`to` 夹住，取不到就是表被改坏了 ——
    // 收口成 base 而不是静默继续。
    const level = LEVEL_ORDER[i] ?? base
    const atBase = i === from

    if (level === 'poi') {
      const all = src.pois?.(level)

      /**
       * ★★ 点位档的**面**继续用「区」这一级（2026-10-02 用户：「区的轮廓，能不能一直
       *   都显示，现在区在放大到显示景点的时候就不会显示了，就不知道这个到底在哪个区」）。
       *
       * `districts`（徽标）在这一档是空的 —— 徽标**必须**退场（它挡景点名字，而且这一档
       * 没有可点进去的下一级）。但**面**不一样：它是"这片属于哪个区"的唯一视觉答案。
       * 所以两个集合在这里**分家**：徽标空、面照旧。
       *
       * ★ 用字面量 `'district'` 而不是 `level`（= `'poi'`）去问数据源：
       *   区索引是全量的，任何缩放/视野下都拿得到；而 `loadBoundsForLevel` 对 `'poi'`
       *   直接返回 `null`（那一级没有"自身"的面）。两者必须一致，否则面取不回来。
       */
      const faceNodes = (src.districts('district') ?? []).filter((n) =>
        containsPoint(view, n, FACE_VIEW_PAD),
      )
      const faces = { faces: faceNodes, faceLevel: 'district' as MapLevel }

      if (all == null) {
        // 未就绪 ≠ 没有。乐观通过交给外层去读数据，但本轮**不动图层**（pending）
        trace.push({ level, inView: -1, taken: true })
        return { level, revealed, districts: [], pois: [], pending: true, ...faces, trace }
      }

      /**
       * ★★ **点位这一级不做回流**（2026-09-29 修，用户："我再怎么放大这个标签都不会消失"）。
       *
       * 原来的写法是"视野里一个点位都没有 ⇒ `continue`，退回上一级"，与徽标几级共用一条
       * 回流规则。对**徽标**（省 / 市 / 区）这条规则是对的：徽标稀疏，视野挪开就该换一级。
       * 但点位是**最细的一级，它没有退路** —— 退回去拿到的是**尺度完全不对的徽标**：
       * 实测 z=16（街道尺度）放大到都江堰某处，视野内没有点位 ⇒ 回流到市级 ⇒
       * 屏幕上冒出「成都 57」这个市徽标。它的位置钉在成都市中心，**离用户正在看的地方
       * 几十公里**，却一直挂在屏幕上不走。放大越深视野越窄、越容易没有点位，
       * 于是就"再怎么放大都不消失"。
       *
       * 代价还是双份的：回流会走 `districtLayer.setNodes()` —— 重建多边形几何
       * （含边界解码）+ 重算徽标避让。放大过程中反复回流 = 反复重建，那正是
       * 同一轮用户报的"地图渲染变慢"。
       *
       * ⇒ 深处没有点位是**正常事实**（这一片就是没收录景点），如实铺空即可：
       *   `districts: []` 会顺手把上（几）级的徽标清干净。
       */
      const strict = all.filter((p) => containsPoint(view, p, 0))
      trace.push({ level, inView: strict.length, taken: true })
      return {
        level,
        revealed,
        districts: [],
        pois: all.filter((p) => containsPoint(view, p, POI_VIEW_PAD)),
        pending: false,
        ...faces,
        trace,
      }
    }

    const all = src.districts(level) ?? []
    const nodes = all.filter((n) => containsPoint(view, n, DISTRICT_VIEW_PAD))
    trace.push({ level, inView: nodes.length, taken: nodes.length > 0 || atBase })

    if (nodes.length > 0 || atBase) {
      /**
       * 区划级：徽标与面是**同一批节点**，但**外扩不同** ——
       * 面用 `FACE_VIEW_PAD`（更宽），理由见那个常量。`nodes` 为空（这一级真没内容）
       * 时面也空，别用宽外扩硬凑出一圈空面。
       */
      const faces = nodes.length === 0
        ? []
        : all.filter((n) => containsPoint(view, n, FACE_VIEW_PAD))
      return { level, revealed, districts: nodes, pois: [], pending: false, faces, faceLevel: level, trace }
    }
    // ← 回流：视野里一个市徽标都没有，退回省徽标，而不是摆一张空地图
  }

  // 走不到这里（`atBase` 那一轮一定 return）。留一个安全的收口，
  // 免得将来有人改 `LEVEL_ORDER` 时静默返回 undefined。
  return { level: base, revealed, districts: [], pois: [], pending: false, faces: [], faceLevel: base, trace }
}
