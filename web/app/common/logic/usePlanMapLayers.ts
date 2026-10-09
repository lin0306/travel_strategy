import { useEffect, useRef } from 'react'

import { useFitOnce } from '~/common/logic/useFitOnce'
import {
  createMarkerLayer,
  createRouteLayer,
  LEG_ID_FROM_STAY,
  Z_LAYER,
  type RouteLeg,
} from '~/common/map/tencent'
import type { MapShellContext } from '~/common/logic/mapShell'
import type { Timeline } from '~/common/logic/itinerary/timeline'
import type { Stay } from '~shared/schema'

/** 一个 stop 对应的「段 id」—— 出发那个 stop 的 uid；住宿出发段用哨兵值 */
export function legIdOf(uid: string | undefined): string {
  return uid ?? LEG_ID_FROM_STAY
}

/**
 * 行程页的地图侧：**连线 / 序号 / 住宿旗标 / 视野 / 降级画布**。
 *
 * ## 为什么单独成 hook 而不留在页面里
 * 这四件都是**命令式**的（建图层、setGeometries、fitBounds），和页面的
 * "推导数据 → 渲染浮层"是两种心智。混在一个 700 行的组件里时，
 * 改一处图层逻辑要在一堆 JSX 之间找 effect。
 *
 * ## 两条纪律
 * 1. **逐段 geometry**（`id` = 段起点 uid）—— 一整条 path 做不了
 *    hover 提亮 / 点段收窄 / 单段描色，而这三条是行程页地图侧的全部价值。
 * 2. 矩阵命中的段**只有两个端点**，画出来是直线 —— 图例必须同时标「直线示意」，
 *    这是 09 文档 6.1 的既定取舍，不是画得糙。
 */
export function usePlanMapLayers({
  shell,
  timeline,
  stay,
  activeLeg,
  onSelectLeg,
  enabled = true,
}: {
  shell: MapShellContext
  timeline: Timeline | null
  stay: Stay | null
  /** 当前展开方案卡的那一段（`''` = 全收起）—— 其余段会降到 40% */
  activeLeg: string
  onSelectLeg: (legId: string) => void
  /**
   * `false` = 只占位、不建层。
   * ★ 不能"条件调用"这个 hook（hooks 规则），而它的调用方又可能想"这一屏不画逐段线"
   *  （规划面板的地图侧是整条沿路折线，两套线叠一张图 = 同一趟行程画两条线），
   *   所以开关做成参数：hook 照常执行，只是 effect 里不建层、也不写 geometry。
   */
  enabled?: boolean
}): void {
  const routeRef = useRef<ReturnType<typeof createRouteLayer> | null>(null)
  const markRef = useRef<ReturnType<typeof createMarkerLayer> | null>(null)

  // 建层 / 拆层
  useEffect(() => {
    const map = shell.map
    if (!map) return
    const route = createRouteLayer(map, { onSelect: onSelectLeg })
    /**
     * ★★ **`planMarker`，不是 24**。
     *
     * 原来这里是 `zIndex: 24` —— 只想着"高过景点那几层（圆点 20 / 名字 21 / 选中 22）"，
     * 却忘了路线是 **30/31** ⇒ **序号标记被路线压住**（路线穿过标记时，数字被线切一半）。
     * 这是"层级要靠翻四个文件才能拼出来"的直接后果，所以本轮把层级收进 `zLayers.ts`。
     */
    const marks = createMarkerLayer(map, { zIndex: Z_LAYER.planMarker })
    routeRef.current = route
    markRef.current = marks
    return () => {
      route.destroy()
      marks.destroy()
      routeRef.current = null
      markRef.current = null
    }
    // onSelectLeg 不进依赖：它每次渲染都是新引用，进去会把图层反复拆建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shell.map])

  // 连线 + 序号 + 住宿旗标
  useEffect(() => {
    const route = routeRef.current
    const marks = markRef.current
    if (!route || !marks || !timeline || !stay) return

    const legs: RouteLeg[] = timeline.legs.map((lg, i) => {
      const src = timeline.stops[i]
      const id = legIdOf(src?.kind === 'poi' ? src.item?.uid : undefined)
      return {
        id,
        mode: lg.mode,
        // `path` 为 null = 矩阵命中，只有两端点 → 画直线并标「直线示意」
        path: lg.path ?? [
          { lng: lg.from.lng, lat: lg.from.lat },
          { lng: lg.to.lng, lat: lg.to.lat },
        ],
        /**
         * ★ 就是**当前展开的那一段** → 打上 `onTop`，由图层放到 `focus` 层
         *   （压在其余线之上）。原来走 `setLegs(legs, { focusId })` 的第二个参数，
         *   现在改成每条自己声明 —— 那个参数只能表达一条，公交方案分段画时不够用。
         */
        ...(activeLeg && id === activeLeg ? { onTop: true } : {}),
      }
    })
    route.setLegs(legs)

    const seqs = timeline.stops
      .filter((s) => s.kind === 'poi' && s.item)
      .map((s, i) => ({
        id: `seq-${s.item!.uid}`,
        styleId: `seq${Math.min(9, i + 1)}`,
        lng: s.place.lng,
        lat: s.place.lat,
      }))
    marks.set([...seqs, { id: `stay-${stay.id}`, styleId: 'stay', lng: stay.lng, lat: stay.lat }])
  }, [timeline, stay, activeLeg])

  /**
   * 换天 / 换住宿段 → 视野跟着换锚点（住宿点必须一起框进来）。
   *
   * ★ 取景的**身份**是「住宿点 + 这一天的点位集合」，不是 `timeline` / `shell`
   *   这两个对象 —— 它们会在无关的重渲染里换引用。修复前依赖是
   *   `[timeline, stay, shell]`，于是**换一次底图就把视野拉回当天全景**。
   */
  const anchors = (timeline?.stops ?? [])
    .filter((s) => s.kind === 'poi')
    .map((s) => ({ uid: s.item?.uid ?? '', lng: s.place.lng, lat: s.place.lat }))
  const fitKey = stay ? `${stay.id}|${anchors.map((a) => a.uid).join(',')}` : null
  useFitOnce(fitKey, shell.status === 'ready', () => {
    if (!stay) return false
    return shell.fit(
      [{ lng: stay.lng, lat: stay.lat }, ...anchors.map(({ lng, lat }) => ({ lng, lat }))],
      { reason: 'drill' },
    )
  })

  /** 降级画布（SDK 不可用时的那张示意底图） */
  useEffect(() => {
    shell.setFallback({
      stay: stay ? { name: stay.name, lng: stay.lng, lat: stay.lat } : null,
      pins: (timeline?.stops ?? [])
        .filter((s) => s.kind === 'poi')
        .map((s, i) => ({
          id: `seq-${s.item?.uid ?? i}`,
          lng: s.place.lng,
          lat: s.place.lat,
          color: 'var(--color-density-3)',
          seq: i + 1,
        })),
      legs: (timeline?.legs ?? []).map((lg) => ({
        from: { lng: lg.from.lng, lat: lg.from.lat },
        to: { lng: lg.to.lng, lat: lg.to.lat },
        // 步行段虚线 —— 线型本身携带语义（"这段是走过去的"）
        dashed: lg.mode === 'walking',
        // ★ 拥堵描色**不在这里画**：路况是用户点开方案卡时才拉的，属于 Step 3 的活。
        //   （算法那关已经过了 —— `speed[].polyline_idx` 自带区间，见 itinerary/polyline.ts）
      })),
    })
  }, [timeline, stay, shell, activeLeg])
}
