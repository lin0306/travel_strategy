/**
 * 城市页 · **移动端** 外壳（底部 Sheet 三档吸附）。
 *
 * ## 与桌面版的差异（全部差异就这三条，别的都在共用层）
 * | | 桌面 | 移动 |
 * |---|---|---|
 * | 容器 | 左侧 348px 定宽面板 | 底部 Sheet（peek / half / full） |
 * | 顶栏动作 | 「我的行程」按钮 | **不给** —— Sheet 页脚已经有「去排行程」这一个入口 |
 * | 排序 | 标题行右侧小按钮 | 页脚左侧整块按钮（拇指够得着） |
 *
 * ★ 顶栏**为什么不能也给一个动作**：会出现两个"去排行程"，而且移动端顶栏那点宽度
 *   挤上动作之后，中间留白会被压得很难看（那一格早先还有地区文字时，它会先被压成省略号）。
 *
 * ★ 移动端不渲染"右侧预览卡"这种东西（屏幕放不下）：选中一个点位时，
 *   **详情 Sheet 顶替列表 Sheet**，关掉就回到列表（`PoiDetailSheet` 在 `mobile/ui/`）。
 *   这也让本文件不必 import 任何桌面件。
 */

import { useState } from 'react'

import { Icon } from '~/common/ui/Icon'
import { CityFilters, CityList } from '~/common/ui/city/CityParts'
import { CityMissing } from '~/common/ui/Missing'
import { PoiDetailSheet } from '~/mobile/ui/PoiDetailSheet'
import { Sheet, SheetHead, type SheetTier } from '~/mobile/ui/Sheet'
import { usePageSheet } from '~/mobile/ui/sheetHub'
import { TopBar } from '~/common/ui/TopBar'
import type { CityView } from '~/common/logic/useCityView'

export function MobileCityView({ view }: { view: CityView }) {
  const { shell, city, visible, loaded, sort } = view
  // 抽屉档位是**纯形态状态**（桌面版根本没有），所以留在视图层，不进共用钩子
  const [tier, setTier] = useState<SheetTier>('half')
  /*
   * 这一页的清单浮层是**页面主体**：进来就把残留的规划 / 图层清掉
   * （用户：「不要隐藏一个下方还有一个」），但它自己不会被别的浮层关掉
   * —— 城市页没有"关掉清单"这回事。规则与 key 见 `mobile/ui/sheetHub`。
   */
  usePageSheet()

  if (loaded && !city) {
    return (
      <>
        <TopBar shell={shell} />
        <Sheet tier={tier} onTier={setTier} header={<SheetHead title="找不到这座城市" />}>
          <CityMissing />
        </Sheet>
      </>
    )
  }

  // 选中景点 → 详情顶替列表；「关闭」或点地图空白回到列表
  // ★ 城市名走 `view.selectedCityName`：搜索命中的可能是**别的城市**的景点
  if (view.selected) {
    return (
      <>
        <TopBar shell={shell} />
        <PoiDetailSheet
          poi={view.selected}
          cityName={view.selectedCityName}
          cityId={view.selectedCityId}
          onClose={view.closePoi}
          onAddToPlan={view.addToPlan}
        />
      </>
    )
  }

  return (
    <>
      <TopBar shell={shell} />

      <Sheet
        tier={tier}
        onTier={setTier}
        header={
          <SheetHead
            title={city?.name ?? '加载中…'}
            sub={
              city
                ? `${city.tagline} · 共 ${city.pois.length} 个点位${
                    visible.length !== city.pois.length ? ` · 已筛出 ${visible.length}` : ''
                  }`
                : undefined
            }
          />
        }
        footer={
          /*
           * ★ 不再给右下角工具条让位（原来的 `mr-[44px]` 已删）：层级改成
           *   「浮层 `z-28` 压住工具条 `z-[27]`」之后，四枚整块在本浮层底下，
           *   页脚右端不再有东西压着 —— 留着那 44px 反而变成一条没来由的空白。
           */
          <button
            type="button"
            onClick={view.toggleSort}
            className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line text-[14.5px] md:h-9 md:text-[13px]"
          >
            {sort === 'hot' ? '热门优先' : '名称排序'}
            <Icon name="chev-down" size="sm" />
          </button>
        }
      >
        {/*
          * ★★ 筛选条**放进滚动容器**并且吸顶（2026-10-25 修「滚动没办法用」）。
          *
          * 原来它在 `header` 里，而 `header` 是 `flex-none`（不滚的）——
          * 于是 Sheet 上半部（把手 + 标题 + 两行 chip ≈ 230px）**根本不是滚动区**，
          * 用户很自然地从那里往下滑，得到的却是"面板纹丝不动"（再往下才是列表）。
          * 实测 half 档里可滚区只剩 237px，比 header 还矮。
          *
          * 现在：标题仍固定（回答"这是哪座城"），筛选条与列表一起滚，
          * 且 `sticky top-0` 吸在滚动区顶部 —— 滚列表时筛选条不跑，
          * 滚过头也不会挡列表。背景要显式给（否则内容会从它下面透出来）。
          */}
        <div className="sticky top-0 z-[1] bg-surface px-3.5 pt-1 pb-1.5">
          <CityFilters view={view} />
        </div>
        {/*
          * ★ 原来这里有个 `pr-[40px]` 给右下角工具条让位 —— 随层级改成
          *   「浮层压住工具条」一起删了（工具条已在本浮层底下，不再是覆盖物）。
          */}
        <div>
          <CityList view={view} />
        </div>
      </Sheet>
    </>
  )
}
