/**
 * 两端共用的两段内容 —— 城市页的「筛选条」与「点位列表」。
 *
 * ## 为什么单独成文件（而不是各自写进两端视图）
 * 桌面外壳（348px 左面板）与移动外壳（底部 Sheet）**装的是同一份内容**：
 * 同一个 `FilterBar`、同一个 `PoiList`、同一批回调。差别只在"装它的壳"。
 * 把这两段各写两遍，等于以后每加一个字段都要改两处 —— 而漏改一处时，
 * 两端只是"看起来不太一样"，不会报错。
 *
 * ★ 本文件只做**接线**（把 `useCityView()` 的字段交给展示件），不放布局。
 *   布局属于两端外壳：桌面要把它塞进可滚动的 flex-1 容器，移动要塞进 Sheet 的正文。
 */

import { FilterBar } from '~/common/ui/city/FilterBar'
import { PoiList } from '~/common/ui/city/PoiList'
import type { CityView } from '~/common/logic/useCityView'

/** 大类 chip + 细类色板（兼图例）。两端同一份 */
export function CityFilters({ view }: { view: CityView }) {
  return (
    <FilterBar
      city={view.city}
      category={view.category}
      subtype={view.subtype}
      counts={view.subtypeCounts}
      onCategory={view.setCategory}
      onSubtype={view.setSubtype}
    />
  )
}

/** 点位列表。两端同一份（含"点开详情 / 添加行程"两个出口） */
export function CityList({ view }: { view: CityView }) {
  return (
    <PoiList
      city={view.city}
      list={view.visible}
      sort={view.sort}
      // ★ 高亮跟随**生效**的那一枚（可能是搜索命中的），不是"页面自己选中的那一枚"
      selectedId={view.selectedId}
      // ★ 行点击与「详情」按钮都走 `openPoi` —— 它**先清搜索命中**再选中。
      //   原来行点击直连 `setSelectedId`，绕过了那一步：那是"谁写选中"多出来的第二条路，
      //   在"命中优先"的规则下会被 pick 吃掉。
      //   （说清可达性：详情面板 620px 盖住了清单 348px，所以**今天点不到** ——
      //     但哪天面板变窄就会立刻变成"点了清单没反应"，不该留着。）
      //   护栏 = AA⑦；不变量写在 `useSearchPick` 文件头。
      onSelect={view.openPoi}
      onOpen={view.openPoi}
      onAddToPlan={view.addToPlan}
    />
  )
}
