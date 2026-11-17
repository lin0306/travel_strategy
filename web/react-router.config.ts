import type { Config } from '@react-router/dev/config'

/**
 * SSG：ssr=false（运行时无服务端）+ prerender（构建期把 `/` 渲染成真 HTML）。
 *
 * ## 2026-11-18：预渲染从 5184 页降到 1 页
 * 用户定「URL 固定不变，层级只存 localStorage / sessionStorage」⇒ 路径不再
 * 承载"我在哪个省 / 哪座城 / 哪个景点"，城市页与景点页也不再是可直达的地址。
 * 于是这里只需要首页一条。
 *
 * ★ 这一步顺带解决了部署侧的老问题：原来 6330 个 JSON 数据模块会随
 *   5184 条路由一起进 Rollup 图，Netlify 的 2GB 堆直接 OOM。现在构建期
 *   只渲染首页，数据在运行时按需加载。
 * ★ 代价（已与用户确认）：深链、收藏、SEO 全部没有。想恢复其中任何一项，
 *   都得先把路由装回去 —— 那时记得同时恢复 navStore 与路径的对应关系。
 */
export default {
  // ★ 输出目录必须对齐 netlify.toml 的 `publish = "dist/client"`（base="web"）。
  //   React Router 默认是 `build`；不改的话本地构建正常，CI 发布时找不到产物。
  buildDirectory: 'dist',
  ssr: false,
  prerender: ['/'],
} satisfies Config
