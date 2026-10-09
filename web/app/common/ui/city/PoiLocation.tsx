/**
 * 「位置与交通」内容块 —— **两端共用**，装配点只有一个。
 *
 * 它砌在 `PoiDetail` 的**正文末尾** —— 详情页与"就地详情"三处外壳都通过 `PoiDetail`
 * 拿到它，自己不再拼一份（这正是三块划分的用法：内容一份，外壳只摆壳）。
 *
 * ★ 桌面原来把它包进右侧 **300px 的独立浮层**（能单独收起）。用户看过之后说那块
 *   "不需要"（2026-09-23 晚）—— 同一条路上摆两块浮层 = 多一处遮挡 + **第二个出口**。
 *   判据：Y⑧（`PoiDetailOverlay` 的 `<Overlay` 恰好 1 个 · 全仓不得引用已删的
 *   `--panel-locate` · `PoiLocation` 只许在 `PoiDetail.tsx` 里出现）。
 */

import { Icon } from '~/common/ui/Icon'
import type { Poi } from '~shared/schema'

export function PoiLocation({ poi }: { poi: Poi }) {
  return (
    <>
      <div className="flex items-center gap-2">
        <Icon name="pin" size="sm" className="text-primary" />
        <b className="text-[13px] font-semibold">位置与交通</b>
      </div>
      <p className="mt-2 mb-0 text-[12.5px] leading-relaxed text-ink">
        {poi.location.address}
        {poi.location.district ? <span className="text-ink-2"> · {poi.location.district}</span> : null}
      </p>
      {poi.location.transportTip ? (
        <p className="mt-1.5 mb-0 text-[12px] leading-relaxed text-ink-2">
          {poi.location.transportTip}
        </p>
      ) : null}
    </>
  )
}
