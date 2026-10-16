/**
 * 「取点模式」的屏幕级提示。
 *
 * ## 为什么它在**外壳**而不是面板里（2026-09-26 修）
 * 它原来长在 `RoutePlanPanelBody` 里 —— 于是 `absolute left-1/2` 是相对**面板**
 * 定位的（`Overlay` 自带 `position: absolute`，是最近的定位祖先）。表现是提示被
 * 挤在 360px 的面板宽度里**折成三行**，而它想说的"点地图上任意位置"指的是**整张地图**。
 * ⇒ 挂在 `routes/map-shell.tsx`（和 `PlanToast` 同一档），定位基准才是屏幕。
 *
 * ## ★ 版式已统一到 `ToastBar`（2026-10-16）
 * 它与「加进行程」的提示现在共用同一个组件与同一个位置（顶端居中）——
 * 用户报「提示到处挂，没统一」并选了全部上顶部。
 * ⇒ 这里只剩**内容**这一个自由度：这是一条**引导**（告诉用户下一步怎么做），
 *   所以没有「打开」那类动作，只有一个「退出」。
 */

import { usePlanUi } from '~/common/logic/itinerary/planUi'
import { ToastBar } from '~/common/ui/ToastBar'

export function PickingHint() {
  const picking = usePlanUi((s) => s.picking)
  const stopPicking = usePlanUi((s) => s.stopPicking)

  if (!picking) return null

  return (
    <ToastBar
      kind="info"
      onClose={stopPicking}
      closeLabel="退出取点模式"
      action={{ label: '退出（Esc）', onClick: stopPicking }}
    >
      点地图上任意位置，把它加进这个组
    </ToastBar>
  )
}