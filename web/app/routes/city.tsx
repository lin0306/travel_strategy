/**
 * 城市页路由 —— **薄壳**：只做「取数 + 按端分派」，一行形态都不含。
 *
 * ## 三层各管什么
 * | 层 | 文件 | 职责 |
 * |----|------|------|
 * | 本文件 | `routes/city.tsx` | 决定渲染哪一端（判据见下），没有任何样式与状态 |
 * | 逻辑 | `common/logic/useCityView.ts` | 取数 / 过滤 / 图层 / 取景 —— **两端共用同一份** |
 * | 形态 | `desktop/ui/CityView` · `mobile/ui/CityView` | 只摆外壳（左面板 vs 底部 Sheet） |
 *
 * ## 端别怎么判（★ 不是 UA）
 * 唯一判据是**媒体查询**（`common/logic/useViewport`）。SSG 构建期没有
 * `window`，所以判定必然发生在浏览器里；而"断点决定浮层形态"这件事，
 * 判据只能是**可用宽度** —— 一个 800px 宽的桌面窗口同样塞不下
 * 348px 侧栏 + 326px 预览卡 + 地图。
 *
 * ★ URL **不分叉**：`/city/xian` 一条地址，手机点开是手机版、桌面点开是桌面版。
 *   双 URL（`/m/...`）会让页数翻倍、SEO 变成"两套地址抢同一个词"，
 *   而收益是假的 —— 反正都要先在浏览器里判一次。
 */

import { DesktopCityView } from '~/desktop/ui/CityView'
import { MobileCityView } from '~/mobile/ui/CityView'
import { useCityView } from '~/common/logic/useCityView'
import { useIsMobile } from '~/common/logic/useViewport'

export default function CityRoute() {
  const view = useCityView()
  return useIsMobile() ? <MobileCityView view={view} /> : <DesktopCityView view={view} />
}
