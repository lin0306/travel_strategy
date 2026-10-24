/**
 * 行程海报的**组合层** —— 头部 / 地图 / 时间轴清单 / 统计 / 落款。
 * 原子（色板/格式化/墨卡托）在 `posterAtom.ts`；导出编排在 `exportPosterFiles.ts`。
 *
 * ## 产品形态（2026-10-17 用户三轮定稿）
 * 每天一张竖版海报：① 高德静态图底图（带 CORS 可进 canvas；腾讯不带）+ 真实道路
 * 路径（腾讯 direction 方案，与行程页同源；**公交分段异色 + 换乘节点**）；
 * ② 纯白时间轴清单（公交段带「线路链」说明）+ 统计 + 落款。宽 1080，高自适应。
 * 底部文字一律**类提示样式**（小号/灰/不加粗）。到达时间缺段显示「—」（红线 10）。
 */

import {
  C,
  fmtClock,
  fmtDur,
  font,
  legLabel,
  W,
  type BaseMap,
  type MapProjection,
  type PosterDayData,
  type PosterLeg,
  type PosterStop,
} from './posterAtom'
import { drawMap } from './posterMap'

/* ── 布局常量（W 在 posterAtom；地图投影/底图类型也在 atom） ─────── */

const HEAD_H = 176
const PAD = 48
const MAP_H_MIN = 420
const MAP_H_MAX = 1400
const ROW_H = 104
/** 段标签行高：普通段 56；公交段带「线路链」说明 88（两行小字） */
const LEG_H = 56
const TRANSIT_LEG_H = 88
const STAT_H = 88
const FOOT_H = 64
const RAIL_X = 94

/* ── 地图区高度（唯一公式） ────────────────────────────────────── */

/** 导出编排层要**提前**知道这个高来定底图请求尺寸（两份公式 = 清单错位，绝不分写）。 */
export function mapHeightOf(d: PosterDayData): number {
  const pts = d.stayPoint ? [...d.stops, d.stayPoint] : d.stops
  if (pts.length === 0) return MAP_H_MIN
  const lngs = pts.map((p) => p.lng)
  const lats = pts.map((p) => p.lat)
  // 把路径点也算进框（道路可能拐出两端点连线之外）
  for (const leg of d.legs) {
    if (!leg.path) continue
    for (const [lng, lat] of leg.path) {
      lngs.push(lng)
      lats.push(lat)
    }
  }
  const cx = Math.cos((((Math.min(...lats) + Math.max(...lats)) / 2) * Math.PI) / 180)
  const bw = Math.max(Math.max(...lngs) - Math.min(...lngs), 1e-5) * cx * 1.3
  const bh = Math.max(Math.max(...lats) - Math.min(...lats), 1e-5) * 1.3
  const rawH = (W * bh) / bw
  return Math.round(Math.min(MAP_H_MAX, Math.max(MAP_H_MIN, rawH)))
}

/* ── 头部 ──────────────────────────────────────────────────────── */

function drawHead(g: CanvasRenderingContext2D, d: PosterDayData): void {
  g.fillStyle = C.white
  g.fillRect(0, 0, W, HEAD_H)

  g.fillStyle = C.ink
  g.font = font(700, 58)
  g.textBaseline = 'alphabetic'
  g.fillText(d.cityName, PAD, 100)

  g.fillStyle = C.primary
  g.font = font(600, 38)
  const dayLabel = `第 ${d.dayNo} 天`
  g.fillText(dayLabel, W - PAD - g.measureText(dayLabel).width, 98)

  g.fillStyle = C.ink3
  g.font = font(400, 26)
  g.fillText(`${d.stops.length} 个点位`, PAD, 148)
  const ratio = `${d.dayNo} / ${d.dayCount}`
  g.fillText(ratio, W - PAD - g.measureText(ratio).width, 148)

  g.fillStyle = C.line
  g.fillRect(0, HEAD_H - 2, W, 2)
}

/* ── 时间轴清单 ────────────────────────────────────────────────── */

function drawRowText(g: CanvasRenderingContext2D, s: PosterStop, cy: number): void {
  g.fillStyle = C.ink
  g.font = font(600, 32)
  let name = s.name
  const maxW = W - PAD - 32 - RAIL_X - 260
  while (g.measureText(name).width > maxW && name.length > 2) name = name.slice(0, -2)
  if (name !== s.name) name += '…'
  g.fillText(name, RAIL_X + 58, cy + 2)

  g.font = font(400, 26)
  g.textAlign = 'right'
  g.fillStyle = s.arriveMin === null ? C.ink3 : C.ink2
  g.fillText(s.arriveMin === null ? '—' : fmtClock(s.arriveMin), W - PAD, cy - 4)
  g.fillStyle = C.ink3
  g.fillText(s.dwellMin === null ? '' : `停留 ${fmtDur(s.dwellMin)}`, W - PAD, cy + 30)
  g.textAlign = 'left'
}

function drawSeqBadge(g: CanvasRenderingContext2D, seq: number, cy: number): void {
  g.beginPath()
  g.arc(RAIL_X, cy, 28, 0, Math.PI * 2)
  g.fillStyle = C.white
  g.fill()
  g.lineWidth = 5
  g.strokeStyle = C.primary
  g.stroke()
  g.fillStyle = C.primary
  g.font = font(700, 28)
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(String(seq), RAIL_X, cy + 1)
  g.textAlign = 'left'
  g.textBaseline = 'alphabetic'
}

/** 段标签区高度：公交段带「线路链」说明更高 */
function legLabelH(leg: PosterLeg | undefined): number {
  return leg?.lineItems ? TRANSIT_LEG_H : LEG_H
}

/** 段标签：主行（方式+时长）；公交段下方加**色点 + 线路链**（色点=地图段色，一一对应） */
function drawLegLabel(
  g: CanvasRenderingContext2D,
  leg: PosterLeg,
  y: number,
): number {
  const h = legLabelH(leg)
  g.strokeStyle = '#dbe0e8'
  g.lineWidth = 3
  g.setLineDash([2, 8])
  g.beginPath()
  g.moveTo(RAIL_X, y)
  g.lineTo(RAIL_X, y + h)
  g.stroke()
  g.setLineDash([])

  // ★ 行首色点 = 本段在地图上的颜色（每条路线一个颜色，三处同色：线/箭头/色点）
  g.beginPath()
  g.arc(RAIL_X + 31, y + h / 2, 5, 0, Math.PI * 2)
  g.fillStyle = leg.color
  g.fill()

  g.fillStyle = C.ink3
  g.font = font(400, 24)
  g.fillText(legLabel(leg), RAIL_X + 44, y + h / 2 + (leg.lineItems ? -8 : 8))
  if (leg.lineItems && leg.lineItems.length > 0) {
    // 第二行：线路链文字（公交段：坐哪几趟，如「661路A线 → 地铁3号线」）
    g.font = font(400, 20)
    let summary = leg.lineItems.join(' → ')
    const maxW = W - PAD - 32 - RAIL_X - 44
    while (g.measureText(summary).width > maxW && summary.length > 2) summary = summary.slice(0, -2)
    if (summary !== leg.lineItems.join(' → ')) summary += '…'
    g.fillStyle = C.ink3
    g.fillText(summary, RAIL_X + 44, y + h / 2 + 25)
  }
  return y + h
}

/* ── 统计与落款（类提示文字：小号、灰、不加粗） ─────────────────── */

function drawStats(g: CanvasRenderingContext2D, d: PosterDayData, y: number): number {
  g.fillStyle = C.white
  g.fillRect(0, y, W, STAT_H)
  g.fillStyle = C.line
  g.fillRect(0, y, W, 2)

  const withDur = d.legs.filter((l) => l.durationSec !== null)
  const transitMin = withDur.reduce((n, l) => n + (l.durationSec ?? 0) / 60, 0)
  const anyEstimated = d.legs.some((l) => l.estimated)
  const missingPath = d.legs.some((l) => l.path === null)
  const parts = [`共 ${d.stops.length} 站`]
  if (withDur.length > 0) parts.push(`路上约 ${fmtDur(transitMin)}`)
  if (anyEstimated) parts.push('时长含估算')
  if (missingPath) parts.push('部分路段为直线示意')

  // ★ 类提示文字：26px / 400 / ink3 —— 不加粗、不抢正文
  g.fillStyle = C.ink3
  g.font = font(400, 26)
  g.fillText(parts.join(' · '), PAD, y + STAT_H / 2 + 9)
  return y + STAT_H
}

function drawFoot(g: CanvasRenderingContext2D, totalH: number): void {
  const y = totalH - FOOT_H
  g.fillStyle = C.white
  g.fillRect(0, y, W, FOOT_H)
  g.fillStyle = C.line
  g.fillRect(0, y, W, 2)

  // ★ 提示样式：两侧都 400 不加粗
  g.fillStyle = C.ink3
  g.font = font(400, 24)
  g.fillText('行迹 · 城市旅游攻略', PAD, y + FOOT_H / 2 + 8)
  const date = new Date()
  const ds = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  g.textAlign = 'right'
  g.fillText(`生成于 ${ds}`, W - PAD, y + FOOT_H / 2 + 8)
  g.textAlign = 'left'
}

/* ── 入口 ──────────────────────────────────────────────────────── */

/**
 * 画一整张海报到 `canvas`。`base` 为底图（加载失败传 null —— 灰底上**照画路线和标记**）。
 * 返回画布尺寸（调用方不需要自己算高）。
 */
export function drawDayPoster(
  canvas: HTMLCanvasElement,
  d: PosterDayData,
  proj: MapProjection,
  base: BaseMap | null,
): { width: number; height: number } {
  const g = canvas.getContext('2d')
  if (!g) throw new Error('canvas 2d 上下文不可用')

  const mapH = mapHeightOf(d)
  // 清单总高：段标签区按各段实际高度算（公交段带线路链更高）
  const legsH = d.legs.reduce((n, leg) => n + legLabelH(leg), 0)
  const listH = d.stops.length * ROW_H + legsH + PAD * 2
  const totalH = HEAD_H + mapH + listH + STAT_H + FOOT_H

  canvas.width = W
  canvas.height = totalH

  // 下段整块纯白（清单/统计/落款同色系，与上段地图形成分层）
  g.fillStyle = C.white
  g.fillRect(0, 0, W, totalH)

  drawHead(g, d)
  drawMap(g, d, proj, base, HEAD_H, mapH)

  let y = HEAD_H + mapH + PAD
  d.stops.forEach((s, i) => {
    const isLast = i === d.stops.length - 1
    const cy = y + ROW_H / 2
    g.strokeStyle = '#dbe0e8'
    g.lineWidth = 3
    g.beginPath()
    g.moveTo(RAIL_X, y)
    g.lineTo(RAIL_X, isLast ? cy : y + ROW_H)
    g.stroke()

    drawSeqBadge(g, s.seq, cy)
    drawRowText(g, s, cy)
    y += ROW_H

    if (!isLast) {
      const leg = d.legs[i]
      if (leg) y = drawLegLabel(g, leg, y)
    }
  })

  drawStats(g, d, y)
  drawFoot(g, totalH)

  return { width: W, height: totalH }
}
