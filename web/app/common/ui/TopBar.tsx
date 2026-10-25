/**
 * 顶栏 —— **一条通栏悬浮条**，贴在地图顶端（`top = --flt-inset`）。
 *
 * ## 形态：通栏，不是两块贴角胶囊
 * 这里改过一轮，结论写下来免得再翻回去：
 * 早先版本做成"左右两块小胶囊、中间让地图透出来"，理由写在注释里
 * ——「通栏会把地图横切成上地图 + 一条栏」。**那个理由是错的**，三处对不上：
 *   · 高保真原型（`prototype/hifi/index.html` 的 `.topbar`）是
 *     `left/right: var(--flt-inset)` 的**整条通栏**；
 *   · 低保真原型（`prototype/index.html` 的 `.topbar`）同样是通栏；
 *   · `plans/05-ui-ux-design.md` P1 骨架画的也是一整条 `┌─ 顶栏浮层 ─┐`。
 * 三个来源一致，只有实现这边是胶囊 —— 那是实现自己发明的形态。
 * ★ 那两份原型已于 2026-10-07 删除（连同整个 `prototype/`），但**上面的结论仍成立**
 *   —— 三方一致的证据里还剩 `plans/05` 这条，够硬。
 * 52px 的一条浮层压在 900px 视口顶端，是"贴在画布上的一张纸条"，
 * 不是把画布横切一刀。
 *
 * ## 内容：左中右三段
 * | 位置 | 内容 |
 * |------|------|
 * | 左 | 站标（Logo + 行迹 + 城市旅游攻略）→ 搜索框 |
 * | 右 | 页面动作 → **底图下拉** → 站点导航 → 全屏 |
 *
 * ## ★ 顶栏不再显示"我在哪"（2026-09-22，第二次撤）
 * 演进全程记在这里，免得又被"顺手加回来"：
 *   1. 最早是「地区选择器（全国 ▾）+ 面包屑（› 四川 › 成都）」并排；
 *   2. 2026-09-19 撤面包屑，只留选择器，按钮文字 = 当前所在地区；
 *   3. 2026-09-22 撤选择器，改成**只读文字** —— 这一步是**多余的妥协**，
 *      用户要的是这一格整个消失，结果又把同一句话说了第三遍（已纠正）；
 *   4. 2026-09-22 晚 **只读文字也删掉**，`region` 属性从组件契约里移除。
 *
 * 为什么该删：它和地图的缩放揭示是**两套并行的"我在哪"** ——
 *   · 文字按 URL 说"我在四川"，而地图按 zoom=7.5 已经把市徽标铺出来了；
 *   · 它与视野毫无联动，读起来像"当前聚焦到了哪儿"，其实只是路由名；
 *   · 4 个直辖市因收录映射的问题在里面根本点不动（已存在的 F1 缺陷），
 *     进一步加深"这玩意儿和地图对不上"的印象。
 *
 * 现在**换级只有一个入口：搜索**（第六节）。输入省 / 市 / 景点 → 直接跳到
 * 对应的路由 → 由页面自己的取景规则决定镜头。少一套并行状态，就不会再打架。
 * "这是哪儿"由三个更强的信号回答：URL、地图上铺的是哪一级、页面面板标题。
 * `RegionPicker.tsx` 与它专用的 `useRegionOptions.ts` 已删。
 *
 * ## ★ 站点导航里的「城市」也删了（同日）
 * 它本是"当前所在板块"的书面表达（原型里是 `<a href="#">`，不可点），
 * 但顶栏**本来就在城市页这一屏上** —— 写个「城市」等于"你现在在看城市页"，
 * 是零信息量的自我描述；何况全站只有这一个板块，没有第二个可切。
 * 现已移除，`NavTodo` 里不再有它。
 *
 * ## 原型上那四样占位，现在**全部做完了**（2026-09-29 定稿）
 * 高保真原型里顶栏有搜索框 / 关于 / 数据来源 / 全屏，本项目起初一样都没有。
 * 三条路各有各的坏：
 *   · 不放 → 顶栏和原型不一样，看不出"这些东西规划过"；
 *   · 放成能点的假按钮 → 点一下没反应，被当成 bug（踩过一次：早先站名按钮兼做回首页，
 *     在首页上是空操作，用户直接问"这玩意儿有什么用"）；
 *   · 放成纯灰按钮 → 被当成"坏了 / 权限不够"，而不是"还没做"。
 * 所以当时一律 `disabled` + 「待开发」。之后逐个补上：
 *
 * | 占位 | 现在 |
 * |------|------|
 * | 搜索框 | **真功能**（2026-09-24）：输入省 / 市 / 景点 → 点一条结果 → 镜头飞过去 / 就地开详情，全程**不换 URL**。★ 它是**唯一"能打字"的东西**，也是本页唯一有键盘语义的地方：`↑↓` 移动 / `Enter` 选中 / `Esc` 清空 / `/` 聚焦（见 `SearchBox.tsx`） |
 * | 关于 · 数据来源 | **一枚按钮 + 弹窗**（2026-09-29）：点开 `AboutModal`，**不跳页**。内容合成一份（`common/ui/doc/AboutContent`）—— 原来那两个独立页面（`/about` / `/credits`）内容重叠、又没有分享场景，已删掉 |
 * | 全屏 | **真功能**（2026-09-29）：一枚按钮两态，进 / 出走 `common/logic/useFullscreen`。之前它被判为"优先级最低"（理由是"地图本来就铺满视口，F11 也一样"）—— 那个理由漏了一点：**铺满的是浏览器视口**，地址栏与工具栏还在，全屏是把这部分也让出来 |
 *
 * ⇒ 占位列表空了，`TodoTag` 组件连同它那份"为什么禁用态要写明原因"的说明一并删除
 *   （2026-09-29）。将来又有"按原型摆好但没做"的控件时，去 git 历史里找它，
 *   别再写第二份 —— 同一件事只留一处实现。
 *
 * ## 两种形态：browse / task
 * 原型在详情页与行程页会把**搜索框与站点导航摘掉**，把顶栏让给页面动作
 * （返回 / 分享 / 导出）。照搬这个判断，用 `variant` 显式声明，
 * 不靠"传没传 actions"去猜 —— 猜出来的规则没人能读懂。
 *
 * ## 底图是**用户自己选**的（2026-09-19 改，2026-09-25 再改）
 * 原来这里是「矢量｜影像」分段控件，外加"按缩放自动降级"与一个锁定开关。
 * 现在换成菜单（`BasemapMenu`）：**一个底图类型 + 一组详细度开关**，
 * 选项与开关项全部来自引擎层的表；自动降级已删除 —— 用户选什么就渲染什么。
 * 理由与被删掉的那套设计的代价写在 `basemap.ts` 文件头。
 */

import { useNavigate } from 'react-router'

import { Icon } from '~/common/ui/Icon'
import { BasemapMenu } from '~/common/ui/BasemapMenu'
import { Brand } from '~/common/ui/Brand'
import { Overlay } from '~/common/ui/Overlay'
import { SearchBox } from '~/common/ui/SearchBox'
import { PlanMenuButton } from '~/common/ui/plan/PlanMenuButton'
import { useDocUi } from '~/common/logic/docUi'
import { GITHUB_REPO_URL } from '~/common/data/site'
import { useFullscreen } from '~/common/logic/useFullscreen'
import type { MapShellContext } from '~/common/logic/mapShell'
import type { ReactNode } from 'react'

export interface TopBarProps {
  /** 右侧页面动作（如"我的行程"）。任务态（详情 / 行程）才用得上 */
  actions?: ReactNode
  shell: MapShellContext
  /**
   * `browse`（默认）= 浏览态：带搜索框与站点导航。
   * `task` = 任务态（点位详情 / 行程）：顶栏让给页面动作，摘掉搜索与站点导航。
   */
  variant?: 'browse' | 'task'
}

/**
 * 分隔竖线。原型 `.vdiv`。窄屏不渲染 —— 那一行每一像素都要留给主内容。
 * 站点导航组自带一条不分档的竖线（整组一起进 `lg` 断点，见下方 ④）。
 */
function VDiv() {
  return <span className="hidden h-5 w-px flex-none bg-line sm:block" aria-hidden="true" />
}

/**
 * 「关于」入口的文案 —— 唯一出处（护栏也读它）。
 *
 * 它把原来那两枚（关于 / 数据来源）合并成**一枚**，打开一块**弹窗**（`AboutModal`）：
 *   · 两页的内容本来就重叠 —— 行程隐私、图片外链、地图来源各说了两遍
 *     （用户 2026-09-29：「这两个感觉内容偏重复，整合一下，**不要跳页面**，也是用弹窗的形式」）；
 *   · 而且这两个页面**没有任何分享场景**（不会有人把"关于本站"发给别人），
 *     独立 URL 的唯一价值就是"能被这枚入口打开" —— 入口改开弹窗之后它就没有理由了。
 * ⇒ 内容合成一份（`common/ui/doc/AboutContent.tsx`），路由 `/about` 与 `/credits` 一并删除：
 *   **同一件事只留一处实现**，不会出现"改了弹窗、页面还是旧的"。
 */
const DOC_LABEL = '关于'

/**
 * GitHub 仓库入口（2026-10-16 加）。
 *
 * ## 为什么放在顶栏而不是只放「关于」里
 * 用户原话：「我现在配好 github 了，这个项目是开源的，要有地方可以打开 github」。
 * 只放「关于」弹窗里的问题很实际：**没人会为了找仓库去读免责条款那一屏** ——
 * 而「star / 提 issue」正是希望被顺手发现的动作。所以顶栏给一枚常驻图标，
 * 「关于」里另有一节详细的介绍与链接（两处指向**同一个常量**）。
 *
 * ## 为什么是图标而不是"GitHub"三个字
 * 顶栏右侧那一列已经有：页面动作 → 路线规划 → 底图菜单 → 关于 → 全屏。
 * 再加一段文字会在 `lg` 断点把中段的搜索框挤窄（`TopBar.tsx` 里 ⑤ 那段注释
 * 记过一次实测：整组约 110px 就已经压到搜索框了）。而 GitHub 猫头是**全站通用语**，
 * 与「全屏」那枚四括号同一档 —— 不需要文字也能认出来。
 *
 * ## ★ 与「关于」同组（2026-10-16 用户定：「可以放一块去，而不是再做分隔」）
 * 原本它单独挂在组外、自带一条分隔线 —— 用户看着是"两块东西"。现在并进站点导航组，
 * 组内只有一条竖线。⇒ 它跟着整组进 `lg` 断点：窄屏上看不到，但「关于」弹窗的
 * 「开源」一节里有同样的链接（`AboutContent.tsx`），窄屏从那里走。
 *
 * ## 为什么外链而不是站内路由
 * 仓库是站外资源，且这个项目**没有任何服务端**（纯静态）⇒ 没有"项目页"可跳。
 *
 * ## 无障碍
 * `aria-label` 必须把"去哪、能干什么"说全（GitHub 图标本身对读屏是空的）。
 * `rel="noreferrer noopener"` 全站外链统一写法。
 */
function RepoButton() {
  return (
    <a
      href={GITHUB_REPO_URL}
      target="_blank"
      rel="noreferrer noopener"
      aria-label="在 GitHub 上查看本站的源代码（lin0306/travel_strategy）"
      className="inline-flex size-[34px] flex-none items-center justify-center rounded-lg text-ink-2 hover:bg-line-2 hover:text-primary"
    >
      {/* ★ 用 `lg`(18px) 而不是默认 `md`(16px)：官方 mark 是 24×24 满格的实心图形，
          在 16px 下猫头显得比旁边的线性图标明显小一截，看着像没对齐。 */}
      <Icon name="github" size="lg" />
    </a>
  )
}

/** 站点导航项：打开「关于」弹窗（**不是链接** —— 它不跳页，只管开一块浮层） */
/**
 * 「关于」入口。
 *
 * ★ `compact` = **只给一枚图标**，给移动端用（2026-10-25 补）。
 *   补它的原因：这块弹窗里有**图片署名规则、内容来源、数据规模** —— 属于合规面，
 *   而原来它只在 `lg`（≥1024px）那组里渲染，手机上**完全没有入口**，等于永远打不开。
 *   移动端顶栏放不下「关于」两个字，所以只留图标，`aria-label` 仍是完整描述。
 */
function DocButton({ compact = false }: { compact?: boolean }) {
  const openAbout = useDocUi((s) => s.openAbout)
  if (compact) {
    return (
      <button
        type="button"
        onClick={openAbout}
        aria-haspopup="dialog"
        aria-label="关于行迹（数据规模 · 使用说明 · 内容与素材来源）"
        className="grid size-8 place-items-center rounded-md text-ink-2 hover:bg-line-2 hover:text-primary"
      >
        <Icon name="info" size="md" />
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={openAbout}
      aria-haspopup="dialog"
      aria-label="关于行迹（数据规模 · 使用说明 · 内容与素材来源）"
      className="rounded-md px-2.5 py-1.5 text-[13px] text-ink-2 hover:bg-line-2 hover:text-primary"
    >
      {DOC_LABEL}
    </button>
  )
}

/**
 * 全屏切换 —— 一枚按钮两态（`useFullscreen`）。
 *
 * ## 为什么它仍然值得存在（地图本来就铺满视口）
 * 铺满视口铺的是**浏览器视口**：地址栏、书签栏、扩展条、下载条还在，
 * 真正给到地图的高度比屏幕少近百像素。全屏把这些一并吃掉 ——
 * 一行 leader line 也换不到的那点高度，正是地图最缺的纵向空间。
 *
 * ## ★ 不支持时**整枚不渲染**，不做 disabled 占位
 * iPhone 版 Safari 不支持元素全屏（只有 `<video>` 可以），被塞进第三方 App 的
 * WebView（缺 `allow="fullscreen"` 的 iframe）同样拿不到权限。
 *
 * 当初这儿挂的是 `disabled` + 「待开发」的占位，那是**另一回事** ——
 * 它说的是"这个功能还没做"，而现在这一类环境是**真的做不到**。两者都表现为
 * "按不动"，但对用户的含义相反：前者是"等着吧"，后者是"换个浏览器"。
 * 摆一枚永远按不动的按钮在最右端，等于每天骗一次用户 —— 所以直接不出现。
 *
 * ## 图标为什么不配文字、也不配 Tooltip
 * 这枚四括号是**全站通用语**（视频播放器、F11 都是它），`aria-label` 也已经把
 * 「进入 / 退出」说全了。本项目没有 Tooltip 组件（为一个图标引一整套进来不值当），
 * 而 HTML `title` 是明令禁止的（约定见 `check_app` C1）。
 */
function FullscreenButton() {
  const { supported, active, toggle } = useFullscreen()
  if (!supported) return null
  return (
    <button
      type="button"
      onClick={toggle}
      // ★ 两态用同一枚按钮 ⇒ 状态必须写在 `aria-pressed` 上，
      //   否则屏幕阅读器读到的永远是"进入全屏"那句旧标签（图标自己会换，
      //   但读屏不看图标）
      aria-pressed={active}
      aria-label={active ? '退出全屏' : '进入全屏（Esc 退出）'}
      className="hidden h-[34px] w-[34px] flex-none items-center justify-center rounded-lg text-ink-2 hover:bg-line-2 hover:text-primary sm:inline-flex"
    >
      <Icon name={active ? 'collapse' : 'expand'} size="sm" />
    </button>
  )
}

export function TopBar({ actions, shell, variant = 'browse' }: TopBarProps) {
  const { basemap, setBasemapKind, setBasemapLevel, toggleBasemapDetail } = shell
  const navigate = useNavigate()

  const browse = variant === 'browse'

  return (
    <Overlay
      anchor="top"
      z={30}
      className="h-[var(--topbar-h)] flex-row items-center gap-3 pr-2.5 pl-3.5"
    >
      {/* ① 站标。★ 它可点回首页 —— 到了城市页之后，站标是"回首页"最顺手的出口 */}
      <Brand onHome={() => navigate('/')} />

      {/* ② 搜索框：原型里占满中段。窄屏不渲染（顶栏一行放不下）。
             ★ 它也是**唯一的换级入口** —— 地区显示撤掉之后，见文件头 */}
      {browse ? <SearchBox /> : null}

      <div className="ml-auto flex flex-none items-center gap-2">
        {actions}

        {/* ③ 路线规划入口。★ 它是**全站唯一**能看到"我有几条规划"的地方，
               而面板本体挂在 `routes/map-shell.tsx`（见 `RoutePlanPanel` 文件头）。
               浏览态才给 —— 任务态（详情页 / 行程页）的顶栏已经让给页面动作了 */}
        {browse ? <PlanMenuButton /> : null}

        {/* ④ 底图菜单。★ 类型、开关项、说明全部来自引擎层的表，
               这里不写死任何一项（写死会与 `basemap.ts` 漂移，
               而"界面上有的、引擎不认"是**静默**失效） */}
        <BasemapMenu
          value={basemap}
          onKind={setBasemapKind}
          onLevel={setBasemapLevel}
          onToggle={toggleBasemapDetail}
        />

        {/* ⑤ 站点导航（浏览态限定）：「关于」+ GitHub **同组**（2026-10-16 用户定：
               「可以放一块去，而不是再做分隔」—— 中间那条独立竖线已去掉）。
               ★ 整组一起进 `lg` 断点：它们一共吃掉 ~146px，挤到 768px 宽时会把
                 中间那个 `flex-1` 的搜索框压成 0 宽（实测过），比整组不显示难看得多。
               ★ 这一组里**不再挂「待开发」标记** —— 占位时代已经结束
                 （`TodoTag` 组件随之删除；最后一枚占位就是紧随其后的全屏，
                 它现在是**按不动就不出现**的真按钮，见 `FullscreenButton`） */}
        {browse ? (
          <>
            {/* ★ lg 以下：只留「关于」一枚图标（数据来源是合规面，手机上不能没有入口）。
                GitHub 那枚不给 —— 它是开发者导向，移动端顶栏不值得为它挤位置 */}
            <div className="flex flex-none items-center lg:hidden">
              <DocButton compact />
            </div>
            <div className="hidden flex-none items-center gap-2 lg:flex">
              <span className="h-5 w-px flex-none bg-line" aria-hidden="true" />
              <nav className="flex items-center gap-0.5" aria-label="站点导航">
                <DocButton />
                <RepoButton />
              </nav>
            </div>
          </>
        ) : null}

        {/* ⑥ 全屏。★ 两态同一枚按钮，且**不会**因为环境不支持而留一个按不动的坑
               （不支持时组件自己返回 null，理由见 `FullscreenButton` 文件头注释） */}
        <VDiv />
        <FullscreenButton />
      </div>
    </Overlay>
  )
}
