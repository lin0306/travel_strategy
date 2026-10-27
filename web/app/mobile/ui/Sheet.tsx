/**
 * 底部浮层 —— **移动端所有面板的基座**（三档吸附 + 下拉/点外部收起）。
 *
 * ## 谁在用它
 * | 浮层 | 收起方式 |
 * |------|---------|
 * | 城市清单（`mobile/ui/CityView`） | 不收 —— 它就是这一页的主体 |
 * | 景点详情（`PoiDetailSheet` / `PoiView`） | 下拉 / 点外部 |
 * | 路线规划（`RoutePlanPanel`） | 下拉 / 点外部 |
 * | 图层（`BasemapSheet`） | 下拉 / 点外部 |
 *
 * 传 `onClose` 才有收起能力（判据与手势在 `useSheetDrag`，那边文件头写了
 * "距离 **或** 速度"为什么不二选一）。
 *
 * ## 三档的语义（08 文档）
 * | 档 | 高度 | 露出什么 |
 * |----|------|---------|
 * | `peek` | 28svh | 把手 + 一行摘要（城市页 = 城市名；详情页 = 景点名） |
 * | `half` | 56svh | 默认档。列表 / 时间轴主体 + 汇总 |
 * | `full` | 88svh | 完整内容 |
 *
 * ## 高度用 svh，不用 vh
 * 移动端 `100vh` 把地址栏算在内，实际比可视区高 56–80px —— 用 vh 的话
 * `full` 档底部会被推到屏幕外。`svh` 取**最小可视高度**（按最坏情况布局），
 * `dvh` 会随地址栏收放抖动，不用。
 *
 * ## ★★★ 层级 + **高度广播**：工具条跟着浮层上移
 *
 * 右下角工具条（`mobile/ui/MapTools`）是 `z-[27]`，**低于**本浮层 —— 内容压住工具。
 * 但只做这一条还不够：浮层最矮的 `peek` 档也有 28svh，「浮层之下的右下角」根本不存在，
 * 一旦浮层升起，工具条就被整块吞掉（城市页的浮层还永不收起）。
 *
 * ⇒ 本组件把**自身高度**写到 `:root` 的 `--sheet-h` 并派发 `sheet-resize`，
 *   工具条据此 `bottom: calc(var(--sheet-h) + var(--flt-inset))` ——
 *   视觉上永远是"右下角"，浮层升起时它就贴在浮层上沿。`full` 档时高度加上工具条
 *   会超出屏幕，工具条按同一份数据判定后**整条不渲染**。
 */

import { useEffect, type ReactNode, type RefObject } from 'react'

import { Icon } from '~/common/ui/Icon'
import {
  MIN_DRAG_PX,
  SHEET_H_VAR,
  SHEET_ORDER,
  SHEET_RESIZE_EVENT,
  SHEET_TIER_SVH,
  type SheetTier,
} from '~/mobile/ui/sheetTier'
import { useSheetDrag } from '~/mobile/ui/useSheetDrag'

/* 档位模型（类型 + 顺序 + 高度）的唯一出处是 `sheetTier`；调用方只认 `Sheet` */
export * from '~/mobile/ui/sheetTier'

/**
 * 当前挂着的浮层元素（用 `Set` 而不是单个变量：城市页与规划浮层**可以同时存在**）。
 * ★ 取**最大**高度对外广播 —— 工具条要让开的是最高的那块。
 */
const liveSheets = new Set<HTMLElement>()

/**
 * 把浮层高度写到 `:root` 的 `--sheet-h`，并派发 `sheet-resize` 事件。
 *
 * 两个消费方，缺一不可：
 *   · CSS：右下角工具条用 `bottom: calc(var(--sheet-h) + …)` 跟着浮层上移；
 *   · JS：工具条还要判「升高之后是否还放得下」，放不下就整条不渲染。
 *
 * ★ 用 `useEffect` 而不是 `useLayoutEffect`：本站是 SSG（`react-router` 预渲染），
 *   `useLayoutEffect` 在服务端会打警告。这里也不需要"布局前"这个时序 ——
 *   `ResizeObserver` 挂上就会立刻回调一次。
 * ★ 用 `rAF` 合帧：拖动浮层时高度每帧都变，不合并的话一个手势能派发上百次。
 */
function usePublishHeight(ref: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const root = document.documentElement
    let raf = 0

    const publish = () => {
      raf = 0
      let h = 0
      for (const node of liveSheets) h = Math.max(h, Math.round(node.getBoundingClientRect().height))
      root.style.setProperty(SHEET_H_VAR, `${h}px`)
      window.dispatchEvent(new CustomEvent<number>(SHEET_RESIZE_EVENT, { detail: h }))
    }
    const schedule = () => {
      if (raf === 0) raf = requestAnimationFrame(publish)
    }

    liveSheets.add(el)
    const ro = new ResizeObserver(schedule)
    ro.observe(el)
    publish()

    return () => {
      ro.disconnect()
      if (raf !== 0) cancelAnimationFrame(raf)
      liveSheets.delete(el)
      publish()
    }
  }, [ref])
}

export interface SheetProps {
  tier: SheetTier
  onTier: (tier: SheetTier) => void
  children: ReactNode
  /**
   * 无障碍名（`aria-label`）。
   * ★ 屏幕上可能同时有好几块 `data-overlay`（顶栏、城市列表、规划……），
   *   屏幕阅读器只会念"区域"。验收脚本同样需要它 —— 按文字找会**误命中顶栏**
   *   （那里也有"路线规划"三个字），这个坑在移动端探针上真踩过。
   */
  label?: string
  /** 固定在底部不随内容滚动的操作条 */
  footer?: ReactNode
  /** 浮层内部标题（把手下方，通常给 `<SheetHead>`） */
  header?: ReactNode
  /** 时间轴自己处理拖拽时置 true —— 把手改为长按激活，避免抢手势 */
  longPressHandle?: boolean
  /** 给了才有「下拉收起 / 点外部收起 / Esc 收起」 */
  onClose?: () => void
}

export function Sheet(props: SheetProps) {
  const { tier, children, footer, header, label, onClose } = props
  const { rootRef, contentRef, dragOffset, onHandleDown, onContentDown, onClickCapture, onDragStart } =
    useSheetDrag({
      tier: props.tier,
      onTier: props.onTier,
      onClose,
      longPressHandle: props.longPressHandle ?? false,
    })

  usePublishHeight(rootRef)

  const base = `calc(${SHEET_TIER_SVH[tier]}svh + env(safe-area-inset-bottom, 0px))`  /**
   * 拖动中的实时高度 = 基准高度 **减去** 位移。
   *
   * ★★ `dragOffset = clientY − startY`：**往上拖是负数**，所以必须 `base − dragOffset`
   *   （负负得正 ⇒ 长高）。2026-10-25 之前写的是 `base − (−dragOffset)` ⇒ **往上拖反而变矮**，
   *   那就是用户报的「上下拉是反的」。
   * ★ 可以收起时下限放 0（拉过阈值整块滑走），否则留 `MIN_DRAG_PX` 防缩成一条缝。
   */
  const minPx = onClose ? 0 : MIN_DRAG_PX
  const dragHeight =
    dragOffset === null ? null : `clamp(${minPx}px, calc(${base} - ${Math.round(dragOffset)}px), 100svh)`

  /** 收起过程中的淡出：只在最矮档往下拉时给，让"再拉就没了"看得见 */
  const dy = dragOffset ?? 0
  const fade = onClose && tier === 'peek' && dy > 40 ? Math.max(0.45, 1 - (dy - 40) / 220) : 1

  return (
    <div
      ref={rootRef}
      data-overlay=""
      {...(label ? { role: 'region' as const, 'aria-label': label } : {})}
      /*
       * ★ `sm:hidden` 不是冗余 —— 它是"桌面端首帧不闪手机版抽屉"的唯一保障：
       *   SSG 预渲染时没有 window，按**移动优先**渲染成浮层；桌面用户拿到的 HTML
       *   里就有一份，要等水合后才换掉（实测约 100ms）。用 CSS 兜住这一段，
       *   与 `useIsMobile()` 的 `(max-width: 639px)` 严格互补。
       *   ⚠️ 改这里的断点必须同时改 `common/logic/useViewport.ts` 的 `MOBILE_QUERY`。
       */
      className="flt sm:hidden absolute inset-x-0 bottom-0 z-28 flex flex-col rounded-t-[16px] rounded-b-none"
      style={{
        height: dragHeight ?? base,
        transition: dragOffset === null ? 'height .22s cubic-bezier(.32,.72,0,1), opacity .18s' : 'none',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        opacity: fade,
      }}
    >
      {/* 把手：既是拖拽抓点，也是"点一下切档"的按钮。视觉条 4px，触控区靠上下留白做到 26px */}
      <div
        onPointerDown={onHandleDown}
        role="button"
        tabIndex={0}
        aria-label={props.longPressHandle ? '长按拖动或点击切换高度' : '拖动或点击切换高度'}
        className="flex flex-none cursor-grab touch-none justify-center pt-3 pb-2.5 active:cursor-grabbing"
      >
        <span className="h-1 w-9 rounded-full bg-ink-2/25" aria-hidden="true" />
      </div>

      {header ? <div className="flex-none px-4 pb-2.5">{header}</div> : null}

      <div
        ref={contentRef}
        className="scroll min-h-0 flex-1"
        onPointerDown={onContentDown}
        onClickCapture={onClickCapture}
        onDragStart={onDragStart}
      >
        {children}
      </div>

      {footer ? <div className="flex flex-none gap-2 border-t border-line px-4 py-2.5">{footer}</div> : null}
    </div>
  )
}

/**
 * 浮层头部的一行标题（主文案 + 副文案 + 右侧动作）。
 *
 * ★ `action` 固定在**右端**而不是紧跟标题后面：景点名的长度差得很远
 *   （「西湖」两字 vs 「重庆中国三峡博物馆」九字），紧跟的话按钮每换一个点位就横移一次，
 *   肌肉记忆归零、连点两下会点空。标题让位（`truncate`），按钮位置恒定。
 */
export function SheetHead({
  title,
  sub,
  action,
}: {
  title: ReactNode
  sub?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <b className="block truncate text-[16px] font-semibold md:text-[14.5px]">{title}</b>
        {sub ? <div className="mt-0.5 truncate text-[13.5px] text-ink-2 md:text-xs">{sub}</div> : null}
      </div>
      {action ? <div className="flex flex-none items-center gap-1.5">{action}</div> : null}
    </div>
  )
}

/** 档位切换按钮（无障碍用：没有它，键盘用户无法改变浮层高度） */
export function SheetTierButtons({ tier, onTier }: { tier: SheetTier; onTier: (t: SheetTier) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      {SHEET_ORDER.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onTier(t)}
          aria-pressed={tier === t}
          className={`flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] ${
            tier === t ? 'border-primary bg-primary text-white' : 'border-line text-ink-2'
          }`}
        >
          <Icon name={t === 'full' ? 'plus' : 'minus'} size="sm" />
          {t}
        </button>
      ))}
    </div>
  )
}
