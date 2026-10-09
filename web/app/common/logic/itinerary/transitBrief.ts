/**
 * **公交/地铁的"分段"** —— 接口原样给的那点东西，翻译成人能读的。
 *
 * ## 为什么单独一个文件
 * `routeOptions.ts` 管的是"拉多方案 + 统一各路接口的差异"，而公交的分段
 * 是**另一种形状的数据**（`steps[]` 而非一根折线），且要处理"逐段解码""换乘在哪"
 * 这些它自己才有的问题。混在一起会让那个文件同时讲两套结构。
 *
 * ## 接口给什么（官方文档）
 * ```
 * routes[]                          ← 一条完整路线
 *   └ steps[]                       ← [步行, 乘车, 步行, 乘车, 步行]
 *       ├ mode: 'WALKING'  →  polyline / distance / duration
 *       └ mode: 'TRANSIT'  →  lines[0] { title, vehicle, station_count,
 *                                        geton.title, getoff.title,
 *                                        destination.title, polyline, ... }
 * ```
 * ★ `lines` 是数组（同一段可能有几条线路），**取 `[0]`** ——
 *   接口保证"数组第一项给出较完整信息，其它项只返回线路名等简要信息"。
 */
/**
 * ★ `LatLngPoint` 从 `./polyline` 直接取（**符号真正声明的地方**），不要绕 `./resolveLeg`
 *   —— 那边只是 `export type { LatLngPoint }` 转一道，护栏 F 项认的是声明处
 *   （"二手来源"会让"这个类型到底归谁"变得含糊）。两者是同一个符号，语义不变。
 */
import { decodePolyline, type LatLngPoint } from './polyline'

/** `transit` 乘车段里的一条线路（只声明我们真的会读的字段） */
interface RawTransitLine {
  /** 线路名，如「地铁1号线」「11路」 */
  title?: string
  /** `BUS` / `SUBWAY` / `RAIL` */
  vehicle?: string
  /** 经停站数 */
  station_count?: number
  /** 线路终点站（用来指示方向；环线是下一站） */
  destination?: { title?: string }
  geton?: { title?: string }
  getoff?: { title?: string }
  /**
   * ★ **地铁线路官方色**（如 `#0060A4`）。
   * ⚠️ 要请求时带 `added_fields=line_color` 才有（官方文档明确写了这个前置条件），
   *   不带就永远拿不到 —— 而"拿不到"和"这条线路本来没有色"看起来一模一样。
   */
  line_color?: string
  distance?: number
  duration?: number
  polyline?: unknown
}

/** `transit` 的 step —— 只有 `mode` 是共有的，其余字段按 `mode` 分叉 */
export interface RawTransitStep {
  mode?: string
  polyline?: unknown
  distance?: number
  duration?: number
  lines?: RawTransitLine[]
}

/**
 * 公交/地铁方案的**一段** —— 只取"人能读"的那几件事。
 *
 * ★ 一段要么是"走"、要么是"乘车"，用 `kind` 区分。**不合并成一个大可选字段集**：
 *   那样 UI 每次都要判"这个字段在不在"，判错的后果是显示一句空白。
 */
export interface TransitStepBrief {
  kind: 'walk' | 'ride'
  /** 米 */
  distance: number
  /** 分钟 */
  durationMinutes: number
  /** 乘车段：线路名（接口原样给，不加工） */
  line?: string
  /** 乘车段：`BUS` / `SUBWAY` / `RAIL` */
  vehicle?: string
  /** 乘车段：上车站名 */
  fromStation?: string
  /** 乘车段：下车站名 —— **它同时就是下一段的换乘站** */
  toStation?: string
  /** 乘车段：开往方向（线路终点站名）—— 公交方向感的唯一来源 */
  towards?: string
  /** 乘车段：经停站数 */
  stationCount?: number
  /**
   * 乘车段：**线路官方色**（地铁一般有，如 `#0060A4`）。
   * 拿不到就是空 —— UI 用自己的默认色，别假装有个色。
   */
  color?: string
}

/**
 * 公交/地铁方案的**一段路线** —— 画在地图上用。
 *
 * ## 与 `TransitStepBrief` 的分工
 * | | 干什么 | 有什么 |
 * |---|---|---|
 * | `TransitStepBrief` | 念给用户**听**（列表文案） | 线路名/站名/站数 |
 * | 本类型 | 画给用户**看**（地图） | 坐标串 + 线型 + 颜色 |
 * 两者一一对应（同一个 `steps[i]`），但**不合成一个** —— 只想要文案的地方
 * 不该被迫拖上几百个坐标点。
 */
export interface RouteSegment {
  kind: 'walk' | 'ride'
  path: LatLngPoint[]
  /** 乘车段的线路官方色（地铁有）。步行段没有 —— 由 UI 用线型表达 */
  color?: string
  /** 线路名（图上标注 / 图例用） */
  line?: string
  /** `BUS` / `SUBWAY` / `RAIL` */
  vehicle?: string
}

/**
 * 公交/地铁的路径 —— **逐段解码后再接起来**。
 *
 * ## ★★ 为什么不能"把各段的原始数组拼起来再解一次"
 * 每段的坐标串都是**独立压缩**的：首两个值是该段起点的**绝对坐标**，
 * 前向差分只在**段内**累加。直接把几段接成一个长数组再解，第二段之后会按
 * "把上一段的末点当起点继续差分"算下去 ⇒ **整体错位**。
 * 而地图上一条错位的线**看起来仍然像一条路**（只是跑到了别处），
 * 这种错不报错、肉眼也难发现，所以必须从根上做对。
 */
/**
 * 公交/地铁的**分段几何** —— 每段一条（步行一条，各条线路各一条）。
 *
 * ★ 2026-10-05 用户：「这个在地图上显示**就是一条线**，得做标识 ——
 *   哪一段到哪一段是步行，哪一段到哪一段是公共交通，地铁线路官方都有默认的颜色」。
 *   ⇒ 不能再把所有段拼成一根：**分段**才画得出"这段走、那段坐地铁"，
 *   也才能让每段用**自己的颜色**（地铁的线路色）。
 */
export function transitSegmentsOf(steps: RawTransitStep[] | undefined): RouteSegment[] {
  const out: RouteSegment[] = []
  for (const st of steps ?? []) {
    if (st.mode !== 'TRANSIT') {
      // 步行段自己带 `polyline`；乘车段在线路对象上
      const raw = st.polyline
      if (!Array.isArray(raw)) continue
      out.push({ kind: 'walk', path: decodePolyline(raw as number[]) })
      continue
    }
    const line = st.lines?.[0]
    if (!line || !Array.isArray(line.polyline)) continue
    out.push({
      kind: 'ride',
      path: decodePolyline(line.polyline as number[]),
      ...(line.line_color ? { color: line.line_color } : {}),
      ...(line.title ? { line: line.title } : {}),
      ...(line.vehicle ? { vehicle: line.vehicle } : {}),
    })
  }
  return out
}

/**
 * 公交/地铁的**整条路径**（所有段拼成一根折线）。
 *
 * ★ 只给"不需要分段"的地方用（判断有没有几何、算包围盒）。
 *   画在地图上要 `transitSegmentsOf` —— 一根线看不出哪儿是步行。
 * ★ 它是 `transitSegmentsOf` 的拼接结果，**不自己再解析一遍**：
 *   两处各解析一次就会有两套"哪段算数"的判据，迟早不一致。
 */
export function transitPathOf(steps: RawTransitStep[] | undefined): LatLngPoint[] {
  return transitSegmentsOf(steps).flatMap((s) => s.path)
}

/**
 * 公交/地铁的**分段摘要** —— 「坐哪几趟、在哪换乘」。
 *
 * ## 换乘信息从哪来（不需要额外字段）
 * 接口把一条完整路线切成 `[步行, 乘车, 步行, 乘车, 步行]`，**换乘就藏在
 * "两个乘车段之间"** —— 下一个乘车段的上车站，就是上一个的下车站。
 * 所以 UI 只要把 `ride` 段顺着念一遍，换乘点自然落在中间。
 *
 * ★ 步行段**照留**（哪怕距离为 0）：它代表"从站台走到出口"这类真实步骤，
 *   丢了会让"上车站"显得凭空出现。
 */
export function transitLegsOf(steps: RawTransitStep[] | undefined): TransitStepBrief[] {
  const out: TransitStepBrief[] = []
  for (const st of steps ?? []) {
    if (st.mode !== 'TRANSIT') {
      out.push({
        kind: 'walk',
        distance: st.distance ?? 0,
        durationMinutes: st.duration ?? 0,
      })
      continue
    }
    const line = st.lines?.[0]
    if (!line) continue
    out.push({
      kind: 'ride',
      distance: line.distance ?? 0,
      durationMinutes: line.duration ?? 0,
      ...(line.title ? { line: line.title } : {}),
      ...(line.vehicle ? { vehicle: line.vehicle } : {}),
      ...(line.geton?.title ? { fromStation: line.geton.title } : {}),
      ...(line.getoff?.title ? { toStation: line.getoff.title } : {}),
      ...(line.destination?.title ? { towards: line.destination.title } : {}),
      ...(typeof line.station_count === 'number' ? { stationCount: line.station_count } : {}),
      ...(line.line_color ? { color: line.line_color } : {}),
    })
  }
  return out
}

/**
 * 公交/地铁方案的**一句话摘要** —— 列表里那一行用：
 * ```
 * 地铁1号线 → 地铁2号线 · 换乘 1 次
 * 11路 · 直达
 * ```
 *
 * ★ "换乘 N 次" = 乘车段数 − 1（换乘点就是相邻两个乘车段的衔接处）。
 * ★ 没有乘车段（纯步行）时如实说「全程步行」—— 不返回空串让 UI 去猜。
 */
export function transitHeadline(legs: TransitStepBrief[]): string {
  const rides = legs.filter((l) => l.kind === 'ride')
  if (rides.length === 0) return '全程步行'
  const names = rides.map((l) => l.line ?? '乘车')
  const transfers = rides.length - 1
  return `${names.join(' → ')} · ${transfers > 0 ? `换乘 ${transfers} 次` : '直达'}`
}
