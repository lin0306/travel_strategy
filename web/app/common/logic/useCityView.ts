/**
 * 城市页的**页面逻辑**（与端无关）—— 三级下钻的第三级，内容最密的一页。
 *
 * ## 这一层为什么存在
 * 两端（桌面 / 移动）在**取数、过滤、图层生命周期、取景**上完全一致，
 * 只有"渲染哪套外壳"不同（左侧 348px 面板 vs 底部 Sheet）。所以：
 *   · 逻辑收在本文件 → 两端各一个视图文件只负责摆外壳（`desktop/ui/CityView`
 *     / `mobile/ui/CityView`）；
 *   · ★ **绝不把本文件复制两份** —— 那等于以后每个字段改动都要改两遍。
 *
 * ## 两级类型体系（02 文档）
 * | 层级 | 数量 | 作用 | 视觉 |
 * |------|------|------|------|
 * | **大类** | 4 | 只负责**筛选** | 筛选 chip 的主色 |
 * | **细类** | 12 | 决定 **marker 颜色** | 地图上的点位色 / 图例 |
 *
 * 两者互不重叠、也**不共用配色**：大类色只出现在 chip 上，细类色只出现在点位上。
 * 这是刻意的 —— 如果 chip 的蓝和某种点位的蓝是同一个，用户会以为筛选和颜色有关系。
 *
 * ## 标注避让是自研的
 * 腾讯 GL **没有**高德那种原生标注避让能力，所以：
 * - 标注单独一层（`MultiLabel`），可以整体控制显隐
 * - 避让算法在 `labelAvoidance.ts`，按 `popularity` 排序 + 浮层占位排除
 * - **只在缩放/拖动结束后重算**，不在每帧算（否则明显掉帧）
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router'

import { useCityEntryFit } from '~/common/logic/useCityEntryFit'
import { useAddToPlan } from '~/common/logic/useAddToPlan'
import { useFitOnce } from '~/common/logic/useFitOnce'
import { useIsMobile } from '~/common/logic/useViewport'
import { useSearchPick } from '~/common/logic/useSearchPick'
import { useSessionFilter, useSessionPick } from '~/common/logic/useSessionState'
import { registerPageSpotOps, useMapShell, type MapShellContext } from '~/common/logic/mapShell'
import { loadCity } from '~/common/data/cityRegistry'
import { loadSubdistricts, type SubdistrictRow } from '~/common/data/subdistricts'
import { useCityDistrictLayer } from '~/common/logic/useCityDistrictLayer'
import { recordMapLog } from '~/common/logic/mapLog'
import {
  createPoiLayer,
  poiTierForZoom,
  toPoiPoints,
  type DistrictLayerStats,
  type MapLevel,
  type PoiLayerHandle,
  type PoiLayerStats,
} from '~/common/map/tencent'
import { countSubtypes, filterPois, sortPois, type PoiSort } from '~/common/ui/city/PoiList'
import { SUBTYPE_META, type Category, type City, type Poi, type SubType } from '~shared/schema'

export interface CityView {
  // ── 环境 ──
  shell: MapShellContext
  cityId: string

  // ── 数据 ──
  /** `null` = 还没读到（`loaded` 为真时仍为 null ⇒ 这座城市不存在） */
  city: City | null
  loaded: boolean
  /** 过滤 + 排序之后的点位 */
  visible: Poi[]
  /** 细类计数（决定 chip 上是否显示数量、以及是否灰掉） */
  subtypeCounts: Map<SubType, number>
  /** 真正要渲染的那一枚 = 页面自己的选中 > 搜索命中（合并规则见 `useSearchPick`） */
  selected: Poi | null
  /** 详情里的城市名。★ 可能是**别的城市**的景点（搜索从任意一级都能命中），所以不能写死本页的 `city.name` */
  selectedCityName: string
  /**
   * 选中景点**归属的城市 id** —— 与 `selectedCityName` 同源（也可能是别的城市）。
   * ★ 景点详情的「添加行程」按钮靠它判断"是不是正在看这座城的规划"（→ 文案改成
   *   「添加到当前行程」并直接加，见 `useAddToPlan.currentPlanForCity`）。
   */
  selectedCityId: string
  /** 收起详情（面板关闭按钮 / 地图空白都走它）—— 页面选中与搜索命中共清 */
  closePoi: () => void

  // ── 筛选与选择 ──
  category: Category | null
  subtype: SubType | null
  setCategory: (c: Category | null) => void
  setSubtype: (s: SubType | null) => void
  /**
   * **生效**的那一枚的 id（清单用它高亮当前那一行）。
   *
   * ★ 它是"真正打开着的那一枚"（搜索命中 > 页面自己的选中，见 `useSearchPick`），
   *   不是"页面自己的选中" —— 两者在搜索之后会不一样，用后者会让清单高亮错行。
   * ★ 没有对应的 `setSelectedId`：清单只能通过 `openPoi` 写入（那条路会先清搜索命中）。
   *   直接暴露 setter 就是"谁写选中"的**第二条路**，会绕过那条不变量 ——
   *   行点击曾经就是这么绕的（今天点不到：详情面板盖住了清单；但结构上不该留）。
   */
  selectedId: string | null
  sort: PoiSort
  /** 「热门优先 ⇄ 名称排序」两档互切 */
  toggleSort: () => void

  // ── 动作 ──
  /**
   * 打开某个点位的**详情**（就地浮层）。
   *
   * ★ 这里**不 navigate**（2026-09-23 用户要求）：「点那个看详情，会触发跳转，
   *   这个跳转不需要，url 不需要有任何变化」。所以它和 `setSelectedId` 是同一件事 ——
   *   保留成独立动作是因为**清单里那个「详情」按钮**要有自己的出口（行点击是"选中"、
   *   按钮是"明确要看详情"，两者今天汇合到一起了）。
   *   详情**页**（`/city/:cityId/poi/:poiId`）仍然存在，留给外链 / SEO / 分享。
   */
  openPoi: (id: string) => void
  addToPlan: (id: string) => void
}

export function useCityView(): CityView {
  const { cityId = '' } = useParams()
  const shell = useMapShell()
  const addPoi = useAddToPlan()
  /**
   * 端别。★ 判据**唯一出处**是 `useViewport.ts`（媒体查询，不是 UA）。
   *   本钩子与路由薄壳各订阅一次，读的是同一份快照，不会打架。
   */
  const isMobile = useIsMobile()

  const [city, setCity] = useState<City | null>(null)
  const [loaded, setLoaded] = useState(false)
  /**
   * 选中的那一枚 + 筛选与排序 —— 都走**会话状态**（刷新之后还在，见
   * `common/logic/useSessionState.ts`）。★ 身份带 `cityId`：换一座城就用
   * **那座城自己**的记录（没记录 = 干净的全选），不会把成都的筛选带到北京。
   */
  const [selectedId, setSelectedId] = useSessionPick(`city:${cityId}`)
  const { category, subtype, sort, setSort, setCategory, setSubtype } = useSessionFilter(cityId)

  const layerRef = useRef<PoiLayerHandle | null>(null)
  /** 这座城市的区列表。`null` = 还没读到（`"cityAdcode"` 还未知 / 分片缺失） */
  const [subdistricts, setSubdistricts] = useState<SubdistrictRow[] | null>(null)

  useEffect(() => {
    let alive = true
    setLoaded(false)
    setCity(null)
    /**
     * ★ 这里**不再**清 `selectedId` / 筛选 —— 那是"换城"该做的事，而**首屏那一次
     *   正是要恢复的东西**（清掉 = 刷新永远回到初始，用户报的就是这个）。
     *   换城的收敛已收进 `useSessionPick` / `useSessionFilter`（按身份取该城的记录）。
     */
    setSubdistricts(null)
    loadCity(cityId).then((c) => {
      if (!alive) return
      setCity(c)
      setLoaded(true)
    })
    return () => {
      alive = false
    }
  }, [cityId])

  /**
   * 区列表懒加载 —— **跟着城市的 adcode 走**，不跟路由 id 走。
   *
   * ★ 为什么不能用 `city.adcode` 之外的值：区分片的文件名就是**市的 adcode**
   *   （`subdistricts/440100.json`），而 `cityId` 是英文 slug（`guangzhou`），两者只在
   *   `city.json` 里对得上。用 slug 去查会命中 0 个文件 —— 而 `import.meta.glob`
   *   匹配不到时**不报错**，只是静默返回空，表现就是"地图上这级永远出不来"。
   */
  const cityAdcode = city?.adcode ?? ''
  useEffect(() => {
    let alive = true
    if (!cityAdcode) return
    loadSubdistricts(cityAdcode).then((rows) => {
      if (alive) setSubdistricts(rows)
    })
    return () => {
      alive = false
    }
  }, [cityAdcode])

  /** 过滤 + 排序都走**唯一出处**（`filterPois` / `sortPois`）——「挑景点」浮层用的是同一份 */
  const visible = useMemo(
    () => (city ? sortPois(filterPois(city.pois, category, subtype), sort) : []),
    [city, category, subtype, sort],
  )

  const subtypeCounts = useMemo(() => countSubtypes(city?.pois ?? []), [city])

  /**
   * 真正要渲染的那一枚 = 页面自己的选中 > 搜索命中（合并规则见 `useSearchPick`）。
   * ★ 定义在图层接线**之前**：下面的 `onSelect` / `onBlank` 会用它。
   */
  const pageSelected = useMemo(
    () => (selectedId ? (city?.pois.find((p) => p.id === selectedId) ?? null) : null),
    [selectedId, city],
  )
  const sel = useSearchPick({
    poi: pageSelected,
    cityName: city?.name ?? '',
    id: selectedId,
  })
  const { clearPick, isCurrent } = sel
  /**
   * 图层回调要读「最新一版的合并结果」，但 `sel` 每次渲染都是**新对象** ——
   * 走 ref 现取，别让它进 effect 依赖：否则每选一次就销毁重建整个图层
   * （本项目的纪律，见 `useMapReveal.ts` 文件头第 2 条）。
   */
  const selRef = useRef({ isCurrent, clearPick })
  selRef.current = { isCurrent, clearPick }

  /**
   * 收起详情（面板关闭按钮 / 地图空白都走它）—— 页面选中与搜索命中共清。
   */
  const closePoi = useCallback(() => {
    setSelectedId(null)
    clearPick()
  }, [clearPick])

  // 注册给外壳（规划面板的「添加景点」要用）：`closePoi` = 收起已开的景点详情；
  // `spotListCity` = "**本页左面板就是这座城的清单**"（于是不必再浮一块同样的）。
  useEffect(() => {
    registerPageSpotOps({ closePoi, spotListCity: cityId })
    return () => registerPageSpotOps(null)
  }, [closePoi, cityId])

  /**
   * ★ 区图层（第四级）—— 城市往下**先是区**，再是景点。
   *
   * 点位层照样由上面的 `layerRef` 铺（它受 `poiTierForZoom` 管着，
   *   缩放到 `POI_REVEAL_ZOOM` 以下就自动收起），两级**不会同时铺**：
   *   区在场时点位不在，点位浮现时区自己退场。
   *
   * ★ `districtStatsRef`：区图层建在这个钩子内部，而 `logCity` 必须把它那一端
   *   的实际读数一起带上 —— 缺了它，日志会说"这一屏什么都没有"，
   *   而屏上明明铺着一整城的区徽标（这正是 2026-09-25 验收时踩到的假象）。
   */
  const districtStatsRef = useRef<(() => DistrictLayerStats | null) | null>(null)
  const cityDistrict = useCityDistrictLayer({
    cityAdcode,
    rows: subdistricts,
    // 点区时"框住这个区里的景点"要用它（见 `focusPointsFor` 的第一条优先级）
    pois: city?.pois ?? null,
    enabled: shell.status === 'ready' && Boolean(city),
    onPainted: () =>
      logCity(layerRef.current?.stats(), districtStatsRef.current?.() ?? null),
  })
  districtStatsRef.current = cityDistrict.stats

  // ── 地图：点位 + 标注 ──
  useEffect(() => {
    const map = shell.map
    if (!map) return

    const layer = createPoiLayer(map, {
      // ★ 两端**同一套聚合**，唯一的差别是"独立点要不要挂名字"（见 plans/12）。
      //   密集处由 MarkerCluster 合成数字气泡，点气泡放大逐级展开 —— 不再抽稀丢点。
      names: !isMobile,
      // ★ 点景点 = 就地看详情。用 `isCurrent` 把"搜索命中过的那一枚"也算作已选中，
      //   否则搜出来之后再点它一下关不掉（面板看着像卡住了）。
      onSelect: (poiId) => {
        const wasOn = selRef.current.isCurrent(poiId)
        selRef.current.clearPick()
        setSelectedId(wasOn ? null : poiId)
      },
      // 点地图空白 → 收起详情。★ "点的是不是空白"这个判定只在图层里能做 ——
      //   页面自己 `map.on('click')` 拿不到几何命中信息，而腾讯点中覆盖物时
      //   **地图 click 一样会派发**，据此关闭会在点圆点的同一瞬间把刚打开的卡关掉。
      onBlank: () => {
        setSelectedId(null)
        selRef.current.clearPick()
      },
      // ★ 日志只在**聚合落地后**记：那一刻的簇数/气泡数才是屏幕上的真数。
      //   `refreshView()` 刚回来的那一刻读 `getClusters()` 必然是空的（聚类在 worker 里算）。
      // ★★ 第二个参数（区图层读数）**必须传**：漏了 `logCity` 里 `d = null` ⇒ `polys: 0`，
      //   而聚合是异步结算的、这一条总在 `onPainted` 之后落盘 ⇒ **覆盖掉正确读数**。
      //   2026-10-02 排查"点位档面也没了"就是被这个假 0 骗着去翻图层代码（真相在 `stats()` 里）。
      //   ★ 面在点位档是**留着的**（`reference` 模式），这条日志必须如实反映它。
      onSettled: () => logCity(layerRef.current?.stats(), districtStatsRef.current?.() ?? null),
    })
    layerRef.current = layer
    return () => {
      layer.destroy()
      layerRef.current = null
    }
  }, [shell.map, isMobile])

  useEffect(() => {
    const layer = layerRef.current
    if (!layer || !city) return
    // ★ 形状转换走 `toPoiPoints`，与首页 / 省级页的缩放揭示同源 ——
    //   各写一遍的话，字段名写错只会得到 undefined 坐标、点位静默消失
    //   （日志不在这里记：统一由 `onSettled` 在聚合落地后记，见上面的接线）
    // ★ `selectedId` 传 `sel.layerId`（搜索命中的那一枚也要高亮）；
    //   `picked` 是它的**坐标** —— 本页候选只有本城，搜到别城的景点时
    //   图层必须靠它才画得出来（否则镜头飞过去了、详情开了、图上没有点位）
    layer.update(toPoiPoints(visible), { selectedId: sel.layerId, picked: sel.pickedPoint })
  }, [city, visible, sel.layerId, sel.pickedPoint, shell.status])

  // ── 视野重刷登记：把本页图层登记到外壳，缩放 / 平移结束后由外壳扇出 ──
  //
  // 为什么必须登记：屏幕上显示什么取决于**当前缩放**（见 `zoomTiers.poiTierForZoom`
  // —— z<8 干脆不铺，其余交给聚合）。而 `update()` 只在数据变化时才跑，
  // 跑的那一刻地图还停在上一页的视野 —— 不登记的话，用户无论怎么缩放都不会有第二次重算。
  //
  // ★ **移动端同样需要登记**：聚合层也要按新缩放重算簇（`gridSize` 是按屏幕像素算的），
  //   不重刷的话换个缩放看到的还是上一屏的簇。
  //
  // ★ 注册时**不捕获 layer 实例**，而是每次从 ref 现取 —— 换端（移动 ↔ 桌面）
  //   会重建图层，闭包若抓住旧实例，之后所有刷新都打在已销毁的图层上。
  useEffect(
    () =>
      shell.registerRefresh((env) => {
        // 日志由 `onSettled` 记（见上面建图层那段：只有聚合落地后的读数才是真数）
        layerRef.current?.refreshView(env)
      }),
    [shell.registerRefresh],
  )

  // ── 视野：进城市页框住全部点位；注意把浮层占位算进去 ──
  // ★ 交给 `useFitOnce` 记账。修复前这个 effect 依赖 `[city, shell]`，而 `shell`
  //   每当地图上下文变化（换底图 / 地图刚 ready / 浮层增删）就是新对象 ——
  //   结果是**镜头被强行拉回全城**，用户正在看的那个点位被甩出屏幕，且不报错。
  //
  // ★ key 里带端别：两端可用区不同（移动端被底部 Sheet 吃掉一截），
  //   换端要重新框一次，否则窄屏下点位会被抽屉盖住。
  // ── 入口取景：框住**这座城**（不是点位云）—— 理由见钩子自己的文件头 ──
  useCityEntryFit({ shell, city, cityAdcode, cityId, isMobile })

  // ── 降级画布 ──
  useEffect(() => {
    shell.setFallback({
      pins: visible.map((p) => ({
        id: p.id,
        lng: p.location.point.lng,
        lat: p.location.point.lat,
        // ★ 点位颜色由**细类**决定，不是大类
        color: SUBTYPE_META[p.subtype].color,
        label: p.name,
      })),
    })
  }, [visible, shell])

  return {
    shell,
    cityId,
    city,
    loaded,
    visible,
    subtypeCounts,
    selected: sel.selected,
    selectedCityName: sel.cityName,
    // ★ 与上面同源：搜索命中的可能是别城的点（`pickCityId`），页面自己的选中则一定是本城
    selectedCityId: sel.pickCityId ?? cityId,
    closePoi,
    category,
    subtype,
    setCategory,
    setSubtype,
    // ★ 对外给**生效**的 id（见接口注释）；写入口只有 `openPoi`
    selectedId: sel.layerId,
    sort,
    toggleSort: () => setSort((s) => (s === 'hot' ? 'name' : 'hot')),
    // ★ 打开详情 = **就地浮层**，不换 URL（理由见 `CityView.openPoi` 的注释）
    //   顺手把"搜索命中"清掉：这两件事是同一个浮层的两个来源，
    //   留着会让"pick 优先"的规则把刚点的那一行吃掉（清单行也走这里）
    openPoi: (id) => {
      clearPick()
      setSelectedId(id)
      /*
       * ★ 「选中就把它**平移到可视区中心**」**不在这里做** —— 那是全站唯一一处
       *   `useSearchPick` 的 effect 干的（四个入口 × 三个页面，收在一处才漏不掉；
       *   这里再写一遍就是"同一件事两处实现"，而且这一处漏了地图点击那条路）。
       *   来龙去脉见 `useSearchPick.ts` 里 ★★ 那段。护栏 = Y⑱。
       */
    },
    // ★ 加点位现在**不换页**：直接加进选中的规划（plans/13 §6.5），
    //   逻辑在 `useAddToPlan` 里一份，四个入口共用
    addToPlan: (id) => addPoi(id, cityId, city?.pois.find((p) => p.id === id)),
  }
}

/**
 * 城市页的日志条目（见 `common/logic/mapLog.ts`）。
 *
 * ★ 本页**不经过** `useMapReveal`，但它不是"只有点位"了 —— 基准层级是**区级**
 *   （`base='district'`）：进来看的是各区的徽标，放大到 `POI_REVEAL_ZOOM` 才换景点上场。
 *   所以层级字段**按当前缩放算**，写死成 `'poi'` 会让日志把自己要排查的现象抹掉
 *   （"放大后点位没出来"在日志里看着永远是正常的点位页）。
 *
 * 本页真正有意义的是 **候选 → 准入 → 簇（其中几个气泡）→ 名字** 这四段读数：
 * 46 个候选铺出来成了几个簇、几个是气泡、几个独立点带名字。
 * 加上区图层的**徽标与面**，合起来才是"这一屏到底有什么"。
 *
 * @param s 点位层的读数。`undefined` = 点位层还没建立
 * @param d 区图层的读数。`null` = 区图层还没建立（或已退场）
 */
function logCity(s: PoiLayerStats | undefined, d: DistrictLayerStats | null = null): void {
  const zoom = s?.zoom ?? d?.zoom ?? 0
  // ★ 与图层同一把尺子：`poiTierForZoom` 是"这一缩放铺不铺点位"的唯一出处
  const level: MapLevel = poiTierForZoom(zoom).admitsPoints ? 'poi' : 'district'
  recordMapLog({
    zoom,
    base: 'district',
    level,
    revealed: level,
    pending: false,
    dTotal: d?.total ?? 0,
    badges: d?.badges ?? 0,
    badgeTexts: d?.badgeTexts ?? [],
    polys: d?.polygons ?? 0,
    pTotal: s?.candidates ?? 0,
    aTotal: s?.admitted ?? 0,
    clusters: s?.clusters ?? 0,
    bubbles: s?.bubbles ?? 0,
    labels: s?.labels ?? 0,
    labelTexts: s?.labelNames ?? [],
  })
}
