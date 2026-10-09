/**
 * 底图类型 + 「详细度开关」—— 这件事的**唯一出处**。
 *
 * ## 2026-09-25 改版：从「四档预设」改成「一个类型 + 一组开关」
 * 用户原话：
 *   「现在矢量图影像图，你现在都是有两个选项的，应该是改成一个选项，
 *     让增加一个开关，控制显示简略还是详细（先这样做，后期有些应该是可以单独控制的）」
 *
 * 上一版是 4 档平铺预设（矢量 / 矢量·简洁 / 影像 / 影像·无注记）。它的毛病是
 * **把两个正交的维度压成了一条清单**：类型（矢量/影像）与详细度（要不要注记）
 * 本来是两个问题，用户却要在四个平级选项里去挑组合。现在拆回两个维度：
 * `kind`（选类型）+ `details`（逐项开关），"简略 / 详细"只是这套开关的两个快捷档。
 *
 * ## ★ 实测：能单独控制到什么粒度（2026-09-25，`_tmp/cdp_layer_matrix.mjs`）
 * 用户问过「能不能单独控制只显示地铁、道路、超市、区划」。答案是**不能** ——
 * 腾讯的 `features` 是**图层级**开关，不是 POI 类别级。实测（全国 zoom 4.6 与街区 zoom 18
 * 两个视野，逐配置截图比对）：
 *
 * | 你想要的 | 实际归谁管 | 能不能单独关 |
 * |---------|-----------|------------|
 * | 道路 / 绿地 / 水域 / **地铁线** / **区划边界与省名** | `base` | ❌ 全在底面里，关掉就没有地图 |
 * | 地铁站名、超市、商场、餐厅、医院、小区名… | `point` | ❌ **只有一个总开关**（高德 GeoHUB 有 42 类，腾讯没有） |
 * | 道路名称 | `label` | ✅ |
 * | 建筑物 | `building2d` | ✅（zoom ≥ 16.5 才出现） |
 * | 影像图上的路网与地名 | `road` | ✅ |
 *
 * 所以「详细度」能给的开关就是下面 `BASEMAP_DETAILS` 这四项 —— 不多不少。
 * ⚠️ 想按 POI 类别控制只能走腾讯控制台的**个性化样式**（生成 `styleId` 绑定 key），
 *    不是运行时 API，本项目没有接。
 *
 * ## ★ 实测：哪些要素名是**没用的**（别再加回来）
 * 同一个探针逐配置截图、**按字节数逐张比对**（同视野下字节数完全相同 = 画面完全一致）：
 *
 * | 要素 | 结论 |
 * |------|------|
 * | `arrow`（道路箭头，官方文档有列） | ❌ **完全无效** —— 加了与不加是同一张图（zoom 4.6 / 16.2 / 18 三个视野都是） |
 * | `buildingRange` | ❌ 测不出差异（在阈值以上与不传等价），不暴露 |
 * | `building3d`（2D 视图下） | ⚠️ 有效但**与 building2d 画面不同**（体积 178KB vs 162KB）。本项目 `viewMode: '2D'`，选平面那档，与原行为一致 |
 *
 * ## ★ 实测：`label` 在**全国视野下没有任何内容**
 * 全国（zoom 4.6）`base` 与 `base+label` 截图**字节数完全相同**（159.988KB）——
 * 道路文字要到街区级才出现（zoom 16.2 时 +12KB）。所以「道路名称」这一项
 * 在小比例尺下是空开关，UI 里照实说明。
 *
 * ## ★ 实测：省界与省名都在 `base` 里（好消息）
 * 全国视野下 `features: ['base']` 的截图里**省界与省名俱在**，`point` 只管
 * 市级地名（乌鲁木齐、兰州…）与水域名。所以用户把「地点名称」全关掉，
 * 首页仍然是可读的中国地图 —— 这正是"简略"档敢做成"全关"的依据。
 */

import { STORAGE_KEYS, readRaw, writeRaw } from '~/common/data/storage'

/**
 * 底图类型。
 *
 * ★ 腾讯 `setBaseMap.type` **只有三类**：`vector` / `satellite` / `traffic`。
 *   第三类"路况"是**叠加层**（单用是一张白板，见 `plans/03` 2.6），不是一个可选类型，
 *   所以这里不列它 —— 它没有"类型"的语义。
 * ★ 也没有 `terrain`：腾讯 GL 不提供地形底图（官方 API 文档只有上面三类）。
 */
export type BasemapKind = 'vector' | 'satellite'

/** 详细度档位 —— 那个「简略 / 详细」开关 */
export type BasemapLevel = 'plain' | 'full'

/** 逐项开关的标识。★ 与 `BasemapKind` 正交：一项只属于一类底图 */
export type BasemapDetailId = 'place' | 'roadName' | 'building' | 'roadNet'

export interface BasemapDetail {
  id: BasemapDetailId
  /** 开关名（**陈述它是什么**，不写祈使句） */
  label: string
  /** 一行说明。★ 说清"什么时候才看得见"，否则用户会以为开关坏了 */
  hint: string
  /** 这一项属于哪种底图 */
  kind: BasemapKind
  /** 写进 `features` 的要素名。★ 必须是上表实测白名单里的名字 */
  feature: string
}

/**
 * 逐项开关表。**UI 里的开关只能来自这里**（写死会与引擎层漂移，
 * 而"界面上有的、引擎不认"是**静默**失效 —— 腾讯对未知要素不报错）。
 */
export const BASEMAP_DETAILS: readonly BasemapDetail[] = [
  {
    id: 'place',
    label: '地点名称',
    hint: '底图自带的 POI 名：商场、超市、餐厅、医院、小区…（腾讯只给这一个总开关，不分类）',
    kind: 'vector',
    feature: 'point',
  },
  {
    id: 'roadName',
    label: '道路名称',
    hint: '路名文字，放大到街区级才出现',
    kind: 'vector',
    feature: 'label',
  },
  {
    id: 'building',
    label: '建筑',
    hint: '建筑物轮廓，放大到 16.5 级以上才出现',
    kind: 'vector',
    feature: 'building2d',
  },
  {
    id: 'roadNet',
    label: '路网与地名',
    hint: '影像图上的路网线 + 路名地名注记',
    kind: 'satellite',
    feature: 'road',
  },
]

/**
 * 底面的要素名。**它永远在** —— 底面是底图的载体，缺了它只剩飘着的文字
 * （实测：只有注记没有底面时地图是一片空白）。
 */
export const BASEMAP_BASE_FEATURE = 'base'

export interface BasemapKindOption {
  id: BasemapKind
  label: string
  hint: string
}

/** 底图类型选项。★ 触发器按钮上的文字也来自这里 */
export const BASEMAP_KINDS: readonly BasemapKindOption[] = [
  { id: 'vector', label: '矢量图', hint: '建筑、道路与地名齐全' },
  { id: 'satellite', label: '影像图', hint: '地表影像，看地形与城市肌理' },
]

/** 档位的中文名（"简略 / 详细"那对按钮） */
export const BASEMAP_LEVEL_LABEL: Record<BasemapLevel, string> = {
  plain: '简略',
  full: '详细',
}

/** 某一档位对应开哪些项：详细 = 全开，简略 = 全关（只剩底面） */
export function detailsForLevel(kind: BasemapKind, level: BasemapLevel): BasemapDetailId[] {
  return level === 'full' ? BASEMAP_DETAILS.filter((d) => d.kind === kind).map((d) => d.id) : []
}

/** 某一类底图下的全部开关项 */
export function detailsOfKind(kind: BasemapKind): BasemapDetail[] {
  return BASEMAP_DETAILS.filter((d) => d.kind === kind)
}

/* ────────────────────────────────────────────────
 * 状态
 * ────────────────────────────────────────────── */

/**
 * 用户的选择 = **一个类型 + 每类各自的开关集合**。
 *
 * ★ 开关**按类型分开存**：切到影像图看一眼、再切回矢量图，矢量的开关不该被抹掉。
 *   单份 `details` 也能跑，但用户"切来切去配置就没了"是必然会发生的事。
 */
export interface BasemapState {
  kind: BasemapKind
  details: Record<BasemapKind, readonly BasemapDetailId[]>
}

/**
 * 默认：**矢量图 · 详细**。
 *
 * 首页是"看全国收录情况"，判据是省界与省名 —— 矢量底图是腾讯的审图版标准底图，
 * 国界 / 省界 / 地名齐全；影像图上边界只有一条极淡的线，读不出这是一张中国地图。
 * 何况影像瓦片体积是矢量的 5–10 倍（实测同一视野：影像 1.85MB vs 矢量 0.55MB）。
 */
export const DEFAULT_BASEMAP: BasemapState = {
  kind: 'vector',
  details: {
    vector: detailsForLevel('vector', 'full'),
    satellite: detailsForLevel('satellite', 'full'),
  },
}

/** 当前档位。全开 = full · 全关 = plain · 其它 = null（界面显示「自定义」） */
export function levelOf(state: BasemapState): BasemapLevel | null {
  const on = state.details[state.kind]
  const all = detailsForLevel(state.kind, 'full')
  if (on.length === 0) return 'plain'
  return on.length === all.length ? 'full' : null
}

/** 状态 → 给 `map.setBaseMap()` 的配置 */
export function basemapConfig(state: BasemapState): TMap.BaseMapOptions {
  const on = state.details[state.kind]
  const feats = detailsOfKind(state.kind)
    .filter((d) => on.includes(d.id))
    .map((d) => d.feature)
  // ★ 底面永远在；后面才挂用户勾的项
  return { type: state.kind, features: [BASEMAP_BASE_FEATURE, ...feats] }
}

/**
 * 触发器按钮与无障碍名上的文字，如「矢量图」。
 *
 * ★ **只写类型，不带档位后缀**（2026-09-25 用户要求）：原来拼成
 *   「矢量图 · 自定义 / · 简略 / · 详细」，用户原话「那个矢量图右侧那个自定义的文字
 *   能不能去掉」。理由是那截后缀要么在说"你处于某个中间状态"（自定义），
 *   要么在复述面板里已经显示过的档位 —— 而按钮回答的问题只有一个：
 *   **我用的是哪张底图**。档位在面板第二段，那里才有上下文（简略/详细两个按钮）。
 */
export function basemapLabel(state: BasemapState): string {
  return BASEMAP_KINDS.find((k) => k.id === state.kind)?.label ?? '底图'
}

/* ────────────────────────────────────────────────
 * 用户选择的持久化
 * ────────────────────────────────────────────── */

function isValidDetail(v: unknown): v is BasemapDetailId {
  return typeof v === 'string' && BASEMAP_DETAILS.some((d) => d.id === v)
}

/** 把任意读出来的东西收成一个合法状态（不合法就退回默认，绝不返回半成品） */
function coerce(raw: unknown): BasemapState | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const kind = o.kind
  if (kind !== 'vector' && kind !== 'satellite') return null
  const d = (o.details ?? {}) as Record<string, unknown>
  const pick = (k: BasemapKind): BasemapDetailId[] => {
    const list = Array.isArray(d[k]) ? (d[k] as unknown[]).filter(isValidDetail) : null
    // 缺这一类的记录 → 用该类默认（全开），而不是空 —— 空会静默变成"只有底面"
    return list ?? detailsForLevel(k, 'full')
  }
  return { kind, details: { vector: pick('vector'), satellite: pick('satellite') } }
}

/**
 * 旧值迁移。历史上这个键存过两代值：
 *   ① `'vector'` / `'satellite'`（最早的底图**类型**）
 *   ② `'vector-full'` / `'vector-plain'` / `'satellite-road'` / `'satellite-plain'`（四档**预设 id**）
 * 不认旧值的话，老用户下次打开会静默回到默认 —— 他自己的选择"丢了"，而且看不出为什么。
 *
 * ② 的映射要**保住语义**：`vector-plain` 当年是"只留路网与路名"（保留 `label`），
 * 所以映射成「矢量 + 只开道路名称」，而不是"全关"。
 */
function migrate(raw: string | null): BasemapState | null {
  if (!raw) return null
  if (raw === 'vector' || raw === 'vector-full') return DEFAULT_BASEMAP
  if (raw === 'vector-plain') {
    return { kind: 'vector', details: { vector: ['roadName'], satellite: detailsForLevel('satellite', 'full') } }
  }
  if (raw === 'satellite' || raw === 'satellite-road') {
    return { kind: 'satellite', details: { vector: detailsForLevel('vector', 'full'), satellite: ['roadNet'] } }
  }
  if (raw === 'satellite-plain') {
    return { kind: 'satellite', details: { vector: detailsForLevel('vector', 'full'), satellite: [] } }
  }
  try {
    return coerce(JSON.parse(raw))
  } catch {
    return null
  }
}

export function loadBasemapPreference(): BasemapState | null {
  return migrate(readRaw(STORAGE_KEYS.basemapPreference))
}

export function saveBasemapPreference(state: BasemapState): void {
  writeRaw(STORAGE_KEYS.basemapPreference, JSON.stringify({ v: 2, ...state }))
}

/** 首次初始化：用户存过的选择优先，否则用默认 */
export function initialBasemap(): BasemapState {
  return loadBasemapPreference() ?? DEFAULT_BASEMAP
}

/* ────────────────────────────────────────────────
 * 控制器（把"状态 + 落盘 + 渲染"收在一处）
 * ────────────────────────────────────────────── */

export interface BasemapControllerOptions {
  onChange: (state: BasemapState) => void
}

/**
 * 只有一件事要记：**用户选了什么**。
 *
 * 没有 `effective` —— 那半个状态是"系统会替你改"留下的遗迹（旧版的按缩放自动降级）。
 * 一旦渲染结果只由用户决定，`preference` 与 `effective` 就是同一个值。
 */
export class BasemapController {
  private map: TMap.Map | null = null
  private state: BasemapState
  private onChange: (state: BasemapState) => void

  constructor(opts: BasemapControllerOptions) {
    this.onChange = opts.onChange
    this.state = initialBasemap()
  }

  getState(): BasemapState {
    return this.state
  }

  attach(map: TMap.Map): void {
    this.map = map
    this.apply()
  }

  detach(): void {
    this.map = null
  }

  /** 换类型。★ 另一类的开关原样留着（`details` 按类分开存） */
  setKind(kind: BasemapKind): void {
    if (kind === this.state.kind) return
    this.commit({ ...this.state, kind })
  }

  /** 一键「简略 / 详细」—— 只管当前这一类 */
  setLevel(level: BasemapLevel): void {
    const kind = this.state.kind
    this.commit({
      ...this.state,
      details: { ...this.state.details, [kind]: detailsForLevel(kind, level) },
    })
  }

  /** 单个开关 */
  toggleDetail(id: BasemapDetailId): void {
    const kind = this.state.kind
    const cur = this.state.details[kind]
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    this.commit({ ...this.state, details: { ...this.state.details, [kind]: next } })
  }

  private commit(next: BasemapState): void {
    this.state = next
    saveBasemapPreference(next)
    this.apply()
  }

  private apply(): void {
    if (!this.map) return
    this.map.setBaseMap(basemapConfig(this.state))
    this.onChange(this.state)
  }
}
