/**
 * 图标 —— 内联 SVG sprite，**不引第三方图标库**。
 *
 * ## 为什么不装图标库
 * 本项目一共用到 20 来个图标。装一个图标库的代价是：多一个依赖、多一份需要
 * 跟版本升级的体积、以及"哪个图标用哪个名字"要另外查文档。而 sprite 方案
 * 是**一次写死、零运行时成本**，且 stroke 颜色统一走 `currentColor`，
 * 天然跟随主题（图标不用管自己是什么颜色）。
 *
 * ## 两个实现约定
 * 1. sprite 只渲染一次，`<Icon>` 只输出 `<use>`。
 *    ⚠️ 渲染点是 `app/root.tsx` 的 `Layout` —— **不是**页面外壳。
 *       sprite 缺席时 `<use href="#i-xxx">` 指向不存在的 id，浏览器
 *       **不报错也不占位**，每个图标静默变空白。静态检查查不出这个，
 *       只能运行时数 `document.querySelectorAll('[id^="i-"]').length`。
 * 2. 线宽统一 1.8、`stroke-linecap: round` —— 细线图标在小尺寸下更清晰，
 *    1.5 太细会灰、2 太粗会糊。
 */

export type IconName =
  | 'pin'
  | 'search'
  | 'locate'
  | 'chev-down'
  | 'chev-up'
  | 'chev-right'
  | 'chev-left'
  | 'back'
  | 'plus'
  | 'minus'
  | 'check'
  | 'alert'
  | 'info'
  | 'link'
  | 'upload'
  | 'download'
  | 'layers'
  | 'close'
  | 'drag'
  | 'clock'
  | 'pencil'
  | 'nav'
  | 'expand'
  | 'collapse'
  | 'lock'
  | 'unlock'
  | 'route'
  | 'driving'
  | 'taxi'
  | 'transit'
  | 'subway'
  | 'bicycling'
  | 'walking'
  | 'image'
  | 'github'
  | 'star'

const PATHS: Record<IconName, string> = {
  // ⚠️ 圆点用两段弧凑整圆（`a…Z`），不要写 `a1.5 1.5 0 1 0 0 .01` ——
  //    那是退化路径，多数渲染器直接不画
  pin: 'M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z|M12 9.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8Z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z|M21 21l-4.3-4.3',
  locate: 'M12 2v3|M12 19v3|M2 12h3|M19 12h3|M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z',
  'chev-down': 'M6 9l6 6 6-6',
  'chev-up': 'M6 15l6-6 6 6',
  'chev-right': 'M9 6l6 6-6 6',
  'chev-left': 'M15 6l-6 6 6 6',
  back: 'M19 12H5|M11 18l-6-6 6-6',
  plus: 'M12 5v14|M5 12h14',
  minus: 'M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  alert: 'M12 3l9.5 16.5h-19L12 3Z|M12 10v4|M12 17.2v.1',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z|M12 11v5|M12 8.2v.1',
  link: 'M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1 1|M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1-1',
  upload: 'M12 16V4|M7 9l5-5 5 5|M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  download: 'M12 4v12|M7 11l5 5 5-5|M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  layers: 'M12 3l9 5-9 5-9-5 9-5Z|M3 13l9 5 9-5',
  close: 'M6 6l12 12|M18 6L6 18',
  drag: 'M8 7h.01|M8 12h.01|M8 17h.01|M16 7h.01|M16 12h.01|M16 17h.01',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z|M12 7.5V12l3 2',
  // 铅笔（改名）。★ 只用在"名字旁边那个小按钮"上 —— 与草稿行的 ✓/✕ 不同，
  //   它表达的是"这条已经存在，想改"，所以笔身要正、笔尖朝左下（视觉重心稳）
  pencil: 'M4 20h4L20 8a2.83 2.83 0 0 0-4-4L4 16v4Z|M13.6 5.4l5 5',
  // 站标（纸飞机）：只用在 Brand 的 Logo 方块里，与「行迹」的路书语义同义
  nav: 'M3.5 11.2 21 3.5l-7.7 17.5-2.4-7.4-7.4-2.4z',
  expand: 'M8 3H5a2 2 0 0 0-2 2v3|M16 3h3a2 2 0 0 1 2 2v3|M16 21h3a2 2 0 0 0 2-2v-3|M8 21H5a2 2 0 0 1-2-2v-3',
  // 退出全屏：与 `expand` 严格互补 —— 四只括号画在**同样那组起点**上，只是拐向内侧，
  // 于是切换时四个角的像素几乎不动，看起来是"箭头和它自己换了方向"而不是换了个图标
  collapse: 'M9 4v5H4|M15 4v5h5|M15 20v-5h5|M9 20v-5H4',
  lock: 'M8 11V7a4 4 0 0 1 8 0v4|M6 11h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z',
  unlock: 'M8 11V7a4 4 0 0 1 7.5-2|M6 11h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z',
  route: 'M6.5 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z|M17.5 20.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z|M6.5 8.5v4a3 3 0 0 0 3 3h5a3 3 0 0 1 3 3',
  driving: 'M5 17h14|M4 17v-4.2a2 2 0 0 1 .3-1L6 8.6A2 2 0 0 1 7.7 7.5h8.6a2 2 0 0 1 1.7 1.1l1.7 3.2a2 2 0 0 1 .3 1V17|M4 17v2h3v-2|M17 17v2h3v-2',
  taxi: 'M5 17h14|M4 17v-4.2a2 2 0 0 1 .3-1L6 8.6A2 2 0 0 1 7.7 7.5h8.6a2 2 0 0 1 1.7 1.1l1.7 3.2a2 2 0 0 1 .3 1V17|M9.5 7.5V5h5v2.5',
  transit: 'M6 4.5h12v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-10Z|M6 9h12|M9 20l1.5-3|M15 20l-1.5-3',
  subway: 'M12 3.5a8 8 0 0 0-8 8v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4a8 8 0 0 0-8-8Z|M4.5 12h15|M8.5 21l2-3.5|M15.5 21l-2-3.5',
  bicycling: 'M6 20a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z|M18 20a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z|M6 16l4-7h5l3 7|M9.5 9H14',
  walking: 'M13 6.1a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2Z|M12 8l-2.5 4.5L11 17l1 4|M12 8l3 2.5.5 4|M9.5 12.5L6 14',
  image: 'M4 5.5h16v13H4z|M4 15l5-4 4 3.5 3-2.5 4 3.5|M9.5 9.5h.01',
  /**
   * GitHub 的**标准 mark（Octocat 猫头）**。
   *
   * ★ 为什么必须是原版、不能自己简化（2026-10-16 用户报「你没用标准的图标」）：
   *   GitHub 的 fill 是**商标**，简化版（尤其把尾巴画成圆弧、耳朵画成三角）一眼就是"山寨图标"，
   *   在开源项目自己的界面上放山寨 GitHub 标记，是最不该出现的那类不一致。
   *   ⇒ 路径取官方 mark-github（MIT / GitHub Logo 许可），只做一件事：
   *     **去掉 viewBox 外的留白并缩到 0~24 的方形**，好让整套图标共用 24×24 网格。
   *
   * ⚠️ 官方原版是**实心**路径，而本 sprite 统一 `fill="none" stroke="currentColor"`
   *    （见下方 `IconSprite` 的注释）—— 只描边会把猫头画成一个空心轮廓，辨识度掉一半。
   *    ⇒ 这个图标必须**例外**：`Icon` 对 `github` 单独走 `fill`（见下方 `FILL_ICONS`）。
   *    写在这里是为了让下一个人知道"这个不一致是刻意的"，别顺手改回去。
   */
  github:
    'M12 .8a11.2 11.2 0 0 0-3.54 21.83c.56.1.77-.24.77-.54v-2.1c-3.12.68-3.78-1.3-3.78-1.3-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.68.08-.68 1.13.08 1.72 1.16 1.72 1.16 1 1.72 2.64 1.22 3.29.94.1-.73.39-1.22.71-1.5-2.49-.28-5.11-1.25-5.11-5.56 0-1.23.44-2.23 1.16-3.02-.12-.28-.5-1.43.11-2.98 0 0 .95-.3 3.1 1.15a10.8 10.8 0 0 1 5.65 0c2.15-1.45 3.1-1.15 3.1-1.15.61 1.55.23 2.7.11 2.98.72.79 1.16 1.79 1.16 3.02 0 4.32-2.63 5.27-5.13 5.55.4.35.76 1.03.76 2.08v3.09c0 .3.2.65.78.54A11.2 11.2 0 0 0 12 .8Z',
  star: 'M12 3.6l2.5 5.3 5.7.8-4.1 4.1 1 5.8-5.1-2.8-5.1 2.8 1-5.8-4.1-4.1 5.7-.8Z',
}

/**
 * ★ 唯一几个必须**实心**的图标（`FILL_ICONS`）。
 *
 * sprite 统一 `fill="none" stroke="currentColor"` —— 线条图标这样最省事，
 * 但**品牌 mark 是实心的**：描边版 GitHub 猫头会变成空心轮廓，一眼山寨。
 * ⇒ 这几个走 `fill="currentColor" stroke="none"`，颜色仍由 CSS 决定。
 */
const FILL_ICONS = new Set(['github'])

/**
 * sprite —— 每个图标 body 只写一次。
 * `fill="none"` + `stroke="currentColor"` 让颜色完全由 CSS 决定。
 */
export function IconSprite() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        {Object.entries(PATHS).map(([name, d]) => (
          <g key={name} id={`i-${name}`}>
            {d.split('|').map((seg, i) => (
              <path key={i} d={seg} />
            ))}
          </g>
        ))}
      </defs>
    </svg>
  )
}

export interface IconProps {
  name: IconName
  /** 尺寸档。'sm' 14 / 'md' 16 / 'lg' 18 / 'xl' 22 */
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

const SIZE: Record<NonNullable<IconProps['size']>, number> = { sm: 14, md: 16, lg: 18, xl: 22 }

export function Icon({ name, size = 'md', className }: IconProps) {
  const px = SIZE[size]
  // ★ 品牌 mark 走实心（见 FILL_ICONS）：统一描边会把 GitHub 猫头画成空心轮廓，一眼山寨。
  const solid = FILL_ICONS.has(name)
  return (
    <svg
      className={className}
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill={solid ? 'currentColor' : 'none'}
      stroke={solid ? 'none' : 'currentColor'}
      strokeWidth={solid ? undefined : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: 'none' }}
    >
      {/* 用 <use> 只输出一次 body，同页面多次使用不重复 DOM */}
      <use href={`#i-${name}`} />
    </svg>
  )
}
