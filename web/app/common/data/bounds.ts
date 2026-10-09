/**
 * 边界读取层 —— 省 / 市 / 区三级「面」的来源与装配。
 *
 * ★ 2026-10-01 从 `data.ts` 拆出（那边撞了 420 行上限）。理由与 `regions.ts` 那次相同：
 *   一个文件只该管一件事，AI 每次读整篇的上下文成本太高。
 *   `data.ts` 保留 `export * from './bounds'`，所以**既有引用点一个都不用改**。
 *
 * 三条链路，都是"**优先新源、缺了退回旧源**"：
 *
 * | 要哪一级的面 | 优先 | 退回 |
 * |-------------|------|------|
 * | 省 | `provinces/<省>.geo.json`（高德抓的"省自身轮廓"） | 用该省**各市的环拼**（腾讯） |
 * | 市 | `cities/<省>.geo.json`（高德抓的"市自身轮廓"，按省打包） | `districts/<省>.geo.json`（腾讯） |
 * | 区 | `districts-own/<市>.geo.json`（高德抓的"区自身轮廓"，按市打包） | `districts/<市>.geo.json`（腾讯，**极粗**：有的区只有 4 个点 = 一个矩形） |
 *
 * ★ 为什么省/市要换到高德：腾讯**没有"某个行政区自身轮廓"的接口**
 *   （`getchildren` 只给下辖子级），而且它给的子级是**各自独立抽稀**的粗轮廓。
 *   高德 `config/district?subdistrict=0&extensions=all` 返回的正是"自身轮廓"，
 *   且同为 **GCJ-02** ⇒ 零坐标转换。详见 `pipeline/amap.py`。
 * ★ 区这一级 2026-10-02 才补上（用户：「这个区的轮廓，怎么方方正正的，这轮廓数据不对吧」）：
 *   腾讯给下辖区的轮廓实测只有 4~15 个点，而区面从 z=9.5 一直画到点位档（z≥12）
 *   ⇒ 满屏方块。见 `pipeline/step11_district_outlines.py`、`loadDistrictFaces()`。
 *
 * ★ 唯一的对外入口是 `loadBoundsForLevel(level, adcodes)` —— 揭示层按"当前铺的是哪一级"
 *   去取，**不许**再让页面各传一个固定的文件（那样放大换级后新徽标查不到自己的 adcode，
 *   整片会没有面）。区这一级另有 `loadDistrictFaces(key)`（城市页直接用市码取）。
 */

type JsonModule = { default: unknown }

// ★ 2026-10-02：三个「**自身**轮廓」读取器（省/市/区，都来自高德）拆去了 `./ownBounds`
//   —— 本文件撞了 G 项 420 行上限。拆分线是「**来源** vs **装配**」：
//   那边只管"把某一级的自身轮廓读出来"，这边管"这一屏该铺哪一级的面"。
// ★ `export *` 是为了让既有引用点（`~/common/data/data`）**一个都不用改**：
//   `data.ts` 那句 `export * from './bounds'` 会把它一起带出去。
import { loadCityOwnBounds, loadOwnDistrictBounds, loadProvinceOwnOutline } from './ownBounds'

export * from './ownBounds'


/* ────────────────────────────────────────────────
 * 边界缓存（★ 只能来自腾讯 District 服务）
 * ────────────────────────────────────────────── */

/**
 * 边界文件。
 *
 * ⚠️ **坐标是 `[lat, lng]`（纬度在前）** —— 直接照腾讯 District 返回的原样存，
 *    不做转换。理由有两条：① 腾讯全链路都是 lat 在前，转换点越少越不容易错；
 *    ② 09 文档明令「不得修改 API 返回的边界形状」，原样存就是最不容易"改坏"的做法。
 *
 * 绘制时按 `new TMap.LatLng(pt[0], pt[1])` 直接构造即可。
 */
export interface DistrictBoundsFile {
  /** 本文件覆盖的区划 adcode（全国图用 `'0'`） */
  adcode: string
  name: string
  /**
   * 子级区划 adcode → 该区划的**环列表**。**按 adcode 索引，不靠数组顺序**。
   *
   * 层级（腾讯原始形状，**两层**）：
   * ```
   * polygons[adcode] = [ 环, 环, … ]
   * 环               = [ lng, lat, lng, lat, … ]    ← ★ 扁平数字串
   * ```
   *
   * 🚨 三条都是实测结论，错一条就静默画不出来：
   * 1. **环是扁平坐标串**，不是 `[[lng,lat], …]` 点数组。
   *    按点数组解会抛 `ring.filter is not a function`（点数组没有 filter 的层级）
   *    或解出 `LatLng(undefined, undefined)`。取值必须 `i += 2` 成对走。
   * 2. **只有两层**。别"推测应该有 飞地/块 这一层"就自己加一层 ——
   *    腾讯把同一区划的多个环都平铺在同一个数组里，没有额外的"块"分层。
   * 3. 点是 `[经度, 纬度]`（腾讯原始顺序），而 `TMap.LatLng` 要 **(lat, lng)**。
   *    转换只在 `districtLayer` 一处做。
   */
  polygons: Record<string, number[][]>
  fetchedAt: string
}

const boundsModules = import.meta.glob<JsonModule>('../../../../data/_generated/districts/*.geo.json')

function boundsKeyOf(path: string): string {
  return path.split('/').pop()!.replace(/\.geo\.json$/, '')
}

const boundsCache = new Map<string, DistrictBoundsFile | null>()

/**
 * 读取某个区划的边界。
 * @param key 传 adcode（如 `'510000'`）取该省各市的边界。
 *
 * ★ 只生成「已收录城市所在省」的边界文件 —— 其余省等真正有内容时再生成，
 *   避免为"待收录"的省浪费体积。
 *
 * 🚨 **腾讯拿不到"省级自身"的边界**：`getchildren?id=<省>` 返回的是**子级（市）**的轮廓，
 *   而省级自身的轮廓在 District 里**没有接口**能给（`id=100000` 返回 0 个节点、
 *   `/district/v1/boundary` 不存在、`search` 永远不带 polygon、`max_offset` 无效）。
 *   ⇒ 省这一级改从**高德**取（`provinces/*.geo.json`，同为 GCJ-02），
 *     读不到才退回"用各市拼"（见 `loadProvinceFaces` / `loadProvinceOutlines`）。
 */
export async function loadDistrictBounds(key: string): Promise<DistrictBoundsFile | null> {
  if (boundsCache.has(key)) return boundsCache.get(key) ?? null

  const entry = Object.entries(boundsModules).find(([p]) => boundsKeyOf(p) === key)
  if (!entry) {
    boundsCache.set(key, null)
    return null
  }

  try {
    const mod = await entry[1]()
    const data = mod.default as DistrictBoundsFile
    // 形状很轻，直接做基本断言；真正的合规校验在 scripts/validate.py 里（来源必须是腾讯）
    const ok =
      data &&
      typeof data.adcode === 'string' &&
      data.polygons !== null &&
      typeof data.polygons === 'object' &&
      !Array.isArray(data.polygons)
    boundsCache.set(key, ok ? data : null)
    return ok ? data : null
  } catch (err) {
    console.error(`[data] 读取区划边界「${key}」失败：`, err)
    boundsCache.set(key, null)
    return null
  }
}


/**
 * 「**省的面**」的**兜底**路径 —— 用该省各市的轮廓拼出来。
 *
 * ★★ 现在只在**没有** `provinces/<省adcode>.geo.json`（省自身轮廓）时才走到这里，
 *   详见 `loadProvinceFaces`。所以它的定位是"兜底"，不是主路径。
 *
 * ★ 它的毛病（也就是要换源的原因）：拼出来的省面**会把省内的市界一起描出来**，
 *   看起来像一张网 —— 用户 2026-09-30 要的是"显示省标签的时候显示省的**轮廓**"。
 *   真并集做不出来：腾讯给每个市的是**各自独立抽稀**的边界，相邻市共享边界的
 *   顶点根本不重合（`districts/110000.geo.json` 里北京 16 个区每个只有 4~28 个点）。
 *
 * ## 拼接方式：**不合并几何，只把环并到一个 key 下**
 * `districtLayer.setNodes()` 是按 `node.adcode` 去 `polygons` 里查几何的，
 * 所以把该省各市的环全部塞进 `polygons[省adcode]`，省徽标就画得出整片 ——
 * **区图层零改动**。
 *
 * @param adcodes 省级 adcode 列表。只传**已收录城市所在的省**：其余省没有边界文件，
 *   而且"没收录的省不画"本身就是我们要表达的信息（与「河北 —」这种徽标同义）。
 * @return 拼好的文件；一个省都没读到返回 `null`
 */
export async function loadProvinceOutlines(adcodes: string[]): Promise<DistrictBoundsFile | null> {
  const polygons: Record<string, number[][]> = {}
  await Promise.all(
    adcodes.map(async (ad) => {
      const file = await loadDistrictBounds(ad) // ★ 走同一份缓存，重复调用很便宜
      if (!file?.polygons) return
      const rings: number[][] = []
      for (const rs of Object.values(file.polygons)) rings.push(...rs)
      if (rings.length > 0) polygons[ad] = rings
    }),
  )
  if (Object.keys(polygons).length === 0) return null
  return { adcode: '0', name: '全国', polygons, fetchedAt: new Date().toISOString() }
}


/**
 * 省这一级的「面」：**逐个省**优先用自身轮廓，缺了才退回"用该省各市拼"。
 *
 * ★ 逐个省而不是"有文件就全用文件"：分片是**按需抓**的（只抓有收录城市的省），
 *   所以完全可能出现"四川有、陕西没有"。逐省编排能让两者**同时成立**，
 *   不会因为缺一个省就把整片降级。
 *
 * ★ 为什么是"先问自身、缺的才拼"而不是两条并行：拼接那条要读
 *   `districts/<省>.geo.json`（全部已收录省份合起来约 450KB）。一旦高德的分片抓齐，
 *   它就成了纯浪费 —— 而"自身轮廓"的查询只是一次内存里的 glob 命中 + 一次动态 import，
 *   多出来的一跳可以忽略。
 */
export async function loadProvinceFaces(adcodes: string[]): Promise<DistrictBoundsFile | null> {
  const polygons: Record<string, number[][]> = {}
  const missing: string[] = []
  await Promise.all(
    adcodes.map(async (ad) => {
      const rings = await loadProvinceOwnOutline(ad)
      if (rings) polygons[ad] = rings
      else missing.push(ad)
    }),
  )
  if (missing.length > 0) {
    // 兜底：这些省没有自身轮廓分片（没抓过 / 抓不到），用各市拼（会带上省内市界）
    const stitched = await loadProvinceOutlines(missing)
    if (stitched) Object.assign(polygons, stitched.polygons)
  }
  if (Object.keys(polygons).length === 0) return null
  return { adcode: '0', name: '全国', polygons, fetchedAt: new Date().toISOString() }
}


/**
 * **区这一级的「面」的唯一入口** —— 逐区合并两个来源。
 *
 * | 来源 | 谁 | 精度（实测） |
 * |------|----|-------------|
 * | **优先** | `districts-own/<键>.geo.json`（高德 `config/district?subdistrict=0&extensions=all`） | 西安莲湖区 **556 点** · 雁塔区 1042 点 |
 * | 退回 | `districts/<键>.geo.json`（腾讯 `getchildren` 下辖轮廓） | 莲湖区 **5 点** · 北京 4 个区只有 **4 点**（一个矩形） |
 *
 * 用户 2026-10-02：「这个区的轮廓，怎么方方正正的，这轮廓数据不对吧」——
 * 根因就是原来**只有**腾讯那一份，而腾讯给下辖区的轮廓是极度抽稀的，
 * 放大到 z≥9.5（区面一直画到点位档）就是方块。
 *
 * ★★ 注意是**逐区**合并（`{...腾讯, ...高德}`），不是"整份二选一"：
 *   抓取是分批做的（2768 个区、高德是月配额），
 *   所以**抓到一半也有用** —— 已抓到的那几个区用精确轮廓，其余的仍用腾讯的粗轮廓，
 *   不会因为"这一份还没抓到"就整片没有面。
 */
export async function loadDistrictFaces(parent: string): Promise<DistrictBoundsFile | null> {
  const [own, teng] = await Promise.all([
    loadOwnDistrictBounds(parent),
    loadDistrictBounds(parent),
  ])
  if (!own && !teng) return null
  if (!own) return teng
  return {
    adcode: parent,
    name: teng?.name ?? '',
    // 高德优先、缺的用腾讯（顺序不能反：腾讯那份每个键都有，但点数是几个）
    polygons: { ...(teng?.polygons ?? {}), ...own },
    fetchedAt: new Date().toISOString(),
  }
}


/**
 * 「**这一级的面**」—— 按当前铺的是哪一级徽标，去取对应层级的轮廓。
 *
 * ## 规则（2026-09-30 用户定稿）
 * > 「显示省标签的时候显示省的轮廓，显示市标签的时候显示市的轮廓，
 * >   显示区的时候显示区的轮廓」
 *
 * | 铺的是 | 几何从哪来 |
 * |--------|-----------|
 * | 省徽标 | **优先** `provinces/<省adcode>.geo.json`（省**自身**的轮廓，构建期用高德抓好）<br>读不到才退回"该省各市的环拼起来"（见 `loadProvinceOutlines`） |
 * | 市徽标 | **优先** `cities/<省adcode>.geo.json`（高德抓的"市自身轮廓"，key = **市 adcode**）<br>读不到才退回 `districts/<省adcode>.geo.json`（腾讯） |
 * | 区徽标 | `districts/<市adcode>.geo.json` —— key 是**区 adcode** |
 *
 * ★★ 为什么省这一级要"自身轮廓"（2026-09-30 用户）：用各市拼出来的省面**会把省内的市界
 *   一起描出来**（一张网），而用户要的是"显示省标签的时候显示省的**轮廓**"。
 *   真并集做不出来 —— 腾讯给每个市的是**各自独立抽稀**的边界，相邻市共享边界的顶点不重合
 *   （`districts/110000.geo.json` 里北京 16 个区每个只有 4~28 个点）。所以只能**换源取**
 *   "省自身"的轮廓（高德，同为 GCJ-02 ⇒ 零坐标转换）。详见 `pipeline/amap.py`。
 *
 * ★★ 上一版是**页面各传一个固定的 `districtFile`**（首页传"各省的面"、省级页传
 *   "各市的面"），于是放大揭示到下一级时，新徽标在那个文件里**查不到自己的 adcode**
 *   ⇒ 整片没有面。实测（首页，镜头钉成都）：
 *
 * | 放大到 | 铺的徽标 | 实际面 |
 * |--------|---------|--------|
 * | z=4.4 | 省（34） | 19 个 = 省的面 ✓ |
 * | z=6.8 | **市**（92） | 7 个 —— **还是省的面** ✗ |
 * | z=9.8 | **区**（20） | **0 个** ✗ |
 *
 * ★ 父分片的 adcode 由**段式算**出来，不靠额外映射表：
 *   市 `510100` → 省 `510000`（前 2 位 + `0000`）；区 `510104` → 市 `510100`（前 4 位 + `00`）。
 * ★ 只加载**当前视野涉及的那些**父分片（揭示侧已按视野外扩筛过一遍），
 *   所以放大到一两个市时只会读那两三个文件。
 *
 * @param level 当前铺的是哪一级徽标（`'poi'` = 点位级，没有"面"）
 * @param adcodes 这一级**当前视野内**的成员 adcode
 */
export async function loadBoundsForLevel(
  level: 'province' | 'city' | 'district' | 'poi',
  adcodes: string[],
): Promise<DistrictBoundsFile | null> {
  if (adcodes.length === 0 || level === 'poi') return null
  if (level === 'province') return loadProvinceFaces(adcodes)

  const polygons: Record<string, number[][]> = {}

  /**
   * ★★ 区这一级：**两轮取**，因为"区属于哪个文件"不是一种。
   *
   * | 区的类型 | 例 | 它的面挂在哪 |
   * |---------|----|-------------|
   * | 普通市下辖的区 | 西安莲湖 `610104` | `districts-own/610100.geo.json`（市码 = 前 4 位 + `00`） |
   * | **直辖市/特区**的区 | 北京东城 `110101` | `districts-own/110000.geo.json`（**省码**：没有中间市层） |
   *
   * 原来只算"前 4 位 + `00`" ⇒ 北京东城推出 `110100`，那个文件**根本不存在**
   * ⇒ 直辖市在首页/省级页的区级**一个面都没有**（而且不报错）。
   * 现在第二轮把"没被覆盖到的"用省码再取一次。
   */
  if (level === 'district') {
    const primary = new Map<string, string[]>()
    for (const ad of adcodes) {
      const key = `${ad.slice(0, 4)}00`
      primary.set(key, [...(primary.get(key) ?? []), ad])
    }
    let covered = new Set<string>()
    for (const key of primary.keys()) {
      const f = await loadDistrictFaces(key)
      if (!f) continue
      for (const [k, v] of Object.entries(f.polygons)) {
        polygons[k] = v
        covered.add(k)
      }
    }
    // ★ 没被覆盖的（直辖市/特区）→ 用**省码**再取一次
    const rest = adcodes.filter((ad) => !covered.has(ad))
    for (const key of new Set(rest.map((ad) => `${ad.slice(0, 2)}0000`))) {
      const f = await loadDistrictFaces(key)
      if (!f) continue
      for (const [k, v] of Object.entries(f.polygons)) polygons[k] = v
    }
    covered = new Set()
    if (Object.keys(polygons).length === 0) return null
    return { adcode: '0', name: '当前视野', polygons, fetchedAt: new Date().toISOString() }
  }

  const parents = new Set<string>()
  for (const ad of adcodes) {
    // level === 'city'：市 adcode → 省码（前 2 位 + 0000）
    parents.add(`${ad.slice(0, 2)}0000`)
  }
  await Promise.all(
    [...parents].map(async (p) => {
      // ★★ 市这一级：**优先**读 `cities/<省>.geo.json`（高德抓的"市自身轮廓"），
      //   读不到才退回腾讯的 `districts/<省>.geo.json`。两个文件**同形**（key = 市 adcode），
      //   所以这里只是换了个来源，`districtLayer` 一无所知。
      //   为什么要换：腾讯那份只对"已收录城市所在的省"生成过（实测 20/34）⇒ 放大到市这一级
      //   半个国家没有面；而且它是各自独立抽稀的粗轮廓（点距几公里 ⇒ z≈9.5 时几十像素的折角）。
      const own = await loadCityOwnBounds(p)
      const polys = own ?? (await loadDistrictBounds(p))?.polygons
      if (!polys) return
      for (const [k, v] of Object.entries(polys)) polygons[k] = v
    }),
  )
  if (Object.keys(polygons).length === 0) return null
  return { adcode: '0', name: '当前视野', polygons, fetchedAt: new Date().toISOString() }
}
