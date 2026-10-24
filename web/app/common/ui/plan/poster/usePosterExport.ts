/**
 * 海报导出的按钮侧 hook —— **只导当前选中的那一天**（2026-10-17 用户定：
 * 「选的是哪一天，就导哪一天的」）。绘制在 `posterDraw`、编排在 `exportPosterFiles`。
 *
 * ## 按钮禁用规则（用户同日定：「这一天没有任何点位，导出按钮禁用；
 *    如果出行方式没选全，也禁用，不然数据不全」）
 * 1. 该天 `items` 为空 → 「这一天还没有点位」；
 * 2. 相邻两段只要有**一段没选出行方式** → 「还有 N 段没选出行方式」——
 *    `buildAdjacentLegs` 对没选方式的段**不产出**（2026-10-04 用户定：
 *    没选就不显示），海报上那段就没有时长/路径，数据不全 ⇒ 直接不让导。
 *    ★ 只判 `items[0..n-2]`：最后一点没有"下一段"。
 * 3. key 缺失不禁用（导出时才需要）—— 但 direction 拉不到会画直线并如实标注。
 *
 * ## ★★ 时长从哪来（2026-10-24 修）
 * 先取本段真实路线方案（`posterRoutes`：24h 缓存命中即零请求，否则真调 direction），
 * **只在拿不到方案时才退回 `resolveLegSync` 的矩阵 / 本地缓存 / 直线估算**。
 * 别把这条改回"只用 legCtx"—— `city.transit` 现在是恒 null（`data/` 里没有 transit.json），
 * 那样每段都会变成直线估算。
 *
 * ## 为什么抽成 hook（护栏 G：单文件 ≤420 行）
 * 导出逻辑与面板 UI 无关，只是被按钮触发；抽出来后组件里只剩一行。
 */

import { useMemo, useState } from 'react'

import { buildPoiIndex } from '~/common/logic/itinerary/matrix'
import { usePlanUi } from '~/common/logic/itinerary/planUi'
import { resolveWebServiceKey } from '~/common/map/tencent'
import type { City, RoutePlan } from '~shared/schema'
import type { ItineraryState } from '~/common/logic/itinerary/store'
import { exportDayPoster } from './exportPosterFiles'

export function usePosterExport(
  plan: RoutePlan | null,
  city: City | null,
  store: ItineraryState,
  activeDay: number,
): { busy: boolean; progress: string; disabledReason: string; run: () => void } {
  /** 是否导出中 */
  const [busy, setBusy] = useState(false)
  /** 详细进度（**进度行显示**，可能很长 —— 用户定：不进按钮，长文案会撑爆按钮） */
  const [progress, setProgress] = useState('')

  /** 禁用原因（空串 = 可导出）。随 activeDay 即时变化 */
  const disabledReason = useMemo(() => {
    if (!plan) return '还没有行程'
    const day = plan.days[activeDay - 1]
    if (!day || day.items.length === 0) return '这一天还没有点位'
    const missing = day.items.slice(0, -1).filter((it) => !it.modeToNext).length
    if (missing > 0) return `${missing} 段还没选出行方式`
    return ''
  }, [plan, activeDay])

  async function runInner(): Promise<void> {
    if (!plan || !city || busy || disabledReason) return
    setBusy(true)
    try {
      const matrix = city.transit ?? null
      const { filename, note } = await exportDayPoster({
        plan,
        city,
        dayNo: activeDay - 1,
        legCtx: {
          matrix,
          poiIndex: matrix ? buildPoiIndex(matrix) : new Map<string, number>(),
          getCached: (k) => store.legCache[k],
          defaultMode: store.defaultMode,
        },
        stays: store.stays,
        /**
         * 用户手选的方案 —— 海报据此用**他挑的那条**（几何 + 时长都取自它）。
         * 这也是海报不必走 `LegContext.getOverride` 的原因：那条只带时长、不带几何。
         */
        chosenOption: store.chosenOption,
        webKey: resolveWebServiceKey() ?? '',
        amapKey: import.meta.env.VITE_AMAP_WEB_KEY ?? '',
        onProgress: (text) => setProgress(text),
      })
      // ★ 底图失败原因必须上 UI（用户「控制台日志看不到」—— 不能只打 console）
      usePlanUi.getState().showToast(note ? `已导出 ${filename}（${note}）` : `已导出 ${filename}`)
    } catch (err) {
      console.error('[poster] 导出失败：', err)
      usePlanUi.getState().showToast('海报导出失败，请重试')
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  return {
    busy,
    progress,
    disabledReason,
    run: () => void runInner(),
  }
}
