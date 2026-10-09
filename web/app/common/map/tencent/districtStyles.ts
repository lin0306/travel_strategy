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
