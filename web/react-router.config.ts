import type { Config } from '@react-router/dev/config'

import { cityIds, loadCity } from './app/common/data/cityRegistry'
import { PROVINCE_ADCODES } from './app/common/data/provinceAdcodes'

/**
 * SSG：ssr=false（运行时无服务端）+ prerender（构建期把每条路由渲染成真 HTML）。
 *
 * 路由列表**从 data/ 里长出来**，不手工维护：
 *   - 新增城市 = 往 data/cities/ 放一份 JSON → 路由自动出现（G5）
 *   - 34 个省级页一并预渲染（省级页对未收录城市显示「待收录」）
 *   - POI 详情页也预渲染，供搜索引擎收录（G6）
 *
 * ★ 「关于 / 数据来源」**不在**这个列表里 —— 它已经不是页面了：
 *   2026-09-29 起它是顶栏的一枚按钮 + 一块弹窗（`common/ui/doc/AboutModal`）。
 *   曾经有 `/about` 与 `/credits` 两个独立页，内容重叠又没有分享场景，已删。
 */
export default {
  // ★ 输出目录必须对齐 netlify.toml 的 `publish = "dist"`（base="web" → web/dist）。
  //   React Router 默认是 `build`；不改的话本地 `pnpm build` 一切正常，
  //   但 CI 发布时会去 dist 找一个根本不存在的目录。**本地看不出问题的那一类坑。**
  buildDirectory: 'dist',
  ssr: false,
  async prerender() {
    const routes = ['/']

    // 省级概览页：34 个省级单位（含中国台湾 / 中国香港 / 中国澳门），一个都不能少
    routes.push(...PROVINCE_ADCODES.map((adcode) => `/province/${adcode}`))

    for (const cityId of cityIds) {
      const city = await loadCity(cityId)
      if (!city) continue
      routes.push(`/city/${cityId}`)
      routes.push(`/city/${cityId}/plan`) // 行程页只预渲染空壳，行程由客户端读 localStorage
      routes.push(...city.pois.map((poi) => `/city/${cityId}/poi/${poi.id}`))
    }

    return routes
  },
} satisfies Config
