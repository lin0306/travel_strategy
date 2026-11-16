/**
 * 高德静态图代理（Netlify Functions v2）—— 存在只为**不让 key 进浏览器**。
 *
 * ## 为什么需要它（2026-11-17）
 *
 * 行程海报的底图必须由浏览器取（要画进 canvas，同源才能 `toBlob`）。原先前端直接
 * `fetch('https://restapi.amap.com/v3/staticmap?...&key=VITE_AMAP_WEB_KEY')`，
 * 于是 key 同时出现在 bundle 和每一次请求的 URL 里 —— 打开 DevTools 就能复制走。
 *
 * 高德这边**没有可用的前端防护**，这是平台能力差异，不是配置没做对：
 *   · 域名白名单只属于「Web端(JS API)」类型的 key，静态图只认「Web服务」key；
 *   · 「Web服务」key 只能配 IP 白名单，而浏览器出口 IP 不固定 ⇒ 一配就挂；
 *   · 数字签名（SK）救不了 —— 签名要在客户端算，SK 同样会发到浏览器。
 *
 * ⇒ 把请求挪到服务端：key 只读 `AMAP_WEB_KEY`（**不带 `VITE_` 前缀**，所以永远不会
 *   被 Vite 注入 bundle），域名白名单由下面的 `hostAllowed()` 自己实现 ——
 *   等价于给高德补上一层它本来没有的能力。
 *
 * ## 已知边界（别把这里当绝对防护）
 *
 * - Referer 可以伪造（curl 带个头就行）⇒ 这是**抬高门槛**，不是拦截。
 *   真正的兜底是「海报 key 与采集 key 分开」+ 高德控制台的配额告警。
 * - 本地 `pnpm dev` 不跑 functions ⇒ 该路径 404 ⇒ 海报降级为无底图（路线标记照画）。
 *   要在本地看底图必须用 `netlify dev`。
 * - CDN 缓存命中时不执行 Referer 校验（`Netlify-CDN-Cache-Control`）。缓存键是完整
 *   query，被猜中才会命中；危害上限就是一张图，可以接受。
 */

const AMAP_STATIC = 'https://restapi.amap.com/v3/staticmap'

/**
 * 只透传这几个参数 —— **白名单而不是黑名单**。
 *
 * 若原样转发 query，这个函数就成了「任意高德接口代理」，别人可以拿它当免费网关
 * 去刷其它接口（甚至换个 path）。白名单把能刷的面收窄到「静态图、指定三参数」。
 */
const PASSTHROUGH = ['location', 'zoom', 'size', 'scale']

export default async function handler(req) {
  const referer = req.headers.get('referer') ?? ''
  if (!hostAllowed(referer)) {
    return new Response('forbidden: referer not allowed', { status: 403 })
  }

  const key = process.env.AMAP_WEB_KEY
  if (!key) {
    console.error('[staticmap] 未配置 AMAP_WEB_KEY（Netlify 环境变量，不带 VITE_ 前缀）')
    return new Response('missing AMAP_WEB_KEY', { status: 500 })
  }

  const src = new URL(req.url)
  const q = new URLSearchParams()
  for (const name of PASSTHROUGH) {
    const v = src.searchParams.get(name)
    if (v) q.set(name, v)
  }
  // 三样缺一不可：`size` 写错格式高德回 200 + JSON（infocode 20003），
  // 在这边先挡掉能少一次付费调用。
  if (!q.get('location') || !q.get('zoom') || !q.get('size')) {
    return new Response('missing location / zoom / size', { status: 400 })
  }
  q.set('key', key)

  const upstream = await fetch(`${AMAP_STATIC}?${q}`)
  const ct = upstream.headers.get('content-type') ?? ''

  // ★ 高德对参数错误也是 HTTP 200 + JSON，所以不能只看 status，必须看 content-type。
  //   错误体原样交回前端 —— `loadBaseMap` 会从中提 `info` 显示到 toast 上
  //   （用户「控制台日志看不到」，关键信息必须上 UI）。
  if (!ct.startsWith('image/')) {
    const body = await upstream.text()
    console.error('[staticmap] 高德返回非图片：', body.slice(0, 200))
    return new Response(body, {
      status: 502,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': ct,
      // 同一 bbox 的底图一天内不会变 ⇒ 让 CDN 缓存，直接省掉一次高德调用。
      // ★ 必须用 `Netlify-CDN-Cache-Control`：函数响应默认不进 CDN 缓存。
      'Netlify-CDN-Cache-Control': 'public, max-age=86400',
      // 浏览器侧短缓存：同一天内重复导出不再回源
      'cache-control': 'public, max-age=3600',
    },
  })
}

/**
 * 域名白名单 —— 就是高德 Web服务 key 缺失的那一层。
 *
 * 匹配规则与腾讯的域名白名单一致：填 `netlify.app` 就**连同所有子域**一起放行，
 * 所以 `xxx.netlify.app` 和 `deploy-preview-123--xxx.netlify.app` 都命中。
 *
 * `ALLOWED_ORIGINS` 可用逗号分隔覆盖（加了自定义域名时必须改，否则海报没底图）。
 */
function hostAllowed(referer) {
  if (!referer) return false
  let host
  try {
    host = new URL(referer).hostname.toLowerCase()
  } catch {
    return false
  }
  const list = (process.env.ALLOWED_ORIGINS ?? 'netlify.app,localhost,127.0.0.1')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return list.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
}
