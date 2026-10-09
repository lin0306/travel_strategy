/**
 * 「关于」弹窗的**内容** —— 全站唯一出处（`AboutModal` 只负责外壳，见那个文件）。
 *
 * ## 为什么要整合（2026-09-29 用户第二轮）
 * > 「这两个感觉内容偏重复，整合一下，不要跳页面，也是用弹窗的形式」
 *
 * 第一版做成了两个**独立页面**（`/about` 与 `/credits`），各七节，重复的地方很显眼：
 * 「行程只存本地」说了两遍、「图片是外链」说了两遍、「地图来自腾讯位置服务」说了两遍、
 * 数据规模与已收录城市清单分散在两个 URL 里。合并后**七节**，每件事只说一次：
 *
 * | 原来的 | 现在 |
 * |--------|------|
 * | about「你的数据」+ credits「行程数据」 | **④ 你的数据**（一节） |
 * | about「内容与免责」+ credits「图片 / 文字与事实」 | **⑤ 内容与素材来源**（一节，含图源表） |
 * | about「技术说明」+ credits「地图」 | **⑥ 地图与技术**（一节） |
 * | about「数据规模」+ credits「已收录城市」 | **② 数据规模**（数字 + 可展开的城市清单） |
 *
 * ## 内容纪律（照旧）
 * 只写两类东西：**能算出来的数**（全部 `loadCityIndex()` 现算，不写死）与
 * **能验证的行为**（每条都能在页面上一试即知）。不写"致力于为用户提供……"那种话。
 */

import { useEffect, useState } from 'react'

import { Icon } from '~/common/ui/Icon'
import { loadCityIndex } from '~/common/data/data'
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
  { title: '地图本身就是目录', body: '缩放换级：省市 → 市/区 → 区 → 景点。点区徽标飞进这个区，点空白收起当前面板。' },
  { title: '点景点，就地看详情', body: '不跳页：详情浮在地图上，同时把那个点平移到没被面板挡住的地方。' },
  { title: '顶栏搜索（键盘友好）', body: '省 / 市 / 景点都能搜。↑↓ 选、Enter 确认、Esc 清空、/ 直接聚焦搜索框。' },
  { title: '把景点排成行程', body: '顶栏「路线规划」，或任意景点详情里的「添加行程」。天数标签可拖拽换序，每天内部也能拖动。' },
  { title: '全屏', body: '顶栏右侧那枚 ⛶：隐藏浏览器工具栏，把整块屏幕让给地图。再点一次退出，Esc 也可以。' },
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
      <Section title="这是什么">
        <P>
          行迹是一份<strong>图文旅游攻略</strong>，形态是地图而不是长列表：缩放地图就是在换层级，
          点开一枚景点就是它的图文详情。收录的每一座城市都有实采的景点、地址、坐标、图片与
          一句话推荐，数据在构建期就固化进站点 —— 打开即用，不需要等接口、也不需要注册。
        </P>
        <P>
          它同时是一个<strong>行程规划器</strong>：把感兴趣的景点排进某几天，行程只存在你自己的浏览器里。
        </P>
      </Section>

      {list.length > 0 ? (
        <Section title="数据规模">
          <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-3.5 sm:grid-cols-4">
            <Stat k="收录城市" v={String(list.length)} />
            <Stat k="景点与场所" v={String(pois)} />
            <Stat k="覆盖省级单位" v={String(provinces)} />
            <Stat k="数据更新至" v={updatedAt} />
          </dl>
          <details className="group mt-4 rounded-lg border border-line bg-surface">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2.5 text-[12.5px] text-ink-2 [&::-webkit-details-marker]:hidden">
              <Icon name="chev-right" size="sm" className="transition-transform group-open:rotate-90" />
              已收录城市（{list.length}）
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
          ★ 全屏中按 <Kbd>Esc</Kbd> 会先退出全屏 —— 那条键由浏览器接管，
          网页拦不住（YouTube、Google Maps 一样）。
        </P>
      </Section>

      <Section title="你的数据">
        <P>
          不注册、不登录、不做任何位置上报。行程与住宿点<strong>只保存在这台设备的浏览器里</strong>，
          清除浏览器数据就会消失；分享链接只包含点位与顺序，住宿点默认以「住宿点」代替，
          不含名称与坐标。
        </P>
      </Section>

      <Section title="内容与素材来源">
        <P>
          所有图片均为<strong>外链直链</strong>，仓库内不存放任何图片文件，版权归原作者所有；
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
        <P>
          <strong>明确排除：</strong>百度百科（图片有 Referer 防盗链，只有百度自己的域名取得到，
          且版权归属不清）· Pixabay（条款禁止热链）。携程 / 马蜂窝 / 小红书等平台的内容
          <strong>只作参考，不入库、不外链</strong>。
        </P>
        <P>
          每个点位都带出处与抓取时间，详情页的「溯源」可以展开看到具体来源。
        </P>
      </Section>

      <Section title="地图与技术">
        <P>
          地图与行政区划边界来自<strong>腾讯位置服务</strong>：省 / 市轮廓只取该服务的官方数据，
          不使用任何第三方 GeoJSON —— 这关系到国家版图表达的准确性。
        </P>
        <P>
          本站是纯静态站点：所有页面在构建期渲染成 HTML，运行时没有后端，
          行程编辑也在浏览器里完成。
        </P>
      </Section>

      <Section title="免责与反馈">
        <P>
          门票、开放时间、预约政策这类信息<strong>会变</strong>，出行前请以官方渠道为准；
          本站内容仅供参考，不构成任何出行承诺。发现内容有误、或认为某处素材使用不当，
          欢迎在项目仓库提 issue，我们会尽快处理。
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
