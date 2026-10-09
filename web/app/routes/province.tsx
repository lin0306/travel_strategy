/**
 * 省级视图路由 —— **薄壳**：取数 + 按端分派（见 `routes/city.tsx` 的三层说明）。
 *
 * | 层 | 文件 |
 * |----|------|
 * | 逻辑 | `common/logic/useProvinceView.ts`（两端共用） |
 * | 内容 | `common/ui/city/ProvinceList`（两端共用） |
 * | 形态 | `desktop/ui/ProvinceView` · `mobile/ui/ProvinceView` |
 */

import { DesktopProvinceView } from '~/desktop/ui/ProvinceView'
import { MobileProvinceView } from '~/mobile/ui/ProvinceView'
import { useProvinceView } from '~/common/logic/useProvinceView'
import { useIsMobile } from '~/common/logic/useViewport'

export default function ProvinceRoute() {
  const view = useProvinceView()
  return useIsMobile() ? <MobileProvinceView view={view} /> : <DesktopProvinceView view={view} />
}
