/**
 * 通勤时长解析 —— `resolveLegSync` 是**同步纯函数**，来源按优先级三级。
 *
 * ```
 * ⓪ 用户手选的方案（方案卡里点的那条）          零调用
 * ① 已拉过的方案（routeSetCache 24h TTL）      零调用，★ 与海报同源
 * ② localStorage 缓存（住宿点相关 / 公交地铁）  零调用
 * ③ 直线估算                                   兜底，UI 必须标「估算」
 * ```
 *
 * ★ **同步路径必须保持纯**：拖拽排序时要每帧重算时间链，一次网络往返就能让交互崩掉。
 *   所以这里所有"可能慢"的事（实时接口）都放在另一条异步路径上，
 *   同步路径只做「查表 → 查缓存 → 直线估算」三件纯计算。
 *
 * ★★ **2026-10-25 删掉了「构建期矩阵」这一级**：它从来没有数据（`data/` 里 0 个
 *   `transit.json`），却让链路看起来有三级来源，掩盖了"行程页段时长一直是直线估算"。
 *   真实时长真正的来源是 `routeSetCache`（点开某段时拉过的方案，24h TTL）——
 *   海报一直用它，现在行程页也并轨（`plannedLegs.ts`）。
 * ⚠️ 本文件**不得 import 任何地图 SDK**（09 文档第九节底线：地图挂了行程照常可用）。
 */

import { MATRIX_CHANNEL, MODE_META, type GeoPoint, type Poi, type TravelMode } from '~shared/schema'

import type { LatLngPoint } from './polyline'

/* ────────────────────────────────────────────────
 * 基础类型
 * ────────────────────────────────────────────── */

/**
 * 坐标点。★ 定义搬到了 `./polyline`（折线解码要用它），这里 **re-export**。
 *
 * 为什么不各写一份：两份同形接口会**各自漂移**，而 `Place extends LatLngPoint` 一旦分家，
 * 连线层与时间链会各拿一套"看起来一样"的类型，体积检查也挡不住
 * （本文件恰好卡在 G 项的行数上限附近，顺手也省了 4 行）。
 */
export type { LatLngPoint }

/** 通勤的两端。住宿点与 POI 统一成同一种「地点」，这样连线与时间链只有一套代码 */
export interface Place extends LatLngPoint {
  kind: 'poi' | 'stay'
  /** POI id 或 stay id */
  id: string
  name: string
}

export type LegSource =
  /**
   * 命中**已拉过的方案**（`routeSetCache`，24h TTL）—— 真实路线，零请求。
   * ★ 与 `cache` 的区别只是存储不同：这个存的是"整段多种方案 + 折线"，
   *   `cache` 存的是"单段一个时长"（住宿点相关 / 公交地铁的即时补算结果）。
   */
  | 'planned'
  /** 命中本地缓存（零调用） */
  | 'cache'
  /** 实时接口返回 */
  | 'live'
  /** 直线距离 × 方式系数估算 —— UI **必须**标注「估算」 */
  | 'estimate'
  /** 该方式不适用，UI 引导换方式。★ 删掉矩阵后暂时没有生产者，见 `resolveLegSync` 注释 */
  | 'not-applicable'

export interface LegResult {
  from: Place
  to: Place
  mode: TravelMode
  /** 米 */
  distance: number
  /** 秒 */
  duration: number
  source: LegSource
  /**
   * 路径点。`null` = 只有两端点，UI 画**直线**并标注「直线示意」。
   *
   * 为什么矩阵命中没有路径：预计算矩阵只存 `distance` + `duration` 两个数，
   * **不存路径点**（否则体积暴涨）。只有运行时真调了路线规划才拿得到 polyline。
   * 这个取舍要写在 UI 上，避免用户以为路线画错了。
   */
  path: LatLngPoint[] | null
  /** 打车费（元）。仅 mode === 'taxi' 且实时拉到时有值 —— 缺失就隐藏该行，不显示"费用未知" */
  taxiFare?: number
}

/* ────────────────────────────────────────────────
 * 直线估算（兜底，也是阈值判定的依据）
 * ────────────────────────────────────────────── */

const EARTH_R = 6_371_008.8

/** 球面距离（米）。⚠️ 入参是 (lng, lat) —— 与腾讯接口的 lat,lng 相反 */
export function haversineMeters(a: LatLngPoint, b: LatLngPoint): number {
  const toRad = Math.PI / 180
  const p1 = a.lat * toRad
  const p2 = b.lat * toRad
  const dp = p2 - p1
  const dl = (b.lng - a.lng) * toRad
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * EARTH_R * Math.asin(Math.sqrt(h))
}

/**
 * ★ 到达点阈值（米）。入口离园区中心超过这个数才改用入口坐标，否则退回中心。
 *
 * 设计：小景点（锦里类）中心与入口差不到 200m，挪动反而没意义甚至更糟；
 * 只有大园区（青城山 ~1.7km、熊猫基地 ~1.5km）入口才值得单独落到售票口。
 * ★★ 与 Python `arrival_of`（`step6_transit.py` / `step3b_entrance.py` 共用口径）
 *    **必须一致** —— 否则"矩阵"与"路线图"会对不上。
 */
export const ARRIVAL_THRESHOLD_M = 300

/**
 * ★ 到达点：规划链路取 POI 落点时，用「入口坐标」而非「园区中心」，避免路线穿园。
 *
 * @returns 入口坐标（当 `location.entrance` 存在且离中心 > `ARRIVAL_THRESHOLD_M` 时），
 *          否则退回中心 `location.point`。
 * @note 展示类（地图标记 / 详情 / 飞入）**不要**调用它 —— 它们就该标在中心，见 handoff 文档。
 */
export function arrivalOf(poi: Poi): GeoPoint {
  const center = poi.location.point
  const entrance = poi.location.entrance
  if (entrance) {
    const d = haversineMeters(center, entrance)
    if (d > ARRIVAL_THRESHOLD_M) return entrance
  }
  return center
}

/**
 * 直线 → 实际路径的绕行系数，以及各方式的平均速度（m/s）。
 *
 * 这些数字是**兜底估算**用的，绝不能与矩阵里的实测值混在一起展示 ——
 * 所以估算结果一律带 `source: 'estimate'`，UI 据此打「估算」标。
 *
 * 速度取值偏保守（驾车按 30 km/h 的市区均速，不是高速巡航速度）。
 */
const ESTIMATE: Record<TravelMode, { detour: number; speed: number }> = {
  driving: { detour: 1.35, speed: 30_000 / 3600 },
  taxi: { detour: 1.35, speed: 30_000 / 3600 },
  bicycling: { detour: 1.2, speed: 4.2 },
  walking: { detour: 1.25, speed: 1.25 },
  transit: { detour: 1.6, speed: 20_000 / 3600 },
  subway: { detour: 1.5, speed: 28_000 / 3600 },
}

/** 直线估算一段。`path` 恒为 null —— 估算给不出路径 */
export function estimateLeg(from: Place, to: Place, mode: TravelMode): LegResult {
  const cfg = ESTIMATE[mode]
  const straight = haversineMeters(from, to)
  const distance = Math.round(straight * cfg.detour)
  const duration = Math.max(60, Math.round(distance / cfg.speed))
  return { from, to, mode, distance, duration, source: 'estimate', path: null }
}

/* ────────────────────────────────────────────────
 * 缓存
 * ────────────────────────────────────────────── */

export interface CachedLeg {
  distance: number
  duration: number
  at: number
  taxiFare?: number
}

/**
 * 缓存有效期（09 文档 3.3）。
 *
 * 公交/地铁时效性最强（地铁新开、公交改线），且用户可能在出行前几天排行程、当天重看 → 7 天。
 * 其余方式相对稳定 → 30 天。
 */
export const CACHE_TTL_MS: Record<TravelMode, number> = {
  transit: 7 * 86_400_000,
  subway: 7 * 86_400_000,
  driving: 30 * 86_400_000,
  taxi: 30 * 86_400_000,
  bicycling: 30 * 86_400_000,
  walking: 30 * 86_400_000,
}

/**
 * 多方案结果的有效期。⚠️ 只有 2 小时 —— 它含实时路况，
 * 放一整天就失去意义了（09 文档 3.3 特意把它单列）。
 */
export const ROUTE_OPTIONS_TTL_MS = 2 * 3_600_000

export function isCacheFresh(entry: CachedLeg, mode: TravelMode, now = Date.now()): boolean {
  return now - entry.at < CACHE_TTL_MS[mode]
}

/** 缓存键：含方式，因为同一点对不同方式是完全不同的结果 */
export function legKey(from: Place, to: Place, mode: TravelMode): string {
  return `${from.kind}:${from.id}|${to.kind}:${to.id}|${mode}`
}

/* ────────────────────────────────────────────────
 * 同步解析（每帧可调）
 * ────────────────────────────────────────────── */

/**
 * 用户在多方案卡里**手动选定**的那一条。
 *
 * 为什么需要它：多方案卡里 A/B/C 三条时长是**真的不一样**的（避堵那条会更长）。
 * 如果用户选了 C 而时间轴还显示矩阵的默认时长，那"换方案"就只是个装饰。
 *
 * 为什么用 `live` 而非新造一个 source：它确实来自一次实时接口调用，
 * 只是"这一条是用户选的"这层语义由 UI 负责说明（卡上会标「已选」）。
 */
export interface LegOverride {
  /** 秒 */
  duration: number
  /** 米 */
  distance: number
  /** 打车费（元）。缺失即隐藏该行，不写 0 */
  taxiFare?: number
}

export interface LegContext {
  /** 本地缓存查询（`store.legCache`：住宿点相关 / 公交地铁的即时补算结果）。不传就是不查 */
  getCached?: (key: string) => CachedLeg | undefined
  /** 默认出行方式（某段没单独指定时用它） */
  defaultMode: TravelMode
  /**
   * 用户在方案卡里选定的那一条（key 由 `legKey()` 生成）。
   *
   * ★ 优先级**最高** —— 矩阵给的是"这条路通常要多久"，
   *   而用户点的那条是"我就要走这条"，后者是更明确的意图。
   */
  getOverride?: (key: string) => LegOverride | undefined
  /**
   * **已拉过、还在有效期内的方案**（`routeSetCache`，24h TTL）。
   * ★ 与 `getOverride` 的分工：后者是"用户手点的那条"（意图 → `live`），
   *   这里是"以前拉过的真实路线"（→ `planned`）。都给真实时长，区别只在来源标记。
   * ★ 没有它也能跑：落到缓存 / 估算，不阻塞渲染。
   */
  getPlanned?: (key: string) => LegOverride | undefined
}

/**
 * 同步解析一段通勤。**不发起任何网络请求。**
 *
 * ## 优先级阶梯（从高到低）
 * | 级 | 来源 | 说明 |
 * |----|------|------|
 * | ⓪ | 用户手选方案 | `ctx.getOverride` —— 意图最明确，压过一切 |
 * | ① | 已拉过的方案 | `ctx.getPlanned`（`routeSetCache` 24h TTL）—— 真实路线，与海报同源 |
 * | ② | 本地缓存 | 住宿点相关 / 公交地铁的即时补算结果 |
 * | ③ | 直线估算 | 兜底，让时间链先有数，异步补齐后再重算 |
 *
 * ★ 这是拖拽排序可以每帧重算的原因：全是 O(1) 查表，
 *   46 个点、一天 8 段，整条时间链重算远在 16ms（一帧）预算之内。
 * ★ 需要实时数据的场景（住宿点相关、公交/地铁）在同步路径上返回**估算值**，
 *   由调用方在异步补齐后重算一次 —— 先给结果，再纠偏。
 *
 * ⚠️ `not-applicable` 目前**没有生产者**（原本只由"矩阵超距哨兵"产生）。值与判据留着，
 *    但别把"没有不适用段"读成"判据失效"。
 */
export function resolveLegSync(
  from: Place,
  to: Place,
  mode: TravelMode,
  ctx: LegContext,
): LegResult {
  const key = legKey(from, to, mode)

  // ⓪ 用户手选的方案 —— 意图最明确，压过一切
  const override = ctx.getOverride?.(key)
  if (override) return numbered(from, to, mode, override, 'live')

  // ① 已拉过的方案（routeSetCache 24h TTL）—— 真实路况，且**一次请求都不用发**
  const planned = ctx.getPlanned?.(key)
  if (planned) return numbered(from, to, mode, planned, 'planned')

  // ② 本地缓存（住宿点相关 / 公交地铁）
  const cached = ctx.getCached?.(key)
  if (cached && isCacheFresh(cached, mode)) {
    return {
      from,
      to,
      mode,
      distance: cached.distance,
      duration: cached.duration,
      source: 'cache',
      path: null,
      taxiFare: cached.taxiFare,
    }
  }

  // ③ 直线估算兜底 —— 先让时间链有数，异步补齐后再重算
  return estimateLeg(from, to, mode)
}

/** 把「只有时长 + 距离」的结果包成 `LegResult`（手选与已拉方案共用，免得抄两遍） */
function numbered(
  from: Place,
  to: Place,
  mode: TravelMode,
  v: LegOverride,
  source: LegSource,
): LegResult {
  return {
    from,
    to,
    mode,
    distance: v.distance,
    duration: v.duration,
    source,
    // 路径仍为 null：这两种来源只带「时长 + 距离」（方案卡上的数字），
    // 折线由「整条一次规划」或方案集合里的 `path` 提供（见 plans/13 §5.1/§5.3）
    path: null,
    ...(v.taxiFare !== undefined ? { taxiFare: v.taxiFare } : {}),
  }
}

/* ────────────────────────────────────────────────
 * 路线点串解码 —— 实现已搬到 `./polyline`
 * ────────────────────────────────────────────── */

/**
 * ★ 2026-09-25：算法**已实测确认**（一次真实调用：解出的首点与请求起点差 9 米、末点差 4 米），
 * 实现搬到 `./polyline`（纯函数 + 硬编码自检样本）。新代码请直接从那里引入。
 *
 * ⚠️ 历史：本处曾经是一个**空实现**（`return null`），注释写着"算法未实测前不猜"。
 *    那个决定本身是对的（画错折线比画直线更糟），但它留下两个**静默**后果：
 *      · `Timeline.leg.path` 恒为 `null` → 地图上的路线**全是直线**；
 *      · 拥堵描色（`jamSpan`）因为拿不到折线**从未生效**。
 *    实测后已补齐 —— 顺带纠正一个误解：腾讯的 `polyline` **不是压缩字符串，是数值数组**
 *    （`[lat1, lng1, dlat, dlng, …]` + 前向差分），所以"解码算法"这件事本身并不存在。
 */

/* ────────────────────────────────────────────────
 * 实时补算（异步，按需）
 * ────────────────────────────────────────────── */

export interface LiveFetchOptions {
  /** WebService key。没有就说明只能走 SDK 或降级 */
  webKey: string
  signal?: AbortSignal
  /** 超时（默认 8s）—— 超时即退化为估算，不让用户干等 */
  timeoutMs?: number
}

interface MatrixApiElement {
  status?: number
  distance?: number
  /** ⚠️ 单位是**秒**（路线规划接口才是分钟，别混） */
  duration?: number
}

/**
 * 住宿点 → 当天各点：一次批量拿全。
 *
 * 这里用的是矩阵接口的**一对多**能力（1 个起点 → 最多 200 个终点）。
 * 逐段算要 8 次调用，一对多只要 1 次 —— 这是即时结算最划算的一次省。
 *
 * ⚠️ 腾讯的矩阵接口**是有方向性**的：这里只算了「住宿点 → 各点」。
 *    若要「各点 → 住宿点」，得把 from/to 反过来再调一次。由于只存上三角做往返均值，
 *    住宿点相关的段建议两次都调、取均值后写缓存（反正一对多很便宜）。
 */
export async function fetchStayToOneWay(
  stay: Place,
  points: Place[],
  mode: TravelMode,
  opts: LiveFetchOptions,
): Promise<Array<{ distance: number; duration: number } | null>> {
  const channel = MATRIX_CHANNEL[mode]
  if (!channel) return points.map(() => null) // 公交/地铁不走矩阵接口
  if (points.length === 0) return []

  // ⚠️ 腾讯坐标是 lat,lng —— 纬度在前
  const from = `${stay.lat},${stay.lng}`
  const to = points.map((p) => `${p.lat},${p.lng}`).join(';')

  const url =
    `https://apis.map.qq.com/ws/distance/v1/matrix?mode=${channel}` +
    `&from=${from}&to=${to}&key=${encodeURIComponent(opts.webKey)}`

  const res = await fetchWithTimeout(url, opts)
  const rows = (res as { result?: { rows?: Array<{ elements?: MatrixApiElement[] }> } }).result?.rows
  const elements = rows?.[0]?.elements ?? []

  return points.map((_, idx) => {
    const el = elements[idx]
    // ⚠️ 单个元素可能失败：附近 5km 无道路时 status=4，
    //    distance 退化为直线距离且**不返回 duration**。必须逐元素判，不能直接读 duration
    if (!el || el.status === 4 || el.duration == null) return null
    return { distance: el.distance ?? 0, duration: el.duration }
  })
}

async function fetchWithTimeout(url: string, opts: LiveFetchOptions): Promise<unknown> {
  const ctrl = new AbortController()
  const timeout = opts.timeoutMs ?? 8000
  const timer = setTimeout(() => ctrl.abort(), timeout)
  if (opts.signal) {
    opts.signal.addEventListener('abort', () => ctrl.abort(), { once: true })
  }
  try {
    const r = await fetch(url, { signal: ctrl.signal })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const json = (await r.json()) as { status?: number; message?: string }
    if (json.status !== 0) throw new Error(json.message ?? `接口返回 status=${json.status}`)
    return json
  } finally {
    clearTimeout(timer)
  }
}

/** 该方式是否可能需要实时调用（用于决定要不要显示"正在校准"这类状态） */
export function needsLiveCall(from: Place, to: Place, mode: TravelMode): boolean {
  if (MODE_META[mode].live) return true // 公交 / 地铁
  // 住宿点相关：任意一端不是 POI 就必须实时算
  return from.kind !== 'poi' || to.kind !== 'poi'
}
