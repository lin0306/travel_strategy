/**
 * 点位与行程标记的**外观定义**（图标 + 样式表）。
 *
 * ## 分工：聚类算腾讯的，画面归我们（2026-09-24 定稿）
 *
 * 用户要「每种类型的点位样式不一样」，而腾讯的 `MarkerCluster` **只有一套渲染样式**
 * （内置那张红水滴）。实测结论（`_tmp/cdp_cluster_style.mjs`：三组对照 + 逐像素数色）：
 *
 * | 配置 | 屏幕上出现什么 |
 * |---|---|
 * | 默认渲染 + 传自定义样式表 | 3 枚**红水滴**，我们的颜色 **0 像素** ⇒ 样式表无效 |
 * | **关掉默认渲染** + 传样式表 | **0 枚** |
 * | 关掉默认渲染，不传样式表 | **0 枚** |
 *
 * ⇒ 两件事同时成立：**它的样式表永远不生效**、**关掉默认渲染它一枚都不画**。
 * 于是分工是：
 *   · **聚类仍由腾讯算**（用户明确要求"不重复造轮子"）；
 *   · **独立点由我们按细类色画**（`sub-<subtype>` / `sub-<subtype>_A`）；
 *   · SDK 自己画的那一枚，由 `poiCluster` 用 class 藏掉（**每次它重画都要重标**，
 *     实测 `setZoom` 之后那些元素是被移除重建的）；
 *   · 气泡（多成员簇）继续由腾讯画 —— 它表达的是"这里有几个"，与类型无关。
 *
 * ## 三类标记共用这一张表
 * | 用途 | 形状 | 理由 |
 * |------|------|------|
 * | POI 点位 | **细类色圆点** | 一次撒几十个，圆点是最轻的"撒点"语言，不挡底图，密集时反而读得出"哪里密、哪里稀" |
 * | 行程当天顺序 | 序号圆点 | 表达的是**顺序**，与类型无关 |
 * | 住宿点 | 旗标 | 它是锚点，不是第 13 个细类 —— 形状必须与普通点不同 |
 *
 * 三者**不能复用一个形状**：形状本身就是语义。
 *
 * ## ★ `MarkerStyle.anchor` 是**像素**，不是比例（2026-09-23 实测标定）
 * SDK 源码里那句 `iconAnchor: [t.anchor && t.anchor.x || 17, t.anchor && t.anchor.y || 50]` ——
 * 默认值 **17 / 50 是像素**（默认图标 34×50 的"底边中点"）。写成比例
 * （`{ x: 0.5, y: 1 }`，那是别的地图库的约定）等于把锚点放在图标**左上角附近**，
 * 整枚图标会往右下挂约 17px —— 用户看到的就是「位置也偏了」。
 *
 * | anchor | 质心相对坐标的偏移 |
 * |---|---|
 * | `{ 0, 0 }` | (+17, +17) |
 * | `{ 0.5, 1 }` | (+16, +16) ← 比例写法 |
 * | `{ 17, 17 }` | (0, 0) |
 * | `{ 17, 34 }` | (0, -17) ← 画布底边中点 |
 *
 * ⇒ 圆点（圆心落在坐标上）写 `{ x: 宽 / 2, y: 高 / 2 }`；针尖类写 `{ x: 宽 / 2, y: 高 }`。
 *   标定脚本：`_tmp/calib_marker_anchor.mjs`。
 */

import { SUBTYPE_KEYS, SUBTYPE_META } from '~shared/schema'

/* ────────────────────────────────────────────────
 * 图标生成
 * ────────────────────────────────────────────── */

/**
 * 圆点 marker 的内联 SVG data URI。
 *
 * ## 为什么是圆点，不是针尖
 * 针尖（pin）的地图语义是「一个要去的目的地」，适合**单点导航**。
 * 城市页要一次撒 46 个点，针尖的视觉重量会让地图变成一片小旗子，
 * 把底图的路网和地名全盖住。圆点是"撒点"的通用语言（散点图、热力图都是它）：
 * 重量轻、不挡底图，密集时反而读得出"哪里密、哪里稀"。
 *
 * ## 画布比圆点大 —— 命中区靠它兜底
 * `MarkerStyle` 的 `width`/`height` 同时是**渲染尺寸**和**命中矩形**，
 * 图片会被缩放到这个尺寸。8px 的圆点若画布也只有 8px，手机上根本点不中
 * （远低于 24px 的推荐触控尺寸）。所以画布固定 `POI_ICON_PX`（24）、圆点画在正中 ——
 * **看到的是 8px，点到的是 24px**。
 *
 * ⚠️ 必须有**白色描边**：影像底图色彩杂乱，没描边的圆点在深绿/深灰区域会糊掉。
 */
export function dotSVG(box: number, dot: number, color: string): string {
  const c = box / 2
  const strokeWidth = 1.6
  // 描边以圆周边为中心向两侧各画一半，所以半径要扣掉半个描边，
  // 否则视觉直径会变成 dot + strokeWidth
  const r = dot / 2 - strokeWidth / 2
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}" viewBox="0 0 ${box} ${box}">` +
    `<circle cx="${c}" cy="${c}" r="${r}" fill="${color}" stroke="#FFFFFF" stroke-width="${strokeWidth}"/>` +
    `</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/**
 * 选中态的圆点：白色圆环打底 + 深色细边 + 彩色圆心。
 *
 * 选中不能只靠"把圆点画大" —— 放大的彩色圆点在一堆同色点里依然认不出来。
 * 加一圈白色实底，等于给它垫了个"底座"，只要旁边有点就会被衬出来。
 * ★ 锚点仍取**画布中心**，所以点中前后圆心都落在坐标上，**不跳**。
 */
export function dotActiveSVG(box: number, ring: number, dot: number, color: string): string {
  const c = box / 2
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}" viewBox="0 0 ${box} ${box}">` +
    `<circle cx="${c}" cy="${c}" r="${ring / 2}" fill="#FFFFFF" stroke="rgba(16,24,40,0.45)" stroke-width="1"/>` +
    `<circle cx="${c}" cy="${c}" r="${dot / 2}" fill="${color}"/>` +
    `</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/**
 * 行程顺序圆点的**画布边长**（px）—— 同时也是 `MarkerStyle` 的**命中矩形**。
 *
 * ★ 2026-09-28 从 **44 缩到 32**（用户：「这个标记会挡住景点的标签，这个标记缩小一点试试」）。
 *   挡住的是**景点名字标签**：它的盒中心在坐标上方 `|LABEL_LIFT_PX|` = 20px、盒高 `LABEL_BOX_PX` = 22
 *   ⇒ **盒底边在坐标上方 10px**；而原来那颗圆的**可见**直径是 26px（`SEQ_DOT_PX` 30 − 白描边 2×2）
 *   ⇒ 圆顶在坐标上方 13px，比标签盒底边**高出 3px**、正压在标签的白底下沿上。
 *   缩小后可见直径 18px（圆顶 −9px），名字**文字**离圆顶还有 **5.5px**
 *   （`_tmp/cdp_planclaim_verify.mjs` 的 ②′ 在截图上逐像素量的）。
 *   ★ **20 是这个位置的临界值**：再大就压住标签盒、再小就装不下 12 号字。
 * ★ 锚点仍是**画布中心**：圆心照旧落在坐标上，缩放前后点位**不跳**。
 */
const SEQ_BOX_PX = 32

/**
 * 序号圆的**可见直径**（px）—— 与 `DOT_SIZE` 是两回事：那个是"撒点"的圆，这个是**装数字**的圆。
 *
 * ★ 它同时决定了「会不会盖住名字标签」（见 `SEQ_BOX_PX` 的算式），
 *   所以别单独调大小 —— 两个常量一起看。
 */
const SEQ_DOT_PX = 20

/** 行程顺序圆点（①②③…）。行程页点位显示的是**顺序**而不是类型色 */
export function seqSVG(index: number, color = '#FFFFFF', bg = '#161A22'): string {
  const label = index <= 9 ? String(index) : '·'
  const c = SEQ_BOX_PX / 2
  // 12 号字的视觉中心在基线之上约 4px ⇒ 基线取圆心 + 4 才显得居中（整数，免得发虚）
  const baseline = c + 4
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SEQ_BOX_PX}" height="${SEQ_BOX_PX}" viewBox="0 0 ${SEQ_BOX_PX} ${SEQ_BOX_PX}">` +
    `<circle cx="${c}" cy="${c}" r="${SEQ_DOT_PX / 2}" fill="${bg}" stroke="#FFFFFF" stroke-width="2"/>` +
    `<text x="${c}" y="${baseline}" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif" ` +
    `font-size="12" font-weight="600" fill="${color}">${label}</text>` +
    `</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** 住宿点旗标 —— 形状必须与普通点位不同（它是另一种标记，不是第 13 个细类） */
export function staySVG(): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="45" viewBox="0 0 34 43">` +
    `<path d="M17 42C17 42 32 27 32 17A15 15 0 1 0 2 17C2 27 17 42 17 42Z" fill="#161A22" stroke="#FFFFFF" stroke-width="2.2"/>` +
    `<path d="M11 20V10.5L23 13.5L11 16.5" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<circle cx="11" cy="10.5" r="1.6" fill="#FFFFFF"/>` +
    `</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/* ────────────────────────────────────────────────
 * 尺寸（每一个数都被别处引用，改一个要连着改）
 * ────────────────────────────────────────────── */

/**
 * 点位的**画布边长**（px）—— 同时也是 `MarkerStyle` 的命中矩形。
 *
 * ★ 这是**跨文件的唯一出处**：`app.css` 的 `.map-layer img[height]` 用同一个数
 *   （CSS 不能 import TS，两边靠 `check_app.py` 的 Z⑦ 钉在一起）。
 *   ★ 那条 CSS 现在的角色变了：SDK 画的那枚点会被我们藏起来，万一**没藏住**，
 *     它至少不至于被 Tailwind Preflight 压成 `0×0`（那样连"出 bug 了"都看不出来）。
 */
export const POI_ICON_PX = 24

/**
 * 看得见的圆点直径。
 *
 * ★ 2026-09-24 从 **8 调到 11**：用户原话「没选中时这个点好小，得大一点」。
 *   8px 叠上 1.6px 的白色描边后只剩 6px 左右，在影像底图上发虚；11px 才站得住。
 *   画布仍是 `POI_ICON_PX`（24）—— **看得见的是 11px，点到的是 24px**。
 */
const DOT_SIZE = 11
/** 选中态的画布 */
const ACTIVE_BOX = 26
/** 白底座直径 */
const ACTIVE_RING = 18
/**
 * 选中态的彩色圆心直径 —— **与 `DOT_SIZE` 同一个数**。
 *
 * ★ 这一条专治用户上一轮报的「选中了和没选中的点大小差得太大」：
 *   选中**不把那枚点放大**，只是给它垫一圈白底座。点本身尺寸不变，
 *   视觉差就只剩底座那一圈 —— 而不是"小点 → 大圆环"的两级跳。
 */
const ACTIVE_DOT = DOT_SIZE

/**
 * 标签**底边**与圆点**顶边**之间的空隙（px）。
 *
 * ★ 2026-09-24 从 **6 调到 3**：用户原话「标签和点之间的间距得缩小一点，现在偏大」。
 *   实测（`_tmp/cdp_gap_dblclick.mjs` 逐行分类裁图）间距是 **15px**，而真正的"让开距离"
 *   里有一大半**不是这个常量造成的** —— 见 `LABEL_LIFT_PX`（原来按画布半径算，多让了 6.5px）。
 *   两处一起改之后实测 15 → **5px**。
 */
const LABEL_GAP_PX = 3

/**
 * 标签盒的**高度**（估算）—— 与下面 `buildLabelStyles` 的字号 / 内边距 / 边框配套。
 *
 * ## 为什么必须写这个数（明明有 `verticalAlignment` 可以让 SDK 自己算）
 * 实测（`_tmp/cdp_label_hitbox.mjs`：在点位周围**逐格点**，看哪些位置能开详情）：
 * `verticalAlignment: 'bottom'` 时，**画出来的框和命中的框差了约 11px** ——
 * 名字画在 dy `-48..-34`，而能点中的只有 dy `-36..-24`。两者只在边角上有一点重叠，
 * 于是"看得见的名字点不动"（用户的原话是「点标签也不显示景点信息」）。
 * `middle`（offset 就是盒中心）时画与命中一致 → **只能用 middle + 自己算半高**。
 *
 * 取值：`size: 12` 字号 + `padding: 3px`×2 + `border: 1px`×2 ≈ 20，实测命中区高约 20–22 → 22。
 * ★ 改字号或内边距时**这个数要跟着改** —— `check_app.py` 的 Z⑦ 只能钉住"图标多大"，
 *   钉不住"标签自己多高"。
 */
const LABEL_BOX_PX = 22

/**
 * 标签中心相对**坐标**要抬多高。
 *
 * ★ 让开的是**看得见的圆点半径**（`DOT_SIZE / 2`），不是画布半径 —— 画布 24px 只是**命中区**，
 *   拿它算等于让标签凭空高出 6.5px。这正是用户报的「标签和点之间的间距偏大」的主要来源
 *   （实测 15px 里有 6.5px 是它），`_tmp/cdp_gap_dblclick.mjs` 量过。
 *
 * ★ 选中与未选中**共用这一个数** —— 两者的可见圆点一样大
 *   （选中只多一圈白底座，白底座画在画布内部、不改变可见高度）。
 * ★ 取整：`DOT_SIZE / 2 = 5.5`，带小数会让画布上的文字发虚（半像素抗锯齿）。
 */
const LABEL_LIFT_PX = -(Math.ceil(DOT_SIZE / 2) + LABEL_GAP_PX + LABEL_BOX_PX / 2)

/* ────────────────────────────────────────────────
 * 样式表
 * ────────────────────────────────────────────── */

export function buildMarkerStyles(): Record<string, TMap.MarkerStyle> {
  const styles: Record<string, TMap.MarkerStyle> = {}
  for (const key of SUBTYPE_KEYS) {
    const color = SUBTYPE_META[key].color
    styles[`sub-${key}`] = new TMap.MarkerStyle({
      width: POI_ICON_PX,
      height: POI_ICON_PX,
      // 圆点在正中 → 锚点取画布中心；★ 是**像素**不是比例（见文件头那段标定）
      anchor: { x: POI_ICON_PX / 2, y: POI_ICON_PX / 2 },
      src: dotSVG(POI_ICON_PX, DOT_SIZE, color),
    })
    styles[`sub-${key}_A`] = new TMap.MarkerStyle({
      width: ACTIVE_BOX,
      height: ACTIVE_BOX,
      // 白底座与彩色圆心同心 → 锚点仍是画布中心，点中前后圆心都在坐标上
      anchor: { x: ACTIVE_BOX / 2, y: ACTIVE_BOX / 2 },
      src: dotActiveSVG(ACTIVE_BOX, ACTIVE_RING, ACTIVE_DOT, color),
    })
  }
  // 行程页的序号与住宿点：**仍是序号圆点 / 旗标** —— 它们各自是"一个目的地"，不是撒点
  // 旗标的针尖在画布底边中点（52×66）
  styles.stay = new TMap.MarkerStyle({ width: 52, height: 66, anchor: { x: 26, y: 66 }, src: staySVG() })
  for (let i = 1; i <= 9; i++) {
    // 序号圆点的圆心落在坐标上（尺寸与"会不会挡住名字标签"都见 `SEQ_BOX_PX`）
    styles[`seq${i}`] = new TMap.MarkerStyle({
      width: SEQ_BOX_PX,
      height: SEQ_BOX_PX,
      anchor: { x: SEQ_BOX_PX / 2, y: SEQ_BOX_PX / 2 },
      src: seqSVG(i),
    })
  }
  return styles
}

/**
 * POI 文字标签样式。
 *
 * ⚠️ 参数名用实测过的那套（`size` / `alignment` / `verticalAlignment`）——
 *    腾讯对未知字段**静默忽略**：写 `fontSize` / `fontFamily` / `fontWeight` /
 *    `align` / `verticalAlign` 都不报错，只是样式悄悄失效。详见 `tmap.d.ts` 的
 *    `LabelStyleOptions` 注释（那里有 CDP 实测的 own properties 权威清单）。
 *
 * ★ **锚点必须留在 `middle`**：实测 `bottom` 时"画出来的框"与"命中的框"差约 11px
 *   （见 `LABEL_BOX_PX` 的注释），会让**看得见的名字点不动**。`middle` 时 offset
 *   就是盒中心、画与命中重合 —— 代价是得自己写 `LABEL_BOX_PX`。
 * ★ 选中与未选中**共用同一个 `LABEL_LIFT_PX`**（理由见那里的注释）。
 */
export function buildLabelStyles(): Record<string, TMap.LabelStyle> {
  return {
    poi: new TMap.LabelStyle({
      color: '#161A22',
      size: 12,
      backgroundColor: 'rgba(255,255,255,0.92)',
      borderColor: 'rgba(16,24,40,0.10)',
      borderWidth: 1,
      borderRadius: 6,
      padding: '3px 7px',
      offset: { x: 0, y: LABEL_LIFT_PX },
      alignment: 'center',
      verticalAlignment: 'middle',
    }),
    poiActive: new TMap.LabelStyle({
      color: '#FFFFFF',
      size: 12.5,
      backgroundColor: '#161A22',
      borderColor: '#FFFFFF',
      borderWidth: 1.5,
      borderRadius: 6,
      padding: '4px 9px',
      offset: { x: 0, y: LABEL_LIFT_PX },
      alignment: 'center',
      verticalAlignment: 'middle',
    }),
  }
}
