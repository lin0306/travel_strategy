/**
 * 省级视图 · **移动端** 外壳 —— 底部 Sheet 三档吸附。
 *
 * 与桌面版的差异只有"壳"：桌面是 348px 左面板（标题栏 + 可滚动正文两段），
 * 移动是 Sheet（标题进 `SheetHead` 的 `sub`，正文整块给清单）。
 * 内容与逻辑都是同一份（`common/ui/city/ProvinceList` / `useProvinceView`）。
 *
 * ★ 放大到点位级之后点景点：**详情顶替列表**（屏幕放不下两块抽屉），
 *   关掉就回到列表 —— 与 `mobile/ui/CityView` 同一个约定。
 */

import { useState } from 'react'

import { ProvinceList } from '~/common/ui/city/ProvinceList'
import { PoiDetailSheet } from '~/mobile/ui/PoiDetailSheet'
import { Sheet, SheetHead, type SheetTier } from '~/mobile/ui/Sheet'
import { TopBar } from '~/common/ui/TopBar'
import type { ProvinceView } from '~/common/logic/useProvinceView'

export function MobileProvinceView({ view }: { view: ProvinceView }) {
  const { shell, detail, collected, title } = view
  // 抽屉档位是纯形态状态（桌面版没有这个概念），留在视图层
  const [tier, setTier] = useState<SheetTier>('half')

  // 选中景点 → 详情顶替列表；「关闭」或点地图空白回到列表
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
            title={title}
            sub={
              detail === null
                ? '加载中…'
                : detail.hasTree
                  ? `已收录 ${collected} / 共 ${detail.childCount} 个下级区划`
                  : '区划数据尚未生成'
            }
          />
        }
      >
        <ProvinceList detail={detail} onPick={view.pickCity} />
      </Sheet>
    </>
  )
}
