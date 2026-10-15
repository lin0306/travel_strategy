# 04 · 内容采集与数据维护（开发期产出 + Actions 可选刷新）

> **原则**：内容**在开发期就生成好**，按城市整理进 `data/` 目录，随仓库走版本管理。运行时**不做任何实时抓取**。
> **图片**：一律用**外链直链**，不下载、不落盘、不在仓库里存二进制。
> **行政区划聚合（全国三级区划计数 + 边界）搬进构建期**，运行时只做查表（见第七节）。
> ⚠️ **通勤时间矩阵已移出构建期**（2026-10-06 决策）—— 改**运行时算**，本文件第六节与 step6 脚本已成遗留，
> 详见 [README 决策变更记录](./README.md) 与 [09 文档](./09-itinerary-planner.md) 顶部告示。
> **将来要"实时"**：用 GitHub Actions 定时重跑同一套脚本 → 自动开 PR，人工确认后合并。

---

## 一、整体形态

```
开发期（本地 / AI 助手执行）                     仓库里最终存在的东西
────────────────────────────                    ──────────────────────
① 联网搜索候选 POI          ┐
② 抽取改写文案（含细类/适游群体）│
③ 地理编码拿 GCJ-02 坐标     ├──▶  data/cities/{cityId}.json     ← 纯文本，可 review
④ 取 Unsplash/Pexels 外链   │     data/cities.index.json
⑤ Zod 校验 + 人工抽检       │     data/credits/{cityId}.md
⑥ ~~通勤矩阵（距离+时长）~~  │     ⛔ 已移出构建期 —— 改运行时算（见第六节）
⑦ 行政区划树 + 聚合计数      ┘     data/_generated/district-tree.json ★ 三级下钻的地基
        ↑
   腾讯位置服务 WebService API：地理编码 + 区划服务 + 边界（★ 距离矩阵只在运行时用于算通勤）

                                   图片只是 JSON 里的 URL 字符串，零文件维护

可选：GitHub Actions（手动/季度触发）→ 重跑 ①②③④⑤⑥⑦ → 自动 PR → 人审合并
                                    ↓ 合并到主分支
                                Netlify Build Hook 自动重建 → 站点更新
```

> 坐标与底图**同源同坐标系**（腾讯底图与腾讯 WebService 都是 GCJ-02），因此**前端 JSAPI 与构建期脚本共用一套坐标，无需任何转换**；也**不需要自己准备行政区划 GeoJSON** —— 省 / 市 / 区边界全部来自腾讯 District 服务（见第七节与 10 文档第九节）。
> 从高德改回腾讯时（本方案第 3 次反转），**已有 POI 坐标可直接复用**（高德与腾讯同为 GCJ-02），只需：① 重跑第 ⑥ 步（矩阵接口不同）；② 跑一次第 ⑦ 步生成区划树（见 07 文档 9.2）。

---

## 二、数据来源分级（白名单）

| 级别 | 类型 | 举例 | 用于 |
|------|------|------|------|
| A | 政府 / 文旅局 / 景区官网 | xx.gov.cn、市文化广电旅游体育局 | 票价、开放时间、地址、景区等级 |
| B | 百科 | 维基百科、百度百科 | 背景、历史、地理概况 |
| C | 旅游平台 | 携程 / 马蜂窝 / 去哪儿景点页 | 亮点、用时、评分（**改写，不整段照抄**） |
| D | 社交 | 小红书、抖音话题 | **只用于发现网红点位线索**，不用于陈述事实 |
| E | 媒体 | 官媒 / 地方媒体旅文报道 | 新开业、季节性活动 |

- 每个 POI **至少 2 个不同级别来源**交叉验证；
- 优先近 12 个月内容，抓取时记录 `publishedAt` 与 `fetchedAt`；
- 请求纪律：统一 UA、1–3s 随机延迟、指数退避重试 3 次、单域名并发 ≤ 1、遵守 robots.txt；
- 付费墙 / 需登录页面直接跳过，标记 `needs_manual`。

---

## 三、六步流水线（开发期执行）

| 步骤 | 输入 | 输出 | 关键约束 |
|------|------|------|---------|
| 1 搜索 | 城市名 + 四类关键词 | 候选清单（名称 + 来源 URL） | 关键词：`{城市} 必去景点 2026`、`{城市} 特色美食 老字号`、`{城市} 网红打卡 新`、`{城市} 文旅局 景区名录` |
| 2 抽取 | 正文纯文本 | 草稿 POI JSON | **必须改写**，禁止整段复制；价格/时间不确定就留空或写"约/起"；每条回填 `sourceUrl`；**必须产出 `subtype`（细类）与 `audience`（适游群体）**，判定依据只能来自来源页面的客观描述；若来源给出"建议游玩时长"，结构化成 `durationMinutes`（见第六节 6.6） |
| 3 地理编码 | POI 名 + 城市 | GCJ-02 经纬度 + 标准地址 + 区县 | 走腾讯**地理编码 WebService**（开发期脚本用 WebService key，不进运行时）。⚠️ 坐标是 `lat,lng` **纬度在前**；结果里的 `adcode` 要一并回填到 city（见 [07](./07-map-provider.md) 第六节） |
| 4 取图 | POI 名 + 英文关键词 | 外链 URL 数组 + credit | 见第四节 |
| 5 校验 | 草稿 JSON | 正式 JSON + 质量报告 | 见第八节 |
| ~~**6 通勤矩阵**~~ | ~~POI 坐标列表~~ | ~~`transit` 字段~~ | ⛔ **已废弃** —— 改运行时算，不预存（见第六节） |
| **7 区划树 + 聚合计数** | 全国 District 数据 + 各城 JSON | `district-tree.json`（三级区划 + 边界 + 每级 POI 计数） | ★ 见第七节。**必须在 6 之后**（要读所有城已入库的 POI）。首次跑通即生成全国 34 个省级单位（含台湾/港澳），未收录的市计数为 `null` |

### 第 3 步细节（位置准确性的关键）

```
GET https://apis.map.qq.com/ws/geocoder/v1/?address={poi_name}&key={TMAP_WEB_KEY}
    &policy=0                          ← 0 允许附近 POI 召回（更易命中具体点位）
    &region={city_name}
→ result.location = { lat, lng }       ← ⚠️ 腾讯返回对象是 lat/lng 分开的，纬度在前
  result.address_components = { province, city, district, street, street_number }
  result.ad_info = { adcode, city_code, ... }
```

- 精确名搜不中 → 退化为「POI 名 + 区县」→ 再不行用官方地址走地址解析；仍失败则标记 `needs_manual_poi`，**不入库**

> ⚠️ **腾讯地理编码是"一对一"接口**（一次一个地址），没有高德那种 `address=a|b|c&batch=true` 的批量模式。因此地理编码这一步的**请求数 = POI 数**（~46/城），靠 `scripts/.cache/geocode.json` 缓存避免重复计费即可，占总配额比例很低（见 07 文档第五节）。
- 用返回的 `ad_info.city_code` / `district` 与目标城市比对 —— 命中异地同名 POI 时直接判失败
- 坐标必须落在城市 bbox 内（⚠️ 腾讯返回 `lat,lng`，落库前转成本项目 GeoJSON 惯例的 `lng,lat`）
- ⚠️ **`region` 参数必须显式传城市名**：不传会做全国范围检索，容易命中同名异地 POI（如"人民公园"全国都有）
- 结果缓存到 `scripts/.cache/geocode.json`，同一 POI 不重复计费
- 💡 顺带产出：`ad_info.adcode` 就是这座城市下钻要用的键，**在第 3 步一并回填 `adcode` / `provinceAdcode`**，省得第 7 步反查

---

## 四、图片策略：全部外链，零文件维护

### 4.0 先说结论：为什么 Wikimedia 不能当主源

| 核查项 | 结论 |
|--------|------|
| 热链有效期 | **URL 不含签名、不会过期**，本身是永久的 |
| 国内可达性 | ❌ **不可用**。upload.wikimedia.org 的 IPv4（198.35.26.112 / 208.80.154.240）在中国大陆被封锁 + DNS 污染，媒体服务器几乎完全不可达 |
| 内容新鲜度 | 地标/古城/自然风光覆盖好；**网红新点位、新开业场馆基本没有** |

→ 所以 Wikimedia 从"第一图源"降级为**境外备用**。热链的真正风险从来不是"链接过期"，而是：① 文件被删/改名 → 404；② 平台改防盗链；③ 网络不可达（Wikimedia 正中这条）。

### 4.1 图源优先级（修订版）

| 优先级 | 图源 | 授权 | 热链政策 | 国内访问 | 用途 |
|--------|------|------|---------|---------|------|
| **1** | **Unsplash**（`images.unsplash.com`） | Unsplash License（免费商用，建议署名） | **官方强制热链**：必须用 API 返回的 `photo.urls`，禁止下载重托管 | 稳定，CDN 优化好 | 城市氛围、美食、人文、封面 |
| **2** | **Pexels**（`images.pexels.com`） | Pexels License（免费商用，建议署名 + 显著 linkback） | 允许热链 | 可访问 | 补充覆盖，支持中英文搜索 |
| 3 | **百度百科图片**（`bkimg.cdn.bcebos.com`） | **版权归原作者**，非商用需注明出处"百度百科" | 可直链（去掉 `?x-bce-process=` 参数即无水印） | 极快 | 中文具体景点的兜底补充，**必须署名** |
| 4 | Wikimedia | CC0 / CC BY / CC BY-SA | 允许热链 | ❌ 不可达 | 仅作境外归档，写入备用位 |
| — | Pixabay | Pixabay License | ❌ **禁止永久热链**（要求下载自托管） | — | **排除** |

> **Unsplash 排第一的理由**：官方明确"所有 API 使用必须热链 API 返回的 URL，不得下载重托管"—— 这跟我们"零文件维护"的目标天然一致；同时国内访问稳定。

### 4.2 三级降级：解决"具体景点没图"

新晋网红点、小众美食在免费图库里大概率搜不到，靠**三级降级**兜住体验：

```
第 1 级  该 POI 的实景图（Unsplash/Pexels 搜具体名，中英双语关键词各试一次）
   ↓ 搜不到
第 2 级  同类氛围图（搜 "{品类} {城市}"，如 "cafe Shenzhen" / "hotpot Chengdu"）
   ↓ 还是没有
第 3 级  风格化占位图（前端按分类色 + POI 名生成 SVG 卡片，零外部请求）
```

第 3 级不是"没图"，是一张设计过的品牌色卡片 —— 视觉上不塌房。

### 4.3 取图方式

**Unsplash（需 key，仅脚本期；key 永不进仓库）**

```
GET https://api.unsplash.com/search/photos?query={英文关键词}&per_page=8
Header: Authorization: Client-ID {UNSPLASH_ACCESS_KEY}
```
取 `urls.regular`（≈1080px）/ `urls.small`（≈400px）、`user.name`、`links.html`、`alt_description`。
注意：`urls` 里的 `ixid=` 参数要**原样保留**，不要手动删改。

**Pexels（需 key，仅脚本期）**

```
GET https://api.pexels.com/v1/search?query={中/英文关键词}&per_page=8
Header: Authorization: {PEXELS_API_KEY}
```
取 `src.large2x` / `src.medium`、`photographer`、`url`、`alt`。

**百度百科（无需 key，补充）**

从词条页图册取 `bkimg.cdn.bcebos.com/pic/{hash}` 链接，**去掉 `?x-bce-process=` 及其后所有参数**即为无水印原图。仅用于 Unsplash/Pexels 都搜不到的中文景点，且 `credit.attributionRequired = true`，UI 显示「图片来源：百度百科，版权归原作者所有」。

**关键词策略**：每个 POI 生成两个 `query` 存进 JSON —— 英文（"Window of the World Shenzhen"）+ 中文/品类（"深圳 主题公园"）。搜图时英文优先，中文兜底。

### 4.4 硬性规则

- ❌ **不下载、不落盘**：仓库里只有 URL 字符串，没有图片文件。
- ❌ **不抓**携程 / 马蜂窝 / 小红书 / 大众点评的图片 —— 版权不清且有防盗链。
- ❌ **不使用 Pixabay 直链**（违反其"禁止永久热链"条款）。
- ✅ 每个 POI **1 张封面 + 2–4 张配图**；城市 hero 1–3 张。
- ✅ `credit` 四字段 + `query` + `status` **缺一不可**（`query` 是自愈机制的前提）。
- ✅ 需要署名的（Unsplash/Pexels 建议署名、百科与 CC BY 系列强制署名）在详情页与页脚展示。
- ⚠️ 含**可识别人脸 / 商标 / 艺术品**的图默认不用。
- ⚠️ 前端统一走 `<ImageLazy>`：`onError` → 自动切下一张候选 → 全挂则渲染风格化占位卡（保留"查看来源"链接），绝不让破图出现。

### 4.5 JSON 里的样子

```json
"images": [
  {
    "url": "https://images.unsplash.com/photo-1506744038136-46273834b3fb?q=75&fm=jpg&w=1080&fit=max&ixid=xxx",
    "thumbUrl": "https://images.unsplash.com/photo-1506744038136-46273834b3fb?q=75&fm=jpg&w=400&fit=max&ixid=xxx",
    "width": 1080, "height": 720,
    "alt": "深圳福田 CBD 天际线",
    "query": "Shenzhen skyline Futian",
    "credit": {
      "source": "unsplash",
      "author": "Jane Doe",
      "sourceUrl": "https://unsplash.com/photos/xxxx",
      "license": "Unsplash License",
      "attributionRequired": false
    }
  }
]
```

---

## 五、数据目录（对外可复用）

```
data/                          ← 与代码解耦，任何人拿走这个目录就能用
├─ cities.index.json           城市列表（含封面 + POI 计数 + adcode + 更新时间）★脚本生成
├─ cities/
│   ├─ chengdu.json            一个城市一份，自包含 —— 唯一真源，人只改这里
│   │                          （含 pois + ★transit 通勤矩阵）
│   ├─ hangzhou.json
│   └─ ...
├─ credits/
│   └─ chengdu.md              来源清单（人类可读，便于 PR review）★脚本生成
└─ _generated/                 ★全部脚本生成，禁止手改
    ├─ district-tree.json      ★ 全国三级区划树 + 每级 POI 计数（三级下钻地基，见第七节）
    ├─ district-bounds/        ★ 边境缓存：{adcode}.json = 该区划边界点串（按需拉、可增量）
    ├─ search-index.json       跨城市倒排索引
    ├─ image-health.json       月度图片巡检结果
    ├─ transit.progress.json   通勤矩阵断点续跑进度（跑完可删）
    ├─ api-usage.json          ★ 腾讯 WebService 用量记账（按接口独立、每日重置，见 07 文档第三节）
    └─ manifest.json           校验和 + 更新时间
```

- 新增城市 = 往 `data/cities/` 放一份 JSON，**不改任何前端代码**：索引由脚本生成，路由由 `import.meta.glob` 自动发现（见 02 文档 4.1）；**同时把该城的 POI 计数并进 `district-tree.json`**（第 7 步）。
- JSON 用 2 空格缩进、UTF-8、LF 换行，便于 diff 与人工 review。
- `shared/schema.ts`（Zod）是唯一校验入口；开发期 `parse` 报错直接暴露脏数据。
- **边界缓存单独放 `district-bounds/`**：省 / 市边界点串体积不小，但按需拉取、很少变动，缓存后不必每次重跑第 7 步都重新下载（见第七节 7.3）。

---

## 六、通勤矩阵生成（step6_transit）⛔ 已废弃

> ⛔ **本节已随 2026-10-06 决策废弃** —— 通勤矩阵**不再在构建期生成、不再入库**。
> **原因**：62 城 × 约 1600 对 × 3 方式预存要**几百 MB**，远超"单城 ≤300KB gzip"的预算；
> 且矩阵时长是生成时刻的**快照**，一两个月后驾车时长已明显失真。
>
> - `pipeline/steps/step6_transit.py` 仍在仓库里作为**遗留实现**，但**不许跑** ——
>   `run.py` 已把 `transit` 子命令摘掉（见 `run.py:150`）。
> - `transit` 字段不再生成；本节下方提到的 `transit.progress.json`、体积预算、覆盖率验收项**均已失效**。
> - **当前实现**：通勤时长在运行时算（`web/app/common/logic/itinerary/routeOptions.ts`），带缓存 + 配额账本。
> - 残留消费点**待拆**：`cityRegistry.ts:38`/`:149`、`usePlanView.ts:208`。
> - ⚠️ `build.py` 那条「缺 transit」WARN 是**假告警**，不代表有数据缺口。
>
> 以下内容**保留作决策来由与接口知识**（腾讯矩阵的批量能力、计量口径、`status:4` 退化等仍然有用）。

---

> 这是本流水线里**唯一因"行程规划"需求新增的步骤**，也是全项目调用量最大的一步。原设计目标：**把 46×46 种通勤组合在构建期算完，让运行时零调用**。
> 完整的产品侧设计见 [09-itinerary-planner.md](./09-itinerary-planner.md) 第三节；本节只讲**怎么跑出来**。

### 6.1 三种方式、一种调用形态（腾讯矩阵统一批量）

| 方式 | 接口 `mode` | 批量能力 | 请求数/城 | 备注 |
|------|-----------|---------|----------|------|
| **驾车** | `driving` | ✅ `25×25 = 625` 对/次 | **4** | 含实时路况，与路线规划 `policy=LEAST_TIME` 同源 |
| **步行** | `walking` | ✅ 同上 | **4** | ⚠️ 起终点附近 5km 内无路时该元素 `status:4`、**无 `duration`** → 落库记 `0000` |
| **骑行** | `bicycling` | ✅ **也有批量**（腾讯优于高德之处） | **4** | 官方说明不考虑路况；上限 500km |
| **公交 / 地铁** | — | ❌ 不预计算 | **0** | 时效性最强（地铁新开/公交改线）+ 无批量接口 → 改为运行时按需算 |

> 💡 **这是本方案回腾讯的核心原因**：三种方式**全部支持批量矩阵**，请求数从"骑车 1,035 次一对一"降到"3 方式 × 4 请求 = 12 次"。高德的 `/v3/distance` 没有骑行批量，骑行只能一对一 —— 这是选型胜负手（见 [07](./07-map-provider.md) 第五节）。

```
构建期用量（46 POI，三种方式）：
  3 方式 × 4 请求（46×46 按 25×25 分块） = 12 次请求 ≈ 7,500 计算次数 / 城
  矩阵接口按"计算次数"计费、10,000 计算次数/日（日重置，不累积）
  → 单城一天内可跑完；阈值裁剪后 ≈ 3,900 → 一天可跑 ~2 城
```

> 注意"请求数"与"计算次数"是两回事：矩阵接口按 **`from 数 × to 数`** 计费。12 次请求因为分块有冗余格子，实际约 7,500 计算次数（详见 07 文档 5.1/5.2）。

### 6.2 核心实现

```python
# scripts/step6_transit.py（要点）
import math, json, time
from pathlib import Path

PROGRESS = Path('data/_generated/transit.progress.json')   # ★ 断点续跑
LEDGER   = Path('data/_generated/api-usage.json')          # ★ 用量记账

# 直线距离阈值：超出就不算该方式（省钱 + 让"不适用"的表达更清楚）
THRESHOLD = {'driving': 0, 'walking': 3000, 'bicycling': 8000}
CHUNK = 25                                                 # 腾讯矩阵单边上限 25（25×25=625）

def haversine(a, b):
    """直线距离，纯本地计算，零调用 —— 用来做阈值裁剪。a/b = [lng, lat]"""
    R = 6371000
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dp, dl = p2 - p1, math.radians(b[0] - a[0])
    h = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2 * R * math.asin(math.sqrt(h))

def matrix(origins, dests, mode):
    """腾讯距离矩阵：from×to ≤ 625 且单侧 ≤ 50。
       ⚠️ 坐标是 lat,lng（纬度在前）—— 写反了结果全错且不好查。"""
    resp = GET('https://apis.map.qq.com/ws/distance/v1/matrix', {
        'mode': mode,                                       # driving | walking | bicycling
        'from': ';'.join(f'{o[1]:.6f},{o[0]:.6f}' for o in origins),   # ← lat,lng
        'to':   ';'.join(f'{d[1]:.6f},{d[0]:.6f}' for d in dests),
        'key': TMAP_WEB_KEY,
    })
    count_usage(LEDGER, f'matrix_{mode}', len(origins) * len(dests))   # 按"计算次数"记账
    return [[norm_element(e) for e in row['elements']] for row in resp['result']['rows']]

def norm_element(e):
    """status!=0 或缺失 duration → None（落库为 0000，UI 显示"不适用"）。
       例：步行的相邻点对超 5km 时腾讯退化为直线且不给 duration。"""
    if e.get('status') != 0 or 'duration' not in e:
        return None
    return int(e['distance']), int(e['duration'])          # ⚠️ duration 单位=秒（路线规划接口是分钟）

def build_matrix(pois, city_id):
    n = len(pois)
    out = {m: {} for m in THRESHOLD}

    for mode in THRESHOLD:
        for i0 in range(0, n, CHUNK):
            for j0 in range(0, n, CHUNK):
                si = list(range(i0, min(i0 + CHUNK, n)))
                sj = list(range(j0, min(j0 + CHUNK, n)))
                rows = matrix([pois[k] for k in si], [pois[k] for k in sj], mode)
                for r, gi in enumerate(si):
                    for c, gj in enumerate(sj):
                        if gi <= gj: continue                          # 只留上三角
                        if not in_range(pois[gi], pois[gj], mode):     # 阈值裁剪 → 记 0000
                            out[mode][(gi, gj)] = None
                        else:
                            out[mode][(gi, gj)] = rows[r][c]
            save_progress(PROGRESS, city_id, mode, i0)                 # ★ 每块落盘

    return encode_channels(out, n=n)
```

### 6.3 四条硬约束

| # | 约束 | 为什么 |
|---|------|--------|
| 1 | **必须在 step3 地理编码之后跑** | 需要最终坐标才能算通勤。顺序错了会算出一堆无用数据 |
| 2 | **采样时段选工作日上午** | 驾车矩阵 `mode=driving` 含实时路况（与路线规划 `policy=LEAST_TIME` 同源），上午最贴近旅游出行典型时段。采样时间要写进 `sampledAtLabel` |
| 3 | **断点续跑** | 分块跑，中途失败重跑整城代价高。每跑完一行分块就落盘 `transit.progress.json` |
| 4 | **用量记账 + 单城上限告警** | 累计**计算次数**写进 `_generated/api-usage.json`；**单城超过 15,000 计算次数直接中止并告警** —— 防脚本 bug（比如分块写错导致重复全量跑）把当日 10,000 的配额打满 |

### 6.4 幂等与刷新策略

| 场景 | 行为 |
|------|------|
| `transit` 已存在且 `generatedAt` 在 **180 天内** | **跳过**（避免重复计费） |
| POI 集合发生变化（增删改） | 必须重算（`poiIndex` 与 `pois` 的顺序/集合必须严格一致） |
| 定期刷新 | ❌ **不做**。时长是快照，刷新频率高没有意义，只是白耗配额 |
| 手动触发 | GitHub Actions 加一个 `force=true` 输入，允许强制重算 |

### 6.5 顺带补的数据：`durationMinutes`

行程规划要算"停留多久"，但 POI 数据里的 `practical.duration` 是自然语言（"建议 3-4 小时"），**不能参与计算**。所以在 step2 抽取阶段就要多做一个动作：

```python
# step2_extract.py 里的抽取提示词要点
"""若来源页面给出'建议游玩时长'，必须**同时**产出两个字段：
   - duration:       原样引用的自然语言，如 '建议 3-4 小时'
   - durationMinutes: 结构化的 [最短, 最长]（分钟），如 [180, 240]
   两者缺一不可；来源没给就都留空，禁止编造。"""
```

**取不到怎么办**：靠分类默认值兜底（写在配置里，不是硬编码在组件里）：

| 分类 | 默认停留 |
|------|---------|
| `scenic` 旅游景点 | 120 min |
| `food` 特色美食 | 60 min |
| `hotspot` 网红打卡 | 45 min |
| `culture` 城市特色 | 45 min |

> ⚠️ **默认值必须在 UI 上显式标出**（「默认 120 分钟 · 点击修改」），让用户知道这是系统猜的，不是事实。见 09 文档 4.2。

---

## 七、区划树与聚合计数（step7_district）

> 三级下钻（全国 → 省 → 市，见 [10 文档](./10-map-drilldown.md)）需要两样构建期产物：**① 全国三级区划的结构**（省 / 市 adcode、名称、中心点、边界）；**② 每级区划的 POI 计数**（"四川 46 个景点"）。两者都在这一步生成，运行时只查表。

### 7.1 数据来源：腾讯 District 服务（唯一合法来源）

```
GET https://apis.map.qq.com/ws/district/v1/list
    ?key={TMAP_WEB_KEY}
→ result[0] = 全国一级（省）列表；result[1..] = 按 cidx 切分的下级数组

GET https://apis.map.qq.com/ws/district/v1/getchildren?id=510000&get_polygon=1
    ?key={TMAP_WEB_KEY}
→ 四川省 → 各市（含 adcode、name、location、polygon 边界点串）

GET https://apis.map.qq.com/ws/district/v1/search?keyword=成都&get_polygon=1
→ 关键词命中单个区划（补漏用，如直辖市/港澳特例）
```

每个区划返回：`id`(adcode) / `name` / `fullname` / **`location`(中心点，直接用作计数标注锚点，不用自己算质心)** / `level` / `polygon`(需 `get_polygon=1`) / `cidx`。

**adcode 规则**：前 2 位 = 省 → 中 2 位 = 市 → 后 2 位 = 区县。特例：直辖市与港澳省级下直接是区级（无二级结构）；省直辖县第 3、4 位为 90。

> 🚨 **合规红线**：边界**只能来自 District 服务**。绝对禁止用第三方 GeoJSON 画中国地图 —— 涉及台湾、藏南、南海诸岛的表达，第三方数据极易出错且违反《地图管理条例》。**必须包含全部 34 个省级单位**（含中国台湾 / 中国香港 / 中国澳门）。详见 [10 文档](./10-map-drilldown.md) 第九节。

### 7.2 聚合计数怎么算

```python
# scripts/step7_district.py（要点）
tree = fetch_district_tree()          # 全国三级：省 → 市（含直辖市 / 港澳特例）

# ① 先按 adcode 汇总已入库城市的 POI 计数
counts = {}                           # adcode → poiCount
for city_json in glob('data/cities/*.json'):
    city = load(city_json)
    counts[city['adcode']] = len(city['pois'])        # 市级计数

# ② 市计数向上滚到省（省 = 其下所有市之和）
for prov in tree.provinces:
    prov['poiCount'] = sum(counts.get(c['adcode'], 0) for c in prov.cities)
    for c in prov.cities:
        # ★ District 树里有、但 data/cities 里没有 → null（= 待收录，绝不是 0）
        c['poiCount'] = counts.get(c['adcode'])       # None 表示待收录
```

**关键：`null` ≠ `0`。** 没有城市详情数据的市，计数是 `null`（前端渲染成灰色虚线"待收录"）；真收了但一个 POI 都没有，才是 `0`。二者在 UI 上完全不同（见 10 文档第六节）。

### 7.3 边界缓存（按需拉 + 可增量）

| 层级 | 边界 | 策略 |
|------|------|------|
| 全国（省级轮廓） | 34 个省级单位 polygon | **一次拉全，落 `district-bounds/` 缓存**，随 `district-tree.json` 一起提交 |
| 省（市级轮廓） | 该省各市 polygon | 首次进入该省时拉，缓存到 `district-bounds/{provinceAdcode}.json` |
| 市（区县轮廓） | 该市各区 polygon | 当前需求**不画区县**，暂不拉；将来要再加 |

- 边界点串体积不小（省级全国约几百 KB），**不必每次重跑都重新下载** —— 命中缓存即跳过（区划边界极少变动，与"每月巡检图片"不同）。
- `district-tree.json` 存**结构与计数**（轻量）；`district-bounds/*.json` 存**几何**（重）。分开是为了让"改计数"不必重下边界。运行时下钻前端命中缓存，不重复拉（见 03 文档 11 节）。

### 7.4 幂等

| 场景 | 行为 |
|------|------|
| 已有 `district-tree.json` 且区划未变 | 只重算计数（本地读城市 JSON，**零 API 调用**） |
| 新增城市 | 重算计数 + 若该省边界未缓存则拉一次 |
| 首次运行 | 拉全国省级边界 + 全省市级结构（约 34 次 `getchildren`，一天内轻松跑完） |

---

## 八、质量校验

任一不通过 → POI 不入库，写进 `REPORTS/{city}-quality.md`：

| 校验 | 规则 |
|------|------|
| Schema | `CitySchema` / `PoiSchema` 全字段通过（~~`CityTransitMatrixSchema`~~ ⛔ 已随矩阵取消） |
| 坐标 | GCJ-02 + 落在城市 bbox + 与最近邻 ≥ 30m |
| **类型一致性** | `subtype` 在枚举内，且 `SUBTYPE_CATEGORY[subtype] === category`（不一致即配置错误） |
| **适游群体** | `audience` ≥ 1 项、不重复，且每项都能溯源到 `sources[]` 的客观描述（**禁止凭印象打标**）；`accessible=true` 必须能溯源到无障碍说明 |
| **行政编码** | `adcode` / `provinceAdcode` 为 6 位数字，且能在 `district-tree.json` 里查到（查不到 = 下钻断链） |
| 内容 | `description` ≥ 80 字、`highlights` ≥ 2、`summary` ≤ 80 字、无跨 POI 重复（相似度 < 0.8） |
| 图片 | ≥ 1 张；URL 可访问（HEAD 200）；`credit` 四字段齐全；**`query` 必填**；图源不得是境外不可达的主机（Wikimedia 仅允许出现在备用位） |
| 来源 | ≥ 1 条可访问，`fetchedAt` 存在 |
| 表达 | 含价格/营业时间的字段必须带"约 / 起 / 以官方为准" |
| 合规 | 无敏感坐标、无禁区、无编造的精确价格 |
| **通勤矩阵一致性** | `poiIndex` 与 `pois` 的 id **集合与顺序完全一致**；三通道的 `distance`/`duration` 长度均 = `n(n−1)/2 × 4` |
| **通勤矩阵质量** | 驾车覆盖率（非 `0000` 的比例）**> 95%**；`duration` 无 0；`distance ÷ 直线距离` 落在 **1.0–3.0** 区间（越界说明坐标错或接口异常） |
| **矩阵元信息** | `generatedAt` 存在且为合法日期；`sampledAtLabel` 非空（缺了就无法在 UI 上如实说明"这是快照"） |
| **区划树一致性** | 每个已入库城市的 `adcode` 都能在 `district-tree.json` 里找到对应节点；计数与 `cities.index.json` 的 `poiCount` 相符 |

**人工抽检**：报告里随机抽 20% POI 列「原文链接 vs 抽取结果」对照，确认后再合并。

---

## 九、图片怎么"更新"：巡检 + 自愈（重点）

### 9.1 核心思路：不换链接，而是自动补图

热链 URL 本身**不会过期**，所以"定期换链接"是伪需求。真正要做的是**发现失效 → 自动补新图**，全链路不需要人工：

```
每月 1 号（Actions 定时）
   ↓
check_images.py  HEAD 扫描 data/ 下所有图片 URL
   ↓
┌─ 200 → 记入 image-health.json（healthy）
└─ 404/403/超时 → 记入 failed
        ↓
   用该图自带的 query 字段重新搜图（Unsplash → Pexels → 百科）
        ↓
   搜到 → 只替换主数据里的 url / credit（这是唯一会改主数据的情况）
   搜不到 → 标记 needs_manual，前端自动走降级
        ↓
补图改动进主数据 + 巡检状态写 data/_generated/image-health.json → 开 PR → 人工合并
```

> **一个刻意的分工**：主数据是"内容"，巡检结果是"运维数据"。状态若写回主数据，每月巡检都会产生几十处无意义 diff、还会和内容改动撞车。所以状态单独落 `_generated/`，主数据只在**真的要换图**时才动。

**关键设计**：每张图都存了 `query`，所以巡检脚本知道"这张图本来想表达什么"，能全自动重搜。**没有 `query` 的图不允许入库** —— 这是自愈闭环的前提。

### 9.2 巡检脚本

```python
# scripts/check_images.py（要点）
health = []                                   # ★ 巡检状态单独收集，全程不碰主数据的 status 字段
for (city_id, poi_id, idx), img in iter_images(data_dir):
    ok, code, elapsed = head_with_retry(img['url'])      # 超时 8s，重试 1 次
    record = { 'key': f'{city_id}/{poi_id}/{idx}', 'url': img['url'],
               'status': 'healthy' if ok else 'failed', 'checkedAt': today }
    if not ok:
        new = (search_unsplash(img['query']) or search_pexels(img['query'])
               or search_baike(img['query']))
        if new:
            img.update(url=new.url, thumbUrl=new.thumb, credit=new.credit)   # ★ 只换图
            record['status'] = 'healed'
        else:
            record['status'] = 'needs_manual'
    health.append(record)

write_json('data/_generated/image-health.json', summarize(health))
```

产出两份东西：`data/_generated/image-health.json`（机读全量状态）+ PR 描述里的摘要（总数 / 健康 / 自愈 / 待人工 + 逐条失效清单）。

### 9.3 两层 Workflow

**A. 图片巡检（每月自动）**

```yaml
# .github/workflows/check-images.yml
name: check-images
on:
  schedule: [{ cron: '23 4 1 * *' }]   # 每月 1 号
  workflow_dispatch:
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.13' }
      - run: pip install -r scripts/requirements.txt
      - run: python scripts/check_images.py
        env:
          UNSPLASH_ACCESS_KEY: ${{ secrets.UNSPLASH_ACCESS_KEY }}
          PEXELS_API_KEY: ${{ secrets.PEXELS_API_KEY }}
      - uses: peter-evans/create-pull-request@v6
        with:
          title: 'fix(images): 月度图片巡检自愈'
          body: |
            月度图片巡检完成。

            - 全量状态：`data/_generated/image-health.json`
            - 摘要：见本次 workflow 的 Step Summary（总数 / 健康 / 自愈 / 待人工）
          branch: chore/image-health
```

**B. 内容刷新（手动 / 可选季度定时）**

```yaml
# .github/workflows/refresh-data.yml
name: refresh-data
on:
  workflow_dispatch:
    inputs:
      city: { description: '城市 id', required: true, default: 'chengdu' }
      force_transit: { description: '强制重算通勤矩阵（默认 180 天内跳过）', type: boolean, default: false }
  # schedule:
  #   - cron: '17 3 1 1,4,7,10 *'   # 每季度首日
jobs:
  harvest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.13' }
      - run: pip install -r scripts/requirements.txt
      - run: python scripts/run.py --city=${{ inputs.city }} ${{ inputs.force_transit && '--force-transit' || '' }}
        env:
          # 腾讯：一个「WebService API」类型的 key，供地理编码 + 距离矩阵 + 区划服务
          # ⚠️ 与前端 JSAPI key 分开，便于分别统计用量（见 07 文档第七节）
          TMAP_WEB_KEY: ${{ secrets.TMAP_WEB_KEY }}
          UNSPLASH_ACCESS_KEY: ${{ secrets.UNSPLASH_ACCESS_KEY }}
          PEXELS_API_KEY: ${{ secrets.PEXELS_API_KEY }}
      - uses: peter-evans/create-pull-request@v6
        with:
          title: 'chore(data): 刷新 ${{ inputs.city }} 数据'
          body-path: REPORTS/${{ inputs.city }}-quality.md
          branch: data/${{ inputs.city }}
```

**两者都不自动合并** —— 内容类改动必须人工过一眼（防止来源抽风把脏数据写进站点）。

### 9.4 数据更新 → 站点自动重建（Netlify Build Hook）

SSG 下数据改动必须**重新构建**才会体现在 HTML 里。数据合并进主分支后 Netlify 会因 push 自动重建；若是定时任务直接提交的路径，可在 Actions 里显式触发：

```yaml
      - name: 触发 Netlify 重建
        if: steps.create_pr.outputs.pull-request-number == ''   # 仅在直接推主分支时
        run: curl -s -X POST -d '{}' "${{ secrets.NETLIFY_BUILD_HOOK }}"
```

Build Hook URL 在 **Netlify → Site settings → Build & deploy → Build hooks** 创建。
这样「Actions 改数据 → 自动 PR → 人工合并 → 自动构建 → 站点更新」形成闭环，全程不需要人碰部署。

> 三个注意点：
> ① 预览站与生产共用同一个前端 key，**域名白名单必须覆盖预览域名**，否则预览站地图会直接报错；
> ② 地图展示与采集脚本**各用一把 key**：前端 JSAPI key（配域名白名单）只用于地图展示，采集脚本的 WebService key（配 IP 白名单或 SN 签名）用于地理编码 / 距离矩阵 / 区划。腾讯**按接口独立计配额**，两者互不挤占（见 07 文档第三节）；
> ③ ⚠️ 腾讯 WebService 各接口 **10,000 次/日、每日重置**（不累积、不像高德那样只免费 1 年），采集脚本的用量记账（`_generated/api-usage.json`）要能回答「今天各接口用了多少、还剩多少」。

### 9.5 一个诚实的提醒

GitHub Actions 跑在境外机房，**能访问 Wikimedia 但检测不到"国内打不开"**。所以巡检只能发现 404/403，**发现不了网络不可达**。
→ 因此图源选择阶段就必须规避境外不可达的源（Wikimedia 已降级为备用），巡检只是第二道防线。

---

## 十、首个城市落地节奏

| 阶段 | 产出 | 验收 |
|------|------|------|
| 1 候选清单 | ~55 个候选（景点 20 / 美食 18 / 网红 12 / 特色 8） | 四类齐全，细类分布均衡（不出现某一细类为零） |
| 2 跑流水线 ①–⑤ | 草稿 JSON + 外链图片 | 入库率 ≥ 70%；每条都有 `subtype` + `audience` |
| 3 人工复核 | 修坐标、补图、改文案、核对适游群体 | ≥ 40 个 POI，每 POI ≥ 3 图；适游标签均可溯源 |
| ~~**4 通勤矩阵**~~ | ⛔ **已废弃**（改运行时算，采集期不产出 `transit`） | ~~驾车覆盖率 > 95%；矩阵 gzip < 15KB~~ |
| **5 区划树** | `district-tree.json` + 省级边界缓存 | 全国 34 个省级单位齐全（含中国台湾 / 中国香港 / 中国澳门）；四川 = 46，其余省 `null`（待收录） |
| 6 地图联调 | 点位落图 + 通勤连线 + 三级下钻 | 腾讯矢量底图上抽查 5 个点位与实地一致；全国→四川→成都三级下钻可点通；**卫星底图确认该城市影像分辨率与时效性**（见 03 文档 M11） |
| **7 行程验收** | 排一天的行程 | 时间链数值合理；拖拽换序后时间实时变化；六种通行方式都能给出时长；⚠️ **断网时降级为估算并明确标注「估算」**（不再是"断网仍可用"） |
| 8 SEO 验收 | `npm run build` 产物 | `dist/city/{id}/index.html` 内能 grep 到正文与 `<title>`；每 POI 有独立 HTML |
