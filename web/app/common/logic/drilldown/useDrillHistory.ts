/**
 * 下钻的浏览器历史与手势。
 *
 * ## ★ 最容易漏的一处（10 文档 2.4 特意标注）
 * **「恢复上一级视野」不是自动的。** 浏览器后退只恢复 URL ——
 * 地图实例是同一个、视野停在下钻前的状态。漏了这步，用户后退会看到
 * 「URL 变了但地图没动」，像是坏了。
 *
 * 做法：**离开某一级之前**，把当前视野写进**当前那条历史记录**的 state；
 * `popstate` 时读回来重新 `fitBounds`。
 *
 * 为什么是 `replaceState` 而不是 `pushState`：我们要改的是"当前这一格"，
 * 导航本身由 React Router 负责 push。用 pushState 会凭空多出一格历史。
 */

import { useCallback, useEffect, useRef } from 'react'

export interface MapViewState {
  lng: number
  lat: number
  zoom: number
}

export interface DrillHistoryState {
  /** 该历史记录对应的层级键，便于调试与断言：`'nation'` / `'province:510000'` / `'city:chengdu'` */
  drillKey?: string
  /** 该层的视野。没有它就无法恢复 */
  view?: MapViewState
}

export interface UseDrillHistoryOptions {
  /** 读当前地图视野。地图没就绪时返 null，此时不做保存 */
  getView: () => MapViewState | null
  /** 恢复视野。注意要跳过动画（`immediately`）—— 后退时再来一段 600ms 飞行会很晕 */
  applyView: (view: MapViewState) => void
  /** 当前层级键，用于写进 state */
  drillKey: string
}

export interface UseDrillHistoryResult {
  /** 在跳转到下一级**之前**调用 */
  saveCurrentView: () => void
  /** 手动返回上一级（ESC / 顶栏"回上一级"入口用） */
  goBack: () => void
}

export function useDrillHistory(opts: UseDrillHistoryOptions): UseDrillHistoryResult {
  const { getView, applyView, drillKey } = opts

  // 用 ref 存最新回调，避免每次 render 都重新绑定 popstate（会漏掉、也会重复触发）
  const getViewRef = useRef(getView)
  const applyViewRef = useRef(applyView)
  const drillKeyRef = useRef(drillKey)
  getViewRef.current = getView
  applyViewRef.current = applyView
  drillKeyRef.current = drillKey

  /** 把当前视野写进**当前**这条历史记录 */
  const saveCurrentView = useCallback(() => {
    if (typeof window === 'undefined') return
    const view = getViewRef.current()
    if (!view) return
    const next: DrillHistoryState = { ...(window.history.state ?? {}), drillKey: drillKeyRef.current, view }
    window.history.replaceState(next, '')
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const onPop = (e: PopStateEvent) => {
      const st = e.state as DrillHistoryState | null
      // 没有 view 说明是进入更深一层（新记录还没写过视野）→ 不动视野，由路由的 fitBounds 负责
      if (st?.view) applyViewRef.current(st.view)
    }

    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const goBack = useCallback(() => {
    if (typeof window === 'undefined') return
    window.history.back()
  }, [])

  return { saveCurrentView, goBack }
}

/**
 * 桌面端：ESC 返回上一级（10 文档 2.4）。
 * 在输入框里按 ESC 不该触发返回 —— 输入框自己要用 ESC 做"清空/失焦"。
 */
export function useEscapeToGoBack(onBack: () => void, enabled = true): void {
  const cbRef = useRef(onBack)
  cbRef.current = onBack

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return
      cbRef.current()
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}

/**
 * 移动端：从**屏幕左边缘 20px 内**起始的右滑才触发返回（10 文档第八节）。
 *
 * ⚠️ 这里有本项目唯一真实的移动端手势冲突：右滑返回 vs 地图拖动。
 * 判定规则是移动端的通用约定（iOS 原生也是这样）——
 * **地图区域内的横滑归地图**，只有边缘起手的才归返回。
 */
export function useEdgeSwipeBack(onBack: () => void, enabled = true): void {
  const cbRef = useRef(onBack)
  cbRef.current = onBack

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return

    const EDGE = 20 // 起手区宽度（px）
    const MIN_DX = 60 // 至少要滑这么远才算返回
    const MAX_DY = 60 // 垂直位移超过就认为用户在滚列表，不是返回

    let startX = 0
    let startY = 0
    let tracking = false

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0]
      if (!t) return
      tracking = t.clientX <= EDGE
      startX = t.clientX
      startY = t.clientY
    }

    const onEnd = (e: TouchEvent) => {
      if (!tracking) return
      tracking = false
      const t = e.changedTouches[0]
      if (!t) return
      const dx = t.clientX - startX
      const dy = Math.abs(t.clientY - startY)
      if (dx >= MIN_DX && dy <= MAX_DY) cbRef.current()
    }

    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchend', onEnd)
    }
  }, [enabled])
}
