/**
 * 腾讯地图 JS API GL 的最小类型声明。
 *
 * 为什么自己写而不是装包：腾讯不提供 npm 类型包，官方做法就是在项目里声明全局。
 * 这里**只声明本项目实际用到的部分** —— 声明全集既没人维护，也会掩盖
 * "我们到底用了 SDK 的哪些能力"这件事。
 *
 * 坐标系提醒：腾讯所有接口都是 **`纬度在前`** —— `new TMap.LatLng(lat, lng)`。
 * 与 GeoJSON 的 `[lng, lat]` 相反，跨边界处必须显式转换。
 */

declare namespace TMap {
  class LatLng {
    constructor(lat: number, lng: number)
    lat: number
    lng: number
    getLat(): number
    getLng(): number
  }

  /**
   * 边界框。
   * ⚠️ 构造需要**一个初始范围**，想要空集必须先建一个"反向"的全球 box
   * （`LatLng(90,180)` → `LatLng(-90,-180)`）再逐点 `extend()`。
   * 直接 `new LatLngBounds(sw, ne)` 得到的是一个固定范围，不是空集。
   */
  class LatLngBounds {
    constructor(southWest: LatLng, northEast: LatLng)
    extend(latlng: LatLng): this
    getCenter(): LatLng
    getSouthWest(): LatLng
    getNorthEast(): LatLng
  }

  interface PaddingOptions {
    top?: number
    bottom?: number
    left?: number
    right?: number
  }

  interface FitBoundsOptions {
    padding?: PaddingOptions
    /** 动画时长（ms）。0 = 立即 */
    duration?: number
  }

  interface BaseMapOptions {
    /** 'vector' | 'satellite' */
    type: string
    /**
     * 特性开关。
     * ⚠️ 卫星图必须带 `'road'`，否则得到一张**没有任何路名地名**的影像图，
     *    用户完全失去参照。
     */
    features: string[]
  }

  interface MapOptions {
    center: LatLng
    zoom?: number
    /** 缩放范围只能是 3~20（不是 22） */
    minZoom?: number
    maxZoom?: number
    pitch?: number
    rotation?: number
    viewMode?: '2D' | '3D'
    baseMap?: BaseMapOptions
    styleId?: string
    /** 是否显示腾讯自带的缩放/比例尺控件（我们自己画控件，所以关掉） */
    showControl?: boolean
    doubleClickZoom?: boolean
    draggable?: boolean
    scrollable?: boolean
  }

  interface MapEvent {
    latLng?: LatLng
    geometry?: { id?: string }
    [key: string]: unknown
  }

  /**
   * 聚合簇里的一个点位。`properties` 是我们自己塞进去的（SDK 原样带回）。
   */
  interface ClusterGeometry {
    position: LatLng
    id?: string
    properties?: Record<string, unknown>
  }

  /**
   * `getClusters()` 的一个元素。三个字段都**来自 SDK 真源码**（`normalizeClusterInfo`）。
   *
   * ★ 三条实测事实（2026-09-22 读 bundle，见 `plans/12-poi-aggregation.md` §2.3）：
   * 1. **单点也是一个簇** —— `geometries` 就是长度 1 的数组。所以"哪些点没被聚合"
   *    是问得出来的，不必猜。
   * 2. `center` 是真 `LatLng`（`averageCenter` 默认 true → 成员平均）。
   * 3. `bounds` = **以簇心为中心、向外扩 `gridSize` 的框**（`_getExtendedBounds`）。
   *    这就是 `zoomInCluster()` 要 fit 的东西 —— 所以点一下会跳 3~4 级，不是 +1 级。
   */
  interface ClusterInfo {
    center: LatLng
    geometries: ClusterGeometry[]
    bounds: unknown
  }

  /**
   * `MarkerCluster` 的 `click` 载荷。
   *
   * 🚨 **只有 `cluster`，`geometry` 永远不会出现。** 源码 `_constructOverlay` 里写的是
   *    `t.geometries ? e.cluster = t : e.geometry = t`，而每个簇都带 `geometries`
   *    （单点簇 = 长度 1）→ 三元永远走前一支。
   *    判断"点的是气泡还是单点"要读 `evt.cluster.geometries.length`。
   *    **源码里出现 `evt.geometry` 就是死分支**（`check_app.py` 的 Z 项守这条）。
   */
  interface ClusterEvent {
    cluster?: ClusterInfo
    [key: string]: unknown
  }

  /**
   * ## 事件名对照表（写错 = 不报错 + 永不触发，所以必须集中记一处）
   *
   * | 场景 | 正确名 | 常见误写 |
   * |------|--------|----------|
   * | 地图缩放完成 | **`zoom`**（光杆） | ~~`zoom_changed`~~ |
   * | 地图中心变化 | `center_changed` | ~~`centerchange`~~ |
   * | 地图视野变化 | `bounds_changed` | ~~`boundschange`~~ |
   * | 覆盖物悬停 | **`hover`** | ~~`mouseover`~~ / ~~`mouseout`~~ |
   * | 覆盖物点击 | `click` | — |
   *
   * 两条额外事实：
   * 1. **缩放事件是光杆 `zoom`** —— 命名风格与另外两个不一致，最容易被"顺手写对"。
   * 2. **`hover` 一个事件兼管移入与移出**：离开时 `evt.geometry` 为 `null`，
   *    不需要（也没有）`mouseout`。
   */
  type OverlayEventName = 'click' | 'dblclick' | 'hover' | 'mousedown' | 'mouseup' | 'mousemove'

  type EventHandler = (evt: MapEvent) => void

  class Map {
    constructor(container: string | HTMLElement, options: MapOptions)

    /**
     * ⚠️ **返回的是 map 实例，不是取消订阅函数** → 解绑必须 `map.off(name, fn)`。
     *    组件卸载时忘记 off 会导致缩放一次触发多次回调。
     */
    on(eventName: string, handler: EventHandler): this
    off(eventName: string, handler: EventHandler): this

    getZoom(): number
    setZoom(zoom: number, options?: { duration?: number }): this
    getCenter(): LatLng
    setCenter(center: LatLng, options?: { duration?: number }): this
    /**
     * 双击放大的**开关**（临时装卸 SDK 挂在 `dblclick` 上的那个 handler）。
     *
     * ★ 实测存在（`_tmp/cdp_gap_dblclick.mjs` 读到的 `getDoubleClickZoom` = `true`），
     *   源码里是 Leaflet 那一套 `doubleClickZoom.enable()/disable()`。
     * ★ 用它而不是在建图时关掉整张图：我们要的是"**只有景点**双击不放大"
     *   （用户原话：「景点，不包括区域和那个聚合点」）——
     *   空白 / 徽标 / 数字气泡仍要能双击放大。
     * ★ 标成可选：SDK 哪天去掉它，调用方退化成"双击仍然放大"（旧行为），不抛错。
     */
    setDoubleClickZoom?(enabled: boolean): this
    getDoubleClickZoom?(): boolean
    /** ⚠️ padding 支持对象形式 `{top, bottom, left, right}`（原型已实测） */
    fitBounds(bounds: LatLngBounds, options?: FitBoundsOptions): this
    getBounds(): LatLngBounds
    /** 地图容器 DOM（浮层实测要用它当坐标系基准） */
    getContainer?(): HTMLElement
    /**
     * 经纬度 → **容器像素**（左上角为原点）。
     *
     * ★ 腾讯没在文档里承诺这个 API，但真机实测一直在用（徽标点击探针、
     *   覆盖物对齐探针都靠它定位）。本项目的用法只有一个：
     *   把"簇心 / 点位"换算成屏幕坐标，与**指针位置**比距离 ——
     *   用来裁掉一次点击里那些"不是用户点中的"载荷（见 `poiCluster.onClick`）。
     *   取不到时调用方会退化成"不裁"（保持旧行为），不会崩。
     */
    projectToContainer?(latLng: LatLng): { getX(): number; getY(): number }
    /** ★ 接收配置对象，不是图层实例 —— 与高德的 `add/remove` 心智完全不同 */
    setBaseMap(baseMap: BaseMapOptions): this
    setStyleId(styleId: string): this
    destroy(): void
  }

  interface MarkerStyleOptions {
    width: number
    height: number
    /** ★ 比例值而非像素偏移：`{x: 0.5, y: 1}` = 底部中心（针尖对准坐标） */
    anchor?: { x: number; y: number }
    src: string
    cursor?: string
  }
  class MarkerStyle {
    constructor(options: MarkerStyleOptions)
  }

  /**
   * 徽标样式选项。
   *
   * 🚨 **这份清单必须与 SDK 实测的 own properties 一致**（CDP 实测，见下）。
   *    腾讯对未知字段是**静默忽略**的，所以这里写错了不会有任何报错 ——
   *    它只会让样式"看起来没生效"，然后被误判成"这个功能没做"。
   *
   * 实测 `new TMap.LabelStyle({...})` 后的 own properties（权威清单）：
   *   color · backgroundColor · borderColor · borderWidth · strokeColor · strokeWidth ·
   *   size · width · height · padding · borderRadius · scale · offset · angle ·
   *   alignment · verticalAlignment · wrapOptions
   *
   * 因此以下字段**不存在**，写上去等于没写：
   *   fontSize（字号用 `size`）· fontFamily · fontWeight ·
   *   align（用 `alignment`）· verticalAlign（用 `verticalAlignment`）· cursor · anchor
   */
  interface LabelStyleOptions {
    color?: string
    /** 字号。**不是 `fontSize`** */
    size?: number
    backgroundColor?: string
    borderColor?: string
    borderWidth?: number
    borderRadius?: number
    /** 内边距，如 `'4px 9px'` */
    padding?: string
    offset?: { x: number; y: number }
    strokeColor?: string
    strokeWidth?: number
    /** 水平对齐：`'left' | 'center' | 'right'`。**不是 `align`** */
    alignment?: string
    /** 垂直对齐：`'top' | 'middle' | 'bottom'`。**不是 `verticalAlign`** */
    verticalAlignment?: string
    width?: number
    height?: number
    scale?: number
    angle?: number
    wrapOptions?: Record<string, unknown>
  }
  class LabelStyle {
    constructor(options: LabelStyleOptions)
  }

  interface PolylineStyleOptions {
    color?: string
    width?: number
    borderWidth?: number
    borderColor?: string
    lineCap?: 'butt' | 'round' | 'square'
    lineJoin?: 'bevel' | 'miter' | 'round'
    /** ★ 虚线。腾讯官方参数，已确认可用 */
    dashArray?: number[]
  }
  class PolylineStyle {
    constructor(options: PolylineStyleOptions)
  }

  interface PolygonStyleOptions {
    color?: string
    showBorder?: boolean
    borderColor?: string
    borderWidth?: number
    borderDash?: number[]
  }
  class PolygonStyle {
    constructor(options: PolygonStyleOptions)
  }

  /**
   * 覆盖物的几何描述。**同一个对象被 Marker / Label / Polyline / Polygon 共用**，
   * 各类只读自己认识的那几个字段（多余的字段被忽略，不会报错）。
   */
  interface Geometry {
    id?: string
    styleId?: string
    position?: LatLng
    paths?: LatLng[] | LatLng[][]
    /**
     * 🚨 **`MultiLabel` 的文字就靠这个字段**（实测：SDK 只读 `content`）。
     *
     * 写成 `style: { text: '北京 3' }` 不会报错、geometry 也会被正常收下，
     * 但 `getGeometries()[i].content` 是空串，于是**一个徽标都渲染不出来** ——
     * 表现成"标注功能好像没做"。这与 `MarkerCluster.setData` 是同一类坑：
     * 自写的 `.d.ts` 让调用与声明自洽，`tsc` 全绿，但 SDK 那边根本不存在。
     */
    content?: string
    style?: Record<string, unknown>
  }

  /** Marker / Label / Polyline / Polygon 的公共部分：都有 setGeometries 做原地更新 */
  class MultiOverlay {
    /** ★ 有 `setGeometries()` 原地更新 —— 筛选变化时用它，不要 `new` 一个新的 */
    setGeometries(geometries: Geometry[]): this
    /**
     * ★ 卸载时必须调（`destroy()` 会把自己从地图上摘掉）——
     *   实测 `typeof TMap.MultiMarker.prototype.destroy === 'function'`（2026-09-22）。
     *   只 `setGeometries([])` 是**清空**而不是**摘除**：空图层会一直挂在地图上，
     *   每次换页多挂几个。（`markerLayer` / `districtLayer` / `routeLayer` 是否同病，待核。）
     */
    destroy(): void
    setStyles(styles: Record<string, unknown>, styleOptions?: unknown): this
    on(eventName: string, handler: EventHandler): this
    off(eventName: string, handler: EventHandler): this
    setVisible(visible: boolean): this
    setZIndex(zIndex: number): this
  }

  class MultiMarker extends MultiOverlay {
    constructor(options: {
      map: Map
      styles: Record<string, MarkerStyle>
      geometries: Geometry[]
      zIndex?: number
    })
  }

  class MultiLabel extends MultiOverlay {
    constructor(options: {
      map: Map
      styles: Record<string, LabelStyle>
      geometries: Geometry[]
      zIndex?: number
    })
  }

  class MultiPolyline extends MultiOverlay {
    constructor(options: {
      map: Map
      styles: Record<string, PolylineStyle>
      geometries: Geometry[]
      zIndex?: number
    })
  }

  class MultiPolygon extends MultiOverlay {
    constructor(options: {
      map: Map
      styles: Record<string, PolygonStyle>
      geometries: Geometry[]
      zIndex?: number
    })
  }

  /**
   * 点聚合 —— **两端都用它**（2026-09-22 起）。密集处出一枚数字气泡，孤立点原样显示。
   *
   * ⚠️ 更新用 `setGeometries()`，**不要重新 new**。
   *
   * 🚨 这个类**没有** `setData()`。曾经这里写的是 `setData`（照 MultiMarker 的
   *    `setGeometries` 顺手猜的），结果移动端一进城市页就 `setData is not a function`
   *    整页白屏 —— 类型声明是**我们自己写的**，写错了 tsc 一样全绿。
   *    实测（CDP 读 `TMap.MarkerCluster.prototype`）公有方法只有：
   *    `setMap` `setGeometries` `updateGeometries` `getMap` `getClusters`
   *    `zoomInCluster` `setVisible` `getVisible` `destroy`。
   *    **改这里的 API 必须先用 CDP 读一次原型**，别信记忆。
   *
   * ## 三条"默认样式"带来的、必须知道的绑定（读 bundle 得来）
   * 1. `enableDefaultStyle`（默认 true）是**唯一的渲染路径**：置 false 时 `_repaint`
   *    整个不渲染，等于"自己写 DOMOverlay"。
   * 2. 默认样式下 **`count === 1` 也用 SDK 自带的水滴图标**（不是我们的圆点），
   *    且 `styleId` 会被 SDK 改写成 `'default'` —— **传 styleId 是空操作**。
   * 3. `zoomOnClick` **同时管气泡和单点**，动作是 `fitBounds(簇 bounds)`。
   *    我们一律传 `false`（见 `zoomOnClick` 字段注释）。
   */
  class MarkerCluster {
    constructor(options: {
      id: string
      map: Map
      geometries: Array<{ position: LatLng; properties?: Record<string, unknown> }>
      /** 默认 60。两个点屏幕距离小于它就并簇 —— 与"两点多近算一个"是同一个念头 */
      gridSize?: number
      /** 默认 2。小于它的簇会被拆回单点（1 个点不该变气泡） */
      minimumClusterSize?: number
      /** 默认 true。**单个点也走默认样式**，我们的样式在图上不存在 */
      enableDefaultStyle?: boolean
      /** 默认 true。簇心取成员平均 */
      averageCenter?: boolean
      /**
       * `zoom ≤ maxZoom` 才做聚合。取值见 `zoomTiers.POI_CLUSTER_MAX_ZOOM`
       * （那里有实测表：为什么是 16 而不是 15）。
       */
      maxZoom?: number
      /**
       * ⚠️ **一律传 `false`。**
       *
       * 它做的事不是"放大一级"，而是 `fitBounds(簇的 bounds)` —— 而 bounds 是
       * 簇心外扩 `gridSize` 的框，1440px 视口去 fit 一个 120px 框 = **跳 3~4 级**；
       * 更要命的是**点单个点也会跳**（用户点一枚景点是为了看详情，镜头不该被推走）。
       *
       * 关掉它**不影响 `click` 事件**（源码里两条语句并列：缩放那句带这个开关，
       * `emit('click')` 那句不带）。分派自己写在 `poiLayer` 的 click 回调里。
       */
      zoomOnClick?: boolean
      /** 气泡的层叠顺序（源码里 `e.zIndex = i.zIndex || null`，默认 null） */
      zIndex?: number
      renderOptions?: Record<string, unknown>
    })
    /** ⚠️ 与 Map 一样，返回的是实例、不是取消函数 */
    on(eventName: string, handler: (evt: ClusterEvent) => void): this
    off(eventName: string, handler: (evt: ClusterEvent) => void): this
    setGeometries(
      geometries: Array<{ position: LatLng; properties?: Record<string, unknown> }>,
    ): void
    updateGeometries(
      geometries: Array<{ position: LatLng; properties?: Record<string, unknown> }>,
    ): void
    /**
     * ⚠️ **异步**：聚类跑在 worker 里，结果落地后才会 `emit('cluster_changed')`。
     *    所以"哪些点是独立点"不能在 `setGeometries()` 的下一行读。
     */
    getClusters(): ClusterInfo[]
    /** 就是 `fitBounds(cluster.bounds)` —— 点气泡时我们自己调它 */
    zoomInCluster(cluster: ClusterInfo): void
    setVisible(visible: boolean): void
    getVisible(): boolean
    destroy(): void
  }

  interface InfoWindowOptions {
    map?: Map
    position?: LatLng
    content?: string | HTMLElement
    offset?: { x: number; y: number }
    enableCustom?: boolean
  }
  class InfoWindow {
    constructor(options: InfoWindowOptions)
    setPosition(position: LatLng): this
    setContent(content: string | HTMLElement): this
    open(): this
    close(): this
    destroy(): void
  }

  /** JS API 服务类 —— 依赖 SDK 已加载；SDK 挂了要退化为 WebService 直连 */
  namespace service {
    class District {
      constructor(options?: { key?: string })
      getChildren(options: { id: string; getPolygon?: number; pageSize?: number }): Promise<unknown>
      search(options: { keyword: string; getPolygon?: number }): Promise<unknown>
    }
    class Driving {
      constructor(options?: { key?: string })
      search(...args: unknown[]): Promise<unknown>
    }
  }
}

interface Window {
  /** SDK 加载完成后挂上来；未加载时为 undefined */
  TMap?: typeof TMap
}
