# 每日定时任务 · 图片重抓 + 审查备料

> **一句话**：定时任务**只备料**（重抓图片 + 拼好对照表），**审查在会话里做**（看图判定 → 回写 → build）。
> 任务名「行迹 · 每日图片重抓 + 审查备料」· 每天 00:00 · 每次滚动 2 城 · 进度以 `status` 为准（已审 2/83）。

**读这份文档的人**：下一个接手定时任务的模型 / 半年后的自己 / 想把这件事自动化得更彻底的你。
**改任务之前**：先读第 7 节（换执行者 checklist）。**出问题**：直接跳第 8 节（排错速查）。

---

## 一、为什么有这个任务

站里有 **83 城 / 4820 个 POI**，图片全部来自采集流水线。旧管线有两个硬伤：

| 硬伤 | 表现 | 后果 |
|---|---|---|
| 固定收 3 张（`max_keep=3`） | 全库 89% 的点位"恰好 3 张"（2026-10-28 实测，修复前 4297/4808） | 能搜到 8 张也只留 3 张；不够 3 张就拿"品类氛围图"垫 |
| 零内容校验 | Wikimedia 按**文字**相关度返回，前 3 条直接入库 | 「西安地铁青龙寺站」标题里同时有"青龙寺""西安"⇒ 排在第一位 ⇒ 进了详情页 |

2026-10-29 起，采集侧已修（上限 6 张 / 入库前过相关性过滤 / 同城 URL 去重 / 配图库停用），
但**其余城市仍是旧数据**，必须逐城重抓 + 逐城过审查。这就是这个任务存在的原因。

实测两城的错误率（我逐格看图判的）：

| 城市 | 封面数 | 判为错图 | 典型错法 |
|---|---|---|---|
| 西安 | 57 | **30（53%）** | 北京回民小学挂在回民街 · 绍兴咸亨挂 5 家饭馆 · 阳朔航拍挂 3 处 · 马路照挂青龙寺 |
| 长春 | 57 | **33（58%）** | 星球大战 Chewbacca 挂长影老摄影棚 · 上海的古塔挂农安辽塔 · 新西兰溶洞挂吊水壶 |

> ★ 错图里**标题全都是对的**（"Qinglong Temple, Xi'an" 就是那张马路照的文件名）。
> 元数据过滤只能拦"说得明白的错"（地铁站 / 地图 / 坐标十万八千里），
> **"标题对、画面是别的东西"只有看图能发现** —— 这是整个流程必须有人在回路里的唯一原因。

---

## 二、角色分工（这套流程唯一重要的一件事）

| | 定时任务（独立进程） | 会话里（能读图的执行者） |
|---|---|---|
| **做** | `next` 选城 → `images --force` 重抓 → 再跑一趟补 `_noImage` → `sheet` 出对照表 → 记账 `refetched` → 写日报 | 读对照表逐格看图 → 写 `verdicts-covers.jsonl` → `apply` 回写 → 记账 `reviewed` → `build` |
| **不做** | **不 build**（未过审的图不许进产物）· **不 apply**（没有判定依据 = 瞎删）· **不 commit**（未审数据不进版本库）· 不按标题猜对错 | 不改采集代码（那是另一件事，另开一轮） |

**为什么"不 build"是硬约束**：审查前的图是**未经审视的新图**。让它进索引/产物，
等于把未过审的数据当成品发布 —— 而 build 之后前端缓存、产物哈希、部署都会跟着变，
错图就从"待审"变成"已上线"。

**为什么也不许 commit**：2026-10-31 00:30 那次任务跑完自己 `git commit`（message「城市信息补充」），
把 changsha / chengde 的 **113 个未审文件**提交进了版本库 —— 等于绕过审查这道关（数据会被别人 pull 走、
被部署链路读到）。build 与 commit 都是"让数据出门"，两者都要等审查完。

**为什么审查不能自动化（至少现在不能）**：
- 没有视觉模型 key，也没有可靠的"图对不对"的文本替代品 —— 文字判据已被证伪（见上表）。
- 按 alt/标题过滤会漏掉一半（青龙寺那张就是反例），按"图源"过滤会误杀（Wikimedia 本身是好源）。

⇒ 所以分工是：**机器做耗时的（下载/重抓/拼图），人做判断的（看一眼）**。

---

## 三、任务配置

| 项 | 值 |
|---|---|
| 名称 | 行迹 · 每日图片重抓 + 审查备料 |
| id | `7206d74a-948b-43d4-8d8f-2f92b301e74e` |
| 频率 | `FREQ=DAILY;BYHOUR=0;BYMINUTE=0`（每天 00:00） |
| 每次工作量 | 2 座城（第一城超 40 分钟就只做一座） |
| 工作目录 | `E:/code/travel_strategy` |
| 状态 | ACTIVE |

### 3.1 prompt 原文（改任务 = 改这段）

````text
在 E:/code/travel_strategy（行迹 · 城市旅游攻略）做**每日图片重抓 + 出审查对照表**：每天滚动 2 座城，把旧管线留下的「固定三张 / 文不对题」的图按新规则重抓，并把待审对照表备好，等我在会话里看图判定。

★★ 定位：**你只备料**。图对不对只能靠看图判断，那是会话里的下一步 —— 所以你不入库、不 build、不 apply、不提交。

背景（为什么要做这件事）：旧采集逻辑是「固定收 3 张 + 按文字相关度原样收下」，中间没有"看一眼"的环节。西安试点 57 个封面里我判出 30 张错的、长春 57 个封面里判出 33 张错的（长影老摄影棚挂着星球大战 Chewbacca、农安辽塔挂着上海的古塔、吊水壶溶洞挂着新西兰溶洞）。新采集逻辑已上线（上限 6 张 / 入库前过相关性过滤 / 同城 URL 去重 / **配图库已停用**），但**其余城市仍是旧数据**（还剩几城看 `next` / `status`），必须逐城重抓 + 逐城过审查。

## 环境（独立进程，不继承任何会话环境）
1. 每条命令先 `cd /e/code/travel_strategy`。
2. python 写全路径 `E:/BASIC/python/python.exe`，**禁用裸 `python`**（依赖装在这个解释器上）。
3. `images` / `sheet` 都放后台跑再收输出，前台会撞超时（一座城 images 约 15 分钟）。

## 步骤

### 1. 选城
```
E:/BASIC/python/python.exe tools/review_images.py next --count 2
```
每行一个城市 slug（POI 少的先做）。进度账本在 `.workbuddy/memory/image-rebuild.json`。
**一次最多 2 座**；若第一城已耗时 >40 分钟，就只做一座，别硬撑。
想看全局进度：`E:/BASIC/python/python.exe tools/review_images.py status`。

### 2. 每城重抓图片（两趟，顺序不能换）
```
E:/BASIC/python/python.exe pipeline/run.py images <city> --force
E:/BASIC/python/python.exe pipeline/run.py images <city>
```
- 第一趟 `--force` 是必须的：库里大多数点位是旧管线「恰好 3 张」，不重算就永远是三张。
- 第二趟**不带** `--force`：Wikimedia 偶发断连会让有真图的点位被误标 `_noImage`（西安城墙实测：第一趟空、重试拿到 6 张真图）⇒ `_noImage` 是"待重试"不是终态。
- 输出里记下 `empty` / `_noImage` 的点位名。（确认图源没有实景 = 前端渲染占位卡，build 里是 WARN 不是 ERROR，不用管。）
- ★ 输出开头会打印「可用图源」。**只应出现 `wikimedia`**；若出现 `pexels` / `unsplash`，说明 `USE_STOCK_SOURCES` 被绕过了 —— 那是配图库（主题配图，不是地点照片，且没有 GPS/分类元数据、过滤器拦不住），**立刻停下并写进日报**，不要继续。

### 3. 出对照表（备料给我审查）
```
E:/BASIC/python/python.exe tools/review_images.py sheet <city> --covers --refresh
```
产出 `_tmp/review/<city>/sheet-covers-*.png` 与 `manifest-covers.json`。
每格左上角烧着白底 `#序号`（我按它判定），个别格子下载失败会标红「[下载失败]」，**不用补跑**。

### 4. 记账
把本批城市 slug 追加进 `.workbuddy/memory/image-rebuild.json` 的 `refetched`。
**`reviewed` 不要动** —— 那是我在会话里审完才记的。

### 5. 日报（**只许追加**）
`cat >> .workbuddy/memory/<YYYY-MM-DD>.md`（写之前先 `ls` 确认文件是否已存在，**绝不用 `cat >`**），内容：
- 重抓了哪几座城、每城图片数分布（0/1/2/…/6 各多少个 POI）
- 确认无实景（`_noImage`）的点位清单
- 对照表路径 + 待审张数
- 结尾固定写一句：**「以上对照表等待我在会话里逐格看图判定（review_images.py apply 回写），未审前不跑 build」**
- 顺带看一眼 `.workbuddy/memory/discover-intake.json`：若某城还有大量未入库候选，在日报里提一句提醒我即可（**不要自己入库**）。

## 禁止
- **不跑 `pipeline/run.py build`** —— 未审查的图不许进前端索引/产物。build 由我在审查回写后再跑。
- **不跑 `tools/review_images.py apply`** —— 你没有判定依据，跑了等于瞎删。
- **不要 `git add` / `git commit`** —— 未审的图不许进版本库（2026-10-31 00:30 那次自动提交了 changsha/chengde 的 113 个未审文件，等于绕过了审查这道关）。提交与部署由我在审查回写后做。
- 不自己"看图判定"，也不许按标题/alt 文字猜对错 —— 已证明文字完全对也可能是错图（青龙寺那张马路照的文件名就叫 "Qinglong Temple, Xi'an"）。
- 不要建议"补配 Pexels/Unsplash key 来补实景" —— 配图库已用两城实测证伪（搜「农安辽塔」给上海的古塔、搜「冰雪新天地」给泛用冰城堡，且无 GPS/分类元数据、过滤器拦不住）。缺图的正确出路是**占位卡** / 人工补图 / 改进 Wikimedia 查询策略。
- 绝不跑 `run.py seed`（它按采编稿整体重建，会清空全城 point 与 images，不可恢复）、`run.py discover`（83 城全缓存，零产出）、`run.py entrance`（图商接口已封）、`step6_transit`（死链路）。
- 不改 `pipeline/.env.local` / `web/.env.local`，不清 `pipeline/.cache/`。
- 日志文件只许 `cat >>` 追加（曾因 `cat >` 覆盖写毁掉过一整天的记录）。
- 收尾可跑一次 `E:/BASIC/python/python.exe tools/check_app.py`，正常应为 ALL_CLEAN；若 AV 报红，把原因写进日报。
````

### 3.2 prompt 里刻意**不写**的东西

| 不写 | 原因 |
|---|---|
| 「还剩 81 城」这种数字 | 每天都会变，写死就要天天改 prompt；让工具用 `next` / `status` 自己算 |
| 具体城市名单 | 同上（顺序由 `next` 按 POI 数排，可复现） |
| 判定标准 / 黑名单 | 判定在会话里做，写进 prompt 只会引诱执行者"按文字猜" |
| 时间预算的数字 | 只写"超 40 分钟就只做一座"这种**判断规则**，不写"预计 15 分钟" |
| 「补配 Pexels/Unsplash key 就能补实景」这类**建议** | 配图库已两城实测证伪。2026-10-31 首次跑就在日报里写了这句（它没真去配，但会误导读日报的人）⇒ 已写进 prompt「禁止」 |

---

## 四、每次执行具体做什么

```
next --count 2
   ↓  拿到 2 个 slug（POI 少的先做，跳过账本里 refetched 过的）
images <city> --force          ← 强制重算，否则旧数据"恰好 3 张"永远不会变
   ↓
images <city>                  ← 不带 force：只重试带 `_noImage` 的点位（网络抖动误标）
   ↓
sheet <city> --covers --refresh ← 下缩略图 + 拼 4×5 对照表 + 写清单
   ↓
账本 refetched += slug · 日报追加
```

### 为什么是这两趟（顺序不能换）

| 趟 | 命令 | 为什么 |
|---|---|---|
| 1 | `images --force` | 旧数据 89% 是"恰好 3 张"。不带 force 会走 `have and not force → skip`，永远修不到 |
| 2 | `images`（不带） | 第一趟里 Wikimedia 偶发断连时 `search_wikimedia` **静默返回空**，点位被标 `_noImage`。西安城墙第一趟被误标"没图"、重试拿到 6 张真图 ⇒ 必须有第二趟 |

### 为什么对照组是"封面"而不是全量

一个点位最多 6 张图，全量审 4820×5 ≈ 2.4 万张，看图成本不可承受。
**封面（`coverIndex=0`）是详情页首图、也是卡片图**，错得最显眼、最该先修。
非封面图的错留到以后（账本 `image-rebuild.json` 的 `_note` 已写明这个边界：
`reviewed = 封面已过审查；非封面图尚未逐张看` —— 不要假装全审过了）。

---

## 五、会话侧 SOP（审查这一步，换模型时最该照抄的部分）

```bash
# 0. 先看有没有"已重抓未审"的城
E:/BASIC/python/python.exe tools/review_images.py status

# 1. 读清单：序号 ↔ 点位名 ↔ alt（文字侧先扫一遍，能白捡一批明显的错）
E:/BASIC/python/python.exe -c "
import json
for e in json.load(open('_tmp/review/<city>/manifest-covers.json',encoding='utf-8')):
    print(e['idx'], e['poi'], '|', e['alt'][:60])
"

# 2. 逐张看对照表（sheet-covers-00/01/02.png），按图内左上角 #序号 判定

# 3. 写判定（一个 idx 一行；ok 可不写 note，reject 必须写清"这是什么"）
cat > _tmp/review/<city>/verdicts-covers.jsonl <<'EOF'
{"idx": 0, "verdict": "reject", "note": "星球大战 Chewbacca 影棚照"}
{"idx": 1, "verdict": "ok", "note": "净月潭实景"}
EOF

# 4. 先演练再落盘
E:/BASIC/python/python.exe tools/review_images.py apply <city> --dry
E:/BASIC/python/python.exe tools/review_images.py apply <city>

# 5. ★ 删图后**再出一轮新封面**，再审一遍（见下）
E:/BASIC/python/python.exe tools/review_images.py sheet <city> --covers --refresh

# 6. 补被删空的点位（不带 --force，不会碰已审过的封面）
E:/BASIC/python/python.exe pipeline/run.py images <city>

# 7. 全量 build（★ 单城 build 会把 cities.index.json 覆盖成只剩一城）
E:/BASIC/python/python.exe pipeline/run.py build

# 8. 记录 + 自检
E:/BASIC/python/python.exe tools/check_app.py     # 期望 RESULT: ALL_CLEAN
```

### 5.1 三个"审查白做"的坑（都已写进工具，但你要知道为什么）

| 坑 | 现象 | 现在的做法 |
|---|---|---|
| 序号与格子**错位** | 读图的一方把 `#5` 判成 `#1` ⇒ 删错图 | 序号**烧进每格左上角**白底方框（不只在格下方写小字） |
| 删图后**新封面没审** | 删掉封面后 `coverIndex=0` 指向原来的第 2 张（没审过） | 删完**必须再出一轮 sheet 再审**。长春一审删 33 张，二审又从新封面里判出 30 张错的 |
| 判定**按位置猜** | 表格最后一列/行不满时，位置推断必错 | 一律按格内 `#序号` 作答；空白格写"空白" |

### 5.2 图下不来怎么办

`[下载失败]` 的格子**不补跑**（wsrv.nl 偶发超时）。按 Commons 文件页判定，
并在 `note` 里标「图未下成，按文件页判定，待复核」—— **不许默默放过**。
判定会按 URL 进全局缓存 `_tmp/review/verdicts-cache.jsonl`，**reject 过的图永远记住**（下轮重抓不会回来）。

---

## 六、文件与状态

| 路径 | 是什么 | 谁写 | 进 git |
|---|---|---|---|
| `.workbuddy/memory/image-rebuild.json` | **进度账本**：`refetched`（抓过）/ `reviewed`（审过）两个名单 | 定时任务写前者、会话写后者 | ❌（`.workbuddy/` 整目录忽略） |
| `.workbuddy/memory/discover-intake.json` | 候选入库账本（另一个任务的事，别混） | 入库任务 | ❌ |
| `.workbuddy/memory/<date>.md` | 每日工作日志（**只许 append**） | 两边都写 | ❌ |
| `.workbuddy/memory/MEMORY.md` · `TRAPS.md` | 项目索引 / 踩坑叙事 | 会话 | ❌ |
| `_tmp/review/<city>/sheet-covers-*.png` | 对照表（4×5=20 格/张） | `sheet` | ❌（`_tmp/` 忽略） |
| `_tmp/review/<city>/manifest-covers.json` | 序号 ↔ 点位 ↔ alt ↔ url | `sheet` | ❌ |
| `_tmp/review/<city>/verdicts-covers.jsonl` | 逐格判定 | **会话（人/模型）** | ❌ |
| `_tmp/review/<city>/thumbs/` | 缩略图缓存（按 scope 命名） | `sheet` | ❌ |
| `_tmp/review/verdicts-cache.jsonl` | 判定缓存（key=URL，跨城共享） | `apply` | ❌ |
| `data/cities/<省>/<市>/pois/**/*.json` | POI 数据（含 `images[]`） | `apply` / `step4` | ✅ **进 git** |

★★ **账本不进 git**：换机器/清工作区会丢进度。丢了就从 `_tmp/review/*/` 目录名 + 数据分布反推，
或者干脆从 `status` 输出的"已重抓未审"重新开始 —— 不要凭空重置（重置会让已审城市再抓一遍、
把 reject 缓存之外的错图重新抓回来）。

### 6.1 数据字段速查（改 `apply` 时要动这些）

| 字段 | 含义 |
|---|---|
| `images[]` | `{url, thumbUrl, width, height, alt, query, credit{source,author,sourceUrl,license,attributionRequired}, review?}` |
| `coverIndex` | 封面下标，**恒为 0**（删图后重置） |
| `_noImage` | `true` = 图源确实没有实景 ⇒ **待重试标记，不是终态**；build 降级为 WARN，前端走占位卡 |
| `images[].review` | `{verdict, by, at}`，审查留痕 |
| `updatedAt` | 业务字段变更时间（改图要写） |

---

## 七、换执行者 / 换模型时怎么改（checklist）

### 7.1 硬约束（改了就会出事）

1. **prompt 必须自包含**。定时任务是**独立进程**，看不到任何会话上下文 ——
   背景、命令、禁止项都要写进 prompt 本身（本文档第 3.1 节就是全文）。
2. **python 写全路径** `E:/BASIC/python/python.exe`。裸 `python` 在这台机器上可能命中另一个解释器
   （依赖装在 `E:/BASIC/python`）。同理 git 用 PortableGit 的路径且**探测不写死**。
3. **保留"只备料"的分界**。任何"顺手 build 一下""顺手 apply 一下"的改动都要否掉：
   没有判定依据的 apply = 随机删图，且**零报错**。
4. **保留账本两个名单的语义**。`refetched` 与 `reviewed` 合并成一个 = 永远不知道哪些城还没审。
5. **不要把审查交给没有视觉能力的执行者**。做不到就退回"只备料 + 人工审"，
   千万不要退化成"按 alt 关键词判" —— 那比不审更危险（看起来审过了）。

### 7.2 改了之后必须验证

```bash
# ① 选城能跑（不该崩）
E:/BASIC/python/python.exe tools/review_images.py next --count 3
E:/BASIC/python/python.exe tools/review_images.py status

# ② 实跑一座小城（别等第二天才发现命令拼错）
E:/BASIC/python/python.exe pipeline/run.py images <小城> --force
E:/BASIC/python/python.exe tools/review_images.py sheet <小城> --covers

# ③ 打开 sheet-covers-00.png 看一眼：格子有图、左上角有 #序号、顺序与 manifest 一致

# ④ 护栏（新加判据必须做反证，见第 9 节）
E:/BASIC/python/python.exe tools/check_app.py
```

### 7.3 想扩大/缩小规模时

| 想改 | 怎么改 | 注意 |
|---|---|---|
| 每天 2 城 → 4 城 | 改 `next --count 4` + prompt 里的"一次最多 N 座" | 一座城约 15 分钟；4 城 ≈ 1 小时，别撞进程超时 |
| 只审封面 → 审全量 | `sheet <city>`（不带 `--covers`） | 张数 ×5（≈2.4 万），得先解决看图成本；`manifest` 会按 scope 分文件 |
| 换图源 | 改 `pipeline/authoring/images.py` + 护栏 AV | **别把配图库加回来**（Pexels/Unsplash 已证伪，见 TRAPS.md） |
| 加视觉模型自动审 | 在 `apply` 前插一层，输出仍写 `verdicts-covers.jsonl` | 模型判定要留 `note`，且**人的复核不能省**（模型对"同名异地"很弱） |

---

## 八、排错速查

| 症状 | 原因 | 处理 |
|---|---|---|
| 输出里出现 `pexels` / `unsplash` | `USE_STOCK_SOURCES` 被绕过（或改回 True） | 停下，检查 `images.py` 的开关与调用点；护栏 AV ②½ 会报红 |
| 图片数又变整齐的 3 张 | 跑了不带 `--force` 的第一趟，或 `MAX_PER_POI` 被改回 3 | 重跑 `--force`；护栏 AV ① 会报红 |
| 某点位 `_noImage` 但明明有图 | 上一轮网络抖动误标 | 再跑一趟 `images <city>`（不带 force，会重试带标记的点位） |
| `apply` 之后图明显删多了/删错了 | `manifest` 与 `--covers` 不匹配（用了全量清单对封面判定） | 看 `manifest-covers.json` 的 idx 是否是判定的那批；**先 `--dry` 是唯一防线** |
| 对照表某格是红的「[下载失败]」 | wsrv.nl 超时 | 不补跑；按文件页判定并标"待复核" |
| `check_app` 的 AV 报红说找不到某段代码 | 大概率是**去注释函数用错**（Python 文件被 TS 版处理，`/*` 吃掉整段） | 见第 9 节；用 `strip_py_comments` |
| `build` 之后站点只有一城 | 跑了 `build <city>`（单城），它覆盖了 `cities.index.json` | 跑全量 `build` 恢复；这是已知行为，不是 bug |
| `build` 撞 `SAFE_DELETE_BULK_CONFIRM_REQUIRED` | `web/dist` 1 万+ 文件超过清理阈值 | `NODE_OPTIONS= CODEBUDDY_SAFE_DELETE_ENABLED=0 npx react-router build` |
| 定时任务没留下任何日志 | 用了 `cat >` 覆盖写，或任务没跑 | 查 `.workbuddy/memory/<date>.md` 是否存在；**日志只许 `>>`** |
| `git log` 出现「城市信息补充」且含未审城市的 data | 任务自作主张提交了（2026-10-31 首次） | prompt「禁止」已加一条；已提交的留在历史里，审查后 `apply` 的 diff 会覆盖它 |
| 日报里出现"补配 Pexels key 补实景"的建议 | 边界没写死在 prompt 里 | prompt「禁止」已加一条；看到这类建议直接忽略，缺图的正解是占位卡 / 人工补图 |

---

## 九、护栏与反证（改任何相关代码都要做）

新加的判据**必须能证明它会报红**（`_tmp/revert_probe_images.py` 就是干这个的：逐条把实现改坏 → 跑
`check_app` → 必须报红 → 还原）。当前 AV 段守 6 组：

| 组 | 守什么 |
|---|---|
| ① | 张数上限是 6（不是 3），且没有 `CATEGORY_FALLBACK`（氛围图垫底不许回来） |
| ②½ | `USE_STOCK_SOURCES` 存在且为 `False`，且**调用点**受它控制（只写开关不接上去 = 绕过） |
| ③ | `step4` 真的调了 `verdict_for(`（候选图必须过相关性过滤才入库） |
| ④ | `_filterMeta` 在入库前被 `pop`（私有字段不许进数据） |
| ④½ | `check_images()` 解析 Python 必须用 `strip_py_comments`，不许用 TS 版（否则**判据读到空文本，静默失效**） |
| ⑤ | 二次审查入口在：`sheet` / `apply` / `next` 三个模式 + `manifest` 按 scope 分文件 |

★★ 两条踩过的坑写在 `TRAPS.md`：
**「判据落行为，不落名字」**（`verdict_for(` 出现在 docstring 里也算出现 ⇒ 要判调用点）；
**「判据会自指」**（判据串写在源码里，匹配到自己那一行 ⇒ 拆成两段拼接）。

---

## 十、进度与历史

| 城市 | 封面 | 判为错 | 备注 |
|---|---|---|---|
| `xian` | 57 | 30 | 首城试点；跑出"配图库是主题库"的第一个证据 |
| `changchun` | 57 | 33（+ 二审 30） | 逼出 `USE_STOCK_SOURCES=False`；两轮审查才收干净 |
| `changsha` | 36 | **待审** | 2026-10-31 定时任务已重抓；21 个点位确认无实景（餐饮/体验类为主） |
| `chengde` | 26 | **待审** | 同上；31 个点位无实景（餐饮 + 「日落/星空/云海」这类观赏条目） |

- **进度以 `tools/review_images.py status` 为准**（2026-10-31：重抓 4/83、已审 2/83），本表只做历史快照（会过期）。
- 剩余城市的问题模式与这两城一致（旧数据 + 固定三张），但**错图的具体形态会不同**，
  别拿这两城的结论去猜别的城（每城都要看图）。
- 下一步规划：先跑完小城（快、问题暴露早），再啃成都/北京这种大城。

---

## 十一、与设计文档的关系

`plans/06-data-maintenance.md` 的 6.1 / 6.2 写的是**早期设想**：GitHub Actions 每月跑
`check-images.yml`、HEAD 扫全量 URL、404 用 `query` 重搜后开 PR。那份设计解决的是**死链**（404），
解决不了**文不对题**（图活着、但是别的地方）。

实际落地的是本文这套：**本地定时任务备料 + 会话看图审查**。两者的关系：

| | 早期设想（06 文档） | 现在落地（本文） |
|---|---|---|
| 触发 | GitHub Actions 每月 1 号 | 本地定时任务每天 00:00 |
| 判据 | HTTP 状态码（404） | **看图**（内容对不对） |
| 产出 | 自动 PR | 人工判定 → `apply` → build |
| 适用 | 图挂了 | 图错了（更常见、更隐蔽） |

`query` 字段（"这张图想表达什么"）两边都依赖 —— 它是重搜的唯一依据，`images.py` 必须继续写。
