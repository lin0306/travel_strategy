/**
 * 地域面板 · **区列表**（首页桌面端，点市卡片的「区列表」按钮进来）。
 *
 * ## 为什么是区，而不是直接摊景点
 * 用户提过两种做法，最后选了**显示区**（他的原话：「我感觉显示区可能会好一点」）。
 * 理由与本项目其它四级下钻一致：一座 69 个点位的城市平铺成 69 行，扫不动；
 * 而 13 个区一行一个，既能认路又能看出"哪几个区有货"。
 * 摊景点这件事在城市页已经做得很完整（筛选 / 排序 / 评分），不必在这里再来一份。
 *
 * ## 点一个区会发生什么
 * **只放大，不开卡**：镜头落到 `DISTRICT_DRILL_ZOOM`（12）那一档，景点随之上屏
 * （`POI_REVEAL_ZOOM` 也是 12）。面板留着、这一行高亮 —— 用户还能接着点下一个区。
 * 区没有"自己的介绍"可读，所以不给它一张卡（`regionNav` 文件头同一条）。
 *
 * ★ `poiCount` 这里可以放心显示 0：能走到这个列表的市**一定已收录**，
 *   已收录城市的区分片是**按几何**数出来的真值。未收录的市根本进不到这一屏。
 */

import { useEffect, useState } from 'react'

import { EmptyState } from '~/common/ui/Overlay'
import { Icon } from '~/common/ui/Icon'
import { loadSubdistricts, type SubdistrictRow } from '~/common/data/subdistricts'

export function DistrictList({
  cityAdcode,
  active,
  onPick,
}: {
  /** **市的 adcode**（分片文件名就是它，不是 slug） */
  cityAdcode: string
  active: string | null
  onPick: (row: SubdistrictRow) => void
}) {
  /** `undefined` = 还在读；`null` = 这份分片不存在（step8 没跑 / 这座城不在抓取范围） */
  const [rows, setRows] = useState<SubdistrictRow[] | null | undefined>(undefined)

  useEffect(() => {
    let alive = true
    setRows(undefined)
    if (!cityAdcode) return
    void loadSubdistricts(cityAdcode).then((r) => {
      if (alive) setRows(r)
    })
    return () => {
      alive = false
    }
  }, [cityAdcode])

  if (rows === undefined) {
    return (
      <div className="flex items-center gap-2 px-3.5 py-6 text-[13px] text-ink-2">
        <span className="size-3.5 flex-none animate-spin rounded-full border-2 border-line border-t-primary" />
        加载中…
      </div>
    )
  }

  if (rows === null) {
    return (
      <EmptyState
        icon={<Icon name="pin" size="xl" />}
        title="区划数据还没生成"
        detail="这座城市的区分片缺席（跑完数据流水线后会有）。先在地图上放大，景点会直接铺出来。"
      />
    )
  }

  if (rows.length === 0) {
    return <EmptyState icon={<Icon name="pin" size="xl" />} title="这座城没有下辖的区" />
  }

  return (
    <div className="pb-4">
      <p className="mx-3.5 mt-3 mb-1.5 text-[11.5px] leading-relaxed text-ink-2/80">
        点一个区，地图会放大到那一档，景点随之上屏。
      </p>
      {rows.map((row) => {
        const on = row.adcode === active
        return (
          <button
            key={row.adcode}
            type="button"
            onClick={() => onPick(row)}
            aria-current={on ? 'true' : undefined}
            className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left ${
              on ? 'bg-bg' : 'hover:bg-bg'
            }`}
          >
            <span className={`min-w-0 flex-1 truncate text-[13.5px] ${on ? 'text-primary' : ''}`}>
              {row.name}
            </span>
            <span className={`flex-none text-[11.5px] ${on ? 'text-primary' : 'text-ink'}`}>
              {row.poiCount} 个
            </span>
            <Icon
              name="chev-right"
              size="sm"
              className={`flex-none ${on ? 'text-primary/60' : 'text-ink-2/50'}`}
            />
          </button>
        )
      })}
    </div>
  )
}
