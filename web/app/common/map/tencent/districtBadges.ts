/**
 * 区划徽标的**显示集合** —— 纯函数，不碰图层状态。
 *
 * ★ 2026-10-02 从 `districtLayer.ts` 拆出（那边撞了 420 行上限）。
 *   它与"画什么"无关，只回答"这一屏该显示哪几个牌子"。
 *
 * ## 判据只有一个：**真实像素碰撞**（2026-11-18 用户定）
 * 演进三步都留在这里，因为每一版都是被上一版的坑推出来的：
 *   ① 「撞了就错开一格 + 画引线」—— 一格 34×30px 在 z4.57 是**上百公里**，
 *      牌子飘到南海，底图上写着「香港特别行政区」，用户说「标签完全乱了」。
 *   ② 「按缩放给数量上限」—— 治好了重叠，但方向仍是错的：z<4.8 全国视图
 *      按表只留 1 个（四川 411），用户当场驳回：「我是让你去计算标签是否会
 *      出现重叠，重叠就显示数量多的那个」。
 *   ③ **现在**：位置永远真实，数量**完全由碰撞决定** —— 撞上了就丢景点少的，
 *      不撞就都留着。所以同一屏在 1440 宽的桌面上能挂十几个，在 390 宽的手机
 *      上自然只剩两三个，**不需要任何按端/按缩放的档位**。
 *
 * ⇒ 这一层不许再出现"缩放阈值"或"数量上限"。少显示的唯一理由是两个牌子的
 *   像素矩形真的相交了；放大之后它们分开，自己就回来。
 *
 * ⚠️ 复用 `labelAvoidance` 的 `rectsIntersect`、`viewport` 的 `projectToPixel`，
 *    **不另写一份**：两处各写会立刻分叉（间距、半宽算法都会漂）。
 */

import { rectsIntersect, type PlacedRect } from './labelAvoidance'
import { badgeText, type DistrictGeoNode } from './districtStyles'
import { projectToPixel, type Viewport } from './viewport'

/** 徽标高度（px）—— 与 `LabelStyle.size` + padding 对齐，估算碰撞框用 */
const BADGE_H = 26
/** 徽标左右内边距（px）：碰撞框宽 = 文本宽 + 2 × 它 */
const BADGE_PAD = 9
/**
 * 两个牌子之间要留的**最小缝**（px）。
 *
 * 取 4 而不是 0：胶囊本身有背景色，边贴边（0 或 1px）在缩略图里会连成一片，
 * 看着像一个超长的地名。4px 是"分开但不用留白"的临界值，实测在 z5.6 的
 * 江浙沪一带刚好能分清。
 */
const MIN_GAP = 4

/**
 * 徽标排序：**已收录 > 有计数 > 待收录**，同档按计数降序、再按 adcode 稳定。
 *
 * 碰撞时留下谁，就看这个顺序 —— 用户的要求是"重叠就显示数量多的那个"。
 * 已收录排最前是同一件事的加强版：它既有数量、又能点进去（「待收录」点不动），
 * 所以两个牌子撞上时，先让它上场。
 */
export function badgeRank(a: DistrictGeoNode, b: DistrictGeoNode): number {
  const pa = a.poiCount !== null && a.poiCount > 0 ? 0 : 1
  const pb = b.poiCount !== null && b.poiCount > 0 ? 0 : 1
  if (pa !== pb) return pa - pb
  if ((a.poiCount ?? 0) !== (b.poiCount ?? 0)) return (b.poiCount ?? 0) - (a.poiCount ?? 0)
  return a.adcode.localeCompare(b.adcode)
}

/** 徽标的碰撞框宽度：中文按 12.5px/字（`LabelStyle.size`），数字与空格约 7px */
function badgeWidth(node: DistrictGeoNode): number {
  let textW = 0
  for (const ch of badgeText(node)) textW += /[\u4e00-\u9fa5]/.test(ch) ? 12.5 : 7
  return textW + BADGE_PAD * 2
}

/**
 * 当前该显示的徽标：**视野内 → 按景点数排序 → 逐个上场，撞了丢弃**。
 *
 * 逐个上场（贪心）而不是先算全量再批量裁:排序已经把"该留谁"钉死了，
 * 贪心的结果就是"每个牌子都能显示，除非它和**已经显示的**撞上" ——
 * 这正好是用户要的语义。批量裁会引入第二轮相对顺序问题（谁裁谁），没有意义。
 *
 * @param all  这一级**全部**候选节点（不预先按视野筛）
 * @param view 视野（唯一读法是 `readViewport`，调用方传进来）
 * @returns adcode → 节点（坐标**原样**，绝不偏移）
 */
export function layoutBadges(all: DistrictGeoNode[], view: Viewport): Map<string, DistrictGeoNode> {
  const out = new Map<string, DistrictGeoNode>()
  const placed: PlacedRect[] = []

  // ① 先按景点数排序：后面每一个"撞了决定丢谁"都以这个顺序为前提
  const seen = [...all].sort(badgeRank)

  for (const node of seen) {
    const p = projectToPixel({ lng: node.lng, lat: node.lat }, view)
    const w = badgeWidth(node)
    const rect: PlacedRect = { x: p.x - w / 2, y: p.y - BADGE_H / 2, w, h: BADGE_H }

    // ② 视野裁剪：**整块牌子**都得在屏内（只判中心会挂半截 —— z5.6 的「浙江 307」）
    if (rect.x < 0 || rect.y < 0) continue
    if (rect.x + w > view.width || rect.y + BADGE_H > view.height) continue

    // ③ 像素碰撞：和已显示的撞上就丢（不偏移 —— 偏移就是"标错地方"）
    if (placed.some((r) => rectsIntersect(r, rect, MIN_GAP))) continue

    placed.push(rect)
    out.set(node.adcode, node)
  }
  return out
}
