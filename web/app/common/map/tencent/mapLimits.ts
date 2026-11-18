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
 * ## 为什么**必须**用 `setBoundary`（2026-11-18 第二次返工）
 * 第一版只在自己这边的「手势停稳 120ms」里钳中心（`clampMapCenter`）。实测
 * （`_tmp/probe_limit_path.mjs`）程序 `setCenter` 与触摸拖拽都能被拉回 ——
 * 但用户仍然说「我现在都能直接拖拽到美国和南北极去了」。
 * 原因：**手指一直按着拖，就永远没有"停稳"那一刻**，120ms 的钳制从头到尾不触发，
 * 画面于是一路滑到美洲；松手后才弹回中国。钳制位置对了，但**时机**错了 ——
 * 而"拖动过程中不许出去"只有引擎自己拦得住。
 *
 * ★ `setBoundary` 的语义是「**视野**不许超出 boundary」（实测），
 *   所以直接设成"中国框"会把桌面首页的 z 从 4.574 顶到 5.018（装不下就自己放大）。
 *   ⇒ 正确用法是**每档缩放现算**边界框：
 *       视野允许框 = 允许的中心框 ± 半个当前视野
 *     于是「视野 ⊆ 允许框」恰好等价于「中心 ∈ 中心框」，且框永远装得下视野、
 *     永远不会触发引擎放大。放大后边界自动收紧，缩小后自动放宽 —— 不需要分支。
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
 * 每张地图**实测到的**缩放地板（首页取景停稳那一刻的 zoom）。
 *
 * ## 为什么不能只靠 `minZoomOf` 的"fit − 余量"
 * `getZoomByBounds`（无 padding）比真实的 `fitBounds`（避让浮层、带 8% 留白）
 * 大 0.1 档左右。为了保证首页能取到景，`zoomOutSlack` 必须留出这个差 ——
 * 结果是用户还能再缩 0.35 档（视野大 27%），"框住中国"就又松了一圈。
 * ⇒ 取景停稳时把**真实值**记下来，用它当地板（比算出来的紧、又绝不会打架）。
 *
 * ★ 只在"接近全国那一档"的取景才记（`NEAR_NATIONAL`）：否则从城市页刷新进来时，
 *   城市 fit（z10+）会被记成地板，用户再也缩不回全国。
 */
const fitFloor = new WeakMap<TMap.Map, number>()
const NEAR_NATIONAL = 0.5

/**
 * 当前容器下的**缩放下限** = 「装下全国要多少」− 端专属余量
 * （若首页取景已停稳，则取那个**实测值**，它更紧）。
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
  return Math.max(3, fit - limits.zoomOutSlack, fitFloor.get(map) ?? 0)
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
 * 当前 `zoom` 下的**半视野**（度）—— 直接从引擎的 `getBounds()` 反读。
 *
 * ★ 不自己推 Mercator：同一 zoom 下横竖比例、容器尺寸、纬度非线性都被引擎算过了，
 *   自己算一遍只会与它差一点，而这点差会变成"边界有时松有时紧"。
 */
function halfSpanOf(map: TMap.Map): { lng: number; lat: number } | null {
  if (typeof map.getBounds !== 'function') return null
  const b = map.getBounds()
  const sw = b.getSouthWest()
  const ne = b.getNorthEast()
  return {
    lng: Math.abs(ne.getLng() - sw.getLng()) / 2,
    lat: Math.abs(ne.getLat() - sw.getLat()) / 2,
  }
}

/**
 * 把「允许的中心框」翻译成引擎能懂的边界：**允许的视野框 = 中心框 ± 半视野**。
 *
 * 这是整个拖拽限制的**唯一落点** —— 调用一次，拖动、惯性、双击、键盘平移
 * 全部被引擎拦在框内，不再依赖"停手 120ms"那个永远不会到来的时机。
 *
 * ## 半视野取「最小缩放那一档」，**不随当前 zoom 变**
 * 直观想法是每档缩放现算（放大后收紧），但它有一个静默死角：
 * `fitBounds` 是**动画**，动画中途 `getBounds()` 读到的是中间值，收紧后的边界
 * 会把动画本身顶住 —— 从城市页回首页时"视野想变大、边界不让"，引擎只能把
 * zoom 往上推，于是首页再也看不到全中国（正是 `setBoundary` 那个 5.018 陷阱）。
 * ⇒ 用**最宽的视野**（= 缩放下限那一档）算一次，边界于是固定：
 *   低缩放时它恰好包住全中国，放大后中心仍只能走到中心框边界。
 *   这正是用户要的语义（「框死在中国境内」），而且与 fit 动画永不冲突。
 *
 * ★ `setBoundary` 标可选：SDK 没有它时退化成"只有停稳后钳中心"（旧行为，不崩）。
 */
export function syncBoundary(map: TMap.Map, limits: MapLimits, fitZoom?: number): void {
  // 取景停稳时顺手把**实测地板**记下来（见 `fitFloor` 的注释）
  if (fitZoom !== undefined && fitZoom <= minZoomOf(map, limits) + NEAR_NATIONAL) {
    const prev = fitFloor.get(map)
    const next = prev === undefined ? fitZoom : Math.min(prev, fitZoom)
    fitFloor.set(map, next)
    map.setMinZoom?.(next)
  }
  if (typeof map.setBoundary !== 'function') return
  const half = halfSpanOf(map)
  if (!half) return
  // 当前视野 → 缩放下限那一档的视野：z 越小视野越大，跨度与 2^z 成反比
  const shrink = Math.pow(2, map.getZoom() - minZoomOf(map, limits))
  // 2% 余量：浮点误差会让"正好相等"被判越界，引擎随后反复 push zoom
  const PAD = 1.02
  const hl = half.lng * shrink * PAD
  const hb = half.lat * shrink * PAD
  // ⚠️ 腾讯是 LatLng(lat, lng) —— 纬度在前
  map.setBoundary(
    new TMap.LatLngBounds(
      new TMap.LatLng(limits.center.lat[0] - hb, limits.center.lng[0] - hl),
      new TMap.LatLng(limits.center.lat[1] + hb, limits.center.lng[1] + hl),
    ),
  )
}

/**
 * 建图后挂上限制，并随窗口尺寸自动重算；返回解绑函数。
 *
 * ★ resize 必须重算：窗口从 1440 拉到 1920，同一个 zoom 看到的地盘变宽，
 *   原来的下限就偏松了（用户又能缩到"中国只剩半屏"）。
 * ★ 不监听 `zoom`：边界取的是**最宽那一档**的视野（见 `syncBoundary`），
 *   与当前缩放无关 ⇒ 不用重算，也就不可能在 fit 动画途中把镜头顶住。
 * ★ `getLimits` 是现取的函数而不是值 —— 换端（移动 ↔ 桌面）后要跟着换，
 *   这个监听不该因此重挂。
 */
export function attachLimits(map: TMap.Map, getLimits: () => MapLimits): () => void {
  const onResize = () => {
    const lim = getLimits()
    applyLimits(map, lim)
    // resize 后视野是终值（没有动画在跑），重算边界安全
    syncBoundary(map, lim)
  }
  // ★ 建图时只设缩放上下限，**不**挂边界：那一刻还在引擎的初始 3.6 档，
  //   `getBounds()` 读到的是那个大视野，算出来的框会与首页 fit 的目标打架
  //   （实测首页从 4.574 掉到 4.33、中心退回 `NATIONAL_VIEW.center`）。
  //   边界由第一次取景停稳后挂 —— 见 `useTMap` 的 `kind === 'fit'` 分支。
  applyLimits(map, getLimits())
  window.addEventListener('resize', onResize)
  return () => window.removeEventListener('resize', onResize)
}
