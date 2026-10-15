# 01 · 总体架构设计

## 一、产品目标

构建一个介绍**中国城市旅游攻略**的前端站点。

**地图是主界面**：默认打开是**中国全图**，展示各省已收录多少个景点；点击某省进入**省地图**（看各市有多少个景点），再点某市进入**城市地图**，把该市的景点撒在图上。景点按**细类**着色（自然景观 / 博物馆 / 古迹 / 公园 / 本地菜 / 小吃 / 咖啡馆 / 拍照机位 …），一眼能区分类型；每个景点除了基础信息，还标注**适合哪类人群**（独游 / 情侣 / 亲子 / 朋友 / 家庭 / 长辈）以及是否**无障碍友好**。三级下钻的边界与计数全部来自腾讯区划服务与构建期预计算（详见 [10 文档](./10-map-drilldown.md)）。

在此之上提供**行程规划**：用户自己定住哪儿、自己挑景点和餐厅、自定顺序，系统负责**算出通勤时间**并排出时间链；六种通行方式（驾车 / 打车 / 公交 / 地铁 / 骑行 / 步行）都要给出**多条备选路线**，以应对堵车等情况。

### 目标与非目标

**Goals**
- G1 用户在地图上直观看到所有点位分布，点击即出详情
- G2 文字与图片内容真实、有出处、较新（每条记录 `fetchedAt` 与 `sourceUrl`）
- G3 按分类快速筛选（**大类**：景点 / 美食 / 网红 / 特色；**细类**：自然景观 / 博物馆 / 古迹 … 共 12 个，决定地图点位颜色）
- G4 首屏快：地图可用 + 关键内容秒开，图片懒加载
- G5 新增城市 = 跑一次脚本 + 加一份数据，**不改前端代码**
- G6 **被搜索引擎收录**：每个城市页、每个 POI 详情页都有独立 URL 与预渲染 HTML
- G7 开源可复现：clone 后装上依赖就能跑，数据层与代码层解耦
- **G8 行程规划**：用户可定**住宿点**（支持中途换住宿）、按天**挑选点位**、**自定顺序**，系统算出每段通勤时长与全天时间链（见 [09](./09-itinerary-planner.md)）
- **G9 通勤时间运行时算**：★ **2026-10-06 决策，已从"构建期预计算矩阵"改为运行时请求图商算**
  （预存要几百 MB 且快照会失真）—— 原表述"运行时零 API 调用"**只对区划计数成立**，通勤时长是例外
- **G10 三级地图下钻**：全国 → 省 → 市，逐级展示景点数量并下钻（见 [10](./10-map-drilldown.md)）
- **G11 点位有类型与适游信息**：细类决定颜色，`audience` 标注适游群体，`accessible` 标注无障碍友好
- **G12 六种通行方式 + 多路线备选**：驾车 / 打车 / 公交 / 地铁 / 骑行 / 步行，且路线可选（考虑堵车）

**Non-goals（本期明确不做）**
- 不做用户系统、评论、收藏同步、后端 API、数据库
- 不做实时数据（票价实时核销、实时人流、实时天气）
- 不做在线交易、门票预订（"复制地址 / 跳转地图 App"足够）
- 不做多语言（保留 i18n 结构但不实现）
- **不做行程自动排序优化（TSP / 2-opt）**：顺序由用户决定。且缺营业时间窗与预约时段数据，"最优"不可信 —— 详见 [09](./09-itinerary-planner.md) 1.1
- **不做跨城联游**：一次行程 = 一个城市（腾讯公交换乘官方明确仅支持同城）
- **不做行程云端同步**：行程存 `localStorage`，通过导出 JSON / 分享链接流转

### 目标用户与核心场景

| 角色 | 场景 | 关键诉求 |
|------|------|---------|
| 准备出行的人 | 出发前做攻略 | 快速看清"有哪些值得去 + 在哪 + 大概什么水平" |
| **已订好住宿的人** | **排具体行程** | **「我住 X，想去 A/B/C，吃 D，一天够吗？几点出门？」** —— 这是本项目的核心场景（G8） |
| 已在当地的人 | 现场找附近去处 | 移动端地图定位 + 就近筛选 |
| 搜索进来的人 | Google / Bing / 百度搜「深圳 必去景点」 | 落地即看到结构化内容，不是空白页 |
| 内容浏览者 | 随便逛逛 | 图片够好、排版舒服、加载快 |

---

## 二、技术选型

| 层 | 选型 | 版本 | 说明 |
|----|------|------|------|
| 构建 | Vite | 7.x | ESM 原生、冷启动快 |
| 框架 | React | 19.x | 函数组件 + Hooks |
| 语言 | TypeScript | 5.x | strict 模式 |
| 样式 | Tailwind CSS | 4.x | 原子类，配合少量自定义 token |
| 路由 | **React Router** | **7.x（Framework 模式）** | 用其 `prerender` 能力做 SSG，同时保留 SPA 交互 |
| 状态 | Zustand | 5.x | 轻量：筛选条件、选中 POI、地图联动 |
| 地图 | **腾讯位置服务 JavaScript API GL**（`TMap`） | v1 | 合规白名单内；坐标 GCJ-02；**底图由用户自选（类型 × 详细度开关），默认矢量图，不随缩放自动切换**；选型依据见 [07](./07-map-provider.md) |
| **路线规划** | 腾讯 `TMap.service.*` / WebService `/ws/direction/v1/*` + **`/ws/distance/v1/matrix` 距离矩阵** | — | 通勤时间来源（★ 运行时算）。**矩阵接口是关键** —— 25×25=625 对/次，**驾车/步行/骑行三种方式都有批量**，让一条规划只需少量请求即可覆盖整条折线（见 [09](./09-itinerary-planner.md) 第三节） |
| 坐标来源 | 腾讯「地理编码」WebService | — | 与底图同源同坐标系，落点不偏；⚠️ 一对一接口（无批量），但请求数 = POI 数，量很小 |
| **行政区划** | 腾讯「区划」WebService `/ws/district/v1/*` | — | ★ 三级下钻的省/市边界与 adcode 来源。**边界绝不用第三方 GeoJSON**（合规红线，见 [10](./10-map-drilldown.md) 第九节） |
| 数据校验 | Zod | 3.x | **脚本与前端共用**同一份 Schema |
| **图片** | 外链直链：**Wikimedia Commons**（CC 许可，需署名）→ Pexels → Unsplash | — | 不下载、不落盘，仓库零图片文件。★ 图源顺序由**命中率实测**定，不是许可宽松度（11 点抽样：Wikimedia 8/11、Pexels 8/11、Unsplash **0/11**）。**百度百科已废弃** —— `bkimg.cdn.bcebos.com` 带 Referer 防盗链，非百度域名一律 403，自家站点必挂 |
| 采集脚本 | Python 3.13 | — | 仅构建期跑，不进运行时产物 |
| 部署 | **Netlify 单站**（已定） | 零运维；Deploy Preview + Build Hook 齐全。免费版节点在新加坡，国内可达性偏弱但已决策接受 —— 将来迁国内**不改一行代码**。详见 08 文档第十节 |

### 地图：为什么是腾讯，以及为什么桌面端默认影像图

**先说选型**（三家官方配额、能力与成本的完整对比见 [07-map-provider.md](./07-map-provider.md)）：

| 结论 | 说明 |
|------|------|
| **批量距离矩阵最强 → 腾讯** | `/ws/distance/v1/matrix` 一次 25×25 = 625 对，**驾车 / 步行 / 骑行三种方式都有批量**。★ 这是选腾讯的胜负手（对比高德：骑行只能一对一，1,035 次/城）。⚠️ 原始判据表述是"让矩阵能在构建期算好"——**矩阵已于 2026-10-06 取消预存**，但"批量能力"本身仍是运行时省配额的关键 |
| ✅ 没有安全密钥负担 | 腾讯 JS API **只需要一把 key**（配域名白名单即可），不像高德那样还要额外暴露 `securityJsCode`（官方标明"不建议生产使用"） |
| ✅ 配额按接口独立、每日重置 | 地理编码 / 距离矩阵 / 区划**各有各的 10,000 次/日**，互不挤占；每日重置、不累积，**不存在"免费期到期即断供"的问题** |
| ✅ 区划服务自带中心点 | District 接口直接返回每个区划的 `location`，**不用自己算质心**，正好做"各省景点数"的标注锚点 |
| 我们的选择 → **腾讯** | 判据重排后（批量矩阵升为首要 + 免安全密钥负担）结论由高德**改回腾讯**。完整论证与三次决策变迁见 [07](./07-map-provider.md) 第〇、二节 |

**两条能力的边界**（如实说明，不是"只挑好的讲"）：
1. **地理编码是一对一**：腾讯没有高德那种 `batch=true` 批量地理编码，请求数 = POI 数（~46/城）。但这一步占总配额比例极低，不构成瓶颈
2. **公交 / 地铁无批量**：与高德一样，公交时效性最强且无批量接口。★ **现在所有方式都在运行时算**（矩阵已不预存），这条边界不再是"要不要预计算"的差别，只影响单次请求的批量化程度（六种通行方式到两条接口链路的映射见 [09](./09-itinerary-planner.md) 3.2.1）

**适配层保护**：业务代码只依赖 `MapProvider` / `RouteProvider` / `DistrictProvider` 三个接口，真要换回高德只改实现文件（见 [07](./07-map-provider.md) 第九节）。

**再说底图**：**由用户自选**（**底图类型**矢量/影像 × **详细度开关**：地点名称 / 道路名称 / 建筑 / 路网与地名；"简略·详细"是这套开关的快捷档），默认「矢量图 · 详细」，选择持久化；**不随缩放自动切换**。⚠️ 按 POI 类别（地铁站 / 超市 / 区划）单独控制**做不到** —— 腾讯的 `features` 是图层级开关，见 [03](./03-map-interaction.md) 2.2.1。

- 首页要读的信息是**省界与省名** —— 矢量底图是审图版标准底图，国界/省界/地名齐全；影像图上这些几乎为零
- 城市级视野（zoom 10–13）是影像最强的场景，但那是用户自己的选择（预设的说明里写清了差别）
- 街区级（zoom ≥ 15.5）影像失效（只有屋顶、认不出入口门脸）—— 这件事写在预设说明里，**不由系统替用户改**
- 影像瓦片体积是矢量的 5–10 倍（实测同一视野 2.0MB vs 0.74MB），两端统一默认矢量
- 完整决策与被删掉的"自动降级 + 迟滞 + 锁定"三重保护，见 03 文档第二节

放弃自绘 SVG 底图的理由（早期方案已否决）：
1. 自绘只有区界轮廓，**没有街道、建筑、水系**，`zoom` 上限低，缩放到街区级就失去参考价值
2. marker 尺寸随缩放变化、命中测试、移动端双指手势等**都要手写**，隐性成本远高于预期
3. 无法做"搜地点 / 路线规划 / 用户定位"，而**路线规划恰恰是本项目的核心需求**（G8）

腾讯 JS API 的坐标系是 **GCJ-02**，与我们的地理编码来源（腾讯地理编码）**同源**，天然无偏移，省掉一整套纠偏逻辑；与高德同为 GCJ-02，因此**上一版改到高德时留下的坐标可原样复用，改回腾讯不必动坐标字段**。

> 🚨 **三级下钻的边界同理，但有更硬的理由**：省 / 市轮廓必须来自腾讯 District 服务，**绝不能用第三方 GeoJSON** —— 这是国家版图完整性问题（台湾、藏南、南海诸岛的表达）。详见 [10 文档](./10-map-drilldown.md) 第九节。

### 为什么用 React Router 7 的 Framework 模式

需求是「React 的交互体验」+「搜索引擎能收录」+「无后端」。这三点恰好对应 React Router 7 的 `ssr: false` + `prerender()` 组合：

- 构建期把 `/`、`/city/chengdu`、`/city/chengdu/poi/wuhou-shrine` 全部渲染成**真实 HTML 文件**
- 浏览器拿到 HTML 后 hydrate，地图、筛选、抽屉等交互与普通 SPA 完全一致
- 部署产物仍是纯静态文件，Netlify 直接托管，**零服务端运行时**
- 路由列表可从 `data/cities/*.json` 动态读出，**新增城市不需要改配置**

> 不选 Astro 的原因：Astro 的岛屿架构对本项目（地图是重度交互主体）收益有限，却要重写全部组件为 `.astro`，迁移成本大于收益。

---

## 三、渲染策略（SSG + 客户端水合）

```
构建期（Node）                                    浏览器
─────────────────────────────                    ─────────────────────
① 读 data/cities/*.json（含 POI 列表；★ 不含通勤矩阵 —— 改运行时算）
   读 data/_generated/district-tree.json（全国三级区划 + 各级计数）
② prerender() 返回全部路由
   /                              ← 全国视图：中国全图 + 各省景点数
   /province/{provinceAdcode}     ← 省级视图：省地图 + 各市景点数
   /city/{cityId}                 ← 市级视图：城市地图 + 撒点（景点按细类着色）
   /city/{cityId}/poi/{poiId}
   /city/{cityId}/plan            ← 行程规划页（只预渲染空壳，见下表）
   /credits
③ 逐路由调用 loader（同步读 JSON，无需网络）
④ 渲染成 HTML + 注入 <title> / meta / OG / JSON-LD
   ↓
dist/
├─ index.html                    ← 全国视图
├─ province/510000/index.html    ← 四川省
├─ city/chengdu/index.html
├─ city/chengdu/poi/wuhou-shrine/index.html
├─ city/chengdu/plan/index.html
└─ assets/*.js  ← 客户端 bundle（hydrate 用）
```

| 关注点 | 处理方式 |
|--------|---------|
| 地图组件 | **必须客户端渲染**。预渲染时没有 `window`，用 `useIsMounted()` 门控：未挂载先渲染骨架，`useEffect` 后挂载真实地图 |
| 数据读取 | loader 通过 `import.meta.glob('./data/cities/*.json')` 引入。构建期与客户端导航共用同一条路径，不需要额外 HTTP 请求 |
| 路由列表 | `prerender()` 里扫描同一份 glob 结果 + 区划树，**数据即路由**，无手工维护清单 |
| **三级下钻路由** | `/`、`/province/:adcode` 的 SEO 价值在于"全国/全省概览"，**34 个省级页全部预渲染**（省级页对未收录城市显示"待收录"）。切换层级主要走客户端导航（地图不重载），直接落地某级 URL 也能正常渲染 |
| **行程规划页** `/city/:id/plan` | **只预渲染空壳**（页面说明 + 引导 + SEO meta），行程数据由客户端读 `localStorage` 填充。理由：行程是用户私有产物，预渲染它既无 SEO 价值、又会导致"分享链接打开是别人的行程"这类错误。⚠️ 通勤时长需**运行时请求图商**，因此该页首屏不含时长（进页后逐段补算） |
| 交互能力 | 预渲染只影响首屏 HTML；选中联动、筛选、抽屉、地图缩放、下钻、行程编排全部在 hydrate 后正常工作 |
| 构建规模 | 当前 1 城市 ≈ 51 页 + 34 省级概览页 ≈ 85 页，构建 < 1 分钟。**城市数 × POI 数 > 3000 页**时才需要改增量预渲染，暂不优化 |

---

## 四、整体架构

```
┌───────────────────── 构建期 A：内容采集（离线脚本） ────────────────┐
│                                                                    │
│  seeds/{city}.yaml        联网搜索                                  │
│   └─ 候选点位清单    ──▶  step1_search.py    →  候选来源 URL 列表    │
│                                                                    │
│                        step2_extract.py      →  抓正文 + LLM 结构化  │
│                          （含 ★结构化停留时长 durationMinutes）       │
│                                                                    │
│                        step3_geocode.py      →  腾讯地理编码 WebService   │
│                          （POI 名 → GCJ-02 经纬度 + 标准地址 + adcode）   │
│                                                                    │
│                        step4_images.py       →  Wikimedia/Pexels/Unsplash│
│                          （只取外链 URL，不下载、不落盘）            │
│                                                                    │
│                        step6_transit.py      →  ⛔ 已废弃（2026-10-06）│
│                          通勤矩阵改运行时算，脚本遗留但不许跑；      │
│                           `transit` 字段不再入库                   │
│                                                                    │
│                        step7_district.py     →  ★ 区划树 + 聚合计数   │
│                          （腾讯 District 服务；省/市结构 + 边界缓存   │
│                           + 每级 POI 计数 → district-tree.json）      │
│                                                                    │
│                        step5_validate.py     →  Zod + bbox + 去重    │
│                              ↓                                     │
│                   data/cities/{cityId}.json                         │
│                     （文案 + 坐标 + 图 URL；★ 无 transit 字段）      │
│                   data/cities.index.json      （城市索引，脚本生成）  │
│                   data/credits/{cityId}.md    （来源清单，脚本生成）  │
│                   data/_generated/district-tree.json ★ 区划树+计数   │
│                   data/_generated/api-usage.json ★ 腾讯用量记账      │
│                   REPORTS/{cityId}-quality.md                       │
└────────────────────────────────────────────────────────────────────┘
                             ↓ git commit（数据进仓库）
┌───────────────────── 构建期 B：预渲染（Vite + React Router） ────────┐
│                                                                    │
│  react-router.config.ts                                            │
│    ssr: false                                                      │
│    prerender() → 扫描 data/cities/*.json → 返回全部路由              │
│                                                                    │
│  loader 读 JSON → 渲染 HTML → 注入 SEO meta / OG / JSON-LD          │
│                                                                    │
│  产出 dist/：每路由一份静态 HTML + 客户端 bundle                     │
└────────────────────────────────────────────────────────────────────┘
                             ↓ Netlify 部署
┌──────────────────────── 运行时（浏览器） ───────────────────────────┐
│                                                                    │
│  ① 请求 /city/chengdu → Netlify CDN 直接返回预渲染 HTML（秒出）      │
│     ↳ 搜索引擎爬到这里，能拿到完整文案、图片、结构化数据              │
│                                                                    │
│  ② hydrate → React 接管                                            │
│     ├─ 底层：MapCanvas 铺满视口（腾讯 JS API GL 按需载入，客户端才跑）│
│     ├─ 浮层：TopBar / FloatingPanel / MapControlStack / LegendBar   │
│     ├─ 浮层：PoiList ──┐ Zustand store 双向联动                    │
│     └─ 浮层：PoiPreviewCard / BottomSheet（移动端）                  │
│                                                                    │
│  ③ 三级下钻（默认落在全国视图）                                       │
│     ├─ /  中国全图 + 各省景点数（区划树计数，零调用）                  │
│     ├─ 点击省 → /province/:adcode 省地图 + 各市景点数                 │
│     └─ 点击市 → /city/:id 城市地图 + 细类着色撒点                     │
│                                                                    │
│  ④ 行程规划页 /city/:id/plan                                        │
│     ├─ 住宿点 / 点位选择 / 顺序调整  → Zustand + localStorage          │
│     ├─ 通勤时长 → ★ 运行时调图商算（带缓存与配额账本，缓存未命中显示"计算中"）│
│                                                                    │
│  ⑤ 后续导航走客户端路由（SPA 体验），不再整页刷新                   │
└────────────────────────────────────────────────────────────────────┘
```

### 「纯前端」边界说明

采集脚本属于**构建期工具**，不打包进浏览器产物，也不在运行时执行。最终交付物只有 HTML / JS / CSS / JSON（图片是 JSON 里的 URL 字符串），可直接丢到静态托管。

内容**在开发期就生成好**并随仓库走版本管理，运行时不做任何实时抓取；将来要"动起来"，用 GitHub Actions 定时重跑脚本 → 自动开 PR（见 04 第九节）。

> ⚠️ **行程规划是"运行时零抓取"原则的例外，必须说清楚**（⚠️ 2026-10-06 决策后范围**扩大**了）：
> 原先只有「自定住宿点」与「公交 / 地铁」需要实时调用；**现在所有通勤时长都实时算**（矩阵不再预存）。
> 所以"纯前端"的准确表述是：
>
> | | 说明 |
> |---|---|
> | **仍然零后端** | 所有调用都是浏览器直连腾讯（带 key + Referer 域名白名单校验），没有任何自有服务端 |
> | **零调用只对计数成立** | 三级下钻的省 / 市计数走预计算的区划树，**这部分运行时零调用**；⚠️ 通勤时长则**一律实时调**，不再有"默认零调用" |
> | **调用可控** | 本地配额账本设上限（单日 300 次/方式），超了退化为估算并标注「估算」；结果进 localStorage 缓存 |
> | **挂了仍能算** | 地图 SDK 加载失败时，通勤时长走 Web 服务 JSONP（不依赖地图实例）→ **时间计算照常可用**；区划树是纯数据 → 下钻计数也可用 |
>
> 这条例外的代价与对冲已写在 [07 文档](07-map-provider.md) 第四、八节。
> **核心判断**：用「可控的运行时调用 + 可降级」换取路线规划能力与仓库体积，值得。

---

## 五、目录结构

```
travel_strategy/                # 仓库根 —— 只放「文档 / 原型 / 数据」
├─ plans/                       # 本文档集
├─ prototype/                   # 原型（低保真 + 高保真，单文件零构建，双击即看）
├─ data/                        # ★ 内容数据，与代码解耦，可独立复用
│  ├─ cities.index.json         #   城市列表（含 adcode，脚本生成，勿手改）
│  ├─ cities/{cityId}.json      #   城市全量数据（唯一真源，人只改这里）
│  ├─ credits/{cityId}.md       #   来源清单（脚本生成，便于 PR review）
│  └─ _generated/               #   脚本生成，勿手改
│     ├─ district-tree.json     #   ★ 全国三级区划树 + 每级 POI 计数（下钻地基）
│     ├─ district-bounds/       #   ★ 省/市边界缓存 {adcode}.json
│     ├─ search-index.json      #   跨城倒排索引
│     ├─ api-usage.json         #   腾讯 WebService 用量记账
│     └─ manifest.json          #   校验和 + 更新时间
├─ netlify.toml                 # ★ 必须留在根：Netlify 只在此（或 base 目录）寻找配置
└─ web/                         # ★ 应用工程（前端 + 采集脚本 + Schema），展开如下

web/                            # ←── 上图的 web/ 展开
├─ scripts/                     # 构建期采集流水线（不进浏览器）
│  ├─ config.py                 #   城市配置、第三方 key（.env）
│  ├─ lib/
│  │  ├─ http.py                #   请求封装：重试、限速、UA
│  │  ├─ llm.py                 #   结构化抽取（含细类 + 适游群体）
│  │  ├─ geocode.py             #   腾讯地理编码（一对一）+ 反向校验
│  │  ├─ transit.py             #   ★ 腾讯距离矩阵 /ws/distance/v1/matrix
│  │  ├─ district.py            #   ★ 腾讯区划服务（区划树 + 边界缓存）
│  │  ├─ images.py              #   图片搜索（只取外链 URL）
│  │  ├─ ledger.py              #   ★ 腾讯接口用量记账（按接口独立、每日重置）
│  │  └─ validate.py            #   质量校验
│  ├─ step1_search.py ~ step5_validate.py
│  ├─ step6_transit.py          #   ⛔ 已废弃：通勤矩阵改运行时算，不许跑
│  ├─ step7_district.py         #   ★ 区划树 + 聚合计数（见 04 第七节）
│  ├─ check_images.py           #   图片巡检 + 自动补图（Actions 用）
│  ├─ build_index.py            #   生成 cities.index / search-index / manifest
│  ├─ gen_credits.py            #   生成来源清单
│  └─ run.py                    #   一键跑全流程
├─ shared/
│  └─ schema.ts / schema.py     # ★ Zod / Pydantic 同构 Schema（单一真源，含 transit / 区划 / 行程结构）
├─ public/                      # 站点静态资源：favicon / OG 默认图 / robots.txt
├─ app/                         # ★ React Router 7 Framework 模式
│  ├─ root.tsx                  #   全局布局 + 默认 meta
│  ├─ routes.ts                 #   路由表
│  ├─ routes/
│  │  ├─ home.tsx               #   /                   全国视图（中国全图 + 各省景点数）
│  │  ├─ province.tsx           #   ★ /province/:adcode 省级视图（省地图 + 各市景点数）
│  │  ├─ city.tsx               #   /city/:cityId       市级视图（撒点，细类着色）
│  │  ├─ city-poi.tsx           #   /city/:cityId/poi/:poiId
│  │  ├─ city-plan.tsx          #   ★ /city/:cityId/plan（行程规划，只预渲染空壳）
│  │  └─ credits.tsx            #   /credits
│  ├─ components/
│  │  ├─ shell/       AppShell.tsx  FloatingPanel.tsx  BottomSheet.tsx
│  │  ├─ layout/      TopBar.tsx  LegendBar.tsx  SiteFooter.tsx
│  │  ├─ drilldown/   ★ Breadcrumb.tsx  CountBadge.tsx  PendingCard.tsx
│  │  ├─ city/        PanelHeader.tsx  CategoryTabs.tsx  FilterBar.tsx  SubtypeLegend.tsx
│  │  ├─ poi/         PoiCard.tsx  PoiList.tsx  PoiPreviewCard.tsx
│  │  │               PoiDetail.tsx  LocateCard.tsx  Gallery.tsx  AudienceTags.tsx
│  │  ├─ itinerary/   ★ ItineraryPanel.tsx  StayPicker.tsx  DayTabs.tsx
│  │  │               TimelineRail.tsx  StopRow.tsx  LegRow.tsx  DaySummary.tsx
│  │  │               ModeSwitcher.tsx  RouteOptionList.tsx
│  │  ├─ map/         MapCanvas.tsx  MapControlStack.tsx  MapFallback.tsx
│  │  └─ common/      Chip.tsx  Tooltip.tsx  SourceLink.tsx  ImageLazy.tsx
│  ├─ map/                      # ★ 地图层（腾讯 JS API GL 薄封装）
│  │  ├─ provider/              #   ★ 适配层：业务代码只认接口，不 import TMap
│  │  │  ├─ types.ts            #     MapProvider / RouteProvider / DistrictProvider 契约
│  │  │  ├─ tencentProvider.ts  #     唯一实现
│  │  │  ├─ tencentRoute.ts     #     ★ 路线规划（多方案 get_mp=1 + 路况 get_speed=1）
│  │  │  └─ tencentDistrict.ts  #     ★ 区划下钻（District 服务 + 边界缓存）
│  │  ├─ tencent/
│  │  │  ├─ loader.ts           #     SDK 单例加载（失败降级）
│  │  │  ├─ config.ts           #     ★ 双 key 解析（用户自备 > 构建期注入 > 降级）
│  │  │  ├─ useTMap.ts          #     实例生命周期 hook
│  │  │  ├─ basemap.ts          #     底图类型 + 详细度开关（用户自选 · 持久化）
│  │  │  ├─ fitView.ts          #     ★ 浮层实测 → fitBounds padding（见 03 文档 4.1）
│  │  │  ├─ poiLayer.ts         #     MultiMarker + MultiLabel + 自建避让（见 03 文档 3.2）
│  │  │  ├─ cluster.ts          #     MarkerCluster（移动端）
│  │  │  ├─ districtLayer.ts    #     ★ 区划面 MultiPolygon + CountBadge
│  │  │  └─ routeLayer.ts       #     ★ 行程连线（MultiPolyline 分天分色）
│  ├─ drilldown/                # ★ 三级下钻逻辑
│  │  ├─ tree.ts                #     区划树读取 + 计数查询（零调用）
│  │  └─ useDrilldown.ts        #     层级状态机 + 边界缓存命中
│  ├─ itinerary/                # ★ 行程规划核心逻辑
│  │  ├─ matrix.ts              #     ⛔ 已废弃：通勤矩阵 base36 编解码 + readLeg()
│  │  ├─ resolveLeg.ts          #     两级解析：缓存 → 实时（六方式映射两条链路）
│  │  ├─ timeline.ts            #     buildTimeline 纯函数（时间链推导）
│  │  ├─ quotaLedger.ts         #     ★ 用量账本（防单点滥用打满配额）
│  │  ├─ share.ts               #     导出 JSON / 分享链接（LZ-string + URL hash）
│  │  └─ store.ts               #     行程状态 + localStorage 持久化
│  ├─ hooks/          useCityData.ts  useMapSync.ts  useIsMounted.ts
│  ├─ store/          useExploreStore.ts
│  ├─ lib/            schema 解析、SEO meta 构造、JSON-LD
│  └─ styles/         index.css  tokens.css
├─ react-router.config.ts       # ★ ssr: false + prerender()
├─ vite.config.ts
├─ .env.example
└─ package.json
```

> **为什么代码在 `web/`、而 `data/` 留在仓库根**：`data/` 与 `plans/`、`prototype/` 同属"人写的内容"，整包拿走可以独立复用；代码是消费方，独立成一个子目录。
>
> 代价是**多了一层路径深度**。有两处必须跟着改，且改错**都不会报错**（只会静默读不到数据）：
>
> | 处 | 写法 |
> |---|---|
> | 别名 `~data` | `vite.config.ts` → `abs('../data')`；`tsconfig.json` → `"~data/*": ["../data/*"]` |
> | `import.meta.glob` | 必须写**字面量相对路径**（别名在 glob 里不可用）→ `'../../../data/cities/*.json'` |
>
> `tools/check_app.py` 的 I 项专门守第二条；Netlify 靠 `netlify.toml` 的 `base = "web"` 指到子目录。
>
> 📌 **本文档集（及 04 / 05 / 06 / 09 / 10）里出现的代码路径，一律相对 `web/`** ——
> 即正文里的 `app/…`、`scripts/…`、`shared/…`、`package.json` 都指 `web/` 下的对应位置；
> **只有 `data/`、`plans/`、`prototype/` 在仓库根**。命令统一先 `cd web`。

---

## 六、构建与部署

### 本地开发

```bash
cd web               # ★ 应用工程在 web/，所有 npm / python 命令都在这里执行
npm install
npm run dev          # http://localhost:5173
```

### 生产构建

```bash
cd web
npm run build        # 预渲染全部路由 → web/dist/
npm run preview      # 本地预览预渲染结果（务必用它验证 SEO 产物）
```

> **不要用 `npm run dev` 检查 SEO**：开发服务器是 CSR 的，`view-source` 里看不到内容。必须用 `build` + `preview`，或直接用 curl 抓 `web/dist/city/shenzhen/index.html` 确认有正文。

### Netlify 配置

```toml
# netlify.toml —— 刻意放在**仓库根**：Netlify 只在此（或已配置的 base 目录）寻找它
[build]
  base = "web"                 # ★ base 一设，command 的执行目录与 publish 的基准都相对它
  command = "npm run build"
  publish = "dist"             # → web/dist

[build.environment]
  NODE_VERSION = "22"

# 地图 key 从 Netlify 环境变量注入（见下方「关于 key 泄露」）
# 预渲染产物已是完整静态文件，无需 SPA fallback；
# 仅为未预渲染的深层路径（如未来新增的客户端路由）兜底：
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
  # 静态文件优先生效：Netlify 只在文件不存在时才走这条规则，
  # 因此不会覆盖 /city/chengdu/index.html
```

**部署流程**

1. Netlify 连 Git 仓库 → 自动识别 `netlify.toml` → 每次 push 到主分支自动构建部署
2. 环境变量在 **Site settings → Environment variables** 配置，`VITE_TMAP_KEY` 等
3. 配 **Deploy Preview**：每个 PR 自动生成预览链接，数据类 PR 可以直接点开看效果
4. 配 **Build Hook**：拿到一个 webhook URL，GitHub Actions 改完数据后可 POST 触发重建 —— 这一条把「Actions 自动改数据 → 站点自动更新」的闭环打通（见 04 第九节）
5. 若绑了自定义域名，记得把域名加进腾讯位置服务控制台的 **Referer 域名白名单**

### 环境变量

```bash
# .env.example
# ── 地图 key（前端必然可见，详见 07 文档第七节）───────────────
# 腾讯 JS API GL 只需一把 key，配 Referer 域名白名单即可（无安全密钥负担）
VITE_TMAP_KEY=请到腾讯位置服务申请 JavaScript API GL key 并替换此占位符

# 使用者可以不改上面的值，直接在页面里填自己的 key（存 localStorage，优先级更高）
# 见 07 文档第八节「双 key 模式」

# ── 仅脚本 / CI 使用，永不进浏览器产物 ───────────────────────
# 腾讯「WebService API」类型的 key（另建一把，勾选 WebService）：
#   地理编码 + 距离矩阵 + 区划服务；建议配 IP 白名单或开启 SN 签名校验
TMAP_WEB_KEY=...
UNSPLASH_ACCESS_KEY=...
PEXELS_API_KEY=...
```

---

## 七、性能与规模预算

| 指标 | 目标 | 说明 |
|------|------|------|
| 首屏 LCP | ≤ 2.0s（4G） | 预渲染 HTML 已含文案，图片在外链 |
| 首屏 JS | ≤ 200KB gzip | 地图 SDK 单独异步 chunk，不阻塞首屏 |
| 地图可用 | SDK 载入 + 首帧 ≤ 1.5s | 骨架屏先行，避免白块 |
| 单城市 JSON | ≤ 300KB gzip | 实测约 30KB gzip（★ 通勤矩阵已不入库，见 G9） |
| 单页 HTML | ≤ 60KB | 预渲染产物，含 meta 与 JSON-LD |
| 图片 | 外链 CDN，列表 400w / 详情 1080w | `loading=lazy` + 尺寸参数 |
| **行程时间链重算** | **≤ 16ms（一帧内）** | 拖拽排序时每帧重算。⚠️ 靠**本地缓存命中**保证同步纯函数（矩阵已取消，新点对异步补算后重算一次） |
| **运行时地图 API 调用** | ⚠️ **不再默认 0 次** | 下钻计数读预计算区划树（这部分零调用）；**通勤时长一律实时调**，带缓存与配额账本，超额降级为估算 |
| **区划树加载** | ≤ 200KB gzip | `district-tree.json` 只存结构与计数（不含边界几何）；边界按需拉、命中缓存即不重复请求（见 10 文档第十节） |
| 构建规模 | < 3000 页 | 超出后改增量预渲染 |

---

## 八、风险与待验证

| # | 事项 | 验证方式 | 影响 |
|---|------|---------|------|
| R1 | 腾讯 **Referer 域名白名单** 对 Netlify 域名/子域的匹配规则；Deploy Preview 随机域名如何处理 | 申请 key 后配白名单，用 Netlify 域名实测调用 | 配错会导致生产环境地图整体不可用 |
| R2 | 腾讯卫星影像在首发城市的**分辨率与时效性** | 用首发城市对照「近两年新开」的网红点位，目视确认影像上是否已建成 | 影响有限：**默认底图是矢量**，影像是用户自己选的档；时效性太差时的退路是把「影像图」这一档的说明写得更明确（**而不是替用户改**）。移动端同此 |
| R3 | 预渲染时 loader 读取 `~data` 别名的路径解析 | 首次 `npm run build` 后检查 `dist/**/index.html` 是否含真实文案 | 失败则 SEO 目标落空 |
| R4 | Netlify 在国内 4G 的**实际加载完成率** | itdog.cn 多点测速 + 真机实测 | 已决策接受（见 README「已确认的 2 项决策」）。若实测长时间加载不出，再评估迁国内托管 —— 纯静态产物，**迁移不改代码** |
| **R5** | **地理编码同名异地误命中**（腾讯一对一无批量，且"人民公园"全国都有） | 抽样 20% POI 人工核对落点；脚本用 `region` 参数 + `ad_info.city_code` 校验 | 落点错会毁掉地图可信度。对冲：`region` 显式传城市 + adcode 强校验（见 04 第三节） |
| **R6** | **区划树体积与边界缓存** | 生成 `district-tree.json` 后测 gzip 体积；测省级边界首次拉取的耗时 | 树过大拖慢下钻首屏；边界不缓存会反复请求。对冲：结构与几何分离 + 缓存命中（见 04 第七节） |
| **R7** | **通勤矩阵的实际体积与质量** | 用成都真实数据生成一次，测 gzip 体积、看驾车覆盖率与 `distance ÷ 直线距离` 分布 | 体积超预算要改编码方案；质量不过关说明坐标或接口有问题（见 04 文档第八节） |
| **R8** | **腾讯步行 / 骑行矩阵在超阈值点对的行为** | 抽样看 `status:4`（退化为直线、无 `duration`）的比例 | 退化比例高会让"步行 / 骑行不适用"格子偏多。本方案本就按阈值裁剪 → 记 `0000`，UI 显示"不适用"，可接受 |
| **R9** | **腾讯无原生标签避让**（高德有 `LabelsLayer`，腾讯需自建） | 用 46 点位实测自建避让算法的可读性 | 若密集区标签重叠严重，退化为"缩放阈值下只显示热度前 N 个标签 + 其余纯圆点"（见 03 文档 3.2） |
| **R10** | **三级下钻的边界合规与 34 省级单位完整性** | 逐项核对省 / 市边界是否覆盖中国台湾 / 中国香港 / 中国澳门；边界来源是否为腾讯 District | 违反《地图管理条例》是**红线级**问题。**必须**只用 District 服务、禁止第三方 GeoJSON（见 10 文档第九节） |
