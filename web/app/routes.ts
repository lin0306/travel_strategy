/**
 * 路由表（React Router 7 Framework 模式）。
 *
 * ## 为什么几乎所有页面都套在 `map-shell` 里
 * 「地图即画布」不是某一个页面的样式，而是**布局模型**：地图层铺满视口，
 * 所有 UI 都是浮层。既然每个页面都要这张地图，它就该是**布局路由**，
 * 而不是每个页面各写一遍。
 *
 * ## 「关于 / 数据来源」现在不是路由了（2026-09-29）
 * 它从两个独立页面（`/about` + `/credits`）改成了**顶栏的一枚按钮 + 一块弹窗**
 * （`common/ui/doc/AboutModal`，内容见 `common/ui/doc/AboutContent`）。
 * 两个页面内容重叠、又没有分享场景 ⇒ 合并成一份，路由与预渲染项一并删掉。
 * 所以本表现在**只有** `map-shell` 一层布局，没有 shell 外的页面。
 *
 * ## 预渲染列表不在这里维护
 * 路由表是**静态**的；动态的 `/city/:id` 由 `react-router.config.ts` 的
 * `prerender()` 从 `data/` 里长出来（新增城市不改这里一行代码）。
 */

import { type RouteConfig, index, layout, route } from '@react-router/dev/routes'

export default [
  layout('routes/map-shell.tsx', [
    index('routes/home.tsx'),
    route('province/:adcode', 'routes/province.tsx'),
    route('city/:cityId', 'routes/city.tsx'),
    // 详情页既可从预览卡进入，也可直接访问（预渲染供 SEO）
    route('city/:cityId/poi/:poiId', 'routes/poi.tsx'),
    // 行程页只预渲染空壳 —— 行程内容在 localStorage 里，构建期无从得知
    route('city/:cityId/plan', 'routes/plan.tsx'),
  ]),
] satisfies RouteConfig
