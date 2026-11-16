/**
 * 城市页顶部的「城市介绍」—— 封面图集 + 简介 + 四项事实（`bestSeason` /
 * `suggestedDays` / `transitTip` / `climateTip`）。
 *
 * ## 为什么要有这一块（2026-11-12）
 * `city.json` 里这三样**一直都有**：`heroImages`（每城 3 张，逐张审过的封面）、
 * `intro`（260~300 字城市简介）、`facts`（四季 / 天数 / 交通 / 气候）。
 * 但前端**一处都没渲染** —— 用户点进任何一座城，看到的只有
 * 「名字 + 一行 tagline + 共 N 个点位 + 一串点位名」，看不出这是座什么城。
 * 那 249 张封面图在磁盘上躺了半年，一张都没上过线。
 *
 * ★ 所以本组件的第一职责是**把死字段接上**，不是"再加一块 UI"。
 *
 * ## 2026-11-14 与景点详情统一（用户原话：「介绍整体上和景点介绍统一一下」）
 * 两处原来是两套阅读语言，现在全部对齐 `PoiDetail`：
 *
 * | | 统一前 | 现在 |
 * |---|---|---|
 * | 图集 | **点封面翻下一张**（看不出能点，也看不出还有几张） | 底部缩略条，当前那张套 `ring` |
 * | 正文 | `12.5px` | `Prose`（`15.5px / 1.75`，桌面 `14px`） |
 * | 分节 | 无 | `H2`「实用信息」 |
 * | 事实 | 标签 `auto` / `11.5px` | 标签列 `84px` / `13px`，与景点「实用信息」同一张表 |
 * | 长文 | `line-clamp` + 「展开城市介绍」 | **全展开**（景点简介也不折） |
 *
 * ★ **去掉折叠是刻意的**：折叠意味着"这段你可以不读"，而一个城市只有这一份
 *   介绍；景点简介从不折叠，城市却要用户多点一次才能读完，就是"两套语言"。
 *   代价是城市页首屏会被介绍占掉大半 —— 可接受：这一页的**第一件事**就是
 *   "这是座什么城"，点位列表往下滚一屏即可（且介绍在滚动区顶部，不钉住）。
 *
 * ## 两条纪律（没变）
 * 1. **不重复头部已有信息**：城市名与 `tagline` 由两端外壳的标题区负责
 *    （桌面左面板 / 移动 Sheet 头），这里只写 `intro`。两处都写 = 同一屏两个标题。
 * 2. **空就不渲染**：没有 `intro` 且没有 `facts` 且没有封面图的城市（未来的新城）
 *    整块不出现，绝不留空框或「暂无介绍」—— 与景点「暂无图片」的判据相反：
 *    那是"这张卡存在意义就是那张图"，城市介绍不是。
 */

import { HeroGallery } from '~/common/ui/HeroGallery'
import { H2, Prose } from '~/common/ui/Section'
import type { City } from '~shared/schema'

/** facts 的展示顺序与中文标签 —— **唯一出处**（别在视图层再写一遍四行 JSX） */
const FACT_ROWS = [
  { key: 'bestSeason', label: '最佳季节' },
  { key: 'suggestedDays', label: '建议天数' },
  { key: 'transitTip', label: '交通' },
  { key: 'climateTip', label: '气候' },
] as const

export function CityIntro({ city }: { city: City }) {
  const facts = FACT_ROWS.map((r) => ({ ...r, value: (city.facts?.[r.key] ?? '').trim() })).filter(
    (r) => r.value.length > 0,
  )
  const hasIntro = city.intro.trim().length > 0
  if (city.heroImages.length === 0 && !hasIntro && facts.length === 0) return null

  return (
    <section className="border-b border-line pb-5">
      <HeroGallery
        images={city.heroImages}
        altFallback={city.name}
        className="h-[110px] md:h-[150px]"
      />

      <div className="px-3.5">
        {hasIntro ? <Prose>{city.intro}</Prose> : null}

        {facts.length > 0 ? (
          <>
            <H2>实用信息</H2>
            {/* 与景点详情的「实用信息」同一张表：标签列 84px、13px、行距 gap-y-2 */}
            <dl className="m-0 grid grid-cols-[84px_1fr] gap-x-3 gap-y-2 text-[13px]">
              {facts.map((r) => (
                <div key={r.key} className="contents">
                  <dt className="text-ink-2">{r.label}</dt>
                  <dd className="m-0">{r.value}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : null}
      </div>
    </section>
  )
}
