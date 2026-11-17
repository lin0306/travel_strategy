/**
 * 徽标**引线**：被错开的徽标，用一条虚线连回它真正的归属地。
 *
 * ## 为什么必须有它（2026-11-18 用户实测）
 * 全国视图下粤港澳三个徽标只差十几像素，`layoutBadges` 会把其中两个推开一格。
 * 一格是 **34×30 px**，可在 z4.57 那是一百多公里 —— 于是"香港 57"飘在海上，
 * 离香港岛老远，而底图自己还画着「香港特别行政区」，两相对照就像标错了地方。
 * 用户的原话：「如果标签有漂移，用连接线标识这个标签指向什么地方」。
 *
 * ## 为什么是虚线、为什么不是箭头
 * - 实线会被读成道路或边界；虚线才是"这只是一个标注"的通行写法。
 * - 箭头表达的是**方向**（往那边走），而这里要表达的是**归属**（这个牌子属于那个点）。
 * - 把牌子拉回原位更不行 —— 那就又叠回去了，正是要解决的问题。
 *
 * ## 几何
 * 起点是 `BadgePlacement.home`（真实锚点），终点是徽标自身坐标；线会被牌子盖住最后一小段，
 * 看起来正是"从牌子背后伸出来"。
 *
 * ⚠️ 只有**真的被错开**的徽标才画（`home` 与 `node` 坐标相同 ⇒ 跳过），一屏通常 1~3 条。
 * ⚠️ 不在锚点画圆点：港澳两个锚点只差 10~15px，任何点标记都会糊成一团黑斑
 *    （2026-11-18 实测，4px 圆点在珠江口变成两块脏东西）。线的落点已经足够指认。
 */

import type { BadgePlacement } from './districtBadges'
import { Z_LAYER } from './zLayers'

/** 引线颜色：比徽标描边深一档 —— 实测 1px 浅灰虚线在全国视图里根本看不见 */
const LEADER_COLOR = '#5b6472'

export interface BadgeLeaders {
  /** 与徽标同一次重绘时调用 */
  sync(placements: BadgePlacement[]): void
  destroy(): void
}

export function createBadgeLeaders(map: TMap.Map): BadgeLeaders {
  const layer = new TMap.MultiPolyline({
    map,
    styles: {
      leader: new TMap.PolylineStyle({
        color: LEADER_COLOR,
        // ★ 2px：1px 在 1440×900 的全国视图上等于看不见（第一版实测完全找不到线）。
        //   ⚠️ **必须是整数**：腾讯 `PolylineStyle` 收到 1.5 会在控制台报
        //   「width 属性无效」并退回默认值 —— 线照样画出来，只在 console 里报错，
        //   所以 dev 阶段很容易漏掉（生产冒烟才抓到）。
        width: 2,
        dashArray: [4, 3],
        lineCap: 'round',
      }),
    },
    geometries: [],
    // 压在徽标**下面**：引线不该盖住牌子，也不该盖住区界面
    zIndex: Z_LAYER.districtBadge - 0.5,
  })

  /** 上一次交给 SDK 的内容签名（拖拽只改投影、不改坐标 ⇒ 别白刷） */
  let sig = ''

  return {
    sync(placements) {
      const geoms: TMap.Geometry[] = []
      const parts: string[] = []

      for (const { home, node } of placements) {
        if (home.lng === node.lng && home.lat === node.lat) continue
        geoms.push({
          styleId: 'leader',
          paths: [new TMap.LatLng(home.lat, home.lng), new TMap.LatLng(node.lat, node.lng)],
        })
        parts.push(`${node.adcode}@${node.lng.toFixed(6)},${node.lat.toFixed(6)}`)
      }

      // 几何逐字节相同时不重设（拖拽会连续触发几十次重绘）
      const next = parts.join('|')
      if (next === sig) return
      sig = next
      layer.setGeometries(geoms)
    },

    destroy() {
      layer.destroy()
    },
  }
}
