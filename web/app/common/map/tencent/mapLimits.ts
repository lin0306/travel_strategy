/**
 * 地图的**伸缩与拖拽边界** —— 「能缩多小、能拖到哪」的唯一出处。
 *
 * ## 为什么要单独管这件事（2026-11-18 用户定）
 * 用户原话：「还需要限定缩放大小和可拖拽的区域，手机端和 web 端的限制是不一样的，
 * 不能都统一用同一个」。两条都是**体验问题**，不是技术问题：
 * - 缩得比"刚好装下全国"还小，中国会变成屏幕中间一小块，周围全是海 —— 看不出任何东西；
 * - 拖到西伯利亚或太平洋中间，屏幕上没有一个中国城市，用户会以为自己迷路了。
 *
 * ## 为什么两端必须分开（不是凑数）
 * 同一个 `zoom` 在两端看到的**范围完全不同**：1440×900 装下全国要 z≈4.57，
 * 390×844 竖屏要装下南海只需 z≈**3.04**（实测，首页 fit 后读数）。
 * 用一个统一值的话：取 4.2 ⇒ 手机根本到不了自己的全国视角（一进首页就被卡住）；
 * 取 3.0 ⇒ 桌面能缩到"中国只占半屏"，上面那条问题原样复现。
 * ⇒ 所以下限不是写死的数，而是「**当前容器下装下全国所需的缩放 − 端专属余量**」，
 *   由 `minZoomOf(map, limits)` 现算 —— 窗口 resize、换端都自动跟上。
 *
 * ## 为什么不用 `setBoundary`（踩过）
 * 腾讯有 `map.setBoundary(bounds)`，实测（`_tmp/probe_boundary.mjs`）它的语义是
 * **"视野不许超出"**：设成中国框后，桌面首页的 z 被从 4.574 强行推到 **5.018**
 * —— 也就是"装不下就自己放大"。而这里要的恰恰相反：低缩放**必须**看得到全中国。
 * ⇒ 边界改成自己钳**中心点**（`clampCenter`），视野大小不管，位置不许出框。
 *
 * ⚠️ 中心范围必须**盖住每一个有景点的城市**（三亚 18.2°N / 喀什 76.0°E）——
 *   钳得太紧会在点城市时把镜头推开几十公里，而那看起来就像"点错了地方"。
 */

import { debugLog } from '~/common/logic/debugLog'

import { NATIONAL_FIT_CORNERS, NATIONAL_VIEW, boundsOf } from './fitView'

/**
 * 允许的**地图中心**范围（不是视野范围 —— 理由见文件头）。
 *
 * 判据是"有景点的国土"：西到喀什（76.0°E）、东到抚远（134.3°E）、
 * 南到三沙（16.8°N）、北到漠河（53.5°N），四周各留一点余量。
 *
 * ⚠️ 这是**取景**用的近似框，不是行政边界 —— 边界只能来自腾讯 District 服务
 *    （见 `districtLayer.ts` 的合规红线）。
 */
export interface MapLimits {
  /** 相对「刚好装下全国」还能再缩多少档。桌面视野宽、需要更紧；手机窄、放宽一点 */
  zoomOutSlack: number
  /** 缩放上限（腾讯引擎上限是 20，这里不放到 20 —— 再近只剩一个屋顶） */
  maxZoom: number
  /** 允许的中心范围 */
  center: {
    lng: readonly [number, number]
    lat: readonly [number, number]
  }
}

/**
 * 两端的限制表。
 *
 * | | 缩放下限 | 缩放上限 | 中心经度 | 中心纬度 |
 * |---|---|---|---|---|
 * | 桌面 | 全国 fit − **0.35** | 18 | 73.5 ~ 135.5 | 14 ~ 48 |
 * | 移动 | 全国 fit − **0.60** | 17 | 71 ~ 138 | 8 ~ 50 |
 *
 * ★ 移动端的余量更大、范围更宽：竖屏装下全国本来就更勉强（fit 3.04 已经贴着引擎
 *   下限 3），再收 0.6 也只是"刚好不能缩"。而窄屏看同一片区域需要更大的活动量，
 *   所以中心框给宽一点 —— 两条都不是随手写的数，改之前先重跑 `_tmp/probe_limits.mjs`。
 */
export const MAP_LIMITS: Readonly<Record<'desktop' | 'mobile', MapLimits>> = {
  desktop: {
    zoomOutSlack: 0.35,
    maxZoom: 18,
    center: { lng: [73.5, 135.5], lat: [14, 48] },
  },
  mobile: {
    zoomOutSlack: 0.6,
    maxZoom: 17,
    center: { lng: [71, 138], lat: [8, 50] },
  },
}

/** 按端取限制表（`useIsMobile` 的结论直接传进来） */
export function mapLimitsFor(isMobile: boolean): MapLimits {
  return isMobile ? MAP_LIMITS.mobile : MAP_LIMITS.desktop
}

/**
 * 中心点越界就给出修正值，没越界返回 `null`。
 *
 * 返回 `null` 而不是原值，是为了让调用方**一次比较就知道要不要动地图** ——
 * 每次手势结束都 `setCenter` 一遍会打断惯性滑动，而且会持续触发 `center_changed`
 * （自己喂自己，日志里能刷出几百行）。
 */
export function clampCenter(
  c: { lng: number; lat: number },
  limits: MapLimits,
): { lng: number; lat: number } | null {
  const lng = clamp(c.lng, limits.center.lng[0], limits.center.lng[1])
  const lat = clamp(c.lat, limits.center.lat[0], limits.center.lat[1])
  return lng === c.lng && lat === c.lat ? null : { lng, lat }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * 当前容器下的**缩放下限** = 「装下全国要多少」− 端专属余量。
 *
 * 用引擎自己的 `getZoomByBounds` 算，不自己推 Mercator：它已经把 padding、
 * 容器尺寸、经纬度比例一起算进去了（实测存在，见 `tmap.d.ts`）。
 * 取不到时退 `NATIONAL_VIEW.zoom`（引擎初始值，与首页首帧一致），不会崩。
 */
export function minZoomOf(map: TMap.Map, limits: MapLimits): number {
  const box = boundsOf(NATIONAL_FIT_CORNERS)
  const fit =
    box && typeof map.getZoomByBounds === 'function'
      ? map.getZoomByBounds(box)
      : NATIONAL_VIEW.zoom
  // 腾讯缩放范围下限是 3（不是 2，也不是 22）
  return Math.max(3, fit - limits.zoomOutSlack)
}

/**
 * 把限制**落到地图上**：重算下限、设上下限、必要时把当前缩放抬到下限。
 * 调用时机由 `attachLimits` 统一管（建图后 + resize），不放进渲染路径。
 */
export function applyLimits(map: TMap.Map, limits: MapLimits): void {
  const minZ = minZoomOf(map, limits)
  map.setMinZoom?.(minZ)
  map.setMaxZoom?.(limits.maxZoom)
  // 恢复出来的旧视野可能比新下限还小 —— 抬到下限，否则一进页面就是一片海
  if (map.getZoom() < minZ) map.setZoom(minZ)
  debugLog(
    '规则',
    `缩放限制 z∈[${minZ.toFixed(2)}, ${limits.maxZoom}] · 中心框 ` +
      `lng ${limits.center.lng.join('~')} / lat ${limits.center.lat.join('~')}`,
  )
}

/**
 * 中心点越界就拉回，返回"是否动过地图"。
 *
 * ★ 调用点是 `viewportEmitter` 的广播前（手势停稳那一刻）：拖出框的那一帧视野
 *   没有任何意义，铺一次内容再拉回等于白铺两遍（用户看到"内容闪了一下又跑掉"）。
 *   所以越界时**不广播**，`setCenter` 会再触发一轮 move，那时中心已在框内。
 * ★ 不在拖动过程中逐帧调：那会把惯性滑动打断成一跳一跳的。
 */
export function clampMapCenter(map: TMap.Map, limits: MapLimits): boolean {
  const c = map.getCenter()
  const fixed = clampCenter({ lng: c.getLng(), lat: c.getLat() }, limits)
  if (!fixed) return false
  debugLog('边界', `中心越界 → 拉回 (${fixed.lng.toFixed(2)}, ${fixed.lat.toFixed(2)})`)
  map.setCenter(new TMap.LatLng(fixed.lat, fixed.lng))
  return true
}

/**
 * 建图后挂上限制，并随窗口尺寸自动重算；返回解绑函数。
 *
 * ★ resize 必须重算：窗口从 1440 拉到 1920，同一个 zoom 看到的地盘变宽，
 *   原来的下限就偏松了（用户又能缩到"中国只剩半屏"）。
 * ★ `getLimits` 是现取的函数而不是值 —— 换端（移动 ↔ 桌面）后要跟着换，
 *   这个监听不该因此重挂。
 */
export function attachLimits(map: TMap.Map, getLimits: () => MapLimits): () => void {
  const sync = () => applyLimits(map, getLimits())
  sync()
  window.addEventListener('resize', sync)
  return () => window.removeEventListener('resize', sync)
}
