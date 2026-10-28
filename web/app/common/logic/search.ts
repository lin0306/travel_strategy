/**
 * 顶栏搜索的**匹配与取景** —— 纯逻辑：不碰 React、不碰地图实例、不发请求。
 *
 * ## 匹配是**纯本地**的（这条是有意的）
 * 数据全部构建期固化，所以搜索**不调任何 POI 搜索接口**（`plans/03` I6 的红线：
 * 地理编码一对一、公交无批量，别把额度花在"用户每打一个字"上）。
 * 代价是只有"名字 / 标签 / 细类 / 城市"这类**我们手里有的字段**能搜 ——
 * 换来的是一条 `data/_generated/search-index.json`（约 160KB，懒加载一次）。
 *
 * ## 打分分级，而不是"能在哪儿找到就行"
 * 排序要**能解释**：名字完全相同 > 名字前缀 > 名字包含 > 关键词（标签 / 细类 /
 * 城市名）。同分时沿用索引里的顺序 —— POI 那一段**构建期已按热度降序**排好，
 * 所以"同分"天然就是"更热门优先"，不需要再存一份 popularity。
 */

import { SUBTYPE_META, type SearchIndex, type SearchPoi, type SearchRegion } from '~shared/schema'

import { focusPointsFor, type FocusSources, type FocusTarget } from './districtFocus'
import type { LatLngLike } from '~/common/map/tencent'

/** 命中等级。用常量表而不是散落的数字 —— 排序规则要能一眼读完 */
const SCORE = {
  /** 名字一样（去行政后缀后也一样） */
  exact: 100,
  /** 名字以查询开头（"成" → "成都"） */
  prefix: 80,
  /** 名字里含查询（"博物" → "成都博物馆"） */
  contains: 60,
  /** 关键词命中：标签 / 细类中文名（"博物馆"、"小吃夜市"） */
  keyword: 40,
  /** 只命中所属城市（"成都" → 成都的那几枚）—— 排在最后，免得占满整列 */
  city: 25,
} as const

/**
 * 两组各自的条数上限。**分开算**是有意的：地区条目少而精，景点条目多，
 * 混在一起排会被一头挤掉（"成都" 能匹配到 57 枚景点，四行之内全是景点）。
 */
export const MAX_REGION_HITS = 4
export const MAX_POI_HITS = 6

/**
 * 行政后缀（比较用）。"四川省" 与 "四川" 必须能互相命中 ——
 * 用户既可能打全称也可能打简称。带 `新区` / `地区` 是因为区划名里真的这么叫。
 */
const ADMIN_SUFFIX_RE =
  /(特别行政区|维吾尔自治区|回族自治区|壮族自治区|自治区|自治州|地区|新区|省|市|区|县|盟|自治县)$/

/** 查询归一化：去首尾空白 + 去中间空白 + 小写（中文不受影响，英文不区分大小写） */
export function normalizeQuery(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '')
}

/** 去行政后缀（比较用）："四川省" → "四川"、"东城区" → "东城" */
function bare(name: string): string {
  const s = name.toLowerCase().replace(ADMIN_SUFFIX_RE, '')
  // 全名就是后缀（理论上不会）时原样返回 —— 别把查询变成空串，那是"匹配一切"
  return s || name.toLowerCase()
}

/** 名字维度打分。0 = 不命中 */
function scoreName(name: string, q: string): number {
  const n = name.toLowerCase()
  const b = bare(name)
  if (n === q || b === q) return SCORE.exact
  if (n.startsWith(q) || b.startsWith(q)) return SCORE.prefix
  if (n.includes(q) || b.includes(q)) return SCORE.contains
  return 0
}

/** 景点打分：先看名字，再看"能被叫出来的别的东西"，最后才看所属城市 */
function scorePoi(p: SearchPoi, q: string): number {
  const byName = scoreName(p.name, q)
  if (byName > 0) return byName
  const label = SUBTYPE_META[p.subtype].label.toLowerCase()
  if (label.includes(q)) return SCORE.keyword
  if (p.tags.some((t) => t.toLowerCase().includes(q))) return SCORE.keyword
  if (p.cityName.toLowerCase().includes(q)) return SCORE.city
  return 0
}

export interface SearchResults {
  regions: SearchRegion[]
  pois: SearchPoi[]
}

const EMPTY: SearchResults = { regions: [], pois: [] }

/**
 * 拿一份索引和一句话做匹配。
 *
 * ★ 传进来的 `q` 已经由调用方（`useSearch`）做过 300ms 防抖 —— 这里每次都当"最终查询"算。
 */
export function searchHits(index: SearchIndex, raw: string): SearchResults {
  const q = normalizeQuery(raw)
  if (!q) return EMPTY

  const regions = index.regions
    .map((item, order) => ({ item, order, score: scoreName(item.name, q) }))
    .filter((x) => x.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        // 同分：已收录的排前面（点进去有内容），再同分沿用索引顺序
        (b.item.poiCount ?? -1) - (a.item.poiCount ?? -1) ||
        a.order - b.order,
    )
    .slice(0, MAX_REGION_HITS)
    .map((x) => x.item)

  const pois = index.pois
    .map((item, order) => ({ item, order, score: scorePoi(item, q) }))
    .filter((x) => x.score > 0)
    // 同分沿用索引顺序 = 构建期排好的热度降序（不再存 popularity，见 build.py）
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, MAX_POI_HITS)
    .map((x) => x.item)

  if (regions.length === 0 && pois.length === 0) return EMPTY
  return { regions, pois }
}

/* ────────────────────────────────────────────────
 * 命中 → 该把哪一片框进视野
 * ────────────────────────────────────────────── */

/**
 * 把搜索索引接成 `districtFocus` 要的**数据源**。
 *
 * ★ 关键：**全部来自索引，不触发任何加载** —— 搜一条地区时不需要 `loadCity`，
 *   所以"搜到哪就能立刻飞过去"，没有"点了等一下"的中间态。
 */
export function indexFocusSources(index: SearchIndex): FocusSources {
  return {
    // 省 → 它下辖各市的中心（索引里就是扁平的，按 provinceAdcode 归组）
    childrenOf: (adcode) =>
      index.regions
        .filter((r) => r.provinceAdcode === adcode && r.lng !== null && r.lat !== null)
        .map((r) => ({ lng: r.lng as number, lat: r.lat as number })),
    // 市 → 它自己的点位（只有已收录的市有）
    poisOf: async (adcode) => {
      const cityId = index.regions.find((r) => r.adcode === adcode)?.cityId
      if (!cityId) return []
      return index.pois
        .filter((p) => p.cityId === cityId)
        .map((p) => ({ lng: p.lng, lat: p.lat }))
    },
  }
}

/**
 * 命中一条**地区** → 停在哪一点、落到哪一档。
 *
 * ★ 复用 `districtFocus.focusPointsFor` 的**同一套口径**（省 → 下辖各市中心；
 *   市 → 该市的点位；都没有 → 徽标中心）。于是"搜索飞到成都"和"点成都徽标"
 *   看到的是**同一个画面** —— 同一件事只允许有一种解释。
 * ★ 坐标缺席（只有名字的行）时返回 `null`：调用方据此"只看清单不推镜头"。
 */
export async function regionFocusPoints(
  index: SearchIndex,
  region: SearchRegion,
): Promise<FocusTarget | null> {
  if (region.lng === null || region.lat === null) return null
  return focusPointsFor(
    { adcode: region.adcode, lng: region.lng, lat: region.lat },
    indexFocusSources(index),
  )
}

/** 命中一条**景点** → 框它自己。`fit` 会给"零面积"范围补一个 ~2km 的方块 = 街区尺度 */
export function poiFocusPoints(poi: SearchPoi): LatLngLike[] {
  return [{ lng: poi.lng, lat: poi.lat }]
}
