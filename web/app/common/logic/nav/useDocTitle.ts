/**
 * 标签页标题跟着层级走。
 *
 * ## 为什么必须有它
 * 地址栏恒为 `/`（2026-11-18 单页化），于是**标签页成了唯一能看出"我在哪"的
 * 字面线索**：进了成都、开了一份行程，标题却还是首页那一句，读者就得回忆自己点过什么。
 *
 * ## 标题形状（越具体越靠前）
 * | 层级 | 标题 |
 * |------|------|
 * | 全国 | `行迹 · 城市旅游攻略` |
 * | 省 | `四川省 · 行迹` |
 * | 市 | `成都 · 行迹` |
 * | 景点 | `武侯祠 · 成都 · 行迹` |
 * | 行程 | `行程规划 · 成都 · 行迹` |
 *
 * ★ 地名在前、站名在最后：标签页宽度不够时右边先被截，截掉的应该是站名。
 * ★ 站名统一取 `data/site.ts`，与 `root.tsx` 的 `<title>` 是同一份常量。
 * ★ 这里**只改 `document.title`**，不碰路由 —— 单页下没有"每页一个标题"的机制，
 *   也不该为了标题把路由加回来（护栏 A3 守这条）。
 */

import { useEffect } from 'react'

import { loadCity } from '~/common/data/cityRegistry'
import { findProvince } from '~/common/data/provinceAdcodes'
import { SITE_NAME, SITE_TITLE } from '~/common/data/site'

import { navKey, navSnapshot, useNav } from './navStore'

/** 拼标题：末位永远是站名，空片段自动跳过（名字取不到时不能出现 `undefined · 行迹`） */
function title(...parts: Array<string | null | undefined>): string {
  const kept = parts.filter((p): p is string => Boolean(p))
  return [...kept, SITE_NAME].join(' · ')
}

export function useDocTitle(): void {
  const nav = useNav()
  const key = navKey(nav)

  useEffect(() => {
    /**
     * ★ 用 `navSnapshot()` 现取，不用闭包里那个 `nav`：effect 的依赖是 `key`，
     *   而闭包捕获的是**某一次渲染**的对象。层级连续变化时两者会错一拍，
     *   表现为"标题晚一档"——不报错、也没有任何检查能抓到。
     */
    const n = navSnapshot()

    if (n.level === 'nation') {
      document.title = SITE_TITLE
      return
    }
    if (n.level === 'province') {
      const p = findProvince(n.adcode)
      document.title = title(p?.fullname ?? p?.name)
      return
    }

    /**
     * 市 / 景点 / 行程三档都要城市名，而 `loadCity` 是**异步**的（首次读分片）。
     * `alive` 门守的是"切得快"：旧请求后到会把标题改回上一座城 —— 这种错一个
     * 字的问题不报错、不白屏，只能靠这行守。
     */
    const level = n.level
    const cityId = n.cityId
    const poiId = level === 'poi' ? n.poiId : null
    let alive = true
    loadCity(cityId).then((city) => {
      if (!alive) return
      if (!city) {
        document.title = SITE_TITLE
        return
      }
      if (level === 'plan') {
        document.title = title('行程规划', city.name)
      } else if (level === 'poi') {
        document.title = title(city.pois.find((p) => p.id === poiId)?.name, city.name)
      } else {
        document.title = title(city.name)
      }
    })
    return () => {
      alive = false
    }
  }, [key])
}
