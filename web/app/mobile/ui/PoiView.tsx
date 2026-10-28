/**
 * 点位详情 · **移动端** 外壳 —— 底部 Sheet。
 *
 * ## ★ 这一端修复了一个真实缺陷
 * 拆分之前，点位详情页**两端共用一块 620px 的浮层**（`--panel-detail`），
 * 而移动端视口只有 375px 左右 —— 面板比屏幕还宽，右侧内容直接被切掉。
 * 城市页 / 省级页 / 行程页都有移动形态，只有这一页没有，所以它不是"设计选择"，
 * 是漏了。现在按同一种移动语言（底部 Sheet）补上。
 *
 * ## 与桌面版的差异
 * | | 桌面 | 移动 |
 * |---|---|---|
 * | 容器 | 620px 浮层（**一块**） | 底部 Sheet（正文一整块） |
 * | 位置与交通 | 砌在 `PoiDetail` 正文末尾 | 同左（**两端同一份实现**） |
 * | 顶栏动作 | 「添加行程」 | 「看点位」（添加行程挪到 Sheet 页脚，拇指够得着） |
 *
 * ★ 「位置与交通」原来这一端也在 `PoiDetail` 之外另拼了一段，2026-09-23 晚并进了
 *   `PoiDetail` 正文 —— 桌面那块独立的 300px 位置卡是同一天删的（用户：「右侧显示一个
 *   景点的简要信息，这个不需要」）。现在**装配点只有一个**，判据是 Y⑧。
 */

import { useState } from 'react'

import { addToPlanLabel, useCurrentPlanForCity } from '~/common/logic/useAddToPlan'
import { Icon } from '~/common/ui/Icon'
import { PoiDetail } from '~/common/ui/city/PoiDetail'
import { PoiMissing } from '~/common/ui/Missing'
import { Sheet, SheetHead, type SheetTier } from '~/mobile/ui/Sheet'
import { useSheetClaim } from '~/mobile/ui/sheetHub'
import { TopBar } from '~/common/ui/TopBar'
import type { PoiView } from '~/common/logic/usePoiView'

export function MobilePoiView({ view }: { view: PoiView }) {
  const { shell, city, poi } = view
  const [tier, setTier] = useState<SheetTier>('half')
  /** 同 `DesktopPoiView`：在 early return 之前调（hooks 不能被条件跳过） */
  const addLabel = addToPlanLabel(useCurrentPlanForCity(view.cityId))
  // 这一页本身就是"景点详情"，同样占浮层位（有出口 ⇒ 参与互斥）
  useSheetClaim('detail', view.backToCity, Boolean(poi))

  if (view.loaded && (!city || !poi)) {
    return (
      <>
        <TopBar variant="task" shell={shell} />
        <Sheet tier={tier} onTier={setTier} header={<SheetHead title="找不到这个点位" />}>
          <PoiMissing cityId={view.cityId} hasCity={city !== null} />
        </Sheet>
      </>
    )
  }

  return (
    <>
      <TopBar
        variant="task"
        shell={shell}
        actions={
          <button
            type="button"
            onClick={view.backToCity}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[12.5px] hover:border-primary hover:text-primary"
          >
            <Icon name="back" size="sm" />
            看点位
          </button>
        }
      />

      <Sheet
        tier={tier}
        onTier={setTier}
        label="景点详情"
        /* 收起 = 回城市页（本页没有"列表"可以回去，出口只能是上一层路由） */
        onClose={view.backToCity}
        header={
          <SheetHead
            title={poi?.name ?? '加载中…'}
            sub={poi ? poi.location.address : undefined}
            action={
              <button
                type="button"
                onClick={view.addToPlan}
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
        {poi && city ? (
          <PoiDetail
            poi={poi}
            cityName={city.name}
            gallery={view.gallery}
            onGallery={view.setGallery}
            showSources={view.showSources}
            onToggleSources={view.toggleSources}
            hideName
          />
        ) : (
          <div className="flex items-center gap-2 p-6 text-[13px] text-ink-2">
            <span className="size-3.5 animate-spin rounded-full border-2 border-line border-t-primary" />
            加载中…
          </div>
        )}
      </Sheet>
    </>
  )
}
