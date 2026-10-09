/**
 * 搜索索引的读取（**构建期产物**，由 `pipeline/build.py` 生成）。
 *
 * ## 为什么单独成文件、而不是塞进 `data.ts`
 * `data.ts` 那 400+ 行讲的是"区划树 / 城市索引 / 边界"这几种**页面地基**；
 * 搜索索引只有一个消费者（顶栏搜索框），而且是**按需**加载 —— 首页 / 城市页
 * 一拍都不用它。混在一起会让"读一次 data.ts"顺带把搜索也拉进上下文。
 *
 * ★ 仍然放在 `common/data/`（而不是 `common/logic/search/`）：`import.meta.glob`
 *   的相对路径**按文件在树里的深度解析**，写错深度**不报错**、只静默匹配 0 个文件
 *   （见 `cityRegistry.ts` 的那条警告）。与 `data.ts` 同级 → 路径直接照抄，不会踩。
 *   `check_app.py` 的 I 项还会核对 glob 落点是否真的在仓库根的 `data/` 下。
 */

import { SearchIndexSchema, type SearchIndex } from '~shared/schema'

import { mirrorSearchCovers } from './imageMirror'

type JsonModule = { default: unknown }
type Loader = () => Promise<JsonModule>

const indexModules = import.meta.glob<JsonModule>('../../../../data/_generated/search-index.json')

/** 一次就够 —— 索引是静态产物，没有"过期重取"这回事 */
let cache: Promise<SearchIndex | null> | null = null

/**
 * 读搜索索引（首次真的要用时才加载）。
 *
 * 读不到时返回 `null` 而**不是抛错**：它是脚本产物，在流水线跑过 `build` 之前
 * 不存在。搜索框要能优雅地"没有"（给一句引导），而不是让整个顶栏炸掉 ——
 * 与 `loadDistrictTree` 对"没有"的处理是同一个态度。
 */
export function loadSearchIndex(): Promise<SearchIndex | null> {
  if (cache) return cache
  cache = (async () => {
    const loader = Object.values(indexModules)[0]
    if (!loader) return null
    try {
      const r = SearchIndexSchema.safeParse((await loader()).default)
      // ★ 镜像在**校验之后**做（与 `cityRegistry.loadCity()` 同一个次序）：
      //   Schema 校验针对原始干净数据，镜像纯粹是展示侧的变换。
      //   漏了这一步 → 搜索结果里的缩略图全部空白，而详情页同一张图却是好的。
      if (r.success) return mirrorSearchCovers(r.data)
      // 形状不对时**只说一句就走**（与 cityRegistry 一致）：搜索退化成"搜不到"，
      // 但页面其余部分照常 —— 索引是增强，不是地基
      console.error('[search] 搜索索引未通过 Schema 校验：', r.error.issues.slice(0, 5))
      return null
    } catch (err) {
      console.error('[search] 读取搜索索引失败：', err)
      return null
    }
  })()
  return cache
}
