import { Icon } from '~/common/ui/Icon'

/**
 * 行内确认条 —— 用于「跨天移动会改变回程起点」这类需要用户拍板的动作。
 *
 * ## 为什么是第三种形态，不复用灰/橙那两条
 * 三种条讲的是三件不同的事，颜色就是它们的分工：
 *
 * | 形态 | 颜色 | 性质 | 期望用户做什么 |
 * |------|------|------|---------------|
 * | `DegBar` | 灰 | 系统状态 | 无需回答 |
 * | `OverloadWarnings` | 橙 | 行程质量 | 无需回答（看完自己决定改不改） |
 * | **本组件** | 主色描边 | **一个问题** | **必须回答：继续 / 取消** |
 *
 * 前两种是"通知"，这一种是"询问"。用通知的颜色画询问，用户会以为事情已经发生了。
 *
 * ## 为什么不用 `window.confirm`
 * 它在微信 WebView 里样式不受控、还会被部分宿主拦截；而且文案里的地名
 * （「第 3 天住的是『青城山下民宿』」）用原生弹窗没法强调。
 */
export function ConfirmBar({
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="mx-3.5 mt-3 rounded-lg border border-primary/45 bg-[#F7FAFF] px-3 py-2.5">
      <div className="flex items-start gap-2 text-[12px] leading-relaxed">
        <Icon name="alert" size="sm" className="mt-0.5 flex-none text-primary" />
        <span>{message}</span>
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-7 rounded-lg border border-line px-3 text-[12px] text-ink-2 hover:border-primary hover:text-primary"
        >
          取消
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="h-7 rounded-lg bg-primary px-3 text-[12px] font-medium text-white"
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  )
}
