/**
 * 主图 + 缩略条 —— **图集翻页的唯一实现**（2026-11-14）。
 *
 * ## 为什么改（用户原话：「这个图片翻页的逻辑不对吧」）
 * 城市封面原来是「**点封面图 → 翻下一张**」，城里三张图靠盲点循环。
 * 三个问题都出在同一个地方：
 *
 * 1. **看不出来能点**：图上没有任何可点的迹象，那两张图等于白存（用户以为只有一张）；
 * 2. **看不出翻到第几张**：右下角「1/3」只说了"共三张"，却不知道另外两张是什么；
 * 3. **点图还有副作用风险**：封面在 `<button>` 里，图成了按钮内容，
 *    以后想给封面加"点开大图"就没地方挂了。
 *
 * 而**景点详情早就用缩略条**（12 组小图并排、当前那张套 `ring-2 ring-primary`）——
 * 两处差一套交互，用户却是在同一个站里来回看。所以以景点那套为准，整块抽出来共用。
 *
 * ## 两个件
 * - `GalleryStrip`：只有缩略条。景点详情用它（当前序号是 `gallery` 状态，
 *   由路由/浮层持有，可能还要写进 URL，所以序号不进这个件）。
 * - `HeroGallery`：主图 + 署名 + 缩略条，自己管序号。城市 / 省封面对外只需一个。
 *
 * ## ★ 压在主图上的浮层必须显式 `z-[2]`
 * 那是 `PhotoCredit` 内部的事（`app.css` 的 `.img-skeleton > img { z-index: 1 }`
 * 会盖住同级定位 `<span>`，见 `HeroImage.tsx` 文件头）。本文件不重写署名，
 * 一律走 `PhotoCredit` —— 护栏 BB 盯着"署名只能有一个出口"。
 */

import { useState, type ReactNode } from 'react'

import { HeroImage, PhotoCredit } from '~/common/ui/HeroImage'
import type { ImageItem } from '~shared/schema'

/**
 * 横向缩略条。
 *
 * ★ 挂 `.scroll`：不挂的话这条横向滚动条是浏览器默认样式（粗、带轨道槽），
 *   在大图正下方非常显眼 —— 全站滚动条统一走 `app.css` 的 `.scroll`（6px 细条）。
 * ★ 单图 / 无图时**整条不渲染**：只有一个缩略图的"图集"是假的，点了也不会变。
 */
export function GalleryStrip({
  images,
  index,
  onPick,
}: {
  images: ImageItem[]
  index: number
  onPick: (i: number) => void
}) {
  if (images.length <= 1) return null
  return (
    <div className="scroll flex gap-1.5 overflow-x-auto px-3.5 py-2.5">
      {images.map((im, i) => (
        <button
          key={im.url}
          type="button"
          onClick={() => onPick(i)}
          aria-label={`第 ${i + 1} 张图片`}
          aria-pressed={i === index}
          className={`img-skeleton size-12 flex-none overflow-hidden rounded-md ${
            i === index ? 'ring-2 ring-primary' : 'opacity-70'
          }`}
        >
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <img src={im.thumbUrl ?? im.url} alt="" className="size-full object-cover" loading="lazy" />
        </button>
      ))}
    </div>
  )
}

/**
 * 主图 + 署名 + 缩略条（序号自管）。
 *
 * `className` 只给**高度**：景点 180/260px、城市与省 110/150px ——
 * 高度由调用方决定，理由见 `HeroImage` 文件头「高度由调用方给」。
 *
 * `empty` 只在**有"没有图"这个概念**的地方给（景点详情必须写「暂无图片」，
 * 因为用户会以为"有图只是没刷出来"）。城市 / 省封面没图时整块不出现 ——
 * 一张城市卡不会因为少张封面就"坏了"，写「暂无封面」反而是噪音。
 */
export function HeroGallery({
  images,
  altFallback,
  className,
  empty,
  index,
  onPick,
}: {
  images: ImageItem[]
  /** `alt` 为空时兜底（老数据有 alt 缺失的情况） */
  altFallback: string
  /** 只给高度，如 `h-[110px] md:h-[150px]` */
  className: string
  /** 没有图时渲染什么。不给 ⇒ 整块不渲染 */
  empty?: ReactNode
  /**
   * 受控序号。**景点详情必须传** —— 那边的 `gallery` 是页面级状态
   * （独立详情页要写进 URL、浮层里要跟着换），序号不能藏在这个件里。
   * 城市 / 省封面不传 ⇒ 自管（它们没有第二个消费方）。
   */
  index?: number
  onPick?: (i: number) => void
}) {
  const [own, setOwn] = useState(0)
  const i = Math.min(index ?? own, Math.max(images.length - 1, 0))
  const cur = images[i]

  if (!cur) return <>{empty ?? null}</>

  return (
    <>
      <div className="relative">
        {/* ★ key=img.url：换图即重挂载，加载态天然归零（见 HeroImage 文件头） */}
        <HeroImage key={cur.url} src={cur.url} alt={cur.alt || altFallback} className={className} />
        <PhotoCredit credit={cur.credit} />
      </div>
      <GalleryStrip images={images} index={i} onPick={onPick ?? setOwn} />
    </>
  )
}
