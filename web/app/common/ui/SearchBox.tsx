/**
 * 顶栏搜索框（2026-09-24 起**真功能**，之前是禁用占位）。
 *
 * ## 它承担什么
 * 「在任意一级都能直接找到目标」：输入省 / 市 / 景点名 → 从结果里点一条
 *   · **地区** → 把那一级框进视野（与点徽标**同一套口径**，见 `districtFocus`）；
 *   · **景点** → 飞过去 + **就地打开详情**（桌面 620px 面板 / 移动端底部 Sheet）。
 * 两者都**不换 URL** —— 与"点地图上的东西"同一条规矩：URL 一变，刷新就停在那一页，
 * 而省 / 城市页没有回全国的出口（顶栏品牌名不是链接），用户会觉得"关不掉"。
 *
 * ## 它是顶栏里唯一"能打字"的东西，所以要守三件事
 * 1. **快捷键提示只在真能按的时候画**：原型框尾那个 `/` 之前**故意没画** ——
 *    给一个按不动的框标快捷键是在骗人。现在它真的能按了，才把它画回来。
 * 2. **窄屏不渲染**（`md` 起）：搜索框是 `flex-1`，窄屏会先被压到 0 宽 ——
 *    实现在 700px 量到过 `w:0`（只剩一个图标吊着），比整块不显示难看得多。
 *    断点阶梯：全屏 `sm` → 搜索框 `md` → 站点导航 `lg`。
 * 3. **键盘可达**（ARIA 1.2 combobox）：↑↓ 移动 / Enter 选中 / Esc 清空，
 *    `aria-activedescendant` 指向当前行 —— 屏幕阅读器读的是"在选项里移动"，
 *    不是"焦点跑掉了"。行用 `onMouseDown` 而不是 `onClick`：`onClick` 会先触发
 *    输入框 blur，某些浏览器顺序下点不中（老问题）。
 *
 * ## 状态文案要分清"没有"和"还没加载"
 * | 情况 | 文案 |
 * |------|------|
 * | 索引还在读 | 正在加载搜索数据… |
 * | 索引不存在（流水线没跑过 `build`） | 搜索数据未生成 + 怎么办 |
 * | 索引有、但没命中 | 没找到「xxx」+ 引导 |
 * 三种都写"没找到"的话，用户会一直换词重试，而真相是数据没生成。
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import { Icon } from '~/common/ui/Icon'
import { useSearch } from '~/common/logic/useSearch'

/** 面板最矮也要能显示 3 行，最高不超过视口六成（顶栏下面还要看得见地图）。
 *  ★ `.scroll`：结果多时出滚动条，统一 6px 细条（不挂就是浏览器默认粗滚动条） */
const PANEL_CLASS =
  'scroll absolute top-[calc(100%+6px)] left-0 z-40 max-h-[60vh] w-full overflow-y-auto rounded-xl border border-line bg-surface py-1 shadow-[0_12px_36px_rgba(16,24,40,.16)]'

export function SearchBox() {
  const { query, setQuery, results, flat, active, setActive, status, pick, reset } = useSearch()
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listId = 'topbar-search-list'

  const typed = query.trim().length > 0
  const open = focused && typed

  // `/` 快捷键：不在输入框里时按 `/` 直接聚焦搜索（原型给的位置就是它）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return
      e.preventDefault()
      inputRef.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const activeHit = flat[active] ?? null
  const activeId = useMemo(
    () => (activeHit ? `${listId}-${active}` : undefined),
    [activeHit, active, listId],
  )

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      reset()
      return
    }
    if (flat.length === 0) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const dir = e.key === 'ArrowDown' ? 1 : -1
      // 首尾循环：一次下到底之后继续按会回到开头，不用记"我在第几个"
      setActive((active + dir + flat.length) % flat.length)
      return
    }
    if (e.key === 'Enter' && activeHit) {
      e.preventDefault()
      pick(activeHit)
    }
  }

  return (
    <div className="relative hidden h-[34px] min-w-0 flex-1 items-center md:flex md:max-w-[392px]">
      <div className="flex h-full w-full items-center gap-2 rounded-lg bg-line-2 px-2.5 text-[12px] focus-within:ring-1 focus-within:ring-primary/40">
        <Icon name="search" size="sm" className="flex-none text-ink-2/60" />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-label="搜索省市、景点"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open ? activeId : undefined}
          placeholder="搜索省市、景点…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 border-0 bg-transparent text-[12px] text-ink outline-none placeholder:text-ink-2/45"
        />
        {typed ? (
          <button
            type="button"
            aria-label="清空搜索"
            // 用 mousedown：click 前输入框会先 blur，列表一关就点不中了
            onMouseDown={(e) => {
              e.preventDefault()
              reset()
              inputRef.current?.focus()
            }}
            className="flex-none rounded p-0.5 text-ink-2/60 transition-colors hover:text-ink"
          >
            <Icon name="close" size="sm" />
          </button>
        ) : (
          <kbd className="flex-none rounded border border-line bg-surface px-1.5 py-0.5 font-sans text-[10px] text-ink-2/70">
            /
          </kbd>
        )}
      </div>

      {open ? (
        <div id={listId} role="listbox" aria-label="搜索结果" className={PANEL_CLASS}>
          {status === 'loading' ? (
            <p className="px-3 py-2.5 text-[12px] text-ink-2">正在加载搜索数据…</p>
          ) : status === 'unavailable' ? (
            <p className="px-3 py-2.5 text-[12px] text-ink-2">
              搜索数据还没生成 —— 跑一次采集流水线的 <code>build</code> 即可
            </p>
          ) : flat.length === 0 ? (
            <p className="px-3 py-2.5 text-[12px] text-ink-2">
              没找到「{query.trim()}」—— 试试城市名或景点名
            </p>
          ) : (
            <>
              <Group label="地区" count={results.regions.length} />
              {results.regions.map((r, i) => (
                <Row
                  key={`r-${r.adcode}`}
                  id={`${listId}-${i}`}
                  active={i === active}
                  icon="nav"
                  name={r.name}
                  hint={r.poiCount === null ? '待收录' : `${r.poiCount} 个景点`}
                  onPick={() => pick({ kind: 'region', region: r })}
                  onHover={() => setActive(i)}
                />
              ))}
              <Group label="景点" count={results.pois.length} />
              {results.pois.map((p, i) => {
                const idx = results.regions.length + i
                return (
                  <Row
                    key={`p-${p.id}`}
                    id={`${listId}-${idx}`}
                    active={idx === active}
                    icon="pin"
                    name={p.name}
                    hint={p.cityName}
                    thumb={p.cover}
                    onPick={() => pick({ kind: 'poi', poi: p })}
                    onHover={() => setActive(idx)}
                  />
                )
              })}
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

/** 分组标题。显式写出条数 —— 让用户知道"还有更下面的"，而不是以为就这几条 */
function Group({ label, count }: { label: string; count: number }) {
  if (count === 0) return null
  return (
    <p className="flex items-baseline gap-1.5 px-3 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-ink-2/70">
      {label}
      <span className="font-normal text-ink-2/50">{count}</span>
    </p>
  )
}

interface RowProps {
  id: string
  active: boolean
  icon: 'nav' | 'pin'
  name: string
  hint: string
  /**
   * 缩略图地址（**已过镜像出口**，见 `searchIndex.ts`）。景点行给真图，
   * 地区行 / 没图的景点留空 → 回落到 `icon` 占位。
   */
  thumb?: string | null
  onPick: () => void
  onHover: () => void
}

function Row({ id, active, icon, name, hint, thumb, onPick, onHover }: RowProps) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      // ★ mousedown 而不是 click：click 之前输入框会 blur，列表一关这一下就丢了
      onMouseDown={(e) => {
        e.preventDefault()
        onPick()
      }}
      onMouseEnter={onHover}
      className={`flex cursor-pointer items-center gap-2.5 px-3 py-1.5 ${
        active ? 'bg-line-2' : ''
      }`}
    >
      {/* 缩略图。★ 两种行都用**同一个方块**（灰底占位），这样名字的左边缘是齐的 ——
          只给景点加图会让地区行的名字比景点行左移一截，看起来像两套列表 */}
      <span className="grid size-8 flex-none place-items-center overflow-hidden rounded-md bg-line-2">
        {thumb ? (
          <img src={thumb} alt="" className="size-full object-cover" loading="lazy" />
        ) : (
          <Icon name={icon} size="sm" className="text-ink-2/70" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{name}</span>
      <span className="flex-none text-[11px] text-ink-2/70">{hint}</span>
    </div>
  )
}
