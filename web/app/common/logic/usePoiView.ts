/**
 * 点位详情页的**页面逻辑**（与端无关）—— 只管「取数 + 视野 + 图层」。
 *
 * ## 双轨渲染
 * 它有两个入口，共用同一个内容组件（`common/ui/city/PoiDetail`）：
 * - **独立页**（`routes/poi.tsx` → 两端视图）：桌面是 620px 面板浮在地图上，
 *   移动是底部 Sheet；预渲染供 SEO 收录
 * - **预览卡**（城市页右侧 326px，桌面专属）：只显示摘要与动作
 *
 * ★ 内容组件是这一页**唯一**该引用的"展示"依赖。想加排版就先问一句
 *   "这个字段要不要在预览卡里也出现"—— 要，就该改 `PoiDetail` 而不是改两端视图。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'

import { useFitOnce } from '~/common/logic/useFitOnce'
import { useAddToPlan } from '~/common/logic/useAddToPlan'
import { useMapShell, type MapShellContext } from '~/common/logic/mapShell'
import { loadCity } from '~/common/data/cityRegistry'
import { createPoiLayer, type PoiLayerHandle } from '~/common/map/tencent'
import { SUBTYPE_META, type City, type Poi } from '~shared/schema'

export interface PoiView {
  shell: MapShellContext
  cityId: string
  city: City | null
  poi: Poi | null
  /** 取数已结束但没找到（用于区分"加载中"与"确实没有"） */
  loaded: boolean
  /** 图片区当前下标。两端共用 —— 换成第二张图后切端不该跳回第一张 */
  gallery: number
  setGallery: (i: number) => void
  showSources: boolean
  toggleSources: () => void
  /** 添加行程（弹「加到哪个组」的窗，不换页） */
  addToPlan: () => void
  /** 回城市页 */
  backToCity: () => void
}

export function usePoiView(): PoiView {
  const { cityId = '', poiId = '' } = useParams()
  const shell = useMapShell()
  const addPoi = useAddToPlan()
  const navigate = useNavigate()
  const [city, setCity] = useState<City | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [gallery, setGallery] = useState(0)
  const [showSources, setShowSources] = useState(false)
  const layerRef = useRef<PoiLayerHandle | null>(null)

  useEffect(() => {
    let alive = true
    setLoaded(false)
    setCity(null)
    setGallery(0)
    setShowSources(false)
    loadCity(cityId).then((c) => {
      if (!alive) return
      setCity(c)
      setLoaded(true)
    })
    return () => {
      alive = false
    }
  }, [cityId, poiId])

  const poi = useMemo(() => city?.pois.find((p) => p.id === poiId) ?? null, [city, poiId])

  // ── 地图：只显示这一个点位（选中态）──
  useEffect(() => {
    const map = shell.map
    if (!map || !poi) return
    // 这一页只有它一个点、且它就是"选中项" → 走选中层，保留项目自己的样式
    // （`names` 对它没影响：选中项**永远**有名字，见 `poiLayer.repaintLabels`）
    const layer = createPoiLayer(map, { names: true })
    layerRef.current = layer
    layer.update(
      [
        {
          id: poi.id,
          name: poi.name,
          subtype: poi.subtype,
          lng: poi.location.point.lng,
          lat: poi.location.point.lat,
          popularity: poi.popularity,
        },
      ],
      { selectedId: poi.id },
    )
    return () => {
      layer.destroy()
      layerRef.current = null
    }
  }, [shell.map, poi])

  // ── 视野重刷登记 ──
  // 这一页只有 1 个点位、且带选中态（选中项不受分档淘汰），所以正常情况下不必重刷。
  // 仍然登记的理由是**管道要统一**：少了这一处，"凡建图层的路由都要登记"就不再是
  // 一条能静态检查的规则，而会变成"除了详情页以外"这种带例外的规则 ——
  // 例外一多，下一个漏登记的页面就查不出来了。
  useEffect(
    () => shell.registerRefresh((env) => layerRef.current?.refreshView(env)),
    [shell.registerRefresh],
  )

  // ★ 用 `useFitOnce` 记账：修复前依赖 `[poi, shell]`，换一次底图就会把镜头
  //   拉回这个点位（对只有一个点的页面看起来"没坏"，但它和城市页是同一个 bug）。
  //
  // ★ 单点**不需要**新增"定格"能力：`fitView.boundsOf()` 对单点已经补了 ±0.02°
  //   （约 2km）跨度，`fitBounds` 自然落在一个街区级缩放。
  useFitOnce(poi ? `${cityId}|${poiId}` : null, shell.status === 'ready', () => {
    if (!poi) return false
    return shell.fit([{ lng: poi.location.point.lng, lat: poi.location.point.lat }], {
      reason: 'drill',
    })
  })

  useEffect(() => {
    shell.setFallback({
      pins: poi
        ? [
            {
              id: poi.id,
              lng: poi.location.point.lng,
              lat: poi.location.point.lat,
              color: SUBTYPE_META[poi.subtype].color,
              label: poi.name,
            },
          ]
        : [],
    })
  }, [poi, shell])

  return {
    shell,
    cityId,
    city,
    poi,
    loaded,
    gallery,
    setGallery,
    showSources,
    toggleSources: () => setShowSources((v) => !v),
    addToPlan: () => {
      // ★ 不换页，直接加进规划（plans/13 §6.5）。手上已有完整 Poi，顺手传进去省一次 loadCity
      if (poi) addPoi(poi.id, cityId, poi)
    },
    backToCity: () => navigate(`/city/${cityId}`),
  }
}
