/**
 * 点位详情的**内容组件**（双轨渲染的单一实现）。
 *
 * ## 谁在用它
 * - **独立页**（`routes/poi.tsx`）：620px 面板浮在地图上，预渲染供 SEO 收录
 * - **就地详情**（`desktop/ui/PoiDetailOverlay` / `mobile/ui/PoiDetailSheet`）：
 *   点地图上的景点时浮出来，**不换 URL**
 *
 * 三处装的是同一份内容，只在外层容器上不同 —— 抄两遍必然漂。
 * ★ 「位置与交通」**砌在正文末尾**，不再单独浮一块：桌面原来把它放在右侧 300px 卡片里，
 *   那正是用户说的「右侧显示一个景点的简要信息，这个不需要」（2026-09-23 晚）。
 *   判据见 `check_app.py` 的 Z⑨。
 *
 * ## 为什么从 `routes/poi.tsx` 拆出来
 * 路由文件本来就该只做「取数 + 视野 + 浮层挂载」，而这个内容组件占了半个文件
 * （图片区、适游标签、亮点、实用信息、溯源五大块）。拆开之后：
 *   · 路由文件重新回到"一眼看得完"的规模
 *   · 改一个字段的排版不再需要拉进地图/图层那套上下文
 *
 * ## 两条内容纪律
 * 1. **溯源必显**：每个点位都带 `sources[]` 与抓取时间。事实性字段（开放时间 /
 *    门票 / 预约）若挂了 `xxxRef`，在字段旁显示角标 —— 用户点开就能看到依据。
 * 2. **不说没来源的话**：`accessible` 默认 `false`、受众必须来自数据。
 *    没数据就不显示那一行，而不是显示一个猜测值。
 */

import type { ReactNode } from 'react'

import { Icon } from '~/common/ui/Icon'
import { PoiLocation } from '~/common/ui/city/PoiLocation'
import {
  AUDIENCE_META,
  CATEGORY_META,
  SUBTYPE_META,
  type Poi,
  type SourceRef,
} from '~shared/schema'

const SOURCE_KIND_LABEL: Record<SourceRef['kind'], string> = {
  gov: '政府',
  wiki: '百科',
  official: '官方',
  'travel-platform': '旅行平台',
  media: '媒体',
  social: '社交平台',
}

/* ────────────────────────────────────────────────
 * 内容组件（预览卡与详情页共用同一份数据形状）
 * ────────────────────────────────────────────── */

export function PoiDetail({
  poi,
  cityName,
  gallery,
  onGallery,
  showSources,
  onToggleSources,
}: {
  poi: Poi
  cityName: string
  gallery: number
  onGallery: (i: number) => void
  showSources: boolean
  onToggleSources: () => void
}) {
  const img = poi.images[gallery] ?? poi.images[0]
  const credit = img?.credit
  const pr = poi.practical

  return (
    <div className="scroll min-h-0 flex-1">
      {/* 图片区。多图用底部缩略条切，不做轮播 —— 轮播会让用户错过后面的图 */}
      <div className="relative">
        {img ? (
          // eslint-disable-next-line jsx-a11y/alt-text
          <img
            src={img.url}
            alt={poi.name}
            className="block h-[260px] w-full object-cover"
            loading="lazy"
          />
        ) : (
          // ★ 取不到图时的占位卡（04 文档 4.2 第 ④ 条）：不能让 `src={undefined}` 出破图
          <div className="flex h-[260px] items-center justify-center bg-bg text-ink-2">
            <Icon name="image" size="xl" />
          </div>
        )}
        {credit?.attributionRequired ? (
          <span className="absolute bottom-0 left-0 max-w-full truncate bg-black/45 px-2.5 py-1 text-[10.5px] text-white">
            摄影 {credit.author} · {credit.license} ·{' '}
            <a href={credit.sourceUrl} target="_blank" rel="noreferrer noopener" className="underline">
              来源
            </a>
          </span>
        ) : null}
      </div>

      {poi.images.length > 1 ? (
        <div className="flex gap-1.5 overflow-x-auto px-3.5 py-2.5">
          {poi.images.map((im, i) => (
            <button
              key={im.url}
              type="button"
              onClick={() => onGallery(i)}
              aria-label={`第 ${i + 1} 张图片`}
              aria-pressed={i === gallery}
              className={`size-12 flex-none overflow-hidden rounded-md ${
                i === gallery ? 'ring-2 ring-primary' : 'opacity-70'
              }`}
            >
              {/* eslint-disable-next-line jsx-a11y/alt-text */}
              <img src={im.thumbUrl ?? im.url} alt="" className="size-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      ) : null}

      <div className="px-3.5 pb-6">
        <h1 className="m-0 text-[20px] font-semibold">{poi.name}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-ink-2">
          <span className="inline-flex items-center gap-1">
            <i
              aria-hidden="true"
              className="size-2 rounded-full"
              style={{ background: SUBTYPE_META[poi.subtype].color }}
            />
            {SUBTYPE_META[poi.subtype].label}
          </span>
          <span>·</span>
          <span>{CATEGORY_META[poi.category].label}</span>
          <span>·</span>
          <span>{cityName}</span>
        </div>

        {/* 适游群体与无障碍：**没有数据就不显示** */}
        {poi.audience.length > 0 || poi.accessible ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {poi.audience.map((a) => (
              <span
                key={a}
                className="rounded-full border border-line px-2 py-0.5 text-[11.5px] text-ink-2"
              >
                适合{AUDIENCE_META[a].label}
              </span>
            ))}
            {poi.accessible ? (
              <span className="rounded-full border border-[#B7E0CE] bg-[#F0FAF5] px-2 py-0.5 text-[11.5px] text-[#0F6E56]">
                无障碍友好
              </span>
            ) : null}
          </div>
        ) : null}

        <p className="mt-3.5 mb-0 text-[14px] leading-[1.75] text-ink">{poi.description}</p>

        <H2>亮点</H2>
        <ul className="m-0 list-none space-y-1.5 p-0">
          {poi.highlights.map((h) => (
            <li key={h} className="flex items-start gap-2 text-[13.5px] leading-relaxed">
              <Icon name="check" size="sm" className="mt-1 flex-none text-primary" />
              {h}
            </li>
          ))}
        </ul>

        <H2>实用信息</H2>
        <dl className="m-0 grid grid-cols-[84px_1fr] gap-x-3 gap-y-2 text-[13px]">
          <Field label="开放时间" value={pr.openHours} refIdx={pr.openHoursRef} sources={poi.sources} />
          <Field label="门票" value={pr.ticket} refIdx={pr.ticketRef} sources={poi.sources} />
          <Field label="建议停留" value={pr.duration} />
          <Field label="预约" value={pr.reservation} refIdx={pr.reservationRef} sources={poi.sources} />
          <Field label="最佳季节" value={pr.bestSeason} />
        </dl>

        {poi.tips.length > 0 ? (
          <>
            <H2>小提示</H2>
            <ul className="m-0 list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-ink-2">
              {poi.tips.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </>
        ) : null}

        {/* 溯源：默认收起，需要时展开。信息密度与可信度都要顾 */}
        <div className="mt-5 border-t border-line pt-3.5">
          <button
            type="button"
            onClick={onToggleSources}
            className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-2 hover:text-primary"
          >
            <Icon name="info" size="sm" />
            溯源（{poi.sources.length} 条）· 更新于 {poi.updatedAt.slice(0, 10)}
            <Icon name={showSources ? 'chev-down' : 'chev-right'} size="sm" />
          </button>
          {showSources ? (
            <ul className="mt-2.5 list-none space-y-2 p-0">
              {poi.sources.map((s) => (
                <li key={s.url} className="text-[12px] leading-relaxed">
                  <span className="mr-1.5 rounded bg-bg px-1.5 py-0.5 text-[10.5px] text-ink-2">
                    {SOURCE_KIND_LABEL[s.kind]}
                  </span>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-primary no-underline"
                  >
                    {s.title}
                  </a>
                  <span className="ml-1.5 text-ink-2">
                    · 抓取于 {s.fetchedAt.slice(0, 10)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {/* 位置与交通：**砌在正文末尾**，不另起一块浮层（理由见文件头）。
            桌面原来把它放在右侧 300px 的独立卡里，用户明确说那块"不需要"。 */}
        <div className="mt-5 border-t border-line pt-3.5">
          <PoiLocation poi={poi} />
        </div>
      </div>
    </div>
  )
}

function H2({ children }: { children: ReactNode }) {
  return <h2 className="mt-5 mb-2 text-[15px] font-semibold">{children}</h2>
}

/** 一行实用信息。`refIdx` 有值 → 显示溯源角标（指回 sources 下标） */
/** 事实字段。`refIdx` 与 `sources` **成对**：给了 refIdx 就必须能解析到 sources，
 *  否则角标指向空。但两者都不是无条件必填 —— `pr.openHoursRef` 这类在 schema 里
 *  本就可选（采集时未必核实到具体那一条）。用联合类型而不是把 sources 声明成一律
 *  必填，是因为后者会逼调用方在根本不挂角标的字段上也传一份用不到的 sources。*/
type FieldProps = {
  label: string
  value?: string
} & (
  | { sources: SourceRef[]; refIdx?: number }
  | { sources?: undefined; refIdx?: undefined }
)

function Field({ label, value, refIdx, sources }: FieldProps) {
  if (!value) return null
  // 解构会打断联合类型的关联收窄（refIdx 与 sources 配套关系会丢），故显式再判一次
  const src = refIdx !== undefined && sources ? sources[refIdx] : undefined
  return (
    <>
      <dt className="text-ink-2">{label}</dt>
      <dd className="m-0">
        {value}
        {src ? (
          <a
            href={src.url}
            target="_blank"
            rel="noreferrer noopener"
            className="ml-1 align-super text-[10px] text-primary no-underline"
            aria-label={`依据：${src.title}`}
          >
            依据
          </a>
        ) : null}
      </dd>
    </>
  )
}
