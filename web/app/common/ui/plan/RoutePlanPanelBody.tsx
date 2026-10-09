/**
 * 右侧「路线规划」面板的**内容**（与容器无关）。
 *
 * ## 为什么内容与容器分家
 * 桌面用右侧浮层（`--panel-plan`），移动用底部 Sheet —— 而项目的三块划分
 * （W 项）规定 **`common/` 不许 import `desktop/` 或 `mobile/`**。
 * 所以这一层只产出"面板里装什么"，容器由两端的薄壳各自提供：
 *   · `desktop/ui/RoutePlanPanel.tsx` → `<Overlay anchor="right">`
 *   · `mobile/ui/RoutePlanPanel.tsx` → `<Sheet>`
 * 与城市页的三层结构（`useCityView` / `CityParts` / 两端外壳）是同一套分法。
 *
 * ## 两态共用一块容器（不换 URL）
 * | 态 | 内容 | 触发 |
 * |----|------|------|
 * | 列表 | 全部组，按 `updatedAt` 倒序 | 点顶栏按钮 |
 * | 详情 | **完整行程**（时间链 / 住宿 / 多方案 / 导入导出分享，见 `PlanDetailView`） | 点列表里某一条 |
 *
 * ## 地图侧：**整条沿路折线 + 序号 + 取点**（plans/13 §5.3）
 * ★ 是 `usePlanRouteLayer`（一条折线），**不是** `usePlanMapLayers`（按天逐段）——
 *   「整条一次规划」只算出一条折线，逐段那条在这里画出来全是直线。
 *   两者同时挂 = 同一趟行程在地图上画两条线，而且**不报错**。
 *
 * ★ 关着的时候**不渲染**（两端容器各自返回 `null`）：面板里挂着地图图层与
 *   `loadCity`，用 CSS 藏起来会让它们一直活着 —— 包括那条折线，
 *   它会在地图上留着而用户已经关掉面板了（看起来像"地图上莫名有条线"）。
 */

import { useEffect } from 'react'

import { addPickedPoint } from '~/common/logic/useAddToPlan'
import { usePlanStore } from '~/common/logic/itinerary/planStore'
import { usePlanUi } from '~/common/logic/itinerary/planUi'
import { usePlanRouteLayer } from '~/common/logic/usePlanRouteLayer'
import { usePlanStops } from '~/common/logic/usePlanStops'
import { useMapShell } from '~/common/logic/mapShell'
import { PlanDetailView } from '~/common/ui/plan/PlanDetailView'
import { PlanListView } from '~/common/ui/plan/PlanListView'

export function RoutePlanPanelBody() {
  const shell = useMapShell()

  const picking = usePlanUi((s) => s.picking)
  const stopPicking = usePlanUi((s) => s.stopPicking)
  /**
   * 详情态里"展开了哪一段"（由 `PlanDetailView` 推上来）。
   * 地图侧据此画候选路线（未选中自动半透明）并把镜头跳到这一段的两端。
   */
  const legFocus = usePlanUi((s) => s.legFocus)

  const plans = usePlanStore((s) => s.plans)
  const activeId = usePlanStore((s) => s.activeId)
  const load = usePlanStore((s) => s.load)

  const plan = activeId ? (plans.find((p) => p.id === activeId) ?? null) : null
  const { stops } = usePlanStops(plan)

  // 面板一挂上就把记录读起来（`load` 幂等；别处也调过就直接返回）
  useEffect(() => {
    void load()
  }, [load])

  // Esc 退出取点（与顶栏下拉的 Esc 语义一致）
  useEffect(() => {
    if (!picking) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stopPicking()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [picking, stopPicking])

  /**
   * 取点模式：**点地图任意位置落一个点**（plans/13 §3.3）。
   *
   * ★ 用 `map.on('click')` 而不是自己监听 DOM 点击再换算坐标：
   *   换算要靠 `projectToContainer` 反推，缩放/俯仰一参与就偏 ——
   *   地图自己给的事件里带 `latLng`，那是唯一准确的来源。
   * ★ 离开取点模式要 `off` 掉（`map.on` 返回的是 map 实例，不是取消函数；
   *   忘了 off 会让"点一次地图"落好几个点）。
   */
  useEffect(() => {
    const map = shell.map
    if (!map || !picking) return
    const planId = picking.planId
    const onClick = (evt: { latLng?: { getLat(): number; getLng(): number } }) => {
      const ll = evt.latLng
      if (!ll) return
      void addPickedPoint(planId, ll.getLng(), ll.getLat())
    }
    map.on('click', onClick)
    return () => {
      map.off('click', onClick)
    }
  }, [shell.map, picking])

  /**
   * 取点模式的光标。★ 走容器的内联样式，不走 SDK ——
   *   腾讯 GL 的 `Map` 上没有 `setCursor`（在 `tmap.d.ts` 里查过），
   *   而光标是纯 DOM 的事，没必要绕一圈。
   */
  useEffect(() => {
    const container = shell.map?.getContainer?.()
    if (!container) return
    const prev = container.style.cursor
    if (picking) container.style.cursor = 'crosshair'
    return () => {
      container.style.cursor = prev
    }
  }, [shell.map, picking])

  // 地图侧：整条折线 + 序号 + 按规划取景
  usePlanRouteLayer({ shell, plan, stops, enabled: true, legFocus })

  return plan ? <PlanDetailView /> : <PlanListView />
}
