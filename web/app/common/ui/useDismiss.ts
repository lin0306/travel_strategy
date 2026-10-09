/**
 * 「点外面 / 按 Esc 就关」—— 气泡、下拉、行内菜单共用的关闭行为。
 *
 * ## 为什么抽出来
 * 底图菜单与规划行的「⋯」菜单需要**一模一样**的三条行为，而这类逻辑各写一遍时
 * 最容易漏的是**卸载时移除监听**：漏了之后那个菜单会在之后每次点击时都收到事件，
 * 表现是"莫名其妙自己关了"，而代码上看不出任何问题。
 *
 * ★ `onClose` 存在 ref 里，所以调用方**不必**用 `useCallback` 包 ——
 *   否则 effect 会在每次渲染时重新订阅（打开状态下每帧一次）。
 *
 * ## ★ 为什么要有一个"临时关掉 Esc"的开关（2026-09-26 加）
 * 「加到哪个组」弹窗里有一行**行内草稿输入框**，它自己也吃 `Esc`（= 只取消草稿）。
 * 而本钩子的 `Esc` 是挂在 **document** 上的 —— 两个都会响应：
 * 用户按一下 `Esc` 想"放弃这行草稿"，结果**整个弹窗被关掉了**。
 * ⇒ `opts.esc === false` 时只装"点外面关"，把 `Esc` 让给里面的输入框。
 *
 * ★ 语义是「**Esc 关掉最里面那一层**」：弹窗有草稿行时 `Esc` 收草稿行，
 *   草稿行收掉之后 `Esc` 才轮到关弹窗（调用方按状态切这个开关即可）。
 *
 * ## ★ 还有"只吃 `Esc`、不吃点外面"这一档（2026-09-27 加）
 * 「挑景点」浮层（`plan/SpotPicker`）是**连续操作**：挑的过程中用户常要在地图上
 * 确认"这个点到底在哪儿"，那一下正好点在浮层外面。按常规手势把浮层关掉，
 * 他就得重新点一次「添加景点」才能接着挑。⇒ 给它 `outside: false`：
 * 收起的出口只留 ✕ 与 `Esc`（两个都看得见、也不会被地图上的操作误触发）。
 */

import { useEffect, useRef, type RefObject } from 'react'

/**
 * @param open 当前是否展开
 * @param onClose 关闭回调
 * @param opts.esc `false` = **暂时不吃 `Esc`**（留给里面正在编辑的输入框）。默认吃
 * @param opts.outside `false` = **不吃"点外面关闭"**（留给"连续操作中要点地图"的浮层）。默认吃
 * @returns 绑到**包裹元素**上的 ref —— 点它内部不算"外面"
 */
export function useDismiss<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  onClose: () => void,
  opts: { esc?: boolean; outside?: boolean } = {},
): RefObject<T | null> {
  const ref = useRef<T | null>(null)
  const cbRef = useRef(onClose)
  cbRef.current = onClose
  const esc = opts.esc !== false
  const outside = opts.outside !== false

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) cbRef.current()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cbRef.current()
    }
    if (outside) document.addEventListener('mousedown', onDown)
    if (esc) document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, esc, outside])

  return ref
}
