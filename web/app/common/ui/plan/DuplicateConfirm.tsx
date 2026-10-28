/**
 * 「这一站已经在里面了，还要再加吗？」确认卡。
 *
 * ## 为什么要拦一下（plans/13 §6.5d）
 * 用户在两个地方翻景点、或点两次「添加行程」时，很容易把同一个点排进同一条组里。
 * 加了两次的后果**不是"多一份"这么轻**：路线会绕回去（A→B→C→A→B），
 * 距离与时间都被算成两倍 —— 而排出来的行程看着完全正常，没人会怀疑。
 *
 * ## 为什么是"问一句"，两头都不许静默
 * | 做法 | 后果 |
 * |------|------|
 * | 静默拒绝 | 重复点**有时候是故意的**（同一个地方去两次：白天看展、晚上看灯） ⇒ 用户没法表达"我就要两次" |
 * | 静默添加 | 用户永远不会发现自己的路线被自己排成了一个圈 |
 * ⇒ 只有"问一句"两边都成立。**默认焦点落在「取消」**上（回车不会误加）。
 *
 * ## 门 / 内容分家（同 `AddToPlanPicker` 与 `MobileRoutePlanPanel`）
 * 它挂在外壳上、常年存在，靠"没有 payload 就 `return null`"表示关着 ——
 * 而 `return null` 只是不渲染内容，**组件实例还在**。所以状态必须住在会卸载的那一层。
 * 静态判据是 `check_app` 的 **AF**；行为判据是验收探针的 ⑧‴ 段。
 */

import { usePlanUi, type DupConfirmPayload } from '~/common/logic/itinerary/planUi'
import { appendStopWithToast } from '~/common/logic/useAddToPlan'
import { Icon } from '~/common/ui/Icon'
import { useDismiss } from '~/common/ui/useDismiss'

/** 门：只负责"开不开"，**不持有任何状态** */
export function DuplicateConfirm() {
  const dup = usePlanUi((s) => s.dupConfirm)
  if (!dup) return null
  return <ConfirmBody dup={dup} />
}

/** 内容：每次打开都是**全新实例** */
function ConfirmBody({ dup }: { dup: DupConfirmPayload }) {
  const close = usePlanUi((s) => s.closeDupConfirm)

  /**
   * 「取消」= **我换个落点** ⇒ 把「加到哪个组」弹窗**还回去**。
   *
   * ★ 用户报的：「这个重复添加景点弹窗，关闭后，原本显示的行程规划弹窗，不显示了」。
   *   原因是选组弹窗在"选定某个组"那一刻就关了（它把活交给这张卡），
   *   于是取消之后屏幕上**一个浮层都不剩**。而用户说的"取消"是"换个地方放"，
   *   不是"这趟算了" —— 所以用同一个 `stop` 把弹窗重新开出来，续上他上一步。
   *   （弹窗会以**默认收起**的全新状态出现，这也正是"重新挑一次"该有的样子。）
   */
  function back() {
    close()
    usePlanUi.getState().openAddPicker(dup.stop)
  }

  /** 点外面 = 同一件事（用户就是想离开这张卡） */
  const wrapRef = useDismiss(true, back, { esc: false })

  /** 「仍然添加」—— 唯一的、**刻意绕过校验**的写入口（这是用户明确要的重复） */
  async function confirm() {
    close()
    await appendStopWithToast(dup.planId, dup.stop)
  }

  return (
    /* ★ `z-[31]`：必须压住右下角工具条（`z-[29]`）—— 它是一块**等用户选**的模态，
       被四枚图标盖住一角就等于少一个选项（两者原来同为 29，靠 DOM 顺序侥幸没撞上）。 */
    <div className="pointer-events-none absolute inset-0 z-[31] flex items-center justify-center">
      <div
        ref={wrapRef}
        role="dialog"
        aria-modal="false"
        aria-label="重复添加确认"
        className="flt flt-in pointer-events-auto w-[min(320px,88vw)] overflow-hidden"
      >
        <div className="flex items-start gap-2 px-3.5 pt-3 pb-2">
          <Icon name="alert" size="sm" className="mt-0.5 flex-none text-primary" />
          <b className="min-w-0 flex-1 text-[13.5px] leading-relaxed font-semibold">
            「{dup.stop.name}」已经在「{dup.planName}」里了
          </b>
        </div>
        <p className="m-0 px-3.5 pb-3 text-[12.5px] leading-relaxed text-ink-2">
          它现在是第 <b className="font-semibold text-ink">{dup.index}</b> 条明细。
          再加一次的话，路线会从这里折返回去，距离和用时都会变大。
          <br />
          如果就是要去两次（比如白天看展、晚上看灯），那就加。
        </p>

        <div className="flex gap-2 border-t border-line px-3.5 py-2.5">
          <button
            type="button"
            // ★ 默认焦点在「取消」：回车不该误加
            autoFocus
            onClick={back}
            className="inline-flex h-8 flex-1 items-center justify-center rounded-lg border border-line text-[12.5px] hover:bg-line-2"
          >
            换个落点
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            className="inline-flex h-8 flex-1 items-center justify-center rounded-lg bg-primary text-[12.5px] font-medium text-white hover:opacity-90"
          >
            仍然添加
          </button>
        </div>
      </div>
    </div>
  )
}
