/**
 * 行程规划页的**页面逻辑**（与端无关）。
 *
 * ## 这一页的定位
 * **它是"行程计时器"，不是"路线优化器"。** 顺序由用户定，系统只算时间 ——
 * 不做 TSP、不做 2-opt，界面上也不出现"已为你优化"这类暗示。
 *
 * ## 时间从哪来（四级解析，越靠前越优先）
 * | 级 | 来源 | 调用 |
 * |----|------|------|
 * | ⓪ | 用户在多方案卡里手选的那条 | 0 次（拉过一次就在手） |
 * | ① | 构建期预计算矩阵 | 0 次 |
 * | ② | `localStorage` 缓存 | 0 次 |
 * | ③ | 实时接口（仅"自填住宿点"与"公交/地铁"） | 按需，且要过配额账本 |
 *
 * ⚠️ **矩阵里的驾车时长是"生成时刻的路况快照"**，不是实时。所以 UI 上
 * 一律标「路况估算」「直线示意」，绝不暗示"这就是你现在开过去要花的时间"。
 *
 * ## 三条隐私约束
 * 1. 住宿点只存本机，**不进 URL**
 * 2. 分享链接不含住宿点名称与坐标（默认脱敏为「住宿点」）
 * 3. 不采集用户位置；「用地图中心点」是用户主动点的动作
 *
 * ## 本文件不管"壳"的事情
 * | 去哪里 | 是什么 |
 * |--------|--------|
 * | `common/ui/plan/PlanDetailView` | 壳：右侧浮层的详情态（标题 / 动作条 / 页脚 / 住宿选择器） |
 * | `common/logic/usePlanMapLayers` | 地图侧：按天逐段连线 / 住宿旗标（★ 面板默认关着，见 `useItineraryView` 的 `opts`） |
 * | `common/logic/itinerary/timeline` | 时间链推导（纯函数） |
 * | `common/logic/itinerary/store` | 行程状态与持久化 |
 */

import { useEffect, useMemo, useState } from 'react'

import { usePlanMapLayers } from '~/common/logic/usePlanMapLayers'
import { useRouteOptions } from '~/common/logic/useRouteOptions'
import { useMapShell, type MapShellContext } from '~/common/logic/mapShell'
import { loadCity } from '~/common/data/cityRegistry'
import { buildPoiIndex } from '~/common/logic/itinerary/matrix'
import { buildAdjacentLegs } from '~/common/logic/itinerary/adjacentLegs'
import { makePlaceOfItem, makePoiLookup } from '~/common/logic/itinerary/places'
import {
  legKey,
  type LegContext,
  type LegOverride,
  type LegResult,
} from '~/common/logic/itinerary/resolveLeg'
import { routeOptionKey, type RouteOptionSet } from '~/common/logic/itinerary/routeOptions'
import {
  buildShareUrl,
  downloadJson,
  parseImport,
  parseShareHash,
  serializeExport,
} from '~/common/logic/itinerary/share'
import {
  selectActiveDay,
  selectStayOfDay,
  useItineraryStore,
  type ItineraryState,
} from '~/common/logic/itinerary/store'
import { usePlanStore, type PlanStoreStatus } from '~/common/logic/itinerary/planStore'
import { buildTimeline, overloadWarnings, type Timeline } from '~/common/logic/itinerary/timeline'
import type { City, CityTransitMatrix, RoutePlan, Stay, TransitPrefer, TravelMode } from '~shared/schema'

export interface PlanView {
  shell: MapShellContext
  store: ItineraryState
  /** 当前挂着的规划。`null` = 还没选（页面要给"请从路线规划里选一条"的占位屏） */
  plan: RoutePlan | null
  /** 规划存储的状态。`unavailable` 时这一页要如实说"用不了"，而不是空转 */
  planStatus: PlanStoreStatus
  cityId: string
  city: City | null
  stay: Stay | null
  timeline: Timeline | null
  /** `uid` → 从这一站到下一站的段（不含住宿点，见 `buildAdjacentLegs`） */
  legByUid: Map<string, LegResult>
  warnings: string[]
  hasSoftData: boolean
  matrix: CityTransitMatrix | null
  optionSets: Record<string, RouteOptionSet>
  optionLoading: string | null
  /** 拉某段某个方式（+偏好）的路线（缓存键见 `routeOptionKey`） */
  onRequestOptions: (uid: string, mode: TravelMode, prefer?: TransitPrefer) => void
  onPickOption: (uid: string, key: string) => void
  importError: string | null

  onExport: () => void
  onShare: () => void
  onImportFile: (file: File) => void

  toast: string | null
  onCloseToast: () => void
  stayPickerOpen: boolean
  onOpenStayPicker: () => void
  onCloseStayPicker: () => void
  onUseMapCenter: (fromDay: number, toDay: number) => void
  onStayPicked: (name: string) => void
}

export function useItineraryView(
  /**
   * 这条组属于哪座城。★ **不要**从 `useParams()` 里读 —— 这个钩子挂在**外壳**
   * （`routes/map-shell.tsx`）上时，它根本不在 `/city/:cityId` 路由的内部，
   * `useParams()` 是空的。城市一律由调用方给：
   * 面板给「当前打开的那条组」的 `cityId`，页面（如果还有）给 URL 参数。
   */
  cityId: string,
  /**
   * 要不要挂**逐段连线**（`usePlanMapLayers`：按天分段 / 住宿旗标 / 点段交互）。
   * 面板的地图侧用的是**整条沿路折线**（`usePlanRouteLayer`）—— 两套线叠在一张图上
   * 就是同一趟行程画两条线，所以面板传 `false`，逐段那条留给旧的完整行程页。
   */
  opts: { mapLayers?: boolean } = {},
): PlanView {
  const shell = useMapShell()

  const [city, setCity] = useState<City | null>(null)
  const [stayPickerOpen, setStayPickerOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  const store = useItineraryStore()
  const attach = useItineraryStore((s) => s.attach)

  /* ── 当前挂的是哪条规划（plans/13 §3.4）──────── */

  const plans = usePlanStore((s) => s.plans)
  const activeId = usePlanStore((s) => s.activeId)
  const rev = usePlanStore((s) => s.rev)
  const planStatus = usePlanStore((s) => s.status)
  const plan = activeId ? (plans.find((p) => p.id === activeId) ?? null) : null

  /**
   * 把规划内容装进行程 store。
   *
   * ★ 依赖里**必须有 `rev`**：在右侧面板里加了一个点位之后，
   *   只有 `plan.id` 没变，这个 effect 根本不会重跑，左边的行程页就**不会更新**
   *   （而且不报错）。`attach` 内部靠 `ownRev` 把自己的写入排除掉，
   *   所以这里可以直接把 `rev` 放进依赖，不必在这里判"是不是我写的"。
   */
  useEffect(() => {
    if (plan) attach(plan, rev)
  }, [plan, rev, attach])

  /* ── 城市数据 ───────────────────────────────── */

  useEffect(() => {
    let alive = true
    setCity(null)
    // ★ 用**规划自己的** cityId 读城市数据，不用 URL 参数 ——
    //   上面那条纠正生效前，URL 可能还是上一座城
    const target = plan?.cityId ?? cityId
    loadCity(target).then((c) => {
      if (alive) setCity(c)
    })
    return () => {
      alive = false
    }
  }, [cityId, plan?.cityId])

  /**
   * 分享链接的接收端。
   *
   * ⚠️ 解析失败**必须让用户知道**（写入 `shareError` → 渲染灰色降级条），
   *    而不是静默留一个空行程：用户点开朋友发的链接却看到空白页，
   *    会以为"行程丢了"，而实际上是链接被截断了。
   */
  useEffect(() => {
    const payload = parseShareHash(window.location.hash)
    if (!payload) return
    if (payload.ok) {
      store.importPayload({ stays: payload.stays, days: payload.days })
    } else {
      store.setShareError(payload.error)
    }
    // 清掉 hash，避免刷新时重复导入
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ── 「添加行程」不再走这里 ─────────────────────
   *
   * 原来这一页靠 `?add=<poiId>` 接住来自城市页 / 首页 / 省级页 / 景点页的加点动作 ——
   * 那是"换页再加"的形态。现在四处的入口统一走 `useAddToPlan`：**不换页**，
   * 直接加进选中的规划（详情见那个文件头）。所以 `?add=` 这条通路整条删掉了，
   * 老链接进来只是"打开了行程页、没有加点"，不会报错。
   */

  /* ── 时间链推导 ─────────────────────────────── */

  const day = selectActiveDay(store)
  const stay = selectStayOfDay(store)

  /** `poiId` → 坐标；自由取点走 `placeOfItem`（两者都收在 `itinerary/places` 里） */
  const placesOf = useMemo(() => makePoiLookup(city), [city])
  const placeOfItem = useMemo(() => makePlaceOfItem(placesOf), [placesOf])

  /**
   * 矩阵上下文。
   * ⚠️ `buildPoiIndex` 的结果要缓存 —— 它按 poiIndex 建 Map，每次渲染重建是白费功夫。
   *
   * ★ `matrix` 可以为 null（矩阵没跑 / 接口配额打满）。此时**不返回 null ctx** ——
   *   否则时间链整条算不出来、行程页直接空白。缺矩阵只是让每段降级为「直线估算」，
   *   页面照常可用，估算身份由 `hasSoftData` 如实标出（红线 10：null ≠ 0，不能填 0 充数）。
   */
  const matrix: CityTransitMatrix | null = city?.transit ?? null
  const poiIndex = useMemo(() => (matrix ? buildPoiIndex(matrix) : new Map<string, number>()), [matrix])

  const baseCtx: LegContext | null = useMemo(
    () =>
      city
        ? {
            matrix,
            poiIndex,
            getCached: (k) => store.legCache[k],
            defaultMode: store.defaultMode,
          }
        : null,
    [city, matrix, poiIndex, store.legCache, store.defaultMode],
  )

  /**
   * ★ 时间链为什么要算**两遍**
   *
   * 存在一个环：`timeline` 需要 `ctx`；`ctx.getOverride` 需要"用户选的那条方案的时长"；
   * 而那条时长要靠 `timeline` 的段结构（from/to/mode）才能对上是哪一段。
   *
   * 破环办法是分两遍，都是纯函数、都没有网络请求：
   *   第一遍 `timelineBase` —— 不含 override，只用来确定"有哪些段、每段什么方式"；
   *   第二遍 `timeline`     —— 带上 override 重算，得到真正展示的时间链。
   *
   * 两遍的段结构必然一致（override 只改时长、不改两端点与方式），所以收敛、
   * 不需要迭代到不动点。代价是每帧多一次 O(段数) 推导，相比 16ms 预算可忽略。
   */
  const timelineBase: Timeline | null = useMemo(() => {
    if (!day || !stay || !baseCtx) return null
    return buildTimeline(day, stay, placesOf, baseCtx)
  }, [day, stay, placesOf, baseCtx])

  /**
   * `uid` → 从这一站到下一站的段。**别改用 `timeline.legs`** —— 那个要求住宿点存在，
   * 而住宿点入口这一版被去掉了（⇒ `timeline` 恒为 null）。推导见 `buildAdjacentLegs`。
   */
  const legByUid = useMemo(
    () =>
      day && baseCtx ? buildAdjacentLegs(day, placeOfItem, baseCtx) : new Map<string, LegResult>(),
    [day, placeOfItem, baseCtx],
  )

  /* ── 多方案：点开某一段才拉 ─────────────────── */

  /**
   * 拉取状态机（未拉 / 拉取中 / 有结果 / 降级）自成一体，见 `useRouteOptions`。
   *
   * ★★ 传 `legByUid` 而不是 `timelineBase`（这一版的关键修正）：钩子原来在里面用
   *   `timeline.stops.findIndex(...)` 找段，而 **`timeline` 恒为 `null`**
   *   （`buildTimeline()` 要求首末都是住宿点，住宿点入口 2026-09-27 被去掉了）
   *   ⇒ 每次点击都被 `if (!timeline) return` 吞掉，**面板点开永远是空的**。
   *   现在换成"按 uid 取段"，与时间链无关。
   * ★ resetKey 传 cityId：换城市时上一座城的路线不能带过来（uid 不通用）。
   */
  const { optionSets, optionLoading, requestOptions } = useRouteOptions({
    legOfUid: (uid) => legByUid.get(uid) ?? null,
    resetKey: cityId,
  })

  /** uid → 用户手选的方案时长。键用 `legKey`（含方式），因为同一段换个方式就是另一条路 */
  const overrides = useMemo(() => {
    const m = new Map<string, LegOverride>()
    if (!timelineBase) return m
    timelineBase.stops.forEach((st, i) => {
      const uid = st.item?.uid
      const leg = timelineBase.legs[i]
      if (!uid || !leg) return
      const key = store.chosenOption[uid]
      if (!key) return
      // ★ 键必须是 `routeOptionKey(uid, mode, prefer)` —— 集合里存的就是这个键。
      //   原先写成 `optionSets[uid]`（永远查不到）⇒ **手选方案的时长从未生效过**（2026-10-19 修）
      const set = optionSets[routeOptionKey(uid, leg.mode, st.item?.transitPrefer)]
      if (!set) return
      const opt = set.options.find((o) => o.key === key)
      if (!opt) return
      m.set(legKey(leg.from, leg.to, leg.mode), {
        // ⚠️ 路线规划接口给的是**分钟**，矩阵与时间链用**秒** —— 混了差 60 倍
        duration: Math.round(opt.durationMinutes * 60),
        distance: opt.distance,
        ...(set.taxiFare !== undefined ? { taxiFare: set.taxiFare } : {}),
      })
    })
    return m
  }, [timelineBase, store.chosenOption, optionSets])

  const ctx: LegContext | null = useMemo(
    () => (baseCtx ? { ...baseCtx, getOverride: (k) => overrides.get(k) } : null),
    [baseCtx, overrides],
  )

  const timeline: Timeline | null = useMemo(() => {
    if (!day || !stay || !ctx) return null
    return buildTimeline(day, stay, placesOf, ctx)
  }, [day, stay, placesOf, ctx])

  const warnings = useMemo(() => {
    const base = timeline && ctx ? overloadWarnings(timeline, ctx) : []
    // 缺矩阵时明确说清"时长是估算的"，别让人以为这是实测路况
    return matrix ? base : ['通勤矩阵尚未生成，段间时长为直线估算值', ...base]
  }, [timeline, ctx, matrix])

  /** 只在存在预估/不适用段时才提示"非实测" —— 全是矩阵命中时不必啰嗦 */
  const hasSoftData = useMemo(
    () => Boolean(timeline && (timeline.hasEstimate || timeline.hasNotApplicable)),
    [timeline],
  )

  /* ── 地图侧（连线 / 序号 / 视野 / 降级画布）─── */

  usePlanMapLayers({
    shell,
    timeline,
    stay,
    activeLeg: store.activeLeg,
    // store.setActiveLeg 内部就是翻转语义（同一个 uid 再点一次即收起）
    onSelectLeg: store.setActiveLeg,
    // 面板传 false：它的地图侧是整条沿路折线，两套线叠一张图 = 同一趟行程画两条线
    enabled: opts.mapLayers !== false,
  })

  /* ── 动作 ─────────────────────────────────── */

  const onExport = () => {
    if (!city) return
    try {
      downloadJson(`行迹-${city.name}-行程.json`, serializeExport(cityId, store.stays, store.days))
      setToast('已导出 JSON 备份 · 行程只在本机，导出不经过服务器')
    } catch (e) {
      setToast(e instanceof Error ? e.message : '导出失败')
    }
  }

  const onImportFile = async (file: File) => {
    setImportError(null)
    const text = await file.text()
    const r = parseImport(text)
    if (!r.ok) {
      setImportError(r.error)
      return
    }
    store.importPayload({ stays: r.stays, days: r.days })
    setToast(r.note ?? '已合并导入的行程')
  }

  const onShare = async () => {
    if (!city) return
    const r = buildShareUrl(window.location.origin, cityId, store.stays, store.days)
    // ⚠️ `ShareResult.ok === false` 不是"分享失败"，而是"链接偏长，建议改发文件" ——
    //    两种情况的处理完全不同：前者要用户改做法，后者仍然给得出链接
    if (!r.ok) {
      setToast(r.message)
      return
    }
    try {
      await navigator.clipboard.writeText(r.url)
      setToast(r.message)
    } catch {
      // 剪贴板不可用（非 HTTPS / 微信 WebView）→ 把链接摊出来让用户手动复制
      setToast(r.url)
    }
  }

  return {
    shell,
    store,
    plan,
    planStatus,
    cityId,
    city,
    stay,
    timeline,
    legByUid,
    warnings,
    hasSoftData,
    matrix,
    optionSets,
    optionLoading,
    onRequestOptions: requestOptions,
    onPickOption: (uid, key) => store.setChosenOption(uid, key),
    importError,
    onExport,
    onShare,
    onImportFile,
    toast,
    onCloseToast: () => setToast(null),
    stayPickerOpen,
    onOpenStayPicker: () => setStayPickerOpen(true),
    onCloseStayPicker: () => setStayPickerOpen(false),
    onUseMapCenter: (fromDay, toDay) => {
      const c = shell.center()
      if (!c) {
        setToast('地图还没就绪，暂时用不了「地图中心」· 可以先从点位里选')
        return
      }
      store.addStay({
        name: '地图点选的位置',
        lng: c.lng,
        lat: c.lat,
        source: 'picked',
        fromDay,
        toDay,
      })
    },
    onStayPicked: (name) => {
      setStayPickerOpen(false)
      setToast(`住宿点已设为「${name}」· 仅存本机`)
    },
  }
}
