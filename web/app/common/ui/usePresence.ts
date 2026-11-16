/**
 * 「先播退场、再卸载」—— 退场动画的时序基座。
 *
 * ## 为什么需要它
 * React 的 `return null` 是瞬间卸载，退场 keyframes 根本没机会播。
 * 有了这个 hook：门组件在 payload 清空后**多渲染一小会儿**（退场动画时长），
 * 挂上退场 class，时间到了才真的卸载。
 *
 * ## 两个变体，各自管一类门
 * | | 传什么 | 拿到什么 | 适用 |
 * |--|--------|---------|------|
 * | `usePresence` | 布尔开关 | `{ mounted, exiting }` | `panelOpen` / `aboutOpen` 这类 |
 * | `useItemPresence` | 载荷对象 | `{ mounted, exiting, item }` | `addPicker` / `dupConfirm` 这类 |
 *
 * ★ `useItemPresence` 会**缓存最后一份非空载荷**：退场那 160ms 里 store 已经清空，
 *   但屏幕上还播着"这张卡正在离开"，内容必须还是原来那张 —— 退场途中变白板
 *   比硬切更难看。这就是 `item` 存在的理由（门组件把 `item` 传下去，别直接传 store 值）。
 *
 * ## 门组件的纪律不变（check_app AF 项）
 * presence 挂在**门**上，门依旧不持有任何业务状态；内容组件依旧是
 * "每次打开都是全新实例"—— 只是"卸载"这个动作晚了一帧动画的时间。
 * 极端边界：关掉后 160ms 内又立刻重开 ⇒ 内容实例没换（还是旧状态）。
 * 现网没有这种路径（重开都来自用户点击，间隔远大于 160ms），接受。
 */

import { useEffect, useRef, useState } from 'react'

/** 退场动画时长（毫秒）。与 anim.css 里 `.flt-out-*` 的 0.15s 同一口径 */
export const EXIT_MS = 160

/** 布尔门：`show` 变 false 后，`mounted` 还会保持 `EXIT_MS` 才落回 false */
export function usePresence(show: boolean, exitMs = EXIT_MS): { mounted: boolean; exiting: boolean } {
  const [mounted, setMounted] = useState(show)
  useEffect(() => {
    if (show) {
      setMounted(true)
      return
    }
    const t = setTimeout(() => setMounted(false), exitMs)
    return () => clearTimeout(t)
  }, [show, exitMs])
  return { mounted, exiting: mounted && !show }
}

/**
 * 载荷门：`payload` 清空后退场，期间渲染**最后一份非空载荷**。
 * ★ 读写 `last.current` 在渲染期进行（非 effect）—— 它只是缓存"刚看过的值"，
 *   与 React 的"渲染期不许有副作用"不冲突，且必须如此才能在同一帧拿到缓存。
 */
export function useItemPresence<T>(
  payload: T | null | undefined,
  exitMs = EXIT_MS,
): { mounted: boolean; exiting: boolean; item: T | null } {
  const last = useRef<T | null>(null)
  if (payload) last.current = payload
  const [mounted, setMounted] = useState(Boolean(payload))
  useEffect(() => {
    if (payload) {
      setMounted(true)
      return
    }
    const t = setTimeout(() => setMounted(false), exitMs)
    return () => clearTimeout(t)
  }, [payload, exitMs])
  return { mounted, exiting: mounted && !payload, item: payload ?? last.current }
}
