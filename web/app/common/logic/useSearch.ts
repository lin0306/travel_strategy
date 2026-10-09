/**
 * 顶栏搜索的**状态机**：输入 → 防抖 → 匹配 → 命中动作。
 *
 * ## 三条设计取舍
 * 1. **索引按需加载**：一进页面不读，第一次真的输入才读（约 160KB 的静态产物）。
 *    首页 / 详情页可能一次搜索都不用，没必要为它付首屏成本。
 * 2. **匹配是本地纯函数**（`search.ts`），所以"输入 → 结果"没有网络往返，
 *    防抖 300ms 纯粹是给重渲染与中文输入法留气口（`plans/03` I6 定的数）。
 * 3. **命中后的动作是"取景 + 交棒"**：镜头由这里飞（`shell.fit`），而"打开详情"
 *    交给**页面**（`shell.setSearchPick`）—— 详情面板长在页面上，三页各有自己的
 *    点位数据与选中状态，搜索框不该再实现一遍（见 `mapShell.SearchPick` 的注释）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

import { loadCity } from '~/common/data/cityRegistry'
import { loadSearchIndex } from '~/common/data/searchIndex'
import { useMapShell } from '~/common/logic/mapShell'
import {
  poiFocusPoints,
  regionFocusPoints,
  searchHits,
  type SearchResults,
} from '~/common/logic/search'
import type { SearchIndex, SearchPoi, SearchRegion } from '~shared/schema'

/** 防抖时长。定这个数的是 03 文档 I6，不是"本地匹配慢" */
const DEBOUNCE_MS = 300

/** 一条件命中的**联合**形状 —— 键盘把两组拉平后走的就是它 */
export type SearchHit =
  | { kind: 'region'; region: SearchRegion }
  | { kind: 'poi'; poi: SearchPoi }

/**
 * 索引的可用状态。**必须区分"还没加载"与"没有"**：
 * 前者要等，后者要给一句人话（流水线跑过 `build` 才有这份索引）——
 * 混成一个 `results.length === 0` 会让用户以为"我搜错了"。
 */
export type SearchStatus = 'idle' | 'loading' | 'ready' | 'unavailable'

export interface SearchController {
  query: string
  setQuery: (q: string) => void
  results: SearchResults
  /** 两组按渲染顺序拉平 —— 键盘 ↑↓ 走的就是它，顺序必须与列表一致 */
  flat: SearchHit[]
  active: number
  setActive: (i: number) => void
  status: SearchStatus
  /** 命中一条：飞镜头（+ 交出待开的详情），并收起列表 */
  pick: (hit: SearchHit) => void
  /** 收起（Esc / 点空白 / 失焦） */
  reset: () => void
}

const EMPTY: SearchResults = { regions: [], pois: [] }

export function useSearch(): SearchController {
  const shell = useMapShell()
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [index, setIndex] = useState<SearchIndex | null>(null)
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [active, setActive] = useState(0)

  // ── 防抖：输入停下 300ms 才算一次查询 ──
  useEffect(() => {
    if (!query.trim()) {
      setDebounced('')
      return
    }
    const t = setTimeout(() => setDebounced(query), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query])

  // ── 索引：**第一次真的要用**才读（不是一进页面就读）──
  useEffect(() => {
    if (!debounced || index !== null || status === 'unavailable') return
    let alive = true
    setStatus('loading')
    void loadSearchIndex().then((idx) => {
      if (!alive) return
      setIndex(idx)
      setStatus(idx ? 'ready' : 'unavailable')
    })
    return () => {
      alive = false
    }
  }, [debounced, index, status])

  const results = useMemo<SearchResults>(
    () => (index ? searchHits(index, debounced) : EMPTY),
    [index, debounced],
  )

  const flat = useMemo<SearchHit[]>(
    () => [
      ...results.regions.map((region) => ({ kind: 'region' as const, region })),
      ...results.pois.map((poi) => ({ kind: 'poi' as const, poi })),
    ],
    [results],
  )

  // 结果集一变就把光标收回第一行 —— 否则它会停在一个已经不存在的位置上，
  // 下一次回车就会打开一个用户根本没看见的东西
  useEffect(() => {
    setActive(0)
  }, [flat.length, debounced])

  const reset = useCallback(() => {
    setQuery('')
    setDebounced('')
  }, [])

  const pick = useCallback(
    (hit: SearchHit) => {
      if (hit.kind === 'region') {
        if (!index) return
        // 省 / 市的取景点来自**索引本身**（不触发任何加载），口径与点徽标完全一致
        void regionFocusPoints(index, hit.region).then((t) => {
          if (t.points.length > 0) shell.fit(t.points, { reason: 'drill', minZoom: t.minZoom, anchor: t.anchor })
        })
      } else {
        // ★ 先飞（"偏移放大"要立刻有反馈），再取数据开详情：
        //   数据取不到只是不弹面板，镜头该动还是动了 —— 反过来做会让人以为没反应
        shell.fit(poiFocusPoints(hit.poi), { reason: 'drill' })
        void loadCity(hit.poi.cityId).then((city) => {
          const poi = city?.pois.find((p) => p.id === hit.poi.id)
          if (!city || !poi) {
            // 索引里有、城市数据里没有 ⇒ 两边不同步（索引是 `build` 产出的快照）
            console.warn(
              `[search] 城市「${hit.poi.cityId}」里找不到「${hit.poi.id}」—— 数据与索引可能不同步`,
            )
            return
          }
          shell.setSearchPick({ poi, cityId: hit.poi.cityId, cityName: city.name })
        })
      }
      // 命中即收起列表：留着会把刚飞过去的视野盖住
      reset()
    },
    [index, shell, reset],
  )

  return {
    query,
    setQuery,
    results,
    flat,
    active,
    setActive,
    status,
    pick,
    reset,
  }
}
