/**
 * 点位详情 —— **就地查看**（移动端形态）：底部浮层。
 *
 * ## 它和 `routes/poi.tsx`（详情页）、`desktop/ui/PoiDetailOverlay` 的关系
 * 三者装的是**同一份内容**（`common/ui/city/PoiDetail` + `PoiLocation`），差别只有外壳。
 * 本组件是"点地图上的景点"这一条路在移动端的落点 —— **不换 URL**。
 *
 * ## 与城市页那张浮层怎么共存
 * 移动端屏幕放不下两块浮层，所以**选中点位时这一张顶替列表那张**（`mobile/ui/CityView`
 * 里做的是"选中 → 详情 / 未选中 → 列表"的切换）。出口有两个：**点浮层外面**、
 * **往下拉过阈值**（2026-10-27 用户定：「点浮窗之外的界面自动隐藏，或者往下拉到
 * 一定程度也自动隐藏」），关掉就回到列表。
 *
 * ## ★ 「添加行程」为什么在标题右侧，而不是底部一整条
 * 用户 2026-10-27 原话：「添加行程按钮不做单独的底部按钮，放到最顶上的标题右侧」。
 * 底部那条按钮要占掉 56px 高度、还要和浮层的安全区抢位置，而它的位置本来就在
 * 一屏之内 —— 提到标题行之后，正文整块多出 56px，读完不用滚。
 * ★ 同时**不再给关闭按钮**：收起的出口是"下拉 / 点外面"，与原生 App 一致
 *   （用户：「关闭按钮可以不需要」）。键盘用户走 Esc，见 `useSheetDrag`。
 *
 * ★ 位置与交通砌在 `PoiDetail` 的正文末尾（**两端同一份实现**）。
 * ★ 换点位要复位 `gallery` / 溯源展开（理由见 `desktop/ui/PoiDetailOverlay` 文件头第 3 条）。
 */

import { useEffect, useState } from 'react'

import { Icon } from '~/common/ui/Icon'
import { addToPlanLabel, useCurrentPlanForCity } from '~/common/logic/useAddToPlan'
import { PoiDetail } from '~/common/ui/city/PoiDetail'
import { Sheet, SheetHead, type SheetTier } from '~/mobile/ui/Sheet'
import { useSheetClaim } from '~/mobile/ui/sheetHub'
import type { Poi } from '~shared/schema'

export function PoiDetailSheet({
  poi,
  cityName,
  cityId,
  onClose,
  onAddToPlan,
}: {
  /** `null` = 没选中 → 不渲染 */
  poi: Poi | null
  cityName: string
  /** 这个景点属于哪座城 —— 「添加行程」按钮靠它判断"是不是正在看这座城的规划" */
  cityId: string
  onClose: () => void
  onAddToPlan: (id: string) => void
}) {
  const [tier, setTier] = useState<SheetTier>('half')
  const [gallery, setGallery] = useState(0)
  const [showSources, setShowSources] = useState(false)
  const poiId = poi?.id ?? ''
  /** 同 `PoiDetailOverlay`：在 early return 之前调（hooks 不能被条件跳过） */
  const addLabel = addToPlanLabel(useCurrentPlanForCity(cityId))

  useEffect(() => {
    setGallery(0)
    setShowSources(false)
  }, [poiId])

  // 占据浮层位：把还开着的规划 / 图层关掉（用户：「不要隐藏一个下方还有一个」）
  // ★ 必须在 early return **之前**调 —— hooks 不能被条件跳过
  useSheetClaim('detail', onClose, Boolean(poiId))

  if (!poi) return null

  return (
    <Sheet
      tier={tier}
      onTier={setTier}
      label="景点详情"
      onClose={onClose}
      header={
        <SheetHead
          title={poi.name}
          sub={poi.location.address}
          action={
            <button
              type="button"
              onClick={() => onAddToPlan(poi.id)}
              aria-label={addLabel}
              className="inline-flex h-8 items-center gap-1 rounded-full bg-primary px-2.5 text-[12.5px] font-medium whitespace-nowrap text-white active:opacity-90"
            >
              <Icon name="plus" size="sm" />
              {addLabel}
            </button>
          }
        />
      }
    >
      <PoiDetail
        poi={poi}
        cityName={cityName}
        gallery={gallery}
        onGallery={setGallery}
        showSources={showSources}
        onToggleSources={() => setShowSources((v) => !v)}
        hideName
      />
    </Sheet>
  )
}
