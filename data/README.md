# `data/` 数据目录契约

> 这个目录是**内容数据**，与 `web/` 下的应用代码完全解耦 —— 整包拿走可以独立复用。
> 前端通过 Vite alias `~data`（解析到仓库根的 `data/`）引入；新增一座城市**不需要改一行前端代码**（放一份 JSON，页面与路由自动出现）。
>
> **仓库布局**：应用工程在 `web/`，本目录与 `plans/`、`docs/`、`pipeline/`、`schema/`、`tools/` 在**仓库根**。
> 所以 `web/` 里的代码引用数据要**往上多走一层**（`../../../data/...`）——
> `import.meta.glob` 必须写字面量相对路径、用不了别名，这是本仓库最容易静默出错的一处
> （写错不报错，只会匹配到 0 个文件、页面进空态）。`tools/check_app.py` 的 I 项专门守这个。

---

## 一、目录结构

```
data/
├─ cities.index.json            # 城市索引（脚本生成，勿手改）★ 顶层是**数组**，不是 {count,cities}
├─ cities/
│  └─ {省slug}/                 # 省（拼音，如 sichuan）—— 34 个省级单位之一
│     ├─ _province.json         #   省元信息（名称 / adcode）
│     └─ {cityId}/              # 市（英文 id，如 chengdu）
│        ├─ city.json           # ★ 城市主数据（人写，唯一真源）
│        ├─ pois/               # ★ 一个大类一个文件夹
│        │  ├─ scenic/{poiId}.json     景点
│        │  ├─ food/{poiId}.json       美食
│        │  ├─ hotspot/{poiId}.json    网红打卡
│        │  └─ culture/{poiId}.json    城市特色
├─ provinces/
│  └─ index.json                # 省级内容（34 段 intro + heroImages），键 = 6 位 adcode
├─ credits/
│  └─ {省slug}/{cityId}.md      # 来源清单（脚本生成，便于 PR review）
├─ _generated/                  # ★ 全部脚本生成，禁止手改
│  ├─ district-tree.json        # ★ 全国三级区划树 + 每级 POI 计数（下钻地基）
│  ├─ district-index.json       # ★ 区 → 省/市 反查，按 adcode 索引
│  ├─ districts/{adcode}.geo.json       # 省 / 市边界缓存（一个 adcode 一个文件）
│  ├─ districts-own/{adcode}.geo.json   # 各级「自身轮廓」（挖空下级，高德源）
│  ├─ provinces/{adcode}.geo.json       # 省级自身轮廓
│  ├─ cities/{adcode}.geo.json          # 市级自身轮廓
│  ├─ subdistricts/{adcode}.json        # 市辖区（区级）数据与边界
│  ├─ city-bbox.json            # 城市 bbox 汇总
│  ├─ search-index.json         # 跨城倒排索引
│  ├─ build-summary.json        # 本次构建汇总（cities 字典）
│  ├─ city-covers.json · province-covers.json   # 封面抓取账本（进度真源）
│  ├─ reviews/{cityId}.json     # AI 点评草稿（按城分文件）
│  ├─ discover/{cityId}.json    # 拓取候选（按城分文件）
│  └─ api-usage.json            # 图商用量记账
└─ _fixtures/                   # ★ 开发占位数据，**不是真实内容**，见第四节
   └─ chengdu.json
```

> ★ `transit.json`（通勤矩阵）已于 **2026-10-25** 彻底删除 —— 时长改为运行时按需算，
> 不再有构建期矩阵产物。第三节保留的是决策来由，**不是现行契约**。

**铁律**：`cities/` 是唯一需要人碰的地方；凡是能算出来的（索引、清单、来源汇总、巡检结果）一律脚本生成。

---

## 二、一座城市的数据长什么样

一座城市拆成**三类文件**，各司其职（目录布局的唯一真源是 `pipeline/layout.py`）：

| 文件 | 谁写 | 内容 |
|------|------|------|
| `city.json` | **人写** | 城市主数据：id / 名称 / adcode / 简介 / 中心点与 bbox / 分类定義 / hero 图 |
| `pois/{大类}/{poiId}.json` | **人写** | 一个点位一个小文件。所在目录即 `category`，文件内不必重复写 |

**为什么分片**：单城 46 个点位写成一个 JSON 会轻松超过 400 行，AI 每次读文件整篇进上下文；
分片后改一个点位只产生**一个文件**的 diff，PR review 能一眼看清改了什么。

> ⚠️ **POI 顺序是契约的一部分**：`city.pois` 按「大类目录顺序 `scenic → food → hotspot → culture` + 文件名字典序」拼装。
> 列表、路线、海报都依赖它稳定 —— 顺序一变，同一个 id 在页面上就换了位置。
> 脚本侧见 `core/layout.py` 的 `iter_poi_files`，前端侧见 `cityRegistry` 的 `CATEGORY_ORDER`，两处必须一致。

- `schema/schema.ts` —— Zod，前端运行时校验
- `schema/schema.py` —— Pydantic，脚本产出校验

两者字段一一对应，**改一处两边都要同步**。

```jsonc
{
  "schemaVersion": 1,
  "id": "chengdu",
  "name": "成都",
  "province": "四川",
  "adcode": "510100",          // ★ 与区划树的关联键，必须能在 district-tree.json 里查到
  "provinceAdcode": "510000",
  "tagline": "天府之国，慢生活之都",   // ≤ 30 字
  "intro": "……",                     // ≥ 150 字
  "center": { "lng": 104.066541, "lat": 30.572269, "coordSystem": "GCJ-02" },
  "bbox": [103.75, 30.30, 104.65, 30.93],   // [minLng, minLat, maxLng, maxLat]
  "defaultZoom": 11,                  // 腾讯 GL 缩放范围 3~20
  "heroImages": [ /* ≥1 且 ≤3，每张必须带 query 与 credit */ ],
  "facts": { "suggestedDays": "2-3 天", "bestSeason": "3-6 月 / 9-11 月" },
  "categories": [ /* 四大类；把大类标签、筛选色与它下面的细类清单交给数据决定 */ ],
  "pois": [ /* 每城 ≈ 46：景点 15 / 美食 15 / 网红 10 / 特色 6 */ ],
  "credits": { "imageSources": [], "textSources": [], "lastUpdated": "2026-09-18" },
  "updatedAt": "2026-09-18"
}
```

### 2.1 不变式（校验会阻断）

| # | 不变式 | 为什么 |
|---|-------|--------|
| 1 | `pois[].id` 全局唯一、只含 `[a-z0-9-]` | 路由键与详情页地址都靠它 |
| 2 | `pois[].location.point` 必须落在 `bbox` 内 | 落点跑出城市说明地理编码错了 |
| 3 | `SUBTYPE_CATEGORY[subtype] === category` | 细类必须归属且只归属一个大类 |
| 4 | `audience` ≥ 1 项且不重复 | 一个都填不出，说明对这个点位理解还不够 |
| 5 | 每个 `xxxRef` 下标 < `sources.length` | 溯源角标不能指向不存在的来源 |
| 6 | `coverIndex` < `images.length` | —— |
| 7 | `description` ≥ 80 字 | 质量门槛，防"页面能跑但内容残缺" |
| 8 | `popularity` 必填（0–100） | ★ 自研标注避让靠它排序；缺了该点低 zoom 下**永远不出标注** |
| 9 | `accessible` 默认 `false` | 未核实就不声称 |

---

## 三、通勤时长：运行时算，不预存（原 `transit` 已删除）

> ⛔ **2026-10-25 起彻底移除**：`transit.json`、`city.transit` 字段、`schema` 里的 `CityTransitMatrix`、
> 前端 `itinerary/matrix.ts`、`pipeline/steps/step6_transit.py` 全部删除，`run.py` 也没有 `transit` 子命令。
> 旧编码方式（对称上三角 / 4 位 base36 / 按下标寻址）与决策来由见 `plans/README.md` 的变更记录 ——
> **不要在数据里再加回矩阵**。

现行做法：

- 行程页拉开两点之间的段时，**当场**按需请求图商（驾车 / 打车 / 骑行 / 步行 / 公交 / 地铁），
  结果进 `routeSetCache`（与海报导出同源），同一次会话内复用；
- 拿到的是**当次请求的真实路况**，不再有"9 月生成的快照在 12 月被当成实时展示"的问题；
- 用量仍记在 `_generated/api-usage.json`（`MATRIX_CHANNEL` 六条通道）。

> ⚠️ 两个老坑仍成立：腾讯接口坐标一律 **`lat,lng`（纬度在前）**，与 GeoJSON 的 `[lng,lat]` 相反；
> 距离矩阵单位是**秒**、路线规划是**分钟**，混用差 60 倍。

---

## 四、`_fixtures/` 是什么

`_fixtures/` 里是**开发占位数据**，用来在真实数据就绪前把页面跑起来看效果。

- **只在开发环境生效**：`import.meta.env.DEV` 且 `data/cities/` 为空时才加载
- **不是真实内容**：坐标是近似值、文案是占位说明、图片是示例外链
- **一旦 `data/cities/` 里有任意一份真实城市数据，fixtures 立即失效**，不需要手动关
- 生产构建**永不**使用 fixtures

它同时兼一个作用：**当"什么算一份合法的城市数据"的参照物**。写采集脚本时对着它看字段该怎么填。

生成方式：

```bash
E:/BASIC/python/python.exe tools/make_fixture.py     # 重算 fixtures（改了 schema 后跑它对齐）
```

---

## 五、区划树（`_generated/district-tree.json`）

三级下钻的地基。**结构与边界分离**：这个文件只有区划层级与计数，**不含任何边界几何**（控制体积，区划树 < 50KB）。

```jsonc
{
  "version": "20260101",              // District 数据的 data_version
  "generatedAt": "2026-09-18",
  "provinces": [
    {
      "adcode": "510000", "name": "四川", "fullname": "四川省",
      "center": { "lng": 104.075931, "lat": 30.651652 },   // ★ 直接用 API 的 location
      "poiCount": 46,     // 该省已收录 POI 总数
      "cityCount": 1,     // 已收录城市数
      "childCount": 21,   // 区划树上的下辖数量（与内容无关）
      "children": [
        { "adcode": "510100", "name": "成都", "cityId": "chengdu", "poiCount": 46, "center": {...} },
        { "adcode": "510300", "name": "自贡", "cityId": null,      "poiCount": 0,  "center": {...} }
      ]
    }
  ]
}
```

### 5.1 `cityCount` 与 `childCount` 必须分开

四川下辖 21 个地级市（`childCount`），但可能只有 1 个已收录（`cityCount`）。UI 要表达的是「**已收录 1 / 共 21 个市**」—— 让用户知道这是进度问题，不是内容问题。

### 5.2 ★ `null ≠ 0`

| 值 | 含义 | UI |
|----|------|-----|
| `cityId: null` | **待收录** —— 我们还没做 | 灰 + 虚线 + 「待收录」 |
| `cityId: "xxx"` | 已收录 | 蓝 + 实线 + 「N 个」 |

把 `null` 渲染成 `0` 是**信息错误** —— 用户会以为"这地方没景点"。这是全项目最容易被做错、也最容易显得项目"很空"的一处。

### 5.3 adcode 的四个特例（处理错了下钻会崩）

| # | 特例 | 处理 |
|---|------|------|
| 1 | **直辖市**（110000 / 120000 / 310000 / 500000）与**港澳**（810000 / 820000） | 省级下**直接是区级**，没有二级结构。下钻时若 `children` 第一项是区级，**不报错**，直接展示 |
| 2 | **省直辖县**：第 3、4 位为 `90`（如 419001 济源市） | 视同地级市处理 |
| 3 | **非行政区划区域** `999999`（如东海） | **过滤掉**，不入树、不显示 |
| 4 | **中国台湾 / 中国香港 / 中国澳门** | **必须作为省级单位正常出现**（710000 / 810000 / 820000） |

### 5.4 🚨 合规红线

**省 / 市边界只能来自腾讯 District 服务**（`/ws/district/v1/*`）。**绝对禁止**引入任何第三方 GeoJSON、自制中国地图轮廓、或 Wikipedia / Natural Earth 之类的数据集。

**为什么这条是红线**：中国地图的行政区划边界涉及**国家版图完整性** —— 台湾省、藏南地区、南海诸岛、阿克赛钦的表达。第三方数据常把台湾单独成"国家"、按错误实控线绘制藏南、或完全缺失南海诸岛。这类错误**违反《地图管理条例》**，且在开源项目中极其常见。

用持牌图商（腾讯）的数据就自动合规。全国图必须覆盖**34 个省级单位**（清单见 `web/app/lib/provinceAdcodes.ts`，`scripts/validate.py` 会断言这个数量）。

---

## 六、采集流水线与校验

流水线在 `pipeline/`，入口 `run.py`。依赖：`pip install -r pipeline/requirements.txt`。

```bash
E:/BASIC/python/python.exe pipeline/run.py usage             # 今日额度 + 取点走哪家图商
E:/BASIC/python/python.exe pipeline/run.py pipeline chengdu  # ③地理编码 → ④取图 → ⑦区划树 → 组装校验
E:/BASIC/python/python.exe pipeline/run.py geocode  chengdu  # 只补坐标（--force 强制重算）
E:/BASIC/python/python.exe pipeline/run.py images   chengdu  # 只取图
E:/BASIC/python/python.exe pipeline/run.py district          # 生成区划树
E:/BASIC/python/python.exe pipeline/run.py build             # 全量组装 + 校验 + 生成索引与 credits
E:/BASIC/python/python.exe pipeline/run.py build --city chengdu   # 只组装一城（★ 会重写 cities.index.json）
```

★ 命令一律在**仓库根**执行，python 写全路径（依赖只装在 `E:/BASIC/python/python.exe`）。

任何触碰 `data/` 的 PR 都应跑通 `build`。**校验不通过不允许合并** —— 这是"格式统一"唯一可靠的保障，靠人自觉没用。

### 6.1 key 从哪来

脚本**拿不到** Vite 注入的 `import.meta.env`，统一走 `pipeline/core/env.py`（2026-09-30 起**配置按工程分家**）：
先读真实环境变量，再读 `pipeline/.env.local` → `pipeline/.env`，最后才兜底读 `web/.env.local` → `web/.env`
（前者不覆盖后者；从 `web/` 捡到采集侧 key 时会打印一次迁移提示）。
**采集侧的 key 一律放 `pipeline/.env.local`**，前端那把 `VITE_TMAP_KEY` 放 `web/.env.local`。

- `TMAP_WEB_KEY` —— 腾讯 WebService key（地理编码 / 区划），**推荐单独申请**
- `VITE_TMAP_KEY` —— 前端 JSAPI key。只有它在腾讯后台**同时开通了 WebService 权限**时才可作兜底（脚本会打印提示）
- `UNSPLASH_ACCESS_KEY` / `PEXELS_API_KEY` —— 可选，缺则自动降级

⚠️ Vite 只认 `.env` / `.env.local` / `.env.[mode]`；`pnpm dev` 的 mode 是 **`development` 全称**，
所以 `.env.dev` **永远匹配不上**且失败完全静默。本机配置一律放 `.env.local`。

### 6.2 已踩过的坑（都写进代码注释了，这里做索引）

| 现象 | 根因 | 处理 |
|------|------|------|
| `ImportError: attempted relative import` 指向 `http.client` | `harvest/http.py` **遮蔽了标准库 `http` 包**（脚本直接运行时脚本目录会进 `sys.path[0]`） | 改名 `fetch.py`。同理别用 `env`/`layout`/`build` 之外的标准库名 |
| 百度百科全量取不到图 | 桌面版 `baike.baidu.com` 对脚本一律 **403**（补全 UA/Referer 也无效） | 改走移动端 `wapbaike.baidu.com`（200 且带图链） |
| 同一个 POI 的 3 张图其实是同一张 | `pic/xxx`（原图）与 `smart/xxx-bkimg-process,…`（变体）是两条链接 | 按"去掉处理后缀的文件名"去重 |
| 小众点位取不到图 | 百科没有"IFS 爬墙熊猫"这类新晋网红词条 | 数据里人工补 `_imageQuery.baike`（精确词条名），可溯源 |
| 坐标对但**是另一个点** | 地理编码模糊匹配：adcode 前 4 位相同就放行 | ★ 追加**名称一致性**校验：`name` 的核心字符必须全出现在接口返回的 `title` 里（单向，不是双向子串） |
| 重跑时 `AttributeError: 'bool' object has no attribute 'get'` | 缓存用 `False` 表示"确认没命中"，被当 dict 用 | `tmap.geocode` 在返回处归一化成 `dict \| None` |
| `AttributeError: 'list' object has no attribute 'get'`（区划） | 腾讯三个区划接口的 `result` **形状各不相同**（list 包数组 / 数组 / 对象数组） | `tmap._flatten_nodes()` 统一展平 |
| 有 ERROR 时 schema 问题被掩盖 | `build` 原本只在零 ERROR 时才跑 Pydantic | 改成错误 ≤20 条时**总是**跑（形状错误是根本性的） |

### 6.3 地理编码的质量闸门（★ 最要紧的一条）

坐标不是"拿到就行"。step3 对每个 POI 依次做三重判定，任一不过就作废换下一级关键词：

1. **同城**：命中结果的 adcode 前 4 位 == 城市 adcode（拦"人民公园"这种全国同名）
2. **同名**：`name` 去掉括号/标点/城市前缀后的字符**全部**出现在接口 `title` 里
3. 关键词三级：精确名 → 区县 + 名 → **人工地址**（地址比店名精确得多，实测救回 14 个点）

跑完还会扫一遍**坐标重合**（不同 POI 落在同一个点 = 至少有一个错）。
实测拦下的真实事故：成都自然博物馆被解析成成都博物馆（相距 10 公里，adcode 校验完全看不出来）。

### 6.4 图商配额：120 与 121 要分清

> ⛔ 「通勤矩阵」这一步已随 `transit.json` 一起删除（见第三节），但**额度的坑没变** ——
> 取点、区划、路线规划走的是同一套配额账本。

- 腾讯按**计算次数**计费，**失败的那次同样计费** —— 宁可主动等，也别被限流后重试
- `status=120` 是"每秒请求量已达上限"（措辞有误导性，实际多为额度 / 窗口问题）；`121` 才是明确的日配额耗尽。
  取点侧遇到 121 会自动切高德（`providers/geoprovider.py`），取图与区划侧只能等明天
- 账本在 `_generated/api-usage.json`，`pipeline/run.py usage` 直接看（同时报「现在走哪家、备胎在不在」）

---

## 七、图片地址与镜像（★ 国内可访问性）

**数据里存的是图源的原始地址，不是能直接塞进 `<img src>` 的地址。**

| 域名 | 实测（2026-09-22，IPv4 / IPv6 各三次） | 结论 |
|------|-------------------------------------|------|
| `commons.wikimedia.org`（API） | 200 · 3.1s | 搜索可用 |
| `upload.wikimedia.org`（原图） | **000 · 15s 超时** | 取不到 |
| `thumb.wikimedia.org`（缩略图） | **000 · 15s 超时** | 取不到 |
| `images.pexels.com` | 200 · 1.0s | 直链可用 |

即 **Wikimedia 搜得到、取不到** —— 库内 643 张 Wikimedia 图若按原地址直连，
国内用户看到的是全白，而脚本端与海外网络都察觉不到。

**处理**：前端在数据出口统一改写（`web/app/common/data/imageMirror.ts`），
把 `upload` / `thumb` 域名的地址改写成镜像后再交给 `<img>`。

> ⚠️ 换图源或换镜像服务**只改那一处**，不要回头改 JSON。
> 数据保持原始地址是为了可溯源（`credit.sourceUrl` 指向 Commons 页面）；
> 一旦把镜像域名写进数据，将来换镜像就得重跑整条流水线。

**两个出口都要接**，漏一个就会出现部分页面有图、部分全白：

| 出口 | 覆盖 |
|------|------|
| `loadCity()` | POI 图集、城市 hero 图 |
| `loadCityIndex()` | `cities.index.json` 的 `coverImage`（脚本产物，不经过 `loadCity()`） |
