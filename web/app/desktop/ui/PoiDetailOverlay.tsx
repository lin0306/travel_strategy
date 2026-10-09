/**
 * 点位详情 —— **就地查看**（桌面形态）：**一块 620px 面板，装全部内容**。
 *
 * ## 它和 `routes/poi.tsx`（详情页）是什么关系
 * 两者装的是**同一份内容**（`common/ui/city/PoiDetail`，末尾含「位置与交通」），
 * 差别只有外壳：
 * | | 详情页 | 本组件 |
 * |---|---|---|
 * | 怎么进来 | 直接输 URL / 分享链接 / SEO 收录 | **点地图上的景点图标或名字** |
 * | 顶栏 | 自有任务顶栏（「添加行程」+「看点位」） | 用地图那一条顶栏，动作收进面板自己的标题行 |
 * | 离开 | 浏览器后退 / 「看点位」 | **关闭按钮** 或 **点地图空白** |
 *
 * ★ 为什么要有它（用户 2026-09-23 的原话）：
 *   「现在点景点，右侧是会显示一个景点的简要信息，这个不需要，点击直接看详情就行，
 *    点那个看详情，会触发跳转，这个跳转不需要，url 不需要有任何变化」
 *   —— 原来点景点只有一张 326px 的**预览卡**，卡上那个「看详情」会 `navigate()` 到详情页，
 *     于是看个景点就把 URL 改掉了（刷新还停在那儿，用户觉得"退不回去"）。
 *   现在：**点景点就地看完整详情，URL 一动不动**。
 *
 * ## 四条纪律
 * 1. **不换 URL**：这里没有任何 `navigate`。要看行程页只能由用户**明确点**「添加行程」
 *    （那是动作，不是"看"）。
 * 2. **只有一块浮层**：原来旁边还有一块 300px 的「位置卡」（`--panel-locate`），
 *    用户看过之后说那块"不需要" —— 位置与交通已并进 `PoiDetail` 正文末尾，
 *    整页只剩这一块。★ 同一条路上摆两块浮层 = 多一处遮挡 + **第二个出口**。
 * 3. **必须有关闭出口**：右上角一个 ✕，外加「点地图空白」——后者由图层的 `onBlank` 触发
 *    （判定只能在图层里做，见 `poiLayer` 的抑制窗）。**没有出口的浮层会让人觉得关不掉。**
 * 4. **换点位要复位**：`gallery` 与"溯源展开"是**跟着这一个点位**的状态，
 *    换一个点必须回到第 1 张、收起溯源 —— 不复位就会"点 A 看了第 3 张图，点 B 还停在第 3 张"。
 */

import { useEffect, useState } from 'react'

import { Icon } from '~/common/ui/Icon'
import { Overlay } from '~/common/ui/Overlay'
import { addToPlanLabel, useCurrentPlanForCity } from '~/common/logic/useAddToPlan'
import { PoiDetail } from '~/common/ui/city/PoiDetail'
import type { Poi } from '~shared/schema'

export function PoiDetailOverlay({
  poi,
  cityName,
  cityId,
  onClose,
  onAddToPlan,
}: {
  /** `null` = 没选中 → 不渲染 */
  poi: Poi | null
  cityName: string
  /** 这个景点属于哪座城 —— 「添加行程」按钮要靠它判断"是不是正在看这座城的规划" */
  cityId: string
  onClose: () => void
  onAddToPlan: (id: string) => void
}) {
  const [gallery, setGallery] = useState(0)
  const [showSources, setShowSources] = useState(false)
  const poiId = poi?.id ?? ''
  /**
   * 正在看这条同城的规划吗 —— 决定按钮写「**添加到当前行程**」还是「添加行程」。
   * ★ 必须在这里调（在 `if (!poi) return null` **之前**）：hook 不能被条件跳过。
   * ★ 判据与 `useAddToPlan.run()` 里那条短路用的是**同一个函数**（`currentPlanForCity`），
   *   所以按钮上写的字与点下去干的事不可能对不上。
   */
  const addLabel = addToPlanLabel(useCurrentPlanForCity(cityId))

  // 换点位 → 图片下标与溯源展开复位（见文件头第 3 条）
  useEffect(() => {
    setGallery(0)
    setShowSources(false)
  }, [poiId])

  if (!poi) return null

  return (
    <>
      {/*
       * ★ `z={27}`：**必须高于**「挑景点」清单（`SpotPicker` 是 26）。
       *   挑景点浮层的「详情」按钮打开的就是这一块（走 `shell.setSearchPick`），
       *   用户明确要求「景点详情弹窗的层级是在这个景点列表的层级之上的」——
       *   层级反了的表现是"点了没反应"（其实渲染了，只是被清单盖住）。
       *   同族其它浮层：左面板 20 · 规划面板 21 · 挑景点 26 · 居中弹窗 28 ·
       *   移动端的详情 Sheet 本来就是 `z-28`，天然满足。
       */}
      <Overlay anchor="left" widthToken="--panel-detail" tall z={27} className="overflow-hidden">
        {/* 标题行：名字 + 「添加行程」 + 关闭。动作收在这里，是因为这一层用的是**地图的顶栏** */}
        <div className="flex flex-none items-center gap-2 border-b border-line px-3.5 py-2.5">
          <b className="min-w-0 flex-1 truncate text-[15px] font-semibold">{poi.name}</b>
          <button
            type="button"
            onClick={() => onAddToPlan(poi.id)}
            className="inline-flex h-8 flex-none items-center gap-1.5 rounded-full border border-line px-3 text-[12.5px] hover:border-primary hover:text-primary"
          >
            <Icon name="plus" size="sm" />
            {addLabel}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭详情"
            className="grid size-8 flex-none place-items-center rounded-full text-ink-2 hover:bg-bg hover:text-ink"
          >
            <Icon name="close" size="sm" />
          </button>
        </div>

        <PoiDetail
          poi={poi}
          cityName={cityName}
          gallery={gallery}
          onGallery={setGallery}
          showSources={showSources}
          onToggleSources={() => setShowSources((v) => !v)}
        />
      </Overlay>
    </>
  )
}
