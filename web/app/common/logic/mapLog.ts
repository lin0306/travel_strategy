/**
 * 地图显示日志 —— 「哪个缩放级别显示了什么」的黑匣子。
 *
 * ## 为什么需要它
 * 「缩放 ↔ 显示」这条链有四个环节（读视野 → 判据 → 图层的量 / 避让 → 画），
 * 任何一环出问题，用户看到的现象都是**同一句模糊的话**：
 * 「标签不对」「有重叠」「该显示的不显示」。而开发者不在现场，看不到用户
 * 当时停在哪个缩放、屏幕上到底挂着什么。
 *
 * 所以这里把每一次**内容真正变化**的时刻记下来：缩放、判据层级、实际铺的层级、
 * 徽标几个叫什么、面几个、几个簇（其中几个是气泡）、名字几个。用户把这份日志复制出来，
 * 「哪一级显示了哪几样」就不再靠猜。
 *
 * ## 记的是「实际」，不是「意图」
 * `reveal.decideReveal` 给出的是**候选**（"这一级要铺这 9 个徽标"），
 * 而屏幕上真正留下多少还要过两道削：徽标要过**像素避让**、点位要过**档位准入**
 * 再被聚合器合成簇（成都 46 个候选 → 8 个簇、其中 3 个是气泡）。两者可能相差一半以上
 * —— 只记候选会得出"明明铺了却看不到"的错觉。所以条目里的
 * `badges` / `clusters` / `bubbles` / `labels` 全部取自**图层自己的读数**（`stats()`），
 * 不是决策结果。
 *
 * ## 去重：按「内容签名」而不是"按时间"
 * 缩放一次会触发多次 `refreshView`（手势抖动、浮层增删、数据到达），
 * 每次都记会瞬间刷屏。而**内容一模一样的两条记录没有任何诊断价值**。
 * 所以签名取 zoom + 层级 + 各计数 + 名字列表 —— 只有内容真的变了才留一条。
 * 平移之后徽标换了一批（计数可能相同、名字不同）会留下新的一条，这是**有意保留**的：
 * 「同一个缩放、不同位置显示了不同东西」本身就是线索。
 *
 * ## 谁在用
 * ① 浮层 `components/overlays/MapLogPanel.tsx`（人看 + 一键复制）
 * ② 探针可以 `window.__mapLog` 直接取（CDP 里不必再去 hook SDK 原型）
 */

import type { MapLevel } from '~/common/map/tencent'

import { debugLog, setDebugLog } from './debugLog'

/** 一条「此刻屏幕上是这样」的记录 */
export interface MapLogEntry {
  /** 自增序号，用来排序 / 判断新旧 */
  seq: number
  /** 记录时刻（Date.now()） */
  at: number
  /** 路由路径，如 `/province/610000` */
  page: string
  /** 缩放，保留两位 */
  zoom: number
  /** 本页的基准层级（路由决定） */
  base: MapLevel
  /** **实际**铺在屏幕上的层级 */
  level: MapLevel
  /** 缩放判据说**该到**哪一级（可能比 `level` 深） */
  revealed: MapLevel
  /** 数据未就绪，本轮保持现状没动图层 */
  pending: boolean
  /** 区划**候选**数（视野外扩后要铺的个数） */
  dTotal: number
  /** 实际挂上地图的徽标数 */
  badges: number
  /** 徽标文字（最多 12 条） */
  badgeTexts: string[]
  /** 实际挂上地图的行政面数 */
  polys: number
  /** 点位**候选**数 */
  pTotal: number
  /** 过了档位准入、交给聚合的点数（`zoom < 8` 时为 0） */
  aTotal: number
  /** 屏幕上实际的**簇数**（气泡 + 独立点） */
  clusters: number
  /** 其中多成员的簇数 —— 也就是屏幕上真有几个数字气泡 */
  bubbles: number
  /** 实际挂上地图的名字数 */
  labels: number
  /** 名字文字（最多 12 条） */
  labelTexts: string[]
}

/** 最多留多少条 —— 环形淘汰最旧的。足够覆盖一次完整的缩放来回 */
const MAX_ENTRIES = 300
/** 名字列表最多记几条 —— 再多也只是刷屏，诊断价值不变 */
const MAX_NAMES = 12

/* ────────────────────────────────────────────────
 * 控制台输出
 * ────────────────────────────────────────────── */

/**
 * 本文件只**消费**调试输出口，不定义它（定义在 `lib/debugLog.ts`）。
 *
 * ★ 刻意用 `console.log` 而不是只靠自绘面板：面板要在页面上找、要点开、要复制；
 *   而"我操作一遍、控制台里直接看到每一条"才是排查时序问题最省事的方式。
 *   两者现在**内容一致**（同一份 store），不存在"面板有、console 没有"。
 */

/** 层级的中文名（控制台用长名，面板/文本导出用 `LEVEL_SHORT` 的单字缩写） */
const LEVEL_CN: Record<MapLevel, string> = {
  province: '省级',
  city: '市级',
  district: '区级',
  poi: '景点级',
}

/* ────────────────────────────────────────────────
 * 派生：把"可能是问题"的组合标出来
 * ────────────────────────────────────────────── */

/**
 * 这一条里值得注意的地方。
 *
 * ★ 判据刻意写得很直白（"两级同时在场" / "没有点却有名字"），因为这份日志的
 *   读者是**用户**：他能对着屏幕说"对，我这会儿就是这样"。写成推理链反而看不懂。
 */
export function warningsOf(e: MapLogEntry): string[] {
  const w: string[] = []
  if (e.pending) w.push('数据未就绪·保持现状')
  // 徽标是"上一级的汇总"，点位是"这一级的内容" —— 同时在场就是层级重叠
  if (e.badges > 0 && e.clusters > 0) w.push('徽标与点位同时在场')
  // ★ 独立点 = 簇数 − 气泡数。名字只该挂在这些点上，多了就是**幽灵标注**
  //   （"有名字、没有点"是踩过的坑，现在靠这条读数当场抓）
  const singles = e.clusters - e.bubbles
  if (e.labels > singles) w.push('名字多于独立点（幽灵标注）')
  // 这两条不是"错"，是**值得当场解释**的两种空屏：本档不铺 / 全在视野外
  if (e.pTotal > 0 && e.aTotal === 0) w.push('候选有点·本档不铺（z<8 或已离开本城）')
  if (e.aTotal > 0 && e.clusters === 0) w.push('准入有点·屏幕上 0 个簇（多半全在视野外）')
  if (e.dTotal > 0 && e.badges === 0) w.push('候选有徽标·上屏 0')
  if (e.badges > 0 && e.polys === 0) w.push('有徽标·无行政面')
  return w
}

/* ────────────────────────────────────────────────
 * 轻量 store（useSyncExternalStore）
 * ────────────────────────────────────────────── */

const EMPTY: MapLogEntry[] = []

let entries: MapLogEntry[] = EMPTY
let seq = 0
/** 上一条的签名 —— 内容没变就不记 */
let lastSig = ''
const listeners = new Set<() => void>()

/** 记一条时调用方要提供的东西 —— `page` / `seq` / `at` 由 store 自己补 */
export type MapLogInput = Omit<MapLogEntry, 'seq' | 'at' | 'page'>

/**
 * 当前路由。
 *
 * 调用方不必回答"我是哪一页" —— 这份日志永远记的是**此刻**这一页，
 * 而从 `location` 读比让四个页面各自传参更难写错。`paint` 只可能在客户端跑
 * （没地图就没有 paint），但仍留 `window` 判空，免得预渲染时抛错。
 */
function pageOf(): string {
  return typeof window === 'undefined' ? '' : window.location.pathname
}

/** 内容签名：只有它变了才值得记一条 */
function signatureOf(e: MapLogInput, page: string): string {
  return [
    page,
    e.zoom.toFixed(2),
    e.base,
    e.level,
    e.revealed,
    e.pending ? 'P' : '-',
    e.dTotal,
    e.badges,
    e.polys,
    e.pTotal,
    e.aTotal,
    e.clusters,
    e.bubbles,
    e.labels,
    e.badgeTexts.join(','),
    e.labelTexts.join(','),
  ].join('|')
}

/** 记一条。内容与上一条完全相同时**跳过**（理由见文件头"去重"） */
export function recordMapLog(e: MapLogInput): void {
  const page = pageOf()
  const sig = signatureOf(e, page)
  if (sig === lastSig) return
  lastSig = sig

  const next = entries === EMPTY ? [] : [...entries]
  next.push({
    ...e,
    page,
    seq: ++seq,
    at: Date.now(),
    badgeTexts: e.badgeTexts.slice(0, MAX_NAMES),
    labelTexts: e.labelTexts.slice(0, MAX_NAMES),
  })
  if (next.length > MAX_ENTRIES) next.splice(0, next.length - MAX_ENTRIES)
  entries = next
  for (const fn of listeners) fn()

  printEntry(next[next.length - 1])
}

/**
 * 把一条记录打到控制台 —— **内容与面板逐字相同**。
 *
 * 为什么记成多行而不是拼一行：这几个数字（徽标/面/簇/名字）是**并列关系**，
 * 挤在一行里读者得自己找分隔符；分行之后"哪一项是 0"一眼就能看见 ——
 * 而"明明是市徽标那一级，点位却是 0"正是要抓的东西。
 */
function printEntry(e: MapLogEntry | undefined): void {
  if (!e) return

  const sameLevel = e.level === e.revealed
  const levelText = sameLevel
    ? `实际=判据=${LEVEL_CN[e.level]}`
    : `实际=${LEVEL_CN[e.level]} · 判据=${LEVEL_CN[e.revealed]}（判据更深＝内容不够看，回流了）`

  debugLog(
    '显示',
    `${e.page}  z=${e.zoom.toFixed(2)}\n` +
      `        层级：${levelText}　本页基准=${LEVEL_CN[e.base]}\n` +
      `        屏幕：${summaryOf(e)}\n` +
      `        候选：徽标 ${e.pending ? '—（本轮未重算）' : `${e.dTotal} 个`} · 点位 ${e.pending ? '—（本轮未重算）' : `${e.pTotal} 个`}（过准入 ${e.aTotal} 个）` +
      (e.labelTexts.length > 0 ? `\n        名字：${e.labelTexts.join(' | ')}` : '') +
      (e.badgeTexts.length > 0 ? `\n        徽标：${e.badgeTexts.join(' | ')}` : '') +
      (warningsOf(e).length > 0 ? `\n        ⚠ ${warningsOf(e).join(' · ')}` : ''),
  )
}

export function clearMapLog(): void {
  entries = EMPTY
  // ★ 签名也要清：否则清空后"再来一条完全相同的"会被当成重复而丢掉，
  //   用户会以为日志坏了
  lastSig = ''
  for (const fn of listeners) fn()
}

export function subscribeMapLog(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function getMapLog(): MapLogEntry[] {
  return entries
}

/** SSR / 预渲染时的快照（`ssr:false` 下仍需要一个稳定引用，不能每次返回新数组） */
export function getMapLogServerSnapshot(): MapLogEntry[] {
  return EMPTY
}

/**
 * 探针用：`window.__mapLog` 直接读，不必再去 hook 腾讯 SDK 的原型。
 *
 * `toText()` 与浮层「复制」按钮走的是同一个函数 —— 探针拿到的就是用户会复制出来的
 * 那份文本，两边不会出现"探针看着对、用户看到的不一样"。
 */
if (typeof window !== 'undefined') {
  ;(window as unknown as { __mapLog?: unknown }).__mapLog = {
    get: getMapLog,
    clear: clearMapLog,
    toText: () => mapLogToText(),
    /** 控制台输出开关：`__mapLog.off()` / `__mapLog.on()` */
    on: () => setDebugLog(true),
    off: () => setDebugLog(false),
  }
}

/**
 * 一行「这一屏是什么」的摘要 —— 控制台与面板共用同一句话。
 *
 * 写法刻意是**陈述句 + 事实数**（"屏幕上：圆点 5 枚、名字 3 个"），而不是
 * "应该显示景点" —— 排查时最需要的是"实际是什么"，而不是代码想干什么。
 */
export function summaryOf(e: MapLogEntry): string {
  const shown: string[] = []
  if (e.badges > 0) shown.push(`徽标 ${e.badges} 枚`)
  if (e.polys > 0) shown.push(`行政面 ${e.polys} 个`)
  if (e.aTotal > 0) {
    // 簇 = 气泡 + 独立点。只报"几个簇"看不出密不密，所以把气泡单列
    const singles = e.clusters - e.bubbles
    shown.push(`点位 ${e.clusters} 簇（气泡 ${e.bubbles} · 独立点 ${singles}）`)
  }
  if (e.labels > 0) shown.push(`名字 ${e.labels} 个`)
  return shown.length > 0 ? shown.join(' · ') : '**屏幕上什么都没有**'
}

/* ────────────────────────────────────────────────
 * 导出成可以粘贴给人看的纯文本
 * ────────────────────────────────────────────── */

/** 面板 / 文本导出里的**单字**缩写 —— 一屏能多排几列，与控制台的长名分开 */
const LEVEL_SHORT: Record<MapLevel, string> = {
  province: '省',
  city: '市',
  district: '区',
  poi: '点',
}

function pad(s: string, n: number): string {
  // 简易左对齐（中文宽度不精确，够用即可）
  return s + ' '.repeat(Math.max(0, n - s.length))
}

function stamp(at: number): string {
  const d = new Date(at)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/**
 * 把日志导出成**按页面 + 缩放排序**的纯文本。
 *
 * 排序而不是按时间顺序：用户缩放常常是来回的，按时间读会看到
 * `7.26 → 11 → 6 → 8.5`，得自己在脑子里排大小；按缩放升序排完，
 * "哪个级别显示了什么"就是一张可以直接对照的表。
 */
export function mapLogToText(list: MapLogEntry[] = entries): string {
  if (list.length === 0) return '（还没有记录 —— 在地图上放大或缩小一次）'

  const byPage = new Map<string, MapLogEntry[]>()
  for (const e of list) {
    const arr = byPage.get(e.page)
    if (arr) arr.push(e)
    else byPage.set(e.page, [e])
  }

  const lines: string[] = ['# 缩放显示日志', '']

  for (const [page, arr] of byPage) {
    const base = LEVEL_SHORT[arr[0]?.base ?? 'province']
    lines.push(`## ${page}   base=${base}`)
    for (const e of [...arr].sort((a, b) => a.zoom - b.zoom)) {
      const head =
        `z=${e.zoom.toFixed(2)}  ` +
        `${pad(`实际=${LEVEL_SHORT[e.level]}`, 10)}` +
        `${pad(`判据=${LEVEL_SHORT[e.revealed]}`, 10)}` +
        // ★ pending 时把候选显示成 `—`：这一轮**根本没重算**，印一个 0 会读成
        //   "候选是 0 却上屏 10 个"这种自相矛盾的数字，而真相是"保持现状"
        `${pad(`徽标=${e.badges}/${e.pending ? '—' : e.dTotal}`, 14)}` +
        `${pad(`面=${e.polys}`, 8)}` +
        `${pad(`点=${e.aTotal}/${e.pending ? '—' : e.pTotal}`, 14)}` +
        `${pad(`簇=${e.clusters}`, 8)}` +
        `${pad(`气泡=${e.bubbles}`, 10)}` +
        `${pad(`名=${e.labels}`, 8)}`
      lines.push(head)
      if (e.badgeTexts.length > 0) lines.push(`        徽标: ${e.badgeTexts.join(' | ')}`)
      if (e.labelTexts.length > 0) lines.push(`        名字: ${e.labelTexts.join(' | ')}`)
      const w = warningsOf(e)
      if (w.length > 0) lines.push(`        ⚠ ${w.join(' · ')}`)
    }
    lines.push('')
  }

  lines.push(`（共 ${list.length} 条 · 导出 ${stamp(Date.now())}）`)
  return lines.join('\n')
}
