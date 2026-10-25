/**
 * 点位详情 —— **就地查看**（移动端形态）：底部 Sheet。
 *
 * ## 它和 `routes/poi.tsx`（详情页）、`desktop/ui/PoiDetailOverlay` 的关系
 * 三者装的是**同一份内容**（`common/ui/city/PoiDetail` + `PoiLocation`），差别只有外壳。
 * 本组件是"点地图上的景点"这一条路在移动端的落点 —— **不换 URL**（见文件头下方的用户原话）。
 *
 * ## 与城市页那张 Sheet 怎么共存
 * 移动端屏幕放不下两块抽屉，所以**选中点位时这一张顶替列表那张**（`mobile/ui/CityView`
 * 里做的是"选中 → 详情 / 未选中 → 列表"的切换）。出口是页脚的「关闭」，关掉就回到列表。
 *
 * ★ 位置与交通砌在 `PoiDetail` 的正文末尾（**两端同一份实现**，桌面原来那套
 *   独立的 300px 位置卡已删）—— 这里不再单独拼一段。
 * ★ 换点位要复位 `gallery` / 溯源展开（理由见 `desktop/ui/PoiDetailOverlay` 文件头第 3 条）。
 */

import { useEffect, useState } from 'react'

import { Icon } from '~/common/ui/Icon'
import { addToPlanLabel, useCurrentPlanForCity } from '~/common/logic/useAddToPlan'
import { PoiDetail } from '~/common/ui/city/PoiDetail'
import { Sheet, SheetHead, type SheetTier } from '~/mobile/ui/Sheet'
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

  if (!poi) return null

  return (
    <Sheet
      tier={tier}
      onTier={setTier}
      header={<SheetHead title={poi.name} sub={poi.location.address} />}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line text-[14.5px] md:h-9 md:text-[13px]"
          >
            <Icon name="close" size="sm" />
            关闭
          </button>
          <button
            type="button"
            onClick={() => onAddToPlan(poi.id)}
            className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary text-[14.5px] font-medium text-white md:h-9 md:text-[13px]"
          >
            <Icon name="plus" size="sm" />
            {addLabel}
          </button>
        </>
      }
    >
      <PoiDetail
        poi={poi}
        cityName={cityName}
        gallery={gallery}
        onGallery={setGallery}
        showSources={showSources}
        onToggleSources={() => setShowSources((v) => !v)}
      />
    </Sheet>
  )
}
