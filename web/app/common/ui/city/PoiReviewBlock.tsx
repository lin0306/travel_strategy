/**
 * **AI 点评**卡片 —— 详情页里唯一一块「带立场」的内容。
 *
 * ## 为什么单独成文件
 * `PoiDetail.tsx` 已经 380 行、五大块内容，再塞一块就顶到单文件 420 行的硬线。
 * 更要紧的是：这块的判据与别的都不一样（分数要能排序、免责必须出现、
 * facets 是动态条数），混在正文里改一次就要通读整页。
 *
 * ## 三条纪律
 * 1. **没有点评就整块不渲染**（调用方判 `poi.review`）。绝不写「暂无点评」占位 ——
 *    全站 4900 个点位，一旦有占位，遍地都是空框子，比不显示更糟。
 * 2. **免责必须出现**：分数是 AI 从公开信息归纳的，不是用户评分、也不是官方评定。
 *    用户 2026-11-10 明确要求「关于和详情里都要有免责说明」，
 *    完整版在 `AboutContent` 的「免责」一节，这里给一行紧贴卡片的。
 * 3. **facets 不参与总分**：`score` 走的是入库打分的四维口径（与 `rate_poi` 同源，
 *    所以列表按它排序不会和收录判断打架）；facets 只是「好在哪、差在哪」的解释。
 *    两者刻意不构成算术关系 —— 别拿 facets 求平均去校 score。
 */

import type { PoiReview } from '~shared/schema'
import { AI_REVIEW_SHORT } from '~/common/ui/doc/AiReviewNotice'

/** 综合分的四档配色：只有前两档用主色，避免全站一片蓝反而看不出差别 */
function scoreTone(score: number): string {
  if (score >= 4.0) return 'text-primary'
  if (score >= 3.6) return 'text-ink'
  return 'text-ink-2'
}

export function PoiReviewBlock({ review }: { review: PoiReview }) {
  return (
    <section
      // 不加阴影、不加底色：0.5px 边框就够把「判断」和「介绍」分开
      className="mt-4 rounded-lg border border-line px-3.5 py-3"
      aria-label="AI 点评"
    >
      <header className="flex items-baseline gap-1.5">
        <IconSpark />
        <span className="text-[12px] text-ink-2">AI 点评</span>
        <span className="ml-auto flex items-baseline gap-0.5">
          <b className={`text-[19px] font-semibold leading-none ${scoreTone(review.score)}`}>
            {review.score.toFixed(1)}
          </b>
          <span className="text-[11px] text-ink-2">/ 5</span>
        </span>
      </header>

      <div className="mt-1.5 text-[14.5px] font-semibold">{review.verdict}</div>

      {/* 分项：条数随点位性质变（博物馆看展陈与人流、爬山看体力与视野）。
          ★ 两列而不是单列铺满：面板内容宽 480px，单列时条要横跨 480px，
            「90% 与 50%」的差别被拉得很散、眼睛要跨半个面板才比得出来。
            两列后每条只占 230px，长短一眼可比。窄屏回落单列。 */}
      <div className="mt-3 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {review.facets.map((f) => (
          <Row key={f.label} label={f.label} score={f.score} />
        ))}
      </div>

      <p className="mt-3 mb-0 text-[13.5px] leading-[1.72] text-ink">{review.body}</p>

      {review.fits.length > 0 ? (
        <p className="mt-2.5 mb-0 flex gap-2 text-[12px] leading-relaxed">
          <span className="flex-none text-ink-2/70">适合</span>
          <span className="text-ink-2">{review.fits.join(' · ')}</span>
        </p>
      ) : null}
      {review.avoid.length > 0 ? (
        <p className="mt-1 mb-0 flex gap-2 text-[12px] leading-relaxed">
          <span className="flex-none text-ink-2/70">不适合</span>
          <span className="text-ink-2">{review.avoid.join(' · ')}</span>
        </p>
      ) : null}

      <div className="mt-3 border-t border-line pt-2">
        <p className="m-0 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-ink-2">
          <span>{review.basis === 'web' ? '已联网复核' : '据站内资料'}</span>
          <span aria-hidden="true">·</span>
          <span>{review.at}</span>
          {review.basis === 'web' && review.sources.length > 0 ? (
            <>
              <span aria-hidden="true">·</span>
              <a
                href={review.sources[0]}
                target="_blank"
                rel="noreferrer noopener"
                className="text-primary no-underline"
              >
                依据 {review.sources.length} 条
              </a>
            </>
          ) : null}
        </p>
        {/* ★ 免责紧贴卡片：这句话不是合规装饰，是让用户知道该信到什么程度。
            文案从 `doc/AiReviewNotice` 取 —— 与「关于」弹窗同一份真源 */}
        <p className="mt-1 mb-0 text-[11px] leading-relaxed text-ink-2/80">{AI_REVIEW_SHORT}</p>
      </div>
    </section>
  )
}

/** 一条分项。`score` 只画长度、不按高低换色 —— 换色会读成"警告"，而它只是强弱。
 *
 *  ★ 刻意**不显示** `facet.note`（"一侧红树林滩涂，一侧福田天际线"这类佐证）：
 *    两列布局里放下 note 必须改成三行一条，5 条就把卡片撑到 500px，
 *    而它说的内容正文基本都覆盖了。note 的用处是**留痕**——
 *    巡检或人工复盘时才需要知道"为什么这条打 2.5"，
 *    所以它留在数据里（`tools/ai_review.py` 可查），不上界面。 */
function Row({ label, score }: { label: string; score: number }) {
  return (
    <div className="grid grid-cols-[3.2em_1fr_auto] items-center gap-x-2">
      <span className="flex-none text-[11.5px] text-ink-2">{label}</span>
      <span className="h-[5px] overflow-hidden rounded-full bg-line">
        <span
          className="block h-full rounded-full bg-primary"
          style={{ width: `${Math.max(4, (score / 5) * 100)}%` }}
        />
      </span>
      <span className="w-[2.1em] text-right text-[11.5px] tabular-nums text-ink-2">
        {score.toFixed(1)}
      </span>
    </div>
  )
}

/** 四角星：全站唯一的「AI 生成」记号，与列表徽标用同一个形状 */
export function IconSpark({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true" className="flex-none">
      <path d="M7 0.5L8.7 5.3L13.5 7L8.7 8.7L7 13.5L5.3 8.7L0.5 7L5.3 5.3Z" fill="currentColor" />
    </svg>
  )
}
