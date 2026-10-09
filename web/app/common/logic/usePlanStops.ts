/**
 * 把一条规划解析成**可直接渲染、可直接画图**的一串站。
 *
 * ## 为什么需要它（而不是直接用 `plan.days`）
 * 每一站要显示的东西里，有几样**只长在 POI 上**：
 * 名字（老数据）、坐标（老数据）、**缩略图**（`images`）、**所在区**（`location.district`）。
 * 所以要把 `poiId` 拿去 `loadCity(plan.cityId)` 查一次，把字段补齐。
 *
 * ★ 2026-09-27 放宽过一次判据：原来只在"缺坐标或名字"（老数据）时才查 ——
 *   结果**新数据不查**，缩略图与区名双双为空（列表里全是灰占位块、第二行只剩省市），
 *   而且**不报错**。现在只要有 `poiId` 就查。`loadCity` 有缓存，代价只是一次内存读。
 *
 * ## 拿不到城市数据时怎么办
 * **如实标出来**（`resolved: false` → 列表里显示「点位已失效」），
 * 绝不猜坐标。猜出来的点在图上看着没问题，实际是错的 —— 那比不显示更糟。
 *
 * ## ★ 地图取点的**地址**（2026-09-28 加）
 * 景点那一行的「省 · 市 · 区」来自城市数据；**地图取点手里只有坐标** ——
 * 于是它那一行原来显示的是 `30.5728, 104.0668`（用户：「第二行不是显示经纬度，
 * 而是显示省市区，保持和其他的一致」）。现在走 `geocode.ts` 的逆地理编码补上：
 *   · 带缓存（同坐标只查一次，`pruneLru` 300 条）；
 *   · **先同步吃一遍缓存**再发请求 —— 命中的当场就能显示，不必先闪一下"定位中…"；
 *   · 查不到就空着（那一行显示"定位中…"），不用最近的城市去猜。
 */

import { useEffect, useMemo, useState } from 'react'

import { loadCity } from '~/common/data/cityRegistry'

import { cachedAddress, formatAddress, reverseGeocode } from './itinerary/geocode'
import { flattenStops, type PlanStopView } from './itinerary/planStops'
import type { Poi, RoutePlan } from '~shared/schema'

export interface PlanStopsResult {
  stops: PlanStopView[]
  /** 正在读那座城的点位 */
  loading: boolean
  /** 城市数据没读到 —— 点位只能显示为「点位已失效」（坐标也补不出来） */
  cityMissing: boolean
}

/**
 * 这一条里有没有**需要回城市数据查**的点位。
 *
 * ★ 判据就是"有没有 `poiId`"：名字与坐标也许已经存在行程里（新数据），
 *   但**缩略图与所在区**只长在 POI 上 —— 不查城市就永远是空的。
 *   地图取点（`kind === 'point'`，没有 `poiId`）本来就不需要查。
 */
function needsCityLookup(plan: RoutePlan | null): boolean {
  if (!plan) return false
  return plan.days.some((d) => d.items.some((it) => Boolean(it.poiId)))
}

export function usePlanStops(plan: RoutePlan | null): PlanStopsResult {
  const cityId = plan?.cityId ?? null
  const need = needsCityLookup(plan)
  const [pois, setPois] = useState<Map<string, Poi> | null>(null)
  const [loading, setLoading] = useState(false)
  const [missing, setMissing] = useState(false)
  /** `uid` → 「省 · 市 · 区」（只对地图取点有值） */
  const [addr, setAddr] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!cityId || !need) {
      // 这条规划一个 POI 都没有（全是地图取点）—— 没什么可查的。
      // ★ 这里**必须把上一座城的索引清掉**，否则换一条规划时还会拿旧城的 poiId 去查，
      //   查不到就显示"已失效"（错怪数据）
      setPois(null)
      setLoading(false)
      setMissing(false)
      return
    }
    let alive = true
    setLoading(true)
    setMissing(false)
    loadCity(cityId)
      .then((city) => {
        if (!alive) return
        if (!city) {
          setMissing(true)
          setPois(null)
          return
        }
        setPois(new Map(city.pois.map((p) => [p.id, p])))
      })
      .catch(() => {
        if (alive) setMissing(true)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [cityId, need])

  /** 换一条规划就把地址表清掉（uid 是全局唯一的，留着只会越长越大） */
  useEffect(() => {
    setAddr({})
  }, [plan?.id])

  /**
   * 地图取点的地址 —— 异步补。
   * ★ 先同步吃缓存（命中就当场能显示），miss 的才发请求；失败的坐标 `geocode.ts` 会记住，
   *   不会每渲染一次重试一遍。
   */
  useEffect(() => {
    if (!plan) return
    const pts: Array<{ uid: string; lng: number; lat: number }> = []
    for (const d of plan.days) {
      for (const it of d.items) {
        if (it.kind !== 'point') continue
        if (typeof it.lng !== 'number' || typeof it.lat !== 'number') continue
        pts.push({ uid: it.uid, lng: it.lng, lat: it.lat })
      }
    }
    if (pts.length === 0) return

    const hit: Record<string, string> = {}
    const miss: typeof pts = []
    for (const p of pts) {
      const a = cachedAddress(p.lng, p.lat)
      if (a) hit[p.uid] = formatAddress(a)
      else miss.push(p)
    }
    if (Object.keys(hit).length > 0) setAddr((cur) => ({ ...cur, ...hit }))
    if (miss.length === 0) return

    let alive = true
    void Promise.all(
      miss.map(async (p) => {
        const a = await reverseGeocode(p.lng, p.lat)
        return a ? ([p.uid, formatAddress(a)] as const) : null
      }),
    ).then((rows) => {
      if (!alive) return
      const got = rows.filter((r): r is readonly [string, string] => r !== null)
      if (got.length === 0) return
      setAddr((cur) => ({ ...cur, ...Object.fromEntries(got) }))
    })
    return () => {
      alive = false
    }
  }, [plan])

  const stops = useMemo(
    () => (plan ? flattenStops(plan, pois, (uid) => addr[uid] ?? null) : []),
    [plan, pois, addr],
  )

  return { stops, loading, cityMissing: missing }
}
