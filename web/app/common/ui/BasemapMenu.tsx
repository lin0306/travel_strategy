/**
 * 底图菜单 —— 顶栏右侧那个「矢量图 · 详细 ▾」。
 *
 * ## 面板里为什么是「类型 + 详细度 + 逐项开关」三段（2026-09-25 改）
 * 上一版是 4 档平铺预设。它把**两个正交的维度**压成了一条清单：类型（矢量/影像）
 * 与详细度（要不要注记）本来是两个问题，用户却要在四个平级选项里挑组合 ——
 * 而且组合会随维度相乘，再加一档就没法看了。现在拆回两个维度。
 *
 * 第三段（逐项开关）是"简略 / 详细"的下沉：那两个按钮只是"全开 / 全关"的快捷档，
 * 中间状态由用户自己勾 —— 这就是用户说的「后期有些应该是可以单独控制的」，
 * 只不过现在就做出来了（结构上本来就是一回事，分开做反而要改两次）。
 *
 * ## ★ 一个必须写在界面上的限制
 * 面板底部那行小字不是装饰：用户问过「能不能单独控制只显示地铁 / 超市 / 区划」，
 * 而**腾讯做不到** —— 道路、地铁线、区划边界全在底面 `base` 里，地铁站与超市名
 * 全在 `point` 一个开关里。不写这一行，用户会一直以为是我们没做。
 * 依据见 `basemap.ts` 文件头那张实测对照表。
 *
 * ## 与 `RegionPicker` 同一套交互规矩
 * 点外部 / Esc 都关闭；每次打开不复用上次位置。只做"点触发按钮再点一次关闭"是不够的：
 * 鼠标移到地图上第一反应是点一下，而那一下会被吃掉。
 */

import { useEffect, useState } from 'react'

import { Icon } from '~/common/ui/Icon'
import { BasemapThumb } from '~/common/ui/BasemapThumb'
import { useDismiss } from '~/common/ui/useDismiss'
import {
  BASEMAP_KINDS,
  BASEMAP_LEVEL_LABEL,
  basemapLabel,
  detailsOfKind,
  levelOf,
  type BasemapDetailId,
  type BasemapKind,
  type BasemapLevel,
  type BasemapState,
} from '~/common/map/tencent'

export interface BasemapMenuProps {
  /** 当前状态。`null` = 地图还没就绪（此时禁用，而不是显示一个假的当前值） */
  value: BasemapState | null
  onKind: (kind: BasemapKind) => void
  onLevel: (level: BasemapLevel) => void
  onToggle: (id: BasemapDetailId) => void
}

/** 面板宽。要放得下「缩略图 + 开关名 + 一行说明」 */
const PANEL_W = 'w-[320px]'

export function BasemapMenu({ value, onKind, onLevel, onToggle }: BasemapMenuProps) {
  const [open, setOpen] = useState(false)
  // 「点外面 / Esc 关闭」走共用实现（`useDismiss`）—— 与规划行的「⋯」菜单同一份
  const wrapRef = useDismiss(open, () => setOpen(false))
  const disabled = value === null

  // 地图未就绪时不该停在一个展开的面板上
  // （换路由会重建地图，那一刻 value 变 null，面板却还挂在屏幕上）
  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  const label = value ? basemapLabel(value) : '底图'
  const level = value ? levelOf(value) : null
  const kind: BasemapKind = value?.kind ?? 'vector'
  const details = detailsOfKind(kind)
  const checked = value?.details[kind] ?? []

  return (
    <div ref={wrapRef} className="relative flex-none">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`选择底图，当前为${label}`}
        className="inline-flex h-[34px] flex-none items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12.5px] text-ink transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Icon name="layers" size="sm" className="flex-none text-ink-2" />
        <span className="whitespace-nowrap">{label}</span>
        <Icon name={open ? 'chev-up' : 'chev-down'} size="sm" className="flex-none text-ink-2" />
      </button>

      {open && value ? (
        <div
          role="menu"
          aria-label="选择底图"
          className={`absolute top-[calc(100%+6px)] right-0 z-40 ${PANEL_W} overflow-hidden rounded-xl border border-line bg-surface pb-1 shadow-[0_12px_36px_rgba(16,24,40,.16)]`}
        >
          {/* ① 底图类型 */}
          <p className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-ink-2/70">
            底图
          </p>
          {BASEMAP_KINDS.map((k) => {
            const on = k.id === kind
            return (
              <button
                key={k.id}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                onClick={() => onKind(k.id)}
                className={`flex w-full items-start gap-2 px-3 py-2 text-left transition-colors ${
                  on ? 'bg-primary/10' : 'hover:bg-line-2'
                }`}
              >
                {/* ★ 缩略图：这两种底图差在哪，看图比读说明快（自绘 SVG，见 BasemapThumb） */}
                <BasemapThumb
                  kind={k.id}
                  className="mt-0.5 h-[28px] w-[40px] flex-none rounded-[5px] ring-1 ring-line"
                />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-[12.5px] text-ink ${on ? 'font-semibold' : ''}`}>
                    {k.label}
                  </span>
                  {/* 说明是**陈述句**：告诉用户这一档是什么，不替用户做决定 */}
                  <span className="mt-0.5 block text-[11px] leading-snug text-ink-2">{k.hint}</span>
                </span>
                {on ? <Icon name="check" size="sm" className="mt-0.5 flex-none text-primary" /> : null}
              </button>
            )
          })}

          <div aria-hidden="true" className="mx-2 my-1 h-px bg-line" />

          {/* ② 详细度快捷档 —— 「全部翻开的那两个按钮就是它」 */}
          <div className="flex items-center justify-between px-3 pt-0.5 pb-1">
            <p className="text-[11px] font-semibold tracking-wide text-ink-2/70">详细度</p>
            <div
              role="group"
              aria-label="详细度"
              className="flex items-center gap-0.5 rounded-md border border-line p-0.5"
            >
              {(['plain', 'full'] as const).map((lv) => {
                const on = level === lv
                return (
                  <button
                    key={lv}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onLevel(lv)}
                    className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                      on ? 'bg-primary/10 font-semibold text-primary' : 'text-ink-2 hover:bg-line-2'
                    }`}
                  >
                    {BASEMAP_LEVEL_LABEL[lv]}
                  </button>
                )
              })}
            </div>
          </div>

          {/* ③ 逐项开关。★ 选项来自引擎层的表，这里一个都不写死 */}
          {details.map((d) => {
            const on = checked.includes(d.id)
            return (
              <button
                key={d.id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                onClick={() => onToggle(d.id)}
                className="flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors hover:bg-line-2"
              >
                <span
                  aria-hidden="true"
                  className={`mt-[3px] grid size-[14px] flex-none place-items-center rounded-[4px] border transition-colors ${
                    on ? 'border-primary bg-primary text-surface' : 'border-line bg-surface'
                  }`}
                >
                  {on ? <Icon name="check" size="sm" className="scale-[0.72]" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-ink">{d.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-ink-2">{d.hint}</span>
                </span>
              </button>
            )
          })}

          <div aria-hidden="true" className="mx-2 my-1 h-px bg-line" />
          {/* ★ 这行是**产品事实**，不是免责声明：用户问过能不能单独关地铁/超市，腾讯不行 */}
          <p className="px-3 pt-0.5 pb-1 text-[11px] leading-snug text-ink-2/80">
            道路、地铁线与区划边界属于底面，腾讯不提供单独开关。
          </p>
        </div>
      ) : null}
    </div>
  )
}
