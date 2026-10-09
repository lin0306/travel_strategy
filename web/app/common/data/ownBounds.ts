/**
 * 「**自身**轮廓」的三个读取器 —— 省 / 市 / 区，**都来自高德**。
 *
 * ★ 2026-10-02 从 `bounds.ts` 拆出（那边 470 行，撞了 G 项 420 行上限）。
 *   拆分线是「**来源** vs **装配**」：
 *     · 本文件 = "把某一级的自身轮廓从分片里读出来"，纯读盘 + 缓存，不关心谁用；
 *     · `bounds.ts` = "这一屏该铺哪一级的面"（`loadBoundsForLevel` / `loadDistrictFaces`）。
 *   两者改动的理由完全不同（一个是数据产地变了、一个是取面策略变了），
 *   而每一次调整都只需读其中一半。
 *
 * ## 为什么这三份不是腾讯的
 * 腾讯 `District.getchildren` **只给下辖子级**，而且给的是"各自独立抽稀"的粗轮廓：
 *   · 省自身 —— 没有接口能给（实测表见 `pipeline/amap.py`）；
 *   · 市自身 —— 只能拿"该省各市"拼，拼出来的省面**内部还画着市界**（一张网）；
 *   · 区自身 —— 拿到的是极粗的形状：北京 16 个区里 4 个只有 **4 个点**（一个矩形），
 *     西安莲湖区 5 个点。用户 2026-10-02 的原话：「这个区的轮廓，怎么方方正正的」。
 * 高德 `config/district?subdistrict=0&extensions=all` 返回的正是"自身轮廓"，
 * 且同为 **GCJ-02** ⇒ 零坐标转换（详见 `pipeline/amap.py`、step9 / step10 / step11）。
 *
 * ## 三份分片的打包粒度不一样（各有理由，别统一）
 * | 级别 | 文件 | 粒度 | 为什么 |
 * |------|------|------|--------|
 * | 省 | `provinces/<省adcode>.geo.json` | 一省一份 | 一屏最多 34 个省，逐省读也才几十个请求 |
 * | 市 | `cities/<省adcode>.geo.json` | **按省打包** | 市这一级一屏会显示很多个市，逐个市一个文件 = 几十上百次请求 |
 * | 区 | `districts-own/<市adcode>.geo.json` | **按市打包** | 区这一级一屏只看得到一两个市的区；按省打包会让"走进一座城"读几百 KB |
 *
 * ★ 文件键（`<市adcode>`）对直辖市/特区是**省码** —— 它们没有中间市层。
 * ★ 文件缺席一律返回 `null`（不是空对象）：调用方据此退回旧源（腾讯那份），
 *   而不是画一张空白。
 */

type JsonModule = { default: unknown }

/* ────────────────────────────────────────────────
 * 省**自身**的轮廓（`pipeline/step9_province_outline.py`）
 * ────────────────────────────────────────────── */

const provinceOwnModules = import.meta.glob<JsonModule>(
  '../../../../data/_generated/provinces/*.geo.json',
)

/** `{省adcode: 环[]}` 的懒加载缓存。**文件不存在 = null**（那就走拼接兜底） */
const provinceOwnCache = new Map<string, number[][] | null>()

/**
 * 读某个省**自身**的轮廓。
 *
 * ★ 这份数据来自**高德**（腾讯没有"省自身"的轮廓接口，实测表见 `pipeline/amap.py`）。
 *   高德 Web 服务返回 **GCJ-02**，与腾讯底图/腾讯 District/我们的 POI **同系**
 *   ⇒ 拿来直接用，**不做任何坐标转换**。（天地图是 CGCS2000≈WGS-84，要转 —— 偏移
 *   50~500m 在省这一档是亚像素，但**绝不能**用在区/点位档。）
 *
 * ★ 形状与 `districts/*.geo.json` 一致（`{adcode: [扁平环,…]}`），所以
 *   `districtLayer` 与 `loadBoundsForLevel` 都**零改动**就能吃下。
 *
 * @return 环列表；没有这个省的分片时返回 `null`（调用方退回"各市拼"）
 */
export async function loadProvinceOwnOutline(adcode: string): Promise<number[][] | null> {
  if (provinceOwnCache.has(adcode)) return provinceOwnCache.get(adcode) ?? null

  const entry = Object.entries(provinceOwnModules).find(
    ([p]) => (p.split('/').pop() ?? '').replace(/\.geo\.json$/, '') === adcode,
  )
  if (!entry) {
    provinceOwnCache.set(adcode, null)
    return null
  }

  try {
    const mod = await entry[1]()
    const data = mod.default as { polygons?: Record<string, number[][]> } | undefined
    const rings: number[][] = []
    for (const rs of Object.values(data?.polygons ?? {})) rings.push(...rs)
    // ★ 空数组按"没有"处理：抓取脚本已经保证"拿不到点就不写文件"，
    //   这里是第二道闸 —— 真出现空分片时也退回拼接，而不是画一张空白
    const out = rings.length > 0 ? rings : null
    provinceOwnCache.set(adcode, out)
    return out
  } catch (err) {
    console.error(`[data] 读取省自身轮廓「${adcode}」失败：`, err)
    provinceOwnCache.set(adcode, null)
    return null
  }
}

/* ────────────────────────────────────────────────
 * 市**自身**的轮廓（`pipeline/step10_city_outlines.py`）
 * ────────────────────────────────────────────── */

const cityBoundsModules = import.meta.glob<JsonModule>(
  '../../../../data/_generated/cities/*.geo.json',
)

/** `{省adcode: {市adcode: 环[]}}` 的懒加载缓存。**文件不存在 = null**（退回腾讯那份） */
const cityBoundsCache = new Map<string, Record<string, number[][]> | null>()

/**
 * 读某个省下**各个市自身**的轮廓（`cities/<省adcode>.geo.json`）。
 *
 * ★ 打包粒度是"省"而不是"市"：市这一级一次会显示很多个市，逐个市一个文件会变成
 *   几十上百次请求；按省打包则和腾讯那份一样，一屏只读几个文件。
 *
 * ★ 直辖市/特区（北京/天津/上海/重庆/中国台湾/中国香港/中国澳门）**自身就是市这一级**，
 *   它们的这一份是 step10 从 `provinces/` 抄过来的 —— 原来在市这一级取
 *   `districts/<直辖市adcode>.geo.json`（key 是**区**）与节点 adcode 对不上 ⇒ 没面。
 *
 * @return `{市adcode: 环[]}`；没有这个省的分片时返回 `null`
 */
export async function loadCityOwnBounds(prov: string): Promise<Record<string, number[][]> | null> {
  if (cityBoundsCache.has(prov)) return cityBoundsCache.get(prov) ?? null

  const entry = Object.entries(cityBoundsModules).find(
    ([p]) => (p.split('/').pop() ?? '').replace(/\.geo\.json$/, '') === prov,
  )
  if (!entry) {
    cityBoundsCache.set(prov, null)
    return null
  }
  try {
    const mod = await entry[1]()
    const data = mod.default as { polygons?: Record<string, number[][]> } | undefined
    const polys = data?.polygons
    // ★ 空对象按"没有"处理：真出现空分片时也退回腾讯，而不是画一张空白
    const out = polys && Object.keys(polys).length > 0 ? polys : null
    cityBoundsCache.set(prov, out)
    return out
  } catch (err) {
    console.error(`[data] 读取市级自身轮廓「${prov}」失败：`, err)
    cityBoundsCache.set(prov, null)
    return null
  }
}

/* ────────────────────────────────────────────────
 * 区**自身**的轮廓（`pipeline/step11_district_outlines.py`）
 * ────────────────────────────────────────────── */

const districtOwnModules = import.meta.glob<JsonModule>(
  '../../../../data/_generated/districts-own/*.geo.json',
)

/** `{文件键: {区adcode: 环[]}}` 的懒加载缓存。**文件不存在 = null**（逐区退回腾讯那份） */
const districtOwnCache = new Map<string, Record<string, number[][]> | null>()

/**
 * 读某个"市文件键"下**各个区自身**的轮廓（`districts-own/<键>.geo.json`）。
 *
 * ★ 键 = 市 adcode（`610100`）；**直辖市/特区 = 省码**（`110000`，没有中间市层）。
 *
 * @return `{区adcode: 环[]}`；没有这份分片时返回 `null`
 */
export async function loadOwnDistrictBounds(parent: string): Promise<Record<string, number[][]> | null> {
  if (districtOwnCache.has(parent)) return districtOwnCache.get(parent) ?? null

  const entry = Object.entries(districtOwnModules).find(
    ([p]) => (p.split('/').pop() ?? '').replace(/\.geo\.json$/, '') === parent,
  )
  if (!entry) {
    districtOwnCache.set(parent, null)
    return null
  }
  try {
    const mod = await entry[1]()
    const data = mod.default as { polygons?: Record<string, number[][]> } | undefined
    const polys = data?.polygons
    // ★ 空对象按"没有"处理：真出现空分片时也逐区退回腾讯，而不是画一张空白
    const out = polys && Object.keys(polys).length > 0 ? polys : null
    districtOwnCache.set(parent, out)
    return out
  } catch (err) {
    console.error(`[data] 读取区自身轮廓「${parent}」失败：`, err)
    districtOwnCache.set(parent, null)
    return null
  }
}
