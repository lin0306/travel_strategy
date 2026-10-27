/**
 * 底部浮层的**档位模型**（唯一出处）。
 *
 * 为什么单独一个文件：`Sheet.tsx`（版式）与 `useSheetDrag.ts`（手势）都要读这几个值，
 * 而两者是**互相依赖**的 —— 手势要判档位、版式要用手势。常量放在第三方，
 * 两边各自 import，就没有环。
 *
 * ## 三档的语义（08 文档）
 * | 档 | 高度 | 露出什么 |
 * |----|------|---------|
 * | `peek` | 28svh | 把手 + 一行摘要（城市页 = 城市名；详情页 = 景点名） |
 * | `half` | 56svh | 默认档。列表 / 时间轴主体 + 汇总 |
 * | `full` | 88svh | 完整内容 |
 *
 * ★ 高度用 `svh` 不用 `vh`：移动端 `100vh` 把地址栏算在内，实际比可视区高 56–80px，
 *   `full` 档的底部会被推出屏幕。
 */

export type SheetTier = 'peek' | 'half' | 'full'

/** 档位顺序（低 → 高） */
export const SHEET_ORDER: SheetTier[] = ['peek', 'half', 'full']

/** 三档高度（svh）。数值与 08 文档一致 */
export const SHEET_TIER_SVH: Record<SheetTier, number> = { peek: 28, half: 56, full: 88 }

/** 拖到最矮也留这么高（把手 + 一行摘要），否则浮层会缩成一条缝 */
export const MIN_DRAG_PX = 72

/**
 * 浮层**当前高度**（px）落在 `:root` 上的 CSS 变量名。
 *
 * 为什么要广播这个：右下角工具条（`mobile/ui/MapTools`）必须**跟着浮层一起上移**，
 * 否则浮层一升起就把它整块盖住 —— 浮层最矮的 `peek` 档也有 28svh，
 * 屏幕上根本不存在"浮层之下的右下角"。写在 `:root` 上是因为 `Sheet` 与工具条
 * 是兄弟节点，行内自定义属性（设在 `Sheet` 上）传不过去。
 */
export const SHEET_H_VAR = '--sheet-h'

/** 浮层高度变化时派发到 `window` 的事件名（`detail` = 高度 px，收起时 0） */
export const SHEET_RESIZE_EVENT = 'sheet-resize'

/**
 * 工具条四枚竖排一列的总高：4×40 + 3×8 = 184px（尺寸见 `MapTools` 的 `ITEM`）。
 * 只用于判「浮层升高之后还剩不剩地方摆」，不做排版。
 */
export const TOOLS_COL_PX = 184
