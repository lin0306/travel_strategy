import type { ReactNode } from 'react'

import { Icon } from '~/common/ui/Icon'

/**
 * 灰底降级条 —— **只用于「系统状态」**。
 *
 * ## 为什么不能和橙色过载提示共用一种颜色
 * 这两种条讲的是完全不同性质的事，混色会让人误判：
 *
 * | 条 | 颜色 | 讲什么 | 用户能做什么 |
 * |----|------|--------|-------------|
 * | `DegBar` | 灰 | 额度用尽 / 本地存储不可用 / 分享链接解析失败 | 只能接受，或换个做法（导出 JSON） |
 * | 过载提示 | 橙 | 排太满、单段太长、方式超距 | 直接改行程就能解决 |
 *
 * 用橙色画"浏览器不让我存数据"，用户会以为是自己行程排错了。
 *
 * ## 为什么不用 `role="alert"`
 * 它随页面首次渲染就可能出现（一进来额度就是满的），此时播报没有意义。
 * 屏幕阅读器按文档顺序会自然读到，不需要强制打断。
 */
export function DegBar({ children }: { children: ReactNode }) {
  return (
    <div className="mx-3.5 mt-3 flex items-start gap-2 rounded-lg border border-line bg-bg px-3 py-2 text-[12px] leading-relaxed text-ink-2">
      <Icon name="info" size="sm" className="mt-0.5 flex-none" />
      <span>{children}</span>
    </div>
  )
}
