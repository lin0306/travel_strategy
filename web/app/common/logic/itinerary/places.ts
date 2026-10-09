/**
 * 「从行程里的一项拿到它的坐标」—— 两个查找器的唯一出处。
 *
 * ## 为什么有两个（都不能少）
 * | 查找器 | 收什么 | 认不认自由取点 |
 * |---|---|---|
 * | `makePoiLookup` | `poiId` | **不认** —— 它只查 `city.pois` |
 * | `makePlaceOfItem` | 整个 `DayItem` | **认**（用 item 自带的 `lng`/`lat`） |
 *
 * ## ★★ 为什么必须有后者
 * **自由取点（地图取点）没有 `poiId`** —— 它是空串（见 `DayItemSchema.poiId` 的注释），
 * 坐标只存在 item 自己身上（`kind: 'point'` + `lng` / `lat`）。
 * 只提供 `poiId` 那条路的后果：**"景点 ↔ 地图取点"这一段永远算不出来**。
 * 用户 2026-10-04 报的正是它 ——「只有景点之间有显示，景点和地图取点之间没有任何显示」。
 *
 * ★ 自由取点用 `uid` 当 `Place.id`：构建期矩阵里当然没有它 ⇒ `resolveLegSync`
 *   自动降级到「直线估算」（UI 会如实标「估算」）—— 这正是要的，
 *   那种点本来就没法进矩阵。
 */
import { poiPlace } from './timeline'
import { arrivalOf, type Place } from './resolveLeg'
import type { City, DayItem } from '~shared/schema'

/** `poiId` → 坐标。只认城市库里有的 POI（自由取点走另一条路）。
 * ★ 用到达点（入口坐标，>300m 才启用）—— 路线/时间链应落点到园区入口而非中心。 */
export function makePoiLookup(city: City | null): (poiId: string) => Place | null {
  if (!city) return () => null
  const byId = new Map(city.pois.map((p) => [p.id, p]))
  return (poiId: string): Place | null => {
    const p = byId.get(poiId)
    if (!p) return null
    const at = arrivalOf(p)
    return poiPlace(p.id, p.name, at.lng, at.lat)
  }
}

/**
 * `DayItem` → 坐标。**自由取点也认**（这是与 `makePoiLookup` 的关键差别）。
 *
 * 先看 item 自带的坐标（`kind: 'point'`），没有才回落去查 `poiId`。
 * 顺序不能反：景点也可能冗余带了坐标，但以库里的为准更稳（库里是权威数据）。
 */
export function makePlaceOfItem(
  poisOf: (poiId: string) => Place | null,
): (it: DayItem) => Place | null {
  return (it: DayItem): Place | null => {
    if (it.kind === 'point' && it.lng !== undefined && it.lat !== undefined) {
      return poiPlace(it.uid, it.name ?? '地图取点', it.lng, it.lat)
    }
    return poisOf(it.poiId)
  }
}
