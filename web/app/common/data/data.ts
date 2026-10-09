/**
 * 数据读取层（索引 / 区划树 / 边界）。
 *
 * 与 `cityRegistry.ts` 的分工：那边管"城市文件自动注册"，这边管**其余构建期产物**。
 *
 * ⚠️ 一条必须守住的边界：这里读到的全是**纯数据**，不依赖地图实例 ——
 *    只要不在这些函数里 import TMap，「地图 SDK 挂了时间轴照常能用」天然成立。
 */

import {
  CityIndexSchema,
  DistrictTreeSchema,
  type City,
  type CityIndexItem,
  type DistrictTree,
} from '~shared/schema'

import { mirrorIndexItems } from './imageMirror'
import { loadAllCities, usingFixtures } from './cityRegistry'
// ★ 拆出去的邻居（都是"一个文件只该管一件事"）：
//   · `./regions.ts`   —— 省 / 市两级的**行形状与读取**（2026-09-26 拆出）
//   · `./bounds.ts`    —— 省 / 市 / 区三级「面」的三条链路 + `loadBoundsForLevel`（2026-10-01 拆出）
//   本文件只留：区划树、城市索引、可用性。两者都用 `export *` 兜住，引用点不必改。

type JsonModule = { default: unknown }
type Loader = () => Promise<JsonModule>

/* ────────────────────────────────────────────────
 * 区划树（三级下钻的地基）
 * ────────────────────────────────────────────── */

const treeModules = import.meta.glob<JsonModule>('../../../../data/_generated/district-tree.json')

let treeCache: DistrictTree | null | undefined

/**
 * 读取区划树。**必须能优雅地"没有"** —— 它是脚本产物，
 * 在采集流水线跑完 step7 之前不存在，此时首页要展示引导而不是崩掉。
 */
export async function loadDistrictTree(): Promise<DistrictTree | null> {
  if (treeCache !== undefined) return treeCache

  const loader = Object.values(treeModules)[0]
  if (!loader) {
    treeCache = null
    return null
  }

  try {
    const mod = await loader()
    const r = DistrictTreeSchema.safeParse(mod.default)
    if (!r.success) {
      console.error('[data] district-tree.json 未通过校验：', r.error.issues.slice(0, 5))
      treeCache = null
    } else {
      treeCache = r.data
    }
  } catch (err) {
    console.error('[data] 读取 district-tree.json 失败：', err)
    treeCache = null
  }

  return treeCache
}

export function isDistrictTreeAvailable(): boolean {
  return Object.keys(treeModules).length > 0
}


/* ────────────────────────────────────────────────
 * 边界 / 几何那一块在 `./bounds.ts`
 * ────────────────────────────────────────────── */
// ★ 2026-10-01 拆出（本文件撞了 420 行上限）。`export *` 是为了让
//   `~/common/data/data` 与 `./data` 的既有引用点**一个都不用改** ——
//   否则 `useMapReveal` / `districtLayer` / `subdistricts` / `regions` 都得跟着改，
//   而这种"到处改 import"的改动最容易漏一处（漏了只报一句找不到导出）。
//
//   那边管：地级/省级"面"的三条链路 + `loadBoundsForLevel` 这个唯一入口。
//   本文件留：区划树、城市索引、可用性。
export * from './bounds'



/* ────────────────────────────────────────────────
 * 城市索引
 * ────────────────────────────────────────────── */

const indexModules = import.meta.glob<JsonModule>('../../../../data/cities.index.json')

let indexCache: CityIndexItem[] | null = null

/** 从城市全量数据里派生索引项 —— 索引文件缺失时的兜底 */
function deriveIndexItem(city: City): CityIndexItem {
  const cover = city.heroImages[0]
  return {
    id: city.id,
    name: city.name,
    province: city.province,
    tagline: city.tagline,
    adcode: city.adcode,
    provinceAdcode: city.provinceAdcode,
    coverImage: cover?.url ?? '',
    poiCount: city.pois.length,
    updatedAt: city.updatedAt,
  }
}

/**
 * 城市索引（**只含已收录城市**）。
 *
 * 优先读 `cities.index.json`（脚本生成的权威版本）；缺失时**就地派生** ——
 * 这样"往 cities/ 里丢一份 JSON 就能看到页面"在跑 `data:build` 之前也成立。
 *
 * ⚠️ 别拿它当"全国计数"用：34 个省级单位的完整计数在 district-tree.json 里，
 *    两者职责不同（见 data/README.md 5.1）。
 */
export async function loadCityIndex(): Promise<CityIndexItem[]> {
  if (indexCache) return indexCache

  const loader = Object.values(indexModules)[0]
  if (loader) {
    try {
      const mod = await loader()
      const r = CityIndexSchema.safeParse(mod.default)
      if (r.success) {
        // ★ 索引存的是原始地址、且这条路径不走 loadCity()，必须自己过一遍镜像（详见 imageMirror）
        indexCache = mirrorIndexItems(r.data)
        return indexCache
      }
      console.error('[data] cities.index.json 未通过校验，改用就地派生：', r.error.issues.slice(0, 5))
    } catch (err) {
      console.error('[data] 读取 cities.index.json 失败，改用就地派生：', err)
    }
  }

  const cities = await loadAllCities()
  indexCache = cities.map(deriveIndexItem).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  return indexCache
}

/* ────────────────────────────────────────────────
 * 数据来源标记（UI 上要如实告知）
 * ────────────────────────────────────────────── */

/**
 * 当前是否为开发占位数据。UI 拿它决定要不要显示「示例数据」标记 ——
 * 反正不能让占位内容被误认成真实内容。
 */
export const isFixtureData: boolean = usingFixtures

/** 一台城市数据整体是否可用（用于空态文案分层） */
export interface DataAvailability {
  hasCities: boolean
  hasDistrictTree: boolean
}

export async function checkAvailability(): Promise<DataAvailability> {
  const index = await loadCityIndex()
  return { hasCities: index.length > 0, hasDistrictTree: isDistrictTreeAvailable() }
}
