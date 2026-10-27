/**
 * 底部浮层的**手势层**（把手拖动 · 内容区过拉 · 下拉收起 · 点外部收起）。
 *
 * ## 为什么从 `Sheet.tsx` 拆出来
 * `Sheet` 本体是**版式**（三档高度、把手、页脚、圆角），而这里是**手势判定**。
 * 两者混在一个文件里已经顶到 420 行的护栏上限，再加"下拉收起"必然超
 * —— 而拆开之后两边各自只有一件事，改手势不会碰到版式。
 *
 * ## 三档与收起的区别
 * | 手势 | 结果 |
 * |------|------|
 * | 点一下把手 | 相邻档位来回切（`peek ⇄ half ⇄ full`） |
 * | 上下拖 | 找相邻档 |
 * | 在 `peek` 档继续往下拉 | **收起**（需要 `onClose`） |
 * | 点浮层外部 / Esc | **收起**（需要 `onClose`） |
 *
 * ## ★★ 下拉收起的判据为什么是"距离 **或** 速度"
 * 用户问过：「你看是下拉的速度快一点的时候触发，还是拉到底部某一个位置触发隐藏」。
 * 两个都要 —— 它们覆盖两种真实手势：
 *   · **慢慢往下按着拖**：用户没想收，只是一直往下按 —— 拉够 `DISMISS_PX`（96px）
 *     才算"他要收"，中途松手就回弹；
 *   · **快速往下甩**：手指一弹就离开屏幕，位移可能只有 30px（`FLICK_PX`），
 *     但速度超过 `FLICK_V`、意图非常明确 —— 只判距离的话这一下会白甩。
 * 只判速度会让"稳着往下拖"永远收不掉；只判距离会让"甩一下"失灵。单靠任何一个都不行。
 *
 * ## ★ 收起只发生在 `peek` 档
 * `half` / `full` 往下拉是"降一档"（信息还在，只是收起来一点），**不能直接收掉** ——
 * 那样从 full 一把拉到顶就等于关掉，用户会以为点错了。所以判据里写死 `tier === 'peek'`。
 *
 * ## ★★ 触摸必须手动挂非 passive 的 `touchmove`
 * 判定为"拖浮层"之后要 `preventDefault()`，否则原生滚动会和拖动同时进行
 * （浮层在变高、内容也在滚）。React 的 `onTouchMove` 是 **passive** 的，
 * 在里面 `preventDefault()` **静默无效** —— 只能 `addEventListener(..., { passive: false })`。
 *
 * ## ★ 点外部不认 `data-sheet-keep`
 * 浮层之上还可能压着别的东西（「加到哪个规划」的选择器、图层浮窗、右下角工具条）。
 * 点它们**不算**"点浮层外面" —— 否则「添加行程 → 选组」那一下会把详情一并关掉，
 * 用户还没看清加成功了没有。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent as RDragEvent, MouseEvent as RMouseEvent, PointerEvent as RPointerEvent } from 'react'

import { SHEET_ORDER, type SheetTier } from '~/mobile/ui/sheetTier'

/** 内容区过拉的判定阈值（px）。小于它当作抖动 / 点击，不算"要拖动浮层" */
const OVERPULL_PX = 10

/** 在 `peek` 档往下拉这么多 = 收起 */
const DISMISS_PX = 96
/** 快速下甩：位移 ≥ 这个值 **且** 速度 ≥ `FLICK_V` ⇒ 不等拉满就收起 */
const FLICK_PX = 24
const FLICK_V = 0.5 // px/ms

interface DragRec {
  startY: number
  /** 长按把手时先不接管（行程页内部有换序手势），到点才置 true */
  armed: boolean
  t0: number
  timer: number | null
}

/** 内容区按下的状态。`mode`：0 = 还没判定（可能只是普通点击/滚动），1 = 下拉，2 = 上拉 */
interface OverRec {
  startX: number
  startY: number
  startTop: number
  max: number
  t0: number
  mode: 0 | 1 | 2
}

export function useSheetDrag({
  tier,
  onTier,
  onClose,
  longPressHandle,
}: {
  tier: SheetTier
  onTier: (tier: SheetTier) => void
  /** 给了才支持"下拉收起 / 点外部收起 / Esc 收起" */
  onClose?: () => void
  longPressHandle: boolean
}) {
  const [dragOffset, setDragOffset] = useState<number | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<DragRec | null>(null)
  const overRef = useRef<OverRec | null>(null)
  /** 拖完浮层后吞掉随之而来的那次 click —— 否则松手会"点开"手指下面的那条 */
  const swallowRef = useRef(false)

  const endDrag = useCallback(
    (movedPx: number, dt: number) => {
      const d = dragRef.current
      dragRef.current = null
      setDragOffset(null)
      if (d?.timer) window.clearTimeout(d.timer)

      // ★ 判「短按」只看**位移**：原来还要求 `dragOffset === null`，而它是异步 state，
      //   快速拖动时可能还没更新 ⇒ 误判成点击、直接跳档（2026-10-25 修）。
      if (Math.abs(movedPx) < 4) {
        onTier(tier === 'peek' ? 'half' : tier === 'half' ? 'full' : 'half')
        return
      }

      // ① 收起：只在最矮档、且只往下拉（判据见文件头）
      const flick = movedPx >= FLICK_PX && movedPx / Math.max(dt, 16) >= FLICK_V
      if (onClose && tier === 'peek' && movedPx > 0 && (movedPx >= DISMISS_PX || flick)) {
        onClose()
        return
      }

      // ② 找相邻档。`indexOf` 取不到时返回 -1，会把 `ORDER[next]` 变成 undefined ⇒
      //    钳到合法区间，并用 `?? tier` 兜底回「当前档」（等价于没动）
      const idx = Math.max(0, SHEET_ORDER.indexOf(tier))
      const next =
        movedPx < -40
          ? Math.min(idx + 1, SHEET_ORDER.length - 1)
          : movedPx > 40
            ? Math.max(idx - 1, 0)
            : idx
      onTier(SHEET_ORDER[next] ?? tier)
    },
    [tier, onTier, onClose],
  )

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      /* ① 内容区过拉 → 拖动整块浮层（判据见文件头） */
      const o = overRef.current
      if (o) {
        const dy = e.clientY - o.startY
        if (o.mode === 0) {
          const dx = Math.abs(e.clientX - o.startX)
          // 先横向为主就不抢 —— 那是 chip 条的横向滚动
          if (Math.abs(dy) > dx + 2) {
            if (dy > OVERPULL_PX && o.startTop <= 0) o.mode = 1
            else if (dy < -OVERPULL_PX && o.startTop >= o.max - 1) o.mode = 2
            else overRef.current = null // 中间位置 = 普通滚动，交给浏览器
            if (o.mode !== 0) {
              dragRef.current = { startY: o.startY, armed: true, t0: o.t0, timer: null }
              // 鼠标拖到这里已经在正文里拉出一片选区了 —— 判定成立的瞬间清掉
              document.getSelection()?.removeAllRanges()
            }
          }
        }
        if (o.mode !== 0) {
          setDragOffset(dy)
          return
        }
      }
      /* ② 把手拖动 */
      const d = dragRef.current
      if (!d || !d.armed) return
      setDragOffset(e.clientY - d.startY)
    }

    const onUp = (e: PointerEvent) => {
      /* ① 内容区过拉 */
      const o = overRef.current
      overRef.current = null
      if (o && o.mode !== 0) {
        // 350ms 后自动复位：正常点击在 pointerup 之后立刻到达，不会漏吞
        swallowRef.current = true
        window.setTimeout(() => {
          swallowRef.current = false
        }, 350)
        endDrag(e.clientY - o.startY, performance.now() - o.t0)
        return
      }
      /* ② 把手 */
      const d = dragRef.current
      if (!d) return
      if (!d.armed) {
        dragRef.current = null
        return
      }
      endDrag(e.clientY - d.startY, performance.now() - d.t0)
    }

    /** 手势被系统打断（来电、通知栏下拉）→ 两个状态都得清，否则浮层卡在半路 */
    const onCancel = () => {
      dragRef.current = null
      overRef.current = null
      setDragOffset(null)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
  }, [endDrag])

  /** 触摸：判定为"拖浮层"之后必须 `preventDefault()`（React 的 onTouchMove 是 passive） */
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const onTouchMove = (e: TouchEvent) => {
      if (overRef.current && overRef.current.mode !== 0) e.preventDefault()
    }
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => el.removeEventListener('touchmove', onTouchMove)
  }, [])

  /** 点外部 / Esc 收起（只在 `onClose` 存在时挂） */
  useEffect(() => {
    if (!onClose) return
    const onDown = (e: PointerEvent) => {
      const root = rootRef.current
      const t = e.target as HTMLElement | null
      if (!root || !t || root.contains(t)) return
      if (t.closest?.('[data-sheet-keep]')) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const onHandleDown = (e: RPointerEvent) => {
    dragRef.current = { startY: e.clientY, armed: !longPressHandle, t0: performance.now(), timer: null }
    if (longPressHandle) {
      // ★ 行程页：长按 300ms 才把手柄变成浮层拖拽，否则交给内部的换序手势
      dragRef.current.timer = window.setTimeout(() => {
        if (dragRef.current) dragRef.current.armed = true
      }, 300)
    }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  /** 内容区按下：只记录起手信息，**不拦截**任何东西 —— 判定在 `pointermove` 里做 */
  const onContentDown = (e: RPointerEvent<HTMLDivElement>) => {
    // ★ 行程页的时间轴自己吃手势，内容区不参与拖浮层
    if (longPressHandle) return
    const root = e.currentTarget
    /*
     * ★ 记的是**离手指最近的那个**可滚容器的位置，不是 `root` 的。
     *   浮层里的滚动容器常常是嵌套的（正文自己再套一层 `.scroll`），读错那一层
     *   会让"滚到顶/底"判反 —— 于是往下拖永远触发不了，或者把普通滚动抢走。
     * ★ 必须**同时**要求 `overflow-y: auto|scroll`：只看 `scrollHeight > clientHeight`
     *   会把 `line-clamp-N` 的摘要当成滚动容器（它是 `overflow: hidden`，内容确实溢出）
     *   ⇒ 手指落在任何一段被截断的摘要上往下拖，都会被判成"可以拉浮层"。
     */
    let el: HTMLElement | null = e.target as HTMLElement
    let box: HTMLElement = root
    while (el && el !== root) {
      const oy = getComputedStyle(el).overflowY
      if (el.scrollHeight > el.clientHeight + 2 && (oy === 'auto' || oy === 'scroll')) {
        box = el
        break
      }
      el = el.parentElement
    }
    overRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startTop: box.scrollTop,
      max: box.scrollHeight - box.clientHeight,
      t0: performance.now(),
      mode: 0,
    }
  }

  /** 打在内容区上：吞掉"拖完浮层"之后的那次 click（松手位置常压在列表项上） */
  const onClickCapture = (e: RMouseEvent) => {
    if (!swallowRef.current) return
    swallowRef.current = false
    e.preventDefault()
    e.stopPropagation()
  }

  /** 图片默认 `draggable`：鼠标按在图上拖会启动原生拖拽 ⇒ 指针链被 `pointercancel` 掉 */
  const onDragStart = (e: RDragEvent) => {
    if ((e.target as HTMLElement).tagName === 'IMG') e.preventDefault()
  }

  return {
    rootRef,
    contentRef,
    dragOffset,
    onHandleDown,
    onContentDown,
    onClickCapture,
    onDragStart,
  }
}
