/**
 * 浮层基础件。
 *
 * 「地图即画布」的四条规则在**组件层面**的落点：
 * ② UI 一律 absolute + 白底 + 圆角 + 投影 → `Overlay`
 * ③ 浮层定宽/定档位 → `width` 走 token，绝不用 `flex:1` 去挤地图
 * ④ 关掉浮层地图不变形 → 浮层是"盖"上去的，不参与任何流式布局
 *
 * ★ `data-overlay` 属性不是装饰：`fitView.ts` 靠它（配合 `querySelectorAll`）
 *   实测浮层占用，反推地图可用区。漏了这个属性，视野适配就会把点位框到浮层底下。
 */

import type { ReactNode } from 'react'

export type OverlayAnchor =
  | 'top'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'left'
  | 'right'
  | 'bottom'
  | 'fill'

export interface OverlayProps {
  anchor: OverlayAnchor
  /** 宽度。优先传 token 变量名（`'--panel-left'`），避免硬编码 */
  widthToken?: string
  /** 直接给宽度（仅在这块确实不该有 token 时用，如"自适应"的提示条） */
  width?: number | string
  children: ReactNode
  className?: string
  /** 让浮层占满可用高度（左面板 / 详情面板用） */
  tall?: boolean
  z?: number
  /** 关掉入场动画（如换档时的尺寸变化不适合再动画一次） */
  noAnim?: boolean
  /**
   * 无障碍名（同时给 `role="region"`）。
   *
   * ★ 为什么值得单独一个 prop：地图上有**好几块** `data-overlay` ——
   *   顶栏、左面板、景点详情、规划面板…… 屏幕阅读器只会念"区域"，
   *   用户分不清自己跳到了哪一块。而验收脚本同样需要它：
   *   按文字内容去找浮层会**误命中顶栏**（顶栏里也有"路线规划"三个字），
   *   这个坑在 `cdp_planflow_verify.mjs` 第一次跑时真踩了。
   */
  label?: string
}

function anchorStyle(anchor: OverlayAnchor): React.CSSProperties {
  const i = 'var(--flt-inset)'
  /*
   * ★ `--rail-top` 是**顶栏下方**的起点，只给"顶栏底下的浮层"用。
   *   顶栏自己贴 `--flt-inset`（'top' / 'top-left' / 'top-right'）。
   *
   *   踩过的坑：早先把 top-left / top-right 也写成 `--rail-top`，而当时
   *   `--rail-top = 52px + inset*2 + gap`（= 96px）—— 于是顶栏整体下移了
   *   一整条高度，屏幕顶端空出一片，看起来像"顶部没做任何东西"。
   *   两个语义必须分开：**顶栏的 top** 与 **顶栏下方的 top** 不是一回事。
   */
  const t = 'var(--rail-top)'
  switch (anchor) {
    case 'top':
      // 通栏顶栏：左右都贴边，中间不留缝
      return { top: i, left: i, right: i }
    case 'top-left':
      return { top: i, left: i }
    case 'top-right':
      return { top: i, right: i }
    case 'bottom-left':
      return { bottom: i, left: i }
    case 'bottom-right':
      return { bottom: i, right: i }
    case 'left':
      return { top: t, left: i, bottom: 'calc(var(--flt-inset) + 40px)' }
    case 'right':
      return { top: t, right: i, bottom: 'calc(var(--flt-inset) + 40px)' }
    case 'bottom':
      return { bottom: i, left: '50%', transform: 'translateX(-50%)' }
    case 'fill':
      return { inset: i }
  }
}

export function Overlay({
  anchor,
  widthToken,
  width,
  children,
  className,
  tall = false,
  z = 20,
  noAnim = false,
  label,
}: OverlayProps) {
  return (
    <div
      data-overlay=""
      {...(label ? { role: 'region' as const, 'aria-label': label } : {})}
      className={`flt ${noAnim ? '' : 'flt-in'} flex flex-col ${tall ? 'min-h-0' : ''} ${className ?? ''}`}
      style={{
        ...anchorStyle(anchor),
        width: widthToken ? `var(${widthToken})` : width,
        zIndex: z,
      }}
    >
      {children}
    </div>
  )
}

/**
 * 浮层内的小按钮（胶囊）。
 *
 * ⚠️ 不提供 `title` 属性 —— 项目约定：所有界面提示统一用 Tooltip 组件。
 *    HTML 原生 `title` 在移动端**根本不显示**，在桌面端也有一秒延迟且无法定制，
 *    用它等于"给一半用户看不到、给另一半用户看个丑的"。
 */
export interface ChipProps {
  children: ReactNode
  onClick?: () => void
  active?: boolean
  className?: string
  /** 无障碍标签：图标按钮必须有，否则屏幕阅读器只念出一个空按钮 */
  label?: string
  disabled?: boolean
}

export function Chip({ children, onClick, active = false, className, label, disabled }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={onClick ? active : undefined}
      className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] whitespace-nowrap transition-colors ${
        active
          ? 'border-primary bg-primary text-white'
          : 'border-line bg-surface text-ink hover:border-primary hover:text-primary'
      } ${disabled ? 'cursor-not-allowed opacity-40' : ''} ${className ?? ''}`}
    >
      {children}
    </button>
  )
}

/** 面板区块标题：小字大写字距，用来切分长列表 */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-3.5 pt-3 pb-1.5 text-[11px] font-semibold tracking-wide text-ink-2">
      {children}
    </div>
  )
}

/** 空态：图标 + 一句话 + （可选）动作 */
export function EmptyState({
  icon,
  title,
  detail,
  action,
}: {
  icon?: ReactNode
  title: string
  detail?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      {icon ? <div className="text-ink-2/60">{icon}</div> : null}
      <p className="m-0 text-[13.5px] font-medium">{title}</p>
      {detail ? <p className="m-0 max-w-[240px] text-xs leading-relaxed text-ink-2">{detail}</p> : null}
      {action}
    </div>
  )
}
