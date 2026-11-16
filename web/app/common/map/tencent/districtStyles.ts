/**
 * 区划面与计数徽标的**外观定义**（样式表 + 徽标文案）。
 *
 * ## 为什么从 `districtLayer.ts` 拆出来
 * `districtLayer` 管的是"铺哪一级、点击怎么命中、徽标挤不挤"，
 * 而配色档位与徽标文案是**另一类改动** —— 它们改的是给人的观感，
 * 与下钻逻辑无关。本项目对超大文件有一条硬约定（单文件 ≤ 420 行），
 * 理由正是"AI 每读一次拉全文"：调一个颜色不该把整套下钻代码拉进上下文。
 *
 * ## 空态是这一层最重要的体验决策（原文照搬，别删）
 * | 档位 | POI 数 | 填充 | 描边 |
 * |------|-------|------|------|
 * | **待收录** | 0 / null | 极浅灰 | 灰**虚线** |
 * | 稀疏 | 1–20 | 浅蓝 | 蓝实线 |
 * | 中等 | 21–60 | 中蓝 | 蓝实线 |
 * | 密集 | 61+ | 较深蓝 | 深蓝实线 |
 *
 * 虚线是关键：它在中国地图语境里天然表达"未完成/规划中"，
 * 且**不破坏版图完整性** —— 边界依然清晰可见，只是用线型区分了状态。
 *
 * ## ★★ 2026-09-30：描边加了一档（用户：「省市区的所有轮廓都不明显」）
 * 上一版的填充与描边都只有"状态区分"这一层考虑，**没考虑它能不能被看见**：
 *
 * | 档位 | 改前 | 改后 |
 * |------|------|------|
 * | 待收录 | `#B4B2A9` · 1px 虚线 | **`#6E6C66` · 2px 虚线** |
 * | 稀疏 / 中等 | `#185FA5` · 1px 实线 | **`#185FA5` · 2px 实线** |
 * | 密集 | `#0C447C` · 2px 实线 | **`#0C447C` · 2.5px** |
 *
 * 为什么非改不可：省级页上**只有"已收录"的市有可见的面**，其余整片是
 * `rgba(136,135,128,0.06)` 填充 + `#B4B2A9` 1px 虚线 —— 在浅色底图上等于没有，
 * 于是一个省的轮廓**看不出来**（那种情况下用户看到的是底图自带的细线，
 * 会以为"我们根本没画轮廓"）。
 *
 * ★ `borderWidth` **只能用整数或半整数**（SDK 的样式校验会拿 `PolylineStyle.width`
 *   的规则过一遍，`1.2` 这种会刷 console.error，见下面 `medium` 那条的历史注释）。
 *   `2.5` 是实测可用的最大档；想更粗就得换 `borderWidth: 3`，但那会把小面积区压死。
 *
 * 🚨 **合规红线**
 * 这里**只定义样式**，几何一律来自腾讯 District 服务。
 * **绝对禁止**任何第三方 GeoJSON、自制中国地图轮廓、或 Natural Earth 之类数据集 ——
 * 中国地图的行政区划边界涉及国家版图完整性（台湾省、藏南、南海诸岛、阿克赛钦的表达），
 * 第三方数据常出错，违反《地图管理条例》。详见 `plans/10-map-drilldown.md` 第九节。
 */

import type { MapLevel } from './zoomTiers'

/**
 * 徽标样式 id。
 *
 * ★★ 2026-10-02 用户报「标签的背景色没了」—— 根因是**徽标的 styleId 与样式表的 key 分家了**：
 *   `districtLayer.repaintBadges` 把**面**用的 `styleIdOf()`（返回 `pending/sparse/medium/dense/
 *   hover/active`）原样传给了 `MultiLabel`，而 `buildBadgeStyles()` 的 key 是
 *   `badge/badgePending/badgeHover` —— 两个集合**交集为空**。
 *   腾讯对未知 styleId **不报错**（同它对未知字段静默忽略的脾气），
 *   于是每个徽标都退回 SDK 默认样式：**白底圆角边全没了，只剩一行黑字压在底图上**，
 *   看上去就像"标签坏了 / 不明显 / 不显示了"。
 *
 * ⇒ 收口办法：把徽标样式 id 变成**联合类型**（`Record<BadgeStyleId, …>` 逼着样式表写全），
 *   徽标几何的 styleId **只能**由 `badgeStyleIdOf()` 产出，两处再也分不了家。
 */
export type BadgeStyleId = 'badge' | 'badgePending' | 'badgeHover' | 'badgeActive'

/**
 * 一个待铺的区划：**几何来自边界文件，计数来自区划树** —— 两者在这层汇合。
 *
 * ⚠️ `poiCount === null`（没做过）与 `=== 0`（做过但空）在**配色**上合并，
 *    但在**文案**上必须分开：前者是「待收录」，后者才是真的「0 个」。
 *    这就是 `badgeText()` 存在的理由 —— 别在渲染处就地拼字符串。
 */
export interface DistrictGeoNode {
  adcode: string
  name: string
  lng: number
  lat: number
  poiCount: number | null
}

/**
 * 徽标文案。
 *
 * - 待收录（`null`）：`「西藏 —」` —— 破折号而不是 0
 * - 已收录：`「成都 46」`
 *
 * ★ 绝不在 `null` 时显示 0："没做过"和"做过但空"是两件事，
 *   用 0 表达前者会让用户以为我们收录了却一个都没有。
 */
export function badgeText(node: DistrictGeoNode): string {
  if (node.poiCount === null) return `${node.name} —`
  return `${node.name} ${node.poiCount}`
}

/**
 * 「**待收录**」判据 —— 唯一出处。
 *
 * ⚠️ `null`（没做过）与 `0`（做过但空）**在这里合并**（同一副皮），
 *    但**文案必须分开**：前者是「待收录」（`badgeText` 给「—」），
 *    后者才是真的「0 个」。用 0 表达前者会让用户以为我们收录了却一个都没有。
 *
 * ★ 2026-10-03 收窄：原先是 `densityTier()`，返回**四档**
 *   （`pending`/`sparse`/`medium`/`dense`），面的底色按它分深浅。
 *   用户说「这个轮廓的不同数量显示不同的颜色区分也去掉，现在标签已经有做区分了，
 *   不做重复处理」⇒ 面不再分档 ⇒ 这里**只剩"是不是待收录"这一位**，
 *   于是从"返回档位"收成"返回布尔"。
 *   ⚠️ 别再把它展开回档位（护栏 AP 守着）。
 */
export function isUncollected(poiCount: number | null): boolean {
  return poiCount === null || poiCount === 0
}

/**
 * 徽标该用哪个样式 id —— **唯一出处**。
 *
 * ★ 徽标只有三态（有数据 / 待收录 / 高亮），与面的四档密度**不是一套语义**：
 *   面的档位区分"收录得多不多"，徽标只需要"有数据 vs 待收录"两副皮。
 *   所以这里独立成一个函数，而**不要**复用面的 `styleIdOf` ——
 *   那次「标签背景色没了」的事故就是复用的代价：面用的 id 在徽标样式表里
 *   一个都不存在，SDK 静默退回默认样式，白底圆角全丢。
 *
 * @param active  当前激活的 adcode（页面点过的那一个）
 * @param hovered 当前悬浮的 adcode
 */
export function badgeStyleIdOf(
  node: Pick<DistrictGeoNode, 'adcode' | 'poiCount'>,
  active: string | null,
  hovered: string | null,
): BadgeStyleId {
  if (node.adcode === active) return 'badgeActive'
  if (node.adcode === hovered) return 'badgeHover'
  // ★ 只取「有没有数据」这一位 —— 面已经不分档了（见 `isUncollected`），
  //   徽标仍分两副皮：`badgePending`（待收录）与 `badge`（已收录）。
  return isUncollected(node.poiCount) ? 'badgePending' : 'badge'
}

/**
 * 图层模式 —— 「这一档的面要不要接事件、要不要出徽标」。
 *
 * | 模式 | 面 | 徽标 | 可点 / 可悬停 | 什么时候用 |
 * |------|----|------|--------------|-----------|
 * | `full` | ✓ | ✓ | ✓ | 省 / 市 / 区**徽标档** —— 徽标是这一档的主角（点它进去） |
 * | `reference` | ✓ | ✗ | ✗ | **点位档**（`zoom ≥ POI_REVEAL_ZOOM`）—— 面只作"我在哪个区"的参考底 |
 *
 * ★★ 为什么点位档要留面（2026-10-02 用户：「区的轮廓能不能一直都显示，现在区在放大到
 *   显示景点的时候就不会显示了，就不知道这个到底在哪个区」）：面消失之后，屏幕上只剩
 *   一堆圆点，**看不出这些景点属于哪个区** —— 而"这一片是什么区"正是选景点时的关键上下文。
 *
 * ★★ 为什么 `reference` 必须**同时**关掉徽标与点击（不能只关一半）：
 *   · 徽标：点位档的徽标会**挡住景点名字**，而且它没有可点进去的下一级；
 *   · 点击：面是**大块填充**，几乎覆盖整屏。留着 `click` ⇒ 用户点景点附近时命中面，
 *     触发"飞到该区" —— 他想点景点，镜头却飞走。这条是 `reference` 模式存在的**主要理由**。
 *   · 悬停：同理，划过一片就整块高亮，在点位档只是干扰。
 *
 *   ⚠️ 关掉面的事件**不影响**"点空白收起详情"：那个判定在点位层（`poiClicks`）。
 */
export type DistrictLayerMode = 'full' | 'reference'

/**
 * 哪一**级**的面要换深色（2026-11-15 界面验收 P2）。
 *
 * 原来按 `zoom >= 9.5` 判，但城市页 / 移动端会抬高 `base`：level 在 z=9.46 / 7.99
 * 就已是 district（底图同样是街道图），于是最常见的「首页 → 进城市页」路径
 * 反而拿不到深线。判据必须跟**揭示级**走，而不是跟绝对缩放走。
 *
 * ★ 取 `faceLevel` 还有个时序好处：它一变就必然 `setNodes → repaint()`，
 *   换色与重铺天然重合（按 zoom 判可能出现"样式变了、面没重铺"）。
 * ★ 刻意定义在 `faceStyleId` **函数体外**：AN ④ 会抓函数体里所有单引号
 *   字面量当作样式 id，把 district 写进去会被误判成"样式表里没有的 id"。
 */
const FACE_DEEP_LEVEL: MapLevel = 'district'

/**
 * 面用哪一档样式。**只会返回 `face` / `faceDeep` / `reference`** —— 面的颜色区分
 * 早已全部取消：不按收录数量分档、不填充、不因悬浮 / 选中变色。
 *
 * ## 三档的分工（只有"看得见"这一个维度，与"多少条数据"无关）
 * | 档 | 何时 | 描边 |
 * |----|------|------|
 * | `face` | 省 / 市徽标档（浅色行政底图） | `rgba(110,108,102,0.7)` 2px |
 * | `faceDeep` | district 级的面（街道底图） | `rgba(66,64,59,0.95)` 2px |
 * | `reference` | 点位 / 规划档（街道底图 + 满屏圆点） | `rgba(95,94,90,0.85)` 2px |
 *
 * ⚠️ 这三档的差别**不是**"收录得多不多"（那条判据 2026-10-03 已彻底删掉，
 *    护栏 AP 守着）。它是"这张底图有多吵" —— 底图越吵，线就要越硬。
 *
 * ## 为什么没有 `hover` / `active` 档（2026-10-03，别再加回来）
 * 用户：「这个轮廓的悬浮高亮去掉，会卡」「所有颜色区分都去掉，背景色不需要，只需要边框」
 * 「不需要整个轮廓都高亮」。
 *
 * "卡"的根源不在判据那一行：`onHover` 每次变化都调 `repaint()`，而 `repaint()` 是
 * **全量** `polygons.setGeometries()`（面**没有**内容签名短路，只有徽标有）。区这一级
 * 一屏几百个面、每个面几百到上千顶点 ⇒ 鼠标每划过一条边界就重建整批多边形。
 * ⚠️ 想"给面加签名短路再把 hover 加回来"也不行：签名要覆盖全部 adcode + 样式 + 几何，
 *    hover 恰好只改其中一个 ⇒ 签名必然变化 ⇒ 还是全量重建。真要做得按 id 增量更新，
 *    SDK 没这个 API。
 *
 * "我选中了哪个区"现在由**徽标**（`badgeActive`）表达；连带好处是 `setActive()` 不必
 * 再全量 `repaint()`。
 *
 * ★ **不许**拿它去设徽标 —— 见 `badgeStyleIdOf` 的文件头。
 */
export function faceStyleId(mode: DistrictLayerMode, faceLevel: MapLevel): string {
  // 点位 / 规划档的面是背景，主角是圆点与路线 —— 必须先于 faceLevel 判
  if (mode === 'reference') return 'reference'
  // ★ 街道底图上区界要更硬；判据跟揭示级走，见 `FACE_DEEP_LEVEL`
  return faceLevel === FACE_DEEP_LEVEL ? 'faceDeep' : 'face'
}

export function buildDistrictStyles(): Record<string, TMap.PolygonStyle> {
  return {
    /**
     * **唯一的一档面样式 —— 只画边框，完全不填充。**
     *
     * 演进过程（别再走回头路）：
     *   ① 四档（`pending`/`sparse`/`medium`/`dense`）按收录数量分深浅
     *      —— 2026-10-03 用户：「这个轮廓的不同数量显示不同的颜色区分也去掉，
     *      现在标签已经有做区分了，不做重复处理」；
     *   ② 合成一档 `face`，但**仍有填充**（浅蓝 0.13）；
     *   ③ 现在（同一天追加）连填充也去掉 —— 用户：「这个轮廓的所有颜色区分都去掉，
     *      背景色不需要，只需要边框」。
     *
     * ★ 为什么填充是多余的：区域的三层信息**都已经在徽标上**了 ——
     *   · 身份（「成都 57」）· 状态（「西藏 —」= 待收录）· 高亮（`badgeHover`/`badgeActive`）。
     *   填充只是往底图上糊一层色：它挡掉地图要素（路网、水系、地名），
     *   又制造"有的深有的浅像没做完"的错觉（那正是 ①→③ 一路被砍掉的原因）。
     * ⇒ 面只剩一个职责：**边界在哪**。
     *
     * ⚠️ `color` **必须显式写成全透明**，不能省略 —— 省略会走 SDK 的默认填充色，
     *   等于把填充又加回来了（而且是不受控的颜色）。
     * ⚠️ **别再按数量把档位加回来**（护栏 AP 守着）。要表达进度，加在徽标文案上。
     */
    face: new TMap.PolygonStyle({
      color: 'rgba(0,0,0,0)', // ★ 全透明 = 不填充
      showBorder: true,
      /**
       * ★★ **灰色，不用蓝**（用户 2026-10-05：「区域的轮廓线，改成用灰色，别用蓝色，
       * 颜色有点重合了」）。
       *
       * ## 为什么蓝会和什么"重合"
       * 地图上还有另一套**蓝色线**：规划路线的候选（浅蓝）/ 选中（主蓝）。
       * 区轮廓是**底图级的参考信息**（回答"这一片属于哪个区"），
       * 而路线是**用户正在看的主内容**（回答"我怎么走"）。
       * 两者同属蓝色系时，"哪条线是路、哪条是区界"要靠粗细和深浅去猜 ——
       * 而它们本来就不是一个层级的东西，**不该共用一套色**。
       *
       * ⇒ 区轮廓回到**中性灰**（`#6E6C66`，与徽标里那几档灰同一个色系）：
       *   它是衬托，不是内容。路线的蓝于是成为地图上**唯一的蓝**，一眼可辨。
       */
      borderColor: 'rgba(110,108,102,0.7)',
      // ⚠️ 描边宽度**只能是整数**：SDK 的样式校验会拿 PolylineStyle 的 `width` 规则
      //    过一遍，`1.2` / `2.5` 都会刷一条
      //    「样式id … 对应的PolylineStyle.width属性无效」的 console.error，
      //    而且被判定无效的那份样式会**丢掉描边**（外表看是"颜色不受控"）。
      borderWidth: 2,
    }),
    /**
     * ⚠️ 这里曾有 `active`（点击选中时整块面变绿）—— **已删**。
     *
     * 用户：「悬浮到区域上，标签显示高亮就行了，**不需要整个轮廓都高亮**」。
     * 那句话是针对 `hover` 说的，但同一个道理对 `active` 更成立：
     * "我选中了哪个区"由**徽标**（`badgeActive`）说明，面不需要再绿一遍。
     *
     * ★ 删掉它还有个副作用是好的：`setActive()` 不必再 `repaint()` ——
     *   那是**全量** `polygons.setGeometries()`（面没有内容签名短路）。
     *   现在点击只重刷徽标。详见 `districtLayer.setActive`。
     */
    /**
     * **点位档（`reference`）专用的面** —— 唯一不按收录密度分档的样式。
     *
     * ★ 为什么需要它：点位档的面**不表达收录状态**（那一档的徽标已经退场，
     *   没人给这些数字做注解），它只回答一件事：**"我这一片属于哪个区"**。
     *   所以：
     *   · 不能沿用 `pending`（灰虚线）—— 区里没有收录景点是**正常事实**，
     *     给它画"待收录"的虚线，等于在用户选景点时说这地方没做过；
     *   · 也不能太淡 —— 2026-10-02 实测：按 `pending` 那套（0.08 填充 + 灰虚线）
     *     渲染时，在 z=13 的街道底图上**肉眼完全看不见**，用户的原话是"区的轮廓不显示了"。
     *     用高对比色做对照实验（fill/border 全换成洋红）确认几何**一直是画出来的**，
     *    ⇒ 问题是**对比度**，不是"没铺"。
     *
     * 取值取**中灰蓝**：在浅色路网与深色 POI 圆点上都读得出，但不抢景点的视觉权重。
     *
     * ★ 2026-10-03：填充也去掉了（`rgba(0,0,0,0)`）——
     *   与 `face` 同一个理由：这一档的面只回答"这一片属于哪个区"，
     *   而那个问题**一条边框就答完了**；填充反而会盖住 POI 圆点与路网，
     *   在点位档是最不该做的事。描边比 `face` 深（0.85 vs 0.65）也不是"颜色区分"，
     *   是**底图不同**：点位档落在 z≥12 的街道底图上，浅色路网会把淡线吃掉。
     */
    reference: new TMap.PolygonStyle({
      color: 'rgba(0,0,0,0)', // ★ 全透明 = 不填充（别省这一行，省了会走 SDK 默认填充）
      showBorder: true,
      // ★ 对比度是**量出来**的：洋红 / 红边对照实验（`_tmp/cdp_badgecheck.mjs`）证明几何
      //   一直在画、样式也一直在生效（z=13 那一屏红边占 1.1 万像素），
      //   只是低 alpha 的浅色叠在街道底图上"看不见" ——
      //   底图自己就有大量浅灰线，静默地把我们那条线吃掉了。所以取高 alpha 的**深灰**。
      //
      // ★ 2026-10-05：色相从"深灰蓝"(`rgba(45,80,130,…)`)**改回中性深灰** ——
      //   理由同 `face` 那条：地图上的蓝要留给**路线**。点位档同样只需要回答
      //   "这一片属于哪个区"，那是衬托性的信息，不该和用户正在看的路线抢同一种颜色。
      //   底图变深（z≥12 街道）时靠**加深灰 + 提高 alpha** 保持可读，而不是靠换色相。
      borderColor: 'rgba(95,94,90,0.85)',
      borderWidth: 2,
    }),
    /**
     * **区徽标档的面** —— 只比 `face` 深，别的一模一样。
     *
     * z≥9.5 进街道底图后，`rgba(110,108,102,0.7)` 的浅灰细线被浅灰路网 + 村名吃掉，
     * 用户读到的就是"区界没画"。取值把明度压到 `(66,64,59)`、alpha 拉到 0.95，
     * 与底图最大的那批浅灰（约 `#D8D6CE`）拉开 4 倍以上明度差。
     * 实拍对照：`_tmp/panels/crop-before-district.png` ↔ `crop-after-district.png`。
     *
     * ⚠️ 宽度仍取 2，**不加粗**：z=10.5 一屏 140 个面，3px 会糊成网格，而且会与
     *   作用域外框（`scope`，3px）抢同一个权重 —— 那一圈必须比下级各面粗一档。
     *   层级靠**粗细**表达，不靠颜色。填充仍全透明（同 `face`，别加浅底）。
     */
    faceDeep: new TMap.PolygonStyle({
      color: 'rgba(0,0,0,0)',
      showBorder: true,
      borderColor: 'rgba(66,64,59,0.95)',
      borderWidth: 2,
    }),
    /**
     * **作用域外框** —— 当前选中单位（省 / 市 / 区）**自身**的轮廓，只有一圈，压在
     * 下级各面之上（见 `districtLayer` 的 `SCOPE_GEOM_ID`）。
     *
     * ## 为什么光有下级的面不够（2026-11-14）
     * 用户要的是「点省了，就只显示那个省的数据和轮廓」，并确认了「省界 + 省内各市界」。
     * 而省界在数据里**就是各市外沿的拼合**：相邻两市的共享边界只有一条线，
     * 线宽与省内市界完全相同 ⇒ 屏幕上只是"一片网格"，读不出"这是一整个省"。
     *
     * ⇒ 额外画这一层（数据来自 `provinces/<省>.geo.json` 的**省自身轮廓**，
     *   不是拼接结果）。市级同理用 `cities/<省>.geo.json`，区级用 `districts-own`。
     *
     * ## 为什么比 `face` 粗一档、且必须是整数
     * `face` 是 2px（市界 / 区界，衬托性）；这一圈是"范围声明"，要比衬托线**明显一档**
     * 才看得出，取 3。⚠️ 腾讯的样式校验会拿 `PolylineStyle.width` 的规则过一遍，
     * `2.5` 这类小数会刷 console.error 并**丢掉描边**（见 `face` 那条注释）——
     * 所以只写整数。
     *
     * ## 2026-11-15：颜色再压深一档（因为下级各面变深了）
     * 加了 `faceDeep` 之后，区徽标档的下级各面是 `rgba(66,64,59,0.95)` —— 比原来这一圈的
     * `(70,68,64)` **还深**，于是"范围声明"反而比它圈住的东西更淡，层级是**反的**。
     * 现在三档严格递增：`face`（0.70 · 浅灰）‹ `faceDeep`（0.95 · 深灰）‹ `scope`（0.96 · 近黑）。
     *
     * ★ 颜色仍走中性灰、不用蓝：地图上的蓝只给路线（`face` 那条的同一条纪律）。
     */
    scope: new TMap.PolygonStyle({
      color: 'rgba(0,0,0,0)',
      showBorder: true,
      borderColor: 'rgba(38,36,32,0.96)',
      borderWidth: 3,
    }),
  }
}

/**
 * 徽标样式。
 *
 * 🚨 **参数名必须用实测过的那套**（`size` / `alignment` / `verticalAlignment` …）。
 *    腾讯 `LabelStyle` 对未知字段是**静默忽略**的 —— 写 `fontSize` / `fontWeight` /
 *    `align` / `cursor` 不会报错，字号会悄悄退回默认 14px、字重与居中设置全部丢失。
 *    实例化后 own properties 实测只有：
 *      color · backgroundColor · borderColor · borderWidth · strokeColor · strokeWidth ·
 *      size · width · height · padding · borderRadius · scale · offset · angle ·
 *      alignment · verticalAlignment · wrapOptions
 *    **没有 `fontSize`，也没有 `fontWeight`** —— 想加粗是做不到的，别硬写。
 *
 * ★★ key 必须**逐一**落在 `BadgeStyleId` 上（返回类型是 `Record<BadgeStyleId, …>`，
 *    漏一个 TS 就报错）—— 这就是 2026-10-02「标签背景色没了」那次事故的护栏：
 *    徽标几何传的 styleId 与这里的 key 一旦对不上，SDK **不报错**，
 *    只是每个牌子都退回默认样式（白底圆角全丢，剩一行黑字）。
 */
export function buildBadgeStyles(): Record<BadgeStyleId, TMap.LabelStyle> {
  const base = {
    alignment: 'center',
    verticalAlignment: 'middle',
    borderRadius: 8,
    padding: '4px 9px',
  }
  return {
    /** 有数据：白底 + 深字 */
    badge: new TMap.LabelStyle({
      ...base,
      color: '#161A22',
      size: 12.5,
      backgroundColor: 'rgba(255,255,255,0.95)',
      borderColor: 'rgba(16,24,40,0.18)',
      borderWidth: 1,
    }),
    /** 待收录：浅灰底 + 灰字 + 灰边，**弱化样式** */
    badgePending: new TMap.LabelStyle({
      ...base,
      color: '#8A8880',
      size: 12,
      backgroundColor: 'rgba(255,255,255,0.82)',
      borderColor: 'rgba(180,178,169,0.9)',
      borderWidth: 1,
    }),
    /** 悬浮态：白底 + 蓝字 + 蓝边 */
    badgeHover: new TMap.LabelStyle({
      ...base,
      color: '#0C447C',
      size: 12.5,
      backgroundColor: '#FFFFFF',
      borderColor: '#0C447C',
      borderWidth: 1.8,
    }),
    /** 激活态（点过的那个区/市）：白底 + 绿字 + 绿边，与面的 `active` 同色系 */
    badgeActive: new TMap.LabelStyle({
      ...base,
      color: '#0F6E56',
      size: 12.5,
      backgroundColor: '#FFFFFF',
      borderColor: '#0F6E56',
      borderWidth: 1.8,
    }),
  }
}
