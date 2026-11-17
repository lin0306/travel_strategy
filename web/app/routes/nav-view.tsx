/**
 * 当前该渲染哪一页 —— 单页模式下的「路由分发」。
 *
 * ## 为什么不是直接用 `<Outlet />`
 * 2026-11-18 起 URL 不再承载状态（见 `common/logic/nav/navStore.ts`）。
 * 路径恒为 `/`，React Router 的匹配结果永远停在 index route 上 ——
 * 它分不出「用户在看成都还是西安」。分发改由层级状态决定。
 *
 * ★ 这里只做「选组件」，不持有任何状态。四个页面组件本身**一行没改形态**
 *   （它们内部从 `useNav()` 取参）。
 * ★ `nation` 档渲染 `<Outlet />`：那正是 `routes.ts` 里的 index route（首页），
 *   这样布局路由的契约仍然成立，首页也不用被重复 import 一遍。
 */

import { Outlet } from 'react-router'

import { useNav } from '~/common/logic/nav/navStore'
import CityRoute from '~/routes/city'
import PlanRoute from '~/routes/plan'
import PoiRoute from '~/routes/poi'
import ProvinceRoute from '~/routes/province'

export function NavView() {
  const nav = useNav()
  switch (nav.level) {
    case 'province':
      return <ProvinceRoute />
    case 'city':
      return <CityRoute />
    case 'poi':
      return <PoiRoute />
    case 'plan':
      return <PlanRoute />
    default:
      return <Outlet />
  }
}
