import { useMemo, useState } from 'react'

import { Icon } from '~/common/ui/Icon'
import { EmptyState } from '~/common/ui/Overlay'
import { ModalScrim } from '~/common/ui/ModalScrim'
import type { ItineraryState } from '~/common/logic/itinerary/store'
import type { City } from '~shared/schema'

/**
 * 住宿点选择器 —— 三路输入。
 *
 * ## 三路输入各自的现实约束
 * | 路径 | 是否需要地图服务 | 状态 |
 * |------|----------------|------|
 * | 从点位里选 | 否 | ✅ 从该城市的 POI 里挑一个当锚 |
 * | 地图点选 | 否（用视野中心） | ✅ 用户把地图挪到住处，再点「用地图中心」 |
 * | 地址搜索 | **是**（地理编码） | ⏳ 需要地图 key，未接入时**不给假输入框** |
 *
 * ### 为什么没有"输入地址搜索"那个框
 * 一个点了没反应、或者输进去永远搜不出结果的输入框，比**明确没做**更糟 ——
 * 用户会以为是自己输错了地址。所以这一路留到地理编码接通再放出来。
 *
 * ## 覆盖天数这一栏是多住宿段的入口
 * 「中途换酒店」不是另一个功能，它就是**再建一个住宿段**：
 * 第一个覆盖第 1–2 天，第二个覆盖第 3–4 天。所以这里要能选范围。
 *
 * ⚠️ 住宿点只存本机、不进 URL（09 文档 3.3），所以这一屏没有任何"保存到云端"的字样。
 */
export function StayPicker({
  city,
  store,
  onClose,
  onDone,
  onUseCenter,
}: {
  city: City | null
  store: ItineraryState
  onClose: () => void
  onDone: (name: string) => void
  onUseCenter: (fromDay: number, toDay: number) => void
}) {
  const [q, setQ] = useState('')
  const [fromDay, setFromDay] = useState(store.activeDay)
  const [toDay, setToDay] = useState(store.activeDay)

  const maxDay = store.days.length
  const clamp = (n: number) => Math.max(1, Math.min(maxDay, n))

  const list = useMemo(() => {
    const kw = q.trim()
    const pois = city?.pois ?? []
    const hit = kw ? pois.filter((p) => p.name.includes(kw) || p.summary.includes(kw)) : pois
    // 住处常在地标/街区附近，所以**不按细类筛**，直接取前 40 个让用户自己认
    return hit.slice(0, 40)
  }, [city, q])

  const submit = (name: string, lng: number, lat: number, ref?: { poiId?: string }) => {
    store.addStay({
      name,
      lng,
      lat,
      // 来源如实记：'poi' = 从点位选的，'picked' = 用户自己点的位置
      source: ref?.poiId ? 'poi' : 'picked',
      ...(ref?.poiId ? { ref } : {}),
      fromDay,
      toDay: Math.max(fromDay, toDay),
    })
    onDone(name)
  }

  return (
    /*
     * ⚠️ 遮罩这一层**用不了 `Overlay`** —— `.flt` 的 `background: var(--color-surface)`
     *    是未分层的 CSS，会盖过 Tailwind 的 `bg-black/30`（工具类在 layer 里，优先级更低）。
     *    结果是遮罩变成一块纯白浮层，什么都看不见。理由与踩坑记录见 `ModalScrim` 文件头。
     * ★ 2026-10-16 两处修正：
     *   ① 底板统一换成 `ModalScrim`，色值/定位/层级与另两个模态一致（原来是 `absolute` + `bg-black/30`）；
     *   ② **去掉了 `data-overlay`** —— 那条属性是给 `fitView` 算"地图可用区"用的，
     *      而遮罩是**临时遮挡**（开着的时候用户在这个弹窗里，不在看地图）。
     *      之前留着会让下一次 `fit` 误以为遮罩是常驻面板、把点位挤到一侧。
     */
    <ModalScrim>
      <div
        className="flt flt-in flex h-full max-h-[640px] w-full max-w-[520px] flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="设置住宿点"
      >
        <div className="flex flex-none items-center justify-between gap-2 border-b border-line px-4 py-3">
          <b className="text-[15px] font-semibold">设置住宿点</b>
          <button type="button" onClick={onClose} aria-label="关闭" className="text-ink-2 hover:text-ink">
            <Icon name="close" size="md" />
          </button>
        </div>

        {/* 覆盖天数：多住宿段的入口。中途换酒店就是在这里再建一段 */}
        <div className="flex flex-none flex-wrap items-center gap-2 px-4 py-2.5">
          <span className="text-[12.5px] text-ink-2">从第</span>
          <input
            type="number"
            min={1}
            max={maxDay}
            value={fromDay}
            onChange={(e) => setFromDay(clamp(Number(e.target.value) || 1))}
            aria-label="起始天"
            className="h-8 w-14 rounded-lg border border-line px-2 text-center text-[13px]"
          />
          <span className="text-[12.5px] text-ink-2">天住到第</span>
          <input
            type="number"
            min={1}
            max={maxDay}
            value={toDay}
            onChange={(e) => setToDay(clamp(Number(e.target.value) || 1))}
            aria-label="结束天"
            className="h-8 w-14 rounded-lg border border-line px-2 text-center text-[13px]"
          />
          <span className="text-[12.5px] text-ink-2">天</span>
          <span className="ml-auto text-[11px] text-ink-2">仅存本机</span>
        </div>

        {store.stays.length > 0 ? (
          <div className="flex-none px-4 pb-1">
            <p className="m-0 text-[11px] leading-relaxed text-ink-2">
              已有 {store.stays.length} 个住宿段：
              {store.stays
                .map((s) => `${s.name}（第 ${s.fromDay}–${s.toDay} 天）`)
                .join('、')}
            </p>
          </div>
        ) : null}

        <div className="flex flex-none gap-2 px-4 pb-2.5 pt-1">
          <div className="flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-line px-2.5">
            <Icon name="search" size="sm" className="flex-none text-ink-2" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="在该城市的点位里找"
              aria-label="搜索点位"
              className="h-full min-w-0 flex-1 border-0 bg-transparent text-[13px] outline-none"
            />
          </div>
        </div>

        <div className="scroll min-h-0 flex-1 px-2 pb-2">
          {list.length === 0 ? (
            <EmptyState
              icon={<Icon name="search" size="xl" />}
              title="没有匹配的点位"
              detail="可以把范围放宽一些，或先把想住的片区加到行程里再选。"
            />
          ) : (
            list.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() =>
                  submit(`${p.name}附近`, p.location.point.lng, p.location.point.lat, { poiId: p.id })
                }
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-bg"
              >
                <Icon name="pin" size="sm" className="flex-none text-ink-2" />
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-[13px] font-medium">{p.name}附近</b>
                  <span className="block truncate text-[11px] text-ink-2">{p.location.address}</span>
                </span>
                <Icon name="chev-right" size="sm" className="flex-none text-ink-2/50" />
              </button>
            ))
          )}
        </div>

        {/* 地图点选这一路：用「当前视野中心」当住宿点。
            不是读取设备定位 —— 中心点取决于用户自己把地图挪到了哪 */}
        <div className="flex flex-none items-center gap-2 border-t border-line px-4 py-3">
          <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-ink-2">
            也可以把地图挪到住处，然后用当前视野中心当住宿点。
          </span>
          <button
            type="button"
            onClick={() => {
              onUseCenter(fromDay, Math.max(fromDay, toDay))
              onDone('地图点选的位置')
            }}
            className="inline-flex h-9 flex-none items-center gap-1.5 rounded-lg border border-line px-3 text-[12.5px] hover:border-primary hover:text-primary"
          >
            <Icon name="locate" size="sm" />
            用地图中心
          </button>
        </div>
      </div>
    </ModalScrim>
  )
}
