/**
 * 海报的**路线拉取** —— 原 `exportPosterFiles.ts` 里的 `fetchLegPaths`，
 * 2026-10-24 拆出来（护栏 G：编排文件已 363 行，再塞缓存复用就要破 420）。
 *
 * ## ★★ 三个必须记住的点（都是 2026-10-24 修掉的缺陷）
 *
 * 1. **先吃 `routeSetCache`（24h TTL，与行程页共享同一份）—— 命中就零请求。**
 *    用户 2026-10-19 的诉求原话是"别每次重新算"；而重复拉会打满每日 100 次配额，
 *    被拒的段在海报里就变成直线（2026-10-18 那轮"断线"的根因之一）。
 *    拉到的结果也**写回同一份缓存**，行程页随后展开段详情时直接可用。
 *
 * 2. **用户手选的方案优先**（`store.chosenOption[uid]` → `RouteOption.key`）。
 *    海报因此**不需要** `LegContext.getOverride` —— 连几何都用他选的那条。
 *    （行程页靠 `getOverride` 才拿到手选方案的时长；海报直接取整个方案，更彻底。）
 *
 * 3. **时长必须取 `option.durationMinutes × 60`。**
 *    原实现只取了 `path`、把时长丢了，于是行间时长退回 `resolveLegSync` 的
 *    「直线估算」—— 而准确值就在同一次响应里。这是海报最憋屈的一处缺陷。
 *    ⚠️ 接口给**分钟**、矩阵与时间链用**秒**，混了差 60 倍。
 */

import {
  fetchRouteOptions,
  routeOptionKey,
  transitHeadline,
  type RouteOption,
  type RouteOptionSet,
} from '~/common/logic/itinerary/routeOptions'
import { loadRouteSets, saveRouteSets } from '~/common/logic/itinerary/routeSetCache'
import type { LegResult } from '~/common/logic/itinerary/resolveLeg'
import { usingOwnKey } from '~/common/map/tencent'
import type { PosterLeg, PosterProgress } from './posterAtom'
import type { TransitPrefer } from '~shared/schema'

/** 一段路线的几何产物 —— 整线 path + 真实时长 + 公交线路链 */
export interface LegGeometry {
  /** `[lng, lat][]`（GCJ-02）。null = 这段没拿到几何，画直线 */
  path: Array<[number, number]> | null
  /** 秒。null = 接口没给可用时长（此时段行显示「—」并断表） */
  durationSec: number | null
  /** 公交/地铁专有：线路链说明（「661路 → 地铁3号线 · 换乘 1 次」） */
  lineItems?: PosterLeg['lineItems']
}

export interface FetchLegsInput {
  /** 当天的 item（**只要 `uid` + `transitPrefer`** —— 偏好必须进缓存键，见 `routeOptionKey`） */
  dayItems: ReadonlyArray<{ uid: string; transitPrefer?: TransitPrefer }>
  webKey: string
  /** uid → 用户手选的方案 key（`store.chosenOption`） */
  chosenOption: Record<string, string>
}

export interface FetchLegsResult {
  paths: Map<string, LegGeometry>
  /** 失败段描述（导出后随 toast 如实上 UI） */
  failures: string[]
}

/**
 * 挑本段要用的那条方案。
 * 手选的优先（**且必须真有几何** —— 手选的那条 geometry 缺失时退回可用的第一条，
 * 否则海报上这一段会从"有路线"变成"直线"，比不尊重手选更糟）。
 */
function pickBest(set: RouteOptionSet, chosenKey?: string): RouteOption | undefined {
  const usable = set.options.filter((o) => (o.path?.length ?? 0) >= 2)
  if (chosenKey) {
    const hit = usable.find((o) => o.key === chosenKey)
    if (hit) return hit
  }
  return usable[0] ?? set.options[0]
}

/**
 * 逐段取几何与时长。
 *
 * @param legsByUid `buildAdjacentLegs` 的产物 —— 它给出 from/to/mode 与"这段到底存不存在"
 * @returns `paths` 按**段起点 item 的 uid** 索引（与 `legsByUid` 同键）
 */
export async function fetchLegPaths(
  input: FetchLegsInput,
  legsByUid: Map<string, LegResult>,
  onProgress?: PosterProgress,
): Promise<FetchLegsResult> {
  const paths = new Map<string, LegGeometry>()
  const failures: string[] = []

  // ★ 宿主持久化缓存（24h TTL 已在 loadRouteSets 里逐条判过）
  const cached = loadRouteSets()
  /** 本次真拉到的集合 —— 收尾统一合并落盘 */
  const fresh: Record<string, RouteOptionSet> = {}

  const items = input.dayItems.filter((it) => legsByUid.has(it.uid))
  let seq = 0
  for (const item of items) {
    const leg = legsByUid.get(item.uid)
    if (!leg) continue
    seq++
    const prefer = item.transitPrefer
    const key = routeOptionKey(item.uid, leg.mode, prefer)
    try {
      let set = cached[key] ?? fresh[key]
      if (!set || set.options.length === 0) {
        onProgress?.(`拉取路线：${leg.from.name} → ${leg.to.name}`)
        set = await fetchRouteOptions(leg.from, leg.to, leg.mode, {
          webKey: input.webKey,
          usingOwnKey: usingOwnKey(),
          timeoutMs: 8000,
          ...(prefer ? { transitPrefer: prefer } : {}),
        })
        fresh[key] = set
      }
      if (set.degrade === 'quota') {
        failures.push(`第${seq}段路线：配额已用完`)
        continue
      }
      const best = pickBest(set, input.chosenOption[item.uid])
      if (!best || (best.path?.length ?? 0) < 2) {
        failures.push(`第${seq}段路线：接口未返回路径`)
        continue
      }
      // ⚠️ durationMinutes 是**分钟**；0 或缺失 ⇒ 当作"没给"（不许拿 0 充数，红线 10）
      const min = best.durationMinutes
      paths.set(item.uid, {
        path: best.path.map((p) => [p.lng, p.lat] as [number, number]),
        durationSec: typeof min === 'number' && min > 0 ? Math.round(min * 60) : null,
        // ★ 公交线路链（原来恒 undefined ⇒ 清单第二行与 88px 行高从来没生效过）
        ...(best.transitLegs && best.transitLegs.length > 0
          ? { lineItems: [transitHeadline(best.transitLegs)] }
          : {}),
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      failures.push(`第${seq}段路线：拉取失败（${msg}）`)
    }
  }

  // 合并落盘（读盘上最新值，避免覆盖行程页刚写进去的段）
  if (Object.keys(fresh).length > 0) saveRouteSets({ ...loadRouteSets(), ...fresh })
  return { paths, failures }
}
