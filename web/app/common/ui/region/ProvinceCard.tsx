/**
 * 地域面板 · **省概览卡**（首页桌面端）。
 *
 * ## 它写的是什么（2026-11-14 起有两层）
 * 1. **省自己**：封面图集 + 采编正文（`data/provinces/index.json` 的 `intro`），
 *    排版与市卡、景点详情**同一套**（`Prose` / `H2` / `HeroGallery`）。
 * 2. **收录情况**：下辖几个市、已收录哪几座、一共多少点位、还剩几个没做 ——
 *    这些是 `district-tree.json` + 城市索引现算的**真数据**，不是文案。
 *
 * ★ 用户原话「省的介绍和图片不抓吗」。当时的真相是省级**没有承载位置**：
 *   `data/` 里只有区划与边界，一个字一张图都没有，省卡只能拿收录统计凑一段话。
 *   现在补了内容层；内容缺失（新城 / 解析失败）时**退回只显示收录情况**，
 *   绝不编人文地理描述。
 *
 * ## ★ `null ≠ 0`
 * 未收录的市 `poiCount` 是 `null`（见 `regions.ts`），这里写「—」而不是「0 个」——
 * 写成 0 等于在说"这儿没有可玩的地方"，而事实是我们还没做。
 *
 * ★ **不带加载态**：`detail` 由面板统一读（它还要用 `isCity` 决定摊省卡还是市卡），
 *   一张纯展示组件自己再 `loadProvinceDetail` 一次 = 同一份数据两条读取路径。
 */

import { useEffect, useState } from 'react'

import { HeroGallery } from '~/common/ui/HeroGallery'
import { Icon } from '~/common/ui/Icon'
import { SectionLabel } from '~/common/ui/Overlay'
import { H2, Prose } from '~/common/ui/Section'
import { loadCityIndex } from '~/common/data/data'
import { loadProvinceContent } from '~/common/data/provinceContent'
import type { CityRow, ProvinceDetail } from '~/common/data/regions'
import type { ProvinceContent } from '~shared/schema'

export function ProvinceCard({
  detail,
  name,
  onPickCity,
}: {
  detail: ProvinceDetail
  /** 简称（"陕西"）。全称由面板标题负责，这里用简称行文更自然 */
  name: string
  onPickCity: (row: CityRow) => void
}) {
  /** cityId → tagline。索引是全站缓存的一份，读它只为给已收录的城市补一句真话 */
  const [taglines, setTaglines] = useState<Map<string, string>>(new Map())
  /** 省介绍与省封面。没有就只显示收录情况（不写"暂无介绍"） */
  const [content, setContent] = useState<ProvinceContent | null>(null)
  const adcode = detail.province?.adcode ?? ''

  useEffect(() => {
    let alive = true
    void loadCityIndex().then((idx) => {
      if (!alive) return
      setTaglines(new Map(idx.flatMap((c) => (c.tagline ? [[c.id, c.tagline] as const] : []))))
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    setContent(null)
    if (!adcode) return
    void loadProvinceContent(adcode).then((c) => {
      if (alive) setContent(c)
    })
    return () => {
      alive = false
    }
  }, [adcode])

  const grouped = detail.cities.filter((c) => c.cityId !== null)
  const poiTotal = grouped.reduce((n, c) => n + (c.poiCount ?? 0), 0)
  const total = detail.childCount

  return (
    <div className="pb-4">
      {content && content.heroImages.length > 0 ? (
        <HeroGallery
          images={content.heroImages}
          altFallback={name}
          className="h-[110px] md:h-[150px]"
        />
      ) : null}

      <div className="px-3.5">
        {content?.intro ? <Prose>{content.intro}</Prose> : null}

        <H2>收录情况</H2>
        <p className="m-0 text-[13px] leading-relaxed text-ink-2">
          {summary(name, total, grouped.length, poiTotal, detail.hasTree)}
        </p>
      </div>

      {grouped.length > 0 ? (
        <>
          <SectionLabel>已收录的城市</SectionLabel>
          {grouped.map((row) => {
            const tag = row.cityId ? taglines.get(row.cityId) : undefined
            return (
              <button
                key={row.adcode}
                type="button"
                onClick={() => onPickCity(row)}
                className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left hover:bg-bg"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px]">{row.name}</span>
                  {tag ? (
                    <span className="mt-0.5 block truncate text-[11.5px] text-ink-2">{tag}</span>
                  ) : null}
                </span>
                <span className="flex-none text-[11.5px] text-ink">
                  {row.poiCount === null ? '—' : `${row.poiCount} 个`}
                </span>
                <Icon name="chev-right" size="sm" className="flex-none text-ink-2/50" />
              </button>
            )
          })}
        </>
      ) : null}

      {total > grouped.length ? (
        <p className="mx-3.5 mt-3 mb-0 text-[11.5px] leading-relaxed text-ink-2/80">
          其余 {total - grouped.length} 个市还在采集，点下面「城市列表」可以看到完整清单。
        </p>
      ) : null}
    </div>
  )
}

/**
 * 那段"收录情况"。四种情况都写成**一句人话**，而不是把四个数字摆成一行表格 ——
 * 「10 个市 · 1 座 · 69 个」读起来像仪表盘，而这里要回答的是"这省我能玩什么"。
 */
function summary(
  name: string,
  total: number,
  collected: number,
  poiTotal: number,
  hasTree: boolean,
): string {
  if (!hasTree || total === 0) {
    return '区划数据还没生成，暂时列不出这个省下辖的市。跑完数据流水线后这里会补齐。'
  }
  if (collected === 0) {
    return `${name}下辖 ${total} 个地级市，目前一座都还没收录 —— 点它们只会放大，看不到景点。`
  }
  if (collected === total) {
    return `${name}下辖的 ${total} 个地级市已全部收录，一共 ${poiTotal} 个点位。`
  }
  return `${name}下辖 ${total} 个地级市，已收录 ${collected} 座（共 ${poiTotal} 个点位），其余 ${total - collected} 个还在采集。`
}
