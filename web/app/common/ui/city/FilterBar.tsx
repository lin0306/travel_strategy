import { useState } from 'react'

import { useIsMobile } from '~/common/logic/useViewport'
import { Icon } from '~/common/ui/Icon'
import {
  CATEGORY_META,
  SUBTYPE_KEYS,
  SUBTYPE_META,
  type Category,
  type City,
  type SubType,
} from '~shared/schema'

/** 四个大类。顺序即展示顺序 —— 景点在最前（多数人的第一诉求） */
const CATEGORIES: Category[] = ['scenic', 'food', 'hotspot', 'culture']

/**
 * 筛选栏：**大类筛、细类色**。
 *
 * ## 为什么是两层而不是一层 12 个 chip
 * 12 个 chip 平铺时用户要在一屏里找"那个青色的是啥来着"；先选大类
 * （景点/美食/网红/特色）再选细类，每层都只有 4 个左右的选择。
 *
 * ## 一个刻意的行为：切大类会清掉细类
 * 细类是大类的子集，跨大类保留细类选择会得到**空列表** ——
 * 用户会以为"这个城市没有这个点位"。所以切大类时顺手把细类重置。
 *
 * ## 细类 chip 只列出**当前有数据的**
 * 列出计数为 0 的细类等于给一个点了没反应的按钮。
 *
 * ## ★ `collapsible`：默认只露一行大类（2026-09-27 加）
 * 「挑景点」浮层（`plan/SpotPicker`）用它。那块面板不长，而"多数时候只改大类"
 * 是这里的常态 ⇒ **默认只显示一行**（全部 + 4 个大类），**最右侧**一个展开/收起，
 * 展开才露出细类色板（用户原话：「顶部增加单选按钮的筛选，默认展示一行常用的，
 * 最右侧有个展开收起按钮」）。
 * ★ 折起来的是**细类那一行**，不是把大类藏起来 —— 大类是筛选的主干，藏了等于没筛选。
 * ★ 城市页不传这个 prop（默认 `false`）⇒ 两行都显示，现状一点不变。
 */
export function FilterBar({
  city,
  category,
  subtype,
  counts,
  onCategory,
  onSubtype,
  collapsible,
}: {
  city: City | null
  category: Category | null
  subtype: SubType | null
  counts: Map<SubType, number>
  onCategory: (c: Category | null) => void
  onSubtype: (s: SubType | null) => void
  /** 细类那一行默认折起、右侧给一个展开/收起按钮 */
  /** 细类是否默认收起。**不传就按端别**：移动端收起（省 Sheet 高度）、桌面展开 */
  collapsible?: boolean
}) {
  /*
   * ★★ 折叠状态必须是**派生**，不能用 `useState(!collapsible)` 当初值：
   *   `useIsMobile()` 的 `getServerSnapshot` 返回 **true**（移动优先），
   *   而 `useState` 的初值只在首次渲染取一次 ⇒ 桌面端水合后**永远停在收起态**。
   *   `userOpen ?? !fold`：没手动点过就跟着端别走，点过就以用户的为准。
   */
  const isMobile = useIsMobile()
  const fold = collapsible ?? isMobile
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const openSub = userOpen ?? !fold

  if (!city) return null

  const subList = (category ? CATEGORY_META[category].subtypes : SUBTYPE_KEYS).filter(
    (s) => (counts.get(s) ?? 0) > 0,
  )

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-1.5">
        {/* 第一行 = **常用的那几个**（全部 + 四个大类）。窄了它会自己换行，不再往下切 */}
        <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => {
              onCategory(null)
              onSubtype(null)
            }}
            className={`h-9 rounded-full border px-2.5 text-[14px] md:h-7 md:text-[12px] ${
              category === null ? 'border-ink bg-ink text-white' : 'border-line text-ink-2'
            }`}
          >
            全部 {city.pois.length}
          </button>
          {CATEGORIES.map((c) => {
            const n = city.pois.filter((p) => p.category === c).length
            const on = category === c
            return (
              <button
                key={c}
                type="button"
                onClick={() => {
                  onCategory(on ? null : c)
                  onSubtype(null)
                }}
                className="h-9 rounded-full border px-2.5 text-[14px] md:h-7 md:text-[12px]"
                style={{
                  borderColor: on ? CATEGORY_META[c].color : undefined,
                  background: on ? CATEGORY_META[c].color : undefined,
                  color: on ? '#fff' : undefined,
                }}
              >
                {CATEGORY_META[c].label} {n}
              </button>
            )
          })}
        </div>

        {/* ★ 判据是 `fold` 不是 `collapsible`：不传 `collapsible` 时 fold 由端别决定，
            这时也必须给出展开按钮 —— 否则细类被收起、却没有任何入口能打开（死锁） */}
        {fold ? (
          <button
            type="button"
            onClick={() => setUserOpen(!openSub)}
            aria-expanded={openSub}
            aria-label={openSub ? '收起细类筛选' : '展开细类筛选'}
            className="inline-flex size-9 flex-none items-center justify-center rounded-full border border-line text-ink-2 hover:border-primary hover:text-primary md:size-7"
          >
            <Icon name={openSub ? 'chev-up' : 'chev-down'} size="sm" />
          </button>
        ) : null}
      </div>

      {openSub ? (
        /*
         * ★ 移动端**横向滚动**而不是换行（2026-10-25）：字号放大后 8 枚细类会换 4 行，
         *   在 56svh 的 Sheet 里吃掉一半高度、把列表挤到只剩 ~120px。
         *   细类兼作**图例**（色点 + 名称 + 计数），所以不隐藏任何一枚 —— 让它滚。
         *   `.scroll` 是 app.css 里唯一的滚动容器样式出处（不自己写 overflow 修饰）。
         */
        <div className="scroll flex gap-1.5 overflow-x-auto pb-1.5 md:flex-wrap md:overflow-visible md:pb-0">
          {subList.map((s) => {
            const on = subtype === s
            return (
              <button
                key={s}
                type="button"
                onClick={() => onSubtype(on ? null : s)}
                className={`flex h-8 items-center gap-1.5 rounded-full border px-2 text-[13px] md:h-6.5 md:text-[11.5px] ${
                  on ? 'border-ink text-ink' : 'border-line text-ink-2'
                }`}
              >
                <i
                  aria-hidden="true"
                  className="size-2 flex-none rounded-full"
                  style={{ background: SUBTYPE_META[s].color }}
                />
                {SUBTYPE_META[s].label}
                <span className="text-ink-2/70">{counts.get(s) ?? 0}</span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
