/**
 * 路由表（React Router 7 Framework 模式）。
 *
 * ## 2026-11-18：只剩一条路由
 * 用户定：**地址栏固定不变，层级状态只进客户端存储**。于是
 * `/province/:adcode`、`/city/:cityId`、`/city/:cityId/poi/:poiId`、
 * `/city/:cityId/plan` 全部退场 —— 路径不再表达"我在哪"。
 *
 * 页面切换改由 `common/logic/nav/navStore.ts` 的层级状态驱动，
 * 分发点是 `routes/nav-view.tsx`。所以本表只剩「地图外壳 + 首页」。
 *
 * ★ 保留 `index('routes/home.tsx')` 而不是让外壳直接 import 首页：
 *   `NavView` 在 `nation` 档渲染的是 `<Outlet />`，它就是这个 index route。
 *   这样外壳仍然是"布局路由"，React Router 的 Outlet 契约成立。
 *
 * ## 历史（留着以免有人再把路由加回来）
 * 「关于 / 数据来源」早在 2026-09-29 就从两个独立页改成顶栏弹窗了；
 * 详情页、行程页、省级页都曾在表里，现在都由 `navStore` 的 level 表达。
 */

import { type RouteConfig, index, layout } from '@react-router/dev/routes'

export default [
  layout('routes/map-shell.tsx', [index('routes/home.tsx')]),
] satisfies RouteConfig
