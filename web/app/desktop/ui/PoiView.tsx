/**
 * 点位详情 · **桌面（web 端）** 外壳。
 *
 * ## 只有一块浮层
 * 620px 详情面板（`--panel-detail`）装**全部**内容 ——「位置与交通」砌在正文末尾。
 * 它原来另有一块 300px 的位置卡（`--panel-locate`，浮在右侧），用户看过之后说
 * 「右侧是会显示一个景点的简要信息，这个不需要」（2026-09-23 晚），已收进正文。
 * ★ 一条"看某处内容"的路不该同时摆两块浮层：多出来的那块既是遮挡，也是**第二个出口**。
 *
 * 定宽是关键：浮层是"盖"在地图上的，用 `flex:1` 会让地图随内容变形。
 */

import { addToPlanLabel, useCurrentPlanForCity } from '~/common/logic/useAddToPlan'
import { Icon } from '~/common/ui/Icon'
import { PoiDetail } from '~/common/ui/city/PoiDetail'
import { Overlay } from '~/common/ui/Overlay'
import { PoiMissing } from '~/common/ui/Missing'
import { TopBar } from '~/common/ui/TopBar'
import type { PoiView } from '~/common/logic/usePoiView'

export function DesktopPoiView({ view }: { view: PoiView }) {
  const { shell, city, poi } = view
  /**
   * 「添加行程」按钮写什么 —— 正在看这条**同城**的规划时改成「添加到当前行程」。
   * ★ 在 early return 之前调（hooks 不能被条件跳过）；判据与 `useAddToPlan.run()`
   *   里那条短路是同一个函数，所以文案与行为不会对不上。
   */
  const addLabel = addToPlanLabel(useCurrentPlanForCity(view.cityId))

  if (view.loaded && (!city || !poi)) {
    return (
      <>
        <TopBar variant="task" shell={shell} />
        <Overlay anchor="left" widthToken="--panel-detail" z={20}>
          <PoiMissing cityId={view.cityId} hasCity={city !== null} />
        </Overlay>
      </>
    )
  }

  return (
    <>
      <TopBar
        variant="task"
        shell={shell}
        actions={
          poi ? (
            <button
              type="button"
              onClick={view.addToPlan}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[12.5px] hover:border-primary hover:text-primary"
            >
              <Icon name="plus" size="sm" />
              {addLabel}
            </button>
          ) : null
        }
      />

      <Overlay anchor="left" widthToken="--panel-detail" tall z={20} className="overflow-hidden">
        {poi && city ? (
          <PoiDetail
            poi={poi}
            cityName={city.name}
            gallery={view.gallery}
            onGallery={view.setGallery}
            showSources={view.showSources}
            onToggleSources={view.toggleSources}
          />
        ) : (
          <Loading />
        )}
      </Overlay>
    </>
  )
}

function Loading() {
  return (
    <div className="flex items-center gap-2 p-6 text-[13px] text-ink-2">
      <span className="size-3.5 animate-spin rounded-full border-2 border-line border-t-primary" />
      加载中…
    </div>
  )
}
