/**
 * 列表拖拽排序（原生 HTML5 DnD）—— **天数标签栏**与**明细时间线**共用。
 *
 * ## 为什么用原生 DnD 而不是引一个拖拽库
 * 两处的需求都只是"把一个列表里的第 i 项拖到第 j 项"：不需要虚拟滚动、
 * 不需要跨容器、不需要自动滚动、不需要键盘拖拽。原生 `draggable` + 三个事件就够，
 * 而一个拖拽库是几十 KB 与一整套新概念。真到了要跨容器拖的那天再换。
 *
 * ## ★ 它**只负责报"从哪拖到哪"**，不碰数据
 * 换序一律交给 store（`moveDay` / `moveItem`）—— 组件里不自己改数组。
 * 这条纪律在 `TimelineRail` 那边也写着：自己改数组会让"界面里的顺序"
 * 与"落盘的顺序"漂开，而且不报错。
 *
 * ## 状态的两半
 * · `dragging` —— 被拖的那一项（画成半透明，让用户知道"手里拿的是它"）
 * · `over` —— 当前悬停到的那一项（画一条插入提示线）
 * 两者都由宿主的 `bind(i)` 读出来用样式表达。
 */

import { useState, type DragEvent } from 'react'

export interface DragSort {
  /** 正在被拖的下标（没有就是 null） */
  dragging: number | null
  /** 当前悬停的下标（画插入提示线） */
  over: number | null
  /** 绑到每一项的元素上：`<li {...bind(i)}>` */
  bind: (i: number) => {
    draggable: true
    onDragStart: (e: DragEvent) => void
    onDragOver: (e: DragEvent) => void
    onDrop: (e: DragEvent) => void
    onDragEnd: () => void
  }
}

export function useDragSort(onDrop: (from: number, to: number) => void): DragSort {
  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)

  function bind(i: number): ReturnType<DragSort['bind']> {
    return {
      draggable: true,
      onDragStart: (e) => {
        setDragging(i)
        // ★ 不设 dataTransfer 的话 Firefox 根本不会启动拖拽（Chrome 会）
        e.dataTransfer.setData('text/plain', String(i))
        e.dataTransfer.effectAllowed = 'move'
      },
      onDragOver: (e) => {
        // 不 preventDefault 就不会触发 drop —— 这是最容易漏的一行
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        // 连续触发，所以只在真的换了目标时才 setState
        if (over !== i) setOver(i)
      },
      onDrop: (e) => {
        e.preventDefault()
        /*
         * ★ `from` 优先**从 `dataTransfer` 读**，而不是读 `dragging` state。
         *   拖拽是一串**跨事件循环**的原生事件，但同一个 tick 里连续派发
         *   dragstart → dragover → drop 时，`setDragging` 还没被 React 提交 ——
         *   那时 state 仍是旧值（null），`onDrop` 就被悄悄吞掉了。
         *   `dataTransfer` 本来就是为"跨事件带数据"设计的，读它两种时序都稳。
         *   （真实拖拽有足够时间提交 state，但依赖时序的代码迟早会在某处翻车。）
         */
        const raw = e.dataTransfer.getData('text/plain')
        const from = raw === '' ? dragging : Number(raw)
        setDragging(null)
        setOver(null)
        if (from !== null && Number.isInteger(from) && from !== i) onDrop(from, i)
      },
      onDragEnd: () => {
        setDragging(null)
        setOver(null)
      },
    }
  }

  return { dragging, over, bind }
}
