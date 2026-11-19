/**
 * 应用根组件（SSG：`ssr: false` + `prerender`）。
 *
 * ## 两个必须在 HTML 层面做对的事
 * 1. **`viewport-fit=cover` 必须有** —— 否则 `env(safe-area-inset-*)` 恒为 0，
 *    移动端的刘海 / Home 指示条会盖住浮层内容。而且加了它之后**不能**再写
 *    `user-scalable=no`（禁止缩放是明确的无障碍问题）。
 * 2. **语言与主题色**：`lang="zh-CN"` 影响中文断行与字体回退；主题色用主色，
 *    让移动端地址栏与页面连成一体。
 */

import { Links, Meta, Outlet, Scripts, ScrollRestoration, isRouteErrorResponse } from 'react-router'

import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE } from './common/data/site'
import { IconSprite } from './common/ui/Icon'

import './app.css'

/**
 * `<head>` 里的元信息（`<Meta />` 在这里取值）。
 *
 * ## 为什么单独记一笔（2026-11-19）
 * 之前**一条 meta 都没导出**，于是预渲染出来的 `index.html` 里连 `<title>` 都没有 ——
 * 浏览器拿不出标题，就把 URL 显示在标签页上（Netlify 上就是
 * `travel-strategy.netlify.app`）。所有静态检查都是绿的：`tsc` 不看 HTML、
 * 构建也不报错，只有**真的看一眼标签页**才会发现。
 *
 * ★ 站名与描述都从 `data/site.ts` 取，不在这里写第二份 —— 顶栏站标用的是同一个词，
 *   两处各写一遍等于给「改站名」留一个必然漏改的点。
 * ★ 单页站没有路由级 meta（`routes.ts` 只剩一条），所以这组值是**全站唯一的一套**。
 */
export const meta = () => [
  { title: SITE_TITLE },
  { name: 'description', content: SITE_DESCRIPTION },
  { name: 'color-scheme', content: 'light' },
  { property: 'og:type', content: 'website' },
  { property: 'og:site_name', content: SITE_NAME },
  { property: 'og:title', content: SITE_TITLE },
  { property: 'og:description', content: SITE_DESCRIPTION },
  { name: 'twitter:card', content: 'summary' },
]

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <meta name="theme-color" content="#FFFFFF" />
        {/*
          ★ 微信不读 `og:` 标签，也不读 `apple-mobile-web-app-capable` 的部分变体，
          但这两个仍对其它浏览器 / 分享卡片有效，成本为零，留着。
        */}
        <meta name="format-detection" content="telephone=no" />
        {/*
          ★ 图标必须显式声明（文件在 `public/favicon.svg`）。
          没有这个 `<link>` 时浏览器会自己去要 `/favicon.ico`，拿 404 并在控制台留一条
          错误 —— 它不影响功能，但会让"控制台很脏"，掩盖真正的问题。
          用 SVG 而不是 .ico：一个文件覆盖所有尺寸，且是纯文本可读可改。
        */}
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <Meta />
        <Links />
      </head>
      <body>
        {/*
          ★★ 图标 sprite 必须**挂在 Layout 里**，而不是挂在某个页面外壳里。
          所有 `<Icon>` 输出的都是 `<use href="#i-xxx">`，它指向的是**同一份文档里**
          由 sprite 定义的 `<g id="i-xxx">`。这份 sprite 一旦没渲染，
          `<use>` 就指向一个不存在的 id —— **浏览器不报错、不警告、不占位**，
          每个图标静默变成一个空白方块。

          这个坑真的踩过：`IconSprite` 定义在 `Icon.tsx` 里、注释写着"挂在外壳里"，
          但没有任何地方真的渲染它，于是**全站图标一个都没显示出来**，
          而所有静态检查（包括 tsc）都是绿的 —— 因为 JSX 里 `<Icon>` 用法完全正确。
          判据只能来自运行时：`document.querySelectorAll('[id^="i-"]').length` 是否为 0。
          放在 Layout（而非 App）是为了连错误边界页也覆盖到。
        */}
        <IconSprite />
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export default function App() {
  return <Outlet />
}

/**
 * 路由级错误边界。
 *
 * ⚠️ 注意这里**只在 SSR/预渲染阶段会真正触发**（运行时是纯前端路由）。
 *    客户端异常由各页面自己的错误态兜住，不走这里。
 */
export function ErrorBoundary({ error }: { error: unknown }) {
  let title = '出了点问题'
  let detail = '请刷新页面重试'

  if (isRouteErrorResponse(error)) {
    title = `${error.status} ${error.statusText}`
    detail = typeof error.data === 'string' ? error.data : detail
  } else if (error instanceof Error) {
    detail = error.message
  }

  return (
    <main className="grid min-h-svh place-items-center bg-bg p-6">
      <div className="max-w-md rounded-[var(--flt-radius)] bg-surface p-6 shadow-[var(--flt-shadow)]">
        <h1 className="m-0 text-lg font-semibold">{title}</h1>
        <p className="mt-2 mb-0 text-sm text-ink-2">{detail}</p>
        <a
          href="/"
          className="mt-4 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white no-underline"
        >
          回到首页
        </a>
      </div>
    </main>
  )
}
