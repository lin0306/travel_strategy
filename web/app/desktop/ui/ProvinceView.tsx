/**
 * 省级视图 · **桌面（web 端）** 外壳 —— 左侧 348px 定宽面板。
 *
 * 逻辑全在 `useProvinceView()`，清单内容全在 `common/ui/city/ProvinceList`。
 * 本文件只摆壳：一个 `Overlay` + 标题栏 + 可滚动正文。
 *
 * ★ 右下那块 `PoiDetailOverlay` 是**放大到点位级之后**才会用到的东西：本页揭示出景点圆点，
 *   点它就浮出完整详情（与首页 / 城市页同一份，见 `desktop/ui/PoiDetailOverlay.tsx`）。
 */

import { Overlay } from '~/common/ui/Overlay'
import { ProvinceList } from '~/common/ui/city/ProvinceList'
import { PoiDetailOverlay } from '~/desktop/ui/PoiDetailOverlay'
import { TopBar } from '~/common/ui/TopBar'
import type { ProvinceView } from '~/common/logic/useProvinceView'

export function DesktopProvinceView({ view }: { view: ProvinceView }) {
  const { shell, detail, collected, title } = view

  return (
    <>
      <TopBar shell={shell} />

      <Overlay anchor="left" widthToken="--panel-left" tall z={20} className="overflow-hidden">
        <div className="flex-none border-b border-line px-3.5 py-3">
          <div className="flex items-baseline justify-between gap-2">
            <b className="text-[14.5px] font-semibold">{title}</b>
            {detail?.hasTree ? (
              <span className="text-[11.5px] text-ink-2">
                已收录 {collected} / {detail.childCount}
              </span>
            ) : null}
          </div>
          {detail && !detail.boundsAvailable ? (
            <p className="mt-1.5 mb-0 text-[11.5px] leading-relaxed text-ink-2">
              本级边界数据尚未生成，地图暂时只显示计数徽标。
            </p>
          ) : null}
        </div>
        <div className="scroll min-h-0 flex-1">
          <ProvinceList detail={detail} onPick={view.pickCity} />
        </div>
      </Overlay>

      {/* 点景点（地图放大到点位级之后的圆点 / 名字）→ **就地**浮出完整详情 */}
      <PoiDetailOverlay
        poi={view.selected}
        cityName={view.selectedCityName}
        cityId={view.selectedCityId}
        onClose={view.closePoi}
        onAddToPlan={view.addToPlan}
      />
    </>
  )
}
