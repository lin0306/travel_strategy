/**
 * 客户端入口 —— 把预渲染出来的 HTML「接活」（hydration）。
 *
 * ## 为什么要自己提供（而不是用 RR 的默认版本）
 * 与 `entry.server.tsx` 同理：入口文件缺失会让 RR 走「自动补依赖 + 自动 install」的
 * 兜底路径，那一步在包管理器不一致时会直接崩掉 dev server。
 * 显式拥有两个入口，项目的行为就完全由我们自己决定，不再依赖框架的启发式。
 *
 * ## 一个和本项目强相关的点：`onRecoverableError`
 * 我们是**预渲染 + 客户端接管**：构建期在 Node 环境渲染的那份 HTML，
 * 运行时要被浏览器里的 React 原样接上，任何「两边渲染结果不一致」都会变成
 * hydration 失败，而它在生产环境**默认是静默的**（React 悄悄丢弃服务端 HTML 重渲染整棵树，
 * 表现为「闪一下」或「地图浮层跳一下」，极难定位）。
 *
 * 本项目地图层尤其容易踩到这个坑（构建期没有 `window`，运行时才有）。
 * 所以这里挂一个**仅开发期**的重放日志，把这类问题从「静默」变成「看得到」；
 * 生产环境不输出，避免刷爆用户控制台。
 */

import { StrictMode, startTransition } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { HydratedRouter } from 'react-router/dom'

/**
 * ★★ 路径归一必须在**水合之前**做完（2026-11-18 单页化）。
 *
 * 预渲染只产出 `/` 一个页面，路由表也只有 index 一条。用户拿旧链接
 * （`/city/chengdu`、收藏夹、别人发来的地址）进来时，React Router 会
 * **先**匹配不到路由 → 渲染 404 → 外壳（`map-shell`）根本不挂载
 * ⇒ 写在它 effect 里的归一逻辑永远不会执行。实测表现：停在 404 页不动，
 * 而且地址栏还留着 `/city/chengdu`，看起来像"整个站坏了"。
 *
 * 所以这一行只能放在 `hydrateRoot` 之前：先让地址变成 `/`，RR 才会
 * 匹配到 index、渲染出真正的那一页。
 *
 * ★ 保留 hash：`#itin=` 分享链接靠它带行程，归一不能把它一起抹掉。
 * ★ 保留 `history.state`：RR 自己会往里面写 `key` / `usr`，丢掉会让
 *   初次水合的后退行为错乱。
 */
if (typeof window !== 'undefined' && window.location.pathname !== '/') {
  window.history.replaceState(window.history.state, '', '/' + window.location.hash)
}

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
    {
      onRecoverableError(error) {
        if (import.meta.env.DEV) {
          console.warn('[hydration] 服务端与客户端渲染结果不一致，React 已重渲染：', error)
        }
      },
    },
  )
})
