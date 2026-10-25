/**
 * 站点行里的**停留时长步进器**（−/+ 各 15 分钟）。
 *
 * ## 为什么单独一个文件
 * `StopTimeline.tsx` 已经 406 行、护栏 G 的上限是 420 —— 这三十来行塞不进去，
 * 硬塞就得从别处砍注释，而那些注释正是"为什么线不能那样画"的依据。
 *
 * ## 为什么它必须存在（2026-10-25 补的缺口）
 * 改停留时长原本只有一处入口：`TimelineRail` 的 ± 按钮。而那条链
 * `PlanPanel` → `ItineraryPanel` → `TimelineRail` **没有任何渲染点** ——
 * 详情页渲染的是 `StopTimeline`，于是**界面上根本改不了停留时长**。
 *
 * ★ 文档（plans/13 §十一）写的是"停留时长在完整行程页的时间轴上调"，
 *   而那个时间轴其实没被接上 —— 文档以为有兜底，实际没有。这类
 *   "文档说还有别的入口"最容易被当成已解决，所以在这里写清楚。
 *
 * ## 口径
 * - 步长 **15 分钟**，与旧时间轴一致（用户习惯那个粒度，别自创一个）。
 * - 下限 **5 分钟**由 `store.setDwell`（`Math.max(5, …)`）与 schema（`.min(5)`）
 *   各自把着，这里**不做二次钳位**。但到下限时要**禁用减号** ——
 *   否则用户点一下数字不变，会以为坏了。
 * - 传的是**绝对值**（`setDwell(uid, minutes)` 的签名如此），不是增量。
 */

import { fmtMinutes } from '~/common/data/format'
import { Icon } from '~/common/ui/Icon'

/** 与 `store.setDwell` 的下限保持一致（只用来决定减号是否可点） */
const MIN_DWELL = 5

const BTN =
  'grid size-5 flex-none place-items-center rounded border border-line text-ink-2 transition-colors ' +
  'hover:border-primary hover:text-primary ' +
  'disabled:opacity-35 disabled:hover:border-line disabled:hover:text-ink-2'

export function DwellStepper({
  minutes,
  onChange,
}: {
  minutes: number
  /** 传**绝对值**回去（自己减好再加 15，调用方不做算术） */
  onChange: (next: number) => void
}) {
  return (
    <span className="flex flex-none items-center gap-1 text-[11px] text-ink-2">
      <span className="tabular-nums whitespace-nowrap">停留 {fmtMinutes(minutes)}</span>
      <button
        type="button"
        disabled={minutes <= MIN_DWELL}
        onClick={() => onChange(minutes - 15)}
        aria-label="减少停留时长 15 分钟"
        className={BTN}
      >
        <Icon name="minus" size="sm" />
      </button>
      <button
        type="button"
        onClick={() => onChange(minutes + 15)}
        aria-label="增加停留时长 15 分钟"
        className={BTN}
      >
        <Icon name="plus" size="sm" />
      </button>
    </span>
  )
}
