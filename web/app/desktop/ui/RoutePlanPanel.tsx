/**
 * 桌面端的「路线规划」面板容器 —— 右侧 360px 浮层（`--panel-plan`）。
 *
 * ★ 内容在 `common/ui/plan/RoutePlanPanelBody`；这里只给壳。
 *   移动端是底部 Sheet（`mobile/ui/RoutePlanPanel`），两端共用同一份内容。
 *   分家的理由（三块划分 W 项）写在 `RoutePlanPanelBody.tsx` 文件头。
 *
 * ★ 关着的时候**不渲染**（返回 `null`）而不是隐藏：面板里挂着地图图层与
 *   `loadCity`，用 CSS 藏起来会让它们一直活着 —— 包括那条整条路线折线，
 *   它会在地图上留着而用户已经关掉面板了（看起来像"地图上莫名有条线"）。
 */

import { RoutePlanPanelBody } from '~/common/ui/plan/RoutePlanPanelBody'
import { usePlanUi } from '~/common/logic/itinerary/planUi'
import { Overlay } from '~/common/ui/Overlay'

export function DesktopRoutePlanPanel() {
  const open = usePlanUi((s) => s.panelOpen)
  if (!open) return null

  return (
    <Overlay anchor="right" widthToken="--panel-plan" tall z={21} label="路线规划" className="overflow-hidden">
      <RoutePlanPanelBody />
    </Overlay>
  )
}
