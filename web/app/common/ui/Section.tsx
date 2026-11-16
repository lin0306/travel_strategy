/**
 * 详情正文的**排版基座** —— 景点详情、城市介绍、省介绍三处共用同一套字号与间距。
 *
 * ## 为什么单独成文件（2026-11-14）
 * 用户看完城市介绍后说「介绍整体上和景点介绍统一一下」。当时两边是两套语言：
 *
 * | | 景点详情 | 城市介绍（统一前） |
 * |---|---|---|
 * | 正文 | `15.5px / 1.75`，桌面 `14px` | `12.5px` |
 * | 分节 | `H2`「亮点 / 实用信息 / 小提示」 | 无分节 |
 * | 事实 | `dl` 两列，标签列 `84px`，`13px` | `dl` 两列，标签 `auto`，`11.5px` |
 * | 长文 | 全展开 | `line-clamp` + 「展开城市介绍」 |
 *
 * 差别不是"哪边更好看"，而是**同一站里两套阅读节奏**：从景点回到城市，
 * 字突然小一号、章节突然没了、内容突然被折起来。所以统一的方向只有一个 ——
 * 以**景点详情**为准（它是内容最完整的一屏），城市与之对齐。
 *
 * ★ 唯一出处：改字号/行高只改这里，别在调用处写 `text-[15.5px]`。
 * ★ 只放"排版"，不放业务：`H2` 就是标题，`Prose` 就是正文段落，
 *   它们不认识 POI、City、Province 任何一个。
 */

import type { ReactNode } from 'react'

/** 正文分节标题。与 `PoiDetail` 的「亮点 / 实用信息 / 小提示」同一档 */
export function H2({ children }: { children: ReactNode }) {
  return <h2 className="mt-5 mb-2 text-[15px] font-semibold">{children}</h2>
}

/**
 * 正文段落（景点 `description` / 城市 `intro` / 省 `intro`）。
 *
 * ★ 移动端 `15.5px` 比桌面 `14px` 还大是**刻意**的：手机视距更近、
 *   而且详情是多层浮层叠在地图上，字小一号就彻底糊了。
 * ★ 不做 `line-clamp`：`Prose` 的语义是"这段就是要读完的"，要折叠由调用方
 *   自己决定要不要包一层（目前三处都**不折** —— 与景点详情一致）。
 */
export function Prose({ children }: { children: ReactNode }) {
  return <p className="mt-3.5 mb-0 text-[15.5px] leading-[1.75] text-ink md:text-[14px]">{children}</p>
}
