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

import { useEffect, useRef, useState, type ReactNode } from 'react'

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

/**
 * 详情主图（带加载态）。
 *
 * ## 为什么必须做加载态（2026-10-16 用户报「图片加载需要时间」）
 * 图片全是**外链直链**（Wikimedia 镜像 / Pexels / Unsplash，见 04 文档 4.2），
 * 首屏到出图隔着一条公网往返 —— 慢的时候 260px 高的区域就是一片空白。
 *
 * ## ★ 三态状态机（用户两轮复报后重构，别再回到"loaded 一把梭"）
 * | 态 | 容器 | 图 |
 * |----|------|----|
 * | 加载中 | `.img-skeleton`（底色 + 扫光 + 图标） | `opacity-0`（藏着，防浏览器破图图标） |
 * | 成功 | 被图**盖住**（CSS 层叠，无 JS 卸载） | 淡入 |
 * | 失败 | 追加 `.img-failed`：停扫光，底色 + 图标**常驻** | 保持 `opacity-0` |
 *
 * 两个踩过的坑，都在"loaded 一把梭"的旧版里：
 *   ① **`img.complete === true` ≠ 加载成功** —— 失败的图也是 complete（但
 *      `naturalWidth === 0`）。旧版挂载时见到 complete 就放图 ⇒ 失败时
 *      放开的是**浏览器破图图标**、骨架却被卸了 ⇒「没有背景占位」。
 *   ② **`onError` 里 `setLoaded(true)` 是错的** —— 那等于"失败也算成功"：
 *      骨架卸了、图放不出来 ⇒ 白板。失败必须有**自己的终态**（底色 + 图标常驻）。
 * 「加载完了不消失」则是纯 CSS 问题：`::after` 扫光画在 img 之上，已由
 * app.css 的 `.img-skeleton > img { z-index: 1 }` 修掉 —— 图盖住底，无需 JS。
 *
 * ## 为什么状态放在图上而不是父组件
 * `gallery` 切换时 `src` 变化 ⇒ 加载态要**随 src 重置** —— 放在子组件里用
 * `key={img.url}`（见调用处）最省心：换图即重挂载，状态天然归零。
 */
function DetailHeroImage({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const imgRef = useRef<HTMLImageElement | null>(null)

  // 缓存命中时 onLoad 不会再触发（切回看过的图）——挂载后查一次 complete。
  // ★ 必须再看 naturalWidth：失败的图也是 complete，但宽度为 0（见上表）。
  useEffect(() => {
    const el = imgRef.current
    if (!el?.complete) return
    if (el.naturalWidth > 0) setLoaded(true)
    else setFailed(true)
  }, [])

  return (
    <div
      // 容器**就是**骨架：底色 + 扫光常驻，成功时被图盖住（app.css 的层叠规则）。
      // 失败追加 .img-failed 停扫光 —— 底色与图标留下，永远不露白板。
      className={`img-skeleton relative h-[180px] w-full overflow-hidden md:h-[260px] ${failed ? 'img-failed' : ''}`}
    >
      {!loaded && !failed ? (
        // 图标层：语义是"图片正在加载"，不是"没有图"。失败时它同样保留（底色 + 图标 = 暂无图占位）。
        <div
          className="absolute inset-0 flex items-center justify-center text-ink-2/60"
          aria-hidden="true"
        >
          <Icon name="image" size="xl" />
        </div>
      ) : null}
      {/* eslint-disable-next-line jsx-a11y/alt-text */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        onLoad={() => setLoaded(true)}
        // ★ 失败是**自己的终态**：底色 + 图标常驻，绝不放开 opacity（那是旧版白板的根源）
        onError={() => setFailed(true)}
        className={`block size-full object-cover transition-opacity duration-300 ${
          loaded ? 'opacity-100' : 'opacity-0'
        }`}
        loading="lazy"
      />
    </div>
  )
}

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
          // ★ key=img.url：换图即重挂载，加载态天然归零（见 DetailHeroImage 文件头）
          <DetailHeroImage key={img.url} src={img.url} alt={poi.name} />
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
        <div
          // ★ 挂 `.scroll`：不挂的话这条横向滚动条是浏览器默认样式（粗、带轨道槽），
          //   在 260px 大图正下方非常显眼 —— 全站滚动条统一走 app.css 的 `.scroll`（6px 细条）
          className="scroll flex gap-1.5 overflow-x-auto px-3.5 py-2.5"
        >
          {poi.images.map((im, i) => (
            <button
              key={im.url}
              type="button"
              onClick={() => onGallery(i)}
              aria-label={`第 ${i + 1} 张图片`}
              aria-pressed={i === gallery}
              className={`img-skeleton size-12 flex-none overflow-hidden rounded-md ${
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

        <p className="mt-3.5 mb-0 text-[15.5px] leading-[1.75] text-ink md:text-[14px]">{poi.description}</p>

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
