# 行迹 · 城市旅游攻略

地图即画布的纯静态旅游攻略站。**83 城**（覆盖 34 个省级单位）、**4972 个点位**，
四级下钻（全国 → 省 → 市 → **区** → 景点）、行程规划、路线规划。

**运行时零后端** —— 数据在构建前就已固化，全站预渲染成静态 HTML。

---

## 目录地图

**一个目录只做一件事。抓取不 import 展示，展示不 import 抓取。**

| 目录 | 是什么 | 边界 |
|------|--------|------|
| `data/` | **唯一的交接面**：抓取的出口、展示的入口 | 抓取只往里写，展示只从里读；不许有第二份数据源 |
| `pipeline/` | 采集流水线（Python） | 只做**抓取**。不 import `web/` |
| `schema/` | 字段契约：`schema.ts` ↔ `schema.py` | 两端**共用同一份**，各自投影；改一边必须改另一边 |
| `tools/` | 工程护栏、体检、入库闸门、巡检 | 跨两端，不属于任何一端 |
| `web/` | 展示工程（Vite7 + React19 + TS + RR7，纯静态 SSG） | 只做**展示**。`web/` 下不许有任何 `.py` |
| `plans/` | 设计文档（13 篇 + 索引）—— **改代码前先看这里** | 人读，不是代码注释的垃圾桶 |
| `docs/` | 操作手册（图片审查 / 巡检，定时任务的步骤清单） | 与 `plans/` 分开：`plans` 讲**为什么这么设计**，`docs` 讲**今天怎么操作** |
| `_tmp/` | 一次性探针与临时产物（git 忽略） | 随时可删；不许被 `pipeline/` / `web/` import |

> **给 AI 执行者**：开工顺序、命令、红线、高频坑全在 [`AGENTS.md`](AGENTS.md)，先读它。
> 这份 README 只负责「这个仓库是什么、目录怎么分、怎么跑起来」。

> `data/` 刻意留在仓库根（在 `web/` 之外），以便"数据目录可整体拿走复用"；
> 前端通过 Vite alias `~data` 引入，新增一座城市**不需要改一行前端代码**。

### `pipeline/` 顶层只有 `run.py`，其余按职责分六层

```
pipeline/
  run.py                    ← 唯一入口
  core/       env · layout · fetch · fix_noise        基础设施，被全体依赖（不 import 任何上层）
  providers/  tmap · amap · geoprovider               图商适配（取点只走 geoprovider）
  geo/        citymeta · districts · districtless · labelgeo      区划与几何
  authoring/  seedlib · seed · images · image_filter · entity_images   采编稿与图源
  steps/      step3 · 3b · 4 · 7 · 8 · 9 · 10 · 11 · 12            采集步骤
  assemble/   build                                   组装与派生产物（唯一往 data/_generated 写）
  seeds/      83 城采编稿                              纯数据
```

依赖方向单向向下：`core` ← `providers` / `geo` / `authoring` ← `steps` ← `assemble`。
★ `step6_transit.py`（通勤矩阵）已于 2026-10-25 **删除** —— 通勤时长改为运行时算，不再预存；`run.py` 也没有 `transit` 子命令。
★ 搬目录的坑见 `pipeline/*/__init__.py` 文件头（`parents[N]` 必须按文件深度算）。

### `tools/` 按用途分四组

| 组 | 工具 |
|----|------|
| 护栏 · 体检 | `check_app`（63 组断言，改代码后必跑）· `check_seed` · `lint_seed` · `audit_suspects` · `audit_history` · `scan_bad_rings` · `fix_districtless` · `make_fixture` · `rmdir_dist` |
| 配图 · 封面 | `review_images` · `clean_images` · `city_cover` · `province_cover` · `cover_review` · `cover_sheet` · `fetch_candidates` · `remap_candidates` |
| 入库 · 拓取 | `intake_queue` · `intake_candidates` · `rate_poi` · `discover_queue` · `refill_queue` · `refill_one_poi` · `ai_review` |
| 巡检 | `patrol_queue` · `patrol_findings` · `patrol_report` · `patrol_sheet` · `arrival_progress` |

每个工具的用法写在它自己的文件头；`docs/` 里的手册负责链路级流程。

---

## 怎么跑

命令一律在**仓库根**执行；python 一律写全路径 `E:/BASIC/python/python.exe`（依赖只装在那个解释器上）。

### 展示（`web/`）

```bash
cd web
pnpm install
pnpm dev          # http://localhost:5173
pnpm build        # 预渲染全部路由 → web/dist/client  ← Netlify 的发布根
pnpm preview      # 本地看预渲染产物（SEO 只能这样验，dev 是 CSR）
pnpm typecheck    # tsc --noEmit
pnpm check        # 工程护栏（= tools/check_app.py），目标 RESULT: ALL_CLEAN
```

★ 产物是 `web/dist/client/`，不是 `web/dist/` —— `ssr:false` 时 RR7 会删掉 server 构建，`dist/` 只是容器。
★ `web/dist` 1 万+ 文件，直接 `pnpm build` 会被 safe-delete 钩子卡死（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`）。
解法二选一：`NODE_OPTIONS= CODEBUDDY_SAFE_DELETE_ENABLED=0 pnpm build`，或先 `python tools/rmdir_dist.py`。
（Windows 下偶发 `EPERM rmdir` 锁在某个 `dist/client/city/<城>/poi/<点>` 上 —— 删掉 `web/dist` 重跑即可，与代码无关。）

**护栏全绿 ≠ 能构建 ≠ 能运行**，三件事互不代表。视觉改动必须截图。

### 抓取（`pipeline/`）

```bash
E:/BASIC/python/python.exe pipeline/run.py usage               # 今日额度 + 取点走哪家图商
E:/BASIC/python/python.exe pipeline/run.py geo-check 北京 故宫  # 新 key 配完先跑它，真发请求
E:/BASIC/python/python.exe pipeline/run.py pipeline chengdu    # ③ 地理编码 → ④ 取图 → ⑦ 区划树 → 组装
E:/BASIC/python/python.exe pipeline/run.py build --strict      # 只组装 + 校验 + 生成索引（CI 模式）
E:/BASIC/python/python.exe tools/check_seed.py --all           # 扩城前先体检采编稿
```

★ `build <city>` 会把 `cities.index.json` 覆盖成只剩那一城 —— 除非你就是要单城，否则跑全量 `build`。
细节见 [`pipeline/README.md`](pipeline/README.md)。

### 契约（`schema/`）

`schema.ts`（Zod，前端运行时校验）与 `schema.py`（Pydantic，脚本产出校验）是**同一份契约**。
改一边必须改另一边；`check_app.py` 的 D 项守两边口径一致。

---

## 部署（Netlify）

`netlify.toml` 在仓库根，四处硬约束，改错就是全站 404 或海报没底图：

```toml
[build]
  base = "web"
  command = "pnpm build"
  publish = "dist/client"            # ★ 写 dist 会 404：dist/ 下只有 client/ 一个目录

[functions]
  directory = "netlify/functions"    # ★ 相对 base 解析 ⇒ 实际是 web/netlify/functions
```

- **本地永远看不出发布根错误** —— `pnpm preview` 走 vite 自己的 server，不读 `netlify.toml`。
  上线前跑 `E:/BASIC/python/python.exe _tmp/_netlify_check.py`（首页 · redirect 目标 · 全部 `/assets/` 引用 ·
  三类页面 · localhost 残留 · 两个关键 env · pnpm 版本两边一致）。
- 站点环境变量（**不进 git**），两条：
  - `VITE_TMAP_KEY` —— 会被编进 bundle。前端地图渲染（JS API GL）和行程路线（WebService 的
    direction / matrix / 逆地理，走 JSONP）都用它，**必须有 `VITE_` 前缀**。
  - `AMAP_WEB_KEY` —— **绝不能带 `VITE_` 前缀**。只给 `netlify/functions/staticmap.mjs` 用
    （行程海报底图）；带了前缀就会被 Vite 注入 bundle，等于公开。
- **两家图商的白名单能力不同，别照抄**：
  - 腾讯 → Key 详情里的**域名白名单**填 `netlify.app` + `localhost`（腾讯按「填了就连子域一起授权」，
    所以 `xxx.netlify.app` 与 deploy-preview 域名都覆盖）。**必须配**：前端 WebService 是浏览器直连，
    不配等于把 key 连同配额一起送人。
  - 高德 → **没有域名白名单**，那只属于「Web端(JS API)」类型的 key；静态图只认「Web服务」key，而
    Web服务 key 只能配 IP 白名单，浏览器出口 IP 不固定 ⇒ 一配海报就挂。所以底图改走同源函数，
    域名校验在函数里做（环境变量 `ALLOWED_ORIGINS`，默认 `netlify.app,localhost,127.0.0.1`）。
- 绑定自定义域名后要**同时改两处**：腾讯的域名白名单 + 函数的 `ALLOWED_ORIGINS`，漏一处就是
  「地图正常、海报没底图」或反之。
- `packageManager`（`web/package.json`）与 `PNPM_VERSION`（`netlify.toml`）必须同值 —— 版本不一致是部署失败头号原因。

---

## 几条不会变的红线

1. **地图即画布**：铺满视口，UI 全是浮层，只盖不挤。
2. **引擎限腾讯 / 高德 / 百度 / 天地图**；当前腾讯 GL。业务层只从 `~/map/tencent` 取。
3. **key 走环境变量**，禁硬编码；采集侧在 `pipeline/.env.local`，前端在 `web/.env.local`
   （`VITE_TMAP_KEY`）—— **两边分家，且都不进 git**。
   ★ 高德海报 key（`AMAP_WEB_KEY`）**只放服务端**（Netlify 环境变量 / `pipeline/.env.local`），
   绝不带 `VITE_` 前缀 —— 理由见「部署」节：高德 Web服务 key 没有域名白名单。
   ★ 取坐标只走 `pipeline/providers/geoprovider.py`：腾讯优先，**日配额耗尽（status 121）自动换高德**（同为 GCJ-02）。
4. **通勤时长运行时算，绝不预存**（2026-10-06 决策）：全量矩阵要几百 MB，且半改会造成跨城口径不一致。
5. **顺序由用户定，禁 TSP**；只给事实与陈述式建议。
6. **住宿点 = 隐私**：只存 localStorage，不上传、分享默认脱敏。
7. **图片只用开放许可，必带 credit。**
8. **不采集、不上传位置。**
9. **未收录 = 「待收录」灰虚线，绝不显示 0**（`null ≠ 0`）。
10. **行政边界只能来自持牌图商 / 官方平台**，绝不用第三方 GeoJSON —— 版图完整性属《地图管理条例》范畴。
11. **不自动 `git add` / `git commit`** —— 提交只在用户明确要求时做（自动提交等于让未经审查的数据出门）。

更细的约定与踩过的坑见 `plans/`；工程惯例与历史坑见 `.workbuddy/memory/`。
