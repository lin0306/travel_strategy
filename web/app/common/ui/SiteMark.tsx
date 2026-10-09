/**
 * SiteMark —— 站标图形（全站唯一一份）。
 *
 * ## 为什么要有这个组件（而不是各处各画一个 SVG）
 * 2026-10-07 之前，站标是**两套互不相干的图形**：
 *   · 顶栏 `Brand.tsx` 用 `.logo-mark` 方块 + `Icon name="nav"`（纸飞机）+ 渐变底
 *   · `public/favicon.svg` 用折线 + 定位点 + 纯色底
 * 同一站两个形象，浏览器标签页和页面顶栏摆在一起时格外刺眼。
 * 现在两边都从这里取，图形改了只改一处。
 *
 * ## 造型：导航箭头（描边）
 * 左上尖端 + 右侧机翼 + 中间缺口 + 下方尾柱。语义是「指过去、点下去」——
 * 这个站的核心交互正是**在地图上点选**（点省、点市、点景点，点空白收起），
 * 光标形状不用解释就对。
 *
 * 为什么描边而不是实心：实心块在 16px 时缺口会被填平、尖端钝掉；
 * 描边版靠留白维持形状，小尺寸下更稳。
 *
 * ## 颜色为什么不读 CSS 变量
 * favicon 是独立文件、不参与 CSS，读不到 `color-primary`；
 * 顶栏这侧虽然是 DOM，但要求**在浅色地图与白色顶栏浮层上两种底都成立**，
 * 读 CSS 反而会跟着主题漂。所以两边都写死 `#0f172a`（近黑）。
 *
 * ★ 改形状/线宽前先看文件 `favicon.svg` 的注释：那里记了四顶点比例
 *   （短边/长边 ≈ 0.43）与线宽的判据（16px 下的实际像素宽 ≥ 1.35px）。
 *   两边必须一致，别只改一处。
 */

/**
 * 导航箭头四顶点（32视口，**已含 20% 内边距 = 6.4 单位**）+ 线宽，与 favicon.svg 逐字对应。
 *
 * ★ 改这两行前先读 `favicon.svg` 的注释：那里记了三条硬约束
 *   （短长边比≥0.38、16px 实际线宽 ≥1.35px、缺口 16px 净空 ≥0.8px）、
 *   定内边距的原因（**只缩几何、线宽不能跟着缩**）、四周留白比例（20%）
 *   与它的上限（25%+ 该换形状而非继续缩）。
 *   两边必须一致，别只改一处。
 */
const ARROW_PATH = 'M9.6 7.8 L23.7 14 L16.9 17 L15.1 24.2 Z'
const ARROW_STROKE = 2.8

export interface SiteMarkProps {
  /** 方块边长（px）。默认 28 —— 顶栏站标的 h-7/w-7 */
  size?: number
  /** 无障碍标签。纯装饰（旁边已有站名文字）时传 null 即可 */
  title?: string | null
  className?: string
}

export function SiteMark({ size = 28, title = null, className }: SiteMarkProps) {
  // 圆角按 32 视口的 rx=7 折算（约 22% 边长），与 favicon 一致
  const s = size / 32
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      role={title ? 'img' : 'presentation'}
      aria-label={title ?? undefined}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <rect width="32" height="32" rx={7 * s} fill="#0f172a" />
      <path
        d={ARROW_PATH}
        fill="none"
        stroke="#ffffff"
        strokeWidth={ARROW_STROKE * s}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
