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
 *   ★★ 2026-11-17：**不再 glob 源分片，改 glob 聚合产物**。
 *      `web/scripts/gen-web-data.mjs` 把一城的分片合成为
 *      `data/_generated/web/cities/{cityId}.json`，这里只认那 83 个文件。
 *
 *      为什么必须这么做：`import.meta.glob` 的**每个文件**都是 Rollup 的一个模块。
 *      直接 glob 源分片 = 5066 个数据模块，构建内存峰值 **3.9 GB** ——
 *      Netlify 构建容器被 Node 判定为 4 GB（V8 默认堆上限只有 2 GB），SSR 阶段必 OOM
 *      （实测 exit 134）。本地能过纯属侥幸：31 GB 内存 ⇒ 堆上限 4144 MB，
 *      只比峰值高 25 MB。
 *      聚合后数据模块 5066 → 83，这是本项目能在 Netlify 上构建成功的前提。
 *      ★ 产物由 `pnpm gen:data` 生成；`dev` / `build` 两个脚本各自**内联前置**调用它
 *      （`"build": "pnpm gen:data && react-router build"`），改完 POI 不用手动跑。
 *
 *   为什么源数据仍分片：单城 57 个点位写成一个 JSON 会超过 400 行，AI 每次读文件
 *   整篇进上下文；分片后改一个点位只产生**一个文件**的 diff，PR review 一眼看清。
 *   ⇒ 源分片是给人看的，聚合产物是给构建看的，两者职责不同。
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

/**
 * ★ 聚合产物：`data/_generated/web/cities/{cityId}.json` = `{ city, pois[] }`。
 *   POI 已按「大类顺序 + poiId 字典序」排好（排序规则在 gen-web-data.mjs 里，
 *   与原来的运行时排序完全一致 —— 顺序变了会牵连搜索、图例、按下标取值的一切）。
 *   产物缺失时这里匹配 0 个文件 ⇒ 全站空态，所以下面留了一条 console.error。
 */
const cityModules = import.meta.glob<JsonModule>('../../../../data/_generated/web/cities/*.json')

/** 开发占位数据：`data/_fixtures/*.json`（仅 DEV 且真实数据缺失时兜底） */
const fixtureModules = import.meta.glob<JsonModule>('../../../../data/_fixtures/*.json')

const DEV = Boolean(import.meta.env?.DEV)

/** `'../../../../data/_generated/web/cities/chengdu.json'` → `'chengdu'` */
function idOf(path: string): string {
  return path.split('/').pop()!.replace(/\.json$/, '')
}

// ── 建立索引 ────────────────────────────────────────────────────

const cityLoaders = new Map<string, Loader>()
for (const [path, load] of Object.entries(cityModules)) {
  cityLoaders.set(idOf(path), load)
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
 * 判据是「DEV 环境 + 没有任何真实城市」—— 所以**一旦有任意一份聚合产物，
 * fixtures 立即失效**，不需要手动关。生产构建（DEV=false）永不使用 fixtures。
 */
export const usingFixtures = !hasRealCities && DEV && fixtureCityIds.length > 0

/** 有效城市 id 列表 —— `prerender()` 直接用它生成路由 */
export const cityIds: string[] = usingFixtures ? fixtureCityIds : realCityIds

// 产物缺失是「静默空态」型故障（站点能打开、每座城都 0 个点位），必须留一句话
if (!hasRealCities && !usingFixtures) {
  console.error(
    '[data] 没有匹配到任何城市 —— 聚合产物缺失？先跑 `node scripts/gen-web-data.mjs`' +
      '（`pnpm dev` / `pnpm build` 会经 pre 钩子自动跑）',
  )
}

const cache = new Map<string, City | null>()

async function loadFromParts(cityId: string): Promise<unknown> {
  const loader = cityLoaders.get(cityId)
  if (!loader) return null

  const mod = await loader()
  const bundle = mod.default as { city?: Record<string, unknown>; pois?: unknown[] } | undefined
  if (!bundle?.city) return null
  return { ...bundle.city, pois: bundle.pois ?? [] }
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
