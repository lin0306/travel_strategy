/**
 * 「点徽标 = 放大到对应的比例」—— 下钻靠缩放，**不靠换页**。
 *
 * ## 为什么不换页（2026-09-22 用户要求）
 * 用户原话：「点击地图的任何内容，url 都不需要出现变化……点对应的标签，
 * 放大对应的比例就行了」。换页（`navigate`）会带来两个毛病：
 * 1. **URL 变了** → 刷新还停在那一页，看着像"这一级关不掉"；
 * 2. 换页把"我在哪一级"交给**路由**，而屏幕上铺的内容却由**缩放**决定 —— 两套口径。
 *    （2026-09-20 起本项目已经定成"揭示不换路由"，徽标点击却还在换页，是自相矛盾的。）
 *
 * 所以徽标 / 点位被点，只做一件事：**把那一片框进视野**。
 *
 * ## 框什么才叫"对应的比例"
 * | 点的东西 | 框它什么 | 得到的比例 |
 * |---|---|---|
 * | 省徽标 | **下辖各市的中心** | ≈ 省级页的取景（一省铺满视野） |
 * | 市徽标（已收录） | **下辖各区的中心** | ≈ 城市页的取景（一座城铺满视野） |
 * | 市徽标（未收录） | 只有中心点 → 用一个近似的市域方块 | ≈ 城市尺度 |
 * | **区徽标** | **它自己点进去的那些景点**（一个都没有才退回行政外接框） | ≈ 街区尺度（点位接力上场） |
 * | 点位（单个） | **它自己** | ≈ 街区尺度 |
 *
 * ★ 前两行不只是"差不多"：它们**复用对应页面自己的取景口径** ——
 *   于是"点徽标"和"进那一页"看到的画面是同一个，区别只是 URL 不动。
 *
 * ★★ 第四行在 2026-09-29 改过一次，改的是**框什么**与**落多深**（两件事，
 *   原来都做错了，见 `FocusTarget.minZoom` 与 `sameDistrict` 的注释）。
 *   一句话概括现在的取舍：**先保证这个区的景点都在屏内，再谈放多大。**
 */

import { POI_ADMIT_MIN_ZOOM, type LatLngLike } from '~/common/map/tencent'

/**
 * 没有范围数据时用的**近似市域跨度**（度）。
 *
 * 只有"待收录的市"会走到这里 —— 我们手里只有它的中心点，没有任何范围几何。
 * 取 0.5°（≈55km）是地级市的量级。等有了边界数据，这一支应该换成实际范围
 * （`data/_generated/districts/*.geo.json` 里目前只有四川有）。
 */
const APPROX_CITY_SPAN = 0.5

/**
 * 末尾的**行政层级字**。剥掉它才能比较两处写法的同一个区。
 *
 * ★ 顺序敏感：`新区` / `林区` / `特区` / `矿区` 必须排在 `区` 前面，
 *   否则 `浦东新区` 会被剥成 `浦东新`（`String.replace` 只替换一次，
 *   alternation 用**第一个能匹配上的**分支）。
 */
const ADMIN_SUFFIX = /(自治县|自治州|自治区|自治旗|林区|特区|新区|矿区|区|县|市|旗|盟)$/

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
 *   下面那段历史仍然成立 —— 它解释了**为什么当初不得不用宽容比较**。
 *
 * 4 个直辖市的点位**曾全在这一格上**：`===` 恒 false ⇒ `poisOf` 恒空
 * ⇒ 点区掉进"行政框"那一支（锚点是**行政中心**，不是景点）⇒ 景点落在屏幕外。
 * 没有任何报错，表现只是"点了这个区，什么都没看到"。
 *
 * ★ 先短路"原样相等"，不等才剥后缀 —— 避免 `X` 与 `X区` 这类极端串味。
 */
export function sameDistrict(poiDistrict: string | null | undefined, nodeName: string): boolean {
  if (!poiDistrict || !nodeName) return false
  if (poiDistrict === nodeName) return true
  return stripAdminSuffix(poiDistrict) === stripAdminSuffix(nodeName)
}

/** 本轮要框的东西 —— 由页面把自己的数据接进来（两个页面的数据源不一样） */
export interface FocusSources {
  /** 「这一级下辖各单位」的中心点。拿不到就给空数组（→ 走下一级） */
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
   * ★ 只应答**区**（第四级）；省 / 市一律返回 `null`，让它们继续走 `childrenOf`。
   *   没有它的时候，点区会一路掉到最底下那个"近似方块"兜底 —— 那是个**市**的量级
   *   （0.5°≈55km），于是"点一个区"的镜头反而**往外退**：这正是 2026-09-26 用户报的
   *   「区的放大等级不对，怎么还缩小地图了」。
   *
   * ★ 它现在的职责只剩**两件**：① 认出"点的是区"（据此启用景点框）；
   *   ② 该区**一个景点都没有**时的兜底框。
   */
  boxOf?: (adcode: string) => Promise<[number, number, number, number] | null>
}

/**
 * 这一下点击要取景到的地方。
 *
 * ★ 为什么带 `minZoom` 而不是只回一组点：区的外接框**常常比景点级还大**
 *   （广州从化区跨 0.8°，框住它 ≈ z10.4），只 fit 全区的话"点这个区"停在区级，
 *   用户眼里就是没反应。
 */
export interface FocusTarget {
  points: LatLngLike[]
  /**
   * 落点**至少**到这一级。只有"点的是区"时才带。
   *
   * ## 为什么它是"点位层真的会铺"的那一档（`POI_ADMIT_MIN_ZOOM`）
   * 这个数**不是**"哪个档更好看"，是一条**硬约束**：低于它，点位层根本不铺
   * （`poiTierForZoom` 判 `zoom < POI_ADMIT_MIN_ZOOM → admitsPoints: false`），
   * 屏幕上只剩区徽标 —— 点区等于什么都没发生。所以它是**地板**，不是目标。
   *
   * ## ★★ 也别再往上抬（那是这个 bug 的前半段）
   * 用户原话（2026-09-29）：「有些区可能就一个景点，放大后我都不知道景点在哪，
   * **景点在当前展示的地图之外**」。
   *
   * 上一版这里钉的是 14（"气泡散开的拐点"，`_tmp/cdp_zoompick.mjs` 实测），
   * 结果（`_tmp/sim_district_focus.py` 复刻整条链路跑 17 城全量）：
   *
   * | 落点 | 会丢景点的区 | 丢的景点 |
   * |------|-------------|---------|
   * | 14 | 54 个 | 353 个（占 49%） |
   * | 12 | 14 个 | 23 个 |
   * | **11.5** | **4 个** | **7 个（1%）** |
   *
   * 根因在 `shrinkForMinZoom`：**以锚点为中心、把跨度缩到 minZoom 对应的跨度**。
   * 框（= 景点自己）跨 20km 时被缩到 14 对应的 ≈11km ⇒ 必然有景点被挤出屏幕。
   *
   * ★★ 关键认识：**`minZoom` 只在"框装不下"时才生效**（装得下就原样 fit）。
   *   所以把它调高，调不出"更清楚"，只调出"更看不全"。
   *   "看得清"该靠**框得准**（框景点自己）+ **锚得准**（见 `anchor`），不是靠钉高落点。
   */
  minZoom?: number
  /**
   * 收缩时的**锚点** —— 视野钉在哪一点上。
   *
   * ## 为什么需要它（同一轮用户反馈的后半段）
   * `shrinkForMinZoom` 默认以框的**几何中心**为中心。而"景点散在四周"时，
   * 几何中心往往落在**一片空地上** —— 收缩之后屏幕上可能一个景点都没有。
   * 实测里最刺眼的一例：重庆渝中 25 个点（其中 24 个挤在半岛 3km 内、
   * 1 个是归错区的"万州烤鱼"，在 93km 外）⇒ 几何中心落在中间的山里 ⇒
   * 收缩到 12 后**看得见 0 个**；换成 medoid 锚点 ⇒ 看得见 24 个。
   *
   * ★ 所以"区里有景点"时给 medoid（离其余景点最近的那一枚，见 `densestPoint`）。
   *   不给（省 / 市 / 退回行政框）时维持几何中心 —— 那时屏幕上本来就没有
   *   "我们自己的景点"需要照顾。
   */
  anchor?: LatLngLike
}

/** 徽标要框的那一片。**优先级：区里自己的景点 → 区自己的行政框 → 下级中心 → 自己的点位 → 只有中心（近似方块）** */
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

  // ① 区：优先框**这个区里面的景点**，没有才退回它的行政外接框
  const box = await src.boxOf?.(node.adcode)
  if (box) {
    /**
     * ★★ 区里**有景点**时框那些景点，而不是整个区的行政框。
     *
     * 为什么（2026-09-29 实测）：行政框常常跨半个纬度（都江堰、广州从化），
     * 把它 fit 出来 ≈ z10.5；而落点一旦被钉住，`zoomSpan.shrinkToMinZoom`
     * 就会以**框中心**为锚收缩，而**景点往往不在框中心**（都江堰的 4 个点在西北的景区里）。
     * 实测（`_tmp/cdp_districtclick.mjs` 点都江堰）：落点确实到了目标档，
     * 但屏幕上**一个点位都没有**（日志读数"点 0"）—— 比原来停在 12 看到气泡还糟。
     *
     * ⇒ 点区的本意是"看这个区的景点"，那就拿景点来框：一定框得住，也一定看得见。
     *
     * ★★ 落点只钉 `POI_ADMIT_MIN_ZOOM`（地板），**不钉更高的档** —— 理由与那张实测表
     *   见 `FocusTarget.minZoom`。把框换成景点之后，"落多深"这件事已经由
     *   **景点自己的跨度**回答了：紧凑的区自然落到 15+，不需要我们再插一脚；
     *   而我们插的那一脚（钉 14）恰恰只在"会丢景点"的区上生效。
     *
     * ★★ 锚点必须给 `densestPoint` 而不是让 `shrinkForMinZoom` 用框几何中心 ——
     *   点散在四周时几何中心是空地，收缩之后一个景点都看不见（见 `FocusTarget.anchor`）。
     *
     * ★★ **徽标上说这个区有几个景点，就是几个** —— 取景必须与那句话一致。
     *
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
     * ⇒ 框住它 + 锚点就是它自己 ⇒ 镜头飞走。
     *
     * ★ 那条数据已经修了（`dist` → `高陵区`），但**判据仍然取 `poiCount`** ——
     *   它是用户看得见的那句话；两套口径再打架时按它走，至少"屏幕上说什么就是什么"。
     * ★ 代价是 `poiCount` 过期时（写 0、其实新增了景点）会退回行政框 —— 但那些景点
     *   就在这个区里，退回行政框照样看得见。**丢景点比飞错地方轻。**
     */
    const inDistrict = node.poiCount === 0 ? [] : await src.poisOf(node.adcode, name)
    if (inDistrict.length > 0) {
      return {
        points: inDistrict,
        minZoom: POI_ADMIT_MIN_ZOOM,
        anchor: densestPoint(inDistrict),
      }
    }
    /**
     * 这个区一个景点都没有 → 退回行政框。此时"看得见景点"无从谈起，
     * 钉地板只是为了让点位层别在这一屏缺席（旁边区的景点可能已经进了视野）。
     * ★ 不给 `anchor`：行政框的中心就该是它的几何中心。
     */
    return {
      points: [
        { lng: box[0], lat: box[1] },
        { lng: box[2], lat: box[3] },
      ],
      minZoom: POI_ADMIT_MIN_ZOOM,
    }
  }

  const children = src.childrenOf(node.adcode)
  if (children.length > 0) return { points: children }

  const pois = await src.poisOf(node.adcode, name)
  if (pois.length > 0) return { points: pois }

  // 兜底：只有中心点，自己造一个近似的市域方块（`fit` 对零面积范围会退化成街区级，太深了）
  const d = APPROX_CITY_SPAN / 2
  return {
    points: [
      { lng: node.lng - d, lat: node.lat - d },
      { lng: node.lng + d, lat: node.lat + d },
    ],
  }
}

/**
 * 这组点里「最密的那一枚」—— 到其余各点距离之和最小的那个（medoid）。
 *
 * ★ 它是**取景的锚点**：收缩框时把视野钉在它身上，而不是钉在框的几何中心。
 *   两者的差别只在"点散在四周"时暴露，而那时差别就是"看得见"与"看不见"：
 *   重庆渝中 25 个点里，24 个挤在半岛 3km 内、1 个在 93km 外（一条归错区的数据），
 *   几何中心落在中间的山里 ⇒ 收缩后**一个景点都看不到**；换成 medoid ⇒ 看到 24 个。
 *
 * ★ 复杂度 O(n²)，n 是**一个区**的景点数（实测最大 43）—— 没必要优化。
 *   换成"网格密度"之类的启发式反而会让"中心落在哪一枚上"变得不可预测，
 *   而这里要的恰恰是**确定性**：锚点必须是**某一枚真实存在的景点**。
 * ★ 只有一枚点时返回它自己（零面积范围由 `boundsOf` 的兜底跨度处理）。
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
