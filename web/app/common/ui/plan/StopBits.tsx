/**
 * `StopTimeline` 的三个**小件** —— 拆出来的唯一理由是行数（G 项 420 上限）。
 *
 * 它们与"这一天怎么排"（拖拽 / 换序 / 连线）无关，是"**一个点长什么样**"：
 * 缩略图、第二行文案、圆点颜色。放在主文件里只会让那个渲染循环更长，
 * 而读代码的人找"拖拽逻辑"时要先穿过这些。
 */
import { Icon } from '~/common/ui/Icon'
import type { PlanStopView } from '~/common/logic/itinerary/planStops'
import { SUBTYPE_META } from '~shared/schema'

/** 圆点颜色 = 该点的**细类色**（与地图上的标记同源）；地图取点没有细类 → 用次级文字色 */
export function dotColor(s: PlanStopView): string {
  return s.subtype ? SUBTYPE_META[s.subtype].color : 'var(--color-ink-2)'
}

/** 缩略图；没有图就给一个灰底占位（**不是空白洞**） */
export function Thumb({ stop }: { stop: PlanStopView }) {
  if (!stop.thumbUrl) {
    return (
      <span className="inline-flex size-11 flex-none items-center justify-center rounded-md border border-line bg-line-2 text-ink-2/50">
        <Icon name="image" size="sm" />
      </span>
    )
  }
  return (
    <img
      src={stop.thumbUrl}
      alt=""
      loading="lazy"
      decoding="async"
      className="size-11 flex-none rounded-md border border-line object-cover"
    />
  )
}

/**
 * 第二行的文案。
 *
 * ★ **用 `·` 分隔而不是直接拼**"四川省成都市青羊区"：直辖市在数据里
 *   `province` 与 `name` 同名（都是"北京"），直接拼会变成"北京北京市朝阳区"。
 *   `Set` 去重之后是"北京 · 朝阳区" —— 两种行政区划都读得通。
 * ★ **地图取点没有区**（它不在任何一个 POI 上）：地址是逆地理编码查来的
 *   （`PlanStopView.address`），查不到就写「定位中…」，不再显示经纬度
 *   （用户 2026-09-28：「第二行不是显示经纬度，而是显示省市区」）。
 */
export function subtitleOf(stop: PlanStopView, province: string, cityName: string): string {
  if (stop.kind === 'point') {
    if (stop.address) return stop.address
    return stop.resolved ? '定位中…' : '位置已记录'
  }
  const parts = [...new Set([province, cityName, stop.district ?? ''])].filter(Boolean)
  if (parts.length > 0) return parts.join(' · ')
  return stop.resolved ? '位置已记录' : '点位信息已失效'
}
