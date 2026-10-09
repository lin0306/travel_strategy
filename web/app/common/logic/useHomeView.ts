/**
 * 首页（全国视图）的**页面逻辑**（与端无关）—— 三级下钻的第一级。
 *
 * ## 这一页的职责
 * 把 34 个省级单位铺成一张**计数徽标**的地图。地图本身就是全部内容，
 * 没有侧边清单 —— 清单与徽标是同一份信息的两种画法，同时出现等于把同一句话说两遍，
 * 而且清单会吃掉左侧一大块画布，与「地图即画布」相悖。
 * **不要"顺手"把省份清单加回来。**
 *
 * 所有计数都来自构建期固化的 `district-tree.json`，**运行时零 API 调用**。
 *
 * ## 缩放揭示（2026-09-19 加，2026-09-20 改为"看内容的判定"）
 * 本页的 `base` 是 `province`，放大之后会**在本页**依次铺出：
 * | 缩放 | 判定 | 铺什么 |
 * |------|------|--------|
 * | < 6.5 | 省 | 34 个省徽标 |
 * | ≥ 6.5 | 先试市 | 视野内各省的**市徽标** |
 * | ≥ 8.5 | 先试点位 | 视野内**已收录市**的点位圆点 |
 *
 * ★★ **每一级都是"试"，不是"该"** —— 视野里没有市徽标就退回省徽标，
 *    没有点位就退回市徽标。修复前判据只看缩放（"缩放到 6.5 就该铺市徽标"），
 *    于是视野落在没有市的地方会铺一张**空地图**。判定与回流现在收在
 *    `common/map/tencent/reveal.ts`（纯函数，带 trace）。
 *
 * ## ★ 地图上的点击做三件**不同**的事（2026-09-23 定稿，别合并成一件）
 * | 点的是 | 做什么 | 为什么不是别的 |
 * |--------|--------|----------------|
 * | 省 / 市**徽标** | 放大到对应的比例（`shell.fit`，对照表在 `districtFocus.ts`） | 徽标表达的是"这一级有什么"，点它就该看得更清 |
 * | 景点**图标 / 名字** | **就地看详情** —— 桌面浮出 620px 详情面板（`desktop/ui/PoiDetailOverlay`）、移动端浮底部 Sheet（`mobile/ui/PoiDetailSheet`） | 点一枚景点是为了看它是什么，**镜头不该动、URL 也不该变**。原话：「点景点的标签和图标，不应该是打开景点详情吗，怎么缩放地图了」，以及「点那个看详情，会触发跳转，这个跳转不需要」 |
 * | 地图**空白** | 收起详情 | 没有出口的浮层 = 用户觉得"关不掉" |
 *
 * ★ 三者都**不换路由**，两端都是（详情就地浮层，不是跳详情页）。
 * ★ 揭示**不换路由**；点徽标 / 景点也**不换路由**（这一页没有回全国的出口，
 *   URL 一变就是"关不掉"）。
 *
 * ## ★ 本页画的是「省的面」—— 用该省各市的轮廓拼出来的（2026-09-30 改）
 * 腾讯**确实拿不到"省自身"的轮廓**（`getchildren?id=<省>` 返的是子级**市**；
 * `id=100000` 返 0 个节点、`/district/v1/boundary` 不存在、`search` 永不带 `polygon`）。
 * 但**该省各市的轮廓拼起来就是省界** —— 省界本来就是各市外边界的并集，
 * 数据一样来自腾讯 District ⇒ 揭示层按"当前铺的是哪一级"去取（`loadBoundsForLevel`）。
 * 不画的时候用户看到的是**底图那条淡线**，会以为"我们根本没做轮廓"
 * （2026-09-30 用户：「省市区的所有轮廓都不明显」）。
 * ★ 只画**已收录城市所在的省**：其余省没有边界文件，而且"没收录的省不画面"
 *   本身就是我们要表达的信息（与「河北 —」那种徽标同义）。
 *
 * ## 三种"数据不齐"的情况都要优雅
 * | 情况 | 表现 |
 * |------|------|
 * | 区划树未生成 | 不撒徽标，视野仍是全国取景框 `NATIONAL_FIT_CORNERS`（与数据无关） |
 * | 地图 SDK 不可用 | 走降级画布，徽标与下钻完全不受影响 |
 * | 某级没有数据 | **退回上一级**（如视野内没有一个点位 → 仍铺市徽标），不摆一张空地图 |
 *
 * ## ★ null ≠ 0
 * 徽标上的计数走 `poiCount === null ? '待收录' : 'N 个'`。
 * 一旦有人图省事写成 `poiCount ?? 0`，这一页就会开始骗用户 ——
 * 它会把「北京 0 个可玩的地方」标到地图上，而事实是我们还没做。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

import { focusPointsFor, parentCityOf, sameDistrict, type FocusSources } from '~/common/logic/districtFocus'
import { useFitOnce } from '~/common/logic/useFitOnce'
import { useIsMobile } from '~/common/logic/useViewport'
import { useMapReveal } from '~/common/logic/useMapReveal'
import { preloadCities } from '~/common/logic/preloadCities'
import { useSearchPick } from '~/common/logic/useSearchPick'
import { useSessionPick } from '~/common/logic/useSessionState'
import { useAddToPlan } from '~/common/logic/useAddToPlan'
import { useDistrictIndex } from '~/common/logic/useDistrictIndex'
import { registerPageSpotOps, useMapShell, type MapShellContext } from '~/common/logic/mapShell'
import { loadCity } from '~/common/data/cityRegistry'
import {
  findSubdistrictOwner,
  loadDistrictBox,
  loadSubdistricts,
  type SubdistrictRow,
} from '~/common/data/subdistricts'
import {
  loadAllCityRows,
  loadNationalView,
  type CityRowWithParent,
  type ProvinceRow,
} from '~/common/data/regions'
import { NATIONAL_FIT_CORNERS, toPoiPoints } from '~/common/map/tencent'
import type { City, Poi } from '~shared/schema'

export interface HomeView {
  shell: MapShellContext
  /** 选中的景点（就地详情面板用）。`null` = 没选中 —— 面板自己会渲染成空 */
  selected: Poi | null
  /** 选中景点所属城市名（详情里的面包屑那一段） */
  selectedCityName: string
  /** 选中景点**归属的城市 id**（详情的「添加行程」按钮用它判断"是不是在看这座城的规划"） */
  selectedCityId: string
  /** 收起详情（面板上的关闭按钮；点地图空白走图层回调） */
  closePoi: () => void
  /** 添加行程（详情面板上的按钮）。★ **不换页**：只弹一个「加到哪个组」的窗（plans/13 §6.5） */
  addToPlan: (poiId: string) => void
}

export function useHomeView(): HomeView {
  const shell = useMapShell()
  const addPoi = useAddToPlan()
  const isMobile = useIsMobile()

  const [rows, setRows] = useState<ProvinceRow[] | null>(null)
  const [cityRows, setCityRows] = useState<CityRowWithParent[]>([])
  /** 点位级**懒加载**下来的城市。点位与两张索引全部由它派生（见下面的 useMemo） */
  const [poiCities, setPoiCities] = useState<City[]>([])
  /**
   * 区级**懒加载**下来的分片 —— key 是**市的 adcode**（分片文件名就是它）。
   * 首页只有放大到 9.5 以上才来读，见下面那条懒加载 effect。
   */
  const [subRows, setSubRows] = useState<Record<string, SubdistrictRow[]>>({})
  /**
   * **全国**区节点（构建期索引，2894 个区）—— 铺区徽标用。
   * 与 `subRows` 的分工见 `useDistrictIndex` 的文件头（那个只有已收录城市，给取景用）。
   */
  const districtIndex = useDistrictIndex()
  /** 当前选中的景点：地图高亮与右侧预览卡都由它驱动 */
  /** 选中的那一枚 —— 走**会话状态**（刷新之后还在，见 `useSessionState`） */
  const [selectedId, setSelectedId] = useSessionPick('home')

  // ── 数据：省级清单 + 全国市级清单 ──
  useEffect(() => {
    let alive = true
    void (async () => {
      const [national, cities] = await Promise.all([loadNationalView(), loadAllCityRows()])
      if (!alive) return
      setRows(national.rows)
      setCityRows(cities)
    })()
    return () => {
      alive = false
    }
  }, [])

  const collectedIds = useMemo(
    () => [...new Set(cityRows.map((c) => c.cityId).filter((id): id is string => id !== null))],
    [cityRows],
  )

  /**
   * 点位候选 + 两张索引 —— **同源**，都从 `poiCities` 派生。
   *
   * ★ 存成三份 state 的写法迟早会分叉：出现"点位上屏了、索引里却没有"的半成品状态时，
   *   表现是**点景点没反应**（不报错、不崩、控制台干净）。
   * · `poiById` 喂详情面板：详情要封面 / 摘要 / 亮点 / 溯源，光有坐标画不出来；
   * · `poiMeta` 只为"添加行程"与"详情里的城市名"存在：点位可能来自索引里没细看的城市，
   *   得先知道归属。
   */
  const poiPoints = useMemo(() => poiCities.flatMap((c) => toPoiPoints(c.pois)), [poiCities])
  const poiById = useMemo(() => {
    const m = new Map<string, Poi>()
    for (const c of poiCities) for (const p of c.pois) m.set(p.id, p)
    return m
  }, [poiCities])
  const poiMeta = useMemo(() => {
    const m = new Map<string, { cityId: string; cityName: string }>()
    for (const c of poiCities) for (const p of c.pois) m.set(p.id, { cityId: c.id, cityName: c.name })
    return m
  }, [poiCities])

  /**
   * 「点徽标要框哪一片」的数据源 —— 本页把两级数据接进来（见 `districtFocus.ts`）：
   * · 省 → 它下辖各市的中心（`cityRows` 带 `provinceAdcode`）
   * · 市 → 该市的点位（`loadCity`；只对已收录的市有）
   */
  const focusSources = useMemo<FocusSources>(
    () => ({
      // ★ 三级是**有优先级**的（见 `focusPointsFor`）：市的区 > 省下辖的市 > 该市的点位。
      //   区分片只有 1KB，优先用它 —— `poisOf` 要把整座城市的点位全读进来才框得出同样一片。
      childrenOf: (adcode) => {
        const sub = subRows[adcode]
        if (sub?.length) return sub.map((r) => ({ lng: r.center.lng, lat: r.center.lat }))
        return cityRows
          // ★ 排除 `adcode` 自己：直辖市**自身**就是一座市，它也在 `cityRows` 里
          //   且 `provinceAdcode` 等于自己的 adcode —— 不排除的话"点北京市徽标"
          //   会拿**它自己**这一个点去 fit，镜头直接掉到街区级（零面积范围的兜底）。
          .filter((c) => c.provinceAdcode === adcode && c.adcode !== adcode && c.center !== null)
          .map((c) => ({ lng: c.center!.lng, lat: c.center!.lat }))
      },
      // 市：按 adcode 找；区：先用「区 adcode 前 4 位」定到所属的市，再按区名筛；已加载的直接用
      poisOf: async (adcode, name) => {
        const c = cityRows.find((x) => x.adcode === adcode) ?? parentCityOf(adcode, cityRows)
        if (!c?.cityId) return []
        const city = poiCities.find((x) => x.id === c.cityId) ?? (await loadCity(c.cityId))
        const hit = (city?.pois ?? []).filter((p) => c.adcode === adcode || sameDistrict(p.location.district, name))
        return hit.map((p) => ({ lng: p.location.point.lng, lat: p.location.point.lat }))
      },
      /**
       * 区（第四级）**自己的**外接框 —— 从它所属那座市的边界文件里取。
       * ★ 与省级页同一条：少了它，"点区"会掉到 0.5° 的近似方块（市的量级），
       *   镜头往外退 —— 那就是「点区怎么还缩小地图了」。
       */
      boxOf: async (adcode) => {
        const parent = findSubdistrictOwner(subRows, adcode)
        return parent ? await loadDistrictBox(parent, adcode) : null
      },
    }),
    // ★ 依赖 `subRows`：区分片到货后，"点市徽标框哪一片"要跟着变
    [cityRows, subRows],
  )

  /**
   * 真正要渲染的那一枚 = 页面自己的选中 > 搜索命中（合并规则见 `useSearchPick`）。
   * ★ 定义在 `useMapReveal` **之前**：下面几个回调会用到它，写在后面虽然运行期也对，
   *   但读起来像"先用后定义"。
   */
  const pageSelected = useMemo(
    () => (selectedId ? (poiById.get(selectedId) ?? null) : null),
    [selectedId, poiById],
  )
  const sel = useSearchPick({
    poi: pageSelected,
    cityName: selectedId ? (poiMeta.get(selectedId)?.cityName ?? '') : '',
    id: selectedId,
  })

  // ── 揭示 ──
  //
  // ★ 数据源只给「该级的**全部候选**」，**不要在页面里按视野筛** ——
  //   判据与筛选统一在 `useMapReveal` 里做（见其文件头 ★★）。
  //   页面自己筛一次、钩子再筛一次的话，两处 pad 不同就会得到
  //   "判据说有点、集合里没有"这种半空状态。
  const { revealed } = useMapReveal({
    base: 'province',
    // ★ 面由揭示层按 `d.level` **现取**（见 `loadBoundsForLevel`）—— 本页不再自己传
    //   `districtFile`：那样只会把面固定成"省的面"，放大到市/区级时新徽标一个面都没有。
    // ★ 末尾那一项是**区索引**：它异步到货，不给它一个坑，揭示就不会重算 ——
    //   表现是"放大到区这一级什么都没出来"，而数据其实已经在了
    dataKey: `${rows?.length ?? -1}|${cityRows.length}|${poiPoints.length}|${Object.keys(subRows).length}|${districtIndex?.length ?? -1}`,
    // 两端都聚合，只差"独立点要不要挂名字"（见 `poiLayer` 文件头）
    names: !isMobile,
    // 选中的那一枚画在选中层上（彩色白环 + 名字置为选中态），不进聚合
    // ★ 传 `layerId` 而不是 `selectedId`：搜索命中的那一枚也要高亮（它在候选里时才画得出来）
    selectedId: sel.layerId,
    // ★ 还要把**坐标**一起给图层：搜索命中的可能是**别的城**的景点，
    //   而本页候选只有已收录城市 —— 少了它，镜头飞过去了、详情开了、图上却是空的
    pickedPoint: sel.pickedPoint,
    // ★ 地图点击的三条分工（徽标放大 / 景点开详情 / 空白收起）写在文件头那张表里
    onSelectDistrict: (node) => {
      void focusPointsFor(node, focusSources).then((t) =>
        shell.fit(t.points, { reason: 'drill', minZoom: t.minZoom, anchor: t.anchor }),
      )
    },
    onSelectPoi: (poiId) => {
      // ★ 点景点 = **就地看详情**（面板浮在地图上），不推镜头、不换页、两端一致。
      //   再点同一个即收起 —— 用 `isCurrent` 把"搜索命中过的那一枚"也算作已选中，
      //   否则搜出来之后再点它一下关不掉（面板看着像卡住了）。
      const wasOn = sel.isCurrent(poiId)
      shell.setSearchPick(null)
      setSelectedId(wasOn ? null : poiId)
    },
    // 点地图空白 → 收起卡片。★ 判定归图层（只有它知道有没有命中），见 `poiLayer`
    onBlank: () => {
      setSelectedId(null)
      shell.setSearchPick(null)
    },
    districts: (lvl) => {
      // 省级：本页的立身之本，34 个（视野筛选交给钩子）
      if (lvl === 'province') {
        return (rows ?? [])
          .filter((r) => r.center !== null)
          .map((r) => ({
            adcode: r.adcode,
            name: r.name,
            lng: r.center!.lng,
            lat: r.center!.lat,
            poiCount: r.poiCount,
          }))
      }
      // 市级：全国所有市的候选（判据用**市本身**的位置，不用省中心 ——
      // 放大后视野常常整块落在省内部，省中心不入镜）
      if (lvl === 'city') {
        return cityRows
          .filter((c) => c.center !== null)
          .map((c) => ({
            adcode: c.adcode,
            name: c.name,
            lng: c.center!.lng,
            lat: c.center!.lat,
            poiCount: c.poiCount,
          }))
      }
      // 区级（第四级）：**全国所有区**（构建期索引）。未收录城市的区 `poiCount: null`
      // ⇒ 徽标显示「XX区 —」（待收录），与省 / 市两级的口径一致。
      // ★ 不是 `subRows` —— 那个只有已收录城市（它服务的是"点市徽标框哪一片"）。
      if (lvl === 'district') return districtIndex ?? []
      // 不该走到这里：本页最深就是区级（`POI_REVEAL_ZOOM` 之上归 `pois()` 管）
      return []
    },
    // 点位级：已收录城市的全部点位。
    // ★ 返回 `null`（而不是 `[]`）表示"**还没加载**" —— 这两件事在决策侧决定的是
    //   相反的动作：前者保持现状并去读数据，后者会**退回市徽标**。
    //   写成 `?? []`（修复前就是这样）会让懒加载与回流互相锁死：
    //   没数据 → 判空 → 退回浅一级 → 拿浅一级去判"不需要加载" → 永远没数据。
    pois: (lvl) => {
      if (lvl !== 'poi') return []
      if (poiPoints.length === 0 && collectedIds.length > 0) return null
      return poiPoints
    },
  })

  // ── 区的懒加载：同上用 `revealed` 触发 ──
  // ★ 只给**已收录**的市拉分片（12 座 × 约 1KB）。全国 367 个市的区分片都有，
  //   但给没内容的城市撒满"0 个"的区徽标，是在谎报"这地方没景点"——
  //   真相是我们还没收录，那该显示的是市一级的灰虚线待收录。
  useEffect(() => {
    if (revealed !== 'district') return
    const todo = cityRows.filter(
      (c) => c.cityId !== null && c.adcode !== '' && subRows[c.adcode] === undefined,
    )
    if (todo.length === 0) return
    let alive = true
    void (async () => {
      const got = await Promise.all(
        todo.map(async (c) => [c.adcode, await loadSubdistricts(c.adcode)] as const),
      )
      if (!alive) return
      setSubRows((cur) => {
        const next = { ...cur }
        for (const [ad, rs] of got) next[ad] = rs ?? []
        return next
      })
    })()
    return () => {
      alive = false
    }
  }, [revealed, cityRows, subRows])

  // ── 点位的懒加载：第一次真的"该到"点位级时才读 ──
  // ★ 用 `revealed`（缩放判据说该到哪一级）而不是 `level`（实际铺的是哪一级）——
  //   数据没到齐时回流会把 `level` 压浅，用 `level` 判就永远不会来加载。
  // 放在揭示之后是刻意的 —— 绝大多数访问不会放大到 `POI_REVEAL_ZOOM`，
  // 没必要在首屏就解析三座城市的全部点位。
  useEffect(() => {
    if (revealed !== 'poi' || poiCities.length > 0 || collectedIds.length === 0) return
    // ★ 分两批读：先把**眼前这几座城**的点位铺出来（其余随后补齐）——
    //   一次全读实测有 4s 空窗，用户看到的是"放大之后半天没反应"（见 `preloadCities`）
    return preloadCities({
      ids: collectedIds,
      centerOf: (id) => cityRows.find((r) => r.cityId === id)?.center ?? null,
      center: shell.center(),
      onPartial: setPoiCities,
    })
  }, [revealed, poiCities.length, collectedIds, cityRows, shell])

  // ── 视野：**恒定的全国取景框**（国界 + 留白）──
  //
  // ★★ 不再用"34 个省级中心点"去 fit。省中心离国界很远（黑龙江中心在东经 126°，
  //    国界到了 135°），框出来的只是"省中心们"—— 东北与西北整块在框外，
  //    用户的原话是「地图默认的缩放级别还得再缩一点，没办法看清楚全中国」。
  //    现在取景只依赖 `NATIONAL_FIT_CORNERS` 这个常量，**与数据是否就绪无关**，
  //    所以也不必再等 `rows` 到齐 —— 但保留"数据到了再取景一次"的时序：
  //    地图实例挂在布局路由上跨页复用，从城市页返回时正需要这一次重取景。
  //
  // ★ 取景之后**不要**再补 `shell.refreshView()` —— 取景是动画，补调读到的是
  //   第 0 帧，会先按旧缩放错铺一次；动画结束后的重刷由 `useTMap` 的稳定检测负责。
  useFitOnce(isMobile ? 'home-m' : 'home-d', shell.status === 'ready', () =>
    shell.fit(NATIONAL_FIT_CORNERS, { reason: 'initial' }),
  )

  // ── 地图不可用时的降级画布点位 ──
  useEffect(() => {
    const pins = (rows ?? [])
      .filter((r) => r.center !== null)
      .map((r) => ({
        id: r.adcode,
        lng: r.center!.lng,
        lat: r.center!.lat,
        // 降级画布用密度色：与地图上的面同语义，不引入第二套配色
        color:
          r.poiCount === null
            ? 'var(--color-density-0)'
            : r.poiCount <= 20
              ? 'var(--color-density-1)'
              : r.poiCount <= 60
                ? 'var(--color-density-2)'
                : 'var(--color-density-3)',
        label: r.name,
      }))
    shell.setFallback({ pins })
  }, [rows, shell])

  /*
   * 收起本页已打开的景点详情，并注册给外壳（规划面板的「添加景点」要先把这张卡收起来）。
   * 本页**没有**景点清单 ⇒ `spotListCity: null`（首页本来就没有"左边那一栏"）。
   */
  const clearPick = sel.clearPick
  const closePoi = useCallback(() => {
    setSelectedId(null)
    clearPick()
  }, [clearPick])

  useEffect(() => {
    registerPageSpotOps({ closePoi, spotListCity: null })
    return () => registerPageSpotOps(null)
  }, [closePoi])

  return {
    shell,
    selected: sel.selected,
    selectedCityName: sel.cityName,
    // ★ 搜索命中优先（它的城市这次才加载）；否则查本页点位索引
    selectedCityId: sel.pickCityId ?? (selectedId ? (poiMeta.get(selectedId)?.cityId ?? '') : ''),
    closePoi,
    addToPlan: (poiId) => {
      // 搜索命中的那一枚可能不在 `poiMeta` 里（它的城市这次才加载）—— 用 pick 的归属兜底
      const cityId = poiMeta.get(poiId)?.cityId ?? sel.pickCityId
      // ★ 不换页，直接加进规划（plans/13 §6.5）
      if (cityId) addPoi(poiId, cityId)
    },
  }
}
