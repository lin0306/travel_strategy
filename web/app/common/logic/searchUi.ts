/**
 * 「移动端搜索页」的开关 —— 一个字段的极简 store。
 *
 * ## 为什么需要一条信道
 * 触发点在**顶栏**（`common/ui/TopBar.tsx`），而搜索页必须挂在**外壳的浮层区**
 * （`routes/map-shell.tsx`）：
 * 1. 它要 `useMapShell()`（`useSearch.pick` 里飞镜头），所以必须在外壳 Provider **内**；
 * 2. 顶栏是 `anchor='top'` 的浮层，挂在它内部会被 52px 高的顶栏裁掉。
 *
 * 两点在不同子树 ⇒ 一条极简信道。★ 写法与 `docUi` / `planUi` 一致，
 * 读者不必为本项目再学第三套状态约定。
 *
 * ## 为什么不复用 `docUi`
 * 那两个字段可以合进一个 `uiChrome`，但"关于弹窗"与"搜索页"的开关时机、关闭条件
 * （前者点遮罩、后者选中即关）完全不同，合在一起只会让两个组件互相读到无关字段。
 */

import { create } from 'zustand'

export interface SearchUiState {
  /** 移动端搜索页是否开着 */
  open: boolean
  openSearch: () => void
  closeSearch: () => void
}

export const useSearchUi = create<SearchUiState>((set) => ({
  open: false,
  openSearch: () => set({ open: true }),
  closeSearch: () => set({ open: false }),
}))
