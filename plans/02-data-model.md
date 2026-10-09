# 02 · 数据模型设计

## 一、设计原则

1. **单一真源**：`shared/schema.ts`（Zod）与 `shared/schema.py`（Pydantic）字段一一对应，脚本产出、前端消费共用同一套定义，改一处两边都要同步（CI 里跑一次 diff 检查）。
2. **扁平 POI 模型 + 两级类型**：景点 / 美食 / 网红 / 特色共用一套 `Poi`，用 `category` 区分**大类**（筛选维度），用 `subtype` 区分**细类**（颜色维度）。避免四张表四套 UI 逻辑，同时让地图上的点位有足够的视觉区分度。
3. **可溯源**：每个 POI 必须带 `sources[]`（来源 URL + 抓取日期 + 来源类型），UI 底部展示，防止内容无出处。
4. **可懒加载**：城市索引与城市详情分离，详情按需 `import()`。
5. **纯文本化**：仓库里**只存文本**——数据全是 JSON，图片全是外链 URL 字符串，零二进制文件。
6. **数据独立**：所有内容放在顶层 `data/` 目录，与 `src/` 解耦；新增城市只加文件不改代码。
7. **把计算搬进构建期**：能预计算的绝不放到运行时。通勤矩阵与行政区划聚合都是这条原则的直接产物 —— 把「46×46 种通勤组合」和「全国区划计数」在构建期算完固化，运行时只做 O(1) 查表。**整个行程规划与三级下钻因此不需要任何后端**（见 09 文档第三节、10 文档第四节）。
8. **分清"仓库数据"与"用户产物"**：前者进 `data/` 受版本管理，后者只存 `localStorage`。详见 4·B 节。

---

## 二、类型定义（TypeScript / Zod）

```ts
// shared/schema.ts

/** ★ 大类（category）—— 筛选维度。四类内容共用一个数组，四类各有一套语义 */
export const CategoryEnum = z.enum(['scenic', 'food', 'hotspot', 'culture']);
export type Category = z.infer<typeof CategoryEnum>;

/**
 * ★ 细类（subtype）—— 颜色维度。地图上 marker 的颜色由它决定。
 *
 * 设计约束（很重要，别随意加）：
 *   1. **细类只有 12 个**。34px 的 marker 尺寸下，超过 ~12 种颜色人眼就分不清了，
 *      加更多细类不会提升可读性，只会让图例变成一堵墙。
 *   2. **更细的描述用 `tags` 承载**（如"夜景""免门票""雨天可去"），不占颜色。
 *   3. **每个细类必须归属且只归属一个大类**（见 SUBTYPE_CATEGORY 映射），
 *      这样"选了景点大类"能正确推导出"该显示哪些颜色的点"。
 */
export const SubTypeEnum = z.enum([
  // ── 景点 scenic ──────────────────────────────
  'nature',      // 自然景观：山水 / 湖泊 / 海滩 / 峡谷
  'museum',      // 博物馆 · 美术馆
  'historic',    // 古迹 · 古建
  'park',        // 公园 · 园林
  'temple',      // 宗教场所
  // ── 美食 food ────────────────────────────────
  'local',       // 本地菜 · 老字号
  'snack',       // 小吃 · 夜市
  'cafe',        // 咖啡馆 · 茶馆
  // ── 网红打卡 hotspot ─────────────────────────
  'photo',       // 拍照机位
  'art',         // 艺术区 · 创意园
  // ── 城市特色 culture ─────────────────────────
  'street',      // 特色街区
  'performance', // 演出 · 剧场
]);
export type SubType = z.infer<typeof SubTypeEnum>;

/**
 * ★ 细类的展示配置：中文名 + marker 颜色
 *
 * 配色原则：**色相相互拉开**，而不是按大类分色系。
 * 理由：地图上同色系的深浅变化在缩放后极难分辨（浅蓝 vs 中蓝在小尺寸 marker 上几乎一样），
 * 而"大类"的区分已经由筛选器承担，不需要颜色再重复表达一次。
 */
export const SUBTYPE_META: Record<SubType, { label: string; category: Category; color: string }> = {
  nature:      { label: '自然景观',   category: 'scenic',  color: '#3B8C4E' },
  museum:      { label: '博物馆',     category: 'scenic',  color: '#6B5BC7' },
  historic:    { label: '古迹古建',   category: 'scenic',  color: '#8A6A3B' },
  park:        { label: '公园园林',   category: 'scenic',  color: '#2A9D8F' },
  temple:      { label: '宗教场所',   category: 'scenic',  color: '#B4553D' },
  local:       { label: '本地菜',     category: 'food',    color: '#E76F2E' },
  snack:       { label: '小吃夜市',   category: 'food',    color: '#D99B1A' },
  cafe:        { label: '咖啡馆',     category: 'food',    color: '#A9805A' },
  photo:       { label: '拍照机位',   category: 'hotspot', color: '#D4537E' },
  art:         { label: '艺术园区',   category: 'hotspot', color: '#9B5FB0' },
  street:      { label: '特色街区',   category: 'culture', color: '#56707F' },
  performance: { label: '演出剧场',   category: 'culture', color: '#A33B6B' },
};

/** 从细类推回大类（校验用：保证 subtype 与 category 一致） */
export const SUBTYPE_CATEGORY = Object.fromEntries(
  Object.entries(SUBTYPE_META).map(([k, v]) => [k, v.category]),
) as Record<SubType, Category>;

/**
 * ★ 适游群体（audience）—— 回答"这地方适合谁去"
 *
 * 可多选：一个点位常常同时适合多类人群（如公园既适合亲子也适合长辈）。
 * 判定依据必须来自来源页面的客观描述（如"适合带孩子""台阶较多"），
 * **不允许凭印象打标**（见质量红线）。
 */
export const AudienceEnum = z.enum([
  'solo',     // 独游
  'couple',   // 情侣
  'kids',     // 亲子
  'friends',  // 朋友结伴
  'family',   // 家庭出行
  'elders',   // 长辈同行
]);
export type Audience = z.infer<typeof AudienceEnum>;

/** GCJ-02 坐标（与腾讯底图一致，禁止混用 WGS-84 / BD-09）
    ⚠️ 腾讯的 SDK 与 WebService 都使用 **纬度在前** 的写法（`TMap.LatLng(lat, lng)`），
    而本字段按 GeoJSON 惯例是 `lng, lat`。跨边界处必须显式转换（见 03 文档第一节） */
export const GeoPointSchema = z.object({
  lng: z.number().min(73).max(136),          // 中国经度范围粗筛
  lat: z.number().min(3).max(54),
  coordSystem: z.literal('GCJ-02'),
});

/** 图片一律用外链直链，不下载、不入库二进制 */
export const ImageItemSchema = z.object({
  url: z.string().url(),                      // 大图：images.unsplash.com / images.pexels.com
  thumbUrl: z.string().url().optional(),      // 列表缩略图（改宽度参数即可）
  width: z.number(),
  height: z.number(),
  alt: z.string().min(2),                     // 必须写中文描述，兼顾 a11y 与 SEO
  caption: z.string().optional(),
  /** ★ 自愈关键：图挂了，巡检脚本用这个关键词自动重搜一张新的 */
  query: z.string().min(2),                   // 如 'Hangzhou West Lake bridge'
  /** 版权溯源：四字段缺一不可，外链同样要署名 */
  credit: z.object({
    source: z.enum(['unsplash', 'pexels', 'baike', 'wikimedia', 'gov-site', 'self', 'other']),
    author: z.string(),
    sourceUrl: z.string().url(),
    license: z.string(),                      // 'Unsplash License' / 'Pexels License' / 'CC BY-SA 4.0' ...
    /** 需要署名的（CC BY / CC BY-SA）UI 必须显示可见署名 */
    attributionRequired: z.boolean().default(false),
  }),
  // 注意：图片健康状态（status / checkedAt）**不写回这里**。
  // 月度巡检结果单独落到 data/_generated/image-health.json，避免每月变更污染主数据、
  // 制造 PR 噪音与并发冲突。前端不依赖构建期状态，靠运行时 onError 兜底（见 06 文档 6.2）。
});

export const SourceRefSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  kind: z.enum(['gov', 'wiki', 'official', 'travel-platform', 'media', 'social']),
  publishedAt: z.string().optional(),         // ISO 日期，能拿到就填
  fetchedAt: z.string(),                      // 抓取时间，必填
});

export const PoiSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),       // 'window-of-the-world'
  name: z.string(),
  category: CategoryEnum,
  /** ★ 细类：决定 marker 颜色，也是地图图例的粒度。
      必须与 category 一致 —— 用 SUBTYPE_CATEGORY 反查校验（不一致即阻断入库） */
  subtype: SubTypeEnum,
  summary: z.string().max(80),                // 一句话卖点，卡片用
  description: z.string().min(80),            // 正文 ≥ 80 字，质量门槛
  highlights: z.array(z.string()).min(2),     // 2~5 条亮点
  location: z.object({
    point: GeoPointSchema,
    address: z.string(),
    district: z.string().optional(),           // 所在区/县
    transportTip: z.string().optional(),       // '地铁1号线世界之窗站 J 口出'
  }),
  /** 事实型字段：填了就必须配 xxxRef，指向 sources 下标（字段级溯源） */
  practical: z.object({
    openHours: z.string().optional(),          // '08:30-18:00'
    openHoursRef: z.number().int().optional(), // → sources[0]
    ticket: z.string().optional(),             // '成人 200 元起' → 必须带"起/约"
    ticketRef: z.number().int().optional(),
    duration: z.string().optional(),           // '建议 3-4 小时'（给人看的自然语言）
    /** ★ 新增：结构化停留时长 [最短, 最长]（分钟），给行程规划算时间用。
        与上面的 duration 并存不替换 —— 一个给人看，一个给机器算（见 09 文档 4.2） */
    durationMinutes: z.tuple([z.number(), z.number()]).optional(),
    bestSeason: z.string().optional(),
    priceLevel: z.enum(['free', 'budget', 'mid', 'high']).optional(),
    reservation: z.string().optional(),
    reservationRef: z.number().int().optional(),
  }).default({}),
  /** ★ 适游群体：这地方适合谁去。至少 1 项 —— 一个都填不出来，说明对这个点位的理解还不够 */
  audience: z.array(AudienceEnum).min(1),
  /** ★ 无障碍友好：轮椅 / 婴儿车可通行。**默认 false** —— 未核实就不声称 */
  accessible: z.boolean().default(false),
  tips: z.array(z.string()).default([]),       // 避坑 / 小建议
  images: z.array(ImageItemSchema).min(1).max(8),
  coverIndex: z.number().int().min(0).default(0),
  tags: z.array(z.string()).default([]),       // ['亲子','夜景','免门票']
  /** 排序权重（脚本打分）：以公开热度信号为依据。不引入 rating 字段 —— 无权威来源的评分是伪数据 */
  popularity: z.number().int().min(0).max(100).default(50),
  sources: z.array(SourceRefSchema).min(1),
  updatedAt: z.string(),
});

/** 通勤矩阵的一个方式通道。定长 4 位 base36 扁平串，按行优先上三角展开：
      idx(i, j) = i × (i − 1) / 2 + j        (i > j)
      读取时对称取值：i > j ? idx(i,j) : idx(j,i)
      '0000' = 不适用（超出该方式的直线距离上限，或接口无数据） */
export const MatrixChannelSchema = z.object({
  distance: z.string(),                       // 距离（米），4 位/格，最大 36⁴ ≈ 1,680 km
  duration: z.string(),                       // 时长（秒），4 位/格，最大 36⁴ ≈ 466 小时
  maxStraightMeters: z.number(),              // 直线距离上限：步行 3000 / 骑行 8000 / 驾车不限(0)
});

export const CityTransitMatrixSchema = z.object({
  /** ★ 必填时间戳：驾车时长含实时路况，是"生成时刻的快照"而非恒定量，
      必须在 UI 上如实标注（见 09 文档 3.2.6） */
  generatedAt: z.string(),
  sampledAtLabel: z.string(),                 // '工作日上午 · 含路况'
  /** 矩阵的 POI 顺序：与 city.pois 下标一一对应 */
  poiIndex: z.array(z.string()),
  /** ★ 三条通道（不是六种方式！）：
      打车复用 driving（同路同速，只是费用不同）；公交/地铁不预计算。
      映射关系见 09 文档 3.2.1 的 MATRIX_CHANNEL */
  modes: z.object({
    driving:   MatrixChannelSchema,
    walking:   MatrixChannelSchema,
    bicycling: MatrixChannelSchema,
    // 刻意没有 transit/subway：公交地铁时效性最强且无批量接口，运行时按需算
  }),
});

export const CitySchema = z.object({
  /** schema 版本，破坏性变更时必须配套迁移脚本 */
  schemaVersion: z.number().int().min(1),      // 当前 = 1
  id: z.string(),                              // 'chengdu'
  name: z.string(),                            // '成都'
  province: z.string(),                        // '四川'
  /** ★ 与行政区划树的关联键（6 位 adcode）。三级下钻靠它把"市的计数"接到这份数据上。
      必须能在 District 树里查到，否则阻断（见 10 文档 2.2 / 4.2） */
  adcode: z.string().regex(/^\d{6}$/),          // '510100' 成都市
  provinceAdcode: z.string().regex(/^\d{6}$/),  // '510000' 四川省
  tagline: z.string().max(30),                 // '天府之国，慢生活之都'
  intro: z.string().min(150),
  center: GeoPointSchema,
  /** 用于坐标合法性校验（POI 必须落在市内） */
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]), // [minLng,minLat,maxLng,maxLat]
  /** 直接喂给 TMap.Map 构造函数（⚠️ 腾讯的 center 是 LatLng(lat, lng)，纬度在前）；
      腾讯 GL 的缩放范围为 3~20。
      城市全貌取 10~12，这也正是影像图表现最好的区间（桌面端默认影像底图，见 03 文档 2.6）。 */
  defaultZoom: z.number().min(3).max(20).default(11),
  heroImages: z.array(ImageItemSchema).min(1).max(3),
  facts: z.object({                            // 城市概览数据条
    bestSeason: z.string().optional(),
    suggestedDays: z.string().optional(),      // '2-3 天'
    transitTip: z.string().optional(),
    climateTip: z.string().optional(),
  }).default({}),
  categories: z.array(z.object({
    key: CategoryEnum,
    label: z.string(),                          // '旅游景点' / '特色美食' / '网红打卡' / '城市特色'
    desc: z.string(),
    icon: z.string(),                           // SVG name
    /** ⚠️ 这是**筛选 chip** 的主色，**不是 marker 颜色** —— marker 颜色由 `subtype` 决定
        （见 SUBTYPE_META）。两者分开是为了让"大类筛选"和"细类配色"互不干扰。 */
    color: z.string(),
    /** 该大类下的细类清单（供筛选面板分组展示，不必前端硬编码遍历） */
    subtypes: z.array(SubTypeEnum),
  })),
  pois: z.array(PoiSchema),

  /** ★ 通勤矩阵（见 09 文档 3.2）：构建期预计算，运行时零调用读表。
      只存「对称上三角」，定长 base36 扁平编码，`0000` = 该方式不适用。
      公交刻意不在矩阵里 —— 时效性最强且无批量接口，改为运行时按需算。 */
  transit: CityTransitMatrixSchema,

  credits: z.object({                          // 全局版权汇总
    imageSources: z.array(z.string()),
    textSources: z.array(z.string()),
    lastUpdated: z.string(),
  }),
  updatedAt: z.string(),
});

export const CityIndexItemSchema = CitySchema.pick({
  id: true, name: true, province: true, tagline: true,
  /** ★ 索引必须带 adcode —— 三级下钻的省级页要拿它把"市的计数"接到详情数据上。
      没有 adcode 就只能靠名称匹配，而名称在不同层级可能重名（如"城区"）。
      有 adcode 的市 = 已收录；District 树里有、索引里没有 = 待收录（见 10 文档 6） */
  adcode: true, provinceAdcode: true,
}).extend({
  coverImage: z.string(),
  poiCount: z.number(),
  updatedAt: z.string(),
});

export const CityIndexSchema = z.array(CityIndexItemSchema);
```

> ⚠️ `CityIndexSchema` 里**只含已收录城市**。全国 34 个省级单位的完整计数来自构建期聚合出的 `district-tree.json`（没有对应城市详情的市，计数为 `null`，前端渲染成灰色虚线"待收录"），两者职责不同，不要混用（见 10 文档第 4 节）。

---

## 三、示例数据（`data/cities/chengdu.json` 片段）

> 首次收录即成都 / 四川（"先跑通链路"），其余 33 个省级单位保持"待收录"（见 10 文档）。

```json
{
  "schemaVersion": 1,
  "id": "chengdu",
  "name": "成都",
  "province": "四川",
  "adcode": "510100",
  "provinceAdcode": "510000",
  "tagline": "天府之国，慢生活之都",
  "center": { "lng": 104.066541, "lat": 30.572269, "coordSystem": "GCJ-02" },
  "bbox": [103.75, 30.30, 104.65, 30.93],
  "defaultZoom": 11,
  "categories": [
    { "key": "scenic",  "label": "旅游景点", "color": "#2F7BE8",
      "subtypes": ["nature", "museum", "historic", "park", "temple"] },
    { "key": "food",    "label": "特色美食", "color": "#E8672F",
      "subtypes": ["local", "snack", "cafe"] },
    { "key": "hotspot", "label": "网红打卡", "color": "#E8389B",
      "subtypes": ["photo", "art"] },
    { "key": "culture", "label": "城市特色", "color": "#12A67A",
      "subtypes": ["street", "performance"] }
  ],
  "pois": [
    {
      "id": "wuhou-shrine",
      "name": "武侯祠",
      "category": "scenic",
      "subtype": "historic",
      "summary": "全国影响最大的三国遗迹博物馆，君臣合祀格局独一份",
      "description": "……",
      "highlights": ["刘备殿与诸葛亮殿君臣合祀，全国唯一", "红墙竹影夹道是经典机位"],
      "location": {
        "point": { "lng": 104.0492, "lat": 30.6448, "coordSystem": "GCJ-02" },
        "address": "成都市武侯区武侯祠大街 231 号",
        "district": "武侯区",
        "transportTip": "地铁 3 号线高升桥站步行约 600 米"
      },
      "practical": {
        "openHours": "08:00-20:00（旺季，以官方为准）",
        "openHoursRef": 0,
        "ticket": "约为 50 元起，以官方渠道为准",
        "ticketRef": 0,
        "duration": "建议 2-3 小时",
        "durationMinutes": [120, 180],
        "priceLevel": "budget"
      },
      "audience": ["solo", "couple", "family"],
      "accessible": true,
      "tips": ["与锦里相邻，可一并安排，建议避开门票高峰期"],
      "images": [/* ... */],
      "coverIndex": 0,
      "tags": ["三国", "红墙机位", "免排队建议"],
      "popularity": 90,
      "sources": [
        { "title": "成都武侯祠博物馆官网", "url": "https://…", "kind": "official", "fetchedAt": "2026-09-16" }
      ],
      "updatedAt": "2026-09-16"
    }
  ],

  "transit": {
    "generatedAt": "2026-09-18",
    "sampledAtLabel": "工作日上午 · 含路况",
    "poiIndex": ["wuhou-shrine", "jinli", "..."],
    "modes": {
      "driving":   { "maxStraightMeters": 0,    "distance": "0a2f0b1c…（46×45/2×4 字符）", "duration": "00k900730…" },
      "walking":   { "maxStraightMeters": 3000, "distance": "000000000b1c…（近距离才有值，其余 0000）", "duration": "0000000000730…" },
      "bicycling": { "maxStraightMeters": 8000, "distance": "…", "duration": "…" }
    }
  }
}
```

> 上面 `transit` 的字符串是**截断示意**。真实值是按 `idx(i,j) = i×(i−1)/2 + j` 行优先展开的上三角，每格固定 4 位 base36，`0000` 表示该方式不适用。编解码与读取实现见 [09-itinerary-planner.md](./09-itinerary-planner.md) 3.2.4。**注意矩阵只有 3 条通道**：打车复用 `driving`、公交/地铁不预计算（运行时按需算），六种通行方式到三条通道的映射见 09 文档 3.2.1。

---

## 四、数据加载策略（SSG 下）

| 数据 | 位置 | 加载方式 | 体积控制 |
|------|------|---------|---------|
| 城市索引 | `data/cities.index.json` | 预渲染 loader 直读；客户端按需 | ≤ 20KB；每城只存封面 + 计数 |
| 城市详情 | `data/cities/{id}.json` | 预渲染 loader 直读（构建期）；客户端 code-split 懒加载 | 单城 ≤ 300KB gzip |
| **通勤矩阵** `transit` | 内嵌在城市详情 JSON 里（**不单独分文件**） | 与城市数据同一次加载 | 46 个 POI 上三角 × 3 方式 × 2 通道 ≈ **25KB 原始 / 约 9KB gzip**（见 09 文档 3.2.4） |
| 图片 | **外链 URL**（JSON 里的字符串） | 列表 `loading=lazy`，详情才加载大图 | 用宽度参数取合适尺寸（列表 400w / 详情 1080w） |

### 4.1 自动注册：新增城市不改一行代码

`import.meta.glob` 在构建期把目录展开成模块映射，因此新增城市**只需往 `data/cities/` 放一份 JSON**，既不用手写 import，也不用改 `prerender()` 的路由列表：

```ts
// app/hooks/useCityData.ts
import type { City } from '~shared/schema'

/** 构建期展开 → { '~data/cities/shenzhen.json': () => import(...), ... } */
const modules = import.meta.glob('~data/cities/*.json')

export const cityLoaders = Object.fromEntries(
  Object.entries(modules).map(([path, load]) => [
    path.split('/').pop()!.replace('.json', ''),        // 'shenzhen'
    load as () => Promise<{ default: City }>,
  ])
)

export const cityIds = Object.keys(cityLoaders)
```

```ts
// react-router.config.ts —— 路由列表复用同一份 glob：数据即路由
import type { Config } from '@react-router/dev/config'
import { cityLoaders } from './app/hooks/useCityData'

export default {
  ssr: false,                       // 纯静态托管，不要服务端
  async prerender() {
    const routes = ['/', '/credits']
    for (const [cityId, load] of Object.entries(cityLoaders)) {
      const { default: city } = await load()
      routes.push(`/city/${cityId}`)
      routes.push(...city.pois.map((p) => `/city/${cityId}/poi/${p.id}`))   // 详情页也要收录
    }
    return routes
  },
} satisfies Config
```

> `~data` / `~shared` 是 `vite.config.ts` 里的 alias，指向仓库根的 `data/` 与 `schema/`。
> 这样 `data/` 保持为唯一真源：**放一份 JSON 进去，页面和路由自动就有了**（满足 G5）。

### 4.2 统一走 Zod 校验

前端消费入口统一 `CitySchema.parse(raw)`：开发期直接暴露脏数据，避免"页面能跑但内容残缺"；生产环境用 `safeParse` + 降级提示。

### 4.3 预渲染的取舍

- **预渲染页面内嵌全文案**：`<title>`、meta、正文、JSON-LD 都在 HTML 里，爬虫无需执行 JS
- **JSON 同时存在于 HTML 与客户端 chunk 中**：单页 HTML 因此略大（≤ 60KB 目标），换来的是 SEO 与首屏体验，值得
- **地图不进预渲染**：SSG 阶段无 `window`，地图组件必须 `useIsMounted()` 门控，先渲染骨架
- **构建规模**：`城市数 × (1 + POI 数)` 个页面。当前 1 城 ≈ 50 页，构建 < 1 分钟；超过 3000 页再考虑增量预渲染

---

## 四·B、行程数据的存放边界（哪些进仓库、哪些只存本地）

行程规划引入了**用户产物**，必须明确它和"仓库数据"的边界 —— 混在一起会污染主数据、也会让 PR 里出现大量个人数据。

| 数据 | 存放位置 | 理由 |
|------|---------|------|
| `CitySchema` / `PoiSchema` / **`transit` 矩阵** | **进仓库**（`data/cities/{id}.json`） | 构建期生成，与用户无关，是全站公共资产 |
| `Stay`（住宿段） | `localStorage` | 用户的个人选择 —— 他住哪个酒店只对他自己有意义 |
| `ItineraryDay` / `DayItem` | `localStorage` | 行程是用户产物，且纯静态站无后端 |
| `legCache`（实时通勤结果） | `localStorage`（上限 300 条 + LRU） | 缓存，可丢。微信 WebView 配额更严（见 08 文档 6.3） |
| `quotaLedger`（用量记账） | `localStorage` | 防单点滥用打满配额（见 09 文档 3.5） |
| 分享链接 | URL hash `#itin=<base64>` | 纯前端可解，无需后端（见 09 文档第八节） |

```ts
// shared/schema.ts —— 行程结构也走 Zod，但**只用于 localStorage 的读写校验**，
// 不参与 data/ 的产出。放在同一个文件是为了「与静态数据结构对齐」这件事本身可见。
export const StaySchema = z.object({
  id: z.string(),
  name: z.string(),
  lng: z.number().min(73).max(136),
  lat: z.number().min(3).max(54),
  source: z.enum(['poi', 'geocoded', 'picked']),   // 从 POI 选 / 地址搜索 / 地图点选
  ref: z.object({ poiId: z.string().optional(), address: z.string().optional() }).optional(),
  fromDay: z.number().int().min(1),                // 住宿段起（含）
  toDay: z.number().int().min(1),                  // 住宿段止（含）—— 支持中途换住宿
});

export const DayItemSchema = z.object({
  uid: z.string(),                                 // 本地唯一：同一 POI 可在同一天出现两次
  poiId: z.string(),
  dwellMinutes: z.number().int().min(5),           // 停留时长，用户可改
  /** ★ 到下一站的通行方式 —— 六选一（与 09 文档 TravelMode 一致）。
      打车与公交/地铁不查预计算矩阵，而是按需实时算（见 09 文档 3.2.1） */
  modeToNext: z.enum([
    'driving', 'taxi', 'transit', 'subway', 'bicycling', 'walking',
  ]).optional(),
  note: z.string().optional(),
});

export const ItineraryDaySchema = z.object({
  stayId: z.string(),                              // ★ 归属某个住宿段
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  items: z.array(DayItemSchema),                   // ★ 有序：顺序完全由用户决定
});
```

> ⚠️ **`items` 的顺序就是真实顺序**，没有单独的 `order` 字段。数组下标即顺序 —— 少一个可能不一致的来源。完整设计见 [09-itinerary-planner.md](./09-itinerary-planner.md) 第四节。

---

## 五、字段质量红线（脚本 enforce）

| 校验项 | 规则 | 失败处理 |
|--------|------|---------|
| 坐标 | 必须落在城市 `bbox` 内；必须为 GCJ-02 | 阻断写入，进质量报告 |
| 坐标精度 | 与最近邻 POI 距离 ≥ 30 米（去重） | 标记疑似重复，人工确认 |
| 描述长度 | ≥ 80 字，且不得与其他 POI 相似度 > 0.8 | 阻断 |
| **类型一致性** | `subtype` 必须存在且落在枚举内；`SUBTYPE_CATEGORY[subtype] === category` **必须成立**（两者不一致 = 配置错误） | 阻断 |
| **适游群体** | `audience` 至少 1 项、不得重复；**每一项都必须能在 `sources[]` 描述的客观语句里找到依据**（如"适合带孩子""适合长者""情侣打卡地"）—— 无依据的标签视为伪数据 | 阻断 + 人工复核 |
| **无障碍** | `accessible: true` 必须能溯源到来源页面的无障碍说明（坡道/电梯/平路）；未核实一律 `false` | 阻断 |
| **行政编码** | `adcode` / `provinceAdcode` 必须为 6 位数字，且能在 District 树（`district-tree.json`）里查到；查不到即阻断（下钻会断链） | 阻断 |
| 图片 | ≥1 张；URL 可达（HEAD 200）；`credit` 四字段齐全；**`query` 必填**；主机不得在境外不可达黑名单内 | 阻断 |
| 来源 | ≥1 条、`url` 可访问（HEAD 200）、`fetchedAt` 存在 | 阻断 |
| 时效性 | 含价格/营业时间的字段必须带"约/起/以官方为准"兜底 | 告警 |
| 合规 | 描述中不含军事禁区、敏感坐标等 | 阻断 + 人工复核 |
| **通勤矩阵** | `poiIndex` 与 `pois` 的 id 集合**完全一致且顺序一致**；`distance` / `duration` 长度 = `n(n−1)/2 × 4`；**驾车覆盖率 > 95%**；`duration` 不得为 0；`distance / 直线距离` 的比值落在 **1.0–3.0** 区间（越界说明坐标或接口有问题） | 阻断 |
| **矩阵时间戳** | `generatedAt` 必须存在且为合法日期 | 阻断（缺了就无法如实告知"时长是快照"） |

---

## 六、驱动 SEO 的字段（不需要额外字段）

预渲染时每页的 meta 直接从现有数据推导，**不引入 `seoTitle` 之类的冗余字段**（避免两处维护、两处不一致）：

| 页面 | `<title>` | `description` | 结构化数据 |
|------|-----------|---------------|-----------|
| `/city/{id}` | `{name}旅游攻略 · 景点美食打卡全收录` | `city.intro` 首 80 字 | `TouristDestination` |
| `/city/{id}/poi/{poiId}` | `{poi.name} · {city.name} · 地址/门票/开放时间` | `poi.summary` + 地址 | `TouristAttraction` |
| `/` | `城市旅游攻略 · 景点美食地图` | 站点简介 | `WebSite` |

图片 SEO：`image.alt` 必填中文描述（已在 Schema 中强制），OG 图取 `poi.images[coverIndex]`。
`bbox` 与 `center` 供 JSON-LD 的 `geo` 字段使用，无需额外数据。
