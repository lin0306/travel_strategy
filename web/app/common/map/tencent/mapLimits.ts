/**
 * 地图的**伸缩与拖拽边界** —— 「能缩多小、拖到哪」的唯一出处。
 *
 * ## 两条必须用 `setBoundary`（2026-11-18 起多次返工）
 * 只在自己的「手势停稳 120ms」里钳中心不够：**手指一直按着拖就永远没有停稳那一刻**，
 * 画面一路滑出去、松手才弹回。只有引擎自己拦得住，所以边界要落到 `setBoundary`。
 *
 * ## 语义是「**视野**不出框」，不是「中心不出框」
 * 所以边界框 = 中心框向外扩「中心到四边的距离」。**四边必须分开算** ——
 * 墨卡托纬度非线性，竖屏 z3.04 视野南跨 66.8°、北跨只有 33.8°；
 * 用对称半跨会把北边界算到 100.3° ⇒ 引擎抛「lat 应在 [−90,90]」⇒ 整条边界失效
 * （能拖到西经 179°，松手再被拽回 —— 2026-11-20 用户报的"中心被重置"就是它）。
 *
 * ⚠️ 中心范围必须**盖住每一个有景点的城市**（三亚 18.2°N / 喀什 76.0°E）——
 *   钳太紧会在点城市时把镜头推开几十公里，看起来像"点错了地方"。
 */

import { debugLog } from '~/common/logic/debugLog'

import { NATIONAL_FIT_CORNERS, NATIONAL_VIEW, boundsOf } from './fitView'
import { attachDragBrake } from './dragBrake'

/**
 * 允许的**地图中心**范围（不是视野范围）。判据是"有景点的国土"：
 * 西喀什 76.0°E、东抚远 134.3°E、南三沙 16.8°N、北漠河 53.5°N，四周留余量。
 * ⚠️ 取景用的近似框，**不是行政边界**（边界只能来自腾讯 District，见合规红线）。
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
 * | | 缩放下限 | 上限 | 中心经度 | 中心纬度 |
 * |---|---|---|---|---|
 * | 桌面 | 全国 fit − **0.35** | 18 | 84 ~ 125 | 22 ~ 42 |
 * | 移动 | 全国 fit − **0.60** | 17 | 82 ~ 128 | 16 ~ 44 |
 * 移动端更宽松是必须的：竖屏 fit 3.04 已贴着引擎下限 3。改之前先跑 `_tmp/probe_limits.mjs`。
 *
 * ★ 中心框**不是**国境线（2026-11-21 用户「范围太大，缩小一点」）：框约束的是
 * 「屏幕中心能到哪」，而首页缩放档的视野本身比中国还宽（桌面约 96°、移动约 67°），
 * 中心贴着国境线时屏幕上是一整屏境外/洋面。收到「中国主体」才符合直觉。
 */
export const MAP_LIMITS: Readonly<Record<'desktop' | 'mobile', MapLimits>> = {
  desktop: {
    zoomOutSlack: 0.35,
    maxZoom: 18,
    center: { lng: [84, 125], lat: [22, 42] },
  },
  mobile: {
    zoomOutSlack: 0.6,
    maxZoom: 17,
    center: { lng: [82, 128], lat: [16, 44] },
  },
}

/** 按端取限制表（`useIsMobile` 的结论直接传进来） */
export function mapLimitsFor(isMobile: boolean): MapLimits {
  return isMobile ? MAP_LIMITS.mobile : MAP_LIMITS.desktop
}

/**
 * 每张地图**实测到的**缩放地板（首页取景停稳那一刻的 zoom）。
 *
 * `getZoomByBounds` 比真实 `fitBounds`（带浮层避让与 8% 留白）大约 0.1 档，
 * 所以 `zoomOutSlack` 留着那点差 ⇒ 用户还能再缩 0.35 档、框又松一圈。
 * 取实测值当地板：比算出来的紧，又绝不与首页取景打架。
 * ★ 只记"接近全国"那一档（`NEAR_NATIONAL`），否则从城市页刷新进来会锁死缩放。
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

/** 把限制**落到地图上**（建图后 + resize 由 `attachLimits` 统一调，不进渲染路径）。 */
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
 * 当前视野的**四至 + 中心**（引擎读数优先，拿不到就按墨卡托自算）。
 *
 * ★★ 必须是「四至」而不是「半视野」：墨卡托下纬度非线性，屏幕中心不在算术中点上。
 * 竖屏 z3.04 实测中心 41.68°，南跨 66.8°、北跨只有 33.8°；旧代码取均值 50.3°
 * 对称外扩 ⇒ 北边界 100.3° ⇒ 引擎抛「lat 应在 [−90,90]」⇒ **整张地图没有边界**，
 * 能拖到西经 179°，松手再被拽回 —— 用户报的"中心被重置"就是这条。
 */
interface ViewGeom {
  /** 西 / 东 / 南 / 北 四至（度） */
  w: number
  e: number
  s: number
  n: number
  /** 视野中心 —— 引擎的 `getCenter()`，**不是**四至的算术中点 */
  clng: number
  clat: number
}

const mercY = (lat: number, world: number): number => {
  const s = Math.sin((lat * Math.PI) / 180)
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * world
}
const invMerc = (y: number, world: number): number =>
  (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / world))) * 180) / Math.PI

function geomOf(map: TMap.Map): ViewGeom | null {
  try {
    const b = map.getBounds()
    const c = map.getCenter()
    if (b) {
      const sw = b.getSouthWest()
      const ne = b.getNorthEast()
      return {
        w: sw.getLng(), e: ne.getLng(), s: sw.getLat(), n: ne.getLat(),
        clng: c.getLng(), clat: c.getLat(),
      }
    }
  } catch {
    /* 引擎未就绪时 `getBounds()` 是**抛异常**（不是返回 null），落到下面自算 */
  }
  try {
    const el = map.getContainer?.()
    const w = el?.clientWidth ?? 0
    const h = el?.clientHeight ?? 0
    const z = map.getZoom()
    const c = map.getCenter()
    if (w <= 0 || h <= 0 || !Number.isFinite(z)) return null
    const world = 256 * Math.pow(2, z)
    const my = mercY(c.getLat(), world)
    const clng = c.getLng()
    return {
      w: clng - ((w / 2) / world) * 360,
      e: clng + ((w / 2) / world) * 360,
      s: invMerc(my + h / 2, world),
      n: invMerc(my - h / 2, world),
      clng,
      clat: c.getLat(),
    }
  } catch {
    return null
  }
}

/**
 * 边界框 = 中心框向外扩「中心到对应边的**真实**距离」。
 *
 * `loose` = 按缩放地板那一档的视野放宽（缩小途中用，否则会被自己的边界顶住、
 * 缩不回全国：实测卡在 z4.85）；放大停稳后用 `tight`。
 * 最后钳到引擎接受的经纬度（±180 / ±85）。
 */
function boundaryBox(
  map: TMap.Map,
  limits: MapLimits,
  loose: boolean,
): ViewGeom | null {
  const g = geomOf(map)
  if (!g) return null
  // 放宽档留 2%（缩小途中要让引擎确定装得下）；收紧档只留 0.5% ——
  // 它决定"能拖过中心框多少"，全国档 0.5% × 视野 ≈ 3px，肉眼不可见。
  // ★ `max(1, …)`：缩到地板以下时系数会 <1（边界比视野还窄）⇒ 引擎反过来 push zoom，
  //   于是"缩不回全国"。地板本身由 `setMinZoom` 兜住，这里只负责别自己顶自己。
  const scale = loose ? Math.max(1, Math.pow(2, map.getZoom() - minZoomOf(map, limits))) : 1
  const k = (loose ? 1.02 : 1.005) * scale
  const world = 256 * Math.pow(2, map.getZoom())
  /**
   * ★★ 纬度方向必须在**墨卡托 y 空间**里加减（2026-11-21 实测修正）。
   *
   * 在**纬度空间**直接 `limits.center.lat[1] + (g.n - g.clat)` 是错的：墨卡托非线性，
   * 同一个"视野北跨"在不同纬度下度数不一样（南京以北 25° 跨几屏，漠河以北只跨一屏）。
   * 实测移动端中心被拖到 **72.56°N** 而设计上限是 50°：框的 n 先被 `min(85,…)` 钳住，
   * 而中心一往北走、视野北跨就变小 ⇒ "允许的中心"跟着抬高 ⇒ 越拖越松，能一路拖到北极圈。
   *
   * 换成 y 空间后，`中心框北端 − 视野半高` 是常数，反算回的纬度**永远等于 50°**，
   * 与当前纬度、缩放、容器比例都无关。经度是线性的，照旧。
   */
  const yC = mercY(g.clat, world)
  const halfN = (yC - mercY(g.n, world)) * k
  const halfS = (mercY(g.s, world) - yC) * k
  return {
    w: Math.max(-180, limits.center.lng[0] - (g.clng - g.w) * k),
    e: Math.min(180, limits.center.lng[1] + (g.e - g.clng) * k),
    s: Math.max(-85, invMerc(mercY(limits.center.lat[0], world) + halfS, world)),
    n: Math.min(85, invMerc(mercY(limits.center.lat[1], world) - halfN, world)),
    clng: g.clng,
    clat: g.clat,
  }
}

/** 上一次挂边界失败的原因 —— 只给"最终放弃"那条日志用（不是状态机） */
let lastFail = ''

/**
 * 缩放停稳多久后把边界收紧到当前档（ms）。
 *
 * ★ 放大时必须收紧，否则**边界一直停在缩小那个档（宽）**：视野变小了、框还是大的，
 *   引擎于是放行"中心再往外走一屏"，用户能把地图拖出去半个中国；等别的判据
 *   （以前是 `clampMapCenter`）把它拽回来 —— 就是"拖到框外又弹回来"。
 *   220ms 比手势停稳（120ms）再留一点余量，避免与正在跑的缩放动画抢镜头。
 */
const ZOOM_SETTLE_MS = 220

/** 把中心框翻译成引擎边界：**视野框 = 中心框 ± 中心到四边的距离**。
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
  if (typeof map.setBoundary !== 'function') {
    lastFail = 'SDK 没有 setBoundary'
    return false
  }
  const box = boundaryBox(map, limits, loose)
  // ★ 返回 `false` 不一定是"不用挂"：`getBounds()` 在取景动画刚停稳的那一帧
  //   可能还是 `null`/抛异常（实测移动端首屏就是这样）。调用方据此重试。
  if (!box) {
    lastFail = '拿不到视野（getBounds 与自算都失败）'
    return false
  }
  try {
    // ⚠️ 腾讯是 LatLng(lat, lng) —— 纬度在前
    map.setBoundary(
      new TMap.LatLngBounds(new TMap.LatLng(box.s, box.w), new TMap.LatLng(box.n, box.e)),
    )
  } catch (err) {
    // 引擎正在重建/销毁时 setBoundary 会抛 —— 交给调用方重试
    lastFail = `setBoundary 抛：${(err as Error)?.message ?? err}`
    return false
  }
  lastFail = ''
  return true
}

/**
 * 挂边界，直到引擎真的给出视野为止（最多 `tries` 帧）。
 *
 * 取景停稳 ≠ 引擎就绪：移动端首屏实测那一刻 `getBounds()` 抛异常、60 帧都拿不到，
 * 而 10 秒后正常。期间若没有边界，用户能一路拖出地球。按帧重试、到点放弃（不做无限循环）。
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
    // ★ 这条日志很久没人看见过，但 2026-11-20 移动端真的走到了这里（60 帧都失败），
    //   而"没边界"的表现是**能一路拖出地球**。
    //   持久兜底在 `attachLimits`（不依赖这条一次性通道）。
    debugLog('边界', `等满 60 帧仍挂不上 —— 这张地图暂时没有边界：${lastFail}`)
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
 * ★ resize 必须重算下限（窗口变宽 ⇒ 同一个 zoom 看到的地盘变多）。
 * ★ `getLimits` 是现取的函数而不是值 —— 换端（移动 ↔ 桌面）要跟着换，监听不该重挂。
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
   *
   * ★★ **放大方向必须收紧，而且要在这里做**（2026-11-21，用户第三次报回弹）：
   *   放大后视野变小、边界还停在旧档（宽）⇒ 引擎放行"中心再往外走一屏"。
   *   实测移动端：首页 z3.04 的框 `e=171.41`，放大到 z4.57 后**框没变**，
   *   引擎允许中心到 159.9°，而设计上限是 138° ⇒ 多出一整屏的可拖范围，
   *   拖过去再被别的判据拽回 = 「拖到框外又弹回来」。
   *   以前指望 `useTMap` 的广播收紧，但那条路会因去重/时序漏掉 —— 挂在这里才闭环：
   *   **任何时候停手 220ms，边界一定等于当前档**。
   */
  let lastZoom = map.getZoom()
  let settleTimer = 0
  const onZoom = () => {
    const z = map.getZoom()
    // 缩小：立即放宽（延迟的话这几帧里根本缩不动）
    if (z < lastZoom - 1e-6) syncBoundary(map, getLimits(), undefined, true)
    lastZoom = z
    window.clearTimeout(settleTimer)
    settleTimer = window.setTimeout(() => {
      if (!map.getContainer?.()) return
      // 停稳了：按当前视野收紧（`loose=false`）⇒ 中心只能在 `limits.center` 之内
      syncBoundary(map, getLimits())
    }, ZOOM_SETTLE_MS)
  }
  map.on('zoom', onZoom)
  /**
   * ★★ **持久兜底：直到边界真的挂上为止**（2026-11-20 用户第二次报"拖完中心被重置"）。
   *
   * 之前的挂载点只有"取景停稳那一记广播"（外加 60 帧重试 ≈1 秒）。移动端首屏实测
   * 那 1 秒里 `getBounds()` 一直失败 ⇒ **整张地图没有边界**，而拖动本身是引擎行为，
   * 于是中心能一路绕到西经 179°（`_tmp/probe_reset_center.mjs` 的 trail 读数），
   * 松手才被拽回 71° —— 用户看到的就是「能拖到别的位置，然后中心被重置」。
   *
   * 一次广播的机会太窄了，所以这里补一条**低频轮询**：每 300ms 试一次，
   * 成功后立刻停（不留常驻定时器）。上限 40 次 ≈ 12 秒，够覆盖"引擎预热"那段。
   * 之后边界随缩放由上面的 `onZoom` 更新，不依赖这个定时器。
   */
  let boundaryOk = false
  let pollTries = 0
  /** 上次轮询读到的缩放 + "连续几轮没变" —— 用来避开 fit 动画（动画中挂会把它顶住） */
  let lastPollZoom = Number.NaN
  let stillCount = 0
  const pollTimer = window.setInterval(() => {
    if (boundaryOk || pollTries++ > 40) {
      window.clearInterval(pollTimer)
      if (!boundaryOk) debugLog('边界', `兜底轮询也挂了 12 秒：${lastFail}`)
      return
    }
    const z = map.getZoom()
    if (Math.abs(z - lastPollZoom) < 1e-6) stillCount += 1
    else {
      stillCount = 0
      lastPollZoom = z
    }
    // 连续两轮（≈600ms）视野没动才算停稳：动画途中挂边界会把镜头顶住（5.018 陷阱）
    if (stillCount < 2) return
    if (syncBoundary(map, getLimits())) {
      boundaryOk = true
      window.clearInterval(pollTimer)
      debugLog('边界', `兜底轮询挂上 z=${z.toFixed(2)}`)
    }
  }, 300)
  // ★ 建图时只设缩放上下限，**不**挂边界：那一刻还在引擎的初始 3.6 档，
  //   `getBounds()` 读到的是那个大视野，算出来的框会与首页 fit 的目标打架
  //   （实测首页从 4.574 掉到 4.33、中心退回 `NATIONAL_VIEW.center`）。
  applyLimits(map, getLimits())
  // 拖拽刹车（抬手即停）跟边界是同一件事的两半：一个管"能到哪"，一个管"什么时候停"。
  // 挂在这里是因为它必须**一图一份**，而 `attachLimits` 正好是那个唯一的建图后挂载点。
  const detachBrake = attachDragBrake(map)
  window.addEventListener('resize', onResize)
  return () => {
    window.removeEventListener('resize', onResize)
    window.clearInterval(pollTimer)
    window.clearTimeout(settleTimer)
    map.off('zoom', onZoom)
    detachBrake()
  }
}
