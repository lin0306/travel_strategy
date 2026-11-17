# AGENTS.md —— 行迹 · 城市旅游攻略

> **这份文件是工作协议，不是项目介绍。**
> 项目是什么 → `README.md`；设计意图 → `plans/`；踩过的坑 → `.workbuddy/memory/TRAPS.md`。
> 三者冲突时以**代码**为准（文档会过期，`TRAPS.md` 里的时间是判断新鲜度的依据）。

---

## 0. 开工顺序（照做，别跳）

| 步 | 做什么 | 为什么 |
|---|---|---|
| 1 | **先读**相关代码/配置，别凭文件名猜 | 用户说"你看一下…"时就是字面意思：读完再改 |
| 2 | **先计划**：编号列出要做的事，等确认 | 用户习惯「计划先行」；不满意会回滚重做 |
| 3 | 小步实现，保持**唯一出处** | 见第 5 节，这条是本项目最容易被破坏的约束 |
| 4 | 验证：`check_app` + 相关探针（新护栏要反证） | 见第 4 节，"全绿"不等于"能用" |
| 5 | 记录：日志 `>>` 追加、`TRAPS.md` 写叙事 | 日志 append-only；覆盖写毁过一整天的记录 |

**改代码前必看**：`plans/` 里对应的设计文档（哪个模块改哪份，见 `plans/README.md`）。

---

## 1. 项目一句话

83 城 / 4900 个 POI（以 `data/cities.index.json` 为准，别信写死的数字）的**纯静态**旅游攻略站：地图即画布（铺满视口，UI 全浮层）、
四级下钻（全国 → 省 → 市 → **区** → 景点）、行程规划、路线规划。**运行时零后端**。

---

## 2. 目录边界（越界即错，`check_app` 会报）

| 目录 | 只能做 | 禁区 |
|---|---|---|
| `data/` | **唯一交接面**：抓取往这写，展示从这读 | 别的目录不许有第二份数据源 |
| `pipeline/` | 采集（Python），顶层只有 `run.py`，其余六层 | **不许 import `web/`** |
| `web/` | 展示（Vite7 + React19 + TS + RR7，SSG） | **不许有任何 `.py`** |
| `schema/` | 字段契约 `schema.ts` ↔ `schema.py` | 改一边必须改另一边（D 项守） |
| `tools/` | 工程护栏与体检 | 跨两端，不属于任何一端 |
| `plans/` | 设计文档（人读） | 不是代码注释的垃圾桶 |
| `_tmp/` | 一次性探针（git 忽略） | 不许被 `pipeline/` / `web/` import |
| `docs/` | 操作手册（本文件的补充） | 同上 |

**一个目录只做一件事：抓取不 import 展示，展示不 import 抓取。**

---

## 3. 命令速查（一律在**仓库根**执行）

```bash
# ── 护栏（改完代码必跑，目标 RESULT: ALL_CLEAN）──
E:/BASIC/python/python.exe tools/check_app.py

# ── 数据采集 ──
E:/BASIC/python/python.exe pipeline/run.py usage          # 今日 API 额度 + 取点走哪家图商
E:/BASIC/python/python.exe pipeline/run.py images <city>  # 取图（加 --force 强制重算）
E:/BASIC/python/python.exe pipeline/run.py build          # 全量组装 + 生成索引
E:/BASIC/python/python.exe tools/check_seed.py --all      # 采编稿体检

# ── 图片二次审查（详见 docs/automation-image-review.md）──
E:/BASIC/python/python.exe tools/review_images.py status              # 进度
E:/BASIC/python/python.exe tools/review_images.py next --count 2      # 下一批城市
E:/BASIC/python/python.exe tools/review_images.py sheet <city> --covers --refresh
E:/BASIC/python/python.exe tools/review_images.py apply <city> --dry  # 先演练

# ── 存量图清洗（详见 docs/automation-image-review.md 第 12 节）──
E:/BASIC/python/python.exe tools/clean_images.py scan                 # 全库只读报告
E:/BASIC/python/python.exe tools/clean_images.py apply --rules stock,reject --dry
E:/BASIC/python/python.exe tools/clean_images.py apply --rules stock,reject

# ── 巡检（详见手册第十九节；定时任务自己会跑，这里是手动排查用）──
E:/BASIC/python/python.exe tools/patrol_queue.py next --n 6           # 本轮该查哪 6 个点（带 DUE/ARB 标记）
E:/BASIC/python/python.exe tools/patrol_report.py pending             # 自动待办（到期/待落地/待仲裁），给下一轮
E:/BASIC/python/python.exe tools/patrol_report.py todo                # 人工待办 → 仓库根 TODO.md（正常 0 条）
E:/BASIC/python/python.exe tools/patrol_findings.py list --state open # 全部未结发现

# ── 前端 ──
cd web && pnpm dev        # 5173
cd web && pnpm build      # 产出 web/dist/client（HTML 在 client/ 下，dist/ 只是容器）
cd web && pnpm typecheck  # tsc --noEmit
```

★★ **python 写全路径** `E:/BASIC/python/python.exe`，禁止裸 `python`（依赖装在那个解释器上）。
★★ **`build <city>` 会覆盖 `cities.index.json`**（只剩一城）—— 除非你就是要单城，否则跑全量 `build`。
★ `web/dist` 1 万+ 文件，`pnpm build` 会撞 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`，解法：
`NODE_OPTIONS= CODEBUDDY_SAFE_DELETE_ENABLED=0 npx react-router build`。
（Windows 下还会偶发 `EPERM rmdir` 锁在某个 `dist/client/city/<城>/poi/<点>` 上 —— 删掉 `web/dist` 重跑即可，与代码无关。）

★★ **Netlify 的 `publish` 必须是 `dist/client`，写 `dist` 会全站 404**（2026-11-16 实测修正）：
`web/dist/` 下**只有** `client/` 一个目录（`ssr:false` 时 server 构建被删除），`web/dist/index.html` 不存在
⇒ 发布根错一层，首页、`/assets/*`、连 SPA 兜底的 `/index.html` 全部落空。
**本地永远看不出来**：`pnpm preview` 走 vite 自己的 server，根本不读 `netlify.toml`。
校验脚本 `python _tmp/_netlify_check.py`（首页 · redirect 目标 · 全部 `/assets/` 引用 · 三类页面 · localhost 残留 · 两个 key · pnpm 版本两边一致）。
上线还差两件事，**都不进 git**：① Netlify 站点环境变量 `VITE_TMAP_KEY` + `VITE_AMAP_WEB_KEY`（缺 key 地图不解锁）；
② 腾讯 / 高德控制台给 key 加 **Referer 域名白名单** `*.netlify.app`（注释里写死了：护城河只有白名单 + 配额告警；不配则构建成功但地图不显示）。
★★ **不要自动 `git add` / `git commit`** —— 提交只在用户明确要求时做。
（2026-10-31 定时任务自作主张提交了 changsha/chengde 的 113 个**未审**文件，等于绕过图片审查。）

---

## 4. "做完了"的定义（三件套，互不代表）

| 件 | 证明什么 | 不证明什么 |
|---|---|---|
| `check_app` **ALL_CLEAN** | 结构/约定没被破坏 | 不代表能构建，更不代表能运行 |
| `pnpm build` / `run.py build` 出齐产物 | 能构建 | 不代表页面是对的 |
| **运行时验收**（探针 / 截图 / CDP） | 用户路径真的走得通 | 不代表别的路径也没事 |

- 视觉改动**必须截图**（`_tmp/panels/*.png`），文字描述不算验收。
- 新加护栏**必须反证**：把实现改坏 → 判据必须报红 → 还原。反证失效时**先看自己改动了什么**
  （历史三次同病：正则被右括号截断 / 只加 `void 0;` 前缀 / 反证脚本第二批是死代码）。
- 探针全绿 ≠ 用户路径覆盖。用户说"没修好"时，**先列他可能的位置与输入方式**，别急着改代码。

---

## 5. 三层硬约束

### A. 产品红线（违反即错，别问）

1. **地图铺满视口 + UI 全浮层**（只盖不挤）。
2. **引擎只限腾讯 / 高德 / 百度 / 天地图**；业务层只从 `~/map/tencent` 取。
3. **key 走环境变量**：采集侧 `pipeline/.env.local`，前端只 `VITE_TMAP_KEY`，两边分家、都不进 git。
4. **取坐标只走 `pipeline/providers/geoprovider.py`**（腾讯优先，配额 121 自动换高德）。
5. **通勤时长运行时算，绝不预存**（`step6_transit.py` 已于 2026-10-25 删除，`run.py` 也无 `transit` 子命令）。
6. **顺序由用户定，禁 TSP**；只给事实与陈述式建议。
7. **住宿点只存 localStorage**，不上传、分享默认脱敏。
8. **图片只用开放许可，必带 credit**（`data/**/*.json` 的 `author` 是 CC 署名，不许删）。
9. **未收录 = 「待收录」灰虚线，绝不显示 0**（`null ≠ 0`）。
10. **行政边界只能来自持牌图商/官方平台**，绝不用第三方 GeoJSON（版图完整性属《地图管理条例》）。

### B. 数据结构

- `schema.ts` 与 `schema.py` 是**同一份契约**，改一边必须改另一边。
- 业务字段变更要写 `updatedAt`；`_noImage` = **待重试**不是终态；`_geocodeSuspect` 清了要说明理由。
- 采集→入库只能走 `tools/intake_candidates.py`，**绝不 `run.py seed`**（会清空全城 point/images）。

### C. 代码规矩

| 规矩 | 唯一出处 / 理由 |
|---|---|
| 筛选、排序、计数 | `filterPois` / `sortPois` / `countSubtypes`（`web/app/common/ui/city/PoiList.tsx`） |
| 品类元信息（label / category / color） | `SUBTYPE_META`（`schema/schema.ts`） |
| 加入行程 | `addStopToPlan`（别在组件里自己 push） |
| 点位取景 | `focusPointsFor` + `districtFocus.drillTo`（页面里出现 `shell.focusPoint(` = 绕过空区判断） |
| 缩放阈值 | `web/app/common/map/tencent/zoomTiers.ts`（6.5 / 9.5 / 12 / 11.5 / 15） |
| 下钻定值 | 省 7 · 市 10.5 · 区 12（`districtFocus`） |
| 移动浮层基座 | `mobile/ui/Sheet`（`sheetTier` + `useSheetDrag`），互斥唯一出处 `sheetHub` |
| 层级 | `MapTools` 钉屏幕右下 `z-[27]`，浮层 `z-28`（工具条**不跟浮层高度走**） |
| 提示 | 必须挂 `ToastStack`；`hint()` 自动消失（"为什么没成"）vs `showToast()` 不消失（"结果 + 去哪看"） |
| 图片 | 禁 HTML `title`；`img.complete` 还要 `naturalWidth > 0` |
| 单文件 | **≤ 420 行**（L 项守，超了拆） |
| 滚动容器 | 只认 `.scroll` / `.scroll-x`；**`.scroll` 绝不能带 `overscroll-behavior: contain`**（嵌套会让浮层纹丝不动、零报错） |
| 无人值守任务的产出 | 三分法：**等日期**（`--due`）→ `PENDING.md` 的 DUE 区、到期自己执行；**多来源打架**（`--alt`）→ ARB 区、去查权威源；**只有不可逆取舍**才进仓库根 `TODO.md` | 定时任务没人盯。「还没挂牌」「三个门牌号不知信哪个」**都不是需要人**，前者等日期、后者等权威。**每轮产出 3 条「待复核」= 设计失败**（手册 19.10 / 19.11） |

---

## 6. 当前事实（别猜，也别信过期数字）

| 事实 | 值 | 怎么核 |
|---|---|---|
| 城市 / POI | **83 城 / 4900 POI** | `data/cities.index.json` / `tools/review_images.py status` |
| 图源（自动入库） | **只有 `wikimedia`** | `images.py` 的 `configured_sources()` |
| 图源（候选补图） | Wikimedia + **Pexels / Unsplash**（只进候选池，**AI 看图判 ok 才入库**） | `tools/fetch_candidates.py grab → sheet → apply` |
| 配图库 | 自动入库链路**停用**（`USE_STOCK_SOURCES=False`，护栏 AV ②½）；补图链路 2026-11-08 **恢复为候选源**；83 城 ×3 张**城市封面**仍有存量在用 | 手册第 17 节 / `AboutContent.tsx` 按用途分列 |
| 每点位图片数 | 自动入库上限 6；**候选补图判 ok 全收、无张数上限**（`schema.py` / `schema.ts` 的 8 已删） | 别假设"都是 3 张 / 最多 6 张" |
| 定时任务 | **2 条**：「行迹 · 每日抓新城市数据」00:00（A 入库 + **A4.5 写点评** + B 拓取，造新数据）·「行迹 · 历史数据巡检」每小时（1 城 6 点内容稽查 + **20 条 AI 点评** + **1~2 个单位省/市封面复核** + 图片 URL 探活，**修旧数据 / 补长尾**）；都常驻不自删、同目录不并发 | `automation_update list`；手册第 3 / 19 / 22 节 |
| 城市封面 | `city.json.heroImages`（1~3 张）。**只收 Wikimedia、查询词用本城地标名、逐张看图**（图库没有地理校验）；账本 `data/_generated/city-covers.json`，工具 `tools/city_cover.py`（grab → sheet/cands → verdicts → apply，alt 必须中文） | `city_cover.py status`；图片手册第二十节 |
| 封面复核 | `tools/cover_review.py`：`next`（体检清单，省/市**交错**输出）/ `sheet`（看已上线）/ `cands`（多城候选合表，每地标一张轮转）/ `keep`（只写 `reviewedAt`，不动 `at`）/ `urls`（HEAD 探活，轮转）。判据：账本 need 10 · **图源非 Wikimedia 4/张** · 依据消失 3/张 · 城市名通道 2/张 · alt 无中文 2/张 · 张数<3 加 3 · 前 3 重点景区零覆盖 2 · 久未复核 1 | `cover_review.py next --kind both --n 6`；手册第二十二节 |
| AI 点评覆盖 | 见 `tools/ai_review.py status`（**刻意不写死数字**，小时任务每轮 +20 在变）；没写点评的点**整块不渲染**，不是缺陷 | `ai_review.py status` |
| 巡检待人工 | **只认仓库根 `TODO.md`**（每轮覆盖重写，正常是 0 条；`HUMAN=n>0` 时定时任务会把自己的名字改成带 `⚠️n 条待确认`，借 WorkBuddy 的完成通知/侧边栏提示人）；自动待办看 `_tmp/patrol/PENDING.md`（到期/待落地/待仲裁，任务自己消费）；`findings-*.json` 是状态机不是垃圾桶 | `patrol_report.py todo` / `pending` |
| 成都的区 | 20 个区里 **11 个 `poiCount = 0`** | 点它不挪镜头，只说「暂无收录景点」 |
| 护栏 | `check_app.py`：**63 条断言组**（代号到 **BI**，组内多条断言） | 末尾打印 `RESULT: ALL_CLEAN`；组数以 `grep -c "^  \[ ok \]"` 为准 |
| 首页地域面板 | 桌面端点**省 / 市徽标** → 放大 + 左侧开卡（省概览 → 城市列表 → 市概览 → 区列表）。偏移**不写死**：落点 = `freeRect` 实测的可用区中心（只有左面板 dx≈+172，再开路线规划变 −44）⇒ 面板必须走 `Overlay`、对焦必须等下一帧（`requestAnimationFrame`）。★ **点击闭环四条**：搜索命中地区走 `pickPageRegion`（首页登记 `region.pick`，不许搜索自己算落点）· 未收录的市在面板里**可点**（`pendingPickable`，省级页仍禁用）· 换卡时 `.scroll` 归零 · `empty` 只对**区**成立（市 / 省点了必须有位移） | `common/logic/regionNav.ts` · `desktop/ui/RegionPanel.tsx` · 护栏 **BC** / **AE** / **BE** |
| 轮廓作用域 | 选中省 / 市 / 区后，轮廓与徽标**只铺它和它的下一级**（先按归属裁、再按视野裁），缩回全国自动放开。归属用**段式前缀**（省 2 位 / 市 4 位 / 区 6 位，写成全等只对区有效）；省界另取一层**自身轮廓**画粗一档（各市外沿拼合与市界同粗，读不出"一整个省"）。翻译 `scopeOf`，取数 `useScopeOutline`，外框 `districtScope` | `common/map/tencent/reveal.ts`（`RevealScope`）· 护栏 **BF** |
| 徽标摆放 | `layoutBadges(nodes, view)` 返回 **adcode → 经纬度**（不是可见集合）。三档：窄容器（<640px）撞了就**丢** · 徽标 >48（市级几百个）撞了就**丢** · 宽容器 + ≤48（省级 34 个）撞了就**错开一格**。错开方向由 `orderByAway` 现算：先满足**方位一致性**（错开后不许把左右/上下关系翻转——少了这条，中国澳门会被摆到中国香港东边），再按「背离最近邻居」的余弦相似度取最贴的方向。★ 最多**一格**（30/34px）：两格在低缩放下对应 300~600 km，实测会把港澳推散到南海且方位颠倒，比少显示一个糟。★ 腾讯 `MultiLabel` 几何**没有**像素偏移，所以像素偏移要经 `unprojectPixel` 反算回经纬度喂 `position`（逆运算往返误差 1e-14）。★ 坐标必须进 `contentSig`：错开量是像素，zoom 一变经纬度就变 | `districtBadges.ts` · `viewport.ts` · 护栏 **AN** |
| 底图默认 | `DEFAULT_BASEMAP` = **矢量图 · 简略**（四项开关全关，只剩底面 + 边界）。理由：底图自带的 POI 名/路名/建筑会与自家点位名、区划徽标抢同一片屏幕，放大到城市级时把景点名字淹掉。用户改过就记 localStorage（`basemapPreference`），不会被默认值覆盖 | `basemap.ts` · 护栏 **U** |
| 轮廓四档描边 | `face`（省 / 市级面，浅灰 0.70 / 2px）‹ `faceDeep`（**district 级**面，深灰 0.95 / 2px）‹ `scope`（选中单位自身，近黑 0.96 / **3px**，跨档）；`reference` 是点位 / 规划档的背景面（比 `faceDeep` 浅）。分档轴是**底图吵不吵**，不是收录数量。★ 判据跟 `faceLevel`（揭示级）走、**不按绝对 zoom**：城市页 / 移动端 z=9.46 / 7.99 也已是街道底图；`faceLevel` 一变必 `setNodes → repaint()`，时序天然对齐。**两条图层通道都要传**（`useMapReveal` / `useCityDistrictLayer`） | `common/map/tencent/districtStyles.ts` · 护栏 **BG** |
| 水合稳定快照 | `usePlanUi` 是**模块级** store，初值读 sessionStorage 会让客户端首帧比预渲染 HTML 多一个 `<MobileRoutePlanPanel>` ⇒ React 丢整棵树重渲染，重渲染 `<head>` 又撞上腾讯 SDK 的 `<script>`（实测 LCP 2748ms）。口径同 `useViewport`：**首帧用稳定快照**（面板关 / 第 1 天），挂载后由 `restorePanelUi()` 一次接回；唯一入口在 `routes/map-shell.tsx`。★ 单独改筛选 / 排序**不会**触发 | `common/logic/itinerary/planUi.ts` · 护栏 **BG** |
| 海报底图代理 | 行程海报底图走**同源 Netlify Function**（`web/netlify/functions/staticmap.mjs`），前端只发路径 `/.netlify/functions/staticmap`。起因：高德「Web服务」key **没有域名白名单**（那只属于 Web端 JS API key），而静态图只认 Web服务 key ⇒ 浏览器直连 = key 公开；IP 白名单因浏览器出口 IP 不固定也用不了，数字签名要把 SK 发到浏览器同样无效。⇒ key 只读服务端 `AMAP_WEB_KEY`（**不许带 `VITE_`** 前缀），域名白名单由函数校验 Referer（`ALLOWED_ORIGINS`，默认 `netlify.app,localhost,127.0.0.1`），query 走**参数白名单**防"任意高德接口代理"。★ `functions.directory` **相对 base 解析** ⇒ 值是 `netlify/functions`；写错只是 warning、函数静默不部署、海报永远无底图。★ 本地 `pnpm dev` 不跑 functions，底图降级为无底图（路线标记照画），不是故障 | `netlify.toml` · 护栏 **BH** |
| 构建规模与密钥扫描 | 两道「本地能过、Netlify 必挂」的坎。① **内存**：`import.meta.glob` 的每个文件都是 Rollup 一个模块，直接 glob 源分片 = 5066 数据模块 + 1191 边界模块，峰值 3.9 GB；Netlify 容器被 Node 判 4 GB ⇒ V8 堆上限 2 GB ⇒ exit 134。⇒ `web/scripts/gen-web-data.mjs` 先聚合到 `data/_generated/web/cities/{cityId}.json`（5066 → 83），`dev`/`build` 各自内联前置 `pnpm gen:data`，产物**不入库**。② **密钥扫描**：`VITE_` 前缀在构建期是字符串替换，值必然进 bundle；Netlify 对标记为 secret 的变量扫产物 ⇒ build 已 exit 0 却在 "Scanning for secrets" 阶段 exit 2。腾讯 JS API key 属**公开即设计**（靠 Referer 白名单保护，不是保密）⇒ `SECRETS_SCAN_OMIT_KEYS="VITE_TMAP_KEY"` 放行；真密文 `AMAP_WEB_KEY` **不许**加进去 | `gen-web-data.mjs` · `netlify.toml` · 护栏 **BI** |
| 省级介绍与封面 | `data/provinces/index.json`（34 条，键 = adcode）：`intro` 采编正文 + `heroImages`（**允许为空**，与 `City` 的 `min_length:1` 不同）。封面走 `tools/province_cover.py`：地标 = 全省点位按 popularity 取前 6（**排 `category=food`**），**只收 Wikimedia**，逐张看图；账本 `data/_generated/province-covers.json`。现状：34 省齐全但**多为 1 张**（图集缩略条只一格），由巡检逐轮补到 3 张 | `province_cover.py status`；设计见 `plans/05` **P1·C** |
| 详情排版基座 | `common/ui/Section.tsx`（`Prose` / `H2`）+ `common/ui/HeroGallery.tsx`（`HeroGallery` / `GalleryStrip`）—— 景点详情、城市介绍、省卡**同一套**；城市介绍**不许**折叠、**不许**点图翻页 | 护栏 **BD** |
| 城市页展示层 | **封面 + 简介 + facts 已接**（`common/ui/city/CityIntro.tsx`，两端同序挂在滚动区最顶）；护栏 **BB** 守着"三字段必须被读、两端都必须挂、署名唯一出口" | `grep -rn "CityIntro" web/app` |
| 图片审查进度 | 见 `docs/automation-image-review.md` 第 10 节 | 以 `status` 为准 |

---

## 7. 六个高频坑（完整叙事见 `TRAPS.md`）

| 坑 | 一句话 |
|---|---|
| **数据缺口 ≠ 渲染 bug** | "不撒点了"先分清"数据层撒了没"（看 `__mapLog`）和"这一片有点吗"（看 `poiCount`），别急着调取景 |
| **配图库是主题库不是地点库** | 搜「农安辽塔」给你上海的古塔，且无 GPS/分类。分链路：**自动入库链路禁用**（`USE_STOCK_SOURCES=False` 绝不改回 True）；**补图链路可作候选源**，但必须 AI 看图判 ok 才入库 |
| **去注释函数按语言分家** | `.py` 用 `strip_py_comments`（`ast` 定位 docstring）；拿 TS 版处理 py 会把 `/*` 之后整段抹掉 ⇒ **判据读空文本、静默失效** |
| **判据落行为不落名字** | `verdict_for(` 在 docstring 里也算"出现"；要判**调用点**。判据串还会**自指**（匹配自己那行）⇒ 拆开拼接 |
| **搬目录三类静默失效** | `parents[N]` 按深度算 · 三种 import 形态 · 相对目录假设（seeds 从 PIPELINE 根算）；搬完必跑 **AR** 项 |
| **`_noImage` 是待重试** | Wikimedia 偶发断连会静默返回空，一次抖动就把有真图的点位标成没图（西安城墙实测） |

---

## 8. 定时任务与图片审查（这里的"你"要分清）

现在**有 2 条常驻任务**，同一工作目录 ⇒ 调度器 `serialized, max 1`，**永不并发**（只是顺延）：

| 任务 | 频率 | 做什么 | 写数据 |
|---|---|---|---|
| 行迹 · 每日抓新城市数据 | 00:00 | **A 段入库**（消费存量候选 → **A1.5 风评打分闸门：`rate_poi.py` 四维加权，未评分/判 `no` 的条目 `intake_candidates` 直接拒收** → 10~12 个 POI → **A4.5 当场写 AI 点评（`ai_review.py write`，`basis=web`、分数复用 A1.5）** → geocode / images 两趟 / 全量 build / check_app）→ **B 段拓取**（`discover_queue.py run` 反复调到 `NEXT=stop`：跑完一城再看 `tencent_left`，`>0` 就开下一城，把 **200/200 打满**；最后一城余额不够时自动切高德补完剩余关键词，当天收手） | **是**（新点位 / 新图） |
| 行迹 · 历史数据巡检（每小时） | 每小时 | **先把待办做掉**：`PENDING.md` 的 DUE（到期执行）/ READY（A 档带 URL 直接落地）/ ARB（按权威链比对，以权威为准）→ `patrol_queue next` 选城选点（优先有 DUE/ARB 的城）→ AI 联网核实「还开着吗 / 门票变了吗 / 多了哪些新景点」+ **P6.5 热点巡检（宰客避雷 / 新晋爆火 → `tips` + `popularity`，幅度 ≤20）** + `patrol_sheet` 看已上线封面 → 改字段 / 重抓挂错的图 / 可逆下架 → **P5.5 补 20 条 AI 点评**（核实过的点 `web`、同城长尾 `corpus`；存量 4900 点靠这条慢慢补满）→ 有改动就全量 build（详见 `docs/automation-patrol.md`） | **是**（老点位订正 / 图片 / 热度 / 点评） |

两条都**常驻，不自删**。★ 两个任务都写数据，边界不在"读写"而在"改什么"：
任务 1 造新的，任务 2 修旧的。任务 2 **不碰图商配额**（只打 Wikimedia），
也**不是**全库补图任务（那条链路仍只有手动通道）。

| 执行者 | 能做的 | 不能做的 |
|---|---|---|
| **定时任务 1**（独立进程，看不到会话） | A/B 两段全流程（**含 build**）/ 记账 / 写日志 | `run.py seed` · commit · 按常识编来源 · 自己判图 |
| **定时任务 2**（内容稽查） | 联网核实内容 / 看图 / 白名单字段订正 / `grab --poi` 重抓 / `retire` 可逆下架 / 写新景点线索 / build | 改分类 · 删点位文件（除 A 档证据下 retire） · 直接入库新景点 · 改 `pipeline/seeds/` · commit · 碰图商配额 · 删自己 |
| **会话里的你**（能读图） | 补图链路 `grab → sheet --dense/--only → 看图 → apply`（判 ok 全收）· 看仓库根 `TODO.md`（唯一的待人工出口，正常是空的）· 需要了解存量待办看 `PENDING.md` | 在定时任务跑的时候改同一批数据文件 |

★ 旧「每日图片重抓 + 审查备料」与「无图点位自动补图（会自删）」**均已停用**；
全库批量补图仍**没有自动调度者**，只能手动跑（每小时稽查只做每轮 ≤2 点的少量重抓）。

完整手册（现行配置在第 3 节，旧任务归档在第 1~14 节，11-08 复核在第十八节、巡检在第十九节）：
**`docs/automation-image-review.md`**。★ 两条任务完整 prompt 的唯一真源都是
`automation_update(mode="view", id=<对应 id>)`，文档刻意不抄第二份全文。

**每小时巡检的设计文档**（分工 / 风评打分卡 / 热点判据 / 已知坑 / 演化史）：
**`docs/automation-patrol.md`** —— 讲"为什么这么设计"，命令清单在 prompt 里。

★ 会话里被要求"审一下图"时（旧封面审查流程，`review_images.py`）：`status` → 读
`manifest-covers.json` → 看 `sheet-covers-*.png` → 写 `verdicts-covers.jsonl` → `apply --dry`
→ `apply` → **再出一轮新封面再审**（删图后 `coverIndex=0` 指向没审过的图）→ 全量 `build` → 记账 `reviewed`。
★ 若是"给无图点位补图"，走 `fetch_candidates.py` 的两轮看图（`--dense` 粗分类 → `--only` 精看定结论），
**粗筛不许下"对不对"的结论**（160px 看不清匾额店招）。

---

## 9. 记忆与记录

| 文件 | 用途 | 写法 |
|---|---|---|
| `.workbuddy/memory/<date>.md` | 每日工作日志 | **只许 `>>` 追加**，写前先 `ls` |
| `.workbuddy/memory/MEMORY.md` | 项目长期索引（≤3000 字） | 只留"动手前必须知道"，细节指向 `TRAPS.md` |
| `.workbuddy/memory/TRAPS.md` | 踩坑叙事（越写越长是正常的） | 现象 → 根因 → 修法 → ★★ 教训 |
| `.workbuddy/memory/image-rebuild.json` | 图片重抓进度账本 | `refetched` / `reviewed` 两个名单，别合并 |
| `.workbuddy/memory/discover-intake.json` | 候选入库账本 | 另一个任务的事，别混 |

这些目录**不进 git**（`/.workbuddy/` 已忽略）—— 换机器会丢，重要结论要同时落到 `TRAPS.md`/`plans/`。

---

## 10. 沟通约定

- **中文**，简洁直接，少废话；给代码时不必逐行解释。
- 计划用**编号列表**；评估用**表格**；结论先行，再分点。
- 不确定就问（尤其"要不要现在改"），别猜着改。
- 报告"修好了"之前，先自查第 4 节三件套 —— 用户会按结果验证，不会按你的描述相信。
