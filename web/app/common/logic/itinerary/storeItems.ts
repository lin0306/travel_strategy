/**
 * 行程 store 里**「点位」那一组动作**（2026-09-28 从 `store.ts` 拆出来）。
 *
 * ## 为什么拆
 * 与 `storeDays.ts` 同一个理由：`store.ts` 又顶到了护栏 G 的 420 行上限
 * （这次是给「地图取点改名」加了一个动作）。而这一块本来就自成一个概念 ——
 * **一条明细（景点或地图取点）怎么加、怎么删、怎么改名、怎么换序、怎么跨天搬**。
 *
 * ## 为什么是工厂函数
 * 这些动作全都要 `set` / `get`（zustand 注入的）与 `persist`（住在 `store.ts`，
 * 因为它要读整份 state）—— 于是包成一个 `makeItemActions(set, get, persist)`，
 * 由 `store.ts` 展开进 store 对象。这样类型仍然是一份 `ItineraryState`，
 * 不需要为分片再造一套 state 类型。
 *
 * ★ 与 `store.ts` 之间是**单向运行时的**循环（这里只 `import type` 它的 state 类型），
 *   不会真的绕起来。
 */

import type { ItineraryDay } from '~shared/schema'

import { newUid } from './ids'
import type { ItineraryState } from './store'

/** zustand 注入的 `set`（只要函数式更新那一档） */
type Setter = (updater: (s: ItineraryState) => Partial<ItineraryState>) => void
type Getter = () => ItineraryState
/** 落盘：把当前 state 写回那条规划（实现在 `store.ts`） */
type Persister = (s: ItineraryState) => void

/** 找某一站在第几天（0 起）。找不到返回 -1 */
function findDayOf(days: ItineraryDay[], uid: string): number {
  return days.findIndex((d) => d.items.some((x) => x.uid === uid))
}

export function makeItemActions(
  set: Setter,
  get: Getter,
  persist: Persister,
): Pick<
  ItineraryState,
  'addPoi' | 'removeItem' | 'renameItem' | 'moveItem' | 'moveItemToDay' | 'setDwell' | 'setModeToNext' | 'setTransitPrefer'
> {
  return {
    addPoi: (day, poiId, dwellMinutes) => {
      const item = { uid: newUid('it'), poiId, dwellMinutes }
      set((s) => ({
        days: s.days.map((d, i) => (i === day - 1 ? { ...d, items: [...d.items, item] } : d)),
      }))
      persist(get())
    },

    removeItem: (day, uid) => {
      set((s) => ({
        days: s.days.map((d, i) =>
          i === day - 1 ? { ...d, items: d.items.filter((x) => x.uid !== uid) } : d,
        ),
        activeLeg: s.activeLeg === uid ? '' : s.activeLeg,
      }))
      persist(get())
    },

    renameItem: (day, uid, name) => {
      // 空名字直接忽略 —— 不清成空标题（那一行还得能认出它是"地图取点"）
      const next = name.trim()
      if (!next) return
      set((s) => ({
        days: s.days.map((d, i) =>
          i === day - 1
            ? { ...d, items: d.items.map((x) => (x.uid === uid ? { ...x, name: next } : x)) }
            : d,
        ),
      }))
      persist(get())
    },

    moveItem: (day, from, to) => {
      set((s) => ({
        days: s.days.map((d, i) => {
          if (i !== day - 1) return d
          const items = [...d.items]
          const [moved] = items.splice(from, 1)
          if (!moved) return d
          items.splice(Math.max(0, Math.min(items.length, to)), 0, moved)
          return { ...d, items }
        }),
      }))
      persist(get())
    },

    moveItemToDay: (fromDay, uid, toDay) => {
      set((s) => {
        const src = s.days[fromDay - 1]
        const dst = s.days[toDay - 1]
        if (!src || !dst) return s
        const item = src.items.find((x) => x.uid === uid)
        if (!item) return s
        return {
          days: s.days.map((d, i) => {
            if (i === fromDay - 1) return { ...d, items: d.items.filter((x) => x.uid !== uid) }
            if (i === toDay - 1) return { ...d, items: [...d.items, item] }
            return d
          }),
        }
      })
      persist(get())
    },

    setDwell: (uid, minutes) => {
      const day = findDayOf(get().days, uid)
      if (day < 0) return
      set((s) => ({
        days: s.days.map((d, i) =>
          i === day
            ? {
                ...d,
                items: d.items.map((x) =>
                  x.uid === uid ? { ...x, dwellMinutes: Math.max(5, Math.round(minutes)) } : x,
                ),
              }
            : d,
        ),
      }))
      persist(get())
    },

    setModeToNext: (uid, mode) => {
      const day = findDayOf(get().days, uid)
      if (day < 0) return
      set((s) => ({
        days: s.days.map((d, i) =>
          i === day
            ? { ...d, items: d.items.map((x) => (x.uid === uid ? { ...x, modeToNext: mode } : x)) }
            : d,
        ),
      }))
      persist(get())
    },

    /**
     * 公共交通的**偏好**（公交优先 / 地铁优先）。
     *
     * ★ 只写 `transitPrefer`，**不动 `modeToNext`** —— 换偏好不是换方式，
     *   把它俩耦合起来的话，"先切地铁再切偏好"会得到意料之外的方式。
     * ★ 传 `undefined` = **回到均衡**：字段被**删掉**（而�不是写一个 `undefined`）。
     *   对象比较与 JSON 序列化对"键存在但值 undefined"和"没有这个键"处理不同，
     *   留着那个键会制造无谓的差异 —— 而"缺省就是均衡"这个约定本来就靠键不存在表达。
     */
    setTransitPrefer: (uid, prefer) => {
      const day = findDayOf(get().days, uid)
      if (day < 0) return
      set((s) => ({
        days: s.days.map((d, i) =>
          i === day
            ? {
                ...d,
                items: d.items.map((x) => {
                  if (x.uid !== uid) return x
                  const { transitPrefer: _prev, ...rest } = x
                  return prefer ? { ...rest, transitPrefer: prefer } : rest
                }),
              }
            : d,
        ),
      }))
      persist(get())
    },
  }
}
