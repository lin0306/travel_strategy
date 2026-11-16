/**
 * 「把这一屏**实际**画成什么样」记一条日志 —— 诊断链的最后一环。
 *
 * ## 为什么单独成文件
 * `useMapReveal.ts` 已到 420 行上限（G 项）。这件事与"铺哪一级"无关：
 * 它只是把图层**已经画出来**的读数搬进日志，换任何驱动方式都需要它。
 *
 * ## ★ 数字必须取自图层的 `stats()`，不是候选数组
 * `d.districts.length` / `d.pois.length` 是**候选**：徽标还要过像素避让
 * （实测 165 → 40），点位还要过档位准入、再被聚合器合成簇（46 候选 → 8 簇）。
 * 只记候选会得出"明明铺了却看不到"的错觉 —— 而那正是要排查的现象本身。
 *
 * ## ★ 必须在图层同步**之后**调用
 * `stats()` 回答的是"上一次重绘的结果"，提前取会拿到上一屏的数 ——
 * 2026-09-30 排查"面没跟着换级"时就被这个陈旧读数误导过一次。
 */

import { recordMapLog } from '~/common/logic/mapLog'
import type {
  DistrictLayerHandle,
  DistrictLayerStats,
  MapLevel,
  PoiLayerHandle,
  PoiLayerStats,
  RevealDecision,
} from '~/common/map/tencent'

export function logSnapshot(
  zoom: number,
  base: MapLevel,
  d: RevealDecision,
  district: DistrictLayerHandle | null,
  poi: PoiLayerHandle | null,
): void {
  const ds: DistrictLayerStats | undefined = district?.stats()
  const ps: PoiLayerStats | undefined = poi?.stats()
  recordMapLog({
    zoom,
    base,
    level: d.level,
    revealed: d.revealed,
    pending: d.pending,
    dTotal: d.districts.length,
    badges: ds?.badges ?? 0,
    badgeTexts: ds?.badgeTexts ?? [],
    polys: ds?.polygons ?? 0,
    pTotal: d.pois.length,
    aTotal: ps?.admitted ?? 0,
    clusters: ps?.clusters ?? 0,
    bubbles: ps?.bubbles ?? 0,
    labels: ps?.labels ?? 0,
    labelTexts: ps?.labelNames ?? [],
  })
}
