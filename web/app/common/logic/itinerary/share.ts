/**
 * 导出 / 导入 / 分享（纯前端，不需要任何后端）。
 *
 * | 能力 | 实现 |
 * |------|------|
 * | 导出 JSON | 序列化 → `Blob` → 下载 `我的成都行程.json` |
 * | 导入 JSON | 文件选择 → Zod 校验 → 合并（同 uid 覆盖，不冲突的新增） |
 * | 分享链接 | 行程 → LZ-string 压缩 → base64 → `location.hash = '#itin=...'` |
 *
 * ## 两条硬约束
 *
 * 1. ★ **能导出就必须能导入** —— 否则用户手里那份 JSON 是一次性的，
 *    "备份"这个承诺就是假的。
 * 2. ★ **分享链接不含住宿点名称** —— 住宿点等于"他在哪过夜"，是个人信息。
 *    默认脱敏为「住宿点」不带名称，用户主动选择才带（09 文档第八节）。
 */

/*
 * ⚠️ lz-string 是**纯 CommonJS** 包（`package.json` 里只有 `main`，没有 `module` / `exports`），
 *    但它自带的类型声明却是 ESM 风格（`export function ...`）——**类型与运行时不符**：
 *
 *      · `tsc` 认为「具名导入没问题」→ 类型检查全绿
 *      · 运行时 Vite 的 SSR 模块运行器拒绝 CJS 的具名导入：
 *        Named export 'compressToEncodedURIComponent' not found.
 *        The requested module 'lz-string' is a CommonJS module → **所有路由 500**
 *
 *    所以这里必须用**默认导入**（拿到 `module.exports` 整个对象）再解构。
 *
 *    也**不要**用 `import * as ns` 绕：CJS 的命名空间对象依赖 cjs-module-lexer 探测具名导出，
 *    探测不到时 `ns.compressToEncodedURIComponent` 是 **undefined** ——
 *    等于把「启动即报错的响亮失败」换成「生成分享链接时静默出错」，更难查。
 */
import lzString from 'lz-string'

const { compressToEncodedURIComponent, decompressFromEncodedURIComponent } = lzString

import {
  ItineraryExportSchema,
  ItineraryShareSchema,
  type ItineraryDay,
  type ItineraryShare,
  type Stay,
} from '~shared/schema'

/** 分享链接长度上限。超了就退化为文件分享（09 文档第八节） */
export const SHARE_URL_SOFT_LIMIT = 2000

/* ────────────────────────────────────────────────
 * 导出 / 导入
 * ────────────────────────────────────────────── */

export function buildExport(cityId: string, stays: Stay[], days: ItineraryDay[]) {
  return ItineraryExportSchema.parse({
    v: 1,
    cityId,
    stays,
    days,
    exportedAt: new Date().toISOString(),
  })
}

export function serializeExport(cityId: string, stays: Stay[], days: ItineraryDay[]): string {
  return JSON.stringify(buildExport(cityId, stays, days), null, 2)
}

/** 触发浏览器下载。SSR 阶段没有 document，直接返回 */
export function downloadJson(filename: string, text: string): void {
  if (typeof document === 'undefined') return
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // 立刻 revoke 会让部分浏览器来不及下载，给一帧余量
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export type ImportResult =
  | { ok: true; cityId: string; stays: Stay[]; days: ItineraryDay[]; note: string }
  | { ok: false; error: string }

/**
 * 解析导入的 JSON。
 * 复用导出的同一个 Schema —— 导出的东西导不回来是最丢人的 bug。
 */
export function parseImport(text: string): ImportResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: '文件不是合法的 JSON' }
  }

  const r = ItineraryExportSchema.safeParse(raw)
  if (!r.success) {
    const first = r.error.issues[0]
    return {
      ok: false,
      error: `行程文件格式不兼容${first ? `（${first.path.join('.') || 'root'}: ${first.message}）` : ''}`,
    }
  }

  // 轻量一致性检查：days 引用的 stayId 必须存在，否则时间链会因为找不到锚点而算空
  const stayIds = new Set(r.data.stays.map((s) => s.id))
  const orphan = r.data.days.find((d) => !stayIds.has(d.stayId))
  if (orphan) {
    return { ok: false, error: `行程引用了不存在的住宿段「${orphan.stayId}」，文件可能已损坏` }
  }

  return {
    ok: true,
    cityId: r.data.cityId,
    stays: r.data.stays,
    days: r.data.days,
    note: `已导入 ${r.data.stays.length} 个住宿段 · ${r.data.days.reduce((n, d) => n + d.items.length, 0)} 个点位`,
  }
}

/**
 * 合并导入的行程到现有行程。
 * 规则：同 uid / 同 stay.id 覆盖，其余新增 —— 用户导两次同一份文件不该产生重复点位。
 */
export function mergeItinerary(
  current: { stays: Stay[]; days: ItineraryDay[] },
  incoming: { stays: Stay[]; days: ItineraryDay[] },
): { stays: Stay[]; days: ItineraryDay[] } {
  const stayMap = new Map(current.stays.map((s) => [s.id, s]))
  for (const s of incoming.stays) stayMap.set(s.id, s)

  // day 按数组下标对齐（第 1 天 = 下标 0）。同一天的 items 按 uid 覆盖 + 新增
  const days: ItineraryDay[] = [...current.days]
  incoming.days.forEach((inc, idx) => {
    const cur = days[idx]
    if (!cur) {
      days[idx] = inc
      return
    }
    const items = [...cur.items]
    for (const item of inc.items) {
      const at = items.findIndex((x) => x.uid === item.uid)
      if (at >= 0) items[at] = item
      else items.push(item)
    }
    days[idx] = { stayId: inc.stayId, startTime: inc.startTime, items }
  })

  return { stays: [...stayMap.values()], days }
}

/* ────────────────────────────────────────────────
 * 分享链接
 * ────────────────────────────────────────────── */

/**
 * 生成分享载荷。
 *
 * @param revealStayNames 是否带上住宿点真实名称。**默认 false（脱敏）**。
 *        用户主动勾选才带 —— 这不是"体验优化"，是隐私默认值该有的方向。
 */
export function buildSharePayload(
  cityId: string,
  stays: Stay[],
  days: ItineraryDay[],
  revealStayNames = false,
): ItineraryShare {
  return {
    c: cityId,
    s: stays.map((s) => ({
      i: s.id,
      n: revealStayNames ? s.name : '住宿点',
      lng: s.lng,
      lat: s.lat,
      f: s.fromDay,
      t: s.toDay,
    })),
    d: days.map((d) => ({
      s: d.stayId,
      st: d.startTime,
      i: d.items.map((it) => ({
        u: it.uid,
        p: it.poiId,
        w: it.dwellMinutes,
        ...(it.modeToNext ? { m: it.modeToNext } : {}),
      })),
    })),
  }
}

export interface ShareResult {
  ok: boolean
  /** 完整的分享链接（不含 origin 之外的额外参数） */
  url: string
  /** 链接长度，便于判断是否该退化为文件分享 */
  length: number
  /** 给用户看的结果说明 */
  message: string
}

/**
 * 生成分享链接。
 *
 * 为什么可行：我们已经在城市页用 URL 承载状态（`/city/:cityId/poi/:poiId`）。
 * 分享链接是同一思路的延伸 —— **URL 是可分享状态的唯一载体**，而这恰好不需要后端。
 */
export function buildShareUrl(
  origin: string,
  cityId: string,
  stays: Stay[],
  days: ItineraryDay[],
  revealStayNames = false,
): ShareResult {
  const payload = buildSharePayload(cityId, stays, days, revealStayNames)
  const hash = `#itin=${compressToEncodedURIComponent(JSON.stringify(payload))}`
  const url = `${origin}/city/${cityId}/plan${hash}`

  if (url.length > SHARE_URL_SOFT_LIMIT) {
    return {
      ok: false,
      url,
      length: url.length,
      message: `行程较大，链接 ${url.length} 字符已偏长 · 建议改用「导出 JSON」发文件`,
    }
  }

  const masked = !revealStayNames ? '，住宿点已脱敏为「住宿点」' : ''
  return {
    ok: true,
    url,
    length: url.length,
    message: `行程链接已复制 · 只含点位与顺序${masked}`,
  }
}

export type ParseShareResult =
  | { ok: true; cityId: string; stays: Stay[]; days: ItineraryDay[] }
  | { ok: false; error: string }

/**
 * 从 `#itin=...` 解出分享的行程。
 * 解析失败**不能给空白页** —— 要把错误交给 UI，由它给「手动添加点位」的入口。
 */
export function parseShareHash(hash: string): ParseShareResult | null {
  const m = /[#&]itin=([^&]+)/.exec(hash)
  if (!m?.[1]) return null

  try {
    const json = decompressFromEncodedURIComponent(m[1])
    if (!json) return { ok: false, error: '链接已失效或格式不兼容' }

    const r = ItineraryShareSchema.safeParse(JSON.parse(json))
    if (!r.success) return { ok: false, error: '链接已失效或格式不兼容' }

    // 注：`source` 在分享链接里没有承载（那是本地输入方式的记录，对接收方无意义），
    // 统一标为 'geocoded' 让类型成立 —— 它只影响"来源"那一句展示文案。
    const stays: Stay[] = r.data.s.map((s) => ({
      id: s.i,
      name: s.n,
      lng: s.lng,
      lat: s.lat,
      source: 'geocoded' as const,
      fromDay: s.f,
      toDay: s.t,
    }))

    const days: ItineraryDay[] = r.data.d.map((d) => ({
      stayId: d.s,
      startTime: d.st,
      items: d.i.map((it) => ({
        uid: it.u,
        poiId: it.p,
        dwellMinutes: it.w,
        ...(it.m ? { modeToNext: it.m } : {}),
      })),
    }))

    return { ok: true, cityId: r.data.c, stays, days }
  } catch {
    return { ok: false, error: '链接已失效或格式不兼容' }
  }
}
