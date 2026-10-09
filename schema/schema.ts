/**
 * shared/schema.ts —— 全项目数据契约（Zod · 单一真源）
 *
 * 三条铁律：
 *   1. 此文件与 shared/schema.py 字段一一对应；脚本产出与前端消费共用同一套定义。
 *   2. `data/` 里的每个文件都必须能通过这里的校验，否则视为脏数据。
 *   3. 行程结构（Stay / ItineraryDay）也走 Zod，但**只用于 localStorage 读写校验**，
 *      不参与 data/ 的产出 —— 放同一文件是为了让「与静态数据结构对齐」这件事本身可见。
 */

import { z } from 'zod'

/* ══════════════════════════════════════════════════════════════════
 * 一、两级类型体系：大类（筛选维度） + 细类（颜色维度）
 * ════════════════════════════════════════════════════════════════ */

/** 大类 —— 只承担「筛选」，不决定颜色 */
export const CategoryEnum = z.enum(['scenic', 'food', 'hotspot', 'culture'])
export type Category = z.infer<typeof CategoryEnum>

/**
 * 细类 —— 决定地图 marker 颜色。上限 12 个，别随意加：
 *   34px 的 marker 尺寸下，超过约 12 色人眼就分不清了，加更多只会让图例变成一堵墙。
 *   更细的描述用 `tags` 承载（"夜景""免门票"），不占颜色。
 */
export const SubTypeEnum = z.enum([
  // ── 景点 scenic ──
  'nature', // 自然景观：山水 / 湖泊 / 海滩 / 峡谷
  'museum', // 博物馆 · 美术馆
  'historic', // 古迹 · 古建
  'park', // 公园 · 园林
  'temple', // 宗教场所
  // ── 美食 food ──
  'local', // 本地菜 · 老字号
  'snack', // 小吃 · 夜市
  'cafe', // 咖啡馆 · 茶馆
  // ── 网红打卡 hotspot ──
  'photo', // 拍照机位
  'art', // 艺术区 · 创意园
  // ── 城市特色 culture ──
  'street', // 特色街区
  'performance', // 演出 · 剧场
])
export type SubType = z.infer<typeof SubTypeEnum>

/**
 * 细类展示配置：中文名 + 归属大类 + marker 颜色。
 *
 * 配色原则：**色相相互拉开**，而不是按大类分色系。
 * 同色系的深浅变化在小尺寸 marker 上几乎分辨不出；而"大类"的区分已由筛选器承担，
 * 不需要颜色再重复表达一次。
 *
 * ★ 单一真源：marker 颜色 / 列表徽章 / 图例 三处都从这里取，不许各写一份。
 */
export const SUBTYPE_META: Record<SubType, { label: string; category: Category; color: string }> = {
  nature: { label: '自然景观', category: 'scenic', color: '#3B8C4E' },
  museum: { label: '博物馆', category: 'scenic', color: '#6B5BC7' },
  historic: { label: '古迹古建', category: 'scenic', color: '#8A6A3B' },
  park: { label: '公园园林', category: 'scenic', color: '#2A9D8F' },
  temple: { label: '宗教场所', category: 'scenic', color: '#B4553D' },
  local: { label: '本地菜', category: 'food', color: '#E76F2E' },
  snack: { label: '小吃夜市', category: 'food', color: '#D99B1A' },
  cafe: { label: '咖啡馆', category: 'food', color: '#A9805A' },
  photo: { label: '拍照机位', category: 'hotspot', color: '#D4537E' },
  art: { label: '艺术园区', category: 'hotspot', color: '#9B5FB0' },
  street: { label: '特色街区', category: 'culture', color: '#56707F' },
  performance: { label: '演出剧场', category: 'culture', color: '#A33B6B' },
}

/** 从细类推回大类 —— 校验 subtype 与 category 是否自洽 */
export const SUBTYPE_CATEGORY = Object.fromEntries(
  Object.entries(SUBTYPE_META).map(([k, v]) => [k, v.category]),
) as Record<SubType, Category>

/** 细类的稳定遍历顺序（图例 / 筛选面板都用它，避免各处 Object.keys 顺序不一致） */
export const SUBTYPE_KEYS = Object.keys(SUBTYPE_META) as SubType[]

export const SUBTYPE_LABEL: Record<SubType, string> = Object.fromEntries(
  SUBTYPE_KEYS.map((k) => [k, SUBTYPE_META[k].label]),
) as Record<SubType, string>

/** 大类的展示配置。★ 这里的 color 是**筛选 chip 的主色**，不是 marker 颜色 */
export const CATEGORY_META: Record<
  Category,
  { label: string; desc: string; color: string; subtypes: SubType[] }
> = {
  scenic: {
    label: '旅游景点',
    desc: '自然景观、博物馆、古迹古建、公园园林、宗教场所',
    color: '#2F7BE8',
    subtypes: ['nature', 'museum', 'historic', 'park', 'temple'],
  },
  food: {
    label: '特色美食',
    desc: '本地菜老字号、小吃夜市、咖啡馆茶馆',
    color: '#E8672F',
    subtypes: ['local', 'snack', 'cafe'],
  },
  hotspot: {
    label: '网红打卡',
    desc: '拍照机位、艺术区创意园',
    color: '#E8389B',
    subtypes: ['photo', 'art'],
  },
  culture: {
    label: '城市特色',
    desc: '特色街区、演出剧场',
    color: '#12A67A',
    subtypes: ['street', 'performance'],
  },
}

export const CATEGORY_KEYS: Category[] = ['scenic', 'food', 'hotspot', 'culture']

/* ══════════════════════════════════════════════════════════════════
 * 二、适游群体
 * ════════════════════════════════════════════════════════════════ */

/**
 * 适游群体 —— 回答"这地方适合谁去"。可多选（公园既适合亲子也适合长辈）。
 * ⚠️ 判定依据必须来自来源页面的客观描述，**不允许凭印象打标**；无依据就不显示。
 */
export const AudienceEnum = z.enum([
  'solo', // 独游
  'couple', // 情侣
  'kids', // 亲子
  'friends', // 朋友结伴
  'family', // 家庭出行
  'elders', // 长辈同行
])
export type Audience = z.infer<typeof AudienceEnum>

export const AUDIENCE_META: Record<Audience, { label: string; icon: string }> = {
  solo: { label: '独游', icon: 'user' },
  couple: { label: '情侣', icon: 'heart' },
  kids: { label: '亲子', icon: 'child' },
  friends: { label: '朋友', icon: 'users' },
  family: { label: '家庭', icon: 'home' },
  elders: { label: '长辈', icon: 'elder' },
}
export const AUDIENCE_KEYS = Object.keys(AUDIENCE_META) as Audience[]

/* ══════════════════════════════════════════════════════════════════
 * 三、基础结构
 * ════════════════════════════════════════════════════════════════ */

/**
 * GCJ-02 坐标。
 *
 * ⚠️ 腾讯的 SDK 与 WebService 都用**纬度在前**的写法（`TMap.LatLng(lat, lng)`、
 * `from=lat,lng`），而本字段按 GeoJSON 惯例是 `lng, lat`。
 * 跨边界处必须显式转换 —— 写反了不报错，只是点位跑到地球另一边。
 *
 * 中国经度范围粗筛 73–136、纬度 3–54，用来挡住"经纬度写反"这类脏数据。
 */
export const GeoPointSchema = z.object({
  lng: z.number().min(73, '经度超出中国范围（疑似经纬度写反）').max(136),
  lat: z.number().min(3, '纬度超出中国范围（疑似经纬度写反）').max(54),
  coordSystem: z.literal('GCJ-02'),
})
export type GeoPoint = z.infer<typeof GeoPointSchema>

/** 图片一律外链直链，不下载、不入库二进制（仓库零图片文件） */
export const ImageCreditSchema = z.object({
  source: z.enum(['unsplash', 'pexels', 'baike', 'wikimedia', 'gov-site', 'self', 'other']),
  author: z.string(),
  sourceUrl: z.string().url(),
  license: z.string(), // 'Unsplash License' / 'Pexels License' / 'CC BY-SA 4.0' ...
  /** 需要署名的（CC BY / CC BY-SA / 百度百科）UI **必须**显示可见署名 */
  attributionRequired: z.boolean().default(false),
})
export type ImageCredit = z.infer<typeof ImageCreditSchema>

export const ImageItemSchema = z.object({
  url: z.string().url(),
  thumbUrl: z.string().url().optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** 必须写中文描述，兼顾 a11y 与 SEO */
  alt: z.string().min(2),
  caption: z.string().optional(),
  /** ★ 自愈关键：图挂了，月度巡检用这个关键词自动重搜一张新的 */
  query: z.string().min(2),
  credit: ImageCreditSchema,
})
export type ImageItem = z.infer<typeof ImageItemSchema>

export const SourceRefSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  kind: z.enum(['gov', 'wiki', 'official', 'travel-platform', 'media', 'social']),
  publishedAt: z.string().optional(),
  /** 抓取时间，必填 —— 不做无出处的编造 */
  fetchedAt: z.string(),
})
export type SourceRef = z.infer<typeof SourceRefSchema>

/* ══════════════════════════════════════════════════════════════════
 * 四、POI
 * ════════════════════════════════════════════════════════════════ */

export const PriceLevelEnum = z.enum(['free', 'budget', 'mid', 'high'])

export const PoiPracticalSchema = z
  .object({
    openHours: z.string().optional(),
    /** 字段级溯源：指向 sources 下标。可能被质疑的字段才需要出处 */
    openHoursRef: z.number().int().nonnegative().optional(),
    ticket: z.string().optional(), // '成人 200 元起' —— 必须带"起/约"
    ticketRef: z.number().int().nonnegative().optional(),
    /** 给人看的自然语言 */
    duration: z.string().optional(),
    /**
     * ★ 给机器算的结构化停留时长 [最短, 最长]（分钟）。
     * 与上面的 duration 并存不替换 —— 一个给人看，一个给行程规划算时间。
     * 缺省时的降级链见 DURATION_DEFAULT_MINUTES。
     */
    durationMinutes: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
    bestSeason: z.string().optional(),
    priceLevel: PriceLevelEnum.optional(),
    reservation: z.string().optional(),
    reservationRef: z.number().int().nonnegative().optional(),
  })
  .default({})
export type PoiPractical = z.infer<typeof PoiPracticalSchema>

/**
 * 停留时长的分类默认值（09 文档 4.2 的降级第 ② 级）。
 * 写在契约层而不是组件里 —— 组件不该持有业务默认值。
 */
export const DURATION_DEFAULT_MINUTES: Record<Category, number> = {
  scenic: 120,
  food: 60,
  hotspot: 45,
  culture: 45,
}

export const PoiLocationSchema = z.object({
  point: GeoPointSchema,
  /** ★ 到达点：高德 entr_location（入口坐标）。
   * 仅当"入口距园区中心 > 300m"时才在规划链路使用（见 arrivalOf），
   * 小景点差 200m 不挪，保护锦里类点位。展示类（标记/详情/飞入）一律用 point。 */
  entrance: GeoPointSchema.optional(),
  address: z.string().min(2),
  district: z.string().optional(),
  transportTip: z.string().optional(),
})
export type PoiLocation = z.infer<typeof PoiLocationSchema>

export const PoiSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, 'POI id 只允许小写字母、数字与连字符'),
  name: z.string().min(2),
  category: CategoryEnum,
  /** ★ 细类：决定 marker 颜色，也是地图图例的粒度 */
  subtype: SubTypeEnum,
  summary: z.string().max(80),
  /** 正文 ≥ 80 字 —— 质量门槛，防"页面能跑但内容残缺" */
  description: z.string().min(80),
  highlights: z.array(z.string()).min(2),
  location: PoiLocationSchema,
  practical: PoiPracticalSchema,
  /** ★ 适游群体：至少 1 项 —— 一个都填不出来，说明对这个点位的理解还不够 */
  audience: z.array(AudienceEnum).min(1),
  /** ★ 无障碍友好。**默认 false** —— 未核实就不声称 */
  accessible: z.boolean().default(false),
  tips: z.array(z.string()).default([]),
  /** ★ 允许 0 张（图源覆盖不全时前端渲染占位卡）。与 `schema.py` 同口径，别再加回 `.min(1)` */
  images: z.array(ImageItemSchema).max(8),
  coverIndex: z.number().int().min(0).default(0),
  tags: z.array(z.string()).default([]),
  /**
   * 排序权重（脚本按公开热度信号打分）。
   * ⚠️ 必填：自研标注避让依赖它排序，缺了该点位在低 zoom 下**永远不会显示标注**。
   * 刻意不引入 rating —— 无权威来源的评分是伪数据。
   */
  popularity: z.number().int().min(0).max(100).default(50),
  sources: z.array(SourceRefSchema).min(1),
  updatedAt: z.string(),
  /**
   * ★ 派生字段 —— 所属**区**的 adcode，由 `build` 用「坐标点在区多边形内」判定后写回，
   *   **人手不填**。它是四级下钻里「区 → 景点」这一跳的唯一依据。
   *
   *   `null` = 尚未归区（还没跑过归区的那次 build），不是错误。
   */
  district: z.string().nullable().default(null),
})
export type Poi = z.infer<typeof PoiSchema>

/* ══════════════════════════════════════════════════════════════════
 * 五、通勤矩阵（构建期预计算，运行时零调用读表）
 * ════════════════════════════════════════════════════════════════ */

/** 四种「能进矩阵」的通道里有三种真正预计算（打车复用 driving，公交/地铁不预计算） */
export const MatrixChannelEnum = z.enum(['driving', 'walking', 'bicycling'])
export type MatrixChannelKey = z.infer<typeof MatrixChannelEnum>

/** 六种用户可见的通行方式 */
export const TravelModeEnum = z.enum(['driving', 'taxi', 'transit', 'subway', 'bicycling', 'walking'])
export type TravelMode = z.infer<typeof TravelModeEnum>

/**
 * 公共交通的**偏好**（见 `DayItem.transitPrefer`）：公交优先 / 地铁优先。
 * ★ **没有"均衡"这个值** —— 缺省就是均衡（字段不存在）。
 */
export const TransitPreferEnum = z.enum(['bus', 'subway'])
export type TransitPrefer = z.infer<typeof TransitPreferEnum>

/**
 * ★ 六种出行方式 → 三条矩阵通道的映射（09 文档 3.2.1）。
 *
 * 打车与轿车**走同一条路、时长完全一样**，差别只在费用 —— 所以复用 driving 通道，
 * 矩阵不重复存；打车费在用户点开该段详情时才拉取。
 * 公交/地铁时效性最强且无批量接口 → 刻意不入矩阵，运行时按需算。
 */
export const MATRIX_CHANNEL: Record<TravelMode, MatrixChannelKey | null> = {
  driving: 'driving',
  taxi: 'driving',
  transit: null,
  subway: null,
  bicycling: 'bicycling',
  walking: 'walking',
}

/** 六方式的展示配置。ico 对应内联 SVG sprite 的 id（`i-<ico>`） */
export const MODE_META: Record<
  TravelMode,
  { label: string; ico: string; channel: MatrixChannelKey | null; live: boolean; fare: boolean }
> = {
  driving: { label: '驾车', ico: 'driving', channel: 'driving', live: false, fare: false },
  taxi: { label: '打车', ico: 'taxi', channel: 'driving', live: false, fare: true },
  transit: { label: '公共交通', ico: 'transit', channel: null, live: true, fare: false },
  /**
   * ⚠️ **历史值，不再出现在可选列表里**（2026-10-05 用户：「公交和地铁合并吧，
   * 改成公共交通」）。
   *
   * 保留它的三个理由：
   * ① 老数据的 `modeToNext` 可能存着 `'subway'` —— 从枚举里删掉会让
   *    `RoutePlanSchema.safeParse` 失败、**整条行程被当成坏记录丢掉**；
   * ② `MODE_META` 是 `Record<TravelMode, …>`，少一个键就编译不过；
   * ③ 它得有个标签才能被老行程**显示**出来（用户看到的是"地铁"，而不是空白）。
   *
   * ⇒ 唯一的变化是把它从 `TRAVEL_MODE_KEYS` 里拿掉（于是六方式条不再是六个）。
   *   "公交还是地铁优先"这件事改由 `DayItem.transitPrefer` 表达。
   */
  subway: { label: '地铁', ico: 'subway', channel: null, live: true, fare: false },
  bicycling: { label: '骑行', ico: 'bicycling', channel: 'bicycling', live: false, fare: false },
  walking: { label: '步行', ico: 'walking', channel: 'walking', live: false, fare: false },
}

/**
 * **切换条里能选**的那几个方式。
 *
 * ★ 不是"所有方式"：`subway` 刻意不在里面（已并入 `transit`，见 `MODE_META.subway`）。
 *   UI 一律遍历这个数组 —— 别直接遍历 `MODE_META` 的键，那样会把历史值也画出来。
 */
export const TRAVEL_MODE_KEYS: TravelMode[] = [
  'driving',
  'taxi',
  'transit',
  'bicycling',
  'walking',
]

/**
 * 各方式的直线距离适用上限（米）。超出即写 '0000'。
 * 步行 40 公里、骑行 30 公里这种数据算出来也没用 —— 用户看到「步行 7 小时 52 分钟」
 * 不会获得任何帮助，反而是噪音。
 */
export const MODE_MAX_STRAIGHT_METERS: Record<MatrixChannelKey, number> = {
  driving: 0, // 0 = 不限
  walking: 3000,
  bicycling: 8000,
}

/**
 * 一条矩阵通道：定长 4 位 base36 扁平串，按行优先上三角展开。
 *   idx(i, j) = i × (i − 1) / 2 + j   (i > j)
 *   '0000' = 不适用（超出该方式直线距离上限，或接口无数据）
 * 容量：36⁴ = 1,679,616 —— 距离够用到 1,680 km，时长够用到 466 小时。
 */
export const MatrixChannelSchema = z.object({
  distance: z.string().regex(/^[0-9a-z]*$/, 'base36 只含小写字母与数字'),
  duration: z.string().regex(/^[0-9a-z]*$/, 'base36 只含小写字母与数字'),
  maxStraightMeters: z.number().int().nonnegative(),
})
export type MatrixChannelData = z.infer<typeof MatrixChannelSchema>

export const CityTransitMatrixSchema = z
  .object({
    /**
     * ★ 必填时间戳。驾车时长含实时路况，是"生成时刻的快照"而非恒定量 ——
     * 必须在 UI 上如实标注 `generatedAt` 与采样时段。
     * 一个 9 月生成的矩阵在 12 月被当成"实时路况"展示，就是在误导用户。
     */
    generatedAt: z.string(),
    sampledAtLabel: z.string(), // '工作日上午 · 含路况'
    /** 矩阵的 POI 顺序：与 city.pois 的下标一一对应（顺序也要一致） */
    poiIndex: z.array(z.string()),
    modes: z.object({
      driving: MatrixChannelSchema,
      walking: MatrixChannelSchema,
      bicycling: MatrixChannelSchema,
    }),
  })
  .superRefine((m, ctx) => {
    const n = m.poiIndex.length
    // 上三角格数 × 4 字符 = 字符串应有长度
    const expect = (n * (n - 1)) / 2 * 4

    // poiIndex 不得有重复 id（重复会让下标与 POI 对不上）
    const seen = new Set<string>()
    m.poiIndex.forEach((id, i) => {
      if (seen.has(id)) {
        ctx.addIssue({ code: 'custom', message: `transit.poiIndex 存在重复 id「${id}」(下标 ${i})` })
      }
      seen.add(id)
    })

    for (const key of MatrixChannelEnum.options) {
      const ch = m.modes[key]
      if (ch.distance.length !== expect) {
        ctx.addIssue({
          code: 'custom',
          message: `transit.modes.${key}.distance 长度应为 ${expect}（${n} 个 POI 的上三角 × 4），实为 ${ch.distance.length}`,
        })
      }
      if (ch.duration.length !== expect) {
        ctx.addIssue({
          code: 'custom',
          message: `transit.modes.${key}.duration 长度应为 ${expect}，实为 ${ch.duration.length}`,
        })
      }
    }
  })
export type CityTransitMatrix = z.infer<typeof CityTransitMatrixSchema>

/* ══════════════════════════════════════════════════════════════════
 * 六、城市
 * ════════════════════════════════════════════════════════════════ */

const AdcodeSchema = z.string().regex(/^\d{6}$/, 'adcode 必须是 6 位数字')

export const CityCategorySchema = z.object({
  key: CategoryEnum,
  label: z.string(),
  desc: z.string(),
  icon: z.string(),
  /** 筛选 chip 主色 —— 不是 marker 颜色，两者分开是为了让"大类筛选"与"细类配色"互不干扰 */
  color: z.string(),
  subtypes: z.array(SubTypeEnum),
})

export const CitySchema = z.object({
  /** 破坏性变更时必须配套迁移脚本（scripts/migrations/v1_to_v2.py） */
  schemaVersion: z.number().int().min(1),
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(2),
  province: z.string().min(2),
  /** ★ 与区划树的关联键 —— 下钻靠它把「市的计数」接到这份数据上 */
  adcode: AdcodeSchema,
  provinceAdcode: AdcodeSchema,
  tagline: z.string().max(30),
  intro: z.string().min(150),
  center: GeoPointSchema,
  /** [minLng, minLat, maxLng, maxLat]，用于校验 POI 是否落在市内 */
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  /**
   * 直接喂给 TMap.Map 构造函数（⚠️ 腾讯 center 是 LatLng(lat, lng)，纬度在前）。
   * 腾讯 GL 缩放范围 3~20；城市全貌取 10~12，也正是影像图表现最好的区间。
   */
  defaultZoom: z.number().min(3).max(20).default(11),
  heroImages: z.array(ImageItemSchema).min(1).max(3),
  facts: z
    .object({
      bestSeason: z.string().optional(),
      suggestedDays: z.string().optional(),
      transitTip: z.string().optional(),
      climateTip: z.string().optional(),
    })
    .default({}),
  categories: z.array(CityCategorySchema),
  pois: z.array(PoiSchema).min(1),
  /**
   * ★ 通勤矩阵：构建期预计算，运行时只做 O(1) 查表。
   *
   * **可为 null** —— 矩阵要调腾讯距离矩阵接口（单城约 4,800 计算次数），
   * 配额打满或未跑 step6 时它就是缺失的。一座城市不该因为矩阵没跑完就整城不可用：
   * 缺失时行程页退化为「直线估算 + 实时公交查询」，UI 按「待收录」呈现（红线 10：null ≠ 0）。
   */
  transit: CityTransitMatrixSchema.nullable().default(null),
  credits: z.object({
    imageSources: z.array(z.string()),
    textSources: z.array(z.string()),
    lastUpdated: z.string(),
  }),
  updatedAt: z.string(),
})
export type City = z.infer<typeof CitySchema>

/** 城市索引：只含**已收录**城市。全国 34 个省级单位的完整计数来自 district-tree.json */
export const CityIndexItemSchema = CitySchema.pick({
  id: true,
  name: true,
  province: true,
  tagline: true,
  adcode: true,
  provinceAdcode: true,
}).extend({
  coverImage: z.string(),
  poiCount: z.number().int().nonnegative(),
  updatedAt: z.string(),
})
export type CityIndexItem = z.infer<typeof CityIndexItemSchema>

export const CityIndexSchema = z.array(CityIndexItemSchema)
export type CityIndex = z.infer<typeof CityIndexSchema>

/* ══════════════════════════════════════════════════════════════════
 * 七、区划树（四级下钻的地基：省 → 市 → 区 → 景点）
 * ════════════════════════════════════════════════════════════════ */

/** 区划层级名。★ 前端**按它渲染**，不靠节点在树里的深度 ——
 *   直辖市没有中间的市层（腾讯给 `110100` 返回 0 个下级），它的 `children`
 *   直接标记为 `district`。靠深度判断会得出"北京只有两级"，
 *   那正是这次要消掉的层级不一致。 */
export const DistrictLevelSchema = z.enum(['province', 'city', 'district'])
export type DistrictLevel = z.infer<typeof DistrictLevelSchema>

/**
 * 一个区划节点（**市或区**，靠 `level` 区分）。
 *
 * ⚠️ `cityId === null` 表示**待收录**，UI 必须显示"待收录"而**不是 0**：
 *      null = 我们还没做（进度问题）；0 = 做了但这儿确实没有（内容问题）。
 *      两者混同会让用户以为"这地方没景点"。
 *
 * ★ `children` 递归到区一级：普通省是 市 → 区；直辖市的子节点只有区。
 *   深度不同但语义一致，这是唯一能同时满足「数据自然」与「前端统一」的表达。
 *
 * ⚠️ 第三个泛型参数**必须**是 `unknown`：`level` 与 `children` 都挂了 `.default()`，
 *    zod 推出来的 **input** 类型里这两项是可选的，而手写的 `DistrictCityNode` 是必填 ——
 *    只写 `z.ZodType<DistrictCityNode>`（Input 默认取 Output）会报 TS2322（2026-09-25 修）。
 *    写 `unknown` = 输入侧不设约束，output 侧仍按 `DistrictCityNode` 校验。
 */
export const DistrictCityNodeSchema: z.ZodType<DistrictCityNode, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.object({
    adcode: AdcodeSchema,
    name: z.string(),
    center: z.object({ lng: z.number(), lat: z.number() }),
    level: DistrictLevelSchema.default('city'),
    // ★ `cityId` 必须是**可缺省**的：区分片（`subdistricts/<市adcode>.json`）里的区节点
    //   天生没有它 —— 一个区不存在"对应的城市 slug"。写成必填会让整份分片
    //   `safeParse` 失败，而 `loadSubdistricts` 的失败路径是**静默返回 null**，
    //   表现就是"区这一级永远出不来、控制台干干净净"（2026-09-25 实测踩到）。
    cityId: z.string().nullable().default(null),
    poiCount: z.number().int().nonnegative(),
    children: z.array(DistrictCityNodeSchema).default([]),
  }),
)
export type DistrictCityNode = {
  adcode: string
  name: string
  center: { lng: number; lat: number }
  level: DistrictLevel
  cityId: string | null
  poiCount: number
  children: DistrictCityNode[]
}

/**
 * `data/_generated/subdistricts/<市adcode>.json` —— 一座城市的**区列表**。
 *
 * ## 为什么不把它并进 `district-tree.json`
 * 全国 493 个市 × 约 11 个区 ≈ 5000 个节点，全塞进树里会让树从 55KB 涨到几百 KB，
 * 而首页与省级页只需要两级。**按市分片 + 懒加载**之后，只有真的走进某座城市
 * 才会读它那一份（约 1KB）。
 *
 * 同市的区边界在 `districts/<市adcode>.geo.json`（形状与省级边界文件一致），
 * `loadDistrictBounds()` 不区分省还是市，按 adcode 取即可。
 */
export const SubdistrictFileSchema = z.object({
  adcode: AdcodeSchema,
  name: z.string(),
  level: z.enum(['district']),
  children: z.array(DistrictCityNodeSchema),
  fetchedAt: z.string(),
})
export type SubdistrictFile = z.infer<typeof SubdistrictFileSchema>

export const DistrictProvinceNodeSchema = z.object({
  adcode: AdcodeSchema,
  name: z.string(),
  fullname: z.string(),
  center: z.object({ lng: z.number(), lat: z.number() }),
  level: DistrictLevelSchema.default('province'),
  /** 直辖市 / 港澳台：省节点自身就是那座城市，这里挂它的 cityId */
  cityId: z.string().nullable().default(null),
  /**
   * ★ 省节点**自身就是一座市**（直辖市 / 特别行政区）—— 它的 `children` 直接是区，
   *   中间没有市那一层（腾讯对 110100「市辖区」返回 0 个下级，2026-09-26 实测）。
   *
   * ★ 前端**不许**拿 `cityId` 或 children 的 `level` 去反推这件事：
   *   那两样是"有没有收录"的副产物 —— 天津（未收录）会被判成普通省，
   *   于是它的 16 个区在市级那一档被当成 16 座「待收录市」，
   *   而真正的市徽标（天津本身）一枚都没有。判据必须与收录状态无关，
   *   所以由 `build.py` 按 adcode 段写死在这里，前端只读。
   */
  isCity: z.boolean().default(false),
  /** 该省已收录 POI 总数 */
  poiCount: z.number().int().nonnegative(),
  /** 已收录城市数 —— 与下面 childCount 必须分开 */
  cityCount: z.number().int().nonnegative(),
  /** ★ 区划树上的下辖数量（与内容无关）。UI 表达「已收录 1 / 共 21 个市」 */
  childCount: z.number().int().nonnegative(),
  children: z.array(DistrictCityNodeSchema),
})
export type DistrictProvinceNode = z.infer<typeof DistrictProvinceNodeSchema>

export const DistrictTreeSchema = z.object({
  /** District 数据的 data_version */
  version: z.string(),
  generatedAt: z.string(),
  provinces: z.array(DistrictProvinceNodeSchema),
})
export type DistrictTree = z.infer<typeof DistrictTreeSchema>

/* ══════════════════════════════════════════════════════════════════
 * 七之二、搜索索引（顶栏搜索用；**构建期产出**，见 `pipeline/build.py`）
 * ════════════════════════════════════════════════════════════════ */

/**
 * 搜索索引里的一条**地区**（省 / 市）。
 *
 * ★ 它长得像 `DistrictProvinceNode` / `DistrictCityNode`，但**刻意不是同一份**：
 *   那两棵是给地图徽标用的（层级树 + 边界 + 徽标计数口径），这份是给输入框用的
 *   （扁平、只留"够用来找 + 够用来取景"的字段）。合成一份的代价是：
 *   任何口径变化都会同时影响徽标与搜索结果，而两者的容忍度完全不同。
 */
export const SearchRegionSchema = z.object({
  adcode: AdcodeSchema,
  name: z.string(),
  level: z.enum(['province', 'city']),
  /** 取景用的中心点。为 `null` 时该条不参与"飞过去" */
  lng: z.number().nullable(),
  lat: z.number().nullable(),
  /** 市条目的上级省 adcode；省条目没有（`undefined`，不是 null） */
  provinceAdcode: AdcodeSchema.optional(),
  /**
   * ★ `null` = **待收录**（≠ 0）。
   *   前端据此决定"这一条能不能下钻到点位"，以及要不要显示「待收录」。
   */
  cityId: z.string().nullable(),
  /** 已收录的景点数 —— `null` = 未收录，**不要当 0 用** */
  poiCount: z.number().int().nonnegative().nullable(),
})
export type SearchRegion = z.infer<typeof SearchRegionSchema>

/**
 * 搜索索引里的一条**景点**。
 *
 * ★ 只有"够用来找 + 够用来飞过去"的字段：详情要的封面 / 摘要 / 亮点 / 溯源
 *   一律不在索引里 —— 那些由页面按 `cityId` 去 `loadCity` 拿（命中时只加载**那一座**）。
 */
export const SearchPoiSchema = z.object({
  id: z.string(),
  name: z.string(),
  cityId: z.string(),
  cityName: z.string(),
  lng: z.number(),
  lat: z.number(),
  subtype: SubTypeEnum,
  /** 与名字一起参与匹配（"小吃夜市"、"世界遗产"这类词用户会直接打） */
  tags: z.array(z.string()).default([]),
  /**
   * 结果列表里的缩略图 —— 该点位的**第一张图**。
   * 索引只用来"找"，不值得为它存整份图集；列表里一行一张就够了。
   *
   * ★ 存的是**原始**地址（与 `poi.images[].url` 同源）：镜像由前端
   *   `searchIndex.ts` 的出口统一做（X 项守）。写镜像地址 = 把"换镜像要重跑
   *   整条流水线"这个坑埋回数据里。
   * ★ 可以为 `null`（点位一张图都没有）—— 渲染处必须有占位，不能出破图。
   */
  cover: z.string().nullable().default(null),
})
export type SearchPoi = z.infer<typeof SearchPoiSchema>

export const SearchIndexSchema = z.object({
  version: z.number().int(),
  generatedAt: z.string(),
  regions: z.array(SearchRegionSchema),
  /**
   * **已按热度降序**排好 —— 所以"分数相同"时前端直接沿用文件顺序即可，
   * 索引里不必再存一份 `popularity`（存了就是第二份会漂的副本）。
   */
  pois: z.array(SearchPoiSchema),
})
export type SearchIndex = z.infer<typeof SearchIndexSchema>

/* ══════════════════════════════════════════════════════════════════
 * 八、行程（只存 localStorage，不参与 data/ 产出）
 * ════════════════════════════════════════════════════════════════ */

/** 住宿段：支持中途换住宿 —— 每天归属一个住宿段 */
export const StaySchema = z.object({
  id: z.string(),
  name: z.string(),
  lng: z.number().min(73).max(136),
  lat: z.number().min(3).max(54),
  /** 三路输入：从 POI 选 / 地址搜索（走地理编码）/ 地图点选 */
  source: z.enum(['poi', 'geocoded', 'picked']),
  ref: z.object({ poiId: z.string().optional(), address: z.string().optional() }).optional(),
  /** 归属天数区间（闭区间，从第 1 天计） */
  fromDay: z.number().int().min(1),
  toDay: z.number().int().min(1),
})
export type Stay = z.infer<typeof StaySchema>

export const DayItemSchema = z.object({
  /** 本地唯一：同一 POI 可在同一天出现两次（如两次经过某地） */
  uid: z.string(),
  /**
   * 景点 id。★ **自由取点没有它 → 空串**（与 `ItineraryDay.stayId: ''` 同一个约定）。
   * 刻意不改成 `.optional()`：那会惊动所有读 `item.poiId` 的地方（tsc 一片红），
   * 而"没有"本来就该有一个表示法，空串在这个仓库里已经用了很久。
   */
  poiId: z.string(),
  /** 停留时长（分钟），用户可改 */
  dwellMinutes: z.number().int().min(5),
  /** 到下一站的通行方式。最后一项不需要 */
  modeToNext: TravelModeEnum.optional(),
  /**
   * **公共交通的偏好** —— 「公交优先」还是「地铁优先」。
   *
   * ★ 只在 `modeToNext === 'transit'` 时有意义（其余方式没有"优先"可言）。
   * ★ **缺省 = 均衡**（不偏向任何一方）。刻意不做成三值枚举：
   *   "没有这个字段"本身已经表达了均衡，多一个枚举值只会多出一种
   *   "要说清在哪个语义下没值"的负担（`DayItem.poiId` 那个空串就是反面例子）。
   * ★ 它**不是** `TravelMode`：方式回答"坐什么"，偏好回答"更想要哪一种" ——
   *   合成一个维度的话，`公交 + 地铁优先` 这种组合就没法表达了。
   */
  transitPrefer: TransitPreferEnum.optional(),  note: z.string().optional(),

  /* ── 以下五项：**这一站自己带着坐标**（2026-09-25 加，见 plans/13 §3.2）──────
   * 全部 optional ⇒ 老数据（只有 `poiId`）依然合法，迁移不用写转换代码。
   *
   * ★ 为什么坐标要在行程里**冗余存一份**（坐标本来能从 poiId 查）：
   *   ① 自由取点**没有 poiId**，坐标无处可查 —— 这是直接原因；
   *   ② 画点 / 算路不该为了一个坐标去 `loadCity`（跨城时更是这样）；
   *   ③ 顺带治一个既有隐患：城市数据重建后 poiId 变了，只存 poiId 的行程会**静默丢点**。 */
  /** 落点类型。**缺省 = `poi`** —— 老数据没有这个字段，别当 `point` 处理 */
  kind: z.enum(['poi', 'point']).optional(),
  /** 显示名。自由取点必须有（没有 poiId 就查不到名字） */
  name: z.string().optional(),
  lng: z.number().min(73).max(136).optional(),
  lat: z.number().min(3).max(54).optional(),
  /** 归属城市。自由取点落在两城之间时可能缺省；跨城规划预留（本轮不做跨城） */
  cityId: z.string().optional(),
})
export type DayItem = z.infer<typeof DayItemSchema>

export const ItineraryDaySchema = z.object({
  /** ★ 归属某个住宿段 —— 支持"前几天住 A 区、后几天住 B 区" */
  stayId: z.string(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  /** ★ 有序列表：**数组下标即真实顺序**，没有单独的 order 字段（少一个可能不一致的来源） */
  items: z.array(DayItemSchema),
})
export type ItineraryDay = z.infer<typeof ItineraryDaySchema>

/** 导出的行程文件 / 分享链接载荷 */
export const ItineraryExportSchema = z.object({
  v: z.literal(1),
  cityId: z.string(),
  stays: z.array(StaySchema),
  days: z.array(ItineraryDaySchema),
  exportedAt: z.string(),
})
export type ItineraryExport = z.infer<typeof ItineraryExportSchema>

/* ────────────────────────────────────────────────
 * 路线规划记录（plans/13）
 * ────────────────────────────────────────────── */

/**
 * 折线上的一个坐标。
 *
 * ★ 刻意**不复用 `GeoPointSchema`**：那个带了 `coordSystem: 'GCJ-02'` 字面量 ——
 *   对数据文件（一个点位一条）是必要的自证，对一条 **500~2000 点**的折线
 *   就是纯浪费（每个点多 20 字节，一条路线凭空胖 40KB）。
 *   而折线坐标**必然**是 GCJ-02：它直接来自腾讯路线的 `polyline`，没有第二种可能。
 */
export const MapPointSchema = z.object({
  lng: z.number().min(73).max(136),
  lat: z.number().min(3).max(54),
})
export type MapPoint = z.infer<typeof MapPointSchema>

/**
 * 已经算好的一条整条路线（**落盘缓存**）。
 *
 * ★ 落盘的判据是「**这一项会不会变**」：
 *   几何（`path`）不会变 —— 同样的起终点，路网不变则折线不变；
 *   实时耗时**会变**（拥堵十分钟一轮），所以**不落盘** ——
 *   落下来就是骗人。这就是必须有 `at`（计算时刻）的原因：UI 要显示它、
 *   要给「重新规划」，过期时如实说明（plans/13 §2.2 的三条约束）。
 */
export const PlanRouteSchema = z.object({
  /** 计算时刻（毫秒）。★ 用户看的「这条路是几点算的」 */
  at: z.number(),
  /** 解压后的整条折线（`itinerary/polyline.ts` 的产物） */
  path: z.array(MapPointSchema),
  /** 米 */
  distance: z.number(),
  /** 秒 */
  duration: z.number(),
  taxiFare: z.number().optional(),
  /** 逐段折线。有它才能给某一段单独描色 / 单独重算；没算过分段就是缺省 */
  legs: z
    .array(
      z.object({
        /** 段起点 / 终点的 `DayItem.uid` —— 用 uid 而不是下标，换序后依然对得上 */
        fromUid: z.string(),
        toUid: z.string(),
        distance: z.number(),
        duration: z.number(),
        path: z.array(MapPointSchema),
      }),
    )
    .optional(),
  /** 降级说明（直线估算 / 只取到一条 / 超 15 途经点已分段拼）。**有它 UI 必须显示** */
  note: z.string().optional(),
})
export type PlanRoute = z.infer<typeof PlanRouteSchema>

/**
 * 一份规划记录 = **一份行程**（plans/13 §3.4）。
 *
 * ## ★ 用户界面里它叫「**组**」
 * 2026-09-26 用户定的说法：「先有一个**组**，然后再是**规划明细**」。
 * | 用户说的 | 代码里 |
 * |---------|--------|
 * | 组 | 本类型（`RoutePlan`）—— 一个容器，属于一座城市 |
 * | 规划明细 | 它的 `days[].items`（`DayItem`）—— 组里的一条条行程 |
 *
 * 所以界面上凡是这个实体出现的地方都写「组」（新建组 / 加到哪个组 / 组名称），
 * 而 `days[].items` 一律叫「规划明细」。**代码标识符保持 `RoutePlan` / `DayItem` 不变** ——
 * 改名会牵动 schema 双生、IndexedDB 里已存的数据、以及三个调用方，
 * 换来的只是"名字更像"，不划算；这条注释就是两者之间的桥。
 *
 * ★ 容器从「一城一份」变成「**一份全局列表，每条带自己的 `cityId`**」：
 *   入口按钮挂在顶栏（任意页可见 —— 首页是"全国"，那里没有"当前城市"），
 *   而且用户完全可能同时在排成都和重庆的两条线。
 *   但**一条规划仍然只属于一座城市**：时间链要靠该城的通勤矩阵算，
 *   住宿段也是城内锚点（跨城本轮不做）。
 *
 * ★ **没有 `stops` 字段**（与 plans/13 §3.2 的初稿不同，理由记在 §3.2 的修订说明里）：
 *   途经点序列由 `days[].items` **按天序摊平**得到，不另存一份 ——
 *   存两份就必须在每次换序时同步两处，而"双源不一致"是本项目吃过最多的亏。
 */
export const RoutePlanSchema = z.object({
  id: z.string(),
  /** 默认「未命名规划」，可改 */
  name: z.string(),
  /** ★ 属于哪座城市。打开一条规划 = 切到该城地图 + `loadCity` 该城数据 */
  cityId: z.string(),
  createdAt: z.number(),
  /** ★ 记录列表按它倒序 = 用户说的「按最近规划时间排序」 */
  updatedAt: z.number(),
  /** 整条统一的通行方式；逐段覆盖仍看 `DayItem.modeToNext` */
  mode: TravelModeEnum,
  /**
   * 逐段选中的备选方案（`DayItem.uid` → `'A'` / `'B'` / `'C'`）。
   *
   * ★ 这不是"结果"而是**用户意图** —— 备选路线本身可以随时重拉，
   *   但"我选的是 B 不是最快的那条"是用户做的决定，丢了就是丢了。
   *   旧行程里它叫 `chosenOption`，迁移时原样带过来（§3.2 初稿漏了它）。
   */
  chosenOption: z.record(z.string(), z.string()),
  stays: z.array(StaySchema),
  /** ★ 有序：**天序 × 每天的 items 顺序**就是途经点顺序，没有单独的 order 字段 */
  days: z.array(ItineraryDaySchema),
  /** 算过才有；没算过 / 算失败 = `null`（不是空对象 —— 空对象骗得过 `if`） */
  route: PlanRouteSchema.nullable(),
})
export type RoutePlan = z.infer<typeof RoutePlanSchema>

/** 一次读一批（IndexedDB 的 `getAll()` 返回它）。逐条 `safeParse`，坏记录只丢自己不拖累全表 */
export const RoutePlanListSchema = z.array(RoutePlanSchema)

/** 分享链接载荷：紧凑字段名，只为压体积。★ 住宿点默认脱敏，不带名称 */
export const ItineraryShareSchema = z.object({
  c: z.string(), // cityId
  s: z.array(
    z.object({
      i: z.string(), // stay id
      /** 脱敏后的显示名（默认「住宿点」，用户主动选择带名称时才写真实名） */
      n: z.string(),
      lng: z.number(),
      lat: z.number(),
      f: z.number().int().min(1), // fromDay
      t: z.number().int().min(1), // toDay
    }),
  ),
  d: z.array(
    z.object({
      s: z.string(), // stayId
      st: z.string(), // startTime
      i: z.array(
        z.object({
          u: z.string(), // uid
          p: z.string(), // poiId
          w: z.number().int().min(5), // dwellMinutes
          m: TravelModeEnum.optional(),
        }),
      ),
    }),
  ),
})
export type ItineraryShare = z.infer<typeof ItineraryShareSchema>

/* ══════════════════════════════════════════════════════════════════
 * 九、校验入口
 * ════════════════════════════════════════════════════════════════ */

export class DataContractError extends Error {
  constructor(message: string, readonly detail?: unknown) {
    super(message)
    this.name = 'DataContractError'
  }
}

/**
 * 严格校验（开发期用）：脏数据直接抛错，避免"页面能跑但内容残缺"。
 * 生产环境请用 safeParseCity + 降级提示。
 */
export function parseCity(raw: unknown): City {
  const r = CitySchema.safeParse(raw)
  if (!r.success) {
    const head = r.error.issues
      .slice(0, 8)
      .map((i) => `  · ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')
    throw new DataContractError(`城市数据未通过 Schema 校验（共 ${r.error.issues.length} 处）:\n${head}`, r.error)
  }
  return r.data
}

export function safeParseCity(raw: unknown) {
  return CitySchema.safeParse(raw)
}

/** 类型一致性校验：subtype 必须归属其 category（不一致即配置错误，阻断入库） */
export function assertSubtypeCategory(poi: Pick<Poi, 'id' | 'category' | 'subtype'>): void {
  const expect = SUBTYPE_CATEGORY[poi.subtype]
  if (expect !== poi.category) {
    throw new DataContractError(
      `POI「${poi.id}」类型不一致：subtype=${poi.subtype} 应属 ${expect}，但 category=${poi.category}`,
    )
  }
}

export const SCHEMA_VERSION = 1
