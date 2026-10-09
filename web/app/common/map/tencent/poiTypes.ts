/**
 * 点位图层的**数据契约**（类型 + 形状转换）—— 从 `poiLayer.ts` 拆出来。
 *
 * ## 为什么单独一个文件（不是"为了好看"）
 * 1. `poiLayer.ts` 逼近**单文件 420 行**的硬约定（`check_app.py` 的 G 项），
 *    而它涨起来的原因是**新增能力**（单点层、藏掉 SDK 画的覆盖物、
 *    搜索命中的那一枚要能跨页画出来），不是职责变杂 ——
 *    所以先把"只被引用、不参与逻辑"的那部分搬走：先是数据契约，
 *    2026-09-24 又把**选项与句柄**（`PoiLayerOptions` / `PoiUpdateOptions` /
 *    `PoiLayerHandle` / `PoiViewEnv`）一起搬过来；
 * 2. 契约是**跨文件唯一出处**：`sub-<subtype>` 的拼法、`PoiPoint` 的字段名，
 *    写错**不报错也不崩**（点位会静默消失），必须一眼看得见；
 * 3. 它还会被"名字层""单点层"这类新模块引用，留在 `poiLayer` 里会构成**循环依赖**。
 */

import type { Poi, SubType } from '~shared/schema'

export interface PoiPoint {
  id: string
  name: string
  subtype: SubType
  lng: number
  lat: number
  popularity: number
}

/**
 * 把点位数据摊平成图层要的形状。
 *
 * 三处调用：城市页（`/city/:cityId`，传**筛选后**的那一份）、首页与省级页的
 * **缩放揭示**（传全部点位）、点位详情页（只传那一个）。
 * 放在这里而不是各页各写一遍，是因为 `location.point` 那层嵌套来自数据 schema ——
 * 页面上把字段名写错（`p.lng` 而不是 `p.location.point.lng`）不会报错、也不会崩溃，
 * 只会得到 `undefined` 坐标，**点位静默消失**。
 */
export function toPoiPoints(pois: Poi[]): PoiPoint[] {
  return pois.map((p) => ({
    id: p.id,
    name: p.name,
    subtype: p.subtype,
    lng: p.location.point.lng,
    lat: p.location.point.lat,
    popularity: p.popularity,
  }))
}

/** `stats()` 的返回值。全部是**读数**，不是意图 */
export interface PoiLayerStats {
  /** 最近一次重刷时的缩放 */
  zoom: number
  /** `update()` 进来的候选总数 */
  candidates: number
  /** 过了档位准入、交给聚合的点数（`zoom < 8` 时为 0） */
  admitted: number
  /** 屏幕上实际的簇数（气泡 + 独立点） */
  clusters: number
  /** 其中多成员的簇数（= 真气泡） */
  bubbles: number
  /** 实际挂上地图的名字数 */
  labels: number
  /** 实际在场的名字（最多 12 条） */
  labelNames: string[]
}

/* ────────────────────────────────────────────────
 * 图层的**选项与句柄**（2026-09-24 从 `poiLayer.ts` 搬来）
 *
 * 判据（`check_app.py` 的 A 项）认的是"符号真正声明在哪"，
 * 所以 barrel 也从这里统一再导出 —— `poiLayer` 里那几行
 * `export type … from './poiTypes'` 只是给"就近读代码"的便利。
 * ────────────────────────────────────────────── */

export interface PoiLayerOptions {
  /**
   * 要不要给**独立点**挂名字。
   *
   * 这是两端现在唯一的差别：桌面挂（屏幕大，名字有用），移动端不挂（屏幕小）。
   * ★ **选中项永远有名字**，不受这个开关影响 —— 用户刚点的那一个必须有名字。
   */
  names: boolean
  onSelect?: (poiId: string) => void
  /**
   * 点到**空白处**（没有命中任何点位）时回调。
   *
   * 为什么归图层管、而不是页面自己 `map.on('click')`："这一下到底点没点到东西"
   * 只有图层知道 —— 页面拿到的是一次朴素的地图 click，分不出"点了点位"和"点了空地"，
   * 而腾讯 **点中覆盖物时地图 click 照样派发**，据此关闭详情会把刚打开的卡关掉。
   */
  onBlank?: () => void
  /**
   * 一次重刷**真正落地后**回调一次（聚合是异步的，见 `poiCluster` 文件头）。
   *
   * 给诊断日志用。为什么不能在 `refreshView()` 之后就记：那一刻 `getClusters()`
   * 必然是空的（实测立刻读 0 个、worker 约 50ms 后才有），会印出
   * 「簇 0 · 名字 5 个」这种自相矛盾的行 —— 而"数字对不上"正是这份日志最该避免的事。
   */
  onSettled?: () => void
}

/**
 * 重刷所需的「环境」—— 由外壳提供（只有它知道当前有哪些浮层盖在地图上）。
 * 容器与浮层都服务于**标注避让**：名字不该落到被面板压住的地方。
 */
export interface PoiViewEnv {
  container?: HTMLElement | null
  overlays?: Array<HTMLElement | null>
}

export interface PoiUpdateOptions extends PoiViewEnv {
  /** `null` = 无选中 */
  selectedId?: string | null
  /**
   * **规划详情态** —— 这一屏上"地图只留这条行程"。
   *
   * 为真时本图层**一个圆点都不铺**（`admitted = []`）：
   * · 行程里的停靠点 → 已由规划那枚序号圆点代表（见 `claimed`）；
   * · **行程之外**的景点 → 整个收起来。
   *
   * ## 为什么要收（用户 2026-10-05，带截图）
   * > 「在打开路线规划时，地图上的标签，景点，你看是显示还是不显示比较好」
   *
   * 规划态地图上原本同时有**四类点**：行程序号、停靠点、**其他所有景点**、区徽标。
   * 用户扫一眼**分不出哪些是"我要去的"** —— 这跟"两条同宽的路线分不出谁压谁"是
   * 同一类问题：**信息密度超过了可辨识度**。不是难看，是**会被误读**。
   *
   * ★ 名字**照旧不撤**：`claimed` 那些点仍会进名字候选（`repaintLabels`），
   *   所以"编号旁边看得见是哪个景点"这条不受影响。
   * ★ 与 `claimed` 是两个维度，不能合并：`planFocus` 说"这一屏是规划态"，
   *   `claimed` 说"这几个点由序号代表"。行程全是"地图取点"时前者真、后者空。
   */
  planFocus?: boolean
  /**
   * 「这些景点**已经由别的图层代表**了」—— 本图层**不画它们的圆点**，也不把它们交给聚合。
   *
   * ## 为什么需要（2026-09-28 用户报的）
   * > 「现在在打开规划详情之后，地图会显示点位顺序，有些点位是标在景点上的，会出现两个点位，
   * >   没办法打开景点详情，而且现在的效果是**盖在景点的点位上的，而不是替换**」
   *
   * 规划那一层（`common/logic/usePlanRouteLayer`，z-index **34 = `Z_LAYER.planMarker`**）
   * 给每个停靠点画了一枚序号圆点，而停靠点若是景点，景点图层在**同一坐标**也画一枚（z-index 20）——
   * 序号圆点把它整个盖住，而且点击命中的是最上面那枚（序号那层原来没有 click 处理）
   * ⇒ **点不开景点详情**。
   *
   * ⇒ 打开规划详情时，这些景点交出去：**位置上只留规划的那一枚**（真"替换"），
   *   点击由规划层接（见 `usePlanRouteLayer` 的 `onClick`）。
   *
   * ★ 名字**不撤**：`repaintLabels` 会把它们补进候选 —— 编号旁边还看得见是哪个景点。
   * ★ 只认 id：本图层不需要知道"是谁认领了它"。
   */
  claimed?: ReadonlySet<string>
  /**
   * 「搜索命中的那一枚」—— 它**可能不在 `points` 里**，也必须画出来。
   *
   * ## 为什么单开一条信道，而不是把它混进 `points`
   * 页面的候选集是**按页划定的**：城市页只有本城的点位、省级页只有本省已收录城市的点位。
   * 而顶栏搜索能在任意一级命中**任何一座城**的景点（这是搜索存在的意义）。
   * 于是出现了一种以前不存在的组合：**镜头飞过去了、详情也开了，那一枚点却没画**
   * （选中层是从 `byId` 取点的，`byId` 只由候选集构成 ⇒ 解析成 `null` ⇒ 选中层空）。
   *
   * ★ 为什么不"把它塞进 `points`"：那样它会**进聚合**（旁边可能凭空多一个气泡）、
   *   还要过**档位准入**（`zoom < 8` 时整个不画）—— 而"我搜到并飞过去的那一枚"
   *   必须无条件在场、且以**选中态**画。所以它是"额外的一枚"，不是"候选中多一枚"。
   *
   * ★ 与 `selectedId` 的分工：`selectedId` 说"选中了谁"（可能只是页面上普通的一枚），
   *   `picked` 说"这一枚的完整坐标，候选集里可能没有它"。两者 id 相同时以 `picked` 兜底。
   */
  picked?: PoiPoint | null
}

/**
 * `update()` 合并选项时，把**环境字段**沿用下来（**没给就用上一份**），其余照旧覆盖。
 *
 * ## 哪些算「环境」
 * `container` / `overlays` / `claimed` / `planFocus` —— 四者都由**外壳广播**
 * （`refreshView(env)`）带进来，描述的是"**这一屏是什么情况**"，
 * 而不是"这次 `update` 想传什么"。
 *
 * ## 为什么必须这么做（2026-10-05 用户报的 bug）
 * `update()` 原来是整份覆盖 `lastOpts = o`，而调用方（如城市页
 * `layer.update(toPoiPoints(visible), { selectedId, picked })`）**只传参数、不传环境**。
 * 而 `refreshView` **只在视野广播时**才跑，不会紧随其后补回来 ⇒ 中间这一段
 * 就是拿着残缺的上下文在画：
 * - `claimed` 丢了 ⇒ **规划态下停靠点的名字整批消失**
 *   （`repaintLabels` 靠它把停靠点补进名字候选），要等下一次广播才恢复；
 * - `overlays` 丢了 ⇒ 标注避让按"屏幕上没有浮层"算。
 *
 * ⚠️ 上一版只"保住"了 `planFocus` **一个**字段，注释却写的是"保留环境字段" ——
 *   而真正被这条链路依赖的 `claimed` 恰好漏了。**改这里时四个都要列上**，
 *   别只写手上正在处理的那一个。
 */
export function mergePoiEnv(
  prev: PoiUpdateOptions,
  next: PoiUpdateOptions,
): PoiUpdateOptions {
  return {
    ...next,
    container: next.container ?? prev.container,
    overlays: next.overlays ?? prev.overlays,
    claimed: next.claimed ?? prev.claimed,
    planFocus: next.planFocus ?? prev.planFocus,
  }
}

export interface PoiLayerHandle {
  update(points: PoiPoint[], opts?: PoiUpdateOptions): void
  /**
   * 用**上一次 `update` 的点位**重算这一屏该画什么（不重新取数）。
   *
   * 缩放 / 平移结束后由外壳广播触发。**不要每帧调**。
   *
   * ★ 入参收 `PoiUpdateOptions`（比"环境"多一个 `selectedId`）：换选中项时
   *   **候选集合没变**，调用方不会重跑 `update()`，选中态只能从这里进来。
   */
  refreshView(env?: PoiUpdateOptions): void
  /**
   * 换端（移动 ↔ 桌面）时切"独立点要不要挂名字"。
   *
   * ★ 这只是名字层的事，**不是"要不要聚合"** —— 聚合两端一致，没有开关。
   *   之所以要一个方法而不是重建图层：重建会丢掉 `points` / `lastOpts`，
   *   而端别变化**不会**触发 `update()`，结果是地图空掉（这类"改完没反应"最难查）。
   */
  setNames(next: boolean): void
  /**
   * 这一刻**实际**挂在地图上的东西 —— 不是"打算挂什么"。
   *
   * 供给诊断日志（`common/logic/mapLog.ts`）。簇数是**现算**的：聚合在 worker 里
   * 异步算，存快照会印出与同一行里的名字数自相矛盾的数。
   */
  stats(): PoiLayerStats
  destroy(): void
}
