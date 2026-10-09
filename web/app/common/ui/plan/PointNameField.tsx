/**
 * 行程时间线里「地图取点」那一行的**名字** —— 两态（plans/13 §6.11 那一节）。
 *
 * ```
 * 平时：      地图取点 ✎            ← 名字 + 编辑图标
 * 在编辑：    [地图取点      ] ✓     ← 输入框 + 保存
 * ```
 *
 * ## ★ 输入框什么时候出现（2026-09-28 用户定，第二轮）
 * > 「点了勾选图标，**没有任何反应**啊，应该是点完勾选图标，就不显示输入框和勾选了，
 * >   直接显示名字，然后名字右侧显示一个**编辑图标**，点编辑图标，再次打开修改，
 * >   这个输入框显示，**只有第一次在地图上选点，就显示输入框，刷新之后就不显示了**，
 * >   还有就是点编辑图标，才显示，刷新之后也不显示了」
 *
 * | 时机 | 形态 |
 * |------|------|
 * | 刚在地图上落下一个点（**本次会话**） | 输入框（`planUi.freshPoint` 指着它） |
 * | 点了名字右边的 ✎ | 输入框（并且**接管键盘**：自动聚焦 + 整段选中） |
 * | 点 ✓ —— **无论有没有改动** | 收起成「名字 + ✎」 |
 * | `Esc` | 放弃改动，同样收起 |
 * | 刷新页面 / 换到别的天再回来 | 「名字 + ✎」 |
 *
 * ★★ **"刚落下"是会话态，不是数据**：它住在 `planUi.freshPoint`（内存，不落盘）。
 *   若把它写进 `DayItem`，刷新之后输入框还会自己弹出来 —— 与用户的要求正好相反。
 * ★★ **点 ✓ 一定要有可见的变化**：它的职责是**收起**（写库只是顺带）。
 *   上一版点 ✓ 时"没改动就什么也不做"，于是用户读到的是"点了没有任何反应"。
 *   所以那个按钮**不许 `disabled`**（护栏 Y⑮），勾空也照样能点（空 ⇒ 回落默认名）。
 */

import { useEffect, useRef, useState } from 'react'

import { usePlanUi } from '~/common/logic/itinerary/planUi'
import { DEFAULT_POINT_NAME } from '~/common/logic/itinerary/planStops'
import { Icon } from '~/common/ui/Icon'

export function PointNameField({
  uid,
  name,
  onCommit,
  onFocus,
}: {
  /** 这一站的 `uid` —— 用它认"是不是刚落到图上的那一个" */
  uid: string
  /** 当前名字（库里没有名字时 `flattenStops` 已经回落成默认名） */
  name: string
  /** 改名的唯一出口（写库在调用方那里走 `store.renameItem`） */
  onCommit: (name: string) => void
  /**
   * 点名字 → 地图上居中放大。
   *
   * ★★ 用户 2026-10-04：「景点的名字点了地图会放大并偏移，**取点的数据的名字点了
   *   没有任何反应**，得保持统一才对」。
   *   原因：景点那一行渲的是 `<button onClick={onFocus}>`，而地图取点走的是本组件
   *   —— 它的名字原来是个**纯 `<span>`**，压根没有点击这回事。
   *   ⇒ 补一个 `onFocus` 让两边行为一致（可改名的能力由旁边的 ✎ 承担，不冲突）。
   */
  onFocus?: () => void
}) {
  /** 刚落到图上的那一行（一次只有一个，见文件头） */
  const fresh = usePlanUi((s) => s.freshPoint === uid)
  const setFreshPoint = usePlanUi((s) => s.setFreshPoint)
  /** 本行自己打开的编辑态（点 ✎ 时置位） */
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const [v, setV] = useState(name)
  /**
   * **本地基线**（已提交的值）。
   * ★ 不能拿 props 的 `name` 当基线：提交后它要等"写库 → 重算 stops → 新 props"
   *   绕一圈才回来，中间那几帧勾一直是"有改动"的亮色（看着像"没保存成功"）。
   *   提交时先把基线对齐，外部值到货后再由下面的 effect 校正。
   */
  const [base, setBase] = useState(name)
  // 换天 / 换规划 / 别处改了名 → 跟着走（否则输入框里留着上一条的旧名字）
  useEffect(() => {
    setV(name)
    setBase(name)
  }, [name])

  /**
   * 点 ✎ 打开时**接管键盘**：自动聚焦 + 整段选中。
   * ★ 整段选中是"新建文件夹"那一套手感（见 `PlanRow.DraftRow`）—— 一打字就整段替换，
   *   而不是在老名字中间插进一个字符。
   * ★ 只在**点 ✎**时做：刚落到图上的那一行不抢焦点（用户可能接着去地图上点下一个地方）。
   */
  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  const open = fresh || editing
  /** 真正要保存的名字：**空输入归一到默认名**（见文件头） */
  const next = v.trim() || DEFAULT_POINT_NAME
  const changed = next !== base

  /** 收起输入框。★ "刚落下"的标记一并清掉 —— 否则下次回到这一天它又会自己弹开 */
  function close() {
    setEditing(false)
    if (fresh) setFreshPoint(null)
  }

  function commit() {
    // 归一的结果要**看得见**（清尾空格 / 清空回到默认名）—— 否则就是"点了没反应"
    setV(next)
    if (changed) {
      onCommit(next)
      setBase(next)
    }
    close()
  }

  function cancel() {
    setV(name)
    close()
  }

  if (!open) {
    return (
      <span className="flex min-w-0 items-center gap-1">
        {/*
         * ★ 名字是**可点的**（与景点那一行同一个行为）：点它把地图居中放大。
         *   没传 `onFocus` 时退回纯文本 —— 那种调用方（如果有）不该假装能点。
         */}
        {onFocus ? (
          <button
            type="button"
            onClick={onFocus}
            aria-label={`在地图上查看「${name}」`}
            className="max-w-full cursor-pointer truncate text-left text-[13px] font-medium hover:text-primary hover:underline"
          >
            {name}
          </button>
        ) : (
          <span className="truncate text-[13px] font-medium">{name}</span>
        )}
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label="改这一站的名字"
          className="inline-flex size-5 flex-none items-center justify-center rounded text-ink-2/70 hover:bg-line-2 hover:text-primary"
        >
          <Icon name="pencil" size="sm" />
        </button>
      </span>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <input
        ref={inputRef}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          // 输入框里的 Esc / Enter 自己用掉（别让外壳的 Esc 把面板也关了）
          e.stopPropagation()
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') cancel()
        }}
        // 行本身是可拖拽的（换序）—— 别让输入框里的按下/拖动变成"拖这一行"
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        aria-label="这一站的名字"
        placeholder={DEFAULT_POINT_NAME}
        className="h-6 min-w-0 flex-1 rounded border border-line bg-surface px-1.5 text-[12.5px] outline-none focus:border-primary"
      />
      {/*
       * ★ **没有 `disabled`**（护栏 Y⑮）：它的职责是"收起"，所以点下去**一定有反应**。
       *   弱/强两级只用颜色表达：没改动 = 次级图标色（与右边 ✕ 同色），改过了 = 主色。
       */}
      <button
        type="button"
        onClick={commit}
        aria-label="保存这一站的名字"
        className={`inline-flex size-6 flex-none items-center justify-center rounded-md hover:bg-line-2 ${
          changed ? 'text-primary' : 'text-ink-2'
        }`}
      >
        <Icon name="check" size="sm" />
      </button>
    </div>
  )
}
