/**
 * 「镜头对准某个点」—— 与 `fitView.ts` 的 **fit** 是两件不同的事：
 *
 * | | `fitPoints`（fitView.ts） | 本文件 |
 * |---|---|---|
 * | 干什么 | 把**一串点**框进可视区（缩放由框大小反推） | 把**一个点**放到可视区中心 |
 * | 缩放 | 由框反推 | · `panPointToCenter` —— **不动**（保留用户调好的）<br>· `focusPointTo` —— **指定一个确定值** |
 * | 什么时候用 | 进入某一级 / 点徽标 / 搜索命中 | 点开景点详情（平移）/ 在行程里点一个站点（平移 + 指定缩放） |
 *
 * ## 为什么"看一个景点"不能用 `fit`
 * `fitBounds` 对**单点**只能从退化框 + padding 反推一个级别，实测落到 13.99 ——
 * 而"看这个景点"要的是**确定的**级别（`minZoom` 是收缩框、不是硬钳位，
 * 单点这条路上给不出保证）。所以 `focusPointTo` 直接 `setZoom(目标)`
 * 并**按目标缩放**算该把中心放哪。
 *
 * ★ 中心必须按**目标缩放**算：点落在屏幕哪个位置取决于世界坐标差在**那个缩放**下的像素值
 *   （`屏幕x = world_z(点) − world_z(中心) + 容器半宽`）。拿当前缩放算出来的位移，
 *   缩放一变就不对了。
 *
 * ## 浮层避让
 * 目标像素都是 `freeRect`（扣掉左面板 / 景点详情 / 规划面板之后）的**中心** ——
 * 用整屏中心的话，点会被挪到浮层边缘甚至压在浮层底下
 * （用户 2026-09-26 的原话：「点左侧的点，会出现被景点详情弹窗盖住的情况」）。
 *
 * ## 探针句柄
 * 镜头动过就写 `window.__mapPan`（与 `__mapLog` 同一条路子：不必去 hook SDK 原型）。
 */

import { FLY_DURATION_MS, freeRect, type LatLngLike } from './fitView'
import { projectToPixel, readViewport } from './viewport'

/* ── 墨卡托：世界像素 ⇄ 经纬度。只在本文件用，所以不做成公共模块 ── */

const LAT_LIMIT = 85.05112878

const worldX = (lng: number, size: number) => ((lng + 180) / 360) * size
const worldY = (lat: number, size: number) => {
  const clamped = Math.max(-LAT_LIMIT, Math.min(LAT_LIMIT, lat))
  const s = Math.sin((clamped * Math.PI) / 180)
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size
}
const lngOf = (x: number, size: number) => (x / size) * 360 - 180
const latOf = (y: number, size: number) => {
  const n = Math.PI - 2 * Math.PI * (y / size)
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}

/** 可视区中心（扣掉浮层之后）—— 两个函数的目标像素都是它 */
function centerOfFreeRect(
  el: HTMLElement,
  overlays: Array<HTMLElement | null>,
): { x: number; y: number } {
  const rect = freeRect(el, overlays)
  return { x: (rect.x0 + rect.x1) / 2, y: (rect.y0 + rect.y1) / 2 }
}

function writeProbe(lng: number, lat: number, zoom: number, dx: number, dy: number): void {
  ;(window as unknown as { __mapPan?: unknown }).__mapPan = {
    lng: Math.round(lng * 1e5) / 1e5,
    lat: Math.round(lat * 1e5) / 1e5,
    zoom: Math.round(zoom * 100) / 100,
    dx: Math.round(dx),
    dy: Math.round(dy),
    at: Date.now(),
  }
}

/**
 * 把某个点**平移**到可视区中心 —— **不改缩放**。
 *
 * 点开详情时用户只是在"看"，`fitBounds` 对单点会放到很深、抢走用户调好的缩放，
 * 所以这里只 `setCenter`。
 *
 * @param desired 目标容器像素。缺省 = 扣除浮层后的可视区中心
 * @returns 是否真的动了（点已经在目标处时返回 `false`，不打扰镜头）
 */
export function panPointToCenter(
  map: TMap.Map,
  point: LatLngLike,
  opts: { container?: HTMLElement | null; overlays?: Array<HTMLElement | null>; desired?: { x: number; y: number } } = {},
): boolean {
  const el = opts.container ?? map.getContainer?.() ?? null
  if (!el) return false
  const desired = opts.desired ?? centerOfFreeRect(el, opts.overlays ?? [])
  const view = readViewport(map, el)
  const p = projectToPixel({ lng: point.lng, lat: point.lat }, view)
  const dx = desired.x - p.x
  const dy = desired.y - p.y
  // 已经在目标附近（±24px）就不动 —— 用户可能就是故意摆在那个位置的
  if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return false

  /*
   * 反投影：把"中心的世界像素"加上**同样的位移的相反数**，再换回经纬度。
   * ★ 符号：点在屏幕上的位置 = world(点) − world(中心) + 容器半宽 ——
   *   要让点的屏幕位置 +d，中心的 world 必须是 **−d**
   *   （第一版加成 +d，点被挪到屏幕外面对角去 —— 是探针算出「点的容器像素 y=−108」才抓到的）。
   */
  const size = 256 * 2 ** view.zoom
  const lng = lngOf(worldX(view.centerLng, size) - dx, size)
  const lat = latOf(worldY(view.centerLat, size) - dy, size)

  map.setCenter(new TMap.LatLng(lat, lng), { duration: FLY_DURATION_MS.drill })
  writeProbe(lng, lat, view.zoom, dx, dy)
  return true
}

/**
 * 把某个点以**指定缩放**放到可视区中心 —— 一次动画里同时改缩放与中心。
 *
 * 「在行程里点一个站点，图上看它」用的就是它：用户点的是一条**具体的地点**，
 * 所以级别必须是确定的，不能由框大小反推（见文件头）。
 *
 * ★ 两次 SDK 调用在同一个 tick 里发出 —— 腾讯会把它们合成**一次**动画。
 *   分两段串起来（先平移、到位后再缩放）会变成两倍时长，而且中间那帧很难看。
 */
export function focusPointTo(
  map: TMap.Map,
  point: LatLngLike,
  zoom: number,
  opts: { container?: HTMLElement | null; overlays?: Array<HTMLElement | null> } = {},
): boolean {
  const el = opts.container ?? map.getContainer?.() ?? null
  if (!el) return false

  const desired = centerOfFreeRect(el, opts.overlays ?? [])
  const size = 256 * 2 ** zoom
  // world_z(中心) = world_z(点) − (目标像素 − 容器中心)
  const lng = lngOf(worldX(point.lng, size) - (desired.x - el.clientWidth / 2), size)
  const lat = latOf(worldY(point.lat, size) - (desired.y - el.clientHeight / 2), size)

  map.setZoom(zoom, { duration: FLY_DURATION_MS.drill })
  map.setCenter(new TMap.LatLng(lat, lng), { duration: FLY_DURATION_MS.drill })
  writeProbe(lng, lat, zoom, desired.x - el.clientWidth / 2, desired.y - el.clientHeight / 2)
  return true
}
