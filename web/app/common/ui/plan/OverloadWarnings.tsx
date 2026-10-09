import { Icon } from '~/common/ui/Icon'

/**
 * 过载提示 —— **橙色**，讲的是「行程质量问题」。
 *
 * ## 与灰色降级条的分工（这条是红线）
 * - 橙（本组件）→ 排太满 / 单段太长 / 方式超距 → **用户改行程就能解决**
 * - 灰（`DegBar`）→ 额度用尽 / 存储不可用 / 链接失效 → 用户只能接受
 *
 * 混色会让人把"浏览器不让我存数据"读成"我的行程排错了"。
 *
 * ## 文案已经在 `overloadWarnings()` 里写定了
 * 那里统一是「陈述事实 + 给建议」，不用祈使句 —— 既然说好了顺序由用户定，
 * 就不能用"你应该…"把判断权夺回来。所以本组件**只负责排版，不改一个字**。
 */
export function OverloadWarnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null

  return (
    <div className="mt-1 px-3.5">
      {warnings.map((w) => (
        <div
          key={w}
          className="mb-1.5 flex items-start gap-2 rounded-lg border border-[#F5D3B8] bg-[#FFF7F0] px-3 py-2 text-[12px] leading-relaxed text-[#8A4B21]"
        >
          <Icon name="alert" size="sm" className="mt-0.5 flex-none" />
          <span>{w}</span>
        </div>
      ))}
    </div>
  )
}
