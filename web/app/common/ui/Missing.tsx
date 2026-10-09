/**
 * 「东西不存在」的两种空态 —— 两端共用同一份文案。
 *
 * ## 为什么文案必须只有一份
 * 空态是**给用户的解释**（"为什么这儿是空的"），它出现的场合是两端 × 两个页面
 * （找不到城市 / 找不到点位）共四处。抄四遍的后果不是"多写几行"，而是
 * **以后改文案只改到一半** —— 手机上说了实话、桌面上还留着旧说法。
 *
 * ## 为什么本文件只返回"内容"、不返回外壳
 * 外壳恰恰是两端唯一该分叉的地方：桌面是左侧 620px 面板，移动是底部 Sheet。
 * 所以这里只给 `EmptyState`（图标 + 标题 + 说明 + 动作），由两端视图自己包壳。
 */

import { useNavigate } from 'react-router'

import { Icon } from '~/common/ui/Icon'
import { EmptyState } from '~/common/ui/Overlay'

/** 城市页 / 点位页共用：这座城市读不到 */
export function CityMissing() {
  return (
    <EmptyState
      icon={<Icon name="alert" size="xl" />}
      title="找不到这座城市"
      detail="可能是链接被改过，或者该城市的数据文件不在 data/cities/ 里。"
    />
  )
}

/**
 * 点位不存在。
 * ★ `hasCity` 只影响"往哪退" —— 城市没读到就退回首页，否则退回城市页。
 *   退错一级会让人以为整站都坏了。
 */
export function PoiMissing({ cityId, hasCity }: { cityId: string; hasCity: boolean }) {
  const navigate = useNavigate()
  return (
    <EmptyState
      icon={<Icon name="alert" size="xl" />}
      title="找不到这个点位"
      detail={hasCity ? '它可能已被移除，或链接里的 id 不对。' : '这座城市的资料没能读到。'}
      action={
        <button
          type="button"
          onClick={() => navigate(hasCity ? `/city/${cityId}` : '/')}
          className="mt-1 rounded-lg border border-line px-3 py-1.5 text-[12.5px]"
        >
          {hasCity ? '回到城市页' : '回到首页'}
        </button>
      }
    />
  )
}
