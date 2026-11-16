/**
 * 地域面板 · **市概览卡**（首页桌面端）—— 封面 + 简介 + 四项事实。
 *
 * ★ 正文**整块复用** `common/ui/city/CityIntro`（城市页那份），不另写一份：
 *   封面轮翻、`line-clamp`、facts 两列、CC 署名（含那个 `z-[2]` 的坑）全在里面。
 *   城市页与首页面板看到的"这座城是什么样"必须是同一段话、同一张图。
 *
 * ★ 名字与 `tagline` 归**外壳**（这里是这张卡的头部，不是 `CityIntro`）——
 *   `CityIntro` 的文件头第 1 条纪律：两处都写 = 同一屏两个标题。
 *
 * ★ 未收录（`cityId === null`）不写「暂无介绍」，写清**为什么**：
 *   我们还没采这座城，所以没有封面也没有简介 —— 这与"这城没什么可看"是两件事。
 */

import { useEffect, useState } from 'react'

import { EmptyState } from '~/common/ui/Overlay'
import { Icon } from '~/common/ui/Icon'
import { CityIntro } from '~/common/ui/city/CityIntro'
import { loadCity } from '~/common/data/cityRegistry'
import type { City } from '~shared/schema'

export function CityCard({ cityId, name }: { cityId: string | null; name: string }) {
  const [city, setCity] = useState<City | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let alive = true
    setCity(null)
    setDone(false)
    if (!cityId) return
    void loadCity(cityId).then((c) => {
      if (!alive) return
      setCity(c)
      setDone(true)
    })
    return () => {
      alive = false
    }
  }, [cityId])

  if (cityId === null) {
    return (
      <EmptyState
        icon={<Icon name="pin" size="xl" />}
        title={`${name}还没收录`}
        detail="我们还没开始采这座城市的点位，所以既没有封面也没有简介。地图上点它只会放大，看不到景点。"
      />
    )
  }

  if (!done) {
    return (
      <div className="flex items-center gap-2 px-3.5 py-6 text-[13px] text-ink-2">
        <span className="size-3.5 flex-none animate-spin rounded-full border-2 border-line border-t-primary" />
        加载中…
      </div>
    )
  }

  if (!city) {
    return (
      <EmptyState
        icon={<Icon name="alert" size="xl" />}
        title="这座城市的数据没读到"
        detail="索引里有它，但主数据文件缺席（可能是构建产物不完整）。刷新一次通常就好了。"
      />
    )
  }

  return (
    <div>
      <p className="mx-3.5 mt-3 mb-2.5 text-[12px] leading-relaxed text-ink-2">
        {city.tagline} · 共 {city.pois.length} 个点位
      </p>
      {/* 介绍整块与城市页同一个组件（2026-11-14 起不再有 `defaultOpen`：
          简介与四项事实在两边都全展开，见 `CityIntro` 文件头那张对照表） */}
      <CityIntro city={city} />
    </div>
  )
}
