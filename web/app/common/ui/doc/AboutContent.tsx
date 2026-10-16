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
import { loadCityIndex } from '~/common/data/data'
import { GITHUB_ISSUES_URL, GITHUB_REPO_URL, LICENSE_NAME } from '~/common/data/site'
import type { CityIndexItem } from '~shared/schema'

/** 素材来源与条款。⚠️ 硬编码是对的 —— 它描述的是**采集策略**，不是数据（逐张署名在 `images[].credit`） */
const IMAGE_SOURCES = [
  {
    source: 'Wikimedia Commons',
    license: 'CC0 / CC BY / CC BY-SA（逐张不同）',
    url: 'https://commons.wikimedia.org/wiki/Commons:Licensing',
    note: '主力来源。需要署名的图必须逐张显示作者与许可；图片文件经镜像访问（原始域名国内不可达）。',
  },
  {
    source: 'Pexels',
    license: 'Pexels License',
    url: 'https://www.pexels.com/license/',
    note: '补充来源。允许热链、免署名，我们仍保留作者与链接。',
  },
  {
    source: 'Unsplash',
    license: 'Unsplash License',
    url: 'https://unsplash.com/license',
    note: '兜底来源，条款最宽松；对中文景点名的命中率低，所以只在前两源都无果时使用。',
  },
]

const TEXT_SOURCES = [
  '场馆官网与官方公众号（开放时间、门票、交通）',
  '维基百科 / 百度百科（历史沿革、文化背景）',
  '政府文旅部门公开信息（景区等级、预约政策）',
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
            <Stat k="更新至" v={updatedAt} />
          </dl>
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

      <Section title="内容与素材来源">
        <P>
          所有图片均为<strong>外链直链</strong>，版权归原作者所有；
          需要署名的图会在图上直接显示作者与许可。文字与事实整理自：
        </P>
        <ul className="m-0 mt-2 list-disc space-y-1 pl-5 text-[12.5px] leading-relaxed text-ink-2">
          {TEXT_SOURCES.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <ul className="mt-3 list-none space-y-2 p-0">
          {IMAGE_SOURCES.map((s) => (
            <li key={s.source} className="rounded-lg border border-line bg-surface px-3 py-2.5">
              <div className="flex flex-wrap items-baseline gap-2">
                <b className="text-[13px]">{s.source}</b>
                <span className="text-[11.5px] text-ink-2">{s.license}</span>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-[11.5px] text-primary no-underline"
                >
                  许可条款 ↗
                </a>
              </div>
              <p className="mt-1 mb-0 text-[12px] leading-relaxed text-ink-2">{s.note}</p>
            </li>
          ))}
        </ul>
        <P>每个点位都带出处与抓取时间，详情页的「溯源」可以展开看到具体来源。</P>

        {/* ★ 采集策略是给维护者看的决策记录，收进折叠区 —— 上一版平铺在正文里，
            一个想查攻略的人不会关心"为什么不用 Pixabay"。 */}
        <details className="group mt-3 rounded-lg border border-line bg-surface">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2.5 text-[12.5px] text-ink-2 [&::-webkit-details-marker]:hidden">
            <Icon name="chev-right" size="sm" className="transition-transform group-open:rotate-90" />
            图片为什么选这几家（选型记录）
          </summary>
          <div className="border-t border-line px-3 py-2.5 text-[12px] leading-relaxed text-ink-2">
            <p className="m-0">
              <strong>明确排除：</strong>百度百科（图片有 Referer 防盗链，只有百度自己的域名取得到，
              且版权归属不清）· Pixabay（条款禁止热链）。携程 / 马蜂窝 / 小红书等平台的内容
              <strong>只作参考，不入库、不外链</strong>。
            </p>
          </div>
        </details>
      </Section>

      <Section title="地图与边界">
        <P>
          地图与行政区划边界来自<strong>腾讯位置服务</strong>：省 / 市轮廓只取该服务的官方数据，
          不使用任何第三方 GeoJSON —— 这关系到国家版图表达的准确性。
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