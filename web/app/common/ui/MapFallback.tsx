/**
 * 降级画布 —— 地图 SDK 不可用时的替代渲染。
 *
 * ## 🚨 合规红线（这个文件是它的落点之一）
 * **绝不绘制任何行政区划边界。** 不画省界、不画国界、不画"中国轮廓"，
 * 一张也不行 —— 哪怕是"示意"。
 *
 * 原因和 `districtLayer.ts` 一样：中国地图的边界涉及**国家版图完整性**
 * （台湾省、藏南、南海诸岛的表达）。一张手绘的简化轮廓几乎必然画错，
 * 而它一旦出现在页面上，就是在以地图的形式做错误表述。
 *
 * 所以这里只画**不表达版图**的事物：河流、环线、绿地、区块。它们传达的是
 * "这是一座城市"，而不是"这是中国的哪一部分"。
 *
 * ## 为什么保留它而不是显示"地图加载失败"
 * 点位、筛选、列表在没地图时全都可用。把点位坐标投影到一张示意画布上，
 * 用户依然能看出"这几个点在城西、那几个在城南" —— 这个**相对位置信息**
 * 是真实且有价值的，比一张纯错误卡片有用得多。
 */

import { useMemo } from 'react'

export interface FallbackPin {
  id: string
  lng: number
  lat: number
  /** 细类色（12 色）。注意：这里传的是 subtype 的颜色，不是大类的 */
  color: string
  label?: string
  /** 行程页的顺序标记（① ② ③…）。有值时画成圆点而不是针尖 */
  seq?: number
}

export interface FallbackLeg {
  from: { lng: number; lat: number }
  to: { lng: number; lat: number }
  /** 步行段用虚线 —— 线型本身携带语义 */
  dashed?: boolean
  /** 拥堵段：叠一条醒目色细线。**只在用户真拉过路况时才有值** */
  jam?: 'slow' | 'jam'
}

export interface FallbackStay {
  name: string
  lng: number
  lat: number
}

export interface MapFallbackProps {
  pins: FallbackPin[]
  legs?: FallbackLeg[]
  stay?: FallbackStay | null
  /** 画布宽高比。默认 16:9 */
  aspect?: number
  className?: string
}

const VIEW_W = 1000

/**
 * 简单等距投影（经纬度 → viewBox 坐标）。
 *
 * 刻意用**线性投影 + 纬度余弦修正**而不是墨卡托：示意画布不需要保角，
 * 只需要"相对位置对"。墨卡托在单城尺度上看不出差别，却多一堆代码。
 */
function makeProjector(pins: Array<{ lng: number; lat: number }>, w: number, h: number) {
  if (pins.length === 0) return null

  const lngs = pins.map((p) => p.lng)
  const lats = pins.map((p) => p.lat)
  let x0 = Math.min(...lngs)
  let x1 = Math.max(...lngs)
  let y0 = Math.min(...lats)
  let y1 = Math.max(...lats)

  // 单点或共线时给一个最小跨度，否则 scale 会除零
  const padX = Math.max((x1 - x0) * 0.18, 0.01)
  const padY = Math.max((y1 - y0) * 0.18, 0.01)
  x0 -= padX
  x1 += padX
  y0 -= padY
  y1 += padY

  const midLat = (y0 + y1) / 2
  // 经度方向按纬度压缩：不做的话中纬度城市会显得横向被拉长
  const kx = Math.cos((midLat * Math.PI) / 180)

  const spanX = (x1 - x0) * kx
  const spanY = y1 - y0
  const scale = Math.min(w / spanX, h / spanY)
  const offX = (w - spanX * scale) / 2
  const offY = (h - spanY * scale) / 2

  return (lng: number, lat: number) => ({
    // y 轴翻转：纬度越大越靠北，屏幕坐标越靠上
    x: offX + (lng - x0) * kx * scale,
    y: offY + (y1 - lat) * scale,
  })
}

export function MapFallback({ pins, legs = [], stay = null, aspect = 16 / 9, className }: MapFallbackProps) {
  const H = Math.round(VIEW_W / aspect)

  const all = useMemo(() => {
    const pts = pins.map((p) => ({ lng: p.lng, lat: p.lat }))
    if (stay) pts.push({ lng: stay.lng, lat: stay.lat })
    for (const l of legs) pts.push(l.from, l.to)
    return pts
  }, [pins, stay, legs])

  const project = useMemo(() => makeProjector(all, VIEW_W, H), [all, H])

  return (
    <svg
      className={className}
      viewBox={`0 0 ${VIEW_W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      style={{ display: 'block', width: '100%', height: '100%' }}
    >
      {/* 底色：绿地与浅灰区块 —— 只表达"城市肌理"，不表达任何行政范围 */}
      <rect width={VIEW_W} height={H} fill="#EEF1F4" />
      <g opacity="0.55">
        <ellipse cx={VIEW_W * 0.24} cy={H * 0.3} rx={VIEW_W * 0.16} ry={H * 0.2} fill="#DCE7DB" />
        <ellipse cx={VIEW_W * 0.78} cy={H * 0.72} rx={VIEW_W * 0.13} ry={H * 0.16} fill="#DCE7DB" />
      </g>

      {/* 环线：同心圆 —— 城市形态的通用语汇，不含任何边界语义 */}
      <g fill="none" stroke="#D5DAE0" strokeWidth="2">
        <circle cx={VIEW_W * 0.5} cy={H * 0.52} r={H * 0.42} />
        <circle cx={VIEW_W * 0.5} cy={H * 0.52} r={H * 0.28} />
        <circle cx={VIEW_W * 0.5} cy={H * 0.52} r={H * 0.15} />
      </g>

      {/* 河流：一条贯穿的曲线，让画面有"地理感" */}
      <path
        d={`M0,${H * 0.63} C ${VIEW_W * 0.22},${H * 0.6} ${VIEW_W * 0.34},${H * 0.44} ${VIEW_W * 0.52},${H * 0.44}
            S ${VIEW_W * 0.8},${H * 0.3} ${VIEW_W},${H * 0.36}`}
        fill="none"
        stroke="#CFE0EE"
        strokeWidth="12"
        strokeLinecap="round"
      />

      {/* ── 行程连线：逐段画，与真实图层同一套语义（虚线 = 步行、叠色 = 拥堵） ── */}
      {project &&
        legs.map((l, i) => {
          const a = project(l.from.lng, l.from.lat)
          const b = project(l.to.lng, l.to.lat)
          const d = `M${a.x.toFixed(1)},${a.y.toFixed(1)} L${b.x.toFixed(1)},${b.y.toFixed(1)}`
          return (
            <g key={`leg-${i}`}>
              <path
                d={d}
                fill="none"
                stroke="#161A22"
                strokeWidth="3"
                strokeLinecap="round"
                opacity="0.8"
                {...(l.dashed ? { strokeDasharray: '9 7' } : {})}
              />
              {/* ★ 拥堵描色**只在该段真拉过路况时**才画 —— 没拉过就画等于编路况 */}
              {l.jam ? (
                <path
                  d={d}
                  fill="none"
                  stroke={l.jam === 'jam' ? '#F5222D' : '#FA8C16'}
                  strokeWidth="2.4"
                  strokeLinecap="round"
                />
              ) : null}
            </g>
          )
        })}

      {/* ── 住宿点：形状与普通点位不同（它是锚，不是第 13 个细类） ── */}
      {project && stay
        ? (() => {
            const q = project(stay.lng, stay.lat)
            return (
              <g transform={`translate(${q.x.toFixed(1)},${q.y.toFixed(1)})`}>
                <path
                  d="M0,0 C0,0 -13,-13 -13,-21 A13,13 0 1,1 13,-21 C13,-13 0,0 0,0 Z"
                  fill="#161A22"
                  stroke="#FFFFFF"
                  strokeWidth="2.2"
                />
                <rect x="-5" y="-26" width="10" height="8" rx="1.5" fill="#FFFFFF" />
              </g>
            )
          })()
        : null}

      {/* ── 点位 ── */}
      {project &&
        pins.map((p) => {
          const q = project(p.lng, p.lat)
          if (p.seq !== undefined) {
            return (
              <g key={p.id} transform={`translate(${q.x.toFixed(1)},${q.y.toFixed(1)})`}>
                <circle r="14" fill="#161A22" stroke="#FFFFFF" strokeWidth="2.4" />
                <text
                  y="5"
                  textAnchor="middle"
                  fontSize="15"
                  fontWeight="600"
                  fill="#FFFFFF"
                  fontFamily="-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif"
                >
                  {p.seq <= 9 ? p.seq : '·'}
                </text>
              </g>
            )
          }
          return (
            <g key={p.id} transform={`translate(${q.x.toFixed(1)},${q.y.toFixed(1)})`}>
              <path
                d="M0,0 C0,0 -11,-11 -11,-18 A11,11 0 1,1 11,-18 C11,-11 0,0 0,0 Z"
                fill={p.color}
                stroke="#FFFFFF"
                strokeWidth="2"
              />
              <circle cy="-18" r="3.6" fill="#FFFFFF" />
            </g>
          )
        })}
    </svg>
  )
}
