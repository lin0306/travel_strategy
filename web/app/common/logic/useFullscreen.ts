/**
 * 全屏（Fullscreen API）—— 顶栏那枚 ⛶ 的**唯一出口**。
 *
 * ## 为什么锁在这一层
 * `requestFullscreen` 是个**一不小心就把 UI 丢在外面**的调用：
 *
 *   · 目标是 `document.documentElement`（= 整个文档）—— 顶栏、左侧清单、
 *     右侧详情、路线规划面板**全都跟进去**。地图是全站唯一的画布，
 *     UI 全是盖在它上面的浮层，两者必须同进同出。
 *   · 目标是 `.map-layer`（听起来最贴近"我要地图全屏"）—— 浮层都在这一层**之外**，
 *     进入全屏后屏幕上只剩一张裸地图：没有搜索、没有底图下拉、没有回首页的出口，
 *     而 `Esc` 之外的退路全没了。
 *
 * 所以：调用目标写死在这里，调用点也只有一个（护栏 AI① 守）；
 * UI 层只拿到 `{ supported, active, toggle }` 三个值。
 *
 * ## ★ 必须 `useSyncExternalStore`，不能用 `useState` 读初值
 *
 * 本站是 SSG（`ssr: false` + prerender）—— **预渲染时没有 `document`**。
 * 写成 `useState(() => document.fullscreenElement !== null)` 会两种死法任选其一：
 *   · 直接抛错，整个预渲染挂掉；
 *   · 服务端 / 服务端快照与客户端首帧取值不同 → **hydration mismatch**
 *     （`useViewport` 文件头记过这个坑的代价：整棵 document 树被丢弃重渲染，
 *     连带把腾讯 SDK 插进 `<head>` 的 `<script>` 撞出第二条报错）。
 *
 * `useSyncExternalStore` 的 `getServerSnapshot` 就是为这种场景准备的：
 * 预渲染与水合首帧都用稳定值，水合后立刻用真值重渲染 —— 既不报错也不闪。
 *
 * ## Safari 的前缀那套
 * Safari 至今只认 `webkitRequestFullscreen` / `webkitExitFullscreen` /
 * `webkitFullscreenElement`，**并且事件名也要带前缀**（`webkitfullscreenchange`）。
 * 少了事件监听的表现是"进得去、出不来时图标不跟着变"。
 *
 * ⚠️ iPhone 版 Safari **不支持元素全屏**（只有 `<video>` 可以）⇒ `supported = false`，
 *    入口直接不渲染 —— 一枚按下去没反应的按钮比没有按钮更糟（这个坑本仓库踩过：
 *    早先站名按钮兼做回首页，在首页上是空操作，用户直接问"这玩意儿有什么用"）。
 *
 * ## `Esc` 的双重含义（已知，不打算改）
 * 浏览器把 `Esc` 退出全屏的行为收在系统里，**网页截不到也拦不住**。
 * 于是全屏中按 `Esc` 想关某块浮层时，会同时退出全屏。这是浏览器的统一语义
 * （YouTube / Google Maps 都一样），改不成"只关浮层"，硬拗反而破坏一致性。
 */

import { useCallback, useSyncExternalStore } from 'react'

import { debugLog } from '~/common/logic/debugLog'

/** Safari 的前缀 API 不在标准类型里，这里显式补齐 */
type FullscreenDoc = Document & {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
}

type FullscreenEl = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void
}

export interface FullscreenState {
  /** 环境是否支持元素全屏。不支持时调用方应当**不渲染**入口，而不是给个按不动的按钮 */
  supported: boolean
  /** 当前是否处于全屏 */
  active: boolean
  /** 进 / 出。★ 同一枚 button 兼两态 —— 与 `aria-pressed` 配套 */
  toggle: () => void
}

/** 预渲染 / 水合首帧的快照：一律当作"不在全屏" */
function serverSnapshot(): boolean {
  return false
}

function currentDoc(): FullscreenDoc | null {
  return typeof document === 'undefined' ? null : (document as FullscreenDoc)
}

/** 当前全屏元素（标准 + Safari 前缀） */
function fullscreenElement(d: FullscreenDoc): Element | null {
  return d.fullscreenElement ?? d.webkitFullscreenElement ?? null
}

/* ────────────────────────────────────────────────
 * supported（环境能力，运行期内不会变）
 * ────────────────────────────────────────────── */

/** 能力值恒定 ⇒ 没有可订阅的事件。空订阅比"假装会变"诚实 */
function subscribeNothing(): () => void {
  return () => {}
}

/**
 * ⚠️ 必须是**模块级稳定函数**：每次渲染新建一个箭头函数会让 React 判定
 *    "快照变了"，然后无限重渲染（`useViewport` 里同一条纪律）。
 */
function supportedSnapshot(): boolean {
  const d = currentDoc()
  if (!d) return false
  const el = d.documentElement as FullscreenEl
  return typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function'
}

/* ────────────────────────────────────────────────
 * active（当前状态）
 * ────────────────────────────────────────────── */

function subscribeActive(onChange: () => void): () => void {
  const d = currentDoc()
  if (!d) return () => {}
  // ★ 两个事件名都要挂：Safari 走到 `exitFullscreen`（标准名）时也可能发带前缀的事件，
  //   漏掉一个 = "退出了但图标还是退出态"（不报错，纯看错状态）
  d.addEventListener('fullscreenchange', onChange)
  d.addEventListener('webkitfullscreenchange', onChange)
  return () => {
    d.removeEventListener('fullscreenchange', onChange)
    d.removeEventListener('webkitfullscreenchange', onChange)
  }
}

function activeSnapshot(): boolean {
  const d = currentDoc()
  if (!d) return false
  return fullscreenElement(d) !== null
}

/** 失败原因只在调试下输出 —— 线上静默 + 状态不变，不会留下半开的界面 */
function reportFailure(where: '进入' | '退出', err: unknown): void {
  debugLog('界面', `全屏${where}失败（浏览器拒绝了这次请求）：${String(err)}`)
}

/**
 * 顶栏那枚按钮用的钩子。
 *
 * ★ `toggle` 内部**自己读当前状态**，不依赖闭包里的 `active` —— 省一个依赖，
 *   也避免"状态更新还没回来时又点了一次"造成反向动作。
 */
export function useFullscreen(): FullscreenState {
  const supported = useSyncExternalStore(subscribeNothing, supportedSnapshot, serverSnapshot)
  const active = useSyncExternalStore(subscribeActive, activeSnapshot, serverSnapshot)

  const toggle = useCallback(() => {
    const d = currentDoc()
    if (!d) return
    // ★ 目标是**整个文档**：UI 全是盖在地图上的浮层，跟着地图一起进全屏才有意义
    const el = d.documentElement as FullscreenEl

    if (fullscreenElement(d)) {
      const exit = d.exitFullscreen ?? d.webkitExitFullscreen
      if (!exit) return
      // ⚠️ 原生方法 this 敏感 —— 必须 `.call(d)`，抽出来裸调用会抛 TypeError
      Promise.resolve(exit.call(d)).catch((e) => reportFailure('退出', e))
      return
    }

    const request = el.requestFullscreen ?? el.webkitRequestFullscreen
    if (!request) return
    // 返回 Promise 会被拒绝的场合：没有用户手势（Robot 式调用）、
    // 被 `allow="fullscreen"` 挡住的 iframe、上一次动画未结束 —— 都不是这里能预判的
    Promise.resolve(request.call(el)).catch((e) => reportFailure('进入', e))
  }, [])

  return { supported, active, toggle }
}
