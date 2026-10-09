/**
 * 列表里的**两种行**：已存在的组（`PlanRow`）与正在新建的草稿（`DraftRow`）。
 *
 * ## 为什么它们住一起、而不跟列表住一起
 * 两者是同一件事的两面（"这一行是一个组"，一种是已存的一条、一种是还没落库的草稿），
 * 而且共享同一套行内边距与字号。`PlanListView` 那边只留"列表怎么排、空态怎么说"。
 * 单文件 420 行的上限也是这么来的 —— 三个东西挤一个文件时，`PlanListView` 到了 490 行。
 *
 * ## 「新建组」= **新建文件夹**（2026-09-26 用户定）
 * 用户的原话：「点新建，在列表头部插入一条数据，显示输入框，名字默认是你现在这个，
 * 右侧有个勾的图标，点击保存名字，可以在输入框里修改名字」。
 * 差别不只是手感：旧做法在**你还没想好叫什么的时候就已经往库里写了一条**，
 * 于是一个"点错了/想了想又不想要了"的名单，每点一次都会多出一个「成都 · 未命名」。
 *
 * 三条交互约定（与文件管理器一致）在 `DraftRow` 的注释里。
 */

import { useEffect, useRef, useState } from 'react'

import { fmtAgo, fmtDistance, fmtDuration } from '~/common/data/format'
import { usePlanStore } from '~/common/logic/itinerary/planStore'
import { openPlanDetail, usePlanUi } from '~/common/logic/itinerary/planUi'
import { planStopCount } from '~/common/logic/itinerary/planStops'
import { Icon } from '~/common/ui/Icon'
import { useDismiss } from '~/common/ui/useDismiss'
import type { RoutePlan } from '~shared/schema'

/** 一行**组**（已存的一条）。展开的 ⋯ 菜单在 `PlanRowMenu` 里 */
export function PlanRow({
  plan,
  cityName,
  renaming,
  onStartRename,
  onEndRename,
}: {
  plan: RoutePlan
  cityName: string
  renaming: boolean
  onStartRename: () => void
  onEndRename: () => void
}) {
  const update = usePlanStore((s) => s.update)
  const duplicate = usePlanStore((s) => s.duplicate)
  const remove = usePlanStore((s) => s.remove)
  const showToast = usePlanUi((s) => s.showToast)
  const [menu, setMenu] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [draft, setDraft] = useState(plan.name)
  const wrapRef = useDismiss(menu, () => {
    setMenu(false)
    setConfirming(false)
  })

  const n = planStopCount(plan)
  const route = plan.route

  async function commitRename() {
    onEndRename()
    const next = draft.trim()
    if (!next || next === plan.name) return
    await update(plan.id, { name: next })
  }

  if (renaming) {
    return (
      <div className="px-3.5 py-2.5">
        <input
          // eslint-disable-next-line jsx-a11y/no-autofocus -- 用户刚点了「重命名」，焦点跟过去是意图本身
          autoFocus
          value={draft}
          aria-label="组名称"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commitRename()
            // Esc 放弃这次改名（`onBlur` 仍会跑一次，但 draft 已还原成原名 ⇒ 是空操作）
            if (e.key === 'Escape') {
              setDraft(plan.name)
              onEndRename()
            }
          }}
          className="h-8 w-full rounded-md border border-primary bg-surface px-2 text-[13px] outline-none"
        />
      </div>
    )
  }

  return (
    <div ref={wrapRef} className="group relative">
      <button
        type="button"
        onClick={() => openPlanDetail(plan.id)}
        className="flex w-full flex-col items-stretch gap-0.5 py-2.5 pr-9 pl-3.5 text-left hover:bg-line-2"
      >
        <span className="flex items-baseline gap-2">
          <b className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{plan.name}</b>
          <span className="flex-none text-[11px] text-ink-2">{fmtAgo(plan.updatedAt)}</span>
        </span>
        <span className="flex items-center gap-1 text-[11.5px] text-ink-2">
          <span className="truncate">
            {cityName} · {n} 条明细
            {route
              ? ` · ${fmtDistance(route.distance)} · ${fmtDuration(route.duration)}`
              : ' · 未规划路线'}
          </span>
        </span>
      </button>

      <button
        type="button"
        aria-label={`${plan.name} 的更多操作`}
        aria-expanded={menu}
        onClick={() => {
          setMenu((v) => !v)
          setConfirming(false)
        }}
        className="absolute top-2 right-2 inline-flex size-7 items-center justify-center rounded-md text-ink-2 hover:bg-line-2 hover:text-ink focus-visible:opacity-100"
      >
        <span aria-hidden="true" className="text-[15px] leading-none">
          ⋯
        </span>
      </button>

      {menu ? (
        <div
          role="menu"
          aria-label={`${plan.name} 的操作`}
          className="absolute top-8 right-2 z-10 w-[132px] overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-[var(--flt-shadow)]"
        >
          {confirming ? (
            <>
              <p className="m-0 px-3 py-1.5 text-[11.5px] text-ink-2">删掉这个组？</p>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  void remove(plan.id)
                  setMenu(false)
                  setConfirming(false)
                }}
                className="block w-full px-3 py-1.5 text-left text-[12.5px] font-medium hover:bg-line-2"
              >
                确认删除
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => setConfirming(false)}
                className="block w-full px-3 py-1.5 text-left text-[12.5px] hover:bg-line-2"
              >
                取消
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setDraft(plan.name)
                  setMenu(false)
                  onStartRename()
                }}
                className="block w-full px-3 py-1.5 text-left text-[12.5px] hover:bg-line-2"
              >
                重命名
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(false)
                  void duplicate(plan.id).then((p) => {
                    if (p) showToast(`已复制为「${p.name}」`, p.id)
                  })
                }}
                className="block w-full px-3 py-1.5 text-left text-[12.5px] hover:bg-line-2"
              >
                复制一份
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => setConfirming(true)}
                className="block w-full px-3 py-1.5 text-left text-[12.5px] hover:bg-line-2"
              >
                删除
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

/**
 * 「新建组」的**行内草稿行** —— 像"新建文件夹"那样：先在**列表头部插一行输入框**，
 * 名字默认是当前那个默认名，右侧一个 ✓ 保存。
 *
 * ## 为什么不沿用"点了就直接建 + 跳进详情"
 * 用户的原话：「新建组和新建文件夹的逻辑差不多，点新建，在列表头部插入一条数据，
 * 显示输入框，名字默认是你现在这个，右侧有个勾的图标，点击保存名字，
 * 可以在输入框里修改名字」。
 * 差别不只是手感：旧做法**在你还没想好叫什么的时候就已经往库里写了一条**，
 * 于是一个"点错了/想了想又不想要了"的名单，每点一次都会多出一个「成都 · 未命名」。
 *
 * ## 三条交互约定（与文件管理器一致）
 * | 动作 | 结果 |
 * |------|------|
 * | `Enter` / 点 ✓ | 保存 |
 * | `Esc` | **放弃**，草稿行消失，库里什么都没写 |
 * | **点到别处**（blur） | **什么都不做** —— 草稿留着，等你想好了点 ✓ |
 *
 * ★★ **blur 不许保存**（2026-09-26 用户反馈「怎么还是点新增直接就保存了」之后改的）。
 *   第一版抄了资源管理器的"点开别处就等于建好了"，但用户的原话是
 *   「右侧有个勾的图标，**点击保存名字**」—— 保存是**显式动作**。blur 保存的后果是：
 *   点完「新建组」随手点一下别处（哪怕只是想看看），一个「成都 · 未命名」就已经落库了，
 *   看起来完全就是"点一下就保存了"。而草稿留着没有任何代价：它不占库、不影响列表，
 *   `Esc` 或点 ✓ 都能收场。
 *
 * ★ 点 ✓ 时仍要 `onMouseDown` 阻止默认 —— 保住"焦点不跳走"这条（否则输入框会在
 *   点击的瞬间失焦，用户看到光标一闪）。父组件那边还有一道 `committingRef` 兜底重复提交。
 *
 * ★ 根节点是 `<div>` 不是 `<li>`：这个组件有**两个使用者** —— 列表面板（行要进 `<ul>`）
 *   与「加到哪个组」弹窗（那里没有列表语义）。外面套 `<li>` 是列表那一侧的事。
 */
export function DraftRow({
  value,
  onChange,
  onCommit,
  onCancel,
  className = 'flex items-center gap-1.5 bg-line-2 px-3 py-2',
  focusTick = 0,
  showCancel = false,
}: {
  value: string
  onChange: (v: string) => void
  onCommit: () => void
  onCancel: () => void
  /** 外层样式。默认是列表面板里那一行的padding/底色 */
  className?: string
  /** 递增这个数 = **把输入框重新整段选中**（"再点一次新建组"的反应，见 `PlanListView`） */
  focusTick?: number
  /** 显示「取消」（✕）。★ 弹窗里的草稿行要它 —— 那里没有 Esc 的明显入口，得给一个看得见的退路 */
  showCancel?: boolean
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  /*
   * 进入就**整段选中**默认名：与新建文件夹一致 —— 一打字就整段替换，
   * 而不是在最前面插一个字符（默认名是「成都 · 未命名」这种，保留它没意义）。
   */
  useEffect(() => {
    inputRef.current?.select()
  }, [focusTick])

  return (
    <div className={className}>
      <input
        ref={inputRef}
        value={value}
        aria-label="组名称"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onCommit()
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
        className="h-8 min-w-0 flex-1 rounded-md border border-primary bg-surface px-2 text-[13px] outline-none"
      />
      {showCancel ? (
        <button
          type="button"
          aria-label="取消新建"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onCancel}
          className="inline-flex size-8 flex-none items-center justify-center rounded-md text-ink-2 hover:bg-line hover:text-ink"
        >
          <Icon name="close" size="sm" />
        </button>
      ) : null}
      <button
        type="button"
        aria-label="保存组名称"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onCommit}
        className="inline-flex size-8 flex-none items-center justify-center rounded-md text-primary hover:bg-line"
      >
        <Icon name="check" size="sm" />
      </button>
    </div>
  )
}
