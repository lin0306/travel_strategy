/**
 * 拖拽刹车 —— 「拖到哪就停在哪」，抬手后不许再滑。
 *
 * ## 为什么需要它
 * 腾讯 GL 的拖拽是 Leaflet 血统（bundle 里 `_map.options.inertia`、
 * `inertiaDeceleration:3400`、`easeLinearity:.2`），抬手后按最后一段速度继续滑。
 * 实测（`_tmp/probe_inertia_distance.mjs`，z12）：
 *
 * | 输入 | 拖动本体 | 抬手后**额外滑行** |
 * |------|----------|--------------------|
 * | 鼠标快拖 | −500px | **−200px** |
 * | 手指快甩 | −230px | −9px |
 *
 * 于是"我明明拖到这里"与"地图停在那里"差出小半个屏，用户只能再拖回去。
 * 导航类地图（要看的地方就得停在手指下）不该有这层惯性。
 *
 * ## 为什么不是"关掉惯性"
 * `inertia` 只存在于引擎内部 map 的 `options` 上，`TMap.Map` 这层包装**没有把它透出来**
 * （`_tmp/probe_inertia_api*.mjs` 把所有自有键与原型方法都摊开看过了：没有 `options`、
 * 没有 `dragging`，只有 `dragPan` handler 和 `stopEase`/`stopMoving` 两个公开方法）。
 * 硬塞 `{ inertia: false }` 走的是"未知字段静默忽略"那条路 —— 不报错、也不生效。
 * 所以改用**刹车**：抬手那一刻的中心就是目的地，之后任何偏离都拉回来。
 *
 * ## 三条必须守住的边界
 * 1. **点一下不算拖**：`pointerdown` 到 `pointerup` 中心没动 ⇒ 不刹车。
 *    否则同一次点击触发的下钻动画（`focusPoint`）会在下一帧被 `stopEase` 掐死
 *    —— 表现是"点徽标只放大一点点就不动了"，比惯性更难查。
 * 2. **任何新的 `pointerdown` 立刻解除刹车**：下一个手势开始时刹车必须已经撤干净。
 * 3. **多指不插手**：双指缩放没有平移惯性，插手只会把缩放打断。
 */

/** 最多盯多少帧（正常情况下 `stopEase` 一帧就停，这里只是兜底上限） */
const BRAKE_FRAMES = 30
/** 连续这么多帧没偏离 ⇒ 认为惯性已死，收手 */
const STABLE_FRAMES = 3

interface LngLat {
  lng: number
  lat: number
}

/** 两个中心算不算"同一个地方"（1e-9 度 ≈ 0.1 毫米，只用来排除浮点噪声） */
function samePos(a: LngLat, b: LngLat): boolean {
  return Math.abs(a.lng - b.lng) < 1e-9 && Math.abs(a.lat - b.lat) < 1e-9
}

/**
 * 挂到地图实例上；返回解绑函数。
 *
 * ★ 监听**捕获阶段**：要抢在引擎自己的 `up` 处理之前读中心 —— 那时地图还停在手指底下，
 *   等到冒泡阶段再读，第一帧惯性已经把它推走了。
 */
export function attachDragBrake(map: TMap.Map): () => void {
  const el = (map.getContainer?.() ?? null) as HTMLElement | null
  if (!el) return () => {}

  /** 当前按下的指针（用来识别多指：`size > 1` 就是捏合） */
  const pointers = new Set<number>()
  /** 按下那一刻的中心 */
  let down: LngLat | null = null
  /** 抬手那一刻的中心 = 用户想去的地方 */
  let target: LngLat | null = null
  let raf = 0
  let frame = 0
  let stable = 0

  const read = (): LngLat | null => {
    try {
      const c = map.getCenter()
      return { lng: c.getLng(), lat: c.getLat() }
    } catch {
      return null
    }
  }

  const cancel = () => {
    if (raf) {
      cancelAnimationFrame(raf)
      raf = 0
    }
    target = null
  }

  const tick = () => {
    raf = 0
    if (!target) return
    // 先让引擎停：这两个都是公开方法，`panBy` 那条惯性动画会被掐掉
    try {
      map.stopEase?.()
    } catch {
      /* 引擎没这个状态时会抛，忽略 */
    }
    try {
      map.stopMoving?.()
    } catch {
      /* 同上 */
    }
    const now = read()
    if (now && !samePos(now, target)) {
      // 已经滑出去几像素 ⇒ 拉回抬手的位置（`stopEase` 偶尔只停动画不回到原处）
      try {
        map.setCenter(new TMap.LatLng(target.lat, target.lng))
      } catch {
        /* 地图已销毁 */
      }
      stable = 0
    } else {
      stable += 1
    }
    frame += 1
    if (stable >= STABLE_FRAMES || frame >= BRAKE_FRAMES) {
      target = null
      return
    }
    raf = requestAnimationFrame(tick)
  }

  const onDown = (e: PointerEvent) => {
    pointers.add(e.pointerId)
    // 新手势开始 ⇒ 上一轮的刹车必须撤干净（否则会把这次触发的下钻动画掐掉）
    cancel()
    down = pointers.size > 1 ? null : read()
  }

  const onUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId)
    const from = down
    down = null
    // 还有别的手指按着（捏合中途抬一根）⇒ 不接管
    if (pointers.size > 0 || !from) return
    const up = read()
    if (!up) return
    // 中心没动过 = 一次点击，不是拖拽
    if (samePos(from, up)) return
    cancel()
    target = up
    frame = 0
    stable = 0
    raf = requestAnimationFrame(tick)
  }

  const onCancel = () => {
    cancel()
    down = null
  }

  const opts = { capture: true }
  el.addEventListener('pointerdown', onDown, opts)
  /**
   * ★ 抬起挂在 `window` 而不是容器上：鼠标一路拖到右侧面板再松手时，
   *   `pointerup` 的目标是面板 —— 挂在容器上就收不到，那一轮惯性会照滑不误。
   *   手指有隐式指针捕获，鼠标没有，所以这条不是多余的。
   *   （`down` 只在"按在地图上"时才非空，所以点面板不会误刹车。）
   */
  window.addEventListener('pointerup', onUp, opts)
  window.addEventListener('pointercancel', onCancel, opts)

  return () => {
    cancel()
    el.removeEventListener('pointerdown', onDown, opts)
    window.removeEventListener('pointerup', onUp, opts)
    window.removeEventListener('pointercancel', onCancel, opts)
  }
}
