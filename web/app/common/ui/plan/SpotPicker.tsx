/**
 * 「挑景点」浮层 —— 左侧那块**景点清单**（2026-09-27 新增）。
 *
 * ## 它为什么存在
 * 规划面板详情态的「添加景点」以前是这么干的：
 * ```ts
 * if (pathname === `/city/${plan.cityId}`) { closePagePoi(); return }  // 就地
 * navigate(`/city/${plan.cityId}`)                                      // 否则**换 URL**
 * ```
 * 用户 2026-09-27 的原话是「改成不跳链接，左侧打开对应城市的景点列表」。
 * ★ 但左侧那份清单**只长在城市页上**（首页 / 省级页 / 点位详情页都没有）——
 *   于是这条要求真正需要的是：**把那份清单做成能独立浮出来的一块**，
 *   而不是继续用 URL 去"切到有清单的那个页面"。
 *
 * ## 谁浮它、什么情况下不浮
 * | 当前页面 | 行为 |
 * |----------|------|
 * | 城市页（含 `/city/x/plan` 行程深链） | **不浮** —— 它左边本来就是这座城的清单（`PageSpotOps.spotListCity`） |
 * | 首页 / 省级页 / 点位详情页 / **别的城市的城市页** | 浮这块（列的是**规划那座城**的景点，与当前页是哪座城无关） |
 *
 * ★ 判据来自**页面自己**（注册制），不是 URL —— 理由写在 `mapShell.PageSpotOps`。
 *
 * ## 这块面板的交互（2026-09-27 两轮用户反馈定稿）
 * | 动作 | 结果 |
 * |------|------|
 * | 点**卡片** | 打开景点详情浮层（层在**本清单之上**） |
 * | 点右侧「**加入行程**」 | 把这一条排进这条规划的**当前天**（走唯一写入口 `addStopToPlan`） |
 * | 没有第三个入口 | 写库的路只有那个按钮一条 |
 *
 * ★★ **行点击永远不加入**（用户原话：「只有点加入行程按钮，才会加入到右侧的行程里面」）。
 *   这条踩过两次：第一版整行就是"加入"（挑景点时手指一滑点中一行，就多出一条行程），
 *   第二版把行点击改成"什么都不做"（用户又要「点卡片就打开景点详情」）——
 *   现在行点击**只做详情**，落点在 `PoiList` 的 `rowAction`（一处决定）。
 * ★★ **这一档没有「详情」按钮**（用户原话：「详情按钮不需要显示，只显示加入按钮，
 *   **用详情按钮的样式**，点卡片就打开景点详情」）—— 行点击已经是详情了，再摆个按钮
 *   是同一件事说两遍；「加入行程」因此改用原来那个详情按钮的样式（`text-primary` 文字链接）。
 * ★★ **详情走页面的那条信道**（`shell.setSearchPick`）而不是自己再渲染一个详情：
 *   详情浮层是**页面**的东西（三页各一份 `selectedId` + 各自的浮层/Sheet），
 *   本组件长在外壳上，拿不到它 —— 与「添加景点」用 `closePagePoi` 是同一类问题
 *   （见 `mapShell.PageSpotOps`）。走信道还有个好处：**三页都自动支持**。
 *   层级由详情浮层那边保证（`PoiDetailOverlay` 的 z 高于本浮层，用户明确要求）。
 *
 * ## 一个平铺列表 + 顶部一条筛选
 * ★ **不分组**（用户原话：「全部都放到一个列表里面，不需要分组」）——
 *   挑景点时是在"扫一遍有什么"，中间插进去的大类标题只会把本来就短的一屏切碎。
 *   筛选交给顶部那条 `FilterBar`（`collapsible`：默认一行大类 + 最右侧展开/收起）。
 * ★ 过滤与排序都用**唯一出处**（`filterPois` / `sortPois`，与城市页清单同源），
 *   各写一份就会出现"同一个 chip 在两处筛出不同的东西"，而且不会报错。
 *
 * ## 点「加入」之后不关浮层
 * 挑景点是连续动作（一口气加三四个很常见），每加一个就关掉等于让用户反复点「添加景点」。
 */

import { useEffect, useState } from 'react'

import { loadCity } from '~/common/data/cityRegistry'
import { usePlanStore } from '~/common/logic/itinerary/planStore'
import { usePlanUi, type SpotPickerRequest } from '~/common/logic/itinerary/planUi'
import { useMapShell } from '~/common/logic/mapShell'
import { addStopToPlan, toStop } from '~/common/logic/useAddToPlan'
import { Icon } from '~/common/ui/Icon'
import { Overlay } from '~/common/ui/Overlay'
import { FilterBar } from '~/common/ui/city/FilterBar'
import { PoiList, countSubtypes, filterPois, sortPois } from '~/common/ui/city/PoiList'
import { useDismiss } from '~/common/ui/useDismiss'
import type { Category, City, SubType } from '~shared/schema'

/**
 * 门：只负责"开不开"，**不持有任何状态**。
 * 它挂在外壳上常年存在，`return null` 只是不渲染、状态还在 ——
 * 状态必须住在下面那个"内容"组件里（护栏 AF 守这条）。
 */
export function SpotPicker() {
  const req = usePlanUi((s) => s.spotPicker)
  if (!req) return null
  return <SpotPickerBody req={req} />
}

/** 内容：每次打开都是**全新实例**，所以筛选 / 滚动位置都不会带到下一次 */
function SpotPickerBody({ req }: { req: SpotPickerRequest }) {
  const close = usePlanUi((s) => s.closeSpotPicker)
  const plans = usePlanStore((s) => s.plans)
  /** 面板上正看着的那一天（全站唯一，由 `PlanDetailView` 单向同步） */
  const detailDay = usePlanUi((s) => s.detailDay)
  const shell = useMapShell()
  const [city, setCity] = useState<City | null>(null)
  /** 顶部那条筛选（大类 + 细类，可同时生效）—— 语义与城市页清单**完全一致** */
  const [category, setCategory] = useState<Category | null>(null)
  const [subtype, setSubtype] = useState<SubType | null>(null)

  /**
   * ★ **只吃 Esc，不吃"点外面关闭"**（`outside: false`）：
   *   挑景点时用户常要去地图上确认"这个点在哪" —— 那一下点在浮层外面，
   *   如果按常规手势关掉，他就得重新点一次「添加景点」。
   *   收起的出口由 ✕ 和 Esc 给，够明确。
   */
  const wrapRef = useDismiss(true, close, { outside: false })

  useEffect(() => {
    let alive = true
    setCity(null)
    // `loadCity` 自带缓存：同城第二次打开不会再有网络/IO 开销
    loadCity(req.cityId).then((c) => {
      if (alive) setCity(c)
    })
    return () => {
      alive = false
    }
  }, [req.cityId])

  const plan = plans.find((p) => p.id === req.planId) ?? null
  /** 这条规划被删了（浮动面板上删掉的那一下）—— 自己不声不响地收起来 */
  useEffect(() => {
    if (!plan) close()
  }, [plan, close])

  /**
   * 点「加入行程」= 加进**面板上正看着的那一天**。
   * ★ `detailDay` 是 1 起的"第几天"，而 `addStopToPlan` 的 `dayIndex` 是 **0 起** ——
   *   少减这个 1 就是"看着第 2 天、加进了第 1 天"，而且不报错。
   * ★ 读全局的 `detailDay` 而不是本组件存一份快照：用户在面板上切天时它自动跟着走
   *   （那句同步只写在 `PlanDetailView` 里，一处）。
   */
  async function add(poiId: string) {
    const poi = city?.pois.find((p) => p.id === poiId)
    if (!poi) return
    await addStopToPlan(req.planId, toStop(poi, req.cityId), detailDay - 1)
  }

  /**
   * 点「详情」→ 交给**页面**那条详情信道（`searchPick`）就地打开详情浮层。
   * `useSearchPick` 的合并规则是"**命中 > 页面自己的选中**"，所以页面会直接渲染这一枚。
   */
  function openDetail(poiId: string) {
    if (!city) return
    const poi = city.pois.find((p) => p.id === poiId)
    if (!poi) return
    shell.setSearchPick({ poi, cityId: req.cityId, cityName: city.name })
  }

  return (
    <Overlay
      anchor="left"
      widthToken="--panel-left"
      tall
      z={26}
      label="挑景点"
      className="overflow-hidden"
    >
      <div ref={wrapRef} className="flex min-h-0 flex-1 flex-col">
        <div className="flex-none border-b border-line px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <b className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">
              挑景点 · {city?.name ?? '加载中…'}
            </b>
            <button
              type="button"
              onClick={close}
              aria-label="关闭挑景点"
              className="-mr-1 inline-flex size-7 flex-none items-center justify-center rounded-md text-ink-2 hover:bg-line-2 hover:text-ink"
            >
              <Icon name="close" size="sm" />
            </button>
          </div>
          {/* 这一句是这块浮层的全部规则 */}
          <p className="mt-1 mb-0 text-[11.5px] leading-relaxed text-ink-2">
            点卡片看这一个点的详情；点右侧「加入行程」才把它排进「{plan?.name ?? ''}」的
            <b>第 {detailDay} 天</b>。加完这块不用关，可以接着挑。
          </p>
        </div>

        {/* 顶部筛选：默认一行大类 + 最右侧展开/收起（细类色板） */}
        {city ? (
          <div className="flex-none border-b border-line px-3.5 py-2.5">
            <FilterBar
              city={city}
              category={category}
              subtype={subtype}
              counts={countSubtypes(city.pois)}
              onCategory={setCategory}
              onSubtype={setSubtype}
              collapsible
            />
          </div>
        ) : null}

        <div className="scroll min-h-0 flex-1">
          {/* ★ 不分组（`grouped={false}`）+ 行不可点：加入只由右侧按钮触发 */}
          <PoiList
            mode="pick"
            grouped={false}
            city={city}
            list={city ? sortPois(filterPois(city.pois, category, subtype), 'hot') : []}
            sort="hot"
            selectedId={null}
            onOpen={openDetail}
            onAddToPlan={(id) => void add(id)}
          />
        </div>
      </div>
    </Overlay>
  )
}
