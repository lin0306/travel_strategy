/**
 * 「放大到景点级」时的**点位分批加载** —— 先把**眼前那几座城**读进来。
 *
 * ## 为什么不是"一次把全部收录城市都读了"
 * 首页放大到 `POI_REVEAL_ZOOM` 时，视野只覆盖**一两座城**，而收录的城市数会一直涨
 * （2026-09-29 已经是 17 座）。一次全读的代价实测是**四秒上下**的空窗：
 * 这段时间里点位层是空的（`useMapReveal` 的 `pending` 分支），
 * 用户看到的就是"放大之后半天没反应" —— 那是他说的"渲染变慢"里最明显的一段。
 *
 * 于是分两批：**按地图中心距离排序**，最近的一批先到货（页面立刻铺一次），
 * 其余的随后补齐。最终状态与"一次全读"**完全一致** —— 差别只在用户先看到什么。
 *
 * ## 为什么按"地图中心"排序，而不是按"视野矩形"筛
 * 批量加载只在 `revealed` 首次变成 `poi` 那一刻启动**一次**；之后用户在视野里平移
 * 不会重新排队。用视野筛会在"中心附近但刚好在框外"的城市上漏掉 ——
 * 而那恰恰是最该先读的那一座（用户下一步就会看它）。
 *
 * ## 为什么不改"加载时机"
 * `plans/12` 与 `useHomeView` 都写明：绝大多数访问不会放大到 `POI_REVEAL_ZOOM`，
 * 所以**首屏不预热点位**。这里只改"真到了那一步之后，先读谁"。
 */

import { loadCity } from '~/common/data/cityRegistry'
import type { City } from '~shared/schema'

export interface PreloadCitiesOptions {
  /** 候选城市 id（已收录的那些） */
  ids: string[]
  /** 该城中心。拿不到就当作"最远"，排到最后 */
  centerOf: (id: string) => { lng: number; lat: number } | null
  /** 地图当前中心。`null` = 地图还没就绪 ⇒ 不排序，按原顺序读 */
  center: { lng: number; lat: number } | null
  /**
   * 到货回调。**可能被调两次**：第一次是最近的一批，第二次是全部。
   * ★ 调用方的 state 合并必须是"整体替换"，别写成累加 —— 第二次给的就是全量。
   */
  onPartial: (cities: City[]) => void
  /** 第一批读几座。默认 2（够覆盖"放大到某一座城"的绝大多数场景） */
  first?: number
}

/**
 * 开始分批读取。返回**取消函数** —— 组件卸载时要调，否则会在已卸载的组件上
 * `onPartial`（React 会警告，且白读一份数据）。
 */
export function preloadCities(o: PreloadCitiesOptions): () => void {
  let alive = true
  const first = Math.max(1, o.first ?? 2)

  void (async () => {
    const ordered = orderByDistance(o)
    const near = ordered.slice(0, first)
    const rest = ordered.slice(first)

    const got = await loadMany(near)
    if (!alive) return
    o.onPartial(got)

    if (rest.length === 0) return
    const more = await loadMany(rest)
    if (!alive) return
    // ★ 第二次给的是**全量** —— 调用方直接替换即可
    o.onPartial([...got, ...more])
  })()

  return () => {
    alive = false
  }
}

async function loadMany(ids: string[]): Promise<City[]> {
  const list = await Promise.all(ids.map((id) => loadCity(id)))
  return list.filter((c): c is City => c !== null)
}

/** 按"离地图中心多远"排序。比较平方和即可（只用来决定**先读谁**，不必开方） */
function orderByDistance(o: PreloadCitiesOptions): string[] {
  const center = o.center
  if (!center) return o.ids
  const dist = (id: string): number => {
    const c = o.centerOf(id)
    if (!c) return Number.POSITIVE_INFINITY
    const dx = c.lng - center.lng
    const dy = c.lat - center.lat
    return dx * dx + dy * dy
  }
  return [...o.ids].sort((a, b) => dist(a) - dist(b))
}
