/**
 * 自研标注避让 —— 腾讯唯一的能力短板。
 *
 * 高德有 `LabelsLayer({ collision: true })` 开箱即用的避让，**腾讯没有**。
 * 46 个 POI 在 zoom 12–14 会出现大面积叠字。
 *
 * ## 核心洞察
 * **避让只需要管文字，图标本身可以重叠** —— 用户能看出"这里有两个点"就够了，
 * 文字糊成一团才是真的读不了。所以这个文件只决定"哪些标注该显示"，不碰图标。
 *
 * ## 两个手段叠加
 * 1. **密度控制**：按 zoom 档位限制同时显示的标注数量上限（低 zoom 只显示高热度点）
 *    —— 档位表不在本文件里，在 `zoomTiers.ts`（唯一出处）
 * 2. **贪心避让**：按热度降序遍历，逐个做矩形相交检测，撞了就跳过
 *
 * 投影用本地 Web Mercator 数学算像素坐标，**不依赖任何未验证的 SDK 投影 API** ——
 * 这样这套逻辑可以脱离地图实例单测，也符合"时间/几何计算与地图解耦"的整体取向。
 *
 * ## 这里的几何件是**共用的**
 * `rectsIntersect` 不只服务标注：`districtLayer` 的窄屏徽标避让用的是同一个。
 * 两处各写一份会立刻分叉 —— 一边修了碰撞间距、另一边没修。
 *
 * ★ `projectToPixel` 与"视野"本身已经搬到 `viewport.ts`（2026-09-20）：
 *   它们早就不只服务标注（撒点去重、揭示判据都在用），留在这里会让人以为
 *   改它们只影响标注。本文件现在只管**避让**这一件事。
 */

import { labelCapForZoom } from './zoomTiers'
import { projectToPixel, type Viewport } from './viewport'

export interface LabelCandidate {
  id: string
  name: string
  lng: number
  lat: number
  /**
   * ★ 必填（契约层已强制 0–100）。
   * 缺了热度的点在低 zoom 下**永远不会显示标注** —— 所以 schema 里它是必填而非可选。
   */
  popularity: number
}

/** 屏幕像素矩形（相对视口左上角）。标注、徽标避让共用 */
export interface PlacedRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 矩形相交（含呼吸间距，避免文字紧贴）。
 *
 * ★ 导出给 `districtLayer` 的徽标避让复用 —— 两处各写一份会分叉。
 */
export function rectsIntersect(a: PlacedRect, b: PlacedRect, pad: number): boolean {
  return !(
    a.x + a.w + pad < b.x ||
    b.x + b.w + pad < a.x ||
    a.y + a.h + pad < b.y ||
    b.y + b.h + pad < a.y
  )
}

export interface PickLabelsOptions {
  /** 标注相对点位的纵向偏移（px）。默认放在点位上方 */
  offsetY?: number
  /** 呼吸间距（px） */
  pad?: number
  /** 已占用的区域（例如浮层盖住的部分），标注不应落进去 */
  occupied?: PlacedRect[]
}

/**
 * 选出当前视野内应该显示哪些标注。
 *
 * @returns 应显示标注的 id 集合。调用方据此 `setGeometries` 到 `MultiLabel`。
 */
export function pickVisibleLabels(
  candidates: LabelCandidate[],
  view: Viewport,
  opts: PickLabelsOptions = {},
): Set<string> {
  const cap = labelCapForZoom(view.zoom)
  if (cap === 0) return new Set()

  const fontSize = view.fontSize ?? 12
  const offsetY = opts.offsetY ?? -22
  const pad = opts.pad ?? 4

  // ① 热度降序 —— 低 zoom 下高热度点必须优先出现
  const ordered = [...candidates].sort((a, b) => b.popularity - a.popularity)

  const placed: PlacedRect[] = [...(opts.occupied ?? [])]
  const shown = new Set<string>()

  for (const p of ordered) {
    if (shown.size >= cap) break

    const { x, y } = projectToPixel(p, view)
    // 视口外的直接跳过（省掉一次相交检测；也让"当前可见"的语义更准）
    if (x < -100 || y < -100 || x > view.width + 100 || y > view.height + 100) continue

    // 中文按 1 字宽 ≈ fontSize 估算；再加 padding 与一点富余
    const w = p.name.length * fontSize + 12
    const h = fontSize + 8
    // 文字框锚点在点位上方居中
    const rect: PlacedRect = { x: x - w / 2, y: y + offsetY - h / 2, w, h }

    if (placed.some((r) => rectsIntersect(r, rect, pad))) continue // 撞了就跳过

    placed.push(rect)
    shown.add(p.id)
  }

  return shown
}

/**
 * 把浮层占位换算成"标注禁区"。
 *
 * 与 fitView 的分工：fitView 管**视野**（点位别被压住），这里管**标注**
 * （文字别被压住）。两者都读同一批浮层元素，但一个改 padding、一个改标注集合。
 */
export function overlaysToOccupied(
  container: HTMLElement,
  overlays: Array<HTMLElement | null>,
): PlacedRect[] {
  const cr = container.getBoundingClientRect()
  const scale = container.offsetWidth ? cr.width / container.offsetWidth : 1
  const out: PlacedRect[] = []

  for (const el of overlays) {
    if (!el || !el.isConnected) continue
    const cs = window.getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) continue
    out.push({
      x: (r.left - cr.left) / scale,
      y: (r.top - cr.top) / scale,
      w: r.width / scale,
      h: r.height / scale,
    })
  }

  return out
}
