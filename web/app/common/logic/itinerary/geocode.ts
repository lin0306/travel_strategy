/**
 * 逆地理编码：**坐标 → 省市区**（只服务"地图取点"那一行第二行文字）。
 *
 * ## 为什么要有它
 * 行程明细里每个景点都有「省 · 市 · 区」，而**地图取点**手里只有坐标 ——
 * 于是那一行原来显示的是 `30.5728, 104.0668`。用户 2026-09-28 的原话：
 * > 「第二行不是显示经纬度，而是显示**省市区**，保持和其他的一致」
 * 经纬度对他没有用（他不知道 104.0668 是哪儿），地址才有用。
 *
 * ## 代价与三条约束
 * 1. **只能走 JSONP** —— 腾讯 WebService 在浏览器里没有 `Access-Control-Allow-Origin`，
 *    理由与实测写在 `jsonp.ts` 文件头（那是唯一走得通的通道）。
 * 2. **缓存两层**（内存 Map + localStorage，`pruneLru` 300 条）：同一个坐标只查一次。
 *    地图取点是**用户手动点**出来的，量天然有限 ⇒ **不往配额账本里记账**
 *    （账本是给"实时路况"那种可能被循环调用的接口用的，见 `quotaLedger.ts` 文件头）。
 * 3. **拿不到就如实返回 `null`**，绝不用"最近的城市"去猜 —— 猜出来的地址看着没问题、
 *    实际是错的，比空着更糟（与"坐标补不出来就不画"是同一条纪律）。
 */

import { resolveWebServiceKey } from '~/common/map/tencent'
import { STORAGE_KEYS, pruneLru, readJson, writeJson } from '~/common/data/storage'

import { jsonp } from './jsonp'

export interface GeoAddress {
  province: string
  city: string
  district: string
  /** 写入时刻 —— `pruneLru` 按它淘汰最旧的 */
  at: number
}

/** 腾讯 `/ws/geocoder` 的响应（只声明我们用到的字段） */
interface GeoResponse {
  status: number
  result?: {
    address_component?: { province?: string; city?: string; district?: string }
  }
}

/**
 * 坐标键：**4 位小数**（约 11 米）。
 * 同一个取点在两次计算间可能有末位小数的抖动，用满精度会白白多发一次请求。
 */
function keyOf(lng: number, lat: number): string {
  return `${lng.toFixed(4)},${lat.toFixed(4)}`
}

const mem = new Map<string, GeoAddress>()
/**
 * 本次会话**问过**的坐标（含失败的）。
 * ★ 失败的也要记：不记的话每次渲染都重试一遍，而每次重试都是一次配额。
 */
const asked = new Set<string>()
let disk: Record<string, GeoAddress> | null = null

function loadDisk(): Record<string, GeoAddress> {
  if (disk) return disk
  disk = readJson<Record<string, GeoAddress>>(STORAGE_KEYS.geoCache) ?? {}
  return disk
}

function save(k: string, addr: GeoAddress): void {
  mem.set(k, addr)
  disk = pruneLru({ ...loadDisk(), [k]: addr }, 300)
  writeJson(STORAGE_KEYS.geoCache, disk)
}

/** 同步读缓存 —— 渲染时先用它，miss 才等异步（避免每行先闪一下"定位中…"） */
export function cachedAddress(lng: number, lat: number): GeoAddress | null {
  const k = keyOf(lng, lat)
  return mem.get(k) ?? loadDisk()[k] ?? null
}

export async function reverseGeocode(lng: number, lat: number): Promise<GeoAddress | null> {
  const k = keyOf(lng, lat)
  const hit = cachedAddress(lng, lat)
  if (hit) return hit
  if (asked.has(k)) return null

  const key = resolveWebServiceKey()
  if (!key) return null

  asked.add(k)
  try {
    // ★ 腾讯的 `location` 是 **纬度在前**（`lat,lng`）—— 写反了会得到地球另一头的地址，不报错
    const url = `https://apis.map.qq.com/ws/geocoder/v1/?location=${lat},${lng}&key=${encodeURIComponent(key)}`
    const res = await jsonp<GeoResponse>(url)
    if (res.status !== 0 || !res.result) return null
    const c = res.result.address_component ?? {}
    const addr: GeoAddress = {
      province: c.province ?? '',
      city: c.city ?? '',
      district: c.district ?? '',
      at: Date.now(),
    }
    // 三样全空 = 接口给了个空壳 —— 不当缓存，按"没拿到"处理
    if (!addr.province && !addr.city && !addr.district) return null
    save(k, addr)
    return addr
  } catch {
    // 地址是锦上添花：断网 / 超时 / 配额都用同一个出口（那一行显示"定位中…"）
    return null
  }
}

/**
 * 拼成"省 · 市 · 区"。
 *
 * ★ 用 `Set` 去重、用 `·` 分隔 —— 与 `StopTimeline.subtitleOf` 对景点那一套**完全一致**
 *   （直辖市在数据里 `province` 与 `city` 同名，直接拼会变成"北京市北京市朝阳区"）。
 *
 * ★★ 还要**掐掉"省/市"后缀**：腾讯返回的是全称（"四川省 · 成都市 · 成华区"），
 *   而城市数据里是简称（景点那行显示"四川 · 成都 · 成华区"）—— 用户要求
 *   「显示省市区，**保持和其他的一致**」，同一列里两种写法就是不一致。
 *   只掐"省"和"市"两种后缀：自治区 / 特别行政区的全称**本来就该带着**（"内蒙古自治区"），
 *   把那些也截短反而错。
 */
export function formatAddress(a: GeoAddress): string {
  const short = (v: string) => v.replace(/(省|市)$/, '')
  return [...new Set([a.province, a.city, a.district].filter(Boolean).map(short))].join(' · ')
}
