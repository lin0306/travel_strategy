# 行迹 · 城市旅游攻略

地图即画布的纯静态旅游攻略站。**83 城**（成都 · 北京 · 重庆 · 西安 · 上海 · 杭州 · 苏州 · …）、
四级下钻（全国 → 省 → 市 → **区** → 景点）、行程规划、路线规划。
**运行时零后端** —— 数据在构建前就已固化。

---

## 目录地图

**一个目录只做一件事。抓取不 import 展示，展示不 import 抓取。**

| 目录 | 是什么 | 边界 |
|------|--------|------|
| `data/` | **唯一的交接面**：抓取的出口、展示的入口 | 抓取只往里写，展示只从里读 |
| `pipeline/` | 采集流水线（Python） | 只做**抓取**。不 import `web/` |
| `schema/` | 字段契约：`schema.ts` ↔ `schema.py` | 两端**共用同一份**，各自投影 |
| `tools/` | 工程护栏与体检工具 | 跨两端，不属于任何一端 |
| `web/` | 展示工程（Vite7 + React19 + TS + RR7，纯静态 SSG） | 只做**展示**。`web/` 下不许有 Python |
| `plans/` | 设计文档 —— **改代码前先看这里** | 人读 |
| `docs/` | 操作手册（定时任务 / 图片审查 SOP） | 与 `plans/` 分开：`plans` 讲**为什么这么设计**，`docs` 讲**今天怎么操作** |
| `_tmp/` | 一次性探针与临时产物（git 忽略） | 随时可删 |

> **给 AI 执行者**：先读 [`AGENTS.md`](AGENTS.md)（开工顺序 / 命令 / 红线 / 高频坑）。
> 定时任务的完整手册在 [`docs/automation-image-review.md`](docs/automation-image-review.md)。

> `data/` 刻意留在仓库根（在 `web/` 之外），以便"数据目录可整体拿走复用"。

> ★ `prototype/` 已于 2026-10-07 删除（早期低保真线框 + 高保真原型）。
> 布局与交互早已全部落地进 `web/app/`，留着那份 HTML 只会**过期得比代码快**。
> 设计意图由 `plans/` 承载；要回看原型从 git 历史取。

### `pipeline/` 顶层只有 `run.py`，其余按职责分六层

```
pipeline/
  run.py                    ← 唯一入口
  core/       env · layout · fetch · fix_noise    基础设施，被全体依赖（不 import 任何上层）
  providers/  tmap · amap · geoprovider           图商适配（取点只走 geoprovider）
  geo/        citymeta · districts · districtless · labelgeo     区划与几何
  authoring/  seedlib · seed · images             采编稿与图源（人写数据 → 展开成产物）
  steps/      step3 · 3b · 4 · 6 · 7 · 8 · 9 · 10 · 11    采集步骤
  assemble/   build                               组装与派生产物（唯一往 data/_generated 写）
  seeds/      83 城采编稿                          纯数据
```

依赖方向单向向下：`core` ← `providers` / `geo` / `authoring` ← `steps` ← `assemble`。
★ `steps/step6_transit.py` 是**死链路**（通勤时长已改为运行时算，不再预存），不要跑。
★ 搬目录的坑见 `pipeline/*/__init__.py` 的文件头注释（`parents[N]` 必须按文件深度算）。

### `tools/` 都是通用工具（不带下划线）

| 文件 | 作用 |
|------|------|
| `check_app.py` | 工程护栏 A–AV（36 组），改代码后必跑，目标 `ALL_CLEAN` |
| `check_seed.py` | 采编稿体检（入库前跑，支持 `--all` 扫全部城市） |
| `audit_suspects.py` | 列出全站 `_geocodeSuspect` 点位（只读） |
| `rmdir_dist.py` | 清 `web/dist`，绕开 safe-delete 钩子导致的构建死锁 |
| `lint_seed.py` · `scan_bad_rings.py` · `make_fixture.py` · `fix_districtless.py` | 各项专项工具 |

---

## 怎么跑

### 展示（`web/`）

```bash
cd web
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # 产出 web/dist —— Netlify 的发布目录
pnpm check      # 工程守则 A–AV，目标 ALL_CLEAN
```

`pnpm check` 会在**改代码之后**跑一遍结构校验（含 `tsc --noEmit`、单文件 420 行上限、
仓库布局归属等）。它全绿不等于能构建、更不等于能运行 —— 还要 `pnpm build` + 抽查产物。

### 抓取（`pipeline/`）

```bash
python pipeline/run.py usage               # 先看今日 API 额度 + 取点现在走哪家图商
python pipeline/run.py geo-check 北京 故宫   # 新key 配完先跑它，真发请求确认能用
python pipeline/run.py pipeline chengdu    # ③ 地理编码 → ④ 取图 → ⑦ 区划树 → 组装
python pipeline/run.py build --strict      # 只做组装 + 校验 + 生成索引（CI 模式）

python tools/check_seed.py --all           # 扩城前先体检采编稿（入库前必跑）
```

★ 命令一律在**仓库根**执行。细节见 `pipeline/README.md`。

### 契约（`schema/`）

`schema.ts`（Zod，前端运行时校验）与 `schema.py`（Pydantic，脚本产出校验）是**同一份契约**。
改一边必须改另一边；`check_app.py` 的 D 项守两边口径一致。

---

## 几条不会变的红线

1. **地图即画布**：铺满视口，UI 全是浮层，只盖不挤。
2. **引擎限腾讯 / 高德 / 百度 / 天地图**；当前腾讯 GL。业务层只从 `~/map/tencent` 取。
3. **key 走环境变量**，禁硬编码；采集侧 key 在 `pipeline/.env.local`
   （`TMAP_WEB_KEY` / `AMAP_WEB_KEY` / `UNSPLASH_ACCESS_KEY` / `PEXELS_API_KEY`），
   前端那把在 `web/.env.local`（`VITE_TMAP_KEY`）—— **两边分家，且都不进 git**。
   ★ 取坐标**只走 `pipeline/providers/geoprovider.py`**：腾讯优先，
   **日配额耗尽（status 121）自动换高德**（同为 GCJ-02）——121 是静默的，
   不换源的话一次配额耗尽 = 一座城当天报废。
4. **通勤时长运行时算，绝不预存**（2026-10-06 决策）：62 城 × 约 1600 对 × 3 方式的
   矩阵要几百 MB，且半改会造成跨城口径不一致。`steps/step6_transit.py` 是遗留死链路。
5. **顺序由用户定**，禁 TSP；只给事实与陈述式建议。
6. **住宿点 = 隐私**：只存 localStorage，不上传、分享默认脱敏。
7. **图片只用开放许可**，必带 credit。
8. **不采集、不上传位置**。
9. **未收录 = 「待收录」灰虚线，绝不显示 0**（`null ≠ 0`）。
10. **行政边界只能来自持牌图商 / 官方平台**（腾讯 / 高德 / 百度 / 天地图），
    绝不用第三方 GeoJSON —— 版图完整性属《地图管理条例》范畴。

更细的约定与踩过的坑见 `plans/`；工程惯例见 `.workbuddy/memory/`。
