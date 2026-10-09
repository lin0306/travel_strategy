/**
 * 区列表读取 —— **第四级的地基**（省 → 市 → **区** → 景点）。
 *
 * ## 为什么单独一个文件
 * `data.ts` 已经顶到 420 行的单文件上限（check_app 的 G 项站着），
 * 而区这一级要新增"列表 + 边界取景"两件事。拆出来而不是摊进 `data.ts`，
 * 是为了不让那条上限逼着人去删注释 —— 那些注释是踩坑记录，不是废话。
 *
 * ## 为什么按市分片而不是塞进区划树
 * 全国 3000 多个区塞进 `district-tree.json`，树会从 55KB 涨到几百 KB，
 * 而首页与省级页根本用不到（它们只到省 / 市两级）。**按市分片 + 懒加载**之后，
 * 只有真的走进某座城市才会读它那一份（约 1KB）。
 *
 * ★ key 一律是**市的 adcode**（`440100` 广州）。它对应的边界文件
 *   `districts/440100.geo.json`（各区的面）由 step8 与区列表**同一次请求**产出。
 */

import { SubdistrictFileSchema } from '~shared/schema'

// ★ 取景框用的几何走 `loadDistrictFaces`（唯一入口：高德"区自身轮廓"优先、
//   逐区退回腾讯那份）—— 与画面读的是同一份，别在这里直接调 `loadDistrictBounds`
import { loadDistrictFaces } from './data'

type JsonModule = { default: unknown }
type Loader = () => Promise<JsonModule>

const subdistrictModules = import.meta.glob<JsonModule>(
  '../../../../data/_generated/subdistricts/*.json',
)

/** 已读过的分片。**连"没有这个文件"这个事实一起缓存** —— 一座市 1KB，不做 GC */
const cache = new Map<string, unknown | null>()

export interface SubdistrictRow {
  adcode: string
  name: string
  center: { lng: number; lat: number }
  poiCount: number
}

/**
 * 读某座城市的区列表（升序）。
 *
 * @return `null` = **这座城市的区还没抓**（step8 没跑 / 这座城不在已抓范围），
 *   它和"这座城市没有区"（理论上不会发生）是两件事 —— 用 `null` 区分，
 *   是为了让 UI 知道该提示"暂无数据"还是直接画空白。
 */
export async function loadSubdistricts(cityAdcode: string): Promise<SubdistrictRow[] | null> {
  if (!cityAdcode) return null
  if (cache.has(cityAdcode)) return cache.get(cityAdcode) as SubdistrictRow[] | null

  const hit = Object.entries(subdistrictModules).find(
    ([p]) => p.split('/').pop()?.replace(/\.json$/, '') === cityAdcode,
  )
  if (!hit) {
    cache.set(cityAdcode, null)
    return null
  }

  try {
    const mod = await (hit[1] as Loader)()
    const r = SubdistrictFileSchema.safeParse(mod.default)
    if (!r.success) {
      console.error(`[data] subdistricts/${cityAdcode}.json 未通过校验：`, r.error.issues.slice(0, 5))
      cache.set(cityAdcode, null)
      return null
    }
    const rows: SubdistrictRow[] = r.data.children.map((c) => ({
      adcode: c.adcode,
      name: c.name,
      center: c.center,
      poiCount: c.poiCount,
    }))
    cache.set(cityAdcode, rows)
    return rows
  } catch (err) {
    console.error(`[data] 读取 subdistricts/${cityAdcode}.json 失败：`, err)
    cache.set(cityAdcode, null)
    return null
  }
}

/**
 * 反查某个区属于哪座市。
 *
 * ## 为什么需要它
 * 区的边界住在**它所属那座市**的文件里（`districts/<市adcode>.geo.json`），
 * 而区自己的 adcode 里看不出市（前 4 位是省、不是市 —— 广州 440100 与
 * 深圳 440300 同为 44 开头，拿省码去开文件必然开错）。所以"点一个区要飞过去"
 * 必须先答出"它的市是谁"。
 *
 * ★ 从**已经加载过的**分片里反查，不去扫全部分片：全国 367 份，为一次点击全读一遍不值。
 *   省级页 / 首页本来就把各市的区分片握在手里（`subRows`），查它是常数级的事。
 *
 * @return 市的 adcode；不在这些分片里时 `null`（这个区属于还没加载的市）
 */
export function findSubdistrictOwner(
  rowsByCity: Record<string, SubdistrictRow[]>,
  districtAdcode: string,
): string | null {
  if (!districtAdcode) return null
  for (const [cityAdcode, rows] of Object.entries(rowsByCity)) {
    if (rows.some((r) => r.adcode === districtAdcode)) return cityAdcode
  }
  return null
}

/**
 * 若干环的外接框。下面两个函数共用这段遍历。
 *
 * @return `[minLng, minLat, maxLng, maxLat]`；一个有效点都没有时返回 `null`（不是全 0 ——
 *   那会被当成"框住几内亚湾"，镜头直接飞到海上）
 */
function boxOfRings(rings: number[][] | undefined): [number, number, number, number] | null {
  if (!rings?.length) return null

  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity
  for (const ring of rings) {
    // ★ 环是**扁平坐标串**（形状说明见 `data.ts` 的 DistrictBoundsFile 注释），成对走。
    //   `noUncheckedIndexedAccess` 下每次取值都带 `undefined`，越界即跳 ——
    //   环长理论上总是偶数（腾讯原样落盘），保护是为了不让脏数据把 bbox 算成 NaN。
    for (let i = 0; i < ring.length - 1; i += 2) {
      const lng = ring[i]
      const lat = ring[i + 1]
      if (lng === undefined || lat === undefined) continue
      if (lng < minLng) minLng = lng
      if (lng > maxLng) maxLng = lng
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
    }
  }
  if (minLng === Infinity) return null
  return [minLng, minLat, maxLng, maxLat]
}

/**
 * 某个区的 bbox `[minLng, minLat, maxLng, maxLat]` —— **点区 → 飞到这个区**用。
 *
 * ★ 走 `loadDistrictFaces`（与画面同一个入口）：**优先高德那份"区自身轮廓"**、
 *   逐区退回腾讯那份。取景框跟着画面走才不会出现"框是按方块算的、线是精确的"。
 *   没有边界时返回 `null`，那时点区退化为"飞到区中心"（由调用方兜底）。
 */
export async function loadDistrictBox(
  cityAdcode: string,
  districtAdcode: string,
): Promise<[number, number, number, number] | null> {
  const file = await loadDistrictFaces(cityAdcode)
  return boxOfRings(file?.polygons?.[districtAdcode])
}

/**
 * **整座城市**的外接框 —— 城市页的入口取景用。
 *
 * ## 为什么不用点位云去 fit
 * 点位是我们自己采的：它们集中在有内容的那一小片（香港 57 个点几乎全在维港两岸）。
 * 拿它们 fit 出来的缩放经常已经 ≥ `POI_REVEAL_ZOOM`，于是**一进城市页就直接是景点**，
 * 用户要的"先看区、再看景点"被跳过了 —— 表现得像是这一级不存在。
 *
 * 而行政外接框框的是"这座城有多大"，与内容无关：进出同一座城市的入口视野**恒定**，
 * 那一刻屏幕上铺的正是各区的徽标。
 *
 * ★ 几何同样走 `loadDistrictFaces`（高德"区自身轮廓"优先、逐区退回腾讯）——
 *   腾讯给下辖区的轮廓是**方块**（实测北京有 4 个区只有 4 个点），
 *   拿它们并集出来的 city bbox 会**偏大**（方块之间互相越界）⇒ 入口视野偏松。
 *
 * @return `null` = 这座城市没有边界文件，调用方退回"按点位 fit"
 */
export async function loadCityBox(
  cityAdcode: string,
): Promise<[number, number, number, number] | null> {
  const file = await loadDistrictFaces(cityAdcode)
  const polys = file?.polygons
  if (!polys) return null

  let box: [number, number, number, number] | null = null
  for (const rings of Object.values(polys)) {
    const b = boxOfRings(rings)
    if (!b) continue
    box = box
      ? [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])]
      : b
  }
  return box
}
