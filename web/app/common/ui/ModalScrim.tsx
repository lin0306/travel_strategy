/**
 * 模态遮罩 —— 决策型弹窗的**共用**底板。
 *
 * ## ★ 为什么要抽出来（2026-10-16 用户报「部分弹窗没有遮罩」）
 * 改之前四个"弹窗"的遮罩是四份各写各的，而且**三种行为**：
 *
 * | 弹窗 | 改之前 | 判定 |
 * |------|--------|------|
 * | `AboutModal` | `fixed` + `bg-[rgba(16,24,40,0.3)]` | ✅ 模态，有遮罩 |
 * | `StayPicker` | `absolute` + `bg-black/30` | ✅ 有，但**定位与色值都不同** |
 * | `AddToPlanPicker` | `pointer-events-none`，**无背景** | ❌ 决策型却没遮罩 |
 * | `DuplicateConfirm` | `pointer-events-none`，**无背景** | ⚠️ **刻意不加**，见下 |
 *
 * `AddToPlanPicker` 那个漏得最不该：它问的是"加到哪个组"，是一个**必须先回答**
 * 的问题，屏幕上却没有任何"注意力被收拢"的暗示。
 *
 * ## ★ 为什么 `DuplicateConfirm` 仍然不加
 * 它是**轻量确认**（320px 一张小卡），点外面即关闭是它的一部分语义 ——
 * 给它加遮罩等于把"随手点掉"变成"必须点按钮或取消"。**那是有意保留的差异，不是漏项。**
 *
 * ## 为什么遮罩自己写定位、不复用 `Overlay`
 * `.flt` 的 `background: var(--color-surface)` 是**未分层**的 CSS，
 * 会盖过 Tailwind 的 `bg-black/30`（工具类在 `@layer` 里，优先级更低）——
 * 结果遮罩变成一块纯白浮层、什么都看不见。这个坑 `StayPicker` 文件头已经踩过一次。
 *
 * ## 色值与透明度
 * 用 `rgba(16,24,40,0.34)`：够暗到让弹窗跳出来，又不至于把地图压成一片死黑
 * —— 用户常在这类弹窗里**看着地图选点位**（`AddToPlanPicker` 的入口就来自地图），
 * 遮太黑就失去"参照"了。
 */

export function ModalScrim({
  children,
  className = '',
  align = 'center',
}: {
  children: React.ReactNode
  className?: string
  /** `center` = 居中（决策型）；`end` = 贴底（移动端「图层」这类"从下往上"的开关面板） */
  align?: 'center' | 'end'
}) {
  return (
    <div
      /*
       * ★ `data-sheet-keep`：告诉移动端底部浮层（`mobile/ui/useSheetDrag` 的
       *   "点外部收起"判定）**别把这一下算成点浮层外面**。
       *   典型场景：详情浮层里点「添加行程」→ 弹出「加到哪个规划」→ 用户点选一条，
       *   那一下落在遮罩上 ⇒ 没有这个标记的话详情浮层会**同时**被关掉，
       *   用户根本没机会看到加成功了没有。遮罩之上的东西都属于"浮层内部流程"。
       */
      data-sheet-keep=""
      // ★ `absolute` 而非 `fixed`：弹窗都挂在 `routes/map-shell.tsx` 的浮层区里，
      //   那里已是视口大小的定位祖先，`fixed` 反而会被祖先的 transform 关进某一层
      //   （`AboutModal` 文件头记过这个坑：顶栏带 transform，`fixed` 子元素会被关进 52px 里）。
      className={`absolute inset-0 z-[50] flex p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] sm:p-6 ${
        align === 'end' ? 'items-end justify-center' : 'items-center justify-center'
      } ${className}`}
      style={{ background: 'rgba(16,24,40,0.34)' }}
    >
      {children}
    </div>
  )
}