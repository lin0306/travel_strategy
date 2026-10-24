/**
 * 「导出海报」按钮 + 禁用原因的悬浮提示（2026-10-17 用户两轮定稿）。
 *
 * ## 交互（用户最终定：图标放**按钮尾部**，悬浮看原因；按钮内容不变）
 * `[⬇ 导出海报 ⓘ]` —— ⓘ 仅禁用时出现，悬浮显示原因。
 *
 * ## ★ 为什么用 `aria-disabled` 而不是真 `disabled`
 * **真禁用的 `<button>` 在 Chrome/Edge 不派发任何鼠标事件** —— 放在按钮尾部的
 * ⓘ 图标永远收不到 hover，Tooltip 就是死的。改用 aria-disabled 模式：
 * 按钮保持可 hover / 可聚焦（屏幕阅读器也能读出 `aria-disabled` + 原因），
 * 点击在 handler 里拦截。视觉上仍是禁用态（半透明 + not-allowed 光标 + hover 不变色）。
 * 这是无障碍组件的常规做法，不是偷懒。
 *
 * ## Tooltip 位置
 * ⓘ 悬浮的提示向上弹（bottom-full）：按钮在页面底部动作条，向下会出屏。
 */

import { Icon } from '~/common/ui/Icon'
import { Tooltip } from '~/common/ui/Tooltip'

export function PosterExportButton({
  busy,
  disabledReason,
  onRun,
}: {
  /** 是否导出中 */
  busy: boolean
  /** 禁用原因（空串 = 可导出） */
  disabledReason: string
  onRun: () => void
}) {
  const disabled = busy || disabledReason !== ''
  return (
    <button
      type="button"
      aria-disabled={disabled}
      onClick={() => {
        if (disabled) return
        onRun()
      }}
      className={`inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line text-[12.5px] ${
        disabled
          ? 'cursor-not-allowed opacity-60'
          : 'hover:border-primary hover:text-primary'
      }`}
    >
      {busy ? (
        // spinner：进度详情在上方进度行（长文案放按钮里会换行/挤出 —— 用户实测）
        <>
          <span className="size-3 flex-none animate-spin rounded-full border-2 border-line border-t-primary" />
          导出中…
        </>
      ) : (
        <>
          <Icon name="download" size="sm" />
          导出海报
          {disabledReason ? (
            <Tooltip text={disabledReason}>
              <span
                aria-label={disabledReason}
                className="ml-0.5 inline-flex cursor-help items-center"
              >
                <Icon name="info" size="sm" />
              </span>
            </Tooltip>
          ) : null}
        </>
      )}
    </button>
  )
}

/**
 * 导出进度行（**与按钮配套**：详细进度放这里，不进按钮 —— 长文案会把按钮撑爆，
 * 2026-10-17 用户实测「内容一多就会换行甚至挤出去」）。仅导出中渲染。
 */
export function PosterProgressRow({ text }: { text: string }) {
  return (
    <div className="flex flex-none items-center gap-1.5 border-t border-line px-3.5 py-1.5 text-[11.5px] text-ink-2">
      <span className="size-3 flex-none animate-spin rounded-full border-2 border-line border-t-primary" />
      <span className="truncate">{text}</span>
    </div>
  )
}
