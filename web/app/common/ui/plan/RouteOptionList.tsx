import { useMemo, useState } from 'react'

import { Icon } from '~/common/ui/Icon'
import { PENDING_CLS, PICKED_BG_CLS, PICKED_CLS, WARN_TEXT_CLS } from '~/common/ui/plan/tokens'
import { fmtDistance, fmtFare, fmtMinutes } from '~/common/data/format'
import {
  routeProvenanceNote,
  sortRouteOptions,
  transitHeadline,
  type RouteOption,
  type RouteOptionSet,
  type RouteSortKey,
  type TransitStepBrief,
} from '~/common/logic/itinerary/routeOptions'

/**
 * 多方案卡 —— 点开某一段才出现（09 文档 6.3.1）。
 *
 * ## 为什么必须「点开才拉」
 * 一进页面就把 8 段的 3 条方案全拉了 = 24 次接口调用，配额当天就废。
 * 矩阵时长已经够回答"今天排得下吗"，"路上堵不堵"是用户主动追问才需要的。
 *
 * ## 四个降级态都必须能优雅显示
 * | degrade | 表现 | 关键点 |
 * |---------|------|--------|
 * | `none` | 正常 3 条 | — |
 * | `single` | **紧凑单行**，不摆"3 条方案"的架子 | 接口只管返回，1 条是正常结果 |
 * | `no-fare` | **整行隐藏**打车费 | "费用未知"是坏信息，不如不给 |
 * | `quota` / `failed` | 只显示一句说明 + 重试 | 空卡片会让人以为是加载失败 |
 *
 * ## 三个措辞约束（都是"不假装实时"）
 * 1. 时长是「查询时刻快照」→ 卡上必须写查询时刻
 * 2. 打车费必须标「预估」—— 它不含动态调价与拥堵溢价
 * 3. 缓行/拥堵只给**文字**，不给"蚂蚁线"动效 —— 那是导航 App 的语言
 */
/** 排序维度的中文名（键与算法都在 `routeOptions.ts`，见 `RouteSortKey`） */
const SORTS: ReadonlyArray<readonly [RouteSortKey, string]> = [
  ['time', '时间'],
  ['distance', '距离'],
]

export function RouteOptionList({
  set,
  loading,
  pickedKey,
  onPick,
  onRetry,
}: {
  set: RouteOptionSet | null
  loading: boolean
  /** 用户当前选中的方案 key（'A' | 'B' | 'C'）。null = 用矩阵默认值 */
  pickedKey: string | null
  onPick: (key: string) => void
  onRetry: () => void
}) {
  /**
   * 排序维度。**默认按时间** —— "哪条最快"是绝大多数人的第一个问题。
   * ★ 这两个按钮只在有多条时才出（单条没有"顺序"可言）。
   */
  const [sort, setSort] = useState<RouteSortKey>('time')

  /**
   * ⚠️ 排序写在 `useMemo` 里、且**必须在两个 early return 之前** ——
   *   hook 不能出现在 early return 之后（React 规则）。所以这里用可选链取值。
   *   ★ 排序算法本身在 `sortRouteOptions`（唯一出处）—— 地图取"第一条"用的是
   *     同一个函数，否则会出现"列表第一条是 A、地图画的却是 B"。
   */
  const sorted = useMemo(
    () => sortRouteOptions(set?.options ?? [], sort),
    [set?.options, sort],
  )

  if (loading) {
    return (
      <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-[11.5px] text-ink-2">
        <span className="size-3 animate-spin rounded-full border-2 border-line border-t-primary" />
        正在查询这一段的路线…
      </div>
    )
  }

  if (!set) return null

  // 配额用尽 / 查询失败：给一句说明 + 一个重试，不放空卡片
  if (set.degrade === 'quota' || set.degrade === 'failed') {
    return (
      <div className="mt-1.5 flex items-start gap-2 rounded-lg border border-line bg-bg px-2.5 py-2 text-[11.5px] leading-relaxed text-ink-2">
        <Icon name="info" size="sm" className="mt-0.5 flex-none" />
        <span className="min-w-0 flex-1">{set.note ?? '暂时拉不到这一段的路线方案'}</span>
        {set.degrade === 'failed' ? (
          <button type="button" onClick={onRetry} className="flex-none text-primary">
            重试
          </button>
        ) : null}
      </div>
    )
  }

  const single = set.degrade === 'single'

  return (
    <div className="mt-1.5 overflow-hidden rounded-lg border border-line">
      <div className="flex items-baseline justify-between gap-2 bg-bg px-2.5 py-1.5">
        <span className="text-[11px] text-ink-2">
          {single ? '仅一条可行路线' : `${set.options.length} 条路线`}
        </span>
        {/* ★ 排序切换（2026-10-04）：同一种方式下的这几条本身没有"顺序"，
            谁在前面只取决于用户此刻在乎时间还是路程 */}
        {!single ? (
          <span className="flex flex-none items-center gap-1">
            {SORTS.map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setSort(k)}
                aria-pressed={sort === k}
                className={`rounded px-1.5 py-0.5 text-[10.5px] ${
                  sort === k ? 'bg-surface text-primary' : 'text-ink-2 hover:text-ink'
                }`}
              >
                按{label}
              </button>
            ))}
          </span>
        ) : (
          <span className="text-[10.5px] text-ink-2">直线示意</span>
        )}
      </div>

      {sorted.map((o) => (
        <OptionRow
          key={o.key}
          option={o}
          selected={pickedKey === o.key}
          onPick={() => onPick(o.key)}
        />
      ))}

      <div className="flex items-center justify-between gap-2 border-t border-line px-2.5 py-1.5">
        <CongestionLine set={set} />
        {/*
          ★ 打车费只在「方式含打车」且「接口真给了费用」时才显示。
          `degrade === 'no-fare'` 就是"没给费用"这一态的显式判据 ——
          此时**整行隐藏**，而不是显示"费用未知"：无信息比坏信息好，
          一个"费用未知"会让人以为这趟打不到车。
        */}
        {set.degrade !== 'no-fare' && set.taxiFare !== undefined ? (
          <span className="flex-none text-[11px] text-ink-2">
            打车约 {fmtFare(set.taxiFare)}
            <span className="ml-0.5 text-[10px]">预估</span>
          </span>
        ) : null}
      </div>

      {/* 查询时刻 —— 用户上午排晚上的行程，看到的路况是上午的 */}
      <p className="m-0 border-t border-line bg-bg px-2.5 py-1.5 text-[10.5px] leading-relaxed text-ink-2">
        {routeProvenanceNote(set.at)}
      </p>
    </div>
  )
}

function OptionRow({
  option,
  selected,
  onPick,
}: {
  option: RouteOption
  selected: boolean
  onPick: () => void
}) {
  const transit = option.transitLegs
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      className={`flex w-full items-start gap-2 border-t border-line px-2.5 py-1.5 text-left text-[11.5px] first:border-t-0 ${
        selected ? PICKED_BG_CLS : ''
      }`}
    >
      <span
        className={`mt-0.5 grid size-5 flex-none place-items-center rounded-full border text-[10.5px] font-semibold ${
          selected ? PICKED_CLS : PENDING_CLS
        }`}
      >
        {option.key}
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className="flex-none font-medium">{fmtMinutes(option.durationMinutes)}</span>
          <span className="flex-none text-ink-2">{fmtDistance(option.distance)}</span>
          {option.tags.length > 0 ? (
            <span className="min-w-0 flex-1 truncate text-ink-2">{option.tags.join(' · ')}</span>
          ) : (
            <span className="min-w-0 flex-1" />
          )}
          {option.toll ? <span className="flex-none text-ink-2">过路费 ¥{option.toll}</span> : null}
        </span>

        {/*
         * ★ 公交/地铁的**线路摘要**（2026-10-05 用户：「只知道多久、距离多远，
         *   还需要有**哪个线路、要不要转站**这些显示」）。
         *   一行说清：坐哪几趟 + 换不换乘。其余方式没有 `transitLegs`，这一行不出现。
         */}
        {transit && transit.length > 0 ? (
          <span className="truncate text-[10.5px] text-ink-2">{transitHeadline(transit)}</span>
        ) : null}

        {/* 选中的那条再展开分段明细 —— 「**在哪里转**」只有分到段才说得清 */}
        {transit && transit.length > 0 && selected ? <TransitSteps legs={transit} /> : null}
      </span>

      <span className={`mt-0.5 flex-none text-[10.5px] ${selected ? 'text-primary' : 'text-ink-2'}`}>
        {selected ? '已选' : '选这条'}
      </span>
    </button>
  )
}

/**
 * 公交/地铁的**分段明细** —— 只在选中的方案下展开。
 *
 * 逐段念一遍就是完整的乘车说明：走多少 → 坐几路上车 → 坐几站到哪 →
 * 换乘点自然落在"上一段的到站 = 下一段的上车"上（接口不另给"换乘"字段，
 * 也不需要 —— 见 `transitLegsOf` 的说明）。
 *
 * ★ 未选中的方案**不展开**：3 条方案 × 5 段会把这个面板撑成一面墙，
 *   而用户比较时先看的是"时间/换乘次数"，细节是选定之后才关心的。
 */
function TransitSteps({ legs }: { legs: TransitStepBrief[] }) {
  return (
    <span className="flex flex-col gap-0.5 border-t border-line pt-1">
      {legs.map((l, i) =>
        l.kind === 'walk' ? (
          <span key={i} className="text-[10.5px] text-ink-2">
            步行 {fmtDistance(l.distance)}
          </span>
        ) : (
          <span key={i} className="flex items-center gap-1 text-[10.5px] text-ink-2">
            {/*
             * ★ 线路官方色的小圆点（地铁一般有）—— 与地图上那条线的颜色**同源**，
             *   两边对得上才认得出"图上那条蓝线就是我列表里这条 1 号线"。
             * 拿不到色（公交多数没有）就画一个中性小点，不留空位。
             */}
            <span
              className="size-2 flex-none rounded-full border border-line"
              style={l.color ? { background: l.color } : { background: 'var(--color-ink-2)' }}
            />
            <b className="font-medium text-ink">{l.line ?? '乘车'}</b>
            {l.towards ? `（往 ${l.towards}）` : ''}
            {l.stationCount ? ` · ${l.stationCount} 站` : ''}
            {l.fromStation ? ` · ${l.fromStation} 上车` : ''}
            {l.toStation ? ` → ${l.toStation}` : ''}
          </span>
        ),
      )}
    </span>
  )
}

/**
 * 拥堵只给文字。
 *
 * ⚠️ 地图上的「拥堵路段描色」目前**还没接上**（属于路线规划改造的 Step 3，见 plans/13 §5.3）。
 *    ★ 好消息是它比原先以为的**简单得多**：2026-09-25 实测（`_tmp/probe_polyline.py`）
 *    发现 `speed[]` 每一项**自带 `polyline_idx: [from, to]`**，直接就是这段在折线上的下标区间 ——
 *    不需要"先解出折线再回头找对应段"。缺的只是"把这段区间喂给 `routeLayer` 的 `jamSpan`"。
 */
function CongestionLine({ set }: { set: RouteOptionSet }) {
  const worst = set.options.reduce<{ slowCount: number; slowestKmh: number } | null>(
    (acc, o) =>
      o.congestion && (!acc || o.congestion.slowestKmh < acc.slowestKmh) ? o.congestion : acc,
    null,
  )
  if (!worst) {
    return <span className="min-w-0 flex-1 text-[11px] text-ink-2">沿途未报告缓行路段</span>
  }
  return (
    <span className={`flex min-w-0 flex-1 items-center gap-1 text-[11px] ${WARN_TEXT_CLS}`}>
      <Icon name="alert" size="sm" className="flex-none" />
      {worst.slowCount} 处缓行 · 最慢 {Math.round(worst.slowestKmh)} km/h
    </span>
  )
}
