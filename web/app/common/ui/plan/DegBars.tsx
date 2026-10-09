/**
 * 行程页顶部的**降级提示条**（两端共用）—— 灰底，放在面板正文最前面。
 *
 * ★ 系统状态用**灰**（存储不可用 / 接口额度打满 / 分享链接解析失败），
 *   行程质量问题用**橙**（过载警告，见 `OverloadWarnings`）—— 混色会让人
 *   误判成"系统坏了"。这里三条都是系统状态，所以都是 `DegBar`。
 *
 * 三条的来源不同，但都必须**说出来**而不是静默降级：
 *   · 规划存储出错 → 否则用户关掉页面才发现改动没了
 *   · 额度打满   → 否则用户以为"公交查不到"是网站坏了
 *   · 链接解析失败 → 否则用户以为朋友发的行程是空的
 *
 * ★ 第一条 2026-09-26 换了来源：以前看的是 `localStorage` 能不能写
 *   （`store.persistAvailable`），现在行程落在 IndexedDB 的那条规划上，
 *   所以改看 `planStore.error` —— **看旧的那个标志位会永远不亮**（它已经删了）。
 */

import { DegBar } from '~/common/ui/plan/DegBar'
import { usePlanStore } from '~/common/logic/itinerary/planStore'
import { loadLedger, quotaExhaustedBanner } from '~/common/logic/itinerary/quotaLedger'
import type { ItineraryState } from '~/common/logic/itinerary/store'

export function DegBars({ store }: { store: ItineraryState }) {
  const planError = usePlanStore((s) => s.error)
  return (
    <>
      {planError ? <DegBar>{planError} · 建议先导出 JSON 备份</DegBar> : null}
      {(() => {
        const banner = quotaExhaustedBanner(loadLedger())
        return banner ? <DegBar>{banner}</DegBar> : null
      })()}
      {store.shareError ? (
        <DegBar>
          分享链接解析失败：{store.shareError} · 你仍然可以手动添加点位，或从 JSON 导入
        </DegBar>
      ) : null}
    </>
  )
}
