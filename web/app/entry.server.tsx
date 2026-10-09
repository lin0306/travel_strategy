/**
 * 服务端入口 —— 只在**构建期预渲染**时执行，运行时没有服务端（`ssr: false`）。
 *
 * ## 为什么必须由我们自己提供这个文件（而不是用 React Router 的默认版本）
 *
 * RR 在 `app/entry.server.tsx` **缺失**时会走一条很激进的兜底路径
 * （`@react-router/dev` 的 `resolveEntryFiles`）：它不用默认模板就完事，
 * 而是会
 *   1. 发现 `package.json` 里没有 `isbot` 依赖 →
 *   2. **自动改写你的 `package.json`**（加上 `"isbot": "^5"`）→
 *   3. 用 `detectPackageManager()` 猜包管理器并执行 `<pm> install`。
 *
 * 第 3 步是硬失败点：它读的是环境变量 `npm_config_user_agent`，也就是**启动 dev 的那个包管理器**。
 * 用 `npm run dev` 启动 → 它就跑 `npm install`；而本项目的 `node_modules` 是 **pnpm** 装的
 * （`.pnpm/` 布局），npm 去读这棵树会直接崩：
 *
 *     npm error Cannot read properties of null (reading 'matches')
 *     Error: Command failed: npm install
 *
 * —— 一个「缺个文件」的问题，最终表现成一条完全看不出因果的 npm 报错，dev server 直接起不来。
 *
 * ## 我们自己的策略：恒用 `onAllReady`，不嗅探 UA
 *
 * 默认模板用 `isbot(userAgent) || isSpaMode` 决定「等全部内容就绪（onAllReady）
 * 还是吐完壳就先响应（onShellReady）」，那是为了给**真 SSR** 保留流式首屏优势。
 * 我们是纯静态站：没有运行时服务端，每条路由都在构建期整份渲染成 HTML，
 * **必须等全部内容就绪**（否则预渲染产物里没有正文，SEO 白做 —— G6 就是靠预渲染产出的 HTML）。
 * 所以这里恒用 `onAllReady`，顺带把 `isbot` 这个依赖整个去掉。
 *
 * ⚠️ 若将来改成真 SSR（`ssr: true`），应当改回按 UA 分流，
 *    否则所有用户都会为「等全部内容」买单，丢掉流式的首屏优势。
 */

import { PassThrough } from 'node:stream'

import type { AppLoadContext, EntryContext } from 'react-router'
import { ServerRouter } from 'react-router'
import { createReadableStreamFromReadable } from '@react-router/node'
import type { RenderToPipeableStreamOptions } from 'react-dom/server'
import { renderToPipeableStream } from 'react-dom/server'

/** 渲染超时上限（毫秒）。超过则中断，避免构建卡死在某个不收敛的路由上。 */
export const streamTimeout = 5_000

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  loadContext: AppLoadContext,
): Promise<Response> {
  // https://httpwg.org/specs/rfc9110.html#HEAD
  if (request.method.toUpperCase() === 'HEAD') {
    return Promise.resolve(
      new Response(null, { status: responseStatusCode, headers: responseHeaders }),
    )
  }

  return new Promise((resolve, reject) => {
    let shellRendered = false

    // 恒用 onAllReady：静态站要的是「完整的 HTML」，不是「更快的半个 HTML」
    const readyOption: keyof RenderToPipeableStreamOptions = 'onAllReady'

    // 在 streamTimeout 之后再留 1s 给已 reject 的边界把内容冲刷出来
    let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(
      () => abort(),
      streamTimeout + 1_000,
    )

    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={routerContext} url={request.url} />,
      {
        [readyOption]() {
          shellRendered = true
          const body = new PassThrough({
            final(callback) {
              // 清掉定时器，避免闭包被长期持有（内存泄漏）
              clearTimeout(timeoutId)
              timeoutId = undefined
              callback()
            },
          })
          const stream = createReadableStreamFromReadable(body)

          responseHeaders.set('Content-Type', 'text/html')

          pipe(body)

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          )
        },
        onShellError(error: unknown) {
          reject(error)
        },
        onError(error: unknown) {
          responseStatusCode = 500
          // 只记录「壳已经吐出去之后」的错误；壳之前的错误会走 reject，
          // 由上层统一记录，这里再记一次就是重复噪声。
          if (shellRendered) {
            console.error(error)
          }
        },
      },
    )
  })
}
