/**
 * 行程规划页路由 —— **薄壳**：取数 + 按端分派（见 `routes/city.tsx` 的三层说明）。
 *
 * | 层 | 文件 |
 * |----|------|
 * | 逻辑 | `common/logic/usePlanView.ts`（两端共用，含时间链两遍推导） |
 * | 内容 | `common/ui/plan/{PlanPanel,DegBars,PlanChrome,StayPicker,ItineraryPanel}`（两端共用） |
 * | 形态 | `desktop/ui/PlanView`（420px 面板） · `mobile/ui/PlanView`（底部 Sheet） |
 *
 * ★★ **2026-09-26：这一页不再是另一套行程 UI** —— 用户要求「把旧的完整行程的内容，
 *   搬到现在的行程详情弹窗里」。`DesktopPlanView` / `MobilePlanView` 已删，
 *   行程的**唯一**界面是右侧浮层的详情态（`PlanDetailView`）。
 *
 *   这条 URL 保留下来是因为它还出现在收藏夹 / 分享里。语义改成
 *   「**打开这座城的规划**」：渲染城市页 + 把面板开在这座城**最近改过**的那条组上。
 *   （★ 预渲染清单里仍留着这 12 条 —— 渲染出来的就是城市页的 HTML，不是空壳。）
 */

import { useEffect } from 'react'

import CityRoute from '~/routes/city'
import { usePlanStore } from '~/common/logic/itinerary/planStore'
import { openPlanDetail, usePlanUi } from '~/common/logic/itinerary/planUi'
import { useParams } from 'react-router'

export default function PlanRoute() {
  const { cityId = '' } = useParams()
  const status = usePlanStore((s) => s.status)
  const load = usePlanStore((s) => s.load)
  const openPanel = usePlanUi((s) => s.openPanel)

  useEffect(() => {
    void load()
  }, [load])

  /**
   * 把面板开在这座城**最近改过**的那条组上。
   *
   * ★ 只跑一次（`status` 就绪时）—— 依赖里**不能放 `plans`**：
   *   往面板里加一个点 `plans` 就变，这条 effect 会把"当前打开的组"
   *   抢回"最新的一条"，用户的选中会被悄悄覆盖。
   */
  useEffect(() => {
    if (status !== 'ready') return
    const { plans } = usePlanStore.getState()
    const target = plans
      .filter((p) => p.cityId === cityId)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (target) {
      openPlanDetail(target.id)
    } else {
      // 这座城还没有组 → 开在列表态，用户点「新建组」
      openPanel()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, cityId])

  // 城市页在下层（左面板 + 地图），规划面板浮在右侧
  return <CityRoute />
}
