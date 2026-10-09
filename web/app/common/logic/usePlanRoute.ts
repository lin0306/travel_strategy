/**
 * 「规划路线 / 重新规划」的控制器 —— **唯一会花配额的动作**。
 *
 * ## 为什么单独成钩子
 * 三条约束集中在这里，散在组件里一定会漏掉其中一条：
 * 1. **只在用户点它时才算**（绝不能因为"面板打开了""规划切换了"就自动跑）——
 *    每一跑就是一次接口配额；
 * 2. **算完就落盘**（`planStore.update({ route })`）—— 这正是"省调用次数"的落点：
 *    几何不会变，下次打开直接从库里读；
 * 3. **失败要说清为什么**，因为用户刚刚花掉了一次额度。
 *
 * ## 为什么不落盘实时路况
 * 路况十分钟就过期，落下来就是骗人。所以 `PlanRoute` 里只有几何 + 耗时 + `at`
 * （计算时刻），UI 靠 `at` 把它标成"某时刻的快照"（plans/13 §2.2）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { resolveWebServiceKey, usingOwnKey } from '~/common/map/tencent'
import { usePlanStore } from './itinerary/planStore'
import type { PlanStopView } from './itinerary/planStops'
import { fetchWholeRoute, type WholeRoutePoint } from './itinerary/wholeRoute'
import type { RoutePlan } from '~shared/schema'

export interface PlanRouteController {
  /** 正在算 */
  computing: boolean
  /** 失败原因（人话）。非空时 UI 必须显示 —— 他刚花了一次额度 */
  error: string | null
  /** ★ 界面上的按钮就该绑它。别的任何地方都不要调 */
  compute: () => void
  clearError: () => void
  /** 有可用的 key 吗。没有就禁用按钮并说明原因（**不静默禁用**） */
  keyReady: boolean
}

export function usePlanRoute(plan: RoutePlan | null, stops: PlanStopView[]): PlanRouteController {
  const update = usePlanStore((s) => s.update)
  const [computing, setComputing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 计算途中换了规划 ⇒ 结果丢弃（否则会把 A 的路线写到 B 上，而且不报错） */
  const targetRef = useRef<string | null>(null)

  // 换一条规划就清掉上一条的错误 —— 留着会让新规划一打开就顶着一句失败提示
  useEffect(() => {
    setError(null)
  }, [plan?.id])

  /**
   * ★ key 每次渲染现取：它来自 `localStorage`（一次同步读取，代价可忽略），
   *   而用户可能刚在设置里填了 key —— 缓存住会让"填完 key 还要刷新页面"成为隐性要求。
   *   依赖 `plan?.id` 只是为了让它在切换规划时也重新求值一次。
   */
  const keyReady = useMemo(() => resolveWebServiceKey() !== null, [plan?.id])

  const compute = useCallback(() => {
    if (!plan || computing) return

    // ★ 查不到坐标的点位**跳过并在结果里说明**，不能悄悄少算一段
    const usable = stops.filter((s) => s.resolved)
    const dropped = stops.length - usable.length
    const points: WholeRoutePoint[] = usable.map((s) => ({
      uid: s.uid,
      kind: s.kind,
      name: s.name,
      lng: s.lng,
      lat: s.lat,
    }))

    if (points.length < 2) {
      setError('至少要有两个点位（且坐标已知）才能规划路线')
      return
    }

    const planId = plan.id
    const mode = plan.mode
    targetRef.current = planId
    setComputing(true)
    setError(null)

    void fetchWholeRoute(points, mode, {
      webKey: resolveWebServiceKey(),
      usingOwnKey: usingOwnKey(),
    })
      .then(async (out) => {
        // 算完发现用户已经换了规划 → 丢结果，不写库
        if (targetRef.current !== planId) return
        if (!out.ok) {
          setError(out.reason)
          return
        }
        const route = dropped > 0
          ? { ...out.route, note: `${out.route.note ? `${out.route.note} · ` : ''}有 ${dropped} 个点位坐标未知，未参与计算` }
          : out.route
        const ok = await update(planId, { route })
        // 落盘失败（配额满 / 事务失败）也要说 —— 否则用户以为路线存住了
        if (!ok) setError('路线算出来了，但没能存到本地数据库（刷新后要重算）')
      })
      .catch((err: unknown) => {
        if (targetRef.current !== planId) return
        setError(err instanceof Error ? `路线查询失败：${err.message}` : '路线查询失败')
      })
      .finally(() => {
        /*
         * ★ 这里**不**加 `targetRef` 判断：`computing` 是这个钩子自己的一个标志位，
         *   换了规划也得归位。判了的话，"算到一半换了规划"会把转圈永久留在新规划上。
         *   而"别把结果写错规划"那件事由 `.then` 里的 `targetRef` 负责 —— 两件事别混。
         */
        setComputing(false)
      })
  }, [plan, stops, computing, update])

  return { computing, error, compute, clearError: () => setError(null), keyReady }
}
