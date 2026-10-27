/**
 * 移动端**右下角**的工具条 —— 四枚圆角图标，竖排一列。
 *
 * ## 位置：右下角，但**跟着浮层走**
 * 用户三次定稿的原话：
 * 1. 「路线规划、图层、关于、GitHub 四个按钮放到右下角，只展示圆角图标」
 * 2. 「这个不是聚合在一块的，是右侧一列，四个图标」（否掉 2×2，不是否掉位置）
 * 3. 「这四个图标，放右下角」（看到当时排在右上之后，再纠一次位置）
 *
 * 难点只有一条：**移动端每一页底下都有浮层**（城市清单 / 详情 / 规划，`z-28`），
 * 而且最矮的 `peek` 档也有 28svh —— "浮层之下的右下角"在屏幕上并不存在。
 * 所以不是二选一，而是让工具条**贴在浮层上沿**：
 *   · `Sheet` 把自身高度写到 `:root` 的 `--sheet-h`，并派发 `sheet-resize`；
 *   · 这里 `bottom: calc(var(--sheet-h) + var(--flt-inset))` ⇒ 永远悬在地图区右下角。
 * `full` 档（88svh）时高度 + 工具条会顶出屏幕 ⇒ 按同一份数据判定后**整条不渲染**，
 * 而不是让它被切掉半截。
 *
 * ## 三条实现约束
 * 1. **`z-[27]`（低于浮层 `z-28`）**。工具属于地图层，内容永远压住工具。
 *    ★ 也不能高过模态（`z-[40]`/`z-[50]`），否则开「关于」时它浮在最上层。
 * 2. **不参与取景避让**（不带 `data-overlay`）：`fitView` 靠那个属性算地图可用区，
 *    而这四枚是**工具**不是内容 —— 让它参与，地图会为了给工具条让位而缩小视野。
 * 3. **带 `data-sheet-keep`**：点它不算"点浮层外面"。否则详情浮层开着时点一下「图层」，
 *    详情会先被关掉（`useSheetDrag` 的外部点击判定），用户看到的是"面板闪了一下"。
 *
 * ## 为什么图层要开浮层而不是弹出气泡
 * 顶栏那版是「右下角弹出 320px 气泡」（`BasemapMenu`），在手机上它会贴着屏幕边缘、
 * 而且按钮挪到右边缘后气泡就没有展开空间了。现在换成与详情/规划**同一个基座**
 * （`mobile/ui/BasemapSheet`）—— 三档可拖、下拉即收，用户只需学一种浮层。
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
import { SHEET_H_VAR, SHEET_RESIZE_EVENT, TOOLS_COL_PX } from '~/mobile/ui/sheetTier'
import { GITHUB_REPO_URL } from '~/common/data/site'

/**
 * 一枚工具按钮的公共外观。★ 固定 `size-10`（40×40）—— 拇指点得准的下限，
 * 再小就比 iOS 的 44pt 指南差得更多。
 */
const ITEM =
  'pointer-events-auto relative grid size-10 place-items-center rounded-[12px] border border-line bg-surface text-ink-2 shadow-[var(--flt-shadow)] transition-colors active:bg-line-2'

/** 读一个 `:root` 上的长度变量（拿不到就用兜底，避免 `NaN` 把判据算死） */
function rootPx(name: string, fallback: number) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name)
  const v = Number.parseFloat(raw)
  return Number.isFinite(v) ? v : fallback
}

/**
 * 浮层升起之后，右下角还摆不摆得下这一列。
 *
 * ★ 判据必须包含**顶栏**：工具条越高、浮层越矮，二者的间隙就越小，
 *   撞上搜索条时按钮会被顶栏盖住（顶栏 `z-30`，比工具条高）。
 * ★ 初始值给 `true`（SSG 首帧没有 `window`）：宁可首帧闪一下位置，也不能首帧不渲染。
 */
function useToolsFits() {
  const [fits, setFits] = useState(true)

  useEffect(() => {
    const measure = (sheetH: number) => {
      const room = window.innerHeight - rootPx('--topbar-h', 52) - rootPx('--flt-inset', 12) * 2
      setFits(sheetH + TOOLS_COL_PX <= room)
    }

    const onSheet = (e: Event) => measure((e as CustomEvent<number>).detail)
    /** 旋转屏幕 / 地址栏收放都会改可视高度，浮层高度没变也得重算 */
    const onResize = () => measure(rootPx(SHEET_H_VAR, 0))

    onResize()
    window.addEventListener(SHEET_RESIZE_EVENT, onSheet)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener(SHEET_RESIZE_EVENT, onSheet)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return fits
}

export function MobileMapTools() {
  const shell = useMapShell()
  const [layersOpen, setLayersOpen] = useState(false)
  const openAbout = useDocUi((s) => s.openAbout)
  const planOpen = usePlanUi((s) => s.panelOpen)
  const togglePlan = usePlanUi((s) => s.togglePanel)
  const count = usePlanStore((s) => s.plans.length)
  const fits = useToolsFits()

  // 规划浮层自带关闭接口，开着时不必再留一条并行的入口；也避免两块浮层叠着
  if (planOpen || !fits) return null

  return (
    <>
      <div
        data-sheet-keep
        /*
         * `bottom` 走行内 style 而不是 Tailwind 任意值：`calc()` 里 `+` 两侧**必须有空格**，
         * 而任意值里的空格要写成 `_`，读起来比原文还难对 —— 这类地方宁可交回 CSS。
         */
        style={{ bottom: 'calc(var(--flt-inset) + var(--sheet-h, 0px))' }}
        className="pointer-events-none absolute right-[var(--flt-inset)] z-[27] flex flex-col items-end gap-2"
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
