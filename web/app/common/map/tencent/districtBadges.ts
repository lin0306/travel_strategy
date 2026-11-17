/**
 * 区划徽标的**摆放结果**（像素级避让 + 排序）—— 纯函数，不碰图层状态。
 *
 * ★ 2026-10-02 从 `districtLayer.ts` 拆出（那边撞了 420 行上限，G 项）。
 *   它与"画什么"无关，只回答"这一屏该显示哪几个牌子、各自落在哪" ——
 *   输入是节点列表与视野，输出 adcode → 经纬度。
 *
 * ★ 2026-11-17 从「只给可见集合」改成「给出坐标」（`visibleBadges` → `layoutBadges`）：
 *   全国视图下**广东 / 中国香港 / 中国澳门**三个徽标在屏幕上只差十几像素，
 *   宽容器原来"一律不避让"⇒ 三个胶囊叠成一坨，倒数第二层那个完全读不出来。
 *   ⇒ 宽容器改成「不丢弃，只错开」：撞了就按候选方向平移一格。
 *   腾讯 `MultiLabel` 的几何没有像素偏移，所以这里直接算**偏移后的经纬度**。
 *
 * ⚠️ 复用 `labelAvoidance` 的 `rectsIntersect`、`viewport` 的 `projectToPixel` /
 *    `unprojectPixel`，**不另写一份**：两处各写会立刻分叉。
 */

import { rectsIntersect, type PlacedRect } from './labelAvoidance'
import { badgeText, type DistrictGeoNode } from './districtStyles'
import { projectToPixel, unprojectPixel, type Viewport } from './viewport'

/**
 * 徽标避让的启用宽度（容器 px）。
 *
 * 桌面宽度下 34 个省级徽标实测**可读但会相碰**（北京/天津、沪苏、粤港澳），
 * 而**裁掉任何一个都等于平白丢掉一个省的计数** —— 那正是全国视图要回答的问题。
 * 所以宽屏不裁，改为错开（见 `orderByAway`）；窄屏才裁——徽标连成片时
 * "少给几个但读得清"远胜"全给全糊"。阈值取 640px（本项目移动端的既有断点）。
 *
 * ⚠️ 它**只管碰撞**，不管视口裁剪 —— 视口外的徽标任何宽度下都不生成。
 */
export const NARROW_PX = 640

/**
 * 徽标数超过它就**恢复成"撞了就丢"**，无论容器多宽。
 *
 * 「宽容器一律错开」只在**省级（34 个）**成立 —— 那正是全国视图要回答的问题。
 * 但首页放大揭示出的**市徽标可达几百个**（实测 zoom 6.8 视野内 165 个，
 * 市与市相距 30~60km 在这个缩放下只有 35~70px）：几百个牌子互相推挤会
 * 连锁错开、飞出省界，比直接少显示几个更糟。
 *
 * 阈值取 48 —— 高于省级的 34，低于它的市级视野也放不下 48 个互不重叠的中文地名。
 */
export const BADGE_AVOID_OVER = 48

/** 徽标高度（px）—— 与 `LabelStyle.size` + padding 对齐，估算碰撞框用 */
const BADGE_H = 26
/** 徽标左右内边距（px）：碰撞框宽 = 文本宽 + 2 × 它 */
const BADGE_PAD = 9
/** 相邻两个徽标之间的最小呼吸间距（px） */
const GAP = 4
/** 纵向错开一格的高度：正好让两个徽标上下相切不相交 */
const STEP_Y = BADGE_H + GAP
/** 横向错开一格的宽度：中文字宽约 12.5px，三字名 + 数字 ≈ 34 */
const STEP_X = 34

/**
 * 错开方向的**兜底顺序**：先上下、再左右、最后对角；同一方向由近及远。
 *
 * 真正的方向由 `orderByAway` 按「背离最近的邻居」现算 —— 这张表只在
 * 附近没有任何已放置矩形时兜底。上下排前面是因为纵向错开最不容易压到
 * **相邻省份**（省徽标横排时，左右平移立刻会撞进邻居的地盘）。
 */
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [0, -1],        // 下 / 上
  [1, 0], [-1, 0],        // 右 / 左
  [1, 1], [-1, 1], [1, -1], [-1, -1], // 对角
]

/**
 * 最多错开**一格**。再远就宁可隐藏。
 *
 * ## 为什么不是两格（2026-11-17 实测）
 * 一格 = 30px。粤港澳在 z5 只差 17px、在 z4.57 只差 11px，三个 64px 宽的牌子
 * 要互不重叠至少要摊开 60px ⇒ 必然吃到第二格。而第二格在低缩放下对应
 * **300~600 km**：实测全国视图里中国澳门被推到中国香港**东侧**、两只都飘在南海，
 * 比"少显示一个"糟得多 —— **位置标错比缺一个标签更误导人**。
 *
 * 一格之内能分开的（京津轻碰、z6.5 的港澳）仍全部显示；分不开的那个这一屏就先不给，
 * 放大到不再拥挤时它自己会回来（判据是像素，不是 zoom 阈值）。
 */
const MAX_LAYER = 1

interface Offset {
  dx: number
  dy: number
}

/** 原位（不偏移）—— 永远第一个试，绝大多数徽标都停在这里 */
const ORIGIN: Offset = { dx: 0, dy: 0 }

/** 「一格」的候选（不含原位），按层展开 */
const STEPS: ReadonlyArray<Offset> = Array.from({ length: MAX_LAYER }, (_, i) =>
  DIRS.map(([ux, uy]) => ({ dx: ux * STEP_X * (i + 1), dy: uy * STEP_Y * (i + 1) })),
).flat()

/**
 * 把候选方向按「**背离最近的邻居**」排序。
 *
 * ## 为什么不能固定顺序
 * 固定"先往下"在粤港澳这一簇上会把中国香港推到**海里**（实测下移 40px，
 * 离实际位置已经很远，图上看起来像标错了地方）。而徽标之所以要错开，
 * 是因为邻居占了位置 —— 那么"继续朝自己原来的方位走"才是最省力的方向：
 * 中国香港在广东东南 ⇒ 往东推；中国澳门在西南 ⇒ 往西南推。
 *
 * ## 两道排序键，缺一不可
 * ① **方位一致性（硬约束，排在前面）**：错开之后，自己相对邻居的**左右 / 上下
 *    关系不能翻转**。少了这条，纯按方向贴合度排会出现「中国澳门被摆到中国香港
 *    东边」—— 实测全国视图就是这样错的，两只都飘在南海、左右还颠倒。
 * ② **方向贴合度**：同样不翻转的几个方向里，挑最接近自身原始方位的那个，
 *    这样徽标被推开的距离最短、也最像"这个牌子还说那边"。
 */
function orderByAway(p: { x: number; y: number }, placed: PlacedRect[]): Offset[] {
  let near: PlacedRect | null = null
  let best = Infinity
  for (const r of placed) {
    const d = Math.hypot(r.x + r.w / 2 - p.x, r.y + r.h / 2 - p.y)
    if (d < best) {
      best = d
      near = r
    }
  }
  // 附近（120px 内）没有邻居 ⇒ 用兜底顺序
  if (!near || best > 120) return [...STEPS]

  const ncx = near.x + near.w / 2
  const ncy = near.y + near.h / 2
  const ux = p.x - ncx
  const uy = p.y - ncy
  const len = Math.hypot(ux, uy) || 1
  const align = (o: Offset) => (o.dx * ux + o.dy * uy) / ((Math.hypot(o.dx, o.dy) || 1) * len)

  // 原始左右 / 上下关系（0 表示几乎同列 / 同行，不约束）
  const sx = Math.sign(ux)
  const sy = Math.sign(uy)
  const keepsSide = (o: Offset) => {
    const nx = Math.sign(p.x + o.dx - ncx)
    const ny = Math.sign(p.y + o.dy - ncy)
    return (sx === 0 || nx === sx) && (sy === 0 || ny === sy)
  }

  return [...STEPS].sort((a, b) => {
    const ka = keepsSide(a) ? 1 : 0
    const kb = keepsSide(b) ? 1 : 0
    if (ka !== kb) return kb - ka
    return align(b) - align(a)
  })
}

/**
 * 徽标排序：**已收录 > 有计数 > 待收录**，同档按计数降序、再按 adcode 稳定。
 *
 * 已收录排最前 —— 它才是用户能点进去的那一个，窄屏下最不该被裁掉的就是它；
 * 宽屏错开时它也先占原位，被推开的总是计数少的那个。
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
 * 一个徽标的**摆放结果**：画在哪 + 它本来属于哪。
 *
 * 两者分开是 `badgeLeaders`（引线）存在的前提 —— 徽标一旦被错开，
 * `node` 的经纬度就不再是真实位置了，必须靠 `home` 把"它到底指哪里"带出来。
 */
export interface BadgePlacement {
  /** 真正画出去的那个节点（被错开时 `lng`/`lat` 已是错开后的坐标） */
  node: DistrictGeoNode
  /** 真实锚点（未错开的位置）；原地摆放时与 `node` 的坐标完全相同 */
  home: { lng: number; lat: number }
}

/**
 * 当前该显示的徽标，以及各自**要画在哪**。
 *
 * 判据刻意用"投影后的像素矩形"而不是"缩放级别阈值"：徽标挤不挤是**像素问题**，
 * 与缩放级别没有一一对应 —— 同一个 zoom 在平板和手机上结论完全不同。
 *
 * 三档行为（`avoid` 与 `shift` 的拆分是本轮的关键）：
 * | 场景 | 撞了怎么办 | 为什么 |
 * |------|-----------|--------|
 * | 窄容器 | 丢掉 | 连成片时一个都读不出来 |
 * | 徽标 > 48（市级） | 丢掉 | 几百个互相推挤会连锁飞出去 |
 * | 宽容器 + ≤ 48（省级） | **错开一格** | 34 个省**一个都不能丢**，而粤港澳/京津沪本来就会相碰 |
 *
 * @param all  这一级**全部**候选节点（不预先按视野筛）
 * @param view 视野（唯一读法是 `readViewport`，调用方传进来）
 * @returns adcode → 摆放结果（`node` 多数与原坐标相同；被错开的那几个不同，且 `home` 记着原位）
 */
export function layoutBadges(all: DistrictGeoNode[], view: Viewport): Map<string, BadgePlacement> {
  const cull = view.width < NARROW_PX || all.length > BADGE_AVOID_OVER

  const placed: PlacedRect[] = []
  const out = new Map<string, BadgePlacement>()

  for (const n of [...all].sort(badgeRank)) {
    const p = projectToPixel({ lng: n.lng, lat: n.lat }, view)
    // 视口外的直接跳过（省掉若干次相交检测）
    if (p.x < -100 || p.y < -100 || p.x > view.width + 100 || p.y > view.height + 100) continue

    const w = badgeWidth(n)
    const rectAt = (o: Offset): PlacedRect => ({
      x: p.x + o.dx - w / 2,
      y: p.y + o.dy - BADGE_H / 2,
      w,
      h: BADGE_H,
    })

    const home = { lng: n.lng, lat: n.lat }
    const rectHome = rectAt(ORIGIN)
    if (!placed.some((r) => rectsIntersect(r, rectHome, 2))) {
      placed.push(rectHome)
      // 原位：坐标原样返回（省一次反算，也免得浮点往返引入漂移）
      out.set(n.adcode, { node: n, home })
      continue
    }

    // 撞了。窄屏 / 徽标过多 ⇒ 丢掉：连成片时一个都读不出来，
    // 而几百个市级牌子互相推挤会连锁飞出去、比少显示几个更糟。
    if (cull) continue

    // 宽屏省级 ⇒ 顺着「背离最近邻居」的方向错开（见 `orderByAway`）
    for (const o of orderByAway(p, placed)) {
      const rect = rectAt(o)
      if (placed.some((r) => rectsIntersect(r, rect, 2))) continue
      placed.push(rect)
      out.set(n.adcode, {
        node: { ...n, ...unprojectPixel({ x: p.x + o.dx, y: p.y + o.dy }, view) },
        home,
      })
      break
    }
    // 所有候选都被占了 ⇒ 不显示（而不是"画在原位压着别人"）
  }
  return out
}
