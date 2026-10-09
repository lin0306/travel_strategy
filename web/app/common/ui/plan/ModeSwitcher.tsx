import type { ReactNode } from 'react'

import { Icon, type IconName } from '~/common/ui/Icon'
import { PENDING_CLS, PICKED_BG_CLS, PICKED_CLS } from '~/common/ui/plan/tokens'
import { canCallRouteOptions } from '~/common/logic/itinerary/quotaLedger'
import { usingOwnKey } from '~/common/map/tencent'
import { MODE_META, TRAVEL_MODE_KEYS, type TravelMode } from '~shared/schema'

/**
 * 六方式切换条。
 *
 * ## 「六种方式」不等于「六个矩阵通道」
 * 构建期矩阵只有 **3 条通道**（驾车 / 步行 / 骑行）：
 * - **打车复用驾车**（同一通道，差别只在车费）
 * - **公交 / 地铁不走矩阵** —— 它们一对一且需要城市 code，只能运行时实时算
 *
 * 所以这个条里点「打车」，段时长和「驾车」一样是**对的**，不是 bug。
 *
 * ## 为什么不把超距的方式禁用
 * 灰掉并划线是给「这个方式到不了」一个可见的出口，但仍可点 ——
 * 点了会看到替代方式的**具体时长**（「骑行 41 分」），而不是一句"建议换方式"。
 * 一个点了完全没反应的灰按钮，比一个给出了具体数字的按钮差得多。
 *
 * ## 切回查过的方式**不会重新拉取**
 * 每段的方案是按 `uid|方式|偏好` 缓存的（见 `routeOptionKey`），
 * 所以来回切换时**已查过的组合直接命中缓存**，只有没查过的才会真的发请求 ——
 * 这一条的代价是"配额按组合消耗"，收益是"随手比一比不心疼"。
 */
export function ModeSwitcher({
  current,
  onPick,
  note,
}: {
  /** `null` = **这一段还没选过方式** —— 六个按钮就都不高亮（默认不预设，见 `LegRow` 文件头） */
  current: TravelMode | null
  onPick: (m: TravelMode) => void
  /**
   * 替换默认那句说明。
   * ★ 整条规划的"方式"与"某一段的方式"影响面完全不同（前者会让整条折线作废，
   *   后者只改一段时长），所以那句话必须由调用方给 —— 用同一句会让用户
   *   以为换了方式也不用重算。
   */
  note?: ReactNode
}) {
  const routeQuota = canCallRouteOptions(usingOwnKey())

  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {TRAVEL_MODE_KEYS.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onPick(m)}
          aria-pressed={m === current}
          className={`inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[11.5px] ${
            /**
             * ★ 选中靠**底色**与未选中对开 —— 只差一个边框色的话，
             *   浅蓝未选 / 主蓝选中在一排按钮里"看起来差不多"（用户 2026-10-05 报的）。
             */
            m === current ? `${PICKED_CLS} ${PICKED_BG_CLS}` : PENDING_CLS
          }`}
        >
          <Icon name={(MODE_META[m].ico as IconName) ?? 'route'} size="sm" />
          {MODE_META[m].label}
        </button>
      ))}
      <span className="w-full text-[10.5px] leading-relaxed text-ink-2">
        {note ?? '换一种方式会重新查这一段的路线 —— 同一种方式通常有好几条可选。'}
        {!routeQuota.allowed && routeQuota.reason ? ` ${routeQuota.reason}` : ''}
      </span>
    </div>
  )
}
