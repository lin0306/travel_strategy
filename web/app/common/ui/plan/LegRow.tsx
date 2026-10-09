/**
 * 「**这一段怎么走**」—— 相邻两个停靠点之间的**出行方式行**。
 *
 * ## 两个地方要它（所以独立成文件）
 *   · `TimelineRail` —— 带时刻的时间轴（首末锚在**住宿点**上，那一版没被渲染）
 *   · `StopTimeline` —— 路线规划详情里那个"一个一个的点"的列表
 * 2026-10-04 用户：「调整路线规划详情，现在的展示是一个一个的点，
 * 点之间需要增加一行，出行方式」。**抽出来给后者复用**，而不是照着再写一个 ——
 * 两份必然漂移（一个改了文案、另一个没改，这种错不报错、只能靠肉眼发现）。
 *
 * ## ★ 左缩进**由调用方决定**，本组件只画卡片本身
 * 两处的列结构不同（`TimelineRail` 是 `46px 时刻列 + 12px 圆点列`，
 * `StopTimeline` 是 `20px 圆点列 + gap + 44px 缩略图列`）。把占位列写在这里，
 * 就必有一边错位。所以由调用方包一层 `flex` 给缩进，本组件根节点是 `flex-1`。
 *
 * ## ★★ 「未选」是一个正式状态（`leg === null`）
 * 2026-10-04 用户：「出行方式**默认是不显示任何出行方式的**（这个后面可以做成一个设置，
 * 默认出行方式）」。
 * ⇒ 没选过就是没选过，卡片上写「选择出行方式」、**不给时长也不给距离**
 *   （那两个数只有选了方式之后才有意义 —— 步行和驾车差着数量级）。
 *   "默认出行方式"将来做成设置项时，改变的是**这里的初值**，而不是让本组件去猜。
 *
 * ## 三处如实标注，别混成"实测"
 * ① `source === 'estimate'` → 标「估算」（矩阵没命中，用直线距离折算的）
 * ② `source === 'not-applicable'` → 不显示距离（那是 0 的哨兵值，
 *    显示出来会写成"0 m 太远"这种自相矛盾的话），改说"走不过去 / 到不了"
 * ③ 打车费只在该模式且有值时才出现，且文案带「预估」（不含动态调价）
 */
import { Icon, type IconName } from '~/common/ui/Icon'
import { ModeSwitcher } from '~/common/ui/plan/ModeSwitcher'
import { RouteOptionList } from '~/common/ui/plan/RouteOptionList'
import { fmtDistance, fmtDuration, fmtFare } from '~/common/data/format'
import type { LegResult } from '~/common/logic/itinerary/resolveLeg'
import type { RouteOptionSet } from '~/common/logic/itinerary/routeOptions'
import {
  PENDING_CLS,
  PICKED_BG_CLS,
  PICKED_CLS,
  WARN_BG_CLS,
  WARN_TEXT_CLS,
} from '~/common/ui/plan/tokens'
import { MODE_META, type TransitPrefer, type TravelMode } from '~shared/schema'

export function LegRow({
  leg,
  uid,
  open,
  optionSet,
  optionLoading,
  pickedKey,
  onToggle,
  onMode,
  onRequestOptions,
  onPickOption,
  transitPrefer,
  onTransitPrefer,
}: {
  /** `null` = **这段还没选出行方式**（不是"取不到"）—— 见文件头那条 */
  leg: LegResult | null
  /** 段起点的 uid —— `undefined` 时不可展开（住宿点段没有可改的归属） */
  uid: string | undefined
  /** 展开中（选方式 / 看多条路线） */
  open: boolean
  /** ⚠️ 只在该 set 的 mode 与当前方式**一致**时才该传进来 —— 否则是上一次拉的结果 */
  optionSet: RouteOptionSet | undefined
  optionLoading: boolean
  pickedKey: string | null
  onToggle: () => void
  onMode: (m: TravelMode) => void
  /** 拉该方式的路线（换方式 / 换偏好后由调用方触发一次） */
  onRequestOptions: (m: TravelMode) => void
  onPickOption: (key: string) => void
  /** 公共交通的偏好（公交优先 / 地铁优先）。`undefined` = 均衡 */
  transitPrefer?: TransitPrefer
  /** 换偏好（传 `undefined` = 回到均衡）。**可选** —— 未渲染的那条旧链路不给它补线 */
  onTransitPrefer?: (p: TransitPrefer | undefined) => void
}) {
  const notApplicable = leg?.source === 'not-applicable'
  const modeLabel = leg ? MODE_META[leg.mode].label : ''

  return (
    <div className="min-w-0 flex-1 pb-2.5">
      <button
        type="button"
        onClick={onToggle}
        disabled={uid === undefined}
        className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left ${
          open ? 'border-primary' : 'border-line'
        }`}
      >
        <Icon
          name={leg ? ((MODE_META[leg.mode].ico as IconName) ?? 'route') : 'route'}
          size="sm"
          className="flex-none text-ink-2"
        />
        {!leg ? (
          // 未选：只给一句引导。**不给 0 分钟 / 0 米** —— 那会让人以为"这段不用走"
          <span className="min-w-0 flex-1 text-[12.5px] text-ink-2">选择出行方式</span>
        ) : notApplicable ? (
          // ⚠️ 不适用时 `leg.distance` 是 0（矩阵未命中的哨兵值），
          //    所以这里**不能显示距离** —— 会写成"0 m 太远"这种自相矛盾的话。
          <span className={`min-w-0 flex-1 text-[12.5px] ${WARN_TEXT_CLS}`}>
            这段{leg.mode === 'walking' ? '走不过去' : '到不了'} · 展开看替代方式
          </span>
        ) : (
          <>
            <span className="flex-none text-[12.5px] font-medium">{fmtDuration(leg.duration)}</span>
            <span className="flex-none text-[11.5px] text-ink-2">{fmtDistance(leg.distance)}</span>
          </>
        )}
        {/* 估算 / 不适用都要如实标，不能混成"实测" */}
        {leg?.source === 'estimate' ? (
          <span className="flex-none rounded bg-bg px-1.5 py-0.5 text-[10px] text-ink-2">估算</span>
        ) : null}
        {notApplicable ? (
          <span className={`flex-none rounded ${WARN_BG_CLS} px-1.5 py-0.5 text-[10px] ${WARN_TEXT_CLS}`}>
            {modeLabel}不适用
          </span>
        ) : null}
        {leg?.taxiFare !== undefined ? (
          <span className="flex-none text-[11.5px] text-ink-2">{fmtFare(leg.taxiFare)}</span>
        ) : null}
        <span className="ml-auto flex-none text-[11px] text-primary">
          {open ? '收起' : '出行方式'}
        </span>
      </button>

      {open && uid !== undefined ? (
        <>
          {/* 未选时段条不预选任何方式（`current = null`） */}
          <ModeSwitcher current={leg?.mode ?? null} onPick={onMode} />
          {/*
           * ★★ **只在公共交通下**才问"公交还是地铁优先"（2026-10-05 用户：
           *   「公交和地铁合并吧，改成公共交通，然后需要增加一个选项，
           *   公交优先或者地铁优先」）。
           *   驾车问"驾车优先"是废话 —— 这个选项是公共交通特有的换乘倾向。
           */}
          {leg?.mode === 'transit' ? (
            <TransitPreferRow value={transitPrefer} onChange={(p) => onTransitPrefer?.(p)} />
          ) : null}
          {/* 拉过方案才显示卡；没拉过时 RouteOptionList 内部返回 null */}
          <RouteOptionList
            set={optionSet ?? null}
            loading={optionLoading}
            pickedKey={pickedKey}
            onPick={onPickOption}
            onRetry={() => {
              if (leg) onRequestOptions(leg.mode)
            }}
          />
        </>
      ) : null}
    </div>
  )
}

/**
 * 公共交通的「**优先**」二选一（公交优先 / 地铁优先）。
 *
 * ## 为什么是"两个按钮 + 再点一次取消"，不是三个
 * 用户说的就是两个选项，而「均衡」是它们的**缺省**（字段不存在）。
 * 多摆一个"均衡"按钮，会让"当前是均衡"和"当前什么都没选"变成两种需要解释的状态；
 * 再点一次已选的那个就回到均衡，这更符合"开关"的直觉。
 *
 * ## 两个选项在接口那侧是**附加限制**（映射见 `transitPolicyOf`）
 * · 地铁优先 → `SUBWAY_FIRST`（优先坐地铁，但可以换公交）
 * · 公交优先 → `NO_SUBWAY`（**完全不含地铁**）
 * ⚠️ 后者比字面语义**强**：腾讯没有 `BUS_FIRST`，能做到的最接近的就是"不坐地铁"。
 *   结果里不会出现地铁方案 —— 这与"公交优先"的直觉一致，不必额外解释。
 */
const PREFERS: ReadonlyArray<readonly [TransitPrefer, string]> = [
  ['bus', '公交优先'],
  ['subway', '地铁优先'],
]

function TransitPreferRow({
  value,
  onChange,
}: {
  value: TransitPrefer | undefined
  onChange: (p: TransitPrefer | undefined) => void
}) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <span className="text-[10.5px] text-ink-2">优先</span>
      {PREFERS.map(([k, label]) => (
        <button
          key={k}
          type="button"
          // 再点一次已选中的那个 = 回到均衡
          onClick={() => onChange(value === k ? undefined : k)}
          aria-pressed={value === k}
          className={`inline-flex h-6 items-center rounded-full border px-2 text-[11px] ${
            value === k ? `${PICKED_CLS} ${PICKED_BG_CLS}` : PENDING_CLS
          }`}
        >
          {label}
        </button>
      ))}
      <span className="text-[10.5px] text-ink-2">都不选＝均衡</span>
    </div>
  )
}
