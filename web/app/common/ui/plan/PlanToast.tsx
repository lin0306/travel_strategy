/**
 * 规划功能的操作反馈 —— 一条居中底部的轻量提示。
 *
 * ## 为什么它必须独立于面板存在
 * 「添加行程」**不会打开面板**（它自己就是那个小弹窗），所以提示出现时
 * 右侧面板多半是关着的。把提示挂在面板里就会"加了却什么都没看到"，
 * 而用户最需要知道的那件事恰恰是**加到哪去了**。
 *
 * ## 为什么不用 `Overlay`
 * 浮层尺寸 token（`--panel-*`）是给"常驻面板"用的，而这条提示是瞬时的、
 * 宽度随内容变。它也不该带 `data-overlay` —— 那会让 `fitView` 的浮层实测
 * 把它算进"地图可用区"，地图会为一条 3 秒后消失的提示白让一块位置。
 */

import { openPlanDetail, usePlanUi } from '~/common/logic/itinerary/planUi'
import { Icon } from '~/common/ui/Icon'

export function PlanToast() {
  const toast = usePlanUi((s) => s.toast)
  const clearToast = usePlanUi((s) => s.clearToast)

  if (!toast) return null

  return (
    <div
      role="status"
      className="flt flt-in absolute bottom-[calc(var(--flt-inset)+8px)] left-1/2 z-[26] flex max-w-[min(560px,92vw)] -translate-x-1/2 items-center gap-2 px-3 py-2 text-[12.5px]"
    >
      <span className="min-w-0">{toast.text}</span>
      {toast.planId ? (
        <button
          type="button"
          onClick={() => {
            // ★ 这条「打开」是必需的，不是锦上添花：不点它，用户只知道"加进去了"，
            //   却不知道加到了哪一条，得自己去列表里翻
            if (toast.planId) openPlanDetail(toast.planId)
            clearToast()
          }}
          className="flex-none rounded-md px-2 py-0.5 text-[12px] font-medium text-primary hover:bg-line-2"
        >
          打开
        </button>
      ) : null}
      <button
        type="button"
        aria-label="关闭提示"
        onClick={clearToast}
        className="flex-none rounded-md p-0.5 text-ink-2 hover:bg-line-2 hover:text-ink"
      >
        <Icon name="close" size="sm" />
      </button>
    </div>
  )
}
