# pipeline · 数据采集流水线

**只做抓取。** 本目录下的脚本只**写** `data/`，不 import `web/` 的任何东西；
展示工程（`web/`）只**读** `data/`，不 import 本目录。
两边共用的字段契约在仓库根的 `schema/`（`schema.py` ↔ `schema.ts`）。

---

## 跑法

**在仓库根执行**（脚本会把仓库根塞进 `sys.path`，`pipeline` 与 `schema` 两个包都从那一层解析）：

```bash
pip install -r pipeline/requirements.txt

python pipeline/run.py usage               # 先看今日 API 额度 + 取点走哪家图商
python pipeline/run.py geo-check 北京 故宫   # 新 key 配完先跑它，真发请求确认两家都能取点
python pipeline/run.py pipeline chengdu    # 完整流水线 ③④⑦ + 组装
python pipeline/run.py geocode  chengdu    # 只补坐标（--force 强制重算）
python pipeline/run.py entrance chengdu    # 只补「到达点 / 入口坐标」（高德 entr_location）
python pipeline/run.py images   chengdu    # 只取图
python pipeline/run.py district            # 只生成区划树
python pipeline/run.py outline             # 省级自身轮廓（高德，一次性静态数据）
python pipeline/run.py cities              # 市级自身轮廓（高德，按省打包可续）
python pipeline/run.py district-outline    # 区级自身轮廓（高德，按市打包可续）
python pipeline/run.py build [--strict] [--city=x]   # 只做组装 + 校验 + 生成索引
```

也可以从 `web/` 走 npm 脚本：`pnpm data:build` / `pnpm data:validate`。

`--strict` 是 CI 模式：任一 **WARN** 也算失败。

扩城前先体检采编稿（**必跑**，能在入库前把写错的字段一次拦下来）：

```bash
python tools/check_seed.py --all           # 或python tools/check_seed.py <城市id>
```

## 步骤顺序不能乱

```
① 搜索 → ② 抽取（seeds/{city}.py + seed.py）
③ 地理编码 ── 拿 GCJ-02 坐标
③b 到达点 ── 高德 entr_location（不跑会让路线穿园）
④ 取图     ── Unsplash → Pexels → 百度百科
⑦ 区划树   ── 读所有已入库 POI
⑧ 市辖区   ── 第四级（区）数据与边界
   组装 · 校验 · 生成索引（build.py）
```

★ **⑥ 通勤矩阵已移出流水线**（2026-10-06 决策）：通勤时长改为用户实际规划时
**运行时**请求图商，采集期绝不预存（62 城 × 约 1600 对 × 3 方式要几百 MB，
且半改会造成跨城口径不一致）。`steps/step6_transit.py` 是遗留死链路，**不要跑**。

③④ 需要腾讯 WebService key（`TMAP_WEB_KEY`），④ 另需图片站 key。
`outline` / `cities` / `district-outline` 需要高德 key（`AMAP_WEB_KEY`）。
没配 key 会**直接报错退出**，不会带着占位符发一堆必然失败的请求。

## 模块

**顶层只有 `run.py`（唯一入口）**，其余按职责分六层。

**`core/`（基础设施，被全体依赖，不 import 任何上层）**

| 文件 | 职责 |
|------|------|
| `core/layout.py` | `data/` 目录布局的**单一真源**（路径只在这里拼） |
| `core/env.py` | env 文件与 key 读取（含占位符兜底判断） |
| `core/fetch.py` | 请求纪律（UA / 节流 / 退避重试）+ 配额记账 |
| `core/fix_noise.py` | 长中文里的英文噪声词清理 |

**`providers/`（图商适配）**

| 文件 | 职责 |
|------|------|
| `providers/tmap.py` | 腾讯位置服务 WebService 封装 |
| `providers/amap.py` | 高德 Web 服务（轮廓 / 入口坐标 / 地理编码备用） |
| `providers/geoprovider.py` | ★ **取点唯一入口**：腾讯优先，配额尽自动换高德 |

**`geo/`（区划与几何）**

| 文件 | 职责 |
|------|------|
| `geo/citymeta.py` | 城市 adcode / center / bbox（全部接口实测，不手填） |
| `geo/districts.py` | 区级几何与"点位归区"（第四级显示的地基） |
| `geo/districtless.py` | 38 个不设区的市 → 折叠成"一个节点 = 市自身" |
| `geo/labelgeo.py` | 徽标落点 = **面内视觉中心**（腾讯给的 `center` 是政府驻地，不对） |

**`authoring/`（采编稿与图源）**

| 文件 | 职责 |
|------|------|
| `authoring/seedlib.py` | 种子稿 → POI 的公共构造（**大类归属由 `seedlib.CATEGORIES` 定死**） |
| `authoring/seed.py` | 跑 `seeds/*.py` 生成 `city.json` + POI 分片 |
| `authoring/images.py` | 图片三级降级 + 带站外 Referer 的探活 |

**`steps/`（采集步骤，一文件一步）**

| 文件 | 职责 |
|------|------|
| `steps/step3_geocode.py` | ③ 地理编码 |
| `steps/step3b_entrance.py` | ③b 到达点 / 入口坐标 |
| `steps/step4_images.py` | ④ 取图 |
| `steps/step6_transit.py` | ⑥ 通勤矩阵 ★ **死链路，不要跑** |
| `steps/step7_district.py` | ⑦ 区划树 + 聚合计数 |
| `steps/step8_subdistricts.py` | ⑧ 市辖区（区级）数据与边界 |
| `steps/step9_province_outline.py` | ⑨ 省级自身轮廓（高德） |
| `steps/step10_city_outlines.py` | ⑩ 市级自身轮廓（高德） |
| `steps/step11_district_outlines.py` | ⑪ 区级自身轮廓（高德） |
| `steps/step12_discover.py` | ⑫ **点位发现**：按类目关键字搜图商，找库里没有的景点 → 候选清单（**不入库**） |

★ ⑫ 与 ③⑦⑪ 的性质完全不同：它**不产出数据、只产出候选**。
  候选落`data/_generated/discover/{城市}.json`，build **不读它**
  （不在 `data/cities/` 下，已验证产物里 grep 不到）。
  要入库得人工把条目搬进 `seeds/{城市}.py` 再跑 seed。
  ★ **配额限制**：每城要搜 36 次，而 `place_search` 只有 200/日
  ⇒ **一次只能跑一城**，全量 83 城永远跑不完。定时任务「行迹·每日拓点位」
  按 14 城轮转表一天一座。
  ★ **去重必须归一化**：图商叫「青城山风景区」、库里叫「青城山」，
  精确名比对挡不住（实测成都 5 个国家级景点里 3 个是误报）。

★ 编号不连续（没有 1/2/5）：①② 就是 `seeds/` 里的采编稿本身；⑤ 从未存在过。
  ⑨⑩⑪ 是后补的轮廓换源，**不进全量流水线**（那会让整条依赖一把高德 key）。

**`assemble/` + `seeds/`**

| 文件 | 职责 |
|------|------|
| `assemble/build.py` | 组装 + 校验 + 生成索引与 credits（**唯一往 `data/_generated/` 写的**） |
| `seeds/` | **83 城**各一份采编稿（纯数据，人写） |
| `.cache/` | 采集缓存（git 忽略） |

## 几条硬约定

- **`data/` 是唯一交接面**：抓取只写、展示只读，谁都不import 对方。
- **改已入库的数据用一次性脚本，别重跑 `seed.py`** —— 它会清空 `point` 与 `images`。
  那种脚本**用完即删**，别留在仓库里（写死城市/批次的，半年后没人看得懂）。
- **降级链上的"拿不到"不算 ERROR**：取不到图走 `_noImage` 标记（前端占位卡）——
  在 `build.py` 里是 **WARN**。
  ★「缺 transit」那条 WARN 现在是**假告警**：通勤已改运行时算，不代表数据缺口。
- **坐标三重闸门**（同城 / 同名 / 关键词级）+ 扫坐标重合。
- **新图源落库前必做「带站外 Referer」探活**。
- **分类归属由 `seedlib.CATEGORIES` 定死**：`scenic(nature/museum/historic/park/temple)`、
  `food(local/snack/cafe)`、`hotspot(photo/art)`、`culture(street/performance)`。
  **博物馆属 scenic，街区与演出属 culture**。
- **菜品不能当 POI**；地址只写到街道级。
- `audience` 只收 6 个英文枚举，中文由 `seedlib.AUDIENCE_ALIASES` 映射；
  兴趣词**丢弃不编造**。

更细的坑与数据格式见 `../data/README.md` 与 `../plans/04-*`；
工程护栏与体检工具见 `../tools/`。
