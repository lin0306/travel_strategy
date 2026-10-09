/**
 * **整条一次规划** —— 一条规划从起点到终点算**一条完整路线**（plans/13 §5.3）。
 *
 * ## 与「逐段多方案」的分工（别混）
 * | 层次 | 是什么 | 怎么拉 |
 * |------|--------|--------|
 * | **整条规划**（本文件） | 起 → … → 终 的一条完整路线 | 一次调用带 `waypoints`，`get_mp=0` **只取最快一条** |
 * | 单段备选（`routeOptions.ts`） | 点开某一段看 A/B/C | `get_mp=1`，点开才拉，保持现状 |
 *
 * 整条取 3 条方案 = 3 条长折线，体积与耗时都不划算，而用户真正会挑的是**某一段怎么走**。
 *
 * ## 三条实现约束
 * 1. **途经点上限 15**（腾讯官方）⇒ 起 + 15 + 终 = 17 个点一次算完；
 *    超了就按 16 点一段切开、**分段请求后拼接**（每段结果都是真实折线，拼起来仍然真实），
 *    并在 `note` 里如实写「本次规划分 N 段计算」。
 * 2. **不用 `waypointOrder`** —— 那是"自动排最顺路"（= TSP），红线 5 禁止。
 *    途经点顺序**就是用户排的顺序**。
 * 3. **只有能一次说清的才算整条**：公交 / 地铁接口返回的是"方案集合"（含步行接驳、
 *    多条线路组合），与"一条折线"不是一回事 ⇒ 明确拒绝并指路，而不是硬拼出一条假的。
 *
 * ⚠️ 这里是**唯一会花配额**的地方（除了逐段方案卡），所以每次调用都过账本
 *    （`quotaLedger`），且**只在用户点「规划路线 / 重新规划」时**才会走到。
 */

import type { PlanRoute, TravelMode } from '~shared/schema'

import { jsonp } from './jsonp'
import { decodePolyline } from './polyline'
import { canCallRouteOptions, consumeRouteOptions } from './quotaLedger'

/** 腾讯 `waypoints` 上限 */
const MAX_WAYPOINTS = 15

/** 一次请求能带的点数：起 + 途经 + 终 */
const POINTS_PER_CALL = MAX_WAYPOINTS + 2

/**
 * 逐段拼的方式上限（段数）。每段一次调用 —— 6 个点就是 5 次，
 * 不设上限时一条 20 点的步行规划会把当日配额一次烧光。
 */
const MAX_PER_LEG = 8

/** ⚠️ 腾讯 `polyline` 里速度数组的一项（`get_speed=1` 才有） */
interface RawSpeed {
  polyline_idx?: number[]
}

interface RawRoute {
  distance?: number
  duration?: number
  taxi_fare?: number
  polyline?: unknown
  speed?: RawSpeed[]
}

interface DirectionResponse {
  status?: number
  message?: string
  result?: { routes?: RawRoute[]; taxi_fare?: { fare?: number } }
}

/** 途经序列里的一个点 */
export interface WholeRoutePoint {
  uid: string
  /** `point` = 地图取点（可能是"不在路上"的那个）—— 失败说明按它分支 */
  kind: 'poi' | 'point'
  name: string
  lng: number
  lat: number
}

export type WholeRouteOutcome =
  | { ok: true; route: PlanRoute }
  | { ok: false; reason: string }

export interface WholeRouteOptions {
  /** 解析好的 WebService key（见 `map/tencent/config.ts` 的 `resolveWebServiceKey`） */
  webKey: string | null
  /** 使用者自备 key ⇒ 不设账本上限（配额是他自己的） */
  usingOwnKey: boolean
  signal?: AbortSignal
  timeoutMs?: number
}

/** 方法 → 接口路径。返回 `null` = 这条路的"整条规划"做不到（见文件头约束 3） */
function endpointOf(mode: TravelMode): string | null {
  if (mode === 'driving' || mode === 'taxi') return 'driving'
  if (mode === 'walking') return 'walking'
  if (mode === 'bicycling') return 'bicycling'
  return null
}

/** 支持 `waypoints` 的只有驾车接口（打车是它的收费版本，同一个 endpoint） */
function supportsWaypoints(mode: TravelMode): boolean {
  return mode === 'driving' || mode === 'taxi'
}

/**
 * 把一串点切成若干次请求。
 * @param perCall 每次请求最多几个点（≥2）
 *
 * ★ 相邻两段**必须重叠一个点**（上一段的终点就是下一段的起点）：
 *   不重叠会漏掉那一段路 —— 而拼起来的线看上去仍然是连续的，不报错、只是少一截。
 */
export function chunkRoute<T>(points: T[], perCall: number): T[][] {
  const per = Math.max(2, Math.floor(perCall))
  const out: T[][] = []
  let i = 0
  while (i + 1 < points.length) {
    const chunk = points.slice(i, i + per)
    if (chunk.length < 2) break
    out.push(chunk)
    i += chunk.length - 1
  }
  return out
}

function buildUrl(endpoint: string, chunk: WholeRoutePoint[], webKey: string): string {
  const from = chunk[0]
  const to = chunk[chunk.length - 1]
  if (!from || !to) throw new Error('chunk 至少要有两个点')
  const mids = chunk.slice(1, -1)

  const q: string[] = [
    // ⚠️ 腾讯坐标是 lat,lng —— 纬度在前
    `from=${from.lat},${from.lng}`,
    `to=${to.lat},${to.lng}`,
    // 途经点用 `;` 分隔
    ...(mids.length > 0 ? [`waypoints=${mids.map((p) => `${p.lat},${p.lng}`).join(';')}`] : []),
    // ★ 整条只取最快一条（多方案留给逐段）
    'get_mp=0',
    'get_speed=1',
    'policy=LEAST_TIME',
    `key=${encodeURIComponent(webKey)}`,
  ]
  return `https://apis.map.qq.com/ws/direction/v1/${endpoint}?${q.join('&')}`
}

/**
 * 发一次请求。
 *
 * ★ **必须走 JSONP，不能 `fetch`**（2026-09-26 实测）：腾讯 WebService 的响应里
 *   **没有 `Access-Control-Allow-Origin`**，浏览器 fetch 一律 `Failed to fetch`；
 *   而接口本身是好的（Node 直连 `status: 0`）。理由与代价写在 `./jsonp` 文件头。
 */
async function callDirection(url: string, opts: WholeRouteOptions): Promise<DirectionResponse> {
  const json = await jsonp<DirectionResponse>(url, {
    // 12s 而不是逐段的 8s：整条规划要一次算完十几个点，链路更长
    timeoutMs: opts.timeoutMs ?? 12_000,
    ...(opts.signal ? { signal: opts.signal } : {}),
  })
  if (json.status !== 0) throw new Error(json.message ?? `接口返回 status=${json.status}`)
  return json
}

/**
 * 算一条完整路线。
 *
 * 返回 `{ ok: false, reason }` 时 `reason` 是**给用户看的中文**，不要吞掉它 ——
 * 用户点了一次要花配额的动作，必须知道结果。
 */
export async function fetchWholeRoute(
  points: WholeRoutePoint[],
  mode: TravelMode,
  opts: WholeRouteOptions,
): Promise<WholeRouteOutcome> {
  if (points.length < 2) {
    return { ok: false, reason: '至少要有两个点位才能规划路线' }
  }

  const endpoint = endpointOf(mode)
  if (!endpoint) {
    return {
      ok: false,
      reason: '公交 / 地铁的路线是「方案集合」（含接驳步行与线路组合），没法画成一条折线 —— 到完整行程页可以逐段看。',
    }
  }

  if (!opts.webKey) {
    return { ok: false, reason: '没有可用的地图 key，无法查询路线（见「关于」页的 key 配置说明）' }
  }

  const byWaypoint = supportsWaypoints(mode)
  const chunks = byWaypoint
    ? chunkRoute(points, POINTS_PER_CALL)
    : chunkRoute(points, 2) // 逐段：每两点一次请求

  if (!byWaypoint && chunks.length > MAX_PER_LEG) {
    return {
      ok: false,
      reason: `「${mode === 'walking' ? '步行' : '骑行'}」只能逐段查询，这条规划有 ${chunks.length} 段，超过一次算 ${MAX_PER_LEG} 段的上限 —— 先精简点位，或改成驾车方式。`,
    }
  }

  const path: Array<{ lng: number; lat: number }> = []
  let distance = 0
  let duration = 0
  let taxiFare: number | undefined

  for (const chunk of chunks) {
    const quota = canCallRouteOptions(opts.usingOwnKey)
    if (!quota.allowed) {
      // ★ 账本那句默认文案是给"逐段方案卡"写的（"仍可手动点开单段查看"），
      //   整条规划这边要说自己的话 —— 接口给的话术在不同场景下会误导。
      return {
        ok: false,
        reason: `今日路线查询额度已用完（${quota.used}/${quota.cap}）· 明天恢复`,
      }
    }

    let json: DirectionResponse
    try {
      json = await callDirection(buildUrl(endpoint, chunk, opts.webKey), opts)
    } catch (err) {
      return { ok: false, reason: describeFailure(err, points) }
    }
    consumeRouteOptions()

    const first = json.result?.routes?.[0]
    if (!first) return { ok: false, reason: describeFailure(new Error('接口未返回可用路线'), points) }

    distance += first.distance ?? 0
    /*
     * ★★ 腾讯 `direction` 返回的 `duration` 是**分钟**，而 `PlanRoute.duration`（以及
     *   时间链、通勤矩阵全线）用的是**秒** —— 差 **60 倍**，而且**不报错**：
     *   实测 94.7 km 的路线被显示成「2 分」（真实值 ~120 分钟），页面看着完全正常。
     *   `routeOptions.ts` 里那个字段特意叫 `durationMinutes` 就是为了防这个，
     *   但整条线路走的是另一个出口，名字帮不上忙 ⇒ 只能在这里乘。
     */
    duration += (first.duration ?? 0) * 60
    // 打车费实测常常不在 `result` 层，两处都看一眼；拿不到就不显示（红 line：宁可没有，不写 0）
    const fare = json.result?.taxi_fare?.fare ?? first.taxi_fare
    if (typeof fare === 'number') taxiFare = fare

    const raw = Array.isArray(first.polyline) ? (first.polyline as number[]) : null
    const pts = raw ? decodePolyline(raw) : []
    if (pts.length === 0) {
      return { ok: false, reason: '接口没有返回可绘制的路线（折线为空）' }
    }
    /*
     * ★ 拼接时**跳过本段的首点**（除了第一段）：它等于上一段的末点。
     *   不跳过会在交界处留一个重复点，折线本身看不出问题，但
     *   一旦以后按顶点做下标定位（拥堵描色就靠下标），整条下标就错位了。
     */
    const startAt = path.length === 0 ? 0 : 1
    for (let i = startAt; i < pts.length; i++) {
      const p = pts[i]
      if (p) path.push({ lng: p.lng, lat: p.lat })
    }
  }

  return {
    ok: true,
    route: {
      at: Date.now(),
      path,
      distance,
      duration,
      ...(taxiFare !== undefined ? { taxiFare } : {}),
      ...(chunks.length > 1 ? { note: `本次规划分 ${chunks.length} 段计算后拼接` } : {}),
    },
  }
}

/**
 * 把失败翻译成**用户能据此行动**的话。
 *
 * ★ 那句"20 公里内没有可通行道路"的说明**只在规划里有地图取点时**才加：
 *   那是唯一会出现"点不在路上"的来源（腾讯驾车算路会把点吸附到就近道路，
 *   方圆 20 公里没有路时直接失败）。没取过点时提这句只会把人带偏。
 */
function describeFailure(err: unknown, points: WholeRoutePoint[]): string {
  const raw = err instanceof Error ? err.message : String(err)
  const hasPicked = points.some((p) => p.kind === 'point')
  return hasPicked
    ? `路线查询失败：${raw}。规划里有「地图取点」—— 那只是地图上的一处坐标，驾车算路会把它吸附到就近道路，方圆 20 公里内没有可通行道路时会直接算不出来。`
    : `路线查询失败：${raw}`
}
