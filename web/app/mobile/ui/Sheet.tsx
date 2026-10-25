/**
 * 底部 Sheet —— 移动端所有内容的容器（三档吸附）。
 *
 * ## 三档的语义（08 文档）
 * | 档 | 高度 | 露出什么 |
 * |----|------|---------|
 * | `peek` | 28svh | 把手 + 一行摘要（城市页 = 城市名；行程页 = 当天首段） |
 * | `half` | 56svh | 默认档。列表 / 时间轴主体 + 汇总 |
 * | `full` | 88svh | 完整内容 + 操作条 |
 *
 * ## 两条实现细节
 *
 * ### 高度用 svh，不用 vh
 * 移动端 `100vh` 把地址栏算在内，实际比可视区高 56–80px —— 用 vh 的话
 * `full` 档底部操作条会被推到屏幕外，用户永远点不到。`svh` 取的是**最小可视高度**，
 * 是"按最坏情况布局"的正确选择。`dvh` 会随地址栏收放抖动，不用。
 *
 * ### 长按 300ms 才激活拖拽（只在行程页生效）
 * 行程页的时间轴本身支持长按拖拽换序，而 Sheet 把手也是拖拽。两个拖拽手势叠在一起
 * 会互相抢事件。解法是：把手**长按 300ms** 才接管为 Sheet 拖拽，短按只是"吸附切换"。
 * 城市页没有内部拖拽，所以直接拖就行。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { Icon } from '~/common/ui/Icon'

export type SheetTier = 'peek' | 'half' | 'full'

/** 三档高度（svh）。数值与 08 文档一致 */
export const SHEET_TIER_SVH: Record<SheetTier, number> = { peek: 28, half: 56, full: 88 }

/** 拖到最矮也留这么高（把手 + 一行摘要），否则 Sheet 会缩成一条缝 */
const MIN_DRAG_PX = 72

export interface SheetProps {
  tier: SheetTier
  onTier: (tier: SheetTier) => void
  children: ReactNode
  /**
   * 无障碍名（`aria-label`）。
   * ★ 与 `Overlay` 的 `label` 同一个理由：屏幕上可能同时有好几块 `data-overlay`
   *   （顶栏、城市列表 Sheet、规划 Sheet……），屏幕阅读器只会念"区域"。
   *   验收脚本同样需要它 —— 按文字找会**误命中顶栏**（那里也有"路线规划"三个字），
   *   这个坑在移动端探针上又踩了一次。
   */
  label?: string
  /** 固定在底部不随内容滚动的操作条 */
  footer?: ReactNode
  /** sheet 内部标题（把手下方） */
  header?: ReactNode
  /** 时间轴内自己处理拖拽时置 true —— 把手改为长按激活，避免抢手势 */
  longPressHandle?: boolean
}

const ORDER: SheetTier[] = ['peek', 'half', 'full']

export function Sheet({ tier, onTier, children, footer, header, longPressHandle = false, label }: SheetProps) {
  const [dragOffset, setDragOffset] = useState<number | null>(null)
  const dragRef = useRef<{ startY: number; armed: boolean; timer: number | null } | null>(null)

  const endDrag = useCallback(
    (movedPx: number) => {
      const d = dragRef.current
      dragRef.current = null
      setDragOffset(null)
      if (d?.timer) window.clearTimeout(d.timer)
      // ★ 判「短按」只看**位移**：原来还要求 `dragOffset === null`，而它是异步 state，
      //   快速拖动时可能还没更新 ⇒ 误判成点击、直接跳档（2026-10-25 修）。
      if (Math.abs(movedPx) < 4) {
        // 短按：把手 = 在 peek 与 half 之间来回切（最常见的意图）
        onTier(tier === 'peek' ? 'half' : tier === 'half' ? 'full' : 'half')
        return
      }
      // 拖动：按方向找相邻档
      // `indexOf` 取不到时返回 -1，会把 ORDER[next] 变成 undefined。
      // 钳到合法区间，并用 `?? tier` 兜底回「当前档」—— 等价于没动，
      // 比崩掉或跳到错误档位都好（理论上 tier 必然在 ORDER 里，但不靠"理论上"）。
      const idx = Math.max(0, ORDER.indexOf(tier))
      const next =
        movedPx < -40 ? Math.min(idx + 1, ORDER.length - 1) : movedPx > 40 ? Math.max(idx - 1, 0) : idx
      onTier(ORDER[next] ?? tier)
    },
    [tier, onTier],
  )

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d || !d.armed) return
      setDragOffset(e.clientY - d.startY)
    }
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const moved = e.clientY - d.startY
      if (!d.armed) return // 长按还没到位就被抬起 → 不算拖拽
      endDrag(moved)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [endDrag])

  const onHandleDown = (e: React.PointerEvent) => {
    const startY = e.clientY
    dragRef.current = { startY, armed: !longPressHandle, timer: null }
    if (longPressHandle) {
      // ★ 行程页：长按 300ms 才把手柄变成 Sheet 拖拽，否则交给 Sheet 内部的换序手势
      dragRef.current.timer = window.setTimeout(() => {
        if (dragRef.current) dragRef.current.armed = true
      }, 300)
    }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  const height = `calc(${SHEET_TIER_SVH[tier]}svh + env(safe-area-inset-bottom, 0px))`

  /**
   * 拖动中的实时高度 = 基准高度 **减去** 位移。
   *
   * ★★ `dragOffset = clientY − startY`：**往上拖是负数**，所以必须 `height − dragOffset`
   *   （负负得正 ⇒ 长高）。2026-10-25 之前写的是 `height − (−dragOffset)` = `height + dragOffset`
   *   ⇒ **往上拖反而变矮**、松手才跳到更高的档，就是用户报的「上下拉是反的」。
   * ★ 外面套 `clamp`：往下拖到底不至于把 Sheet 拖成负高度，往上拖不至于盖过视口。
   */
  const dragHeight =
    dragOffset === null
      ? null
      : `clamp(${MIN_DRAG_PX}px, calc(${height} - ${Math.round(dragOffset)}px), 100svh)`

  return (
    <div
      data-overlay=""
      {...(label ? { role: 'region' as const, 'aria-label': label } : {})}
      /*
       * ★ `sm:hidden` 不是冗余 —— 它是"桌面端首帧不闪手机版抽屉"的唯一保障。
       *
       * 端别由 `useIsMobile()` 判定，而 SSG 预渲染时没有 window、按**移动优先**
       * 渲染成 Sheet。于是桌面用户拿到的 HTML 里就有一份 Sheet，要等 JS 水合后
       * 才会被换成 Overlay（实测约 100ms）。
       *
       * 用 CSS 兜住这一段：Sheet 只在 <640px 可见，**与 `useIsMobile` 的
       * `(max-width: 639px)` 严格互补**（Tailwind `sm:` = `min-width: 640px`）。
       * 首帧由 CSS 直接判定，不依赖 JS —— 桌面端从第一帧起就看不到它，移动端
       * 照常立即显示（默认可见 + 向上增强，符合"移动优先只向上增强"的约定）。
       *
       * ⚠️ 若改这里的断点，必须同时改 `hooks/useViewport.ts` 的 `MOBILE_QUERY`，
       *    否则会出现"JS 以为该显示、CSS 把它藏了"的空窗。
       */
      className="flt sm:hidden absolute inset-x-0 bottom-0 z-28 flex flex-col rounded-t-[16px] rounded-b-none"
      style={{
        // 拖动中跟着手指走（方向见 `dragHeight`）；松手回落到档位值（用 transition 收尾）
        height: dragHeight ?? height,
        transition: dragOffset !== null ? 'none' : 'height .22s cubic-bezier(.32,.72,0,1)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      {/* 把手：既是拖拽抓点，也是"点一下切档"的按钮 */}
      <div
        onPointerDown={onHandleDown}
        role="button"
        tabIndex={0}
        aria-label={longPressHandle ? '长按拖动或点击切换高度' : '拖动或点击切换高度'}
        /*
         * ★ 触控区从 20px 加到 26px（2026-10-25）：它是"点一下切档 + 拖动"的双用把手，
           `pt-2.5 pb-1.5` 只有 10+4+6=20px，实测在手机上很难点准。
           视觉条仍是 4px（`h-1`），只是外面那圈留白加大 —— 不靠加粗来放大。
        */
        className="flex flex-none cursor-grab touch-none justify-center pt-3 pb-2.5 active:cursor-grabbing"
      >
        <span className="h-1 w-9 rounded-full bg-ink-2/25" aria-hidden="true" />
      </div>

      {header ? <div className="flex-none px-4 pb-2.5">{header}</div> : null}

      <div className="scroll min-h-0 flex-1">{children}</div>

      {footer ? <div className="flex flex-none gap-2 border-t border-line px-4 py-2.5">{footer}</div> : null}
    </div>
  )
}

/** Sheet 头部的一行标题（主文案 + 副文案） */
export function SheetHead({ title, sub }: { title: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-2">
        <b className="truncate text-[16px] font-semibold md:text-[14.5px]">{title}</b>
      </div>
      {sub ? <div className="mt-0.5 truncate text-[13.5px] text-ink-2 md:text-xs">{sub}</div> : null}
    </div>
  )
}

/** 档位切换按钮（调试 / 无障碍双用：没有它，键盘用户无法改变 Sheet 高度） */
export function SheetTierButtons({ tier, onTier }: { tier: SheetTier; onTier: (t: SheetTier) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      {ORDER.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onTier(t)}
          aria-pressed={tier === t}
          className={`flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] ${
            tier === t ? 'border-primary bg-primary text-white' : 'border-line text-ink-2'
          }`}
        >
          <Icon name={t === 'peek' ? 'minus' : t === 'half' ? 'minus' : 'plus'} size="sm" />
          {t}
        </button>
      ))}
    </div>
  )
}
