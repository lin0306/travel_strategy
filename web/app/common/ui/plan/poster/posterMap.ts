/**
 * 海报**地图绘制** —— 底图 + 路线（公交分段异色/换乘节点/方向箭头）+ 标记。
 * 从 `posterDraw.ts` 拆出（护栏 G：单文件 ≤420 行）。
 *
 * ## 绘制口径（2026-10-17 用户定：「每条路线都用不同的颜色」）
 * - **每条 leg 专属色**（调色板按段序轮换，相邻必不同色）—— 不再按交通方式着色；
 *   地图的线、方向箭头、清单的色点三处同色。
 * - **法向微偏移**（按段序 -3/0/+3px 轮换）：重叠的 leg 错开。
 * - 公交段的**换乘点**白底小圆（标出在哪里换乘）；每条 leg 带方向箭头。
 *
 * ## 半透明 + 层级（2026-10-24 用户改）
 * - **轨迹线半透明**：底图的道路、地名要能透出来（2026-10-17 曾以「混色」为由否决，
 *   用户看实际成图后要回来了 —— 混色在这里是可接受的代价，看不清底图才是问题）。
 * - **越早的段在越上层**：`d.legs` **逆序**落笔 ⇒ 第 1 段最后画、压在最上面。
 */

import {
  C,
  font,
  makeMercator,
  W,
  type BaseMap,
  type MapProjection,
  type Mercator,
  type PosterDayData,
} from './posterAtom'

/** 点标记半径（2026-10-17 用户报「点太大了，都占位了」—— 从 28 缩到 18） */
const MARK_R = 18

/**
 * 线段不透明度。
 * ★ 白边（衬底）比彩线更透：它只负责把线从底图上"分离"出来，太实会把压在下层的
 *   段整条切死（层级就看不出来了）。
 */
const LEG_ALPHA = 0.8
const CASING_ALPHA = 0.5


export function drawMap(
  g: CanvasRenderingContext2D,
  d: PosterDayData,
  proj: MapProjection,
  base: BaseMap | null,
  y: number,
  mapH: number,
): void {
  // 无底图时给浅灰底 —— 不许白板（底图加载失败也要有"地图区"的形状）
  g.fillStyle = '#eef1f4'
  g.fillRect(0, y, W, mapH)

  const { zoom, centerLng, centerLat, k } = proj
  const m: Mercator = makeMercator(zoom)
  const cx = m.lngToX(centerLng)
  const cy = m.latToY(centerLat)

  // 底图：覆盖范围 = center ± (coverW/2) 个 zoom 级墨卡托像素（`coverW` 就是墨卡托px，
  // 不是图像像素 —— 高分辨率请求时图像像素更多，源码整张画进这个矩形即可）。
  // drawImage 位移 = 底图**左上角**的画布坐标 = W/2 - (coverW/2)*k
  // —— 首版写成 W/2 - cx*k（墨卡托世界原点，-313 万 px），整张图被画到画布外，
  //    表现为"底图不显示"但路线正常。
  if (base) {
    g.drawImage(
      base.image,
      W / 2 - (base.coverW / 2) * k,
      y + mapH / 2 - (base.coverH / 2) * k,
      base.coverW * k,
      base.coverH * k,
    )
  }

  // 经纬度 → 画布像素（与底图同投影、同缩放 —— 对齐靠 center/zoom/k 三要素）
  const toXY = (lng: number, lat: number): [number, number] => [
    W / 2 + (m.lngToX(lng) - cx) * k,
    y + mapH / 2 + (m.latToY(lat) - cy) * k,
  ]

  /**
   * **法向微偏移**（用户 2026-10-17：「有些路线重叠了，叠在一起看不出来哪里到哪里」）：
   * 把折线的每个点沿"局部行进方向的法线"平移 `off` 像素 —— 同一条路上的两条 leg
   * （偏移 -3 / 0 / +3 轮换）就错开 6px，各自可辨。
   */
  const offsetPolyline = (
    pts: Array<[number, number]>,
    off: number,
  ): Array<[number, number]> => {
    // ★★ 必须先转画布坐标**再**判 off —— 首版写成 `if (off === 0) return pts`，
    //    返回的是**经纬度**（104, 30），`strokePts` 当像素画 ⇒ 该段落到画布左上角外，
    //    表现为「这一段路线凭空消失」。而 off 为 0 正是段序 i%3===1 的第 2、5、8… 段，
    //    所以**只要有两段以上就必有一段画不出来**（2026-10-24 离屏验证抓到的）。
    const cpts = pts.map(([lng, lat]) => toXY(lng, lat))
    if (off === 0 || cpts.length < 2) return cpts
    return cpts.map((p, i) => {
      const a = cpts[Math.max(0, i - 1)]
      const b = cpts[Math.min(cpts.length - 1, i + 1)]
      if (!a || !b) return p
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const len = Math.hypot(dx, dy) || 1
      return [p[0] + (-dy / len) * off, p[1] + (dx / len) * off] as [number, number]
    })
  }

  // 路线：有 path 画道路形状，没有画直线（白边垫底 + 段色）
  const strokePts = (pts: Array<[number, number]>) => {
    if (pts.length < 2) return
    g.beginPath()
    pts.forEach(([x, yy], i) => {
      if (i === 0) g.moveTo(x, yy)
      else g.lineTo(x, yy)
    })
    g.stroke()
  }

  /** 方向箭头：画在折线 ~60% 处（用户：「没办法看出来怎么走」—— 方向感靠它） */
  const drawArrow = (pts: Array<[number, number]>, color: string) => {
    if (pts.length < 2) return
    const idx = Math.max(1, Math.floor(pts.length * 0.6))
    const a = pts[idx - 1]
    const b = pts[idx]
    if (!a || !b) return
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0])
    g.save()
    g.translate(b[0], b[1])
    g.rotate(ang)
    g.beginPath()
    g.moveTo(9, 0)
    g.lineTo(-7, 5.5)
    g.lineTo(-7, -5.5)
    g.closePath()
    g.fillStyle = color
    g.fill()
    g.lineWidth = 2
    g.strokeStyle = C.white
    g.stroke()
    g.restore()
  }

  g.lineJoin = 'round'
  g.lineCap = 'round'
  /**
   * ★★ **逆序落笔** ⇒ 越早的段越在上层：第 1 段最后画、压在最上面；末段最先画、沉在最下。
   * 段色/箭头/偏移量一律仍按**原段序** `i` 取（绘制顺序变了，配色与错位不能跟着变，
   * 否则与清单里的色点对不上）。
   */
  for (let i = d.legs.length - 1; i >= 0; i--) {
    const leg = d.legs[i]
    if (!leg) continue
    // ★ 每条 leg 专属颜色（调色板按段序轮换，相邻必不同色）+ 按序号法向微偏移
    //（重叠的 leg 错开 ±3px —— 与半透明并用：错开可辨、叠压可读）
    const off = ((i % 3) - 1) * 3
    const pts: Array<[number, number]> | null =
      leg.path ??
      (() => {
        const from = d.stops[i]
        const to = d.stops[i + 1]
        return from && to ? ([[from.lng, from.lat], [to.lng, to.lat]] as Array<[number, number]>) : null
      })()
    if (!pts) continue
    const shifted = offsetPolyline(pts, off)
    for (const pass of [
      { color: C.white, width: 12, alpha: CASING_ALPHA },
      { color: leg.color, width: 7, alpha: LEG_ALPHA },
    ]) {
      g.globalAlpha = pass.alpha
      g.strokeStyle = pass.color
      g.lineWidth = pass.width
      strokePts(shifted)
    }
    // 箭头保持不透明 —— 它是符号不是轨迹，方向感优先
    g.globalAlpha = 1
    drawArrow(shifted, leg.color)
  }
  g.globalAlpha = 1

  // 标记：白底主色环序号 + 住宿墨色「宿」（半径 18 —— 用户报 28「都占位了」）
  const marks: Array<{ x: number; yy: number; label: string; stay: boolean }> = d.stops.map(
    (s) => {
      const [x, yy] = toXY(s.lng, s.lat)
      return { x, yy, label: String(s.seq), stay: false }
    },
  )
  if (d.stayPoint) {
    const [x, yy] = toXY(d.stayPoint.lng, d.stayPoint.lat)
    marks.push({ x, yy, label: '宿', stay: true })
  }
  for (const mk of marks) {
    g.beginPath()
    g.arc(mk.x, mk.yy, MARK_R, 0, Math.PI * 2)
    g.fillStyle = mk.stay ? C.ink : C.white
    g.fill()
    g.lineWidth = 4
    g.strokeStyle = mk.stay ? C.ink : C.primary
    g.stroke()
    g.fillStyle = mk.stay ? C.white : C.primary
    g.font = font(700, 19)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(mk.label, mk.x, mk.yy + 1)
    g.textAlign = 'left'
    g.textBaseline = 'alphabetic'
  }
}
