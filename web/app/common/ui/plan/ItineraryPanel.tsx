import { useState } from 'react'

import { Icon, type IconName } from '~/common/ui/Icon'
import { EmptyState } from '~/common/ui/Overlay'
import { ConfirmBar } from '~/common/ui/plan/ConfirmBar'
import { DaySummary } from '~/common/ui/plan/DaySummary'
import { DayTabs } from '~/common/ui/plan/DayTabs'
import { OverloadWarnings } from '~/common/ui/plan/OverloadWarnings'
import { StayRow } from '~/common/ui/plan/StayRow'
import { TimelineRail } from '~/common/ui/plan/TimelineRail'
import { fmtClock, fmtDuration } from '~/common/data/format'
import type { RouteOptionSet } from '~/common/logic/itinerary/routeOptions'
import { crossDayStayWarning, type ItineraryState } from '~/common/logic/itinerary/store'
import type { Timeline } from '~/common/logic/itinerary/timeline'
import { MODE_META, type City, type Stay, type TravelMode } from '~shared/schema'

export interface ItineraryPanelProps {
  city: City | null
  stay: Stay | null
  timeline: Timeline | null
  warnings: string[]
  hasSoftData: boolean
  store: ItineraryState
  onOpenStayPicker: () => void
  importError: string | null
  optionSets: Record<string, RouteOptionSet>
  optionLoading: string | null
  onRequestOptions: (uid: string, mode: TravelMode) => void
  onPickOption: (uid: string, key: string) => void
  /**
   * 紧凑档（移动端 peek，28svh）。
   *
   * ★ 不是"少显示几个字段"，而是**换一套内容**：peek 只回答"第一站几点到",
   *   所以给「锚点 + 当天首段」。把完整时间轴塞进来再裁掉一半，
   *   用户看到的是半行残字，比不给更糟。
   */
  compact?: boolean
}

/** 待确认的跨天移动 */
interface PendingMove {
  uid: string
  fromDay: number
  toDay: number
  message: string
}

/**
 * 行程面板主体 —— 桌面左栏与移动端 Sheet 的**同一份内容**。
 *
 * 两端不各写一套，是因为时间轴一行有六个字段（时刻 / 圆点 / 名称 / 细类 / 停留 / 操作），
 * 抄一遍必然会漂。差异（字号、拖拽把手、底部操作条）留在各自的容器里。
 *
 * ## 跨天移动为什么要先问一句
 * 多住宿段的情况下，"把这点挪到第 3 天"会连带改变**回程起点** ——
 * 第 3 天住的是另一家酒店，末段时长完全不同。所以这不是"移错了能再移回来"
 * 的操作，它会改变时间链的语义。因此先问，但不硬阻止（决定权仍在用户）。
 */
export function ItineraryPanel({
  city,
  stay,
  timeline,
  warnings,
  hasSoftData,
  store,
  onOpenStayPicker,
  importError,
  optionSets,
  optionLoading,
  onRequestOptions,
  onPickOption,
  compact = false,
}: ItineraryPanelProps) {
  const [pending, setPending] = useState<PendingMove | null>(null)

  if (!city) {
    return (
      <div className="flex items-center gap-2 px-3.5 py-6 text-[13px] text-ink-2">
        <span className="size-3.5 animate-spin rounded-full border-2 border-line border-t-primary" />
        加载中…
      </div>
    )
  }

  const poiById = new Map(city.pois.map((p) => [p.id, p]))
  const dayCount = timeline?.stops.filter((s) => s.kind === 'poi').length ?? 0

  /** 移动到别的天：住宿段不同的情况下先弹确认 */
  const moveToDay = (uid: string, fromDay: number, toDay: number) => {
    const warn = crossDayStayWarning(store, fromDay, toDay)
    if (warn) {
      setPending({ uid, fromDay, toDay, message: warn })
      return
    }
    store.moveItemToDay(fromDay, uid, toDay)
  }

  /* ── peek 档：换一套内容，不是裁一段 ── */
  if (compact) {
    return (
      <>
        <StayRow stay={stay} onOpen={onOpenStayPicker} />
        <DayTabs
          days={store.days}
          activeDay={store.activeDay}
          onActivate={store.setActiveDay}
          onAdd={() => store.setDayCount(store.days.length + 1)}
          onRemove={store.removeDay}
          onMove={store.moveDay}
        />
        {stay && timeline && dayCount > 0 ? (
          <FirstLegPeek timeline={timeline} />
        ) : (
          <p className="mx-3.5 mt-3 mb-0 text-[12px] leading-relaxed text-ink-2">
            {stay ? '这一天还没有点位 · 上滑看完整面板' : '还没有住宿点 · 先设一个才能算时间'}
          </p>
        )}
      </>
    )
  }

  return (
    <>
      <StayRow stay={stay} onOpen={onOpenStayPicker} />

      {/* 确认条放在最上方 —— 放在被移动的那一行旁边会被滚出视野，
          而这是一个"必须回答"的问题，不能让人看不见 */}
      {pending ? (
        <ConfirmBar
          message={pending.message}
          confirmLabel={`仍移到第 ${pending.toDay} 天`}
          onConfirm={() => {
            store.moveItemToDay(pending.fromDay, pending.uid, pending.toDay)
            setPending(null)
          }}
          onCancel={() => setPending(null)}
        />
      ) : null}

      <DayTabs
        days={store.days}
        activeDay={store.activeDay}
        onActivate={store.setActiveDay}
        onAdd={() => store.setDayCount(store.days.length + 1)}
        onRemove={store.removeDay}
        onMove={store.moveDay}
      />

      {importError ? (
        <div className="mx-3.5 mt-3 rounded-lg border border-[#F0D9A8] bg-[#FFF8E8] px-3 py-2 text-[12px] leading-relaxed text-[#7A5A12]">
          导入失败：{importError}
        </div>
      ) : null}

      {!stay ? (
        <EmptyState
          icon={<Icon name="pin" size="xl" />}
          title="先设一个住宿点"
          detail="行程的起点与终点都锚在住宿点上。设好之后，就能把点位排进当天并算出完整时间链。"
        />
      ) : !timeline || dayCount === 0 ? (
        <EmptyState
          icon={<Icon name="route" size="xl" />}
          title="这一天还没有点位"
          detail="从城市页把想去的点位加进来，顺序随时可以调整。"
        />
      ) : (
        <>
          <TimelineRail
            timeline={timeline}
            poiById={poiById}
            store={store}
            optionSets={optionSets}
            optionLoading={optionLoading}
            onRequestOptions={onRequestOptions}
            onPickOption={onPickOption}
            onMoveToDay={moveToDay}
          />
          <OverloadWarnings warnings={warnings} />
          <DaySummary timeline={timeline} hasSoftData={hasSoftData} />
        </>
      )}

      <div className="px-3.5 pb-4">
        <button
          type="button"
          onClick={onOpenStayPicker}
          className="w-full rounded-lg border border-dashed border-line py-2.5 text-[12.5px] text-ink-2 hover:border-primary hover:text-primary"
        >
          换住宿点，或新增一个住宿段
        </button>
      </div>
    </>
  )
}

/**
 * peek 档那一段 —— 「几点出发、第一站几点到」。
 *
 * 只取**当天首段**（住宿 → 第一个点位）。选它而不是"前 N 条时间轴"的理由：
 * 用户把 Sheet 拉到 peek 档时问的是"我今天大概几点动身"，
 * 而首段是唯一能回答这个问题的段 —— 后面的段都取决于它。
 */
function FirstLegPeek({ timeline }: { timeline: Timeline }) {
  const from = timeline.stops[0]
  const leg = timeline.legs[0]
  const to = timeline.stops[1]
  if (!from || !leg || !to) return null

  return (
    <div className="mx-3.5 mt-3 flex items-center gap-2.5 rounded-lg border border-line px-3 py-2.5">
      <span className="flex-none text-[12px] font-semibold tabular-nums">{fmtClock(from.atMin)}</span>
      <span className="min-w-0 flex-none truncate text-[11.5px] text-ink-2">{from.place.name}</span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="h-px flex-1 bg-line" />
        <Icon
          name={(MODE_META[leg.mode].ico as IconName) ?? 'route'}
          size="sm"
          className="flex-none text-ink-2"
        />
        <span className="flex-none text-[11.5px] text-ink-2">{fmtDuration(leg.duration)}</span>
        <span className="h-px flex-1 bg-line" />
      </span>
      <span className="flex-none text-[12px] font-semibold tabular-nums">{fmtClock(to.atMin)}</span>
      <span className="min-w-0 flex-none truncate text-[11.5px] text-ink-2">{to.place.name}</span>
    </div>
  )
}
