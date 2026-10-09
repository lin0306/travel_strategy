/**
 * 「进这一页就把镜头放好」—— 四个页面共用的一条纪律。
 *
 * ## 为什么必须收成一个钩子（2026-09-20 全量修复）
 * 修复前四个页面各写一遍取景 effect，而且是**四种写法**：
 * | 页面 | 记账 | 依赖数组 |
 * |------|------|---------|
 * | `home.tsx` | 有 `fittedRef` | `[rows, isMobile, shell]` |
 * | `province.tsx` / `city.tsx` / `poi.tsx` | **没有** | `[detail, shell]` / `[city, shell]` / `[poi, shell]` |
 *
 * 后面那三个的 `shell` 是个**每次地图上下文变化就会换新的对象** ——
 * 用户换一次底图、开关一次浮层、地图从 loading 变 ready，`shell` 都是新的 →
 * effect 重跑 → **镜头被强行拉回全城**，用户正在看的那个点位被甩出屏幕。
 * 而且它不报任何错，表现只是"我看了半天的地方，一下子没了"。
 *
 * 所以记账这一步必须收成一处分：**key 相同就不再取景**，与 `shell` 换不换对象无关。
 *
 * ## 为什么 `ready` 要单独拿出来
 * "地图还没建好"与"这一页已经取过景"是**两件事**：
 *   · 前者要**重试**（`fit()` 在地图未就绪时返回 false）；
 *   · 后者要**拦住**。
 * 混在一个依赖里就会出现"要么重复取景、要么永远不取景"二选一。
 *
 * ## 用法
 * ```tsx
 * useFitOnce(detail ? `${adcode}|${isMobile ? 'm' : 'd'}` : null, shell.status === 'ready', () =>
 *   shell.fit(pts, { reason: 'drill' }),
 * )
 * ```
 * ★ 取景之后**不要**再调 `shell.refreshView()`。取景是动画，补调读到的是
 *   动画第 0 帧（`useTMap` 的稳定检测会在动画结束后自己广播一次）。
 */

import { useEffect, useRef } from 'react'

import { restoredViewFor } from '~/common/data/uiState'

/**
 * @param key 取景的**身份**：换了它就该重新取景（换省市 / 换端）。`null` = 数据还没到，先不取。
 * @param ready 地图可用。`false` 时不取景也不记账，等它变 `true` 再试。
 * @param run 真正取景。返回 `false` = 这次没取成（会留待下一次重试）
 */
export function useFitOnce(key: string | null, ready: boolean, run: () => boolean): void {
  /** 上一次**取景成功**的 key。空串 = 还没成功过 */
  const fittedRef = useRef('')
  /** 每次渲染刷新：`run` 是页面内联箭头函数，进依赖会让 effect 每次渲染都跑 */
  const runRef = useRef(run)
  runRef.current = run

  useEffect(() => {
    if (key === null || !ready) return
    if (fittedRef.current === key) return
    /**
     * ★★ **「视野恢复」优先于「入口取景」**（2026-09-29）
     *
     * > 用户：「我不管怎么弄，打开什么东西，我只要刷新页面，就又回到了最开始打开时的样子」
     *
     * 刷新时镜头已经由会话状态摆好了（外壳建图时就用存下的中心/缩放），
     * 这时再跑一次入口取景 = 把用户刚回到的位置又推走 —— 那正是"刷新就回到初始"。
     *
     * ★ 判据不是"时间窗"，而是**这条路径是否等于页面加载时那条**（见 `restoredViewFor`）：
     *   从首页点进城市页（路径变了）照旧取景；从景点详情返回城市页（路径相同）
     *   回到"上次在这页看的位置"，比重新 fit 全城更贴近预期。
     * ★ 命中时要**记账**（`fittedRef`）：否则后续渲染还会再进来问一次。
     */
    if (restoredViewFor(window.location.pathname)) {
      fittedRef.current = key
      return
    }
    // ★ 只在**成功**时记账：失败（地图尚未就绪 / 没有任何可框的点）不记，
    //   留待 `key` 或 `ready` 再变时重试。成功之后再抖也不会去抢用户拖动过的地图。
    if (runRef.current()) fittedRef.current = key
  }, [key, ready])
}
