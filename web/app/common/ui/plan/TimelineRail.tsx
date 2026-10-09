import { Icon } from '~/common/ui/Icon'
import { LegRow } from '~/common/ui/plan/LegRow'
import { fmtClock, fmtMinutes } from '~/common/data/format'
import type { RouteOptionSet } from '~/common/logic/itinerary/routeOptions'
import type { Timeline, TimelineStop } from '~/common/logic/itinerary/timeline'
import type { ItineraryState } from '~/common/logic/itinerary/store'
import { SUBTYPE_META, type Poi, type TravelMode } from '~shared/schema'

export interface TimelineRailProps {
  timeline: Timeline
  /** 当天点位的 id → Poi，用于取细类配色与名称 */
  poiById: Map<string, Poi>
  store: ItineraryState
  /** 段 uid → 已拉到的多方案集合。没拉过就没有这个键 —— 不预拉 */
  optionSets: Record<string, RouteOptionSet>
  /** 正在查询的那一段 uid（同一时刻只可能有一段在拉） */
  optionLoading: string | null
  onRequestOptions: (uid: string, mode: TravelMode) => void
  onPickOption: (uid: string, key: string) => void
  /**
   * 移到下一天。★ 由上层处理（不是直接调 store）——
   * 多住宿段下这一步可能要先弹确认，而那个状态属于面板层
   */
  onMoveToDay: (uid: string, fromDay: number, toDay: number) => void
}

/**
 * 时间轴 —— 行程页的主体。
 *
 * ## 结构：Stop / Leg 交替
 * ```
 * Stop 住宿     09:00 出发
 *   Leg  驾车 18 分 · 6.2 km       ← 点它展开六方式条 + 多方案卡
 * Stop 宽窄巷子 09:18 → 10:48
 *   Leg  步行 9 分 · 700 m
 * Stop 人民公园 10:57 → 11:57
 * …
 * Stop 住宿     15:16 抵达
 * ```
 * 首末必须是住宿点 —— 这两段时长直接由「住宿在哪」决定，所以住宿点缺失时
 * 整条时间链算不出来（页面会先要求设置住宿点）。
 *
 * ## 时间只有一种算法
 * 展示值全部来自 `buildTimeline()`，本组件**不做任何加减**。
 * 停留时长的 ±15 分钟是写回 store 后重算 —— 不是就地改显示的数字。
 */
export function TimelineRail({
  timeline,
  poiById,
  store,
  optionSets,
  optionLoading,
  onRequestOptions,
  onPickOption,
  onMoveToDay,
}: TimelineRailProps) {
  const day = store.activeDay

  return (
    <div className="mt-1.5 px-3.5">
      {timeline.stops.map((st, i) => {
        const leg = timeline.legs[i]
        const uid = st.item?.uid
        const open = uid !== undefined && store.activeLeg === uid

        return (
          <div key={`${st.kind}-${st.item?.uid ?? i}`}>
            <StopRow
              stop={st}
              poiById={poiById}
              store={store}
              day={day}
              onMoveToDay={onMoveToDay}
            />
            {leg && !st.isLast ? (
              // ★ 左缩进留在这里（`46px` 时刻列 + `12px` 圆点列）——
              //   `LegRow` 只画卡片，理由见那个文件头
              <div className="flex gap-2.5">
                <div className="w-[46px] flex-none" />
                <div className="w-3 flex-none" />
                <LegRow
                  leg={leg}
                  uid={uid}
                  open={open}
                  optionSet={uid !== undefined ? optionSets[uid] : undefined}
                  optionLoading={uid !== undefined && optionLoading === uid}
                  pickedKey={uid !== undefined ? (store.chosenOption[uid] ?? null) : null}
                  onToggle={() => uid !== undefined && store.setActiveLeg(uid)}
                  onMode={(m) => uid !== undefined && store.setModeToNext(uid, m)}
                  onRequestOptions={(m) => uid !== undefined && onRequestOptions(uid, m)}
                  onPickOption={(k) => uid !== undefined && onPickOption(uid, k)}
                />
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

/* ────────────────────────────────────────────────
 * 停靠点行
 * ────────────────────────────────────────────── */

function StopRow({
  stop,
  poiById,
  store,
  day,
  onMoveToDay,
}: {
  stop: TimelineStop
  poiById: Map<string, Poi>
  store: ItineraryState
  day: number
  onMoveToDay: (uid: string, fromDay: number, toDay: number) => void
}) {
  const isStay = stop.kind === 'stay'
  const poi = stop.item ? poiById.get(stop.item.poiId) : undefined
  const item = stop.item

  // 顺序调整要的是**当天的点位下标**（住宿点不在 items 里）
  const items = store.days[day - 1]?.items ?? []
  const itemIndex = item ? items.findIndex((it) => it.uid === item.uid) : -1

  return (
    <div className="flex gap-2.5">
      <div className="flex w-[46px] flex-none flex-col items-end pt-0.5">
        <span className="text-[12px] font-semibold tabular-nums">{fmtClock(stop.atMin)}</span>
        {!stop.isLast ? (
          <span className="text-[10.5px] text-ink-2">{fmtClock(stop.leaveMin)}</span>
        ) : null}
      </div>

      {/* 时间轴轨道：圆点 + 竖线。住宿点用实心黑点，与 POI 的细类色区分开 */}
      <div className="flex w-3 flex-none flex-col items-center">
        <span
          className={`mt-1 size-2.5 flex-none rounded-full ${isStay ? 'bg-ink' : 'border-2 border-white'}`}
          style={isStay ? undefined : { background: poi ? SUBTYPE_META[poi.subtype].color : '#6B7280' }}
        />
        {!stop.isLast ? <span className="my-0.5 w-px flex-1 bg-line" /> : null}
      </div>

      <div className="min-w-0 flex-1 pb-1">
        <div className="flex items-center gap-1.5">
          <b className="truncate text-[13.5px] font-medium">{stop.place.name}</b>
          {isStay ? (
            <span className="flex-none rounded bg-bg px-1.5 py-0.5 text-[10.5px] text-ink-2">住宿</span>
          ) : poi ? (
            <span className="flex-none text-[10.5px] text-ink-2">{SUBTYPE_META[poi.subtype].label}</span>
          ) : null}
        </div>

        {!isStay && item ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-ink-2">
            <span>停留 {fmtMinutes(item.dwellMinutes)}</span>
            <button
              type="button"
              onClick={() => store.setDwell(item.uid, item.dwellMinutes - 15)}
              aria-label="减少停留时长 15 分钟"
              className="grid size-5 place-items-center rounded border border-line"
            >
              <Icon name="minus" size="sm" />
            </button>
            <button
              type="button"
              onClick={() => store.setDwell(item.uid, item.dwellMinutes + 15)}
              aria-label="增加停留时长 15 分钟"
              className="grid size-5 place-items-center rounded border border-line"
            >
              <Icon name="plus" size="sm" />
            </button>

            {/* 顺序由用户定 —— 这一组按钮就是那句话的落点。
                ★ 全部走 store 的 moveItem / moveItemToDay，组件里不自己改数组 */}
            <span className="ml-auto flex flex-none items-center gap-1">
              <button
                type="button"
                disabled={itemIndex <= 0}
                onClick={() => store.moveItem(day, itemIndex, itemIndex - 1)}
                aria-label="上移一位"
                className="grid size-5 place-items-center rounded border border-line disabled:opacity-35"
              >
                <Icon name="chev-up" size="sm" />
              </button>
              <button
                type="button"
                disabled={itemIndex < 0 || itemIndex >= items.length - 1}
                onClick={() => store.moveItem(day, itemIndex, itemIndex + 1)}
                aria-label="下移一位"
                className="grid size-5 place-items-center rounded border border-line disabled:opacity-35"
              >
                <Icon name="chev-down" size="sm" />
              </button>
              <button
                type="button"
                disabled={day >= store.days.length}
                onClick={() => onMoveToDay(item.uid, day, day + 1)}
                aria-label="移到下一天"
                className="grid size-5 place-items-center rounded border border-line disabled:opacity-35"
              >
                <Icon name="chev-right" size="sm" />
              </button>
              <button
                type="button"
                onClick={() => store.removeItem(day, item.uid)}
                className="ml-0.5 text-[11.5px] hover:text-[#E8672F]"
              >
                移除
              </button>
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
