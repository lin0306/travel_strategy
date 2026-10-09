/**
 * 视口与端别。
 *
 * ★ 端别的**唯一**判据是媒体查询（与 05 文档断点一致：< 640px 为移动），
 *   而不是 UA、不是设备类型、不是 `matchMedia('(pointer: coarse)')`。
 *   理由：断点决定的是**浮层形态**，而形态取决于可用宽度 —— 一个 800px 宽的
 *   桌面窗口同样塞不下 348px 侧栏 + 326px 预览卡 + 地图。
 *
 * ## 🚨 为什么这里必须用 `useSyncExternalStore` 而不是 `useState`（2026-09-21 修）
 *
 * 原写法是 `useState(() => typeof window === 'undefined' ? true : matchMedia(...).matches)`。
 * 看着合理（"初次就取真实值，避免闪动"），但它有**两个**初始值：
 *   · 预渲染（SSG，无 window）→ `true`  → 渲染手机版底部抽屉 `Sheet`
 *   · 客户端水合（桌面 1418px）→ `false` → 渲染桌面版左面板 `Overlay`
 * 两边结构完全不同 → React 判为 **hydration mismatch**，把整棵 document 树丢弃重渲染。
 *
 * 实测代价（CDP 抓到的两条报错，都在 `/province/*`、`/city/*`，`/` 不受影响
 * 是因为首页只拿它决定地图聚合模式、不用它切换组件结构）：
 *   ① `Hydration failed because the server rendered HTML didn't match the client`
 *   ② `Encountered a script tag while rendering React component`
 *      —— ②是①的连带：重渲染整个 document 时，腾讯 SDK 的 `<script>` 恰被
 *      `loader.ts` 的 effect 插进了 `<head>`，React 在重渲染 `<head>` 时撞上它。
 *
 * `useSyncExternalStore` 正是为这类"服务端与客户端快照必然不同"的场景设计的：
 *   · `getServerSnapshot` 在**服务端渲染与水合首次渲染**都用 → 结构必然一致
 *   · 水合后 React 立刻用 `getSnapshot` 的真实值同步重渲染（在绘制前完成）
 * 于是既没有 mismatch，也不会看到"先手机版再跳桌面版"的闪动。
 *
 * ⚠️ `getServerSnapshot` 必须返回**移动端** `true`：这是"移动优先"在端别判定上的
 *    落点，与 `app.css` 里"默认样式写移动端、媒体查询只做向上增强"是同一条约定。
 */

import { useSyncExternalStore } from 'react'

/** 05 文档断点：S(<640) 为移动默认形态 */
const MOBILE_QUERY = '(max-width: 639px)'

/** 预渲染 / 水合首次渲染用的快照 —— 移动优先 */
const MOBILE_ON_SERVER = true
/** 视口高度没有服务端真值，给一个稳定默认值（只影响水合首帧，随即被真实值替换） */
const HEIGHT_ON_SERVER = 800

/* ────────────────────────────────────────────────
 * 端别
 * ────────────────────────────────────────────── */

/**
 * `getSnapshot` / `getServerSnapshot` 都必须是**模块级稳定函数**：
 * 每次渲染新建一个箭头函数会让 React 每次比对都判定"快照变了"，直接无限重渲染。
 */
function subscribeMobile(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const mq = window.matchMedia(MOBILE_QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

function getMobileSnapshot(): boolean {
  if (typeof window === 'undefined') return MOBILE_ON_SERVER
  return window.matchMedia(MOBILE_QUERY).matches
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribeMobile, getMobileSnapshot, () => MOBILE_ON_SERVER)
}

/* ────────────────────────────────────────────────
 * 视口高度（svh）
 * ────────────────────────────────────────────── */

/**
 * ⚠️ 用 `100svh` 而不是 `100vh`：移动端 `100vh` 会把地址栏算进去，
 *    实际比可视区高 56–80px，底部浮层会被推到屏幕外。
 *    也不用 `dvh` —— 它随地址栏收放实时变化，浮层会跟着抖。
 *
 * 这里只在需要**像素值**时读取（如 Sheet 档位高度），纯 CSS 场景一律走 svh 单位。
 */
function subscribeResize(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener('resize', onChange)
  return () => window.removeEventListener('resize', onChange)
}

function getHeightSnapshot(): number {
  return typeof window === 'undefined' ? HEIGHT_ON_SERVER : window.innerHeight
}

export function useViewportHeight(): number {
  return useSyncExternalStore(subscribeResize, getHeightSnapshot, () => HEIGHT_ON_SERVER)
}
