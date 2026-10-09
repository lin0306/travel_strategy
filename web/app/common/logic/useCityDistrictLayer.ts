/**
 * 城市页的**区图层**接线（第四级：省 → 市 → 区 → 景点）。
 *
 * ## 为什么单独一个 hook
 * `useCityView.ts` 已经贴着 420 行的单文件上限，而区这一级要新增"加载边界、
 * 建图层、按缩放决定铺不铺、点区取景"四件事。抽出来之后城市页只多**一行**调用，
 * 而图层生命周期里最容易写错的地方（走 ref 现取、签名比对、destroy）也集中在一处。
 *
 * ## ★ 这一级与上面两级有一个本质差别：**没有"待收录"**
 * | 级别 | `poiCount === null` 的含义 |
 * |------|---------------------------|
 * | 市 | **待收录** —— 我们还没采集这座城市（进度问题），UI 显示「—」 |
 * | 区 | 不存在这种状态。一个区没有景点就是 **0**，如实显示「0 个」 |
 *
 * 区的"待收录"是伪概念：城市收了就是全市范围的采集，某个区没景点是内容事实。
 * 把 0 画成虚线的「待收录」，等于告诉用户"这区我们还没做" —— 那是假话。
 *
 * ## 什么时候铺（2026-10-02 改：点位档**不再收起面**）
 * 城市页的基准层级现在是 **`district`**（原来是 `poi`），于是：
 *   - `zoom < POI_REVEAL_ZOOM` → **`full`**：区的面 + 区徽标 + 可点（点区 = 飞过去）
 *   - `zoom ≥ POI_REVEAL_ZOOM` → **`reference`**：**面留着**，徽标退场、不接事件
 *
 * ★★ 上一版在点位档直接 `clear()`，把**面也一起收掉了** —— 用户 2026-10-02：
 *   「区的轮廓能不能一直都显示……就不知道这个到底在哪个区」。详见 `paint()` 里那段。
 * 点位要不要铺**不归本文件管** —— 那是 `poiTierForZoom()` 的职责（唯一出处）。
 */

import { useCallback, useEffect, useRef } from 'react'

import { loadDistrictFaces, type DistrictBoundsFile } from '~/common/data/data'
import type { Poi } from '~shared/schema'
import { loadDistrictBox, type SubdistrictRow } from '~/common/data/subdistricts'
import { focusPointsFor, sameDistrict } from '~/common/logic/districtFocus'
import { useMapShell, type ViewportEnv } from '~/common/logic/mapShell'
import {
  createDistrictLayer,
  POI_REVEAL_ZOOM,
  readViewport,
  type DistrictGeoNode,
  type DistrictLayerHandle,
  type DistrictLayerStats,
} from '~/common/map/tencent'

export interface UseCityDistrictLayerOptions {
  /** 市的 adcode —— 区分片与边界文件的文件名就是它（`subdistricts/440100.json`） */
  cityAdcode: string
  /** 区列表。`null` = 还没有这份数据（step8 没跑 / 这座城不在范围） */
  rows: SubdistrictRow[] | null
  /**
   * 本页的点位。用来回答"**这个区里面**有哪些景点"—— 点区时优先框它们
   * （见 `focusPointsFor` 的第一条优先级：框住区的行政框常常把镜头落到一片空地上）。
   */
  pois: Poi[] | null
  /** 地图是否可用。地图还没 ready 时建图层会拿到 null map */
  enabled: boolean
  /**
   * 图层每次重画后回调 —— 页面拿它记诊断日志。
   *
   * ★ 为什么不能只靠点位层的 `onSettled`：点位没上场的那一屏（正是区级那一屏）
   *   **没有聚簇、也就没有结算事件**，日志会停在上一屏的读数上。
   */
  onPainted?: () => void
}

export interface UseCityDistrictLayerResult {
  /** 该图层这一刻的**实际**读数（供 `common/logic/mapLog.ts`）。图层未建立时 `null` */
  stats: () => DistrictLayerStats | null
}

/**
 * 把区图层挂到城市页的地图上。**副作用全在内部**，调用方只需要传数据。
 */
export function useCityDistrictLayer(o: UseCityDistrictLayerOptions): UseCityDistrictLayerResult {
  const shell = useMapShell()
  const { cityAdcode, rows, enabled } = o

  /** 回调用 ref 现取：页面每次渲染都会产生新的闭包，进依赖会让图层反复重建 */
  const paintedRef = useRef(o.onPainted)
  paintedRef.current = o.onPainted

  /** 最近一版的区数据。effect 与图层回调都从这里现取，避免闭包抓住旧的那一份 */
  const rowsRef = useRef<SubdistrictRow[] | null>(rows)
  rowsRef.current = rows
  /** 最近一版的市 adcode（点区取景时用，它在图层建立那一刻就被固定了） */
  const adcodeRef = useRef(cityAdcode)
  adcodeRef.current = cityAdcode

  const layerRef = useRef<DistrictLayerHandle | null>(null)
  /** 最新一版点位。图层回调里现取（进依赖会让图层反复重建） */
  const poisRef = useRef<Poi[] | null>(o.pois)
  poisRef.current = o.pois
  /** 该市的区边界（各区的面）。它与区列表是孪生产物，step8 一次请求产出两样 */
  const boundsRef = useRef<DistrictBoundsFile | null>(null)
  /** 上一次真正铺上去的签名。没有它 = 每次刷新都重建几何 = 缩放时持续闪烁 */
  const sigRef = useRef('')
  /**
   * 最近一次**外壳广播**给的环境。
   *
   * ★ 为什么必须留着：`paint()` 有**四个**调用点 —— 视野广播、区列表变化、边界到达
   *   （`loadDistrictFaces().then`）、以及城市切换。**只有视野广播那一路手里有 `env`**；
   *   其余几路调的是 `paint()`（无参）。若不记住上一份 env，那些路径会把
   *   "规划态该收起徽标"这个判断丢掉 —— 表现为**徽标又冒出来**，而且只在
   *   "边界晚到 / 数据晚到"时出现（本地快、线上慢，最难复现的那种）。
   */
  const envRef = useRef<ViewportEnv | null>(null)

  /** 铺（或收起）区图层 */
  const paint = useCallback((env?: ViewportEnv) => {
    if (env) envRef.current = env
    const map = shell.map
    const layer = layerRef.current
    if (!map || !layer) return

    const clear = () => {
      if (sigRef.current !== '') {
        layer.clear()
        sigRef.current = ''
      }
    }

    const list = rowsRef.current
    if (!list?.length) return clear()

    /**
     * ★★ 点位档**不收起区图层，而是切成「纯参考」模式**（2026-10-02 用户：
     *   「区的轮廓能不能一直都显示，现在区在放大到显示景点的时候就不会显示了，
     *     就不知道这个到底在哪个区」）。
     *
     * 上一版写的是 `zoom ≥ POI_REVEAL_ZOOM → clear()`，理由是"把画面交给点位层"。
     * 但那把**面也一起收掉了** —— 屏幕上只剩一堆圆点，看不出这片属于哪个区，
     * 而"我在哪个区"正是选景点时最需要的上下文。
     *
     * ⇒ 现在：徽标照旧退场（它会挡景点名字，且这一档没有可点进去的下一级），
     *    **面留着**当参考底；同时**面和徽标都不接点击** —— 面几乎覆盖整屏，
     *    留着 click 会让"点景点附近"命中面而飞到区中心（见 `DistrictLayerMode`）。
     *
     * ★★ 2026-10-05 又加了**第二个**进入这一档的判据：**规划详情态**
     *    （见 `common/logic/planFocus.ts`）。理由同上但方向不同 ——
     *    不是因为"这一档没有下一级可点"，而是"用户此刻在看的是行程"：
     *    徽标回答"这一片归哪个区"，而行程态的问题是"我这条路线怎么走"。
     *    **面同样留着**（灰轮廓不抢眼，且方位感仍有用）。
     *
     * ⚠️ 只读一次视野：`map.getZoom()` 在地图移动过程中每次调用都可能返回不同的值
     */
    const view = readViewport(map)
    const facesOnly = Boolean(envRef.current?.planFocus) || view.zoom >= POI_REVEAL_ZOOM

    const nodes: DistrictGeoNode[] = list.map((r) => ({
      adcode: r.adcode,
      name: r.name,
      lng: r.center.lng,
      lat: r.center.lat,
      // ★ 区没有"待收录"这一说，所以这里**不传 null** —— 理由见文件头
      poiCount: r.poiCount,
    }))
    // ★ 签名里**必须有"边界到没到"**：只记 adcode 集合的话，边界是异步后到的，
    //   它抵步时签名没变 → `setNodes` 被跳过 → **徽标铺了、面永远画不出来**。
    //   （`useMapReveal` 用同样的 `'b' / '-'` 一位处理同一件事，理由那里也写着。）
    // ★ 模式也要进签名：`full ↔ reference` 切换同样要重铺（不然徽标收不回去）
    const sig = `${nodes
      .map((n) => n.adcode)
      .sort()
      .join(',')}|${boundsRef.current ? 'b' : '-'}|${facesOnly ? 'ref' : 'full'}`
    if (sig !== sigRef.current) {
      sigRef.current = sig
      layer.setNodes(nodes, boundsRef.current ?? undefined, facesOnly ? 'reference' : 'full')
    }
    // 视野变了 → 徽标避让要重算（挤不挤随缩放变化），与 setNodes 是否执行无关
    layer.refreshView()
    paintedRef.current?.()
  }, [shell.map])

  // ── ① 读区边界 ──
  // ★ 与省级页同一条纪律：**没有边界也要能只撒徽标**（边界是可选增强，不是前置条件），
  //   所以拿不到一律降级为 null，不阻断、不报错。
  useEffect(() => {
    let alive = true
    boundsRef.current = null
    sigRef.current = ''
    if (!cityAdcode) return
    // ★ 走 `loadDistrictFaces` 这个**唯一入口**：它逐区优先用高德的"区自身轮廓"，
    //   缺了退回腾讯那份（腾讯给下辖区的轮廓极粗，实测有的区只有 4 个点 = 一个矩形
    //   —— 用户 2026-10-02：「这个区的轮廓，怎么方方正正的」）。
    //   ⚠️ 别在这里直接调 `loadDistrictBounds`：那条只读腾讯那份。
    loadDistrictFaces(cityAdcode).then((f) => {
      if (!alive) return
      boundsRef.current = f
      paint()                                  // 边界到了，带着面重铺一次
    })
    return () => {
      alive = false
    }
  }, [cityAdcode, paint])

  // ── ② 建图层 ──
  useEffect(() => {
    const map = shell.map
    if (!map || !enabled) return

    const layer = createDistrictLayer(map, {
      /**
       * 点区 = **飞到这个区**，不换 URL（与"点地图上的东西不换 URL"同一条规矩）。
       * 落点通常在 12 以上，于是点位层自然接着揭示出来 ——
       * "先看区、再看景点"就是这么发生的，不需要额外的状态机。
       */
      onSelect: (node) => {
        layer.setActive(node.adcode)
        const parent = adcodeRef.current
        /**
         * ★ 与省级页 / 首页**同一条逻辑**（`focusPointsFor`）——各写一遍的话，
         *   "点区框哪一片"会分叉（本页原来只框行政框，于是大区落到一片空地上）。
         */
        void focusPointsFor(
          // ★ `poiCount` 必须带上：徽标写 0 个的区不该被"按名字筛出来的一条"拉走
          //   （见 `focusPointsFor` 里那段"徽标说几个就是几个"）
          { adcode: node.adcode, name: node.name, lng: node.lng, lat: node.lat, poiCount: node.poiCount },
          {
            // 区的下级（街道）没有数据 —— 只走 `boxOf`（行政框）与 `poisOf`（区里的景点）两条
            childrenOf: () => [],
            poisOf: async (_adcode, name) =>
              (poisRef.current ?? [])
                // ★ 必须用 `sameDistrict` 而不是 `===`：直辖市的徽标名不带"区"
                //   （东城 vs 东城区），裸比较恒 false ⇒ 点区掉进"行政框"那一支，
                //   景点就跑到屏幕外了（见 `sameDistrict` 自己的注释）。
                .filter((p) => sameDistrict(p.location.district, name))
                .map((p) => ({ lng: p.location.point.lng, lat: p.location.point.lat })),
            boxOf: (adcode) => loadDistrictBox(parent, adcode),
          },
        ).then((t) => shell.fit(t.points, { reason: 'drill', minZoom: t.minZoom, anchor: t.anchor }))
      },
    })
    layerRef.current = layer
    sigRef.current = ''
    paint()

    return () => {
      layer.destroy()
      layerRef.current = null
      sigRef.current = ''
    }
  }, [shell.map, shell.fit, enabled, paint])

  // ── ③ 数据到达 / 变化时重铺（paint 内部做签名比对）──
  useEffect(() => {
    paint()
  }, [paint, rows])

  // ── ④ 视野变化后决定是否还是"区这一档" ──
  // ★ 必须登记：拖到 12 以上时区要自己退场，缩回来时要重新出现。
  useEffect(() => shell.registerRefresh((env) => paint(env)), [shell.registerRefresh, paint])

  return { stats: () => layerRef.current?.stats() ?? null }
}
