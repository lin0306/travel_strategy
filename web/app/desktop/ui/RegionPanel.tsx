/**
 * 首页 · **地域面板**（桌面 / web 端）—— 点省 / 市徽标之后，左侧开一块"这一级有什么"。
 *
 * ## 为什么要有它
 * 首页是「地图即画布」最纯粹的一页：34 个省徽标 + 一条顶栏，没有任何清单
 * （`useHomeView` 文件头专门写了"不要顺手把省份清单加回来"）。代价是**点省 / 市只放大**，
 * 屏幕上永远只有名字和数字 —— 这个省收了哪几座城、是哪座城，全靠用户自己认。
 *
 * ★ 它不违反那条纪律：面板**不是常驻清单**，只在"点了某一个省 / 市"之后出现，
 *   关掉就没了。首页首屏仍然是一张裸地图。
 *
 * ## 三级怎么串
 * ```
 * 点省徽标 → [省概览]  ──「城市列表」──→  [城市列表] ──点市──→ [市概览]
 *                 ↑                                            │
 *                 └──────────────  ‹ 返回   ───────────────────┘
 *                                                              │「区列表」
 *                                                              ↓
 *                                                         [区列表] ──点区──→ 地图放大到该区
 *                                                              │「进入城市页」
 *                                                              ↓
 *                                                        /city/:cityId
 * ```
 * **每一级都只回答"这一级有什么"**：省卡答"收了哪几座城"，市卡答"这是座什么城"，
 * 区列表答"哪几个区有货"。想深读（筛选 / 排序 / 评分）→ 城市页那扇门。
 *
 * ## 三条纪律
 * 1. **URL 一动不动**（点徽标不换页，与 `districtFocus.ts` 同一条）。
 * 2. **对焦由 `regionNav` 安排**（面板挂上之后的下一帧），本文件只管画。
 * 3. **空就不渲染**：`region` 为 `null` 时整块卸载（由 `useItemPresence` 管退场时序）。
 *
 * ★ 面板必须走 `Overlay`（它带 `data-overlay`）：地图"扣掉浮层之后的空闲区"
 *   靠它实测，落点偏移与右侧路线规划叠加时的二次收缩全由它推导 ——
 *   自己拿 `<div>` 画一块面板，点徽标就会把徽标正好摆在面板底下。
 */

import { useEffect, useRef, useState } from 'react'

import { navTo } from '~/common/logic/nav/navStore'
import { Icon } from '~/common/ui/Icon'
import { Overlay } from '~/common/ui/Overlay'
import { useItemPresence } from '~/common/ui/usePresence'
import { ProvinceList } from '~/common/ui/city/ProvinceList'
import { CityCard } from '~/common/ui/region/CityCard'
import { DistrictList } from '~/common/ui/region/DistrictList'
import { ProvinceCard } from '~/common/ui/region/ProvinceCard'
import { loadProvinceDetail, type ProvinceDetail } from '~/common/data/regions'
import { provinceFullname, type RegionNav } from '~/common/logic/regionNav'

export function RegionPanel({ nav }: { nav: RegionNav }) {
  /* 退场那 160ms 里 `region` 已经清空，但屏幕上还得是原来那张卡（`useItemPresence`） */
  const pres = useItemPresence(nav.region)
  const sel = pres.item

  /**
   * 省的下级清单（也是"这是不是直辖市"的来源）。
   * ★ 只在省那一级读；市那一级用不到它。
   */
  const [detail, setDetail] = useState<ProvinceDetail | null>(null)
  useEffect(() => {
    let alive = true
    setDetail(null)
    if (sel?.level !== 'province') return
    void loadProvinceDetail(sel.adcode).then((d) => {
      if (alive) setDetail(d)
    })
    return () => {
      alive = false
    }
  }, [sel])

  /**
   * ★★ 换卡之后滚动位置必须归零（2026-11-14 用户：「点省之后再点市，不会切换到市的面板」）。
   *
   * 面板是一个**不卸载的滚动容器** —— 里面换的是省卡 / 市卡 / 列表。原来的滚动位置
   * 会原样留给下一张卡：用户在省卡里往下滚过（省卡比市卡长得多），再点一座市，
   * 新卡的头（封面 / 城市名 / 简介开头）已经在滚动区之外，屏上剩下的是新卡的中段，
   * 短卡甚至直接是**一段空白**。表现就是"面板没换"—— 它换了，只是停在半截。
   *
   * `listKey` 把「列表 ↔ 概览」也算进去：从城市列表点进市卡同样要回到顶部。
   */
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const listKey = sel ? `${sel.level}:${sel.adcode}:${nav.listOpen ? 'list' : 'card'}` : ''
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = 0
  }, [listKey])

  if (!pres.mounted || !sel) return null
  /**
   * ★ 直辖市 / 特别行政区（`isCity`）的"省"就是"市"：
   *   `loadProvinceDetail` 给回的下级只有它自己一枚。给它摊一张"省概览（1 个市）"
   *   毫无意义，直接摊市卡 —— 用户点北京看到的就是北京这座城。
   */
  const asCity = sel.level === 'city' || detail?.isCity === true
  /** 市卡要的城市 id：市那一级来自选择本身，直辖市来自它的下级行 */
  const cityId = sel.level === 'city' ? sel.cityId : (detail?.cities[0]?.cityId ?? null)

  const title = asCity && sel.level === 'city' ? sel.name : provinceFullname(sel.adcode)
  const mode = asCity
    ? nav.listOpen
      ? '区列表'
      : '城市概览'
    : nav.listOpen
      ? '城市列表'
      : '省概览'

  return (
    <Overlay
      anchor="left"
      widthToken="--panel-left"
      tall
      z={20}
      label="地域介绍"
      className="overflow-hidden"
      exiting={pres.exiting}
    >
      <div className="flex flex-none items-center gap-1.5 border-b border-line px-3 py-2.5">
        {nav.backable ? (
          <button
            type="button"
            onClick={nav.back}
            aria-label="返回上一级"
            className="-ml-1 inline-flex size-6 flex-none items-center justify-center rounded-md text-ink-2 hover:bg-bg hover:text-ink"
          >
            <Icon name="back" size="sm" />
          </button>
        ) : null}
        <b className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</b>
        <span className="flex-none text-[11px] text-ink-2">{mode}</span>
        <button
          type="button"
          onClick={nav.close}
          aria-label="关闭地域面板"
          className="-mr-1 inline-flex size-6 flex-none items-center justify-center rounded-md text-ink-2 hover:bg-bg hover:text-ink"
        >
          <Icon name="close" size="sm" />
        </button>
      </div>

      <div ref={scrollRef} className="scroll min-h-0 flex-1">
        {!asCity ? (
          nav.listOpen ? (
            <ProvinceList detail={detail} onPick={nav.pickCity} pendingPickable />
          ) : detail ? (
            <ProvinceCard detail={detail} name={sel.name} onPickCity={nav.pickCity} />
          ) : (
            <Busy />
          )
        ) : nav.listOpen ? (
          <DistrictList cityAdcode={sel.adcode} active={nav.activeDistrict} onPick={nav.pickDistrict} />
        ) : (
          <CityCard cityId={cityId} name={sel.name} />
        )}
      </div>

      <div className="flex-none border-t border-line">
        {/* ★ 未收录的市不给"查看区列表"：区分片是按已收录的点位算出来的，点进去必然是空表 */}
        {asCity && !cityId ? (
          <div className="px-3.5 py-2.5 text-[11.5px] text-ink-2">
            还没收录，没有区列表可看。换一座城，或等采集跟上。
          </div>
        ) : !nav.listOpen ? (
          <button
            type="button"
            onClick={nav.toggleList}
            className="flex w-full items-center justify-between px-3.5 py-2.5 text-[12.5px] hover:bg-bg"
          >
            <span>{asCity ? '查看区列表' : '查看城市列表'}</span>
            <Icon name="chev-right" size="sm" className="text-ink-2/60" />
          </button>
        ) : asCity ? (
          cityId ? (
            <button
              type="button"
              onClick={() => navTo.city(cityId)}
              className="flex w-full items-center justify-between px-3.5 py-2.5 text-[12.5px] hover:bg-bg"
            >
              <span>进入城市页看全部景点</span>
              <Icon name="chev-right" size="sm" className="text-ink-2/60" />
            </button>
          ) : (
            <div className="px-3.5 py-2.5 text-[11.5px] text-ink-2">这座城还没收录</div>
          )
        ) : (
          <button
            type="button"
            onClick={nav.toggleList}
            className="flex w-full items-center gap-1.5 px-3.5 py-2.5 text-[12.5px] hover:bg-bg"
          >
            <Icon name="chev-left" size="sm" className="text-ink-2/60" />
            <span>返回省概览</span>
          </button>
        )}
      </div>
    </Overlay>
  )
}

function Busy() {
  return (
    <div className="flex items-center gap-2 px-3.5 py-6 text-[13px] text-ink-2">
      <span className="size-3.5 flex-none animate-spin rounded-full border-2 border-line border-t-primary" />
      加载中…
    </div>
  )
}
