/**
 * 「我在哪」的唯一真源（2026-11-18 起：**URL 不再承载任何状态**）。
 *
 * ## 为什么不再用 URL
 * 用户定：地址栏固定不变，层级状态只进 `sessionStorage`。所以
 * `/city/chengdu`、`/city/chengdu/poi/x` 这些路径**全部退场**，整站只有一个 `/`。
 * 代价是明确的（已与用户确认）：预渲染从 5184 页降到 1 页、深链与 SEO 归零。
 *
 * ## 三个必须踩住的点
 * 1. ★ **首帧恒 `nation`**。预渲染出来的 HTML 是首页；如果客户端首帧就读
 *    `sessionStorage` 直接渲染城市页，服务端 DOM 会被整棵丢弃重渲染 ——
 *    和 `restorePanelUi()` 那条注释记的是同一场事故。恢复只发生在
 *    `hydrateNav()`（挂在外壳的 effect 里，水合之后）。
 * 2. ★ **地址栏要一直显示 `/`**，但**后退键仍然可用**：`pushState` 写相同的
 *    URL、只带 state。这样「后退」不会变成离开站点。
 * 3. ★ **`#itin=` 必须活下来**：分享链接靠 hash 带行程，它是「别人发来的链接」，
 *    不是本站的导航状态。所以 URL 归一化时一律保留 hash。
 *
 * ## 为什么不留第二份状态
 * `useCurrentCityId()` 原来从 pathname 正则里抠城市 —— 现在它读这里。
 * 再算第二份就是「两套并行的我在哪」，漂移时不报错。
 */

import { useSyncExternalStore } from 'react'

import { markBootPage, readNav, writeNav } from '~/common/data/uiState'

export type NavState =
  | { level: 'nation' }
  | { level: 'province'; adcode: string }
  | { level: 'city'; cityId: string }
  | { level: 'poi'; cityId: string; poiId: string }
  | { level: 'plan'; cityId: string }

/** 层级键：既做去重判据，也做「这一页的视野」在 `uiState` 里的存储键 */
export function navKey(n: NavState): string {
  switch (n.level) {
    case 'nation':
      return 'nation'
    case 'province':
      return `province:${n.adcode}`
    case 'city':
      return `city:${n.cityId}`
    case 'plan':
      return `plan:${n.cityId}`
    case 'poi':
      return `poi:${n.cityId}:${n.poiId}`
  }
}

const NATION: NavState = { level: 'nation' }

let state: NavState = NATION
let hydrated = false
const listeners = new Set<() => void>()

function emit(): void {
  for (const fn of listeners) fn()
}

function isNonEmpty(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

/** 结构校验：sessionStorage 里可能是上一版格式，坏数据一律退回首页，不许抛 */
function isNav(v: unknown): v is NavState {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  switch (o.level) {
    case 'nation':
      return true
    case 'province':
      return isNonEmpty(o.adcode)
    case 'city':
    case 'plan':
      return isNonEmpty(o.cityId)
    case 'poi':
      return isNonEmpty(o.cityId) && isNonEmpty(o.poiId)
    default:
      return false
  }
}

function readStored(): NavState {
  if (typeof window === 'undefined') return NATION
  // ★ sessionStorage 的唯一出口在 `data/uiState.ts`（含隐私模式兜底），这里不裸碰
  const stored = readNav()
  return isNav(stored) ? (stored as NavState) : NATION
}

function persist(n: NavState): void {
  if (typeof window === 'undefined') return
  writeNav(n)
}

/** 地址栏的**唯一**写法：永远是 `/`，但保留 hash（分享链接要用） */
function homeUrl(): string {
  return '/' + (typeof window === 'undefined' ? '' : window.location.hash)
}

function onPop(e: PopStateEvent): void {
  const raw = (e.state as { __nav?: unknown } | null)?.__nav
  state = isNav(raw) ? raw : NATION
  persist(state)
  emit()
}

/**
 * 水合之后接回会话里的层级。**只调一次**（外壳的 mount effect）。
 *
 * 顺带把地址栏归一到 `/` —— 用户可能拿旧链接 `/city/chengdu` 进来，
 * 路径本来已经不做匹配了，留着只会让地址栏和内容对不上。
 */
export function hydrateNav(): void {
  if (hydrated || typeof window === 'undefined') return
  hydrated = true
  const stored = readStored()
  const changed = navKey(stored) !== navKey(state)
  state = stored
  // ★ 告诉 `uiState`「加载时我在这一层」—— 视野恢复靠这个键判断，
  //   不再比较 pathname（单页模式下它恒为 `/`，比了必然不等）
  markBootPage(navKey(state))
  window.history.replaceState({ __nav: state }, '', homeUrl())
  window.addEventListener('popstate', onPop)
  if (changed) emit()
}

export function subscribeNav(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** 当前层级。★ 引用稳定：只有真的换了层级才换对象，`useSyncExternalStore` 靠它判变化 */
export function navSnapshot(): NavState {
  return state
}

/**
 * 跳到某个层级。
 *
 * ★ 相同层级**直接返回**：重复点同一张卡不该往历史里塞一条重复记录
 *   （否则后退要按两次，看起来像「卡住了」）。
 */
export function goto(next: NavState): void {
  if (navKey(state) === navKey(next)) return
  state = next
  persist(state)
  if (typeof window !== 'undefined') {
    window.history.pushState({ __nav: next }, '', homeUrl())
  }
  emit()
}

/** 后退一级 —— 交给浏览器，`popstate` 会把 state 读回来 */
export function goBack(): void {
  if (typeof window !== 'undefined') window.history.back()
}

/** 动作表：调用点只认语义，不再拼路径字符串 */
export const navTo = {
  nation: (): void => goto(NATION),
  province: (adcode: string): void => goto({ level: 'province', adcode }),
  city: (cityId: string): void => goto({ level: 'city', cityId }),
  poi: (cityId: string, poiId: string): void => goto({ level: 'poi', cityId, poiId }),
  plan: (cityId: string): void => goto({ level: 'plan', cityId }),
}

/** 订阅当前层级 */
export function useNav(): NavState {
  return useSyncExternalStore(subscribeNav, navSnapshot, () => NATION)
}

/** 当前层级键（视野存取、换页清浮层都用它，替代原来的 `pathname`） */
export function useNavKey(): string {
  return navKey(useNav())
}

/**
 * 当前所在城市；首页与省级页返回 `null`。
 *
 * ⚠️ `null` 是正确答案，调用方要按「没有城市上下文」处理
 *    （例如禁用「新建规划」并说明原因），而不是随便挑一座城。
 */
export function useNavCityId(): string | null {
  const n = useNav()
  return n.level === 'city' || n.level === 'poi' || n.level === 'plan' ? n.cityId : null
}

/** 当前省级页的 adcode；不在省级页返回 `null` */
export function useNavAdcode(): string | null {
  const n = useNav()
  return n.level === 'province' ? n.adcode : null
}

/** 当前景点页的 poiId；不在景点页返回 `null` */
export function useNavPoiId(): string | null {
  const n = useNav()
  return n.level === 'poi' ? n.poiId : null
}
