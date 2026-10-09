/**
 * localStorage 安全访问层。
 *
 * 存在的理由只有一个：**隐私模式 / 微信 WebView 下 localStorage 可能直接抛异常**
 * （iOS 无痕模式 `setItem` 会 throw，微信某些版本配额极小）。
 * 行程数据全在这里，任何一处裸用 `localStorage` 都会让整页白屏。
 *
 * 策略：探测一次可用性 → 不可用就退化为**内存 Map**，
 * 并把 `persistAvailable` 暴露出去，让 UI 能如实提示「本次会话有效，关闭后将丢失」。
 */

const memory = new Map<string, string>()

let available: boolean | null = null

/** 探测 localStorage 是否真的能读写（不能只看 `'localStorage' in window`） */
export function isPersistAvailable(): boolean {
  if (available !== null) return available
  try {
    const k = '__chexing_probe__'
    window.localStorage.setItem(k, '1')
    window.localStorage.removeItem(k)
    available = true
  } catch {
    available = false
  }
  return available
}

/** 不依赖环境探测的一次性读取。任何异常都吞掉并返 null —— 读缓存失败不该是致命错误 */
export function readRaw(key: string): string | null {
  if (isPersistAvailable()) {
    try {
      return window.localStorage.getItem(key)
    } catch {
      /* 落到内存兜底 */
    }
  }
  return memory.get(key) ?? null
}

/**
 * 写入。
 * @returns 是否真的持久化了（false = 仅存在内存里，刷新即丢）
 */
export function writeRaw(key: string, value: string): boolean {
  if (isPersistAvailable()) {
    try {
      window.localStorage.setItem(key, value)
      return true
    } catch {
      // 配额超限也会走到这里（微信 WebView 尤其容易）
      memory.set(key, value)
      return false
    }
  }
  memory.set(key, value)
  return false
}

export function removeRaw(key: string): void {
  if (isPersistAvailable()) {
    try {
      window.localStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  }
  memory.delete(key)
}

/** 读 JSON。解析失败当作不存在 —— 旧版本格式或手改坏了都不该让页面崩 */
export function readJson<T>(key: string): T | null {
  const raw = readRaw(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function writeJson(key: string, value: unknown): boolean {
  try {
    return writeRaw(key, JSON.stringify(value))
  } catch {
    return false
  }
}

/** 存储键统一前缀，避免和同域下其他应用撞键 */
export const STORAGE_KEYS = {
  /**
   * ★ **旧版**「一城一份行程」的键（plans/13 §3.4 之前的形态）。
   * 新代码不再写它 —— 规划记录已经搬进 IndexedDB（`common/data/idb.ts`）。
   * 但**不要删**：迁移是"复制一份过去"而不是"搬走"，旧键留着当回滚点，
   * 而且 `itinerary/store.ts` 在切完之前还在读写它。
   */
  itinerary: (cityId: string) => `chexing:itin:${cityId}`,
  /** 旧行程已迁进 IndexedDB 的一次性标记（值是迁移时刻的毫秒数） */
  plansMigrated: 'chexing:plans-migrated',
  quota: 'chexing:quota',
  legCache: 'chexing:legcache',
  /**
   * 逆地理编码结果（坐标 → 省市区），地图取点那一行的地址用。
   * 见 `common/logic/itinerary/geocode.ts`：同名坐标只查一次，LRU 300 条。
   */
  geoCache: 'chexing:geo',
  /**
   * 用户选中的底图状态（JSON：`{ v: 2, kind, details }`）。
   * ⚠️ 历史上这个键存过底图**类型**字符串与四档**预设 id** —— 旧值迁移在
   * `map/tencent/basemap.ts` 的 `migrate()` 里，改格式时别忘了一起改。
   */
  basemapPreference: 'chexing:basemap',
  tmapKey: 'chexing:tmap-key',
} as const

/**
 * 列出所有以 `prefix` 开头的键 —— 迁移旧数据要枚举，而 `readJson` 只能按键取。
 *
 * ★ 只枚举**真实 localStorage**：内存兜底 Map 里只会有本次会话写过的东西，
 *   历史数据永远不会在那儿。所以存储不可用时返回 `[]` 是对的，不是"漏了"。
 *   返回**键**而不是值：调用方通常还要从键里解析出 cityId（`chexing:itin:<cityId>`）。
 */
export function listRawKeys(prefix: string): string[] {
  if (!isPersistAvailable()) return []
  try {
    const out: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (k && k.startsWith(prefix)) out.push(k)
    }
    return out
  } catch {
    return []
  }
}

/**
 * 按上限 + LRU 淘汰（09 文档 3.3 末尾）。
 *
 * 微信内置浏览器配额更严，缓存必须**有上限**：
 * 最多 300 条，超出按 `at`（写入时刻）淘汰最旧的。
 */
export function pruneLru<T extends { at: number }>(map: Record<string, T>, max = 300): Record<string, T> {
  const entries = Object.entries(map)
  if (entries.length <= max) return map
  entries.sort((a, b) => b[1].at - a[1].at)
  return Object.fromEntries(entries.slice(0, max))
}
