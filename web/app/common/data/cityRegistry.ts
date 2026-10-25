/**
 * 城市自动注册 —— **数据即路由**。
 *
 * 新增一座城市 = 往 `data/cities/{省}/{市}/` 放 `city.json` + `pois/{大类}/{poiId}.json`
 * → 页面与路由自动出现，不需要手写 import，也不需要改 `prerender()` 的路由清单。
 *
 * ★ 目录布局（唯一真源是 `pipeline/layout.py`，两侧必须一致）：
 *     data/cities/{省slug}/{cityId}/
 *       ├─ city.json        城市主数据（人写）
 *       └─ pois/{大类}/{poiId}.json   一个点位一个文件
 *
 *   ★ 2026-10-25：`transit.json`（构建期通勤矩阵）**不再存在**，这里也不再 glob 它。
 *     通勤时长改为运行时算（2026-10-06 决策），真实值来自 `routeSetCache`。
 *
 *   为什么分片而不是一个大 JSON：单城 46 个点位会超过 400 行，
 *   AI 每次读文件都要整篇进上下文；分片后改一个点位只产生一个文件的 diff。
 *
 * ★ 两条自我约束（本文件被 react-router.config.ts 直接引用，跑在构建期 Node 里）：
 *   1. **只用相对路径 import**，不用 `~shared` 这类 alias
 *      —— 配置文件模块图未必吃到 vite.config.ts 的 resolve.alias，相对路径没有这个风险。
 *   2. **不碰 window / document** —— 它在浏览器与 Node 两侧都要能跑。
 *
 * ⚠️ `import.meta.glob` **只吃字面量相对路径**，且按文件在树里的深度解析。
 *    写错深度**不报错**、只会静默匹配 0 个文件（页面进空态），是全项目最容易踩的一处。
 */

import { parseCity, safeParseCity, type City } from '../../../../schema/schema'
import { mirrorCityImages } from './imageMirror'

type JsonModule = { default: unknown }
type Loader = () => Promise<JsonModule>

/** 城市主数据：`data/cities/{省}/{市}/city.json` */
const cityModules = import.meta.glob<JsonModule>('../../../../data/cities/*/*/city.json')

/** ★ POI 分片：`data/cities/{省}/{市}/pois/{大类}/{poiId}.json` */
const poiModules = import.meta.glob<JsonModule>('../../../../data/cities/*/*/pois/*/*.json')

/** 开发占位数据：`data/_fixtures/*.json`（仅 DEV 且真实数据缺失时兜底） */
const fixtureModules = import.meta.glob<JsonModule>('../../../../data/_fixtures/*.json')

const DEV = Boolean(import.meta.env?.DEV)

/** ★ 大类的展示顺序 —— 必须与 `layout.CATEGORY_DIRS` 一致。
 *  这个顺序决定了 `city.pois` 的数组顺序（列表、搜索、地图图例都按它排）。 */
const CATEGORY_ORDER = ['scenic', 'food', 'hotspot', 'culture'] as const

/**
 * 从 glob 路径里解析出 (省 slug, 城市 id)。
 * `'../../../../data/cities/sichuan/chengdu/city.json'` → `{ slug: 'sichuan', cityId: 'chengdu' }`
 */
function parseCityPath(path: string): { slug: string; cityId: string } | null {
  const m = /\/cities\/([^/]+)\/([^/]+)\//.exec(path)
  const slug = m?.[1]
  const cityId = m?.[2]
  // 显式判空：`noUncheckedIndexedAccess` 下正则分组结果是 string | undefined
  return slug && cityId ? { slug, cityId } : null
}

/** `'../../../../data/cities/sichuan/chengdu/city.json'` → `'chengdu'` */
function idOf(path: string): string {
  return path.split('/').pop()!.replace(/\.json$/, '')
}

// ── 建立索引 ────────────────────────────────────────────────────

const cityLoaders = new Map<string, Loader>()
for (const [path, load] of Object.entries(cityModules)) {
  const p = parseCityPath(path)
  if (p) cityLoaders.set(p.cityId, load)
}

/** cityId → [{ category, poiId, load }]，已按「大类顺序 + 文件名字典序」排序 */
const poiLoaders = new Map<string, Array<{ category: string; poiId: string; load: Loader }>>()
{
  const bucket = new Map<string, Array<{ category: string; poiId: string; load: Loader }>>()
  for (const [path, load] of Object.entries(poiModules)) {
    const p = parseCityPath(path)
    if (!p) continue
    const tail = path.slice(path.indexOf('/pois/') + '/pois/'.length)   // 'scenic/wuhou-shrine.json'
    const [category, filename] = tail.split('/')
    if (!category || !filename) continue
    const list = bucket.get(p.cityId) ?? []
    list.push({ category, poiId: filename.replace(/\.json$/, ''), load })
    bucket.set(p.cityId, list)
  }
  for (const [cityId, list] of bucket) {
    list.sort((a, b) => {
      const ra = CATEGORY_ORDER.indexOf(a.category as (typeof CATEGORY_ORDER)[number])
      const rb = CATEGORY_ORDER.indexOf(b.category as (typeof CATEGORY_ORDER)[number])
      const norm = (x: number) => (x === -1 ? CATEGORY_ORDER.length : x)  // 未知大类排最后
      return norm(ra) - norm(rb) || a.poiId.localeCompare(b.poiId)
    })
    poiLoaders.set(cityId, list)
  }
}

const fixtureLoaders: Record<string, Loader> = Object.fromEntries(
  Object.entries(fixtureModules).map(([path, load]) => [idOf(path), load]),
)

export const realCityIds: string[] = [...cityLoaders.keys()].sort()
export const fixtureCityIds: string[] = Object.keys(fixtureLoaders).sort()

/** 真实数据是否存在 */
export const hasRealCities = realCityIds.length > 0

/**
 * 是否正在使用开发占位数据。
 * 判据是「DEV 环境 + 没有任何真实城市」—— 所以**一旦 data/cities/ 里有任意一份真实数据，
 * fixtures 立即失效**，不需要手动关。生产构建（DEV=false）永不使用 fixtures。
 */
export const usingFixtures = !hasRealCities && DEV && fixtureCityIds.length > 0

/** 有效城市 id 列表 —— `prerender()` 直接用它生成路由 */
export const cityIds: string[] = usingFixtures ? fixtureCityIds : realCityIds

const cache = new Map<string, City | null>()

async function loadFromParts(cityId: string): Promise<unknown> {
  const loader = cityLoaders.get(cityId)
  if (!loader) return null

  const mod = await loader()
  const city = { ...(mod.default as Record<string, unknown>) }

  const parts = poiLoaders.get(cityId) ?? []
  const pois = await Promise.all(
    parts.map(async (it) => {
      const poiMod = await it.load()
      const poi = { ...(poiMod.default as Record<string, unknown>) }
      // POI 文件里可以不写 category（所在目录已经表达了）—— 这里补上，保持数据自包含
      poi.category ??= it.category
      return poi
    }),
  )
  city.pois = pois

  return city
}

/**
 * 读取并校验一座城市。
 *
 * 开发期用严格 `parseCity`（脏数据直接抛错，避免"页面能跑但内容残缺"）；
 * 生产环境用 `safeParse` 降级为 `null`，让页面走空态而不是整站崩掉。
 */
export async function loadCity(id: string): Promise<City | null> {
  if (cache.has(id)) return cache.get(id) ?? null

  let city: City | null = null
  try {
    const raw = usingFixtures
      ? (await fixtureLoaders[id]?.())?.default ?? null
      : await loadFromParts(id)

    if (raw === null) {
      cache.set(id, null)
      return null
    }

    if (DEV) {
      city = parseCity(raw)
    } else {
      const r = safeParseCity(raw)
      if (r.success) {
        city = r.data
      } else {
        console.error(
          `[data] 城市「${id}」未通过 Schema 校验，已降级为不可用：`,
          r.error.issues.slice(0, 5),
        )
      }
    }
  } catch (err) {
    console.error(`[data] 读取城市「${id}」失败：`, err)
  }

  // ★ 图片统一走镜像：Wikimedia 的图片域名（upload/thumb）国内不可达，
  //   直链会全部空白。放在**校验之后**—— 让 Schema 校验针对原始干净数据，
  //   镜像纯粹是展示侧变换，数据文件里始终是原始可溯源地址。
  //   详见 ./imageMirror.ts（换镜像服务只改那里一处）。
  if (city) city = mirrorCityImages(city)

  cache.set(id, city)
  return city
}

/** 一次性把全部城市读完（首页/索引/预渲染用） */
export async function loadAllCities(): Promise<City[]> {
  const list = await Promise.all(cityIds.map((id) => loadCity(id)))
  return list.filter((c): c is City => c !== null)
}

/**
 * 按 adcode 反查已收录城市 —— 下钻时「点市边界 → 跳城市页」靠它。
 * 用 adcode 而非名称：名称在不同层级可能重名（如"城区"）。
 */
export function findCityIdByAdcode(cities: City[], adcode: string): string | null {
  return cities.find((c) => c.adcode === adcode)?.id ?? null
}
