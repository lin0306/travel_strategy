/**
 * 行程页的两块页面级小浮层 —— 提示条与符号图例（两端共用内容）。
 *
 * ## 符号图例为什么还存在
 * 三个符号（住宿旗标 / 序号圆点 / 直线示意）**光看图认不出来**，必须给文字。
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
 */

import { Icon } from '~/common/ui/Icon'
import { Overlay } from '~/common/ui/Overlay'
import { StayPicker } from '~/common/ui/plan/StayPicker'
import type { PlanView } from '~/common/logic/usePlanView'

export function PlanToast({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <Overlay
      anchor="bottom"
      width="auto"
      z={40}
      className="max-w-[420px] flex-row items-center gap-2 px-3.5 py-2.5"
    >
      <Icon name="info" size="sm" className="text-primary" />
      <span className="text-[12.5px]">{text}</span>
      <button type="button" onClick={onClose} aria-label="关闭提示" className="text-ink-2 hover:text-ink">
        <Icon name="close" size="sm" />
      </button>
    </Overlay>
  )
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
        连线为<strong className="mx-0.5 font-semibold">直线示意</strong>
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
