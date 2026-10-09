/**
 * **会话级 UI 状态** —— 「刷新还在、关掉标签页就回到初始」。
 *
 * > 用户 2026-09-29：「我不管怎么弄，打开什么东西，我只要刷新页面，就又回到了最开始
 * >   打开时的样子…… 关掉页面重新打开，这种情况恢复最初始的版本没问题」
 *
 * 这句话正好是 `sessionStorage` 的语义：
 *
 * | 动作 | sessionStorage |
 * |------|----------------|
 * | 按 F5 / 刷新 | **保留**（同一个标签页会话） |
 * | 关掉标签页再打开 | **清空**（新会话） |
 * | 新开一个标签页 | 清空 |
 *
 * ## 为什么不用 localStorage
 * localStorage 会把状态带到"下一次打开"，而用户明确说那时**回到初始**才对。
 * 而且它跨标签页共享 —— 两个标签页各看各的城市，会互相把对方的选中项改掉。
 *
 * ## 为什么不用 IndexedDB / 不进路由
 * 这些都是**几百字节的 UI 偏好**，没有二进制、没有查询需求。IDB 是给行程记录用的
 * （`common/data/idb.ts`）。也不进 URL：URL 是"地址"（可以分享的东西），
 * 而"我当时正在看哪个景点"是**个人上下文**，分享给别人没有意义
 * —— 与"住宿点不进 URL"是同一条理由（红线 6 的精神）。
 *
 * ## 边界：哪些存、哪些不存
 * **存**（用户能感知的"我打开的东西"）：
 *   · 地图视野（**带 path**，只在同一条路由的刷新上恢复）
 *   · 路线规划面板（开着 / 哪一条 / 第几天）
 *   · 各页选中的景点（按页面身份分开存，免得串味）
 *   · 城市页的筛选与排序
 *
 * **不存**（一次性动作，恢复了反而是怪）：
 *   · 搜索命中的那一枚、`searchPick` · 「挑景点」浮层 · 「加到哪个规划」弹窗
 *   · 重复添加确认 · toast · "在地图上取点"进行中 · 刚落下的那个取点
 *   · 搜索框里的半截输入
 * 这些都是"某一次交互"的中间态 —— 刷新把它们清掉才是对的。
 *
 * ## 存储不可用怎么办
 * 隐私模式 / 微信 WebView 下 `sessionStorage` 也可能抛（与 `storage.ts` 同一个坑）。
 * 一律 try/catch 吞掉：**读不到就当没有**，退化成"刷新即回到初始"（旧行为），
 * 绝不因为存不了而让页面白屏。
 */

import type { Category, SubType } from '~shared/schema'

export type PoiSortStored = 'hot' | 'name'

/** 地图视野。★ 必须带 `path`：换页之后仍然走各页自己的入口取景 */
export interface StoredView {
  /** 存下来时的 `location.pathname` */
  path: string
  lng: number
  lat: number
  zoom: number
}

export interface StoredPlanUi {
  open: boolean
  activeId: string | null
  /** 1 起（与「第 N 天」同口径） */
  day: number
}

export interface StoredFilter {
  category: Category | null
  subtype: SubType | null
  sort: PoiSortStored
}

export interface UiState {
  /** 格式版本。改结构时 +1 —— 旧值一律丢弃，不做迁移（这几个字段丢了无所谓） */
  v: 1
  view: StoredView | null
  plan: StoredPlanUi
  /** key = 页面身份（`city:chengdu` / `home` / `province:510000`） */
  picks: Record<string, string | null>
  /** key = 城市 id */
  filters: Record<string, StoredFilter>
}

const KEY = 'chexing:ui'
const VERSION = 1

const EMPTY: UiState = {
  v: VERSION,
  view: null,
  plan: { open: false, activeId: null, day: 1 },
  picks: {},
  filters: {},
}

/** sessionStorage 存不可用时的内存兜底（与 `storage.ts` 同策略：能用就用，不能就退化） */
let memoryFallback: string | null = null

function rawRead(): string | null {
  try {
    return window.sessionStorage.getItem(KEY)
  } catch {
    return memoryFallback
  }
}

function rawWrite(value: string): void {
  memoryFallback = value
  try {
    window.sessionStorage.setItem(KEY, value)
  } catch {
    /* 存不了就算了 —— 退化成"刷新即回初始"，不该因此报错 */
  }
}

/**
 * 读整份状态。**每次调用都重新解析**（不做模块级缓存）。
 *
 * ★ 为什么不缓存：这个模块会在**页面加载时**被 shell 读一次（拿自己的恢复值），
 *   之后各个 store 初始化时也要读 —— 而它们的初始化顺序不保证。缓存会让"谁先谁赢"，
 *   后读到的那个变成过期快照。解析几十字节的 JSON 不值一提。
 */
export function readUiState(): UiState {
  const raw = rawRead()
  if (!raw) return EMPTY
  try {
    const parsed = JSON.parse(raw) as Partial<UiState>
    if (parsed.v !== VERSION) return EMPTY
    return {
      v: VERSION,
      view: parsed.view ?? null,
      plan: { ...EMPTY.plan, ...(parsed.plan ?? {}) },
      picks: parsed.picks ?? {},
      filters: parsed.filters ?? {},
    }
  } catch {
    // 旧格式 / 手改坏了：当作没有。**不要抛** —— 一个坏键不该让页面打不开
    return EMPTY
  }
}

/** 浅合并写回（`plan` / `picks` / `filters` 由调用方给出完整的新值） */
export function patchUiState(patch: Partial<Omit<UiState, 'v'>>): void {
  const next: UiState = { ...readUiState(), ...patch, v: VERSION }
  rawWrite(JSON.stringify(next))
}

/** 只写一个页面身份下的选中项（读-改-写，其它的 key 原样留着） */
export function patchPick(pageKey: string, poiId: string | null): void {
  const cur = readUiState()
  patchUiState({ picks: { ...cur.picks, [pageKey]: poiId } })
}

/** 只写一座城的筛选（同理） */
export function patchFilter(cityId: string, filter: StoredFilter): void {
  const cur = readUiState()
  patchUiState({ filters: { ...cur.filters, [cityId]: filter } })
}

/** 只写视野 */
export function patchView(view: StoredView): void {
  patchUiState({ view })
}

/** 只写「路线规划面板」那三件事（读-改-写，其余字段原样留着） */
export function patchPlanUi(patch: Partial<StoredPlanUi>): void {
  const cur = readUiState().plan
  patchUiState({ plan: { ...cur, ...patch } })
}

/* ────────────────────────────────────────────────
 * 「这一页该不该用会话里存的视野」
 * ────────────────────────────────────────────── */

/**
 * **页面加载时**那条 `pathname`。
 *
 * ★ 这就是"刷新恢复"与"导航进页面"的分界线，而且比时间窗可靠：
 *   · 刷新：`pathname` 与它相同 ⇒ 用会话里的视野，**入口取景让位**；
 *   · 从首页点进城市页：路径不同 ⇒ 正常走入口取景（fit 行政区）；
 *   · 从景点详情返回城市页：路径又相同 ⇒ 回到"上次在城市页看的那个位置"
 *     （这比重新 fit 全城更贴近用户预期）。
 */
let bootPathCache: string | null = null

function bootPath(): string {
  if (bootPathCache === null) {
    bootPathCache = typeof window === 'undefined' ? '' : window.location.pathname
  }
  return bootPathCache
}

/**
 * 这一页**该用会话里存的视野**吗？是则返回它（同时供"建图初值"与"跳过入口取景"两处用）。
 *
 * 两个条件缺一不可：`pathname` 与加载时相同、且存下的视野**也是这条路径的**。
 * 后者防的是"在别的页面存了视野、却拿到这一页来用"。
 */
export function restoredViewFor(pathname: string): StoredView | null {
  if (!pathname || pathname !== bootPath()) return null
  const v = readUiState().view
  if (!v || v.path !== pathname) return null
  // 字段类型校验：手改坏了不该让地图飞到 NaN 去
  if (typeof v.lng !== 'number' || typeof v.lat !== 'number' || typeof v.zoom !== 'number') return null
  if (!Number.isFinite(v.lng) || !Number.isFinite(v.lat) || !Number.isFinite(v.zoom)) return null
  return v
}
