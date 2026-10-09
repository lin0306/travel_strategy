/**
 * 右侧浮层 · **列表态**（plans/13 §6.2）。
 *
 * ```
 * ┌ 路线规划 ──────────────── [+ 新建组] ┐
 * │ ▸ [成都三日          ] ✓            │  ← 新建组：先在**头部插一行输入框**
 * │ ● 成都三日 · 成都 · 8 条明细          │
 * │   12.4 km · 46 分钟 · 2 小时前        │  ← 按 updatedAt 倒序
 * └──────────────────────────────────────┘
 * ```
 *
 * ## 新建组 = **新建文件夹**（2026-09-26 用户定）
 * 「点新建，在列表头部插入一条数据，显示输入框，名字默认是你现在这个，
 *   右侧有个勾的图标，点击保存名字，可以在输入框里修改名字」
 *
 * 关键差别不在手感，而在**什么时候写库**：**点「新建组」时不写库**，
 * 只插一行草稿输入框；直到 `Enter` / 点 ✓ / 点到别处才 `create()`。
 * 旧做法在你还没想好叫什么的时候就已经落库了，于是一个"点错了/想了想又不想要了"的
 * 名单，每点一次都会多出一个「成都 · 未命名」。
 *
 * 交互细节与三条约定见 `PlanRow.tsx`（`DraftRow`）的注释。
 *
 * ## 文件分工（拆过一轮：挤一个文件时本文件到了 490 行）
 * | 文件 | 管什么 |
 * |------|--------|
 * | 本文件 | 列表怎么排、空态/加载/不可用怎么渲染、草稿行的状态机 |
 * | `PlanRow.tsx` | 两种行：已存的组（`PlanRow`）与草稿（`DraftRow`） |
 * | `PanelHeader.tsx` | 顶部条（两态共用，保证切换时不跳） |
 *
 * ## 三条文案纪律
 * 1. **不显示 0**：没算过路线写「未规划路线」，不写「0 公里」（红线 10）。
 *    `0 公里`会被读成"算出来就是 0"，而事实是"还没算"。
 * 2. **每条显示它属于哪座城**：列表是跨城的，不写城名时
 *    「我的行程」这种名字根本分不出是哪一条。
 * 3. **不可用与"空列表"必须分开渲染**：前者要教用户怎么办，
 *    后者要引导他建第一条 —— 共用一套文案等于什么都没说。
 */

import { useRef, useState } from 'react'

import { useCityNames } from '~/common/logic/useCityNames'
import { useCurrentCityId } from '~/common/logic/useCurrentCityId'
import { usePlanStore } from '~/common/logic/itinerary/planStore'
import { usePlanUi } from '~/common/logic/itinerary/planUi'
import { Icon } from '~/common/ui/Icon'
import { DraftRow, PlanRow } from '~/common/ui/plan/PlanRow'
import { PanelHeader } from '~/common/ui/plan/PanelHeader'

export function PlanListView() {
  const plans = usePlanStore((s) => s.plans)
  const status = usePlanStore((s) => s.status)
  const error = usePlanStore((s) => s.error)
  const create = usePlanStore((s) => s.create)
  const closePanel = usePlanUi((s) => s.closePanel)
  const cityId = useCurrentCityId()
  const names = useCityNames()
  const [renamingId, setRenamingId] = useState<string | null>(null)

  const nameOf = (id: string) => names.get(id) ?? id

  /**
   * 草稿行。`null` = 没在新建；`''` = 在新建但**还没改过**（显示默认名）；
   * 其余 = 用户打进去的内容。
   *
   * ★ 为什么要区分 `''` 与"已有内容"：默认名里带着城市名，而城市名是**异步**来的
   *   （`useCityNames`）。把默认名在点击那一刻**烤成一个字符串**存进 state，
   *   就会在"城市名还没加载完"时把 `chengdu · 未命名` 这种东西烤进去。
   *   让 `''` 代表"用当前算出来的默认名"，显示就永远跟着加载结果走。
   */
  const [draft, setDraft] = useState<string | null>(null)
  /** 防止 `blur` 与「点 ✓」两条路径各提交一次（详见 `DraftRow` 的注释） */
  const committingRef = useRef(false)

  /** 城市未定时的默认名：不带城市前缀，别写成「 · 未命名」 */
  const defaultName = cityId ? `${nameOf(cityId)} · 未命名` : '未命名'
  const creating = draft !== null
  /**
   * 第二次点「新建组」的"反应"：草稿已经开着时**不新建第二条**，
   * 而是把输入框重新整段选中（有反应、且不丢已经打进去的名字）。
   */
  const [focusTick, setFocusTick] = useState(0)

  function startCreate() {
    if (creating) {
      setFocusTick((n) => n + 1)
      return
    }
    committingRef.current = false
    setDraft('')
  }

  /** 只在 `Enter` / 点 ✓ / 点到别处时被调 —— **这里才真的写库** */
  async function commitDraft() {
    if (committingRef.current) return
    committingRef.current = true
    const name = (draft ?? '').trim() || defaultName
    // 先收起草稿行（输入框会卸载，它的 blur 还会再进来一次 —— 被上面的 ref 挡住）
    setDraft(null)
    // ★ `cityId` 可能为空（首页 / 省级页建的组）→ 先落「城市未定」，
    //   等第一条明细进来时由它认领城市（守卫在 `planStore.update`）
    const p = await create({ cityId: cityId ?? '', name })
    // ★ 存不进去（配额满 / 事务失败）时把草稿放回去：别让用户白打一遍名字
    if (!p) {
      committingRef.current = false
      setDraft(name)
    }
  }

  return (
    <>
      <PanelHeader
        title="路线规划"
        onClose={closePanel}
        onCreate={startCreate}
        right={<span className="flex-none text-[11px] text-ink-2">{plans.length} 条</span>}
      />

      {error ? (
        <p className="m-0 flex-none border-b border-line bg-line-2 px-3.5 py-2 text-[11.5px] text-ink-2">
          {error}
        </p>
      ) : null}

      <div className="scroll min-h-0 flex-1">
        {status === 'loading' ? (
          <div className="flex items-center gap-2 p-6 text-[13px] text-ink-2">
            <span className="size-3.5 flex-none animate-spin rounded-full border-2 border-line border-t-primary" />
            读取本机规划…
          </div>
        ) : status === 'unavailable' ? (
          <div className="flex flex-col gap-2 px-5 py-8 text-center">
            <p className="m-0 text-[13.5px] font-medium">路线规划不可用</p>
            <p className="m-0 text-xs leading-relaxed text-ink-2">
              {error ?? '当前浏览器不允许使用本地数据库'}
            </p>
            <p className="m-0 text-xs leading-relaxed text-ink-2">
              规划记录只能存在本机浏览器里，存不了就没法用。可以试试：换一个浏览器、关掉无痕模式，
              或检查站点权限里「Cookie 与网站数据」有没有被禁止。
            </p>
          </div>
        ) : plans.length === 0 && !creating ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <Icon name="route" size="xl" className="text-ink-2/60" />
            <p className="m-0 text-[13.5px] font-medium">还没有组</p>
            <p className="m-0 max-w-[240px] text-xs leading-relaxed text-ink-2">
              '建一个规划，然后往里添加行程 —— 顺序由你决定，系统只算时间。'
            </p>
            <button
              type="button"
              onClick={startCreate}
              className="mt-1 inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-[12.5px] text-ink hover:border-primary hover:text-primary"
            >
              <Icon name="plus" size="sm" />
              新建规划
            </button>
          </div>
        ) : (
          <ul className="m-0 list-none divide-y divide-line p-0">
            {/* 草稿行永远在最上面 —— "在列表头部插入一条数据"。
                ★ `DraftRow` 的根节点是 `<div>`（弹窗那边也要用），所以这里套一层 `<li>` */}
            {creating ? (
              <li>
                <DraftRow
                  value={draft === '' ? defaultName : draft}
                  onChange={setDraft}
                  focusTick={focusTick}
                  onCommit={() => void commitDraft()}
                  // Esc = 放弃：草稿行消失，库里什么都没写
                  onCancel={() => setDraft(null)}
                  // ★ 草稿行给「取消」（2026-09-26 用户要求）—— Esc 不够明显
                  showCancel
                />
              </li>
            ) : null}
            {plans.map((p) => (
              <li key={p.id}>
                <PlanRow
                  plan={p}
                  // 城市未定（在首页建的组，还没加过东西）—— 别显示成空串
                  cityName={p.cityId ? nameOf(p.cityId) : '城市未定'}
                  renaming={renamingId === p.id}
                  onStartRename={() => setRenamingId(p.id)}
                  onEndRename={() => setRenamingId((cur) => (cur === p.id ? null : cur))}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
