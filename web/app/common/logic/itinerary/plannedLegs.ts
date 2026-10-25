/**
 * **已拉过的方案 → 段时长**：把 `routeSetCache` 里的真实路线喂给时间链。
 *
 * ## 为什么需要这一层（2026-10-25）
 * 删掉构建期矩阵之后，行程页的段时长只剩两个来源：`legCache`（住宿点相关 /
 * 公交地铁的即时补算）与直线估算 —— 而 `legCache` 只在"整条一次规划"里写，
 * 普通用户根本走不到。结果是**用户明明点开过某段、看过真实路线**，
 * 时间链上却还在用直线估算乘系数。
 *
 * 海报那边早就是对的：`poster/posterRoutes.ts` 直接读 `routeSetCache`
 * （24h TTL）取真实时长。这里把同一套口径搬给行程页 —— **两边同源**，
 * 海报不再比页面准。
 *
 * ## 与 `getOverride` 的分工（两个 Map，不是合并）
 * | Map | 含义 | 来源标记 |
 * |---|---|---|
 * | `picked` | 用户**手点**的那一条（`store.chosenOption`） | `live` |
 * | `planned` | 手点之外，方案集合里的第一条（接口按最优排序给的） | `planned` |
 * 两者都给真实时长；分开是为了让 UI 能区分"我选的"与"默认给的"。
 *
 * ## ★ 为什么不复用 `usePlanView` 原来那段 `overrides`
 * 原来那段依赖 `timelineBase`，而 `timelineBase` 要求**存在住宿点**
 * （`buildTimeline` 的入参之一）。不设住宿点 ⇒ `timelineBase` 为 null ⇒
 * **手选方案从未生效**。这里改成直接遍历 `day.items`，不依赖时间链，
 * 顺带把这个哑火修掉。
 */

import type { ItineraryDay, TravelMode } from '~shared/schema'

import { legKey, type LegOverride, type Place } from './resolveLeg'
import { routeOptionKey, type RouteOptionSet } from './routeOptions'

export interface PlannedLegs {
  /** 用户手选（`chosenOption`）→ `LegContext.getOverride` */
  picked: Map<string, LegOverride>
  /** 已拉过的方案里挑的那条 → `LegContext.getPlanned` */
  planned: Map<string, LegOverride>
}

/** 方案集合里的"那一条"：手选优先，否则接口给的第一条 */
function bestOf(set: RouteOptionSet | undefined, pickedKey: string | undefined) {
  if (!set || set.options.length === 0) return null
  if (pickedKey) {
    const hit = set.options.find((o) => o.key === pickedKey)
    if (hit) return hit
  }
  return set.options[0] ?? null
}

/**
 * @param placeOfItem `uid` 的那一站 → `Place`。`null` = 这一站没有坐标（跳过错位风险）
 * @param optionSets  `routeOptionKey(uid, mode, prefer)` → 方案集合（可能是降级集合，`options` 空）
 */
export function buildPlannedLegs(input: {
  day: ItineraryDay | null
  placeOfItem: (item: ItineraryDay['items'][number]) => Place | null
  optionSets: Record<string, RouteOptionSet>
  chosenOption: Record<string, string>
  defaultMode: TravelMode
}): PlannedLegs {
  const picked = new Map<string, LegOverride>()
  const planned = new Map<string, LegOverride>()
  const day = input.day
  if (!day) return { picked, planned }

  for (let i = 0; i + 1 < day.items.length; i++) {
    const cur = day.items[i]
    const next = day.items[i + 1]
    if (!cur || !next) continue
    const from = input.placeOfItem(cur)
    const to = input.placeOfItem(next)
    // ☆ 任一端没有坐标就跳过：这一段本来也不会出现在时间链上（`buildAdjacentLegs` 同口径）
    if (!from || !to) continue

    const mode = cur.modeToNext ?? input.defaultMode
    const set = input.optionSets[routeOptionKey(cur.uid, mode, cur.transitPrefer)]
    const pickedKey = input.chosenOption[cur.uid]
    const opt = bestOf(set, pickedKey)
    if (!opt) continue

    // ⚠️ 接口给的是**分钟**，时间链用**秒** —— 混了差 60 倍（海报那边同样的坑）
    const value: LegOverride = {
      duration: Math.round(opt.durationMinutes * 60),
      distance: opt.distance,
      ...(set?.taxiFare !== undefined ? { taxiFare: set.taxiFare } : {}),
    }
    const key = legKey(from, to, mode)
    // 手选那条同时进 `picked`（⓪ 级）—— 它比 `planned` 更能代表"我就要走这条"
    if (pickedKey && opt.key === pickedKey) picked.set(key, value)
    else planned.set(key, value)
  }

  return { picked, planned }
}
