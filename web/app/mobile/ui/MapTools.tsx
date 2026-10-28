/**
 * 移动端**右下角**的工具条 —— 四枚圆角图标，竖排一列。
 *
 * ## 位置：钉死在屏幕右下角
 * 用户 2026-10-28 的原话：「右下角那四个悬浮按钮，是固定在底部的，不会被其他东西往上挤」。
 *
 * 上一版为了"浮层升起时仍然可见"，让它跟着 `--sheet-h` 一起上移 —— 结果它在
 * 半屏处飘着，看起来像被什么东西顶上去了。现在回到**屏幕右下角固定**：
 * `bottom: var(--flt-inset)`，不读任何浮层高度。
 *
 * ★★ 层级：`z-[27]`，**低于**底部浮层（`z-28`）
 *   用户 2026-10-28 第三次定稿：「浮层永远在最上」。
 *   起因是观感不统一：图层 / 详情两块浮层在工具条之下，而路线规划那块因为
 *   `planOpen` 时本组件直接 `return null`（按钮整条消失）看起来像"压住了按钮"。
 *   现在三块浮层一个规矩：浮层在上、工具在下；`return null` 那条例外也删了 ——
 *   不再有"某种浮层开着时工具条会消失"这样的第二套行为。
 *   ⚠️ 已知代价：城市页的清单浮层常驻且没有出口，那四枚在城市页会被整块盖住
 *   （首页 / 点位详情页没有常驻浮层，照常可点）。要恢复"城市页也能点"，就把
 *   层级抬回 `z-[29]` 并把 `CityView` 列表 / 页脚的让位一起加回来。
 *   ★ 仍低于模态（`z-[40]`/`z-[50]`）：开「关于」时它不该浮在最上层。
 *
 * ## 三条实现约束
 * 1. **不参与取景避让**（不带 `data-overlay`）：`fitView` 靠那个属性算地图可用区，
 *    而这四枚是**工具**不是内容 —— 让它参与，地图会为了给工具条让位而缩小视野。
 * 2. **带 `data-sheet-keep`**：点它不算"点浮层外面"。否则详情浮层开着时点一下「图层」，
 *    详情会先被关掉（`useSheetDrag` 的外部点击判定），用户看到的是"面板闪了一下"。
 * 3. **容器 `pointer-events-none`**：只有四枚按钮吃事件，它盖住的那块地图仍然可以拖动。
 *
 * ## 为什么图层要开浮层而不是弹出气泡
 * 顶栏那版是「右下角弹出 320px 气泡」（`BasemapMenu`），在手机上它会贴着屏幕边缘、
 * 而且按钮挪到右边缘后气泡就没有展开空间了。现在换成与详情/规划**同一个基座**
 * （`mobile/ui/BasemapSheet`）—— 可拖、下拉即收，用户只需学一种浮层。
 *
 * ★ 四枚图标全部**没有文字**，所以 `aria-label` 是唯一的名字，必须写全。
 */

import { useEffect, useState } from 'react'

import { BasemapSheet } from '~/mobile/ui/BasemapSheet'
import { Icon } from '~/common/ui/Icon'
import { useDocUi } from '~/common/logic/docUi'
import { useMapShell } from '~/common/logic/mapShell'
import { usePlanUi } from '~/common/logic/itinerary/planUi'
import { usePlanStore } from '~/common/logic/itinerary/planStore'
import { GITHUB_REPO_URL } from '~/common/data/site'

/**
 * 一枚工具按钮的公共外观。★ 固定 `size-10`（40×40）—— 拇指点得准的下限，
 * 再小就比 iOS 的 44pt 指南差得更多。
 */
const ITEM =
  'pointer-events-auto relative grid size-10 place-items-center rounded-[12px] border border-line bg-surface text-ink-2 shadow-[var(--flt-shadow)] transition-colors active:bg-line-2'

export function MobileMapTools() {
  const shell = useMapShell()
  const [layersOpen, setLayersOpen] = useState(false)
  const openAbout = useDocUi((s) => s.openAbout)
  const planOpen = usePlanUi((s) => s.panelOpen)
  const togglePlan = usePlanUi((s) => s.togglePanel)
  const count = usePlanStore((s) => s.plans.length)
  const load = usePlanStore((s) => s.load)

  /*
   * ★★ 角标必须**开局就有数**（用户 2026-10-28：「路线规划的数量，在初始状态下，
   *   这个图标的角标不显示，必须要我点开过一次，才显示」）。
   *   以前只有 `RoutePlanPanelBody` 挂载时才 `load()`，而它要等用户点开面板 ——
   *   于是"已经有 3 条规划"的人，一进站看到的是没有角标的图标。
   *   `load()` 是幂等的（`status === 'ready'` 直接返回），这里再调一次没有额外代价。
   */
  useEffect(() => {
    void load()
  }, [load])

  /*
   * ★ 不再写 `if (planOpen) return null`。那条特例是"规划浮层开着时工具条整条消失"
   *   的来源，也是用户看到"三种浮层层级不统一"的一半原因。
   *   现在浮层（`z-28`）本来就压在工具条（`z-[27]`）上面，不需要再靠卸载来避让；
   *   而且互斥仲裁（`mobile/ui/sheetHub`）保证不会出现"规划开着又点出图层"。
   */
  return (
    <>
      <div
        data-sheet-keep
        className="pointer-events-none absolute right-[var(--flt-inset)] bottom-[var(--flt-inset)] z-[27] flex flex-col items-end gap-2"
      >
        {/* ① 路线规划。★ 条数徽标只在 >0 时出现（写「0」是噪音，还会被读成出错） */}
        <button
          type="button"
          onClick={togglePlan}
          aria-expanded={planOpen}
          aria-label={count > 0 ? `路线规划（${count} 条）` : '路线规划'}
          className={ITEM}
        >
          <Icon name="route" size="md" />
          {count > 0 ? (
            <span className="absolute -top-1 -right-1 min-w-[15px] rounded-full bg-primary px-1 text-[9.5px] leading-[15px] text-white tabular-nums">
              {count}
            </span>
          ) : null}
        </button>

        {/* ② 图层（底图）。★ 选项一条都不写死 —— 全部来自引擎层的表（见 `BasemapPanelBody`） */}
        <button
          type="button"
          onClick={() => setLayersOpen(true)}
          aria-haspopup="dialog"
          aria-label="图层设置（底图类型与详细度）"
          className={ITEM}
        >
          <Icon name="layers" size="md" />
        </button>

        {/* ③ 关于。数据来源 / 图片署名 / 站点说明都在那一块（合规面，不能没有入口） */}
        <button
          type="button"
          onClick={openAbout}
          aria-haspopup="dialog"
          aria-label="关于行迹（数据规模 · 使用说明 · 内容与素材来源）"
          className={ITEM}
        >
          <Icon name="info" size="md" />
        </button>

        {/* ④ GitHub —— 站外链接。★ 地址走 `common/data/site` 的唯一常量 */}
        <a
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="在 GitHub 上查看本站的源代码（lin0306/travel_strategy）"
          className={ITEM}
        >
          <Icon name="github" size="md" />
        </a>
      </div>

      <BasemapSheet
        open={layersOpen}
        onClose={() => setLayersOpen(false)}
        value={shell.basemap}
        onKind={shell.setBasemapKind}
        onLevel={shell.setBasemapLevel}
        onToggle={shell.toggleBasemapDetail}
      />
    </>
  )
}
