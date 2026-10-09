/**
 * 首页路由 —— **薄壳**：接上共用逻辑，渲染「地图 + 顶栏」。
 *
 * ## ★ 本页**没有** desktop / mobile 两份视图，这是刻意的
 * 判据是「同一个位置渲染了两个不同的组件吗」：
 *   · 城市 / 省级 / 点位 / 行程四页 —— 是（左面板 ↔ 底部 Sheet），所以各分两份；
 *   · 本页 —— 不是。两端都是「一张铺满视口的地图 + 一条顶栏」，一个字节都不差。
 *
 * 硬凑出两个只差一行注释的文件，等于以后每改一处都要改两遍，而漏改时
 * **不会报错**、只是两端慢慢长得不一样 —— 那正是这次拆分要消灭的东西。
 * 端别差异只有**一处半**，而且都不在"页面骨架"上：
 *   · 逻辑层：独立点挂不挂名字（`names: !isMobile`）、点景点是"选中"（`useHomeView`）；
 *   · 形态层：**详情浮层**用哪一份 —— 桌面 620px 面板，移动端底部 Sheet。
 * 后者就是那个"端别件"本身（`desktop/ui/PoiDetailOverlay` / `mobile/ui/PoiDetailSheet`），
 * 所以下面**只分派它自己**，不为它再造一对 `HomeView.tsx`。
 * ★ 判据对比：城市 / 省级 / 点位 / 行程四页要分的是**整个骨架**（左面板 ↔ 底部 Sheet
 *   装的是不同东西），那才值得两份文件。
 *
 * ## 内容是什么、边界怎么处理、null 为什么不能当 0
 * 全在 `common/logic/useHomeView.ts` 的文件头（那份注释跟着逻辑走，
 * 不跟着渲染走 —— 逻辑搬家时注释一起搬，才不会留下一份骗人的文档）。
 */

import { TopBar } from '~/common/ui/TopBar'
import { PoiDetailOverlay } from '~/desktop/ui/PoiDetailOverlay'
import { PoiDetailSheet } from '~/mobile/ui/PoiDetailSheet'
import { useHomeView } from '~/common/logic/useHomeView'
import { useIsMobile } from '~/common/logic/useViewport'

export default function HomeRoute() {
  const view = useHomeView()
  const isMobile = useIsMobile()

  return (
    /* ★ 不要再往顶栏塞图例：徽标自己就带文案（「四川 46」/「北京 —」），
       再加一条"收录密度 1–19 / 20–49 / 50+"的色块图例就是同一句话说两遍。
       同理也**不要再自绘底图署名** —— 腾讯 SDK 在左下角自带 `.logo-text`
       （`©2026 Tencent - GS(2026)1190号`），我们那份"© 腾讯地图"是纯重复，
       而且信息量更低（没有审图号）。想表达"现在用哪张图"靠顶栏的底图下拉。
       ★ 也**不要再往顶栏加"我在哪"**（地区文字 / 下拉 / 面包屑都已撤）——
         这一页是"全国视图"这件事，由地图上铺的省级徽标自己说明。 */
    <>
      <TopBar shell={view.shell} />
      {/* 点景点图标 / 名字 → **就地**看完整详情（**不是**把镜头推过去、更不是跳详情页）。
          URL 一动不动；点地图空白或面板上的 ✕ 收起。详见 useHomeView 文件头 */}
      {isMobile ? (
        <PoiDetailSheet
          poi={view.selected}
          cityName={view.selectedCityName}
          cityId={view.selectedCityId}
          onClose={view.closePoi}
          onAddToPlan={view.addToPlan}
        />
      ) : (
        <PoiDetailOverlay
          poi={view.selected}
          cityName={view.selectedCityName}
          cityId={view.selectedCityId}
          onClose={view.closePoi}
          onAddToPlan={view.addToPlan}
        />
      )}
    </>
  )
}
