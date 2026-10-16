/**
 * 瞬时提示的**堆叠出口** —— 全站只有这一个挂点。
 *
 * ## 为什么需要"栈"而不是各挂各的（2026-10-16 用户报「提示到处挂，没统一」）
 * 统一位置之后冒出一个新问题：**两条提示会同时出现**。
 * `PlanToast`（加进行程成功）与 `PickingHint`（取点引导）都可能在规划流程里同开，
 * 而它们共用同一个 `top` ⇒ 两条直接**叠在一起**，只看得见下面那条。
 *
 * | 做法 | 问题 |
 * |------|------|
 * | 两条各自定位 | 就是"没统一"，用户已经报过了 |
 * | 让它们互斥（一条出现就藏另一条） | 藏掉的那条**信息就丢了** —— 而"加成功了"恰恰不能丢 |
 * | **按顺序往下堆** |✅ 两条都在，且位置有稳定规律 |
 *
 * ## ★ 为什么这里要**先算存在性**、再决定要不要渲染
 * 第一版是"无条件渲染两个容器，靠子组件自己 `return null`"——
 * 而 `PickingHint` / `PlanToast` 在无内容时返回 `null`，**外层的 `gap-2` 容器仍然占位**：
 * 上面那条不出现时，下面那条会被顶到第一行，看起来像"提示在乱跳"。
 *
 * ⇒ 这里直接读 store 判存在性：**不存在就不渲染那个容器**。
 * 所以本文件必须 import 两个 store（`usePlanUi`），否则拿不到"有没有"。
 *
 * ## 为什么优先级是「取点引导」在前
 * 取点是**当前正在进行的操作**，"加成功了"是上一步的结果 ——
 * 用户此刻的眼睛在找"下一步点哪儿"，先看到该看到的那条。
 *
 * ## 为什么不带 `data-overlay`
 * 见 `ToastBar` 文件头：提示会自动消失，不该让地图为它白让位置。
 */

import { usePlanUi } from '~/common/logic/itinerary/planUi'
import { PickingHint } from '~/common/ui/plan/PickingHint'
import { PlanToast } from '~/common/ui/plan/PlanToast'

export function ToastStack() {
  // ★ 存在性判据直接取自 store —— 只有 `toast` / `picking` 非空才渲染那一行，
  //   避免"空容器占位导致另一条被顶位"。两组件内部还会再判一次，是双保险。
  const toast = usePlanUi((s) => s.toast)
  const picking = usePlanUi((s) => s.picking)

  return (
    /*
     * 容器**不吃事件**（`pointer-events-none`）—— 绝不挡住下层浮层的点击；
     * `pointer-events-auto` 由 `ToastBar` 自己加回来（它上面有按钮）。
     * ★ 不用 `Overlay`：那是给"常驻面板"的（带白底/圆角/投影），这里要的是纯定位容器。
     * ★ 用 `flex-col` + `gap-2` 而不是逐条 `translateY`：条目数量会变（0/1/2），
     *   让布局自己算，比写死偏移少一类错位。
     */
    <div
      className="pointer-events-none absolute inset-x-0 z-[26] flex flex-col items-center gap-2"
      style={{ top: 'var(--rail-top)' }}
    >
      {picking ? <PickingHint /> : null}
      {toast ? <PlanToast /> : null}
    </div>
  )
}