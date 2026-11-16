/**
 * 首页（web 端）的「地域面板」导航 —— 点省 / 市徽标除了放大，还要在左侧开一块介绍。
 *
 * ## 它解决的问题
 * 首页原来点省 / 市徽标**只做一件事**：把镜头放大到那一档（`districtFocus.drillTo`）。
 * 于是屏幕上永远只有徽标和数字 —— 这个省有几个市、收了哪几座、是哪座城，
 * 全靠用户自己认。而 `plans/05` 里 P3 那张 ASCII 图本来就没画左侧面板。
 *
 * 现在点省 / 市：**放大 + 左侧开卡**（URL 不动，与"点徽标不换页"同一条纪律）。
 * 省卡里可以翻到市列表，市卡里可以翻到区列表 —— 三级用面板串起来，
 * 每一级都只回答"这一级有什么"。
 *
 * ## ★★ 为什么对焦要**等面板挂上之后**（`pending` + `requestAnimationFrame`）
 * `shell.focusPoint` 的落点不是屏幕中心，而是「**扣掉浮层之后**那块空闲区的中心」
 * （`panTo.ts` 的 `centerOfFreeRect`）。而 `freeRect` 量的是**当下 DOM 里**
 * 带 `data-overlay` 的元素 —— 面板刚被点开的那一瞬间它还没渲染出来，
 * 这一帧去对焦就等于"按旧布局算"：徽标会停在屏幕正中，随后被左面板盖掉。
 *
 * 这正是用户提的那个点：「省市点击现在的逻辑，还得往右偏移一点，不然可能会被挡住」。
 * 偏移量**不在这里算**（写死 348 / 420 之类），一律交给 `freeRect` 实测：
 * 左侧面板开着就左缩 348、右侧路线规划也开着就再右缩 420 ——
 * 两种情况的中心天然不同，不需要两套数。
 *
 * ⇒ 所以顺序必须是「先开面板（render）→ 下一帧再对焦（rAF）」。
 *   rAF 那一帧面板已在 DOM 里，`overlayAware()` 现查就能量到它。
 *
 * ## 什么不进面板
 * **区徽标**不进：区没有"自己的介绍"可读，点它就是"放大看景点"（旧逻辑原样保留）。
 * 只记一个 `activeDistrict` 给列表高亮用，镜头照旧走 `drillTo`。
 */

import { useCallback, useEffect, useState } from 'react'

import { PROVINCES } from '~/common/data/provinceAdcodes'
import type { CityRow, CityRowWithParent } from '~/common/data/regions'
import type { SubdistrictRow } from '~/common/data/subdistricts'
import { drillTo, regionLevelOf, type FocusSources } from '~/common/logic/districtFocus'
import type { LatLngLike, RevealScope } from '~/common/map/tencent'
import type { MapShellContext } from '~/common/logic/mapShell'

/** 面板能表达的两级。**区**不在其中（见文件头） */
export type RegionLevel = 'province' | 'city'

export interface RegionSel {
  level: RegionLevel
  adcode: string
  /** 简称（"陕西" / "西安"）。★ 省的**全称**由面板自己按 adcode 查，避免这里存两份 */
  name: string
  /** 市：已收录时为城市 id，未收录为 `null`（`null ≠ ''`：前者是"待收录"，后者是"不知道"） */
  cityId: string | null
}

/** 徽标 / 列表行都能提供的形状 —— 只取对焦需要的四个字段 */
export interface RegionNode {
  adcode: string
  name?: string
  lng: number
  lat: number
  poiCount?: number | null
}

export interface RegionNav {
  region: RegionSel | null
  /** 面板此刻显示的是「下级列表」还是「自己」（省概览 / 市概览） */
  listOpen: boolean
  /** 区列表里高亮的那一枚（点地图上的区徽标也会写它） */
  activeDistrict: string | null
  /** 有上一级可退吗 —— 面板据此决定显不显示返回箭头 */
  backable: boolean
  /** 点地图上的省 / 市 / 区徽标（页面在 `onSelectDistrict` 里调这一个入口） */
  pick: (node: RegionNode) => void
  /** 从省列表里点一座市：开市卡 + 放大到该市 */
  pickCity: (row: CityRow) => void
  /** 从区列表里点一个区：只放大（不开卡，理由见文件头） */
  pickDistrict: (row: SubdistrictRow) => void
  toggleList: () => void
  back: () => void
  close: () => void
}

export function useRegionNav({
  shell,
  sources,
  notify,
  cityRows,
}: {
  shell: Pick<MapShellContext, 'focusPoint'>
  sources: FocusSources
  /** 落到"一个景点都没有"的单位时的那句话 —— 与 `drillTo` 同一个出口（`ToastStack`） */
  notify: (text: string) => void
  /**
   * 全国市级清单（`loadAllCityRows`）。
   * ★ 只要它一件事：徽标给的是 **adcode**，而卡片要的是 **城市 id**（`beijing`）；
   *   顺带还能反查"这座市属于哪个省"（按 `provinceAdcode`）。
   */
  cityRows: CityRowWithParent[]
}): RegionNav {
  const [region, setRegion] = useState<RegionSel | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [activeDistrict, setActiveDistrict] = useState<string | null>(null)
  /** 等面板挂上再执行的对焦（理由见文件头 ★★） */
  const [pending, setPending] = useState<{ center: LatLngLike; zoom: number } | null>(null)
  /**
   * 上一次打开的省 —— 从市卡按 `‹` 返回时用它把镜头也退回去。
   * 没有它就只能换卡片文字、镜头仍停在市那一档（"面板说陕西省，地图是西安"）。
   */
  const [lastProvince, setLastProvince] = useState<RegionNode | null>(null)

  // ── 面板挂上之后的那一帧再对焦 ──
  useEffect(() => {
    if (!pending) return
    const raf = requestAnimationFrame(() => {
      shell.focusPoint(pending.center, pending.zoom)
      setPending(null)
    })
    return () => cancelAnimationFrame(raf)
  }, [pending, shell])

  /**
   * 开一张卡：写状态 + 安排对焦。
   * `node === null` = 只换内容不挪镜头（例如从省列表按返回，镜头已经在省那一档）。
   */
  const open = useCallback(
    (sel: RegionSel, node: RegionNode | null) => {
      setRegion(sel)
      setListOpen(false)
      setActiveDistrict(null)
      /**
       * ★ 只在**真的拿到了坐标**时记 `lastProvince`：给它补 `{lng:0, lat:0}` 当占位，
       *   之后按「返回所属省」就会把镜头飞到几内亚湾（0,0）—— 静默、而且看起来像地图崩了。
       */
      if (sel.level === 'province' && node) setLastProvince(node)
      if (!node) return
      /**
       * ★ 落点与"0 景点只说话不挪镜头"这两件事**仍然只由 `drillTo` 一处负责** ——
       *   这里换的只是**去哪落**：给它一个"只记目标、不飞镜头"的 shell 替身，
       *   真正的 `shell.focusPoint` 留到面板进 DOM 之后的下一帧。
       *   自己再调一次 `focusPointsFor` 就是第二条落点路径（迟早与 `drillTo` 分家）。
       */
      drillTo(node, sources, { focusPoint: (center, zoom) => setPending({ center, zoom }) }, notify)
    },
    [sources, notify],
  )

  const pick = useCallback(
    (node: RegionNode) => {
      const level = regionLevelOf(node.adcode)
      if (level === 'district') {
        // 区：只放大 + 列表高亮（理由见文件头「什么不进面板」）
        setActiveDistrict(node.adcode)
        drillTo(node, sources, shell, notify)
        return
      }
      const cityId = cityRows.find((c) => c.adcode === node.adcode)?.cityId ?? null
      open({ level, adcode: node.adcode, name: node.name ?? '', cityId }, node)
    },
    [open, sources, shell, notify, cityRows],
  )

  const pickCity = useCallback(
    (row: CityRow) => {
      // ★ `center === null`（区划树还没生成）时照样开卡 —— 卡里会写"数据还没生成"
      open(
        { level: 'city', adcode: row.adcode, name: row.name, cityId: row.cityId },
        row.center
          ? { adcode: row.adcode, name: row.name, lng: row.center.lng, lat: row.center.lat, poiCount: row.poiCount }
          : null,
      )
    },
    [open],
  )

  const pickDistrict = useCallback(
    (row: SubdistrictRow) => {
      setActiveDistrict(row.adcode)
      drillTo(
        {
          adcode: row.adcode,
          name: row.name,
          lng: row.center.lng,
          lat: row.center.lat,
          poiCount: row.poiCount,
        },
        sources,
        shell,
        notify,
      )
    },
    [sources, shell, notify],
  )

  const close = useCallback(() => {
    setRegion(null)
    setListOpen(false)
    setActiveDistrict(null)
  }, [])

  const back = useCallback(() => {
    // ① 列表 → 回自己的概览卡
    if (listOpen) {
      setListOpen(false)
      return
    }
    // ② 市卡 → 回所属省的概览（镜头也退回去）
    if (region?.level === 'city') {
      const p = `${region.adcode.slice(0, 2)}0000`
      if (lastProvince?.adcode === p) {
        open({ level: 'province', adcode: p, name: lastProvince.name ?? '', cityId: null }, lastProvince)
        return
      }
    }
    close()
  }, [listOpen, region, lastProvince, open, close])

  const toggleList = useCallback(() => setListOpen((v) => !v), [])

  return {
    region,
    listOpen,
    activeDistrict,
    backable: listOpen || (region?.level === 'city' && lastProvince?.adcode === `${region.adcode.slice(0, 2)}0000`),
    pick,
    pickCity,
    pickDistrict,
    toggleList,
    back,
    close,
  }
}

/** 省的全称（"陕西省"）—— 面板标题用。查不到就退回 adcode，别静默显示空串 */
export function provinceFullname(adcode: string): string {
  return PROVINCES.find((p) => p.adcode === adcode)?.fullname ?? adcode
}

/**
 * 把「面板的选中状态」翻译成「地图作用域」—— 轮廓只铺这一个单位 + 它的下一级。
 *
 * 2026-11-14 用户：「不管什么情况，地图轮廓都显示，比如说点省了，就只显示那个省的数据和轮廓」。
 * 修复前判据只有视野，点陕西之后周边省份的市照样描线（`reveal.ts` 的 `RevealScope`）。
 *
 * ★ 优先级：**面板选中的省 / 市** > **点过的区**（区只放大不开卡，所以它不在 `region` 里）。
 * ★ 返回 `null` = 没选中 ⇒ 首屏照旧铺 34 个省（那是首页的立身之本）。
 * ★ 这里**不做**"缩回全国该不该放开"的判断 —— 那在 `decideReveal` 里一处判完，
 *   两边各判一次迟早会分叉。
 */
export function scopeOf(
  nav: Pick<RegionNav, 'region' | 'activeDistrict'>,
): RevealScope | null {
  if (nav.region) return { adcode: nav.region.adcode, level: nav.region.level }
  if (nav.activeDistrict) return { adcode: nav.activeDistrict, level: 'district' }
  return null
}
