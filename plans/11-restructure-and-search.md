# 11 · 工程重构与搜索导航

> **步骤 1–4 已落地**（目录分家、三块重排、端别分派、删顶栏"我在哪" —— 验收见 7.0）。
> 剩下 5（搜索）/ 6（视野记忆 + 修 F1）/ 7（文档同步）。
> **第三节的端别分派与第四节 B2（顶栏整个不表达"我在哪"）现在就是线上形态**，
> 01 / 05 / 08 / 10 四份文档里与目录结构、端别适配、导航入口相关的段落**尚未同步**（属步骤 7）。

## 〇、这份文档要解决的四件事

| # | 用户原话 | 落点 |
|---|---------|------|
| 1 | 「抓取单独一个目录，展示一个目录」 | 第二节：`pipeline/` 与 `web/` 彻底分家 |
| 2 | 「展示部分抽成 3 块：公共 / web 端 / 移动端」 | 第二节 2.2：`common/` `desktop/` `mobile/` |
| 3 | 「访问页面时判断 PC 还是移动，跳转到不同的页面」 | 第三节：**决策 A**（URL 要不要分叉） |
| 4 | 「去掉左上角省市选择，直接用搜索」 | 第四、五节：**决策 B / C** |

### 决策已定（2026-09-21）

| # | 决策 | 结论 | 落点 |
|---|------|------|------|
| 1 | 端别 URL | **A1 · 同 URL + 路由层分派** | 第三节 |
| 2 | 目录分家与命名 | **抓取 `pipeline/`（根）· 契约 `schema/`（根）· 工程守则 `tools/`（根）** | 第二节 |
| 3 | 顶栏「我在哪」 | **B2 · 顶栏一个字都不表达"我在哪"**（选择器 / 只读文字 / 站点导航里的「城市」全部删除，2026-09-22 定稿） | 第四节 |
| 4 | 省 / 市 / 景点取景 | **不新增任何取景规则**：复用页面既有的 `fit()`，缩放的揭示分层归 `zoomTiers`（见 5.2） | 第五节 |
| 5 | 视野状态（本轮新增） | **按路由身份存 `sessionStorage`**：本次会话内刷新不重摆镜头；关掉标签页即清空，下次打开重新选 | 5.5 |

### 三条工程纪律（本轮全程适用）

1. **不打补丁。** 动手前先问一句"这是不是某个更上游的假设错了"。本轮已经因此**砍掉一个设计**：
   景点定位原本打算新增地图能力 `focusOn(point, 15)`，查证后发现 `fitView.boundsOf()`
   对单点已经兜了 ±0.02°（约 2km）跨度 → 单点 `fit()` 就是一个街区级定格。
   **结论：一个地图 API 都不新增。**
2. **可拓展性优先，但复用优先于抽象。** 能挂进已有的唯一出处就不另造一套。
   例：视野记忆挂在 `useFitOnce`（它本来就是"进这一页镜头怎么摆"的唯一出处），
   不新写第二个记账钩子。
3. **搬家一律 `mv`**，禁止"新建同名文件 + 删旧文件"。后者浪费 token，还会丢掉
   git 的 rename 追踪（review 时看不到"这是移动"）。

---

## 一、现状盘点（只列事实）

### 1.1 顶层与工程内

```
travel_strategy/                 web/                      ← 应用工程
├─ data/          ← 抓取产物      ├─ app/        ← React Router 应用（14 个子目录）
├─ plans/         ← 文档          ├─ scripts/    ← ★ 14 个 Python（抓取 + 自检）
├─ prototype/     ← 原型          ├─ shared/     ← schema.ts + schema.py（同构契约）
├─ netlify.toml                   ├─ public/
└─ web/           ← 抓取 + 展示混在一起  ├─ dist/ build/ _distcheck/  ← 25MB 可再生残留
                                   └─ package.json / vite.config.ts / tsconfig.json
```

### 1.2 端别分叉点（今天只有 5 处，正因如此拆起来便宜）

`useIsMobile()` 只出现在：

| 文件 | 用途 |
|------|------|
| `routes/home.tsx` | 决定 `cluster`（聚合模式）|
| `routes/province.tsx` | `Overlay`（桌面）**或** `Sheet`（移动），二选一渲染 |
| `routes/city.tsx` | 同上 |
| `routes/plan.tsx` | 同上 |
| `components/overlays/RegionPicker.tsx` | 桌面两列级联 / 窄屏单列下钻（**即将删除**）|

也就是说：**端别差异目前集中在「同一页用 Overlay 还是 Sheet」这一个判断上**，
页面主体逻辑（取数、揭示、筛选、联动）两端是共用的。

> ⚠️ 这条事实决定了重构的**性价比**：如果只是"把 if 换成两个文件"，
> 收益很低、风险不低（420 行上限、`check_app.py` 的 S/P/V 三项都盯着这些文件）。
> 所以第二节的拆分必须**同时**解决 1.3 的两个真问题，否则不如不拆。

### 1.3 顺带发现的三个真问题（与本次改动同域，建议一并处理）

| # | 问题 | 证据 | 后果 |
|---|------|------|------|
| **F1** | 四个**直辖市点不进去** | `district-tree.json` 里 `110000 北京` / `310000 上海` / `500000 重庆` 的 `cityCount = 0`，16 个 children 的 `cityId` **全是 `null`**；但 `data/cities/{beijing,shanghai,chongqing}/` 确实存在，`cities.index.json` 里 `poiCount = 46` | 顶栏下拉里这 4 个直辖市全是「待收录」且禁用；首页徽标把它们标成「—」。**地图上有内容、选择器却进不去** —— 这正是"左上角选择器和地图对不上"的一个具体来源 |
| **F2** | `package.json` 两条脚本**静默失效** | `data:validate` → `python scripts/validate.py`、`data:build` → `python scripts/build_index.py`；这两个文件已不在 `web/scripts/`（搬进了 `harvest/`）| 跑 `pnpm data:build` 报错为止；若被 CI 调用则是"没跑校验却以为跑了" |
| **F3** | 取景与"我在哪一级"是两个独立状态 | 页面各自 `shell.fit(点集)`（4 处，四种点集）；`RegionPicker` 换 URL 时**地图视野不动** | 用户原话「选择西安之后，地图上的西安就不会消失了」。根因不是图层没清，是**换级这件事没有一次统一的取景动作** |

---

## 二、目标目录结构

### 2.1 仓库根

```
travel_strategy/
├─ README.md              ★ 新增：目录地图（一份就能说清"什么在哪、怎么跑"）
├─ pipeline/              ★ 数据抓取（原 web/scripts/ 的 harvest 部分）
│  ├─ README.md           ★ 新增：跑法与产出说明
│  ├─ requirements.txt
│  ├─ run.py              ← 入口：usage | pipeline | geocode | images | transit | district | build
│  ├─ seedlib.py  seed*.py  step3_geocode.py  step4_images.py  step7_district.py  ← step6_transit.py 已废弃（通勤改运行时算，不许跑）
│  ├─ step8_search_index.py   ★ 新增：生成搜索索引（见第六节）
│  ├─ layout.py  build.py  tmap.py  images.py  fetch.py  citymeta.py  env.py  fix_noise.py
│  └─ .cache/             （git 忽略）
├─ tools/
│  └─ check_app.py        ★ 从 web/scripts/ 移出：它是**跨两端**的工程守则，不属于抓取
├─ schema/                ★ 同构契约（原 web/shared/）：schema.ts + schema.py
├─ data/                  ← 不变。抓取的产物 + 展示的数据源，两端唯一的交接面
├─ plans/  prototype/     ← 不变
└─ web/                   ← 展示工程（详见 2.2）
```

**为什么 `data/` 不动**：它本来就是"抓取的出口、展示的入口"，是这次分家唯一正确的衔接点。
抓取只写 `data/`，展示只读 `data/`，谁都不 import 对方。

### 2.1.1 ⚠️ 契约外置的代价：两端各要一条"桥"（2026-09-21 落地时实测）

`schema/` 搬到 `web/` 之外后，`schema.ts` 的 `import { z } from 'zod'` **两边都解析不了** ——
Rollup 与 tsc 都是从**文件自身所在目录**往上找 `node_modules`，而 `<repo>/schema/` 之上没有它。

| 缺哪一侧 | 表现（都只在构建/类型检查时才暴露） |
|---------|-----------------------------------|
| `web/vite.config.ts` 的 `resolve.alias` | `pnpm build` 直接死：`Rollup failed to resolve import "zod" from ".../schema/schema.ts"` |
| `web/tsconfig.json` 的 `paths` | `tsc` 报 100+ 条假错误（找不到模块 + 由它引发的 implicit any 连锁）|

所以 `zod` 这条映射在两处各写一遍，并且**`check_app.py` 的 J 项会断言两边同步** ——
把"两处必须一致"这件事从"靠人记"变成"护栏管"。（反证：删掉 vite 那条 alias，构建立刻挂。）

> 备选方案是"让契约成为 workspace 包"（`schema/package.json` + 根 `pnpm-workspace.yaml`），
> 依赖解析会更自然。**不采纳**：那会把 `pnpm install` 挪到仓库根，而 `netlify.toml`
> 的 `base = "web"` + `publish = "dist"` 是当前部署唯一能跑通的形态，改安装拓扑得先重验部署。
> 收益（省两条配置）不抵风险。**契约的运行时依赖若超过 1 个，再回来重新评估这一条。**

同类坑还有一条：`app/lib/cityRegistry.ts` 被 `react-router.config.ts` 直接 import，
跑在**构建期 Node**里 —— 它的文件头有明文纪律「**只用相对路径，不用 alias**」，
因为配置模块图未必吃到 vite 的 `resolve.alias`。实测违反它 = 构建报
`Cannot find module '~shared/schema'`。**这个文件不要"顺手统一"成别名导入。**

### 2.2 展示工程三块

```
web/
├─ app/
│  ├─ entry.client.tsx  entry.server.tsx  root.tsx  routes.ts  app.css
│  │
│  ├─ routes/                    薄壳：只做「取数 + 按端分派」（见第三节）
│  │  ├─ map-shell.tsx  home.tsx  province.tsx  city.tsx  poi.tsx  plan.tsx  credits.tsx
│  │
│  ├─ common/                    ★ 第 1 块：公共（**不含端别分叉**）
│  │  ├─ data/     cityRegistry.ts  data.ts  provinceAdcodes.ts  storage.ts  format.ts
│  │  ├─ map/      tencent/*（引擎：loader / config / basemap / fitView / poiLayer /
│  │  │            districtLayer / reveal / zoomTiers / viewport / viewportEmitter /
│  │  │            dotBudget / labelAvoidance / markerLayer / routeLayer / useTMap）
│  │  ├─ logic/    drilldown/  itinerary/  useFitOnce.ts  useMapReveal.ts  useViewport.ts
│  │  │            mapLog.ts  debugLog.ts
│  │  ├─ search/   ★ 新增：index.ts（读索引）match.ts（纯函数匹配）useSearch.ts
│  │  └─ ui/       Icon.tsx  Overlay.tsx(浮层框架+Chip+EmptyState)  Tooltip  TodoTag
│  │               Brand  TopBar  SearchBox  BasemapMenu  MapLogPanel  MapStatusCard  MapFallback
│  │
│  ├─ desktop/                   ★ 第 2 块：PC
│  │  ├─ home.tsx  province.tsx  city.tsx  poi.tsx  plan.tsx
│  │  └─ ui/   SidePanel  PoiPreviewCard  DetailCard  MapControlStack  plan/*
│  │
│  └─ mobile/                    ★ 第 3 块：移动
│     ├─ home.tsx  province.tsx  city.tsx  poi.tsx  plan.tsx
│     └─ ui/   Sheet  Capsule  ActionBar  plan/*
│
├─ public/       favicon.svg  robots.txt（待加）
├─ dist/         ★ 构建产物（唯一出口）
├─ package.json  pnpm-lock.yaml  vite.config.ts  tsconfig.json  react-router.config.ts
└─ .env.example  .env.local（git 忽略）
```

**分块的判据（一句话，可执行）**：

> 一个文件属于哪一块，看它**有没有端别分叉**。
> 没有 → `common/`；有且是 PC 形态 → `desktop/`；有且是移动形态 → `mobile/`。
> 「`hidden sm:flex` 这类断点」**不算端别分叉** —— 断点是同一个组件的自适应，
> 分叉是"同一个位置渲染两个不同的组件"。

按这条判据，`TopBar`（两端都是同一条通栏）留在 `common/ui/`；
`Overlay` 与 `Sheet` 分别在 `common/` 与 `mobile/`。

### 2.3 与 React Router 的关系

**`appDirectory` 不动**（仍是 `app/`）。三块是 `app/` 的子目录，
不改 RR7 的任何约定文件位置 —— 这一条是刻意选的：

- 把 `app/` 本身改成三层（`web/common`、`web/desktop`、`web/mobile`）需要设
  `appDirectory: '.'`，而 RR7 的 `entry.*` / `routes.ts` / `.react-router/types`
  全都假设 `appDirectory` 下有一层固定结构。**改错了本地 dev 正常、build 时才炸。**
- 保持 `app/` 之后，`~` 别名不动，`check_app.py` 的 A–V 项大多不用改路径基准。

---

## 三、决策 A：端别路由，URL 要不要分叉

### 3.1 三个方案

| | 方案 | URL | 预渲染页数 | 分享链接 | 首屏闪动 | 代价 |
|---|------|-----|-----------|---------|---------|------|
| **A1** ✅ | **同 URL + 路由层分派**：`/city/xian` 一个地址，路由薄壳渲染 `desktop/city.tsx` 或 `mobile/city.tsx` | 不分叉 | ~85（不变） | 手机/桌面打开**都对** | 无（机制见 3.3） | 端别判定发生在水合 |
| A2 | **双 URL 前缀**：`/m/city/xian` | 分叉 | **~170** | 手机拿到桌面链接要 JS 重定向，闪一下 | 有 | canonical 要指主版本、`/m/` 要 noindex；SEO 变成"两套 URL 抢一个词" |
| A3 | 同 URL + 纯 CSS 切 | 不分叉 | ~85 | 对 | 无 | 浮层结构差异太大（Sheet vs 左面板），只能两套 DOM 都渲染 + `display` 切 → DOM 翻倍、地图容器可能重复初始化 |

### 3.2 结论：A1

三条理由，按权重排序：

1. **SEO 唯一真源**。城市页与 46 个 POI 页是这个站的收录主体。A2 会让每个页面
   出现两个地址，必须靠 canonical + noindex 把权重合并 —— 这是在给自己制造
   "重复内容"的判断题，而收益只是"HTML 里不含另一端的 DOM"。
2. **分享链接两端通用**。一条 `/city/xian/poi/bingmayong` 微信发出去，
   桌面点开是桌面版，手机点开是手机版。A2 做不到（除非每次都重定向）。
3. **判定只能发生在浏览器**。SSG 没有 UA，端别判定必然在水合之后；
   既然无论如何都要在客户端切一次，URL 分叉带来的"HTML 就是那一端"的收益是假的 ——
   你依然会先下发一份 A 端的 HTML 再去重定向。

### 3.3 端别判据：**媒体查询，不是 UA**

这一条是既有约定，不是新设计。`hooks/useViewport.ts` 文件头写得很清楚：

> ★ 端别的**唯一**判据是媒体查询，而不是 UA、不是设备类型、不是 `matchMedia('(pointer: coarse)')`。
> 理由：断点决定的是**浮层形态**，而形态取决于可用宽度 —— 一个 800px 宽的桌面窗口
> 同样塞不下 348px 侧栏 + 326px 预览卡 + 地图。

所以"判断浏览器是 PC 还是移动"的正确实现是**按可用宽度**：

- 用 `useSyncExternalStore`（现有实现，**不要改回 `useState`**）：
  `getServerSnapshot` 恒返回移动端 → 预渲染与水合首帧结构一致 → 无 hydration mismatch；
  水合后 React 用真实快照**在绘制前**同步重渲一次 → 用户看不见"先手机后桌面"。
- 这条机制**已经被实测过**：CDP 复测桌面端 0 帧 Sheet、0 个 hydration 错误。
  换成"整页两套实现"后代价不变（第一帧仍由 serverSnapshot 决定）。
- 需要整屏级差异时，额外用 CSS 兜一段（如 `Sheet` 现成的 `sm:hidden`，
  它与 `MOBILE_QUERY` 的 `(max-width: 639px)` **严格互补** —— 改一个必须改另一个）。

> ⚠️ **不要引入 UA 判定 / 服务端重定向**。Netlify 免费版要用 Edge Function 才能嗅探 UA，
> 那会把"纯静态、零运维"这条基本盘换成"远端有一小段逻辑要维护"；
> 而且平板、折叠屏、桌面小窗全是灰区，媒体查询反而是**唯一符合用户实际感受**的判据。

### 3.4 薄壳长什么样

```tsx
// app/routes/city.tsx —— 之后每页都长这样：取数 + 分派，不含任何形态
export default function CityRoute() {
  const city = useCity(params.cityId)          // 取数（现有逻辑，抽成 common 的钩子）
  if (!city) return <NotFound />
  return useIsMobile() ? <MobileCity city={city} /> : <DesktopCity city={city} />
}
```

**两个必须一起做的配套**（否则拆完等于没拆）：

- 页面里"取数 → 派生"的那一段（现在和形态混在 355 行的 `city.tsx` 里）抽成
  `common/logic/useCityView.ts` 之类的钩子，两端共用同一份 —— **绝不复制两份**。
- 揭示（`useMapReveal`）、图层创建、`registerRefresh` 都归 common，
  两端只在"渲染哪套浮层"上分叉。

---

## 四、决策 B：删掉左上角省市选择器之后，「我在哪」怎么表达

### 4.1 先确认删它的理由成立

选择器与缩放显示逻辑的**真正冲突**不在"选择器本身"，而在：

1. 选择器改 URL 时，**地图视野不动**（F3）→ 进了西安，视野还停在陕西 → 用户看到"西安没消失"；
2. 选择器表达的"我在哪一级"与 `zoomTiers` 的揭示层级是**两个独立答案**：
   选择器说"我在四川"，地图因为 zoom 到 7.5 已经铺出市徽标；
3. F1 让 4 个直辖市在选择器里根本进不去。

删掉它，等于**让"我在哪一级"只剩一个答案：URL**。这是对的方向。

### 4.2 三个可选形态

| | 形态 | 说明 |
|---|------|------|
| B1 | **只读地区文字**：顶栏左侧保留一小段纯文本「四川 · 成都」（由 URL 派生，不可点、无下拉） | 曾按此落地（2026-09-21）—— 它不与缩放冲突（不产生动作），但**2026-09-22 被推翻**，见下 |
| **B2** ✅ | **完全去掉**，靠地图内容 + 页面标题 | 最干净。"我在哪"本来就由三个更强的信号回答：URL、地图铺的是哪一级、面板 / 抽屉标题 |
| B3 | 换成"返回上一级"按钮 | 只解决"怎么回去"，不解决"我在哪" |

**已定 B2**（决策 3，2026-09-22 修订）：顶栏**一个字都不表示"我在哪"**。
B1 落地之后用户的原话是「顶上 tab 栏左侧的城市显示去掉，说几遍了」——
只读文字只是把同一句话说第三遍（选择器 → 文字 → 删），所以整格删除，
`TopBar` 的 `region` 属性也随之从组件契约里移除。

**同一轮还删掉了站点导航里的「城市」**：它是"当前所在板块"的自我表达，
而全站只有这一个板块，没有第二个可切，属零信息量。

**B2 的顾虑怎么兜**：B1 当初担心"用户在省页放大到市徽标时会怀疑自己在哪一级"，
这个顾虑由三样东西回答 —— ① 地图上的徽标自己带文案（「四川 46」/「北京 —」）；
② 左面板 / 底部 Sheet 的标题写着城市名；③ 地址栏就是权威答案。
真正因此暴露的缺口是**跨级跳没有入口**，补齐动作是**搜索**（第五节）。

### 4.3 顶栏改造后的构成

| 位置 | 改前 | B1 曾改成 | **B2（2026-09-22）→ 现状（2026-09-29）** |
|------|------|-----------|--------------------------|
| 左 | 站标 → **地区选择器（下拉）** → 搜索框（禁用） | 站标 → 只读地区文字 → 搜索框 | **站标 → 搜索框（唯一换级入口）** |
| 右 | 底图下拉 → 站点导航 → 全屏 | 不变 | **底图下拉 → 关于（一枚按钮，打开弹窗、不跳页）→ 全屏（真功能，2026-09-29 完成）**，站点导航里的「城市」已删。★ 全屏也是最后一枚占位：自此顶栏**没有待开发项**，`TodoTag` 组件随之删除 |

**「全屏」这一枚的落地口径**（2026-09-29）：
- 进 / 出走 `common/logic/useFullscreen`，**调用点全站唯一**（护栏 AI①）
  —— 目标必须是 `document.documentElement`；对准 `.map-layer` 会把浮层留在全屏之外，
  进去就只剩一张没有出口的裸地图。
- 两态同一枚按钮（图标 expand ⇄ collapse，状态写在 `aria-pressed` 上）。
- **环境不支持就整枚不渲染**（`if (!supported) return null`）——
  iPhone 版 Safari 不支持元素全屏。这与旧的"禁用占位"是**两件事**：那时说的是"还没做"，
  现在这类环境是"做不到"，摆一枚永远按不动的按钮等于天天骗人。
- `Esc` 退出全屏由浏览器接管，**网页截不到也拦不住** ⇒ 全屏中按 `Esc` 关浮层时会一并退出。
  这是浏览器统一语义（YouTube / Google Maps 相同），不去硬拗。

**「关于」这一枚的两轮演进**（2026-09-29）：

| 轮次 | 形态 | 用户反馈 |
|------|------|----------|
| 原型起 | `disabled` + 「待开发」的占位（`NavTodo`） | —— |
| 上半天 | 两枚真链接 → `/about`（关于）+ `/credits`（素材与数据来源），两页共用 `DocPage` 版式 | 「这两个感觉内容偏重复，**整合一下，不要跳页面**，也是用弹窗的形式」 |
| 现在 | **一枚按钮 + 一块弹窗**：内容合成一份（`common/ui/doc/AboutContent`），外壳 `AboutModal`，开关走 `docUi` 这条极简信道；两个路由页 + 预渲染项 + 旧版式（`DocPage`）**全部删除** | —— |

三条实现要点（每条都对应一次会静默出错的坑）：

- **模态挂在 `routes/map-shell.tsx`，不在 `TopBar` 内部** —— 顶栏是 `anchor='top'` 的浮层，
  它的 `flt-in` 入场动画用 transform，而**祖先带 transform 会让 `fixed` 子元素相对该祖先定位**，
  模态会被关进 52px 高的顶栏里（不报错，只是"东西不见了"）；
- **模态不带 `data-overlay`** —— 那条属性是给 `fitView` 算"地图可用区"的；模态是临时遮挡，
  参与避让只会让下一次 `fit` 把点位挤到一侧（与"详情面板该不该避让"是两件事）；
- **门与内容分家**：`map-shell` 条件渲染 `AboutModal` ⇒ 关闭即卸载，折叠清单的展开态自然回到初始。

护栏 **AH**（4 条判据：顶栏必须"按钮 + 调 `openAbout()`"且不许再有页面链接 · 两个旧页面彻底删掉
（文件 / 路由 / 预渲染）· 内容唯一出处且旧版式不残留 · 弹窗必须接 `useDismiss`），
反证 `_tmp/falsify_ah.py`（3 个变异）；行为面 `_tmp/cdp_docpages_verify.mjs`（真鼠标 + 真 `Esc`）。

**同时改掉的护栏**（不改则 `check_app.py` 立刻红）：

- `Q` 项：删掉「`<TopBar>` 必须传 `region`」，换成「`<TopBar>` 必须传 `shell`」，
  并**反向**断言 `TopBar.tsx` 源码里不得出现 `region`、不得渲染 `<RegionPicker`
  （反证实测：往里插一行 `const region = …` 被精确拦下，且**不是**靠 tsc 拦的）。
- `T` 项：原「顶栏不得有选择器」「必须渲染 `{region}`」两条**搬到 `Q` 项** ——
  顶栏的契约跟撒点去重摆在一起不搭；`T` 项只留撒点去重与「未收录不可点」。

---

## 五、决策 C：搜索的落点与"对应的缩放级别"

### 5.1 三种目标的落点

| 搜到 | 动作 | 取景 |
|------|------|------|
| **省**（陕西） | `navigate('/province/610000')` | 见 5.2 |
| **已收录市**（西安） | `navigate('/city/xian')` | 见 5.2 |
| **未收录市**（咸阳） | **不换路由**：`shell.focusOn(中心, 省级定格)` + 顶部提示条「咸阳 尚未收录，仅定位」 | 中心 + 定格 |
| **景点**（兵马俑） | `navigate('/city/xian/poi/bingmayong')` | **街区定格 15** + 已有详情卡 |

★ 搜不到的景点天然不会出现 —— 搜索索引里的景点**只来自已收录城市的 JSON**，
不存在"搜到一个我们没数据的点"。

### 5.2 取景：不新增规则，复用页面既有的 `fit()`（决策 4）

你的原话：「省放大到市了，自然就显示市的标签了，这个和地图的缩放逻辑一致啊，
路由固定，没有任何变化。」—— 对，而且**现在就是这样的**。

"镜头落在哪"和"显示哪一级"是两件事，各自早有唯一出处，本轮**一行都不改**：

| 事 | 谁管 | 现状 |
|----|------|------|
| 镜头落到哪（视野） | 页面自己的 `useFitOnce(键, ready, () => shell.fit(点集))` | 已实现（4 个页面）|
| 显示哪一级（揭示） | `zoomTiers` + `reveal.decideReveal()` | 已实现 |

关键在于这四个页面取的**点集恰好就是该级的下辖范围** —— 所以我上一轮担心的
"省面积差 20 倍"这个难点**早就被解决了**，解决方式是"框住该级的点集"，不是写死 zoom：

| 级 | 现有代码（`app/routes/*.tsx`） | 取到什么 |
|----|------------------------------|---------|
| 全国 | `shell.fit(NATIONAL_FIT_CORNERS)` | 国界 + 8% 留白 |
| 省 | `shell.fit(该省全部下辖市中心点)` | 省域（省大就缩得远，天然自适应）|
| 市 | `shell.fit(该市全部点位)` | 市域 |
| 景点 | `shell.fit([该点])` | **街区级** |

> 📌 与 `zoomTiers.ts` 的既有约定一致：「**守相邻两级的大小关系，不守绝对值**」。
> "放大到市级自然出现市标签"正是这条约定的直接结果，不需要任何额外动作。

### 5.3 不需要新增定位能力（`focusOn` 砍掉）

我上一轮提的 `focusOn({lng, lat}, zoom)` **砍掉了** —— 它是个补丁式设计。
查证 `fitView.boundsOf()`：对单点会补 ±0.02°（约 2km）的跨度，`fitBounds` 于是
自然落在一个街区级缩放（≈ 15）。**景点定位、未收录市定位，用现成的 `fit([点])` 就够。**

少一个 API 就少一处"必须记得走同一条广播管道"的地方 —— 原方案风险表里那条
「`focusOn` 缩写回 `< 8` 触发点位归零」连同 API 一起消失了。

> 本轮唯一新增的地图能力是 **`applyView({center, zoom})`**（瞬时套用视野，不动画），
> 它只服务于 5.5 的视野记忆，**不参与任何取景规则**。

### 5.4 搜索为什么天然解决"闭环冲突"（F3）

关键结论：**搜索 = 一条路由跳转，不需要额外的"取景意图"传递**。

因为每一级的取景规则是**页面自己的默认行为**（第七节步骤 6 落地）：

- 搜"陕西" → 跳省页 → 省页一进来就按"省取景规则"取景 = 你想看到的效果；
- 搜"兵马俑" → 跳 POI 页 → POI 页一进来就按"街区定格"取景 = 你想看到的效果；
- 已经有 `useFitOnce(fitKey, …)` 在管"换了城市/换了端就重新取景一次"，机制现成。

**这正好补上了 F3**：原来"换级"（RegionPicker 改 URL）没有配套取景，现在
"换级"和"取景"变成同一件事。不需要 `navigate(path, { state })`，不需要全局意图 store。

> ❌ 明确不做：把 zoom 塞进 URL（`?z=15`）。理由：URL 是分享单位，
> 带 zoom 的链接发出去别人打开会落在一个奇怪的视野；而且这是**第二套状态**，
> 与"URL 决定 base、缩放决定揭示"这条分工冲突。

### 5.5 视野记忆：存 `sessionStorage`，按路由身份（决策 5）

**要解决的问题**：当前 `useFitOnce` 的记账是 `useRef`（内存），刷新即丢 →
刷新后页面重新 `fit()` → 用户刚拖到的位置被强行拉回。他的原话：
「地图缩放存 session……这样也能保证刷新的时候，不会出现问题。」

**做法**（只改 `useFitOnce` 一个文件，不新增记账机制）：

| 时机 | 行为 |
|------|------|
| 进页（`key` 就绪 + 地图 ready） | 先查 `sessionStorage['view:' + key]`：**有 → 直接套用（无动画）**；无 → 走原来的 `fit()` |
| 视野稳定（手势结束 / 取景动画结束） | 把 `{center, zoom}` 写回同一个 key |

- **key 就是现成的 `fitKey`**（`city.tsx` 是 `${cityId}|${端}`，`province.tsx` 是
  `${adcode}|${下辖数}|${端}`）。`useFitOnce` 本来就是"进这一页镜头怎么摆"的唯一出处，
  记忆挂在它身上是顺着结构走，不是打补丁。
- **`sessionStorage` 而不是 `localStorage`**：会话内刷新保留；关掉标签页即清空，
  下次打开是一个干净的默认态（用户明确要的"这样干净"）。
- **套用视野需要 `shell.applyView({center, zoom})`（瞬时、不动画）**，这是本轮
  **唯一**新增的地图能力（砍掉了 `focusOn`，净增 1 个）。
  写入口径与 `fit` 一致：套用后由既有广播通知各图层重算，页面**不补刷**（V 项纪律）。
- 写入点是**视野稳定广播**（`viewportEmitter` 那条），不是 `onViewportChange` 的业务回调 ——
  保证"用户拖到哪就记住哪"，与是否有人订阅无关。

---

## 六、搜索的数据与实现

### 6.1 索引来源与体积

| 类 | 条数 | 来源 | 字段 |
|----|------|------|------|
| 省 | 34 | `district-tree.json` 的 `provinces[]` | `name` `fullname` `adcode` `center` |
| 市 | ~340 | 同上，`provinces[].children[]` | `name` `adcode` `center` `cityId`（null = 待收录）|
| 景点 | ~322 | 各城市 `city.json` + `pois/**/*.json` | `name` `poiId` `cityId` `category` `point` |

**推荐构建期生成 `data/_generated/search-index.json`**（新增 `pipeline/step8_search_index.py`）：

- 只存"能定位的最小字段"，**不存正文**；图片只存**一张封面**（2026-09-25 加，见 8.10）
  → 实测 **347KB 未压缩 / 67KB gzip**（加封面之前是 170KB / 约 30KB）；
- 前端**首次聚焦搜索框时懒加载**（与 `loadDistrictTree` 同一套路），首屏零成本；
- 兜底：索引文件缺失时**就地派生**（省/市来自已在内存的 `district-tree`，
  景点来自已加载的城市）—— 与 `loadCityIndex` 的做法一致，不新增"必须跑脚本"的硬依赖。

### 6.2 匹配规则（先做能做的，不假装会拼音）

| 优先 | 规则 | 例 |
|------|------|-----|
| 1 | 名称**前缀**命中，同分时按类型（省 > 市 > 景点）与热度 | 「西」→ 西安 / 西城 / 西湖 / 西溪 |
| 2 | 名称**包含**命中 | 「兵马」→ 兵马俑 |
| 3 | 省市简称/别名 | 仅收录**明确的**（如「沪」→ 上海），**不编造** |

**明确不做（写进文档，避免以后被当成遗漏）**：拼音搜索、模糊纠错、搜索历史、联想词。
理由是它们都需要额外数据（拼音表 / 用户行为），而当前索引只有名字。

### 6.3 交互（两端同一份数据，形态按端）

| 端 | 形态 |
|----|------|
| PC | 顶栏搜索框（`md` 起显示，沿用现断点）+ 下拉候选面板，`↑↓` 选择 / `Enter` 确认 / `Esc` 关闭；`/` 唤起 |
| 移动 | 顶栏一个搜索图标 → 点开**全屏搜索页**（键盘不挡候选列表），选中后关闭并跳转 |

> ⚠️ 候选面板必须**不带 `data-overlay`** —— 它是瞬态观测物，不该参与
> `fitView` 的可用区计算（`MapLogPanel` 踩过同一个坑）。

---

## 七、迁移步骤（每步独立可验证、独立可回滚）

| 步 | 内容 | 验收判据 |
|----|------|---------|
| **1** | **清残留 + 目录搬家**（一律 `mv`，禁止"新建+删旧"）：删 `web/{build,dist,_distcheck}`（25MB）；`web/scripts/harvest/` → 根 `pipeline/`；`web/scripts/{check_app.py,make_fixture.py}` → 根 `tools/`；`web/shared/` → 根 `schema/`；`web/package.json` 的 `check` / `data:*` 指向新路径（修 F2）；`.gitignore` 补 `__pycache__/`、锚定 `pipeline/.cache/`；加根 `README.md` + `pipeline/README.md` | `pnpm check` ALL_CLEAN；`python pipeline/run.py usage` 能跑；`web/` 下再无 `*.py` |
| **2** | **展示工程三块重排**（**纯移动，零行为变化**）：按 2.2 把 `app/**` 归到 `common/ desktop/ mobile/`；`~` 别名不动，新增 `~common` `~desktop` `~mobile` 可选 | `pnpm typecheck` 过；`pnpm build` 出的 HTML 与步骤 1 前**逐字节等价**（diff `dist/**/index.html`） |
| **3** | **端别分派落地**：每个 route 变薄壳（3.4）；两端主体逻辑抽到 `common/logic/use*View.ts` | 桌面窗口缩到 <640px 自动切移动形态；CDP 复测 0 hydration 错误 |
| **4** | **删 `RegionPicker`**：顶栏改只读地区文字（决策 B）；同步改 `check_app.py` 的 Q / T 项 | 全站没有"点两个下拉"的地方；`pnpm check` ALL_CLEAN |
| **5** | **搜索**：`pipeline/step8_search_index.py` + `common/search/**` + `SearchBox` 真实现 + 候选面板 | 搜"陕西/西安/兵马俑"三类各命中并落到正确页面；未收录市给出提示而不跳空页 |
| **6** | **视野记忆 + 修 F1**：`useFitOnce` 接 `sessionStorage`（5.5）+ 新增 `shell.applyView()`；**不新增取景规则、不新增 `focusOn`**；修 F1（直辖市收录） | 拖动地图后刷新，镜头停在原地；搜到景点落在街区级；直辖市能进城市页 |
| **7** | **护栏与文档同步**：`check_app.py` 增补第九节的新项；01/05/08/10 四份文档改目录与导航段落；`plans/README.md` 索引 | `pnpm check` ALL_CLEAN + 四份文档里搜不到 `RegionPicker` |

**顺序不可调**：2 是纯机械移动（可逐字节验收），3 才开始动行为。
把 2 和 3 合成一步，一旦页面行为变了，就分不清是"路径改错"还是"分派写错"。

### 7.0 进度（2026-09-21）

| 步 | 状态 |
|----|------|
| **1** | ✅ **已完成** |
| **2** | ✅ **已完成** |
| **3** | ✅ **已完成** |
| **4** | ✅ **已完成** |
| **5** | ✅ **已完成**（2026-09-24，见 §八） |
| **6** | ✅ **已完成**（2026-09-29，实现与 §5.5 有出入，见 §8.11） |
| **7** | 🟡 护栏 AA 项已做；文档同步 2026-10-25 补完 |

#### 步骤 2–4 的实际落地形态（与 2.2 的差异，记下来免得对不上）

2.2 画的是 `app/{desktop,mobile}/{home,province,city,poi,plan}.tsx`。实际落地时
**路由文件没有搬家**，而是保持 `app/routes/*.tsx` 当薄壳，形态放到
`app/{desktop,mobile}/ui/XxxView.tsx`：

```
app/routes/city.tsx          ← 薄壳：useCityView() + useIsMobile() + 二选一
app/common/logic/useCityView.ts   ← 两端共用的页面逻辑
app/desktop/ui/CityView.tsx       ← 只摆外壳（左面板）
app/mobile/ui/CityView.tsx        ← 只摆外壳（底部 Sheet）
```

**为什么偏离 2.2**：2.2 那版把 `app/` 本身改成三层需要动 `appDirectory`；
实际把端别目录做成 `app/` 的子目录后，路由不必跟着搬 —— 少一次大范围移动，
`~` 别名与 RR7 约定文件位置完全不动。**收益一样，风险更低。**

薄壳的**端别分派落在路由层**（决策 A1 原意），所以首页虽然两端渲染同一套
地图 + 顶栏，也走 `useIsMobile()`，只有 `cluster` 这一个差异留在逻辑钩子里。

#### 步骤 2–4 的验收实测

| 判据 | 结果 |
|------|------|
| `tools/check_app.py` | **ALL_CLEAN**（含 L 真跑 `tsc --noEmit`、新增 W 三块划分/端别分派） |
| 预渲染页数 | **379 = 379**，路由集合与重构前**逐一相同**（无新增/丢失） |
| 页面结构指纹 | 每类页面「同壳」的聚类关系与基线**完全一致** —— 说明页面渲染没被搞乱，差异只是全局资源哈希 |
| 端别分派（CDP 实测 1440 / 390 同一 URL） | 城市页：`348×764 左面板` ↔ `390×473 底部 Sheet`；点位页：`620 正文 + 300 右侧位置卡` ↔ `底部 Sheet（位置块砌进正文）`；行程页：`420 左面板 + 左下角图例` ↔ `底部 Sheet` |
| 顶栏下拉（步骤 4 当时） | 顶栏地区元素是 **`SPAN`**（不是 `<button>`），全站仅剩 1 处 `[aria-haspopup]` = **底图下拉**（合法保留） |
| 顶栏「我在哪」（步骤 4 的**后续修订**，2026-09-22 晚） | **整格删除**：8 个场景（首页 / 省级 / 城市 / 点位 / 行程 × 两端）实测顶栏文本里**不含**「全国」「西安」「城市」任何一个；顶栏左段站标仍在；`[aria-haspopup]` 仍恰好 1 个；页内报错 0（腾讯 SDK 的 `MultiPolyline.styles` 样式告警已单独识别、不计入） |
| hydration 报错 | **0**（仅腾讯 SDK 的 `MultiPolyline.styles` 样式告警，与本次无关） |

> ⚠️ **`pnpm build` 退出码在本机恒为 1** —— 失败点是 `ssr:false` 收尾时
> `rmSync(web/dist/server)` 报 `EPERM`。查证 `_tmp/_build_out.txt`（重构**之前**
> 的构建日志）里**同样有这条** → 属**既有环境问题**，与本次重构无关；
> 预渲染产物 `web/dist/client/**` 是完整的（379 页齐全）。
> 本机另有一个坑：`pnpm build` 在**前台**跑会挂住（无输出、CPU 空转），
> 必须后台跑 —— 前台那次挂了 30 分钟，后台 47 秒完成。

> 📌 顺带发现（**不在本轮范围，未动**）：`netlify.toml` 的 `publish = "dist"`，
> 但 RR7 把产物写在 `web/dist/client/`（`web/dist/` 下只有 `client/` 一个子目录）。
> 真要发布时这两处对不上，需要单独确认。

**步骤 1 的验收实测**：`tools/check_app.py` = ALL_CLEAN（L 项真跑了 `tsc --noEmit`）；
`python pipeline/run.py usage` 返回 0；14 个 pipeline/schema 模块全部可 import；
`web/` 下已无任何 `*.py`；`web/{build,dist,_distcheck}` 共 2554 个文件 / 19MB 已清。

**步骤 1 挖出来的三件事**（都是"改完才知道"，已写进 2.1.1 与护栏）：

1. 契约外置必须在 **vite alias 与 tsconfig paths 两边架桥**，且 J 项断言两边同步；
2. `pipeline/` 里的 `parents[N]` 必须跟着减 1 —— 机械替换只改了模块名，
   漏掉 5 个文件的 `parents[2]`，**不报错**、只是把仓库根算成上一层。已加护栏：
   `pipeline/**` 下出现 `parents[N≠1]` 直接红（已反证）；
3. `app/lib/cityRegistry.ts` 有明文纪律**只用相对路径**（它跑在构建期 Node，
   配置模块图未必吃到 vite 的 `resolve.alias`）。"顺手统一成别名"会让构建挂掉。

### 7.1 F1（直辖市）单独说

`district-tree.json` 里直辖市的关键字段错在**层级假设**：脚本只把"地级市"映射到 `cityId`，
把直辖市的 16 个市辖区当成了下辖单位。两种修法：

- **改脚本**（推荐）：直辖市的 `province.cityId` 直接指到自己的城市（北京 → `beijing`），
  `children` 保持市辖区但全部标 `cityId: null`；首页徽标读 `province.cityId`。
- **改前端**：`loadNationalView` 里对 4 个直辖市 adcode 做特判 —— **不要**，
  这是把数据问题写进显示层。

---

## 八、影响面清单（文件级）

### 移动（`git mv`，内容不变）

| 原 | 新 |
|----|-----|
| `web/scripts/harvest/*.py` | `pipeline/*.py` |
| `web/scripts/check_app.py` | `tools/check_app.py` |
| `web/shared/schema.{ts,py}` | `schema/schema.{ts,py}` |
| `app/lib/{data,cityRegistry,provinceAdcodes,storage,format}.ts` | `app/common/data/` |
| `app/map/tencent/*` | `app/common/map/tencent/*` |
| `app/drilldown/` `app/itinerary/` | `app/common/logic/` |
| `app/hooks/{useFitOnce,useMapReveal,useViewport}.ts` | `app/common/logic/` |
| `app/lib/{mapLog,debugLog}.ts` | `app/common/logic/` |
| `app/components/overlays/{Overlay,Icon,Tooltip*,TodoTag,Brand,TopBar,SearchBox,BasemapMenu,MapLogPanel}.tsx` | `app/common/ui/` |
| `app/components/overlays/Sheet.tsx` | `app/mobile/ui/Sheet.tsx` |
| `app/components/{city,plan}/*` | 按端分到 `app/{desktop,mobile}/ui/` |

### 删除

| 文件 | 理由 |
|------|------|
| `app/components/overlays/RegionPicker.tsx` | 决策 B |
| `app/hooks/useRegionOptions.ts` | 只服务 RegionPicker；`provinceOfCity` 一并删 |
| `web/build` `web/dist` `web/_distcheck` | 25MB 可再生残留 |
| `web/scripts/make_fixture.py` 等孤儿 | 搬家时逐个确认是否还有引用 |

### 新增

`pipeline/step8_search_index.py`、`pipeline/README.md`、根 `README.md`、`tools/`（搬家后）、
`schema/`（搬家后）、`app/common/search/{index,match,useSearch}.ts`、
`app/{desktop,mobile}/{home,province,city,poi,plan}.tsx`、`app/common/logic/use*View.ts`、
视野记忆（`useFitOnce` 内，不新建模块）、`shell.applyView()`。

### 改写

`app/routes.ts`（保持，但 route 文件变薄壳）、`app/routes/*.tsx`（7 个）、
`app/components/overlays/TopBar.tsx`、`app/map/tencent/zoomTiers.ts`（定格常量）、
`web/vite.config.ts`（alias）、`web/tsconfig.json`（paths）、`web/package.json`（scripts）、
`.gitignore`、`tools/check_app.py`。

### 不动

`data/`（结构）、`netlify.toml`（`base = "web"` 仍成立）、`react-router.config.ts`
（路由数不变）、`prototype/`、`app/styles`（`app.css` 位置不变）。

---

## 九、护栏（`check_app.py`）改动

| 项 | 现状 | 改后 |
|----|------|------|
| **I** | glob 路径基准（`~data` 在根、其余在 web/）| **不变**（`data/` 未动）|
| **J** | 仓库布局归属：`web/{data,plans,prototype}` 不该存在；`netlify.toml` 在根 | **扩展**：断言 `pipeline/` `tools/` `schema/` 在根且 `web/` 里不含 `*.py`（**这条正是"前端项目里不许有 Python"的护栏化**）|
| **M** | `.env*` 被 git 忽略 | **不变** |
| **Q** | `<TopBar>` 必传 `region`；不得自绘底图署名 | **已改（2026-09-22）**：断言换成「`<TopBar>` 必传 `shell`」+ 反向「`TopBar.tsx` 里不得出现 `region`、不得渲染 `<RegionPicker`」；「不得自绘署名 / 不得隐藏 SDK 署名」两条不变。反证已做（插一行 `const region` 被精确拦下） |
| **S** | `useMapReveal` 使用者不得自建图层 / 必须传 `base` / 业务层禁止 `getZoom()` 比数字 | **扩展**：路径基准改 `app/common/**` |
| **T** | `TopBar` 必渲染 `<RegionPicker>`；`RegionPicker` 有 `cityId === null` + `disabled` | **替换**：① 全站不得 import `RegionPicker`；② `<SearchBox>` 必须消费 `common/search` 的匹配函数（断言"不自己写一份匹配"）；③ 未收录市必须走提示分支而不是 `navigate` 到不存在的城市 |
| **U** | 底图预设白名单 | **不变** |
| **V** | 视野闭环（不得直接 `getZoom`/`getCenter`；页面不补刷）| **扩展**：新增 `focusOn` 后，断言"业务层只从 `common/map` barrel 导入 `focusOn`" |
| **W** ★ 新增 | — | **端别归属**：`app/common/**` 与 `desktop/**` `mobile/**` 里不得出现 `from '~desktop'` / `'~mobile'`（common 不许依赖端）；`app/mobile/**` 不得 import `desktop/**`，反之亦然 |
| **X** ★ 新增 | — | **三块目录存在性**：`app/{common,desktop,mobile}` 必须存在且非空（防止有人"重构"成别的名字）|

> ⚠️ 按项目约定：**新增检查项必须反证**（故意写坏 → 必须报错 → 再改回）。

---

## 十、风险与回滚

| 风险 | 影响 | 对冲 |
|------|------|------|
| 大范围 `git mv` 导致 diff 巨大、review 困难 | 中 | 步骤 2 单独一次提交，且**验收判据是 build 产物逐字节等价**（不是"看着对"）|
| 步骤 3 拆 route 时把 420 行上限撞破 | 中 | 拆分的同时把取数逻辑抽到 `common/logic/use*View.ts`；`G` 项会拦 |
| 顶部搜索框在窄屏把顶栏压塌 | 低 | 沿用现有断点阶梯：搜索框 `md` 起、站点导航 `lg` 起（`SearchBox.tsx` 文件头记过实测 `w:0` 的坑）|
| 删 RegionPicker 后用户失去"逐级返回"路径 | 低 | 站标可回首页；各页自带返回动作（城市页「看点位」等）；浏览器后退可用。★ 真正缺的是**跨级跳**入口 —— 2026-09-22 连只读文字也删之后这一格彻底空了，补齐动作就是**决策 C 的搜索**（第五节）；在搜索做出来之前跨级只能一级一级走 |
| 视野记忆存了脏数据（中心/缩放出界） | 低 | 套用前做一次范围校验（lng/lat 合法 + zoom ∈ 引擎档位），不合法就当没有记录、走 `fit()` |
| 每换一页都写 `sessionStorage` 造成抖动 | 低 | 只在**视野稳定广播**时写，一次手势只写一次；键空间是每路由一条，会话结束由浏览器回收 |
| Netlify 部署因目录变动失败 | 中 | `base = "web"` 与 `publish = "dist"` **不动**；改了必须先用 `pnpm build && pnpm preview` 验一遍 |

**回滚**：每步一个 commit，任一步出问题 `git revert` 该步即可，不存在"必须全部回滚"的耦合。

---

## 十一、决策记录（2026-09-21 已定）

| # | 决策 | 结论 |
|---|------|------|
| 1 | 端别 URL | **A1 · 同 URL + 路由层分派** |
| 2 | 目录分家与命名 | 抓取 **`pipeline/`**（根）· 契约 **`schema/`**（根）· 工程守则 **`tools/`**（根） |
| 3 | 顶栏「我在哪」 | **B2 · 顶栏整个不表达"我在哪"**（2026-09-22 修订：B1 的只读文字也删了，见 4.2） |
| 4 | 取景 | **不新增规则**：复用页面既有 `fit()`；`focusOn` 砍掉（见 5.3） |
| 5 | 视野状态 | 按**路由身份**存 `sessionStorage`，关标签页即清（见 5.5） |

两件顺手做（已纳入本轮）：

- **F1** 直辖市收录（改 `pipeline` 的区划映射脚本，不动前端）；
- **F3** 取景闭环 —— 删掉 `RegionPicker` 后**自然消失**：换级只剩"导航"一条路径，
  而导航会触发目标页自己的 `useFitOnce`。**不需要额外机制**，这也是"不打补丁"的一个例子。

---

## 附：本次改动**不影响**的东西（先说清楚，免得白担心）

- **SEO**：路由数不变、URL 不变、预渲染照旧。搜索是客户端行为，不产生新路由。
  删掉 RegionPicker 也不影响收录 —— 它是客户端控件，从不参与预渲染内容。
- **合规红线**：底图/边界来源、key 策略、图片许可、住宿点隐私、`null ≠ 0`
  全部原样不动。
- **性能预算**：构建产物仍是单一 `dist/`；搜索索引懒加载，首屏 JS 不增。
- **行程规划**：`common/logic/itinerary/**` 只搬家不改逻辑。

---

## 八、落地记录：搜索（2026-09-24）

第七节把"搜索"排成**步骤 5**，本轮做完。产物是
`data/_generated/search-index.json`（**527 个地区** = 34 省 + 493 个下级 · **513 枚景点**，
164KB 未压缩 / 约 20KB gzip），挂在 `pipeline/build.py` 的 `build_search_index()` 里 ——
而不是 6.1 写的 `pipeline/step8_search_index.py`：索引要用的是**装配完成的城市**
（`assembled`），那正是 `build.py` 手里现成的东西；单开一个 step 就得把装配再跑一遍
（或另存一份中间产物）。

### 8.1 与 §5.1 的差异：**不换路由**（本节最要紧的一处）

§5.1 那张表写的是「省 → `navigate('/province/610000')`、景点 → `navigate('/city/xian/poi/bingmayong')`」。
**本轮没有照它做**，因为 2026-09-23 定下的那条规矩更强、也更晚：
点地图上的东西**一律不换 URL**，理由是"URL 一变，刷新就停在那页，
而省 / 城市页**没有回全国的出口**"（顶栏品牌名不是链接）。用户当时的原话是
「点击地图的任何内容，url 都不需要出现变化」；本轮他又原话确认了搜索该有的行为：
「地区点击触发地图偏移和放大，景点触发地图偏移放大并打开景点详情」——
**一句都没提跳转**。

| 搜到 | 动作 | 取景 |
|------|------|------|
| 省 / 市 | **飞镜头**（`shell.fit`）+ 就地展开对应一级 | 该级的点集（口径 = 点徽标那条 `districtFocus`，唯一出处） |
| 景点 | **飞镜头 + 就地打开详情**（桌面 620px 面板 / 移动底部 Sheet） | 街区级（`fit([该点])`，`boundsOf` 对单点补 ±0.02°） |

★★ 于是 §5.4 那套"靠**跳页**触发目标页 `useFitOnce`，所以搜索天然解决 F3"的论证
**前提不成立了**（前提是跳页）。不跳页之后 F3 由另一件事保证：
**两个动作都复用既有管道** —— 镜头走 `shell.fit`（与点徽标同一条），
详情走页面的就地浮层（与点景点同一条）。同样**不需要**新增机制，
也不需要 `navigate(path, { state })` 或全局意图 store。

### 8.2 §6.1 的兜底改了：不"就地派生"，给一句人话

§6.1 写的是"索引缺失时**就地派生**（省/市来自 `district-tree`，景点来自已加载的城市）"。
本轮**没有这么做**：就地派生要求搜索框把**全部已收录城市**读进内存（9 城 × 58 个文件），
而那正是这份索引存在的理由（避免"搜一次把所有城市解析一遍"）。
索引缺失只说明一件事 —— **流水线没跑过 `build`**，所以给它一句准确的引导
（「搜索数据还没生成 —— 跑一次采集流水线的 `build` 即可」），而不是假装能搜：
派生出来的索引会**少掉没加载的城市**，用户会以为那些地方没收录（正是 `null ≠ 0` 要防的那种骗人）。

### 8.3 §6.2 的匹配：分级打分 + 两组分别限量

比 §6.2 多了一条"关键词"级，并且**两组各限各的量**（地区 ≤ 4、景点 ≤ 6）：

| 分 | 规则 | 例 |
|----|------|-----|
| 100 | 名字相同（去行政后缀后也相同） | 「四川」/「四川省」→ 四川 |
| 80 | 名字前缀 | 「成」→ 成都 |
| 60 | 名字包含 | 「博物」→ 成都博物馆 |
| 40 | 关键词：标签 / 细类中文名 | 「博物馆」→ 各城的博物馆 |
| 25 | 只命中所属城市 | 「成都」→ 成都的那几枚（排最后，免得占满整列） |

★ **分组限量**不是为了"两栏好看"：「成都」能匹配到 57 枚景点 ——
混在一起排的话，地区那几条会被景点整列挤掉。
★ 同分时**沿用索引顺序** = 构建期已排好的热度降序，所以索引里不存 `popularity`
（存了就是第二份会漂的副本）。
★ §6.2 明确不做的四样（拼音 / 模糊纠错 / 搜索历史 / 联想词）**仍然不做**。

### 8.4 §6.3 的移动端：**还没做**

§6.3 给移动端定的是"顶栏一个搜索图标 → 点开全屏搜索页"。现状是
搜索框与其它顶栏项一样**在 `md` 以下不渲染** ⇒ **移动端现在没有搜索入口**。
没有顺手放一个图标占位：点不开的图标就是骗人（`TodoTag` 那条纪律）。
要补是一次独立的小改造（全屏搜索页 + 移动端结果点击语义），不混在本轮里。

### 8.5 落地清单

| 文件 | 动作 |
|---|---|
| `pipeline/build.py` | 新增 `build_search_index()`；挂进主流程；产出 `data/_generated/search-index.json` |
| `schema/schema.py` · `schema/schema.ts` | 新增 `SearchRegion` / `SearchPoi` / `SearchIndex`（双生契约） |
| `common/data/searchIndex.ts` | **新增**：按需加载 + `safeParse` 校验 + 模块级缓存 |
| `common/logic/search.ts` | **新增**：匹配打分（纯函数）+ 命中 → 取景点（复用 `districtFocus`） |
| `common/logic/useSearch.ts` | **新增**：防抖 300ms · 索引懒加载 · 命中动作（飞镜头 + 交棒） |
| `common/logic/useSearchPick.ts` | **新增**：把"搜索命中的那一枚"并进页面的选中（**三页共用一份**） |
| `common/ui/SearchBox.tsx` | 由**禁用占位**改成真功能（ARIA combobox + `↑↓` / `Enter` / `Esc` / `/`） |
| `common/logic/mapShell.ts` · `routes/map-shell.tsx` | 新增 `searchPick` 信道；**换页清空** |
| `common/logic/use{Home,Province,City}View.ts` | 三页消费 `searchPick`（页面自己的选中优先）；关闭 / 点空白时**两个源一起清** |
| `desktop/ui/CityView.tsx` · `mobile/ui/CityView.tsx` | 详情的城市名改走 `view.selectedCityName`（命中的可能是**别的城市**的景点） |
| `common/ui/TopBar.tsx` | 文件头更正（搜索不再是"待开发"） |
| `tools/check_app.py` | **新增 AA 项**（五条判据，见 8.6）；顺带修掉 Y④ 里一条写死字面量的老判据 |

### 8.6 护栏 AA

| # | 判据 | 抓的失效（都是不报错的那种） |
|---|------|--------------------------|
| ① | 索引文件名**两端同源** + 真的走 `safeParse` | 路径写错 → `import.meta.glob` **静默匹配 0 个文件** → "搜索永远没结果"，而数据就在盘上 |
| ② | 搜索链路**不许 `navigate(`** | 换 URL = 用户觉得"关不掉"（省 / 城市页没有回全国的出口） |
| ③ | 三个页面钩子都调 `useSearchPick(` 且把 `sel.layerId` 交给图层 | 漏一页 = "在那一页搜景点：镜头飞过去了、详情不弹"，而另外两页是好的 |
| ④ | 换页清空 `searchPick`（挂在 `[pathname]` 上） | 不清 = 下一个页面弹出**别人家**点位的详情 |
| ⑤ | `closePoi` **两个源一起清** | 只清一个 = 面板被另一个重新渲染出来，用户看到"关不掉" |

★ ③⑤ 判据都**认调用 / 定义体，不认名字**：只查"`useSearchPick` 这个名字在不在这份文件里"
会被 `import` 那一行骗过（反证时当场踩到一次，已改成查调用）。
★ ④ 顺手改掉一条**写死字面量**的老判据（Y④ 那句 `onBlank: () => setSelectedId(null)`）：
搜索命中成为第二个选中源之后，这一行从"一行"变成"多行语句"，
写死字面量会把**正确**的代码判成错（改成多行时当场踩到）。
★ AA③ 的破坏**必然牵连 `tsc`**（`sel` 就没定义了）。判据仍必须自己响 ——
否则等于"全靠类型系统兜着"，而类型系统在**新增一个页面**时不会报警。

### 8.7 落地后修的一处：搜到**别的城**的景点，地图上不画点（2026-09-24）

用户原话：「搜索不在当前地图界面上的景点，点击后，地图会偏移过去，景点详情也会显示，
**但是地图没有渲染点位**」。

**根因**（先复现、再改，不猜）：`poiLayer` 的选中层是从
`byId.get(selectedId)` 反查坐标的，而 `byId` **只由本页的候选集构成** ——
页面的候选集是**按页划定**的：

| 页面 | 候选集 | 搜到别处时 |
|---|---|---|
| 首页 | 全部已收录城市的点位（懒加载） | 能对上（所以"首页有时是好的"） |
| 省级页 | **本省**已收录城市的点位 | 解析不出坐标 ⇒ **不画** |
| 城市页 | **本城**的点位 | 解析不出坐标 ⇒ **不画** |

而顶栏搜索能在**任意一级**命中**任何一座城**的景点 —— 这是两个各自都对的设计撞出来的
一个**新组合**：镜头由 `shell.fit` 飞过去了、详情由页面浮出来了，
唯独"那一枚点"要从本页数据里找，找不到就静默没了。

**复现取证**（`_tmp/cdp_pick_marker.mjs`，两条判据：**打点** + **像素**）：

| 场景 | `setGeometries` 里带目标 id 的选中层调用 | 靶子区细类色像素 |
|---|---|---|
| 城市页搜西安的兵马俑 | **0 次** | **0** |
| 省级页（陕西）搜成都博物馆 | **0 次** | **0** |
| 首页搜兵马俑（懒加载全部 9 城） | 2 次 | 88 ✓ |

★ 光有"打点"不够：得**同时**量屏幕上的像素，才排得掉"应用要求画了、但渲染没出来"。
  上一轮的教训（"只确认了气泡和名字，恰恰没确认水滴"）就是只做了一半。

**修法**：给图层加一条独立的坐标信道 —— `PoiUpdateOptions.picked`。

```ts
// poiTypes.ts
picked?: PoiPoint | null   // 「搜索命中的那一枚」，可能不在本页候选集里

// poiLayer.ts
function selectedPoint(o: PoiUpdateOptions): PoiPoint | null {
  const id = o.selectedId ?? null
  if (!id) return null
  return byId.get(id) ?? (o.picked?.id === id ? o.picked : null)   // ← 这一句就是修复点
}
```

`repaint` 的选中层与 `repaintLabels` 都改走 `selectedPoint(o)`，于是"坐标从哪来"
只有一处。三个页面把 `sel.pickedPoint` 交下去（`useSearchPick` 统一用 `toPoiPoints` 算，
不让三页各写一遍那层 `location.point.lng` 嵌套）。

★ **为什么不把它混进 `points`**：那样它会**进聚合**（旁边可能凭空多一个气泡）、
  还要过**档位准入**（`zoom < 8` 时整个不画）——
  而"我搜到并飞过去的那一枚"必须**无条件在场、且以选中态画**。
  所以它是"额外的一枚"，不是"候选中多一枚"。

★ **`useMapReveal` 的两条出口都要转发**：`update` 管候选集变化，
  `refreshView` 管"只是换了选中项"（那时签名比对会跳过 `update`）。

**顺带拆了个文件**：`poiLayer.ts` 涨到 **435 行**（G 项上限 420），
把**选项与句柄**（`PoiLayerOptions` / `PoiUpdateOptions` / `PoiLayerHandle` / `PoiViewEnv`）
搬进 `poiTypes.ts`（它本来就是"只被引用、不参与逻辑"的那一半）→ 回到 **361 行**。
barrel 也改成从 `./poiTypes` 统一再导出 —— A 项的判据认的是**符号真正声明在哪**，
`poiLayer` 里那几行 `export type … from './poiTypes'` 只是给"就近读代码"的便利。

**验收**：`_tmp/cdp_pick_marker.mjs` **6/6**（三个场景各两条判据）·
`check_app.py` **A–Z + AA ALL_CLEAN** · `_falsify_z.py` **63 条全过** ·
护栏 **新增 AA⑥**（契约有 `picked` · 图层**真的用它** · 三页各交一次 ·
揭示钩子两条出口都转发）· `pnpm build` ✓。

### 8.8 优先级写反了：先点开 A，再搜 B，详情**不切换**（2026-09-25）

用户原话：「我点击打开一个景点的详情，然后顶部搜索地图上其他地方的景点，
景点详情弹窗内容**没有切换到新的景点的内容**，地图上的标点**也没有显示**，
我再找到前面打开的那个景点，那个图标**是打开的样式**」。

**三个症状、一个原因**。`useSearchPick` 里那条"合并规则"原文写的是
「**页面自己的选中优先**」，理由是我当时想的"用户刚在地图上点的那一枚，比几秒前搜的
那一枚更接近意图"。**那个理由只覆盖了一半的情况** —— 用户这条链正好是反的：

| # | 发生了什么 | 旧规则下的结果 |
|---|---|---|
| 1 | 清单里点开 A | `page.id = A`，面板显示 A |
| 2 | 顶栏搜 B 并点它 | `pick = B`，但 `selected = page.poi ?? pick.poi` ⇒ **仍是 A** ⇒ 面板不换 |
| 2' | 同上 | `layerId = page.id ?? pick.poi.id` ⇒ **仍是 A** ⇒ 选中层画 A、B 不画 |
| 3 | 回到 A 那片 | A 还占着选中层 ⇒ **图标仍是"打开样式"** |

⇒ 正确的规则不是"谁更近"而是「**后发生的那次意图赢**」：
`pick` **只在"用户刚点了搜索结果"的那一刻存在**（任何别的动作都会把它清掉），
所以"页面选中比 pick 新"这种情况**不存在**。

```ts
// useSearchPick.ts
const effectiveId = pick?.poi.id ?? page.id ?? null      // ← 改前是 page.id ?? pick?.poi.id
selected: pick?.poi ?? page.poi ?? null                  // ← 改前是 page.poi ?? pick?.poi
cityName: pick ? pick.cityName : page.cityName
layerId: effectiveId
```

★ **`selected` 与 `layerId` 必须同一口径** —— 只改一处就会出现"面板换了、高亮没换"
  这种半成品（判据也分开守：AA⑦ 两条）。

★★ 这条规则有一条**前提不变量**：**任何写入页面选中的入口都要先 `clearPick()`**。
  一改就发现城市页多了一条路 —— `CityParts.tsx` 的清单行当时是
  `onSelect={view.setSelectedId}`，**直连 setter、绕过了 `openPoi` 里的 `clearPick()`**。

  ⚠️ **说清可达性（别夸大）**：它**今天不可达** —— 详情面板（620px，左侧）
  **盖住了**清单（348px，左侧），所以"面板开着（= pick 存在）时点清单"根本点不到。
  探针第一版就是去点清单，得到的读数正是"点了没反应"，我差点把它当成应用的 bug
  （见 TRAPS）。但它仍然是**结构上的漏洞**："谁写选中"不该有第二条路，
  而且哪天面板变窄 / 改成不遮清单，它就会立刻变成真的"点了清单没反应"。
  已改：行点击与「详情」按钮都走 `view.openPoi`，并把 `setSelectedId` 从 `CityView`
  的对外契约里**删掉**；`selectedId` 对外的语义也改成"**生效**的那一枚"
  （清单高亮跟随它，否则搜索之后会高亮错行）。

**复现与验收**（`_tmp/cdp_search_switch.mjs`，两条判据 + 一条结构性判据）：

| | 修复前 | 修复后 |
|---|---|---|
| 详情标题 | 仍是 `成都博物馆` | **`广州塔`** |
| 选中层最后一次调用 | `active: ["chengdu-museum"]` | `active: ["canton-tower"]` |
| B 处细类色像素 | **0** | **89** |
| 飞回 A 之后 | A 仍在选中层 | A 回到**普通点层**（`ids` 里带它、`active` 为空）、再没进过选中层 |
| 此时点地图上的 A | — | **切到 A**（"先清 pick 再写选中"这条不变量成立，走的是**能到达**的那条路） |

★ 顺带记一条**布局事实**（它决定了哪些路径"能到达"）：桌面城市页的详情面板
  （`--panel-detail` 620px）与清单面板（`--panel-left` 348px）**都锚在左侧**、
  z 分别是 22 / 20 ⇒ 详情一开，**清单整块被盖住、点不到**。
  所以"面板开着的时候还能从清单改变选中"这件事**不存在**。

★ 这里踩了一个**判据本身不可信**的坑：第一版想用"近白像素"判"A 的白底座撤了没"，
  写的是 `white < 60`；实测**选中态那片**就有 **2826** —— 底图本身就是浅色的
  （路面 / 浅底），这个数根本分不开。改成**结构性判据**：
  飞回 A 后应当出现一次 `setGeometries`**带 A 的 id 但不带 `_A` 样式**（= 它回到了普通点层）。
  ⇒ 纪律：**颜色类的判据只对"specific 的颜色"成立**（细类色可以，白/浅灰不行）。

### 8.9 §7.0 进度更新

| 步 | 状态 |
|----|------|
| 1–4 | ✅ 已完成 |
| **5（搜索）** | ✅ **已完成**（本轮；与 §5.1 的差异见 8.1，与 §6.1/6.2 的差异见 8.2/8.3） |
| **6（视野记忆 + F1）** | ✅ **已完成（2026-09-29）** —— 见 §8.11：**实现方式与 §5.5 不同** |
| 7（护栏与文档同步） | ✅ 护栏 AA 已做；文档同步 2026-10-25 补完（05 / 10 的 RegionPicker、README 索引行） |

### 8.10 结果列表加景点缩略图（2026-09-25）

用户原话：「左侧搜景点的时候，能不能也显示缩略图」。

**数据侧** — 索引里给每个景点加一个 `cover`：

| 项 | 决定 |
|----|------|
| 存什么 | 该点位的**第一张图**（优先 `thumbUrl`，它是给列表用的小图；`url` 是 800px 主图，拿去当 40px 缩略图是白花流量） |
| 存原始还是镜像地址 | **原始**（与 `poi.images[].url` 同源）。写镜像地址 = 把"换镜像要重跑整条流水线"埋回数据里 |
| 没有图的点位 | `null`，**不留空串**（渲染处必须有占位，空串会去请求一个空地址 = 破图） |
| 体积 | 170KB → **347KB**（gzip 67KB）。平均每条约 220 字符（Wikimedia thumb 路径本身就长） |
| 契约 | `schema.py` 与 `schema.ts` **两侧都要加**（双生契约） |

**前端侧** — 三条容易漏的：

1. **镜像出口**：搜索索引是脚本产物、读它的路径（`loadSearchIndex`）**不经过 `loadCity()`**，
   与 `cities.index.json` 是同一个坑的两个入口 → 新增 `imageMirror.mirrorSearchCovers()`，
   `searchIndex.ts` 在 **Schema 校验之后**调用。护栏 **X②b** 守它（判据查**调用形式**，不查子串）。
   漏了的现象是「搜索结果缩略图全白、点进详情同一张图却好好的」。
2. **两种行共用同一个方块**：地区行 / 没图的景点回落到灰底 + 图标占位。
   只给景点加图会让地区行的名字比景点行左移一截，看起来像两套列表。
3. **判据要落到像素**：`<img>` 存在 ≠ 图出来了（src 是镜像地址，可能 404 / 代理超时）——
   验收时逐张回读 `naturalWidth > 0`（实测 6/6 通过：Wikimedia 走 `wsrv.nl`、Pexels 直连）。

---

### 8.11 步骤 6 的落地形态：与 §5.5 有三处出入（2026-09-29，2026-10-25 补记）

§5.5 写的是「`useFitOnce` 接 `sessionStorage`，按 `fitKey` 存，并新增 `shell.applyView({center, zoom})`」。
实际落地时**换了载体、也砍掉了那个新能力**，效果一样但结构不同 —— 记下来，免得后人对不上：
（★ 2026-10-25 核对：这些代码 2026-09-29 就已在仓库里，但 §7.0/§8.9 的进度表一直写着"未开始"。）

| 项 | §5.5 原设计 | 实际落地 |
|---|---|---|
| 存储载体 | `sessionStorage['view:' + fitKey]`（一页一个键） | `sessionStorage['chexing:ui']` 里的 `view` **一个对象**，带 `path` 字段（`common/data/uiState.ts`） |
| 恢复判据 | 有键就恢复 | ★ **`pathname` 必须等于页面加载时那条**（`restoredViewFor`）。理由：从景点详情返回城市页时路径相同，回到"上次在这页看的位置"比重新 fit 全城更贴预期；而换页（路径变了）必须照常走入口取景 |
| 地图能力 | 新增 `shell.applyView()`（瞬时、不动画） | **没有这个方法**。视野恢复走"建图初值"—— 外壳建图时直接用存下的 center/zoom，再让 `useFitOnce` **跳过**入口取景（`useFitOnce.ts:66`） |
| 写入点 | 视野稳定广播 | 同（`viewportEmitter` 那条，与是否有人订阅无关） |
| 顺带 | — | 多了 `picks`（各页选中的景点）/ `plan`（规划面板开合）/ `filters`（城市页筛选）四类会话状态，判据同一套；存不住时退化为内存兜底（隐私模式 / 微信 WebView） |

**F1（直辖市收录）**也一并修了：`district-tree.json` 里直辖市**自身**就是市节点
（`adcode=110000` 且 `cityId='beijing'`、`level='province'`），下级直接是区，
不需要「省下再挂一个同名市」那一层。
