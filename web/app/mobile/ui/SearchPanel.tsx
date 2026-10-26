/**
 * **移动端搜索页**（plans/11 §6.3 / §8.4）—— 顶栏图标点开后铺满一屏。
 *
 * ## 为什么是"铺满一屏"而不是下拉候选面板
 * 手机上键盘会吃掉屏幕下半截（约 300px）。桌面那种"输入框 + 贴着它的下拉面板"
 * 在手机上会让候选列表**被键盘压住** —— 用户看得见输入、看不见结果。
 * 铺满一屏 + 列表自己可滚，键盘弹起时列表跟着缩短，仍然看得见前几条。
 *
 * ## 复用而不是重写
 * 匹配规则、索引懒加载、防抖、命中后"飞镜头 + 交棒详情"全部走 `useSearch()`
 * —— 与桌面是**同一份逻辑**（§8.1 的 AA 护栏也守在那一份上）。
 * 本文件只负责**形态**：全屏容器、更大的行、键盘语义简化。
 *
 * ## 命中之后
 * `pick()` 会飞镜头并把命中的那一枚交给 `shell.searchPick`，页面侧由 `useSearchPick`
 * 接住（打开详情）。**不换路由** —— 这是 §8.1 定下的，手机上也一样：
 * 换 URL 会让"关不掉"（省/市页没有回全国的出口）。
 * ★ 所以本文件点完只做一件事：关掉自己 + 收键盘。
 */

import { useEffect, useRef } from 'react'

import { Icon } from '~/common/ui/Icon'
import { useSearchUi } from '~/common/logic/searchUi'
import { useSearch, type SearchHit } from '~/common/logic/useSearch'

/** 挂载点用它判断要不要渲染（关着的时候连 hook 都不该跑） */
export function MobileSearchPage() {
  const open = useSearchUi((s) => s.open)
  return open ? <SearchPanel /> : null
}

function SearchPanel() {
  const s = useSearch()
  const close = useSearchUi((s2) => s2.closeSearch)
  const inputRef = useRef<HTMLInputElement>(null)

  // 进页即聚焦 —— 用户点这枚图标的意图就是"我要打字"
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const onPick = (hit: SearchHit) => {
    // ★ 先收键盘再飞镜头：不收的话视野被键盘盖住，"飞过去"这件事用户看不见
    inputRef.current?.blur()
    s.pick(hit)
    close()
  }

  const typed = s.query.trim().length > 0
  const empty = s.status === 'ready' && typed && s.flat.length === 0

  return (
    <div
      // ★ `absolute` 不是 `fixed`（与 `ModalScrim` 同一条规矩）：外壳根节点铺满视口，
      //   而浮层动画用的是 transform —— 祖先带 transform 时 `fixed` 会相对它定位。
      className="absolute inset-0 z-[70] flex flex-col bg-surface"
      role="dialog"
      aria-modal="true"
      aria-label="搜索省市、景点"
    >
      {/* 顶栏：返回 + 输入框。★ 顶部要给安全区留白，否则刘海机上输入框被咬掉半截 */}
      <div
        className="flex flex-none items-center gap-2 border-b border-line px-2.5 pb-2.5"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)' }}
      >
        <button
          type="button"
          onClick={close}
          aria-label="关闭搜索"
          className="grid size-9 flex-none place-items-center rounded-md text-ink-2"
        >
          <Icon name="back" size="md" />
        </button>
        <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg bg-line-2 px-2.5">
          <Icon name="search" size="sm" className="flex-none text-ink-2/60" />
          <input
            ref={inputRef}
            type="search"
            role="searchbox"
            aria-label="搜索省市、景点"
            // ★ 手机上不显示"搜索"键以外的动作键，`search` 类型正好给一个"搜索"回车
            enterKeyHint="search"
            placeholder="搜省市、景点…"
            value={s.query}
            onChange={(e) => s.setQuery(e.target.value)}
            className="min-w-0 flex-1 border-0 bg-transparent text-[16px] text-ink outline-none placeholder:text-ink-2/45"
          />
          {typed ? (
            <button
              type="button"
              aria-label="清空"
              onClick={() => {
                s.setQuery('')
                inputRef.current?.focus()
              }}
              className="grid size-7 flex-none place-items-center rounded text-ink-2/70"
            >
              <Icon name="close" size="sm" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="scroll min-h-0 flex-1">
        {!typed ? (
          <p className="m-0 px-4 py-6 text-[14px] leading-relaxed text-ink-2">
            输入城市名或景点名。省份、城市、景点都能搜到。
          </p>
        ) : s.status === 'loading' ? (
          <p className="m-0 px-4 py-6 text-[14px] text-ink-2">正在加载搜索数据…</p>
        ) : s.status === 'unavailable' ? (
          // ★ 与"没搜到"分开说 —— 合成一句会让用户以为是自己打错了
          <p className="m-0 px-4 py-6 text-[14px] leading-relaxed text-ink-2">
            搜索数据还没生成（跑一次采集流水线的 build 即可）。你仍然可以点地图上的徽标逐级进入。
          </p>
        ) : empty ? (
          <p className="m-0 px-4 py-6 text-[14px] text-ink-2">
            没找到「{s.query.trim()}」—— 试试城市名或景点名
          </p>
        ) : (
          <ul className="m-0 list-none p-0">
            {s.results.regions.length > 0 ? (
              <li className="px-4 pt-3 pb-1 text-[12.5px] font-semibold tracking-wide text-ink-2/70">
                地区 <span className="font-normal text-ink-2/50">{s.results.regions.length}</span>
              </li>
            ) : null}
            {s.results.regions.map((r) => (
              <li key={`r-${r.adcode}`}>
                <SearchRow
                  icon="nav"
                  name={r.name}
                  hint={r.poiCount === null ? '待收录' : `${r.poiCount} 个景点`}
                  onPick={() => onPick({ kind: 'region', region: r })}
                />
              </li>
            ))}
            {s.results.pois.length > 0 ? (
              <li className="px-4 pt-3 pb-1 text-[12.5px] font-semibold tracking-wide text-ink-2/70">
                景点 <span className="font-normal text-ink-2/50">{s.results.pois.length}</span>
              </li>
            ) : null}
            {s.results.pois.map((p) => (
              <li key={`p-${p.id}`}>
                <SearchRow
                  icon="pin"
                  name={p.name}
                  hint={p.cityName}
                  thumb={p.cover}
                  onPick={() => onPick({ kind: 'poi', poi: p })}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 底部安全区占位 —— 列表滚到底时不至于贴着 Home 指示条 */}
      <div className="flex-none" style={{ height: 'env(safe-area-inset-bottom, 0px)' }} />
    </div>
  )
}

/**
 * 结果行。★ 地区行与景点行**共用同一个缩略图方块**（没图的回落到图标）——
 * 只给景点加图会让地区行的名字左移一截，看起来像两套列表（桌面同样处理，见 `SearchBox`）。
 */
function SearchRow({
  icon,
  name,
  hint,
  thumb,
  onPick,
}: {
  icon: 'nav' | 'pin'
  name: string
  hint: string
  thumb?: string | null
  onPick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-line-2"
    >
      <span className="grid size-10 flex-none place-items-center overflow-hidden rounded-md bg-line-2">
        {thumb ? (
          <img src={thumb} alt="" className="size-full object-cover" loading="lazy" />
        ) : (
          <Icon name={icon} size="sm" className="text-ink-2/70" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-[15.5px] text-ink">{name}</span>
      <span className="flex-none text-[13px] text-ink-2/70">{hint}</span>
    </button>
  )
}
