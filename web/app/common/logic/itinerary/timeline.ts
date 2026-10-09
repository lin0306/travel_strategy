/**
 * 时间链推导 —— `buildTimeline` 是**纯函数**，不依赖地图实例、不发网络请求。
 *
 * 用户自己排顺序，所以推导逻辑是**一条直线**，没有任何搜索或优化：
 *
 * ```
 * 09:00  住宿点出发
 *          │ Leg 1：驾车 18 分钟 · 4.2 km
 * 09:18  到达 宽窄巷子   ← 停留 90 分钟
 * 10:48  离开 宽窄巷子
 *          │ Leg 2：步行 12 分钟 · 0.9 km
 * 11:00  到达 人民公园   ← 停留 60 分钟
 * ...
 * 17:21  回到住宿点
 * ```
 *
 * ★ 关键性质：矩阵命中路径是**同步纯函数**，所以拖拽排序时可以**每帧重算**，
 *   交互零延迟。需要实时数据的段先给估算值，异步结果回来后重算一次。
 *
 * ⚠️ 本文件同样不得 import 地图 SDK —— 见 resolveLeg.ts 顶部说明。
 */

import type { DayItem, ItineraryDay, Stay, TravelMode } from '~shared/schema'
import { MODE_META, TRAVEL_MODE_KEYS } from '~shared/schema'

import { fmtClock, fmtDistance, fmtDuration, fmtMinutes } from '~/common/data/format'

import { resolveLegSync, type LegContext, type LegResult, type Place } from './resolveLeg'

/* ────────────────────────────────────────────────
 * 类型
 * ────────────────────────────────────────────── */

export interface TimelineStop {
  kind: 'poi' | 'stay'
  place: Place
  /** 仅 POI 停靠点有 */
  item?: DayItem
  /** 到达时刻（从 0 点起的分钟数）。首项是"出发"、末项是"回到住宿" */
  atMin: number
  /** 离开时刻 */
  leaveMin: number
  /** 是否当天第一站 / 最后一站（首末都是住宿点） */
  isFirst: boolean
  isLast: boolean
}

export interface Timeline {
  stops: TimelineStop[]
  /** `legs[i]` 是 `stops[i] → stops[i+1]` 那一段 */
  legs: LegResult[]
  startMin: number
  endMin: number
  /** 在途总时长（秒） */
  transitSec: number
  /** 停留总时长（分钟） */
  dwellMin: number
  /** 是否含估算值（UI 要打「估算」标） */
  hasEstimate: boolean
  /** 是否有段「不适用」（UI 引导换方式） */
  hasNotApplicable: boolean
  /** 天气/时长数据是否完整 —— 供 DaySummary 决定要不要加"部分为估算"的注脚 */
  allFromMatrix: boolean
}

/** 把 POI 与住宿点统一成 Place —— 连线、时间链、估算都只有一套代码 */
export function poiPlace(poiId: string, name: string, lng: number, lat: number): Place {
  return { kind: 'poi', id: poiId, name, lng, lat }
}

export function stayPlace(stay: Stay): Place {
  return { kind: 'stay', id: stay.id, name: stay.name, lng: stay.lng, lat: stay.lat }
}

/* ────────────────────────────────────────────────
 * 时间链
 * ────────────────────────────────────────────── */

/**
 * 推导一天的完整时间链。
 *
 * @param day       当天的有序点位列表（数组下标即真实顺序）
 * @param stay      当天所属的住宿段 —— 起终点都是它
 * @param placesOf  把 poiId 解析成 Place 的函数（POI 表由调用方持有）
 * @param ctx       矩阵 + 缓存 + 默认方式
 *
 * ### ⚠️ 一处刻意偏离 09 文档的地方（文档伪代码有 off-by-one）
 * 文档 5.1 的伪代码写的是 `day.items[i]?.modeToNext`，即**按"段序号"取当前 item 的方式**。
 * 但 `DayItem.modeToNext` 的语义是「到**下一个**点的交通方式」——
 * 它属于**这一段出发的那个 stop**，不是"这一段到达的那个"。
 *
 * 于是正确的取法是「**看段起点**」：
 *   - 起点是 POI  → 用它自己的 `modeToNext`
 *   - 起点是住宿点（只可能是首段）→ 住宿点没有这个字段，用 `defaultMode`
 *   - 末段（回住宿点）→ 用最后一个 item 的 `modeToNext`；该字段在文档里标注"最后一项不需要"，
 *     缺省时同样落回 `defaultMode`
 *
 * 按文档写法会让每段的出行方式**整体错位一格**（用户选了"第 1 段步行"，结果步行出现在第 2 段），
 * 而且首段永远取到第二段的方式。所以这里按语义实现，并把差异记在案。
 */
export function buildTimeline(
  day: ItineraryDay,
  stay: Stay,
  placesOf: (poiId: string) => Place | null,
  ctx: LegContext,
): Timeline {
  const home = stayPlace(stay)

  // 停靠点序列 = 住宿点 → 各点位 → 住宿点（★ 末段回到住宿）
  const stops: TimelineStop[] = []
  const pois: Array<{ item: DayItem; place: Place }> = []
  for (const item of day.items) {
    const place = placesOf(item.poiId)
    if (place) pois.push({ item, place })
  }

  const startMin = 0 // 占位，下面统一用 startTime 平移
  void startMin

  let t = parseStart(day)
  const START = t

  // 首站：出发
  stops.push({
    kind: 'stay',
    place: home,
    atMin: t,
    leaveMin: t,
    isFirst: true,
    isLast: false,
  })

  const legs: LegResult[] = []
  let transitSec = 0
  let dwellMin = 0
  let hasEstimate = false
  let hasNotApplicable = false
  let allFromMatrix = true

  for (let k = 0; k < pois.length; k++) {
    const cur = pois[k]
    if (!cur) continue
    const prevPlace: Place = k === 0 ? home : (pois[k - 1]?.place ?? home)
    // ★ 出行方式属于**段起点**（见函数注释里那处 off-by-one 说明）
    const mode: TravelMode = k === 0 ? ctx.defaultMode : (pois[k - 1]?.item.modeToNext ?? ctx.defaultMode)

    const leg = resolveLegSync(prevPlace, cur.place, mode, ctx)
    legs.push(leg)
    transitSec += leg.duration
    if (leg.source === 'estimate') {
      hasEstimate = true
      allFromMatrix = false
    }
    if (leg.source === 'not-applicable') hasNotApplicable = true
    if (leg.source !== 'matrix') allFromMatrix = false

    t += leg.duration / 60 // leg.duration 是**秒**
    const arrive = t
    t += cur.item.dwellMinutes
    dwellMin += cur.item.dwellMinutes

    stops.push({
      kind: 'poi',
      place: cur.place,
      item: cur.item,
      atMin: arrive,
      leaveMin: t,
      isFirst: false,
      isLast: false,
    })
  }

  // 末段：回住宿点
  if (pois.length > 0) {
    const last = pois[pois.length - 1]
    if (last) {
      const mode: TravelMode = last.item.modeToNext ?? ctx.defaultMode
      const leg = resolveLegSync(last.place, home, mode, ctx)
      legs.push(leg)
      transitSec += leg.duration
      if (leg.source === 'estimate') {
        hasEstimate = true
        allFromMatrix = false
      }
      if (leg.source === 'not-applicable') hasNotApplicable = true
      if (leg.source !== 'matrix') allFromMatrix = false
      t += leg.duration / 60

      stops.push({
        kind: 'stay',
        place: home,
        atMin: t,
        leaveMin: t,
        isFirst: false,
        isLast: true,
      })
    }
  } else {
    // 空行程：首站即末站
    const first = stops[0]
    if (first) {
      first.isLast = true
      first.leaveMin = first.atMin
    }
  }

  return {
    stops,
    legs,
    startMin: START,
    endMin: t,
    transitSec,
    dwellMin,
    hasEstimate,
    hasNotApplicable,
    allFromMatrix,
  }
}

function parseStart(day: ItineraryDay): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(day.startTime)
  if (!m) return 540 // 09:00
  return Number(m[1]) * 60 + Number(m[2])
}

/* ────────────────────────────────────────────────
 * 过载提示
 * ────────────────────────────────────────────── */

/** 收尾过晚的阈值（22:00） */
const LATE_END_MIN = 22 * 60
/** 单段过长的阈值（60 分钟） */
const LONG_LEG_MIN = 60

/**
 * 四条过载规则（09 文档 5.2）。
 *
 * ★ 措辞一律「**陈述事实 + 给建议**」，不用祈使句 —— 顺序的决定权在用户手里。
 *   这是"不做自动排序"这个取舍在文案上的延续：既然说好了顺序由他定，
 *   就不该用"你应该"的语气把判断夺回去。
 */
export function overloadWarnings(tl: Timeline, ctx?: LegContext): string[] {
  const out: string[] = []

  // ① 收尾过晚
  if (tl.endMin > LATE_END_MIN) {
    out.push(`行程排到 ${fmtClock(tl.endMin)}，可能过晚 · 建议减少 1 个点位`)
  }

  // ② 在途占比过高
  const transitMin = tl.transitSec / 60
  if (tl.dwellMin > 0 && transitMin > tl.dwellMin * 0.5) {
    out.push(
      `路上耗掉 ${fmtMinutes(Math.round(transitMin))}，超过游玩时间的一半 · 建议把相近的点位排在一起`,
    )
  }

  // ③ 单段过长（只报最长的一段）
  let worstIdx = -1
  let worstLeg: LegResult | null = null
  tl.legs.forEach((leg, idx) => {
    if (leg.duration / 60 <= LONG_LEG_MIN) return
    if (!worstLeg || leg.duration > worstLeg.duration) {
      worstLeg = leg
      worstIdx = idx
    }
  })
  if (worstLeg) {
    const w: LegResult = worstLeg
    out.push(
      `第 ${worstIdx + 1} 段需 ${fmtDuration(w.duration)}，是全天最长的一段 · 建议换个顺序或改出行方式`,
    )
  }

  // ④ 方式不适用 → ★ 给**替代方式的具体时长**，不留"建议换方式"这种空话
  const naLeg = tl.legs.find((l) => l.source === 'not-applicable')
  if (naLeg) {
    const alts = alternativeModes(naLeg, ctx)
    const suffix = alts.length
      ? ` · 建议：${alts.map((a) => `${MODE_META[a.mode].label} ${fmtDuration(a.duration)}`).join(' / ')}`
      : ''
    out.push(
      `${MODE_META[naLeg.mode].label}在这段不适用（直线 ${fmtDistance(
        haversinePair(naLeg),
      )}，已超出该方式的合理距离）${suffix}`,
    )
  }

  return out
}

function haversinePair(leg: LegResult): number {
  // 这里只需要大致量级用于文案，复用估算器的几何计算
  const toRad = Math.PI / 180
  const p1 = leg.from.lat * toRad
  const p2 = leg.to.lat * toRad
  const dp = p2 - p1
  const dl = (leg.to.lng - leg.from.lng) * toRad
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * 6_371_008.8 * Math.asin(Math.sqrt(h))
}

/**
 * 换一个方式，这段大概多久？ —— 用于"不适用"时的具体替代建议。
 *
 * 优先查矩阵里这条点对的其他通道（真实值），查不到才退回直线估算。
 * 刻意排除掉同样不适用的方式，否则会出现「建议：步行 0 分」这种废话。
 */
function alternativeModes(
  leg: LegResult,
  ctx?: LegContext,
): Array<{ mode: TravelMode; duration: number }> {
  if (!ctx) return []
  const out: Array<{ mode: TravelMode; duration: number }> = []
  for (const mode of TRAVEL_MODE_KEYS) {
    if (mode === leg.mode) continue
    if (MODE_META[mode].live) continue // 公交/地铁要实时算，这里给不了确定数
    const r = resolveLegSync(leg.from, leg.to, mode, ctx)
    if (r.source === 'not-applicable' || r.duration <= 0) continue
    out.push({ mode, duration: r.duration })
  }
  out.sort((a, b) => a.duration - b.duration)
  return out.slice(0, 2)
}

/* ────────────────────────────────────────────────
 * 汇总口径
 * ────────────────────────────────────────────── */

/** 住宿段的展示文案：`'第 1–2 天 · 搜索定位 · 仅存本机'` */
export function stayRangeLabel(stay: Stay): string {
  const src = stay.source === 'geocoded' ? '搜索定位' : stay.source === 'picked' ? '地图点选' : '从 POI 里选'
  const day = stay.fromDay === stay.toDay ? `第 ${stay.fromDay} 天` : `第 ${stay.fromDay}–${stay.toDay} 天`
  // ★ "仅存本机"是隐私声明，不是装饰 —— 住宿点等于"他在哪过夜"（09 文档第八节）
  return `${day} · ${src} · 仅存本机`
}

/** 给定天数，取当天所属的住宿段（多住宿段支持） */
export function stayOfDay(stays: Stay[], day: number): Stay | null {
  return stays.find((s) => day >= s.fromDay && day <= s.toDay) ?? null
}
