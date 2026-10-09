/**
 * 图片镜像 —— **全站图片的统一出口变换**。
 *
 * ## 为什么需要它
 *
 * Wikimedia 的图片服务器在国内**不可达**（2026-09-22 实测，IPv4 与 IPv6 各自三次）：
 *
 * | 域名 | 结果 |
 * |------|------|
 * | `commons.wikimedia.org`（API） | 200 · 3.1s |
 * | `upload.wikimedia.org`（原图） | **000 · 15s 超时** |
 * | `thumb.wikimedia.org`（缩略图） | **000 · 15s 超时** |
 *
 * 也就是说：**搜得到、取不到** —— API 能给出精确的图，但图片域名连不上。
 * 数据里 643 张 Wikimedia 图若直链引用，国内用户看到的是全部空白。
 *
 * ## 为什么不改数据、而是改出口
 *
 * 1. **数据保持可溯源**：`images[].url` 留原始地址，`credit.sourceUrl` 指向 Commons 页面。
 *    图片地址一旦被写死成镜像域名，将来换镜像要重跑整条流水线。
 * 2. **一处改，全站生效**：所有消费方（预览卡 / 详情 / 城市 hero / 图集）都从
 *    `cityRegistry.loadCity()` 拿数据，在那儿改写一次即可。
 * 3. **可关闭**：把 `MIRROR_ENABLED` 改成 `false` 就退回原链，不用碰任何 JSON。
 *
 * ## 镜像服务
 *
 * 走 `wsrv.nl`（免费公共图片代理）：请求发到镜像，镜像在境外回源抓图并缓存，
 * 再把结果交给国内用户 —— 绕开"图片域名连不上"这一段。
 * 实测 6/6 抽样全部返回真实 JPEG（64–145KB @800px，1–2s）。
 *
 * ⚠️ 它是第三方公共服务，没有 SLA。生产环境若要求稳定，应换成自建 Worker /
 *    CDN 回源，届时**只改 `MIRROR_ENDPOINT` 一处**。
 */

/** 关掉它就退回直链（排障用：判断是镜像的问题还是数据的问题） */
const MIRROR_ENABLED = true

/**
 * 需要走镜像的域名。
 * ★ 只列**图片**域名 —— `commons.wikimedia.org` 是 API / 页面域名，国内可达，
 *   且数据里的 `credit.sourceUrl` 指向它，不能镜像（那是给人点的溯源链接，不是 `<img src>`）。
 */
const MIRROR_HOSTS = ['upload.wikimedia.org', 'thumb.wikimedia.org'] as const

/** 镜像端点。换服务商只改这一行。 */
const MIRROR_ENDPOINT = 'https://wsrv.nl/'

/** 主图宽度预算（卡片大图 / 详情主图） */
const WIDTH_FULL = 800

/** 缩略图宽度（图集小图 / 列表预览） */
const WIDTH_THUMB = 400

/**
 * 行内小图宽度（搜索结果列表那种 ~40px 的方形缩略图）。
 * 显示尺寸的 4 倍 —— 照顾 2x/3x 屏，同时别为一行小图去拉 400px。
 */
export const WIDTH_THUMB_SM = 160

/** 取出 URL 的主机名；解析失败返回 null（相对路径 / 非法串） */
function hostOf(url: string): string | null {
  const m = /^https?:\/\/([^/?#]+)/i.exec(url)
  return m?.[1]?.toLowerCase() ?? null
}

/** 是否已经是镜像地址 —— 保证函数**幂等**，重复调用不会套两层 */
function isMirrored(url: string): boolean {
  return url.startsWith(MIRROR_ENDPOINT)
}

/** 剥掉 utm 之类的追踪参数：它们对取图没用，且 `&` 会干扰镜像自己的参数解析 */
function stripQuery(url: string): string {
  const i = url.indexOf('?')
  return i === -1 ? url : url.slice(0, i)
}

/**
 * 单张图走镜像。
 *
 * ★ 源 URL 要**整体 percent-encode**：Wikimedia 的文件名本身已带 `%E5%B9%B4` 这类编码，
 *   不编码的话 `%` 与 `&` 会被镜像当成自己的参数分隔符。
 */
export function mirrorUrl(url: string, width: number = WIDTH_FULL): string {
  if (!MIRROR_ENABLED || isMirrored(url)) return url

  const host = hostOf(url)
  if (!host || !(MIRROR_HOSTS as readonly string[]).includes(host)) return url

  // 去掉协议：wsrv.nl 的 `url` 参数吃 "域名/路径" 形式
  const raw = stripQuery(url).replace(/^https?:\/\//i, '')
  return `${MIRROR_ENDPOINT}?url=${encodeURIComponent(raw)}&w=${width}&output=jpg&q=80`
}

/** 带 `url` + 可选 `thumbUrl` 的图片条目 */
type ImageLike = { url: string; thumbUrl?: string | null }

function mirrorImage<T extends ImageLike>(im: T): T {
  return {
    ...im,
    url: mirrorUrl(im.url, WIDTH_FULL),
    // thumbUrl 缺省时保持缺省（渲染处有 `?? url` 兜底），不凭空造一条
    thumbUrl: im.thumbUrl ? mirrorUrl(im.thumbUrl, WIDTH_THUMB) : im.thumbUrl,
  }
}

/**
 * 城市索引项的封面图走镜像。
 *
 * ★ 为什么单独有一个：`cities.index.json` 是**脚本产物**，里面存的是原始图片地址，
 *   而读它的那条路径（`loadCityIndex`）**不经过 `loadCity()`** —— 漏掉这里的话，
 *   首页与列表页的城市封面会全部空白，而详情页却是好的（最迷惑的一种不一致）。
 */
export function mirrorIndexItems<T extends { coverImage: string }>(items: T[]): T[] {
  return items.map((it) => ({ ...it, coverImage: mirrorUrl(it.coverImage) }))
}

/**
 * 搜索索引里每个景点的 `cover` 走镜像（结果列表的缩略图）。
 *
 * ★ 与 `mirrorIndexItems` 是同一类东西、同一个坑：搜索索引也是**脚本产物**，
 *   里面存的也是原始地址，而读它的那条路径（`loadSearchIndex`）**同样不经过
 *   `loadCity()`**。漏掉这里 → 搜索结果里缩略图全部空白，而点进详情却好好的
 *   （"同一张图，一处有、一处没有"是最难查的一种不一致）。
 * ★ `cover` 可以是 `null`（该景点一张图都没有）—— 保持 `null`，别变成空串。
 */
export function mirrorSearchCovers<T extends { pois: Array<{ cover: string | null }> }>(index: T): T {
  return {
    ...index,
    pois: index.pois.map((p) => ({
      ...p,
      cover: p.cover ? mirrorUrl(p.cover, WIDTH_THUMB_SM) : null,
    })),
  }
}

/**
 * 一座城市的全部图片走镜像 —— 城市 hero 图 + 每个 POI 的图集。
 *
 * 在 `cityRegistry.loadCity()` 里**校验之后**调用：
 * 让 Schema 校验针对原始干净数据，镜像纯粹是展示侧的变换。
 */
export function mirrorCityImages<T extends { heroImages: ImageLike[]; pois: Array<{ images: ImageLike[] }> }>(
  city: T,
): T {
  return {
    ...city,
    heroImages: city.heroImages.map(mirrorImage),
    pois: city.pois.map((p) => ({ ...p, images: p.images.map(mirrorImage) })),
  }
}
