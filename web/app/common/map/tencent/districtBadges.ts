/**
 * 区划徽标的**可见集合**（像素级避让 + 排序）—— 纯函数，不碰图层状态。
 *
 * ★ 2026-10-02 从 `districtLayer.ts` 拆出（那边撞了 420 行上限，G 项）。
 *   它与"画什么"无关，只回答"这一屏该显示哪几个牌子" —— 输入是节点列表与视野，
 *   输出是 adcode 集合，所以拆出来也更好单独验证。
 *
 * ⚠️ 复用 `labelAvoidance` 的 `projectToPixel` / `rectsIntersect`，**不另写一份**：
 *    两处各写会立刻分叉（一边调了碰撞间距、另一边没调）。
 */

import { rectsIntersect, type PlacedRect } from './labelAvoidance'
import { badgeText, type DistrictGeoNode } from './districtStyles'
import { projectToPixel, type Viewport } from './viewport'

/**
 * 徽标避让的启用宽度（容器 px）。
 *
 * 桌面宽度下 34 个省级徽标实测是可读的（北京/天津 这种贴在一起的也只是轻轻相碰），
 * 而**裁掉任何一个都等于平白丢掉一个省的计数** —— 那正是全国视图要回答的问题。
 * 窄屏则相反：徽标连成片，一个都读不出来，此时"少给几个但读得清"远胜"全给全糊"。
 * 所以避让只在窄容器下生效，阈值取 640px（本项目移动端的既有断点）。
 *
 * ⚠️ 它**只管碰撞避让**，不管视口裁剪 —— 视口外的徽标任何宽度下都不生成。
 */
export const NARROW_PX = 640

/**
 * 徽标数超过它就**强制开避让**，无论容器多宽。
 *
 * 「宽容器一律不避让」这条规则在**省级（34 个）**是成立的 —— 那正是全国视图
 * 要回答的问题，裁掉任何一个都等于平白丢一个省的计数，而 34 个徽标在任何
 * 桌面宽度下都挤不着。但首页放大揭示出的**市徽标可达几百个**
 * （实测 zoom 6.8 视野内 165 个，市与市相距 30~60km 在这个缩放下只有
 * 35~70px），不避让就糊成一片、一个都读不出来。
 *
 * 所以判据是**数量**而不是容器宽度：34 个省徽标任何宽度都不必避让，
 * 165 个市徽标任何宽度都必须避让。阈值取 48 —— 高于省级的 34，低于这个数
 * 的市级视野也不会挤（一个屏幕上放不下 48 个互不重叠的中文地名）。
 */
export const BADGE_AVOID_OVER = 48

/**
 * 徽标排序：**已收录 > 有计数 > 待收录**，同档按计数降序、再按 adcode 稳定。
 *
 * 已收录排最前 —— 它才是用户能点进去的那一个，窄屏下最不该被裁掉的就是它。
 */
export function badgeRank(a: DistrictGeoNode, b: DistrictGeoNode): number {
  const pa = a.poiCount !== null && a.poiCount > 0 ? 0 : 1
  const pb = b.poiCount !== null && b.poiCount > 0 ? 0 : 1
  if (pa !== pb) return pa - pb
  if ((a.poiCount ?? 0) !== (b.poiCount ?? 0)) return (b.poiCount ?? 0) - (a.poiCount ?? 0)
  return a.adcode.localeCompare(b.adcode)
}

/**
 * 当前该显示的徽标 adcode 集合。
 *
 * 宽容器 → 全给（见 `NARROW_PX`）；窄容器或节点多 → 按**像素间距**贪心避让。
 *
 * 判据刻意用"投影后的像素矩形"而不是"缩放级别阈值"：徽标挤不挤是**像素问题**，
 * 与缩放级别没有一一对应 —— 同一个 zoom 在平板和手机上结论完全不同。
 *
 * @param all  这一级**全部**候选节点（不预先按视野筛）
 * @param view 视野（唯一读法是 `readViewport`，调用方传进来）
 */
export function visibleBadges(all: DistrictGeoNode[], view: Viewport): Set<string> {
  // ★ 宽容器**只跳过碰撞避让**，不跳过视口裁剪 —— 这两件事曾经被写在一起
  //   （`if (width >= NARROW_PX) return 全集`），在"一层只有 34 个省徽标"时
  //   看不出问题。但首页放大揭示出的**市级徽标可能有几百个**，
  //   全给意味着每个平移动作都要重建几百个几何，且它们在屏幕外谁也看不见。
  // 避让的判据见 `BADGE_AVOID_OVER`：窄屏一律避让，宽屏只在徽标多时避让。
  const avoid = view.width < NARROW_PX || all.length > BADGE_AVOID_OVER

  const placed: PlacedRect[] = []
  const shown = new Set<string>()

  for (const n of [...all].sort(badgeRank)) {
    const { x, y } = projectToPixel({ lng: n.lng, lat: n.lat }, view)
    // 视口外的直接跳过（省掉一次相交检测）
    if (x < -100 || y < -100 || x > view.width + 100 || y > view.height + 100) continue

    if (avoid) {
      // 估宽：中文 12.5px/字（`LabelStyle.size`），数字与空格约 7px；再算上 padding
      let textW = 0
      for (const ch of badgeText(n)) textW += /[\u4e00-\u9fa5]/.test(ch) ? 12.5 : 7
      const rect: PlacedRect = { x: x - textW / 2 - 9, y: y - 13, w: textW + 18, h: 26 }

      if (placed.some((r) => rectsIntersect(r, rect, 2))) continue
      placed.push(rect)
    }
    shown.add(n.adcode)
  }
  return shown
}
