/**
 * 视野适配：**浮层实测 → `fitBounds` 的 padding**。
 *
 * ## 问题
 * 地图铺满 100% 视口，但浮层（左面板 348px / 右预览卡 326px / 详情面板 620px /
 * 行程面板 420px / 移动端 Sheet）会盖住地图的一部分。如果直接把点位 `fitBounds` 到
 * 整个视口，被浮层盖住的那部分点位**用户根本看不见** —— 点位"在视野内"但"被面板压着"。
 *
 * ## 做法
 * 从 DOM 实测所有可见浮层的包围盒，反推出「未被遮挡的空闲矩形」，
 * 再把矩形转成 `fitBounds` 的 padding。
 *
 * > 💡 换引擎的代价：高德有 `setBounds(bounds, immediately, avoid)` 的 `avoid` 参数
 * > 直接对应这个语义；**腾讯没有 `avoid`，只能走 padding**。所以这套逻辑在腾讯这边
 * > 是**必需的正式实现**，不是过渡方案。
 *
 * ## 另一半：`minZoom`（落点至少到某一级）
 * 光有 padding 只回答"框不框得下"，不回答"落点是不是该到的那一档"。
 * 那一半的几何（缩放 ↔ 跨度换算 + 框收缩）在 `./zoomSpan.ts` —— 那边是纯几何，
 * 本文件只管 DOM 侧的实测与动画。
 */

import { DEGENERATE_SPAN_DEG, shrinkForMinZoom } from './zoomSpan'

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface LatLngLike {
  lng: number
  lat: number
}

/* ────────────────────────────────────────────────
 * 全国视野（首页的固定取景框）
 * ────────────────────────────────────────────── */

export interface NationalView {
  /** 西南角 / 东北角。给 `fit()` 用来框住全国（会自动避开浮层遮挡） */
  corners: LatLngLike[]
  /** 边界数据缺席时的退化取景；引擎的初始视野也用它 */
  center: LatLngLike
  /**
   * 与 `center` 配套的**引擎兜底缩放**（页面 fit 成功后会立刻被覆盖）。
   * 取 3.6 而不是 4：首帧的观感要与 fit 之后的"国界 + 8% 留白"接近，
   * 否则打开首页会看到地图先"跳"一下。
   */
  zoom: number
}

/**
 * 全国视野 —— 首页「中国全图」的取景。
 *
 * ## 为什么它必须是一个常量，而不是"fit 一下省级中心点"就完事
 * 首页是 `/`，它的正确取景是**固定的**：把镜头对准整个中国。这件事
 * **不该依赖任何数据是否就绪**。`district-tree.json` 是采集流水线的产物，
 * 在跑完之前根本不存在，那时 34 个省级 `center` 全是 `null` ——
 * 于是"fit 省级中心点"退化成"一个点都没框"，地图停在引擎初始中心。
 * 这正是「打开首页看到的是成都」这个 bug 的成因（而且从城市页返回首页时同样中招，
 * 因为地图实例挂在布局路由上、跨页复用）。
 *
 * ## ⚠️ 这是「取景」，不是「边界几何」
 * 这里只给两个角点，用来把镜头框住。**不画任何轮廓。**
 * 行政边界（含中国台湾、中国香港、中国澳门）**只能**来自腾讯 District 服务 ——
 * 版图完整性属《地图管理条例》范畴，严禁拿这里的坐标去近似边界。
 *
 * 取景范围到海南岛一带（约 18°N）为止，不把南海诸岛一并拉进首屏 ——
 * 那会把整块国土压成一小团。诸岛的表达由腾讯底图与区划边界负责，不由取景负责。
 */
export const NATIONAL_VIEW: NationalView = {
  corners: [
    { lng: 73.5, lat: 18.0 },
    { lng: 135.1, lat: 53.6 },
  ],
  center: { lng: 104.3, lat: 35.9 },
  zoom: 3.6,
}

/**
 * 取景留白比例 —— 把国界框再向外扩 8%。
 *
 * ## 为什么必须留白（用户原话：「地图默认的缩放级别还得再缩一点，没办法看清楚全中国」）
 * `fitBounds` 会把给定框**紧贴**到 padding 边界上：框的两个角正好落在可视区边缘。
 * 而"看清全中国"需要的不是"角点在屏内"，是"整个国土在屏内还留有余地" ——
 * 因为：① 东北（黑龙江抚远）与西北（新疆喀什）在屏幕上就是两个角，
 * 贴边时它们与顶栏/屏幕边缘挤在一起，看起来像被切了；
 * ② 地图天然还有 `fitBounds` 自己的一点点内边距，两处不知谁多谁少。
 *
 * ## 上一次的根因不在这里，但两者叠加才明显
 * 旧代码用**34 个省级中心点**去 fit：省中心离国界很远（黑龙江中心在东经 126°，
 * 而国界到了 135°），所以框出来的是"省中心们"，东北与西北整块在框外。
 * 现在改成恒定用`NATIONAL_FIT_CORNERS`（国界 + 留白），不再受点位分布影响。
 */
export const NATIONAL_FIT_MARGIN = 0.08

/**
 * 把一组角点按比例向外扩（相对这组点的中心）。
 *
 * ⚠️ **只用于取景**。不要拿它的结果去做任何与边界几何有关的事 ——
 *    行政边界（含中国台湾、中国香港、中国澳门）只能来自腾讯 District 服务，
 *    版图完整性属《地图管理条例》范畴，见 10 文档第九节。
 */
export function expandCorners(corners: LatLngLike[], ratio: number): LatLngLike[] {
  if (corners.length === 0) return corners
  const lngs = corners.map((c) => c.lng)
  const lats = corners.map((c) => c.lat)
  const cLng = (Math.min(...lngs) + Math.max(...lngs)) / 2
  const cLat = (Math.min(...lats) + Math.max(...lats)) / 2
  return corners.map((c) => ({
    lng: cLng + (c.lng - cLng) * (1 + ratio),
    lat: cLat + (c.lat - cLat) * (1 + ratio),
  }))
}

/**
 * 首页固定取景框 = 国界 + 留白。
 *
 * 做成模块级常量而不是"每次调用现算"：它是**唯一**的首屏取景依据，
 * 出现在两个地方（页面 fit、探针断言）时必须是同一个值。
 */
export const NATIONAL_FIT_CORNERS: LatLngLike[] = expandCorners(
  NATIONAL_VIEW.corners,
  NATIONAL_FIT_MARGIN,
)

/**
 * 可见性判定。
 *
 * ⚠️ **只按 `display` / `visibility`，不能按 `opacity` 过滤** ——
 * 浮层入场动画是从 `opacity: 0` 起步的，按 opacity 过滤会把"正在入场"的浮层漏掉，
 * 导致空闲区算大、点位被压。这是原型阶段踩过的坑。
 */
function isVisible(el: HTMLElement): boolean {
  if (!el.isConnected) return false
  const cs = window.getComputedStyle(el)
  if (cs.display === 'none' || cs.visibility === 'hidden') return false
  // 尺寸为 0 的元素（未布局、空容器）也跳过，否则会污染边界判断
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}

/**
 * 容器自身的缩放系数。
 *
 * ⚠️ **必须实测，不能用 state 里的值** —— 如果外层有 transform 缩放动画，
 * 尚未生效的那一帧 state 与真实渲染不一致，会算错空区。
 */
function measureScale(container: HTMLElement): number {
  const r = container.getBoundingClientRect()
  if (!container.offsetWidth) return 1
  const s = r.width / container.offsetWidth
  return Number.isFinite(s) && s > 0 ? s : 1
}

/**
 * 实测空闲矩形（容器坐标系，单位 px）。
 *
 * ## 贴边方向怎么判：**先分「通栏」还是「角落」，再比距离**
 *
 * 旧实现只有"到四条边的距离取最小"这一步，它在**通栏浮层**上必然判错：
 * 顶栏（`left/right = 16, top = 16, height = 52`）到四边的距离是
 * `16 / 16 / 16 / 832` —— 最小值并列在 left / right / **top** 上，
 * 而代码用 `min === dLeft` 先命中，于是**只收缩了 x**，y 一动不动；
 * 紧接着 x 又触发"可用区过窄"兜底被重置回全宽 →
 * **最终 padding 变成 0**，顶栏白占 52px，`fitBounds` 出来的内容被它压住。
 * 2026-09-19 实测证据：首页取景后中国最北点（漠河）投影到 y=41，
 * 而顶栏底边在 y=68 —— 那块国土就在顶栏底下。
 *
 * 现在的判据分两步：
 *   1. 浮层的跨度**几乎铺满**容器的一条轴（≥ 80%）→ 它是**通栏**，
 *      压的是另一条轴：横向通栏压上下，纵向通栏压左右；
 *   2. 否则是**角落浮层**，按最近的边收缩（原逻辑）。
 *
 * 三种常见形态都能对上：
 * | 浮层 | 判定 | 收缩 |
 * |------|------|------|
 * | 顶栏 / 底栏（横向通栏） | spansX | 上（或下） |
 * | 左面板 / 右面板（纵向通栏） | spansY | 左（或右） |
 * | 右下角小卡 | 角落 | 最近的那条边 |
 */
export function freeRect(container: HTMLElement, overlays: Array<HTMLElement | null>): Rect {
  const scale = measureScale(container)
  const cr = container.getBoundingClientRect()
  const W = container.offsetWidth || cr.width
  const H = container.offsetHeight || cr.height

  let x0 = 0
  let y0 = 0
  let x1 = W
  let y1 = H

  for (const el of overlays) {
    if (!el || !isVisible(el)) continue
    const r = el.getBoundingClientRect()

    // 换算到容器的**未缩放**坐标系
    const ox0 = (r.left - cr.left) / scale
    const oy0 = (r.top - cr.top) / scale
    const ox1 = ox0 + r.width / scale
    const oy1 = oy0 + r.height / scale

    // 浮层在容器外（另一层级的浮层）→ 忽略
    if (ox1 < 0 || oy1 < 0 || ox0 > W || oy0 > H) continue

    const dLeft = Math.max(0, ox0)
    const dRight = Math.max(0, W - ox1)
    const dTop = Math.max(0, oy0)
    const dBottom = Math.max(0, H - oy1)

    const spansX = ox1 - ox0 >= W * 0.8
    const spansY = oy1 - oy0 >= H * 0.8

    if (spansX && !spansY) {
      // 横向通栏（顶栏 / 底栏）：压上边还是下边，看它更靠哪一边
      if (dTop <= dBottom) y0 = Math.max(y0, Math.min(oy1, H))
      else y1 = Math.min(y1, Math.max(oy0, 0))
      continue
    }
    if (spansY && !spansX) {
      // 纵向通栏（左右面板）：压左边还是右边
      if (dLeft <= dRight) x0 = Math.max(x0, Math.min(ox1, W))
      else x1 = Math.min(x1, Math.max(ox0, 0))
      continue
    }

    // 角落浮层：收缩它贴着的那一条边
    const min = Math.min(dLeft, dRight, dTop, dBottom)
    if (min === dLeft) x0 = Math.max(x0, Math.min(ox1, W))
    else if (min === dRight) x1 = Math.min(x1, Math.max(ox0, 0))
    else if (min === dTop) y0 = Math.max(y0, Math.min(oy1, H))
    else y1 = Math.min(y1, Math.max(oy0, 0))
  }

  // 兜底：浮层几乎盖满（或测量异常）时不要把空闲区算成 0 —— 那会让 fitBounds 直接报错
  if (x1 - x0 < W * 0.15) {
    x0 = 0
    x1 = W
  }
  if (y1 - y0 < H * 0.15) {
    y0 = 0
    y1 = H
  }

  return { x0, y0, x1, y1 }
}

/** 空闲矩形 → `fitBounds` 的 padding */
export function freeRectToPadding(container: HTMLElement, overlays: Array<HTMLElement | null>): TMap.PaddingOptions {
  const cr = container.getBoundingClientRect()
  const scale = measureScale(container)
  const W = container.offsetWidth || cr.width
  const H = container.offsetHeight || cr.height
  const r = freeRect(container, overlays)

  return {
    top: Math.round(r.y0),
    bottom: Math.round(H - r.y1),
    left: Math.round(r.x0),
    right: Math.round(W - r.x1),
  }
}

/* ────────────────────────────────────────────────
 * fitBounds 封装
 * ────────────────────────────────────────────── */

/**
 * 由一组点算出范围框。
 *
 * ## 为什么是"先自己算 min/max"，而不是建一个反向 box 再 extend
 * 腾讯 `LatLngBounds` 的构造函数会**立刻校验** sw < ne。用
 * `new LatLngBounds(LatLng(90,180), LatLng(-90,-180))`（空集惯用写法）建初始框时，
 * 每一帧都会往控制台刷一条
 * 「LatLngBounds中sw 的经纬度必须小于ne的经纬度，实际传入sw为： 90, 180 ne 为： -90, -180」。
 * 它不会中断渲染，但会**把真正的错误淹没掉** —— 本项目已经因为这条噪音，
 * 在排查别的故障时多花过时间。自己算 min/max 就没有这个中间态。
 *
 * ## 单点 / 退化范围
 * 只有 1 个点时 min === max，`fitBounds` 会把缩放拉到引擎上限。给一个极小的兜底跨度
 * （约 2km），让"只有一个点位"也有合理视野，而不是糊在最大缩放下。
 */
export function boundsOf(points: LatLngLike[]): TMap.LatLngBounds | null {
  if (points.length === 0) return null

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

  const PAD = DEGENERATE_SPAN_DEG
  if (maxLat - minLat < PAD) {
    minLat -= PAD / 2
    maxLat += PAD / 2
  }
  if (maxLng - minLng < PAD) {
    minLng -= PAD / 2
    maxLng += PAD / 2
  }

  // ⚠️ 腾讯是 LatLng(lat, lng) —— 纬度在前
  return new TMap.LatLngBounds(new TMap.LatLng(minLat, minLng), new TMap.LatLng(maxLat, maxLng))
}

/**
 * 这次取景的**语义**。
 *
 * ## 为什么不让调用方传毫秒数（2026-09-20）
 * 修复前四个页面各写一遍 `{ duration: 600 }` / `{ duration: 0 }`，于是：
 *   · 谁也说不清哪个数是"首屏"、哪个是"下钻"—— 换个人改标定只能靠猜；
 *   · 首屏（`duration: 0`）与下钻（`600`）走的是**同一个** `fit()`，而
 *     "取景刚发起就去读视野"的代码读到的永远是动画第 0 帧 ——
 *     那个时序错位就是这么来的（现在由 `useTMap` 的稳定检测兜住）。
 * 语义化之后，"这次取景是首屏还是下钻"变成**类型层面**的信息，
 * 时长只在下面这一个表里出现。
 */
export type FlyReason = 'initial' | 'drill'

/**
 * 取景动画时长（ms）。
 * · `initial` —— 首屏落位。**必须 0**：用户打开页面时镜头该已经在那儿了，
 *   放一段飞行动画只会让人等，而且第一帧的取景判据会读到动画中途的值。
 * · `drill` —— 下钻/换页。给一段动画，让用户看懂"我是从哪儿来的"。
 */
export const FLY_DURATION_MS: Record<FlyReason, number> = { initial: 0, drill: 600 }

export interface FitOptions {
  /** 浮层元素（用来算空闲区）。传了就自动算 padding */
  container?: HTMLElement | null
  overlays?: Array<HTMLElement | null>
  /** 手动指定 padding（传了就不实测） */
  padding?: TMap.PaddingOptions
  /** 这次取景的语义（决定动画时长）。默认按"下钻"处理 */
  reason?: FlyReason
  /**
   * 这次取景**至少要落到**这一级（引擎缩放值）。
   *
   * ## 为什么需要它
   * `fitBounds` 只回答"这片范围框得下吗"，不回答"落点是不是该到的那一档"。
   * 而第四级（区）的外接框经常**比景点级还大**：广州从化区跨 0.8°×0.56°，
   * 框住它 ≈ z10.4，而景点要 z≥12 才揭出来 —— 于是"点这个区"看上去什么都没发生，
   * 甚至比上一屏还小（省级页原先退化成 0.5° 的近似方块，就是"点区反而缩小"）。
   *
   * ## 为什么是"收缩框"而不是 fit 完再 `setZoom`
   * `fitBounds` 是**动画**：紧接着 `setZoom` 会打断它（镜头瞬移），
   * 而且 `setZoom` 不认 padding —— 浮层避让白算。把框按比例收缩到目标级别
   * 对应的跨度再 fit，中心、动画、避让全都还是原来那套。
   *
   * ★ 只在"框出来的级别比它小"时生效（框本来就更深时不动），所以传它永远安全。
   */
  minZoom?: number
  /** 收缩 `minZoom` 时的**锚点**：视野钉在这一枚点上，而不是框的几何中心（见 `shrinkForMinZoom`） */
  anchor?: LatLngLike
}

/**
 * 把一组点位框进"没被浮层盖住的地方"。
 *
 * ⚠️ 只在**浮层显隐 / 换档**的那一次调用，**不要在地图拖动时反复调**。
 *
 * ★ 这是一个**动画**开始的动作，不是"镜头已经到位"。想知道什么时候到位，
 *   用 `useTMap` 暴露的那次广播（它在稳定检测之后才发）—— 不要在返回值后面
 *   紧接着读 `getZoom()`，那读到的是第 0 帧。
 */
export function fitPoints(map: TMap.Map, points: LatLngLike[], opts: FitOptions = {}): boolean {
  const box = boundsOf(points)
  if (!box) return false

  let padding = opts.padding
  if (!padding && opts.container) {
    padding = freeRectToPadding(opts.container, opts.overlays ?? [])
  }

  // `minZoom`：先把框收缩到"至少那么深"再 fit（理由见 `FitOptions.minZoom`）。
  // ★ 容器量不出来时**放弃**它（返回 null → 原样 fit）：宁可让落点浅一点，
  //   也不要拿 0 像素去算一个荒唐的收缩系数。
  const avail = containerPixels(opts.container ?? map.getContainer?.() ?? null, padding)
  const target = shrinkForMinZoom(points, opts.minZoom, avail, opts.anchor)

  map.fitBounds(boundsOf(target) ?? box, {
    padding,
    duration: FLY_DURATION_MS[opts.reason ?? 'drill'],
  })
  return true
}

/**
 * 容器**扣掉浮层之后**还剩多少像素。
 *
 * 浮层避让算的是 padding，而"这片跨度能框到几级"必须按**剩下的**像素算 ——
 * 用整屏算会把落点估深（左面板吃掉 348px，等于可用宽度少了四分之一）。
 *
 * @return `null` = 量不出来（容器还没挂载 / 尺寸为 0），调用方应放弃 `minZoom`
 */
function containerPixels(
  el: HTMLElement | null | undefined,
  padding: TMap.PaddingOptions | undefined,
): { w: number; h: number } | null {
  if (!el) return null
  const w = el.offsetWidth || el.getBoundingClientRect().width
  const h = el.offsetHeight || el.getBoundingClientRect().height
  if (!w || !h) return null

  const l = padding?.left ?? 0
  const r = padding?.right ?? 0
  const t = padding?.top ?? 0
  const b = padding?.bottom ?? 0
  // ★ 兜个 1px 下限：padding 把容器吃光时（极端浮层布局）不要除出 0
  return { w: Math.max(w - l - r, 1), h: Math.max(h - t - b, 1) }
}
