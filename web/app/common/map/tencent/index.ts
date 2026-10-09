/**
 * 地图引擎层统一出口。
 *
 * ## 唯一的纪律
 * **业务代码只从 `~/common/map/tencent` 引入，永远不直接写 `TMap.*`。**
 * 换引擎（比如将来要接高德）只需要重写这个目录 + 换这一行出口，
 * 上层页面与组件一行不动。
 *
 * 所以这里刻意**不导出 `tmap.d.ts` 里的类型** —— 导出 `TMap.Map` 就等于把
 * 引擎类型泄漏到业务层，那层纪律就白定了。需要地图实例的地方用
 * `UseTMapResult['map']` 这种"经由我们自己的类型"来拿。
 *
 * ## 目录分工
 * | 文件 | 职责 |
 * |------|------|
 * | `config.ts` | key 双路解析（内置受限 + 使用者自备，用户 key 优先） |
 * | `loader.ts` | SDK 单例加载 + 四类失败的可识别错误 |
 * | `useTMap.ts` | React 生命周期：建图 / **事件注册** / 卸载清理 |
 * | `viewportEmitter.ts` | **视野广播时序**：手势防抖 + 取景稳定检测（"什么时候通知图层重算"） |
 * | `viewport.ts` | **视野模型**：读视野、投影、视野判据 —— 全项目唯一读法 |
 * | `reveal.ts` | **揭示决策**：这一屏铺哪一级（逐级下降 + 逐级回流） |
 * | `basemap.ts` | 底图**类型 + 详细度开关**（`kind` × `details`）+ 用户选择的持久化 |
 * | `fitView.ts` | **浮层实测 → fitBounds padding**（腾讯无 `avoid`，这是正式实现） |
 * | `poiLayer.ts` | **点位三层**：聚合 + 选中项 `MultiMarker` + 名字 `MultiLabel` |
 * | `poiCluster.ts` | **聚合层的封装**（`MarkerCluster` 参数 / 点击分派 / 落地结算 / 读数）。★ 不对外导出 |
 * | `labelAvoidance.ts` | 自研标注避让（腾讯无原生避让，必须自算） |
 * | `zoomTiers.ts` | **缩放分档表**：放大到多少揭示下一级 + 这一档铺不铺点位 + 名字上限（唯一出处） |
 * | `districtLayer.ts` | 区划多边形 + 计数徽标（三级下钻的地图侧） |
 * | `routeLayer.ts` | 行程连线（逐段 geometry + 拥堵双线 + 步行虚线 + 换乘点） |
 * | `zLayers.ts` | **覆盖物图层的 zIndex 唯一出处**（"谁压谁"只在这里定义） |
 *
 * ## 「缩放 → 显示」这条链的分工（2026-09-22 修订）
 * ```
 * viewport.ts  读视野            ← 输入
 *      ↓
 * zoomTiers.ts 阈值 / 档位表     ← 只用数字说话，不看内容
 *      ↓
 * reveal.ts    该铺哪一级（看内容，能回流）
 *      ↓
 * districtLayer.ts 画徽标与面 · poiLayer.ts 交给聚合（谁进气泡由 MarkerCluster 定）
 * ```
 * ★ 原来这里还有第五个环节 `dotBudget.ts`（"一屏撒哪几枚"：抽稀 + 总量闸门 + 像素去重）。
 *   它做的是**把多余的点扔掉**，与"气泡上的数字必须如实"直接冲突，2026-09-22 整体删除
 *   （`plans/12-poi-aggregation.md`）。所以现在**没有"撒几枚"这件事**了。
 *
 * ★ `poiCluster.ts` **刻意不从这里导出** —— 它是 `poiLayer` 的实现细节。
 *   谁想拿它建聚合层，就得自己绕开档位准入（T 项守的那个闸门）。
 *
 * 判断"要不要显示"的代码**只能**住在上面这几个文件里。页面与组件一律不做这个判断
 * —— 那正是修复前"四个页面四种写法"的来源。`check_app.py` 的 V 项守这条。
 */

export {
  clearUserKey,
  getUserKey,
  KEY_APPLY_URL,
  KEY_SETUP_HINT,
  resolveTmapKey,
  resolveWebServiceKey,
  saveUserKey,
  usingOwnKey,
  type KeySource,
  type ResolvedKey,
} from './config'

export { loadTMapSdk, mapErrorText, MapConfigError, type MapErrorCode, type MapLoadResult } from './loader'

export { useTMap, type MapStatus, type MapFailure, type UseTMapResult } from './useTMap'

export {
  createViewportEmitter,
  GESTURE_SETTLE_MS,
  SETTLE_STEP_MS,
  type ViewportChange,
  type ViewportEmitter,
  type ViewportEmitterOptions,
} from './viewportEmitter'

export {
  BASEMAP_BASE_FEATURE,
  BASEMAP_DETAILS,
  BASEMAP_KINDS,
  BASEMAP_LEVEL_LABEL,
  basemapConfig,
  basemapLabel,
  DEFAULT_BASEMAP,
  detailsForLevel,
  detailsOfKind,
  initialBasemap,
  levelOf,
  type BasemapDetail,
  type BasemapDetailId,
  type BasemapKind,
  type BasemapKindOption,
  type BasemapLevel,
  type BasemapState,
} from './basemap'

export {
  boundsOf,
  expandCorners,
  fitPoints,
  FLY_DURATION_MS,
  freeRect,
  freeRectToPadding,
  NATIONAL_FIT_CORNERS,
  NATIONAL_FIT_MARGIN,
  NATIONAL_VIEW,
  type FitOptions,
  type FlyReason,
  type LatLngLike,
  type NationalView,
  type Rect,
} from './fitView'

export {
  containsPoint,
  isOnScreen,
  projectToPixel,
  readViewport,
  viewSignature,
  type MapInstance,
  type Viewport,
} from './viewport'

export {
  decideReveal,
  DISTRICT_VIEW_PAD,
  FACE_VIEW_PAD,
  POI_VIEW_PAD,
  type RevealDecision,
  type RevealSources,
  type RevealTraceRow,
} from './reveal'

export { createPoiLayer } from './poiLayer'

// ★ 契约（`PoiPoint` / 选项 / 句柄）与形状转换都在 `poiTypes.ts` ——
//   那边是**跨文件唯一出处**，也避免了新模块（名字层 / 单点层）与 poiLayer 的循环依赖。
//   ★ 2026-09-24：选项与句柄也搬了过去（`poiLayer` 涨到 435 行、超 G 项 420）。
//     所以这里**从 `./poiTypes` 统一再导出**，不要再从 `./poiLayer` 拿 ——
//     `poiLayer` 里那几行 `export type … from './poiTypes'` 只是给"就近读代码"的便利，
//     barrel 的判据（A 项）认的是**符号真正声明在哪**。
export {
  toPoiPoints,
  type PoiLayerHandle,
  type PoiLayerOptions,
  type PoiLayerStats,
  type PoiPoint,
  type PoiUpdateOptions,
  type PoiViewEnv,
} from './poiTypes'

export {
  buildLabelStyles,
  buildMarkerStyles,
  seqSVG,
  staySVG,
} from './poiStyles'

export {
  overlaysToOccupied,
  pickVisibleLabels,
  rectsIntersect,
  type LabelCandidate,
  type PlacedRect,
} from './labelAvoidance'

export {
  CITY_REVEAL_ZOOM,
  deepestLevel,
  describeTierRules,
  labelCapForZoom,
  LEVEL_ORDER,
  POI_ADMIT_MIN_ZOOM,
  POI_CLUSTER_MAX_ZOOM,
  POI_REVEAL_ZOOM,
  poiTierForZoom,
  STOP_FOCUS_ZOOM,
  type MapLevel,
  type PoiTier,
} from './zoomTiers'

export {
  createMarkerLayer,
  type MarkerItem,
  type MarkerLayerHandle,
  type MarkerLayerOptions,
} from './markerLayer'

export {
  createDistrictLayer,
  type DistrictLayerHandle,
  type DistrictLayerMode,
  type DistrictLayerOptions,
  type DistrictLayerStats,
} from './districtLayer'

export {
  badgeText,
  buildBadgeStyles,
  buildDistrictStyles,
  isUncollected,
  type DistrictGeoNode,
} from './districtStyles'

export {
  createRouteLayer,
  jamLevelOf,
  LEG_ID_FROM_STAY,
  type JamSpan,
  type RouteLayerHandle,
  type RouteLayerOptions,
  type RouteLeg,
  type RoutePoint,
} from './routeLayer'

// ★ 覆盖物图层的 zIndex **唯一出处** —— 调用方要"让某一层压在路线上方"时，
//   从这里取，不要再写裸数字（层级错的表现是"某样东西看不见了"，不报错）。
export { Z_LAYER } from './zLayers'
