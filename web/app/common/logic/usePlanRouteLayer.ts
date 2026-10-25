/**
 * 规划的地图侧：**画路线 + 序号 + 取景**（右侧浮层用，全站生效）。
 *
 * ## 与 `usePlanMapLayers` 的分工（两者不能同时生效）
 * | | 谁用 | 画什么 |
 * |---|---|---|
 * | `usePlanMapLayers` | **完整行程页**（`/city/:id/plan`） | 逐段连线 + 序号 + 住宿旗标 + 按天取景 |
 * | 本文件 | 右侧浮层（在**别的页面**上） | 整条路线的一条折线 + 序号 + 按规划取景 |
 *
 * ★ 所以本钩子必须被 `enabled=false` 关掉在完整行程页上 ——
 *   否则两块会画两套线两套序号，而且**不会报错**，只是图上多一层。
 *   判据由调用方给（`usePlanRouteLayer` 的 `enabled`），不在这里猜路径。
 *
 * ## 没有算过路线时**不画线**
 * 只画序号。刻意不画"两点直连的示意线"：那种线在地图上和真实道路长得太像，
 * 用户会以为自己看到的是路线规划结果。宁可什么都不画，让面板上的
 * 「未规划路线」把那句话说清楚。
 *
 * ## ★ 序号标记**顶替**了停靠点上的景点圆点（2026-09-28 用户定）
 * > 「打开规划详情之后……有些点位是标在景点上的，会出现两个点位，没办法打开景点详情，
 * >   而且现在的效果是**盖在景点的点位上的，而不是替换**」
 *
 * 现状改成：**一个位置一枚标记**。
 * · 景点图层收到"这些景点由别的图层代表"的名单（`ViewportEnv.claimed`）⇒
 *   不画它们、也不交给聚合（名字留着，编号旁边还看得见是哪个景点）；
 * · 那个位置上的**序号标记接住点击** ⇒ 打开该景点的详情（`openStop`，含"为什么延后一拍"）。
 */

import { useCallback, useEffect, useRef } from 'react'

import { loadCity } from '~/common/data/cityRegistry'
import {
  createMarkerLayer,
  createRouteLayer,
  STOP_FOCUS_ZOOM,
  Z_LAYER,
  type MarkerItem,
  type RouteLeg,
  type RoutePoint,
} from '~/common/map/tencent'

import { useFitOnce } from './useFitOnce'
import type { JamSpan } from './itinerary/jams'
import type { PlanStopView } from './itinerary/planStops'
import type { MapShellContext } from './mapShell'
import type { RoutePlan, TravelMode } from '~shared/schema'

export interface PlanRouteLayerOptions {
  shell: MapShellContext
  plan: RoutePlan | null
  stops: PlanStopView[]
  /** `false` = 这条链路不接管地图（完整行程页用 `false`） */
  enabled: boolean
  /**
   * **用户正展开的那一段**（`null` = 没展开任何一段）。
   *
   * ★ 2026-10-04 用户：「切换到那个出行方式，下方列表显示多条路线供用户选择，
   *   相对应的，**左侧的地图要显示路线**」
   *   「出行方式展开的时候，**地图要跳转到这两个点的位置**」
   *   「地图上需要有路线选择，**未选中的要加透明度**，选中的（不要）透明度」。
   *
   * · `routes` —— 该段**当前方式下的多条候选路线**（已解码）。
   *   底下的整条线保留（回答"这趟大概怎么走"），这些叠在上面（回答"这一段怎么走"）。
   * · `focusedKey` —— 其中被选中的那条。★ 未选中的会由 `routeLayer` 自动画成
   *   **半透明**（`solidDim` / `dashedDim` = `rgba(INK,0.4)`，见那个文件里
   *   `baseStyleId` 的分派），选中的则是主色实线 —— 正是用户要的对比。
   *   没选时传 `null`：那所有候选都一样淡，用户知道"还得挑一条"。
   * · `from` / `to` —— 镜头要收到这一段的两端。
   */
  legFocus?: {
    routes: Array<{
      key: string
      mode: TravelMode
      path: RouteLeg['path']
      /**
       * ★ 公交/地铁的**分段**（步行一条 + 每条线路各一条，各带**线路官方色**）。
       * 选中的那条按它逐段画；其余方式（没有这个字段）画一根线。
       */
      segments?: Array<{ kind: 'walk' | 'ride'; path: RouteLeg['path']; color?: string }>
      /**
       * 拥堵切片（该方案 `path` 的下标区间）。
       * ★ 只有"点开这一段、真拉过方案"才有 —— 路况不落盘，刷新即失。
       *   结构与 `routeLayer.JamSpan` 同构，直接透传。
       */
      jams?: JamSpan[]
    }>
    focusedKey: string | null
    from: RoutePoint
    to: RoutePoint
  } | null
}

export function usePlanRouteLayer({
  shell,
  plan,
  stops,
  enabled,
  legFocus,
}: PlanRouteLayerOptions): void {
  const routeRef = useRef<ReturnType<typeof createRouteLayer> | null>(null)
  const markRef = useRef<ReturnType<typeof createMarkerLayer> | null>(null)

  /** 当前 `stops` / `plan` 的**现取值** —— 点击回调只注册一次，不能捕获建层那一刻的数组 */
  const stopsRef = useRef(stops)
  stopsRef.current = stops
  const planRef = useRef(plan)
  planRef.current = plan

  const map = shell.map
  const active = enabled && Boolean(map)

  /**
   * 点一枚**序号标记** = 打开这一站。这是规划详情态下那个位置上**唯一**的标记。
   *
   * ## 为什么必须是这一层接（用户 2026-09-28）
   * 停靠点若是景点，景点图层会被要求**让位**（`ViewportEnv.claimed` ⇒
   * 它不画那枚圆点、也不把它交给聚合）—— 于是"点这枚标记看详情"只能由这里接。
   * 反过来说：**这一层接上点击之后，那个位置才重新可点**。
   *
   * | 点的是 | 做什么 |
   * |--------|--------|
   * | 景点（有 `poiId`） | `loadCity` 取完整对象 → `shell.setSearchPick` 交给**当前页面**开详情（三页通用，走的就是搜索/「挑景点」那条信道） |
   * | 自己取的「地图取点」 | 没有详情可开 ⇒ 把它**居中放大**（与点面板里那个标题同一个落点与缩放） |
   *
   * ★★ **延后一拍**再交出去：腾讯点中覆盖物时**地图自己的 click 照样派发**
   *   （SDK 两处都发，见 `poiClicks` 文件头），而那条路会被判成"点了空白"⇒ 把详情收起来。
   *   同步打开会被它当场关掉 —— 表现为"点了一下、闪一下没了"，而且不报错。
   *   两处回调都在**同一个任务**里派发，所以 `setTimeout(0)` 必定在它们之后。
   */
  const openStop = useCallback(
    (markId: string) => {
      const uid = markId.replace(/^planseq-/, '')
      const stop = stopsRef.current.find((s) => s.uid === uid)
      if (!stop) return
      if (!stop.poiId) {
        shell.focusPoint({ lng: stop.lng, lat: stop.lat }, STOP_FOCUS_ZOOM)
        return
      }
      const cityId = planRef.current?.cityId ?? ''
      if (!cityId) return
      void (async () => {
        const city = await loadCity(cityId)
        const poi = city?.pois.find((p) => p.id === stop.poiId)
        if (!city || !poi) return
        setTimeout(() => shell.setSearchPick({ poi, cityId, cityName: city.name }), 0)
      })()
    },
    [shell],
  )
  /** 同上：把最新的回调放进 ref，建层那个 effect 的依赖才不必跟着 `shell` 换身份重建 */
  const openRef = useRef(openStop)
  openRef.current = openStop

  // 建层 / 拆层
  useEffect(() => {
    if (!active || !map) return
    const route = createRouteLayer(map)
    /*
     * ★ `planMarker` —— 在景点那几层（圆点 / 名字 / 选中）**之上**，
     *   因为规划详情态下停靠点位置上的景点圆点会让位（见 `PoiUpdateOptions.claimed`），
     *   那个位置上就只剩它。
     * ★ **必须在路线之上**：序号被路线穿过就看不清数字了。层级表见 `zLayers.ts`。
     * ★ **必须接点击**：原来这一层没给 `onClick`，于是点它就等于"点到一个没有处理器的
     *   覆盖物"—— 景点那枚又被盖在下面收不到点击 ⇒ 用户报的"没办法打开景点详情"。
     */
    const marks = createMarkerLayer(map, {
      zIndex: Z_LAYER.planMarker,
      onClick: (id) => openRef.current(id),
    })
    routeRef.current = route
    markRef.current = marks
    return () => {
      route.destroy()
      marks.destroy()
      routeRef.current = null
      markRef.current = null
    }
  }, [map, active])

  // 画线 + 序号
  useEffect(() => {
    const route = routeRef.current
    const marks = markRef.current
    if (!route || !marks) return

    const legs: RouteLeg[] = []
    if (plan?.route && plan.route.path.length >= 2) {
      legs.push({
        id: `plan-${plan.id}`,
        // 整条统一用规划的方式 —— 线型（步行虚线）因此也能正确表达
        mode: (plan.mode ?? 'driving') as TravelMode,
        path: plan.route.path,
      })
    }
    /**
     * ★ 展开段的多条候选叠在上面。`focusId` 交给图层去分派明暗：
     *   命中它的是 `solidOn/dashedOn`（主色、粗、不透明），
     *   其余自动落到 `solidDim/dashedDim`（`rgba(INK,0.4)` = **半透明**）。
     *   ⚠️ `focusId` 用**前缀化**的 id（`leg-${key}`）—— 直接传 `key`（'A'/'B'/'C'）
     *   会跟别的 id 撞上，而撞上之后只是"高亮错了那条"，不报错。
     */
    /**
     * ★★★ 2026-10-05（用户）：「这个在地图上显示**就是一条线**，得做标识 ——
     *   哪一段到哪一段是步行，哪一段到哪一段是公共交通，地铁线路官方都有默认的颜色」。
     *
     * ⇒ **选中的那条按 `segments` 逐段画**：步行＝虚线，乘车＝**该线路的官方色**。
     *   其余候选仍是**一根浅蓝** —— 它们是"待比"，不该用线路色抢眼；
     *   颜色要留给"我选的这条"（否则五颜六色铺满屏，反而看不出哪个是选中）。
     *
     * ★ `onTop` 打在**每一段**上（不再是只有一个 id 的 `focusId`）——
     *   一条公交方案被选中就有好几段，每一段都要压在待选之上。
     */
    for (const r of legFocus?.routes ?? []) {
      const focused = r.key === legFocus?.focusedKey
      if (focused && r.segments && r.segments.length > 0) {
        /**
         * ★ **换乘点 = 第 2 个及以后的乘车段的起点。**
         *
         * 换乘就落在"上一程下车、下一程上车"的那一点上，而它正好是**后一个乘车段
         * 的第一个坐标** —— 不需要任何额外字段。判定放在这里（而不是图层里）：
         * 只有这一层手里有完整的分段序列，图层只该回答"这个坐标要一枚换乘点"。
         *
         * ★ 步行段打 `transitWalk`（灰细虚线）—— 与"整条就是步行"分开，
         *   见 `routeStyles.styleIdOf`。
         */
        let seenRide = false
        r.segments.forEach((s, i) => {
          const isRide = s.kind === 'ride'
          /**
           * ★ **"之前是否已经坐过一程"要在 `return` 之前取**（2026-10-05 审查发现）。
           *
           * 下面那个 `return` 会跳过**画不出来**的段（坐标不足 2 点），而它同时也跳过了
           * `seenRide` 的更新。换乘点的判据是"**行程序列**里这是第 2 程及以后"，
           * 与"这一段有没有被画出来"无关 —— 上一程没画出坐标，下一程的上车点**照样**
           * 是换乘站。所以先记账、再决定画不画。
           */
          const hadRide = seenRide
          if (isRide) seenRide = true
          if (s.path.length < 2) return
          legs.push({
            id: `leg-${r.key}-${i}`,
            mode: r.mode,
            path: s.path,
            candidate: true,
            onTop: true,
            ...(s.color ? { color: s.color } : {}),
            ...(isRide ? {} : { dashed: true, transitWalk: true }),
            ...(isRide && hadRide ? { transferAtStart: true } : {}),
          })
        })
        continue
      }
      if (r.path.length < 2) continue
      /**
       * ★★ 公交/地铁走上面的分段分支；**其余方式（没有 `segments`）落到这里**。
       *
       * ⚠️⚠️ 这一行**必须也判 `focused`** —— 漏了它的后果是：
       *   选中的那条只有 `candidate`（没有 `onTop`）⇒ 被画成**待选的浅蓝**，
       *   与其他几条**一模一样**，用户完全看不出自己选了哪条。
       *   而公交那条走上面的分支、每段都标了 `onTop`，所以**偏偏只有它是对的** ——
       *   用户 2026-10-05 报的正是「**除公共交通外的四个**，已选和待选的颜色怎么一样了」。
       *   ⇒ 两个分支都要给"选中的那条"打 `onTop`，这是同一个条件的两处出口。
       */
      legs.push({
        id: `leg-${r.key}`,
        mode: r.mode,
        path: r.path,
        candidate: true,
        ...(focused ? { onTop: true } : {}),
        /**
         * ★ **拥堵描色**（2026-10-25）：区间由 `jamsOf()` 从 `get_speed=1` 的
         *   `polyline_idx` 直接算出（不用回头找对应段）。只有**这一段被点开、
         *   真拉过方案**时才有值 —— 路况不落盘，所以刷新后会消失，这是对的。
         *   图层那边只在 `path` 是真实折线时才画（两点直连没有"哪一段堵"可言）。
         */
        ...(r.jams && r.jams.length > 0 ? { jams: r.jams } : {}),
      })
    }
    route.setLegs(legs)

    marks.set(
      stops
        .filter((s) => s.resolved)
        .map((s, i): MarkerItem => ({
          id: `planseq-${s.uid}`,
          styleId: `seq${Math.min(9, i + 1)}`,
          lng: s.lng,
          lat: s.lat,
        })),
    )
  }, [plan?.id, plan?.route, plan?.mode, stops, legFocus])

  /**
   * **展开某一段 → 镜头跳到这一段的两端**（用户：「出行方式展开的时候，
   * 地图要跳转到这两个点的位置」）。
   *
   * ★ 依赖用**四个标量**而不是 `legFocus` 对象：对象身份由上游决定，一旦哪天上游
   *   改成"每次渲染都新建"，用对象做依赖就会让镜头**每次重渲染都飞一次**。
   *   标量相等就不动 —— 这正是我们要的"只在换段/换端点时跳"。
   *
   * ★★ **`shell.fit` 走 ref、不进依赖**（2026-10-05 审查发现）：`shell` 是外壳里那个
   *   `useMemo`，依赖含底图状态 / `searchPick` / `fallback` —— **切底图详细度、
   *   或搜索命中一枚点**都会让它换身份 ⇒ 镜头被**与地图无关的操作**拉回这一段的两端。
   *   这正是下面 `fitKey` 注释里记的那个坑（"换一次底图就把镜头拉回去"）：
   *   那条 `useFitOnce` 已经规避了，唯独这一条漏了。
   * ★ `reason: 'drill'` 给一段 600ms 动画，让用户看懂镜头是从哪儿过来的。
   */
  const fromLng = legFocus?.from.lng
  const fromLat = legFocus?.from.lat
  const toLng = legFocus?.to.lng
  const toLat = legFocus?.to.lat
  /** `shell.fit` 的**现取值** —— 用 ref 让下面那个 effect 不必把 `shell` 放进依赖 */
  const fitRef = useRef(shell.fit)
  fitRef.current = shell.fit
  useEffect(() => {
    if (!active || fromLng === undefined || toLng === undefined) return
    fitRef.current(
      [
        { lng: fromLng, lat: fromLat as number },
        { lng: toLng, lat: toLat as number },
      ],
      { reason: 'drill' },
    )
  }, [active, fromLng, fromLat, toLng, toLat])

  /**
   * 取景：**按规划的身份**取一次。
   * key 用 `规划 id + 已解析点位数` —— 点位数变化（加/删点）值得重新取景，
   * 而 `plan` / `stops` 这两个对象在无关重渲染里会换引用（同 `usePlanMapLayers` 踩过的坑：
   * 拿对象当 key 会让"换一次底图就把镜头拉回去"）。
   */
  const anchors = stops.filter((s) => s.resolved)
  const fitKey = active && plan && anchors.length > 0
    ? `${plan.id}|${anchors.length}|${anchors[0]?.uid ?? ''}|${anchors[anchors.length - 1]?.uid ?? ''}`
    : null
  useFitOnce(fitKey, shell.status === 'ready', () =>
    shell.fit(
      anchors.map(({ lng, lat }) => ({ lng, lat })),
      { reason: 'drill' },
    ),
  )
}
