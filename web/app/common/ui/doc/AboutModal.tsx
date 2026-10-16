/**
 * 「关于」弹窗 —— 顶栏右上角那一枚打开的模态（内容见 `AboutContent`）。
 *
 * ## 为什么从"两个独立页面"改成"一个弹窗"（2026-09-29 用户第二轮）
 * > 「这两个感觉内容偏重复，整合一下，**不要跳页面**，也是用弹窗的形式」
 *
 * 第一版是 `/about` 与 `/credits` 两个整页。两页内容本来就重叠（行程隐私、图片外链、
 * 地图来源各说了两遍），而且**没有任何分享场景** —— 不会有人把"关于本站"发给别人。
 * 于是那两个 URL 的唯一价值就只剩"能被顶栏入口打开"，而顶栏入口现在改开弹窗。
 * ⇒ 内容合成一份（`AboutContent`），路由与预渲染列表里的两项一并删掉：
 *   **同一件事只留一处实现**，不会出现"改了弹窗、页面还是旧的"。
 *
 * ## 三个必须说清的实现决定
 * ① **挂在 `routes/map-shell.tsx` 的浮层区，不在 `TopBar` 内部** —— 顶栏是
 *    `anchor='top'` 的浮层，`flt-in` 入场动画用 transform，而**祖先带 transform 会让
 *    `fixed` 子元素相对该祖先定位**：模态会被关进 52px 高的顶栏里（这类 bug 不报错，
 *    只是"东西不见了"）。★ 顺带的好处：`ModalScrim` 用 `absolute` 就够了，
 *    不必再赌 `fixed` 会不会被祖先的 transform 吃掉。
 * ② **不带 `data-overlay`** —— 那条属性是给 `fitView` 算"地图可用区"用的。
 *    模态是**临时遮挡**（打开时用户在看文档、不在地图上），参与避让只会让下一次
 *    `fit` 把点位挤到一侧。★ 与"景点详情面板该不该避让"是两件事：那个是常驻面板。
 * ③ **门与内容分家**：`map-shell` 条件渲染本组件 ⇒ 关闭即卸载，折叠清单的展开态
 *    自然回到初始，不需要手写重置（AF 项那条纪律）。
 *
 * ## ★ 遮罩改为共用 `ModalScrim`（2026-10-16）
 * 原本这里是 `fixed` + 另写的一份 `bg-[rgba(16,24,40,0.3)]`，而 `AddToPlanPicker`
 * 压根没有遮罩 —— 用户报「部分弹窗没有遮罩」。现在三个决策型模态共用一块底板，
 * 色值（`rgba(16,24,40,0.34)`）与层级一致。`DuplicateConfirm` 是有意不加的那一个，
 * 理由见 `ModalScrim` 文件头的表。
 */

import { AboutContent } from '~/common/ui/doc/AboutContent'
import { Icon } from '~/common/ui/Icon'
import { ModalScrim } from '~/common/ui/ModalScrim'
import { useDismiss } from '~/common/ui/useDismiss'
import { useDocUi } from '~/common/logic/docUi'

export function AboutModal() {
  const closeAbout = useDocUi((s) => s.closeAbout)
  /**
   * 点卡片外面 / 按 `Esc` 关闭。
   * ★ `useDismiss` 的 ref 绑在**卡片**上（不是遮罩上）—— 遮罩在 ref 之外，
   *   所以"点遮罩"天然算"点外面"，不需要再挂一次 onClick。
   */
  const ref = useDismiss<HTMLDivElement>(true, closeAbout)

  return (
    <ModalScrim className="z-[40]">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="关于行迹"
        className="flt flt-in flex max-h-[86svh] w-full max-w-[640px] flex-col overflow-hidden"
      >
        {/* 头部固定不滚：长文滚到一半时，关闭按钮与"这是哪一页"都还在 */}
        <header className="flex flex-none items-start gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-[15px] font-semibold">关于行迹</h2>
            <p className="mt-0.5 mb-0 text-[11.5px] text-ink-2">
              数据规模 · 使用说明 · 内容与素材来源
            </p>
          </div>
          <button
            type="button"
            onClick={closeAbout}
            aria-label="关闭"
            className="inline-flex size-7 flex-none items-center justify-center rounded-md text-ink-2 hover:bg-line-2 hover:text-ink"
          >
            <Icon name="close" size="sm" />
          </button>
        </header>

        <div className="scroll min-h-0 flex-1 px-4 pt-1 pb-5">
          <AboutContent />
        </div>
      </div>
    </ModalScrim>
  )
}
