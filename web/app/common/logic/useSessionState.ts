/**
 * **页面上的「选择」与「筛选」** —— 接到会话状态上（刷新保留），三页共用一份接线。
 *
 * > 用户 2026-09-29：「我不管怎么弄，打开什么东西，我只要刷新页面，就又回到了最开始
 * >   打开时的样子，这个页面保持的功能得完善一下…… 关掉页面重新打开，这种情况
 * >   恢复最初始的版本没问题」
 *
 * ## 为什么必须收成 hook，而不是各页各写一遍
 * 三个页面各有一份"选中的景点"，城市页还多一份筛选。而"接到会话状态上"只有一种正确
 * 写法：**初值来自恢复值、变化时写回**。各写一遍的话，迟早有一页忘了写回 ——
 * 表现就是"那一页刷新之后还是回到初始"，而另外两页是好的（用户报的正是这种半好）。
 *
 * ## 三条纪律
 * 1. **初值走惰性函数**（`useState(() => …)`）：读存储有副作用，不该每次渲染都跑；
 * 2. **写回走 effect**：页面里写 `selectedId` 的地方有好几处（点地图 / 点清单 /
 *    点空白 / 收起），逐个去调 `patchPick` 一定会漏 ⇒ 用一条 effect 盯住**状态本身**，
 *    所有写入点自动覆盖（这也是"唯一出处"）。
 * 3. **换身份用渲染期收敛**，不用 effect —— 见 `useSessionFilter` 里那段注释：
 *    effect 会晚一拍，写回那条会**抢先把旧城的筛选写给新城**（静默少显示景点）。
 */

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

import { patchFilter, patchPick, readUiState } from '~/common/data/uiState'
import type { Category, SubType } from '~shared/schema'
import type { PoiSort } from '~/common/ui/city/PoiList'

/** 该城的筛选记录（没有记录 ⇒ 默认值：全选 + 热门优先） */
function filterOf(cityId: string): { category: Category | null; subtype: SubType | null; sort: PoiSort } {
  const f = readUiState().filters[cityId]
  return { category: f?.category ?? null, subtype: f?.subtype ?? null, sort: f?.sort ?? 'hot' }
}

/**
 * 「当前选中的那一枚景点」+ 会话状态。
 *
 * @param pageKey 页面身份（`home` / `city:chengdu` / `province:510000`）。
 *   ★ **必须带上城市 / 省份**：不带的话，在成都选了「宽窄巷子」再换到北京，
 *   刷新后北京页会去找一个不属于它的 id（表现为"什么都没有"，且不报错）。
 */
export function useSessionPick(
  pageKey: string,
): [string | null, Dispatch<SetStateAction<string | null>>] {
  const [id, setId] = useState<string | null>(() => readUiState().picks[pageKey] ?? null)
  /** 上一次的身份 —— 用来区分"状态变了"与"换了个身份" */
  const keyRef = useRef(pageKey)

  useEffect(() => {
    if (keyRef.current !== pageKey) {
      // ★ 换了身份（换城 / 换省）：装进新身份的恢复值，**且不把旧值写给新身份**
      keyRef.current = pageKey
      setId(readUiState().picks[pageKey] ?? null)
      return
    }
    patchPick(pageKey, id)
  }, [pageKey, id])

  return [id, setId]
}

export interface SessionFilterState {
  category: Category | null
  subtype: SubType | null
  sort: PoiSort
  setCategory: Dispatch<SetStateAction<Category | null>>
  setSubtype: Dispatch<SetStateAction<SubType | null>>
  setSort: Dispatch<SetStateAction<PoiSort>>
}

/**
 * 城市页的**筛选与排序** + 会话状态。
 *
 * ★ 按 `cityId` 分开存：在成都筛「特色美食」，回到成都还是它（这是对的）；
 *   而一座**没筛过**的城必须是干净的全选 —— 把一份筛选跨城沿用会静默地少显示景点
 *   （用户会说"北京怎么才这么几个点"）。
 */
export function useSessionFilter(cityId: string): SessionFilterState {
  const [own, setOwn] = useState(() => ({ city: cityId, ...filterOf(cityId) }))

  /**
   * 换了城市 ⇒ 整体换成那座城的记录。
   *
   * ★★ 这里**必须在渲染期收敛**，不能放 effect：写回那条 effect 会**抢先把旧城的三项
   *   写给新城**（同一轮里 effect 按定义顺序跑），新城凭空多出一份不属于它的筛选。
   *   这是 React 官方那条 "adjusting state when a prop changes" 模式 —— 渲染期
   *   `setState` 会立刻重渲染，用户看不到中间态。
   */
  if (own.city !== cityId) setOwn({ city: cityId, ...filterOf(cityId) })

  useEffect(() => {
    patchFilter(own.city, { category: own.category, subtype: own.subtype, sort: own.sort })
  }, [own])

  /** 三个 setter 都要吃"值或更新函数"（调用方两处风格都有） */
  const apply = <K extends 'category' | 'subtype' | 'sort'>(k: K, v: SetStateAction<typeof own[K]>) =>
    setOwn((s) => ({ ...s, [k]: typeof v === 'function' ? (v as (p: typeof own[K]) => typeof own[K])(s[k]) : v }))

  return {
    category: own.category,
    subtype: own.subtype,
    sort: own.sort,
    setCategory: (v) => apply('category', v),
    setSubtype: (v) => apply('subtype', v),
    setSort: (v) => apply('sort', v),
  }
}
