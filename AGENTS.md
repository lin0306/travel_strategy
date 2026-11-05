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

83 城 / 4820 个 POI 的**纯静态**旅游攻略站：地图即画布（铺满视口，UI 全浮层）、
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

# ── 前端 ──
cd web && pnpm dev        # 5173
cd web && pnpm build      # 产出 web/dist
cd web && pnpm typecheck  # tsc --noEmit
```

★★ **python 写全路径** `E:/BASIC/python/python.exe`，禁止裸 `python`（依赖装在那个解释器上）。
★★ **`build <city>` 会覆盖 `cities.index.json`**（只剩一城）—— 除非你就是要单城，否则跑全量 `build`。
★ `web/dist` 1 万+ 文件，`pnpm build` 会撞 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`，解法：
`NODE_OPTIONS= CODEBUDDY_SAFE_DELETE_ENABLED=0 npx react-router build`。
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
5. **通勤时长运行时算，绝不预存**（`step6_transit` 是死链路，别跑）。
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

---

## 6. 当前事实（别猜，也别信过期数字）

| 事实 | 值 | 怎么核 |
|---|---|---|
| 城市 / POI | **83 城 / 4820 POI** | `tools/review_images.py status` |
| 图源 | **只有 `wikimedia`** | `images.py` 的 `configured_sources()` |
| 配图库 | **已停用**（`USE_STOCK_SOURCES = False`） | 同上，且护栏 AV ②½ 会报红 |
| 每点位图片数 | 上限 6，分布不齐（0~6） | 别假设"都是 3 张" |
| 成都的区 | 20 个区里 **11 个 `poiCount = 0`** | 点它不挪镜头，只说「暂无收录景点」 |
| 护栏 | `check_app.py` **36 组**（代号 A–AV，组内多条断言） | 末尾打印 `RESULT: ALL_CLEAN` |
| 图片审查进度 | 见 `docs/automation-image-review.md` 第 10 节 | 以 `status` 为准 |

---

## 7. 六个高频坑（完整叙事见 `TRAPS.md`）

| 坑 | 一句话 |
|---|---|
| **数据缺口 ≠ 渲染 bug** | "不撒点了"先分清"数据层撒了没"（看 `__mapLog`）和"这一片有点吗"（看 `poiCount`），别急着调取景 |
| **配图库是主题库不是地点库** | 搜「农安辽塔」给你上海的古塔，且无 GPS/分类 ⇒ 过滤器瞎。已停用，**别加回来** |
| **去注释函数按语言分家** | `.py` 用 `strip_py_comments`（`ast` 定位 docstring）；拿 TS 版处理 py 会把 `/*` 之后整段抹掉 ⇒ **判据读空文本、静默失效** |
| **判据落行为不落名字** | `verdict_for(` 在 docstring 里也算"出现"；要判**调用点**。判据串还会**自指**（匹配自己那行）⇒ 拆开拼接 |
| **搬目录三类静默失效** | `parents[N]` 按深度算 · 三种 import 形态 · 相对目录假设（seeds 从 PIPELINE 根算）；搬完必跑 **AR** 项 |
| **`_noImage` 是待重试** | Wikimedia 偶发断连会静默返回空，一次抖动就把有真图的点位标成没图（西安城墙实测） |

---

## 8. 定时任务与图片审查（这里的"你"要分清）

每天 00:00 有一个独立进程在跑「图片重抓 + 审查备料」。**它只备料，判定在会话里做。**

| 执行者 | 能做的 | 不能做的 |
|---|---|---|
| **定时任务**（独立进程，看不到会话） | 选城 / 重抓 / 出对照表 / 记账 / 写日报 | build · apply · commit · 按文字猜对错 |
| **会话里的你**（能读图） | 逐格看图 → 写 `verdicts` → `apply` → `build` | 顺手改采集代码（另开一轮） |

完整操作手册（含 prompt 原文、SOP、排错表、换模型 checklist）：**`docs/automation-image-review.md`**。

★ 你在会话里被要求"审一下图"时，步骤是：`status` → 读 `manifest-covers.json` → 看 `sheet-covers-*.png`
→ 写 `verdicts-covers.jsonl` → `apply --dry` → `apply` → **再出一轮新封面再审**（删图后 `coverIndex=0`
指向没审过的图）→ 全量 `build` → 记账 `reviewed`。

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
