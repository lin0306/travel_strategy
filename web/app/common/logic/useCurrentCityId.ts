/**
 * 「当前正在看哪座城市」—— 从 **URL** 认，不从页面状态认。
 *
 * ## 为什么需要它（而不是 `useParams()`）
 * 规划面板（右侧浮层）与「添加行程」选择器都挂在 **外壳**（`routes/map-shell.tsx`）
 * 与顶栏上，**不在** `/city/:cityId` 这条路由的内部 —— `useParams()` 在那里是空的。
 * 而"新建规划要挂在哪座城"「这个点属于哪座城」都必须知道它。
 *
 * ## 为什么以 URL 为唯一判据
 * 与全站一致：URL 是"我在哪"的最终答案（顶栏那套地区文字已删，见 `TopBar.tsx` 文件头）。
 * 从页面状态里再算一份，就会重新长出"两套并行的我在哪"。
 *
 * ⚠️ 首页（`/`）与省级页确实**没有**城市 —— 返回 `null` 是正确答案，
 *    调用方要按"没有城市上下文"处理（例如禁用「新建规划」并说明原因），
 *    而不是随便挑一座城。
 */

import { useLocation } from 'react-router'

/** `/city/chengdu` · `/city/chengdu/plan` · `/city/chengdu/poi/xxx` 都认 */
const CITY_PATH = /^\/city\/([^/]+)/

export function useCurrentCityId(): string | null {
  const { pathname } = useLocation()
  const m = CITY_PATH.exec(pathname)
  const raw = m?.[1]
  if (!raw) return null
  try {
    return decodeURIComponent(raw)
  } catch {
    // 坏的百分号编码不该让整页崩 —— 原样返回，后续 loadCity 自然会失败并如实报"未收录"
    return raw
  }
}
