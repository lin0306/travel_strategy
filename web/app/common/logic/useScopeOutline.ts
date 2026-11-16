/**
 * 「当前选中单位**自身**的轮廓」的取数与缓存 —— 作用域外框的数据侧。
 *
 * ## 它在整条链里的位置
 * ```
 * 页面（region.region / activeDistrict）
 *    ↓  scope = { adcode, level }
 * decideReveal  → 按作用域裁节点（这一屏铺哪几个市 / 区）
 *    ↓  d.scope（可能已因"缩回全国"而变成 null）
 * 本钩子      → 取"这个单位自己的轮廓"，交给图层画那一圈粗边
 * ```
 *
 * ## 为什么要单独取一次几何
 * 用户确认的口径是「省界 + 省内各市界」。省界在数据里**就是各市外沿的拼合** ——
 * 相邻两市的共享边界只有一条线，线宽与市界相同 ⇒ 屏幕上只是一片网格，读不出
 * "这是一整个省"。所以额外取一层"自身轮廓"（省优先高德自身轮廓、市优先
 * `cities/<省>.geo.json`、区优先 `districts-own`），画粗一档。
 *
 * ★ 取几何用的还是 `loadBoundsForLevel(scope.level, [adcode])` —— 那个 adcode
 *   在"它自己所属那一级"的文件里**恰好就是**它的自身轮廓，不需要新的读取函数。
 *
 * ## 两个必须记住的时序
 * 1. **先撤旧的、再等新的**：换选中时旧外框不能留在屏幕上（那是在说"你现在看的是
 *    上一个省"）。缓存命中则直接换，不闪。
 * 2. **异步回来要验身份**：按 `key === 当前键` 才设 —— 否则快速连点两次，
 *    先发的那次回来会把后一次的几何盖掉（看起来像"点了没反应"）。
 */

import { useCallback, useRef } from 'react'

import { loadBoundsForLevel } from '~/common/data/data'
import type { DistrictLayerHandle, RevealScope } from '~/common/map/tencent'

type Sync = (dl: DistrictLayerHandle, scope: RevealScope | null) => void

export function useScopeOutline(): Sync {
  /** `level|adcode` → 环（`undefined` = 还没取过，`null` = 取过但没有） */
  const ringsRef = useRef(new Map<string, number[][] | null>())
  /** 最近一次同步的键。异步回来时比对，防止"换了选中之后旧几何盖上去" */
  const keyRef = useRef('')

  return useCallback<Sync>((dl, scope) => {
    const key = scope ? `${scope.level}|${scope.adcode}` : ''
    keyRef.current = key
    if (!scope) {
      // 图层内部有签名短路（连续清只真做一次），这里不必自己省
      dl.setScopeOutline(null, null)
      return
    }
    const hit = ringsRef.current.get(key)
    if (hit !== undefined) {
      dl.setScopeOutline(scope.adcode, hit)
      return
    }
    dl.setScopeOutline(null, null)
    void loadBoundsForLevel(scope.level, [scope.adcode]).then((f) => {
      const rings = f?.polygons?.[scope.adcode] ?? null
      ringsRef.current.set(key, rings)
      if (keyRef.current === key) dl.setScopeOutline(scope.adcode, rings)
    })
  }, [])
}
