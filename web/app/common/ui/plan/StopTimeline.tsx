/**
 * 行程详情的内容区 —— **当前这一天的一条竖线**（plans/13 §6.11）。
 *
 * ```
 *  ◉  [图] 宽窄巷子                    ✕
 *  ┆        四川 · 成都 · 青羊区
 *  ┆  [🚗 12 分钟 · 3.2 公里  换方式/方案]  ← 段行（2026-10-04 加，可展开）
 *  ●  [图] 人民公园                    ✕
 *  ┆        四川 · 成都 · 青羊区
 *  ◉  [图] 地图取点（可改名）           ✕
 *           四川 · 成都 · 青羊区
 * ```
 *
 * ## 一次只渲染**一天**（2026-09-27 用户定）
 * 内容区只跟着 `activeDay` 走，天数标签栏从"跳转"变成"切换"，
 * 所以这里**没有天标题**（那信息已经写在标签栏上）。空天照样出一句「这一天还没有安排」。
 *
 * ## ★ 时间线的画法（2026-09-28 用户逐条定，当天改了两轮）
 * > 第一轮：「时间线左侧的连接线效果不对，上下没有连起来，得修复一下，然后改成用虚线，
 * >   而不是实线，那个圆点的颜色，改成景点类型那个颜色，而不是固定蓝色，
 * >   时间线的那个起点和终点，那个圆点，需要再显示一圈轮廓，标注这是开始点和结束点」
 * > 第二轮：「连接线得粗一点，现在根本看不清，时间线每个卡片之间是不是设置了外边距
 * >   还是设置了什么，那个虚线没连起来，起点和终点那个圆环的颜色和点的颜色保持一致，
 * >   间距加大一点，现在看不清中间的透明环」
 *
 * | 要求 | 做法 |
 * |------|------|
 * | 连线**上下要连起来** | **一个元素画完这一天**（`RAIL_LINE`，绝对定位在 `section` 上，从**首那颗外圈**画到**末那颗外圈**，端点靠 `RAIL_END_Y`）。★ 第一轮写成"每行各画一段"是错的，而且**错了两重**：行的 `py-2` 是**行的内边距**（不在那一列里）⇒ 每行末尾的线只到内容盒底部、行界处各断 16px；就算补上那 16px，`border-dashed` 的**相位也是每行重置**的 ⇒ 接缝偶尔撞出双倍空隙，看着仍然是断的 |
 * | 改成**虚线** | `border-l-2 border-dashed`（第二轮还要**粗一点**：1px 在 44px 的缩略图旁边看不见） |
 * | 虚线的**颜色** | `--color-ink-2` 的 50% —— ★ **不能用 `--color-line`**（`#e8ebf0`）：那是给 1px 描边用的（输入框 / 卡片边框），拿来画连线等于没有 |
 * | 圆点用**景点类型色** | `SUBTYPE_META[subtype].color` —— 与地图上的点位、清单里的色点**同一个出处**（地图取点没有细类 ⇒ 中性灰，不编一个类型出来） |
 * | 起点/终点加**一圈轮廓** | 首/末那颗外面套一个 20px 的**空心圈**（`border-2`），**颜色与圆点一致**（第二轮定：原来是 `ring-primary/45` 的蓝，与点不同色）。圆点 10px 居中 ⇒ 四周各 3px **透明**间隔 —— 用户说的"中间那个透明环"就是它（原来紧贴着，看不出是个环）。★ **第三轮**：连线的端点也改到**这圈上** —— 原来画到圆点中心，线会穿过那 3px 透明间隔、把环填掉 |
 *
 * ## 地图取点的两处特殊显示
 * > 「标题那行，不是直接显示地图取点，改成一个输入框，右侧有个勾图标，默认是地图取点，
 * >   然后第二行不是显示经纬度，而是显示省市区，保持和其他的一致」
 * ⇒ 标题 = `PointNameField`（**两态**：平时「名字 + ✎」，刚落到图上或点了 ✎ 才出输入框；
 *   改名走 `renameItem`，细节见那个文件头）；第二行 = 逆地理编码查来的省市区
 *   （`usePlanStops` 里补，见那个文件头）。查不到就写「定位中…」——
 *   **绝不用最近的城市去猜**（猜出来的地址看着没问题、实际是错的）。
 *
 * ## 拖拽只做"同一天之内"的换序
 * 跨天移动要处理住宿段与天数归属，那是另一件事（旧时间轴上叫 `moveItemToDay`）。
 * 这一版先不做，别假装做了。
 *
 * ## 为什么还留着 `DaySection` 这一层
 * `useDragSort` 是**有状态**的 hook，而"取哪一天"是运行时才知道的 ⇒ 让持有拖拽状态
 * 的那一层永远挂在"确定有内容"的分支上，父组件那边就可以安全地早退。
 */

import { Fragment } from 'react'

import { Icon } from '~/common/ui/Icon'
import { DwellStepper } from '~/common/ui/plan/DwellStepper'
import { dotColor, subtitleOf, Thumb } from '~/common/ui/plan/StopBits'
import { LegRow } from '~/common/ui/plan/LegRow'
import { PointNameField } from '~/common/ui/plan/PointNameField'
import { useDragSort } from '~/common/ui/plan/useDragSort'
import type { PlanStopView } from '~/common/logic/itinerary/planStops'
import type { LegResult } from '~/common/logic/itinerary/resolveLeg'
import { routeOptionKey, type RouteOptionSet } from '~/common/logic/itinerary/routeOptions'
import type { ItineraryState } from '~/common/logic/itinerary/store'
import { SUBTYPE_META, type ItineraryDay, type TransitPrefer, type TravelMode } from '~shared/schema'

/**
 * 圆点 10px；所在列 20px。
 * ★ 两者之差就是用户说的"**中间的透明环**"：外圈是 2px 描边的**空心圈**，圆点居中
 *   ⇒ 四周各留 3px 透明间隔（原来外圈紧贴圆点，根本看不出那是个环）。
 * ★ 有没有外圈都用这个列宽 —— 有外圈的行不该比别的行宽一点。
 */
const DOT_PX = 'size-2.5'
const DOT_COL_PX = 'size-5'

/**
 * 连线的样子 —— **2px 虚线**（用户：「连接线得粗一点，现在根本看不清」）。
 * ★ 颜色**不能用 `--color-line`**（`#e8ebf0`）：那是给 1px 描边用的（输入框 / 卡片边框），
 *   摆在 44px 高的缩略图旁边基本等于没有。这里用 `--color-ink-2` 的 50%。
 * ★ `left-[23px]` = 行的 `px-3.5`(14) + 列宽 20/2 − 线宽 2/2 ⇒ 线正好压在圆点纵轴上。
 */
const RAIL_LINE =
  'pointer-events-none absolute left-[23px] w-0 border-l-2 border-dashed border-ink-2/50'

/**
 * 圆点中心到行顶 / 行底的距离（px）。
 * 行高 = 缩略图 44 + 行的 `py-2`(16) = 60，圆点在行内垂直居中 ⇒ 30。
 * ★ 实际行高会因文案差**零点几像素**（取点那行比景点行高 ~1px），所以两端各差 ≲1px ——
 *   这是刻度问题、不是"断开"，探针的容差就是 1px。
 */
const DOT_CENTER_Y = 30

/** 首 / 末那颗外圈的半径（`DOT_COL_PX` 是 20px） */
const RING_R = 10

/**
 * **连线的端点距行顶 / 行底** —— 停在**首 / 末那颗外圈的外沿**上。
 *
 * > 用户 2026-09-28 第三轮：「起点和终点的连接线样式有问题，**连到中间那个点了**，
 * >   而不是连到外面那个圈」
 * > 第四轮（放大复测）：「你仔细看看呢，这个虚线，**直接穿过整个圆点了**」
 *
 * ★★ 关键在**线的方向**：线是从下面来的。
 *   · 首那颗标记：线在它**下方** ⇒ 端点该落在它的外圈**下沿**（`+ RING_R`）；
 *   · 末那颗标记：线在它**上方** ⇒ 端点该落在它的外圈**上沿**（也是 `+ RING_R`，从段底往上量）。
 *   第一版取的是 `− RING_R`（外圈**上**沿）—— 那是把线当成从上面搭下来的，
 *   于是线的端头落进圈里，还**穿过圈内那 3px 的透明间隔**（圆点只挡住中间 10px），
 *   看着就是"虚线直接穿过整个圆点"（8 倍放大图看得一清二楚）。
 * ⇒ 现在 40 = `DOT_CENTER_Y + RING_R`：线**一点也碰不到任何外圈里面**，
 *   中间的标记（没有圈）照旧由不透明的圆点自己盖住线。
 */
const RAIL_END_Y = DOT_CENTER_Y + RING_R

/** 圆点色：景点用细类色（与地图点位同源），地图取点用中性灰 */

export function StopTimeline({
  days,
  activeDay,
  stopByUid,
  province,
  cityName,
  store,
  legByUid,
  optionSets,
  optionLoading,
  onFocus,
  onRemove,
  onRename,
  onMove,
  onRequestOptions,
  onPickOption,
}: {
  days: ItineraryDay[]
  /** 当前天（1 起）—— **内容区唯一的渲染依据** */
  activeDay: number
  /**
   * `uid` → 补好字段的那一站（名字 / 坐标 / 缩略图 / 区名 / 地址）。
   * ★ 传 Map 而不是数组：**天与顺序一律由 `days` 决定**，这里只负责"把字段补上"。
   */
  stopByUid: Map<string, PlanStopView>
  /** 城市所属省（拼"省 · 市 · 区"用） */
  province: string
  cityName: string
  /** 点标题 → 地图上把这个点居中并放大 */
  onFocus: (lng: number, lat: number) => void
  onRemove: (uid: string) => void
  /** 改名（只有地图取点的输入框会调） */
  onRename: (uid: string, name: string) => void
  /** 同一天内换序，下标都是**天内**下标 */
  onMove: (from: number, to: number) => void
  /** 行程状态 —— 段行的展开态 / 已选方案 / 出行方式都从它读写 */
  store: ItineraryState
  /**
   * `uid` → **从这一站到下一站**的段。
   * ★ 按 `uid` 而不是下标取：时间链会漏掉取不到坐标的点，按下标会整体错位一格
   *   （两重理由写在 `PlanDetailView` 建这个 Map 的地方）。
   */
  legByUid: Map<string, LegResult>
  /** 段 uid → 已拉到的多方案集合。键是 `routeOptionKey(uid, mode)` —— 两种方式各一份 */
  optionSets: Record<string, RouteOptionSet>
  /** 正在查询的键（同一时刻只可能有一个在拉） */
  optionLoading: string | null
  /** 拉某段某个方式（+偏好）的路线 —— 选完方式 / 换完偏好由段行立刻调一次 */
  onRequestOptions: (uid: string, mode: TravelMode, prefer?: TransitPrefer) => void
  onPickOption: (uid: string, key: string) => void
}) {
  const day = days[activeDay - 1]
  // `activeDay` 在 store 里被钳位过（`removeDay` / `setDayCount`），正常到不了这里
  if (!day) return null

  return (
    <DaySection
      // 换天 = 换一次拖拽上下文（见文件头）
      key={activeDay}
      day={activeDay}
      items={day.items
        .map((it) => stopByUid.get(it.uid))
        .filter((x): x is PlanStopView => Boolean(x))}
      fill={day.items.length}
      province={province}
      cityName={cityName}
      store={store}
      legByUid={legByUid}
      optionSets={optionSets}
      optionLoading={optionLoading}
      onFocus={onFocus}
      onRemove={onRemove}
      onRename={onRename}
      onMove={onMove}
      onRequestOptions={onRequestOptions}
      onPickOption={onPickOption}
    />
  )
}

/** 这一天 —— 拖拽状态住在这里（见文件头：循环里不能调 hook） */
function DaySection({
  day,
  items,
  fill,
  province,
  cityName,
  store,
  legByUid,
  optionSets,
  optionLoading,
  onFocus,
  onRemove,
  onRename,
  onMove,
  onRequestOptions,
  onPickOption,
}: {
  day: number
  items: PlanStopView[]
  /** `day.items.length` —— 与 `items.length` 不同：坐标查不到的点**不在 `items` 里**时用作兜底说明 */
  fill: number
  province: string
  cityName: string
  store: ItineraryState
  legByUid: Map<string, LegResult>
  optionSets: Record<string, RouteOptionSet>
  optionLoading: string | null
  onFocus: (lng: number, lat: number) => void
  onRemove: (uid: string) => void
  onRename: (uid: string, name: string) => void
  onMove: (from: number, to: number) => void
  onRequestOptions: (uid: string, mode: TravelMode, prefer?: TransitPrefer) => void
  onPickOption: (uid: string, key: string) => void
}) {
  const drag = useDragSort(onMove)

  return (
    // `data-day` 留作定位锚点（"现在内容区在第几天"），但内容区不再有天标题
    // `relative` = 给那条**全天一条**的连线当定位基准（见下面）
    <section data-day={day} className="relative">
      {fill === 0 ? (
        <p className="m-0 px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-2/70">这一天还没有安排</p>
      ) : items.length === 0 ? (
        // 有明细但一条都渲染不出来（坐标与名字都没查到）—— 如实说，别显示成空天
        <p className="m-0 px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-2/70">
          这一天有 {fill} 条明细，但点位信息读取失败
        </p>
      ) : (
        <>
          {/*
           * 连线 = **一个元素画完这一天**（从第一颗圆点中心到最后一颗）。
           * ★ 上一版是**每行各画一段**，错在两重：行的 `py-2` 是**行的内边距**（不落在那一列里）
           *   ⇒ 每行末尾的线只到内容盒底部、行界处各断 16px；就算补上那 16px，
           *   `border-dashed` 的**相位也是每行重置**的，接缝仍会偶尔撞出双倍空隙。
           * ★ 只有一颗点时不画：一个点没有"连接"可言。
           */}
          {items.length > 1 ? (
            <span
              aria-hidden="true"
              data-rail
              className={RAIL_LINE}
              style={{ top: RAIL_END_Y, bottom: RAIL_END_Y }}
            />
          ) : null}

          <ul className="m-0 list-none p-0">
            {items.map((s, i) => {
              const first = i === 0
              const last = i === items.length - 1
              const dragging = drag.dragging === i
              const isOver = drag.over === i && !dragging
              /** 这一站到下一站的段。`null` = **还没选出行方式**（不是"取不到"） */
              const leg = legByUid.get(s.uid) ?? null
              return (
                <Fragment key={s.uid}>
                  <li
                    {...drag.bind(i)}
                    className={`flex items-center gap-2.5 px-3.5 py-2 ${dragging ? 'opacity-40' : ''} ${
                      isOver ? 'bg-line-2' : ''
                    }`}
                  >
                    {/*
                     * 左列 = **只有圆点**（连线画在 section 上，是全天一条）。
                     * ★ 用 `items-center` 让它落在行的垂直中线上 —— 与连线的端点同高。
                     * ★ `z-[1]`：连线是**定位元素**（画在流内内容之上），圆点要盖住它，
                     *   否则线条会横穿圆点（空心外圈的内侧最明显）。
                     */}
                    <span
                      data-dot={i}
                      className={`relative z-[1] flex ${DOT_COL_PX} flex-none items-center justify-center`}
                    >
                      {/* 起点 / 终点：**与圆点同色**的空心外圈（2px，中间留透明间隔） */}
                      {first || last ? (
                        <span
                          aria-hidden="true"
                          data-ring
                          className="absolute inset-0 rounded-full border-2"
                          style={{ borderColor: dotColor(s) }}
                        />
                      ) : null}
                      <span
                        aria-hidden="true"
                        data-dot-fill
                        className={`${DOT_PX} rounded-full`}
                        style={{ background: dotColor(s) }}
                      />
                    </span>

                    <Thumb stop={s} />

                  {/* 两行：标题（景点可点 → 地图居中放大；地图取点是可改名的输入框） / 省市区 */}
                  <div className="min-w-0 flex-1">
                    {s.kind === 'point' ? (
                      /*
                       * 两态（`PointNameField`）：平时是「名字 + ✎」，只有"刚落到图上"或
                       * 点了 ✎ 才出输入框 —— 细节与理由都在那个文件头。
                       */
                      <PointNameField
                      uid={s.uid}
                      name={s.name}
                      onCommit={(v) => onRename(s.uid, v)}
                      /* ★ 与下面「景点」那一路同一个行为：点名字 → 地图居中放大 */
                      onFocus={() => onFocus(s.lng, s.lat)}
                    />
                    ) : (
                      <button
                        type="button"
                        disabled={!s.resolved}
                        onClick={() => onFocus(s.lng, s.lat)}
                        aria-label={`在地图上查看「${s.name}」`}
                        className={`block max-w-full truncate text-left text-[13px] font-medium ${
                          s.resolved
                            ? 'cursor-pointer hover:text-primary hover:underline'
                            : 'cursor-default text-ink-2'
                        }`}
                      >
                        {s.name}
                      </button>
                    )}
                    {/*
                     * 副标题（省 · 市 · 区）+ **停留时长**。★ 停留放这一行右侧而不是单开一行：
                     * 每行再长 20px 会破坏用户定过的卡片间距；口径见 `DwellStepper` 文件头。
                     */}
                    <div className="mt-0.5 flex items-center gap-1">
                      <p className="m-0 min-w-0 flex-1 truncate text-[11px] text-ink-2">
                        {subtitleOf(s, province, cityName)}
                      </p>
                      <DwellStepper minutes={s.dwellMinutes} onChange={(m) => store.setDwell(s.uid, m)} />
                    </div>
                  </div>

                  <button
                    type="button"
                    aria-label={`从第 ${day} 天删掉「${s.name}」`}
                    onClick={() => onRemove(s.uid)}
                    className="inline-flex size-7 flex-none items-center justify-center rounded-md text-ink-2 hover:bg-line-2 hover:text-ink"
                  >
                    <Icon name="close" size="sm" />
                  </button>
                </li>
                  {/* ── 段行 = 「从这一站到下一站」的出行方式。末项不渲染：它的下一站是住宿点 ── */}
                  {!last ? (
                    <li className="flex items-start gap-2.5 px-3.5 pb-2">
                      {/* 两列占位（圆点+缩略图）让卡片与上一行文字左对齐。★ 占位不能放进 `LegRow`：那边的调用方列结构不同 */}
                      <span className={`${DOT_COL_PX} flex-none`} aria-hidden="true" />
                      <span className="w-11 flex-none" aria-hidden="true" />
                      <LegRow
                        leg={leg}
                        uid={s.uid}
                        open={store.activeLeg === s.uid}
                        // ★ 键含方式与偏好：换任一个都是另一组路线，取错键会显示上一次的结果
                        optionSet={
                          leg
                            ? optionSets[
                                routeOptionKey(s.uid, leg.mode, s.transitPrefer)
                              ]
                            : undefined
                        }
                        optionLoading={
                          leg
                            ? optionLoading ===
                              routeOptionKey(s.uid, leg.mode, s.transitPrefer)
                            : false
                        }
                        pickedKey={store.chosenOption[s.uid] ?? null}
                        onToggle={() => store.setActiveLeg(s.uid)}
                        onMode={(m) => {
                          /**
                           * ★ 选方式 = 写库 + **立刻拉该方式的路线**。
                           *   用户：「一种出行方式是有好几种路线的，所以切换到那个出行方式，
                           *   下方列表显示多条路线供用户选择」—— 只写库只是把时长算出来，
                           *   下面的列表还是空的。
                           */
                          store.setModeToNext(s.uid, m)
                          onRequestOptions(s.uid, m)
                        }}
                        onRequestOptions={(m) => onRequestOptions(s.uid, m)}
                        onPickOption={(k) => onPickOption(s.uid, k)}
                        transitPrefer={s.transitPrefer}
                        onTransitPrefer={(p) => {
                          /**
                           * ★ 换偏好与换方式同理：**写库 + 立刻用新偏好重拉**。
                           *   只写库的话，列表里还是上一组方案 —— 那和不做没区别。
                           *   （偏好进缓存键，所以这两次结果互不覆盖，见 `routeOptionKey`。）
                           */
                          store.setTransitPrefer(s.uid, p)
                          onRequestOptions(s.uid, 'transit', p)
                        }}
                      />
                    </li>
                  ) : null}
                </Fragment>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
