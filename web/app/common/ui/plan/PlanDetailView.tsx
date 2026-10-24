/**
 * 右侧浮层 · **详情态**（plans/13 §6.3 / §6.6 / §6.10 / §6.11）。
 *
 * ## 这一版详情态长什么样（2026-09-27 用户定的形态）
 * ```
 * ┌ 成都三日 ────────────────────────── ✕ ┐
 * │ [添加景点]  [地图上取点]                │  ← 动作条
 * │ [第 1 天 ✕] [第 2 天 ✕]  ＋            │  ← 天数标签栏（点=切换 · 拖=换序 · ✕=关 · ＋=加）
 * │  ●  [图] 宽窄巷子                 ✕     │  ← 内容区：**只渲染当前这一天**
 * │  │       四川 · 成都 · 青羊区           │
 * │  │  [🚗 12 分钟 · 3.2 公里 换方式/方案]  │  ← 段行（2026-10-04）
 * │  ●  [图] 人民公园                 ✕     │
 * └─────────────────────────────────────────┘
 * ```
 *
 * ## ★ 内容区**只显示当前这一天**（2026-09-27 用户定）
 * > 「一天的列表，只展示一天的，不需要都展示，那个第 n 天的标签，那个景点数，不需要显示」
 *
 * 上一版内容区是"每一天一节"的连续列表，点天数标签 = **滚到那一段**。
 * 现在两件事一起收口：
 * | 之前的 | 现在 |
 * |--------|------|
 * | 内容区把 `days` 全铺出来 | 只铺 `days[activeDay - 1]` 这一天 |
 * | 点标签 → `scrollToDay`（找 `[data-day]` 滚过去） | 点标签 → `setActiveDay`（**换内容**，不是滚） |
 * | 每一节有「第 N 天」吸顶标题 | **没有**天标题 —— 那信息已经在标签栏上 |
 * | 标签上带景点条数 | 不带（切过去就能看见有没有安排） |
 *
 * ★ 于是 `scrollToDay` 这个 DOM 探测器**整个删掉**了：它存在的唯一理由是"列表是连续的"，
 *   而这一点现在已经不成立（滚到的目标可能根本没渲染）。留着会是一段永远查不到元素的死代码。
 *
 * ## ★ 这一版**去掉了**两样东西（用户 2026-09-27 定）
 * | 去掉 | 用户原话 |
 * |------|----------|
 * | 「设置住宿点」那一行提示 | 「去掉，不需要」 |
 * | 底部 导出 / 导入 / 分享 | 「都先去掉，这个按钮的逻辑后面得调整」 |
 *
 * ⇒ 于是**带时刻的时间轴**（`PlanPanel` → `ItineraryPanel` → `TimelineRail`）
 *   **这一版不再被渲染**：那套锚在住宿点上，而住宿点现在没有入口。
 *   文件与实现都保留（住宿点逻辑用户说后面再调），只是拆掉这里的接线。
 *   导出 / 导入 / 分享三件事在 `usePlanView` 里仍然可用（`onExport` /
 *   `onImportFile` / `onShare`），只是这一版没有入口。
 *
 * ## ★ 「添加景点」**不换 URL**（2026-09-27 用户定）
 * ```
 * ① closePagePoi()                 -- 先收起已打开的景点详情（三页都注册了 closePoi）
 * ② pageSpotListCity() === cityId  -- 本页左边就有这座城的清单（城市页）→ 就地用 + 一句引导
 * ③ 否则 openSpotPicker(...)       -- 外壳浮出这块清单（SpotPicker，左边 348px）
 * ```
 * 判据来自**页面自己**（注册制 `PageSpotOps`）而不是 URL —— 细节见 `onAddSpot` 的注释。
 *
 * ## 内容区为什么不再分两态
 * 上一版是「有时间链 → 时间轴；没有 → 按天列表」，两套 UI 轮着出现。
 * 用户要的是**一套**：不管有没有住宿点，看到的都是这条时间线。
 *
 * ## 天数一律以 `view.store.days` 为准
 * 它既是渲染源、也是编辑目标（`removeDay` / `moveDay` / `moveItem` 都改它），
 * 而 `activeDay` 决定"渲染哪一天"。
 * 用 `plan.days` 渲染而拿 `view.store.days` 去编辑，就会出现"序号对不上"
 * 那种只在两个源差一拍时发生的错删。
 */

import { useEffect, useMemo, useRef } from 'react'

import { PosterExportButton, PosterProgressRow } from '~/common/ui/plan/poster/PosterExportButton'
import { usePosterExport } from '~/common/ui/plan/poster/usePosterExport'

import { closePagePoi, pageSpotListCity, useMapShell } from '~/common/logic/mapShell'
import { usePlanStore } from '~/common/logic/itinerary/planStore'
import { closePlanDetail, usePlanUi } from '~/common/logic/itinerary/planUi'
import { readUiState } from '~/common/data/uiState'
import { usePlanStops } from '~/common/logic/usePlanStops'
import { routeOptionKey } from '~/common/logic/itinerary/routeOptions'
import { useItineraryView } from '~/common/logic/usePlanView'
import { STOP_FOCUS_ZOOM } from '~/common/map/tencent'
import { DayTabs } from '~/common/ui/plan/DayTabs'
import { DegBars } from '~/common/ui/plan/DegBars'
import { PanelHeader } from '~/common/ui/plan/PanelHeader'
import { StayPicker } from '~/common/ui/plan/StayPicker'
import { StopTimeline } from '~/common/ui/plan/StopTimeline'
import { Icon } from '~/common/ui/Icon'

/**
 * 点标题时落到这一级（引擎缩放值）—— **常量在 `zoomTiers`（唯一出处）**：
 * 点地图上那枚序号标记用的是同一个数（见 `usePlanRouteLayer`）。
 */

export function PlanDetailView() {
  const plans = usePlanStore((s) => s.plans)
  const activeId = usePlanStore((s) => s.activeId)
  /** 存储层的错误（IDB 打不开之类） */
  const storeError = usePlanStore((s) => s.error)
  const plan = activeId ? (plans.find((p) => p.id === activeId) ?? null) : null

  const picking = usePlanUi((s) => s.picking)
  const startPicking = usePlanUi((s) => s.startPicking)
  const stopPicking = usePlanUi((s) => s.stopPicking)
  const closePanel = usePlanUi((s) => s.closePanel)
  /** 点标题要把那个点在地图上居中并放大 —— 取景能力来自外壳 */
  const shell = useMapShell()

  /** 推导（城市 / 时间链 / 住宿 / 多方案）—— 与弹窗那份共用 `useItineraryView` */
  const view = useItineraryView(plan?.cityId ?? '', { mapLayers: false })
  /** 每一条的坐标 / 名字 / 缩略图 / 区名 —— 按 uid 索引，**只补字段**（结构由 days 决定） */
  const { stops } = usePlanStops(plan)
  const stopByUid = useMemo(() => new Map(stops.map((s) => [s.uid, s])), [stops])

  /**
   * **把"展开的那一段"推给地图侧**（`planUi.legFocus`）。
   *
   * 图层（`usePlanRouteLayer`）挂在**外层** `RoutePlanPanelBody` 上 —— 列表态也要画
   * 整条路线 —— 而"展开了哪一段"只有详情态知道。两边不是父子，只能借 store 过去。
   *
   * 推过去的内容 = 该段**当前方式下的多条候选路线**（已解码）+ 选中的那条 + 两端。
   * 地图侧据此：① 把候选都画上（未选中的自动变半透明）② 镜头跳到这两点之间。
   *
   * ★ 没有展开段 / 那段还没选方式 / 还没拉到路线 → 一律推 `null`
   *   （地图侧就不画、也不跳；"跳到一个什么都没有的地方"比不跳更糟）。
   * ★ 依赖放的是**值**（`legByUid` / `optionSets` 由上层 memo 稳定），
   *   不要放整个 `view` —— 那每次渲染都是新对象，effect 会空转。
   */
  useEffect(() => {
    const uid = view.store.activeLeg
    const leg = uid ? view.legByUid.get(uid) : undefined
    // ★ 缓存键要带上**偏好** —— 否则"公交优先"和"地铁优先"会互相顶掉（见 routeOptionKey）
    const prefer = stops.find((x) => x.uid === uid)?.transitPrefer
    const opts =
      (leg ? view.optionSets[routeOptionKey(uid, leg.mode, prefer)]?.options : undefined) ?? []
    if (!uid || !leg || opts.length === 0) {
      usePlanUi.getState().setLegFocus(null)
      return
    }
    usePlanUi.getState().setLegFocus({
      uid,
      mode: leg.mode,
      routes: opts.map((o) => ({
        key: o.key,
        mode: leg.mode,
        /**
         * ★ 用**已解码**的 `path`，不要自己 `decodePolyline(o.polyline)` ——
         *   公交/地铁的几何散在 `steps[]` 里、且每段独立压缩，必须逐段解码后再拼
         *   （那件事在 `RouteOption.path` 的解析处做掉了）。
         */
        path: o.path,
        /**
         * ★★ 公交/地铁还要把**分段**带上（用户：「得做标识 —— 哪一段是步行、
         *   哪一段是公共交通，地铁线路官方都有默认的颜色」）。
         * 其余方式没有 `segments`，地图那边就画一根线。
         */
        ...(o.segments && o.segments.length > 0
          ? {
              segments: o.segments.map((s) => ({
                kind: s.kind,
                path: s.path,
                ...(s.color ? { color: s.color } : {}),
              })),
            }
          : {}),
      })),
      focusedKey: view.store.chosenOption[uid] ?? null,
      from: { lng: leg.from.lng, lat: leg.from.lat },
      to: { lng: leg.to.lng, lat: leg.to.lat },
    })
  }, [view.store.activeLeg, view.store.chosenOption, view.legByUid, view.optionSets])

  /**
   * **卸载兜底**：带走详情态专属的状态（主清理在 `closePlanDetail`，理由见 `planUi.ts`）。
   *
   * 上面那个 effect 只在**它自己重跑**时清；而「返回组列表」（`PanelHeader` 的 `onBack`）
   * 让**整个详情态卸载** —— 卸载时它不重跑 ⇒ 脏状态留在 store 里，地图上那条候选线
   * 一直挂着，而且**下次打开面板还会复发**（用户 2026-10-05 报的）。
   * ★ 顺带清**取点模式**（同源：入口按钮也只长在详情态里）。
   * ★ 不塞进上面那个 effect 的 cleanup —— 它每次依赖变化都跑，会把刚设的值当场清掉。
   */
  useEffect(
    () => () => {
      usePlanUi.getState().setLegFocus(null)
      usePlanUi.getState().stopPicking()
    },
    [],
  )

  /**
   * 把**面板上正看着的那一天**同步给 `planUi.detailDay` —— 全站唯一的"当前天"。
   *
   * ## 为什么需要它（用户 2026-09-28：「整体的功能没有闭环，感觉逻辑上有点重复了」）
   * 有三处要问"加进哪一天"：面板自己的标签栏（切天）、「挑景点」清单（加入）、
   * 景点详情的「添加到当前行程」（直接加）。而真源在 `useItineraryStore`（面板副本）里
   * —— 页面与外壳都读不到它。⇒ 由这一句把它**单向**广播出去，别处不再各存一份。
   *
   * ★ 以前「挑景点」自己存了一份快照 `day`，切天时再单独同步一次：同一个概念两份状态，
   *   而"两份能对不上"正是那种不报错的 bug 的温床。
   */
  /**
   * ★★ **刷新恢复「当前天」**（2026-09-29）。
   *
   * 「当前天」的真源在**面板副本**（`useItineraryStore.activeDay`），而它刷新后是从
   * `store.ts` 的初值 **1** 起步的；从会话状态恢复来的那一份是 `planUi.detailDay`
   * ⇒ 这里要把恢复值装回副本，否则屏幕上永远是第 1 天。
   *
   * ## 为什么是"**持续纠正**"而不是"只做一次"
   * 第一版用 ref 只做一次，探针**仍然红**：`attach()` 在数据到货后的**稍后一拍**还会跑，
   * 把 `activeDay` 又重置回 1（时序证据：刷新后 session 里的 `day` 从 2 变回 1）。
   * 只做一次就赶不上那次重置。⇒ 判据改成"**副本停在 1、而恢复值是别的天**"
   * （这正是"被重置"的特征；用户主动切到第 1 天时 `d > 1` 不成立，不会被误纠正）。
   *
   * ★ 用户自己切过天（`userPickedDayRef`）之后**不再干预** —— 面板才是"当前天"的主人。
   * ★ 必须等 `days` 到货：规划与 `days` 都是异步来的。
   */
  const userPickedDayRef = useRef(false)
  /**
   * ★★ 恢复值**直接读会话状态**，**不能读 `planUi.detailDay`**。
   *
   * 这是探针连着打回两次才看清的一层：上面那条广播 effect 会在 `activeDay` 被
   * `attach()` 重置回 1 时，把 `detailDay` 也写成 1 —— 于是"恢复值"当场变成 1，
   * 纠正在下一轮就失去依据（`d > 1` 不成立），形成"点了第 2 天、刷新回第 1 天"的死循环。
   * ⇒ 恢复值取自己那一份快照（`useRef` 的初值只在**首渲染**求值 —— 那时广播还没跑过）。
   */
  const restoredDayRef = useRef(readUiState().plan.day)
  const dayCount = view.store.days.length
  useEffect(() => {
    if (userPickedDayRef.current || dayCount === 0) return
    const d = restoredDayRef.current
    if (d > 1 && d <= dayCount && view.store.activeDay === 1) view.store.setActiveDay(d)
  }, [dayCount, view.store, view.store.activeDay])

  /**
   * 面板副本的 `activeDay` 变化 → 广播给 `planUi.detailDay`
   *（全站"当前天"的唯一出处，`SpotPicker` 与详情页的「添加到当前行程」都读它）。
   *
   * ★ **首屏跳过**：首屏那一刻副本还是初值 1，先广播就**把刚恢复的 `detailDay`
   *   覆盖成 1**（`_tmp/diag_session_day.mjs` 里抓到的就是这个）。
   */
  const firstSyncRef = useRef(true)
  useEffect(() => {
    if (firstSyncRef.current) {
      firstSyncRef.current = false
      return
    }
    usePlanUi.getState().setDetailDay(view.store.activeDay)
  }, [view.store.activeDay])

  // 海报导出（poster/usePosterExport.ts）：只导当前天；无点位/方式没选全则禁用（ⓘ 悬浮看原因）
  const { busy: posterBusy, progress: posterProgress, disabledReason: posterBlock, run: onExportPoster } =
    usePosterExport(plan, view.city, view.store, view.store.activeDay)

  /**
   * 「添加景点」：**不换 URL**（2026-09-27 用户定）。
   *
   * > 「现在点击是会跳转一个新的链接的，改成不跳链接，左侧打开对应城市的景点列表，
   * >   如果之前打开了景点详情，记得隐藏」
   *
   * 于是这条路径变成三步，顺序不能反：
   * 1. **先收起已打开的景点详情**（`closePagePoi()`）—— 它盖住的正是要用的地方；
   *    三页各自把 `closePoi` 注册给外壳，所以这一句在哪个页面上都成立。
   * 2. **本页自己就有这座城的清单 → 就地用**（城市页的左面板）。再浮一块同样的清单
   *    就是同一屏两份清单，用户不知道该点哪一份。
   *    ★ 判据来自**页面自己**（注册制 `PageSpotOps.spotListCity`），不是 URL：
   *      用 `pathname === '/city/<id>'` 会把行程深链 `/city/x/plan`（它就是城市页）
   *      与点位深链 `/city/x/poi/y` 判错 —— 从前的 bug 就在这里。
   * 3. **其余情况由外壳浮出清单**（`common/ui/plan/SpotPicker`，左边 348px）。
   *    ★ 以前这里是 `navigate('/city/<id>')`：URL 一变用户就"离开"了原页面，
   *      而他要的只是把景点挑出来加进这条规划。
   */
  function onAddSpot() {
    if (!plan?.cityId) return
    closePagePoi()
    if (pageSpotListCity() === plan.cityId) {
      // 关掉之后给一句引导 —— 不然"什么都没打开"时点这个按钮毫无反应
      usePlanUi.getState().showToast('在左侧列表里挑一个景点，点它的「添加行程」')
      return
    }
    usePlanUi.getState().openSpotPicker({ planId: plan.id, cityId: plan.cityId })
  }

  // 这条组还没有城市：时间链 / 坐标补全都用不上，给引导而不是空行程
  if (!plan || !plan.cityId) {
    return (
      <>
        <PanelHeader title={plan?.name ?? ''} onBack={closePlanDetail} onClose={closePanel} />
        <div className="scroll min-h-0 flex-1">
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <Icon name="route" size="xl" className="text-ink-2/60" />
            <p className="m-0 text-[13.5px] font-medium">这个组还没定城市</p>
            <p className="m-0 max-w-[240px] text-xs leading-relaxed text-ink-2">
              加第一个景点时它会自动归到那座城。
              先去一座城市（搜索或点地图上的徽标），再点某个景点的「添加行程」。
            </p>
          </div>
        </div>
      </>
    )
  }

  const pickingHere = picking?.planId === plan.id

  /**
   * 点标题 → 把那个点**居中并放大**。
   *
   * ★ 用 `focusPoint` 而不是 `fit([point], { minZoom })`：`fitBounds` 对**单点**
   *   只能从退化框 + padding 反推级别，实测落到 13.99 —— 而 `minZoom` 是"收缩框"、
   *   不是硬钳位，单点这条路上给不出保证。这里要的是**确定的**落点。
   */
  function focusStop(lng: number, lat: number) {
    shell.focusPoint({ lng, lat }, STOP_FOCUS_ZOOM)
  }

  return (
    <>
      <PanelHeader title={plan.name} onBack={closePlanDetail} onClose={closePanel} />

      {storeError ? (
        <p className="m-0 flex-none border-b border-line bg-line-2 px-3.5 py-2 text-[11.5px] text-ink-2">
          {storeError}
        </p>
      ) : null}

      <DegBars store={view.store} />

      {/*
       * 标签栏 = **切换**（不是跳转）：点谁，下面就换成谁。
       *
       * ★★ 2026-10-04 用户：「顶部的天数也是固定的，不随着页面滚动」——
       *   原来它在下面的滚动容器**里面**，行程一长（十几个点）它就跟着滚上去了，
       *   而"切天"是这一屏最常用的动作 ⇒ 移出来，成为与 `DegBars` 并列的固定条。
       *   ⚠️ 别再挪回滚动容器里；真需要吸顶就用 `sticky`，不要靠"放在流里"碰运气。
       */}
      <DayTabs
        days={view.store.days}
        activeDay={view.store.activeDay}
        /*
         * ★ 换天只做一件事：改面板自己的 `activeDay`。
         *   「加进哪一天」的所有消费者读的是 `planUi.detailDay`，而它由上面那个
         *   effect 单向同步 —— 不需要在这里再去通知谁（通知两处就是两处可能漏）。
         */
        onActivate={(day) => {
          // ★ 用户自己切的天 —— 之后"刷新恢复"那条不再干预（见上面那条 effect）
          userPickedDayRef.current = true
          view.store.setActiveDay(day)
        }}
        onAdd={() => view.store.setDayCount(view.store.days.length + 1)}
        onRemove={view.store.removeDay}
        onMove={view.store.moveDay}
      />

      {/* 内容区只有这一天 —— 删除 / 换序 / 改名都作用在**当前天**上 */}
      <div className="scroll min-h-0 flex-1">
        <StopTimeline
          days={view.store.days}
          activeDay={view.store.activeDay}
          stopByUid={stopByUid}
          province={view.city?.province ?? ''}
          cityName={view.city?.name ?? ''}
          store={view.store}
          /*
           * ★ 用 `view.legByUid`（`usePlanView` 里遍历相邻点算的），**不要**自己
           *   从 `view.timeline.legs` 取 —— 后者要求住宿点存在，而住宿点入口这一版
           *   被去掉了 ⇒ `timeline` 恒为 `null`，那段代码永远不会产出任何一行。
           *   详细理由写在 `usePlanView` 里 `legByUid` 的推导处。
           */
          legByUid={view.legByUid}
          optionSets={view.optionSets}
          optionLoading={view.optionLoading}
          onFocus={focusStop}
          onRemove={(uid) => view.store.removeItem(view.store.activeDay, uid)}
          onRename={(uid, name) => view.store.renameItem(view.store.activeDay, uid, name)}
          onMove={(from, to) => view.store.moveItem(view.store.activeDay, from, to)}
          onRequestOptions={view.onRequestOptions}
          onPickOption={view.onPickOption}
        />
      </div>

      {/* 海报导出进度行（仅导出中渲染）—— 详细进度不进按钮（长文案会撑爆按钮，用户实测） */}
      {posterProgress ? <PosterProgressRow text={posterProgress} /> : null}

      {/* 动作条：加明细的入口在底部（2026-09-28 用户定 —— 不压正文、不跟内容滚动） */}
      <div className="flex flex-none gap-2 border-t border-line px-3.5 py-2.5">
        <button
          type="button"
          onClick={onAddSpot}
          className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line text-[12.5px] hover:border-primary hover:text-primary"
        >
          <Icon name="nav" size="sm" />
          添加景点
        </button>
        <button
          type="button"
          onClick={() => (pickingHere ? stopPicking() : startPicking(plan.id))}
          className={`inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border text-[12.5px] ${
            pickingHere ? 'border-primary text-primary' : 'border-line hover:border-primary hover:text-primary'
          }`}
        >
          <Icon name="locate" size="sm" />
          {pickingHere ? '取消取点' : '地图上取点'}
        </button>
        {/* 导出海报（按钮+悬浮提示一体，见 poster/PosterExportButton.tsx） */}
        <PosterExportButton busy={posterBusy} disabledReason={posterBlock} onRun={onExportPoster} />
      </div>

      {/*
       * 住宿选择器：**入口（那行「设置住宿点」）这一版按用户要求去掉了**，
       * 所以它现在永远打不开。渲染留着 —— 住宿点那套逻辑用户说后面再调，
       * 入口回来时这里不用重新接。
       */}
      {view.stayPickerOpen ? (
        <StayPicker
          city={view.city}
          store={view.store}
          onClose={view.onCloseStayPicker}
          onUseCenter={view.onUseMapCenter}
          onDone={view.onStayPicked}
        />
      ) : null}
    </>
  )
}
