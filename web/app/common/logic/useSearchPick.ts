/**
 * 把「搜索命中的那一枚」并进页面的选中状态 —— **三个页面共用一份**。
 *
 * ## 为什么要共用
 * 首页 / 省级页 / 城市页各有自己的 `selectedId`，但"搜索选中的怎么跟页面自己的选中
 * 拼在一起"这件事只有一种正确解释（见下面那条 ★★）。各写一遍的话，某一边迟早会把
 * 优先级反过来，表现是"搜完再点地图没反应"——而且不报错。
 *
 * ## ★★ 优先级：**搜索命中 > 页面自己的选中**（2026-09-25 改）
 *
 * 原来写的是"页面优先"，理由是"用户刚在地图上点的那一枚，比几秒前搜的那一枚更接近意图"。
 * **那个理由只覆盖了一半的情况** —— 用户报的这条链正好相反：
 * 「我点击打开一个景点的详情，然后顶部搜索地图上其他地方的景点，景点详情弹窗内容
 *   没有切换到新的景点的内容，地图上的标点也没有显示，我再找到前面打开的那个景点，
 *   那个图标是打开的样式」。
 *
 * 三个症状同一个原因：`page.id` 还停在**更早**的那次地图点击上（A），
 * 于是新命中的 B 既不进面板、也不进选中层，而 A 一直挂着"打开样式"。
 * ⇒ 正确的规则不是"谁更近"而是"**后发生的那次意图赢**"：
 *   `pick` **只在"用户刚点了搜索结果"的那一刻存在**（任何别的动作都会把它清掉），
 *   所以"页面选中比 pick 新"这种情况不存在。
 *
 * ★ 这条规则成立的**前提是那条不变量**：**任何写入页面选中的入口都要先 `clearPick()`**
 *   （地图点击 / 点空白 / 清单行 / 「详情」按钮）。
 *
 *   ⚠️ 城市页那个**清单行曾经绕过它**（`onSelect={view.setSelectedId}` 直连 setter）。
 *   要说清楚的是：**它今天不可达** —— 详情面板（620px，左侧）**盖住了**清单（348px，左侧），
 *   所以"面板开着（= pick 存在）的时候点清单"根本点不到（实测过，见 `TRAPS`）。
 *   但它是**结构上的漏洞**（"谁写选中"多了一条路），而且哪天面板变窄 / 改成不遮清单
 *   就会立刻变成"点了清单没反应"。⇒ 已改成走 `openPoi`，并把 `setSelectedId`
 *   从 `CityView` 的对外契约里删掉（少一条能绕过去的路）。护栏 = **AA⑦**。
 *
 * ## 图层要的是 `layerId`
 * 地图高亮（白底座 + 名字置选中态）由图层按 id 画，它只认"候选集合里有没有这一枚"：
 * 搜索命中的那一枚可能还没进候选（数据懒加载中 / 属于别的城市），传过去最多是不画高亮，
 * **不会**影响详情面板 —— 面板用的是 `selected`（完整 `Poi`）。
 * ★ 但"不画高亮"就是用户报的第二个症状，所以**坐标**还得单独给（`pickedPoint`，见 AA⑥）。
 *
 * ## 与"点地图空白收起"的关系
 * 清空要**两个一起清**（页面的选中 + 搜索的命中），只清一个会留下"关不掉的面板"：
 * 页面选中没了、但搜索命中还在 → 面板被重新渲染出来。
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'

import { useMapShell } from '~/common/logic/mapShell'
import { toPoiPoints, type PoiPoint } from '~/common/map/tencent'
import type { Poi } from '~shared/schema'

export interface PageSelection {
  /** 页面自己选中的那一枚（没有就是 null） */
  poi: Poi | null
  /** 页面自己那一枚所属城市名 */
  cityName: string
  /** 页面自己的选中 id —— 用来判断"再点同一枚要不要收起" */
  id: string | null
}

export interface EffectiveSelection {
  /** 真正要渲染的那一枚（**搜索命中 > 页面自己的选中**，见文件头） */
  selected: Poi | null
  cityName: string
  /** 交给图层的 id（做高亮用）—— 与 `selected` 同一口径 */
  layerId: string | null
  /**
   * 交给图层的**那一枚的坐标**（`PoiPoint` 形状），只在"搜索命中"时非空。
   *
   * ★★ 为什么非要有它（2026-09-24 用户报的"搜到别的城的景点，地图上没有点位"）：
   *   图层的选中层是从**本页候选集**里按 id 反查坐标的，而页面的候选集**按页划定**
   *   （城市页 = 本城、省级页 = 本省已收录城市）。搜索却能在任意一级命中**任何一座城**
   *   —— 于是那枚点解析不出坐标，镜头飞过去了、详情也开了，图上却是空的。
   *   把坐标单独带下去，图层就不必"先在本页数据里找到它"。
   *
   * ★ 为什么由这里给、而不是三个页面各算一遍：`toPoiPoints` 那层字段嵌套
   *   （`location.point.lng`）写错**不报错**，只会得到 `undefined` 坐标 → 点又静默消失。
   *   一份实现，三页共用。
   */
  pickedPoint: PoiPoint | null
  /** 搜索命中的那一枚的归属城市 —— 「添加行程」要用（页面索引里可能没有它） */
  pickCityId: string | null
  /** 收起：把"搜索命中"清掉（页面自己的选中由页面自己清） */
  clearPick: () => void
  /**
   * 这一下点的是不是"当前有效的那一枚" —— 页面用它实现"再点一次收起"。
   * 把搜索命中也算进来，否则搜出来之后再点它一下关不掉。
   */
  isCurrent: (poiId: string) => boolean
}

export function useSearchPick(page: PageSelection): EffectiveSelection {
  const shell = useMapShell()
  const pick = shell.searchPick

  const clearPick = useCallback(() => shell.setSearchPick(null), [shell])
  /**
   * 生效的那一枚的 id —— **pick 先、page 后**（见文件头 ★★）。
   * ★ 三个用到它的地方（`selected` / `cityName` / `layerId` / `isCurrent`）
   *   必须**同一个口径**：只改一处，就会出现"面板换了、高亮没换"这类半成品状态。
   */
  const effectiveId = pick?.poi.id ?? page.id ?? null
  const isCurrent = useCallback((poiId: string) => effectiveId === poiId, [effectiveId])
  // ★ 按 `pick` 记忆：`pick` 是外壳里的 state，身份稳定 —— 每次渲染都新建的话，
  //   它会进"城市页图层 effect"的依赖，于是每渲染一次就重建整个图层。
  const pickedPoint = useMemo(() => (pick ? (toPoiPoints([pick.poi])[0] ?? null) : null), [pick])

  /**
   * ★★ 「**选中哪一枚，就把它搬到看得见的地方**」—— 全站唯一出处（2026-09-28）。
   *
   * > 用户：「点景点的时候，要偏移地图，把景点放到地图中间，这个你没做」
   *
   * ## 为什么必须收在这里，而不是各入口各写一遍
   * 「打开一枚景点的详情」有**四个入口**：地图点圆点 / 左侧清单行 / 顶栏搜索命中 /
   * 「挑景点」浮层与地图上的序号标记（后两者都走 `searchPick` 这条信道）；
   * 而它们的选中动作**分别写在三个页面里**（三页各一份图层 `onSelect` + 城市页的 `openPoi`）。
   * 上一版只加在城市页的 `openPoi` 上 ⇒ **地图点击**（它走图层 `onSelect` 里内联的
   * `setSelectedId`）与**首页 / 省级页**全都没居中 —— 用户看到的是「点景点没放到中间」，
   * 而代码里明明"有一处做了"。`_tmp/cdp_centering_verify.mjs` 的改前基线：
   * 四个入口里只有「城市页 · 清单行」居中（偏差 0px），其余三个都是 **121px**。
   *
   * 收在这里的理由与上面那条优先级规则一模一样：**"生效的是哪一枚"只有这一个出处**，
   * 那么"把它摆到看得见的地方"也只能有一个出处 —— 四入口 × 三页自动全覆盖，漏不掉。
   *
   * ## 三条时序与边界（都踩过）
   * 1. **等两帧**再动镜头：详情浮层是这次选中才挂上的，外壳的浮层清单要等 commit 之后的
   *    effect 才把它收进去；立刻平移会按"还没有浮层"的可视区算中心（实测差 ~140px，
   *    点落在面板边上而不是正中）。
   * 2. **同一枚不重复搬**（用 ref 记 id）：`centerOn` 自己也有 ±24px 死区，
   *    但重跑一帧两帧的 rAF 是白开销，而且会把用户中途的手动拖动打回去。
   * 3. **收起（`null`）不动镜头**：用户合上卡片时不该看到地图自己跳一下 ——
   *    所以这一支只清记忆、不调 `centerOn`（清了记忆，下次再点同一枚才会重新居中）。
   */
  const centeredIdRef = useRef<string | null>(null)
  const selectedRef = useRef<Poi | null>(null)
  selectedRef.current = pick?.poi ?? page.poi ?? null
  useEffect(() => {
    const poi = selectedRef.current
    if (!poi) {
      centeredIdRef.current = null
      return
    }
    if (centeredIdRef.current === poi.id) return
    centeredIdRef.current = poi.id
    const target = { lng: poi.location.point.lng, lat: poi.location.point.lat }
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => shell.centerOn(target)))
    return () => cancelAnimationFrame(raf)
  }, [effectiveId, shell])

  return {
    selected: pick?.poi ?? page.poi ?? null,
    cityName: pick ? pick.cityName : page.cityName,
    layerId: effectiveId,
    pickedPoint,
    pickCityId: pick?.cityId ?? null,
    clearPick,
    isCurrent,
  }
}
