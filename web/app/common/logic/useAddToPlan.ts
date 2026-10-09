/**
 * 「添加行程」—— **四个地方只剩这一份实现**（plans/13 §6.5）。
 *
 * ## 它替掉了什么
 * 原来城市页 / 首页 / 省级页 / 景点页各有一句
 * `navigate('/city/:cityId/plan?add=<poiId>')` —— **换页**，而且四个地方各写一遍。
 * 现在的形态：**不换页**，弹一个「加到哪个组？」的窗，选完就地加进去。
 *
 * ## 默认弹窗；**但"正在看那条规划 + 同城"时直接加**（2026-09-26 定，09-28 加例外）
 *
 * 曾经写过三级短路（正打开着同城的组就直接加 / 同城只有一条也直接加 / 一条都没有就自动新建）
 * —— 被否掉了，用户的原话是「添加行程按钮，点击后出弹窗，**选择加到哪个组**，
 * 可以在弹窗添加新组」。**短路的真正问题不是"少了确认"，而是同一个按钮在不同状态下
 * 干不同的事**：有时静默加进某条、有时弹窗、有时顺手给他建一条，用户没法预期也就没法学。
 *
 * ★★ **2026-09-28 加回一条有前提的短路**（用户原话：「如果打开了路线规划的详情页面，
 *   景点详情的添加行程按钮改一下，改成**添加到当前行程**，前提是景点和规划是同一个城市，
 *   才显示这个，点击后，**不出弹窗**，直接添加到右侧的行程里面」）。
 *   它**不违反**上面那条理由：按钮文案会跟着变（`useCurrentPlanForCity`）——
 *   用户看得见"这个按钮会把点加进**右边开着的那条行程**"，就不存在"偷偷干别的事"。
 *   ⇒ 判据三合一（`currentPlanForCity`）：**面板开着 · 处于详情态 · 与景点同城**；
 *   ⇒ 加进 `planUi.detailDay`（面板上正看着的那一天）。
 *
 * ## 候选只取**同城**的组
 * 一个组属于一座城市（时间链要靠该城的通勤矩阵算），把成都的景点加进重庆的组
 * 不是"灵活"，而是让那条规划算不出来。弹窗里会写明这条规则，不让用户以为是列表漏了。
 */

import { useCallback, useMemo } from 'react'

import { loadCity } from '~/common/data/cityRegistry'

import { usePlanStore } from './itinerary/planStore'
import { newUid } from './itinerary/ids'
import {
  appendStopToPlan,
  DEFAULT_POINT_NAME,
  findDuplicateStop,
  type NewStop,
} from './itinerary/planStops'
import { arrivalOf } from './itinerary/resolveLeg'
import { usePlanUi } from './itinerary/planUi'
import type { Poi, RoutePlan } from '~shared/schema'

/** 兜底停留时长：数据里没给区间时用（与行程页的 `DWELL_FALLBACK_MIN` 同值） */
const DWELL_FALLBACK_MIN = 90

/**
 * @param poiId 景点 id
 * @param cityId 它属于哪座城
 * @param poi **可选**：手上已经有完整对象就传进来（省一次 `loadCity`）。
 *            四个调用点里有三个手上只有 id。
 */
export type AddToPlan = (poiId: string, cityId: string, poi?: Poi) => void

/**
 * `Poi` → `NewStop`。
 *
 * ★ **导出**是为了让「挑景点」浮层（`common/ui/plan/SpotPicker`）走同一份转换 ——
 *   那里也要把点进来的景点变成一站。各写一份的结果是"停留时长默认值/字段名"
 *   两处慢慢不一样（`dwellMinutes` 少一个字段就是**静默**少一个值，不报错）。
 */
export function toStop(poi: Poi, cityId: string): NewStop {
  const range = poi.practical.durationMinutes
  // ★ 用到达点（入口坐标，>300m 才用），让规划落点落到园区入口而非中心 —— 避免路线穿园
  const at = arrivalOf(poi)
  return {
    kind: 'poi',
    poiId: poi.id,
    name: poi.name,
    lng: at.lng,
    lat: at.lat,
    cityId,
    dwellMinutes: range ? Math.round((range[0] + range[1]) / 2) : DWELL_FALLBACK_MIN,
  }
}

/**
 * **加一站进某条规划的唯一入口** —— 重复校验也在这里。
 *
 * ## 为什么要拦重复
 * 用户在两个地方翻景点、或点两次「添加行程」时，很容易把同一个点排进同一条组里。
 * 加了两次的后果不是"多一份"这么轻：**路线会绕回去**（A→B→C→A→B），
 * 距离与时间都被算成两倍，而排出来的行程看着完全正常。
 *
 * ## 为什么是"问一句"而不是静默拒绝 / 静默添加
 * - 静默拒绝：重复点**有时候是故意的**（同一个地方去两次：白天看展、晚上看灯），
 *   拒绝的话用户没有任何办法表达"我就要两次"；
 * - 静默添加：用户永远不会发现自己的路线被自己排成了一个圈。
 * ⇒ 所以走一次确认，由用户决定。
 *
 * @returns `'added'` 已写入；`'asking'` 已弹出确认（**还没写**）；`'missing'` 找不到那条规划
 */
export async function addStopToPlan(
  planId: string,
  stop: NewStop,
  /** 加进**哪一天**（0 起）。★ 弹窗是棵树（一级组 / 二级天），用户点的是某一天 */
  dayIndex?: number,
): Promise<'added' | 'asking' | 'missing'> {
  const store = usePlanStore.getState()
  const plan = store.plans.find((p) => p.id === planId)
  if (!plan) return 'missing'

  const index = findDuplicateStop(plan, stop)
  if (index !== null) {
    usePlanUi.getState().openDupConfirm({ planId, planName: plan.name, stop, index })
    return 'asking'
  }

  await appendStopWithToast(planId, stop, undefined, dayIndex)
  return 'added'
}

/**
 * 把一站写进某条规划，并按结果给一条 toast。
 *
 * ★ **`addStopToPlan` 之外的调用方只应当是「确认卡」那一个**（"仍然添加"）。
 *   别的路径直接用它 = 绕过了重复校验。
 *
 * ★ **一并把已算的路线清掉**（`route: null`）：点位变了，那条折线就不再描述这串点。
 *   留着它比没有更糟 —— 图上画着一条对的路线，对不上列表里的顺序。
 *
 * ★ toast 带上 `planId` ⇒ 面板给一个「打开」动作。少了它，用户只知道"加进去了"，
 *   但不知道加到了哪儿，得自己去列表里找。
 */
export async function appendStopWithToast(
  planId: string,
  stop: NewStop,
  okText?: (planName: string) => string,
  /** 加进哪一天（0 起）。不给 = 最后一个非空天（地图取点那条路，没有弹窗） */
  dayIndex?: number,
): Promise<void> {
  const store = usePlanStore.getState()
  const plan = store.plans.find((p) => p.id === planId)
  if (!plan) return
  /*
   * ★ 这一站如果落在一条**还没定城市**的组里，就由它来认领这座城市
   *   （用户要求「新建组不管什么情况下都能点」⇒ 首页也能先建一条空组，
   *     城市等第一条明细进来时才定下来）。已经在某座城的组不受影响 ——
   *     守卫在 `planStore.update` 里。
   */
  const ok = await store.update(planId, {
    days: appendStopToPlan(plan, stop, dayIndex),
    route: null,
    ...(plan.cityId ? {} : { cityId: stop.cityId }),
  })
  usePlanUi.getState().showToast(
    ok
      ? (okText?.(plan.name) ?? `已把「${stop.name}」加到「${plan.name}」`)
      : `「${stop.name}」加进去了，但没能存到本地数据库（刷新后会丢）`,
    planId,
  )
}

/**
 * 「在地图上取点」落点（plans/13 §3.3）。
 *
 * ## 三条约定
 * 1. **不反查地址**：逆地理编码要花配额，而"这个点在哪"用户自己知道（是他点的）。
 *    名字默认「地图取点」，面板里可以改。
 * 2. `kind: 'point'`、`poiId: ''`（见 `DayItem` 的字段注释）。
 * 3. 停留时长给一个中性默认 30 分钟 —— 它只是个起点，用户会改。
 *
 * ⚠️ 取到的点**大概率不在路上**：腾讯驾车算路会把它吸附到就近道路，
 *    **方圆 20 公里内没有可通行道路时直接算路失败**。所以算路失败的话术
 *    在 `wholeRoute.describeFailure` 里专门为这种点写了一句解释。
 */
export async function addPickedPoint(planId: string, lng: number, lat: number): Promise<void> {
  const store = usePlanStore.getState()
  const plan = store.plans.find((p) => p.id === planId)
  if (!plan) return
  /*
   * ★ uid **由这里生成**（而不是让 `appendStopToPlan` 自己造）：刚落到图上的这个点要
   *   **立刻打开改名输入框**，而"哪一行该打开"是靠 uid 认的（`planUi.freshPoint`）。
   *   不传就只能靠"前后 diff 找新 uid"去猜 —— 那种写法会静默失效。
   */
  const uid = newUid('it')
  const stop: NewStop = {
    uid,
    kind: 'point',
    poiId: '',
    name: DEFAULT_POINT_NAME,
    lng,
    lat,
    cityId: plan.cityId,
    dwellMinutes: 30,
  }
  // ★ 走**唯一入口**（含重复校验）：同一条规划里点到同一个位置两次，也要问一句
  const r = await addStopToPlan(planId, stop)
  /*
   * 「刚落下 ⇒ 输入框自动打开」只在**真写进去**时打标。
   * 走到"问重复"那条路时还没写库，而且用户确认要加的那一条**本来就在行程里**
   * （名字早就有了）—— 给它自动开一个改名框反而是噪音。
   */
  if (r === 'added') usePlanUi.getState().setFreshPoint(uid)
}

async function run(poiId: string, cityId: string, poi?: Poi): Promise<void> {
  const ui = usePlanUi.getState()
  await usePlanStore.getState().load()

  if (usePlanStore.getState().status === 'unavailable') {
    ui.showToast('本地数据库不可用，路线规划用不了（地图与景点详情不受影响）')
    return
  }

  let full = poi
  if (!full) {
    const city = await loadCity(cityId)
    full = city?.pois.find((p) => p.id === poiId)
  }
  if (!full) {
    ui.showToast('读不到这个景点的数据，没法添加行程')
    return
  }

  const stop = toStop(full, cityId)

  /*
   * ★★ **正在看那条规划（且同城）⇒ 直接加，不弹窗**（2026-09-28 用户定）。
   *
   * 用户原话：「如果打开了路线规划的详情页面，景点详情的添加行程按钮改一下，
   *   改成**添加到当前行程**，前提是景点和规划是同一个城市，才显示这个，点击后，
   *   **不出弹窗**，直接添加到右侧的行程里面」。
   *
   * 加进**哪一天**：`planUi.detailDay`（面板上正看着的那一天）—— 与「挑景点」清单
   * 读的是同一个值，所以两边不可能各加一天。
   *
   * ★ 仍然走**唯一写入口** `addStopToPlan`：重复校验不绕。重复时照样会问一句 ——
   *   那和"选组弹窗"是两件事（前者是"你确定要两次吗"，后者是"加到哪条"）。
   */
  const cur = currentPlanForCity(cityId)
  if (cur) {
    const day = usePlanUi.getState().detailDay
    await addStopToPlan(cur.id, stop, day - 1)
    return
  }

  /*
   * 其余情况**一律弹窗**（2026-09-26 用户定）。
   *
   * 三级短路（正打开着同城的组就直接加 / 同城只有一条也直接加 / 一条都没有就自动新建）
   * 已经被否掉：它们的问题是**同一个按钮在不同状态下干不同的事，而用户看不到任何区别**。
   * ⇒ 只做"把要加的东西准备好"，剩下的交给弹窗（含"一个组都还没有"的情况，
   *   那时弹窗里只有「新建规划」这一条路，看得见、说得清）。
   */
  ui.openAddPicker(stop)
}

/**
 * 「**当前正在看的那条规划**」—— 面板开着 + 处于详情态 + **与这个景点同城**，三条都满足才非空。
 *
 * ## 它决定两件事（用户 2026-09-28 定）
 * 1. 景点详情那个按钮**写什么**（「添加到当前行程」还是「添加行程」）；
 * 2. 点下去**弹不弹窗**（不弹 —— 直接加进这条规划的当前天）。
 *
 * ## 为什么三条缺一不可
 * · 面板没开 ⇒ 用户根本没在看哪条行程，不该替他决定加到谁那儿；
 * · 面板开着但在**列表态**（还没点进某条）⇒ 同上，没有"当前"可言；
 * · **城市不同** ⇒ 那条规划的时间链靠该城的通勤矩阵算，跨城的点会让它算不出来
 *   （所以那种情况下按钮也不许写"添加到当前行程"）。
 *
 * ★ 纯函数版（读 store 快照）与 hook 版**同一条判据**、两处用法不同：
 *   `run()` 要的是"点下去那一刻"的答案，视图要的是"每次渲染都跟着变"的答案。
 */
export function currentPlanForCity(cityId: string): RoutePlan | null {
  if (!usePlanUi.getState().panelOpen) return null
  const store = usePlanStore.getState()
  if (!store.activeId) return null
  const plan = store.plans.find((p) => p.id === store.activeId) ?? null
  return plan && plan.cityId === cityId ? plan : null
}

/**
 * 上面那个判据的**订阅版** —— 给按钮文案用。
 * ★ 必须订阅而不是调一次纯函数：面板一开一关、切到别的组、切到别的天，
 *   按钮上的字都要跟着变 —— 否则会出现"按钮写着『添加到当前行程』、而其实不在看任何一条"。
 */
export function useCurrentPlanForCity(cityId: string): RoutePlan | null {
  const panelOpen = usePlanUi((s) => s.panelOpen)
  const activeId = usePlanStore((s) => s.activeId)
  const plans = usePlanStore((s) => s.plans)
  return useMemo(() => {
    if (!panelOpen || !activeId) return null
    const plan = plans.find((p) => p.id === activeId) ?? null
    return plan && plan.cityId === cityId ? plan : null
  }, [panelOpen, activeId, plans, cityId])
}

/** 按钮上该写什么 —— **一处决定**，四个调用点共用（别各写一遍三元） */
export function addToPlanLabel(cur: RoutePlan | null): string {
  return cur ? '添加到当前行程' : '添加行程'
}

/**
 * 视图侧拿到的就是它。★ 用 `useCallback` 包一层只为保持引用稳定
 * （它会被当作 `onAddToPlan` 传进 `PoiList` 等组件的 props）。
 */
export function useAddToPlan(): AddToPlan {
  return useCallback<AddToPlan>((poiId, cityId, poi) => {
    void run(poiId, cityId, poi)
  }, [])
}
