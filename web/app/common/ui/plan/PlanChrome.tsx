/**
 * 行程页的两块页面级小浮层 —— 提示条与符号图例（两端共用内容）。
 *
 * ## 符号图例为什么还存在
 * 三个符号（住宿旗标 / 序号圆点 / 估算连线）**光看图认不出来**，必须给文字。
 * 它是**信息**不是功能，所以不放进会滚动的面板里（滚一下就找不到了）。
 *
 * ★ 「地区选择器 + 面包屑 + 图例」曾经挤在同一条底部栏里，后果是"我在哪一级"
 *   被降级成工具级信息，而顶部轨道一直空着。现在：**"我在哪"整个从界面撤掉了**
 *   （选择器 → 顶栏只读文字 → 连文字也删，2026-09-22 走完，理由见
 *   `common/ui/TopBar.tsx` 文件头）、**底图署名交给 SDK 自带的左下角**
 *   （含审图号，信息量更高）、这条栏只留行程符号。
 *
 * ## 两端装法不同
 * 桌面：图例浮在左下角（地图是画布，信息就该浮在上面）。
 * 移动：砌进 Sheet 正文末尾 —— 底部被抽屉占满，浮在左下角会被压在抽屉底下。
 *
 * ## ★ 提示条已统一到 `ToastBar`（2026-10-16）
 * 它原本是**第四个**提示组件（底部居中 + `info` 图标 + `Overlay`），
 * 与另外三个各玩各的 —— 用户报「提示到处挂，没统一」。现在版式全部收进 `ToastBar`，
 * 理由与那张对照表写在本文件下方的 `PlanToast` 注释里。

/**
 * 行程页提示条 —— ★ 2026-10-16 起直接用 `ToastBar`。
 *
 * ## 为什么原来这里是**第四个**提示（用户报「提示到处挂，没统一」时漏掉的）
 * 改之前一共四处提示，各自定位：
 * | 组件 | 位置 | 版式 |
 * |------|------|------|
 * | `plan/PlanToast.tsx` | 底部居中 | 无图标 |
 * | `plan/PickingHint.tsx` | 顶部居中 | locate 图标 |
 * | `PlanChrome.tsx` 这个 | 底部居中 | ★ **info 图标 + `Overlay`**（与上面两个不同款） |
 * | `MapStatusCard` | 顶端偏右 | 常驻状态卡 |
 *
 * 前两个已收进 `ToastStack`；本组件是**行程页专用**的那条（触发在 `usePlanView`，
 * 不走 `planUi` 那个 store），所以不能并进 `ToastStack`，但**版式必须一致** ⇒ 直接用 `ToastBar`。
 *
 * ## ★ 它原来是 `Overlay`（带 `data-overlay`），现已不带了
 * 提示是自动消失的瞬时条，参与 `fitView` 的"地图可用区"实测只会让地图
 * 为一条 3 秒后消失的提示白让一块位置（理由见 `ToastBar` 文件头）。
 *
 * ## 为什么这文件里还留着图例
 * 图例是**信息**不是提示（见文件头"符号图例为什么还存在"），且两端装法不同，所以不动。
 */

import { Overlay } from '~/common/ui/Overlay'
import { ToastBar } from '~/common/ui/ToastBar'
import { StayPicker } from '~/common/ui/plan/StayPicker'
import type { PlanView } from '~/common/logic/usePlanView'

export function PlanToast({ text, onClose }: { text: string; onClose: () => void }) {
  return <ToastBar onClose={onClose}>{text}</ToastBar>
}

/** 图例内容。`as="overlay"` 给桌面（自己浮一块），`as="inline"` 给移动（砌进抽屉） */
export function PlanLegend({ hasSoftData, as }: { hasSoftData: boolean; as: 'overlay' | 'inline' }) {
  const items = (
    <>
      <span className="flex flex-none items-center gap-1 text-[11.5px]">
        <i aria-hidden="true" className="size-2.5 rounded-full bg-ink" />
        住宿点
      </span>
      <span className="flex flex-none items-center gap-1 text-[11.5px]">
        <i aria-hidden="true" className="size-2.5 rounded-full border border-ink bg-white" />
        当天顺序
      </span>
      <span className="flex flex-none items-center gap-1 text-[11.5px] text-ink-2">
        连线为<strong className="mx-0.5 font-semibold">估算</strong>
        {hasSoftData ? ' · 时长含估算' : ''}
      </span>
    </>
  )

  if (as === 'inline') {
    return <div className="flex flex-wrap items-center gap-2.5 px-4 py-3">{items}</div>
  }

  return (
    <Overlay
      anchor="bottom-left"
      width="auto"
      z={26}
      noAnim
      className="max-w-[min(100vw-32px,calc(100%-32px))] flex-row flex-wrap items-center gap-2.5 px-3 py-2"
    >
      {items}
    </Overlay>
  )
}

/**
 * 两端都要的两件**浮层**：住宿点选择器 + 提示条。
 *
 * ★ 图例不在这里 —— 桌面要它浮在左下角、移动要它砌进抽屉正文，
 *   而"砌进正文"要求它出现在 `Sheet` 的 children 里（由各自的视图决定位置）。
 *   所以图例是个独立组件（`PlanLegend`），由两端视图各自摆放。
 */
export function PlanExtras({ view }: { view: PlanView }) {
  return (
    <>
      {view.stayPickerOpen ? (
        <StayPicker
          city={view.city}
          store={view.store}
          onClose={view.onCloseStayPicker}
          onUseCenter={view.onUseMapCenter}
          onDone={view.onStayPicked}
        />
      ) : null}

      {view.toast ? <PlanToast text={view.toast} onClose={view.onCloseToast} /> : null}
    </>
  )
}
