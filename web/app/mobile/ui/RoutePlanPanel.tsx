/**
 * 移动端的「路线规划」面板容器 —— **底部 Sheet**（08 文档的三档容器）。
 *
 * ## 为什么不能用桌面的右侧浮层
 * `--panel-plan` 是 **360px**，而手机竖屏宽 360~430px —— 铺上去等于整屏被盖住，
 * 地图一点都看不到。而规划面板的价值恰恰是"看着地图上的点位改顺序"。
 * 所以移动端换成底部 Sheet：地图在上面露着，面板在下半屏（三档可拖）。
 *
 * ★ 内容与桌面**同一份**（`RoutePlanPanelBody`）；这里只给容器。
 * ★ 关着时不渲染 —— 理由同桌面版（不留活着的图层与已加载的城市数据）。
 *
 * ★★ **档位状态必须活在"关了就会卸载"的那一层**（2026-09-26，与 `AddToPlanPicker` 同一条）。
 *    组件挂在外壳上常年存在，若把 `tier` 放在它自己身上，`return null` 只是不渲染、
 *    **状态还在** —— 于是"上次拖到 full、关掉再打开还是 full"。用户对这类症状的原话是
 *    「弹窗内容没恢复到之前的状态」，所以这里也按同一条纪律处理：门（只判断开不开）+ 内容
 *    （每次打开都是新实例，永远从 `half` 开始）。
 */

import { useState } from 'react'

import { usePlanUi } from '~/common/logic/itinerary/planUi'
import { RoutePlanPanelBody } from '~/common/ui/plan/RoutePlanPanelBody'
import { Sheet, type SheetTier } from '~/mobile/ui/Sheet'

/** 门：只负责"开不开"，**不持有任何状态**（见文件头） */
export function MobileRoutePlanPanel() {
  const open = usePlanUi((s) => s.panelOpen)
  if (!open) return null
  return <PlanSheet />
}

/** 内容：每次打开都是**全新实例**，所以永远从 `half` 档开始 */
function PlanSheet() {
  /*
   * 默认给 `half` 而不是 `peek`：打开面板的人一定是来做事的（看列表 / 改顺序），
   * `peek` 只能看到一行，他必然要再拖一次。默认档要落在"马上能用"的那一档。
   */
  const [tier, setTier] = useState<SheetTier>('half')

  return (
    /* ★ 不给 `header`：面板正文自己有一行标题（标题 + 条数 + 新建组 + 关闭），
       Sheet 头再写一遍"路线规划"就是在同一屏说两遍同一句话。
       把手本身已经表达了"这是一块可拖的浮层" */
    <Sheet tier={tier} onTier={setTier} label="路线规划">
      <RoutePlanPanelBody />
    </Sheet>
  )
}
