/**
 * 通用标记图层 —— 给「不是 POI」的点位用（行程的序号圆点、住宿旗标）。
 *
 * ## 为什么不复用 `poiLayer`
 * `poiLayer` 的样式名是**从 subtype 推出来的**（`sub-<subtype>`），因为它要保证
 * "颜色只跟细类走"。而行程页的标记是另一套语义：
 * - 序号圆点表达的是**顺序**，与类型无关
 * - 住宿旗标是**锚点**，不是第 13 个细类
 *
 * 硬塞进 `poiLayer` 就需要给 `PoiPoint` 加一个"绕过 subtype"的口子 ——
 * 那个口子迟早会被误用成"用大类拼样式名"（会静默掉图标）。所以独立一层更安全。
 *
 * ## 样式表复用
 * 具体的 SVG 与尺寸仍来自 `poiStyles.buildMarkerStyles()` —— 一个 marker 长什么样
 * 只应该定义一次。那套样式表在 `poiStyles.ts`，不在 `poiLayer.ts`：
 * 后者管"什么时候挂哪一层、按缩放给多少个"，本文件只需要"形状长什么样"。
 */

import { buildMarkerStyles } from './poiStyles'
import { createTapGuard } from './tapGuard'
import { Z_LAYER } from './zLayers'

export interface MarkerItem {
  id: string
  /** ★ 必须是样式表里真实存在的名字（`seq1`…`seq9` / `stay` / `sub-<subtype>`） */
  styleId: string
  lng: number
  lat: number
}

export interface MarkerLayerHandle {
  set(items: MarkerItem[]): void
  clear(): void
  destroy(): void
}

export interface MarkerLayerOptions {
  zIndex?: number
  onClick?: (id: string) => void
  onHover?: (id: string | null) => void
}

export function createMarkerLayer(map: TMap.Map, opts: MarkerLayerOptions = {}): MarkerLayerHandle {
  const markers = new TMap.MultiMarker({
    map,
    styles: buildMarkerStyles(),
    geometries: [],
    zIndex: opts.zIndex ?? Z_LAYER.genericMarker,
  })
  /**
   * ★★ 「拖地图不算点击」—— 判据的唯一出处是 `tapGuard`（聚合层 / 景点层 / 区域层
   * 用的是同一套）。拖动是"按在某个东西上开始"的，起点压在标记上时 SDK 照样
   * 把这一下当成"点中了它"。
   */
  const tap = createTapGuard(map)

  if (opts.onClick) {
    markers.on('click', (evt) => {
      // ★ 拖地图不算点击（判据见 tapGuard）
      if (!tap.isTap()) return
      const id = evt.geometry?.id
      if (id) opts.onClick?.(id)
    })
  }
  // ⚠️ 事件名是 `hover`（离开时 geometry 为 null）—— 详见 tmap.d.ts 的事件名对照表
  if (opts.onHover) {
    markers.on('hover', (evt) => opts.onHover?.(evt.geometry?.id ?? null))
  }

  return {
    set(items) {
      markers.setGeometries(
        items.map((m) => ({
          id: m.id,
          styleId: m.styleId,
          // ⚠️ 腾讯纬度在前
          position: new TMap.LatLng(m.lat, m.lng),
        })),
      )
    },
    clear() {
      markers.setGeometries([])
    },
    destroy() {
      // ★ 真的**摘掉**图层 —— `setGeometries([])` 只是清空，空图层会一直挂在地图上
      //   （地图实例跨页复用 ⇒ 每换一次页多挂一个）。`destroy()` 在基类 `MultiOverlay` 上。
      markers.destroy()
      // ★ 判据的监听也要解 —— 它挂的是**捕获阶段**的六个事件，不摘就跨页累积
      tap.destroy()
    },
  }
}
