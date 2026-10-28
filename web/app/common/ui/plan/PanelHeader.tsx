/**
 * 路线规划面板的**顶部条**（两态共用同一根高度，切换时不跳）。
 *
 * ## 为什么单开一个文件
 * 列表态与详情态**各有一份**（标题不同、右侧动作不同），两份都长在各自的视图文件里
 * 就等于同一根 52px 的条被实现两遍 —— 高度、内边距、关闭按钮的位置迟早会漂。
 *
 * ## 「新建组」**永远可点**（2026-09-26 用户定）
 * > 用户原话：「新建组为什么是不可点击的，这个应该是不管什么情况下都能点击才对」
 *
 * 原来有两处禁用，各自的解法：
 * | 原来的禁用 | 现在 |
 * |---|---|
 * | **没有城市上下文**（首页 / 省级页） | 允许先建一条「**城市未定**」的组，**由它的第一条明细认领城市**。判据在 `planStore.update`。因为"我在哪座城"完全可以等加第一个景点时再定，不该由按钮逼用户现在决定 |
 * | **正在新建**（草稿行开着） | 不新建第二条，改成**把草稿输入框重新整段选中** —— 有反应，且不丢已经打进去的名字 |
 *
 * ## ★★ 移动端形态（2026-10-28 用户定）
 * 原话：「路线规划的这个浮窗，新建规划按钮和景点那个保持统一，关闭按钮也去掉」。
 * | | 桌面 | 移动 |
 * |---|---|---|
 * | 「新建规划」 | 描边小按钮（面板里众多动作之一，不该最响） | **主色胶囊**，与景点详情的「添加行程」同一套（`h-8 rounded-full bg-primary`） |
 * | 「关闭」 | 保留（桌面的浮层没有下拉手势，它是唯一出口） | **不渲染** —— 三档浮层可以下拉收起、也可以点外面收起 |
 *
 * ★ 判据走 `useIsMobile()` 而不是传 prop：两态（列表/详情）在移动端与桌面端各自渲染，
 *   多一个必须记得传的 prop，就等于多一处会忘的地方。
 */

import { useIsMobile } from '~/common/logic/useViewport'
import { Icon } from '~/common/ui/Icon'
import type { ReactNode } from 'react'

/** 顶部条：标题 + 新建规划 + 关闭。两态共用同一根高度，切换时不跳 */
export function PanelHeader({
  title,
  onBack,
  onCreate,
  right,
  onClose,
}: {
  title: string
  onBack?: () => void
  onCreate?: () => void
  right?: ReactNode
  onClose: () => void
}) {
  const mobile = useIsMobile()

  return (
    <div className="flex flex-none items-center gap-1.5 border-b border-line px-3 py-2.5">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label="返回组列表"
          className="-ml-1 inline-flex size-7 flex-none items-center justify-center rounded-md text-ink-2 hover:bg-line-2 hover:text-ink"
        >
          <Icon name="back" size="sm" />
        </button>
      ) : null}
      <b className="min-w-0 flex-1 truncate text-[14px] font-semibold">{title}</b>
      {right}
      {onCreate ? (
        <button
          type="button"
          onClick={onCreate}
          aria-label="新建规划"
          /*
           * 移动端用**主色胶囊**：它与景点详情的「添加行程」是同一类动作（"往计划里加东西"），
           * 在两个浮层里出现时长得一样，用户就不用认两回。
           * 桌面仍是描边 —— 那一端这一条只是列表里的众多动作之一，实心会把整块浮层喊哑
           * （用户 2026-09 反馈「有点突兀」）。
           */
          className={
            mobile
              ? 'inline-flex h-8 flex-none items-center gap-1 rounded-full bg-primary px-2.5 text-[12.5px] font-medium whitespace-nowrap text-white active:opacity-90'
              : 'inline-flex h-7 flex-none items-center gap-1 rounded-md border border-line px-2 text-[12px] text-ink hover:border-primary hover:text-primary'
          }
        >
          <Icon name="plus" size="sm" />
          新建规划
        </button>
      ) : null}
      {/* 移动端不给关闭键：三档浮层能下拉收起、也能点浮层外面收起（见文件头） */}
      {mobile ? null : (
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭路线规划面板"
          className="-mr-1 inline-flex size-7 flex-none items-center justify-center rounded-md text-ink-2 hover:bg-line-2 hover:text-ink"
        >
          <Icon name="close" size="sm" />
        </button>
      )}
    </div>
  )
}
