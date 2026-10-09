/**
 * 省级视图的「下辖城市清单」—— 两端共用同一份。
 *
 * ## 判据是"是否已收录"，不是"有没有景点"
 * 已收录（`cityId !== null`）点得进去；未收录显示「待收录 —」并给出为什么。
 * 两组分开列，因为它们回答的是两个问题：**哪些现在能玩** / **还剩哪些没做**。
 *
 * ## ★ 两个计数必须分开显示
 * 「已收录 1 / 共 21 个市」—— 前者是**进度**，后者是**区划事实**。
 * 只显示"1 个市"会让用户以为四川只有 1 个市；只显示"21 个"又会让他以为点进去都有内容。
 * 那行汇总由两端外壳各自排版（尺寸不同），所以只在这一份里的是**每一行的写法**。
 *
 * ★ `null ≠ 0`：未收录写「待收录 —」，绝不写成「0 个」
 *   —— 那是在说"这儿没有可玩的地方"，而事实是我们还没做。
 */

import { Icon } from '~/common/ui/Icon'
import { EmptyState, SectionLabel } from '~/common/ui/Overlay'
import type { CityRow, ProvinceDetail } from '~/common/data/regions'

export function ProvinceList({
  detail,
  onPick,
}: {
  detail: ProvinceDetail | null
  onPick: (cityId: string) => void
}) {
  if (detail === null) {
    return (
      <div className="flex items-center gap-2 px-3.5 py-6 text-[13px] text-ink-2">
        <span className="size-3.5 flex-none animate-spin rounded-full border-2 border-line border-t-primary" />
        加载中…
      </div>
    )
  }

  if (detail.province === null) {
    return (
      <EmptyState
        icon={<Icon name="alert" size="xl" />}
        title="没有这个省级单位"
        detail="该 adcode 不在 34 个省级单位清单里，可能是链接被改过。请从首页重新进入。"
      />
    )
  }

  if (detail.cities.length === 0) {
    return (
      <EmptyState
        icon={<Icon name="pin" size="xl" />}
        title={detail.hasTree ? '本级暂无下辖区划' : '区划数据尚未生成'}
        detail={
          detail.hasTree
            ? '该省级单位没有下辖的地级单位数据。'
            : '跑完数据流水线后，这里会列出该省的下辖城市与各自的收录情况。'
        }
      />
    )
  }

  const grouped = detail.cities.filter((c) => c.cityId !== null)
  const rest = detail.cities.filter((c) => c.cityId === null)

  return (
    <div className="pb-3">
      {grouped.length > 0 ? (
        <>
          <SectionLabel>已收录</SectionLabel>
          {grouped.map((c) => (
            <CityRowItem key={c.adcode} row={c} onPick={onPick} />
          ))}
        </>
      ) : null}
      {rest.length > 0 ? (
        <>
          <SectionLabel>待收录</SectionLabel>
          {rest.map((c) => (
            <CityRowItem key={c.adcode} row={c} onPick={onPick} />
          ))}
        </>
      ) : null}
    </div>
  )
}

function CityRowItem({ row, onPick }: { row: CityRow; onPick: (cityId: string) => void }) {
  const pending = row.cityId === null
  return (
    <button
      type="button"
      onClick={() => (pending ? undefined : onPick(row.cityId!))}
      disabled={pending}
      className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left ${
        pending ? 'cursor-default opacity-70' : 'hover:bg-bg'
      }`}
    >
      <span
        aria-hidden="true"
        className="size-2.5 flex-none rounded-[3px]"
        style={{
          background: pending ? 'var(--color-density-0)' : 'var(--color-density-2)',
          border: pending ? '1px dashed #B4B2A9' : '1px solid rgba(16,24,40,.14)',
        }}
      />
      <span className="min-w-0 flex-1 truncate text-[13.5px]">{row.name}</span>
      <span className={`flex-none text-[11.5px] ${pending ? 'text-ink-2' : 'text-ink'}`}>
        {pending ? '待收录 —' : `${row.poiCount} 个`}
      </span>
      {!pending ? <Icon name="chev-right" size="sm" className="flex-none text-ink-2/50" /> : null}
    </button>
  )
}
