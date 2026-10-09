/**
 * 城市页 · **桌面（web 端）** 外壳。
 *
 * ## 它是什么形态
 * 左侧 348px 定宽面板（`--panel-left`）装筛选 + 列表；点某个景点时，
 * **620px 详情面板**（`--panel-detail`）盖在左侧面板之上 + 300px 位置卡浮右侧。
 * 三块都**定宽**，绝不用 `flex:1` —— 浮层是"盖"在地图上的，一旦参与流式布局，
 * 地图就会随内容变形。
 *
 * ## 它不该有什么
 * 取数、过滤、图层、取景全在 `useCityView()` 里；本文件只摆壳。
 * 想加字段 → 改 `common/logic/useCityView.ts` 与 `common/ui/city/CityParts.tsx`，
 * 那两处是两端共用的，改一次两端都生效。
 */

import { Icon } from '~/common/ui/Icon'
import { CityFilters, CityList } from '~/common/ui/city/CityParts'
import { PoiDetailOverlay } from '~/desktop/ui/PoiDetailOverlay'
import { Overlay } from '~/common/ui/Overlay'
import { CityMissing } from '~/common/ui/Missing'
import { TopBar } from '~/common/ui/TopBar'
import type { CityView } from '~/common/logic/useCityView'

export function DesktopCityView({ view }: { view: CityView }) {
  const { shell, city, visible, loaded, selected, sort } = view

  if (loaded && !city) {
    return (
      <>
        <TopBar shell={shell} />
        <Overlay anchor="left" widthToken="--panel-left" z={20}>
          <CityMissing />
        </Overlay>
      </>
    )
  }

  const title = city?.name ?? '加载中…'

  return (
    <>
      {/* ★ 这里原来有一个「我的行程」按钮 —— 2026-09-26 撤掉：顶栏现在有**全站**的
          「路线规划」入口（`PlanMenuButton`），两个按钮做的是同一件事。
          而且"我的行程"这个名字在多规划之后是歧义的（一座城可能有好几条）。 */}
      <TopBar shell={shell} />

      <Overlay anchor="left" widthToken="--panel-left" tall z={20} className="overflow-hidden">
        <div className="flex-none border-b border-line px-3.5 py-3">
          <div className="flex items-baseline justify-between gap-2">
            <b className="text-[15px] font-semibold">{title}</b>
            <button
              type="button"
              onClick={view.toggleSort}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] text-ink-2 hover:text-primary"
            >
              {sort === 'hot' ? '热门优先' : '名称排序'}
              <Icon name="chev-down" size="sm" />
            </button>
          </div>
          {city ? (
            <p className="mt-1 mb-0 text-[11.5px] text-ink-2">
              {city.tagline} · 共 {city.pois.length} 个点位
              {visible.length !== city.pois.length ? ` · 已筛出 ${visible.length}` : ''}
            </p>
          ) : null}
          <div className="mt-2.5">
            <CityFilters view={view} />
          </div>
        </div>
        <div className="scroll min-h-0 flex-1">
          <CityList view={view} />
        </div>
      </Overlay>

      {/* 点景点（地图上的图标 / 名字，或清单里的行）→ **就地**浮出完整详情。
          ★ 不是那张 326px 的预览卡，也不跳详情页 —— 用户 2026-09-23 的要求：
            「这个不需要，点击直接看详情就行」「这个跳转不需要，url 不需要有任何变化」
          ★ 城市名走 `view.selectedCityName` 而不是本页的 `city.name`：
            搜索命中的可能是**别的城市**的景点（顶栏搜索在任意一级都能用）。 */}
      <PoiDetailOverlay
        poi={selected}
        cityName={view.selectedCityName}
        cityId={view.selectedCityId}
        onClose={view.closePoi}
        onAddToPlan={view.addToPlan}
      />
    </>
  )
}
