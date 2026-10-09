/**
 * 旧行程 → 规划记录的一次性迁移（plans/13 §4.4）。
 *
 * ## 迁什么
 * | 旧 | 新 |
 * |---|---|
 * | `localStorage['chexing:itin:<cityId>']`（一城一份） | IndexedDB `plans` store 里的一条 `RoutePlan` |
 *
 * ## 四条实现约束（每条都对应一个真实会踩的坑）
 * 1. **只做一次**，落 `chexing:plans-migrated` 标记 —— 否则每次启动都要扫一遍 localStorage。
 * 2. **不删旧键**：迁移是「复制一份过去」，不是「搬走」。旧键留着当回滚点，
 *    而且 `itinerary/store.ts` 在切完之前还在读写它。
 * 3. **id 是确定式的**（`legacy-<cityId>`）而不是随机 —— 万一标记位丢了要重迁，
 *    结果是**覆盖同一条**，而不是越迁越多、列表里堆出一串「XX · 我的行程」。
 * 4. **有写失败就不落标记** —— 宁可下次启动重试，也不要出现"标记已迁、数据其实没进去"。
 *    这是"静默丢用户数据"最典型的一种成因。
 *
 * ## 空行程不迁
 * 用户可能只是打开过某个城市的行程页（`init()` 会落一个空壳），那不该变成一条记录。
 * 判据：`stays` 为空**且**所有天都没有点位 ⇒ 跳过。有住宿点但还没排点，算他的劳动成果，要迁。
 */

import { z } from 'zod'

import {
  ItineraryDaySchema,
  StaySchema,
  TravelModeEnum,
  type RoutePlan,
} from '~shared/schema'

import { loadCityIndex } from '~/common/data/data'
import { getPlan, putPlan } from '~/common/data/idb'
import { STORAGE_KEYS, isPersistAvailable, listRawKeys, readJson, writeJson } from '~/common/data/storage'

/**
 * 旧键前缀。
 * ★ 用**键构造器**推导而不是手抄字面量 —— 手抄就会在有人改键名时悄悄失配，
 *   而失配的表现是"迁移一条都没迁到、还不报错"（最坏的一类 bug）。
 */
const LEGACY_PREFIX = STORAGE_KEYS.itinerary('')

/** 旧版落盘结构。`schema.ts` 的同名结构在 `itinerary/store.ts` 里，故意不导出（它是私有的） */
const LegacyItinerarySchema = z.object({
  stays: z.array(StaySchema),
  days: z.array(ItineraryDaySchema),
  defaultMode: TravelModeEnum.default('driving'),
  chosenOption: z.record(z.string(), z.string()).default({}),
})

/** 迁移结果。`skipped` 不是错误 —— 空行程/坏数据都记在这里，供日志与自检看 */
export interface MigrationResult {
  /** 真的写进 IDB 的条数 */
  migrated: number
  /** 看过但因为空/坏而没迁的条数 */
  skipped: number
  /** 写成功的那几条（调用方可以直接并进内存，不必再读一遍库） */
  plans: RoutePlan[]
  /** 标记位是否已落。`false` = 这轮有写失败，下次启动会重试 */
  sealed: boolean
}

const EMPTY_RESULT: MigrationResult = { migrated: 0, skipped: 0, plans: [], sealed: true }

/** 取城市显示名；拿不到就返回空 Map（名字退化成「我的行程」，不是错误） */
async function cityNames(): Promise<Map<string, string>> {
  try {
    const rows = await loadCityIndex()
    return new Map(rows.map((c) => [c.id, c.name]))
  } catch {
    return new Map()
  }
}

/**
 * 跑一次迁移。**幂等**：标记位存在就直接返回空结果（不会再读一遍库）。
 *
 * 刻意不抛错：迁移失败不该让规划功能整体不可用 —— 最坏的结果是"旧行程没搬过来"，
 * 而旧键还在、还能回滚，这个后果比"页面打不开"轻得多。
 */
export async function migrateLegacyItineraries(): Promise<MigrationResult> {
  // ── ① 只做一次 ──
  if (readJson<number>(STORAGE_KEYS.plansMigrated) !== null) return EMPTY_RESULT

  /*
   * ★ 没有 localStorage 就没有旧数据可迁 —— 但**不落标记**：
   *   存储不可用可能只是这一次（比如用户刚好在受限环境里打开），
   *   落了标记就等于永久放弃迁移。反正这个分支下次启动也只是多扫一遍空表。
   */
  if (!isPersistAvailable()) return EMPTY_RESULT

  const keys = listRawKeys(LEGACY_PREFIX)
  if (keys.length === 0) {
    writeJson(STORAGE_KEYS.plansMigrated, Date.now())
    return EMPTY_RESULT
  }

  const names = await cityNames()
  const now = Date.now()
  const candidates: RoutePlan[] = []
  let skipped = 0

  for (const key of keys) {
    const cityId = key.slice(LEGACY_PREFIX.length)
    if (!cityId) {
      skipped += 1
      continue
    }
    const raw = readJson<unknown>(key)
    const parsed = raw ? LegacyItinerarySchema.safeParse(raw) : null
    if (!parsed?.success) {
      // 坏数据（旧版本格式 / 手改坏）不是错误，是"没得迁"
      if (raw) console.warn('[planMigrate] 旧行程未通过校验，跳过：', key)
      skipped += 1
      continue
    }
    const { stays, days, defaultMode, chosenOption } = parsed.data
    const hasWork = stays.length > 0 || days.some((d) => d.items.length > 0)
    if (!hasWork) {
      skipped += 1
      continue
    }

    const city = names.get(cityId)
    candidates.push({
      // ★ 确定式 id：重复迁移 = 覆盖同一条，不会越迁越多
      id: `legacy-${cityId}`,
      name: city ? `${city} · 我的行程` : '我的行程',
      cityId,
      createdAt: now,
      updatedAt: now,
      mode: defaultMode,
      chosenOption,
      stays,
      // ★ 天数为空时补一天：`days: []` 在 UI 上是"没第 1 天"，而所有"第 N 天"的读取都会拿到 undefined
      days: days.length > 0 ? days : [{ stayId: '', startTime: '09:00', items: [] }],
      // 旧数据没有算好的整条路线，也没有折线 —— 老实留 null，进详情时按需重算
      route: null,
    })
  }

  const plans: RoutePlan[] = []
  let already = 0
  for (const plan of candidates) {
    /*
     * ★ 已存在就跳过 —— 这是"真幂等"，不是锦上添花：
     *   万一上一轮有写失败（标记没落），这一轮会重跑。若直接 `put`，
     *   已迁成功的那几条会被**再写一遍并刷新 `createdAt` / `updatedAt`**，
     *   而 `updatedAt` 是记录列表的排序依据 ⇒ 用户会发现列表顺序莫名其妙地变了。
     */
    if ((await getPlan<RoutePlan>(plan.id)) !== null) {
      already += 1
      continue
    }
    if (await putPlan(plan)) plans.push(plan)
  }

  // ── ④ 全成功才落标记（见文件头第 4 条）──
  const sealed = plans.length + already === candidates.length
  if (sealed) writeJson(STORAGE_KEYS.plansMigrated, now)

  if (plans.length > 0 || already > 0) {
    console.info(
      `[planMigrate] 旧行程迁入规划记录：新迁 ${plans.length} 条、此前已迁 ${already} 条、跳过 ${skipped} 条`,
    )
  }
  return { migrated: plans.length, skipped, plans, sealed }
}
