/**
 * 区节点索引的**读取**（首屏读，不懒加载）。
 *
 * ## 为什么单独一个 hook
 * `useHomeView` / `useProvinceView` 都贴着 420 行上限（G 项）。索引这段逻辑两边一模一样，
 * 放这里各调用一行。
 *
 * ## 为什么与"区懒加载（`subRows`）"并存，而不是合并
 * 两者服务的东西不同，**合并就得给 374 个市都去读分片**：
 * | | 数据 | 覆盖 | 用途 |
 * |---|---|---|---|
 * | `subRows`（既有） | `subdistricts/<市>.json` 逐市 | **只有已收录城市** | 「点市徽标框哪一片」（`findSubdistrictOwner`）|
 * | 本 hook | `district-index.json` 一份 | **全国 2894 个区** | 铺区徽标 |
 *
 * ## ★ 为什么**不**等到"放大到区这一级"才读（试过一次，绕不开）
 * 该不该加载只有 `useMapReveal` 知道（它返回 `revealed`），而 `districts` 回调是**喂给**
 * `useMapReveal` 的入参 —— 用 `revealed` 触发就变成"回调要用它、它依赖回调的结果"。
 * 换成"看 zoom"又要另引一条订阅。而它 gzip 只有 **45KB**，首页同一屏要读的省级轮廓是
 * **1.1MB** ⇒ 省这点不值得绕那一圈。首屏读完最干净，`dataKey` 也自然是对的。
 */

import { useEffect, useState } from 'react'

import { loadDistrictIndex, type DistrictIndexItem } from '~/common/data/districtIndex'

export function useDistrictIndex(): DistrictIndexItem[] | null {
  const [items, setItems] = useState<DistrictIndexItem[] | null>(null)

  useEffect(() => {
    let alive = true
    void loadDistrictIndex().then((d) => {
      if (alive) setItems(d)
    })
    return () => {
      alive = false
    }
  }, [])

  return items
}
