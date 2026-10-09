/**
 * 缩放揭示 —— 「一张地图上，放大就看得见更多」的落点。
 *
 * ## 它解决什么
 * 首页与省级页原先**缩放完全不起作用**：34 个省徽标 / 21 个市徽标在任何缩放下
 * 都一模一样。这个钩子把「当前该铺哪一级」交给 `reveal.decideReveal`，
 * 并在缩放跨过阈值时把下一级的内容铺出来 —— **同页揭示，不换路由**。
 *
 * ## 2026-09-20 全量修复：它从"判据"退回成"驱动"
 * 修复前，判据、回流、视野筛选、分档**全部散在这个文件里**，于是：
 *   · 判据只看缩放（"缩放到 6.5 就该铺市徽标"），不看**视野里到底有没有市徽标**
 *     —— 视野落在没有市的地方会铺一张空地图，而且不会退回省徽标；
 *   · 只有 点位→市徽标 这一段有回流，市徽标→省徽标 没有；
 *   · 返回的 `level` 语义是"判据说该到哪一级"，不是"屏幕上实际铺的是哪一级"，
 *     而页面拿它做懒加载 —— 因为数据没到齐时回流会把层级压浅，两边互相锁死。
 *
 * 现在判据与回流收在 `map/tencent/reveal.ts`（纯函数、可单测、带 trace），
 * 视野收在 `map/tencent/viewport.ts`，分档收在 `map/tencent/zoomTiers.ts`。
 * 本文件只剩三件事：**建图层、把决策结果铺上去、按签名只在真变了时重铺**。
 *
 * ## 为什么必须是共用钩子而不是两个页面各写一遍
 * 两个页面要做的事**逐字相同**：
 *   ① 建区划图层 + 点位图层
 *   ② 订阅外壳的视野广播
 *   ③ 决策 → 该铺什么 → 只在**真的变了**时重铺
 *   ④ 换端时切聚合
 * 差别只在"数据从哪来"。所以数据源由调用方以 `districts()` / `pois()` 两个
 * **纯查询函数**注入，其余全在这里。各写一遍的话，③ 那份"只在变了才重铺"
 * 的判断是最容易分叉的 —— 一边写了签名比对、另一边没写，就会每帧重建图层，
 * 表现为缩放时徽标闪烁。
 *
 * ## 两条纪律
 * 1. **重铺必须做签名比对**。`setNodes` 会重建全部几何（含边界解码），
 *    每次 refresh 都调它 = 缩放过程中持续闪烁。签名 = 层级 + 有无边界 + adcode 集合。
 * 2. **回调用 ref 现取**，不进 effect 依赖。页面每次渲染都会产生新的闭包，
 *    若让它们进依赖，`registerRefresh` 会被反复注销重登记，图层也会重建。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { loadBoundsForLevel, type DistrictBoundsFile } from '~/common/data/data'
import { recordMapLog } from '~/common/logic/mapLog'
import {
  createDistrictLayer,
  createPoiLayer,
  decideReveal,
  readViewport,
  type DistrictGeoNode,
  type DistrictLayerHandle,
  type DistrictLayerMode,
  type DistrictLayerStats,
  type MapLevel,
  type PoiLayerHandle,
  type PoiLayerStats,
  type PoiPoint,
  type RevealDecision,
} from '~/common/map/tencent'
import { useMapShell, type ViewportEnv } from '~/common/logic/mapShell'
import { NO_CLAIM } from '~/common/logic/planFocus'

/**
 * 揭示状态。**两个字段缺一不可**，它们回答的是两个不同的问题：
 * | 字段 | 问题 | 谁用 |
 * |------|------|------|
 * | `level` | **屏幕上实际铺的是哪一级** | 想展示"当前在看什么"的地方 |
 * | `revealed` | **缩放判据说该到哪一级** | **数据懒加载** |
 *
 * ★ 懒加载必须用 `revealed`。用 `level` 会与回流锁死：数据没到齐 → 回流把
 *   `level` 压浅 → 拿它判"不需要加载" → 永远不加载 → 永远判空。
 */
export interface RevealState {
  level: MapLevel
  revealed: MapLevel
}

export interface UseMapRevealOptions {
  /**
   * 本页路由对应的**基准层级**：
   * `/` → `'province'`、`/province/:adcode` → `'city'`。
   * 揭示只会比它更深；连它都没有内容时也不再退（那是这一页的立身之本）。
   */
  base: MapLevel
  /**
   * 该层级的**全部候选**徽标。
   *
   * ⚠️ **不要在页面里自己按视野筛** —— 判据必须与上屏集合同源
   * （见 `reveal.ts` 文件头的"两个视野"），所以筛选统一在决策侧做。
   * 返回 `null` / 空数组 = 这一级没有徽标。
   */
  districts: (level: MapLevel) => DistrictGeoNode[] | null
  /**
   * 该层级的**全部候选**点位（同上：不要在页面里筛视野）。
   *
   * ★ 返回 `null` 表示**数据尚未就绪**，`[]` 表示**确定没有** —— 这两件事
   *   决定的是相反的动作（前者保持现状并去读数据，后者退回上一级）。
   *   写成 `?? []` 会让懒加载与回流互相锁死。
   *
   * 不实现 = 本页没有点位级。
   */
  pois?: (level: MapLevel) => PoiPoint[] | null
  onSelectDistrict?: (node: DistrictGeoNode) => void
  onSelectPoi?: (poiId: string) => void
  /**
   * 点到**地图空白**（没命中任何点位）时回调 —— 页面用它收起已打开的详情。
   *
   * ★ 这个判定**只能在图层里做**：只有图层知道这一下有没有命中，而腾讯点中覆盖物时
   *   地图自己的 `click` 照样派发。页面自己挂 `map.on('click')` 会在点圆点的同一瞬间
   *   把刚打开的卡关掉（见 `poiLayer` 的抑制窗）。
   */
  onBlank?: () => void
  /**
   * 当前选中的点位。命中时它会被**单独画在选中层**上（彩色白环 + 名字置为选中态），
   * 不进聚合 —— 否则"点了列表里的点，地图上找不到它"。
   *
   * ★ 它必须每次 `paint` 都往下传：候选集合没变、只是换了选中项时，
   *   签名比对会跳过 `update()`，只靠 `refreshView()` 把选中态送进图层。
   */
  selectedId?: string | null
  /**
   * 「搜索命中的那一枚」的**完整坐标** —— 它可能**不在本页的候选集里**
   * （城市页只有本城、省级页只有本省已收录城市，而搜索能在任意一级命中任何一座城）。
   *
   * ★ 必须和 `selectedId` 一起传下去：少了它，选中层与名字层都解析不出坐标，
   *   表现就是用户报的「镜头飞过去了、详情也开了，**图上没有点位**」。
   *   语义与为什么不混进 `pois()` → 见 `poiLayer.PoiUpdateOptions.picked`。
   */
  pickedPoint?: PoiPoint | null
  /**
   * 点位给**独立点**挂不挂名字（与城市页同一套判据：桌面挂、移动端不挂）。
   *
   * ★ 这只是"名字"的开关，**不是"要不要聚合"** —— 聚合两端都开，且由 `poiLayer` 独占，
   *   页面没有开关可拨（见 `plans/12-poi-aggregation.md`）。
   */
  names?: boolean
  /**
   * 数据版本号。异步取数完成后改一下，即可用新数据重铺。
   * 传字符串（如 `'rows,children,pois'` 的拼接），不要传对象 —— 它进 effect 依赖。
   */
  dataKey?: string
}

/**
 * 把「缩放揭示」挂到地图上。返回当前揭示状态，供页面渲染提示文案与触发懒加载。
 *
 * 调用方**不需要**再自己 `registerRefresh` —— 钩子内部已经登记了。
 */
export function useMapReveal(o: UseMapRevealOptions): RevealState {
  const shell = useMapShell()
  const { base, names, dataKey, selectedId, pickedPoint } = o

  const [state, setState] = useState<RevealState>({ level: base, revealed: base })

  /** 最新一版的回调。每次渲染刷新，effect 与图层事件都从这里现取 */
  const oRef = useRef(o)
  oRef.current = o

  const districtRef = useRef<DistrictLayerHandle | null>(null)
  const poiRef = useRef<PoiLayerHandle | null>(null)

  /** 上一次真正铺上去的「层级 + 有无边界 + adcode 集合」签名 */
  const districtSigRef = useRef('')
  /** 「层级 + adcode 集合」→ 取回的边界文件（`undefined` = 还没取过，`null` = 取过但没有） */
  const boundsCacheRef = useRef(new Map<string, DistrictBoundsFile | null>())
  /** 上一次真正铺上去的点位 id 集合签名 */
  const poiSigRef = useRef('')
  /** 最近一次的揭示决策 —— 供聚合落地后的日志使用（见 `poiLayer.onSettled`） */
  const lastDecisionRef = useRef<RevealDecision | null>(null)
  /** 最近一次外壳广播给的环境。★ 初值非空 —— `paint()` 的多个无参调用点（数据/边界晚到）
   *  也必须拿到上一份，否则"规划态该收起来"会被丢掉；非空初值还让下面不必写 `?? {}`。 */
  const envRef = useRef<ViewportEnv>({
    container: null, overlays: [], planFocus: false, claimed: NO_CLAIM,
  })

  const paint = useCallback(
    (env?: ViewportEnv) => {
      if (env) envRef.current = env
      const map = shell.map
      if (!map) return

      const opts = oRef.current
      const view = readViewport(map, env?.container)
      const d = decideReveal(opts.base, view, {
        districts: opts.districts,
        pois: opts.pois,
      })
      // ★ 存下来给 `onSettled` 用：聚合落地是**异步**的，那一刻 `paint()` 的局部变量早没了
      lastDecisionRef.current = d

      // ★ 只在**真的变了**时改 state，否则每次缩放结束都会重渲染整页
      setState((cur) =>
        cur.level === d.level && cur.revealed === d.revealed
          ? cur
          : { level: d.level, revealed: d.revealed },
      )

      const dl = districtRef.current
      if (dl) {
        /**
         * ★★ 面的层级**必须与徽标的层级一致**（2026-09-30 用户：「显示省标签的时候
         *   显示省的轮廓，显示市标签的时候显示市的轮廓，显示区的时候显示区的轮廓」）。
         *
         * 上一版是页面各传一个固定的 `districtFile` —— 首页传"各省的面"、
         * 省级页传"各市的面"。于是放大揭示到下一级时，新徽标在那个文件里**查不到
         * 自己的 adcode** ⇒ 整片没有面。实测（首页，镜头钉成都）：
         *
         * | 放大到 | 铺的徽标 | 实际面 |
         * |--------|---------|--------|
         * | z=4.4 | 省（34） | 19 个 = 省的面 ✓ |
         * | z=6.8 | **市**（92） | 7 个 —— **还是省的面** ✗ |
         * | z=9.8 | **区**（20） | **0 个** ✗ |
         *
         * ⇒ 现在按 `d.faceLevel` 现取（`loadBoundsForLevel` 里写着"父 adcode 怎么算"）。
         * 取回来之前**先铺徽标**，面到了再重铺一次 —— 不让"读文件"挡住徽标上屏。
         *
         * ★★ 2026-10-02：**面与徽标在这一档分家**。点位档（`d.level === 'poi'`）的
         *   `d.districts` 是空的（徽标退场），但 `d.faces` **仍是区级节点** ——
         *   用户要的是"放大到看景点时也知道自己在哪个区"。所以这里用 `faces` 铺几何、
         *   用 `districts` 决定徽标开关（→ `'reference'` 模式：只画参考面、不收事件）。
         *
         * ★ `faces` 为空时**点位档不清屏**：那是"区数据还没到"或"视野内暂时没有区"，
         *   清一下会让轮廓闪白；而区划级为空（base 且视野内真的没有节点）就该清。
         */
        const faceNodes = d.faces
        if (faceNodes.length === 0) {
          if (d.level !== 'poi' && districtSigRef.current !== '') {
            districtSigRef.current = ''
            dl.clear()
          }
        } else {
          const adcodes = faceNodes.map((n) => n.adcode).sort()
          // ★ 规划态也走 `'reference'`（见 `planFocus.ts`）：徽标回答"这片归哪个区"，
          //   而规划态用户问的是"我这条行程怎么走"。面照旧留着。模式进了下面的 `sig`，
          //   所以切模式会重铺 —— 不然徽标收不回去。
          const mode: DistrictLayerMode =
            d.districts.length > 0 && !envRef.current.planFocus ? 'full' : 'reference'
          // ★ 缓存键**不含模式**（几何与模式无关），签名键**含模式**（切模式要重铺）
          const cacheKey = `${d.faceLevel}|${adcodes.join(',')}`
          const sig = `${cacheKey}|${mode}`
          const cached = boundsCacheRef.current.get(cacheKey)
          if (sig !== districtSigRef.current) {
            districtSigRef.current = sig
            dl.setNodes(faceNodes, cached ?? undefined, mode)
          }
          if (cached === undefined) {
            void loadBoundsForLevel(d.faceLevel, adcodes).then((f) => {
              boundsCacheRef.current.set(cacheKey, f)
              // ★ 只有还停在**同一档**时才重铺：换级之后铺回去 = 拿旧几何盖掉新徽标
              if (districtSigRef.current === sig) {
                dl.setNodes(faceNodes, f ?? undefined, mode)
                // ★ 面是**异步**到的：`paint()` 末尾那次 `logSnapshot` 记到的是"还没有面"
                //   的那一帧（`polys: 0`）。不补记的话探针读到的永远是"没有面" ——
                //   2026-09-30 排查"面没跟着换级"时就被这个陈旧读数误导过一次。
                logSnapshot(readViewport(map).zoom, opts.base, d, dl, poiRef.current)
              }
            })
          }
        }
        // 视野变了，避让要重算 —— 即使徽标集合没变（挤不挤随缩放变化）
        dl.refreshView()
      }

      /**
       * ── 数据未就绪：**只挡住点位层**（2026-09-29 修）──
       *
       * 原来的写法是"整套跳过"（连上面那段徽标同步一起跳过），理由是"数据马上就到，
       * 先清掉会闪一帧白"。那理由只在**数据马上到**时成立；而首页的懒加载要读
       * **全部已收录城市**的点位（17 座城），这个窗口有好几秒。
       *
       * 后果正是用户报的这一条：「我点那个区，放大到区级了，我再怎么放大这个标签
       * 都不会消失」—— 他已经放大到 z≥12（街道尺度），屏幕上却一直挂着上（几）级的
       * 徽标（实测 20 个区徽标），而那枚徽标钉在区中心，**离他正在看的地方几十公里**。
       * 数据到得越慢，挂得越久。
       *
       * ⇒ `pending` 的语义本来就只是"**点位**数据没到，别用空数组去清点位层"，
       *   与"上层徽标该不该在"无关：决策已经说了这一级是 `poi`（`districts: []`），
       *   那就照它清。上面那段现在对 pending 也执行，只把下面的点位同步挡住。
       */
      if (d.pending) {
        // ★ 这一条也要记：用户看到的"放大时闪一下白/空窗"正发生在这个窗口里。
        //   不记的话日志里会凭空少一段，看起来像"什么都没发生"
        logSnapshot(view.zoom, opts.base, d, districtRef.current, poiRef.current)
        return
      }

      const pl = poiRef.current
      if (pl) {
        // 签名只看**候选集合**，不看分档 —— 分档随缩放变，而缩放变化本身
        // 一定会走到 `refreshView`（下面那行），所以不必进签名
        const sig = d.pois
          .map((x) => x.id)
          .sort()
          .join(',')
        if (sig !== poiSigRef.current) {
          poiSigRef.current = sig
          pl.update(d.pois, {
            selectedId: oRef.current.selectedId ?? null,
            picked: oRef.current.pickedPoint ?? null,
          })
        }
        // ★ 选中项**每次都要往下传**：候选集合没变、只是换了选中的那一个时，
        //   上面那段签名比对会跳过 `update()` —— 只在这里传才高亮得到
        // ★ 用 `envRef.current` 而不是入参 `env`：无参调用点上要保住 `claimed` / `planFocus`
        pl.refreshView({
          ...envRef.current,
          selectedId: oRef.current.selectedId ?? null,
          picked: oRef.current.pickedPoint ?? null,
        })
      }

      // ★ 点位 futures 结算后由 `onSettled` 记（那一刻的簇数才是屏幕上的真数）。
      //   **区级这一屏必须在这里记**：它没有簇，也就不会有 `onSettled` ——
      //   只依赖 `onSettled` 的话，日志会永远停在"上一次有点位的那一屏"，
      //   于是"上一级压根没出现"这种事在日志里**看不见**，而那正是要排查的现象本身。
      if (d.pois.length === 0) {
        logSnapshot(view.zoom, opts.base, d, districtRef.current, poiRef.current)
      }
    },
    [shell.map],
  )

  // 建两个图层。★ 用 ref 现取回调，所以这里**不依赖任何页面回调**
  useEffect(() => {
    const map = shell.map
    if (!map) return

    const d = createDistrictLayer(map, {
      onSelect: (n) => oRef.current.onSelectDistrict?.(n),
    })
    const p = createPoiLayer(map, {
      names: oRef.current.names ?? true,
      onSelect: (id) => oRef.current.onSelectPoi?.(id),
      // 点空白 → 交给页面收详情（判定归图层，理由见 `UseMapRevealOptions.onBlank`）
      onBlank: () => oRef.current.onBlank?.(),
      // ★ 日志只在**聚合落地后**记一次：那一刻的簇数/气泡数才是屏幕上的真数
      //   （`refreshView()` 刚回来时 `getClusters()` 还是空的 —— 聚类在 worker 里算）
      onSettled: () => {
        const d = lastDecisionRef.current
        if (!d) return
        logSnapshot(readViewport(map).zoom, oRef.current.base, d, districtRef.current, poiRef.current)
      },
    })
    districtRef.current = d
    poiRef.current = p
    districtSigRef.current = ''
    poiSigRef.current = ''
    paint()

    return () => {
      d.destroy()
      p.destroy()
      districtRef.current = null
      poiRef.current = null
      // 清签名：图层换了，上一次的签名不再代表"屏幕上是什么"
      districtSigRef.current = ''
      poiSigRef.current = ''
    }
  }, [shell.map, paint])

  // 换端（移动 ↔ 桌面）切"独立点挂不挂名字"。
  // ★ 只切名字层 —— 聚合两端一致，没有第二个开关要拨。已经是目标值时图层自己会短路
  useEffect(() => {
    poiRef.current?.setNames(names ?? true)
  }, [names])

  // 缩放 / 平移结束、取景动画结束，都由外壳扇出。
  // ★ 不捕获 paint 之外的任何东西
  useEffect(() => shell.registerRefresh((env) => paint(env)), [shell.registerRefresh, paint])

  // 数据到齐 / 筛选变化 / **选中项或搜索命中变化**时重铺（paint 内部会做签名比对）
  useEffect(() => {
    paint()
  }, [paint, dataKey, selectedId, pickedPoint])

  return state
}

/**
 * 把这一屏的**实际**内容记一条日志（见 `common/logic/mapLog.ts`）。
 *
 * ★ 数字全部取自图层自己的 `stats()`，**不是** `d.districts.length` / `d.pois.length`。
 *   后者是**候选**：徽标还要过像素避让（实测 165 → 40），点位还要过档位准入、
 *   再被聚合器合成簇（46 个候选 → 8 个簇，其中 3 个是气泡）。只记候选会得出
 *   "明明铺了却看不到"的错觉 —— 而那正是要排查的现象本身。
 *
 * ★ 必须在图层同步**之后**调用：`stats()` 回答的是"上一次重绘的结果"，
 *   提前取会拿到上一屏的数。
 */
function logSnapshot(
  zoom: number,
  base: MapLevel,
  d: RevealDecision,
  district: DistrictLayerHandle | null,
  poi: PoiLayerHandle | null,
): void {
  const ds: DistrictLayerStats | undefined = district?.stats()
  const ps: PoiLayerStats | undefined = poi?.stats()
  recordMapLog({
    zoom,
    base,
    level: d.level,
    revealed: d.revealed,
    pending: d.pending,
    dTotal: d.districts.length,
    badges: ds?.badges ?? 0,
    badgeTexts: ds?.badgeTexts ?? [],
    polys: ds?.polygons ?? 0,
    pTotal: d.pois.length,
    aTotal: ps?.admitted ?? 0,
    clusters: ps?.clusters ?? 0,
    bubbles: ps?.bubbles ?? 0,
    labels: ps?.labels ?? 0,
    labelTexts: ps?.labelNames ?? [],
  })
}
