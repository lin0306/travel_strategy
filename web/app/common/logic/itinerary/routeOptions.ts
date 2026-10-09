/**
 * 多方案路线（"考虑堵车"的落地方式）。
 *
 * ## 为什么矩阵给不了多方案
 * 预计算矩阵只存 `distance` + `duration` 两个数，**存不了"有哪些路线可选"**；
 * 而且矩阵里的驾车时长是**生成时刻的路况快照**，给不出"现在哪条路更堵"。
 * 所以多方案**只能在运行时拉**。
 *
 * ## 因此必须控制成本
 * ```
 * 朴素做法（错）：一进行程页就把所有段的 3 条方案都拉了 → 8 段 × 3 条 = 24 次调用
 * 正确做法：      默认只用矩阵时长做汇总，【点开某一段】时才拉该段 → 1 次调用
 * ```
 * 切换方案**不重新请求**（3 条已在手），关掉该段结果留在缓存（**2 小时 TTL**，因为含实时路况）。
 *
 * ## 三个必须处理的降级（09 文档 3.6.3）
 * 1. `get_mp=1` **不保证返回 3 条** → 要能优雅展示"仅一条路线"
 * 2. 打车费**必须标「预估」** —— 它不含动态调价与拥堵溢价
 * 3. 路况是**查询时刻**的，不是行程当天的 → 措辞不能暗示"出发时就是这样"
 */

import type { TransitPrefer, TravelMode } from '~shared/schema'

import { jsonp } from './jsonp'
import { decodePolyline } from './polyline'
import {
  transitLegsOf,
  transitPathOf,
  transitSegmentsOf,
  type RawTransitStep,
  type RouteSegment,
  type TransitStepBrief,
} from './transitBrief'
import { canCallRouteOptions, consumeRouteOptions } from './quotaLedger'
// ★ `LatLngPoint` 从**声明处**（`./polyline`）取，`Place` 才是 `./resolveLeg` 的 ——
//   后者只是转一道 `export type { LatLngPoint }`，护栏 F 项认的是声明处。
import type { LatLngPoint } from './polyline'
import type { Place } from './resolveLeg'

/**
 * UI 一直从**本文件**取这几个名字（历史上它们就住在这里），所以在这里转出去 ——
 * 搬了家但没改调用方的 import，是这次拆分唯一"故意留下的旧地址"。
 */
export { transitHeadline } from './transitBrief'
export { transitSegmentsOf, type RouteSegment, type TransitStepBrief }


/** 方案卡按 A/B/C 命名，与原型和文案一致 */
const OPTION_KEYS = ['A', 'B', 'C'] as const

export interface CongestionInfo {
  /** 缓行/拥堵路段数 */
  slowCount: number
  /** 最慢路段速度（km/h） */
  slowestKmh: number
}

export interface RouteOption {
  /** 'A' | 'B' | 'C' */
  key: string
  /** 米 */
  distance: number
  /** ⚠️ **分钟** —— 路线规划接口用分钟，矩阵用秒。混了差 60 倍 */
  durationMinutes: number
  /** 过路费（元），有值才显示 */
  toll?: number
  /** 方案特色标签，如 ['少红绿灯'] */
  tags: string[]
  congestion?: CongestionInfo
  /**
   * 折线原始值 —— ★ **腾讯返回的是数值数组** `[lat1, lng1, dlat2, dlng2, …]`（前向差分），
   * **不是压缩字符串**（2026-09-25 实测确认，见 `./polyline` 文件头那张表）。
   * 解压交给 `decodePolyline()`；接口没给就是 `null` → 画「直线示意」并如实标注。
   *
   * ⚠️ **公交/地铁这条永远是 `null`** —— 那个接口的几何不在 `routes[].polyline` 上
   *    （见下面 `path` 那条）。要画几何请一律用 `path`。
   */
  polyline: number[] | null
  /**
   * **已解码**的绝对坐标路径 —— 调用方拿它直接画。
   *
   * ## ★★ 为什么不让调用方自己 `decodePolyline(polyline)`
   * 公交/地铁（`transit` 接口）的 `routes[]` **没有 `polyline` 字段**，
   * 几何散在 `steps[]` 里：
   * ```
   * steps[].mode === 'WALKING'  →  steps[].polyline
   * steps[].mode === 'TRANSIT'  →  steps[].lines[0].polyline
   * ```
   * 而每段的坐标串是**独立压缩**的（首两个值是该段起点的绝对坐标，
   * 前向差分只在段内累加）⇒ **把原始数组拼起来再解会整体错位**，
   * 必须**逐段解码、再把点接起来**。这件事解析处最清楚，所以一次做好。
   *
   * ★ 接口没给几何时是**空数组**（不是 null）—— 调用方判 `length >= 2` 即可。
   */
  path: LatLngPoint[]
  /**
   * **公交/地铁专有**：分段摘要（坐哪几趟、在哪换乘）。
   * 其余方式没有这个字段 —— UI 据此决定"要不要显示线路摘要"。
   */
  transitLegs?: TransitStepBrief[]
  /**
   * **公交/地铁专有**：分段**几何** —— 步行一条、每条线路各一条，各带自己的颜色。
   *
   * ★ 地图要"分段画"（哪段走、哪段坐车）就得用这个，**不能**用上面那根
   *   拼起来的 `path` —— 一根线看不出哪儿是步行，也没法给每段上不同的色。
   */
  segments?: RouteSegment[]
}

/**
 * 降级标记 —— 让 UI 知道该展示什么、不该展示什么。
 * - `single`  ：接口只返回 1 条 → 紧凑展示，不摆"3 条方案"的架子
 * - `no-fare` ：打车费缺失 → **隐藏该行，不显示"费用未知"**（无信息比坏信息好）
 * - `quota`   ：账本用尽 → 提示而不是空转
 */
export type RouteDegrade = 'none' | 'single' | 'no-fare' | 'quota' | 'failed'

/** 排序维度 —— 用户关心的就两件：哪条最快、哪条最短 */
export type RouteSortKey = 'time' | 'distance'

/**
 * 路线排序 —— **唯一出处**。
 *
 * ★★ 为什么必须收口：列表（`RouteOptionList`）与**地图**都要"第一条"。
 *   各写一份排序，就会出现"列表里第一条是 A、地图画的却是 B" ——
 *   而两者都"看起来对"，用户只会觉得地图画错了。
 *   所以"怎么排"只在这里定义一次：`sortRouteOptions(options, 'time')[0]`
 *   就是列表里第一条，也就是地图该画的那条。
 *
 * ★ **不改原数组**（`[...options]`）—— 传进来的可能是 state 里的引用，
 *   就地 sort 会污染它（React 里表现为"顺序偶尔乱一下"）。
 */
export function sortRouteOptions(options: RouteOption[], by: RouteSortKey): RouteOption[] {
  return [...options].sort((a, b) =>
    by === 'time' ? a.durationMinutes - b.durationMinutes : a.distance - b.distance,
  )
}

/**
 * 段 + 方式 + 偏好 → 缓存键。
 *
 * ★ **别退回只用 `uid`**：步行与驾车是两组完全不同的路线，共用一个键会让切回上一个
 *   方式时看到另一个方式的路线（不报错）。
 *
 * ★★ **`prefer` 只在公共交通下参与拼键**（2026-10-05 修）：上一版是无条件拼，
 *   而**读取端**（`StopTimeline` / `PlanDetailView`）无脑传 `s.transitPrefer`、
 *   **请求端**（`useRouteOptions`）在"换方式"那条路上**不传** —— 两端口径不同。
 *   加上 `setModeToNext` **不清 `transitPrefer`**，一个段完全可以"方式是驾车、
 *   身上还留着 `subway`" ⇒ 请求写进 `uid|driving|-`、列表去查 `uid|driving|subway`
 *   ⇒ **方案列表全程空白**（连 loading 都不显示，地图上也不画候选），**不报错**。
 *
 * ⇒ 判据收在这里（**唯一出处**）：非公交/地铁一律按 `-` 算 —— 无论调用方传不传
 *   `prefer`，键都稳定。比"要求每个调用方自己记得条件化"稳：那种约定迟早有人漏。
 */
export function routeOptionKey(uid: string, mode: TravelMode, prefer?: TransitPrefer): string {
  const transit = mode === 'transit' || mode === 'subway'
  return `${uid}|${mode}|${transit ? (prefer ?? '-') : '-'}`
}

export interface RouteOptionSet {
  at: number
  options: RouteOption[]
  /** 打车费（元）。缺失即为 undefined —— 不要写 0 */
  taxiFare?: number
  degrade: RouteDegrade
  /** 给用户看的一句说明（可为空） */
  note?: string
}

interface RawRoute {
  distance?: number
  duration?: number
  toll?: number
  tags?: string[]
  polyline?: unknown
  speed?: number[]
  /**
   * ★ **公交/地铁专用**：几何在这里，**不在** `polyline` 上。
   * 各段的坐标串是**独立压缩**的，所以要逐段解码（见 `transitPathOf`）。
   */
  steps?: RawTransitStep[]
}






interface DirectionResponse {
  status?: number
  message?: string
  result?: {
    routes?: RawRoute[]
    taxi_fare?: { fare?: number }
  }
}

/**
 * 公共交通的 `policy` —— 一次说清"偏哪边"。
 *
 * | 情况 | policy | 说明 |
 * |---|---|---|
 * | 非公交 | `LEAST_TIME` | 参考实时路况的最快 |
 * | `mode === 'subway'` | `LEAST_TIME,ONLY_SUBWAY` | **历史值**（合并前的"地铁"），保持原行为 |
 * | 偏好 = 地铁 | `LEAST_TIME,SUBWAY_FIRST` | 地铁优先 |
 * | 偏好 = 公交 | `LEAST_TIME,NO_SUBWAY` | ★ 腾讯**没有** `BUS_FIRST`，最接近的是"不坐地铁" |
 * | 无偏好（均衡） | `RECOMMEND` | 官方说"与腾讯地图 APP 默认策略一致" |
 *
 * ⚠️ 排序策略（`LEAST_TIME` / `RECOMMEND` …）是**四选一**，而 `SUBWAY_FIRST` /
 *   `NO_SUBWAY` / `ONLY_SUBWAY` 是**附加限制** —— 两者不是一类东西，
 *   用逗号同时传（官方文档明确支持），**别把附加限制单独当 policy 传**。
 * ⚠️ `NO_SUBWAY` 的语义比"公交优先"**强**：它是"完全不含地铁"。
 *   所以 UI 上那句话要说成「只坐公交」，不能写成"偏公交" ——
 *   用户选了它却看到一条含地铁的方案，会以为我们没生效。
 */
function transitPolicyOf(mode: TravelMode, prefer: TransitPrefer | undefined): string {
  if (mode !== 'transit' && mode !== 'subway') return 'LEAST_TIME'
  if (mode === 'subway') return 'LEAST_TIME,ONLY_SUBWAY'
  if (prefer === 'subway') return 'LEAST_TIME,SUBWAY_FIRST'
  if (prefer === 'bus') return 'LEAST_TIME,NO_SUBWAY'
  return 'RECOMMEND'
}

/**
 * 拉取某一段的多方案。
 *
 * @param usingOwnKey 使用者自备 key 时不设账本上限（配额是他自己的），但仍记账
 */
export async function fetchRouteOptions(
  from: Place,
  to: Place,
  mode: TravelMode,
  opts: {
    webKey: string
    usingOwnKey: boolean
    signal?: AbortSignal
    timeoutMs?: number
    /** ★ 公共交通的偏好（公交优先 / 地铁优先）。**不传 = 均衡** */
    transitPrefer?: TransitPrefer
  },
): Promise<RouteOptionSet> {
  const quota = canCallRouteOptions(opts.usingOwnKey)
  if (!quota.allowed) {
    return { at: Date.now(), options: [], degrade: 'quota', note: quota.reason }
  }

  // 公交 / 地铁走 transit 接口（也有多方案，但参数不同）；其余走 driving
  const isTransit = mode === 'transit' || mode === 'subway'
  const endpoint = isTransit ? 'transit' : 'driving'

  /**
   * ★★ 公共交通下"偏哪边"（公交 / 地铁 / 均衡）走 `policy` 的**附加限制**，
   * 不换接口 —— 映射见 `transitPolicyOf`。老数据里 `mode === 'subway'` 的
   * "只坐地铁"也在那里兜住。
   */
  const policy = transitPolicyOf(mode, opts.transitPrefer)

  /**
   * ⚠️⚠️ **`added_fields` 只对公交/地铁那个接口有效，必须条件化**。
   *
   * 这个坑真踩过一次（用户 2026-10-05 实测）：
   * 「路线查询失败：参数错误，**AddedFields line_color 不存在**」——
   * 而且**驾车、打车、骑行、步行全都报这个错**，因为它们都跟着带了这个参数。
   * 腾讯对不认识的附加字段是**直接拒绝整个请求**，不是忽略。
   *
   * ⇒ 教训不是"记住这个参数只对 transit 有效"，而是**参数要按接口拼**：
   *   下面凡是只适用于某类接口的，都紧挨着 `isTransit` 判断写，别混在公共串里。
   *   （`get_mp` / `get_speed` / `policy` 是几类接口共有的，所以照旧无条件带。）
   */
  const extraFields = isTransit ? '&added_fields=line_color' : ''

  // ⚠️ 不要在这里加 `output=jsonp` —— `jsonp()` 会自己拼（加两次会被腾讯当成无回调）
  const url =
    `https://apis.map.qq.com/ws/direction/v1/${endpoint}` +
    // ⚠️ 腾讯坐标是 lat,lng —— 纬度在前
    `?from=${from.lat},${from.lng}&to=${to.lat},${to.lng}` +
    `&get_mp=1` + // ★ 多方案（最多 3 条）
    `&get_speed=1` + // ★ 路况配速（哪段堵、堵到什么程度）
    `&policy=${policy}` + // 默认策略即参考实时路况
    // ★ 地铁线路的**官方色**（`lines[].line_color`，如 `#0060A4`）——
    //   官方文档写了前提：不带这个参数就永远拿不到，而"没带所以没有"和
    //   "这条线路本来就没色"**看起来一模一样**。所以它和读它的代码写在一起。
    extraFields +
    `&key=${encodeURIComponent(opts.webKey)}`

  try {
    const json = (await fetchJson(url, opts)) as DirectionResponse
    consumeRouteOptions()

    const routes = json.result?.routes ?? []
    const taxiFareRaw = json.result?.taxi_fare?.fare

    if (routes.length === 0) {
      return { at: Date.now(), options: [], degrade: 'failed', note: '接口未返回可用路线' }
    }

    const options: RouteOption[] = routes.slice(0, 3).map((r, i) => ({
      key: OPTION_KEYS[i] ?? String(i + 1),
      distance: r.distance ?? 0,
      durationMinutes: r.duration ?? 0,
      ...(r.toll ? { toll: r.toll } : {}),
      tags: (r.tags ?? []).map(tagLabel),
      congestion: congestionOf(r.speed),
      // ★ 实测是**数值数组**（不是压缩字符串）—— 用 Array.isArray 判，别用 typeof 'string'。
      //   腾讯坐标是 (lat, lng)，解压与转序都在 decodePolyline 里做（见 ./polyline）
      //   ⚠️ 公交/地铁这条**恒为 null**（那个接口不给这个字段），几何一律看 `path`
      polyline: !isTransit && Array.isArray(r.polyline) ? (r.polyline as number[]) : null,
      /**
       * ★ **画线请一律用这个**。公交/地铁的几何散在 `steps[]` 里，要逐段解码后拼接；
       *   其余方式就是一根折线。两者的差别收在 `transitPathOf` / `decodePolyline` 里。
       */
      path: isTransit
        ? transitPathOf(r.steps)
        : decodePolyline(Array.isArray(r.polyline) ? (r.polyline as number[]) : []),
      // ★ 公交/地铁才有：坐哪几趟、在哪换乘（其余方式没有这个概念）
      ...(isTransit ? { transitLegs: transitLegsOf(r.steps) } : {}),
      // ★ 公交/地铁才有：**分段几何**（每段一条，各带自己的线路色）
      ...(isTransit ? { segments: transitSegmentsOf(r.steps) } : {}),
    }))

    // ★ 只有 1 条是**正常情况**，不是错误 —— 有些点对就只这一条可行路线
    const degrade: RouteDegrade =
      options.length === 1 ? 'single' : mode === 'taxi' && taxiFareRaw == null ? 'no-fare' : 'none'

    return {
      at: Date.now(),
      options,
      // 打车费只在打车方式下有意义，且必须标「预估」
      ...(mode === 'taxi' && taxiFareRaw != null ? { taxiFare: taxiFareRaw } : {}),
      degrade,
      // 只有"仅一条"需要额外说明；"打车费缺失"是静默隐藏该行，不需要文案
      ...(degrade === 'single' ? { note: '这段只有一条可行路线' } : {}),
    }
  } catch (err) {
    return {
      at: Date.now(),
      options: [],
      degrade: 'failed',
      note: err instanceof Error ? `路线查询失败：${err.message}` : '路线查询失败',
    }
  }
}

/** 腾讯返回的是 `LEAST_LIGHT` 这类枚举，转成中文标签 */
function tagLabel(tag: string): string {
  const map: Record<string, string> = {
    LEAST_LIGHT: '少红绿灯',
    LEAST_FEE: '少收费',
    LEAST_TIME: '时间最短',
    LEAST_DISTANCE: '距离最短',
    AVOID_JAM: '避堵',
    HIGHWAY: '走高速',
    NO_HIGHWAY: '不走高速',
    TOLL: '收费',
    NO_TOLL: '免费',
  }
  return map[tag] ?? tag
}

/**
 * 从 `get_speed=1` 的速度数组里提炼拥堵信息。
 *
 * 速度区间 → 视觉表达（09 文档 6.3.1）：
 *   ≥ 40 km/h 畅通（基准色） / 20–40 缓行（橙） / < 20 拥堵（红）
 *
 * ⚠️ 刻意**不做"蚂蚁线"动态流光** —— 那是导航 App 的语言，会让人误以为这是实时导航。
 *    我们给的是"查询时刻的快照"，静态描色更诚实。
 */
function congestionOf(speed?: number[]): CongestionInfo | undefined {
  if (!speed || speed.length === 0) return undefined
  const slow = speed.filter((v) => v < 40)
  if (slow.length === 0) return undefined
  return { slowCount: slow.length, slowestKmh: Math.min(...slow) }
}

/** 拥堵的视觉分档。UI 与地图描色共用，避免两处各判一次 */
export function congestionLevel(kmh: number): 'clear' | 'slow' | 'jam' {
  if (kmh >= 40) return 'clear'
  if (kmh >= 20) return 'slow'
  return 'jam'
}

/**
 * 发一次请求。
 *
 * ★ **必须走 JSONP**（2026-09-26 实测）：腾讯 WebService 的响应里没有
 *   `Access-Control-Allow-Origin`，`fetch` 一律 `Failed to fetch`；
 *   接口本身是好的。详见 `./jsonp` 文件头那张实测表。
 *   ——这段代码改之前用的是 `fetch`，也就是说它**从来没在浏览器里成功过**：
 *   当时 WebService key 压根没配到前端，所以永远停在"未配置 key"，
 *   连这次失败都没机会暴露。
 */
async function fetchJson(url: string, opts: { signal?: AbortSignal; timeoutMs?: number }): Promise<unknown> {
  const json = await jsonp<DirectionResponse>(url, {
    timeoutMs: opts.timeoutMs ?? 8000,
    ...(opts.signal ? { signal: opts.signal } : {}),
  })
  if (json.status !== 0) throw new Error(json.message ?? `接口返回 status=${json.status}`)
  return json
}

/**
 * 方案卡里那句必须写的话（09 文档 3.6.3 第 3 点）。
 * 用户上午排晚上的行程，看到的路况是上午的 —— 不能暗示"出发时就是这样"。
 */
export function routeProvenanceNote(at: number): string {
  const d = new Date(at)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `路况为 ${hh}:${mm} 查询时刻的快照 · 参考值，非出发时的承诺`
}

/** 方案是否已过期（2 小时 TTL） */
export function isRouteOptionsStale(set: RouteOptionSet, now = Date.now()): boolean {
  return now - set.at > 2 * 3_600_000
}
