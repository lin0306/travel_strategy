/**
 * 行程时间链面板 —— **两端共用同一份**（`ItineraryPanel` 的一层接线）。
 *
 * 时间轴一行六个字段（时间 / 点位 / 通勤 / 时长 / 花费 / 动作），抄一遍必然漂：
 * 桌面上改了字段顺序、移动端忘了跟 —— 而这类不一致不会报错，只会让两端"看起来
 * 不太一样"，排查时很难联想到是抄了两份。
 *
 * ★ 两端**唯一**的差别是 `compact`：移动端 `peek` 档只有 28svh 高，容不下完整
 *   时间轴，于是换成「锚点 + 当天首段」。这一个布尔值是端别差异的全部 ——
 *   所以它作为参数传进来，而不是复制一份面板。
 */

import { ItineraryPanel } from '~/common/ui/plan/ItineraryPanel'
import type { PlanView } from '~/common/logic/usePlanView'

export function PlanPanel({ view, compact }: { view: PlanView; compact: boolean }) {
  return (
    <ItineraryPanel
      city={view.city}
      stay={view.stay}
      timeline={view.timeline}
      warnings={view.warnings}
      hasSoftData={view.hasSoftData}
      store={view.store}
      onOpenStayPicker={view.onOpenStayPicker}
      importError={view.importError}
      optionSets={view.optionSets}
      optionLoading={view.optionLoading}
      onRequestOptions={view.onRequestOptions}
      onPickOption={view.onPickOption}
      compact={compact}
    />
  )
}
