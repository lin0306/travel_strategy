/**
 * 规划记录 store —— **多条路线规划**，落 IndexedDB（plans/13 §3.4 / §4）。
 *
 * ## 它和「行程 store」（`./store`）是什么关系
 * 不是两套东西。**一条规划 = 一份行程**：
 * | | `./store`（旧） | 本模块（新） |
 * |---|---|---|
 * | 粒度 | 一座城市一份 | 一份全局列表，每条带 `cityId` |
 * | 存储 | `localStorage[chexing:itin:<cityId>]` | IndexedDB 的 `plans` store |
 * | 依据 | `init(cityId)` 从路由参数取城 | 打开哪条规划，就用哪条的 `cityId` |
 *
 * 所以 `days` / `stays` / `chosenOption` 的**结构一字没改**，改的只是容器与落盘媒介。
 * 时间链、过载提示、分享导出全都照旧能吃这份数据。
 *
 * ## 为什么必须是全局列表（而不是"本城的规划"）
 * ① 入口按钮挂在顶栏 —— 首页是"全国"视角，那里**没有**当前城市；
 * ② 用户说"按最近规划时间排序"，这个诉求本身就暗示它们被放在一起比；
 * ③ 同时排成都和重庆两条线是完全正常的用法。
 *
 * ## 三条实现约定
 * 1. **只有「可用 / 不可用」**（用户 2026-09-25 定，plans/13 §4.2）：IDB 打不开就
 *    老实说"规划不可用"，**不退回 localStorage、也不进内存态** ——
 *    第二套持久化路径要连读写 / 上限 / 清理 / 迁移一起维护两遍，复杂度是实的、收益是负的。
 * 2. **先校验再改内存**：`update` 拿到的新记录先过 `RoutePlanSchema`，
 *    不合法就**内存也不动** —— 否则内存里会留一条永远写不进磁盘的"幽灵规划"。
 * 3. **写失败不退内存，只如实报错**：与约定 2 不矛盾 —— 校验失败是"这份数据本身不对"
 *    （用户的输入有问题，不该假装成功），写失败是"数据对但没存住"（配额满 / 事务失败），
 *    此时**收起用户的改动反而更糟**，正确的做法是留住它并明说「刷新后会丢」。
 */

import { create } from 'zustand'

import {
  RoutePlanSchema,
  type ItineraryDay,
  type PlanRoute,
  type RoutePlan,
  type Stay,
  type TravelMode,
} from '~shared/schema'

import { deletePlan, getAllPlans, isIdbAvailable, putPlan } from '~/common/data/idb'
import { patchPlanUi, readUiState } from '~/common/data/uiState'

import { emptyDay } from './emptyDay'
import { migrateLegacyItineraries } from './planMigrate'

/* ────────────────────────────────────────────────
 * 状态
 * ────────────────────────────────────────────── */

export type PlanStoreStatus =
  /** 还没读完（首屏的中间态，UI 应当复用它已经有的「行程加载中」占位屏） */
  | 'loading'
  /** 读完了。`plans` 可能是空数组 —— 那是"还没有规划"，不是错误 */
  | 'ready'
  /** 本地数据库用不了。★ 与 `ready` + 空列表**必须分开渲染**，文案完全不同 */
  | 'unavailable'

export interface PlanCreateInit {
  cityId: string
  name?: string
  mode?: TravelMode
  stays?: Stay[]
  days?: ItineraryDay[]
}

/**
 * `update` 能改的字段。★ 刻意**不含** `id` / `createdAt` —— 它们不是"编辑"的对象。
 *
 * ## `cityId` 是特例：**只允许"从空设成非空"**（2026-09-26）
 * 用户要求「新建组不管什么情况下都能点」 ⇒ 首页 / 省级页（没有城市上下文）也能建组，
 * 那种组先落成「城市未定」（`cityId === ''`），**由它的第一条明细决定属于哪座城**
 * （明细自带 `cityId`）。
 *
 * 但**已经定下的城市不许改**：时间链、住宿锚点、通勤矩阵全绑在它上面，
 * 半路改城市等于把那条规划算过的所有东西悄悄作废。守卫写在 `update` 里。
 */
export type PlanPatch = Partial<{
  name: string
  cityId: string
  mode: TravelMode
  chosenOption: Record<string, string>
  stays: Stay[]
  days: ItineraryDay[]
  route: PlanRoute | null
}>

export interface PlanState {
  /** 全部规划，**按 `updatedAt` 倒序**（= 用户说的"最近规划时间"） */
  plans: RoutePlan[]
  status: PlanStoreStatus
  /** 不可用 / 读写失败的原因。非空时 UI 必须如实显示，不许吞 */
  error: string | null
  /** 当前打开的那条（右侧面板由"列表态"切到"详情态"）。`null` = 只看列表 */
  activeId: string | null
  /**
   * **数据版本号**：每次成功写入 +1。
   *
   * ★ 它是"别的地方改了这条规划"给完整行程页的信号。行程页把规划内容装进自己的
   *   store 编辑（`useItineraryStore`），如果只按 `plan.id` 判断要不要重新装载，
   *   那么在右侧面板里加一个点、左边的行程页**不会变**（而且不报错）。
   *   行程页记下"我自己那次写入造成的 rev"，只对别人的变更重新装载 ——
   *   否则它会把自己每敲一下都当成外部变更，光标都保不住。
   */
  rev: number

  /** 读一次。**幂等**：已 `ready` 就直接返回；并发调用共用同一次读取 */
  load: () => Promise<void>
  /** 新建。**写不进去就返回 `null` 且不入内存** —— 建一条刷新即消失的规划比失败更糟 */
  create: (init: PlanCreateInit) => Promise<RoutePlan | null>
  update: (id: string, patch: PlanPatch) => Promise<boolean>
  /** 复制一份（"在成都这条的基础上再排一条"） */
  duplicate: (id: string) => Promise<RoutePlan | null>
  remove: (id: string) => Promise<boolean>
  setActive: (id: string | null) => void
  /** 清掉错误提示（用户看过之后） */
  clearError: () => void
}

/* ────────────────────────────────────────────────
 * 工具
 * ────────────────────────────────────────────── */

let planSeq = 0
/** 本地唯一 id。时间戳 + 自增序号：同一毫秒内连建两条也不会撞 */
function newPlanId(): string {
  planSeq += 1
  return `plan-${Date.now().toString(36)}-${planSeq.toString(36)}`
}

/** 倒序：最近动过的排最前。`updatedAt` 相同时比 `createdAt`，保证**稳定**（不靠引擎实现） */
function sortPlans(plans: RoutePlan[]): RoutePlan[] {
  return [...plans].sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt)
}

const ERR_UNAVAILABLE = '当前浏览器不允许使用本地数据库（IndexedDB），路线规划无法使用'
const ERR_READ = '读取本地规划记录失败'
const ERR_WRITE = '规划没能保存到本地数据库（可能是存储空间不足），这次改动刷新后会丢失'
const ERR_INVALID = '规划数据不完整，已放弃这次改动'

/* ────────────────────────────────────────────────
 * Store
 * ────────────────────────────────────────────── */

/** 并发 `load()` 共用同一次读取（两个组件在同一个 tick 里 mount 时很常见） */
let inflightLoad: Promise<void> | null = null

export const usePlanStore = create<PlanState>((set, get) => ({
  plans: [],
  status: 'loading',
  error: null,
  /**
   * 「当前打开的是哪一条」—— 初值从**会话状态**来：刷新之后还停在同一条上。
   * ★ 指向的记录要等 `load()` 从 IDB 读回来才存在；读之前 `selectActivePlan()`
   *   返回 `null`（面板显示列表态），读完自然接上 —— 不需要额外的等待逻辑。
   */
  activeId: readUiState().plan.activeId,
  rev: 0,

  load: async () => {
    if (inflightLoad) return inflightLoad
    if (get().status === 'ready') return
    inflightLoad = (async () => {
      set({ status: 'loading', error: null })

      // ── ① 存储可用吗 ──
      if (!(await isIdbAvailable())) {
        set({ status: 'unavailable', error: ERR_UNAVAILABLE, plans: [], activeId: null })
        return
      }

      // ── ② 旧行程迁进来（幂等，只做一次；失败也不影响下面读库）──
      await migrateLegacyItineraries()

      // ── ③ 读数 ──
      const raw = await getAllPlans<RoutePlan>()
      if (raw === null) {
        // 探测说可用、读却说不行 —— 与"不可用"分开措辞，因为处理办法不一样
        set({ status: 'unavailable', error: ERR_READ, plans: [], activeId: null })
        return
      }

      /*
       * ── ④ 逐条校验 ──
       * ★ **一条坏记录只丢它自己**，不许拖累整张表：用户宁可少看到一条规划，
       *   也不能因为手改坏的一条而打不开列表（而那正是他查看其它规划的入口）。
       */
      const plans: RoutePlan[] = []
      let bad = 0
      for (const item of raw) {
        const r = RoutePlanSchema.safeParse(item)
        if (r.success) plans.push(r.data)
        else bad += 1
      }
      if (bad > 0) console.warn(`[planStore] 有 ${bad} 条规划记录未通过校验，已忽略`)

      set({ plans: sortPlans(plans), status: 'ready', error: null })
    })().finally(() => {
      inflightLoad = null
    })
    await inflightLoad
  },

  create: async (init) => {
    const now = Date.now()
    const plan: RoutePlan = {
      id: newPlanId(),
      name: init.name?.trim() || '未命名规划',
      cityId: init.cityId,
      createdAt: now,
      updatedAt: now,
      mode: init.mode ?? 'driving',
      chosenOption: {},
      stays: init.stays ?? [],
      // ★ 至少一天：`days: []` 会让所有"第 1 天"的读取拿到 undefined
      days: init.days && init.days.length > 0 ? init.days : [emptyDay()],
      route: null,
    }

    const parsed = RoutePlanSchema.safeParse(plan)
    if (!parsed.success) {
      console.warn('[planStore] 新建的规划未通过校验：', parsed.error.issues)
      set({ error: ERR_INVALID })
      return null
    }
    // ★ 建不进去就不入内存：一条刷新即消失的规划比"新建失败"更让人困惑
    if (!(await putPlan(parsed.data))) {
      set({ error: ERR_WRITE })
      return null
    }
    set((s) => ({ plans: sortPlans([...s.plans, parsed.data]), error: null, rev: s.rev + 1 }))
    return parsed.data
  },

  update: async (id, patch) => {
    const current = get().plans.find((p) => p.id === id)
    if (!current) return false

    const next: RoutePlan = {
      ...current,
      ...patch,
      // 这些不是"编辑"的对象，patch 里就算带了也不许改
      id: current.id,
      createdAt: current.createdAt,
      /*
       * ★ `cityId` 只允许**从空设成非空**（首条明细认领这座城市）。
       *   已经是某座城了就原样保留 —— 见 `PlanPatch` 的注释。
       */
      cityId: !current.cityId && patch.cityId ? patch.cityId : current.cityId,
      // ★ 每次改动都算一次"规划动作" —— 记录列表按它排序，不bump就等于改完沉底
      updatedAt: Date.now(),
    }

    // ── 先校验、再动内存（见文件头约定 2）──
    const parsed = RoutePlanSchema.safeParse(next)
    if (!parsed.success) {
      console.warn('[planStore] 规划未通过校验，已放弃这次改动：', parsed.error.issues)
      set({ error: ERR_INVALID })
      return false
    }
    const record = parsed.data

    set((s) => ({
      plans: sortPlans(s.plans.map((p) => (p.id === id ? record : p))),
      error: null,
      rev: s.rev + 1,
    }))

    // ── 再落盘。写失败**不回滚内存**（约定 3），只把话说清楚 ──
    if (!(await putPlan(record))) {
      set({ error: ERR_WRITE })
      return false
    }
    return true
  },

  duplicate: async (id) => {
    const src = get().plans.find((p) => p.id === id)
    if (!src) return null
    const created = await get().create({
      cityId: src.cityId,
      name: `${src.name} 副本`,
      mode: src.mode,
      stays: src.stays,
      days: src.days,
    })
    if (!created) return null
    // `chosenOption` 与 `route` 也照抄 —— 副本的意义就是"接着改"，不是"从零再排"
    await get().update(created.id, { chosenOption: { ...src.chosenOption }, route: src.route })
    return get().plans.find((p) => p.id === created.id) ?? created
  },

  remove: async (id) => {
    if (!(await deletePlan(id))) {
      set({ error: '删除规划失败，请重试' })
      return false
    }
    set((s) => ({
      plans: s.plans.filter((p) => p.id !== id),
      // ★ 删掉的正好是打开着的 → 退回列表态，否则右侧面板会挂在一个不存在的 id 上
      activeId: s.activeId === id ? null : s.activeId,
      error: null,
      rev: s.rev + 1,
    }))
    // 打开的那条被删了也要跟着写回，否则刷新后会话状态里还挂着它
    if (get().activeId !== id) patchPlanUi({ activeId: get().activeId })
    else patchPlanUi({ activeId: null })
    return true
  },

  setActive: (id) => {
    set({ activeId: id })
    patchPlanUi({ activeId: id })
  },
  clearError: () => set({ error: null }),
}))

/* ────────────────────────────────────────────────
 * 派生（放这里而不是散在组件里，保证口径唯一）
 * ────────────────────────────────────────────── */

/** 当前打开的那条。`activeId` 指向不存在的记录时返回 `null`（不许抛） */
export function selectActivePlan(state: PlanState): RoutePlan | null {
  if (!state.activeId) return null
  return state.plans.find((p) => p.id === state.activeId) ?? null
}

/*
 * 「摊平途经点 / 换序 / 删除 / 追加」这些**纯编辑函数**都在 `./planStops` ——
 * 它们同时被右侧面板、地图侧、完整行程页用到，留在这里会让本文件既管存储又管编辑。
 */
