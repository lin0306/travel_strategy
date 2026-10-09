/**
 * 配额账本 —— 前端自带的一层消费上限。
 *
 * ## 为什么必须有
 * 运行时的地图 key 可能是**内置的受限 key**。任何一个循环 bug 或爬虫都能在几分钟内
 * 把日配额打满，而配额打满的表现是"地图整个不能用"，不是"慢一点"。
 *
 * ## 上限设得刻意低
 * 不是为了省，而是为了**防单点滥用**：一个用户正常一天最多排几十段，
 * 300 已是很宽松的余量。若某天突然接近 300，说明要么有 bug 在循环调用，要么有人在爬。
 *
 * ## 与腾讯配额模型的关系
 * 腾讯的日配额按接口独立（各 10,000/日、每日重置），所以"驾车用超了"不会影响"公交可用"——
 * 各方式的计数天然隔离，账本按方式分开记即可。
 */

import { TRAVEL_MODE_KEYS, type TravelMode } from '~shared/schema'

import { STORAGE_KEYS, readJson, writeJson } from '~/common/data/storage'

/** 单日上限（前端自设，远低于腾讯的 10,000/接口/日） */
export const DAILY_CAP: Record<TravelMode, number> = {
  driving: 300,
  taxi: 200,
  transit: 300,
  subway: 300,
  bicycling: 200,
  walking: 100,
}

/**
 * 多方案查询单独计数 —— 它比单段查询贵（一次拿 3 条方案 + 路况）。
 * 上限也更低。
 */
export const ROUTE_OPTIONS_CAP = 100

export interface QuotaLedger {
  /** `'2026-09-18'` —— 跨天自动归零 */
  date: string
  counts: Record<TravelMode, number>
  routeOptions: number
}

export interface QuotaDecision {
  allowed: boolean
  /** 拒绝原因，可直接进 toast 文案 */
  reason?: string
  used: number
  cap: number
}

function todayKey(now = new Date()): string {
  // 用本地日期而不是 UTC —— 用户的"今天"是他的时区
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function emptyLedger(date: string): QuotaLedger {
  const counts = {} as Record<TravelMode, number>
  for (const m of TRAVEL_MODE_KEYS) counts[m] = 0
  return { date, counts, routeOptions: 0 }
}

export function loadLedger(now = new Date()): QuotaLedger {
  const date = todayKey(now)
  const raw = readJson<Partial<QuotaLedger>>(STORAGE_KEYS.quota)

  // 跨天或读不出来 → 全新账本（腾讯配额每日重置，账本跟着重置才一致）
  if (!raw || raw.date !== date) return emptyLedger(date)

  const base = emptyLedger(date)
  for (const m of TRAVEL_MODE_KEYS) {
    const v = raw.counts?.[m]
    if (typeof v === 'number' && Number.isFinite(v)) base.counts[m] = v
  }
  base.routeOptions = typeof raw.routeOptions === 'number' ? raw.routeOptions : 0
  return base
}

export function saveLedger(ledger: QuotaLedger): void {
  writeJson(STORAGE_KEYS.quota, ledger)
}

/**
 * 能不能再调一次？
 *
 * @param usingOwnKey 使用者填了自己的 key → **不设上限**（配额是他自己的。
 *                    账本照常记录，让他能看到用量）
 */
export function canCall(mode: TravelMode, usingOwnKey: boolean, now = new Date()): QuotaDecision {
  const ledger = loadLedger(now)
  const used = ledger.counts[mode] ?? 0
  const cap = DAILY_CAP[mode]
  if (usingOwnKey) return { allowed: true, used, cap }
  if (used >= cap) {
    return {
      allowed: false,
      reason: `今日「${{ driving: '驾车', taxi: '打车', transit: '公交', subway: '地铁', bicycling: '骑行', walking: '步行' }[mode]}」实时查询额度已用完，本页时长改为估算值`,
      used,
      cap,
    }
  }
  return { allowed: true, used, cap }
}

export function canCallRouteOptions(usingOwnKey: boolean, now = new Date()): QuotaDecision {
  const ledger = loadLedger(now)
  if (usingOwnKey) return { allowed: true, used: ledger.routeOptions, cap: ROUTE_OPTIONS_CAP }
  if (ledger.routeOptions >= ROUTE_OPTIONS_CAP) {
    return {
      allowed: false,
      reason: '今日多方案查询额度已用完 · 仍可手动点开单段查看',
      used: ledger.routeOptions,
      cap: ROUTE_OPTIONS_CAP,
    }
  }
  return { allowed: true, used: ledger.routeOptions, cap: ROUTE_OPTIONS_CAP }
}

/** 记一次消费。返回更新后的账本 */
export function consume(mode: TravelMode, now = new Date()): QuotaLedger {
  const ledger = loadLedger(now)
  ledger.counts[mode] = (ledger.counts[mode] ?? 0) + 1
  saveLedger(ledger)
  return ledger
}

export function consumeRouteOptions(now = new Date()): QuotaLedger {
  const ledger = loadLedger(now)
  ledger.routeOptions += 1
  saveLedger(ledger)
  return ledger
}

/**
 * 配额用尽时的降级文案。**用灰色降级条而不是橙色过载提示** ——
 * 额度用尽是"系统状态"，排太满才是"行程质量问题"，混色会让人误判成系统坏了。
 */
export function quotaExhaustedBanner(ledger: QuotaLedger): string | null {
  const exhausted = TRAVEL_MODE_KEYS.filter((m) => (ledger.counts[m] ?? 0) >= DAILY_CAP[m])
  if (exhausted.length === 0) return null
  return '今日实时路况额度已用完，本页时长改为估算值 · 静态矩阵照常可用'
}

/** 给维护者看的用量快照（也便于开源使用者发现"谁把配额刷没了"） */
export function quotaSnapshot(now = new Date()): Array<{ mode: TravelMode; used: number; cap: number }> {
  const ledger = loadLedger(now)
  return TRAVEL_MODE_KEYS.map((mode) => ({ mode, used: ledger.counts[mode] ?? 0, cap: DAILY_CAP[mode] }))
}
