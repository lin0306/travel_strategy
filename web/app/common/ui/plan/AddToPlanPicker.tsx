/**
 * 「加到哪个组？」选择器（plans/13 §6.5）。
 *
 * ## 它现在是**每一次**添加的必经之路
 * 早先只在"同城有 ≥2 个组"时才弹，其余情况静默加进某条 —— 已改：
 * 用户的原话是「添加行程按钮，点击后出弹窗，**选择加到哪个组**，可以在弹窗添加新组」。
 * 理由（"同一个按钮在不同状态下干不同的事，用户没法预期"）写在 `useAddToPlan` 文件头。
 *
 * ## ★ 为什么拆成「门 + 内容」两段（`AddToPlanPicker` / `PickerBody`）
 * 这个组件挂在**外壳**上、常年存在（`routes/map-shell.tsx`），靠"没有 payload 就 `return null`"
 * 来表现"关着"。而 `return null` **只是不渲染内容，组件实例还在** —— 它内部的 `useState`
 * 会一直活着。第一版就是这样翻车的：
 *
 * > 用户原话：「我新建组后，再点添加行程出现的弹窗，弹窗内容没恢复到之前的状态，
 * >   还是显示了个输入框，而是按钮」
 *
 * 也就是"上一次的草稿行"被带到了下一次打开。**这类 bug 的根源不是忘了重置某个值，
 * 而是把状态放在了一个"关掉也不消失"的组件里** —— 所以这次不去补 `useEffect` 重置
 * （那是跟在 bug 后面跑：以后再加一个局部状态就又要记得重置一次），
 * 而是让**内容组件随开关真正挂载/卸载**：关了就不存在，下次打开一定是全新的。
 *
 * 同一个套路在行程页也用过（内容与容器分家），判据是"关掉再打开必须回到初始态"。
 *
 * ## 为什么它是个居中面板，而不是下拉气泡
 * 它的锚点位置每次都不一样（城市页清单、景点详情、首页点位……四处都有入口），
 * 跟着按钮定位就要把坐标一路传过来；而且它会挡住地图中间的取景点。
 * 居中 + 点外面关闭，四处入口共用一套。
 */

import { useState } from 'react'

import { usePlanStore } from '~/common/logic/itinerary/planStore'
import { appendDayToPlan, planStopCount, type NewStop } from '~/common/logic/itinerary/planStops'
import { usePlanUi } from '~/common/logic/itinerary/planUi'
import { useCityNames } from '~/common/logic/useCityNames'
import { addStopToPlan } from '~/common/logic/useAddToPlan'
import { Icon } from '~/common/ui/Icon'
import { DraftRow } from '~/common/ui/plan/PlanRow'
import { useDismiss } from '~/common/ui/useDismiss'

/** 门：只负责"开不开"，**不持有任何状态**（见文件头） */
export function AddToPlanPicker() {
  const stop = usePlanUi((s) => s.addPicker)
  if (!stop) return null
  return <PickerBody stop={stop} />
}

/** 内容：每次打开都是**全新实例**，所以永远从「选组 + 新建组按钮」开始 */
function PickerBody({ stop }: { stop: NewStop }) {
  const close = usePlanUi((s) => s.closeAddPicker)
  const showToast = usePlanUi((s) => s.showToast)
  const plans = usePlanStore((s) => s.plans)
  const create = usePlanStore((s) => s.create)
  const names = useCityNames()
  /**
   * 只在这一层挂监听：它存在就等于弹窗开着。
   *
   * ★ `esc` 要**跟着草稿行走**：草稿行自己也吃 `Esc`（= 只取消草稿），
   *   而本钩子的 `Esc` 挂在 `document` 上 —— 两个都响应的话，
   *   用户按一下 `Esc` 想"放弃这行草稿"，**整个弹窗会被关掉**。
   *   语义应当是「**Esc 关掉最里面那一层**」：有草稿行时收草稿行，收掉之后才轮到关弹窗。
   */
  const [draft, setDraft] = useState<string | null>(null)
  const creating = draft !== null
  const wrapRef = useDismiss(true, close, { esc: !creating })

  /** ★ 候选 = 这座城的组 + **城市未定**的组（后者加第一站时才认领城市） */
  const candidates = plans.filter((p) => p.cityId === stop.cityId || p.cityId === '')
  const others = plans.length - candidates.length
  const nameOf = (id: string) => names.get(id) ?? id
  const defaultName = stop.cityId ? `${nameOf(stop.cityId)} · 未命名` : '未命名'

  /**
   * 展开的组。**默认全都收起**（2026-09-27 用户定：「默认是收起状态」）。
   *
   * ★ 这里原来写的是 `expandedId ?? candidates[0]?.id` —— 拿"第一个候选"当缺省，
   *   于是**点第一个组想收起会被立刻兜回去**，表现为"展开/收起功能没用"
   *   （用户报的原话）。`null` 必须是**合法的"都收起"状态**，不能拿任何值兜底。
   */
  const [expandedId, setExpandedId] = useState<string | null>(null)

  /**
   * 选中一个组。
   *
   * ★ 一律走 `addStopToPlan`（**唯一的写入口**）而不是自己拼 `update` ——
   *   重复校验就挂在那个入口上，自己拼就等于绕过它。
   * ★ 无论结果是"已加入"还是"要问一句"，**弹窗都先关掉**：
   *   问的时候由「确认卡」接管（两张卡同时开着会让用户不知道该点哪张）。
   */
  /** 点的是**某一天** —— 这才是"排进行程" */
  async function addTo(planId: string, dayIndex: number) {
    close()
    await addStopToPlan(planId, stop, dayIndex)
  }

  /**
   * 组右侧「＋」= **往后加一天**。
   *
   * ★ 只加天，**不碰这个景点**（详见 `appendDayToPlan` 的注释）：第一版把它写成
   *   "加到新的一天"，于是点 ＋ 也走重复校验、弹「这个景点已经在里面了」，
   *   而用户的原话是「我点组的添加，不应该是**添加天的数据**吗」—— 他在建结构，
   *   系统却在跟他讨论景点。
   * ★ 加完**不关弹窗**，并把那个组**展开**：新出现的「第 N 天」就是下一步的落点，
   *   用户点它才真的把这个地点排进去。关掉弹窗等于让他去猜"到底加上没有"。
   *   （这也顺手消掉了另一条路径上的困惑：关掉确认卡后屏幕上什么都不剩。）
   */
  async function addDay(planId: string) {
    const store = usePlanStore.getState()
    const plan = store.plans.find((p) => p.id === planId)
    if (!plan) return
    const ok = await store.update(planId, { days: appendDayToPlan(plan) })
    if (!ok) {
      showToast('没能存到本地数据库，这一天没加上')
      return
    }
    // 展开它 —— 否则"加了一天"在界面上没有任何可见的变化
    setExpandedId(planId)
  }

  async function createAndAdd() {
    if (draft === null) return
    const name = draft.trim() || defaultName
    close()
    const created = await create({
      cityId: stop.cityId,
      name,
      // ★ 新组的第一条明细就带坐标 —— 老 `DayItem` 只存 poiId，城市数据一变就静默丢点
    })
    if (!created) {
      showToast('新建组失败，没能存到本地数据库')
      return
    }
    // 新组一定是空的 ⇒ 这里不可能撞重复；但**还是走同一个入口**，
    // 免得以后给"新建"加上"复制既有组的点位"之类的行为时又绕过了校验
    await addStopToPlan(created.id, stop, 0)
  }

  return (
    /* 点外面关闭由 `useDismiss` 挂在下面这块面板上；外层只负责居中，不拦事件 */
    <div className="pointer-events-none absolute inset-0 z-[28] flex items-center justify-center">
      <div
        ref={wrapRef}
        role="dialog"
        aria-modal="false"
        aria-label="加到哪个组"
        className="flt flt-in pointer-events-auto w-[min(320px,88vw)] overflow-hidden"
      >
        <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
          <b className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">
            把「{stop.name}」加到哪个组？
          </b>
          <button
            type="button"
            onClick={close}
            aria-label="取消"
            className="-mr-1 inline-flex size-7 flex-none items-center justify-center rounded-md text-ink-2 hover:bg-line-2 hover:text-ink"
          >
            <Icon name="close" size="sm" />
          </button>
        </div>

        {candidates.length === 0 ? (
          <p className="m-0 px-3.5 py-4 text-center text-[12.5px] leading-relaxed text-ink-2">
            这座城还没有组。建一个 —— 组是装规划明细的容器，
            之后你可以把别的景点、地图取点也加进来。
          </p>
        ) : (
          <ul className="m-0 max-h-[46vh] list-none overflow-auto p-0">
            {candidates.map((p) => {
              const open = expandedId === p.id
              return (
                <li key={p.id}>
                  {/*
                   * 一级：组。**两个动作拆成两个按钮**（不能把一个 button 嵌进另一个 —— 那是非法 HTML，
                   * 浏览器会把内层挤出去、点击判定跟着乱）：
                   *   · 左边一大块 = 展开/收起（点组名本身，符合直觉）
                   *   · 右边「＋」 = **往后加一天**并把当前景点放进去（2026-09-27 用户定）
                   * 原来那个"展开后在最下面出现一行『新的一天』"已去掉 —— 它的入口现在在这行右侧，
                   * 不用先展开再找。
                   */}
                  <div className="flex items-center hover:bg-line-2">
                    <button
                      type="button"
                      onClick={() => setExpandedId(open ? null : p.id)}
                      aria-expanded={open}
                      className="flex min-w-0 flex-1 items-center gap-2 py-2.5 pl-3.5 pr-1 text-left"
                    >
                      <Icon
                        name={open ? 'chev-down' : 'chev-right'}
                        size="sm"
                        className="flex-none text-ink-2"
                      />
                      <span className="min-w-0 flex-1 truncate text-[13px]">
                        {p.name}
                        {p.cityId ? '' : <span className="ml-1 text-[10.5px] text-ink-2">城市未定</span>}
                      </span>
                      <span className="flex-none text-[11px] text-ink-2">{planStopCount(p)} 条明细</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void addDay(p.id)}
                      aria-label={`在「${p.name}」后面加一天`}
                      className="mr-2.5 ml-0.5 inline-flex size-7 flex-none items-center justify-center rounded-md text-ink-2 hover:bg-line hover:text-primary"
                    >
                      <Icon name="plus" size="sm" />
                    </button>
                  </div>

                  {/* 二级：天。★ 点**某一天** = 加进那一天 */}
                  {open ? (
                    <ul className="m-0 list-none border-t border-line bg-line-2/40 p-0">
                      {p.days.map((d, i) => (
                        <li key={i}>
                          <button
                            type="button"
                            onClick={() => void addTo(p.id, i)}
                            className="flex w-full items-center gap-2 py-2 pl-8 pr-3.5 text-left hover:bg-line-2"
                          >
                            <span className="min-w-0 flex-1 truncate text-[12.5px]">第 {i + 1} 天</span>
                            <span className="flex-none text-[11px] text-ink-2">{d.items.length} 条</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}

        {/* ★「新建组」**永远在最下面且永远可点**，包括列表为空时 ——
            它就是"可以在弹窗添加新组"那句话的落点。
            点它**不立刻建**，而是把这一块换成一行输入框（与列表面板同一个 `DraftRow`），
            点 ✓ / `Enter` 才真的建组并把这个景点加进去。 */}
        <div className="border-t border-line px-3.5 py-2.5">
          {creating ? (
            /* ★ 这条草稿行给「取消」—— 弹窗里没有明显的 Esc 入口，得有看得见的退路 */
            <DraftRow
              value={draft === '' ? defaultName : draft}
              onChange={setDraft}
              onCommit={() => void createAndAdd()}
              onCancel={() => setDraft(null)}
              className="flex items-center gap-1.5"
              showCancel
            />
          ) : (
            /* ★ 虚线边框 + 圆角 + 文字居中（2026-09-27 用户定）——
               虚线是"这里可以长出一样新东西"的通用语汇（新建文件夹 / 新建标签页都是它），
               比描边实线的按钮更能说明"点它是**建**，不是**选**" */
            <button
              type="button"
              onClick={() => setDraft('')}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line py-2 text-[12.5px] text-ink-2 hover:border-primary hover:text-primary"
            >
              <Icon name="plus" size="sm" />
              新建规划
            </button>
          )}
          <p className="mt-1.5 mb-0 text-[10.5px] leading-relaxed text-ink-2">
            一级是组，展开是「天」 —— 点哪一天就把这个地点加进哪一天；
            组右边的 ＋ 是往后加一天（加完点新出现的「第 N 天」把地点放进去）。
            「城市未定」的组加第一站时会归到这座城。
            {others > 0 ? `另有 ${others} 个其它城市的组没列出来。` : ''}
          </p>
        </div>
      </div>
    </div>
  )
}
