/**
 * 「关于」弹窗的**内容** —— 全站唯一出处（`AboutModal` 只负责外壳，见那个文件）。
 *
 * ## 面向谁写（2026-10-16 重写，用户：「这个内容是给大众看的，现在感觉不像」）
 * 读者假设是**来这里查攻略的普通人**，不是来读技术文档的开发者。所以：
 *
 * | 原则 | 具体做法 |
 * |------|---------|
 * | **先说这是什么、对我有什么用** | 开头一屏内讲清「地图即目录」+「能排行程」，而不是先讲数据规模 |
 * | **数字服务于信任，不炫技** | 保留规模数（它证明"内容是真的"），但去掉"三通道上三角 base36"这类内部实现 |
 * | **采集策略不面向大众** | 「为什么排除百度百科/Pixabay」是给维护者看的决策记录，收进可展开区 |
 * | **技术细节降级** | 「构建期 SSG」「GCJ-02」这类压到最后，且说人话（"不需要注册，打开就能看"） |
 * | **开源要给门** | 新增「开源」一节：仓库地址 + 能做什么（看源码/提 issue/star）+ 许可证 |
 *
 * ★ 上一版的问题不是"写错了"，而是**视角错了** —— 它像一份给贡献者的说明书。
 *   内容纪律本身（只写能算出来的数、能验证的行为）保留，那条是对的。
 *
 * ## 内容纪律（照旧）
 * 只写两类东西：**能算出来的数**（全部 `loadCityIndex()` 现算，不写死）与
 * **能验证的行为**（每条都能在页面上一试即知）。不写"致力于为用户提供……"那种话。
 */

import { useEffect, useState } from 'react'

import { Icon } from '~/common/ui/Icon'
import { SiteMark } from '~/common/ui/SiteMark'
import { AiReviewNotice } from '~/common/ui/doc/AiReviewNotice'
import { loadCityIndex } from '~/common/data/data'
import { GITHUB_ISSUES_URL, GITHUB_REPO_URL, LICENSE_NAME } from '~/common/data/site'
import type { CityIndexItem } from '~shared/schema'

/**
 * 来源清单。⚠️ 硬编码是对的 —— 这里描述的是**采集策略**，不是逐条数据
 * （逐张署名在 `images[].credit`，每条事实的出处在 `sources[]`）。
 *
 * ★ 2026-11-08 三轮修订（前两轮各写错过一处，以第三轮为准）：
 *   ① 用户「只列了图片素材、数据来源没列」⇒ 拆 `DATA_SOURCES` / `IMAGE_SOURCES`。
 *   ② 复核发现「配图库存量已清空」是错的：清洗工具只扫点位目录，
 *      `city.json.heroImages`（83 城 ×3）里仍有 Pexels 83 / Unsplash 46 张；
 *      4716 条「百度百科」链接则全在 `sources[]`（文字溯源），不在图片 URL。
 *   ③ 用户「代码取完图还会让 AI 再过一遍，这两个源其实有用」⇒ 复核成立：
 *      补图链路的 `verdict_for` 只是参考分、不删图，看图判定才是终审。
 *      ⇒ 配图库恢复为**候选源**，但只准进 AI 审查链路，自动入库那条仍关闭。
 */

/** 数据本身来自哪里 —— 与下面的「图片素材」是两回事 */
const DATA_SOURCES = [
  {
    label: '点位名称、地址与坐标',
    source: '腾讯位置服务 · 高德开放平台',
    note: '地点搜索取名称、地址与分类，地理编码补坐标（GCJ-02）。腾讯当日配额用尽时自动改用高德，两家坐标系一致。',
  },
  {
    label: '行政区划与层级',
    source: '腾讯位置服务「区划」服务',
    note: '省 / 市 / 区的代码、层级关系与地图轮廓。三级下钻的计数都挂在这套区划码上，详见下方「地图与边界」。',
  },
  {
    label: '行程里的通勤耗时',
    source: '腾讯位置服务「路径规划 · 距离矩阵」',
    note: '不预存一份时间表：排行程时按你选的驾车、公交、步行或骑行实时计算，所以路况与线路变化会反映在结果里。',
  },
  {
    label: '文字、门票与开放时间',
    source: '场馆官网与官媒 · 百科（含百度百科） · 政府文旅部门 · 媒体报道',
    note: '每个点位逐条记录出处与抓取日期，详情页「溯源」可展开核对 —— 那里出现的「百度百科」是文字出处，不是图片来源。这类信息会变，出行前请以官方渠道为准。',
  },
]

/**
 * 图片素材来源与条款 —— **按用途分**：
 * 点位实景图必须"是这个地方"，城市封面只需传达氛围，两者对图源的要求不同。
 * 逐张署名不在这里，在 `images[].credit` / `heroImages[].credit`。
 */
const IMAGE_SOURCES = [
  {
    scope: '点位实景图（详情页）',
    source: 'Wikimedia Commons · Pexels · Unsplash',
    license: 'CC 系列 / Pexels License / Unsplash License（逐张不同）',
    links: [
      { label: 'Commons 条款 ↗', url: 'https://commons.wikimedia.org/wiki/Commons:Licensing' },
      { label: 'Pexels 条款 ↗', url: 'https://www.pexels.com/license/' },
      { label: 'Unsplash 条款 ↗', url: 'https://unsplash.com/license' },
    ],
    note: '主力是 Wikimedia Commons：它带 GPS 与 Commons 分类，可校验「是不是这个地方」。Pexels / Unsplash 只作无图点位的补充候选——代码抓完还要逐张看图，判无关的舍弃并永久记住，判对的才入库，署名按真实来源逐张显示。',
  },
  {
    scope: '城市封面（首页城市卡）',
    source: 'Wikimedia Commons · Pexels · Unsplash',
    license: 'CC 系列 / Pexels License / Unsplash License（逐张不同）',
    links: [
      { label: 'Pexels 条款 ↗', url: 'https://www.pexels.com/license/' },
      { label: 'Unsplash 条款 ↗', url: 'https://unsplash.com/license' },
    ],
    note: '83 座城每城 3 张，其中 43 座仍用着 Pexels / Unsplash 的历史图。封面只负责城市氛围、不对应具体点位，主题配图库在这里是合适的；新城市的封面采集目前未启用这两家。',
  },
]

/** 「怎么用」的每一条 —— 都是**已实现**的交互，能在页面上一试即知 */
const HOW_TO = [
  { title: '缩放地图就是在换层级', body: '全国看各省 → 省内看各市 → 城市看景点。不用点菜单，缩放就到位。' },
  { title: '点地名徽标，飞进那个地方', body: '点一下就飞过去；点地图空白处收起，面板不会一直挡着地图。' },
  { title: '点景点，就地看详情', body: '不跳页。图片、地址、一句话推荐都在地图上直接展开。' },
  { title: '用搜索直接跳到任何地方', body: '省 / 市 / 景点都能搜。↑↓ 选、Enter 确认、Esc 清空、/ 聚焦搜索框。' },
  { title: '把想去的地方排成行程', body: '顶栏「路线规划」，或任意景点里的「添加行程」。天数可拖拽换序，系统帮你算出路上花多久。' },
]

export function AboutContent() {
  const [cities, setCities] = useState<CityIndexItem[] | null>(null)

  useEffect(() => {
    let alive = true
    loadCityIndex().then((list) => {
      if (alive) setCities(list)
    })
    return () => {
      alive = false
    }
  }, [])

  const list = cities ?? []
  // ★ 全部**现算**：写死的数字会在下次扩城之后悄悄说谎
  const pois = list.reduce((n, c) => n + c.poiCount, 0)
  const provinces = new Set(list.map((c) => c.provinceAdcode)).size
  const updatedAt = list.map((c) => c.updatedAt).sort().at(-1)?.slice(0, 10) ?? ''

  return (
    <>
      {/* ★ 品牌块（2026-10-27 加）：移动端顶栏的 logo 撤掉了，用户要求
          「logo 等信息放到关于弹窗里面」，并且明确这条**两端通用**。
          放在最上面的理由与下面的「这是什么」一致 —— 先回答"我在看什么东西"。
          ★ 图形走 `SiteMark`（与 favicon / 桌面站标同一份），不再画第二套。 */}
      <div className="mt-4 flex items-center gap-3">
        <SiteMark size={44} className="flex-none" />
        <div className="min-w-0">
          <p className="m-0 flex flex-wrap items-baseline gap-x-2">
            <b className="text-[16px] leading-tight tracking-tight">行迹</b>
            <span className="text-[11.5px] text-ink-2">城市旅游攻略</span>
          </p>
          <p className="mt-1 mb-0 text-[12px] leading-relaxed text-ink-2">
            一张地图，安排一次旅行。开源、无广告、不用注册。
          </p>
        </div>
      </div>

      {/* ★ 开篇先讲"这是什么、对我有什么用"。上一版把「数据规模」放在第二节，
          而一个还没决定要不要信它的人，此刻最想知道的不是有多少个景点。 */}
      <Section title="这是什么">
        <P>
          行迹是一份<strong>把地图当目录</strong>的旅游攻略。缩放地图就是在换层级 ——
          从全国到省、从省到城市、再到城市里的景点；不用在菜单里翻，点一下地名就飞过去。
          点开一枚景点，它的图片、地址和一句话推荐直接浮在地图上。
        </P>
        <P>
          它同时是个<strong>行程规划器</strong>：把中意的景点排进某几天，
          系统按驾车、公交、地铁、骑行或步行<strong>算出路上要多久</strong>，
          并在时间轴上提醒你"路上花的时间超过了游玩时间"。
        </P>
        <P>
          <strong>不用注册、不用登录、不用等加载。</strong>打开就能看。
        </P>
      </Section>

      {list.length > 0 ? (
        <Section title="收录了多少">
          <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-3.5 sm:grid-cols-4">
            <Stat k="城市" v={String(list.length)} />
            <Stat k="景点与场所" v={String(pois)} />
            <Stat k="省级单位" v={String(provinces)} />
            {/* 不说「更新至」：那是全库点位里**最近一次内容修改**的日子，不是站点发布日 */}
            <Stat k="最近更新" v={updatedAt} />
          </dl>
          <p className="mt-3 mb-0 text-[12px] leading-relaxed text-ink-2">
            这些数字不是手填的：站点每次构建时直接从已收录的城市与点位里现算 ——
            城市数、点位数按实际条目统计，省级单位按行政区划代码去重；
            日期是全部点位中最近一次内容更新的那天。采集任务每天更新数据，
            页面上的数字会在<strong>站点重新构建后</strong>同步。
          </p>
          <details className="group mt-4 rounded-lg border border-line bg-surface">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2.5 text-[12.5px] text-ink-2 [&::-webkit-details-marker]:hidden">
              <Icon name="chev-right" size="sm" className="transition-transform group-open:rotate-90" />
              具体是哪{list.length} 座城市
            </summary>
            <ul className="m-0 list-none border-t border-line px-3 py-2.5">
              {list.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-1 text-[12.5px]">
                  <span>
                    {c.name} <span className="text-ink-2">{c.province}</span>
                  </span>
                  <span className="text-[11.5px] tabular-nums text-ink-2">
                    {c.poiCount} 个 · {c.updatedAt.slice(0, 10)}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </Section>
      ) : null}

      <Section title="怎么用">
        <ul className="m-0 list-none space-y-2 p-0">
          {HOW_TO.map((h) => (
            <li key={h.title} className="rounded-lg border border-line bg-surface px-3 py-2.5">
              <b className="text-[13px]">{h.title}</b>
              <p className="mt-0.5 mb-0 text-[12.5px] leading-relaxed text-ink-2">{h.body}</p>
            </li>
          ))}
        </ul>
        <P>
          {'键盘：'}
          <Kbd>↑</Kbd> <Kbd>↓</Kbd> 移动、<Kbd>Enter</Kbd> 选中、<Kbd>Esc</Kbd> 清空搜索或收起面板、
          <Kbd>/</Kbd> 聚焦搜索框。
        </P>
        <P>
          ★ 全屏中按 <Kbd>Esc</Kbd> 会先退出全屏 —— 那条键由浏览器接管，网页拦不住。
        </P>
      </Section>

      {/* ★ 新增（2026-10-16）：用户配好 GitHub 后要求有地方能打开。
          顶栏也有一枚图标入口（见 `TopBar.tsx` 的 `RepoButton`），两处指向同一个常量。 */}
      <Section title="开源">
        <P>
          这个站点的全部内容与代码都是<strong>公开的</strong>。你可以：
        </P>
        <ul className="m-0 list-none space-y-1.5 p-0 text-[12.5px]">
          <RepoAction href={GITHUB_REPO_URL} icon="github" title="浏览源代码">
            看看它是怎么做的，或自己部署一份
          </RepoAction>
          <RepoAction href={GITHUB_ISSUES_URL} icon="alert" title="反馈问题">
            景点信息有错、图片挂了、想加一座城市 —— 在这里提
          </RepoAction>
        </ul>
        <P>
          许可证是 <b>{LICENSE_NAME}</b>。图片版权属于各自作者，按下方条款使用。
        </P>
      </Section>

      <Section title="你的数据">
        <P>
          不注册、不登录、不做任何位置上报，<strong>也没有统计脚本</strong>。
          行程与住宿点只保存在这台设备的浏览器里，清除浏览器数据就会消失；
          分享链接只包含点位与顺序，住宿点默认以「住宿点」代替，不含名称与坐标。
        </P>
      </Section>

      <Section title="数据来源">
        <P>
          下面这些是<strong>数据本身</strong>的来源 —— 点位、区划、通勤耗时与文字各走一条链，
          和配图素材是两回事。
        </P>
        <ul className="mt-2.5 list-none space-y-2 p-0">
          {DATA_SOURCES.map((s) => (
            <li key={s.label} className="rounded-lg border border-line bg-surface px-3 py-2.5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <b className="text-[13px]">{s.label}</b>
                <span className="text-[11.5px] text-ink-2">{s.source}</span>
              </div>
              <p className="mt-1 mb-0 text-[12px] leading-relaxed text-ink-2">{s.note}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="图片与文字素材">
        <P>
          所有图片均为<strong>外链直链</strong>，版权归原作者所有，需要署名的逐张显示作者与许可。
          <strong>点位实景图</strong>和<strong>城市封面</strong>对图源的要求不同，所以分开列：
          前者必须"是这个地方"，后者只需传达城市氛围。
        </P>
        <ul className="mt-3 list-none space-y-2 p-0">
          {IMAGE_SOURCES.map((s) => (
            <li key={s.scope} className="rounded-lg border border-line bg-surface px-3 py-2.5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-[11px] text-ink-2">{s.scope}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-baseline gap-2">
                <b className="text-[13px]">{s.source}</b>
                <span className="text-[11.5px] text-ink-2">{s.license}</span>
                {s.links.map((l) => (
                  <a
                    key={l.url}
                    href={l.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-[11.5px] text-primary no-underline"
                  >
                    {l.label}
                  </a>
                ))}
              </div>
              <p className="mt-1 mb-0 text-[12px] leading-relaxed text-ink-2">{s.note}</p>
            </li>
          ))}
        </ul>

        {/* ★ 采集策略是给维护者看的决策记录，收进折叠区。
            必须写清"两条链路的边界"与"百度百科为什么只出现在溯源里"。 */}
        <details className="group mt-3 rounded-lg border border-line bg-surface">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2.5 text-[12.5px] text-ink-2 [&::-webkit-details-marker]:hidden">
            <Icon name="chev-right" size="sm" className="transition-transform group-open:rotate-90" />
            图片选型记录（两条链路 · 排除的来源）
          </summary>
          <div className="space-y-2 border-t border-line px-3 py-2.5 text-[12px] leading-relaxed text-ink-2">
            <p className="m-0">
              <strong>为什么要分两条链路：</strong>Pexels / Unsplash 是<strong>主题配图库</strong>而非地点图库
              —— 搜「农安辽塔」给出的是上海的古塔，也没有 GPS / 分类可供过滤。
              西安 57 张首审判出 30 张错、长春 57 张判出 33 张错，几乎全来自这两家。
              但问题出在「代码判完直接入库」：<strong>每日自动采集只收 Wikimedia</strong>；
              补图任务则把三家候选都抓来、逐张看图，判无关的舍弃且永久记住。
              暂时没有实景图的点位显示「暂无图片」，绝不垫一张别处的图。
            </p>
            <p className="m-0">
              <strong>百度百科：</strong>图片明确排除（有 Referer 防盗链，只有百度自家域名取得到，版权归属也不清）。
              详情页「溯源」里那些「××·百度百科」是<strong>文字事实的出处链接</strong>，不是图片来源；
              另有 6 个点位留着早期用于查百科的关键词字段，目前都没有配图。
            </p>
            <p className="m-0">
              <strong>明确排除：</strong>Pixabay（条款禁止热链）。携程 / 马蜂窝 / 小红书等平台的内容
              <strong>只作参考，不入库、不外链</strong>。
            </p>
          </div>
        </details>
      </Section>

      <Section title="地图与边界">
        <P>
          底图由<strong>腾讯位置服务</strong>渲染；省 / 市轮廓只取该服务的官方数据，
          不使用任何第三方 GeoJSON —— 这关系到国家版图表达的准确性。
          三级区划的代码与层级见上方「数据来源」。
        </P>
        <P>
          本站是纯静态站点，页面在构建期就渲染好了，运行时没有后端，
          行程编辑也在你自己的浏览器里完成。
        </P>
      </Section>

      <Section title="免责">
        <P>
          门票、开放时间、预约政策这类信息<strong>会变</strong>，出行前请以官方渠道为准；
          本站内容仅供参考，不构成任何出行承诺。发现内容有误、或认为某处素材使用不当，
          欢迎在 <ExtLink href={GITHUB_ISSUES_URL}>项目仓库提 issue</ExtLink>，我们会尽快处理。
        </P>
        {/* AI 点评的免责。文案在 `AiReviewNotice`（详情卡片取短版），此处只引用 */}
        <AiReviewNotice />
      </Section>
    </>
  )
}

/* ────────────────────────────────────────────────
 * 版式原子（只服务这一份内容 —— 独立页面删掉之后，它们没有别的用户）
 * ────────────────────────────────────────────── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-[14px] font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="m-0 text-[12.5px] leading-relaxed text-ink-2">{children}</p>
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-surface px-1 py-0.5 font-sans text-[11px] text-ink">
      {children}
    </kbd>
  )
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[11.5px] text-ink-2">{k}</dt>
      <dd className="m-0 text-[18px] font-semibold tabular-nums">{v}</dd>
    </div>
  )
}

/** 站外链接 —— `rel` 三件套是全站统一写法，护栏会查。 */
function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="text-primary no-underline">
      {children}
    </a>
  )
}

/** 开源节里的一行：图标 + 做什么 + 详情 */
function RepoAction({
  href,
  icon,
  title,
  children,
}: {
  href: string
  icon: 'github' | 'alert'
  title: string
  children: React.ReactNode
}) {
  return (
    <li>
      <ExtLink href={href}>
        <span className="flex items-start gap-2 rounded-lg border border-line bg-surface px-3 py-2">
          <Icon name={icon} size="sm" className="mt-0.5 flex-none text-primary" />
          <span className="min-w-0">
            <b className="block text-[12.5px] text-ink">{title}</b>
            <span className="text-[12px] text-ink-2">{children}</span>
          </span>
        </span>
      </ExtLink>
    </li>
  )
}