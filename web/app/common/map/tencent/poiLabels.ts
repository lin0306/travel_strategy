/**
 * POI **名字层** —— 「这一屏上给哪几枚点挂名字」。
 *
 * ## 为什么单独一个文件
 * `poiLayer.ts` 管的是**图层的生命周期**（建层、挂事件、拆层）与"这一屏铺哪些点"；
 * 而"名字给谁、挤不挤、留下哪几个"是**另一件事** —— 它有自己的一整套判据
 * （候选集来自聚合器 + 认领名单，落点过一遍避让，再按优先级裁）。
 * 混在一起那个文件会同时讲两套东西（2026-10-05 拆，原来它已顶到 420 行上限）。
 *
 * ## ★★ 「谁是独立点」必须问聚合器
 * `singleIds()` 是它自己的结论。自己拿距离再算一遍必然与它分叉
 * （它按屏幕像素、按簇心距离、还在 worker 里算）。
 * 这也正是**不会产生幽灵标注**的原因：名字的候选集天然排除了已经进气泡的点。
 *
 * ## 两处"必须给名字"的例外
 * 1. **被规划认领的景点**（`env.claimed`）：它们的圆点撤掉了、位置上是规划的序号圆点，
 *    但"这是哪个景点"仍然要看得到 —— 名字与圆点是两件事。
 * 2. **选中项**：无论有没有被聚合、有没有被避让掉，都必须有名字。
 */
import { overlaysToOccupied, pickVisibleLabels, type LabelCandidate } from './labelAvoidance'
import { readViewport } from './viewport'
import type { PoiPoint, PoiUpdateOptions } from './poiTypes'

export interface PoiLabelsInput {
  map: TMap.Map
  /** 名字层实例（本函数只往里写几何） */
  labels: TMap.MultiLabel
  /** 当前候选点集，按 id 查 */
  byId: ReadonlyMap<string, PoiPoint>
  /** 是否给**独立点**挂名字（移动端不给，只留选中项与认领点） */
  names: boolean
  /**
   * 聚合器给出的"这些是独立点"（`Set` 或数组都行）—— **唯一出处**，别在外面另算一遍。
   * ★ 类型收 `Iterable` 而不是 `string[]`：聚合器交付的就是 `Set`，
   *   为了塞进数组在调用处多写一次 `[...]` 是白拷贝。
   */
  singleIds: Iterable<string>
  /** 选中项（可能不在候选集里，见 `PoiPoint` 的 `picked`） */
  selected: PoiPoint | null
  /** 环境：`container` / `overlays` / `claimed` */
  env: PoiUpdateOptions
}

/**
 * 铺名字。
 * @returns 屏幕上**真的留下**的那几个名字（供日志如实反映，别报候选数）
 */
export function paintPoiLabels(i: PoiLabelsInput): string[] {
  const { map, labels, byId, names, singleIds, selected, env } = i
  const selectedId = env.selectedId ?? null
  const picked = new Map<string, PoiPoint>()

  if (names) {
    for (const id of singleIds) {
      const p = byId.get(id)
      if (p) picked.set(p.id, p)
    }
    // ★ 被认领的（规划停靠点）也要有名字 —— 见文件头"两处例外"
    for (const id of env.claimed ?? []) {
      const p = byId.get(id)
      if (p) picked.set(p.id, p)
    }
  }
  if (selected) picked.set(selected.id, selected)

  if (picked.size === 0) {
    labels.setGeometries([])
    return []
  }

  const view = readViewport(map, env.container)
  // 避让要躲开浮层：拿不到容器就当作"屏幕上没有浮层"（退化成不避让，不是不画）
  const el = (env.container ?? map.getContainer?.()) as HTMLElement | null
  const occupied =
    el && env.overlays && env.overlays.length > 0 ? overlaysToOccupied(el, env.overlays) : undefined

  const candidates: LabelCandidate[] = [...picked.values()].map((p) => ({
    id: p.id,
    name: p.name,
    lng: p.lng,
    lat: p.lat,
    popularity: p.popularity,
  }))

  const shown = pickVisibleLabels(candidates, view, occupied ? { occupied } : {})
  // ★ 先算出**最终上屏那一批**再 `setGeometries`：返回值要如实反映屏幕上留了几个名字
  const final = candidates.filter((c) => shown.has(c.id) || c.id === selectedId)

  labels.setGeometries(
    final.map((c) => ({
      id: c.id,
      styleId: c.id === selectedId ? 'poiActive' : 'poi',
      position: new TMap.LatLng(c.lat, c.lng),
      // 🚨 文字必须走 `content`（实测：SDK 只读这个字段）。
      //    漏了它不会报错，几何也照收 —— 只是**一个名字都显示不出来**。
      content: c.name,
    })),
  )

  return final.map((c) => c.name)
}
