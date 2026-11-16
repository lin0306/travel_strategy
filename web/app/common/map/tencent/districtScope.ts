/**
 * 作用域外框 —— 「当前选中的那个省 / 市 / 区」**自身轮廓**的那一圈。
 *
 * ## 为什么需要它（2026-11-14 用户）
 * > 「点省了，就只显示那个省的数据和轮廓」
 *
 * 用户确认的口径是「省界 + 省内各市界」。而省界在数据里**就是各市外沿的拼合**：
 * 相邻两市的共享边界只有一条线，线宽与省内市界完全相同 ⇒ 屏幕上只是一片网格，
 * 读不出"这是一整个省"。所以要在下级各面之上**单独**再画一圈。
 *
 * ## 为什么单独成文件
 * `districtLayer.ts` 已到 420 行上限（G 项）。这条通道与"铺哪一级"完全无关 ——
 * 它有自己的签名、自己的解码缓存键、自己的生命周期（换级时不变、换选中才变），
 * 抽出来正好让两边的职责各自清晰。
 *
 * ## 三个静默坑
 * 1. **几何 id 不能用 adcode**：点北京时它同时是省级单位与市级单位，
 *    与下级节点同 id 会在 `setGeometries` 里互相覆盖 —— 而且不报错。
 * 2. **解码缓存键要加前缀**：节点也按 adcode 缓存，同键会让外框拿到
 *    "某个下级面的几何"（一条形状完全不对的线）。
 * 3. **签名要带首个环的点数**：同一个 adcode 在两个来源下形状不同
 *    （高德自身轮廓 vs 腾讯拼接兜底），只比 adcode 会让"换源后仍是旧形状"一直挂着。
 */

import type { GeometryStore } from './districtGeometry'

/**
 * 外框那条几何的 id。**独立于任何 adcode** —— 与节点同 id 会互相覆盖（见文件头第 1 条）。
 */
export const SCOPE_GEOM_ID = '__scope'

export interface ScopeOutlineHandle {
  /**
   * 设 / 换 / 清外框。
   * @return **真的变了**才返回 `true` —— 调用方据此决定要不要重铺多边形
   *         （`setGeometries` 会重建全部几何，白刷一次很贵）
   */
  set(adcode: string | null, rings: number[][] | null): boolean
  /** 当前要画的那几环（`null` = 没有外框） */
  paths(): TMap.LatLng[][] | null
  /** 清空（清屏时用：语义是"这一屏什么都不画"） */
  clear(): void
}

export function createScopeOutline(geo: GeometryStore): ScopeOutlineHandle {
  let paths: TMap.LatLng[][] | null = null
  let sig = ''

  return {
    set(adcode, rings) {
      const ok = Boolean(adcode) && (rings?.length ?? 0) > 0
      const next = ok ? `${adcode}:${rings!.length}:${rings![0]?.length ?? 0}` : ''
      if (next === sig) return false
      sig = next
      paths = ok ? (geo.pathsOf(`${SCOPE_GEOM_ID}:${adcode}`, rings!) ?? null) : null
      return true
    },
    paths: () => paths,
    clear() {
      paths = null
      sig = ''
    },
  }
}
