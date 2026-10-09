/**
 * 聚合层 —— 密集处的一个**数字气泡**（腾讯 `MarkerCluster` 的封装）。
 *
 * ## 为什么和 `poiLayer` 分成两个文件
 * 因为两件事的**失败方式完全不同**：
 * · `poiLayer` 管"这一屏有哪些点"（档位准入 + 选中项 + 名字）；
 * · 本文件管"这些点怎么变成一个气泡"。
 * 准入错了 → 该有的点没有；聚合接线错了 → 点了没反应 / 数字不对 / 名字挂错。
 * 判据也分得开：准入归 T 项，聚合接线归 Z 项。
 *
 * ## 三条来自 SDK 真源码的约束（都验证过，别照文档写）
 * 1. **默认样式是唯一的渲染路径**（`enableDefaultStyle: false` 时 `_repaint` 整个不渲染）。
 *    代价：`count === 1` 的**单个点也用 SDK 自带的水滴**，且传进去的 `styleId`
 *    会被就地改写成 `'default'`（`_checkGeometries` 只收到 geometries、没有 styles 表）。
 * 2. **点击载荷里只有 `evt.cluster`**（单点也是"长度 1 的簇"），`evt.geometry` 永远 undefined。
 * 3. **`zoomOnClick` 做的是 `fitBounds(簇的 bounds)`**（簇心向外扩 `gridSize`）
 *    → 一次跳 3~4 级，**连单点也会跳**。所以传 `false`，分派写在 `onClick` 里。
 *    ★ 关掉它**不影响 `click` 事件**（源码里两条语句并列，缩放那句带开关、emit 那句不带）。
 *
 * ## 聚类是异步的（本文件最容易踩的地方）
 * 实测（`_tmp/cdp_settle_probe.mjs` / `cdp_agg_verify.mjs`，2026-09-22）：
 * · `setGeometries()` 会**同步清空** `clusters`（`_resetViewport()` 里 `this.clusters = []`），
 *   紧接着读 `getClusters()` 恒为 0，worker **60ms 内**出结果；
 * · **SDK 自己也会重聚类** —— 视野一变它就 `_resetViewport()` + `_redraw()`，
 *   于是 `cluster_changed` 会来**不是我们那次**的（实测：那时我们的 `repaint` 还没跑，
 *   日志会把旧缩放的簇数记到新缩放上，然后被去重规则吃掉）；
 * · 反过来，我们 `setGeometries()` 之后**又一次清空**，此刻若恰好结算，就会读到 0；
 * · 而"什么时候出结果"**不能靠猜时长**：独立小实验里 60ms 就出，但在真实城市页
 *   （整屏瓦片正在加载、worker 排队）实测**超过 300ms 还没出** —— 于是按固定时长
 *   结算会稳定地记下 0 个簇，而屏幕上明明有气泡（踩过一次：日志里 z≥12 全是"簇 0"）。
 *
 * ⇒ 所以"结算"的判据是**"我们发出去的那批点已经有结果了"**，靠 `trySettle()` 轮询等待，
 *   而不是靠一个估计出来的时长。见那里的三道条件。
 */

import { createTapGuard } from './tapGuard'
import { Z_LAYER } from './zLayers'
import { POI_CLUSTER_MAX_ZOOM } from './zoomTiers'

/**
 * 聚合层需要的最小点位形状 —— **只要 id 与坐标**。
 * 写成最小契约是为了不和 `PoiPoint` 互相 import（会构成循环依赖）。
 */
export interface PoiDot {
  id: string
  lng: number
  lat: number
}

/**
 * 两点**屏幕像素距离**小于它就并成一个气泡。
 *
 * ★ "两个点多近算一个"的**唯一**出处。曾经另有一个 `DOT_MIN_GAP_PX = 18`
 *   （圆点之间的最小间距，配合抽稀与像素去重），那套做法已随 `dotBudget.ts` 删除 ——
 *   两套数字并存的结局是"有时候看着对、有时候不对"，而没人说得清哪一套在生效。
 */
const CLUSTER_GRID_PX = 60

/** 形成气泡的最小点数 —— 一个点不该变成气泡 */
const CLUSTER_MIN_POINTS = 2

/** 轮询间隔 —— 结果没出来就又看一次（`getClusters()` 只是读一个数组，代价可忽略） */
const CLUSTER_POLL_MS = 40


/**
 * 簇心离指针超过这么多像素，就认为**这条点击载荷不是用户点中的那一个**。
 *
 * ## 为什么需要它（实测，2026-09-23）
 * 一次点击会收到**多条** `click` 载荷。探针 `_tmp/cdp_payload.mjs`：点成都市区里
 * 一枚**单点**图标，`emit('click')` 来了两条 ——
 *   ① `['gangguanchang-xiaojungan']`（就是点到的那枚）
 *   ② `['jianshelu-snack-street','mingting-restaurant']` —— 一个中心在 **3.4km 之外、
 *      屏幕坐标差约 95px** 的 2 成员气泡。
 * 而 `_tmp/cdp_dom_events.mjs` 证明 **DOM 事件只给了那枚单点的 `<img>`**
 * （mousedown / mouseup / click 三个事件的 target 全是它）。
 * ⇒ SDK 的 finger 判定在这里不可信：**"点的是哪一个"必须我们自己裁。**
 * 不裁的后果就是用户报的「点景点怎么缩放地图了」—— 单点被选中（开详情）的**同时**，
 * 那个远在天边的气泡还把镜头推走了。
 *
 * ## 32 是怎么来的
 * · 气泡：盒子 40×40（SDK 的 `Gd`）且以簇心为中心 → 点在盒角时离簇心最远
 *   `20√2 ≈ 28.3`；
 * · 单点：图标盒 24×24 且**针尖在坐标上**（中心在点位上方 12px）→ 最远约 `12√2 ≈ 17`。
 * 取 32 两者都容得下，而实测那条误报在 95px —— 一刀切干净。
 */
const CLUSTER_CLICK_SLOP_PX = 32


/**
 * 最多等多久。★ 不能取"实测时长 × 常数"：独立小实验 60ms 出结果，
 * 而真实城市页在整屏瓦片加载时**300ms 都还没出**（worker 排队）——
 * 按固定时长结算会稳定地记下 0 个簇。所以这里是**上限**，不是预期值；
 * 正常情况由 `cluster_changed` 立刻叫醒（见 `trySettle`）。
 */
const CLUSTER_MAX_WAIT_MS = 2000

export interface PoiClusterOptions {
  /** 点到**独立点**（簇里只有它一个）时回调。气泡不走这里 —— 点气泡是放大 */
  onSelectPoi: (poiId: string) => void
  /**
   * 聚合结果**落地后**回调一次（见文件头"聚类是异步的"）。
   * 名字层与诊断日志都挂在这里：提前读只会读到 0。
   */
  onSettled: () => void
  /** 有任何覆盖物被点到 —— 调用方用它推"抑制窗"（见 `poiLayer` 的注释） */
  onOverlayClick: () => void
}

export interface PoiClusterHandle {
  /** 把这一屏的点交给聚合器。**全量**，不要再自己按视野筛（它自己只算 `mapBounds` 内的） */
  setDots(dots: readonly PoiDot[], excludeId: string | null): void
  /** 屏幕上实际的簇数 / 其中多成员簇数 —— 从**图层自己**读回，不拿我们的意图冒充 */
  counts(): { clusters: number; bubbles: number }
  /** 没被聚合的**独立点** id 集合 —— 名字层只给它们挂名字 */
  singleIds(): Set<string>
  destroy(): void
}

export function createPoiCluster(map: TMap.Map, opts: PoiClusterOptions): PoiClusterHandle {
  const cluster = new TMap.MarkerCluster({
    id: 'poi-cluster',
    map,
    geometries: [],
    gridSize: CLUSTER_GRID_PX,
    minimumClusterSize: CLUSTER_MIN_POINTS,
    // 实测标定过 16（不是 15），那张表在 `zoomTiers.POI_CLUSTER_MAX_ZOOM` 的注释里
    maxZoom: POI_CLUSTER_MAX_ZOOM,
    // ★ 关掉它，分派自己写在 `onClick` 里（理由见文件头第 3 条）
    zoomOnClick: false,
    zIndex: Z_LAYER.poiDot,
  })

  let settleTimer: ReturnType<typeof setTimeout> | null = null
  /** 我们发出去的那批点是否**还等着**结果（`false` = 此刻不该结算） */
  let waiting = false
  /** 我们发出去的点数（`0` = 这一屏本来就不该有点，不必等） */
  let sentCount = 0
  /** 本次等待的截止时刻（上限，不是预期） */
  let deadline = 0
  /**
   * **上一次落地**的独立点集合 —— 只在 `getClusters()` 已被清空、而我们正等新答案时顶上。
   *
   * ★ 实测（`_tmp/cdp_label_stale.mjs`）：`setGeometries()` 会**同步清空**
   *   `getClusters()`，而 `poiLayer.repaint()` 里紧跟其后的 `repaintSingles()` /
   *   `repaintLabels()` 正是读它 —— 于是我们自己画的那批点和名字会**整批消失**
   *   直到 worker 回话（实测 2ms ~ **146ms**，肉眼就是一下闪白）。
   *   用它顶上，等到落地再换成真答案（一个点都不会丢，只是把上一帧多留一拍）。
   */
  let lastSingles = new Set<string>()

  /**
   * 上一次交给聚合器的**点集签名**（`excludeId` + 每点的 id 与坐标）。
   *
   * ★ 与它相同 ⇒ **不再 `setGeometries`**，理由见 `setDots` 里那段。这个短路是本文件
   *   最值钱的一行：它把"每次拖拽都重建全部点位 + 重跑一次聚类"变成"什么都不做"。
   */
  let lastSentSig: string | null = null

  /**
   * 「这次是不是一次**点击**（而不是拖地图）」+「指针按在哪」——
   * 两者一起收在 `createTapGuard` 里（**唯一出处**，`poiClicks` 用的是同一套）。
   *
   * ★ 为什么必须放一起：它们是**两个正交的判据**（"算不算点击" / "点的是哪一个"），
   *   但都依赖"按下那一刻的指针"与"按下之后移动了多少"。各写一份必然会漂移 ——
   *   一个调了阈值、另一个没调，而这种错不报错，只表现为"偶尔点不准"。
   */
  const tap = createTapGuard(map)
  /** 本次按下是否已经触发过动作（一次按下只做一个动作） */
  let acted = false

  /** 簇心离指针多远（屏幕像素）。拿不到投影/指针时返回 0 = **不裁** */
  function pointerDistance(center: TMap.LatLng | undefined): number {
    const pt = tap.pointer()
    if (!pt || !center || !map.projectToContainer) return 0
    const q = map.projectToContainer(center)
    return Math.hypot(q.getX() - pt.x, q.getY() - pt.y)
  }

  function stopWait() {
    if (settleTimer) {
      clearTimeout(settleTimer)
      settleTimer = null
    }
  }

  /**
   * 结算 —— 三道条件缺一不可（理由见文件头"聚类是异步的"）：
   * ① `waiting`：**只有我们那次**才结算。SDK 视野变化自己也会重聚类并派发事件，
   *    那时我们的 `repaint` 还没跑，照它结算就会把旧缩放的簇数记到新缩放上
   *    （实测被日志的去重规则吃掉，表现得像"这一档没有记录"）；
   * ② 真拿到结果（`getClusters()` 非空）：我们 `setGeometries()` 会**同步清空**它，
   *    不检查的话一个"上一次留下的"事件就能让我们读到 0；
   * ③ 真没有点（`sentCount === 0`）或**等到上限**：那是事实上的空（点全在视野外），
   *    不能无限等。
   *
   * 不满足就**继续轮询** —— 因为"多久出结果"取决于 worker 排在哪：
   * 独立小实验 60ms，真实城市页（瓦片正在加载）实测 300ms 都还没出。
   */
  function trySettle() {
    if (!waiting) return
    const landed = cluster.getClusters().length > 0
    if (landed || sentCount === 0 || performance.now() >= deadline) {
      stopWait()
      waiting = false
      opts.onSettled()
      return
    }
    stopWait()
    settleTimer = setTimeout(trySettle, CLUSTER_POLL_MS)
  }

  /** 点到覆盖物：气泡 → 放大（用户要的"点开再放大"）；独立点 → 交给调用方开详情 */
  function onClick(evt: TMap.ClusterEvent) {
    const c = evt.cluster
    if (!c) return
    /**
     * ⓪ **先判"这是不是一次点击"**（在判"点的是哪一个"之前）。
     *   拖动地图也会走到这里（起点压在聚合点上），必须挡在最前面 ——
     *   用户 2026-10-05 报的正是「一拖地图，聚合点就被选中了」。
     *   ⚠️ 这条与下面的 `pointerDistance` 是**两个正交的判据**，
     *      谁都不能替代谁：一个管"算不算点击"，一个管"点的是哪一个"。
     */
    if (!tap.isTap()) return
    // ① **不是用户点中的那一个**就丢弃（一次点击会收到多条载荷，理由见
    //    `CLUSTER_CLICK_SLOP_PX`）。拿不到投影时 `pointerDistance` 返回 0 → 不裁，
    //    退化成旧行为（宁可偶尔多推一次镜头，也不要整个点不动）
    if (pointerDistance(c.center) > CLUSTER_CLICK_SLOP_PX) return
    // ② 一次按下**只做一个动作**：两个覆盖物叠在一起时，不要"又选中又缩放"
    if (acted) return
    acted = true
    // ③ 先告诉调用方推抑制窗：这一下也会让地图派发 click，不隔开就会当成"点空白"
    opts.onOverlayClick()
    if (c.geometries.length > 1) {
      cluster.zoomInCluster(c)
      return
    }
    const id = c.geometries[0]?.properties?.id
    if (typeof id === 'string') opts.onSelectPoi(id)
  }

  cluster.on('click', onClick)
  cluster.on('cluster_changed', trySettle)

  return {
    setDots(dots, excludeId) {
      const sent = dots.filter((p) => p.id !== excludeId)
      /**
       * ★★ 点集没变 ⇒ **不要再 `setGeometries`**（2026-10-02 · 用户：
       *   「像区和景点的点位，拖拽时如果渲染过了就不需要再重复计算了吧，
       *     现在放大到一定比例，拖拽的时候会卡一下」）。
       *
       * `setGeometries()` 会**同步清空** `getClusters()`（`_resetViewport()`）并触发
       * 一次 worker 重聚类 —— 那一拍里 `singleIds()` 是空的，靠 `lastSingles` 顶替，
       * 实测空窗 2ms~300ms，肉眼就是"拖一下卡一下"。
       *
       * 而**视野变化时 SDK 自己会重聚类**（文件头那条：`_resetViewport()` + `_redraw()`，
       * 并派发 `cluster_changed`）⇒ 点集没变时我们**什么都不用做**，只要等它派发。
       *
       * ⚠️ 签名必须含**坐标**：同一批 id 但坐标更新（数据重载 / 改点）时仍要重设几何。
       * ⚠️ 已经有一轮在等时**不重置 `deadline`** —— 否则每帧都续期，永远等不到结算。
       */
      const sig = `${excludeId ?? ''}|${sent.map((p) => `${p.id}:${p.lng},${p.lat}`).join(',')}`
      if (sig === lastSentSig) {
        if (!waiting) {
          waiting = true
          sentCount = sent.length
          deadline = performance.now() + CLUSTER_MAX_WAIT_MS
        }
        trySettle()
        return
      }
      lastSentSig = sig

      cluster.setGeometries(
        // `properties` 只放 id：名字/热度从调用方现取，避免两处各存一份
        sent.map((p) => ({ position: new TMap.LatLng(p.lat, p.lng), properties: { id: p.id } })),
      )
      sentCount = sent.length
      waiting = true
      deadline = performance.now() + CLUSTER_MAX_WAIT_MS
      trySettle() // 先立刻看一次；没结果就自己排下一轮轮询
    },
    counts() {
      const list = cluster.getClusters()
      let bubbles = 0
      for (const c of list) if (c.geometries.length > 1) bubbles += 1
      return { clusters: list.length, bubbles }
    },
    singleIds() {
      const list = cluster.getClusters()
      // ★ 刚 `setGeometries()` 过、worker 还没回话时这个数组是**空的**
      //   （`_resetViewport()` 里同步清空）—— 这一刻交出**上一次落地**的答案，
      //   否则点和名字会整批消失一拍（理由见 `lastSingles`；实测空窗最长 146ms）。
      //   ⚠️ 只有 `waiting`（确实在等新答案）时才顶：`sentCount === 0` 那一路会
      //     立刻结算，那时必须交出**真空集**，不然上一屏的点会赖在屏幕上不走。
      if (list.length === 0 && waiting) return lastSingles
      const out = new Set<string>()
      for (const c of list) {
        if (c.geometries.length !== 1) continue // 进气泡的点不许冒出来
        const id = c.geometries[0]?.properties?.id
        if (typeof id === 'string') out.add(id)
      }
      lastSingles = out
      return out
    },
    destroy() {
      stopWait()
      // 指针监听是 `tapGuard` 自己挂的，必须自己摘（捕获阶段的监听不会随图层销毁而走）
      tap.destroy()
      // 它的 click / cluster_changed 监听随 destroy 一起注销
      // （SDK 的 `onDestroy` 里会 `removeAllListeners`）
      cluster.destroy()
    },
  }
}
