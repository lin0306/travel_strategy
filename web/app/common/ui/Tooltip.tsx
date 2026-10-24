/**
 * Tooltip —— **全站悬浮提示的唯一出处**（2026-10-17 建）。
 *
 * ## 为什么现在才有
 * 全局偏好早有「Tooltip > title，禁 HTML `title` 属性」，但站内一直没有真正的
 * 悬浮提示场景（提示都走 `ToastStack`）。海报导出的禁用原因需要"悬浮图标看原因"
 * —— 禁用按钮收不到 hover，ToastStack 又是自动消失的条 —— 这才有了第一个真需求。
 *
 * ## 实现取舍
 * - **纯 CSS `group-hover`，零 JS 状态**：hover 提示没有"常驻/单例/焦点管理"诉求，
 *   用状态机实现纯属多余；`hidden group-hover:block` 一行切换。
 * - `absolute` + 向上弹（bottom-full）：首个使用者是**页面底部动作条**，向下弹会出屏。
 * - `pointer-events-none`：提示层不拦鼠标，移开即消失，不需要延迟/闪烁处理。
 * - 深底白字（`bg-ink`）+ 小号 —— 与 `ToastBar` 同族但更轻（Toast 管告知，Tooltip 管解释）。
 */

import type { ReactNode } from 'react'

export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2.5 py-1.5 text-[11.5px] leading-none text-white shadow-[0_4px_14px_rgba(16,24,40,.22)] group-hover:block"
      >
        {text}
      </span>
    </span>
  )
}
