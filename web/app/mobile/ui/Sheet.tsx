/**
 * 底部浮层 —— **移动端所有面板的基座**（可拖 + 下拉/点外部收起）。
 *
 * ## 谁在用它
 * | 浮层 | 尺寸模式 | 收起方式 | 互斥 |
 * |------|---------|---------|------|
 * | 城市清单（`mobile/ui/CityView`） | 三档 | 不收 —— 它就是这一页的主体 | 只赶人、不被赶 |
 * | 景点详情（`PoiDetailSheet` / `PoiView`） | 三档 | 下拉 / 点外部 | 参与 |
 * | 路线规划（`RoutePlanPanel`） | 三档 | 下拉 / 点外部 | 参与 |
 * | 图层（`BasemapSheet`） | **自由拉伸** | 下拉 / 点外部 | 参与 |
 *
 * 传 `onClose` 才有收起能力（判据与手势在 `useSheetDrag`，那边文件头写了
 * "位置 **或** 速度"为什么要两条）。
 *
 * ## ★★★ 同一时刻只有一块「可选浮层」
 * 有出口的三块（详情 / 规划 / 图层）走 `mobile/ui/sheetHub` 的仲裁：谁新开谁把
 * 别的关掉；页面主体（清单）挂载时清场、自己不会被关。用户 2026-10-28：
 * 「这个浮层，同时只显示一个吧，不要隐藏一个下方还有一个」。
 *
 * ## 两种尺寸模式（2026-10-28）
 * - **三档**（`tier` + `onTier`）：`peek 28 / half 56 / full 88` svh，松手吸附到相邻档。
 * - **自由**（`size`）：用户拖到哪停哪，只夹在 `min..max` 之间。图层用它 ——
 *   用户原话：「这个浮层，不做固定三个大小，改成用户默认拉，限制最大高度和最小高度」。
 *
 * 两者共用同一套手势与同一条收起判据：**拖到比最小高度还低**（或快速下甩）就关。
 *
 * ## 高度用 svh，不用 vh
 * 移动端 `100vh` 把地址栏算在内，实际比可视区高 56–80px —— 用 vh 的话
 * `full` 档底部会被推到屏幕外。`svh` 取**最小可视高度**（按最坏情况布局），
 * `dvh` 会随地址栏收放抖动，不用。
 *
 * ## ★★ 层级：`z-28` 压在右下角工具条（`z-[27]`）之上
 * 用户 2026-10-28 第三次定稿：「浮层永远在最上」。
 * ⇒ 浮层升起时那四枚被盖住（城市页的清单浮层常驻，所以四枚在城市页看不见 ——
 *   这是这条选择的已知代价，已向用户确认过；首页/点位详情页没有常驻浮层，四枚照常可点）。
 * ★ 别再让它跟着浮层高度跑（`--sheet-h` 那套已删）：用户要的是"固定在底部，
 *   不会被其他东西往上挤"。
 */

import { useState, type ReactNode } from 'react'

import { Icon } from '~/common/ui/Icon'
import { MIN_DRAG_PX, SHEET_ORDER, SHEET_TIER_SVH, type SheetTier } from '~/mobile/ui/sheetTier'
import { useSheetDrag } from '~/mobile/ui/useSheetDrag'

/* 尺寸模型（类型 + 顺序 + 高度）的唯一出处是 `sheetTier`；调用方只认 `Sheet` */
export * from '~/mobile/ui/sheetTier'

/** 自由拉伸模式的尺寸（单位都是 svh） */
export interface SheetSize {
  min: number
  max: number
  initial: number
}

export interface SheetProps {
  /** 三档模式用。与 `size` 二选一 */
  tier?: SheetTier
  onTier?: (tier: SheetTier) => void
  /** 自由拉伸模式用。给了它就不看 `tier` */
  size?: SheetSize
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
  const { children, footer, header, label, onClose, size } = props
  const free = Boolean(size)

  /**
   * 自由模式下**用户拉到的位置**（svh）。三档模式不用它。
   * ★ 存 svh 而不是 px：这样 `height`、`clamp()` 的下限、拖动中的 `calc()`
   *   三处都是同一套单位，不必在渲染期去问 `window.innerHeight`（SSG 首帧没有）。
   */
  const [freeSvh, setFreeSvh] = useState(size?.initial ?? SHEET_TIER_SVH.half)

  const { rootRef, contentRef, dragOffset, onHandleDown, onContentDown, onClickCapture, onDragStart } =
    useSheetDrag({
      tier: props.tier ?? 'half',
      onTier: props.onTier,
      onClose,
      longPressHandle: props.longPressHandle ?? false,
      /** 收起判据的分界线：三档 = `peek` 档；自由 = `size.min` */
      minSvh: size?.min ?? SHEET_TIER_SVH.peek,
      maxSvh: size?.max,
      onResize: free ? setFreeSvh : undefined,
    })

  const baseSvh = free ? freeSvh : SHEET_TIER_SVH[props.tier ?? 'half']
  const base = `calc(${baseSvh}svh + env(safe-area-inset-bottom, 0px))`

  /**
   * 拖动中的实时高度 = 基准高度 **减去** 位移。
   *
   * ★★ `dragOffset = clientY − startY`：**往上拖是负数**，所以必须 `base − dragOffset`
   *   （负负得正 ⇒ 长高）。2026-10-25 之前写的是 `base − (−dragOffset)` ⇒ **往上拖反而变矮**，
   *   那就是用户报的「上下拉是反的」。
   * ★ 可以收起时下限放 0（拉过阈值整块滑走），否则留 `MIN_DRAG_PX` 防缩成一条缝。
   * ★ 自由模式的上限是 `size.max`，三档的上限是 `100svh` —— 用户往上拉得比 full 还高也不该
   *   出屏（`full` 档本身只到 88）。
   */
  const floorPx = onClose ? 0 : MIN_DRAG_PX
  const ceil = free && size ? `${size.max}svh` : '100svh'
  const dragHeight =
    dragOffset === null
      ? null
      : `clamp(${floorPx}px, calc(${base} - ${Math.round(dragOffset)}px), ${ceil})`

  /**
   * 收起过程中的淡出：让"再拉就没了"看得见（否则浮层在到达阈值前一直是实心的，
   * 松手瞬间突然消失像出错）。两种模式的"开始淡出点"不同：
   *   · 三档：只有 `peek` 档往下拉才可能收起 ⇒ 拉过 40px 开始；
   *   · 自由：拉到低于 `min` 才开始（在那之前他只是在把浮层拉矮一点，不该淡）。
   */
  const dy = dragOffset ?? 0
  let fade = 1
  if (onClose && dragOffset !== null && dy > 0) {
    if (free) {
      /** 100svh 大约等于 `innerHeight` —— 这里只求量级对，不用精确 */
      const pxPerSvh = window.innerHeight / 100
      const over = (dy / pxPerSvh - (baseSvh - (size?.min ?? 0))) * pxPerSvh
      if (over > 0) fade = Math.max(0.45, 1 - over / 120)
    } else if (props.tier === 'peek' && dy > 40) {
      fade = Math.max(0.45, 1 - (dy - 40) / 220)
    }
  }

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
 * ★ `sub` 是可选的，**不是每个浮层都该有**：图层浮层原来写的是当前底图名，
 *   而下面第一条选项就是"矢量图/影像图"（还打着勾）—— 同一屏说两遍
 *   （用户 2026-10-28：「这个标题的副标题不需要」）。
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
