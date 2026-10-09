/**
 * 行程连线层（09 文档 6.3 / 6.3.1）。
 *
 * ## 为什么必须「逐段」而不是「一整条」
 * 一整条 path 是一个 geometry，它**没法**被单独提亮、单独聚焦、单独描拥堵色 ——
 * 而这四条联动恰恰是行程页的地图侧全部价值：
 *
 * | 面板动作 | 地图响应 |
 * |---------|---------|
 * | hover 一段 | 该段加粗提亮，其余降到 40% |
 * | 点一段 | 视野收窄到该段两端点 |
 * | 切换方式 | 线型切换（步行虚线 / 其余实线） |
 * | 拥堵路段 | 上层叠一段醒目色细线 |
 *
 * 所以每段一个 geometry，`id` 用**出发那个 stop 的 uid**；
 * 住宿点出发的那一段没有对应 POI，用 `LEG_ID_FROM_STAY`（`__leg0`）。
 *
 * ## 三个诚实性约束（写在这里，因为都是渲染层决定的）
 * 1. **静态命中画的是两端点直连**，UI 必须同时标「直线示意」——
 *    矩阵只存距离与时长、**不存路径点**，这是 09 文档 6.1 的既定取舍。
 * 2. **拥堵双线只在「用户点开过方案卡」的那段画** —— 路况是点开时才拉的接口，
 *    没拉过就画红段等于编造路况。
 * 3. **不做流光蚂蚁线** —— 那是导航 App 的语言，会让人以为是实时导航。
 *    我们给的是「查询时刻的快照」，静态描色才诚实。
 */

import {
  buildBaseStyles,
  buildDynamicStyles,
  buildJamStyles,
  buildTransferStyles,
  styleIdOf,
} from './routeStyles'
import { createTapGuard } from './tapGuard'
import { Z_LAYER } from './zLayers'
import { MODE_META, type TravelMode } from '~shared/schema'

/** 住宿点出发那一段的固定 id —— 它没有对应的 POI，所以借这个哨兵值占位 */
export const LEG_ID_FROM_STAY = '__leg0'

export interface RoutePoint {
  lng: number
  lat: number
}

/** 拥堵切片：在 `path` 上的 `[fromIdx, toIdx]` 区间内 */
export interface JamSpan {
  fromIdx: number
  toIdx: number
  /** 20–40 km/h 缓行 / < 20 km/h 拥堵 */
  level: 'slow' | 'jam'
}

export interface RouteLeg {
  /** ★ 段 id = 出发 stop 的 uid；住宿出发段用 `LEG_ID_FROM_STAY` */
  id: string
  mode: TravelMode
  /**
   * 路径点。**静态命中时只有首尾两点**（直线示意）；
   * 实时调过路线规划才是真实折线。
   */
  path: RoutePoint[]
  /**
   * 拥堵切片。**只有在 `path` 是真实折线时才可能非空** ——
   * 两点直连没有"路上哪一段堵"可言。
   */
  jams?: JamSpan[]
  /**
   * 这条是「**候选组里的一员**」（不是那条整条规划线）。
   *
   * ★ 有候选在场时，基准样式必须分两档：**选中的**主色实线、**待选的浅蓝**。
   *   而"有没有候选"跟"用户选没选"是**两件事** —— 用户刚点开、还没挑的时候
   *   那些候选也要画成浅蓝，不能掉进"无焦点"那档（近黑实线）。
   *   用户 2026-10-05：「不要用灰色表示待选，都看不出来，**用浅蓝色**」。
   */
  candidate?: boolean
  /**
   * ★ **自定义颜色** —— 地铁线路的官方色就靠它（`lines[].line_color`）。
   *
   * 预置样式表只有几档固定色，而线路色是**任意值**（`#0060A4`、`#E4002B`…），
   * 装不进预置表 ⇒ 由 `setLegs` 现建（见那里的 `dyn`）。
   */
  color?: string
  /**
   * ★ **强制虚线** —— 步行段用。
   *
   * 线型本身携带语义："这段是**走过去**的"。原来靠 `mode === 'walking'` 推，
   * 但公交方案里"整条的方式"是 `transit`、只有**其中一段**是走路，
   * 所以必须由每段自己声明。
   */
  dashed?: boolean
  /**
   * ★ **公共交通方案里的步行段** —— 单独的、更弱的一档（灰、细虚线）。
   *
   * 与"整条路线就是步行"分开：那条是主角，照常醒目；这一截只是两程车之间的中转，
   * 和乘车段同宽同色会把一条方案画成"蓝实线 + 蓝虚线"的怪线。
   * 判据见 `routeStyles.styleIdOf`。
   */
  transitWalk?: boolean
  /**
   * ★ 这条段的**起点是换乘点**（公交/地铁的换乘站）—— 在这里画一枚小圆。
   *
   * 由调用方判定（"这是第 2 个及以后的乘车段"），因为只有它手里有完整的分段序列；
   * 图层只负责"这个坐标要一枚换乘点"。理由见 `buildTransferStyles`。
   */
  transferAtStart?: boolean
  /**
   * ★ 这条属于**选中的那一组** —— 放 `focus` 层（压在待选之上）。
   *
   * 取代原来只能表达**一条**的 `focusId`：公交方案一被选中就有好几段
   * （步行 + 各条线路），**每段都要在上面**，一个 id 表达不了。
   */
  onTop?: boolean
}

export interface RouteLayerOptions {
  /** 点某一段 —— 调用方负责 fitBounds 到两端点 + 拉取该段多方案 */
  onSelect?: (legId: string) => void
  onHover?: (legId: string | null) => void
}

export interface RouteLayerHandle {
  /**
   * 铺/更新连线。
   * @param focusId 当前聚焦的段（hover 或展开中）—— 其余段会降到 40%
   */
  /** 重设全部线。谁在上由每条自己的 `onTop` 决定（见 `RouteLeg`） */
  setLegs(legs: RouteLeg[]): void
  clear(): void
  destroy(): void
}

/* ────────────────────────────────────────────────
 * 样式
 * ────────────────────────────────────────────── */



/**
 * ⚠️ **三套图层**（`base` / `focus` / `jam`）而不是一套 —— 腾讯**不保证**同一
 * `MultiPolyline` 内后加入的 geometry 盖在先加入的上面，靠声明顺序去赌是不稳的。
 *
 * | 层 | zIndex | 画什么 |
 * |----|--------|--------|
 * | `base` | 30 | 背景整条线（中性浅灰）+ **待选**候选（浅蓝） |
 * | `focus` | 31 | **选中的那条**（主色、粗）—— 用户 2026-10-05：「选中的线路要在待选之上」 |
 * | `jam` | 32 | 拥堵细线（只画在已拉过方案的那一段上） |
 *
 * 分层之后「谁压谁」是**结构保证**，不依赖实现细节。
 *
 * ★★ **宽度与描边必须是整数**（2026-09-26 实测 + 读 SDK 源码确认）。
 *    腾讯的校验是 `n.width >= 0 && n.width % 1 == 0`，不满足就
 *    `console.error('MultiPolyline.styles: 样式id … width属性无效')` 并**把这一项换成默认值**。
 *    原来这里的 `3.5 / 5.5 / 2.5` 与 `borderWidth: 1.6` **全部被静默丢掉** ——
 *    表现是"线还是画出来了，只是粗细不是设计的那一档"，8 条 console.error 一直挂着。
 *    所以下面一律取整数：**这一档粗一点、那一档细一点，肉眼能分辨就够了**，
 *    精度没有意义（像素本来就不支持半像素的实心描边）。
 */


/* ────────────────────────────────────────────────
 * 图层
 * ────────────────────────────────────────────── */



export function createRouteLayer(map: TMap.Map, opts: RouteLayerOptions = {}): RouteLayerHandle {
  const base = new TMap.MultiPolyline({
    map,
    styles: buildBaseStyles(),
    geometries: [],
    zIndex: Z_LAYER.routeBase,
  })
  /**
   * ★★ **选中的那条单独一层**（用户 2026-10-05：「还有一个层级问题，
   * 选中的线路要在待选之上」）。
   *
   * 为什么不能靠"在 `legs` 数组里往后放"：腾讯**不保证**同一个 `MultiPolyline`
   * 内后加入的 geometry 盖在先加入的上面 —— 本文件头顶那段注释就是为这件事写的
   * （`jam` 层当年也是被它逼出来的）。所以只能**真的分出一个图层**，
   * 上下由 `zIndex` 定：**那是结构保证，不赌实现细节**。
   *
   * ⇒ 层级见 `zLayers.ts`（唯一出处）：
   *   `base` < **`focus`** < `jam` < `transfer` < `planMarker`
   */
  const focus = new TMap.MultiPolyline({
    map,
    styles: buildBaseStyles(),
    geometries: [],
    zIndex: Z_LAYER.routeFocus,
  })
  const jam = new TMap.MultiPolyline({
    map,
    styles: buildJamStyles(),
    geometries: [],
    zIndex: Z_LAYER.routeJam,
  })
  /**
   * ★ **换乘点**单独一层（不是折线，是 marker）。
   *
   * 它必须压在整条路线之上 —— 换乘站正好落在两条乘车段的接缝处，
   * 压在线下面就会被线吃掉一半、看着像线的一个毛刺。
   * 样式为什么是"白心空心圆"见 `buildTransferStyles`。
   */
  const transfers = new TMap.MultiMarker({
    map,
    styles: buildTransferStyles(),
    geometries: [],
    zIndex: Z_LAYER.routeTransfer,
  })

  let legs: RouteLeg[] = []
  /**
   * 上一次注册的**动态颜色集合**（排序后拼成的串）。
   * 没变就不重建样式表 —— 拖动地图会频繁 `setLegs`，每次重建是白烧性能。
   */
  let styleSig = ''

  function toLatLngs(pts: RoutePoint[]): TMap.LatLng[] {
    // ⚠️ 腾讯纬度在前
    return pts.map((p) => new TMap.LatLng(p.lat, p.lng))
  }

  function setLegs(next: RouteLeg[]) {
    legs = next
    /**
     * ★ 有候选在场就算"分组中" —— **不看用户选没选**（判据见 `RouteLeg.candidate`）。
     */
    const anyFocus = legs.some((l) => l.candidate || l.onTop)

    /**
     * ★ **地铁线路色是任意值，预置样式表装不下** ⇒ 给用到的每个颜色现建一档。
     *
     * · `setStyles` 是**整表替换**，所以要把预置的一起带上（`buildBaseStyles()`）。
     * · 只在颜色集合**变了**的时候才调（用 `styleSig` 短路）—— 拖动地图会频繁
     *   重算 legs，每次都重建样式表是白烧性能。
     * · 键由"颜色+线型"拼（`dynStyleId`），同一色多处复用自动共享一档。
     */
    const dyn = buildDynamicStyles(legs)
    const sig = Object.keys(dyn).sort().join(',')
    if (sig !== styleSig) {
      styleSig = sig
      /**
       * ★★ **先探再用** —— `setStyles` 只写在**手写的** `tmap.d.ts` 里，
       * 而那个文件有过前车之鉴：`MarkerCluster.setData` 是照别的类顺手猜的，
       * 结果移动端一进城市页就 `setData is not a function`、**整页白屏**
       * （详见 `tmap.d.ts` 里那段注释）。
       *
       * ⇒ 真不存在就**跳过**（地铁线路色不生效，但页面照常），并且 `warn` 出来 ——
       *   静默跳过才是最难查的那种：图上少个颜色，没人知道是哪儿的事。
       * （`dyn` 为空时这一步其实是"把样式表恢复成预置的那套"，所以照常要走。）
       */
      const merged = { ...buildBaseStyles(), ...dyn }
      const apply = (layer: TMap.MultiPolyline) => {
        const fn = (layer as unknown as { setStyles?: (s: Record<string, unknown>) => void })
          .setStyles
        if (typeof fn === 'function') {
          fn.call(layer, merged)
        } else if (Object.keys(dyn).length > 0) {
          console.warn(
            '[routeLayer] 该 SDK 版本没有 MultiPolyline.setStyles —— 线路官方色不生效（地图其余部分正常）',
          )
        }
      }
      apply(base)
      apply(focus)
    }

    /** 带 `onTop` 的 → `focus` 层（在上）；其余（背景线 + 待选候选）→ `base` 层（在下） */
    const onTop = legs.filter((l) => l.onTop)
    const below = legs.filter((l) => !l.onTop)

    base.setGeometries(
      below
        .filter((l) => l.path.length >= 2)
        .map((l) => ({ id: l.id, styleId: styleIdOf(l, anyFocus), paths: toLatLngs(l.path) })),
    )
    focus.setGeometries(
      onTop
        .filter((l) => l.path.length >= 2)
        .map((l) => ({ id: l.id, styleId: styleIdOf(l, anyFocus), paths: toLatLngs(l.path) })),
    )

    // 拥堵细线：**只画在已点开方案卡的那一段**（`jams` 为空数组就是没拉过）
    const jamGeoms: TMap.Geometry[] = []
    for (const l of legs) {
      if (!l.jams || l.jams.length === 0) continue
      l.jams.forEach((span, i) => {
        const slice = l.path.slice(span.fromIdx, span.toIdx + 1)
        if (slice.length < 2) return
        jamGeoms.push({
          id: `${l.id}__jam${i}`,
          styleId: span.level === 'jam' ? 'jam' : 'slow',
          paths: toLatLngs(slice),
        })
      })
    }
    jam.setGeometries(jamGeoms)

    /**
     * 换乘点 —— **段的起点**就是换乘站（由调用方判定，见 `RouteLeg.transferAtStart`）。
     * ★ 只认 `path[0]`：换乘发生在"上一程下车、下一程上车"的那一点上，
     *   而这里拿到的正是下一程的第一个坐标。
     */
    const xferGeoms: TMap.Geometry[] = []
    for (const l of legs) {
      const head = l.path[0]
      if (!l.transferAtStart || !head) continue
      // ⚠️ 腾讯纬度在前
      xferGeoms.push({
        id: `${l.id}__xfer`,
        styleId: 'transfer',
        position: new TMap.LatLng(head.lat, head.lng),
      })
    }
    transfers.setGeometries(xferGeoms)
  }

  /**
   * 悬停 / 点击 —— ★ **两层都要注册**。
   *
   * 选中的那条已经搬到 `focus` 层（为了压在待选之上），只往 `base` 挂监听
   * 会**漏掉它** —— 表现是"点待选有反应、点选中的那条没反应"，而日志里一句错都没有。
   * 两个层用同一套处理逻辑，所以抽成一个函数绑两次。
   */
  /** ★ 「拖地图不算点击」—— 判据的唯一出处（见 `tapGuard`），下面两个图层的 click 都用它 */
  const tap = createTapGuard(map)

  const bindEvents = (layer: TMap.MultiPolyline) => {
    // 事件名是 `hover`（见 tmap.d.ts 对照表）—— 移出时 geometry 为 null
    layer.on('hover', (evt) => {
      if (opts.onHover) opts.onHover(evt.geometry?.id ?? null)
    })
    layer.on('click', (evt) => {
      /**
       * ★ **拖地图不算点击** —— 判据的唯一出处是 `tapGuard`
       * （聚合层 / 景点层 / 区域层 / 标记层用的是同一套）。
       * ★ 加在 `id` 判断之前：拖一下地图就把某条路线选中，比"点错一条"更难受 ——
       *   因为用户根本没想点它。
       */
      if (!tap.isTap()) return
      const id = evt.geometry?.id
      if (id && opts.onSelect) opts.onSelect(id)
    })
  }
  bindEvents(base)
  bindEvents(focus)

  return {
    setLegs,
    clear() {
      legs = []
      base.setGeometries([])
      focus.setGeometries([])
      jam.setGeometries([])
      transfers.setGeometries([])
    },
    destroy() {
      legs = []
      // ★ 真的**摘掉**四层 —— `setGeometries([])` 只是清空，空图层会一直挂在地图上
      //   （地图实例跨页复用 ⇒ 每进出行程页就多挂四个）。`destroy()` 在基类 `MultiOverlay` 上。
      //   ★ `poiLayer.destroy()` 早就这么做了，这里此前漏了。
      base.destroy()
      focus.destroy()
      jam.destroy()
      transfers.destroy()
      // ★ 判据的监听也要解（捕获阶段的六个事件，见 `tapGuard`）
      tap.destroy()
    },
  }
}

/* ────────────────────────────────────────────────
 * 速度 → 拥堵等级（09 文档 6.3.1）
 * ────────────────────────────────────────────── */

/**
 * 道路速度（km/h）→ 拥堵等级。
 *
 * | 速度 | 表达 |
 * |------|------|
 * | ≥ 40 | 畅通 —— 不描色 |
 * | 20–40 | 缓行 —— 橙 |
 * | < 20 | 拥堵 —— 红 |
 *
 * ⚠️ 步行 / 骑行**永远没有拥堵** —— 这两种方式不受机动车拥堵影响。
 *    调用方不该给它们传 `jams`，这里也返回 `null` 兜底。
 */
export function jamLevelOf(mode: TravelMode, speedKmh: number): 'slow' | 'jam' | null {
  const channel = MODE_META[mode].channel
  if (channel === 'walking' || channel === 'bicycling') return null
  if (!Number.isFinite(speedKmh) || speedKmh >= 40) return null
  return speedKmh < 20 ? 'jam' : 'slow'
}
