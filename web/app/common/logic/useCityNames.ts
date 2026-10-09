/**
 * cityId → 中文名。
 *
 * 规划记录里只存 `cityId`（那是稳定的键），但列表上要显示「成都 / 重庆」——
 * 否则一条被用户改过名的规划在列表里看不出属于哪座城。
 *
 * ★ 缺失时**返回 id 本身**，不返回「未知」/「—」：
 *   id 至少能让人认出是哪座城（`chengdu`），而"未知"是一句没有信息的话。
 */

import { useEffect, useState } from 'react'

import { loadCityIndex } from '~/common/data/data'

export function useCityNames(): Map<string, string> {
  const [names, setNames] = useState<Map<string, string>>(() => new Map())

  useEffect(() => {
    let alive = true
    loadCityIndex()
      .then((rows) => {
        // `alive` 守卫：加载途中换页/卸载后 setState 会警告，且没必要
        if (alive) setNames(new Map(rows.map((c) => [c.id, c.name])))
      })
      .catch(() => {
        /* 拿不到就退回显示 id —— 不是错误，不必打扰用户 */
      })
    return () => {
      alive = false
    }
  }, [])

  return names
}
