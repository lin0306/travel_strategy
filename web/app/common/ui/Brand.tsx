/**
 * 站标 —— 顶栏最左侧那一块（Logo 方块 + 「行迹」+ 副标题）。
 *
 * ## 图形为什么换成 `<SiteMark />`（2026-10-07）
 * 早先这里是一块 `.logo-mark` 渐变方块里放 `Icon name="nav"`（纸飞机），
 * 而 `public/favicon.svg` 是折线 + 定位点 —— **同一站两套图形**，
 * 浏览器标签页和顶栏摆在一起时格外刺眼。
 * 现在两边共用 `SiteMark`（近黑底 + 白色描边鼠标箭头），改图形只改一处。
 * ★ `nav`（纸飞机）**没有删** —— 行程详情与搜索框还在用它，那两处语义
 *   是"导航/前往"，与站标不是一回事。
 *
 * ## 为什么它可点（而早先的版本刻意不可点）
 * 早先版本这里是**纯文字**，理由是「做成可点就在每一级都放一个『回首页』，
 * 和面包屑首级重复」。那条理由已经随面包屑一起作废（2026-09-19 面包屑已撤），
 * 但结论不变：
 * 1. 地区选择器里的「全国」确实也能回首页，可那是**展开后才能选到的一项**，
 *    站标是常驻可见的出口；「站标可点回首页」是全网共识交互，用户不会去猜
 *    它有没有用 —— 真正让人困惑的是**没有站标、只有一个孤立按钮**。
 *    ★ 那个选择器后来连只读文字一起删了（2026-09-22），**站标现在是全站
 *      唯一常驻的"回全国"出口** —— 这条理由比原先更硬。
 * 2. 到了首页，站标是这一屏唯一的"这是首页"的书面锚点。
 *
 * ## 副标题为什么必须留
 * 「行迹」二字单独出现时，用户读不出这是干什么的（人名？店名？）。
 * 「城市旅游攻略」六个字是这一屏唯一的**自我说明**，比任何 tooltip 都直接。
 * 窄屏会把它藏掉（顶栏一行塞不下），桌面端必须显。
 */

import { SiteMark } from '~/common/ui/SiteMark'

export interface BrandProps {
  /** 回首页。顶栏在每一级都传 —— 站标是兜底的「回全国」出口 */
  onHome: () => void
}

export function Brand({ onHome }: BrandProps) {
  return (
    <button
      type="button"
      onClick={onHome}
      aria-label="行迹 · 回到全国视图"
      className="flex flex-none items-center gap-2.5 rounded-md transition-opacity hover:opacity-85"
    >
      {/* 纯装饰：站名「行迹」就在旁边，图形再报一次名是噪声 */}
      <SiteMark size={28} title={null} className="flex-none" />
      <span className="text-left text-[15px] leading-[1.1] font-bold tracking-tight">
        行迹
        {/* 副标题：窄屏隐藏（`em` 保留语义上的从属关系，只是不占位） */}
        <em className="hidden text-[9.5px] font-normal not-italic tracking-wide text-ink-2/70 sm:block">
          城市旅游攻略
        </em>
      </span>
    </button>
  )
}
