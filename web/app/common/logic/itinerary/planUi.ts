/**
 * 规划功能的**交互态** —— 面板开没开 / 正在往哪条里加 / 是否在取点。
 *
 * ## 为什么不并进 `planStore`
 * `planStore` 管的是**数据**（记录本体、读写、迁移），它要能被"没有界面"的地方用
 * （地图侧、以后的导入导出、自动化验收）。这些字段反过来只对界面有意义 ——
 * 混在一起之后，任何一次 `plans` 变更都会连"面板开没开"一起广播出去。
 *
 * ## 为什么不用 React state 放在某个组件里
 * 触发点和使用点**不在同一棵子树**：点「路线规划」的是顶栏（每个页面各渲染一份），
 * 点「添加行程」的是城市页清单 / 详情页 / 首页 / 省级页**四个地方**，
 * 而面板长在 `routes/map-shell.tsx`（全站唯一一份）。要串起来只能走全局。
 */

import { create } from 'zustand'

import { patchPlanUi, readUiState } from '~/common/data/uiState'
import type { JamSpan } from './jams'
import { usePlanStore } from './planStore'
import type { NewStop } from './planStops'
import type { TravelMode } from '~shared/schema'

/**
 * 「这一站已经在了」的确认载荷。
 * ★ 单独导出成类型而不是让调用方写 `NonNullable<ReturnType<...>>` ——
 *   那种写法读起来像噪音，而且 store 一改名就散得到处都是。
 */
export interface DupConfirmPayload {
  planId: string
  planName: string
  stop: NewStop
  /** 已经在的第几站（1 起）。提示里要说清"它现在是第 N 条明细" */
  index: number
}

/**
 * 「挑景点」浮层的载荷（`common/ui/plan/SpotPicker`）。
 *
 * ## 为什么它取代了"跳转到城市页"（2026-09-27 用户定）
 * 原来「添加景点」在"当前不在那座城"时 `navigate('/city/<id>')`，用户的原话是
 * 「改成不跳链接，左侧打开对应城市的景点列表」。可左侧那份清单只长在**城市页**上
 * （首页 / 省级页 / 点位详情页都没有），所以这里存的不是"要跳去哪"，
 * 而是"要给哪条规划、哪座城挑景点" —— 清单由外壳浮出来。
 *
 * ★ **没有 `day` 字段**（2026-09-28 收口）：加入的目标天一律读 `detailDay`
 *   （"面板上正看着的那一天"）。以前这里另存一份 `day`，于是同一个概念有两份状态，
 *   切天时要记得同步两处 —— 那正是"逻辑上重复"的来源。
 */
export interface SpotPickerRequest {
  planId: string
  cityId: string
}

/**
 * 展开的那一段（`PlanUiState.legFocus` 的载荷）。
 *
 * 坐标用 `{ lng, lat }` 而不是地图层的 `RoutePoint` —— UI 状态层**不 import 地图层**，
 * 而两者结构本来就一样（`RoutePoint` 也是这两个字段）。
 */
export interface LegFocusPayload {
  /** 段起点 stop 的 uid */
  uid: string
  mode: TravelMode
  /** 该方式下的多条候选路线（已解码） */
  routes: Array<{
    key: string
    mode: TravelMode
    path: Array<{ lng: number; lat: number }>
    /**
     * ★ 公交/地铁的**分段**（步行一条 + 每条线路各一条，各带**线路官方色**）。
     * 其余方式没有（它们本来就只有一根折线）—— 地图据此决定"一根线"还是"分段画"。
     */
    segments?: Array<{
      kind: 'walk' | 'ride'
      path: Array<{ lng: number; lat: number }>
      color?: string
    }>
    /**
     * 拥堵切片（**该方案自己的 `path`** 的下标区间）。
     * ★ 只有"点开这一段、真拉过"才有 —— 它跟着实时路况走，十分钟就过期，所以不落盘。
     * ★ 公交/地铁为空：它们的 path 是多段拼接的，接口下标对不上。
     */
    jams?: JamSpan[]
  }>
  /** 用户选中的那条（`null` = 还没选，此时所有候选一样淡） */
  focusedKey: string | null
  from: { lng: number; lat: number }
  to: { lng: number; lat: number }
}

export interface PlanUiState {
  /** 右侧「路线规划」浮层是否打开 */
  panelOpen: boolean
  /**
   * 「添加行程」选择器要加的那一站（非空 = 显示选择器）。
   *
   * ★ **现在是每一次添加都弹**（2026-09-26 用户定：同一个按钮的行为必须永远一样）。
   *   这里只存"弹窗要加的那一站"，判断在 `useAddToPlan` 里。
   */
  addPicker: NewStop | null
  /**
   * 地图取点模式：非空 = 正在为这条规划取点（光标变十字 + 顶部提示 + Esc 退出）。
   * ★ 存 `planId` 而不是一个布尔：取点结束时要写回**哪条**规划，靠它定位。
   */
  picking: { planId: string } | null
  /**
   * 操作反馈。★ 刻意做成"一句话 + 可选的打开动作"而不是通用 toast 系统 ——
   *   规划这边的反馈只有一种需求：**告诉用户刚才那一下加到哪去了**，
   *   而"加到哪去了"必须给一条能点开的路径，否则他得自己去列表里找。
   *
   * ★ 2026-10-28：加了 `autoHideMs`，因为**非规划**的一句话提示也走这儿了
   *   （点到一个没有收录景点的区 → 「温江区暂无收录景点」）。那种提示**必须自己消失**：
   *   它说的是"这一下没成"，用户接着点别处时它还挂着就是噪音。
   *   而"加到哪去了"/"存库失败"这类**不能**自动消失 —— 用户可能正低头看列表。
   *   所以判据不是"有没有 planId"，而是调用方显式传不传 `autoHideMs`（见 `hint()`）。
   */
  toast: { text: string; planId?: string; autoHideMs?: number } | null
  /**
   * 「这一站已经在里面了，还要再加吗？」（非空 = 显示确认卡）。
   *
   * ## 为什么要拦一下
   * 用户在两个地方翻景点、或点两次「添加行程」时，很容易把同一个点排进同一条组里。
   * 加了两次的后果不是"多一份"这么轻：**路线会绕回去**（A→B→C→A→B），
   * 距离与时间都会被算成两倍，而排出来的行程看着完全正常。
   *
   * ## 为什么不是"静默拒绝"
   * 重复点**有时候是故意的**（同一个地方去两次：白天看展、晚上看灯）。
   * 所以是"问一句"，不是"不许" —— 拒绝的话用户没有任何办法表达"我就要两次"。
   * 同理也不能静默添加：那样用户永远不会发现自己的路线被自己排成了一个圈。
   */
  dupConfirm: DupConfirmPayload | null
  /**
   * 「挑景点」浮层：非空 = 它开着（内容是这座城的景点清单）。
   * 载荷的语义见 `SpotPickerRequest`。★ 它由**外壳**渲染 —— 触发点在规划面板里，
   * 而面板与页面可能不在同一棵子树下（面板挂在外壳上）。
   */
  spotPicker: SpotPickerRequest | null
  /**
   * **面板上正看着的那一天**（1 起）。2026-09-28 加，是全站唯一的"当前天"。
   *
   * ## 为什么它必须住在全局
   * 三处都要问"加进哪一天"：面板自己的标签栏（切天）、「挑景点」清单（加入）、
   * 景点详情的「添加到当前行程」（直接加）。而**真源**在 `useItineraryStore`
   * （面板副本）里，页面与外壳都拿不到 ⇒ 由 `PlanDetailView` 在 `activeDay`
   * 变化时同步到这里。
   *
   * ★ 以前「挑景点」自己存了一份 `day`（打开那一刻的快照 + 切天同步），
   *   等于同一个概念两份状态 —— 用户 2026-09-27 说的「逻辑上有点重复了」。
   */
  detailDay: number

  /**
   * **出行方式面板展开的那一段** —— 地图侧靠它画候选路线 + 取景到两端。
   *
   * ## 为什么放在这里（而不是详情组件直接传给图层）
   * 图层（`usePlanRouteLayer`）挂在**外层** `RoutePlanPanelBody` 上 ——
   * 因为列表态也要画整条路线 —— 而"展开了哪一段"只有详情态知道。
   * 两边不是父子，只能借这座桥。
   *
   * ★ **不落盘**（`readUiState` 不认它）：刷新之后没有"展开的段"可言，
   *   留着会让地图一进来就画一堆候选线。
   */
  legFocus: LegFocusPayload | null
  setLegFocus: (v: LegFocusPayload | null) => void

  /**
   * 本次会话里**刚在地图上落下的那个取点**（`DayItem.uid`），没有就是 `null`。
   *
   * ## 它只干一件事：让那一行的**改名输入框自动打开**
   * > 用户 2026-09-28：「只有第一次在地图上选点，就显示输入框，**刷新之后就不显示了**」
   *
   * ★ **只活在内存里、不落盘** —— 这正是"刷新之后不显示"的实现方式：
   *   刷新后这个字段回到 `null`，那一行就显示「名字 + 编辑图标」两态里的前者。
   *   （若把它写进 `DayItem`，刷新后输入框还会自己弹出来，与要求相反。）
   * ★ **只记最后一个**：连着落两个点时，前一个自动收起 —— 它已经不再"刚落下"。
   * ★ 用户点 ✓ / `Esc` 收起那一行时清掉它（`PointNameField` 里）。
   */
  freshPoint: string | null

  openPanel: () => void
  closePanel: () => void
  togglePanel: () => void
  showToast: (text: string, planId?: string) => void
  /**
   * 一句话提示，**到点自己消失**（`autoHideMs`）。
   * 用于"这一下为什么没成"（点了 0 景点的区 / 搜到没有收录景点的地方）；
   * 有结果、需要用户去处理的那类走 `showToast`（不自动消失）。
   */
  hint: (text: string) => void
  clearToast: () => void
  openAddPicker: (stop: NewStop) => void
  closeAddPicker: () => void
  openDupConfirm: (v: DupConfirmPayload) => void
  closeDupConfirm: () => void
  openSpotPicker: (req: SpotPickerRequest) => void
  closeSpotPicker: () => void
  /** 面板上换了天 —— 全站的"当前天"跟着走（没有面板在时也照记，不报错） */
  setDetailDay: (day: number) => void
  /** 记下"刚落到图上的那个取点"（`null` = 收起来 / 没有） */
  setFreshPoint: (uid: string | null) => void
  startPicking: (planId: string) => void
  stopPicking: () => void
}

export const usePlanUi = create<PlanUiState>((set) => {
  /**
   * 初值从**会话状态**来 —— 刷新之后「面板开着、看着哪条、第几天」还在。
   * （「关掉标签页再打开」时 sessionStorage 已清空 ⇒ 回到初始，正是用户要的。）
   * ▲ `activeId` 存在 `planStore` 里，它自己也从同一份状态取初值。
   */
  const saved = readUiState().plan

  return {
    panelOpen: saved.open,
    addPicker: null,
    picking: null,
    toast: null,
    dupConfirm: null,
    // ★ 这几个**故意不恢复**：搜索命中 / 挑景点 / 加到哪个规划 / 重复确认 / toast /
    //   取点进行中 / 刚落下的取点 —— 都是"某一次交互"的中间态，刷新清掉才对
    spotPicker: null,
    detailDay: saved.day,
    freshPoint: null,
    legFocus: null,

    openPanel: () => {
      set({ panelOpen: true })
      patchPlanUi({ open: true })
    },
    closePanel: () => {
      set({ panelOpen: false })
      patchPlanUi({ open: false })
    },
    togglePanel: () => {
      set((s) => {
        patchPlanUi({ open: !s.panelOpen })
        return { panelOpen: !s.panelOpen }
      })
    },
    showToast: (text, planId) => set({ toast: planId ? { text, planId } : { text } }),
    /**
     * 一句话提示，**到点自己消失**。
     *
     * ★ 与 `showToast` 的分工：这里是"告诉你刚才那一下为什么没成"（点空区、搜到空地），
     *   读完就走；`showToast` 是"结果 + 去哪看"，必须留到用户处理完。
     */
    hint: (text) => set({ toast: { text, autoHideMs: 4200 } }),
    clearToast: () => set({ toast: null }),
    openAddPicker: (stop) => set({ addPicker: stop }),
    closeAddPicker: () => set({ addPicker: null }),
    openDupConfirm: (v) => set({ dupConfirm: v }),
    closeDupConfirm: () => set({ dupConfirm: null }),
    openSpotPicker: (req) => set({ spotPicker: req }),
    closeSpotPicker: () => set({ spotPicker: null }),
    setDetailDay: (day) => {
      set({ detailDay: day })
      patchPlanUi({ day })
    },
    setFreshPoint: (uid) => set({ freshPoint: uid }),
    setLegFocus: (v) => set({ legFocus: v }),
    startPicking: (planId) => set({ picking: { planId } }),
    stopPicking: () => set({ picking: null }),
  }
})

/**
 * 打开某条规划的详情（并保证面板是开着的）。
 *
 * ★ 两个 store 一起写，所以做成函数而不是 store 动作 ——
 *   放在任一 store 里都会让另一个变成它的依赖，而 `planStore` 必须保持"无界面依赖"。
 */
export function openPlanDetail(planId: string): void {
  usePlanStore.getState().setActive(planId)
  // ★ 走动作而不是 `setState`：面板开关的**写回**（会话状态）都长在动作里，
  //   绕过它就会出现"面板开着、刷新后却是关的"
  usePlanUi.getState().openPanel()
}

/**
 * 退回列表态（清掉"当前打开的那条"，**面板不关**）。
 *
 * ★★ **详情态专属的状态，退出时要一起带走**（用户 2026-10-05 报的 bug）。
 * > 「在路线规划详情里点开了路线，**没有点收起**，而是点了**左上角那个返回**，
 * >   这种情况下地图上的路线还是会显示，只有再点顶部的路线规划才会隐藏」
 *
 * 判据是「**它的唯一入口在不在这块视图里**」。四个都属于这一类：
 *
 * | 状态 | 入口 / 消费者 | 不清的后果 |
 * |---|---|---|
 * | `legFocus` | 详情态展开某一段 → 地图画候选路线 | 线**残留**；且面板重开时**复发** |
 * | `picking` | 详情态「在地图上取点」 | 十字光标 + 提示浮层挂着、点地图继续落点，而"取消"按钮已不在面板上 |
 * | `freshPoint` | 详情态落点 → 自动开改名输入框 | **重进详情，输入框又自己弹开** |
 * | `spotPicker` | 详情态「添加景点」（浮层挂在外壳上） | 浮层残留，还列着上一座城的清单 |
 *
 * ## 为什么清在这里（而不是靠组件卸载）
 * `legFocus` 原来只有 `PlanDetailView` 里一个 effect 会清，而它**只在自身重跑时**清
 * （= 用户主动收起某一段）；"点返回"是让整个详情态**卸载** ⇒ 卸载时它不重跑 ⇒ 没人清。
 * 而退回列表态时**面板还开着**（图层仍在）⇒ 地图照旧按 `legFocus` 画那条线；
 * 关掉面板图层才销毁（用户看到的"再点顶部才隐藏"），但**脏状态一直在 store 里**
 * ⇒ 下次打开面板又画出来。
 * ⇒ 出口只有这一个函数，清在这里最明确（`PlanDetailView` 的卸载清理是第二道）。
 *
 * ★ `freshPoint` 上一版被判定为"不需要清：它在列表态没有消费者，无害" —— **错了**。
 *   消费者（`PointNameField`）确实只在详情态渲染，但**它读的就是这个字段** ⇒
 *   退回再进自然又读到。判"要不要清"不能看"有没有消费者"，
 *   要看"**这个值会不会被下一次进入读到**"。
 */
export function closePlanDetail(): void {
  usePlanStore.getState().setActive(null)
  const ui = usePlanUi.getState()
  ui.setLegFocus(null)
  ui.stopPicking()
  ui.setFreshPoint(null)
  ui.closeSpotPicker()
}
