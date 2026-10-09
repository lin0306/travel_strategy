import { Icon } from '~/common/ui/Icon'
import { stayRangeLabel } from '~/common/logic/itinerary/timeline'
import type { Stay } from '~shared/schema'

/** 三路输入在界面上各自的说法 —— 用户需要知道这个点是"搜出来的"还是"自己点的" */
const SOURCE_LABEL: Record<Stay['source'], string> = {
  poi: '从点位里选',
  geocoded: '搜索定位',
  picked: '地图点选',
}

/**
 * 住宿行 —— 行程的锚，必须**常显**。
 *
 * ## 为什么它永远排在最上面
 * 时间链的首末两段都是"住宿点 ↔ 第一个/最后一个点位"，所以：
 * - 没有住宿点 → 时间链根本算不出来（下方会是空态，而不是"0 分钟"）
 * - 换了住宿点 → 当天首末两段时长一起变
 *
 * 它同时也是"我从哪出发"的唯一线索，藏在设置里就等于让用户自己记。
 *
 * ⚠️「仅存本机」这四个字不能省 —— 住宿点等于"他在哪过夜"，
 *    是这套数据里唯一的隐私项（09 文档 3.3）。
 */
export function StayRow({ stay, onOpen }: { stay: Stay | null; onOpen: () => void }) {
  return (
    <div className="mx-3.5 mt-3 flex items-center gap-2.5 rounded-lg border border-line px-3 py-2.5">
      <Icon name="pin" size="sm" className="text-primary" />
      {stay ? (
        <>
          <span className="min-w-0 flex-1">
            <b className="block truncate text-[13px] font-medium">{stay.name}</b>
            <span className="block text-[11px] text-ink-2">
              {stayRangeLabel(stay)} · {SOURCE_LABEL[stay.source]} · 仅存本机
            </span>
          </span>
          <button type="button" onClick={onOpen} className="flex-none text-[12px] text-primary">
            更换
          </button>
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1 text-[12.5px] text-ink-2">
            还没有住宿点 —— 它是行程的起终点，没有它算不出时间
          </span>
          <button
            type="button"
            onClick={onOpen}
            className="flex-none rounded-lg bg-primary px-2.5 py-1 text-[12px] font-medium text-white"
          >
            设置
          </button>
        </>
      )}
    </div>
  )
}
