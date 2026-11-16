/**
 * 大图（hero）—— **三态状态机**的单一实现，点位详情与城市封面共用。
 *
 * ## 为什么单独成文件（2026-11-12 从 `PoiDetail` 抽出）
 * 城市封面要用的正是同一件事："给一张外链大图，加载中 / 成功 / 失败三态"。
 * 各写一份的代价不是多几十行，而是**把下面这两个坑再踩一遍** —— 它们都不报错，
 * 只在界面上留下一块白板：
 *
 * | 态 | 容器 | 图 | 文字（`ImageState`） |
 * |----|------|----|----|
 * | 加载中 | `.img-skeleton`（底色 + 扫光） | `opacity-0`（藏着，防破图图标） | 「图片加载中…」 |
 * | 成功 | 被图**盖住**（CSS 层叠） | 淡入 | **卸载**（见下） |
 * | 失败 | `.img-failed`：停扫光，底色常驻 | 保持 `opacity-0` | 「图片加载失败」 |
 *
 * ① **`img.complete === true` ≠ 加载成功** —— 失败的图也是 complete（但
 *   `naturalWidth === 0`）。见到 complete 就放图 ⇒ 失败时放开的是**浏览器破图图标**、
 *   骨架却被卸了 ⇒「没有背景占位」。
 * ② **`onError` 里 `setLoaded(true)` 是错的** —— 那等于"失败也算成功"。
 *   失败必须有**自己的终态**（底色常驻 + 一句话）。
 *
 * ## 高度由调用方给
 * 本组件只负责"图怎么出来"，**不决定多高** —— 详情页 180/260px、城市封面
 * 120/150px，把它们塞进组件里当 props 默认值，等于以后每加一处又要改这里。
 * 传 `className` 给高度（Tailwind 的分支直接在类名里写）。
 *
 * ## 为什么状态放在图上而不是父组件
 * 换图时 `src` 变化 ⇒ 加载态要**随 src 重置** —— 调用方用 `key={url}` 最省心：
 * 换图即重挂载，状态天然归零。
 */

import { useEffect, useRef, useState } from 'react'

import { Icon } from '~/common/ui/Icon'
import type { ImageCredit } from '~shared/schema'

/**
 * 图片区「图出不来时」的**唯一文案出口**（2026-11-08）。
 *
 * ★★ 用户报「这个看着有实际没有」：老版三种情况都只给一块灰底 + 图片图标、
 *    一个字都不写，用户分不清「还在加载」「外链挂了」「这点位压根没收录」，
 *    一律当成"有图只是没刷出来"在那儿等。⇒ 三态各写一句人话，不让用户猜。
 *
 * ★ 它不是骨架：`.img-skeleton` 那个带扫光的容器仍在 `HeroImage` 里，
 *   这一层只说"为什么没图"，图加载成功后整层卸载 —— 留在 DOM 里会让读屏
 *   念一句已经过期的「图片加载中…」，半透明 PNG 还会把字透出来。
 */
const IMAGE_STATE_TEXT = {
  empty: '暂无图片',
  loading: '图片加载中…',
  failed: '图片加载失败',
} as const

export function ImageState({ state }: { state: keyof typeof IMAGE_STATE_TEXT }) {
  return (
    // ★ 图标淡、文字实：这句是**给用户读的结论**，不能跟着装饰一起淡到看不清
    <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-2">
      <Icon name="image" size="xl" className="text-ink-2/50" />
      <span className="text-[12.5px] text-ink-2">{IMAGE_STATE_TEXT[state]}</span>
    </div>
  )
}

export function HeroImage({
  src,
  alt,
  className = '',
}: {
  src: string
  alt: string
  /** 只给高度（如 `h-[120px] md:h-[150px]`）。宽度恒为 100% */
  className?: string
}) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const imgRef = useRef<HTMLImageElement | null>(null)

  // 缓存命中时 onLoad 不会再触发（切回看过的图）——挂载后查一次 complete。
  // ★ 必须再看 naturalWidth：失败的图也是 complete，但宽度为 0（见文件头 ①）。
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
      className={`img-skeleton relative w-full overflow-hidden ${failed ? 'img-failed' : ''} ${className}`}
    >
      {/* ★ 条件是 `!loaded` 而不是 `!loaded && !failed`：旧版把 failed 时的图标层
          一起移掉了，失败态只剩一块纯灰板（文件头当时还写着"图标保留"，注释与实现不符）。
          现在失败也有文字。成功则整层卸载，由 img 自己盖满。 */}
      {!loaded ? <ImageState state={failed ? 'failed' : 'loading'} /> : null}
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

/**
 * 图片署名角标（CC BY / CC BY-SA / 百度百科**必须**可见，见 `schema.ts` 的
 * `attributionRequired`）。压在大图左下角，全站同一份。
 *
 * ## ★★ `z-[2]` 不是随手写的 —— 少了它就是"署名存在但永远看不见"
 * `.img-skeleton > img` 在 `app.css` 里被垫到 `z-index: 1`（为了让图盖住骨架扫光），
 * 而 `z-index` 只在**定位元素**上生效、且 `z-index: auto` 的同级谁在后面谁在上。
 * 于是 `<img>`（z=1）会压过 DOM 里排在**后面**的定位 `<span>`（z=auto）——
 * 署名条明明渲染了、`textContent` 也在，肉眼就是一个字都看不到。
 *
 * 这个坑真的踩过：点位详情页的署名条从 2026-09-22 起一直被图盖着
 * （2026-11-12 用 `elementFromPoint` 在署名条中心取点，命中的是 `IMG` 才查出来）。
 * ⇒ **任何压在主图上的浮层（署名、张数、标签）都必须显式给 z-index ≥ 2。**
 */
export function PhotoCredit({
  credit,
  link = true,
  maxWidth,
}: {
  credit?: ImageCredit | null
  /** 放在 `<button>` 里的封面图给 false —— `<a>` 嵌在 `<button>` 里是非法嵌套 */
  link?: boolean
  /** 需要给右侧角标让位时收窄（内联样式，避免与类名打架） */
  maxWidth?: string
}) {
  if (!credit?.attributionRequired) return null
  return (
    <span
      style={maxWidth ? { maxWidth } : undefined}
      className="absolute bottom-0 left-0 z-[2] max-w-full truncate bg-black/45 px-2.5 py-1 text-[10.5px] text-white"
    >
      摄影 {credit.author} · {credit.license}
      {link ? (
        <>
          {' · '}
          <a
            href={credit.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="underline"
          >
            来源
          </a>
        </>
      ) : null}
    </span>
  )
}
