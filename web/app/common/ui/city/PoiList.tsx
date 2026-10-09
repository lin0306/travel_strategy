import type { KeyboardEvent } from 'react'

import { Icon } from '~/common/ui/Icon'
import { EmptyState, SectionLabel } from '~/common/ui/Overlay'
import {
  CATEGORY_META,
  SUBTYPE_META,
  type Category,
  type City,
  type Poi,
  type SubType,
} from '~shared/schema'

/** 列表排序方式。'hot' = 热门优先，'name' = 名称排序 */
export type PoiSort = 'hot' | 'name'

/**
 * 排序 —— **唯一出处**：城市页的清单与「挑景点」浮层（`plan/SpotPicker`）都用它。
 *
 * ★ 它只是一行纯函数，但值得单独抽出来：两处的清单**必须是同一种顺序**
 *   （用户在两边看到的都是"热门优先"）。各写一份 = 迟早一处改了口径、
 *   另一处照旧，而屏幕上只是"顺序看起来有点怪"，没人会报成 bug。
 */
export function sortPois(list: Poi[], sort: PoiSort): Poi[] {
  return sort === 'hot'
    ? [...list].sort((a, b) => b.popularity - a.popularity)
    : [...list].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
}

/**
 * 两级筛选（大类 + 细类，可以同时生效）—— 与 `sortPois` 同一档的**唯一出处**。
 *
 * ★ 抽出来的理由与排序完全一样：城市页清单与「挑景点」浮层用的是**同一套筛选语义**，
 *   各写一份就会出现"同一个 chip 在两处筛出不同的东西"，而且不会报错。
 */
export function filterPois(list: Poi[], category: Category | null, subtype: SubType | null): Poi[] {
  let out = list
  if (category) out = out.filter((p) => p.category === category)
  if (subtype) out = out.filter((p) => p.subtype === subtype)
  return out
}

/** 细类计数（chip 上的数字、以及"计数为 0 的不列出"）—— 同上，唯一出处 */
export function countSubtypes(pois: Poi[]): Map<SubType, number> {
  const m = new Map<SubType, number>()
  for (const p of pois) m.set(p.subtype, (m.get(p.subtype) ?? 0) + 1)
  return m
}

/**
 * 点位列表。
 *
 * ## 两行一条，不做卡片
 * 一个城市 ~46 个点，卡片式一屏只看得到 4 个；两行一条能看 10 个以上。
 * 这一栏的作用是"扫一遍看有什么"，不是"逐条细读" —— 细读有详情页。
 *
 * ## ★ 两档 `mode` 的**分工**（2026-09-27 两轮定稿）
 * | | 点行 | 右侧按钮 | 分组标题 |
 * |---|---|---|---|
 * | `'browse'`（城市页清单） | **选中**（就地开详情） | 详情 · 添加行程 | `grouped` 控制 |
 * | `'pick'`（「挑景点」浮层） | **打开详情** | **只有一个「加入行程」** | **不分组**（`grouped={false}`） |
 *
 * ★★ **加入永远只有右侧那个按钮**（用户 2026-09-27 原话：
 *   「只有点加入行程按钮，才会加入到右侧的行程里面」）。这一条踩过两次：
 *   第一版整行就是"加入"（一滑手就多一条行程），第二版行不响应任何点击
 *   （用户又要"点卡片看详情"）—— 现在行点击**只做详情**，写库的路只剩按钮一条。
 * ★★ `pick` 档**不显示「详情」按钮**（用户：「详情按钮不需要显示……点卡片就打开景点详情」）：
 *   那一档的行点击就是详情，再摆一个按钮是同一件事说两遍。
 *   「加入行程」用的是原来那个详情按钮的样式（`text-primary` 文字链接）——
 *   用户明确要求「用详情按钮的样式」，所以那一档不再有描边按钮。
 * ★ 行点击的目标由 `rowAction` **一处**决定，不是散在 JSX 里的三元。
 *
 * ## `pick` 档不分组
 * 挑景点时用户在"扫一遍有什么"，中间插进来的大类标题只会把本来就短的一屏切碎
 * （用户原话：「全部都放到一个列表里面，不需要分组」）。筛选交给顶部那条（`FilterBar`）。
 */
export function PoiList({
  city,
  list,
  sort,
  selectedId,
  onSelect,
  onOpen,
  onAddToPlan,
  mode = 'browse',
  grouped = true,
}: {
  city: City | null
  list: Poi[]
  sort: PoiSort
  selectedId: string | null
  /** 行被点（**仅 `browse`**：`pick` 档行点击走 `onOpen`） */
  onSelect?: (id: string) => void
  /** 点「详情」按钮（`browse`）/ **点行**（`pick`） */
  onOpen?: (id: string) => void
  /** 右侧那个**唯一**能写库的按钮 */
  onAddToPlan: (id: string) => void
  mode?: 'browse' | 'pick'
  /** 是否插大类分组标题（只在 `sort='hot'` 时才有意义，见文件头） */
  grouped?: boolean
}) {
  if (!city) {
    return (
      <div className="flex items-center gap-2 px-3.5 py-6 text-[13px] text-ink-2">
        <span className="size-3.5 flex-none animate-spin rounded-full border-2 border-line border-t-primary" />
        加载中…
      </div>
    )
  }

  if (list.length === 0) {
    return (
      <EmptyState
        icon={<Icon name="search" size="xl" />}
        title="这个筛选下没有点位"
        detail="换一个细类，或者点「全部」看所有点位。"
      />
    )
  }

  const pick = mode === 'pick'
  /**
   * **行点击的目标**：`browse` = 选中（就地开详情）；`pick` = 直接打开详情。
   * ★ 两档都不把行点击接到"加入"上 —— 写库只有右侧按钮一条路（见文件头 ★★）。
   */
  const rowAction = pick ? onOpen : onSelect
  let lastCat: Category | null = null

  return (
    <div className="pb-3">
      {list.map((p) => {
        const showCat = grouped && sort === 'hot' && p.category !== lastCat
        lastCat = p.category
        return (
          <div key={p.id}>
            {showCat ? <SectionLabel>{CATEGORY_META[p.category].label}</SectionLabel> : null}
            <div
              /*
               * `data-poi` 是**验收锚点**（与 `data-day` / `data-overlay` 同一类东西）：
               * 验收脚本要"点这一行"就得有个稳定的钩子 —— 靠文本找行会误命中顶栏与筛选 chip。
               */
              data-poi={p.id}
              role="button"
              tabIndex={0}
              onClick={() => rowAction?.(p.id)}
              onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
                if (e.key === 'Enter') rowAction?.(p.id)
              }}
              className={`flex cursor-pointer items-start gap-2.5 px-3.5 py-2 hover:bg-bg ${
                !pick && selectedId === p.id ? 'bg-bg' : ''
              }`}
            >
              <span
                aria-hidden="true"
                className="mt-1 size-2.5 flex-none rounded-full"
                style={{ background: SUBTYPE_META[p.subtype].color }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <b className="truncate text-[13.5px] font-medium">{p.name}</b>
                  <span className="flex-none text-[10.5px] text-ink-2">
                    {SUBTYPE_META[p.subtype].label}
                  </span>
                </div>
                <p className="mt-0.5 mb-0 line-clamp-1 text-[11.5px] text-ink-2">{p.summary}</p>
              </div>
              <div className="flex flex-none flex-col items-end gap-1">
                {/* ★ `pick` 档没有「详情」—— 那一档行点击就是详情（见文件头 ★★） */}
                {!pick && onOpen ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpen(p.id)
                    }}
                    className="text-[11px] text-primary"
                  >
                    详情
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onAddToPlan(p.id)
                  }}
                  // `pick` 档用**原详情按钮的样式**（文字链接）
                  className={
                    pick ? 'text-[11px] text-primary' : 'text-[11px] text-ink-2 hover:text-primary'
                  }
                >
                  {pick ? '加入行程' : '添加行程'}
                </button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
