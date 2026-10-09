/**
 * 点到**景点**时的动作语义：选中一枚 · 双击不放大 · 点空白收起。
 *
 * ## 为什么单独成文件
 * 这三件事全是**时序知识**（谁先到、双击窗口多长、SDK 内部 handler 何时装卸），
 * 与"这一屏该画什么"（`poiLayer`）是两种知识 —— 而它们与 `poiLayer` 的耦合只有两个回调。
 * 混在一起时 `poiLayer` 已经 400+ 行（G 项上限 420），改时序的人得在一堆图层代码里找它。
 *
 * ## 三条来自实测的时序事实
 * 1. **腾讯 GL 不吞事件**：点中覆盖物时它自己的 `click` 会派发，而**地图的 `click` 也跟着
 *    派发**（与 DOM 冒泡无关，是 SDK 自己两处都发），两条回调的先后顺序**也不保证**。
 *    于是"点景点"的下一瞬间就可能被判成"点了空白"，把刚打开的详情自己关掉。
 *    用一个**时间窗**隔开 —— 它对顺序不敏感，这是"点空白收起"能成立的前提。
 *    反证做过：把窗口改成 0，详情直接打不开。
 * 2. **一次双击 = 按下/抬起/click ×2，最后才是 `dblclick`**。地图的双击放大是 SDK 挂在
 *    `dblclick` 上的内部 handler（Leaflet 那一套），所以在**第一下 click** 里把它卸掉还来得及。
 * 3. **两次 click 会到两次**：第一下选中、第二下又把它切掉 —— 用户看到的是"双击之后详情自己关了"。
 *    所以双击窗口内**同一个 id 只当一个动作**。
 *
 * ## 只卸"景点"这一种情况（用户明确要求）
 * 用户原话：「正常双击地图不是会放大吗，现在双击点和标签，也会触发地图放大，这两个能不能
 * 不放大地图，**景点，不包括区域和那个聚合点**」。
 * ⇒ 这里是**临时**卸掉（`map.setDoubleClickZoom(false)`），不是建图时把整张图关掉：
 * 双击空白 / 徽标 / 数字气泡**仍然放大**（走的是各自的 click，不经这里），
 * 而且下一次"没点到景点的地图 click"就把 handler 装回去。
 *
 * ★ 卸掉之后**必须装回来**，而且图层销毁时也要装回 —— 地图实例是**跨页面复用**的，
 *   漏了就是"从这一页之后，双击再也放不大"，且不报任何错。
 */

/** 「点中覆盖物 → 地图 click 也跟着来」的抑制窗（ms）。见文件头第 1 条 */
import { createTapGuard } from './tapGuard'

export const MAP_CLICK_SUPPRESS_MS = 300

/**
 * 多近算一次双击（ms）—— 同一枚景点在这段时间内被点第二下，只当一个动作。
 *
 * 取 400：比浏览器的双击判定（Chrome 默认约 500）紧一点，足够盖住双击的两下；
 * 而"想点两次来收起"的人间隔通常远大于它（`cdp_gap_dblclick.mjs` 用 800ms 验）。
 */
const POI_DBLCLICK_MS = 400

export interface PoiClicksOptions {
  map: TMap.Map
  /** 真正"选中一枚景点"（桌面浮卡 / 移动端弹层由调用方决定） */
  onSelect: (poiId: string) => void
  /**
   * 点到**地图空白**（没命中任何点位）时回调，页面用它收起详情。
   *
   * ★ 这个判定只能在这里做：页面拿到的是一次朴素的地图 click，
   *   分不出"点了点位"和"点了空地"（理由见文件头第 1 条）。
   */
  onBlank: () => void
}

export interface PoiClicksHandle {
  /**
   * 图层派发的"**点到一枚景点**"（圆点层与名字层都走它）。
   * 返回 `false` = 这一下是双击的后半下，调用方**不要**再当一次独立动作。
   */
  poi(poiId: string): boolean
  /** **气泡**被点到 —— 也算"这一下不是点空白"（但要能双击放大，所以不卸 handler） */
  overlay(): void
  destroy(): void
}

export function createPoiClicks(o: PoiClicksOptions): PoiClicksHandle {
  /** 「刚刚点中过覆盖物」的抑制窗终点（`performance.now()` 口径） */
  let suppressUntil = 0
  /** 最近一次"点到景点"的时刻 / 是哪一枚 —— 双击窗口与"装回双击放大"都看它 */
  let poiAt = 0
  let poiId = ''
  /** 双击放大此刻是否被我们卸掉了 */
  let dblZoomOff = false

  /**
   * 卸掉地图的双击放大 —— 用户双击**景点**时不该动镜头。
   *
   * 只在状态真的变了时调 SDK：`setDoubleClickZoom` 会动它内部的 handler 表，
   * 每次点击都调是白开销。`?.` 是防御 —— SDK 若没有这个方法，退化成"双击仍然放大"
   * （旧行为），而不是抛错把整条点击链断掉。
   */
  function turnOffDblZoom() {
    if (dblZoomOff) return
    dblZoomOff = true
    o.map.setDoubleClickZoom?.(false)
  }

  /** 装回地图的双击放大 —— 空白 / 徽标 / 气泡都要能双击放大，图层销毁时也必须还回去 */
  function turnOnDblZoom() {
    if (!dblZoomOff) return
    dblZoomOff = false
    o.map.setDoubleClickZoom?.(true)
  }

  /**
   * 地图自己的 click。
   *   · 不在"点景点"那一串里 → 说明这一下**没点到景点** → 把双击放大装回去；
   *   · 在抑制窗内 → 是同一次交互的余波，**不当作点空白**。
   */
  /**
   * ★★ **拖动地图不算点击** —— 否则拖完一下就把详情收了，而用户根本没点空白。
   *   用户 2026-10-05 报的"拖动时被选中"是同一件事的两个面：
   *   聚合点那边是**误选中**、这里是**误收起**。
   *   判据与聚合层**同源**（`createTapGuard`）—— 阈值只在一处定义，不会各自漂移。
   */
  const tap = createTapGuard(o.map)

  const onMapClick: TMap.EventHandler = () => {
    // ⚠️ 放在最前：`turnOnDblZoom` 那步也该跳过（拖动不是一次点击，没理由改双击缩放）
    if (!tap.isTap()) return
    const now = performance.now()
    if (now - poiAt > POI_DBLCLICK_MS) turnOnDblZoom()
    if (now < suppressUntil) return
    o.onBlank()
  }
  o.map.on('click', onMapClick)

  return {
    poi(id) {
      const now = performance.now()
      // ★ 双击的后半下：只续期窗口，**不再当一次动作**（否则"选中 ⇄ 取消"会自己抵消，
      //   用户看到的是"双击之后详情自己关了"）
      const second = id === poiId && now - poiAt < POI_DBLCLICK_MS
      poiAt = now
      poiId = id
      if (!second) suppressUntil = now + MAP_CLICK_SUPPRESS_MS
      // 双击放大必须在**第一下 click** 里卸掉：`dblclick` 紧跟其后，来不及就晚了
      turnOffDblZoom()
      return !second
    },
    overlay() {
      const now = performance.now()
      poiAt = now
      suppressUntil = now + MAP_CLICK_SUPPRESS_MS
      // 气泡**不卸**双击放大（用户："不包括那个聚合点"）
    },
    destroy() {
      tap.destroy()
      // ★ 腾讯的 `on()` 返回实例、不是取消函数 → 必须用同一个引用 `off()`
      o.map.off('click', onMapClick)
      // ★ 也要装回去：地图实例跨页面复用，留着就是把后面的页面一起废掉
      turnOnDblZoom()
    },
  }
}
