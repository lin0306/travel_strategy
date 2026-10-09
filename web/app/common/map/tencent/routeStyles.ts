/**
 * 路线的**样式** —— 颜色常量、预置样式表、以及"这条线该用哪一档"的判据。
 *
 * ## 为什么单独一个文件
 * `routeLayer.ts` 管的是**图层的生命周期**（建层、挂事件、拆层）与"哪些线要画"；
 * 而"某条线长什么样"是另一件事 —— 档位有六种、判据有四层优先级、
 * 还要处理**任意色**（地铁线路官方色）。混在一起那个文件会同时讲两套东西。
 *
 * ## 独立类型（`RouteLegLike`）而不是 import `RouteLeg`
 * 本文件被 `routeLayer` 引用，若反过来再 import 它的 `RouteLeg` 就是**循环依赖**。
 * 而这里其实只关心几个字段，用结构类型（鸭子类型）描述更准确。
 */
import type { TravelMode } from '~shared/schema'

const INK = '22,26,34' // #161A22
const PRIMARY = '22,119,255' // #1677FF
/**
 * 「**待选**」的浅蓝 —— 与 `PRIMARY` 同色系但**明度更高、饱和度更低**。
 *
 * ★ 2026-10-05 用户两轮反馈：
 *   ① 「不要用灰色表示待选，都看不出来，**用浅蓝色**」（前一版是 `rgba(INK,0.4)`）；
 *   ② 「待选的浅蓝色**这个颜色不对**，粗细也和已经选上的颜色保持一致」。
 *
 * 第 ② 轮说明 `rgba(PRIMARY,0.5)` **不对**：主色降透明度在半透明叠加下会偏向
 * "脏蓝"（叠到浅灰路网上是灰蓝），既不是干净的浅蓝、又和选中那条的色相拉不开。
 * ⇒ 改成**一个确定的不透明浅蓝**——色相与主色一致，明度明显更高。
 *
 * ⚠️ 线宽与选中那条**保持一致**（都是 6）：区分只交给颜色，不再靠粗细。
 */
const PENDING = '143,190,247' // #8FBEF7
const JAM = '245,34,45' // #F5222D
const SLOW = '250,140,22' // #FA8C16
/**
 * 公共交通里**步行段**的颜色 —— 中性灰。
 *
 * ★ 这里用灰**不是**"表示待选"（那个用处 2026-10-05 已被用户否掉，
 *   因为灰线叠在浅灰路网上"跟没画一样"，见 `PENDING` 的注释）。
 *   这里灰表达的是**权重**："这一截是走过去的，不是交通本身"。
 *   它周围有彩色的乘车段衬着，不存在"看不出来"的问题。
 * ★ 不透明度给足（0.95）：它是路线的一部分，不该像水印。
 */
const WALK = '90,98,112' // #5A6270

/** 线上要用的那几个字段（`RouteLeg` 的子集，见文件头"独立类型"） */
export interface RouteLegLike {
  mode: TravelMode
  /** 自定义色（地铁线路官方色）。给了就用它 */
  color?: string
  /** 强制虚线（步行段） */
  dashed?: boolean
  /**
   * ★ **公共交通方案里的步行段** —— 它和"整条路线就是步行"是两回事：
   * · 整条步行（`mode === 'walking'`）：用户全程在走，这条线是**主角**，照常醒目；
   * · 换乘中的步行（`mode === 'transit'` + `dashed`）：只是两程车之间的一小截，
   *   **不该和乘车段抢眼** —— 否则一条方案看起来就是"蓝色实线 + 蓝色虚线"的一根怪线
   *   （用户 2026-10-05：「公共交通因为要换乘，这个呈现效果不是很好」）。
   * ⇒ 用它把后者单独拎出来降一档。
   */
  transitWalk?: boolean
  /** 属于"选中的那一组" */
  onTop?: boolean
  /** 属于"候选组" */
  candidate?: boolean
}

/**
 * ⚠️ **宽度与描边必须是整数**（2026-09-26 实测 + 读 SDK 源码确认）。
 * 腾讯的校验是 `n.width >= 0 && n.width % 1 == 0`，不满足就
 * `console.error('MultiPolyline.styles: 样式id … width属性无效')` 并**把这一项换成默认值**。
 * 原来这里的 `3.5 / 5.5 / 2.5` 与 `borderWidth: 1.6` **全部被静默丢掉** ——
 * 表现是"线还是画出来了，只是粗细不是设计的那一档"，8 条 console.error 一直挂着。
 */
function mk(color: string, width: number, dash?: number[], borderWidth = 2): TMap.PolylineStyle {
  return new TMap.PolylineStyle({
    color,
    width: Math.round(width),
    borderWidth,
    borderColor: '#FFFFFF', // 卫星底图色彩杂乱，没白描边会糊掉
    lineCap: 'round',
    lineJoin: 'round',
    ...(dash ? { dashArray: dash } : {}),
  })
}

/** 预置的基准样式。任意色（线路色）走 `buildDynamicStyles`，不在这里 */
export function buildBaseStyles(): Record<string, TMap.PolylineStyle> {
  return {
    solid: mk(`rgba(${INK},0.88)`, 4),
    /**
     * ★ **选中的那条用更厚的白描边**（3，其余档是 2）。
     *
     * 同一段路的多条候选往往**路径几乎重合**，于是选中那条和待选那条会**贴在一起**。
     * 描边厚 1px 之后，选中线在交叠处会连着自己那圈白边一起压上来、
     * 与待选线之间凭空多出一道白缝 —— 视觉上"浮"起来了。
     * 用户 2026-10-05：「路线的图层好像不是最高的，**有些还是被盖住了**」——
     * 层级本身没错（见 `zLayers`），但两条同宽的线贴在一起，
     * 光靠颜色分不出谁压谁。⚠️ 描边必须是**整数**（理由同 `width`）。
     */
    solidOn: mk(`rgba(${PRIMARY},1)`, 6, undefined, 3),
    solidDim: mk(`rgba(${PENDING},1)`, 6),
    solidPlan: mk(`rgba(${INK},0.3)`, 4),
    dashed: mk(`rgba(${INK},0.88)`, 4, [8, 6]),
    dashedOn: mk(`rgba(${PRIMARY},1)`, 6, [10, 6], 3),
    dashedDim: mk(`rgba(${PENDING},1)`, 6, [10, 6]),
    dashedPlan: mk(`rgba(${INK},0.3)`, 4, [8, 6]),
    /**
     * ★ 公共交通里的**步行段** —— 更细（4）、更短的划（5,5）、中性灰。
     *   与乘车段（线路官方色、6、实线）放在一起，一眼能分出"这截在走、那截在坐车"。
     */
    dashedWalk: mk(`rgba(${WALK},0.95)`, 4, [5, 5]),
  }
}

/**
 * **换乘点**的标记样式 —— 白心 + 深灰环的小圆。
 *
 * ## 为什么需要一个点
 * 一条公共交通方案被切成一串段（走 → 坐 → 走 → 坐），光看线只能看出
 * "这里线变细了/变虚了"，**看不出这是个换乘站**。用户 2026-10-05 说的
 * 「公共交通因为要换乘，呈现效果不好」有一半是这个 —— 换乘是公交出行的**关键决策点**
 * （在哪换、换几次），值得一个明确的符号。
 *
 * ## 为什么是"空心"而不是"实心彩点"
 * 实心点会跟**线路色**混起来（用户会以为那是又一个站）。白心 + 深灰环是
 * 地铁图里换乘站的通用画法，且**在任何线路色上都看得见**（白边自己带对比度）。
 *
 * ★ 锚点取画布中心（腾讯的 `anchor` 是**像素**，见 `poiStyles` 文件头那段标定）——
 *   圆心正好落在换乘坐标上。
 */
export function buildTransferStyles(): Record<string, TMap.MarkerStyle> {
  const box = 16
  const c = box / 2
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}" viewBox="0 0 ${box} ${box}">` +
    `<circle cx="${c}" cy="${c}" r="5.5" fill="#FFFFFF" stroke="rgba(16,24,40,0.75)" stroke-width="2.5"/>` +
    `</svg>`
  return {
    transfer: new TMap.MarkerStyle({
      width: box,
      height: box,
      anchor: { x: c, y: c },
      src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    }),
  }
}

export function buildJamStyles(): Record<string, TMap.PolylineStyle> {
  return {
    jam: mk(`rgba(${JAM},1)`, 2),
    slow: mk(`rgba(${SLOW},1)`, 2),
  }
}

/**
 * **动态颜色档**的 styleId —— 键由"颜色 + 线型"本身拼出来。
 *
 * ★ 用颜色当键（而不是"第几条"这样的序号）：同一线路色在好几段上复用时
 *   自动共享一档；序号键会随段序变化不断重建样式表。
 * ★ 颜色串里的 `#`、`(`、`)` 不能进 id，剔掉非字母数字。
 */
export function dynStyleId(color: string, dashed: boolean): string {
  return `c${dashed ? 'd' : 's'}_${color.replace(/[^0-9a-zA-Z]/g, '')}`
}

/**
 * 一条线的 styleId。**按优先级**：
 *
 * | 判据 | 落到哪档 | 长什么样 |
 * |------|---------|---------|
 * | `color` | 动态档（`dynStyleId`） | **地铁线路官方色**（`#0060A4`…） |
 * | `transitWalk` | `dashedWalk` | 换乘中的步行段：**灰、细虚线**（权重最低） |
 * | `onTop` | `solidOn` / `dashedOn` | 选中的：主色、粗、**厚白描边** |
 * | `candidate` | `solidDim` / `dashedDim` | **待选**：浅蓝 |
 * | 有候选但自己都不是 | `solidPlan` / `dashedPlan` | 背景整条线：中性浅灰 |
 * | 都不满足 | `solid` / `dashed` | 平常那条：近黑实线 |
 *
 * ★ `candidate` 与"有候选在场"（`anyFocus`）**不是一回事**：前者说"这条是候选"，
 *   后者说"这一屏上有候选"。背景整条线属于"自己没有候选身份、但身处有候选的屏"
 *   ⇒ 两个都要判，否则它会借用待选的浅蓝、跟候选**撞色**。
 * ★ 虚线判据是 `dashed ?? mode === 'walking'`：公交方案里整条的方式是 `transit`，
 *   只有**其中一段**是走路，所以由每段自己声明（`dashed`）优先。
 */
export function styleIdOf(l: RouteLegLike, anyFocus: boolean): string {
  if (l.color) return dynStyleId(l.color, Boolean(l.dashed))
  /**
   * ★ **公共交通里的步行段**要排在 `onTop` 之前判 —— 它同时也是"选中的那一组"
   *   （整条方案被选中了，它每一段都在上面），若让它走到 `onTop` 分支，
   *   就会拿到和乘车段同宽同色的 `dashedOn`，那正是用户说的"呈现效果不好"。
   */
  if (l.transitWalk) return 'dashedWalk'
  const walk = l.dashed ?? l.mode === 'walking'
  if (l.onTop) return walk ? 'dashedOn' : 'solidOn'
  if (l.candidate) return walk ? 'dashedDim' : 'solidDim'
  if (anyFocus) return walk ? 'dashedPlan' : 'solidPlan'
  return walk ? 'dashed' : 'solid'
}

/**
 * 给**用到的每个自定义色**现建一档。
 *
 * ★ 地铁线路色是**任意值**（`#0060A4`、`#E4002B`…），预置表装不下。
 * ★ 宽度与选中那条一致（6）—— 分段画的是一条完整的乘车路径，不该比别的细。
 */
export function buildDynamicStyles(
  legs: Array<{ color?: string; dashed?: boolean }>,
): Record<string, TMap.PolylineStyle> {
  const out: Record<string, TMap.PolylineStyle> = {}
  for (const l of legs) {
    if (!l.color) continue
    out[dynStyleId(l.color, Boolean(l.dashed))] = mk(
      l.color,
      6,
      l.dashed ? [10, 6] : undefined,
    )
  }
  return out
}
