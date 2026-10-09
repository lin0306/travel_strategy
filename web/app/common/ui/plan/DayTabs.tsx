/**
 * 行程里的**天数标签栏**（plans/13 §6.10，2026-09-27 扩写）。
 *
 * ## 它管四件事
 * | 动作 | 结果 |
 * |------|------|
 * | 点标签 | **切到那一天**（`onActivate`）—— 内容区只渲染当前这一天（见 §6.11） |
 * | 拖标签 | 换天数的前后顺序，**那一天的明细跟着走**（`onMove` → `moveDay`） |
 * | 标签上的 ✕ | **删掉这一天连同它的景点**（先出内联确认条；用户 2026-09-27 定） |
 * | 末尾的 ＋ | 往后加一天（`onAdd`） |
 *
 * ## 为什么"删一天"要二次确认，而且确认条是**内联**的
 * 它连同明细一起删 —— 误点一下就是"我的第 3 天没了"（用户原话：
 * 「连景点一起删掉，但是要有提示」）。确认条直接长在标签栏下面，而不是再开一块浮层：
 * 动作的范围就在这一条栏上，让确认出现在**动作发生的地方**，用户不用在两张卡片之间对账。
 * （确认条上的条数只在这里出现，见下。）
 *
 * ## 小橙点是干什么的
 * 它标在**住宿段发生变化的那一天** —— 也就是"今天换酒店了"。
 * 多住宿段是行程里最容易忘、也最影响时间计算的一件事（换了住宿点，
 * 当天首末两段时长全变），所以必须有个不靠文字就能看见的标记。
 * 判据是 `stayId` 与前一天不同，不是"这个 stay 的 fromDay 是几" ——
 * 后者在有多个住宿段时会漏。
 *
 * ## ★ 标签上**不显示条数**（2026-09-27 用户定）
 * 上一版每个标签跟着一个很淡的明细条数，用来暴露"空天在列表里看不见"造成的静默不一致。
 * 用户看过之后要求去掉：「那个第 n 天的标签，那个**景点数**，不需要显示」——
 * 这版内容区**只显示当前一天**，切换过去就能看见有没有安排，
 * 条数既占地方又让标签变吵，所以撤掉。★ 顺带：这也避免了"**绝不显示 0**"（红线 10）
 * 那种需要特意绕开的写法 —— 不显示数字，就不存在 0 写不写的问题。
 * （内联确认条里那句「及其 N 个景点」保留：那不是常态信息，是"你确定吗"的范围说明。）
 *
 * ## 拖拽为什么把 `draggable` 挂在整颗标签上
 * 挂在里面那个小按钮上的话，用户得精确抓按钮才拖得动。整颗标签可拖、里面两个按钮
 * 各自正常响应点击 —— 这是"拖"和"点"在同一块区域共存的标准做法
 * （`draggable` 只在按住并移动时才生效，单击不会触发拖拽）。
 */

import { useState } from 'react'

import { Icon } from '~/common/ui/Icon'
import { useDragSort } from '~/common/ui/plan/useDragSort'
import type { ItineraryDay } from '~shared/schema'

export function DayTabs({
  days,
  activeDay,
  onActivate,
  onAdd,
  onRemove,
  onMove,
}: {
  days: ItineraryDay[]
  /** 当前天（1 起）—— 决定高亮，也决定内容区渲染哪一天 */
  activeDay: number
  onActivate: (day: number) => void
  onAdd: () => void
  /** 连那天的明细一起删（语义见文件头） */
  onRemove: (day: number) => void
  /** `from` / `to` 都是**天序号**（1 起） */
  onMove: (from: number, to: number) => void
}) {
  /** 待确认删掉的那一天（null = 没有确认条） */
  const [pending, setPending] = useState<number | null>(null)
  /** 拖拽用**下标**（0 起），换到 store 之前 +1 */
  const drag = useDragSort((from, to) => {
    setPending(null)
    onMove(from + 1, to + 1)
  })

  const pendingCount = pending === null ? 0 : (days[pending - 1]?.items.length ?? 0)

  return (
    <div className="flex-none border-b border-line">
      <div className="flex items-center gap-1.5 overflow-x-auto px-3 py-2">
        {days.map((d, i) => {
          const day = i + 1
          const on = day === activeDay
          const dragging = drag.dragging === i
          const isOver = drag.over === i && !dragging
          const stayChanged = i > 0 && d.stayId !== days[i - 1]?.stayId
          return (
            <div
              key={i}
              {...drag.bind(i)}
              className={`relative flex flex-none items-center rounded-full border py-0.5 pr-0.5 pl-2.5 text-[12px] ${
                on ? 'border-primary text-primary' : 'border-line text-ink-2'
              } ${dragging ? 'opacity-40' : ''} ${isOver ? 'border-dashed border-primary' : ''}`}
            >
              <button type="button" onClick={() => onActivate(day)} className="cursor-pointer py-0.5">
                第 {day} 天
              </button>
              {/* ★ 这里**不放条数**（用户 2026-09-27 定，理由见文件头） */}
              <button
                type="button"
                aria-label={`删掉第 ${day} 天`}
                onClick={() => setPending(day)}
                className="ml-1 inline-flex size-5 flex-none items-center justify-center rounded-full text-ink-2/60 hover:bg-line hover:text-ink"
              >
                <Icon name="close" size="sm" />
              </button>
              {/* 今天换酒店了 */}
              {stayChanged ? (
                <i aria-hidden="true" className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary" />
              ) : null}
            </div>
          )
        })}
        <button
          type="button"
          aria-label="加一天"
          onClick={onAdd}
          className="inline-flex size-6 flex-none items-center justify-center rounded-full border border-dashed border-line text-ink-2 hover:border-primary hover:text-primary"
        >
          <Icon name="plus" size="sm" />
        </button>
      </div>

      {/* 内联确认条：删除范围大（连带明细），所以必须问一句 */}
      {pending !== null ? (
        <div className="flex items-center gap-2 border-t border-line bg-line-2 px-3 py-2">
          <span className="min-w-0 flex-1 text-[11.5px] leading-relaxed">
            删掉「第 {pending} 天」
            {pendingCount > 0 ? `及其 ${pendingCount} 个景点` : ''}？
          </span>
          <button
            type="button"
            aria-label="取消删天"
            onClick={() => setPending(null)}
            className="inline-flex h-7 flex-none items-center rounded-md border border-line bg-surface px-2 text-[11.5px] hover:bg-line-2"
          >
            取消
          </button>
          <button
            type="button"
            aria-label="确认删天"
            onClick={() => {
              onRemove(pending)
              setPending(null)
            }}
            className="inline-flex h-7 flex-none items-center rounded-md bg-red-600 px-2 text-[11.5px] text-white hover:bg-red-700"
          >
            删掉
          </button>
        </div>
      ) : null}
    </div>
  )
}
