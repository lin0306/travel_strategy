/**
 * 城市页的**入口取景** —— 把镜头落在"区这一级"该看的视距上。
 *
 * ## 为什么单独一个钩子
 * `useCityView.ts` 贴着单文件行数上限，而这段是**自成一体**的一件事：
 * 「这座城有多大 → 框住它」。它不与点位、筛选、选中任何一个打交道。
 *
 * ## ★ 为什么用行政外接框，而不是 fit 点位云
 * 点位是**采出来的**，集中在有内容的那一小片 —— 香港 57 个点几乎全在维港两岸、
 * 澳门更不用说。拿它们 fit 出来的缩放常常已经 ≥ `POI_REVEAL_ZOOM`，于是
 * **一进城市页屏幕上直接就是景点**，用户要的"先看区、再看景点"被整段跳过，
 * 表现得像是"这一级不存在"（不报错，只是没有它出场的机会）。
 *
 * 行政外接框框的是"这座城有多大"，**与内容无关**：
 *   · 进出同一座城市的入口视野恒定（不会因为补录了几个点就变）；
 *   · 那一刻屏幕上铺的正是各区的徽标。
 * 没有边界文件时退回点位云 —— 那是真没有，不是还没到（见下面 `boxTried`）。
 */

import { useEffect, useMemo, useState } from 'react'

import { useFitOnce } from '~/common/logic/useFitOnce'
import type { MapShellContext } from '~/common/logic/mapShell'
import { loadCityBox } from '~/common/data/subdistricts'
import type { City } from '~shared/schema'

export interface UseCityEntryFitOptions {
  shell: MapShellContext
  /** 城市数据。`null` = 还没读到 */
  city: City | null
  /** 市的 adcode —— 边界文件的文件名就是它（`districts/440100.geo.json`） */
  cityAdcode: string
  cityId: string
  /** 端别。★ 两端可用区不同（移动端被底部 Sheet 吃掉一截），换端要重新框一次 */
  isMobile: boolean
}

export function useCityEntryFit(o: UseCityEntryFitOptions): void {
  const { shell, city, cityAdcode, cityId, isMobile } = o

  /**
   * 这座城市的行政外接框。
   *
   * ★ `null` 有两种来源，下手之前必须分清：① 还没读到（pending）；② 真的没有边界文件。
   *   只有 ② 允许退回"按点位 fit" —— 否则会先按点位框一次、边界到了再框一次，
   *   用户看到的是镜头自己跳了一下（而且第一次 jumps 会撤掉用户刚刚拖动的视野）。
   */
  const [cityBox, setCityBox] = useState<[number, number, number, number] | null>(null)
  const [boxTried, setBoxTried] = useState(false)

  useEffect(() => {
    let alive = true
    setCityBox(null)
    setBoxTried(false)
    if (!cityAdcode) return
    void loadCityBox(cityAdcode).then((b) => {
      if (!alive) return
      setCityBox(b)
      setBoxTried(true)
    })
    return () => {
      alive = false
    }
  }, [cityAdcode])

  /** 入口要框的那一片：优先行政外接框，真的没有边界文件时退回点位云 */
  const fitPoints = useMemo(() => {
    if (cityBox) {
      return [
        { lng: cityBox[0], lat: cityBox[1] },
        { lng: cityBox[2], lat: cityBox[3] },
      ]
    }
    return (city?.pois ?? []).map((p) => ({ lng: p.location.point.lng, lat: p.location.point.lat }))
  }, [cityBox, city])

  useFitOnce(city && boxTried ? `${cityId}|${isMobile ? 'm' : 'd'}` : null, shell.status === 'ready', () =>
    fitPoints.length > 0 && shell.fit(fitPoints, { reason: 'drill' }),
  )
}
