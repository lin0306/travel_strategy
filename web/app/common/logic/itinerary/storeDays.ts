/**
 * 行程 store 里**「天」那一组动作**（2026-09-27 从 `store.ts` 拆出来）。
 *
 * ## 为什么拆
 * `store.ts` 加到 456 行，撞了护栏 G 的上限（420）。而它里面本来就是四块
 * 互不依赖的东西：天 / 住宿段 / 点位 / 选择与缓存。这里搬走的是**天数**这一块 ——
 * 它自成一个概念（"行程有几天、哪一天在第几位"），而且新加的两个动作
 * （`removeDay` / `moveDay`）都长在这一块上。
 *
 * ## 为什么是工厂函数而不是普通导出
 * 这些动作全都要 `set` / `get`（zustand 注入的）与 `persist`（住在 `store.ts`，
 * 因为它要读整份 state）—— 于是包成一个 `makeDayActions(set, get, persist)`，
 * 由 `store.ts` 展开进 store 对象。这样类型仍然是一份 `ItineraryState`，
 * 不需要为分片再造一套 state 类型。
 *
 * ★ 与 `store.ts` 之间是**单向运行时的**循环（这里只 `import type` 它的 state 类型），
 *   不会真的绕起来。
 */

import { emptyDay } from './emptyDay'
import type { ItineraryState } from './store'

/** zustand 注入的 `set`（只要函数式更新那一档） */
type Setter = (updater: (s: ItineraryState) => Partial<ItineraryState>) => void
type Getter = () => ItineraryState
/** 落盘：把当前 state 写回那条规划（实现在 `store.ts`） */
type Persister = (s: ItineraryState) => void

export function makeDayActions(
  set: Setter,
  get: Getter,
  persist: Persister,
): Pick<ItineraryState, 'setDayCount' | 'removeDay' | 'moveDay' | 'setStartTime'> {
  return {
    setDayCount: (n) => {
      const count = Math.max(1, Math.min(30, Math.round(n)))
      set((s) => {
        const days = [...s.days]
        while (days.length < count) days.push(emptyDay())
        days.length = count
        return { days, activeDay: Math.min(s.activeDay, count) }
      })
      persist(get())
    },

    /*
     * ★ 下面两个是 2026-09-27 跟着「天数标签栏」一起加的：
     *   那条栏上要能**删一天**、还要能**把一天拖到别的位置**。
     *   两者都只动"天"这一层，明细跟着各自的天走。
     */

    removeDay: (day) => {
      set((s) => {
        // 至少留一天 —— 删到 0 天，所有"第 N 天"的读取都会拿到 undefined
        // （`attach` 里也有一条同样的补天逻辑，两处是同一件事的两道保险）
        if (s.days.length <= 1) return s
        const days = s.days.filter((_, i) => i !== day - 1)
        return { days, activeDay: Math.min(s.activeDay, days.length) }
      })
      persist(get())
    },

    moveDay: (from, to) => {
      set((s) => {
        const a = from - 1
        const b = to - 1
        if (a === b || a < 0 || b < 0 || a >= s.days.length || b >= s.days.length) return s
        const days = [...s.days]
        const moved = days.splice(a, 1)[0]
        if (!moved) return s
        days.splice(b, 0, moved)
        /*
         * `activeDay` 要跟着"它原来指的那一天"走 —— 否则换序之后
         * 用户在看的那个天会突然变成另一天的内容（而且不报错）。
         * 下面是"数组元素移动后跟踪一个下标"的标准三种情形。
         */
        let active = s.activeDay
        if (s.activeDay === from) active = to
        else if (a < b && s.activeDay > a && s.activeDay <= b) active -= 1
        else if (a > b && s.activeDay >= b && s.activeDay < a) active += 1
        return { days, activeDay: active }
      })
      persist(get())
    },

    setStartTime: (day, time) => {
      set((s) => ({
        days: s.days.map((d, i) => (i === day - 1 ? { ...d, startTime: time } : d)),
      }))
      persist(get())
    },
  }
}
