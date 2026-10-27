/**
 * 移动端的「图层」浮层 —— 触点就是右上角工具条那枚 `layers` 图标。
 *
 * ## 与详情 / 规划**同一个基座**（2026-10-27 用户定）
 * 用户原话：「你看要不要设置一个通用的基础组件，其他浮窗都用这个浮窗基座，这样效果
 * 保持统一，图层这个在移动端的展示，也可以用这个浮窗组件」。
 * ⇒ 这里没有一处自己的定位/圆角/投影/关闭按钮，全部来自 `mobile/ui/Sheet`：
 * 三档可拖、往下拉过阈值收起、点浮层外面也收起。
 *
 * ## ★ 为什么它不在 `common/ui/BasemapMenu.tsx` 里了
 * 它要 `mobile/ui/Sheet`，而 `common/` 不许 import `mobile/`（分层护栏 W）。
 * 原来那版挂在 `common/` 上是靠 `ModalScrim` 自己拼出来的居中卡 —— 也就必然
 * 与详情浮层的形态对不上（一个是"贴底的浮窗"，一个是"可以拖的浮层"）。
 * 现在内容仍在 `common`（`BasemapPanelBody`），壳在 `mobile`，桌面气泡一份、
 * 移动浮层一份，**选项一个字都没有抄**。
 *
 * ## 门 / 内容两截
 * 与 `RoutePlanPanel` 同一条纪律：`tier` 必须活在"关了就会卸载"的那一层 ——
 * 否则"上次拖到 full、关掉再打开还是 full"。
 */

import { useState } from 'react'

import { BasemapPanelBody, basemapPartsOf, type BasemapMenuProps } from '~/common/ui/BasemapMenu'
import { basemapLabel, type BasemapState } from '~/common/map/tencent'
import { Sheet, SheetHead, type SheetTier } from '~/mobile/ui/Sheet'

export function BasemapSheet({
  open,
  onClose,
  value,
  onKind,
  onLevel,
  onToggle,
}: BasemapMenuProps & { open: boolean; onClose: () => void }) {
  if (!open || !value) return null
  return <SheetBody value={value} onClose={onClose} onKind={onKind} onLevel={onLevel} onToggle={onToggle} />
}

/** 内容：每次打开都是新实例，所以永远从 `half` 开始 */
function SheetBody({
  value,
  onClose,
  onKind,
  onLevel,
  onToggle,
}: Omit<BasemapMenuProps, 'value'> & { value: BasemapState; onClose: () => void }) {
  const [tier, setTier] = useState<SheetTier>('half')
  const { kind, level, checked } = basemapPartsOf(value)

  return (
    <Sheet
      tier={tier}
      onTier={setTier}
      label="图层设置"
      onClose={onClose}
      header={<SheetHead title="图层" sub={basemapLabel(value)} />}
    >
      <div className="pb-2">
        <BasemapPanelBody
          kind={kind}
          level={level}
          checked={checked}
          onKind={onKind}
          onLevel={onLevel}
          onToggle={onToggle}
        />
      </div>
    </Sheet>
  )
}
