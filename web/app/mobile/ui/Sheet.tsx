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
 * ## 三条实现细节
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
 *
 * ### ★★ 内容区「过拉」也能拖浮层（2026-10-27）
 * 用户报「浮层的滚动没办法用，鼠标直接拖、按住拖都不行」—— 实测把手拖拽
 * 5/5 通过、内容区滚轮与触摸也都能滚，**唯一没反应的是"拖内容区"**：
 * 整块浮层只有顶部那 26px 的把手能拖，而人不会去挑那一条 —— 他按在列表上往下拉，
 * 期待浮层跟着走（原生 App 的 Sheet 全都这样）。
 *
 * 判据是**边界过拉**：滚到顶还继续往下拉、滚到底还继续往上拉，才把这段位移
 * 转为浮层高度；中间位置的拖动照旧交给原生滚动。
 *
 * ★ 触摸必须 `preventDefault` 掉 `touchmove`，否则原生滚动会和拖动同时进行
 *   （浮层在变高、内容也在滚）。而 React 的 `onTouchMove` 是 **passive** 的，
 *   在里面 `preventDefault()` 静默无效 —— 只能用 `addEventListener(..., { passive: false })`
 *   手动挂，这是本文件唯一一个非 React 事件。
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

/** 内容区过拉判定阈值（px）。小于它当作抖动 / 点击，不算"要拖动浮层" */
const OVERPULL_PX = 10

export function Sheet({ tier, onTier, children, footer, header, longPressHandle = false, label }: SheetProps) {
  const [dragOffset, setDragOffset] = useState<number | null>(null)
  const dragRef = useRef<{ startY: number; armed: boolean; timer: number | null } | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  /**
   * 内容区按下的状态。`mode`：0 = 还没判定（可能只是一次普通点击/滚动），
   * 1 = 已判定为"下拉收起"，2 = 已判定为"上拉展开"。
   */
  const overRef = useRef<{ startX: number; startY: number; startTop: number; max: number; mode: 0 | 1 | 2 } | null>(null)
  /** 拖完浮层后吞掉随之而来的那次 click —— 否则松手会"点开"手指下面的那条景点 */
  const swallowClickRef = useRef(false)

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
      /* ① 内容区过拉 → 拖动整块浮层（判据见文件头「内容区过拉」） */
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
              dragRef.current = { startY: o.startY, armed: true, timer: null }
              // 鼠标拖到这里已经在正文里拉出一片选区了 —— 判定成立的瞬间清掉，
              // 否则松手时浮层收起了、文字还是反白的
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
        swallowClickRef.current = true
        window.setTimeout(() => {
          swallowClickRef.current = false
        }, 350)
        endDrag(e.clientY - o.startY)
        return
      }
      /* ② 把手 */
      const d = dragRef.current
      if (!d) return
      dragRef.current = null
      if (!d.armed) return // 长按还没到位就被抬起 → 不算拖拽
      endDrag(e.clientY - d.startY)
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

  /**
   * 触摸：判定为"拖浮层"之后必须 `preventDefault()`，否则原生滚动会和拖动同时发生。
   * ★ React 的 `onTouchMove` 是 passive 的，在里面 preventDefault 无效 ⇒ 只能手动挂。
   */
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const onTouchMove = (e: TouchEvent) => {
      if (overRef.current && overRef.current.mode !== 0) e.preventDefault()
    }
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => el.removeEventListener('touchmove', onTouchMove)
  }, [])

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

  /** 内容区按下：只记录起手信息，**不拦截**任何东西 —— 判定在 `pointermove` 里做 */
  const onContentDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // ★ 行程页的时间轴自己吃手势，内容区不参与拖浮层
    if (longPressHandle) return
    const root = e.currentTarget
    /*
     * ★ 记的是**离手指最近的那个**可滚容器的位置，不是 `root` 的。
     *   Sheet 里的滚动容器常常是嵌套的（正文自己再套一层 `.scroll`），
     *   读错那一层的 `scrollTop` 会让"滚到顶/底"判反 —— 于是往下拖永远触发不了、
     *   或者反过来把普通滚动抢走。这类错**不会报错**，只会"有时候拖不动"。
     */
    let el: HTMLElement | null = e.target as HTMLElement
    let box: HTMLElement = root
    while (el && el !== root) {
      /*
       * ★ 必须**同时**要求 `overflow-y: auto|scroll`。
       *   只看 `scrollHeight > clientHeight` 会把 `line-clamp-N` 的摘要当成滚动容器
       *   （它是 `overflow: hidden`，但内容确实溢出）⇒ 记下 `startTop: 0`
       *   ⇒ 手指落在任何一段被截断的摘要上往下拖，都会被判成"滚到顶了，可以拉浮层"。
       *   表现是"有时候莫名其妙整个面板跟着往下掉"，而且只在某些位置上复现。
       */
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
      mode: 0,
    }
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

      <div
        ref={contentRef}
        className="scroll min-h-0 flex-1"
        onPointerDown={onContentDown}
        onPointerCancel={() => {
          overRef.current = null
        }}
        /*
         * ★ 拖完浮层的那次 click 要吞掉：松手的位置往往正好压在某个列表项上，
         *   不拦就会"拖一下浮层 → 顺手打开了第三个景点"。只在拖动刚结束时生效（350ms）。
         */
        onClickCapture={(e) => {
          if (!swallowClickRef.current) return
          swallowClickRef.current = false
          e.preventDefault()
          e.stopPropagation()
        }}
        /*
         * ★ 图片默认 `draggable`：鼠标按在图上拖会启动**原生拖拽**，浏览器随即
         *   `pointercancel` 掉这条指针链 ⇒「按在图上拖=收起浮层」直接失效。
         *   详情页首屏就是一整块大图，起手位置十有八九落在图上，所以这不是边角情况。
         *   ★ 只拦 `IMG`，不碰别的 `draggable` 元素 —— 行程页的时间轴排序靠原生 DnD。
         */
        onDragStart={(e) => {
          if ((e.target as HTMLElement).tagName === 'IMG') e.preventDefault()
        }}
      >
        {children}
      </div>

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
