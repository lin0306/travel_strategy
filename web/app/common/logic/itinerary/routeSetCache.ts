/**
 * **多方案路线（含轨迹）的持久化缓存** —— 2026-10-19 用户定：
 * 「现在路线规划是实时的数据，能不能直接把这个数据存下来，这样就不用每次重新算了，
 *  存选好的轨迹数据」。
 *
 * ## 要解决的问题（两个，同一个根因）
 * 1. 每次打开段详情 / 刷新页面，方案卡是空的、地图上没有路线 —— 必须**手动再点一次**
 *    出行方式才会拉（用户 2026-10-19：「已经选中了其中一个了，再点开列表不会默认展示」）。
 * 2. 每次重新拉 = 重复消耗配额（`ROUTE_OPTIONS_CAP` 每日 100 次）—— 用户反复测试
 *    很容易打满，被拒的段在**海报里就变成了直线**（2026-10-18 那轮"断线"的根因之一）。
 *
 * ## 设计取舍（明确写出来，便于以后推翻）
 * - **存储**：localStorage。一条 driving 折线几百到上千点，5 段 × 3 方案约 100~300KB ——
 *   在 5MB 配额内；写入是低频动作（每次拉取一次），不值得为它上 IndexedDB。
 * - **TTL 24 小时**（逐条按 `RouteOptionSet.at` 判）：原始设计是"不落盘，因为含实时路况
 *   2 小时 TTL"。用户要求落盘复用，24 小时是"当天排行程不重复算"与"别把昨天的路况
 *   当今天"之间的折中 —— 过期即视为无缓存，再展开会重新拉。
 * - **LRU 40 条**：键是 `uid|mode|prefer`，一天十几段 × 几种方式就到 40 —— 超了按 `at`
 *   淘汰最旧，防止长期使用把 localStorage 撑满。
 * - **写失败静默降级**：配额满（QuotaExceeded）时只 console.warn，功能退回"仅内存缓存"
 *   —— 缓存是增强，不该因为它挂掉而让路线功能不可用。
 * - **不要在 SSR 里读**（`window` 不存在）：所有入口都判 `typeof window`。
 */

import { readJson, STORAGE_KEYS, writeJson } from '~/common/data/storage'

import type { RouteOptionSet } from './routeOptions'

/** 逐条有效期：24 小时（见文件头的取舍说明） */
export const ROUTE_SET_TTL_MS = 24 * 60 * 60 * 1000
/** 最多保留的条目数（按 `at` LRU） */
export const ROUTE_SET_MAX = 40

interface StoredRouteSets {
  v: 1
  sets: Record<string, RouteOptionSet>
}

/** 读缓存并**逐条按 TTL 过滤**。返回的一定是可直接展示的集合。 */
export function loadRouteSets(now = Date.now()): Record<string, RouteOptionSet> {
  if (typeof window === 'undefined') return {}
  const raw = readJson<StoredRouteSets>(STORAGE_KEYS.routeOptionSets)
  if (!raw || raw.v !== 1 || !raw.sets) return {}
  const out: Record<string, RouteOptionSet> = {}
  for (const [k, set] of Object.entries(raw.sets)) {
    if (!set || typeof set.at !== 'number') continue
    if (now - set.at > ROUTE_SET_TTL_MS) continue
    out[k] = set
  }
  return out
}

/**
 * 落盘（LRU 裁剪 + 失败降级）。
 * ★ 传空对象时**清键**（换城市 / 重置的路径会走到这里）。
 */
export function saveRouteSets(sets: Record<string, RouteOptionSet>): void {
  if (typeof window === 'undefined') return
  const entries = Object.entries(sets)
  if (entries.length === 0) {
    writeJson(STORAGE_KEYS.routeOptionSets, { v: 1, sets: {} } satisfies StoredRouteSets)
    return
  }
  // 按 at 倒序保留最新 ROUTE_SET_MAX 条
  entries.sort((a, b) => (b[1]?.at ?? 0) - (a[1]?.at ?? 0))
  const kept = Object.fromEntries(entries.slice(0, ROUTE_SET_MAX))
  // writeJson 内部已吞异常并返回 false（配额满等）—— 缓存是增强，降级为"仅内存"即可
  const ok = writeJson(STORAGE_KEYS.routeOptionSets, { v: 1, sets: kept } satisfies StoredRouteSets)
  if (!ok) console.warn('[routeSetCache] 写缓存失败，本次仅内存缓存（可能是 localStorage 已满）')
}
