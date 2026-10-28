/**
 * 「点徽标 = 落到对应的比例」—— 下钻靠缩放，**不靠换页**。
 *
 * ## 为什么不换页（2026-09-22 用户要求）
 * 用户原话：「点击地图的任何内容，url 都不需要出现变化……点对应的标签，
 * 放大对应的比例就行了」。换页（`navigate`）会带来两个毛病：
 * 1. **URL 变了** → 刷新还停在那一页，看着像"这一级关不掉"；
 * 2. 换页把"我在哪一级"交给**路由**，而屏幕上铺的内容却由**缩放**决定 —— 两套口径。
 *
 * 所以徽标 / 点位被点，只做一件事：**把镜头挪过去，落到那一级该有的比例**。
 *
 * ## 落点：一个点 + 一档定值（2026-10-28 定稿）
 * | 点的东西 | 停在哪个点（`center`） | 落到多深（`zoom`） |
 * |---|---|---|
 * | 省徽标 | 下辖各市中心的 medoid | `PROVINCE_DRILL_ZOOM`（7） |
 * | 市徽标 | 下辖各区中心的 medoid | `CITY_DRILL_ZOOM`（10.5） |
 * | **区徽标** | **它自己那些景点的 medoid**（一个都没有才用行政框中心） | `DISTRICT_DRILL_ZOOM`（12） |
 *
 * ★★ 2026-10-28 之前这里是"框一片点 → `fitBounds` → 缩放由框反推"。用户否掉了：
 *   「市级标签点击固定缩放到某个比例，其他的也是同理，而不是根据屏幕的尺寸计算」。
 *   反推的后果是同一个标签在手机与桌面上给出两个数（成都 8.73 vs 10.36），
 *   而且窄屏那个数掉到区级揭示线以下 ⇒ **点完屏幕上还是市徽标**（"点了没进去"）。
 *   现在 zoom 与屏幕**完全无关**，三档取值与理由见 `zoomTiers.ts` 的「下钻落点」。
 *
 * ★ 代价：大区（都江堰 / 浦东 / 黄岛这类景点散到 20km 外的）在手机上会切掉边角
 *   —— 全量实测那张表在 `zoomTiers.ts`。**落点一致优先于"每个区刚好兜住自己景点"**，
 *   后者只有 `fit` 给得了，而 `fit` 正是被否掉的那一半。
 *
 * ★★ `center` 一律走 `densestPoint`（medoid）而不是几何中心：点散在四周时几何中心
 *   是**一片空地**。实测最刺眼的一例：重庆渝中 25 个点（24 个挤在半岛 3km 内、
 *   1 个是归错区的"万州烤鱼"，在 93km 外）⇒ 几何中心落在中间的山里 ⇒
 *   镜头停在那儿**一个景点都看不见**；换成 medoid ⇒ 看得见 24 个。
 *   现在落点是定值、不再收缩，但这条同样成立：锚在空地上，那一屏就是空的。
 */

import {
  CITY_DRILL_ZOOM,
  DISTRICT_DRILL_ZOOM,
  PROVINCE_DRILL_ZOOM,
  type LatLngLike,
} from '~/common/map/tencent'

/**
 * 末尾的**行政层级字**。剥掉它才能比较两处写法的同一个区。
 *
 * ★ 顺序敏感：`新区` / `林区` / `特区` / `矿区` 必须排在 `区` 前面，
 *   否则 `浦东新区` 会被剥成 `浦东新`（`String.replace` 只替换一次，
 *   alternation 用**第一个能匹配上的**分支）。
 */
const ADMIN_SUFFIX = /(自治县|自治州|自治区|自治旗|林区|特区|新区|矿区|区|县|市|旗|盟)$/

/**
 * 这个 adcode 是**市**（`510100`）—— 用来决定落入哪一档。
 *
 * ★ 只认"后两位 00 且不是 0000"：
 *   · 省 / 直辖市 / 特别行政区 `510000` / `110000` / `810000` → **不是**：
 *     它们下辖的是"市"或"区"，跨度量级是省，落 `PROVINCE_DRILL_ZOOM`；
 *   · 区 `510104` → **不是**，但区有自己的那一档（`DISTRICT_DRILL_ZOOM`，靠 `boxOf` 认领）。
 * ★ 不用"有没有下级"判 —— 那要等 `childrenOf` 返回才知道，而且省与市都可能为空。
 */
function isCityAdcode(adcode: string): boolean {
  return adcode.endsWith('00') && !adcode.endsWith('0000')
}

/** 剥掉末尾行政层级字；剥空了就退回原串（别让空串参与比较） */
function stripAdminSuffix(s: string): string {
  const out = s.replace(ADMIN_SUFFIX, '')
  return out.length > 0 ? out : s
}

/**
 * 两处写的区名是不是**同一个区** —— 宽容比较（剥掉行政后缀再比）。
 *
 * ## 为什么不能直接 `===`（2026-09-29 用户报「景点在当前展示的地图之外」）
 * 同一个区在两份数据里写法不一样，而这件事**错得非常安静**：
 *
 * | 来源 | 北京 | 上海 | 天津 | 重庆 | 成都 |
 * |------|------|------|------|------|------|
 * | 区划树 / 分片（徽标上的 `name`） | `东城` | `黄浦` | `和平` | `渝中` | `锦江区` |
 * | 点位 `poi.location.district` | `东城` | `黄浦` | `和平` | `渝中` | `锦江区` |
 *
 * ★★ **2026-10-01 起两列已经同源**（`build.reindex_poi_districts` 把**区名**也按几何写回
 *   `location.district`，与分片同源；修前直辖市那一列是采编稿手写的 `东城区`，实测
 *   105 处与徽标数字对不上 —— 用户看到"徽标写 28、点进去 21"）。
 *   但 `sameDistrict()` **必须留着**：
 *     · 它是"两边写法可能漂"的**唯一收口**，而名字匹配本身没有强约束；
 *     · 存量数据与第三方来源都可能再写成 `东城区`；
 *     · 剥后缀的成本是两次字符串操作，出错成本是整条链路静默失效。
 *
 * 4 个直辖市的点位**曾全在这一格上**：`===` 恒 false ⇒ `poisOf` 恒空
 * ⇒ 点区拿不到景点 ⇒ 锚点退回**行政中心**（不是景点）⇒ 镜头停在没景点的空地上。
 * 没有任何报错，表现只是"点了这个区，什么都没看到"。
 *
 * ★ 先短路"原样相等"，不等才剥后缀 —— 避免 `X` 与 `X区` 这类极端串味。
 */
export function sameDistrict(poiDistrict: string | null | undefined, nodeName: string): boolean {
  if (!poiDistrict || !nodeName) return false
  if (poiDistrict === nodeName) return true
  return stripAdminSuffix(poiDistrict) === stripAdminSuffix(nodeName)
}

/** 点这一下要用的数据源 —— 由页面把自己的数据接进来（两个页面的数据源不一样） */
export interface FocusSources {
  /** 「这一级下辖各单位」的中心点。拿不到就给空数组（→ 走下一支） */
  childrenOf: (adcode: string) => LatLngLike[]
  /**
   * 「这一级**自己**」的点位。
   *
   * ★ 两个场景共用一个入口，靠 `adcode` 区分：
   *   · **市**（点市徽标 / 兜底）：该市已收录的全部点位；
   *   · **区**（`boxOf` 认领的那一级）：该区**里面**的景点 —— 按 `name` 在
   *     `poi.location.district` 上筛（构建期按**几何**归区写进去的，见
   *     `build.reindex_poi_districts` —— 它与徽标数字的 `poiCount` **同源**）。
   *   ★★ 筛的时候用 `sameDistrict()`，**不许写 `===`**（理由见它自己的注释：
   *     直辖市的 `东城区` vs `东城` 会让整条链路静默失效）。
   *   拿不到就给空数组。
   */
  poisOf: (adcode: string, name: string) => Promise<LatLngLike[]>
  /**
   * **区**自己的行政外接框 `[minLng, minLat, maxLng, maxLat]`。
   *
   * ★ 只应答**区**（第四级）；省 / 市一律返回 `null`。它现在的职责只有两件：
   *   ① **认出"点的是区"**（据此选 `DISTRICT_DRILL_ZOOM`，并去筛区里的景点）；
   *   ② 该区**一个景点都没有**时的兜底锚点（用框中心）。
   *
   * ★ 以前它还有一个职责"兜底框"（把行政框整个 fit 出来）—— 已随 fit 一起退场。
   */
  boxOf?: (adcode: string) => Promise<[number, number, number, number] | null>
}

/**
 * 这一下点击最后停在哪儿。
 *
 * ★ 只有两件事：**停在哪一点** 与 **落到多深**。前者是数据（medoid / 行政中心），
 *   后者是**定值**（由点的是哪一级决定，与屏幕尺寸无关）。
 *   浮层避让不在这里 —— `shell.focusPoint` 会把 `center` 摆到"扣掉浮层之后"的
 *   那块区域的正中（`panTo.ts`），所以两端、各页、有无浮层都是同一个落点。
 */
export interface FocusTarget {
  /** 镜头停在这个点（它会出现在可视区的正中） */
  center: LatLngLike
  /** 引擎缩放值。**定值**，见 `zoomTiers.ts` 的「下钻落点」 */
  zoom: number
  /**
   * **这一级确实一个点都没有**（不是"还没加载"）。
   *
   * ## 为什么要有这个字段（2026-10-28 用户：「放大到 12 不显示景点，13 甚至 14 也不显示，
   * 不撒点了」）
   * 地图上有一半的区**本来就没有收录景点** —— 成都 20 个区里 11 个是 0
   * （青白江 · 新都 · 温江 · 郫都 · 新津 · 金堂 · 蒲江 · 彭州 · 邛崃 · 崇州 · 简阳）。
   * 徽标上确实写着「0」，但点下去镜头照样飞到该区，屏幕上**一片空白**，
   * 再放大还是空 —— 用户无法区分"这里没收录"和"这东西坏了"。
   *
   * ⇒ 调用方拿到 `empty: true` 时**不要挪镜头**，改成说一句话（`drillTo` 已经这么做了）。
   *   把这层判断放在这里，是因为只有它同时知道 `poiCount` 与筛出来的点位。
   *
   * ★ 判据是**筛出来的点位为空**，不是 `poiCount === 0`：`poiCount` 可能缺失
   *   （通话方没传 / 未收录的区是 `null`），而"筛出 0 个"是事实。
   */
  empty: boolean
}

/**
 * 点这一下该停在哪、落到多深。
 *
 * ## 优先级（与旧版一致，只是产出从"一组点"变成"一个点 + 一档"）
 * **区里自己的景点 → 区的行政框中心 → 下级中心 → 自己的点位 → 徽标中心**
 *
 * ## `zoom` 只由**点的是哪一级**决定
 * 这是这一版的核心：`zoom` 与"数据多不多、屏幕多大"**完全无关**。
 * 数据只影响 `center`（停在哪一点），不影响落多深。这样同一个标签在任何设备上
 * 都是同一个缩放值 —— 这是用户 2026-10-28 的原话要求。
 */
export async function focusPointsFor(
  node: {
    adcode: string
    name?: string
    lng: number
    lat: number
    /**
     * 徽标上写的"这个区有几个景点"。
     *
     * ★ `undefined`（调用方没传）与 `null`（**未收录**，≠ 0）都是"不知道"⇒ 照常筛景点；
     *   **`0` 是确定信息** ⇒ 不去筛（理由见下面那段注释）。
     * ★ 三个徽标入口都能给：城市页 / 省级页 / 首页的 `node` 都是 `DistrictGeoNode`。
     */
    poiCount?: number | null
  },
  src: FocusSources,
): Promise<FocusTarget> {
  const name = node.name ?? ''
  const self: LatLngLike = { lng: node.lng, lat: node.lat }

  // ① 区：停在该区**自己的景点**上，一个都没有才用行政框中心
  const box = await src.boxOf?.(node.adcode)
  if (box) {
    /**
     * ★★ 徽标上说这个区有几个景点，就是几个 —— 取景必须与那句话一致。
     * `poiCount` 来自 `subdistricts/*.json`（`step8` **按几何**归区算出来的）。
     * ★ **2026-10-01 起两边同源了**：`poisOf` 筛的 `poi.location.district` 也是
     *   `build.reindex_poi_districts` **按几何**写回的（修前是采编稿手写的 `dist`，
     *   实测 105 处对不上 ⇒ 出现「徽标写 0 个，点进去却飞到 20km 外的某个景点」）。
     *   那一轮的**防御**仍然留着（`poiCount === 0` 就不筛景点），因为 `poiCount` 是
     *   "屏幕上给用户看的那句话"，口径再打架时按它走 —— 丢景点比飞错地方轻。
     *
     * 实例（2026-09-30 用户：「我点西安未央区，这个区都没有景点，
     * 点了之后直接跳到咸阳的汉景帝陵去了」）：西安「汉景帝阳陵」的稿子写着
     * `dist="未央区"`，几何归区却在**高陵区**（陵园地跨渭城区 / 泾阳县 / 高陵区，
     * 我们有边界的那一段落在高陵）⇒ 未央区徽标 **0**，按名字筛却筛得出这 1 条
     * ⇒ 锚点就是它自己 ⇒ 镜头飞走 20km。
     *
     * ★ 那条数据已经修了（`dist` → `高陵区`），但**判据仍然取 `poiCount`** ——
     *   它是用户看得见的那句话；两套口径再打架时按它走，至少"屏幕上说什么就是什么"。
     */
    const inDistrict = node.poiCount === 0 ? [] : await src.poisOf(node.adcode, name)
    return {
      center: densestPoint(inDistrict) ?? { lng: (box[0] + box[2]) / 2, lat: (box[1] + box[3]) / 2 },
      zoom: DISTRICT_DRILL_ZOOM,
      empty: inDistrict.length === 0,
    }
  }

  // ② 省 / 市：停在下级各单位的 medoid（= 主城密区），落点是该级定值
  const zoom = isCityAdcode(node.adcode) ? CITY_DRILL_ZOOM : PROVINCE_DRILL_ZOOM
  const children = src.childrenOf(node.adcode)
  if (children.length > 0) return { center: densestPoint(children) ?? self, zoom, empty: false }

  const pois = await src.poisOf(node.adcode, name)
  if (pois.length > 0) return { center: densestPoint(pois) ?? self, zoom, empty: false }

  // ③ 兜底：只有徽标中心（未收录、下级数据还没到货都走这里）。
  //    ★ 落点**不跟着退化** —— 仍是该级的定值，否则"点了个还没收录的市"会突然落到别的档。
  return { center: self, zoom, empty: true }
}

/**
 * 「点这一级徽标」的**完整动作** —— 挪镜头，或者在**没有内容时只说一句话**。
 *
 * ## 为什么收成一个函数（而不是四处各写一遍）
 * 四个入口（首页 · 省级页 · 城市页的区图层 · 搜索命中地区）做的是同一件事，
 * 而"没有内容时怎么办"恰恰是最容易漏的一半：漏了它，用户点一个 0 景点的区，
 * 镜头就飞进一片空白（2026-10-28 用户报的正是这个）。
 *
 * ★ `notify` 由调用方注入，**必须**是那条全站唯一的提示通道（`ToastStack`）——
 *   在这里 import UI 会让"逻辑层"反过来依赖展示层。
 */
export function drillTo(
  node: { adcode: string; name?: string; lng: number; lat: number; poiCount?: number | null },
  src: FocusSources,
  shell: { focusPoint: (center: LatLngLike, zoom: number) => void },
  notify: (text: string) => void,
  /** 真的挪镜头**之前**要做的事（城市页用它 `setActive(adcode)`）—— 空区不该被高亮 */
  before?: () => void,
): void {
  void focusPointsFor(node, src).then((t) => {
    if (t.empty) {
      notify(`${node.name || '这一片'}暂无收录景点`)
      return
    }
    before?.()
    shell.focusPoint(t.center, t.zoom)
  })
}

/**
 * 这组点里「最密的那一枚」—— 到其余各点距离之和最小的那个（medoid）。
 *
 * ★ 它是**落点的锚**：镜头停在它身上，而不是停在这组点的几何中心。
 *   两者的差别只在"点散在四周"时暴露，而那时差别就是"看得见"与"看不见"：
 *   重庆渝中 25 个点里，24 个挤在半岛 3km 内、1 个在 93km 外（一条归错区的数据），
 *   几何中心落在中间的山里 ⇒ 一屏**一个景点都看不到**；换成 medoid ⇒ 看到 24 个。
 *
 * ★ 复杂度 O(n²)，n 是**一个区**的景点数（实测最大 43）—— 没必要优化。
 *   换成"网格密度"之类的启发式反而会让"锚点落在哪一枚上"变得不可预测，
 *   而这里要的恰恰是**确定性**：锚点必须是**某一枚真实存在的地点**。
 * ★ 只有一枚点时返回它自己；空数组返回 `undefined`（调用方自己兜底）。
 */
export function densestPoint(points: LatLngLike[]): LatLngLike | undefined {
  if (points.length === 0) return undefined
  if (points.length === 1) return points[0]

  let best = points[0]
  let bestSum = Infinity
  for (const a of points) {
    let sum = 0
    for (const b of points) sum += Math.hypot(a.lng - b.lng, a.lat - b.lat)
    if (sum < bestSum) {
      bestSum = sum
      best = a
    }
  }
  return best
}

/**
 * 从**区**的 adcode 找到它所属的**市**那一行。
 *
 * ★ 判据是 adcode 的**前 4 位**（锦江区 `510104` → 成都市 `510100`）——
 *   adcode 本身就是"省 2 + 市 2 + 区 2"的段式编码，不必按名字猜
 *   （"城关区"这类重名满国都是）。直辖市 / 特别行政区同样成立：它们的省码就是市码。
 * ★ 跳过 `cityId === null` 的行（未收录的市）—— 那种市一个点位都没有，不必去读。
 */
export function parentCityOf<T extends { adcode: string; cityId: string | null }>(
  districtAdcode: string,
  rows: T[],
): T | undefined {
  const seg = districtAdcode.slice(0, 4)
  return rows.find((r) => r.cityId !== null && r.adcode.slice(0, 4) === seg)
}
