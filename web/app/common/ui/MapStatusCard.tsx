/**
 * 地图状态卡 —— 加载中 / 未配置 key / 加载失败的统一呈现。
 *
 * ## 设计原则：**绝不遮挡整页**
 * 它是一张浮在**顶端偏右**的窄卡，不是全屏遮罩。原因很实在：
 * 没地图的时候，列表、筛选、详情、三级下钻的区划列表、行程的时间计算
 * **全都还能用**。用全屏遮罩把这些一起盖掉，等于把"部分降级"做成"完全不可用"。
 *
 * ## ★ 它与瞬时提示的分工（2026-10-16 用户报「提示到处挂，没统一」）
 * 改之前三条提示分处**底部居中**（`PlanToast`）、**顶部居中**（`PickingHint`）、
 * **顶栏下方右侧**（本卡）三个位置。用户选了**全部上顶部**，于是本卡归到
 * **顶端偏右**这一档，与居中的瞬时提示（`ToastStack`）分列两侧。
 *
 * ★ **它的位置其实一直没动过**（本来就是 `--rail-top`，在顶栏下方而非屏幕右上角）——
 *   真正改位置的是另两条。写在这里是为了让下一个人读得懂"为什么它不并进 ToastStack"。
 *
 * ## 为什么**不并进** `ToastStack`
 * | | 本卡 | `ToastBar` |
 * |--|------|-----------|
 * | 生命周期 | **常驻**，不自动消失 | 瞬时，自动消失 |
 * | 可交互 | 有 key 输入框 + 重试按钮 | 只读，可能带一个动作 |
 *
 * 硬并成一个组件会得到"既要自动消失又能输入"的东西。所以**并排而不是合并**。
 *
 * ## 三种状态三套文案
 * | 状态 | 文案重点 |
 * |------|---------|
 * | `loading` | 一句话，不解释 |
 * | `no-key` | **给动作**：怎么申请、填哪里（fork 者第一次跑就是这一步） |
 * | 其它失败 | 给**原因 + 重试**：超时多是网络抖动，值得给一次机会 |
 */

import { useState } from 'react'

import { KEY_APPLY_URL, KEY_SETUP_HINT, saveUserKey } from '~/common/map/tencent'
import type { MapFailure, MapStatus } from '~/common/map/tencent'

export interface MapStatusCardProps {
  status: MapStatus
  failure: MapFailure | null
  onRetry: () => void
}

export function MapStatusCard({ status, failure, onRetry }: MapStatusCardProps) {
  const [keyDraft, setKeyDraft] = useState('')
  const [showKeyForm, setShowKeyForm] = useState(false)

  if (status === 'ready') return null

  const isNoKey = failure?.code === 'no-key'

  return (
    <div
      className="flt flt-in absolute z-40 w-[300px] p-3.5"
      // ★ 顶端偏右，与居中的瞬时提示（`ToastStack`）分列两侧。
      //   它比提示宽且常驻，居中会顶到搜索框；贴最右则两者互不遮挡。
      style={{ top: 'var(--rail-top)', right: 'var(--flt-inset)' }}
      data-overlay=""
      role="status"
    >
      {status === 'loading' ? (
        <div className="flex items-center gap-2.5">
          <span className="size-3.5 flex-none animate-spin rounded-full border-2 border-line border-t-primary" />
          <span className="text-[13px] text-ink-2">地图加载中 · 下方的列表与详情不受影响</span>
        </div>
      ) : (
        <>
          <div className="flex items-start gap-2">
            <span
              className="mt-px size-4 flex-none rounded-full text-center text-[11px] leading-4 font-bold text-white"
              style={{ background: isNoKey ? '#1677FF' : '#E8672F' }}
              aria-hidden="true"
            >
              !
            </span>
            <div className="min-w-0">
              <p className="m-0 text-[13px] font-semibold">
                {isNoKey ? '地图未解锁' : '地图暂时不可用'}
              </p>
              <p className="mt-1 mb-0 text-xs leading-relaxed text-ink-2">
                {isNoKey
                  ? KEY_SETUP_HINT
                  : `${failure?.text ?? '未知原因'} · 其余功能照常可用`}
              </p>
            </div>
          </div>

          {/* no-key：给一条自助路径。fork 者第一次跑就是卡在这一步 */}
          {isNoKey ? (
            <div className="mt-3">
              {showKeyForm ? (
                <div className="flex gap-1.5">
                  <input
                    value={keyDraft}
                    onChange={(e) => setKeyDraft(e.target.value)}
                    placeholder="粘贴你的腾讯 key"
                    aria-label="腾讯地图 key"
                    className="h-8 min-w-0 flex-1 rounded-lg border border-line px-2 text-xs outline-none focus:border-primary"
                  />
                  <button
                    type="button"
                    className="h-8 flex-none rounded-lg bg-primary px-3 text-xs font-medium text-white"
                    onClick={() => {
                      if (keyDraft.trim()) {
                        saveUserKey(keyDraft)
                        // key 存在 localStorage，重新走一次加载即可生效
                        onRetry()
                      }
                    }}
                  >
                    保存
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="h-8 rounded-lg bg-primary px-3 text-xs font-medium text-white"
                    onClick={() => setShowKeyForm(true)}
                  >
                    填入我的 key
                  </button>
                  <a
                    href={KEY_APPLY_URL}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-xs text-primary no-underline"
                  >
                    去申请（免费）
                  </a>
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              className="mt-3 h-8 rounded-lg border border-line px-3 text-xs font-medium hover:border-primary hover:text-primary"
              onClick={onRetry}
            >
              重试
            </button>
          )}

          <p className="mt-2.5 mb-0 text-[11px] leading-snug text-ink-2/80">
            没有地图时，区划列表、点位筛选、详情与行程时间计算依然完整可用。
          </p>
        </>
      )}
    </div>
  )
}
