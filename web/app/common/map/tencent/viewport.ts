/**
 * 视野模型 —— 「镜头现在看到什么」的唯一读法。
 *
 * ## 为什么必须收成一处（2026-09-20 全量修复）
 * 修复前，读视野在工程里有**三份各写一遍**的实现：
 *   · `useMapReveal.readView()`       —— 供揭示判据
 *   · `poiLayer.viewport()`           —— 供撒点去重与标注避让
 *   · `districtLayer.visibleBadges()` —— 供徽标避让
 * 三份读的是同样的量，但**读的时刻不同**。地图正在移动时 `getCenter()` 每次调用
 * 都可能返回不同的值 —— 于是同一帧里三处按不同的中心算，表现在屏幕上就是
 * 「圆点在这一侧、名字在那一侧、徽标又偏了一截」。
 *
 * 第二重代价是判据散落：三份里只有 `useMapReveal` 那份带 `contains()`，
 * 另外两处各自内联着"投影完比大小"。改一次判据要在三个地方改，漏一处**不报错**。
 *
 * 所以：读视野只有 `readViewport` 一个入口，屏幕判定只有 `projectToPixel` /
 * `containsPoint` 两个函数。其余文件一律从这里取。
 *
 * ## 它在闭环里的位置
 * 视野是整条「缩放 → 显示」链路的**输入**。它由引擎产生，但引擎不会告诉你
 * "它什么时候稳定下来" —— 所以这里除了读，还提供 `viewSignature`：把
 * `(zoom, center)` 压成一个字符串，供 `useTMap` 判断"镜头是否已经停下"
 * （见 `useTMap` 里的稳定检测）。缺了它，页面对 `fitBounds` 的飞行动画
 * 什么时候结束就只能靠猜时长 —— 而猜错的后果是**按动画第 0 帧的缩放铺一次内容**。
 */

import type { UseTMapResult } from './useTMap'

/**
 * 地图实例。**不写 `TMap.Map`** —— 那等于把引擎类型漏进业务层
 * （见 `index.ts` 的"唯一的纪律"）。`UseTMapResult['map']` 就是我们自己那层皮上的类型。
 */
export type MapInstance = NonNullable<UseTMapResult['map']>

/**
 * 一次快照。投影、判据、避让要的是**同一组量**，所以只读一次往下传。
 *
 * ★ 这个名字曾经叫 `LabelViewInfo`（挂在 `labelAvoidance.ts` 下）。改名是因为
 *   它早就不只服务标注了：撒点去重、视野判据、徽标避让、取景全用它。
 *   名字里带 "Label" 会让人以为改它只影响标注。
 */
export interface Viewport {
  zoom: number
  centerLng: number
  centerLat: number
  /** 视口尺寸（px）。取不到时退窗口尺寸 —— 见 `readViewport` 的三层兜底 */
  width: number
  height: number
  /** 估算的文字字号（px）。只被标注避让用，其余场景留空 */
  fontSize?: number
}

/**
 * 读一次视野。
 *
 * 容器尺寸优先取调用方给的 `container`（外壳知道地图容器在哪），
 * 退回 `map.getContainer()`，再退回窗口 —— 三层兜底是为了让"容器还没量出来"
 * 这种瞬间不至于算出 0 宽，那会让避让把所有东西都裁掉。
 */
export function readViewport(map: MapInstance, container?: HTMLElement | null): Viewport {
  const el = container ?? ((map.getContainer?.() as HTMLElement | null) ?? null)
  const c = map.getCenter()
  return {
    zoom: map.getZoom(),
    centerLng: c.getLng(),
    centerLat: c.getLat(),
    width: el?.clientWidth ?? (typeof window !== 'undefined' ? window.innerWidth : 1024),
    height: el?.clientHeight ?? (typeof window !== 'undefined' ? window.innerHeight : 768),
  }
}

/**
 * 视野签名 —— `(zoom, 中心)` 的字符串压缩。
 *
 * 用途只有一个：判断"镜头动了没有」。`useTMap` 用它做两件事 ——
 *   ① 用户手势停止后**去重**广播（同一视野不重复扇出）
 *   ② `fitBounds` 之后**检测动画结束**（连续两次采样相同 = 停了）
 *
 * ⚠️ 精度是刻意选的：`zoom` 到 1e-4、经纬度到 1e-5（约 1 米）。再粗会把
 *    真实的微小移动当成"没动"，再细则引擎的浮点抖动会让它永远"在动"。
 */
export function viewSignature(map: MapInstance): string {
  const c = map.getCenter()
  return `${map.getZoom().toFixed(4)}|${c.getLng().toFixed(5)}|${c.getLat().toFixed(5)}`
}

/**
 * 经纬度 → 像素坐标（Web Mercator）。结果相对视口左上角，可直接用于碰撞检测。
 *
 * ## 为什么自算而不问 SDK
 * ① 腾讯的投影 API 在不同版本里名字不同（`project` / `latLngToContainerPixel`…），
 *    而这个公式是**标准 Web Mercator**，与它渲染用的完全一致；
 * ② 自算让它**脱离地图实例**，能单测；
 * ③ 项目里所有几何（撒点去重、标注避让、徽标避让）都要用它，走 SDK 就得把
 *    地图实例一路传进纯几何代码里。
 *
 * ★ 它原来住在 `labelAvoidance.ts`。搬到视野模型下面，是因为**调用它的地方
 *   已经不止避让**（还有撒点去重、视野判据）。留在避让文件里会让人以为
 *   改它只影响标注。
 */
export function projectToPixel(
  point: { lng: number; lat: number },
  view: Viewport,
): { x: number; y: number } {
  const worldSize = 256 * 2 ** view.zoom
  const toWorldX = (lng: number) => ((lng + 180) / 360) * worldSize
  const toWorldY = (lat: number) => {
    const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat))
    const s = Math.sin((clamped * Math.PI) / 180)
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * worldSize
  }

  const cx = toWorldX(view.centerLng)
  const cy = toWorldY(view.centerLat)

  return {
    x: toWorldX(point.lng) - cx + view.width / 2,
    y: toWorldY(point.lat) - cy + view.height / 2,
  }
}

/**
 * 这个点在不在视野里。`pad` 是额外扩张比例（`0.3` = 四边各外扩 30%）。
 *
 * ★★ 全项目**只有这一个**视野判据。修复前，每个调用方各自写一遍
 *    "投影 → 比 x/y 大小"，而它们的 `pad` 与边界条件各不相同 ——
 *    于是出现"判据说有点、屏幕上一个都没有"这类只在某些纬度上复现的怪象。
 *
 * > `pad = 0` 是**严格视野**。揭示判据必须用它，而上屏集合用**外扩**视野
 * > —— 两者故意不同，理由见 `reveal.ts`。
 */
export function containsPoint(
  view: Viewport,
  point: { lng: number; lat: number },
  pad = 0,
): boolean {
  const { x, y } = projectToPixel(point, view)
  const mx = view.width * pad
  const my = view.height * pad
  return x >= -mx && x <= view.width + mx && y >= -my && y <= view.height + my
}

/** 严格视野（`pad = 0`）的简写 —— 撒点排序里问得最多的一句 */
export function isOnScreen(view: Viewport, point: { lng: number; lat: number }): boolean {
  const { x, y } = projectToPixel(point, view)
  return x >= 0 && x <= view.width && y >= 0 && y <= view.height
}
