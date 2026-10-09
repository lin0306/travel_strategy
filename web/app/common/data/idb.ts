/**
 * IndexedDB 封装 —— **只管"能不能存、能不能取"，不懂任何业务**。
 *
 * ## 为什么规划记录必须离开 localStorage（plans/13 §4.1）
 * | | localStorage | IndexedDB |
 * |---|---|---|
 * | 容量 | ~5MB（微信 WebView 更小） | 磁盘配额的一小部分，够用几个数量级 |
 * | 写入 | **同步**，阻塞主线程 | 异步 |
 * | 事务 | 无（并发写互相覆盖） | 有 |
 *
 * 而**一条市内路线解压后就是 500~2000 个点**，JSON 约 30~150KB：
 * 10 条规划 × 3 份方案 ≈ 3MB，直接顶到 localStorage 上限。所以折线这层必须搬。
 *
 * ## ★ 只有「可用 / 不可用」两态，**没有降级链**（2026-09-25 用户定）
 * > 「indexeddb 不能用时，在规划的时候**提示用户不可用**，而不是再退回 local，
 * >  这样得写两套逻辑，会变复杂」
 *
 * 所以本模块**不提供**"退回 localStorage / 退回内存态"的路径：打不开就返回 `null`，
 * 由上层把"规划不可用"如实告诉用户。少一套持久化路径 = 少一套读写 / 上限 / 清理 / 迁移逻辑。
 *
 * ## 为什么不引三方库
 * 项目现在只有 zustand / zod / react-router / lz-string 四个运行时依赖。
 * 裸 `indexedDB` 写这四个操作不到 150 行，为它引 `idb` 或 `dexie` 不划算
 * —— 而且那两家封装的核心价值（事务编排、cursor 遍历）我们一个都用不上。
 *
 * ## 三个实现约定
 * 1. **打不开就 `null`，绝不抛错**：IDB 在隐私模式 / 策略禁用 / 磁盘满时都会失败，
 *    而那不该让页面崩 —— 与 `loadSearchIndex` 对"没有"的态度一致。
 * 2. **单例连接**：`openDb()` 结果缓存；`versionchange` 时主动关掉并清缓存
 *    （否则另一个标签页升级数据库会把它永久阻塞在旧版本上）。
 * 3. **错误只记日志不抛**：写失败（QuotaExceededError 等）返回 `false`，
 *    由上层决定要不要提示 —— 拿 boolean 比拿 exception 好处理。
 */

/** 数据库名。与 localStorage 的 `chexing:` 前缀同一个命名习惯 */
const DB_NAME = 'chexing'

/** 版本号。★ 加 store / 加索引必须 +1，否则 `onupgradeneeded` 根本不跑 */
const DB_VERSION = 1

/** 规划记录的 store 名 */
export const STORE_PLANS = 'plans'

/** 单例连接。`null` = 已经确认不可用（不再重试） */
let dbPromise: Promise<IDBDatabase | null> | null = null

/**
 * 打开数据库。**永不 reject** —— 失败返回 `null`。
 *
 * `onblocked` 也当失败处理：它意味着另一个标签页还占着旧版本连接，
 * 此时继续等下去会让本页**永远卡在 loading**（比明确失败更糟）。
 */
function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null)
      return
    }
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      // 某些浏览器在禁用存储时直接抛 SecurityError
      resolve(null)
      return
    }

    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_PLANS)) {
        const store = db.createObjectStore(STORE_PLANS, { keyPath: 'id' })
        // 记录列表按"最近规划时间"倒序 —— 建索引后由 IDB 排序，不必把全表读进内存再排
        store.createIndex('updatedAt', 'updatedAt')
      }
    }

    req.onsuccess = () => {
      const db = req.result
      /*
       * ★ 别的标签页升级了数据库时，本连接会被要求关闭。
       *   不关的话对方会一直 blocked，而本页会拿着**旧 schema** 继续读写（静默出错）。
       */
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      resolve(db)
    }
    req.onerror = () => resolve(null)
    req.onblocked = () => resolve(null)
  })

  return dbPromise
}

/** 把一次 IDBRequest 包成 Promise。`null` = 失败 */
function toPromise<T>(req: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
  })
}

/** 规划记录至少要有 `id` 与 `updatedAt` 才能进这个 store */
export interface IdbRecord {
  id: string
  updatedAt: number
}

/**
 * 一次事务的通用跑法。
 *
 * ★ 事务必须**在最外层一次性拿到** store 并在同一个 tick 里发起请求 ——
 *   IDB 事务在宏任务边界会自动 commit，`await` 之后再 `transaction()` 会得到
 *   `TransactionInactiveError`（React 里很容易踩，因为它到处是 await）。
 *   所以这里把"开事务"收在一个函数里，调用方只提供"对 store 做什么"。
 */
async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | null,
): Promise<T | null> {
  const db = await openDb()
  if (!db) return null
  try {
    const tx = db.transaction(STORE_PLANS, mode)
    const req = fn(tx.objectStore(STORE_PLANS))
    if (!req) return null
    return await toPromise(req)
  } catch (err) {
    console.warn('[idb] 事务失败：', err)
    return null
  }
}

/* ────────────────────────────────────────────────
 * 对外能力
 * ────────────────────────────────────────────── */

/**
 * 存储是否可用。
 *
 * ★ 它是**异步**的（IDB 没有同步探测），所以 UI 上会先有一小段"未知"期 ——
 *   调用方应当把 `null`（还不知道）与 `false`（确定不可用）**分开渲染**，
 *   不要用 `false` 充当"还没探到"（那会让能用的用户先看到一句"不可用"）。
 */
export async function isIdbAvailable(): Promise<boolean> {
  return (await openDb()) !== null
}

/** 读全部规划记录。`null` = 读不了（不同于"还没有记录"，那是 `[]`） */
export async function getAllPlans<T extends IdbRecord>(): Promise<T[] | null> {
  return withStore<T[]>('readonly', (s) => s.getAll() as IDBRequest<T[]>)
}

/**
 * 读一条。`null` = 读不了**或**不存在 —— 调用方只需要"有 / 没有"。
 *
 * ★ 这里必须把 `undefined` 归一成 `null`：**IDB 对不存在的键给的是 `undefined`**，
 *   而所有调用方都按"`null` 才是没有"来写（`if (record !== null)`）。
 *   不归一化的话，"没有"会被判成"有" —— 这个坑在旧行程迁移的幂等检查上真踩过：
 *   首次迁移会把每条旧行程都判成"已经迁过"→ 一条都不迁 → 还落下"已迁移"标记
 *   ⇒ **用户的老行程永远静默消失**。归一化放在这一层，是为了让契约只有一处解释。
 */
export async function getPlan<T extends IdbRecord>(id: string): Promise<T | null> {
  const r = await withStore<T | undefined>('readonly', (s) => s.get(id) as IDBRequest<T | undefined>)
  return r ?? null
}

/** 写一条（有则覆盖）。`false` = 没写成功（配额满 / 事务失败） */
export async function putPlan<T extends IdbRecord>(record: T): Promise<boolean> {
  const r = await withStore<IDBValidKey>('readwrite', (s) => s.put(record))
  return r !== null
}

/**
 * 删一条。`false` = 没删成功。
 *
 * ⚠️ 判据是 `!== null`（`null` 只代表 `withStore` 里抛了 / 开不了事务）。
 *   **不要照抄 `getPlan` 那样把 `undefined` 归一成 `null`** ——
 *   `delete()` 成功时 `result` **本来就是 `undefined`**，归一化会让删除永远报失败。
 */
export async function deletePlan(id: string): Promise<boolean> {
  const r = await withStore<undefined>('readwrite', (s) => s.delete(id))
  return r !== null
}

/** 清空（"删除全部规划"用）。`false` = 没清成功。同上：`clear()` 成功时 `result` 也是 `undefined` */
export async function clearPlans(): Promise<boolean> {
  const r = await withStore<undefined>('readwrite', (s) => s.clear())
  return r !== null
}
