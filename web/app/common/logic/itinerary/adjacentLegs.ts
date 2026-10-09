/**
 * 相邻两个停靠点之间的段 —— **不经过住宿点**。
 *
 * ## 为什么需要它（踩过的坑）
 * `buildTimeline()` 产出的 `Timeline.legs` 天然带住宿点：
 * ```
 * stops = [ 住宿, POI₁, POI₂, …, 住宿 ]
 * legs[i] = "stops[i] → stops[i+1]"      // ⇒ legs[0] 是"住宿 → 首个 POI"
 * ```
 * 而它**要求首末都是住宿点**（`usePlanView` 里那句 `if (!day || !stay || !baseCtx)
 * return null` 就是判据）。住宿点的入口 2026-09-27 被去掉了（见 `PlanDetailView`
 * 文件头"去掉了两样东西"）⇒ **那一版 `timeline` 恒为 `null`**，`legs` 一辈子是空的。
 *
 * 于是"路线规划详情里点之间那一行出行方式"如果直接读 `timeline.legs`，
 * 就会**编译全过、类型全对、页面上却一行都不出来**（第一版正是如此）。
 *
 * ## 怎么做的
 * 相邻两点之间怎么走，**根本不需要住宿点参与** —— 它就是 `resolveLegSync` 一次调用
 * （只吃 `from` / `to` / `mode` / `ctx`）。所以这里直接遍历 `day.items` 的相邻对，
 * 与时间链**解耦**：时间链那边哪天把住宿点接回来，这边也不用改。
 *
 * ## 两条边界
 * - **末项不算**：列表里没有住宿行，"最后一点 → 住宿"指向一个用户看不见的地方
 *   没有意义。⇒ 只出 `items.length - 1` 段。由调用方（`StopTimeline` 的 `!last`）再兜一层。
 * - **出行方式取段起点**的 `modeToNext`，与 `buildTimeline` 的约定一致
 *   （那处 off-by-one 的说明在 `timeline.ts` 的 `buildTimeline` 注释里）。
 *
 * ## 为什么键是 `uid` 而不是下标
 * `placeOfItem()` 给不出坐标的点**不参与**（它画不出段）—— 若按下标对齐，
 * 从那个点开始就会**整体错位一格**，表现为"时长配错了点"，很难反查。键是 uid，
 * 缺哪一段就是缺哪一段，没有自由度。
 *
 * ## ★★ 为什么收 `placeOfItem` 而不是 `placesOf(poiId)`
 * 第一版收的是 `(poiId) => Place | null`，而**自由取点（地图取点）没有 `poiId`**
 * —— 它是空串（见 `DayItemSchema.poiId` 的注释），坐标只存在 item 自己身上
 * （`kind: 'point'` + `lng`/`lat`）。
 * ⇒ 那种点会被当成"取不到坐标"而跳过 ⇒ **"景点 ↔ 地图取点"之间永远没有段**
 *   （用户 2026-10-04 报的正是这个：「景点和地图取点之间没有任何显示」）。
 * 所以这里收的是"把 item 变成 Place"的能力，由调用方决定查库还是用自带坐标。
 */
import { resolveLegSync, type LegContext, type LegResult } from './resolveLeg'
import type { Place } from './resolveLeg'
import type { DayItem, ItineraryDay } from '~shared/schema'

export function buildAdjacentLegs(
  day: ItineraryDay,
  placeOfItem: (it: DayItem) => Place | null,
  ctx: LegContext,
): Map<string, LegResult> {
  const out = new Map<string, LegResult>()
  const items = day.items
  for (let i = 0; i + 1 < items.length; i++) {
    const cur = items[i]
    const next = items[i + 1]
    if (!cur || !next) continue
    /**
     * ★★ **没选出行方式就不产出段**（2026-10-04 用户：「出行方式默认是不显示任何
     *   出行方式的」）。
     *
     * 这里**刻意不回落到 `ctx.defaultMode`** —— 那条回落会让每一段一开就写着
     * 「驾车 12 分钟」，而用户根本没选过。他要的是"先空着，等我选"。
     * （"默认出行方式"要留成**设置项**，是后面的事；那之前不该有任何预设。）
     *
     * ⇒ 段行由 `StopTimeline` 渲染成「选择出行方式」的**空位**，
     *   点开选完才写入 `modeToNext`，这里随之产出真正的段。
     */
    const mode = cur.modeToNext
    if (!mode) continue
    const from = placeOfItem(cur)
    const to = placeOfItem(next)
    if (!from || !to) continue
    out.set(cur.uid, resolveLegSync(from, to, mode, ctx))
  }
  return out
}
