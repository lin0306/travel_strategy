import { fmtDuration, fmtMinutes } from '~/common/data/format'
import type { Timeline } from '~/common/logic/itinerary/timeline'

/**
 * 全天汇总条。
 *
 * ## 左边那两句话是刻意的
 * 1. **「顺序由你决定，系统只算时间」** —— 这是全项目最重要的一句产品承诺。
 *    放在每天的汇总里而不是只写一次帮助文档，因为用户每次看时间链都会看到它，
 *    才能确信"排得不好不是系统排的"。（本项目不做 TSP / 2-opt 推导排序。）
 * 2. **「部分时长由直线距离估算，非实测路况」** —— 只在真含估算值时才出现。
 *    全是矩阵命中时说这句是多余的噪音；含估算却不说，就等于把估算冒充实测。
 */
export function DaySummary({ timeline, hasSoftData }: { timeline: Timeline; hasSoftData: boolean }) {
  const poiCount = timeline.stops.filter((s) => s.kind === 'poi').length

  return (
    <div className="mx-3.5 mt-1 mb-3 flex items-end justify-between gap-3 rounded-lg bg-bg px-3 py-2.5">
      <div className="text-[11.5px] leading-relaxed text-ink-2">
        在途 <b className="text-ink">{fmtDuration(timeline.transitSec)}</b> · 停留{' '}
        <b className="text-ink">{fmtMinutes(timeline.dwellMin)}</b>
        <br />共 {poiCount} 个点位 · 顺序由你决定，系统只算时间
        {hasSoftData ? (
          <>
            <br />部分时长由直线距离估算，非实测路况
          </>
        ) : null}
      </div>
      <div className="flex-none text-right">
        <b className="block text-[20px] leading-none">
          {fmtDuration((timeline.endMin - timeline.startMin) * 60)}
        </b>
        <span className="text-[11px] text-ink-2">全天合计</span>
      </div>
    </div>
  )
}
