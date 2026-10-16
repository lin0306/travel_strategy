/**
 * 规划功能的操作反馈 —— 「加进行程」成功之后那一条提示。
 *
 * ## 为什么它必须独立于面板存在
 * 「添加行程」**不会打开面板**（它自己就是那个小弹窗），所以提示出现时
 * 右侧面板多半是关着的。把提示挂在面板里就会"加了却什么都没看到"，
 * 而用户最需要知道的那件事恰恰是**加到哪去了**。
 *
 * ## ★ 定位与版式已统一到 `ToastBar`（2026-10-16）
 * 它原来在**底部居中**，而「取点模式」的引导在**顶部居中** —— 两处提示两个位置，
 * 用户报「提示到处挂，没统一」并选了**全部上顶部**。
 * 现在本组件只负责"规划成功时说什么"，定位/版式/关闭按钮全在 `ToastBar` 里。
 *
 * 为什么不用 `Overlay`：浮层尺寸 token（`--panel-*`）是给"常驻面板"用的，
 * 而这条提示是瞬时的、宽度随内容变。
 */

import { openPlanDetail, usePlanUi } from '~/common/logic/itinerary/planUi'
import { ToastBar } from '~/common/ui/ToastBar'

export function PlanToast() {
  const toast = usePlanUi((s) => s.toast)
  const clearToast = usePlanUi((s) => s.clearToast)

  if (!toast) return null

  return (
    <ToastBar
      onClose={clearToast}
      action={
        toast.planId
          ? {
              label: '打开',
              onClick: () => {
                // ★ 这条「打开」是必需的，不是锦上添花：不点它，用户只知道"加进去了"，
                //   却不知道加到了哪一条，得自己去列表里翻
                if (toast.planId) openPlanDetail(toast.planId)
                clearToast()
              },
            }
          : undefined
      }
    >
      {toast.text}
    </ToastBar>
  )
}