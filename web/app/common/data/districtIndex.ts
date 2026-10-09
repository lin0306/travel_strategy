/**
 * 「区」节点索引的读取（**构建期产物**，`pipeline/build.py` 的 `build_district_index`）。
 *
 * ## 它解决什么（2026-10-01）
 * 区徽标原来只从**已收录城市**的区分片里取 —— 见 `useHomeView` 那个 `cityId !== null`
 * 的筛，注释写的理由是"给没内容的城市撒满 `0` 个区徽标 = 谎报没景点"。
 * 用户要求区这一级也**全国铺**（省 / 市两级已经全量：34 省 + 374 市），而"读 374 份
 * 分片"= 374 个请求 ⇒ 合成这一份（127KB · gzip 45KB），前端**一次**读走。
 *
 * ## 形状：5 元组数组，不是对象
 * `[adcode, name, lng, lat, poiCount]` —— 2894 条里 **2599 条是"待收录"**，
 * 用对象写每个 key 都得重复一遍，体积要多花一倍。
 *
 * ## `poiCount` 为 `null` = **待收录**，不是"0 个"
 * `districtStyles.nodeStatusLabel` 据此输出「XX区 —」。★ 红线：未收录**绝不显示 0**
 * —— 写成 `0` 就是谎报"这个区有 0 个景点"，而真相是这座城市我们还没收录。
 *
 * ★ 放在 `common/data/`（而不是 `logic/`）：`import.meta.glob` 的相对路径按**文件在
 *   树里的深度**解析，写错深度**不报错**、只静默匹配 0 个文件（见 `cityRegistry.ts`
 *   那条警告）。与 `data.ts` 同级 → 路径直接照抄，不会踩。
 */

type JsonModule = { default: unknown }

const modules = import.meta.glob<JsonModule>('../../../../data/_generated/district-index.json')

/** 一个区节点。`poiCount === null` = 待收录（徽标显示「—」） */
export interface DistrictIndexItem {
  adcode: string
  name: string
  lng: number
  lat: number
  poiCount: number | null
}

/** 一次就够 —— 索引是静态产物，没有"过期重取"这回事 */
let cache: Promise<DistrictIndexItem[] | null> | null = null

/**
 * 读区索引（**第一次真的放大到区这一级时才加载**）。
 *
 * 读不到时返回 `null` 而**不是抛错**：它是脚本产物，在流水线跑过 `build` 之前不存在。
 * 那时区这一级会退回"只有已收录城市的区"（决策侧还会回流到市），页面其余部分照常
 * —— 与 `loadSearchIndex` / `loadDistrictTree` 对"没有"的处理是同一个态度。
 */
export function loadDistrictIndex(): Promise<DistrictIndexItem[] | null> {
  if (cache) return cache
  cache = (async () => {
    const loader = Object.values(modules)[0]
    if (!loader) return null
    try {
      const raw = (await loader()).default as { items?: unknown } | null
      const items = raw?.items
      if (!Array.isArray(items)) {
        // 形状不对时**只说一句就退**：区这一级退化成"只有已收录城市"，页面不炸
        console.error('[districts] 区索引形状不对（没有 items 数组）')
        return null
      }
      const out: DistrictIndexItem[] = []
      for (const it of items) {
        // ★ 逐项守卫：索引是**脚本产物**，形状漂了不该画出一张错误的图
        if (!Array.isArray(it) || it.length !== 5) continue
        const [adcode, name, lng, lat, n] = it as unknown[]
        if (typeof adcode !== 'string' || !adcode || typeof name !== 'string') continue
        if (typeof lng !== 'number' || typeof lat !== 'number') continue
        out.push({ adcode, name, lng, lat, poiCount: typeof n === 'number' ? n : null })
      }
      return out
    } catch (err) {
      console.error('[districts] 读取区索引失败：', err)
      return null
    }
  })()
  return cache
}
