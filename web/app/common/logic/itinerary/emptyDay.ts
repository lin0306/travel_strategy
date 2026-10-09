/**
 * 「第 N 天」的空白构造器。
 *
 * ★ 单独一个文件，**唯一目的是打断循环依赖**：
 *   规划记录 store（`planStore.ts`）要用它建默认天，
 *   而行程 store（`store.ts`）迟早要反向依赖规划 store（落盘从 localStorage 换成 IDB）。
 *   两行代码放进任何一边都会变成 `store ⇄ planStore` 的环 —— 那类问题平时不报错，
 *   只在某个 import 顺序下炸成 `undefined is not a function`，是最难查的一种。
 */

import type { ItineraryDay } from '~shared/schema'

/** 一条空白的一天。`stayId: ''` = 还没归属任何住宿段（`store.ts` 的既有约定） */
export function emptyDay(startTime = '09:00'): ItineraryDay {
  return { stayId: '', startTime, items: [] }
}
