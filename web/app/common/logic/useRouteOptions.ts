/**
 * 「**某一段 · 某个方式**的多条路线」拉取 —— 独立成一钩子的理由：它有**自己的状态机**
 * （未拉 / 拉取中 / 有结果 / 降级），而这一套状态与行程页的其它状态没有交集。
 *
 * ## ★★ 为什么收 `legOfUid` 而不是 `timeline`
 * 第一版收的是 `timeline`，然后在里面 `timeline.stops.findIndex(...)` 找段 ——
 * 但 **`timeline` 在这个版本恒为 `null`**（`buildTimeline()` 要求首末都是住宿点，
 * 而住宿点入口 2026-09-27 被去掉了）⇒ `if (!timeline) return` 把每次点击直接吞掉，
 * **面板点开永远是空的**（用户 2026-10-04 报的正是"点开什么都没有"）。
 * 这和"段行不显示"是同一个根因的另一半 —— 上一轮只修了显示，没修这里。
 * ⇒ 改成收一个"按 uid 取段"的函数，来源是 `usePlanView` 的 `legByUid`（不依赖时间链）。
 *
 * ## ★ 键是 `uid|mode`（不是 `uid`）
 * 2026-10-04 用户：「一种出行方式是有好几种路线的，所以切换到那个出行方式，
 * 下方列表显示多条路线供用户选择」。步行与驾车是**两组完全不同的路线**，
 * 共用一个键会让切回上一个方式时看到另一个方式的路线（而且不报错）。
 * 用 `uid|mode` 做键，两种方式各存一份，切回来还省一次请求。
 *
 * ## 只在用户点开某一段时才拉
 * 时间链上的每一段都去拉一次，会在打开页面的瞬间打出十几个请求。而用户通常
 * 只看其中一两段 —— 所以拉取由 `requestOptions(uid, mode)` 显式触发。
 *
 * ## 三条降级必须**说出原因**，不能变成"查询失败"
 * | 情况 | 用户看到 |
 * |------|---------|
 * | 配额账本判定不能再调 | 额度打满的说明（`quotaExhaustedBanner` 那条的来源） |
 * | 没配 WebService key | 「未配置 VITE_TMAP_WEB_KEY…上面的时长来自矩阵，照常可用」 |
 * | 接口真的失败 | `degrade: 'failed'` + 原因 |
 *
 * ⚠️ 用 WebService key（`VITE_TMAP_WEB_KEY`），它和前端 JS key 是**两个产品**，
 *    互不通用 —— JS key 拿去调 WebService 接口会被拒。没配时如实说明，
 *    而不是让它以"查询失败"的面目出现（那会让人以为是网络问题）。
 *
 * ## ★★ 结果**落盘**了（2026-10-19 用户改定，推翻此前"不落盘"的决策）
 * 此前理由："它含实时路况（2 小时 TTL），持久化只会让用户第二天看到昨天的路况快照"。
 * 但用户实测后的诉求更硬：「路线规划是实时的数据，能不能直接把这个数据存下来，
 * 这样就不用每次重新算了，存选好的轨迹数据」—— 而且不落盘的后果是**两个 bug**：
 * ① 刷新后方案卡空、地图没线，必须手动再点一次方式才拉；
 * ② 每次重复拉取吃配额（每日 100 次），耗尽后被拒的段在海报里变成直线。
 * ⇒ 现在落盘 24 小时（`routeSetCache.ts`），过期即视为无缓存、展开会重拉。
 */

import { useEffect, useRef, useState } from 'react'

import { canCallRouteOptions } from '~/common/logic/itinerary/quotaLedger'
import { loadRouteSets, saveRouteSets } from '~/common/logic/itinerary/routeSetCache'
import {
  fetchRouteOptions,
  routeOptionKey,
  type RouteOptionSet,
} from '~/common/logic/itinerary/routeOptions'
import type { Place } from '~/common/logic/itinerary/resolveLeg'
import { resolveWebServiceKey, usingOwnKey } from '~/common/map/tencent'
import type { TransitPrefer, TravelMode } from '~shared/schema'

export interface RouteOptionsState {
  /** `routeOptionKey(uid, mode)` → 已拉到的多方案集合 */
  optionSets: Record<string, RouteOptionSet>
  /** 正在拉取的键（`null` = 没有进行中的请求） */
  optionLoading: string | null
  /** 拉这一段 **这一个方式（+偏好）** 的路线 */
  requestOptions: (uid: string, mode: TravelMode, prefer?: TransitPrefer) => void
}

/**
 * @param legOfUid 按 uid 取这一段的**两端**（只用到 from/to，不依赖时间链、不依赖 `legByUid`）。
 *   ★ 2026-10-25 收窄：原来要整个 `LegResult`，导致 `usePlanView` 必须先算 `legByUid`，
 *     而 `legByUid` 要用 `optionSets` —— 又由本钩子产出，绕成一个圈。
 *     只要两端之后，调用方可以直接从 `day.items` + `placeOfItem` 算，圈就断了。
 *   返回 `null` = 这段还没有坐标。
 * @param resetKey 换城市时清空 —— uid 不通用，留着只会串数据
 */
export function useRouteOptions({
  legOfUid,
  resetKey,
}: {
  legOfUid: (uid: string) => { from: Place; to: Place } | null
  resetKey: string
}): RouteOptionsState {
  // ★ 懒初始化：**先吃持久化缓存**（24h TTL）—— 刷新/重开段详情时方案与轨迹直接可用，
  //   不需要再发一次请求（用户 2026-10-19：「已经选中了，再点开列表不会默认展示」）
  const [optionSets, setOptionSets] = useState<Record<string, RouteOptionSet>>(() => loadRouteSets())
  const [optionLoading, setOptionLoading] = useState<string | null>(null)

  // 换城市 → 上一座城的路线不能带过来（内存 + 落盘一起清）。
  // ★ 必须**跳过首次挂载**：这个 effect 在挂载时也会跑一次，直接清会把上面刚读到的
  //   持久化缓存抹掉（表现为"缓存失效、仍要重新拉"—— 正是本次要修的症状）。
  const lastResetKey = useRef(resetKey)
  useEffect(() => {
    if (lastResetKey.current === resetKey) return
    lastResetKey.current = resetKey
    setOptionSets({})
    setOptionLoading(null)
    saveRouteSets({})
  }, [resetKey])

  // 每次集合变化落盘（LRU 40 + 逐条 TTL 判定都在 saveRouteSets / loadRouteSets 里）
  useEffect(() => {
    saveRouteSets(optionSets)
  }, [optionSets])

  const requestOptions = (uid: string, mode: TravelMode, prefer?: TransitPrefer) => {
    const leg = legOfUid(uid)
    if (!leg) return
    // ★ 偏好进键（见 `routeOptionKey`）—— 否则切"公交优先/地铁优先"会看到上一组
    const key = routeOptionKey(uid, mode, prefer)

    const quota = canCallRouteOptions(usingOwnKey())
    if (!quota.allowed) {
      setOptionSets((m) => ({
        ...m,
        [key]: {
          at: Date.now(),
          options: [],
          degrade: 'quota',
          ...(quota.reason ? { note: quota.reason } : {}),
        },
      }))
      return
    }

    const webKey = resolveWebServiceKey()
    if (!webKey) {
      setOptionSets((m) => ({
        ...m,
        [key]: {
          at: Date.now(),
          options: [],
          degrade: 'failed',
          note: '未配置 VITE_TMAP_WEB_KEY，拉不到实时路况方案 · 上面的时长来自矩阵，照常可用',
        },
      }))
      return
    }

    setOptionLoading(key)
    void (async () => {
      try {
        /**
         * ★ 传的是**用户刚点的那个 `mode`**，不是 `leg.mode`。
         *   点"步行"的那一刻 `leg.mode` 还是上一个方式（`setModeToNext` 写库 →
         *   重算 → 新 leg 回来，是**下一拍**的事），用 `leg.mode` 会拉到上一次的方式。
         */
        const set = await fetchRouteOptions(leg.from, leg.to, mode, {
          webKey,
          usingOwnKey: usingOwnKey(),
          // ★ 公共交通下"公交优先 / 地铁优先"；其余方式不传（传了也没意义）
          ...(prefer ? { transitPrefer: prefer } : {}),
        })
        setOptionSets((m) => ({ ...m, [key]: set }))
      } finally {
        setOptionLoading(null)
      }
    })()
  }

  return { optionSets, optionLoading, requestOptions }
}
