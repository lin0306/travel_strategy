/**
 * 移动端的「图层」浮层 —— 触点是右下角工具条那枚 `layers` 图标。
 *
 * ## 与详情 / 规划**同一个基座**（2026-10-27 用户定）
 * 用户原话：「你看要不要设置一个通用的基础组件，其他浮窗都用这个浮窗基座，这样效果
 * 保持统一，图层这个在移动端的展示，也可以用这个浮窗组件」。
 * ⇒ 这里没有一处自己的定位/圆角/投影/关闭按钮，全部来自 `mobile/ui/Sheet`。
 *
 * ## ★★ 但尺寸是**自由拉伸**，不是三档（2026-10-28 用户改）
 * 原话：「这个浮层，不做固定三个大小，改成用户默认拉，限制最大高度和最小高度，
 * 往下拉到一定程度触发隐藏，第二个是往下拉的速度，这个能监听吗，如果可以的话，
 * 速度过快也直接隐藏」。
 * 图层是一张**固定高度的短表单**（2 条底图 + 一条详细度 + 3 个开关），三档里有两档
 * 都用不上 —— 拉到 `peek` 只看得见标题，拉到 `full` 又空出半屏白。所以换成
 * `size={{min, max, initial}}`：拖到哪停哪，松手记住，拖过 `min` 或快速下甩即收起。
 *
 * ## ★ 标题不再带副标题
 * 原来 `SheetHead sub={basemapLabel(value)}` 写的是当前底图名（"矢量图"），
 * 而下面第一条选项就是「矢量图」并打着勾 —— 同一屏说两遍
 * （用户 2026-10-28：「这个标题的副标题不需要」）。
 *
 * ## ★ 为什么它不在 `common/ui/BasemapMenu.tsx` 里了
 * 它要 `mobile/ui/Sheet`，而 `common/` 不许 import `mobile/`（分层护栏 W）。
 * 原来那版挂在 `common/` 上是靠 `ModalScrim` 自己拼出来的居中卡 —— 也就必然
 * 与详情浮层的形态对不上（一个是"贴底的浮窗"，一个是"可以拖的浮层"）。
 * 现在内容仍在 `common`（`BasemapPanelBody`），壳在 `mobile`，桌面气泡一份、
 * 移动浮层一份，**选项一个字都没有抄**。
 *
 * ## 门 / 内容两截
 * 与 `RoutePlanPanel` 同一条纪律：尺寸状态必须活在"关了就会卸载"的那一层 ——
 * 否则"上次拉到的位置、关掉再打开还是那个位置"。
 */

import { BasemapPanelBody, basemapPartsOf, type BasemapMenuProps } from '~/common/ui/BasemapMenu'
import { type BasemapState } from '~/common/map/tencent'
import { Sheet, SheetHead, SHEET_FREE_SVH } from '~/mobile/ui/Sheet'
import { useSheetClaim } from '~/mobile/ui/sheetHub'

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

/** 内容：每次打开都是新实例，所以永远从 `SHEET_FREE_SVH.initial` 开始 */
function SheetBody({
  value,
  onClose,
  onKind,
  onLevel,
  onToggle,
}: Omit<BasemapMenuProps, 'value'> & { value: BasemapState; onClose: () => void }) {
  const { kind, level, checked } = basemapPartsOf(value)

  // 占据浮层位：把还开着的详情 / 规划关掉（用户：「同时只显示一个」）
  useSheetClaim('layers', onClose)

  return (
    <Sheet size={SHEET_FREE_SVH} label="图层设置" onClose={onClose} header={<SheetHead title="图层" />}>
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
