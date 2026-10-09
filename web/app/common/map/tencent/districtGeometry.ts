/**
 * 区划几何的**解码与缓存** —— "边界文件里的坐标 → SDK 的 `LatLng`" 那一半。
 *
 * ★ 2026-10-02 从 `districtLayer.ts` 拆出（那边撞了 420 行上限，G 项）。
 *   拆分线也正好是"**纯转换 vs 有状态图层**"：本文件只做 `环 → TMap.LatLng[][]`
 *   的转换与缓存，不碰地图、不碰事件、不碰任何图层状态 ⇒ 可以单独理解与替换。
 *
 * ## 两个必须记住的形状（错一条就静默画不出来）
 *
 * 1. **环是扁平坐标串** `[lng, lat, lng, lat, …]`（步长 2），不是 `[[lng,lat], …]`
 *    点数组。按点数组解会抛 `ring.filter is not a function`，或解出一堆
 *    `LatLng(undefined, undefined)`。
 * 2. 数据是 **(经度, 纬度)**，而 `TMap.LatLng` 要 **(纬度, 经度)** —— 写反了不报错，
 *    多边形会跑到地球另一边（纬度 103° 不合法，直接画不出来）。
 *
 * ## 缓存为什么在这里（而不是图层里）
 *
 * 用户 2026-10-02：「拖拽到屏幕之外后再拖拽进来，会重新渲染」。
 * 拖出视野时那批节点会从图层集合里消失，拖回来又要**从头解码一遍** ——
 * 一次解码 = 每个坐标点 `new TMap.LatLng`，市档一份省的轮廓是几千点。
 * 缓存之后，"拖出去再拖回来"只是把已有几何重新挂上，**零解码**。
 *
 * ⚠️ **必须有上限**：全国 2894 个区，无界缓存会一路吃内存（每点一个 SDK 对象）。
 *   超限就**淘汰最早的一半**（`Map` 保持插入序）—— 不做 LRU：几何是
 *   `adcode → 环` 的纯函数，丢了只是重解码一次，没有正确性风险。
 */

/** 缓存的 adcode 个数上限。够覆盖"一屏 + 周围几屏"，又不会无界增长 */
export const GEOMETRY_CACHE_MAX = 1200

export interface GeometryStore {
  /**
   * 取某个 adcode 的环。
   * @return 全部环都无效（少于 3 个点，闭合不成面）时返回 `null` ——
   *   调用方**不要**把空数组塞给 SDK（见 `districtLayer.repaint` 的注释）
   */
  pathsOf(adcode: string, rings: number[][]): TMap.LatLng[][] | null
  /** 当前缓存了几个 adcode（诊断用） */
  size(): number
}

export function createGeometryStore(max: number = GEOMETRY_CACHE_MAX): GeometryStore {
  const cache = new Map<string, TMap.LatLng[][]>()

  function decode(rings: number[][]): TMap.LatLng[][] {
    return rings
      .map((flat) => {
        const ring: TMap.LatLng[] = []
        for (let i = 0; i + 1 < flat.length; i += 2) {
          // ⚠️ (经度, 纬度) → `LatLng(纬度, 经度)`，见文件头第 2 条
          ring.push(new TMap.LatLng(flat[i + 1] as number, flat[i] as number))
        }
        return ring
      })
      // 少于 3 个点闭合不成面，交给 SDK 只会得到无效几何
      .filter((ring) => ring.length >= 3)
  }

  return {
    pathsOf(adcode, rings) {
      const hit = cache.get(adcode)
      if (hit) return hit

      const paths = decode(rings)
      if (paths.length === 0) return null

      // 超限 ⇒ 淘汰最早的一半，不让缓存无界增长
      if (cache.size >= max) {
        let drop = Math.floor(max / 2)
        for (const k of cache.keys()) {
          cache.delete(k)
          if (--drop <= 0) break
        }
      }
      cache.set(adcode, paths)
      return paths
    },
    size: () => cache.size,
  }
}
