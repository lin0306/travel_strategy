/**
 * 地图显示日志浮层 —— 「哪个缩放级别显示了什么」的现场记录。
 *
 * ## 它为什么存在
 * 「缩放 ↔ 显示」出了问题，用户能说出来的只有现象（"标签重叠""该消失的不消失"），
 * 而开发者需要的是**数字**：当时停在哪个缩放、判据层级是哪一个、屏幕上是几个徽标
 * 几个圆点几个名字。这份面板把那些数字摆在用户眼前，让他可以直接念出来 / 复制出来。
 *
 * ## 三条设计约束
 * 1. **不参与取景** —— 刻意**不用** `Overlay` 组件：那个组件会带 `data-overlay=""`，
 *    而 `fitView.ts` 靠这个属性实测"哪里被浮层盖住了"。调试面板去吃地图的可用区，
 *    会把取景结果改掉 —— 拿有副作用的东西去观测，观测本身就污染了对象。
 * 2. **默认不占地方** —— 折叠成一枚小胶囊（桌面在右下角、移动端在右上角，
 *    见下方容器那段注释）。它不是产品功能，是诊断工具，不该在用户看地图时抢注意力。
 * 3. **只存在于开发环境** —— 生产构建里**没有任何开关能打开它**（见 `shouldShow`）。
 *
 * ## 读的是 store 而不是 props
 * 日志由图层在重绘后写入（`lib/mapLog.ts`），与 React 渲染不同步，也不该同步
 * ——它记的是**地图**的状态，不是某个组件的状态。所以走 `useSyncExternalStore`。
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

import {
  clearMapLog,
  getMapLog,
  getMapLogServerSnapshot,
  mapLogToText,
  subscribeMapLog,
  warningsOf,
  type MapLogEntry,
} from '~/common/logic/mapLog'
import type { MapLevel } from '~/common/map/tencent'

/** 层级的中文单字。与 `mapLog` 的文本导出保持同一套说法 */
const LEVEL_CN: Record<MapLevel, string> = { province: '省', city: '市', district: '区', poi: '点' }

/**
 * 要不要显示这个面板 —— **只认构建期常量**。
 *
 * ## ★ `?dbg` 后门已删（2026-10-27 用户定）
 * 用户原话：「底部那个日志，在开发模式显示，生产模式不显示」。
 * 之前线上留了一条 `?dbg` 路径（理由是"真机出问题时让用户加个参数就能取现场"），
 * 但那条路径的代价是**线上永远存在一块不属于产品的浮层**：任何拿到链接的人
 * 都能打开它，而它盖在真地图上、随时可能被截图当成产品的一部分。
 * 真机取现场改走开发构建（`run.py` 起的 dev server 就是 DEV）。
 *
 * ★ `import.meta.env.DEV` 在构建期被静态替换成 `false`，整个面板连同这段判断
 *   一起从产物里消失 —— 不是"运行时隐藏"，是**根本没有这段代码**。
 */
function shouldShow(): boolean {
  return import.meta.env.DEV
}

export function MapLogPanel() {
  // 只算一次 —— URL 参数在会话中途不会变，没必要每次渲染都读
  const [enabled] = useState(shouldShow)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const entries = useSyncExternalStore(subscribeMapLog, getMapLog, getMapLogServerSnapshot)

  const copy = useCallback(() => {
    const text = mapLogToText(entries)
    void navigator.clipboard
      .writeText(text)
      .then(() => setCopied(true))
      // 剪贴板被浏览器策略挡住（非安全上下文）时不要静默失败 ——
      // 用户会以为"复制了"，粘过去却是空的
      .catch(() => setCopied(false))
  }, [entries])

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(t)
  }, [copied])

  if (!enabled) return null

  const latest = entries[entries.length - 1] ?? null

  return (
    // 容器本身不吃事件（`pointer-events-none`），只有面板与按钮吃 ——
    // 否则这块右下角会变成"拖不动地图"的死区
    /*
      ★★ `z-[27]`（2026-10-25 修）：原来写的是 `z-[60]`，而移动端 Sheet 是 `z-28`
         ⇒ 这枚诊断胶囊**压在 Sheet 之上**，实测挡住详情页的「添加行程」和城市页的
         「热门优先」。它是诊断工具，不该盖住产品操作 —— 降到 Sheet 之下，
         Sheet 收起（peek）时才露出来，打开时被盖住正好。
      ★★ 位置按端别分家（2026-10-27，三轮）：移动端**右下角**是四枚工具图标
         （`mobile/ui/MapTools`，它会跟着浮层上移，占满整条右下的地图区）——
         胶囊只能去**左上**。展开方向跟着翻（`flex-col-reverse`：按钮在上、面板向下展开）。
         （第一版放在右上，实测正好压住工具条最上面那枚「路线规划」，截图才看出来。
           工具条后来按用户要求挪回右下角，左上这条判据不变。）
      ⚠️ 别为了"看得见"再往上调 z：它自己不带 `data-overlay`（见文件头约束 1），
         也就是说它**不参与取景避让**，压住内容时没有任何补偿机制。
    */
    <div className="pointer-events-none absolute top-[calc(var(--flt-inset)+var(--topbar-h))] left-[var(--flt-inset)] z-[27] flex flex-col-reverse items-start gap-2 md:top-auto md:right-[var(--flt-inset)] md:bottom-[var(--flt-inset)] md:left-auto md:flex-col md:items-end">
      {open ? (
        <div
          role="dialog"
          aria-label="地图显示日志"
          className="pointer-events-auto flex w-[430px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-[var(--flt-radius)] border border-line bg-surface shadow-[var(--flt-shadow)]"
        >
          <div className="flex flex-none items-center gap-2 border-b border-line px-3 py-2">
            <b className="text-[12.5px] font-semibold text-ink">缩放显示日志</b>
            <span className="text-[11.5px] text-ink-2">{entries.length} 条</span>
            <span className="ml-auto flex flex-none items-center gap-1">
              <button
                type="button"
                onClick={copy}
                aria-label="复制全部日志"
                className="rounded-md border border-line px-2 py-[3px] text-[11.5px] text-ink transition-colors hover:border-primary hover:text-primary"
              >
                {copied ? '已复制' : '复制'}
              </button>
              <button
                type="button"
                onClick={clearMapLog}
                aria-label="清空日志"
                className="rounded-md border border-line px-2 py-[3px] text-[11.5px] text-ink-2 transition-colors hover:border-primary hover:text-primary"
              >
                清空
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="收起日志"
                className="rounded-md px-2 py-[3px] text-[11.5px] text-ink-2 transition-colors hover:text-primary"
              >
                收起
              </button>
            </span>
          </div>

          <div className="scroll max-h-[min(340px,52vh)] min-h-0 overflow-y-auto">
            {entries.length === 0 ? (
              <p className="m-0 px-3 py-4 text-[11.5px] leading-relaxed text-ink-2">
                还没有记录。在地图上放大或缩小一次 —— 内容每变一次就会记一条。
              </p>
            ) : (
              // 最新在上：用户刚做完动作，想看的是刚才那一下
              [...entries].reverse().map((e) => <LogRow key={e.seq} e={e} />)
            )}
          </div>

          <div className="flex-none border-t border-line px-3 py-1.5 text-[11px] text-ink-2">
            点「复制」把这份清单发出来，就能对照着调
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="地图显示日志"
        className="pointer-events-auto inline-flex h-7 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-[11.5px] text-ink-2 shadow-[var(--flt-shadow)] transition-colors hover:text-primary"
      >
        <span className="font-semibold text-ink">日志</span>
        {latest ? (
          <span className="font-mono">
            z={latest.zoom.toFixed(2)} · {LEVEL_CN[latest.level]}
          </span>
        ) : (
          <span>0</span>
        )}
        <span className="rounded-full bg-bg px-1.5 text-[10.5px]">{entries.length}</span>
      </button>
    </div>
  )
}

/** 一行记录。所有数字都是**读数**（见 `lib/mapLog.ts` 的"记的是实际，不是意图"） */
function LogRow({ e }: { e: MapLogEntry }) {
  const warns = warningsOf(e)
  return (
    <div className="border-b border-line/70 px-3 py-2 last:border-b-0">
      <div className="flex items-baseline gap-1.5 text-[11.5px]">
        <b className="font-mono text-ink">z={e.zoom.toFixed(2)}</b>
        <span className="truncate text-ink-2">{e.page}</span>
        <span className="ml-auto flex-none text-ink-2">
          实={LEVEL_CN[e.level]}
          {e.revealed !== e.level ? ` / 判=${LEVEL_CN[e.revealed]}` : ''}
        </span>
      </div>

      <div className="mt-1 font-mono text-[11px] text-ink-2">
        徽标 {e.badges}/{e.pending ? '—' : e.dTotal} · 面 {e.polys} · 点 {e.aTotal}/
        {e.pending ? '—' : e.pTotal} · 簇 {e.clusters}（泡 {e.bubbles}）· 名 {e.labels}
      </div>

      {e.badgeTexts.length > 0 ? (
        <div className="mt-0.5 text-[11px] break-all text-ink-2">
          徽标：{e.badgeTexts.join(' | ')}
        </div>
      ) : null}
      {e.labelTexts.length > 0 ? (
        <div className="mt-0.5 text-[11px] break-all text-ink-2">名字：{e.labelTexts.join(' | ')}</div>
      ) : null}
      {warns.length > 0 ? (
        <div className="mt-0.5 text-[11px] text-[var(--color-food)]">⚠ {warns.join(' · ')}</div>
      ) : null}
    </div>
  )
}
