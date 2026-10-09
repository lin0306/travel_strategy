/**
 * 点位详情页路由 —— **薄壳**：取数 + 按端分派（见 `routes/city.tsx` 的三层说明）。
 *
 * | 层 | 文件 |
 * |----|------|
 * | 逻辑 | `common/logic/usePoiView.ts`（两端共用） |
 * | 内容 | `common/ui/city/PoiDetail` · `common/ui/city/PoiLocation`（两端共用） |
 * | 形态 | `desktop/ui/PoiView`（620px 面板 + 位置卡） · `mobile/ui/PoiView`（底部 Sheet） |
 *
 * ★ 端别判据是**媒体查询**，不是 UA —— 理由见 `common/logic/useViewport.ts` 文件头。
 */

import { DesktopPoiView } from '~/desktop/ui/PoiView'
import { MobilePoiView } from '~/mobile/ui/PoiView'
import { usePoiView } from '~/common/logic/usePoiView'
import { useIsMobile } from '~/common/logic/useViewport'

export default function PoiRoute() {
  const view = usePoiView()
  return useIsMobile() ? <MobilePoiView view={view} /> : <DesktopPoiView view={view} />
}
