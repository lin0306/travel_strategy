/**
 * 顶栏的「路线规划」入口（plans/13 §6.1）。
 *
 * ## 为什么单独一个组件
 * 顶栏在**每个页面**各渲染一份（`TopBar` 是公共件），而面板全站只有一块。
 * 这个按钮要做的事就一件：把全局的 `planUi.panelOpen` 翻过来 ——
 * 它不持有任何状态，所以渲染几份都不冲突。
 *
 * ## 为什么带条数徽标
 * "我到底有几条规划"是打开面板之前唯一值得先知道的事。
 * ★ 但 **0 条时不显示徽标**：一个写着「0」的角标是噪音，还会被读成"出错了"（红线 10 同款）。
 *
 * ## 断点
 * 它占约 90px，而顶栏在 768px 已经挤（搜索框 `md`、站点导航 `lg`）。
 * 所以它在 `sm` 以下**只留图标**，`sm` 起才带文字 —— 与底图菜单的收法一致。
 *
 * ## 图标用 `md`（16px）而不是 `sm`（14px）
 * `route` 是两个圆 + S 形连线，14px 时 1 个单位只有 0.58px，S 的弯会糊成一团。
 * 16px 时与旁边 12.5px 的文字也更协调（按钮高 32px，放得下）。
 */

import { usePlanStore } from '~/common/logic/itinerary/planStore'
import { usePlanUi } from '~/common/logic/itinerary/planUi'
import { Icon } from '~/common/ui/Icon'

export function PlanMenuButton() {
  const open = usePlanUi((s) => s.panelOpen)
  const toggle = usePlanUi((s) => s.togglePanel)
  const count = usePlanStore((s) => s.plans.length)

  return (
    <button
      type="button"
      onClick={toggle}
      aria-expanded={open}
      aria-label={count > 0 ? `路线规划（${count} 条）` : '路线规划'}
      className={`inline-flex h-8 flex-none items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] transition-colors sm:px-3 ${
        open
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-line bg-surface text-ink hover:border-primary hover:text-primary'
      }`}
    >
      <Icon name="route" size="md" />
      <span className="hidden sm:inline">路线规划</span>
      {count > 0 ? (
        <span className="rounded-full bg-line-2 px-1.5 text-[11px] text-ink-2">{count}</span>
      ) : null}
    </button>
  )
}
