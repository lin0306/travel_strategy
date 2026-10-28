/**
 * 移动端浮层的「同一时刻只开一块」仲裁。
 *
 * 用户 2026-10-28 原话：「还有这个浮层，同时只显示一个吧，不要隐藏一个下方还有一个」。
 * 现象：工具条压在最上层时可以一块一块往上叠 —— 开图层 → 再开规划 → 关掉规划，
 * 露出来的不是地图，是下面还躺着的那块图层。用户关一次没关干净。
 *
 * ## 规则（两条，其余都是推论）
 * 1. **有出口的浮层互相排斥**：景点详情 / 路线规划 / 图层，谁新开谁把别的关掉。
 * 2. **页面主体只赶人、不被赶**：城市清单、省级清单、点位详情页是这一页的**内容**
 *    （用户没打算关掉它们），不参与"被别的浮层关掉"；但它们**挂载时**会把残留的
 *    可选浮层清干净 —— "进了新页面就只剩这一块"。
 *
 * ## 为什么按挂载/卸载注册
 * 项目里所有浮层都是"关掉就 `return null`"（`RoutePlanPanel` / `BasemapSheet` 的门组件），
 * 所以"挂载 ⟺ 开着"。effect 的 cleanup 天然对上"收起"，不需要每个浮层再手写一遍
 * `open` 的依赖数组。
 *
 * ## 为什么不塞进 `Sheet` 自动做
 * `Sheet` 分不清"页面主体"和"可选浮层"，也拿不到别人的关闭方法（关闭动作有的是
 * `planStore`、有的是页面 view 的 `closePoi`、有的是组件自己的 `useState`）。
 */
import { useEffect, useRef } from 'react'

/** key → 怎么关掉它。同一 key 只会有一份（重渲染只换关法，不重复触发关闭） */
const closers = new Map<string, () => void>()

/** 页面主体的 key（不参与互斥，只负责在挂载时赶走残留浮层） */
export const PAGE_SHEET = 'page'

/**
 * 占据浮层位：把**除了自己**以外的浮层全部关掉。
 *
 * ★ 先拷一份再遍历：`close()` 里会同步改 `closers`（被关的那块随即卸载），
 *   直接遍历 Map 会漏掉后面的条目。
 * ★ 已经在位的（`had`）直接返回：浮层重渲染时 effect 不该再关别人一次 ——
 *   否则"详情开着时它自己重渲染"会把手边的东西一起关掉。
 */
export function claimSheet(key: string, close: () => void): void {
  const had = closers.has(key)
  closers.set(key, close)
  if (had) return
  for (const [k, c] of [...closers]) {
    if (k !== key) c()
  }
}

/** 让出浮层位（浮层收起时） */
export function releaseSheet(key: string): void {
  closers.delete(key)
}

/** 页面主体的关闭动作 = 什么都不做（它不是可选项，是这一页的内容） */
const NOOP = () => {}

/**
 * 挂载即占位、卸载即让位。
 *
 * `close` 走 ref：调用方几乎都是内联箭头函数（`() => setOpen(false)`），
 * 每帧一个新身份 —— 放进依赖数组会让 effect 每帧跑一次，等于每帧"抢一次位"。
 */
export function useSheetClaim(key: string, close: () => void, enabled = true): void {
  const ref = useRef(close)
  ref.current = close
  useEffect(() => {
    if (!enabled) return
    claimSheet(key, () => ref.current())
    return () => releaseSheet(key)
  }, [key, enabled])
}

/**
 * 页面主体：挂载时清场，自己不会被别的浮层关掉（关闭动作是空的）。
 *
 * ★ 仍要**卸载时注销**：路由切走的那一刻位子该空出来，否则下一张页面的
 *   `usePageSheet` 会看到"已经有人在位"而跳过清场，残留的规划浮层就留在新页面上。
 *   （这次提交里 cleanup 一定先于新页面的 effect，顺序是安全的。）
 */
export function usePageSheet(): void {
  useSheetClaim(PAGE_SHEET, NOOP)
}
