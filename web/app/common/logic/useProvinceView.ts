/**
 * 省级视图的**页面逻辑**（与端无关）—— 三级下钻的第二级。
 *
 * ## 这一页要回答的问题
 * 「这个省里，哪些地方你已经能玩了？」清单的判据是**是否已收录**（`cityId !== null`），
 * 而不是"有没有景点"。见 `common/ui/city/ProvinceList`。
 *
 * ## 缩放揭示（2026-09-19 加 · 2026-09-25 扩成四级）
 * 本页 `base` 是 `city`，放大后**逐级**揭出更细的一级：
 *   市徽标 → `DISTRICT_REVEAL_ZOOM`（市下辖区徽标）→ `POI_REVEAL_ZOOM`（点位）
 * —— 阈值见 `zoomTiers.ts`。视野里一个下级的候选都没有时**回流**到上一级
 * （保持市徽标不变，不摆空地图）。
 *
 * ★ 判据是「视野里有没有**点位本身**」，不是「城市中心点在不在视野里」——
 *   后者在放大后必然失效（缩放越大，同一段地理偏移换算成的像素越多，
 *   于是"中心在屏幕内"这个判据单方向崩塌）。本页与首页踩过同一个坑。
 *
 * 与首页的分工：首页揭示的是"全国 → 各省的市 → 区 → 点位"，本页是"本省的市 → 区 → 点位"。
 * 两页共用同一条管道（`common/logic/useMapReveal.ts`），差别只在数据源；
 * **撒点范围与判据也统一在那里**，页面不要自己筛视野（筛两次会不一致）。
 *
 * ## ★ 区的覆盖范围：只给**已收录**的市
 * step8 抓了全国 367 个市的区（`subdistricts/<市adcode>.json`），但本页只给有内容的
 * 那些市拉分片 —— 剩下的市还处在「待收录」，它们的区**全是 0**，撒上去等于告诉用户
 * "这地方没景点"（那是假话，真相是我们还没做）。这条与"未收录 = 灰虚线待收录"同一口径。
 *
 * ## ★ 地图上的点击做三件**不同**的事（2026-09-23 定稿，与首页逐字一致）
 * | 点的是 | 做什么 | 为什么不是别的 |
 * |--------|--------|----------------|
 * | 市**徽标** | 放大到该市的取景（`shell.fit`，对照表在 `districtFocus.ts`） | 徽标表达的是"这一级有什么"，点它就该看得更清 |
 * | 景点**图标 / 名字** | **就地看详情** —— 桌面 620px 面板 / 移动底部 Sheet | 点一枚景点是为了看它是什么，**镜头不该动、URL 也不该变** |
 * | 地图**空白** | 收起详情 | 没有出口的浮层 = 用户觉得"关不掉" |
 *
 * ★ 三者都**不换路由**；清单里的行（`pickCity`）才换页。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'

import { focusPointsFor, parentCityOf, sameDistrict, type FocusSources } from '~/common/logic/districtFocus'
import { useFitOnce } from '~/common/logic/useFitOnce'
import { useIsMobile } from '~/common/logic/useViewport'
import { useMapReveal } from '~/common/logic/useMapReveal'
import { useSearchPick } from '~/common/logic/useSearchPick'
import { useSessionPick } from '~/common/logic/useSessionState'
import { useAddToPlan } from '~/common/logic/useAddToPlan'
import { useDistrictIndex } from '~/common/logic/useDistrictIndex'
import { registerPageSpotOps, useMapShell, type MapShellContext } from '~/common/logic/mapShell'
import { loadCity } from '~/common/data/cityRegistry'
import {
  findSubdistrictOwner,
  loadCityBox,
  loadDistrictBox,
  loadSubdistricts,
  type SubdistrictRow,
} from '~/common/data/subdistricts'
import { loadProvinceDetail, type ProvinceDetail } from '~/common/data/regions'
import { toPoiPoints, type LatLngLike } from '~/common/map/tencent'
import type { City, Poi } from '~shared/schema'

export interface ProvinceView {
  shell: MapShellContext
  adcode: string
  detail: ProvinceDetail | null
  /** 已收录的下级数（进度）。★ 与 `detail.childCount`（区划事实）是两个数，都要显示 */
  collected: number
  /** 标题：省级单位全名，未就绪时给一句中性占位 */
  title: string
  pickCity: (cityId: string) => void
  /** 选中的景点（就地详情面板用）。`null` = 没选中 */
  selected: Poi | null
  /** 选中景点所属城市名（详情里的面包屑那一段） */
  selectedCityName: string
  /** 选中景点**归属的城市 id**（详情的「添加行程」按钮用它判断"是不是在看这座城的规划"） */
  selectedCityId: string
  /** 收起详情 */
  closePoi: () => void
  /** 添加行程（详情面板上的按钮）。★ **不换页**：只弹一个「加到哪个组」的窗 */
  addToPlan: (poiId: string) => void
}

export function useProvinceView(): ProvinceView {
  const { adcode = '' } = useParams()
  const shell = useMapShell()
  const addPoi = useAddToPlan()
  const navigate = useNavigate()
  const isMobile = useIsMobile()

  const [detail, setDetail] = useState<ProvinceDetail | null>(null)
  /**
   * 直辖市（`isCity`）的入口取景点 —— 本页的下级只有"它自己"一座市，
   * 拿一枚中心点去 `fit` 会**掉到街区级**（零面积范围补出来的 2km 方块），
   * 所以改用这座市的行政外接框（与城市页入口同一把尺子，见 `useCityEntryFit`）。
   *
   * ★ `null` 有两种来源（还没读到 / 真的没有边界），用 `flatTried` 区分：
   *   没试完之前**不许取景**，否则会先按单点框一次、再按框框一次，镜头自己跳一下。
   */
  const [flatPts, setFlatPts] = useState<LatLngLike[] | null>(null)
  const [flatTried, setFlatTried] = useState(false)
  /** 点位级**懒加载**下来的城市。点位与两张索引全部由它派生 */
  const [poiCities, setPoiCities] = useState<City[]>([])
  /**
   * 区级**懒加载**下来的分片 —— key 是**市的 adcode**（分片文件名就是它）。
   *
   * ★ 用 Map 而不是数组：回流/重铺会反复读它，且"哪些市已经拉过"本身就是信息
   *   （用 `null` 表达"没拉过"会让 `districts()` 每帧都返回新的空对象，进而把图层刷爆）。
   */
  const [subRows, setSubRows] = useState<Record<string, SubdistrictRow[]>>({})
  /** **全国**区节点（构建期索引）—— 本页只用属于本省的那部分（按 adcode 前 2 位筛） */
  const districtIndex = useDistrictIndex()
  /** 当前选中的景点：地图高亮与右侧预览卡都由它驱动 */
  const [selectedId, setSelectedId] = useSessionPick(`province:${adcode}`)

  useEffect(() => {
    let alive = true
    setDetail(null)
    setPoiCities([])
    setSubRows({})
    setFlatPts(null)
    setFlatTried(false)
    setSelectedId(null)
    void (async () => {
      const d = await loadProvinceDetail(adcode)
      if (!alive) return
      setDetail(d)
    })()
    return () => {
      alive = false
    }
  }, [adcode])

  const collectedIds = useMemo(
    () => (detail?.cities ?? []).map((c) => c.cityId).filter((id): id is string => id !== null),
    [detail],
  )

  // ── 直辖市的入口取景点：行政外接框，没有边界时退回它的区中心 ──
  useEffect(() => {
    let alive = true
    setFlatPts(null)
    setFlatTried(false)
    if (!detail?.isCity || !adcode) return
    void (async () => {
      const box = await loadCityBox(adcode)
      let pts: LatLngLike[] | null = box
        ? [
            { lng: box[0], lat: box[1] },
            { lng: box[2], lat: box[3] },
          ]
        : null
      // 边界文件缺席时才读区分片（1KB）—— 区中心同样能表达"这座城有多大"
      if (!pts) {
        const rows = await loadSubdistricts(adcode)
        pts = rows?.length ? rows.map((r) => ({ lng: r.center.lng, lat: r.center.lat })) : null
      }
      if (!alive) return
      setFlatPts(pts)
      setFlatTried(true)
    })()
    return () => {
      alive = false
    }
  }, [detail?.isCity, adcode])

  /** 点位候选 + 两张索引，**同源**（理由见 `useHomeView.ts` 里那段注释） */
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
   * 「点徽标要框哪一片」的数据源。
   *
   * ★ 优先级是 **下辖区的中心 → 该市自己的点位 → 近似方块**（见 `focusPointsFor`）。
   *   区分片一旦到了就用它 —— 那只需 1KB，而 `poisOf` 要把整座城市的点位全读进来。
   *   两者不合适同一件事：**区中心画的是"这座城有多大"**，点位画的是"有哪些点"，
   *   后者在点位集中在某一角时（风景区型城市）会把镜头框偏。
   */
  const focusSources = useMemo<FocusSources>(
    () => ({
      childrenOf: (adcode) =>
        (subRows[adcode] ?? []).map((r) => ({ lng: r.center.lng, lat: r.center.lat })),
      // 市：按 adcode 找；区：定到所属的市（adcode 前 4 位同段）后按区名筛（区名由 `pipeline/districts.py` 归）
      poisOf: async (adcode, name) => {
        const c = detail?.cities.find((x) => x.adcode === adcode) ?? parentCityOf(adcode, detail?.cities ?? [])
        if (!c?.cityId) return []
        const city = await loadCity(c.cityId)
        const hit = (city?.pois ?? []).filter((p) => c.adcode === adcode || sameDistrict(p.location.district, name))
        return hit.map((p) => ({ lng: p.location.point.lng, lat: p.location.point.lat }))
      },
      /**
       * 区（第四级）**自己的**外接框 —— 从它所属那座市的边界文件里取。
       *
       * ★ 少了这一条，"点区"会一路掉到 `focusPointsFor` 最底下那个 0.5° 的近似方块
       *   （那是市的量级）→ 镜头往外退，就是用户报的「点区怎么还缩小地图了」。
       */
      boxOf: async (adcode) => {
        const parent = findSubdistrictOwner(subRows, adcode)
        return parent ? await loadDistrictBox(parent, adcode) : null
      },
    }),
    // ★ 依赖 `subRows`（不能只写 `detail`）：区分片到货后，"点徽标框哪一片"要跟着变
    [detail, subRows],
  )

  /**
   * 真正要渲染的那一枚 = 页面自己的选中 > 搜索命中（合并规则见 `useSearchPick`）。
   * ★ 定义在 `useMapReveal` **之前**：下面几个回调会用到它（读起来才不像"先用后定义"）。
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
  const { revealed } = useMapReveal({
    base: 'city',
    // ★ 末尾那一项是**区索引**：它异步到货，不给它一个坑，揭示就不会重算
    dataKey: `${detail?.childCount ?? -1}|${poiPoints.length}|${Object.keys(subRows).length}|${districtIndex?.length ?? -1}`,
    // 两端都聚合，只差"独立点要不要挂名字"（见 `poiLayer` 文件头）
    names: !isMobile,
    // 选中的那一枚画在选中层上（彩色白环 + 名字置为选中态），不进聚合
    // ★ 传 `layerId`：搜索命中的那一枚也要高亮（它在候选里时才画得出来）
    selectedId: sel.layerId,
    // ★ 还要把**坐标**一起给图层：本页候选只有**本省已收录城市**的点位，
    //   而搜索能命中别省的景点 —— 少了它，镜头飞过去了、详情开了、图上却是空的
    pickedPoint: sel.pickedPoint,
    // ★ 面由揭示层按 `d.level` **现取**（见 `loadBoundsForLevel`）—— 本页不再自己传
    //   `districtFile`：那样只会把面固定成"各市的面"，放大到区级时区徽标一个面都没有
    //   （2026-09-30 用户：「显示区的时候显示区的轮廓」）。
    // ★ 地图点击的三条分工 → 本文件头那张表；对照表在 `districtFocus.ts`
    onSelectDistrict: (node) => {
      void focusPointsFor(node, focusSources).then((t) =>
        shell.fit(t.points, { reason: 'drill', minZoom: t.minZoom, anchor: t.anchor }),
      )
    },
    onSelectPoi: (poiId) => {
      // ★ 点景点 = **就地看详情**（桌面 620px 面板 / 移动底部 Sheet），不推镜头、不换页、两端一致。
      //   用 `isCurrent` 把"搜索命中过的那一枚"也算作已选中 —— 否则搜出来之后再点它一下关不掉。
      const wasOn = sel.isCurrent(poiId)
      sel.clearPick()
      setSelectedId(wasOn ? null : poiId)
    },
    // 点地图空白 → 收起卡片。★ 判定归图层（只有它知道有没有命中）
    onBlank: () => {
      setSelectedId(null)
      sel.clearPick()
    },
    // 该级的**全部候选**徽标 —— 视野筛选交给钩子（判据与筛选都在那里）
    districts: (lvl) => {
      const cities = detail?.cities ?? []
      // 市级：本页的立身之本
      if (lvl !== 'district') {
        return cities
          .filter((c) => c.center !== null)
          .map((c) => ({
            adcode: c.adcode,
            name: c.name,
            lng: c.center!.lng,
            lat: c.center!.lat,
            poiCount: c.poiCount,
          }))
      }
      // 区级：**本省所有区**（构建期索引，按 adcode 前 2 位筛）。未收录城市的区
      // `poiCount: null` ⇒ 徽标显示「XX区 —」（待收录），与市这一级的口径一致。
      // ★ 不是 `subRows` —— 那个只有已收录城市（它服务的是"点市徽标框哪一片"）。
      if (lvl === 'district') {
        const p2 = adcode.slice(0, 2)
        return (districtIndex ?? []).filter((d) => d.adcode.startsWith(p2))
      }
      return []
    },
    // 点位级：本省已收录城市的全部点位。
    // ★ `null` = 还没加载（≠ `[]` 确定没有）—— 写成 `?? []` 会与回流锁死，见 useHomeView.ts
    pois: (lvl) => {
      if (lvl !== 'poi') return []
      if (poiPoints.length === 0 && collectedIds.length > 0) return null
      return poiPoints
    },
  })

  // ── 区的懒加载：同上，用 `revealed` 触发 ──
  // ★ 只拉**已收录**的市：未收录的市区数全是 0，撒上去等于谎报"这里没有景点"。
  //   各省 1～2 座城、每份约 1KB —— 不放大到区级就永远不会来读。
  useEffect(() => {
    if (revealed !== 'district') return
    const todo = (detail?.cities ?? []).filter(
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
        for (const [ad, rows] of got) next[ad] = rows ?? []
        return next
      })
    })()
    return () => {
      alive = false
    }
  }, [revealed, detail, subRows])

  // ── 点位懒加载：用 `revealed` 而不是 `level`（理由见 useHomeView.ts） ──
  useEffect(() => {
    if (revealed !== 'poi' || poiCities.length > 0 || collectedIds.length === 0) return
    let alive = true
    void (async () => {
      const cities = (await Promise.all(collectedIds.map((id) => loadCity(id)))).filter(
        (c): c is City => c !== null,
      )
      if (!alive) return
      setPoiCities(cities)
    })()
    return () => {
      alive = false
    }
  }, [revealed, poiCities.length, collectedIds])

  // ── 视野：进本省就把镜头框住全省的市 ──
  // ★ key 里带 `detail.cities.length`：数据到了才取景；换省（adcode 变）重新取景。
  //   交给 `useFitOnce` 记账之后，`shell` 换对象（换底图 / 地图刚 ready）**不会**
  //   再把镜头拉回全城 —— 修复前这里的依赖是 `[detail, shell]`，正是那个 bug。
  // ★ 取景后**不要**补 `shell.refreshView()`：它读的是动画第 0 帧。
  // ★ 直辖市要等外接框到手才取景（`flatTried`），否则镜头会先跳一次单点再跳一次框
  const fitKey = !detail
    ? null
    : detail.isCity
      ? flatTried
        ? `${adcode}|flat|${isMobile ? 'm' : 'd'}`
        : null
      : `${adcode}|${detail.cities.length}|${isMobile ? 'm' : 'd'}`
  useFitOnce(fitKey, shell.status === 'ready', () => {
    if (detail?.isCity) {
      return flatPts !== null && flatPts.length > 0 && shell.fit(flatPts, { reason: 'drill' })
    }
    const pts = (detail?.cities ?? []).filter((c) => c.center !== null).map((c) => c.center!)
    return pts.length > 0 && shell.fit(pts, { reason: 'drill' })
  })

  // ── 降级画布 ──
  useEffect(() => {
    const pins = (detail?.cities ?? [])
      .filter((c) => c.center !== null)
      .map((c) => ({
        id: c.adcode,
        lng: c.center!.lng,
        lat: c.center!.lat,
        color: c.cityId === null ? 'var(--color-density-0)' : 'var(--color-density-2)',
        label: c.name,
      }))
    shell.setFallback({ pins })
  }, [detail, shell])

  const collected = useMemo(
    () => (detail?.cities ?? []).filter((c) => c.cityId !== null).length,
    [detail],
  )

  /*
   * 收起本页已打开的景点详情，并注册给外壳（规划面板的「添加景点」要先把这张卡收起来）。
   * 本页**没有**景点清单 ⇒ `spotListCity: null` —— 省级页左边那份是**城市**列表，不是景点清单。
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
    adcode,
    detail,
    collected,
    title: detail?.province?.fullname ?? '省级视图',
    pickCity: (cityId) => navigate(`/city/${cityId}`),
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
