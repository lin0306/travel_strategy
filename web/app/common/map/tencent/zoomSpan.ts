/**
 * **缩放 ↔ 跨度**的换算（Web Mercator）—— 取景「至少落到某一级」的地基。
 *
 * ## 为什么单独一个文件
 * 它原来是 `fitView.ts` 里的一段，加上之后那个文件 509 行、顶穿 G 项的 420 行上限。
 * 拆出来的理由不是行数本身，而是这两件事**确实不是一件事**：
 *   · `fitView.ts` —— DOM 侧：浮层实测、padding、飞行动画；
 *   · 本文件 —— 纯几何：给一段经纬度跨度和可用像素，答出"会落到多少级"。
 * 纯的部分单独放着，将来要改标定（比如换引擎的瓦片尺寸）不用在 DOM 代码里翻。
 *
 * ## 它解决什么问题（2026-09-26 用户报的「点区怎么还缩小地图了」）
 * `fitBounds` 只会回答"这片范围框得下吗"。第四级（区）的外接框常常**比景点级还大**
 * （广州从化区跨 0.8°×0.56°，框住它 ≈ z10.4，而景点 z≥12 才揭出来），
 * 于是"点这个区"停在区级 —— 用户眼里就是没反应，甚至比上一屏更小
 * （省级页原先退化成 0.5° 的近似市域方块，那就是实打实的**缩小**）。
 *
 * 所以取景要多一条约束：**落点至少到某一级**。做法是先把框收缩到"目标级别对应的跨度"
 * 再交给 `fitBounds`，而不是 fit 完再 `setZoom` —— 后者会打断飞行动画，
 * 而且 `setZoom` 不认 padding，浮层避让白算。
 */

import type { LatLngLike } from './fitView'

/**
 * 零面积范围的兜底跨度（度）。≈2km，只用来消除"只有一个点"这种退化范围。
 *
 * ★ 它必须**只有一份**：`fitView.boundsOf` 与下面的 `shrinkForMinZoom` 共用。
 *   两处各写一份的话，刚收缩完的框会被 `boundsOf` 重新撑回 2km，`minZoom` 就白给了
 *   （这是本文件里最容易改坏的一处 —— 看着只是个 0.02，坏了却没有任何报错）。
 */
export const DEGENERATE_SPAN_DEG = 0.02

/** Web Mercator 在 `zoom = 0` 时的世界像素宽（腾讯 / 高德 / 谷歌一致） */
const WORLD_PX = 256

/** 纬度 → 墨卡托 y（单位：π = 北极）。★ 缩放换算是**线性**的，但只在墨卡托空间线性 */
function mercY(lat: number): number {
  return Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
}

/** `mercY` 的逆变换 */
function latFromMercY(y: number): number {
  return (Math.atan(Math.exp(y)) - Math.PI / 4) * (360 / Math.PI)
}

/**
 * 「这片跨度用这么多像素框，会落到多少级」—— 与 `fitBounds` 同源的换算。
 *
 * ★ 精度够用即可：它只用来判断"够不够到 `minZoom`"以及算收缩系数。
 *   引擎自己还会留一点边距（实际落点略**浅**于这里的数），所以按它收缩只会**过头**、
 *   不会不足 —— 过头的结果是"比目标再深一点"，那正是我们要的方向。
 *
 * @param spanLng 经度跨度（度）
 * @param spanMerc 墨卡托 y 的跨度（用 `mercY` 算两端再相减，**不是**纬度差）
 * @param avail 可用像素（已扣掉浮层 padding）
 */
export function zoomForSpan(
  spanLng: number,
  spanMerc: number,
  avail: { w: number; h: number },
): number {
  const zLng = Math.log2((avail.w * 360) / (spanLng * WORLD_PX))
  const zMerc = Math.log2((avail.h * 2 * Math.PI) / (spanMerc * WORLD_PX))
  return Math.min(zLng, zMerc)
}

/**
 * 把一组点按"**锚点**不动、跨度缩到 `minZoom`"重投一遍。
 *
 * ★ 只在框出来的级别**浅于** `minZoom` 时动手：够深就原样返回 ——
 *   大框不缩小、小框也不放大，传 `minZoom` 是**单向**的承诺（"至少这么深"）。
 *
 * ★★ **锚点默认是框的几何中心，但可以由调用方指定**（`anchor`）。
 *   为什么需要指定：几何中心在"点散在四周"时是**一片空地** ——
 *   收缩之后屏幕上可能一个点都没有。点区取景框的是"这个区的景点"，
 *   所以它把锚点给成 `densestPoint`（最密的那一枚）。见 `districtFocus`。
 *
 * 纬度走墨卡托空间：直接对纬度做线性收缩，在跨纬度的地方会偏（墨卡托是拉伸过的）。
 */
export function shrinkForMinZoom(
  points: LatLngLike[],
  minZoom: number | undefined,
  avail: { w: number; h: number } | null,
  anchor?: LatLngLike,
): LatLngLike[] {
  if (points.length === 0 || minZoom === undefined || !avail || avail.w <= 0 || avail.h <= 0) {
    return points
  }

  let minLat = Infinity
  let maxLat = -Infinity
  let minLng = Infinity
  let maxLng = -Infinity
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat
    if (p.lat > maxLat) maxLat = p.lat
    if (p.lng < minLng) minLng = p.lng
    if (p.lng > maxLng) maxLng = p.lng
  }
  // 与 `boundsOf` 同一把尺子（同一份兜底跨度），否则收缩后又被撑开
  if (maxLat - minLat < DEGENERATE_SPAN_DEG) {
    minLat -= DEGENERATE_SPAN_DEG / 2
    maxLat += DEGENERATE_SPAN_DEG / 2
  }
  if (maxLng - minLng < DEGENERATE_SPAN_DEG) {
    minLng -= DEGENERATE_SPAN_DEG / 2
    maxLng += DEGENERATE_SPAN_DEG / 2
  }

  const spanLng = maxLng - minLng
  const yLo = mercY(minLat)
  const yHi = mercY(maxLat)
  const spanMerc = Math.abs(yHi - yLo)
  const z = zoomForSpan(spanLng, spanMerc, avail)
  // ★ 只有"框太大（级别太浅）"才收缩。z 已是目标或更深 → 原样 fit
  if (!(z < minZoom)) return points

  const k = Math.pow(2, z - minZoom) // < 1：级别差多少，跨度就缩到 2^差 分之一
  // ★ 锚点：给了就用它（"别把视野锚在空地上"），否则用框的几何中心
  const cLng = anchor ? anchor.lng : (minLng + maxLng) / 2
  const cY = anchor ? mercY(anchor.lat) : (yLo + yHi) / 2
  const halfLng = (spanLng / 2) * k
  const halfY = (spanMerc / 2) * k
  return [
    { lng: cLng - halfLng, lat: latFromMercY(cY - halfY) },
    { lng: cLng + halfLng, lat: latFromMercY(cY + halfY) },
  ]
}
