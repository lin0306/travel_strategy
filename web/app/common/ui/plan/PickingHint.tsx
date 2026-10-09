/**
 * 「取点模式」的屏幕级提示。
 *
 * ## 为什么它在**外壳**而不是面板里（2026-09-26 修）
 * 它原来长在 `RoutePlanPanelBody` 里 —— 于是 `absolute left-1/2` 是相对**面板**
 * 定位的（`Overlay` 自带 `position: absolute`，是最近的定位祖先）。表现是提示被
 * 挤在 360px 的面板宽度里**折成三行**，而它想说的"点地图上任意位置"指的是**整张地图**。
 * ⇒ 挂在 `routes/map-shell.tsx`（和 `PlanToast` 同一档），定位基准才是屏幕。
 *
 * ## 为什么不带 `data-overlay`
 * 它是一次交互的瞬时提示，不是面板。带上的话 `fitView` 的浮层实测会把它算进
 * "地图可用区"，地图会为一条几秒后就消失的提示白让一块位置。
 */

import { usePlanUi } from '~/common/logic/itinerary/planUi'
import { Icon } from '~/common/ui/Icon'

export function PickingHint() {
  const picking = usePlanUi((s) => s.picking)
  const stopPicking = usePlanUi((s) => s.stopPicking)

  if (!picking) return null

  return (
    <div
      role="status"
      className="flt flt-in absolute left-1/2 z-[25] flex -translate-x-1/2 items-center gap-2 px-3 py-1.5 whitespace-nowrap"
      style={{ top: 'var(--rail-top)' }}
    >
      <Icon name="locate" size="sm" className="text-primary" />
      <span className="text-[12.5px]">点地图上任意位置，把它加进这个组</span>
      <button
        type="button"
        onClick={stopPicking}
        className="ml-1 rounded-md px-1.5 py-0.5 text-[11.5px] text-ink-2 hover:bg-line-2 hover:text-ink"
      >
        退出（Esc）
      </button>
    </div>
  )
}
