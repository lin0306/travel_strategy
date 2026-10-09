/**
 * 地图实例的生命周期（React 侧唯一的入口）。
 *
 * ## 这个 hook 负责什么 / 不负责什么
 * 负责：SDK 加载状态、建图、底图预设接管、**事件注册**、卸载清理。
 * 不负责：任何图层内容（点位/区划/连线各有自己的 `create*Layer`）——
 * 那部分由页面组件在拿到 `map` 之后自行创建，这样图层可以随路由自由增删。
 * 也不负责"收到事件之后怎么办"—— 那部分在 `viewportEmitter.ts`（时序是另一种知识）。
 *
 * ## 两个必须做对的地方
 *
 * ### 1. 卸载要逐个 `off()`
 * 腾讯的 `map.on(name, fn)` **返回的是 map 实例，不是取消订阅函数**，
 * 所以 `const off = map.on(...)` 这种写法在腾讯这边是错的（拿到的是 map）。
 * 必须自己留着 `name` + `fn`，卸载时 `map.off(name, fn)`。
 * 漏掉的后果：缩放一次触发多次回调（旧实例的 handler 还活着）。
 *
 * ### 2. 地图失败绝不能拖垮页面
 * 列表 / 筛选 / 详情 / 区划列表 / 行程时间计算全部独立于地图存活。
 * 所以这里把失败收敛成 `status: 'error'` 让 UI 渲染降级卡片，**不往外抛**。
 *
 * ## 事件名（腾讯这边最阴的地方）
 *   · 缩放是**光杆 `zoom`**，写成 `zoom_changed` 不会报错、只是永不触发
 *   · 中心/视野变化**带下划线**：`center_changed` / `bounds_changed`
 * 三条都注册，统一交给 `viewportEmitter` 做防抖 —— 拖动过程中每帧重算会明显掉帧。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { debugLog } from '~/common/logic/debugLog'

import {
  BasemapController,
  type BasemapDetailId,
  type BasemapKind,
  type BasemapLevel,
  type BasemapState,
} from './basemap'
import { fitPoints, NATIONAL_VIEW, type FitOptions, type LatLngLike } from './fitView'
import { focusPointTo, panPointToCenter } from './panTo'
import { loadTMapSdk, mapErrorText, warnIfMapLikelyFailed, type MapErrorCode } from './loader'
import { createViewportEmitter, type ViewportChange, type ViewportEmitter } from './viewportEmitter'
import { describeTierRules } from './zoomTiers'

export type MapStatus = 'loading' | 'ready' | 'error'

export interface MapFailure {
  code: MapErrorCode | 'unknown'
  /** 已中文化，可直接渲染 */
  text: string
}

export interface UseTMapOptions {
  /** 地图容器。★ 必须是「铺满视口的地图层」本身，不是某个浮层 */
  containerRef: React.RefObject<HTMLElement | null>
  /**
   * 当前可见的浮层元素（用来实测空闲矩形 → fitBounds padding）。
   * 用 ref 传而不是数组值：浮层是随路由变化的，传值会让 hook 反复重建。
   */
  overlaysRef?: React.RefObject<Array<HTMLElement | null>>
  /** 地图创建成功时回调 —— 页面在这里建自己的图层 */
  onReady?: (map: TMap.Map) => void
  /**
   * 视野变化时回调（zoom / 平移结束）。★ 不要在这里做重活 ——
   * 收口方（外壳）会把这次广播扇出给页面登记的图层，圆点/徽标/标注按缩放重算。
   */
  onViewportChange?: (e: ViewportChange) => void
  /**
   * 底图状态变化（用户在下拉里换了类型、切了档位、或动了某个开关）。
   * ⚠️ 只在**用户操作**时触发 —— 底图不再随缩放自动切换（见 `basemap.ts` 文件头）。
   */
  onBasemapChange?: (state: BasemapState) => void
  /** 初始中心（默认中国全图） */
  center?: LatLngLike
  zoom?: number
}

export interface UseTMapResult {
  status: MapStatus
  failure: MapFailure | null
  /** 就绪后才有值。★ 不要在渲染期直接读它做副作用 */
  map: TMap.Map | null
  /**
   * 当前底图状态（类型 + 每类的详细度开关）。地图就绪前为 `null`（下拉此时禁用）。
   * ★ 拆成"类型 / 档位 / 单项"三个动作而不是暴露一个 setter：
   *   "档位 → 开哪几项"这条规则住在 `basemap.ts`，界面不该知道它。
   */
  basemap: BasemapState | null
  setBasemapKind: (kind: BasemapKind) => void
  setBasemapLevel: (level: BasemapLevel) => void
  toggleBasemapDetail: (id: BasemapDetailId) => void
  /** 失败后重试（超时多为网络抖动，值得给用户一次机会） */
  retry: () => void
  /** 把点位框进「没被浮层盖住的地方」 */
  fit: (points: LatLngLike[], opts?: Omit<FitOptions, 'container' | 'overlays'>) => boolean
  /**
   * 把**一个点**平移到「没被浮层盖住的地方」的中心 —— **不改缩放**。
   * 点开景点详情时用：不拉深镜头，只把那个点从会被详情面板盖住的位置挪到可视区中央。
   */
  centerOn: (point: LatLngLike) => boolean
  /**
   * 把一个点**以指定缩放**放到可视区中心（行程里点一个站点用）。
   * 与 `centerOn` 只差一处：缩放是**给定的**，不由框大小反推 ——
   * `fitBounds` 对单点只能从退化框反推级别，给不出确定的落点。
   */
  focusPoint: (point: LatLngLike, zoom: number) => boolean
  /**
   * 手动触发一次视野重刷（圆点/徽标/标注都按当前缩放重算）。
   *
   * ★ 三条自动路径已经覆盖了绝大多数情况，**页面不要自己调它**：
   *   · 用户缩放/平移 → 停手 120ms 后广播
   *   · 取景（`fit`）→ 稳定检测到动画结束再广播
   *   · 外壳发现浮层增删 → 由外壳调
   * 它剩下的用途只有一个：**地图没动、但可用区变了**（浮层显隐）时强制重算。
   * 页面在 `shell.fit()` 之后补调它曾经是必须的 —— 现在有了稳定检测就不再需要，
   * 而且补调反而有害（读到动画第 0 帧）。`check_app.py` 的 V 项守这条。
   */
  refreshView: () => void
  /**
   * 当前地图中心。用于「用地图中心点当住宿点」这类**用户主动点击**的取值场景。
   *
   * ★ 它不是"获取用户位置"—— 中心点取决于用户自己把地图挪到了哪，
   *   与设备的定位权限无关。本项目不采集、不上传任何位置信息。
   */
  center: () => LatLngLike | null
}

/**
 * 初始视野：**中国全图**。
 *
 * ⚠️ 这里曾经写死成都（`104.0668, 30.5728` / zoom 11），注释写的是"首批数据只做成都"。
 *    那在只有一座城市时看着没毛病，但它埋了一个后果：**任何页面只要没能自己
 *    `fit()` 成功，就会露出这个"默认城市"** —— 首页（全国视图）在区划树缺席时
 *    正好是这种情况，于是打开首页看到的是一片成都市区。
 *
 *    取景该由**页面**决定：首页框全国（`NATIONAL_FIT_CORNERS`）、城市页框本城。
 *    引擎给一个中性的全国视野，只在页面还没接手前兜住第一帧。
 */
const DEFAULT_CENTER: LatLngLike = NATIONAL_VIEW.center
const DEFAULT_ZOOM = NATIONAL_VIEW.zoom

export function useTMap(opts: UseTMapOptions): UseTMapResult {
  const [status, setStatus] = useState<MapStatus>('loading')
  const [failure, setFailure] = useState<MapFailure | null>(null)
  const [basemap, setBasemapState] = useState<BasemapState | null>(null)
  const [attempt, setAttempt] = useState(0)

  // 用 ref 存实例与回调：这些变化**不应该**触发重建地图
  const mapRef = useRef<TMap.Map | null>(null)
  const basemapRef = useRef<BasemapController | null>(null)
  const listenersRef = useRef<Array<{ name: string; fn: TMap.EventHandler }>>([])
  const optsRef = useRef(opts)
  optsRef.current = opts

  /*
   * 视野广播器：**每个 hook 实例一个，跨建图/卸载存活**。
   * 它的状态（手势起点、上次签名）不属于地图实例，属于"这个页面在看什么"，
   * 所以放在 effect 外 —— 否则重试建图会把时序状态一起清掉。
   * 用惰性初始化而不是 `useRef(createViewportEmitter(...))`：后者每次渲染都会
   * 白白造一个被丢弃的对象（并发两个 emitter 还会各记一份日志）。
   */
  const emitterRef = useRef<ViewportEmitter | null>(null)
  if (emitterRef.current === null) {
    emitterRef.current = createViewportEmitter({
      getMap: () => mapRef.current,
      onChange: (e) => optsRef.current.onViewportChange?.(e),
    })
  }
  const emitter = emitterRef.current

  useEffect(() => {
    const el = optsRef.current.containerRef.current
    if (!el) {
      setStatus('error')
      setFailure({ code: 'unknown', text: '地图容器尚未就绪' })
      return
    }

    let disposed = false
    let stopSuspectCheck: (() => void) | null = null

    setStatus('loading')
    setFailure(null)

    loadTMapSdk()
      .then(({ sdk }) => {
        // ★ 异步返回后组件可能已卸载 —— 不判这一下会在 StrictMode 下建出两个地图实例
        if (disposed) return

        const map = new sdk.Map(el, {
          center: new sdk.LatLng(
            optsRef.current.center?.lat ?? DEFAULT_CENTER.lat,
            optsRef.current.center?.lng ?? DEFAULT_CENTER.lng,
          ),
          zoom: optsRef.current.zoom ?? DEFAULT_ZOOM,
          // ⚠️ 腾讯缩放范围是 3~20（不是 2，也不是 22）
          minZoom: 3,
          maxZoom: 20,
          viewMode: '2D',
          // 腾讯自带控件与我们自绘的浮层风格冲突 → 关掉
          showControl: false,
          doubleClickZoom: true,
          draggable: true,
          scrollable: true,
        })
        mapRef.current = map

        /* 底图：控制器只负责「用户选了什么」，页面只管显示（不再有自动降级） */
        const controller = new BasemapController({
          onChange: (state) => {
            if (disposed) return
            setBasemapState(state)
            optsRef.current.onBasemapChange?.(state)
          },
        })
        basemapRef.current = controller
        controller.attach(map)
        setBasemapState(controller.getState())

        /*
         * 注册事件。三条都要记进 listenersRef 以便卸载时精确 off()。
         * 事件名的坑见文件头；"收到之后怎么办"（防抖 / 稳定检测）在 viewportEmitter。
         *
         * ⚠️ 这里**不再**复算底图。上一版会按缩放把影像自动降级成矢量，
         *    那是"系统替用户改选择"，已删（见 `basemap.ts` 文件头）。
         */
        const onZoom: TMap.EventHandler = () => emitter.scheduleGesture('zoom')
        const onMove: TMap.EventHandler = () => emitter.scheduleGesture('move')

        map.on('zoom', onZoom)
        map.on('center_changed', onMove)
        map.on('bounds_changed', onMove)
        listenersRef.current = [
          { name: 'zoom', fn: onZoom },
          { name: 'center_changed', fn: onMove },
          { name: 'bounds_changed', fn: onMove },
        ]

        stopSuspectCheck = warnIfMapLikelyFailed(map, (msg) => {
          // 只记日志不判死：慢网下误判成失败会直接把可用地图换成降级卡片
          console.warn('[map]', msg)
        })

        setStatus('ready')
        // 开机先把「哪个缩放级别该显示什么」打出来 —— 之后每一个异常读数都能
        // 当场对照规则表，不必回头翻源码（见 `zoomTiers.describeTierRules`）
        debugLog('规则', describeTierRules())
        debugLog(
          '规则',
          `容器 ${el.clientWidth}×${el.clientHeight} · 初始 z=${map.getZoom().toFixed(2)}`,
        )
        optsRef.current.onReady?.(map)
      })
      .catch((err: unknown) => {
        if (disposed) return
        const code = (err as { code?: MapErrorCode }).code ?? 'unknown'
        setStatus('error')
        setFailure({ code, text: mapErrorText(err) })
      })

    return () => {
      disposed = true
      if (stopSuspectCheck) stopSuspectCheck()
      emitter.dispose()

      // ★ 逐个 off —— 腾讯不接受"统一清除"，也不返回取消函数
      const map = mapRef.current
      if (map) {
        for (const { name, fn } of listenersRef.current) map.off(name, fn)
      }
      listenersRef.current = []
      basemapRef.current?.detach()
      basemapRef.current = null
      map?.destroy()
      mapRef.current = null
    }
  }, [attempt, emitter])

  const fit = useCallback<UseTMapResult['fit']>(
    (points, o) => {
      const map = mapRef.current
      const el = optsRef.current.containerRef.current
      if (!map || !el) return false
      const ok = fitPoints(map, points, {
        container: el,
        overlays: optsRef.current.overlaysRef?.current ?? [],
        ...o,
      })
      // ★ 取景是**动画**：以"稳定检测"代替"页面自己再补一次重刷"。
      //   补的那次读的是动画第 0 帧，两层内容会各按一个缩放铺一遍（闪一下），
      //   而且四个页面里只有两个补了、另外两个没补 —— 同一件事四种写法。
      if (ok) emitter.watchSettle()
      return ok
    },
    [emitter],
  )

  /**
   * 平移（不缩放）到某点。★ 与 `fit` 共用同一套浮层避让，动画结束同样走稳定检测 ——
   * 两层内容会按新的缩放重算一遍，不能让页面自己补 `refreshView`（读到动画第 0 帧）。
   */
  /**
   * 取「地图 + 容器 + **现场查到的**浮层清单」。
   *
   * ★ 浮层清单**现场查 DOM**，不用 `overlaysRef`：详情面板是"点开详情"这一下才挂上的，
   *   外壳的收集 effect 与这里的时序赛跑不稳定（实测两次都少算它，点落在面板边上而不是正中）。
   *   调用方都在 `rAF×2` 之后才动，那时 DOM 一定已提交，现场查一定准。
   *
   * 只读 ref，所以 `useCallback` 的依赖是空的 —— 拿到的永远是最新的 ref。
   */
  const overlayAware = useCallback(() => {
    const map = mapRef.current
    const el = optsRef.current.containerRef.current
    if (!map || !el) return { map, el, overlays: [] as Array<HTMLElement | null> }
    const root = el.parentElement
    return {
      map,
      el,
      overlays: root
        ? Array.from(root.querySelectorAll<HTMLElement>('[data-overlay]'))
        : (optsRef.current.overlaysRef?.current ?? []),
    }
  }, [])

  const centerOn = useCallback<UseTMapResult['centerOn']>(
    (point) => {
      const { map, el, overlays } = overlayAware()
      if (!map || !el) return false
      const ok = panPointToCenter(map, point, { container: el, overlays })
      if (ok) emitter.watchSettle()
      return ok
    },
    [emitter, overlayAware],
  )

  /**
   * 把一个点**以指定缩放**放到可视区中心（行程里点一个站点用）。
   * 与 `centerOn` 的差别只有一处：**缩放是给定的**，不由框大小反推。
   */
  const focusPoint = useCallback<UseTMapResult['focusPoint']>(
    (point, zoom) => {
      const { map, el, overlays } = overlayAware()
      if (!map || !el) return false
      const ok = focusPointTo(map, point, zoom, { container: el, overlays })
      if (ok) emitter.watchSettle()
      return ok
    },
    [emitter, overlayAware],
  )

  const refreshView = useCallback(() => emitter.refreshView(), [emitter])

  const setBasemapKind = useCallback((kind: BasemapKind) => {
    basemapRef.current?.setKind(kind)
  }, [])

  const setBasemapLevel = useCallback((level: BasemapLevel) => {
    basemapRef.current?.setLevel(level)
  }, [])

  const toggleBasemapDetail = useCallback((id: BasemapDetailId) => {
    basemapRef.current?.toggleDetail(id)
  }, [])

  const center = useCallback<UseTMapResult['center']>(() => {
    const map = mapRef.current
    if (!map) return null
    const c = map.getCenter()
    // ⚠️ 转成 (lng, lat) —— 腾讯自己的 LatLng 是 lat 在前，
    //    项目内部一律用 (lng, lat)，转换只在这一处发生
    return { lng: c.getLng(), lat: c.getLat() }
  }, [])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  /*
   * 这里直接暴露 `mapRef.current` 看似不安全（ref 变化不触发渲染），
   * 但时序上成立：建图 → `mapRef.current = map` → `setBasemapState()` 触发重渲染，
   * 所以消费方**每次拿到 ready 状态时** `mapRef.current` 必已有值。
   * 代价是不能靠 `map` 字段自身的变化去驱动副作用 —— 地图只建一次，本来也不需要。
   */
  return {
    status,
    failure,
    map: mapRef.current,
    basemap,
    setBasemapKind,
    setBasemapLevel,
    toggleBasemapDetail,
    retry,
    fit,
    centerOn,
    focusPoint,
    refreshView,
    center,
  }
}
