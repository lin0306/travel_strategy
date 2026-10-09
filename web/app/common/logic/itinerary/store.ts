/**
 * 行程状态（Zustand）。
 *
 * ## ★ 它现在往哪写（2026-09-26 改）
 * 从「`localStorage` 一城一份」换成「**IndexedDB 里的那条规划**」（plans/13 §3.4）。
 * 容器与媒介都变了，但 `days` / `stays` / `chosenOption` 的结构**一字未改** ——
 * 所以时间链推导、过载提示、分享导出照旧吃这份数据。落盘见文件末尾的 `persist()`。
 *
 * ## 存放边界（02 文档 4·B 节）
 * 行程是**用户产物**，不是仓库数据：只存本机，不上传、不进 URL
 * （除非用户主动点分享，且住宿点默认脱敏）。所以这里的一切都不参与 `data/` 的产出。
 *
 * ## 三条实现约束
 * 1. 写入前过 Zod —— 在 `planStore.update` 里做（本模块不再自己写存储，就不必自己校验）
 * 2. **必须挂在某条规划上**（`attach`）才会落盘，否则只改内存（见 `persist`）
 * 3. **删住宿段要挡引用** —— 删掉仍被某天使用的住宿段，时间链会直接算不出来
 */

import { create } from 'zustand'

import type { ItineraryDay, RoutePlan, Stay, TransitPrefer, TravelMode } from '~shared/schema'

import { STORAGE_KEYS, pruneLru, readJson, writeJson } from '~/common/data/storage'

import { emptyDay } from './emptyDay'
import { makeItemActions } from './storeItems'
import { makeDayActions } from './storeDays'
import { newUid } from './ids'
import { usePlanStore } from './planStore'
import type { CachedLeg } from './resolveLeg'
import { mergeItinerary } from './share'

/* ────────────────────────────────────────────────
 * 工具
 * ────────────────────────────────────────────── */

/*
 * `newUid` 与 `emptyDay` 都搬去了同目录的小模块（`./ids` / `./emptyDay`），
 * 理由是同一个：`store ⇄ planStore` 不能在模块层互相 import。
 * `emptyDay` 照旧 re-export（对外门面不变）；`newUid` 是本模块内部用的工具，不导出。
 */
export { emptyDay } from './emptyDay'

/* ────────────────────────────────────────────────
 * Store
 * ────────────────────────────────────────────── */

export interface ItineraryState {
  cityId: string | null
  stays: Stay[]
  days: ItineraryDay[]
  defaultMode: TravelMode
  /** 当前查看第几天（1 起） */
  activeDay: number
  /** 当前展开方案卡的那一段 —— 值是**段起点 stop 的 uid**；'' 表示全收起 */
  activeLeg: string
  chosenOption: Record<string, string>
  legCache: Record<string, CachedLeg>
  /** 是否已从存储读过（避免 SSR/首帧误判"空行程"） */
  hydrated: boolean
  /** 分享链接解析失败的提示（非空时 UI 要给"手动添加点位"的入口，而不是空白页） */
  shareError: string | null

  /**
   * ★ 挂在哪条**规划记录**上（plans/13 §3.4）。`null` = 还没挂。
   *
   * 挂上之后，`persist()` 写的是 IndexedDB 里的那条规划，而不是
   * `localStorage[chexing:itin:<cityId>]` —— 容器从"一城一份"换成了"一份全局列表"。
   * 旧键保留不删（迁移是复制不是搬走），但本页不再写它。
   */
  planId: string | null
  /**
   * 我自己那次写入造成的 `planStore.rev`。
   * 用来区分"别的界面改了这条规划"与"我自己刚写的" —— 判错的后果见 `attach` 的注释。
   */
  ownRev: number

  // ── 生命周期 ──
  /** 把一条规划装进来（并让后续改动写回它）。`rev` 见 `planStore.rev` */
  attach: (plan: RoutePlan, rev: number) => void
  reset: () => void

  // ── 住宿段 ──
  addStay: (stay: Omit<Stay, 'id'> & { id?: string }) => Stay
  updateStay: (id: string, patch: Partial<Stay>) => void
  /** @returns 删除是否成功；失败原因写在 blockedReason 里 */
  removeStay: (id: string) => { ok: boolean; reason?: string }

  // ── 天数（实现在 storeDays.ts）──
  setDayCount: (n: number) => void
  /**
   * 删掉一整天（1 起）**连同那天的明细**。
   * ★ 语义由用户 2026-09-27 定：「连景点一起删掉，但是要有提示」——
   *   提示在 UI 层（天数标签栏的内联确认条），这里只负责删。
   */
  removeDay: (day: number) => void
  /** 把第 `from` 天挪到第 `to` 位（都 1 起）—— **明细跟着走**（天数标签拖拽排序用） */
  moveDay: (from: number, to: number) => void
  setStartTime: (day: number, time: string) => void

  // ── 点位 ──
  addPoi: (day: number, poiId: string, dwellMinutes: number) => void
  removeItem: (day: number, uid: string) => void
  /**
   * 给一站**改名**（天号 1 起 + uid）。
   * ★ 目前只有「地图取点」用得上：它的默认名就叫「地图取点」，用户改成真实叫法
   *   （"朋友家""那家面馆"）才有意义 —— 见 `StopTimeline` 标题行那个输入框。
   *   空名字直接忽略（不清成空标题）。
   */
  renameItem: (day: number, uid: string, name: string) => void
  /** 同一天内换序 */
  moveItem: (day: number, from: number, to: number) => void
  /** ★ 跨天移动 —— 调用方要先做住宿段校验（见 6.2） */
  moveItemToDay: (fromDay: number, uid: string, toDay: number) => void
  setDwell: (uid: string, minutes: number) => void
  setModeToNext: (uid: string, mode: TravelMode) => void
  /**
   * 公共交通的**偏好**（公交优先 / 地铁优先）。
   * ★ 传 `undefined` = **回到均衡**（字段被删掉，而不是存一个"均衡"值）。
   */
  setTransitPrefer: (uid: string, prefer: TransitPrefer | undefined) => void

  // ── UI 状态 ──
  setActiveDay: (day: number) => void
  setActiveLeg: (uid: string) => void
  setChosenOption: (uid: string, key: string) => void
  setDefaultMode: (mode: TravelMode) => void

  // ── 缓存 / 导入 ──
  cacheLeg: (key: string, entry: CachedLeg) => void
  importPayload: (p: { stays: Stay[]; days: ItineraryDay[] }) => void
  setShareError: (msg: string | null) => void
}

export const useItineraryStore = create<ItineraryState>((set, get) => ({
  cityId: null,
  stays: [],
  days: [emptyDay()],
  defaultMode: 'driving',
  activeDay: 1,
  activeLeg: '',
  chosenOption: {},
  legCache: {},
  hydrated: false,
  shareError: null,
  planId: null,
  ownRev: 0,

  /**
   * 把一条规划装进来（并让后续改动写回它）。
   *
   * ## 两道跳过守卫，缺一不可
   * ① **同一条规划 + `rev` 没变** ⇒ 什么都不做。
   *    少了它：每次重渲染都会重置 `activeDay` / `activeLeg`（用户刚切到第 3 天又被弹回第 1 天）。
   * ② **`rev === ownRev`** ⇒ 这次变更**是我自己写的**，别覆盖自己。
   *    少了它：每敲一下输入框就重新装载一次，输入框失焦、光标跳走。
   *
   * `rev` 由 `planStore` 在每次成功写入后 +1（见那里的注释）。这两条守卫合起来
   * 正好表达我们真正想要的语义：**只有"别人改了这条规划"才重新装载**。
   *
   * ★ `activeDay` 只在**换了一条规划**时才重置（2026-09-27 修，`_tmp/cdp_spotpicker_verify.mjs` 抓到）：
   *   同一条规划被"别人"改过（最常见的就是刚往某一天加了一个景点）时，
   *   用户在看的"第几天"不该被弹回第 1 天 —— 现象是"我在第 2 天连挑两个景点，
   *   第一个进去之后面板自己跳回第 1 天，第二个就加错天了"，而**全程不报错**。
   */
  attach: (plan, rev) => {
    const samePlan = get().planId === plan.id
    if (samePlan && rev === get().ownRev) return
    // 天数为空时补一天 —— `days: []` 会让所有"第 N 天"的读取拿到 undefined
    const days = plan.days.length > 0 ? plan.days : [emptyDay()]
    set({
      planId: plan.id,
      cityId: plan.cityId,
      stays: plan.stays,
      days,
      defaultMode: plan.mode,
      chosenOption: plan.chosenOption,
      // 段缓存是**全局**的（按两端点+方式寻址，与规划无关），所以在首次挂载时读一次即可
      legCache: get().legCache ?? readJson<Record<string, CachedLeg>>(STORAGE_KEYS.legCache) ?? {},
      // 同一条规划 ⇒ 留着用户在看的那一天（天数变少时钳一下，见文件头 ★）
      activeDay: samePlan ? Math.min(get().activeDay, days.length) : 1,
      activeLeg: '',
      hydrated: true,
      ownRev: rev,
      // 换规划之后上一份分享失败的提示就没意义了
      shareError: null,
    })
  },

  reset: () => {
    set({
      stays: [],
      days: [emptyDay()],
      activeDay: 1,
      activeLeg: '',
      chosenOption: {},
      shareError: null,
    })
    persist(get())
  },

  /* ── 住宿段 ────────────────────────────────── */

  addStay: (input) => {
    const stay: Stay = { ...input, id: input.id ?? newUid('stay') }
    set((s) => {
      const stays = [...s.stays, stay]
      // 新增住宿段后，把还没归属的天自动接到它身上 —— 否则用户要手动再点一次
      const days = s.days.map((d, i) => {
        const dayNo = i + 1
        if (d.stayId) return d
        if (dayNo >= stay.fromDay && dayNo <= stay.toDay) return { ...d, stayId: stay.id }
        return d
      })
      return { stays, days }
    })
    persist(get())
    return stay
  },

  updateStay: (id, patch) => {
    set((s) => ({ stays: s.stays.map((x) => (x.id === id ? { ...x, ...patch, id: x.id } : x)) }))
    persist(get())
  },

  removeStay: (id) => {
    const { days, stays } = get()
    const usedBy = days
      .map((d, i) => ({ d, dayNo: i + 1 }))
      .filter((x) => x.d.stayId === id)
      .map((x) => x.dayNo)

    // ★ 阻止删除仍被引用的住宿段（09 文档 6.2）
    if (usedBy.length > 0) {
      return { ok: false, reason: `第 ${usedBy.join('、')} 天正在使用这个住宿点，先改掉它们` }
    }
    if (stays.length <= 1) {
      return { ok: false, reason: '至少要保留一个住宿段 —— 行程的起终点都靠它' }
    }
    set((s) => ({ stays: s.stays.filter((x) => x.id !== id) }))
    persist(get())
    return { ok: true }
  },

  /* ── 天数（实现在 storeDays.ts，见那里的注释）── */

  ...makeDayActions(set, get, persist),

  /* ── 点位（实现在 storeItems.ts，见那里的注释）── */

  ...makeItemActions(set, get, persist),

  /* ── UI 状态（不落盘，切天/展开是临时视图状态）── */

  setActiveDay: (day) => set({ activeDay: day, activeLeg: '' }),
  setActiveLeg: (uid) => set((s) => ({ activeLeg: s.activeLeg === uid ? '' : uid })),
  setChosenOption: (uid, key) => {
    set((s) => ({ chosenOption: { ...s.chosenOption, [uid]: key } }))
    persist(get())
  },
  setDefaultMode: (mode) => {
    set({ defaultMode: mode })
    persist(get())
  },

  /* ── 缓存 / 导入 ───────────────────────────── */

  cacheLeg: (key, entry) => {
    set((s) => {
      const legCache = pruneLru({ ...s.legCache, [key]: entry })
      writeJson(STORAGE_KEYS.legCache, legCache)
      return { legCache }
    })
  },

  importPayload: ({ stays, days }) => {
    const merged = mergeItinerary({ stays: get().stays, days: get().days }, { stays, days })
    set({ stays: merged.stays, days: merged.days, shareError: null })
    persist(get())
  },

  setShareError: (msg) => set({ shareError: msg }),
}))

/**
 * 统一落盘入口 —— 所有会改变行程的动作都要调它。
 *
 * ## 从 localStorage 换成了 IndexedDB 里的那条规划（plans/13 §3.4）
 * | | 以前 | 现在 |
 * |---|---|---|
 * | 落到哪 | `localStorage[chexing:itin:<cityId>]` | IndexedDB 的 `plans` store 里 `planId` 那条 |
 * | 粒度 | 一城一份 | 一份全局列表中的一条 |
 *
 * ★ **不双写**：只写一个地方。两边都写看起来"更稳"，实际是"哪边对"变成运气问题。
 * ★ 没挂规划时**不落盘**（只改内存）：页面在没有规划时渲染的是"请先选一条"的占位屏，
 *   压根没有编辑入口，所以这条分支是防御性的，不是常态。
 */
function persist(
  s: Pick<ItineraryState, 'planId' | 'stays' | 'days' | 'defaultMode' | 'chosenOption'>,
): void {
  const planId = s.planId
  if (!planId) {
    if (import.meta.env.DEV) console.warn('[itinerary] 还没挂到任何规划上，这次改动只在内存里')
    return
  }

  /*
   * ★ 先记下"这次写入是我造成的"，再发出去（`update` 内部**同步**把 rev +1，
   *   所以 `rev + 1` 就是这次写入之后的版本号）。记晚了会让 `attach` 的守卫失效 →
   *   每敲一下输入框就重新装载一次行程。
   */
  const nextRev = usePlanStore.getState().rev + 1
  useItineraryStore.setState((prev) => (prev.planId === planId ? { ownRev: nextRev } : {}))

  void usePlanStore.getState().update(planId, {
    stays: s.stays,
    days: s.days,
    mode: s.defaultMode,
    chosenOption: s.chosenOption,
  })
}

/* ────────────────────────────────────────────────
 * 派生选择器（放这里而不是散在组件里，保证口径唯一）
 * ────────────────────────────────────────────── */

/** 当天所属的住宿段。多住宿段的核心：切天即换锚 */
export function selectStayOfDay(state: ItineraryState): Stay | null {
  const day = state.days[state.activeDay - 1]
  if (!day || !day.stayId) return null
  return state.stays.find((s) => s.id === day.stayId) ?? null
}

export function selectActiveDay(state: ItineraryState): ItineraryDay | null {
  return state.days[state.activeDay - 1] ?? null
}

/**
 * 跨天移动前的住宿段校验（09 文档 6.2）。
 * 不阻止，只提示 —— 决定权在用户手里。
 */
export function crossDayStayWarning(state: ItineraryState, fromDay: number, toDay: number): string | null {
  const a = state.days[fromDay - 1]?.stayId
  const b = state.days[toDay - 1]?.stayId
  if (!a || !b || a === b) return null
  const nameOf = (id: string) => state.stays.find((s) => s.id === id)?.name ?? '另一个住宿点'
  return `第 ${toDay} 天住的是「${nameOf(b)}」，与第 ${fromDay} 天的「${nameOf(a)}」不同 · 移过去后回程起点会跟着变`
}
