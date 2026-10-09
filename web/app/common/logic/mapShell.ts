/**
 * 地图外壳的 **context 契约**（与端无关）。
 *
 * ## 为什么契约在这里、而 Provider 在 `routes/map-shell.tsx`
 * 外壳分两半：
 *   · **契约**（本文件）—— 类型、`Ctx`、读取钩子。它被 `common/`、`desktop/`、
 *     `mobile/` 三块都用到，所以必须待在 `common/`；
 *   · **实现**（`routes/map-shell.tsx`）—— 建地图、收集浮层、扇出重刷。
 *     它认识 React Router（`<Outlet>`），所以只能待在路由层。
 *
 * ★ 这一刀是**分层反转的修复**，不是搬家：修复前 `Ctx` 与 `useMapShell` 长在
 *   `routes/map-shell.tsx` 里，于是 `common/logic/*` 与 `common/ui/*` 一共 8 处
 *   从路由层 import —— 公共层反过来依赖路由层，
 *   而路由层又依赖公共层的组件（`MapFallback` / `TopBar`），形成环。
 *   环能让代码跑起来，代价是**没人能回答"这块能不能单独拿走"**。
 */

import { createContext, useContext } from 'react'
import { useOutletContext } from 'react-router'

/**
 * 页面登记给外壳的**两件事** —— 规划面板的「添加景点」要用。
 *
 * | 字段 | 它回答什么 | 为什么只有页面答得上 |
 * |------|------------|----------------------|
 * | `closePoi()` | 收起**本页**已打开的景点详情（含地图上的选中标记） | 景点选中态是页面自己的 `useState`（三页各一份） |
 * | `spotListCity` | 本页左面板装的是**哪座城**的景点清单 | 只有城市页有那份清单，别处没有 |
 *
 * ## 为什么是注册制而不是 context 字段
 * 景点选中态是**页面自己**的 `useState`（三页各一份，见 `useCityView`），
 * 而调用方（规划面板）挂在外壳上、拿不到页面的状态 —— 这正是当初搜索框
 * 不直接开详情、而是走 `searchPick` 信道的同一个原因。
 * 但这两件事都不需要传数据，只是一问一答 ⇒ 用**注册/注销**比再造一条 context
 * 信道轻。页面挂载时注册、卸载时注销；同时最多有一个页面在场，单槽足够。
 *
 * ## ★ `spotListCity` 是干什么用的（2026-09-27）
 * 「添加景点」**不再换 URL**（用户 2026-09-27 定），于是它要回答一个以前不必回答的问题：
 * **本页是不是已经把这座城的景点清单摆在左边了？**
 *   · 是（城市页）→ 就地用那一份（再浮一块同样的清单 = 同一屏两份清单）；
 *   · 否（首页 / 省级页 / 点位详情页 / **别的城市的城市页**）→ 由外壳浮一块出来
 *     （`common/ui/plan/SpotPicker`）。
 *
 * ★ 判据必须来自**页面自己**，不能用 URL 猜：`pathname === '/city/<id>'` 这种精确
 *   相等会把"行程深链 `/city/x/plan`"（它就是城市页！）、"点位深链 `/city/x/poi/y`"
 *   一起判错（前者会开两块清单、后者该开却不开）。页面自己知道自己的清单属于哪座城。
 */
export interface PageSpotOps {
  /** 收起本页已打开的景点详情（含地图上的选中标记） */
  closePoi: () => void
  /** 本页左面板装的是哪座城的景点清单；`null` = 本页没有清单 */
  spotListCity: string | null
}

let pageSpotOps: PageSpotOps | null = null

export function registerPageSpotOps(ops: PageSpotOps | null): void {
  pageSpotOps = ops
}

/** 收起当前页面的景点详情（没有页面注册过就是空操作） */
export function closePagePoi(): void {
  pageSpotOps?.closePoi()
}

/** 当前页面的左面板是哪座城的清单（`null` = 它没有清单，该由外壳浮一块出来） */
export function pageSpotListCity(): string | null {
  return pageSpotOps?.spotListCity ?? null
}

import type { FallbackLeg, FallbackPin, FallbackStay } from '~/common/ui/MapFallback'
import type { MapFailure, MapStatus, UseTMapResult } from '~/common/map/tencent'
import type { Poi } from '~shared/schema'

export interface FallbackData {
  pins: FallbackPin[]
  legs?: FallbackLeg[]
  stay?: FallbackStay | null
}

/**
 * 重刷时交给页面的「地图环境」。
 * 图层算避让需要知道容器尺寸与哪些浮层盖住了地图，而这些只有外壳知道。
 */
export interface ViewportEnv {
  container: HTMLElement | null
  overlays: Array<HTMLElement | null>
  /**
   * **规划详情态** —— 右侧浮层开着且选中了某条规划。
   *
   * 打开时**地图上只留这条行程**：行程之外的景点圆点/名字不铺、区徽标不铺。
   * 判据的唯一出处是 `common/logic/planFocus.ts` 的 `isPlanFocused()`。
   *
   * ★ 为什么挂在**这条广播**上、而不是跟着 `update()` 走：打开 / 关掉规划面板
   *   **不是数据变化**，页面不会重跑 `update()`；而"该收起来 / 该把点还回来"
   *   必须马上生效。视野重刷是唯一一条"不换数据也能让图层重算"的信道。
   */
  planFocus: boolean
  /**
   * **被规划详情认领的景点** —— 当前页面不画它们的圆点，位置交给规划那枚序号标记。
   * （语义与理由见 `common/map/tencent/poiTypes.ts` 的 `PoiUpdateOptions.claimed`。）
   *
   * ★ 与 `planFocus` 的分工：`planFocus` 说"**这一屏是规划态**"（决定其余的点收不收），
   *   `claimed` 说"**这几个点由序号代表**"（决定哪几个圆点让位、以及哪些名字要留）。
   *   两个都要：`planFocus` 为真而 `claimed` 为空（行程全是地图取点）是完全正常的组合。
   */
  claimed: ReadonlySet<string>
}

/**
 * 「搜索命中了一枚景点」—— 外壳把它交给**当前页面**去就地开详情。
 *
 * ## 为什么需要这条信道（而不是让搜索框直接开详情）
 * 搜索框长在**顶栏**（外壳这边），而"选中哪一枚、详情面板渲染在哪儿"是**页面**的事：
 * 三页各自有 `selectedId`，还有各自的点位数据（首页/省级页是全部已收录城市、
 * 城市页只有本城）。让搜索框自己去开面板就等于在第四个地方再实现一遍详情 ——
 * 那正是 `plans/12` 反复吃亏的"同一件事两套实现"。
 *
 * ## 为什么把 `Poi` 一起带上、而不是只给一个 id
 * 详情要封面 / 摘要 / 亮点 / 溯源，**索引里没有这些**（索引只有"够用来找 + 够飞过去"
 * 的字段，见 `pipeline/build.py`）。所以命中时由搜索那边 `loadCity(cityId)` 取一次
 * 完整对象（只加载**那一座**城市），页面拿到就是可直接渲染的东西 ——
 * 页面不必知道"这一枚是不是本次会话加载过的"。
 *
 * ## ★ 它现在有**两个**来源（2026-09-27）
 * 1. 顶栏搜索命中（原本的用途）；
 * 2. 「挑景点」浮层（`common/ui/plan/SpotPicker`）的**「详情」按钮** —— 它同样长在外壳上、
 *    同样拿不到页面自己的 `selectedId`，而"就地打开某一枚的详情"这件事只有页面会做
 *    ⇒ 只剩这条信道可用（三页都消费它，所以三页都自动支持，不用再加一套注册）。
 *
 * ⇒ 字段名里的 "search" 是**历史**：真正的语义是「**外壳要求当前页面打开这一枚**」。
 *   没改名是为了不动 AA 那套护栏与三页的消费点；**改名前先全局搜 `searchPick`**。
 */
export interface SearchPick {
  poi: Poi
  cityId: string
  cityName: string
}

export interface MapShellContext {
  status: MapStatus
  failure: MapFailure | null
  retry: () => void
  /** 地图实例。`status !== 'ready'` 时为 null */
  map: UseTMapResult['map']
  /** 是否走降级画布（SDK 失败时自动为真） */
  fallback: boolean
  /** 把点位框进「没被浮层盖住的地方」。★ 换档 / 换页时调用，别在地图拖动时调 */
  fit: UseTMapResult['fit']
  /** 把一个点平移到「没被浮层盖住的地方」的中心（不改缩放）—— 景点点开详情时用 */
  centerOn: UseTMapResult['centerOn']
  /** 把一个点**以指定缩放**放到可视区中心 —— 行程里点一个站点时用 */
  focusPoint: UseTMapResult['focusPoint']
  /** 手动重刷一次全部图层（缩放/平移结束后外壳已自动触发，页面一般不需要自己调） */
  refreshView: () => void
  /**
   * 页面把**自己的**视野重刷函数登记进来，返回注销函数。
   *
   * `PoiLayerHandle.refreshView` / `DistrictLayerHandle.refreshView` 都能直接传。
   * 为什么需要登记 → 见 `routes/map-shell.tsx` 里那段长注释。
   */
  registerRefresh: (fn: (env: ViewportEnv) => void) => () => void
  /** 当前地图中心（用户主动挪出来的位置，非设备定位） */
  center: UseTMapResult['center']
  /**
   * 当前底图状态（类型 + 详细度开关）。地图未就绪时 `null`。
   *
   * ★ 是"类型 × 一组开关"，不是一条平铺的预设清单 —— 见 `basemap.ts` 文件头。
   *   三个动作分开，是因为"档位 → 开哪几项"这条规则住在引擎层，界面不该知道它。
   */
  basemap: UseTMapResult['basemap']
  /** 换底图类型（矢量 / 影像） */
  setBasemapKind: UseTMapResult['setBasemapKind']
  /** 一键「简略 / 详细」—— 只管当前这一类 */
  setBasemapLevel: UseTMapResult['setBasemapLevel']
  /** 单个要素开关（地点名称 / 道路名称 / 建筑 …） */
  toggleBasemapDetail: UseTMapResult['toggleBasemapDetail']
  /** 页面把要画的降级内容推上来 */
  setFallback: (data: FallbackData) => void
  /**
   * 搜索命中了一枚景点（还没被任何页面接管时非空）。页面把它并进自己的
   * `selected` 即可 —— 关闭 / 点空白 / 换页都会清空，具体见 `SearchPick`。
   */
  searchPick: SearchPick | null
  /** 搜索那边在命中时调用；页面**不要**自己 set（只有搜索知道完整的 Poi） */
  setSearchPick: (pick: SearchPick | null) => void
}

export const MapShellCtx = createContext<MapShellContext | null>(null)

export function useMapShell(): MapShellContext {
  const v = useContext(MapShellCtx)
  if (!v) throw new Error('useMapShell 只能在 map-shell 布局路由内使用')
  return v
}

/** 兼容 `useOutletContext` 的写法 —— 两种都可用，指向同一份值 */
export function useMapShellOutlet(): MapShellContext {
  return useOutletContext<MapShellContext>()
}
