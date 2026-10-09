/**
 * 「关于」弹窗的开关 —— 一个字段的极简 store。
 *
 * ## 为什么需要一条信道（而不是本地 state / context 字段）
 * 触发点在**顶栏**（`common/ui/TopBar.tsx`），而模态必须挂在**外壳的浮层区**
 * （`routes/map-shell.tsx`）—— 不能挂在顶栏内部：顶栏是 `anchor='top'` 的浮层，
 * 它的 `flt-in` 入场动画用的是 transform，而**祖先带 transform 会让 `fixed` 子元素
 * 相对该祖先定位**，模态就被关进 52px 高的顶栏里了。
 *
 * 两点在不同子树 ⇒ 要么给 `MapShellContext` 加字段（可它是"地图外壳能力"，
 * 塞一个文档开关进去会让契约变浑），要么一条极简信道。
 * ★ 写法与 `planUi` 一致 —— 读者不必为本项目再学第二套状态约定。
 */

import { create } from 'zustand'

export interface DocUiState {
  /** 「关于」弹窗是否开着 */
  aboutOpen: boolean
  openAbout: () => void
  closeAbout: () => void
}

export const useDocUi = create<DocUiState>((set) => ({
  aboutOpen: false,
  openAbout: () => set({ aboutOpen: true }),
  closeAbout: () => set({ aboutOpen: false }),
}))
