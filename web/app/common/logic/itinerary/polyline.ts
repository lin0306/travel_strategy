/**
 * 腾讯路线折线的解压 —— **实测确认，不是猜的**。
 *
 * ## 实测（2026-09-25 · `_tmp/probe_polyline.py` · 一次真实调用）
 * 起终点：成都 宽窄巷子 `(30.6695, 104.0555)` → 大熊猫繁育研究基地 `(30.7369, 104.1498)`
 *
 * | 项 | 实测结果 |
 * |---|---|
 * | `polyline` 类型 | **`number[]`**，566 个值 —— **不是压缩字符串** |
 * | 解压后 | 283 个点 |
 * | 首点 | `(30.66953, 104.055411)` → 与请求点差 **9 米** |
 * | 末点 | `(30.736906, 104.149843)` → 与请求点差 **4 米**（都是吸附道路的偏移，正常） |
 * | `polyline_idx` | 是**下标**（不是坐标个数）：最后一条 step 的 `[560, 565]` 对上 566 长的数组 |
 *
 * 官方算法（WebService API 文档原话）：polyline 是 `[lat1, lng1, lat2, lng2, …]`，
 * **第一个坐标未被压缩**，之后是**前向差分**；解压 `coors[i] = coors[i-2] + coors[i]/1e6`。
 *
 * ## ★ 两处要纠正的旧认知
 * 1. **不存在"解码算法"这件事** —— 之前 `resolveLeg.ts` 里那个空实现连**类型都是错的**
 *    （`decodePolyline(polyline: unknown)`，以为要解字符串）。网上常见的
 *    `charCodeAt(i) - 63` 那套是**微信小程序地图组件**的 polyline 格式，与 WebService 无关，
 *    照抄进来会得到一堆乱七八糟的坐标（且**不报错**，只是路线画到别处去）。
 * 2. **拥堵区间不用推算**：`speed[]` 每项自带 `polyline_idx: [from, to]`，
 *    直接就是这段在折线上的下标区间 —— 不需要"解出折线再回头找对应段"。
 *
 * ⚠️ 前向差分是**累加**的：`coors[i]` 依赖 `coors[i-2]`（已被本次循环改写过的值），
 *    所以必须**原地按顺序**遍历，不能并行/跳步。
 */

/** 一个坐标点。★ 与项目内部口径一致是 `(lng, lat)`，而腾讯接口是 `(lat, lng)` —— 转换只在本文件发生 */
export interface LatLngPoint {
  lng: number
  lat: number
}

/** 差分值的缩放因子。腾讯把经纬度乘 1e6 后取整再作差 */
const DELTA_SCALE = 1_000_000

/**
 * 解压腾讯返回的 `polyline`。
 *
 * @param flat 原始数值数组 `[lat1, lng1, dlat2, dlng2, …]`
 * @returns `(lng, lat)` 顺序的点串；输入不合法（长度 < 2）时返回**空数组**而不是抛错
 *          —— 路线是个增强，画不出来不该让页面崩（与 `loadSearchIndex` 同一个态度）。
 */
export function decodePolyline(flat: readonly number[]): LatLngPoint[] {
  const n = flat.length
  if (n < 2) return []

  // ★ 原地累加（见文件头「前向差分是累加的」）。数组来自 JSON，是崭新的，可以放心改。
  const coors = flat.slice()
  for (let i = 2; i < n; i++) {
    const base = coors[i - 2]
    const delta = coors[i]
    if (base === undefined || delta === undefined) break
    // ★ 脏值必须**截断**而不是跳过：差分是累加的，`base + NaN` 会污染它后面**每一个**点。
    //   截断 = 少画后半段（可见地少了一截），跳过 = 整条折线全变 NaN（MultiPolyline 直接不画）。
    if (!Number.isFinite(base) || !Number.isFinite(delta)) break
    coors[i] = base + delta / DELTA_SCALE
  }

  const pts: LatLngPoint[] = []
  for (let i = 0; i + 1 < n; i += 2) {
    const lat = coors[i]
    const lng = coors[i + 1]
    if (lat === undefined || lng === undefined) break
    // 头部两个值是绝对值，不经过上面的累加，所以这里也要挡一道
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    pts.push({ lat, lng })
  }
  return pts
}

/**
 * 自检样本 —— 上面那次**真实调用**返回的 `polyline` 前 30 个值。
 *
 * 为什么留一份硬编码样本：算法只有一行累加，但**写错的形态很多**
 * （缩放因子写成 1e5、忘了 ×1e6、索引跳步、把 `(lat,lng)` 当 `(lng,lat)`），
 * 而且错了**不会报错** —— 只是路线画到别的地方去。有样本就能一句话验完：
 *
 * ```ts
 * const pts = decodePolyline(POLYLINE_SAMPLE)
 * // 期望：首点 (lng 104.055411, lat 30.66953)，且每两个值一个点
 * ```
 */
export const POLYLINE_SAMPLE: readonly number[] = [
  30.66953, 104.055411, -109, -45, -21, 18, -61, 125, 0, 0, -211, -134, -163, -104, 0, 0, -415, 873,
  -197, 399, -515, 1088, -240, 552, -178, 480, -501, 1410, -14, 68,
]

/** 样本解压后的期望首点（用于自检） */
export const SAMPLE_FIRST_POINT: LatLngPoint = { lng: 104.055411, lat: 30.66953 }

/** 样本解压后的点数（30 个值 → 15 个点） */
export const SAMPLE_POINT_COUNT = 15

/**
 * 跑一次自检。**开发期调用**（见 `web/app/routes/city.tsx` 的注释或 check 脚本），
 * 断言解码器没被改坏。返回错误说明（`null` = 通过）。
 */
export function selfCheckPolyline(): string | null {
  const pts = decodePolyline(POLYLINE_SAMPLE)
  if (pts.length !== SAMPLE_POINT_COUNT) {
    return `样本解出 ${pts.length} 个点，期望 ${SAMPLE_POINT_COUNT} 个`
  }
  const first = pts[0]
  if (!first) return '样本解出空点串'
  if (Math.abs(first.lat - SAMPLE_FIRST_POINT.lat) > 1e-9 || Math.abs(first.lng - SAMPLE_FIRST_POINT.lng) > 1e-9) {
    return `首点解为 (${first.lng}, ${first.lat})，期望 (${SAMPLE_FIRST_POINT.lng}, ${SAMPLE_FIRST_POINT.lat})`
  }
  return null
}
