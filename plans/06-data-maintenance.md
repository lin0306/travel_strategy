# 06 · 数据维护方案（存储选型 · 溯源 · 更新 · 查询）

> 项目定位：**纯开源、非商用**。所以重心不是"页面写死内容"，而是**把数据层当一等公民**来维护。
> 本章回答四件事：数据用什么格式存、怎么保证格式统一、每个数据从哪来怎么跳回去、怎么更新与快速查询。

---

## 一、存储格式选型

### 1.1 候选对比

| 方案 | 更新（diff / PR review） | 查询能力 | 额外包体 | 开源协作 | 结论 |
|------|------------------------|---------|---------|---------|------|
| **JSON 分片** | ✅ 纯文本，PR 里能看清改了哪行 | 内存 filter/sort，46 条 < 1ms | 0 | ⭐ 最佳 | ✅ **采用** |
| Markdown 分片 | ✅ 可 diff | 需解析器，半结构化 | +解析器体积 | 好 | 长文可以，结构化字段不行 |
| SQLite（.db 提交） | ❌ 二进制，diff 是乱码 | SQL 强 | +900KB~1.5MB wasm | 差 | ❌ |
| SQLite WASM（运行时） | ❌ 同上 | SQL 强，支持全文检索 | sql.js ~1.5MB；官方 `@sqlite.org/sqlite-wasm` 需 COOP/COEP 响应头 | 差 | ❌ 见下方说明 |
| Parquet / Arrow | ❌ | 极快 | +大型解析库 | 差 | ❌ 前端过重 |

### 1.2 结论：JSON，且写死理由

1. **决定性因素**：数据是"内容"，开源项目靠 PR 协作。JSON 的 diff 人能读，SQLite 的 diff 是二进制噪声 —— 这一条就否掉了数据库。
2. **性能根本不是问题**：单城 46 个 POI、单文件 ≤ 300KB，全量 load 进内存做 filter/sort 是**微秒级**。为 46 条数据上 SQL 是杀鸡用牛刀。
3. **格式统一靠 Schema 不靠数据库**：Zod 是唯一真源，脚本产出和前端消费共用同一份定义（见第三节）。
4. **部署零负担**：Vite 直接 `import()` JSON，不需要 wasm、不需要 COOP/COEP 头。

> **升级触发条件**（写死，别拍脑袋）：当出现下列任一情况，才启动 SQLite 评估 ——
> 城市数 > 30 **或** 总 POI > 3000 **或** 首屏查询耗时实测 > 100ms。
> 目前（1–5 个城市、约 200 POI）距离阈值很远。

---

## 二、数据目录与文件职责

```
data/
├─ cities.index.json              # 城市列表（★构建期生成，勿手改）
├─ cities/
│   ├─ shenzhen.json              # 城市主数据 —— ★唯一真源，人工/脚本可改
│   └─ ...
├─ credits/
│   └─ shenzhen.md                # 人类可读的来源清单（★自动生成，便于 review）
└─ _generated/                    # ★全部自动生成，禁止手改，可加 .gitattributes 标 linguist-generated
    ├─ search-index.json          # 倒排索引（跨城市搜索）
    ├─ image-health.json          # 月度图片巡检结果（不污染主数据）
    ├─ sitemap.xml                # SEO 站点地图（构建后生成）
    └─ manifest.json              # 城市清单 + 校验和 + 更新时间
```

**铁律**：`cities/` 是唯一需要人碰的地方；凡是能算出来的（索引、清单、来源汇总、巡检结果）一律脚本生成，不进人工维护范围。

---

## 三、格式统一的三道闸门

### 闸门 1：Schema 单一真源

```
shared/schema.ts   ← Zod，前端运行时校验
shared/schema.py   ← Pydantic，脚本产出校验
        ↑ 两者字段一一对应，CI 里跑一次字段 diff，不一致直接失败
```

### 闸门 2：版本与迁移

每个 JSON 顶部带 `schemaVersion`：

```json
{ "schemaVersion": 1, "id": "shenzhen", ... }
```

schema 破坏性变更时：**必须**同时提交 `scripts/migrations/v1_to_v2.py`，能批量升级 `data/cities/*.json`。禁止"直接改字段让老数据失效"。

### 闸门 3：CI 强校验（PR 阶段）

`.github/workflows/validate.yml`，任何 PR 触碰 `data/` 就跑：

```bash
cd web                                 # 应用工程在 web/（data/ 在仓库根，脚本自己按上一层找）
python scripts/validate.py --strict    # Zod/Pydantic 全量校验
python scripts/check_sources.py        # 溯源完整性：无 source 的字段直接 fail
npm run data:build                     # 重建索引，若产物与提交的不一致 → fail（防忘生成）
```

**校验不通过不允许合并** —— 这是"格式统一"唯一的可靠保障，靠人自觉没用。

常用命令（`package.json`）：

```json
"scripts": {
  "data:validate": "python scripts/validate.py",
  "data:build":    "python scripts/build_index.py",
  "data:credits":  "python scripts/gen_credits.py",
  "harvest":       "python scripts/run.py"
}
```

---

## 四、溯源规范：每个数据都能跳回来源

> 你的要求：「什么数据来自什么地方，肯定都要有对应的跳转」。落到数据层就是**字段级溯源**。

### 4.1 三类溯源

| 类型 | 载体 | 必填 | UI 呈现 |
|------|------|------|---------|
| POI 整体来源 | `poi.sources[]` | ✅ ≥1 条 | 详情页「数据来源」列表，每条可点 |
| **事实字段来源** | `xxxRef: number` 指向 `sources` 下标 | 关键字段必填 | 字段旁角标 `¹`，点击跳对应来源 |
| 图片来源 | `image.credit.sourceUrl` | ✅ 必填 | 图片下方署名 + 可点链接 |
| 城市级来源 | `city.credits` | ✅ | 城市页底部 + 独立 `/credits` 页 |

### 4.2 字段级溯源示例

```json
{
  "name": "世界之窗",
  "practical": {
    "ticket": "约 220 元起",
    "ticketRef": 0,
    "openHours": "09:00-22:00",
    "openHoursRef": 1,
    "duration": "建议 4-6 小时"
  },
  "sources": [
    { "title": "景区官网票价页", "url": "https://…", "kind": "official", "fetchedAt": "2026-09-17" },
    { "title": "XX 文旅局公告",   "url": "https://…", "kind": "gov",      "fetchedAt": "2026-09-17" }
  ]
}
```

**只给"事实型字段"加 Ref**（票价、开放时间、等级、地址、评分）；描述性文案（`description`、`highlights`）不加，避免数据臃肿。原则是：**可能被质疑的才需要出处**。

### 4.3 UI 跳转落点

| 位置 | 展示 |
|------|------|
| POI 详情 · 票价行 | `约 220 元起 ¹` → 角标链接到 sources[0].url |
| POI 详情 · 底部 | 「数据来源」区块：标题 + 类型徽章 + 抓取日期 + 外链图标 |
| 图片下方 | `图：作者名 / Unsplash`（非 CC 协议可不强制署名，但**建议一律显示**，成本极低） |
| 城市页底部 | 本城来源汇总 + 图片版权汇总 |
| 独立页 `/credits` | 全站来源与版权总表，按城市分组，可搜索 |
| 首页页脚 | 「数据来源与版权」入口 + 地图服务商署名 |

**所有外链统一 `target="_blank" rel="noopener noreferrer"`。**

### 4.4 自动生成来源清单

`scripts/gen_credits.py` 输出 `data/credits/{city}.md`：

```markdown
# 深圳 · 数据来源

## 文本内容
| POI | 字段 | 来源 | 类型 | 抓取日期 |
|-----|------|------|------|---------|
| 世界之窗 | 票价 | [景区官网](https://…) | official | 2026-09-17 |

## 图片版权
| 图片 | 作者 | 协议 | 来源 |
|------|------|------|------|
| 世界之窗-01 | Jane Doe | Unsplash License | [链接](…) |
```

作用：PR review 时一眼看清"这次加了哪些来源"，也让合规审计有据可查。

---

## 五、图片：国内可达性（实测）

> 项目**纯开源非商用**，所以 Unsplash / Pexels / CC 协议全部可用；**唯一卡点是国内能不能打开**。以下为 2026-09 在深圳电信网络的实测：

| 图源 | 实测结果 | 定位 |
|------|---------|------|
| 百度百科 `bkimg.cdn.bcebos.com` | 200 / **0.31s** | 中文具体景点兜底，最快 |
| Unsplash `images.unsplash.com` | 200 / **0.43–0.84s** | **主图源** |
| jsDelivr `cdn.jsdelivr.net` | 200 / 0.51–0.95s | 镜像模式 CDN，快 |
| Pexels `images.pexels.com` | 200 / **2.3–3.0s** | 补充源（偏慢，控制数量） |
| wsrv.nl 代理 | 服务器可达 1.5s，取源失败 | 待验证，暂不依赖 |
| **Wikimedia 直连** | **超时 25s（000）** | ❌ 国内不可用，仅境外归档 |

### 三级降级（保证国内不会白屏）

```
1 级  具体实景图（Unsplash → Pexels 搜具体名，中英双语各试）
2 级  同类氛围图（"{品类} {城市}"，如 "hotpot Chengdu"）
3 级  风格化 SVG 占位卡（分类色 + POI 名，零外部请求）
```

前端 `ImageLazy`：`onError` → 切下一张候选 → 全挂渲染占位卡。**绝不留破图。**

### 可选「镜像模式」（默认关闭）

给想用 Wikimedia 等境外内容的场景留个开关：`scripts/mirror_images.py` 把图片拉到 `assets/` 分支，前端通过 jsDelivr 引用（实测 0.5–1s）。
代价：仓库体积增大（建议 LFS 或独立分支）。
**默认关闭** —— 主方案靠国内可达图源，不引入这层复杂度。

---

## 六、更新机制

### 6.1 三类更新

| 类型 | 触发 | 流程 | 自动合并 |
|------|------|------|---------|
| 内容纠错 / 新增 POI | 人工改 `data/cities/*.json` | PR → CI 校验 → 人审合并 | ❌ |
| 内容刷新 | 手动 / 季度定时 | `refresh-data.yml` → 重跑采集 → PR | ❌ |
| **图片巡检自愈** | 每月 1 号 | `check-images.yml` → HEAD 扫全部 → 404 用 `query` 重搜补图 → PR | ❌ |

> 内容类改动一律**不自动合并**：来源抽风可能写进脏数据，必须人过一眼。

### 6.2 图片自愈闭环（核心）

每张图必存 `query` 字段（"这张图想表达什么"），于是失效后能全自动补：

```
月度 Actions → HEAD 全量 URL
  200 → 记入 image-health.json（status=ok）
  404 → 用 query 重搜（Unsplash → Pexels → 百科）→ 替换 url/credit → 开 PR
  搜不到 → 标记 needs_manual，前端自动走降级
```

**两个刻意的设计**：

1. **巡检状态不写回主数据**。`status` / `checkedAt` 落到 `data/_generated/image-health.json`（key 为 `{cityId}/{poiId}/{imageIndex}`）。
   理由：主数据是"内容"，巡检结果是"运维数据"。混在一起会让每次巡检都产生几十处无意义 diff，PR 噪音大、还容易和内容改动撞车。
2. **前端不依赖巡检状态**。`ImageLazy` 的 `onError` 兜底是实时的、必然生效的；构建期状态只是给维护者看的报表。

前端还有运行时兜底：主图挂 → 下一张候选 → 占位卡。

> ⚠️ Actions 跑在境外，**检测不到"国内不可达"**，只能发现 404。所以图源选择阶段规避境外源是第一道防线，巡检是第二道。

### 6.3 数据变更 → 站点重建（Netlify）

SSG 下，数据改动**必须重新构建**才会体现在 HTML 里（这是 SSG 与 SPA 的本质区别）：

| 触发路径 | 链路 | 延迟 |
|---------|------|------|
| 人工改数据并 push | push → Netlify 自动构建 → 部署 | 约 1–3 分钟 |
| Actions 自动开 PR | PR → **Deploy Preview**（可直接点开看效果）→ 人审合并 → 主分支构建 | 取决于人工 |
| 定时任务提交主分支 | 提交 → 调 Build Hook → 构建 → 部署 | 约 1–3 分钟 |

**Deploy Preview 是换到 Netlify 后最大的收益**：数据类 PR 会自动生成可访问的预览站，review 时不用脑补 JSON 改动效果，点开就能看。
（注意：预览站与生产共用同一个 key，Referer 白名单需覆盖预览域名。地图展示本身不计量，不构成配额压力。）

> 设计取舍：SSG 换来 SEO，代价是"数据改了要等构建"。当前内容更新是季度级、图片巡检月度级，延迟完全可接受。若将来要做真正的实时，才需要重新评估 SSR 或客户端 fetch。

### 6.4 Schema 迁移

`schemaVersion` 变更 → 提交 `scripts/migrations/v{n}_to_v{n+1}.py` → CI 校验版本一致性 → 批量升级所有城市文件后合并。

---

## 七、查询方案（快速 + 通用）

| 场景 | 方案 | 复杂度 |
|------|------|--------|
| 城市内筛选/排序 | 内存 `filter` + `sort`，46 条 < 1ms | O(n)，够用 |
| 城市内搜索 | 名称 / tags / 描述模糊匹配，防抖 300ms | O(n) |
| **跨城市搜索** | 构建期生成 `search-index.json`（倒排：token → [cityId, poiId]），约 50KB | O(1) 命中 |
| 地图点位 | 直接遍历 `visiblePois`（≤60 个）；超 100 再按视口裁剪 | O(n) |
| 数据加载 | 预渲染期 loader 直读 JSON；客户端 `import.meta.glob` code-split 懒加载，切页不重复请求 | — |
| 首屏 | 预渲染 HTML 直接带内容（无需等 JS），爬虫与用户同时受益 | — |

**为什么不用 SQLite 做全文检索**：300 条数据自研倒排索引（几 KB）+ 简单分词就够，引入 1.5MB wasm 反而拖慢首屏。真到了那个量级再按第一节的触发条件升级。

### 前端逻辑通用性的保障

- 四类内容（景点/美食/网红/特色）**共用一套 `Poi` 结构**，只靠 `category` 区分 → 卡片、详情、地图图层全是一套代码
- 城市差异只体现在 `data/`，**前端零 `if (city === 'shenzhen')`**
- 新增城市 = 加 JSON + 跑 `data:build`，**不改一行前端代码**

---

## 八、落地清单

| # | 任务 | 产出 |
|---|------|------|
| D1 | 定稿 `shared/schema.ts` + `schema.py`（含 `xxxRef` 溯源字段） | schema v1 |
| D2 | `scripts/validate.py`（Zod/Pydantic + bbox + 溯源完整性） | CI 闸门 |
| D3 | `scripts/build_index.py`（cities.index + search-index + manifest） | 构建期产物 |
| D4 | `scripts/gen_credits.py`（来源清单 md） | 可审计 |
| D5 | `scripts/gen_sitemap.py`（扫描 `dist/` 或复用 `prerender()` 路由表） | SEO 收录 |
| D6 | `.github/workflows/validate.yml`（PR 强校验） | 格式统一保障 |
| D7 | `.github/workflows/check-images.yml`（月度自愈 → `image-health.json`） | 图片保鲜 |
| D8 | `.github/workflows/refresh-data.yml`（手动/季度 + Build Hook） | 内容刷新 |
| D9 | 前端 `SourceLink` / `SourceBadge` / `credits` 页 / 图片署名组件 | 溯源可见 |
| D10 | `netlify.toml` + 环境变量 + Build Hook + Deploy Preview | 部署链路 |
