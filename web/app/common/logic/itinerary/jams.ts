/**
 * **实时路况**：把 `get_speed=1` 的速度步骤，转成「哪一段路堵、堵到什么程度」。
 *
 * ## 数据长什么样（2026-09-25 实测，见 `polyline.ts` 文件头那张表）
 * ```
 * "speed": [ { "polyline_idx": [0, 12], "speed": 55 }, { "polyline_idx": [12, 40], "speed": 18 } ]
 * ```
 * - `polyline_idx` 是**下标**（不是坐标个数）：实测最后一条 `[560, 565]` 对上 566 长的数组；
 * - `speed` 是 km/h。
 *
 * ## ★★ 这里修的是一个静默 bug（2026-10-25）
 * 旧代码把 `speed` 当成 `number[]`（`speed.filter(v => v < 40)`）—— 而它实际是**对象数组**，
 * 对象跟数字比较恒为 `false` ⇒ `congestionOf` **永远返回 undefined**，
 * 方案卡上的拥堵提示从来没出现过；`jams` 也因此一直没人生产（`routeLayer` 画得出来但没数据）。
 * 这类错误不报错、不崩溃，只是"那个功能一直空着"。
 *
 * ## 为什么单独一个文件
 * `routeOptions.ts` 卡在护栏 G 的上限附近（416/420），而这一段还带类型与三档阈值。
 *
 * ## 与图商层的边界
 * `JamSpan` 与 `map/tencent/routeLayer.ts` 里的同名接口**结构同构**，但刻意**不 import**
 * —— 业务层不许依赖图商适配层（护栏 AM）。两者靠 TypeScript 的结构化类型自动兼容。
 */

/** 拥堵的视觉分档。UI 与地图描色共用，避免两处各判一次 */
export type JamLevel = 'clear' | 'slow' | 'jam'

/**
 * 速度（km/h）→ 分档（09 文档 6.3.1）：
 * `≥40` 畅通（不描色，基准色就是它）/ `20–40` 缓行 / `<20` 拥堵。
 */
export function congestionLevel(kmh: number): JamLevel {
  if (kmh >= 40) return 'clear'
  if (kmh >= 20) return 'slow'
  return 'jam'
}

/** 方案卡上那一行「N 段缓行 · 最慢 X km/h」 */
export interface CongestionInfo {
  /** 缓行 + 拥堵的路段数 */
  slowCount: number
  /** 最慢路段速度（km/h） */
  slowestKmh: number
}

/** 折线上的拥堵区间。★ 与 `routeLayer.JamSpan` 同构（见文件头） */
export interface JamSpan {
  fromIdx: number
  toIdx: number
  level: Exclude<JamLevel, 'clear'>
}

/**
 * 腾讯 `speed[]` 的一项。
 * ★ `polyline_idx` 与 `speed` 都是可空：接口偶尔省略，缺了就跳过这一步（别猜）。
 */
export interface RawSpeed {
  polyline_idx?: number[]
  speed?: number
}

/** 只取有数值的部分 —— 缺 `speed` 的步骤对"堵不堵"没有信息 */
function speedsOf(speed: RawSpeed[] | undefined): number[] {
  if (!speed || speed.length === 0) return []
  return speed.map((s) => s.speed).filter((v): v is number => typeof v === 'number')
}

/**
 * 从速度步骤里提炼拥堵摘要（方案卡那一行）。
 *
 * ⚠️ 刻意**不做"蚂蚁线"动态流光** —— 那是导航 App 的语言，会让人误以为这是实时导航。
 *    我们给的是"查询时刻的快照"，静态描色更诚实。
 */
export function congestionOf(speed: RawSpeed[] | undefined): CongestionInfo | undefined {
  const values = speedsOf(speed)
  if (values.length === 0) return undefined
  const slow = values.filter((v) => v < 40)
  if (slow.length === 0) return undefined
  return { slowCount: slow.length, slowestKmh: Math.min(...slow) }
}

/**
 * 把速度步骤转成**可描色的下标区间**。
 *
 * @param speed 接口原样的 `speed[]`（下标是**原始差分数组**的，见文件头）
 * @param pathLen 该方案 `path` 的**点数**（解码之后），用来换算 + 裁掉越界区间
 * @returns 畅通段**不入结果**（基准色本身表达畅通，描一层只会糊）；不足两点画不出线的也跳过
 */
export function jamsOf(speed: RawSpeed[] | undefined, pathLen: number): JamSpan[] {
  if (!speed || speed.length === 0 || pathLen < 2) return []
  /** 原始差分下标 → 解码后的点下标（★ 见文件头那张实测表） */
  const toPoint = (raw: number) =>
    Math.max(0, Math.min(pathLen - 1, Number.isFinite(raw) ? Math.floor(raw / 2) : 0))

  const out: JamSpan[] = []
  for (const step of speed) {
    const idx = step.polyline_idx
    const kmh = step.speed
    if (!idx || idx.length < 2 || typeof kmh !== 'number') continue
    const fromIdx = toPoint(idx[0] ?? 0)
    const toIdx = toPoint(idx[1] ?? 0)
    if (toIdx - fromIdx < 1) continue
    const level = congestionLevel(kmh)
    if (level === 'clear') continue
    out.push({ fromIdx, toIdx, level })
  }
  return out
}
