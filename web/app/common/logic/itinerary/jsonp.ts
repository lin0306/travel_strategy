/**
 * JSONP 请求 —— **腾讯 WebService 在浏览器里唯一走得通的通道**。
 *
 * ## 实测（2026-09-26，一次真实调用 + 一次 Node 直连对照）
 * | 尝试 | 结果 |
 * |------|------|
 * | `fetch(url)` 直连 | **`Failed to fetch`** —— 响应头里**没有 `Access-Control-Allow-Origin`**，浏览器直接拦死 |
 * | 同一个 URL 用 Node 直连（无 CORS 约束） | `status: 0`、520 个折线值 ⇒ **接口本身是好的**，纯粹是跨域 |
 * | 加 `output=jsonp&callback=__cb` | 返回 `__cb&&__cb({...})`，`Content-Type: application/javascript` ⇒ **可用** |
 *
 * 所以"WebService 直连"这句话在浏览器里**只有 JSONP 这一种形态**。
 * 之前 `routeOptions.ts` 用的是 `fetch` —— 那段代码从来没在浏览器里成功过
 * （配的 WebService key 是错的、读取路径也读不到，所以它一直停在"未配置 key"那一步，
 *   连失败都没机会暴露）。
 *
 * ## 代价要说清（这条必须写在代码里，不然下一个人会随手拿它去请求任意地址）
 * JSONP = **把远端返回当脚本在本页的源里执行**。它只对**可信的固定域名**可用
 * —— 这里是 `apis.map.qq.com`，与"加载它的地图 SDK"是同一个信任级别。
 * **绝不要**把它用在用户可控或来路不明的地址上。
 *
 * ## 三条实现纪律
 * 1. **每条出口都要清理**（删 `window` 上的回调 + 摘掉 `<script>`）：
 *    漏一条就是内存泄漏 + 回调名堆积，而且**不报错**。
 * 2. 回调名带随机段：同名回调并发时会互相覆盖，结果串到另一条请求上。
 * 3. 超时自己实现 —— `<script>` 没有超时，网络卡住时它会永远挂着（UI 上就是一直转圈）。
 */

/** 递增序号 + 随机段：同一毫秒内并发也不会撞名 */
let seq = 0

export interface JsonpOptions {
  /** 回调参数名。腾讯用 `callback` */
  callbackParam?: string
  /** 超时（毫秒）。默认 12s */
  timeoutMs?: number
  signal?: AbortSignal
}

/**
 * 发一条 JSONP，拿到解析后的对象。
 *
 * ⚠️ 失败一律 **reject**（不像 `idb.ts` 那样返回 null）——
 *   调用方需要知道"是接口报错还是网络断了"，因为用户为这次调用花了配额。
 */
export function jsonp<T>(url: string, opts: JsonpOptions = {}): Promise<T> {
  const cbParam = opts.callbackParam ?? 'callback'
  const timeoutMs = opts.timeoutMs ?? 12_000
  seq += 1
  const name = `__tmjsp_${seq.toString(36)}_${Math.random().toString(36).slice(2, 8)}`

  return new Promise<T>((resolve, reject) => {
    const win = window as unknown as Record<string, unknown>
    const script = document.createElement('script')
    let done = false

    const cleanup = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      try {
        delete win[name]
      } catch {
        // 某些环境不允许 delete 全局 —— 置成 undefined 也够（回调名带随机段，不会复用）
        win[name] = undefined
      }
      script.remove()
    }

    const fail = (msg: string) => {
      cleanup()
      reject(new Error(msg))
    }

    function onAbort() {
      fail('请求已取消')
    }

    const timer = setTimeout(() => fail('请求超时'), timeoutMs)

    win[name] = (data: T) => {
      cleanup()
      resolve(data)
    }

    // 用 `;` 分隔已有查询串（腾讯的 URL 里已经有 `?`）
    const sep = url.includes('?') ? '&' : '?'
    script.src = `${url}${sep}${cbParam}=${encodeURIComponent(name)}&output=jsonp`
    script.async = true
    // ⚠️ 加载失败（断网 / 被拦截 / 域名不可达）只会走 onerror，不会有任何返回值
    script.onerror = () => fail('脚本加载失败（网络或域名不可达）')

    if (opts.signal?.aborted) {
      onAbort()
      return
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    document.head.appendChild(script)
  })
}
