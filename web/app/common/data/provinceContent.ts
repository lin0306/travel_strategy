/**
 * 省级展示内容（`data/provinces/index.json`）的读取 —— 省介绍与省封面。
 *
 * ## 为什么省级要单独一份数据（2026-11-14）
 * 用户问「省的介绍和图片不抓吗」。查下来不是"抓了没显示"，而是**根本没有承载位置**：
 * `data/` 里省级只有区划树（`district-tree.json`）与边界（`_generated/provinces/*.geo.json`），
 * 一个字、一张图都没有。于是首页省卡只能把"下辖 10 个市、已收录 1 座、共 69 个点位"
 * 拼成一段话 —— 那是**收录进度**，不是"这个省是什么样"。
 *
 * 现在由人写 `intro`（真实人文地理，不编数据）、由 `tools/province_cover.py`
 * 逐张看图后写回 `heroImages`。
 *
 * ## 为什么一个人一个文件（而不是并进 district-tree）
 * 树是**流水线产物**（`step7` 生成、`build` 回填收录信息），手写内容混进去
 * 下次重跑就可能被覆盖；而这份是**采编数据**，生命周期跟 `data/cities/**` 一样。
 * 34 个省的内容合成一份 index（约 12KB），一次读完全部 —— 省卡是点开才渲染的，
 * 但整份文件比一个请求往返还小，没必要按需分片。
 *
 * ★ 解析失败**静默退化为 `null`**（省卡就只显示收录情况），不抛错：
 *   少一段介绍不该让首页白屏。这与 `loadDistrictTree` 的失败态度一致。
 */

import { ProvinceIndexSchema, type ProvinceContent } from '~shared/schema'

type JsonModule = { default: unknown }

/** ⚠️ `import.meta.glob` 只吃字面量相对路径，且按文件深度解析 —— 写错深度不报错、只匹配 0 个 */
const modules = import.meta.glob<JsonModule>('../../../../data/provinces/index.json')

let cache: Record<string, ProvinceContent> | null | undefined

async function loadAll(): Promise<Record<string, ProvinceContent> | null> {
  if (cache !== undefined) return cache

  const loader = Object.values(modules)[0]
  if (!loader) {
    cache = null
    return cache
  }
  try {
    const mod = await loader()
    const parsed = ProvinceIndexSchema.safeParse(mod.default)
    cache = parsed.success ? parsed.data.provinces : null
  } catch {
    cache = null
  }
  return cache
}

/**
 * 取一个省级单位的内容。没有（还没写 / 解析失败 / adcode 不在清单里）⇒ `null`。
 *
 * ★ 调用方必须能接住 `null`：省卡在 `null` 时只显示收录情况，与旧版一致。
 */
export async function loadProvinceContent(adcode: string): Promise<ProvinceContent | null> {
  const all = await loadAll()
  return all?.[adcode] ?? null
}
