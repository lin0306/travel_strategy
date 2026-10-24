/**
 * 海报绘制的**原子层** —— 色板 / 字体 / 格式化 / 墨卡托投影。
 *
 * ## 为什么拆出来（护栏 G：单文件 ≤420 行）
 * 与海报布局（头部/地图/清单/统计/落款）是两种变更节奏，分文件各自可读。
 *
 * ★ 色板与 app.css 的 token **同值不同源**（canvas 读不到 CSS 变量）——
 *   改主题色要同步这两处（已在 `C` 上注释标明）。
 */

import { MODE_META, type TravelMode } from '~shared/schema'

/* ── 数据形状（调用方准备，绘制模块不 import 逻辑层） ─────────────── */

/** 清单里的一站 */
export interface PosterStop {
  /** 序号（1 起）。住宿段不占序号 —— 见 `PosterDayData.stayPoint` */
  seq: number
  name: string
  lng: number
  lat: number
  /** 停留分钟（null = 不显示） */
  dwellMin: number | null
  /** 到达时刻（从 0 点起的分钟）。null = 前面有段时长缺失，累计断了 */
  arriveMin: number | null
}

/** 两站之间的一段（用于行间小字 + 地图上的路线几何） */
export interface PosterLeg {
  mode: TravelMode
  /** 秒。null = 取不到（估算上下文缺失），行间标签显示「—」 */
  durationSec: number | null
  /** 是否估算值（缓存未命中/直线估算）——统计条要如实标注 */
  estimated: boolean
  /**
   * ★ **真实道路路径**（`[lng, lat][]`，GCJ-02）—— 来自腾讯 direction 接口
   * 的方案 `path`（`fetchRouteOptions`），与行程页地图同一数据源、同一形状。
   * `null` = 没拉到（配额拒绝 / 接口失败）⇒ 画**直线**并在统计条标注。
   */
  path: Array<[number, number]> | null
  /**
   * ★ **本段的专属颜色**（调色板按段序轮换）—— 用户 2026-10-17 定：
   * 「不按交通方式展示不同颜色，改成每条路线都用不同的颜色」。
   * 地图的线、方向箭头、清单的色点**三处同色**，段与段天然可分。
   */
  color: string
  /**
   * ★ **公交/地铁专有**：换乘链（每条乘车线名，按序）—— 清单段标签下方的
   * 小字说明（「661路A线 → 地铁3号线」），文字统一灰色。
   */
  lineItems?: string[]
}

export interface PosterDayData {
  cityName: string
  /** 第几天（1 起）与总天数 */
  dayNo: number
  dayCount: number
  stops: PosterStop[]
  /** `legs[i]` 连接 `stops[i] → stops[i+1]`，`path` 为真实道路路径 */
  legs: PosterLeg[]
  /** 住宿点（当天 stayId 对应的）。画「宿」标记，不进序号清单 */
  stayPoint: { name: string; lng: number; lat: number } | null
}

/* ── 色板（与站内 token 同值，canvas 里不能用 CSS 变量） ──────────── */

export const C = {
  primary: '#1677ff', // = --color-primary
  ink: '#1a1d24', // = --color-ink
  ink2: '#5c6470',
  ink3: '#9aa1ac',
  line: '#e8ebf0', // = --color-line
  white: '#ffffff',
} as const

/** 全站字体栈（canvas 没有 token，写同族） */
export const FONT = "'PingFang SC','Hiragino Sans GB','Microsoft YaHei',system-ui,sans-serif"
export const font = (weight: number | string, px: number) => `${weight} ${px}px ${FONT}`

/* ── 格式化 ────────────────────────────────────────────────────── */

/** 阶段文案（导出进度行显示）。定义在原子层 —— 绘制/编排/按钮三处共用同一个签名 */
export type PosterProgress = (text: string) => void

export function fmtDur(min: number): string {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  if (h === 0) return `${m} 分钟`
  if (m === 0) return `${h} 小时`
  return `${h} 小时 ${m} 分`
}

export function fmtClock(minFromMidnight: number): string {
  const h = Math.floor(minFromMidnight / 60) % 24
  const m = Math.floor(minFromMidnight % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** 段的行间文案（「驾车 · 约 25 分钟」）。durationSec 缺失显示「—」 */
export function legLabel(leg: PosterLeg): string {
  return leg.durationSec === null
    ? `${MODE_META[leg.mode].label} · —`
    : `${MODE_META[leg.mode].label} · 约 ${fmtDur(leg.durationSec / 60)}`
}

/** 相邻乘车段颜色去重的备用调色板（官方色缺失或撞色时按序轮换，保证视觉可分） */
export const FALLBACK_LINE_COLORS = ['#1677ff', '#e67e22', '#9b59b6', '#16a085', '#e74c3c']

/** 海报画布宽度（posterDraw 与 posterMap 共用 —— 唯一定义在原子层） */
export const W = 1080

/* ── 地图投影与底图（posterMap.ts 绘制、exportPosterFiles.ts 计算传入） ── */

/**
 * 地图投影（编排层算好传入）。
 * ★ **与底图无关** —— 底图加载失败也必须有投影，路线和标记照画（灰底上）。
 *   首版 `if (!base) return` 把路线一起丢了，用户截图抓到：地图区一片空白。
 */
export interface MapProjection {
  /**
   * **标准 Web 墨卡托 zoom**（`makeMercator` 直接吃这个数）。
   *
   * ★★ 不许把"请求高德时传的 zoom"塞进来 —— 两者差一档，见 `amapStaticZoom()`。
   */
  zoom: number
  centerLng: number
  centerLat: number
  /**
   * **画布像素 / 该 zoom 级墨卡托像素**（`toXY` 与底图绘制共用这一个数）。
   *
   * 当前口径（`loadBaseMap`）：`min(W/spanX, mapH/spanY) × MARGIN` ——
   * contain 式再乘 0.82，让点位区域占画布 82%、四周留 ~9%（标记 r=18 才不贴边）。
   *
   * ★★ 历史上这里写错过两次，两次都是"sank 到 2 倍/一半"的静默错误：
   * ① 把高德 `scale=2` 的图当成 1:1 用；② 高德静态图 zoom 比标准墨卡托大一档
   *    （见 `amapStaticZoom`）却按标准 zoom 算 —— 表现都是「路线和底图对不上」，
   *    而且**越远离中心偏得越多**，看起来像"用了另一张地图"。
   * ⇒ 底图的 drawImage 宽高与 `toXY` 必须共用这同一个 k，任何一处单独乘系数都会错。
   */
  k: number
}

/** 底图（加载失败传 null —— 灰底上照画路线） */
export interface BaseMap {
  image: HTMLImageElement
  /**
   * ★ 底图**覆盖的地理范围**，单位是 `MapProjection.zoom` 级墨卡托像素
   * （**不是图像实际像素**）。
   *
   * 为什么要分开：同一片区域可以请求成高分辨率图（`size` 放大 2^n、请求 zoom 同步 +n），
   * 此时图像像素 = `coverW × 2^n`。绘制一律用 `coverW × k` 摆图，源码里画整张，
   * 所以分辨率提升不影响对齐（2026-10-24 加的分辨率提升就是这么接的）。
   */
  coverW: number
  coverH: number
  /**
   * blob: 对象 URL —— 编排层画完必须 `revokeObjectURL`。
   * ★ 不 revoke 的话每次导出一张图就漏一份 blob 在内存里（导出是低频，但会累积）。
   */
  objectUrl?: string
}

/* ── Web 墨卡托投影（与高德/腾讯瓦片同一算法） ───────────────────── */

/**
 * ★★★ **高德静态图的 zoom 比标准 Web 墨卡托大一档**（同数字下放大 2 倍）。
 *
 * 2026-10-24 用一条纯水平折线标定（`_tmp/calib-amap*.mjs`，zoom 11~17 全档）：
 * 同样的经纬度跨度，高德画出来恒为 `makeMercator(z)` 算出的 **2.03 倍**宽
 * （多出的 0.03 = 8px 线宽占掉两端各 3.5px；线段中心线误差 ~1px）。
 * 换个说法：高德 `zoom=z` 的静态图，**1 图像px = 标准 `256×2^(z+1)` 世界里的 1px**。
 *
 * ⇒ **投影一律用标准 zoom**（`MapProjection.zoom`、`makeMercator`、`fitZoom` 都是），
 *   只在拼高德请求 URL 时减 1。写成常量而不是各处 `-1`：这档差一旦漏改，
 *   表现是「路线整体比底图小一半、越远离中心偏得越多」—— 看起来像"地图不对"，
 *   完全看不出是投影比例问题（2026-10-24 用户报的就是这个）。
 */
export const AMAP_STATIC_ZOOM_OFFSET = -1

/** 标准 zoom → 高德静态图 `zoom` 参数 */
export function amapStaticZoom(standardZoom: number): number {
  return standardZoom + AMAP_STATIC_ZOOM_OFFSET
}

export interface Mercator {
  /** 该 zoom 下的世界总像素（256 × 2^zoom） */
  worldPx: number
  lngToX: (lng: number) => number
  latToY: (lat: number) => number
}

export function makeMercator(zoom: number): Mercator {
  const worldPx = 256 * 2 ** zoom
  return {
    worldPx,
    lngToX: (lng) => ((lng + 180) / 360) * worldPx,
    latToY: (lat) => {
      // 标准墨卡托：等角纬度公式，clamp 到 ±85.05°（Web 墨卡托边界）
      const clamped = Math.max(-85.0511, Math.min(85.0511, lat))
      const rad = (clamped * Math.PI) / 180
      return (worldPx / 2) * (1 - Math.log(Math.tan(Math.PI / 4 + rad / 2)) / Math.PI)
    },
  }
}

/**
 * 由 bbox 反推**整数 zoom**（floor 保证框得住）。
 * 纵向按"框内最北纬度的墨卡托像素高 ≤ 视高"判 —— 小范围行程这样近似够用。
 */
export function fitZoom(
  bbox: { minLng: number; maxLng: number; minLat: number; maxLat: number },
  viewW: number,
  viewH: number,
  padRatio = 0.3,
): number {
  const w = Math.max(bbox.maxLng - bbox.minLng, 1e-5) * (1 + padRatio)
  const h = Math.max(bbox.maxLat - bbox.minLat, 1e-5) * (1 + padRatio)
  for (let z = 17; z >= 3; z--) {
    const world = 256 * 2 ** z
    const pxW = (w / 360) * world
    // 纵向：bbox 上下缘的墨卡托 y 差
    const m = makeMercator(z)
    const pxH = Math.abs(m.latToY(bbox.minLat) - m.latToY(bbox.maxLat)) * (1 + padRatio)
    if (pxW <= viewW && pxH <= viewH) return z
  }
  return 3
}
