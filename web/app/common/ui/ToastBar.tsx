/**
 * 浮层提示条 —— 全站**唯一**的瞬时提示出口。
 *
 * ## 为什么要抽这一个组件（2026-10-16 用户报「提示到处挂，没统一」）
 * 改之前有三条各自为政的提示，定位各不相同：
 *
 * | 原组件 | 原位置 | 性质 |
 * |--------|--------|------|
 * | `PlanToast` | 底部居中 | 操作结果（"已加入行程"） |
 * | `PickingHint` | 顶部居中 | 交互引导（"点地图任意位置"） |
 * | `MapStatusCard` | 右上角 | ★ **不是瞬时提示** —— 常驻状态卡，见下 |
 *
 * 用户选了**统一到顶部**（顶部是视线第一落点，且不与移动端底部 Sheet 抢拇指区）。
 * ⇒ 现在两条瞬时提示都渲染成同一个组件，靠 `kind` 区分语气，定位与版式**只有这一处**。
 *
 * ## ★ `MapStatusCard` 为什么不并进来
 * 它是**常驻状态**（不自动消失、还带 key 输入框与重试按钮），而本组件是**自动消失的瞬时条**。
 * 两者的生命周期与可交互性根本不同，硬并成一个组件会得到"既要自动消失又能输入"的东西。
 * ⇒ 但它的**定位**也改到了顶部同一档（`--rail-top`），这样"所有提示都在顶部"是成立的。
 *
 * ## ★ 本组件**不自己定位**
 * 定位与堆叠归 `ToastStack`（本组件是"一条提示"的版式，`ToastStack` 是"几条提示怎么排"）。
 * 这样多条提示同开时才不会叠在一起 —— 早期版本把 `top: var(--rail-top)` 写在这里，
 * 结果两条提示各自绝对定位到同一个 top、直接重叠（现由外层 flex-col 统一排）。
 *
 * ## 为什么顶端居中、而不是右上角
 * ① 顶部居中与顶栏同一视觉轴，读起来是"顶栏在下方回话"；
 * ② 右上角那个位置已经被「关于」入口占着，再塞一条会挤在一起；
 * ③ 底部是移动端 Sheet 的地盘，提示压在那儿会被半截面板盖住。
 *
 * ## 为什么不带 `data-overlay`
 * 那条属性是给 `fitView` 算"地图可用区"用的（见 `Overlay.tsx` 文件头）。
 * 提示 3 秒后就消失，让地图为它白让一块位置不划算 —— 与 `PlanToast` / `PickingHint`
 * 原来的判断一致。
 */

import { Icon } from '~/common/ui/Icon'

/** 语气。三种足够，再多就该换组件而不是加枚举。 */
export type ToastKind = 'info' | 'success' | 'warning'

export interface ToastBarProps {
  kind?: ToastKind
  children: React.ReactNode
  /** 右侧动作（如"打开"）。给了就渲染成可点的胶囊。 */
  action?: { label: string; onClick: () => void }
  /** 关闭按钮。给了才渲染 —— 有些提示不该被提前关掉（比如必须读完的引导）。 */
  onClose?: () => void
  /** 无障碍名（配合 `role="status"`）。图标按钮必须给，否则读屏只念出一个空按钮。 */
  closeLabel?: string
}

/** 各语气的强调色。只改色，不改结构 ⇒ 三种提示的高度与版式永远一致。 */
const ACCENT: Record<ToastKind, string> = {
  info: 'text-primary',
  success: 'text-primary',
  warning: 'text-[#E8672F]',
}

export function ToastBar({ kind = 'info', children, action, onClose, closeLabel = '关闭提示' }: ToastBarProps) {
  return (
    <div
      role="status"
      className="flt flt-in pointer-events-auto flex max-w-[min(560px,92vw)] items-center gap-2 px-3 py-2 text-[12.5px]"
    >
      <span className={`min-w-0 flex-1 ${ACCENT[kind]}`}>{children}</span>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="flex-none rounded-md px-2 py-0.5 text-[12px] font-medium text-primary hover:bg-line-2"
        >
          {action.label}
        </button>
      ) : null}
      {onClose ? (
        <button
          type="button"
          aria-label={closeLabel}
          onClick={onClose}
          className="flex-none rounded-md p-0.5 text-ink-2 hover:bg-line-2 hover:text-ink"
        >
          {/* ★ 用项目自己的 sprite，不内联 <svg>：图标只有一处定义（Icon.tsx 的 PATHS），
              护栏 R 项会断言每个 <Icon name> 都有对应定义，反过来手写路径会绕过它。 */}
          <Icon name="close" size="sm" />
        </button>
      ) : null}
    </div>
  )
}