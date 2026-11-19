/**
 * 地图的**伸缩与拖拽边界** —— 「能缩多小、能拖到哪」的唯一出处。
 *
 * ## 为什么要单独管（2026-11-18 用户定）
 * 「限定缩放大小和可拖拽的区域，手机端和 web 端的不一样」。两条都是体验问题：
 * 缩得比"刚好装下全国"还小 ⇒ 中国变屏幕中间一小块；拖到太平洋 ⇒ 屏幕上一个城市都没有。
 *
 * ## 两端必须分开（不是凑数）
 * 同一个 `zoom` 两端看到的范围完全不同：1440×900 装下全国要 z≈4.57，
 * 390×844 竖屏只要 z≈**3.04**（实测）。统一取 4.2 ⇒ 手机到不了自己的全国视角；
 * 取 3.0 ⇒ 桌面能缩到"中国只占半屏"。⇒ 下限由 `minZoomOf` 现算（fit − 端专属余量）。
 *
 * ## 必须用 `setBoundary`（2026-11-18 第二次返工）
 * 第一版只在自己这边的「手势停稳 120ms」里钳中心 —— 但**手指一直按着拖就永远没有
 * 停稳那一刻**，画面于是一路滑到美洲、松手才弹回。钳制位置对了，**时机**错了：
 * "拖动过程中不许出去"只有引擎自己拦得住。
 *
 * ★ `setBoundary` 的语义是「**视野**不许超出 boundary」（实测），直接设成"中国框"会把
 *   桌面首页从 4.574 顶到 5.018（装不下就自己放大）⇒ 边界 = 中心框 ± 半视野，
 *   分 `tight`/`floor` 两档（见 `boundarySpan`）：最宽档视野比中心框还宽，
 *   缩小途中必须用 floor，否则会被自己顶住。
 *
 * ⚠️ 中心范围必须**盖住每一个有景点的城市**（三亚 18.2°N / 喀什 76.0°E）——
 *   钳得太紧会在点城市时把镜头推开几十公里，那看起来就像"点错了地方"。
 */

import { debugLog } from '~/common/logic/debugLog'

import { NATIONAL_FIT_CORNERS, NATIONAL_VIEW, boundsOf } from './fitView'
import { attachDragBrake } from './dragBrake'

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
  let fit = NATIONAL_VIEW.zoom
  if (box && typeof map.getZoomByBounds === 'function') {
    // ★ 引擎**未就绪时会抛**（`getBounds()` 同时期返回 null）。不接住的话，
    //   调用链会一路断掉且不留任何日志 —— 2026-11-19 移动端首屏就是这样：
    //   边界一次都没挂上，看起来像"忘了调用"。
    try {
      const z = map.getZoomByBounds(box)
      if (Number.isFinite(z) && z > 0) fit = z
    } catch {
      /* 未就绪：退 `NATIONAL_VIEW.zoom`，下一次广播会再算 */
    }
  }
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
 * ## ★ 判据与边界同源（2026-11-19 修「松手回弹」）
 * 用户：「拖拽超过边界了，松手后会自动回弹 —— 应该拖到边界就不许再拖」。
 * 旧代码用 `clampCenter`（中心 ∈ 中心框）判断，而引擎允许中心走到「框边 − 半视野」，
 * 两者差半个视野 ⇒ 拖动放过一屏、松手又拽回来。现在统一走 `centerRangeOf`，
 * 拖拽停稳时中心本来就在里面 ⇒ **回弹消失**，只在程序性 `setCenter` 越界时兜底。
 * ★ 越界时**不广播**（`setCenter` 会再触发一轮 move）；不在拖动中逐帧调（引擎自己就是硬钳）。
 */
export function clampMapCenter(map: TMap.Map, limits: MapLimits): boolean {
  const range = centerRangeOf(map, limits)
  if (!range) return false
  const c = map.getCenter()
  const lng = clamp(c.getLng(), range.lng[0], range.lng[1])
  const lat = clamp(c.getLat(), range.lat[0], range.lat[1])
  if (lng === c.getLng() && lat === c.getLat()) return false
  debugLog('边界', `中心越界 → 拉回 (${lng.toFixed(2)}, ${lat.toFixed(2)})`)
  map.setCenter(new TMap.LatLng(lat, lng))
  return true
}

/**
 * 当前 `zoom` 下的**半视野**（度）—— 优先从引擎的 `getBounds()` 反读。
 * ★ 不自己推 Mercator：横竖比例、容器尺寸、纬度非线性都被引擎算过了，自己算会差一点。
 */
function halfSpanOf(map: TMap.Map): { lng: number; lat: number } | null {
  if (typeof map.getBounds === 'function') {
    // ★ 引擎未就绪时这里是**抛异常**（不是返回 null）—— 2026-11-19 移动端首屏实测：
    //   `getBounds()` 抛 ⇒ `syncBoundary` 整个中断 ⇒ 边界一次都没挂上，且不留日志。
    try {
      const b = map.getBounds()
      if (b) {
        const sw = b.getSouthWest()
        const ne = b.getNorthEast()
        return {
          lng: Math.abs(ne.getLng() - sw.getLng()) / 2,
          lat: Math.abs(ne.getLat() - sw.getLat()) / 2,
        }
      }
    } catch {
      /* 落到下面的自算兜底 */
    }
  }
  return estimateHalfSpan(map)
}

/**
 * 引擎给不出 `getBounds()` 时，用**容器尺寸 + 中心 + 缩放**自己算半视野。
 *
 * ★ 为什么需要：移动端首屏实测 `getBounds()` 在取景停稳后**连等 60 帧（≈1 秒）
 *   都不可用**（会抛异常），10 秒后才正常 —— 那段时间地图是完全没有边界的。
 *   公式与引擎同一条墨卡托（与 `_tmp` 的投影探针一致），误差由 `PAD` 吸收。
 * ★ 只在兜底路径用：正常路径仍读引擎，避免"边界有时松有时紧"。
 */
function estimateHalfSpan(map: TMap.Map): { lng: number; lat: number } | null {
  const mercY = (lat: number, world: number): number => {
    const s = Math.sin((lat * Math.PI) / 180)
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * world
  }
  const invMerc = (y: number, world: number): number =>
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / world))) * 180) / Math.PI
  try {
    const el = map.getContainer?.()
    const w = el?.clientWidth ?? 0
    const h = el?.clientHeight ?? 0
    const z = map.getZoom()
    const c = map.getCenter()
    if (w <= 0 || h <= 0 || !Number.isFinite(z)) return null
    const world = 256 * Math.pow(2, z)
    const my = mercY(c.getLat(), world)
    return {
      lng: ((w / 2) / world) * 360,
      lat: Math.abs(invMerc(my + h / 2, world) - invMerc(my - h / 2, world)) / 2,
    }
  } catch {
    return null
  }
}

/**
 * 边界的**半跨度**（度）+ 当前视野：`tight`（当前视野）与 `floor`（缩放下限档）。
 *
 * 只用 `tight` 会让**缩小被自己顶住**：z12 时边界只 62.4° 宽，回首页要 85.8° 视野，
 * 引擎判装不下就把 zoom 推回去（实测卡在 4.85，看不到完整中国）。
 * 只用 `floor` 又会让**放大后太松**：z12 允许中心拖到东经 30°，屏幕上一个城市都没有
 * —— 用户说的「拖拽超过边界」就是这个。
 * ⇒ 放大停稳后用 `tight`（拖到头就是中国边界），缩小每帧用 `floor`（缩得回去）。
 *   调用点：`useTMap`（停稳）+ `attachLimits`（缩小途中）。
 * ★ 2% 余量（`PAD`）：浮点误差会让"正好相等"被判越界，引擎随后反复 push zoom。
 */
function boundarySpan(
  map: TMap.Map,
  limits: MapLimits,
): { tight: Span; floor: Span; view: Span } | null {
  const half = halfSpanOf(map)
  if (!half) return null
  const PAD = 1.02
  // 当前视野 → 缩放下限那一档的视野：z 越小视野越大，跨度与 2^z 成反比
  const shrink = Math.pow(2, map.getZoom() - minZoomOf(map, limits))
  return {
    tight: { lng: half.lng * PAD, lat: half.lat * PAD },
    floor: { lng: half.lng * shrink * PAD, lat: half.lat * shrink * PAD },
    view: { lng: half.lng, lat: half.lat },
  }
}

interface Span {
  lng: number
  lat: number
}

/**
 * 当前**允许的中心范围** —— 与 `tight` 边界同源：边界框 = `中心框 ± tight`，
 * 中心范围 = 边界框内缩**当前视野** ⇒ 恰好就是 `limits.center`。
 * 拖到中心框就停住，既不越界也不回弹。拿不到视野时返回 `null`（调用方不动地图）。
 */
export function centerRangeOf(
  map: TMap.Map,
  limits: MapLimits,
): { lng: readonly [number, number]; lat: readonly [number, number] } | null {
  if (!boundarySpan(map, limits)) return null
  return { lng: limits.center.lng, lat: limits.center.lat }
}

/**
 * 把「允许的中心框」翻译成引擎能懂的边界：**允许的视野框 = 中心框 ± 半视野**。
 *
 * 这是整个拖拽限制的**唯一落点** —— 调用一次，拖动、惯性、双击、键盘平移
 * 全部被引擎拦在框内，不再依赖"停手 120ms"那个永远不会到来的时机。
 *
 * ## 半视野取「缩放下限那一档」，与当前 zoom 无关
 * 理由见 `boundarySpan`（取当前视野会把缩放下限顶住）。这边只说结论：
 * 边界**固定**，`setBoundary` 一次就够，不需要随缩放重算，
 * 也就不可能在 fit 动画途中把镜头顶住（那个 5.018 陷阱的前提是"视野比边界还大"）。
 *
 * ★ 用户真正抱怨的「拖出去又回弹」不在这一层：引擎一直是硬钳的（实测拖 700px
 *   只走 418px 就停住）。回弹来自 `clampMapCenter` 用了另一套更紧的判据，
 *   现已改成与这里同源（`centerRangeOf`）。
 *
 * ★ `setBoundary` 标可选：SDK 没有它时退化成"只有停稳后钳中心"（旧行为，不崩）。
 */
export function syncBoundary(
  map: TMap.Map,
  limits: MapLimits,
  fitZoom?: number,
  /** `true` = 用最宽档（缩小途中，保证装得下）；默认 `false` = 当前视野（停稳后收紧） */
  loose = false,
): boolean {
  // 取景停稳时顺手把**实测地板**记下来（见 `fitFloor` 的注释）
  if (fitZoom !== undefined && fitZoom <= minZoomOf(map, limits) + NEAR_NATIONAL) {
    const prev = fitFloor.get(map)
    const next = prev === undefined ? fitZoom : Math.min(prev, fitZoom)
    fitFloor.set(map, next)
    map.setMinZoom?.(next)
  }
  if (typeof map.setBoundary !== 'function') return false
  const span = boundarySpan(map, limits)
  // ★ 返回 `false` 不一定是"不用挂"：`getBounds()` 在取景动画刚停稳的那一帧
  //   可能还是 `null`/抛异常（实测移动端首屏就是这样）。调用方据此补帧重试。
  if (!span) return false
  const use = loose ? span.floor : span.tight
  try {
    // ⚠️ 腾讯是 LatLng(lat, lng) —— 纬度在前
    map.setBoundary(
      new TMap.LatLngBounds(
        new TMap.LatLng(limits.center.lat[0] - use.lat, limits.center.lng[0] - use.lng),
        new TMap.LatLng(limits.center.lat[1] + use.lat, limits.center.lng[1] + use.lng),
      ),
    )
  } catch {
    // 引擎正在重建/销毁时 setBoundary 会抛 —— 交给 `syncBoundaryWhenReady` 重试
    return false
  }
  return true
}

/**
 * 挂边界，直到引擎真的给出视野为止（最多等 `tries` 帧）。
 *
 * ## 为什么要"等"
 * 取景动画停稳 ≠ 引擎已就绪：移动端首屏实测（`_tmp/probe_boundary_when.mjs`，
 * 给 `setBoundary` 打点）**一次都没被调到** —— 那一刻 `getBounds()` 还是 `null`，
 * 而 10 秒后它是正常的。桌面端同一时刻就有值，所以这个坑只在手机上出现，
 * 表现是"整张地图没有边界，能一路拖走"，且**零报错**。
 *
 * 补一帧不够（首帧仍可能为 null），所以按帧重试；上限 60 帧（≈1 秒），
 * 到点放弃 —— 不做无限循环，否则会和 fit 动画互相喂。
 */
export function syncBoundaryWhenReady(
  map: TMap.Map,
  limits: MapLimits,
  fitZoom?: number,
  loose = false,
  tries = 60,
): void {
  if (syncBoundary(map, limits, fitZoom, loose)) {
    debugLog('边界', `引擎边界已挂  z=${map.getZoom().toFixed(2)}${loose ? '（放宽档）' : ''}`)
    return
  }
  if (tries >= 60) debugLog('边界', '取景停稳，但这一帧还拿不到视野 → 逐帧重试')
  if (tries <= 0) {
    debugLog('边界', '等满 60 帧仍拿不到视野 —— 这张地图没有边界')
    return
  }
  requestAnimationFrame(() => {
    // 地图已销毁（`destroy()` 之后 `getContainer()` 给 null）就别再碰它
    if (!map.getContainer?.()) return
    syncBoundaryWhenReady(map, limits, fitZoom, loose, tries - 1)
  })
}

/**
 * 建图后挂上限制，并随窗口尺寸自动重算；返回解绑函数。
 *
 * ★ resize 必须重算：窗口从 1440 拉到 1920，同一个 zoom 看到的地盘变宽，
 *   原来的下限就偏松了（用户又能缩到"中国只剩半屏"）。
 * ★ 这里**不监听 `zoom`**：边界固定（见 `boundarySpan`），与当前缩放无关 ⇒ 不用重算，
 *   也就不可能在 fit 动画途中把镜头顶住。
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
  /**
   * ★ **缩小途中必须放宽**（2026-11-19 实测）：边界收紧到当前视野后，
   * 缩小意味着视野要变大，而边界还停在小档 ⇒ 引擎判"装不下"⇒ 把 zoom 顶回去。
   * 实测从 z12 缩回首页只到 **z4.85**（首页是 4.39），看不到完整中国，且不报错。
   * 所以每帧放宽；放大方向不在这里管（视野变小，原边界天然装得下），
   * 停稳后由 `useTMap` 的广播收紧。
   */
  let lastZoom = map.getZoom()
  const onZoom = () => {
    const z = map.getZoom()
    if (z < lastZoom - 1e-6) syncBoundary(map, getLimits(), undefined, true)
    lastZoom = z
  }
  map.on('zoom', onZoom)
  // ★ 建图时只设缩放上下限，**不**挂边界：那一刻还在引擎的初始 3.6 档，
  //   `getBounds()` 读到的是那个大视野，算出来的框会与首页 fit 的目标打架
  //   （实测首页从 4.574 掉到 4.33、中心退回 `NATIONAL_VIEW.center`）。
  //   边界由第一次取景停稳后挂 —— 见 `useTMap` 的 `kind === 'fit'` 分支。
  applyLimits(map, getLimits())
  // 拖拽刹车（抬手即停）跟边界是同一件事的两半：一个管"能到哪"，一个管"什么时候停"。
  // 挂在这里是因为它必须**一图一份**，而 `attachLimits` 正好是那个唯一的建图后挂载点。
  const detachBrake = attachDragBrake(map)
  window.addEventListener('resize', onResize)
  return () => {
    window.removeEventListener('resize', onResize)
    map.off('zoom', onZoom)
    detachBrake()
  }
}
