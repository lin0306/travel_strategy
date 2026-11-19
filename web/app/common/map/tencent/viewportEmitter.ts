/**
 * 视野广播机制 —— 「用户动完地图之后，什么时候通知图层重算」。
 *
 * ## 为什么值得单独成文件
 * 这件事与"建图/卸载地图"是**两种知识**：后者是 SDK 生命周期，前者是**时序**。
 * 时序那部分（防抖多久、动画什么时候算停、什么该跳过）踩过的坑全部记在这，
 * 而建图流程一行都不关心。混在一个 460 行的文件里时，改时序的人要在一堆
 * SDK 调用里找它。
 *
 * ## 三条触发路径（唯一出口都是 `onChange`）
 * | 路径 | 谁触发 | 延迟 | 为什么 |
 * |------|--------|------|--------|
 * | 手势（缩放/拖动） | `zoom` / `center_changed` / `bounds_changed` | 停手 120ms | 每帧广播会让避让与撒点持续重算 → 明显掉帧 |
 * | 取景动画 | `fit()` 之后调 `watchSettle()` | 60ms 采样一次 | `fitBounds` **是动画**，`fit()` 返回不代表镜头到位 |
 * | 手动重刷 | 外壳发现浮层增删 | 无 | 地图没动但可用区变了 |
 *
 * ## 两个必须知道的事
 *
 * ### 1. 取景不能靠"页面自己补一次"
 * `fit()` 之后立刻读 zoom 拿到的是**动画第 0 帧**的值，于是进一个页面会算两遍
 * （先按旧缩放错铺一次，动画结束再铺一次，用户看到"闪一下"）。所以这里**采样**：
 * 每 `SETTLE_STEP_MS` 读一次视野签名，连续两次相同即认定停稳。
 * 它同时覆盖 `duration: 600`（动画）与 `duration: 0`（瞬移）两种写法 ——
 * 后者第一次采样就是终值。缺了它，`duration: 0` 只能赌"引擎会派发事件"；
 * 不派发的话页面会**永远停在上一页的档位**，且不报任何错。
 *
 * ### 2. 事件名是腾讯这边最阴的地方
 * 缩放是**光杆 `zoom`**，写成 `zoom_changed` 不会报错、只是永不触发；
 * 中心/视野变化**带下划线**（`center_changed` / `bounds_changed`）。
 * 事件注册在建图侧（`useTMap`），这里只负责"收到一记信号之后怎么办"。
 *
 * ## 日志
 * 全程走 `debugLog('手势', ...)`：**用户做了多久的手势、从哪个缩放变到哪个缩放**
 * 都打出来。跳过也要打 —— 否则用户会以为"监听没生效"，而真相是引擎把同一个
 * 视野连发了多条事件（`center_changed` 与 `bounds_changed` 经常成对）。
 */

import { debugLog } from '~/common/logic/debugLog'

import { viewSignature } from './viewport'

/**
 * 用户手势停止多久后广播一次视野变化（ms）。
 * 拖动过程中每帧广播会让避让与撒点持续重算 —— 明显掉帧。
 */
export const GESTURE_SETTLE_MS = 120

/**
 * 取景动画的采样间隔（ms）。**连续两次读到同一个视野签名 = 镜头停了**。
 * 采样两次的代价是首帧晚 60ms 更新，换来的是窗口期内的每一次判定都读终值。
 */
export const SETTLE_STEP_MS = 60

/**
 * 稳定检测的**兜底上限**（ms）：采样最多盯这么久。
 * 只有"镜头一直在动"（用户手指没松）才会走到它 —— 到点也必须广播一次，
 * 否则这一页的图层会一直停在旧缩放上（不报错，只是内容不对）。
 */
const SETTLE_MAX_MS = 3000

/** 视野变化广播载荷 —— 图层用它决定要不要重算标注避让 */
export interface ViewportChange {
  /** `fit` = 取景动画结束（由稳定检测发出），`zoom` / `move` = 用户手势 */
  kind: 'zoom' | 'move' | 'fit'
  zoom: number
  /**
   * 这次广播的**视野与上一次相同**（被签名去重命中）。
   *
   * ★ 仍然会送到 `onChange`，因为有些事**不能**被去重挡掉 ——
   *   2026-11-19：首页 `fit` 停稳时签名早已被前面的 `zoom` 广播占住，
   *   于是 `syncBoundary` 从来没执行过，整张地图**一个边界都没有**
   *   （`_tmp/probe_boundary_when.mjs` 实测 `boundary: false`），
   *   用户能一路拖到美洲。内容重算可以省，边界同步不能省。
   */
  deduped?: boolean
}

/** 手势的中文名 —— 只给控制台日志用 */
const GESTURE_CN: Record<ViewportChange['kind'], string> = {
  zoom: '缩放',
  move: '拖动/平移',
  fit: '取景',
}

export interface ViewportEmitter {
  /** 收到引擎的缩放/平移信号（`zoom` / `center_changed` / `bounds_changed`） */
  scheduleGesture(kind: 'zoom' | 'move'): void
  /** `fit()` 之后调用，开始盯镜头 */
  watchSettle(durationMs?: number): void
  /** 地图没动、但可用区变了 —— 立即广播（不过滤） */
  refreshView(): void
  /** 卸载：清掉两个定时器 */
  dispose(): void
}

export interface ViewportEmitterOptions {
  /** 现取地图实例（可能尚未创建，也可能已卸载） */
  getMap: () => TMap.Map | null
  /** 广播出口。**收口方（外壳）会把这次广播扇出给页面登记的图层** */
  onChange: (e: ViewportChange) => void
}

export function createViewportEmitter(o: ViewportEmitterOptions): ViewportEmitter {
  let gestureTimer: number | null = null
  /**
   * 当前这一段手势。`null` = 没有正在进行的手势。
   *
   * ## 为什么要记「收到过哪些事件」而不是「第一个事件」
   * 腾讯在缩放时 `zoom` 与 `center_changed`/`bounds_changed` 会**连着来**，
   * 而且实测 **`center_changed` 先到、`zoom` 后到** —— 若按"第一个事件"
   * 认定手势类型，一次纯缩放会被记成「拖动/平移」，日志直接骗人。
   * 所以这里收集整段里**实际到达过的事件种类**，结束时再定性。
   */
  let gesture: {
    at: number
    fromZoom: number
    kinds: Set<'zoom' | 'move'>
  } | null = null

  /** 上一次**自动**广播的视野签名。手动 `refreshView()` 不过滤 */
  let lastAutoSig = ''

  /** 取景稳定检测的状态 */
  let settleTimer: number | null = null
  let settleSig = ''
  let settleStable = 0

  function emit(kind: ViewportChange['kind'], dedupe: boolean): void {
    const map = o.getMap()
    if (!map) return
    if (dedupe) {
      const sig = viewSignature(map)
      if (sig === lastAutoSig) {
        // ★ 跳过也要**说出来**：否则用户会以为"监听没生效"。
        //   真相是引擎把同一个视野连发了多条事件 —— 去重挡的是噪音，不是用户操作。
        if (kind === 'fit') {
          debugLog('手势', '取景动画停稳，但视野签名同上 → 跳过重算（引擎重复事件）')
          // ★ 但**不能整条丢掉**：边界同步就挂在这条路上（见 `deduped` 的注释）。
          o.onChange({ kind, zoom: map.getZoom(), deduped: true })
        }
        return
      }
      lastAutoSig = sig
    }
    if (kind === 'fit') debugLog('手势', `取景动画停稳  z=${map.getZoom().toFixed(2)}`)
    o.onChange({ kind, zoom: map.getZoom() })
  }

  function stopGesture(): void {
    if (gestureTimer !== null) {
      window.clearTimeout(gestureTimer)
      gestureTimer = null
    }
  }

  function stopSettle(): void {
    if (settleTimer !== null) {
      window.clearTimeout(settleTimer)
      settleTimer = null
    }
    settleSig = ''
    settleStable = 0
  }

  function scheduleGesture(kind: 'zoom' | 'move'): void {
    // ★ 一段手势的起点 —— 定时器还没挂上就说明这是新手势
    if (gesture === null) {
      const z = o.getMap()?.getZoom() ?? 0
      gesture = { at: Date.now(), fromZoom: z, kinds: new Set() }
      debugLog('手势', `开始  z=${z.toFixed(2)}`)
    }
    // 整段里到过的事件种类都收下 —— 结束时才能说准"用户到底做了什么"
    gesture.kinds.add(kind)

    stopGesture()
    gestureTimer = window.setTimeout(() => {
      gestureTimer = null
      const started = gesture
      gesture = null

      if (started) {
        const to = o.getMap()?.getZoom() ?? started.fromZoom
        const kinds = [...started.kinds]
        // 两种事件都到过 = 缩放带动了视野，如实写「缩放+平移」，
        // 不假装能分清用户是先拖还是先滚
        const label = kinds.length > 1 ? '缩放+平移' : GESTURE_CN[kinds[0] ?? 'move']
        debugLog(
          '手势',
          `结束（${label}）  耗时 ${Date.now() - started.at}ms  ` +
            `z=${started.fromZoom.toFixed(2)} → ${to.toFixed(2)}`,
        )
      }

      // 结束日志放在广播**之前**：这样控制台里的顺序就是
      // 「我做了什么 → 屏幕上变成了什么」，与实际因果一致
      emit(kind, true)
    }, GESTURE_SETTLE_MS)
  }

  /**
   * 盯住一次**动画取景**，停稳后广播一次（`kind: 'fit'`）。
   *
   * @param durationMs 这一段动画本身有多久（`FLY_DURATION_MS[reason]`）。
   *   ★ **必须传**：只靠"连续两次采样相同"判停稳会被**启动延迟**骗过去 ——
   *   2026-11-19 手机端就是这个坑：`focusPoint` 发起 600ms 动画后立刻采样，
   *   头两次（0ms / 60ms）读到的都还是**动画开始前**的视野 ⇒ 判"已停稳" ⇒
   *   广播一次（签名与上次相同被去重）⇒ 停止采样。之后镜头飞到新位置，
   *   但**再也没有人广播** —— 于是"点省徽标会放大、但徽标不换级"，
   *   手机上一整张图停在省徽标，而且不报任何错。
   */
  function watchSettle(durationMs = 0): void {
    stopSettle()
    const startedAt = Date.now()
    /** 动画到底**动过没有** —— 没有"动过"就不能用"两次采样相同"判停稳（理由见 @param） */
    let seenMove = false
    let firstSig = ''

    const step = (): void => {
      const map = o.getMap()
      if (!map) return
      const sig = viewSignature(map)

      if (firstSig === '') firstSig = sig
      else if (sig !== firstSig) seenMove = true

      if (sig === settleSig) settleStable += 1
      else {
        settleSig = sig
        settleStable = 0
      }

      // 停稳的两个充分条件（满足任一即可收口）：
      //   ① 确实动过，且连续两次采样相同 —— 动画已经结束
      //   ② 等过了「动画时长 + 余量」还没动过 —— 说明这次取景本来就没位移
      const waitedEnough = Date.now() - startedAt >= durationMs + SETTLE_STEP_MS + 120
      if (settleStable >= 1 && (seenMove || waitedEnough)) {
        stopSettle()
        emit('fit', true)
        return
      }
      // 兜底：用户在这期间一直操作（镜头持续在动）也要收口，不能无限采样
      if (Date.now() - startedAt > SETTLE_MAX_MS) {
        stopSettle()
        emit('fit', true)
        return
      }
      settleTimer = window.setTimeout(step, SETTLE_STEP_MS)
    }
    step()
  }

  function refreshView(): void {
    // 这条与手势不同：**地图根本没动**，是浮层/数据变了要求重算。日志里必须区分，
    // 否则读日志时会以为用户操作了一下
    debugLog('手势', '手动重刷（地图未动，浮层或数据变了）')
    emit('move', false)
  }

  function dispose(): void {
    stopGesture()
    stopSettle()
    gesture = null
  }

  return { scheduleGesture, watchSettle, refreshView, dispose }
}
