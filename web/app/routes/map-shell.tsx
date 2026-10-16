/**
 * 地图外壳（布局路由）——「地图即画布」的落点。
 *
 * ## 它做三件事
 * 1. 铺一张 `position:absolute; inset:0` 的地图层（**是页面本身，不是组件**）
 * 2. 在它之上渲染当前页面的浮层（`<Outlet />`）
 * 3. 把地图能力通过 context 交给页面：`map` / `fit` / 底图开关 / 降级态
 *
 * ## 为什么降级画布的 pins 由页面「回填」给外壳
 * 点位数据属于页面（不同路由撒不同的点），但画布层属于外壳（它要跟真地图
 * 同一个位置、同一个层级）。所以页面把要画的点通过 `setFallback()` 推上来，
 * 外壳负责决定"画真地图还是画降级画布"。
 *
 * ## 浮层实测的收集方式
 * 不做 ref 层层透传，直接按 `[data-overlay]` 属性收集 DOM ——
 * `fitView.ts` 本来就要实测真实占位，走属性反而更贴近它的语义。
 * 父组件的 effect 在子组件之后执行，所以每次渲染后都能拿到完整 DOM。
 *
 * ## ★ context 的**契约**不在本文件
 * 类型、`MapShellCtx`、`useMapShell()` 全在 `~/common/logic/mapShell`。
 * 这里只留"实现"（建地图 / 收浮层 / 扇出重刷）。理由见那个文件头 ——
 * 契约被 `common` 三块都用到，长在路由层会让公共层反向依赖路由层。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router'

import { MapFallback } from '~/common/ui/MapFallback'
import { MapStatusCard } from '~/common/ui/MapStatusCard'
import { MapLogPanel } from '~/common/ui/MapLogPanel'
import { usePlanUi } from '~/common/logic/itinerary/planUi'
import { usePlanStore } from '~/common/logic/itinerary/planStore'
import { claimedPoiIds, isPlanFocused, planFocusKey } from '~/common/logic/planFocus'
import { AddToPlanPicker } from '~/common/ui/plan/AddToPlanPicker'
import { DuplicateConfirm } from '~/common/ui/plan/DuplicateConfirm'
import { SpotPicker } from '~/common/ui/plan/SpotPicker'
// ★ 提示的挂点收在这里了，不再逐条import（见下方 ③‴ 的注释）
import { ToastStack } from '~/common/ui/ToastStack'
import { AboutModal } from '~/common/ui/doc/AboutModal'
import { useDocUi } from '~/common/logic/docUi'
import { DesktopRoutePlanPanel } from '~/desktop/ui/RoutePlanPanel'
import { MobileRoutePlanPanel } from '~/mobile/ui/RoutePlanPanel'
import {
  MapShellCtx,
  type FallbackData,
  type MapShellContext,
  type SearchPick,
  type ViewportEnv,
} from '~/common/logic/mapShell'
import { useIsMobile } from '~/common/logic/useViewport'
import { readViewport, useTMap, type ViewportChange } from '~/common/map/tencent'
import { patchView, restoredViewFor } from '~/common/data/uiState'

/**
 * ★★ 「规划详情态」与「认领名单」的判据**已搬到 `common/logic/planFocus.ts`**。
 *
 * 原因：这两个判据现在有**两个消费者** —— 外壳自己（做广播）与城市页的区图层
 * （决定要不要铺徽标）。原来只住在本文件里，区图层要用就只能各写一遍，
 * 而"两处各写一遍 `panelOpen && activeId`"迟早漂移，漂移的表现是
 * "某个地方少了点东西" —— **不报错**。
 */

export default function MapShellRoute() {
  /** 端别。★ 唯一出处是 `useViewport`（媒体查询，不是 UA），与页面薄壳读的是同一份快照 */
  const isDesktopViewport = !useIsMobile()
  /** 当前路由 —— 顶上的"视野恢复"与下面的"换页清浮层"都要用，所以在这里一次取好 */
  const { pathname } = useLocation()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const overlaysRef = useRef<Array<HTMLElement | null>>([])
  const [fallbackData, setFallbackData] = useState<FallbackData>({ pins: [] })

  /**
   * 图层重刷注册表。★★ 这是「标注为什么一个都不显示」那一类 bug 的修复点。
   *
   * ## 为什么需要一层注册表
   * 显示多少**取决于当前缩放**（圆点见 `zoomTiers.poiTierForZoom`，徽标见
   * `districtLayer.visibleBadges`），所以「视野变了就重刷」是它们能出现的前提。
   * 但视野事件的广播在 `useTMap` 里，而图层是**页面**创建的 —— 外壳并不认识
   * 页面的图层。于是中间需要一层登记：页面（拿到图层后）把自己的重刷函数登记进来，
   * 外壳（收到视野变化后）统一扇出。
   *
   * ## 这里曾经是一条断头路
   * `useTMap` 早就支持 `onViewportChange`，但**没有任何人传这个参数**；
   * 页面上也没有任何人调重刷。两边都以为对方会接，结果：
   * 只有**数据到达**那一刻算过一次，而那一刻地图通常还停在上一页的视野
   * （从首页进城市页时是全国视野），圆点/徽标/标注全部按错误的缩放定档、
   * 之后再不重算。而且**不会报任何错**。
   */
  const viewRefreshersRef = useRef(new Set<(env: ViewportEnv) => void>())

  const refreshView = useCallback(() => {
    // 环境**现取**而不是缓存：浮层会随页面状态增删，缓存下来的容器尺寸会过期
    const env: ViewportEnv = {
      container: containerRef.current,
      overlays: overlaysRef.current,
      // ★ 两个都现取：打开 / 关掉规划面板**不是数据变化**，页面不会重跑 `update()`，
      //   而"该收起来 / 该把点还回来"必须马上生效（判据见 `common/logic/planFocus.ts`）
      planFocus: isPlanFocused(),
      claimed: claimedPoiIds(),
    }
    for (const fn of viewRefreshersRef.current) fn(env)
  }, [])

  /**
   * 规划态 / 认领名单变了 → 补一次视野重刷。
   *
   * ★ 用**订阅 + 比键**，而不是把 `plans` 放进渲染依赖：理由见 `planFocus.ts`
   *   （外壳重渲染会让 `shell` 换身份，波及页面里那一堆 effect）。
   * ★ 比键而不是每次都刷：`plans` 在改一个站点名字时也会变，那种变化与这两件事无关。
   * ★ 键里**含规划态本身**（不只是名单）：行程全是"地图取点"时名单恒空，
   *   只比名单的话打开面板不会触发补刷，"景点该收起来"就不会生效
   *   （理由写在 `planFocusKey`）。
   */
  useEffect(() => {
    let last = planFocusKey()
    const bump = () => {
      const next = planFocusKey()
      if (next === last) return
      last = next
      refreshView()
    }
    const offPlan = usePlanStore.subscribe(bump)
    const offUi = usePlanUi.subscribe(bump)
    return () => {
      offPlan()
      offUi()
    }
  }, [refreshView])

  const registerRefresh = useCallback((fn: (env: ViewportEnv) => void) => {
    viewRefreshersRef.current.add(fn)
    return () => {
      viewRefreshersRef.current.delete(fn)
    }
  }, [])

  /**
   * 视野变化 → ① 扇出重刷（原有逻辑）② **记下这一页的视野**，刷新之后回到这里。
   *
   * ★ 载荷里只有 `{ kind, zoom }`（见 `viewportEmitter.ViewportChange`），
   *   center 得自己从地图实例读 —— 所以走 `tmapRef`（回调可能在地图建好之前就被
   *   装上，那时 `tmap` 还没赋值）。
   */
  const tmapRef = useRef<ReturnType<typeof useTMap> | null>(null)
  const onViewportChange = useCallback(
    (e: ViewportChange) => {
      refreshView()
      const m = tmapRef.current?.map
      const el = containerRef.current
      if (!m || !el) return
      // ★ 视野的**唯一读法**是 `readViewport()`（护栏 V 拦的正是直接 `getCenter()`/`getZoom()`）：
      //   地图正在移动时，同一帧里分头读会拿到不同的中心，而这里要写的是一份"终值"
      const v = readViewport(m, el)
      patchView({ path: pathname, lng: v.centerLng, lat: v.centerLat, zoom: v.zoom })
    },
    [refreshView, pathname],
  )

  /**
   * 「这一页该不该用会话里存的视野」—— 刷新（或从别的页回到**加载时那条路径**）时为真，
   * 此时建图直接用存下的中心与缩放，同时各页的**入口取景会让位**（见 `useFitOnce`）。
   */
  const restoredView = useMemo(() => restoredViewFor(pathname), [pathname])

  const tmap = useTMap({
    containerRef,
    overlaysRef,
    onViewportChange,
    // 只有恢复了视野才覆盖默认（中国全图）——否则一律交给入口取景
    ...(restoredView
      ? { center: { lng: restoredView.lng, lat: restoredView.lat }, zoom: restoredView.zoom }
      : {}),
  })
  tmapRef.current = tmap

  /**
   * DEV 探针出口：把地图实例挂到 `window.__tmap`（与 `window.__mapLog` 同一档次的观测口）。
   *
   * ## 为什么需要它
   * 圆点画在 canvas 上，DOM 里查不到 —— 验收脚本要"点中第 3 个圆点""点一片空地"
   * 就只能靠它把经纬度投影成屏幕坐标（`getZoom()` / `getCenter()` /
   * `getContainer().clientWidth`）。没有这个出口，交互类验收只能靠盲点坐标碰运气，
   * 而"碰巧点到了别的圆点"会伪装成代码 bug。
   *
   * ★ 只在 DEV 存在：`import.meta.env.DEV` 会被构建期静态替换为 `false`，
   *   整段连同 `__tmap` 一起从产物里消失（不是运行时判断）。
   */
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const g = window as unknown as { __tmap?: unknown }
    g.__tmap = tmap.map
    return () => {
      g.__tmap = null
    }
  }, [tmap.map])

  // 每次渲染后收集浮层（父 effect 晚于子组件执行，此时 DOM 已完整）
  useEffect(() => {
    const root = containerRef.current?.parentElement
    const next = root ? Array.from(root.querySelectorAll<HTMLElement>('[data-overlay]')) : []
    const changed =
      next.length !== overlaysRef.current.length ||
      next.some((el, i) => el !== overlaysRef.current[i])
    overlaysRef.current = next

    // ★ 浮层增删会让「可用区」变：视野一个像素都没动，但**标注该重新避让一次**。
    //   少了这一步，打开右侧预览卡之后，名字依然会落在卡片底下（而且不会报错）。
    //   这是"地图没动、可用区变了"的唯一正确出口 —— 页面自己不知道浮层何时增删，
    //   只有外壳看得见。
    //   循环安全性：`refreshView` 只在层级/位置真的变了时才 setState，下一轮到这里
    //   `changed` 必为 false。
    if (changed) refreshView()
  })

  const setFallback = useCallback((data: FallbackData) => {
    setFallbackData(data)
  }, [])

  /**
   * 搜索命中的景点（还没被页面接管时非空）。
   *
   * ★ 换页时清空：它是"这一次交互"的意图，不是可长期持有的状态 ——
   *   留着会让下一个页面一进来就弹出一枚它根本没在显示的点位的详情。
   */
  const [searchPick, setSearchPick] = useState<SearchPick | null>(null)
  useEffect(() => {
    setSearchPick(null)
  }, [pathname])

  /**
   * ★ 「挑景点」浮层**也跟着换页清**（与上面那条同源理由）：它的意图同样属于
   *   "这一次交互"，不是可长期持有的状态。而且换了页之后，新页面**左边可能自己就有
   *   这座城的清单**（城市页）—— 留着它就变成同屏两份清单
   *   （正是 `PageSpotOps.spotListCity` 要避免的那件事）。
   *   ★ 单独一个 effect 而不是并进上面那条：两条各自只有一个职责，
   *     上面那条同时被 AA④ 的护栏盯着（"清空必须就挂在 `[pathname]` 上"）。
   */
  useEffect(() => {
    usePlanUi.getState().closeSpotPicker()
    // ★ 「关于」弹窗同理：它的意图属于"这一次交互"，不是可长期持有的状态
    useDocUi.getState().closeAbout()
  }, [pathname])

  /**
   * ⚠️ 只在**失败**时切降级画布，不在 `loading` 时切。
   *    SDK 正常时加载只要几百毫秒，这期间先画一张示意画布、再换成真地图，
   *    是一次毫无必要的闪屏。加载中就让地图层空着（状态卡会说明正在加载）。
   */
  const fallback = tmap.status === 'error'

  /** 「关于」弹窗的开关（触发点在顶栏，信道见 `common/logic/docUi.ts`） */
  const aboutOpen = useDocUi((s) => s.aboutOpen)

  const ctx = useMemo<MapShellContext>(
    () => ({
      status: tmap.status,
      failure: tmap.failure,
      retry: tmap.retry,
      map: tmap.map,
      fallback,
      fit: tmap.fit,
      centerOn: tmap.centerOn,
      focusPoint: tmap.focusPoint,
      refreshView,
      registerRefresh,
      center: tmap.center,
      basemap: tmap.basemap,
      setBasemapKind: tmap.setBasemapKind,
      setBasemapLevel: tmap.setBasemapLevel,
      toggleBasemapDetail: tmap.toggleBasemapDetail,
      setFallback,
      searchPick,
      setSearchPick,
    }),
    [tmap.status, tmap.failure, tmap.retry, tmap.map, fallback, tmap.fit, tmap.centerOn, tmap.focusPoint, tmap.center, tmap.basemap, tmap.setBasemapKind, tmap.setBasemapLevel, tmap.toggleBasemapDetail, setFallback, refreshView, registerRefresh, searchPick],
  )

  return (
    <div className="relative min-h-svh w-full overflow-hidden">
      {/* ① 地图层：铺满视口，是页面本身 */}
      <div className="map-layer" ref={containerRef}>
        {fallback ? (
          <MapFallback
            pins={fallbackData.pins}
            legs={fallbackData.legs}
            stay={fallbackData.stay}
          />
        ) : null}
      </div>

      {/* ② 降级/加载状态卡：只在「地图不可用」时出现，且不遮住整个页面 */}
      {tmap.status !== 'ready' ? (
        <MapStatusCard
          status={tmap.status}
          failure={tmap.failure}
          onRetry={tmap.retry}
        />
      ) : null}

      {/* ③ 页面浮层 */}
      <MapShellCtx.Provider value={ctx}>
        <Outlet context={ctx} />
        {/* ③′ 右侧「路线规划」浮层 —— ★ 长在**外壳**而不是页面里。
               入口按钮在每个页面的顶栏各有一份，而面板全站只能有一块
               （否则四个页面各挂一次 = 四份实例抢同一份全局状态）。
               它在 Provider **内部**：地图侧要 `shell.fit` / 图层能力。
               完整行程页上它会自己让位（判据在 `RoutePlanPanel` 里）。 */}
        {isDesktopViewport ? <DesktopRoutePlanPanel /> : <MobileRoutePlanPanel />}
        {/* ③″「加到哪个规划」选择器 —— 同样长在外壳：它的触发点在四个页面里，
               锚点位置每次都不同（见 `AddToPlanPicker` 文件头）。
               它自带 `pointer-events` 处理，关着的时候不占任何交互 */}
        <AddToPlanPicker />
        {/* ③″′ 重复添加确认。★ 与弹窗**互斥**（弹窗先关、它再接管）——
            两张卡同时开着，用户不知道该点哪一张 */}
        <DuplicateConfirm />
        {/* ③‴ 瞬时提示的**堆叠出口**（2026-10-16）。★ 必须在面板**外面**：
               · toast —— 添加行程不会打开面板，提示得照样出现；
               · 取点提示 —— 它说的是"点地图上任意位置"，定位基准是**屏幕**；
                 挂在面板里会被 360px 的宽度挤成三行（真踩过）。
               ★ 为什么收进一个 `ToastStack`：两条可能同时出现，而统一位置后
                 同一个 `top` 会让它们**重叠**。堆叠出口统一排，且"不存在就不占位"。 */}
        <ToastStack />
        {/* ③⁗「挑景点」清单 —— 规划面板详情态的「添加景点」用它**取代**了跳转城市页
               （2026-09-27 用户定：「改成不跳链接，左侧打开对应城市的景点列表」）。
               ★ 它必须长在外壳上：触发点在规划面板里，而面板挂在**这里**。
                 页面自己那三个（首页 / 省级页 / 点位页）都没有左侧清单，
                 清单只长在城市页 —— 所以判据走页面注册（`PageSpotOps.spotListCity`），
                 本页有清单时不浮它（否则同一屏两份清单）。 */}
        <SpotPicker />
      </MapShellCtx.Provider>

      {/* ④ 「关于」弹窗。★ 放在 Provider **外** —— 它只读数据（`loadCityIndex`），
             不需要任何地图能力；也**不带 `data-overlay`**：那是给 `fitView` 算
             "地图可用区"用的，而模态是**临时遮挡**（打开时用户在看文档），
             参与避让只会让下一次 `fit` 把点位挤到一侧。
             开关走 `docUi` 这条极简信道（触发点在顶栏，见那个文件头的理由）。 */}
      {aboutOpen ? <AboutModal /> : null}

      {/* ⑤ 诊断浮层：地图显示日志（开发环境常开 / 线上带 `?dbg`）。
          ★ 放在 Provider **外** 且**不带 `data-overlay`** —— 它记的是地图状态，
            与外壳 context 无关，也不该参与 `fitView` 的可用区计算（否则观测会污染对象）。 */}
      <MapLogPanel />
    </div>
  )
}
