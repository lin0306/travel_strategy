/**
 * 展示格式化 —— 时间 / 距离的中文呈现。
 *
 * 放独立文件的原因：时间链推导、时间轴、方案卡、图例、空态都要用同一套措辞。
 * 各写一份的话，"1 小时 26 分"和"1小时26分"会同时出现在一个页面上。
 */

/** 分钟数 → `'09:18'`。超过 24 小时会绕回去，所以调用方应先确认当天时间没溢出 */
export function fmtClock(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440
  const h = Math.floor(m / 60)
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** `'09:00'` → 从 0 点起的分钟数（540）。非法输入返 0，避免 NaN 污染整条时间链 */
export function parseClock(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return 0
  const h = Number(m[1])
  const min = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(min)) return 0
  return h * 60 + min
}

/**
 * 秒 → 中文时长。刻意不用 `'1.4 小时'`：
 * 时间链上每格都可能是小数小时，读起来比"1 小时 26 分"慢。
 */
export function fmtDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds / 60))
  if (total < 60) return `${total} 分`
  const h = Math.floor(total / 60)
  const m = total % 60
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`
}

/** 分钟 → 中文时长（时间链里的停留时长直接用这个） */
export function fmtMinutes(minutes: number): string {
  return fmtDuration(minutes * 60)
}

/**
 * 米 → 距离。小于 1 km 用米（"900 米"比"0.9 km"更有实感），
 * 1 km 以上保留一位小数。
 */
export function fmtDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} 米`
  const km = meters / 1000
  return `${km >= 100 ? Math.round(km) : km.toFixed(1)} km`
}

/** 元 → `'约 ¥18'`。★ 一律带"约" —— 打车费不含动态调价与拥堵溢价，显示成准确值就是误导 */
export function fmtFare(yuan: number): string {
  return `约 ¥${Number.isInteger(yuan) ? yuan : yuan.toFixed(1)}`
}

/** HTML 转义。所有来自数据的文本插进 innerHTML/JSX 之外的地方都要过一遍 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 千分位。计数徽标上用（"1,024 个"） */
export function fmtCount(n: number): string {
  return n.toLocaleString('zh-Hans-CN')
}

/**
 * 时刻 → 相对现在的中文说法（`'2 小时前'`）。
 *
 * ★ 用于**规划记录的"最近规划时间"**。刻意不用绝对时刻（`'09-26 14:20'`）：
 *   这个字段的用途是"哪条是我刚动过的"，相对说法一眼可比，
 *   绝对时刻要用户自己在脑子里做减法。
 *
 * 超过 7 天就不再"几天前"了 —— 那时"具体是哪天"比"几天前"更有用。
 */
export function fmtAgo(at: number, now = Date.now()): string {
  const d = now - at
  // 时钟回拨 / 未来时间：不说"负几小时前"这种胡话
  if (d < 0) return '刚刚'
  const min = Math.floor(d / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day <= 7) return `${day} 天前`
  const dt = new Date(at)
  return `${dt.getMonth() + 1} 月 ${dt.getDate()} 日`
}
