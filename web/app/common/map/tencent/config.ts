/**
 * 地图 key 解析 —— 双 key 模式。
 *
 * ## 先把事实说清楚
 * **任何托管平台都不能让前端 key 免于暴露**（Netlify 也不例外，这是浏览器的机制而非平台缺陷）。
 * `VITE_` 前缀本身就是一条指令 —— 让构建工具把值**静态替换进 bundle**。
 *
 * 所以护城河只有两样：**Referer 域名白名单 + 配额告警**。
 * 相比高德，腾讯少一层暴露面（不需要额外暴露 `securityJsCode`）。
 *
 * ## 三级优先级
 * | 层 | 来源 | 用途 |
 * |----|------|------|
 * | ① | 使用者在页面里填的 key（存 `localStorage`） | fork / 自部署者。配额与用量都算他自己的 |
 * | ② | 构建期注入的环境变量（维护者的"受限 key"） | 只配域名白名单，保证 clone 后打开就能看到效果 |
 * | ③ | 都没有 | **不初始化地图，走降级卡片** —— 列表/筛选/详情/下钻计数/行程时间计算全部照常可用 |
 */

import { STORAGE_KEYS, readRaw, removeRaw, writeRaw } from '~/common/data/storage'

export type KeySource = 'user' | 'env' | 'none'

export interface ResolvedKey {
  /** 可直接给 SDK 的 key。`source === 'none'` 时为 null */
  key: string | null
  source: KeySource
}

/** `.env.example` 里那句中文占位 —— 用户没改就当成没配 */
const PLACEHOLDER_SENTINELS = ['请到腾讯位置服务', '在此填入', 'your_key', 'YOUR_KEY', 'xxx']

function isPlaceholder(value: string): boolean {
  const v = value.trim()
  if (!v) return true
  return PLACEHOLDER_SENTINELS.some((s) => v.includes(s))
}

/** 使用者自备的 key（localStorage） */
export function getUserKey(): string | null {
  const v = readRaw(STORAGE_KEYS.tmapKey)
  return v && !isPlaceholder(v) ? v : null
}

export function saveUserKey(key: string): void {
  writeRaw(STORAGE_KEYS.tmapKey, key.trim())
}

export function clearUserKey(): void {
  removeRaw(STORAGE_KEYS.tmapKey)
}

/**
 * 按优先级解析出实际使用的 key。
 *
 * ⚠️ 这个函数会被 loader 与"设置面板"同时调用，所以要稳定、无副作用。
 */
export function resolveTmapKey(): ResolvedKey {
  const user = getUserKey()
  if (user) return { key: user, source: 'user' }

  const env = (import.meta.env?.VITE_TMAP_KEY as string | undefined) ?? ''
  if (!isPlaceholder(env)) return { key: env.trim(), source: 'env' }

  return { key: null, source: 'none' }
}

/** 是否由使用者自备 key —— 决定配额账本要不要设上限（他自己的配额，不设上限） */
export function usingOwnKey(): boolean {
  return resolveTmapKey().source === 'user'
}

/**
 * WebService key —— **整条路线规划走的就是它**（plans/13 §5.1 实测定案）。
 *
 * ## 先说清一处曾写错的认知（2026-09-25 实测纠正）
 * 这里原来写着「主路径是 JS API 服务类……还能直接拿到 polyline」。**两句都不对**：
 * - 抓了带 `libraries=service` 的 SDK 包，服务类的实现就是
 *   `apiUrls.driving = 'https://apis.map.qq.com/ws/direction/v1/driving/'` +
 *   `Object.assign({from,to}, t)` 拼 URL ⇒ **它就是同一个 WebService 的壳**，
 *   参数与返回完全一致，拓展性没有区别；
 * - 它**也不解析折线**：包里 `polyline` 的命中全是 WebGL shader 名，
 *   返回的仍是那串数值数组，照样要自己解压（见 `itinerary/polyline.ts`）。
 *
 * 而 WebService 直连反而更简单：不用改 loader 去加载扩展库，也不用逆 `servicesk` 签名。
 * 唯一代价是这个 key 必须暴露在前端 —— 与 JS key 的处境完全一样（见文件头第 1 段）。
 *
 * ## 三级解析
 * ① 使用者自备（`localStorage`）—— 他填的那个 key 同时开通了 JS 与 WebService；
 * ② `VITE_TMAP_WEB_KEY` —— ⚠️ **必须是 `VITE_` 前缀**，否则 Vite 不会暴露给前端。
 *    历史坑：`.env.local` 里曾有一个 `TMAP_WEB_KEY`（没有前缀），
 *    前端永远读不到，而**不报错**，只是每次调用都"未配置 key"；
 * ③ **回落到 JS 的那个 env key** —— 腾讯一个应用 key 默认同时可用于 WebService，
 *    所以绝大多数情况下不需要额外配一行。
 */
export function resolveWebServiceKey(): string | null {
  const own = getUserKey()
  if (own) return own

  const env = (import.meta.env?.VITE_TMAP_WEB_KEY as string | undefined) ?? ''
  if (!isPlaceholder(env)) return env.trim()

  const jsEnv = (import.meta.env?.VITE_TMAP_KEY as string | undefined) ?? ''
  return isPlaceholder(jsEnv) ? null : jsEnv.trim()
}

/** key 缺失时给用户看的引导文案（附申请链接） */
export const KEY_SETUP_HINT = '配置地图 key 后解锁地图 · 5 分钟即可申请（免费）'
export const KEY_APPLY_URL = 'https://lbs.qq.com/'
