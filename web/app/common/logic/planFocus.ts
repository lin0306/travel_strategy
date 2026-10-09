/**
 * 「**规划详情态**」的判据 —— 唯一出处。
 *
 * ## 为什么单独一个文件
 * 这条判据（`panelOpen && activeId`）原来只住在 `routes/map-shell.tsx` 里，
 * 而它现在有**两个消费者**：
 * 1. `map-shell` 自己要拿它做广播（`ViewportEnv.planFocus` / `claimed`）；
 * 2. 城市页的区图层要知道"该不该铺徽标"。
 * 各写一遍的后果是**两边迟早漂移**，而漂移的表现是"某个地方少了点东西" —— 不报错。
 *
 * ## 为什么都用 `getState()` 现取、不进渲染依赖
 * 这套判据的变化**不该让外壳重渲染**：`shell` 这个 context 值一换身份，页面里把它
 * 当依赖的 effect 全部重跑（`useCityEntryFit` 的注释里记着那个坑，表现为"镜头被莫名
 * 拉回全城"）。所以外壳用**订阅 + 比键**的方式补一次视野重刷（见 `planFocusKey`）。
 */
import { usePlanUi } from '~/common/logic/itinerary/planUi'
import { usePlanStore } from '~/common/logic/itinerary/planStore'

/** 没有认领时的共享空集合 —— 免得每次重刷都新建一个 `Set` */
export const NO_CLAIM: ReadonlySet<string> = new Set()

/**
 * 是否处在**规划详情态**（右侧浮层打开、且选中了某条规划）。
 *
 * ## 它决定"地图上只留这条行程"
 * 打开时：
 * · 停靠点的圆点**让位**给行程序号（`claimed`），名字留着；
 * · **行程之外**的景点圆点/名字**全部不铺**；
 * · **区徽标不铺**（面留着 —— 它回答"我在哪个区"，且不抢眼）。
 *
 * 用户 2026-10-05（带截图）：「在打开路线规划时，地图上的标签，景点，你看是显示还是不显示
 * 比较好」。判据不是"好看"，是**会不会被误读** —— 规划态地图上原本同时有行程序号、
 * 停靠点、其他所有景点、区徽标四类点，扫一眼分不出"哪些是我要去的"。
 */
export function isPlanFocused(): boolean {
  const { panelOpen } = usePlanUi.getState()
  const { activeId } = usePlanStore.getState()
  return panelOpen && Boolean(activeId)
}

/**
 * **被规划详情认领的景点**（停靠点里那些真·景点）—— 交给景点图层的"让位"名单。
 *
 * > 用户 2026-09-28：「打开规划详情之后……有些点位是标在景点上的，会出现两个点位，
 * >   没办法打开景点详情，而且现在的效果是**盖在景点的点位上的，而不是替换**」
 *
 * 名单 = 这条规划所有天里 `poiId` 非空的明细。自己在地图上取的「地图取点」没有 `poiId`，
 * 本来就没有对应的景点圆点要撤 ⇒ 不进名单。
 *
 * ★ 名字**不撤**：景点图层会把它们补进名字候选 —— 编号旁边还看得见是哪个景点。
 */
export function claimedPoiIds(): ReadonlySet<string> {
  const { panelOpen } = usePlanUi.getState()
  const { plans, activeId } = usePlanStore.getState()
  if (!panelOpen || !activeId) return NO_CLAIM
  const plan = plans.find((p) => p.id === activeId)
  if (!plan) return NO_CLAIM
  const ids = new Set<string>()
  for (const d of plan.days) {
    for (const it of d.items) if (it.poiId) ids.add(it.poiId)
  }
  return ids.size > 0 ? ids : NO_CLAIM
}

/**
 * 「规划态 + 认领名单」的**稳定键** —— 订阅方用它判断"真的变了没有"
 * （集合与 `boolean` 每次都可能是新值，直接比会永远不等）。
 *
 * ★ 必须把 `isPlanFocused()` 也算进去，**不能只看名单**：
 *   行程里若一个景点都没有（全是地图取点），名单**恒为空** ——
 *   只比名单的话，打开/关掉面板时键不变 ⇒ 补刷不触发 ⇒
 *   "景点该收起来"这个变化**根本不会生效**。
 */
export function planFocusKey(): string {
  return `${isPlanFocused() ? '1' : '0'}|${[...claimedPoiIds()].sort().join('|')}`
}
