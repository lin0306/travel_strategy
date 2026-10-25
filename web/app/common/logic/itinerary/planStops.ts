/**
 * 规划里的「一站」—— **纯函数**，不认识 React、不认识 IndexedDB、不发请求。
 *
 * ## 为什么单独一个文件
 * 「摊平 / 换序 / 删除 / 追加 / 补坐标」这五件事被**三个地方**用：
 * 右侧面板（列表与编辑）、地图侧（画点与算路）、完整行程页。
 * 各写一遍必然漂移，而漂移的表现是"面板里的顺序和画在图上的顺序不一样"——
 * 没有报错，只能靠肉眼发现。
 *
 * ## ★ 途经点序列是**算出来的**，不是存的
 * `RoutePlan` 里**没有** `stops` 字段：它就是 `days[].items` 按天序摊平。
 * 存两份就必须在每次换序时同步两处（plans/13 §3.2 修订记了这个决定）。
 */

import type { DayItem, ItineraryDay, Poi, RoutePlan, SubType, TransitPrefer } from '~shared/schema'

import { mirrorUrl, WIDTH_THUMB_SM } from '~/common/data/imageMirror'

import { emptyDay } from './emptyDay'
import { newUid } from './ids'
import { arrivalOf } from './resolveLeg'

/** 摊平出途经点序列：**天序 × 天内顺序**。这就是"途经点的真实顺序" */
export function planStopItems(plan: RoutePlan): DayItem[] {
  return plan.days.flatMap((d) => d.items)
}

/** 一共排了几个点（空规划在 UI 上要区别对待，不能显示成"0 公里"） */
export function planStopCount(plan: RoutePlan): number {
  return plan.days.reduce((n, d) => n + d.items.length, 0)
}

/**
 * 两站是不是**同一个地方**（重复校验的判据）。
 *
 * ## 判据分两路，因为"同一个"对两种点意味着不同的事
 * | 类型 | 判据 | 为什么 |
 * |------|------|--------|
 * | 景点（`poiId` 非空） | `poiId` 相等 | 同一个景点就是同一个地方，与坐标无关（坐标是抓来的，可能重采样） |
 * | 地图取点（`poiId` 为空） | 坐标相差 < 1e-5（≈1 米） | 取点**没有 id**，"同一个"只能是同一个坐标 |
 *
 * ★ 判据只看 `poiId` 是否非空，**不先看 `kind`** —— 老数据里 `kind` 可能缺失，
 *   而 `poiId` 是更硬的证据（同 `stopKindOf` 的取舍）。
 */
export function sameStopItem(item: DayItem, stop: NewStop): boolean {
  if (stop.poiId) return item.poiId === stop.poiId
  if (typeof item.lng !== 'number' || typeof item.lat !== 'number') return false
  return Math.abs(item.lng - stop.lng) < 1e-5 && Math.abs(item.lat - stop.lat) < 1e-5
}

/**
 * 这一站**已经在这条规划里**了吗？在的话是第几站（1 起），没有 → `null`。
 *
 * 用途是"重复了要不要再加一次"的确认 —— 见 `useAddToPlan` 的 `addStopToPlan`。
 * 返回**序号**而不是布尔：提示里要能说清"它现在是第 3 条明细"，
 * 只说"已存在"的话用户还得自己去列表里找是哪一条。
 */
export function findDuplicateStop(plan: RoutePlan, stop: NewStop): number | null {
  const i = planStopItems(plan).findIndex((it) => sameStopItem(it, stop))
  return i === -1 ? null : i + 1
}

/**
 * 这一站是什么类型。
 * ★ **缺省是 `poi`** —— 老数据没有 `kind` 字段，把它当 `point` 处理会让
 *   所有老点位在"自由取点"的样式与逻辑里跑（而且不会报错）。
 */
export function stopKindOf(item: DayItem): 'poi' | 'point' {
  return item.kind === 'point' ? 'point' : 'poi'
}

/** 面板里的一站（坐标与名字已经补齐，可直接渲染 / 直接画） */
export interface PlanStopView {
  uid: string
  kind: 'poi' | 'point'
  /**
   * 这一站对应的**景点 id**；自己在地图上取的「地图取点」是**空串**
   * （与 `DayItem.poiId` 同一个约定）。
   *
   * ★ 地图侧要靠它做两件事（2026-09-28）：① 点序号标记 → 打开这一枚的详情；
   *   ② 告诉景点图层"这些景点由规划代表"（让位名单）。
   */
  poiId: string
  name: string
  lng: number
  lat: number
  /** 属于第几天（1 起）。面板用它画天分隔 */
  day: number
  /** 在**摊平序列**里的下标。换序按钮按它定位 */
  index: number
  /**
   * 在**这一站停留多少分钟**（`DayItem.dwellMinutes` 原样带上来）。
   *
   * ★ 带上来的理由：详情页要**就地改**它（`DwellStepper` 的 −/+ 15 分钟）。
   *   只留在 store 里的话，UI 得自己去 `days[天].items[序]` 里翻，而
   *   "这一站在哪一天第几个"正是这一层已经在算的东西 —— 让 UI 再算一遍就会两处口径。
   * ★ 下限 5 由 `store.setDwell` 与 schema 各自把着，这里不做钳位。
   */
  dwellMinutes: number
  /**
   * 坐标/名字是从城市数据补出来的（老数据只有 `poiId`）。
   * `false` = 这一项**查不到**（poiId 失效 / 城市数据没加载）—— UI 要如实标出来，
   * 不能假装它在图上（那就变成"数据有了但看不见"那一类静默失效）。
   */
  resolved: boolean
  /**
   * 列表缩略图（**已走 `imageMirror`**：Wikimedia 域名国内不可达）。
   * `null` = 没有图（取点 / 数据里 images 为空）—— UI 给占位块，不是空白。
   */
  thumbUrl: string | null
  /**
   * 所属**区**名（"青羊区"）。省与市从 `city` 拿 —— 所以这里只带区，
   * 省市区由 UI 拼（同一座城里省市对每条都一样，放这里就是冗余）。
   */
  district: string | null
  /**
   * 细类 —— 时间线的圆点按它上色（**与地图上的点位同色**，用户 2026-09-28 要求）。
   * 地图取点没有细类 ⇒ `null`（UI 用中性色，不能编一个类型出来）。
   */
  subtype: SubType | null
  /**
   * 「省 · 市 · 区」整串，**只有地图取点有**（景点那一行用 `district` + 页面给的省市拼）。
   * ★ 它是异步查来的（`geocode.ts` 的逆地理编码），查不到就是 `null`（UI 显示"定位中…"）。
   */
  address: string | null
  /**
   * 公共交通的**偏好**（公交优先 / 地铁优先）。`undefined` = 均衡。
   * ★ 原样从 `DayItem` 带上来 —— UI 要拿它当取路线的缓存键的一部分
   *   （见 `routeOptionKey`），所以必须能在这一层读到，不能只留在 store 里。
   */
  transitPrefer: TransitPrefer | undefined
}

/**
 * 把规划摊成可直接渲染的一串。
 *
 * @param pois `plan.cityId` 那座城市的点位索引。**老数据（只有 poiId）必须有它**，
 *             否则只能拿到一条"查不到"的占位（宁缺勿编：不猜坐标）。
 */
export function flattenStops(
  plan: RoutePlan,
  pois: Map<string, Poi> | null,
  /**
   * 地图取点的**地址**（省市区）—— 由调用方异步查好、按 `uid` 交给这里。
   * ★ 它只对 `kind='point'` 有意义（景点那一行用的是城市数据里的 `district`）：
   *   地图取点手里只有坐标，地址得走逆地理编码（`geocode.ts`）。
   *   查不到就给 `null` —— 那一行显示"定位中…"，绝不用最近的城市去猜。
   */
  addressOf?: (uid: string) => string | null,
): PlanStopView[] {
  const out: PlanStopView[] = []
  plan.days.forEach((d, di) => {
    for (const it of d.items) {
      const poi = it.poiId && pois ? pois.get(it.poiId) : undefined
      // 行程里存的坐标优先（它是"当时那一站"的快照，已是到达点/入口），缺了才回落到城市数据。
      // ★ 回落也走到达点（>300m 才用入口），与 toStop 同口径 —— 否则老数据会落回园区中心穿园。
      const arrival = poi ? arrivalOf(poi) : undefined
      const lng = it.lng ?? arrival?.lng
      const lat = it.lat ?? arrival?.lat
      const has = typeof lng === 'number' && typeof lat === 'number'
      // 缩略图：`coverIndex` 指定的那张，越界 / 缺失就退回第一张
      const img = poi ? (poi.images[poi.coverIndex] ?? poi.images[0]) : undefined
      out.push({
        uid: it.uid,
        kind: stopKindOf(it),
        poiId: it.poiId,
        name: it.name ?? poi?.name ?? (it.poiId ? '点位已失效' : '地图取点'),
        lng: has ? (lng as number) : 0,
        lat: has ? (lat as number) : 0,
        day: di + 1,
        index: out.length,
        // ★ 停留时长原样带上来 —— 详情页的步进器直接读写它（见 PlanStopView 那条注释）
        dwellMinutes: it.dwellMinutes,
        resolved: has,
        // ★ 缩略图必须走镜像出口（红线 7）—— 160 与搜索索引的 cover 同档
        thumbUrl: img ? mirrorUrl(img.thumbUrl ?? img.url, WIDTH_THUMB_SM) : null,
        district: poi?.location.district ?? null,
        // 时间线的圆点用它上色（细类色，与地图上的点位同色）
        subtype: poi?.subtype ?? null,
        address: addressOf ? addressOf(it.uid) : null,
        // ★ 公共交通的偏好原样带上来（缺省 = 均衡），见 `PlanStopView.transitPrefer`
        transitPrefer: it.transitPrefer,
      })
    }
  })
  return out
}

/* ────────────────────────────────────────────────
 * 编辑（都返回**新的 days 数组**，不改原对象）
 * ────────────────────────────────────────────── */

/**
 * 在**摊平序列**上把第 `from` 站挪到第 `to` 位。
 *
 * ★ 天数的分桶**保持不变**（每天站数照旧），只是把新序列按这些数量重新装回去。
 *   这样"拖动一个点"不会意外合并天数，也不会因为跨天而需要复制住宿段引用。
 *   真正的跨天移动（连带住宿段校验）是完整行程页的职责 —— 那里有 `moveItemToDay`。
 */
export function moveStopInPlan(plan: RoutePlan, from: number, to: number): ItineraryDay[] {
  const flat = planStopItems(plan)
  if (from < 0 || from >= flat.length) return plan.days
  const next = [...flat]
  const [moved] = next.splice(from, 1)
  if (!moved) return plan.days
  next.splice(Math.max(0, Math.min(next.length, to)), 0, moved)

  let i = 0
  return plan.days.map((d) => {
    const slice = next.slice(i, i + d.items.length)
    i += d.items.length
    return { ...d, items: slice }
  })
}

/** 删掉一站。空的"天"留着 —— 天数由用户显式管，删空点位不等于删一天 */
export function removeStopFromPlan(plan: RoutePlan, uid: string): ItineraryDay[] {
  return plan.days.map((d) => ({ ...d, items: d.items.filter((it) => it.uid !== uid) }))
}

/**
 * 要加进去的一站（还没发 uid）。
 *
 * ★ `cityId` 是**必填**（不是可选）：加点位的每一个入口都知道"这一点属于哪座城"
 *   （城市页有 cityId、搜索命中的那枚有归属、地图取点用的是规划自己的城）。
 *   做成可选只会让下游到处写 `?? ''`，而空串的 cityId 在跨城筛选里是个静默的地雷。
 */
/**
 * 「地图取点」的默认名。
 * ★ **两个地方必须一致**：① 落点那一刻写进库的初值（`useAddToPlan.addPickedPoint`）；
 *   ② 名字输入框被清空时的回落（`common/ui/plan/PointNameField`）。
 *   各写一遍就会漂 —— 改了这里忘了那里，表现是"清空之后名字变成另一种写法"，不报错。
 */
export const DEFAULT_POINT_NAME = '地图取点'

export interface NewStop {
  /**
   * 这一条的 uid。**不给就当场生成**（默认）。
   * ★ 只有「地图取点」会传它：刚落到图上的那个点要**立刻打开改名输入框**，
   *   而"哪一行该打开"是靠 uid 认的（`planUi.freshPoint`）—— 不传的话调用方
   *   只能靠"前后 diff 找新 uid"来猜，那是会静默失效的写法。
   */
  uid?: string
  kind: 'poi' | 'point'
  /** `kind='point'` 时是空串 */
  poiId: string
  name: string
  lng: number
  lat: number
  cityId: string
  dwellMinutes: number
}

/**
 * 追加一站，**加到最后一个有站的天**（没有就第 1 天）。
 *
 * 为什么是"最后一天"：加点位的动作总是发生在"我正在排的这一段"，
 * 而用户排到第几天，最后那个非空的天就是他手上的位置。
 */
/**
 * 把一站写进某条规划。
 *
 * @param dayIndex 加进**哪一天**（0 起）。★ 「添加行程」的弹窗是棵树：一级是组、
 *   二级是天 —— 用户点的是**某一天**，所以这一天必须由调用方给。
 *   不给（地图取点那条路，没有弹窗）→ 落到**最后一个非空天**（没有就第 1 天），
 *   与"顺着排"的直觉一致。
 */
export function appendStopToPlan(plan: RoutePlan, stop: NewStop, dayIndex?: number): ItineraryDay[] {
  const item: DayItem = {
    // ★ 调用方给了就用它（见 `NewStop.uid`：地图取点要知道"刚建的是哪一条"）
    uid: stop.uid ?? newUid('it'),
    poiId: stop.poiId,
    ...(stop.kind === 'point' ? { kind: 'point' as const } : {}),
    name: stop.name,
    lng: stop.lng,
    lat: stop.lat,
    cityId: stop.cityId,
    dwellMinutes: Math.max(5, Math.round(stop.dwellMinutes)),
  }

  // 天数为空：无论加到哪天，都得先有"第 1 天"
  if (plan.days.length === 0) return [{ stayId: '', startTime: '09:00', items: [item] }]

  // 指定的天越界（比如只有 1 天却点了"第 3 天"）→ 补空天到那一天为止
  let target = typeof dayIndex === 'number' ? dayIndex : -1
  if (target >= 0) {
    if (target >= plan.days.length) {
      const padded = [...plan.days]
      while (padded.length <= target) padded.push({ stayId: '', startTime: '09:00', items: [] })
      return padded.map((d, i) => (i === target ? { ...d, items: [...d.items, item] } : d))
    }
  } else {
    // 不指定：落到最后一个非空天（没有就第 1 天）
    target = -1
    for (let i = plan.days.length - 1; i >= 0; i--) {
      if ((plan.days[i]?.items.length ?? 0) > 0) {
        target = i
        break
      }
    }
    if (target < 0) target = 0
  }

  return plan.days.map((d, i) => (i === target ? { ...d, items: [...d.items, item] } : d))
}

/**
 * 在末尾**加一天**（空天）—— 「加到哪个组」弹窗里组行右侧那个「＋」用它。
 *
 * ## ★ 它**不碰任何明细**（2026-09-27 修）
 * 用户点的是「往后加一天」—— 一个**结构操作**，不是"把这个景点放进去"。
 * 第一版把两件事揉在一起（`appendStopToPlan(plan, stop, plan.days.length)`），
 * 于是点 ＋ 也会走唯一写入口的重复校验、弹出「这个景点已经在里面了」：
 *
 * > 用户原话：「我点组的添加，不应该是添加天的数据吗，怎么说重复添加景点」
 *
 * 语义完全错位 —— 用户在建结构，系统却在跟他讨论景点。
 * 现在 ＋ 只加天，**由用户点新出现的「第 N 天」把景点排进去**（那才是"添加行程"）。
 *
 * ## 为什么不清 `route`
 * 折线穿的是**明细点位**（`days[].items`），空天不改变这个序列 ⇒ 已算的路线仍然有效。
 * （对比 `appendStopToPlan` 必须清 —— 那里点集真的变了。）
 */
export function appendDayToPlan(plan: RoutePlan): ItineraryDay[] {
  return [...plan.days, emptyDay()]
}

/**
 * 改一站的名字（自由取点默认叫「地图取点」，用户大概率想改）。
 * ★ `name` 是**必填**字段，所以清空时回落到默认名而不是空串 —— 空串在列表里是一行空白。
 */
export function renameStopInPlan(plan: RoutePlan, uid: string, name: string): ItineraryDay[] {
  const fallback = '地图取点'
  const clean = name.trim() || fallback
  return plan.days.map((d) => ({
    ...d,
    items: d.items.map((it) => (it.uid === uid ? { ...it, name: clean } : it)),
  }))
}
