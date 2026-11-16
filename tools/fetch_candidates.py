#!/usr/bin/env python3
"""
tools/fetch_candidates.py —— **给无图点位重新抓图，候选全部留档，逐张看图确认**

## 它解决什么问题

`step4_images.py` 的 `pick_images` 是"判完再收"：`verdict_for` 觉得不像就直接丢。
结果是全库 2858 个点位停在 `_noImage` —— 里面既有"图源真没有"，也有
"有，但被过滤/没搜到"。只跑 step4 永远分不清这两类。

本工具反过来：**先把候选抓全，再让人眼看**。

    ① grab  <city>   三条通道全抓（关键词 / 实体对齐 / 坐标邻近），落 candidates.jsonl
    ② sheet <city>   拼对照表（每格标 #idx + 点位名 + 通道 + 距离）
    ③ （逐格看图，写 verdicts-candidates.jsonl：{"idx":0,"verdict":"ok|reject"}）
    ④ apply <city>   ok 的**写进** poi.images（补全旧数据）；reject 进全局缓存

★ 与 `review_images.py` 的分工：那个是"审已有图"，这个是"补没有的图"。共用同一套
  判据缓存（`_tmp/review/verdicts-cache.jsonl`）与同一个看图口径。

## 三条通道，为什么都要

| 通道 | 强在哪 | 弱在哪 |
|---|---|---|
| 关键词 `kw:` | 标题命中，最常用 | 同名异地、译名撞车（多肉也叫"蓬莱阁"） |
| 实体 `ent:` | Wikidata `P18`/条目主图/分类 = **这个对象** | 只有知名点位有实体 |
| 坐标 `geo:` | 没有文字线索时的唯一办法 | **附近随便一张**，多数拍到隔壁 |

坐标通道的图**必须**看 `distance_m`：30 米 ≈ 就在这里拍的；800 米 ≈ 同一个街区。
不看距离直接用，就会重演 2026-10-31 的反例（贵阳小吃位拿到火车站平面图）。
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pipeline.authoring import entity_images as ents          # noqa: E402
from pipeline.authoring.image_filter import verdict_for        # noqa: E402
from pipeline.authoring.images import (                        # noqa: E402
    _core_name, _is_latin, load_env, rejected_urls, search_wikimedia,
    search_pexels, search_unsplash,
)
from tools.review_images import (                               # noqa: E402
    COLS, ROWS, ROOT as REVIEW_ROOT, TILE, fetch, mirror, poi_paths,
)

OUT = ROOT / "_tmp" / "fetch"
CACHE = ROOT / "_tmp" / "review" / "verdicts-cache.jsonl"

#: 带中文字形的字体缓存（字号 → font）
_FONT_CACHE: dict[int, object] = {}

#: 系统里可能的中文字体，按优先级。★ 项目在 Windows 上跑，但别写死单一平台。
_FONT_PATHS = (
    "C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/msyhl.ttc",
    "C:/Windows/Fonts/simhei.ttf", "C:/Windows/Fonts/simsun.ttc",
    "/System/Library/Fonts/PingFang.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
)


def _cjk(size: int = 13):
    """返回能渲染中文的字体。

    ★★ 为什么必须有这个（2026-11-01 实测踩到）：`ImageDraw.text()` 不传 font 时
       用的是 `load_default()`，它**只有 ASCII 字形** —— 表里所有中文（点位名、
       "已属「XX」"、通道名）全部渲染成「□□□□」。原来的 4×5 表一直是这样，
       只是判定时靠 manifest 打印的区间对照，没人依赖格内文字，所以没暴露。
       但 dense 粗筛表每格只印点位名，文字一乱就等于"这格属于谁"全丢。
    """
    if size in _FONT_CACHE:
        return _FONT_CACHE[size]
    font = None
    for p in _FONT_PATHS:
        if os.path.exists(p):
            try:
                font = ImageFont.truetype(p, size)
                break
            except Exception:                              # noqa: BLE001
                continue
    if font is None:
        print("⚠️ 没找到中文字体，表内中文会渲染成方块（能看图，但读不到点位名）")
        font = ImageFont.load_default()
    _FONT_CACHE[size] = font
    return font


def _fit(font, text: str, width: int) -> str:
    """按**像素宽度**把文字截到能塞进 `width`，放不下就补省略号。

    ★ 不能用 `text[:9]` 这种按字符数截：中文全角 12px、英文数字半角 6px，
      「慈城名牌年糕(鼓楼店)」和「Ningbo Museum」同样 9 个字符，宽度差一倍 ——
      按字符截会让前者溢出压到隔壁格。
    """
    try:
        if font.getlength(text) <= width:
            return text
    except Exception:                                      # noqa: BLE001 —— 老 PIL 没 getlength
        return text[:9]
    while text:
        text = text[:-1]
        try:
            if font.getlength(text + "…") <= width:
                return text + "…"
        except Exception:                                  # noqa: BLE001
            break
    return "…"

#: ★★ 2026-11-08 主人定：**候选不再有任何数量上限**。
#:    「查到多少张，就把多少张交给 AI 筛选过滤，不应该限定只存多少张」——
#:    下面这些数字**全是图源单次请求的上限**，不是"留几张"的截断：
#:      · 实测 Commons 匿名 API 一次最多回 50 张（geosearch 传 200 也只回 50）；
#:      · Pexels / Unsplash 的 per_page 上限分别是 80 / 30；
#:      · Wikidata 实体通道给 20，够覆盖分类页里的图。
#:    原来 `MAX_CAND=60` / `STOP_AFTER=8` / `quota=5` / `mine[:60]` 全部删除：
#:    截断发生在 grab 里，被截掉的图"到底对不对"永远没有机会被看到。
GEO_LIMIT = 50            # Commons generator=geosearch 单次上限（实测 200 也只回 50）
ENTITY_LIMIT = 20         # Wikidata P18 / 条目主图 / Commons 分类
KW_PER_PAGE = 50          # Commons generator=search 单次上限
STOCK_PER_PAGE: dict[str, int] = {"pexels": 80, "unsplash": 30}  # 两家 per_page 上限

#: 餐馆小店的取图层级词汇。顺序 = 优先级：店内 → 门面 → 所在街道（坐标通道）。
FOOD_TIER_WORDS: dict[str, tuple[str, ...]] = {
    "inside": ("菜品", "店内"),
    "front": ("门面", "招牌"),
}
#: 层级排序：数字小的优先。`exact` 是非食物点位的默认层（等同于"本体"，与店内同权）。
#: ★ `ambience` = 配图库候选（主题配图），排最后：只有前面几层都不够时才补位，
#:   且**它进候选池不等于合格** —— 判 ok 与否完全由看图那一步定。
TIER_ORDER: dict[str, int] = {"inside": 0, "exact": 0, "front": 1, "street": 2, "ambience": 3}
TIER_LABEL: dict[str, str] = {
    "inside": "店内", "front": "门面", "street": "街道", "exact": "", "ambience": "配图库",
}

#: ★★ 配图库（Pexels / Unsplash）**只作 AI 审查链路的候选源**（2026-11-08 用户定）。
#:
#:   它们不是地点图库：搜「农安辽塔」会给上海的古塔，也没有 GPS / Commons 分类，
#:   `verdict_for` 对它们基本只能给 `suspect`。但**本工具本来就不据过滤器删图**
#:   （`filter` 只是参考分），抓完要看图逐格判 ok/reject，reject 还永久进缓存
#:   ⇒ 错图在这里会被筛掉，而不像 `step4_images` 那样"判完直接入库"。
#:
#:   ★ 因此 `pipeline/authoring/images.py` 的 `USE_STOCK_SOURCES` **保持 False**：
#:     那条是自动入库链路（没有看图环节），6602 张主题图污染就是从那进去的。
#:
#:   配额：Pexels 免费 200 次/小时、Unsplash 50 次/小时。
#:   ★★ 2026-11-08 去掉「每城 12/6 次」封顶：那是**数量截断**，第 13 个点位
#:      之后就一张配图库候选都拿不到。改成按第三方**小时额度**的全局闸门
#:      （留一点余量，跨整点自动重置），用完会明确打印一次，不静默跳过。
STOCK_HOURLY_LIMIT: dict[str, int] = {"pexels": 180, "unsplash": 45}
_STOCK_LOCK = threading.Lock()
#: 进程内小时窗口：{"hour": Unix 小时序号, "left": {源: 剩余次数}}
_STOCK_WINDOW: dict = {"hour": -1, "left": {}}
_STOCK_EXHAUSTED: set[str] = set()


def _take_stock_slot(src: str) -> bool:
    """按第三方小时额度抢一次调用名额；抢不到就跳过这一家（不是跳过整个点位）。

    ★ 这是**额度闸门**，不是候选数量限制：额度内每个符合条件的点位都能问，
      拿回来的每一张都进对照表交给看图的人。跨整点自动恢复。
    """
    hour = int(time.time() // 3600)
    with _STOCK_LOCK:
        if _STOCK_WINDOW["hour"] != hour:
            _STOCK_WINDOW["hour"] = hour
            _STOCK_WINDOW["left"] = dict(STOCK_HOURLY_LIMIT)
            _STOCK_EXHAUSTED.clear()
        left = _STOCK_WINDOW["left"]
        if left.get(src, 0) <= 0:
            if src not in _STOCK_EXHAUSTED:
                _STOCK_EXHAUSTED.add(src)
                print(f"    ! 配图库 {src} 本小时 {STOCK_HOURLY_LIMIT[src]} 次额度用尽，"
                      f"后续点位跳过（下个整点自动恢复）")
            return False
        left[src] -= 1
        return True



def _queries(poi: dict, city: str) -> list[tuple[str, str]]:
    """关键词组合与 `pick_images` 保持一致（同口径才能与既有数据对比）。

    ★ 返回 `(查询词, 层级)`。层级是主人定下的取图优先级，只对 `category=food`
      （餐馆·小吃·本地菜）生效：

          店内（菜品/店内实景） > 门面（招牌/店面） > 所在街道（走坐标通道）

      食物类点位裸名搜出来的常是"同名异地"——「葛根粉」搜到日本葛饼、
      「焖子」搜到大连焖子。先把"菜品/店内"这些限定词放在最前面，
      命中率反而比裸名高。
    """
    q = poi.get("_imageQuery") or {}
    name = poi.get("name", "")
    core = _core_name(name)
    zh = q.get("zh") or name
    en = q.get("en") or ""
    out: list[tuple[str, str]] = []
    if poi.get("category") == "food":
        for tier in ("inside", "front"):
            for word in FOOD_TIER_WORDS[tier]:
                out.append((f"{core} {word}", tier))
    if city:
        out += [(f"{core} {city}", "exact"), (f"{zh} {city}", "exact")]
    out += [(zh, "exact"), (core, "exact"), (name, "exact")]
    if en:
        out += [(f"{en} {city}" if city else en, "exact"), (en, "exact")]
    return list(dict.fromkeys(k for k in out if k[0]))


def _group_by_tier(pairs: list[tuple[str, str]]) -> list[tuple[str, list[str]]]:
    """把 `[(查询词, 层级)]` 压成 `[(层级, [查询词…])]`，保持原有先后顺序。"""
    out: list[tuple[str, list[str]]] = []
    for kw, tier in pairs:
        if out and out[-1][0] == tier:
            out[-1][1].append(kw)
        else:
            out.append((tier, [kw]))
    return out


#: 本轮 kw 通道撞 429 的次数。★ 必须计数并打印：429 会被 `except` 吞成"[]"，
#: 表现与"图源确实没有"**完全一样** —— 不打印就永远在审一批假空点位。
_KW_429 = 0


def _kw_images(kw: str) -> list[dict]:
    """关键词通道。★ 自己控速 —— Wikimedia 匿名调用会 429，而 fetch 的 3 次重试
    是在 1 秒内打完的，全 429 后被上层吞掉 ⇒ 表现为"一张图都搜不到"。

    所以这里自己退避重试；只有"真的返回 0 条"才算空。撞 429 加计数，
    城市跑完统一打印 —— 撞得多说明这一批的"候选 0"不可信，得降速重跑。
    """
    global _KW_429
    for attempt in range(4):
        ents.throttle_slot()             # ★ 走全局时隙，多个 worker 才不会同时撞上去
        try:
            # ★ 2026-11-08：默认 per_page=8 是关键词通道最隐蔽的一处数量截断。
            #   候选链路要拿满 Commons 单次上限（实测 50），一张都不提前丢。
            #   `search_wikimedia` 的默认 8 保持不动 —— 自动入库链路仍走它。
            return search_wikimedia(kw, per_page=KW_PER_PAGE)
        except Exception as exc:
            if "429" in str(exc):
                _KW_429 += 1
                time.sleep(5 * (attempt + 1))
                continue
            return []
    return []


def _grab_one(poi: dict, city_name: str, bad: set[str]) -> list[dict]:
    """单个点位的三条通道。★ 通道顺序 = 性价比顺序：

        ① 坐标（1 个请求，婺源 100/110 张候选都出自这里，命中率最高）
        ② 实体（无维基条目时 1 个请求就返回，很便宜）
        ③ 关键词（每次查询 1 个 RTT + 节流，最贵；**只在①②没捞到东西时才跑**）

    关键词通道原先无条件跑 4-5 条，实测在县级市/乡村点位几乎全空（Commons 中文
    文件名极少），白烧 15 秒/点位 × 2785 个点位 = 十几小时。降级成"补漏"。
    """
    mine: list[dict] = []

    def add(cands: list[dict], via: str, tier: str = "exact") -> None:
        for c in cands:
            url = c.get("url") or ""
            if not url or url.split("?", 1)[0] in bad:
                continue                        # 看图判死过的，别再收
            if any(m["url"] == url for m in mine):
                continue
            c["_via"] = via
            c["_tier"] = tier
            mine.append(c)

    # ① 坐标邻近（图是"附近"，距离交给看图的人）—— 这一层就是"所在街道"
    pt = (poi.get("location") or {}).get("point") or {}
    if isinstance(pt.get("lat"), (int, float)) and isinstance(pt.get("lng"), (int, float)):
        # ★ 2026-11-08：30 → 50（Commons 匿名单次上限，实测传 200 也只回 50）。
        #   geosearch 是**一个请求**，多要几张不多花请求；按距离由近到远返回，
        #   截断等于把"稍远但仍可能是本体"的那些直接丢掉。
        add(ents.geosearch_images(pt["lat"], pt["lng"], limit=GEO_LIMIT), "geo", "street")
    # ② 实体（P18 / 条目主图 / Commons 分类）—— 是这个对象，但分不清店内还是门面，记中间层
    add(ents.entity_images(poi.get("name", ""), limit=ENTITY_LIMIT), "ent", "front")
    # ③ 关键词通道：★★ 2026-11-08 起**所有查询词都跑、不提前停**。
    #
    #    原来的三道闸门（`specific < 8` 才跑 / 每层只取 1~2 个词 / quota=5 /
    #    STOP_AFTER=8 提前 break）会把同一个点位的其他叫法、译名、品类词
    #    全掐在 grab 里 —— 而"哪张是对的那张"只有看图的人能定。
    #    代价是请求数涨到每点位约 8~11 次（全部走 `throttle_slot()` 全局节流，
    #    不并发猛打），429 拦截与退避在 `_kw_images` / grab 结尾继续守着。
    for tier, group in _group_by_tier(_queries(poi, city_name)):
        for kw in group:
            add(_kw_images(kw), f"kw:{kw}", tier)

    # ④ 配图库补位（2026-11-08）：**只在 Commons 连本体层都没捞到时**才问。
    #    ★ 两条硬门槛，缺一不可（2026-11-08 复核后保留）：
    #      · 英文关键词必须是拉丁文 —— 拿中文名去查 Pexels 只会得到一堆无关图；
    #      · Commons 本体层 < 3 张 —— 这是**准确性**护栏，不是数量限制：
    #        本来就有 20 张实景图的点位没必要再灌 80 张氛围图让 AI 白看。
    #    ★ 每城 12/6 次封顶已删除，改按第三方小时额度（见 `_take_stock_slot`）。
    #    ★ 抓回来的图**只进候选池**：这里不据来源删，也不据 `verdict_for` 删，
    #      由对照表 + 看图判定决定去留（错的 reject 进全局缓存，下轮不再抓回）。
    specific = sum(1 for m in mine if m["_tier"] not in ("street", "ambience"))
    en = str((poi.get("_imageQuery") or {}).get("en") or "")
    if specific < 3 and _is_latin(en):
        for label, search in (("pexels", search_pexels), ("unsplash", search_unsplash)):
            if not _take_stock_slot(label):
                continue
            try:
                add(search(en, per_page=STOCK_PER_PAGE[label]), f"stock:{label}", "ambience")
            except Exception as exc:                     # 配额/网络挂了不该拖垮这一城
                print(f"    ! 配图库 {label} 取图异常：{type(exc).__name__} {exc}")
    # ★★ 2026-11-08：删除 `mine[:MAX_CAND]`。抓到多少就留多少，一张都不在
    #    grab 里截掉 —— 去留只由「看图判定」决定，代价由两轮对照表吸收。
    return mine


def grab(city: str, *, limit: int = 0, only: set[str] | None = None,
         replace: bool = False) -> int:
    """抓候选。

    `only`：只抓这些 poi id —— **已有图也抓**。用途是巡检发现「图是错的」时重抓：
            默认模式只补无图点位，永远碰不到"有图但图错"的点位。
    `replace`：配合 `only`，apply 时用本轮判 ok 的图**替换**旧图，而不是追加。
    """
    load_env()
    bad = rejected_urls()
    used: dict[str, str] = {}          # url → 首个占用的点位（同城撞图在这里挡）
    entries: list[dict] = []
    out_dir = OUT / city
    out_dir.mkdir(parents=True, exist_ok=True)

    targets = []
    for path in poi_paths(city):
        poi = json.loads(path.read_text(encoding="utf-8"))
        if only:
            if poi.get("id") not in only:
                continue
        elif poi.get("images"):
            continue                    # 默认模式：只补旧的空点位，不动已有图
        targets.append((path, poi))
    if limit:
        targets = targets[:limit]
    if not targets:
        print(f"{city}：没有待补的点位")
        return 0

    #: 并发数。★ 收益在 RTT 重叠：单请求 RTT 1.2-2.6s，串行时"RTT + 节流"相加，
    #: 并发后按节流间隔发出，吞吐从 0.25 req/s 提到接近 0.9 req/s。别调太高 ——
    #: Wikimedia 匿名限流很紧，实测把 THROTTLE 压到 0.5 就开始 429。
    workers = max(1, int(os.environ.get("GRAB_WORKERS", "4")))
    hit429_before = ents.hits_429()          # 见结尾：用它区分"真没料"与"被限流"
    # ★ 2026-11-08：配图库额度不再按「每城每轮」重置，改成第三方小时窗口
    #   （`_take_stock_slot` 自己判跨整点）。一晚手动连跑多城时共用同一份额度。
    print(f"{city}：{len(targets)} 个无图点位，开始抓候选（{workers} 并发）…")

    def job(item: tuple[Path, dict]) -> tuple[Path, dict, list[dict]]:
        path, poi = item
        cn = poi.get("_cityName") or _city_name(path)
        try:
            return path, poi, _grab_one(poi, cn, bad)
        except Exception as exc:                       # 单点位炸了不该拖垮整城
            print(f"    ! {poi.get('name', '')[:14]} 抓取异常：{type(exc).__name__} {exc}")
            return path, poi, []

    done = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for path, poi, mine in pool.map(job, targets):
            done += 1
            name = poi.get("name", "")
            city_name = poi.get("_cityName") or _city_name(path)
            rel = path.relative_to(ROOT).as_posix()
            kept: list[dict] = []
            for c in mine:
                if c["url"] in used:            # 同城撞图在主线程挡（worker 里没有共享视图）
                    continue
                used[c["url"]] = name
                kept.append(c)
            for c in kept:
                verdict, reason, _score = verdict_for(c, poi, city=city_name)
                entries.append({
                    "idx": len(entries),
                    "file": rel,
                    "poi": name,
                    "url": c["url"],
                "thumb": c.get("thumbUrl") or c["url"],
                "alt": c.get("alt", ""),
                    "via": c.get("_via", ""),
                    "tier": c.get("_tier", "exact"),
                    # ★ 来源必须进清单：apply 要按它写 credit，看图的也要靠它认出
                    #   「这格是主题配图库来的」。旧版 apply 一律写 wikimedia ⇒ 伪造署名。
                    "source": (c.get("credit") or {}).get("source", "wikimedia"),
                    "distance_m": c.get("distance_m"),
                "license": (c.get("credit") or {}).get("license", ""),
                "author": (c.get("credit") or {}).get("author", ""),
                "sourceUrl": (c.get("credit") or {}).get("sourceUrl", ""),
                "attributionRequired": (c.get("credit") or {}).get("attributionRequired", True),
                    "filter": verdict,          # ★ 只是**参考分**，不据此删：ok/suspect/reject 都留着
                    "reason": reason,
                    # ★ 重抓通道的凭据：apply 见 replace 就清掉该点位旧图（只在本轮判 ok 的
                    #   图上重建），否则旧错图会一直留着跟新图并列。
                    "replace": bool(replace),
                })
            print(f"  {done:03d}/{len(targets)} {name[:14]:16s} 候选 {len(kept):2d}", flush=True)

    # ── 落盘之前先判：这批"候选 0"是真的没图，还是被限流吞了 ─────────────
    #    ★★ 两者在日志上一字不差，后果却完全相反（2026-11-01 凤凰城实测踩到）：
    #       · 真没料 ⇒ 这城本来就没素材，照常写 0 张
    #       · 被限流 ⇒ 必须重跑。若写成 0 张，refill_queue 会记一次 fail，
    #                  连 2 次就进 skipped **永久跳过这座城**
    #    实测症状：同一坐标单独测返回 10 张，紧接着 4 并发 grab 全 0。
    hit429 = ents.hits_429() - hit429_before
    empty_n = len(targets) - len({e["file"] for e in entries})
    if targets and empty_n / len(targets) >= 0.9 and (hit429 or _KW_429):
        print(f"\n★★ 疑似被图源限流：{empty_n}/{len(targets)} 个点位候选为 0，"
              f"本轮撞 429 共 {hit429 + _KW_429} 次")
        print("   ⇒ **不写 candidates.jsonl**（避免把「没抓到」记成「没图」）")
        print("   ⇒ 等 5~10 分钟图源空闲后重跑；连续两次仍如此才当它是真没料")
        return -1

    path = out_dir / "candidates.jsonl"
    path.write_text("\n".join(json.dumps(e, ensure_ascii=False) for e in entries) + "\n",
                    encoding="utf-8")
    poi_n = len({e["file"] for e in entries})
    print(f"\n{city}：{len(entries)} 张候选（覆盖 {poi_n}/{len(targets)} 个点位）→ {path}")
    if _KW_429:
        print(f"★★ 本轮撞 429 共 {_KW_429} 次（已退避重试）—— 次数多说明限速被顶了，"
              f"这批\"候选 0\"可能不可信，建议 WM_THROTTLE 调回 1.1 重跑")
    return len(entries)


def _city_name(path: Path) -> str:
    """城市中文名从 city.json 取（POI 里没有就退回 slug）。

    ★ 层级：`data/cities/<省>/<市>/pois/<类>/<id>.json` —— city.json 在 `parents[1]`，
      写 `parents[2]` 会读到省份目录、静默拿不到名字（这里退回 slug，只是查询词变差）。
    """
    city_json = path.parents[1] / "city.json"
    try:
        return json.loads(city_json.read_text(encoding="utf-8")).get("name") or path.parts[3]
    except Exception:
        return path.parts[3]


def sheet(city: str, *, refresh: bool = False,
          dense: bool = False, only: list[int] | None = None) -> int:
    """出对照表。三种模式，对应「两轮粗筛」的不同阶段：

    | 调用 | 网格 | 产物 | 用来干什么 |
    |---|---|---|---|
    | `sheet <city>` | 4×5（300px） | `sheet-cand-XX.png` | 老流程，一屏 20 张 |
    | `sheet <city> --dense` | 8×6（160px） | `sheet-dense-XX.png` | **第一轮粗筛**，一屏 48 张 |
    | `sheet <city> --only 3,7,12` | 4×5（300px） | `sheet-pick-XX.png` | **第二轮精看**，只列入围的 |

    ★★ 为什么要有 dense：grab 取消候选数量上限后（2026-11-08），
      单个点位最多可攒到 50（坐标）+ 20（实体）+ 每词 50（关键词）+ 110（配图库），
      一座城几千张候选很常见。按 20 格/页要上百页，逐页精看不现实。
      dense 把一屏提到 48 格，第一轮只做**粗分类**（是建筑/食物/人像/地图/室内），
      剔除明显不可能的，剩下的才进第二轮看大图定"是不是这个景点"。
      ★ 粗筛判不了"是不是这座庙"—— 那需要看匾额，小图看不清。别在第一轮下结论。
    """
    src = OUT / city / "candidates.jsonl"
    if not src.exists():
        print(f"没有 {src} —— 先跑 `grab {city}`")
        return 0
    all_entries = [json.loads(l) for l in src.read_text(encoding="utf-8").splitlines() if l.strip()]
    if not all_entries:
        print("候选为空")
        return 0

    # --only：只留入围的，且**按给定顺序**排（前几张放最可能是本体的）
    if only:
        by_idx = {e["idx"]: e for e in all_entries}
        miss = [i for i in only if i not in by_idx]
        if miss:
            print(f"★★ 这些序号不在候选里：{miss}（跳过）")
        entries = [by_idx[i] for i in only if i in by_idx]
        if not entries:
            print("入围序号一个都不存在 —— 检查 --only 列表")
            return 0
    else:
        entries = all_entries

    out = OUT / city
    thumbs = out / "thumbs"
    thumbs.mkdir(parents=True, exist_ok=True)
    # ★ 本城**已有图**的点位占着哪些 URL —— 这些候选即使判 ok 也写不进去
    #   （apply 会按"一图不挂两点位"跳过），必须在表上标出来，否则白判一整天。
    taken: dict[str, str] = {}
    for p in poi_paths(city):
        d = json.loads(p.read_text(encoding="utf-8"))
        for im in d.get("images") or []:
            taken[im.get("url", "")] = d.get("name", "")
    if refresh:
        for f in thumbs.glob("cand-*.jpg"):
            f.unlink()

    print(f"共 {len(entries)} 张候选，下载缩略图…")
    with ThreadPoolExecutor(max_workers=10) as pool:
        list(pool.map(lambda e: fetch(e["thumb"] or e["url"], thumbs / f"cand-{e['idx']}.jpg"),
                      entries))
    lost = [e for e in entries if not (thumbs / f"cand-{e['idx']}.jpg").exists()]
    if lost:
        print(f"★★ {len(lost)} 格取不到缩略图（这些格子看不到，不能判）：")
        for e in lost[:10]:
            print(f"     #{e['idx']} {e['poi'][:12]} {(e['alt'] or '')[:40]}")

    # 网格：dense = 粗筛（48 格/页），其余 = 精看（20 格/页）
    cols, rows_max, tile = (8, 6, 160) if dense else (COLS, ROWS, TILE)
    stem = "sheet-dense" if dense else ("sheet-pick" if only else "sheet-cand")
    foot = 22 if dense else 40                # 每格底部文字区高度（两行 13px + 行距）
    per = cols * rows_max
    sheets = []
    for s in range(0, len(entries), per):
        chunk = entries[s:s + per]
        rows = min(rows_max, (len(chunk) + cols - 1) // cols)
        canvas = Image.new("RGB", (cols * (tile + 4) + 4, rows * (tile + foot) + 4), (245, 245, 245))
        draw = ImageDraw.Draw(canvas)
        fnt = _cjk(12 if dense else 13)        # 见 _cjk 的说明：不传字体中文全是方块
        for k, e in enumerate(chunk):
            c, r = k % cols, k // cols
            x, y = 4 + c * (tile + 4), 4 + r * (tile + foot)
            p = thumbs / f"cand-{e['idx']}.jpg"
            if p.exists():
                try:
                    img = Image.open(io.BytesIO(p.read_bytes())).convert("RGB")
                    img.thumbnail((tile, tile))
                    canvas.paste(img, (x, y))
                except Exception:
                    pass
            else:
                draw.text((x + 8, y + 8), "[下载失败]", fill=(200, 30, 30), font=fnt)
            # 参考色边：绿=过滤器说 ok，黄=suspect，红=reject（**不是结论**，只是提示）
            color = {"ok": (40, 160, 80), "suspect": (220, 170, 30)}.get(e["filter"], (200, 50, 50))
            draw.rectangle((x, y, x + tile, y + tile), outline=color, width=3)
            # 序号烧进格子（只在下方写小字会让读图方错位，长春首审踩过）
            bw = 46 if tile >= 300 else 42
            draw.rectangle((x + 4, y + 4, x + bw, y + 25), fill=(255, 255, 255))
            draw.text((x + 9, y + 9), f"#{e['idx']}", fill=(0, 0, 0), font=fnt)
            dist = f" {e['distance_m']}m" if e.get("distance_m") is not None else ""
            owner = taken.get(e.get("url", ""))
            if owner:
                # 已被本城别的点位用掉 —— 判 ok 也写不进来，标出来省一次判断
                draw.rectangle((x, y, x + tile, y + tile), outline=(150, 150, 150), width=3)
            if dense:
                # 粗筛只印一行：点位名（被占用的改成"已属谁"）
                label = f"已属「{owner}」" if owner else e["poi"]
                draw.text((x + 3, y + tile + 4), _fit(fnt, label, tile - 6),
                          fill=(130, 130, 130) if owner else (20, 20, 20), font=fnt)
            else:
                # 精看两行。★ 第一行**无论是否已被占用都要画**：精看时要靠它确认
                #   "这格属于哪个点位"，只印「已属「XX」」等于把归属信息丢了。
                draw.text((x + 3, y + tile + 3), _fit(fnt, f"#{e['idx']} {e['poi']}{dist}", tile - 6),
                          fill=(20, 20, 20), font=fnt)
                tier = TIER_LABEL.get(e.get("tier") or "exact", "")
                src_tag = {"pexels": "Pexels", "unsplash": "Unsplash"}.get(e.get("source", ""))
                sub = (f"已属「{owner}」" if owner
                       else f"{tier + ' · ' if tier else ''}{e['via'][:24]}")
                # ★ 配图库来的必须在格子上标出来：这类图"看着像但可能根本不是这个地点"，
                #   看图的人得知道要多核对一眼。用暖色，别和过滤器的红/绿/黄撞义。
                if src_tag:
                    sub = f"{src_tag} · {sub}"
                draw.text((x + 3, y + tile + 21), _fit(fnt, sub, tile - 6),
                          fill=(170, 95, 20) if src_tag else
                          (130, 130, 130) if owner else (90, 90, 90), font=fnt)
        sp = out / f"{stem}-{len(sheets):02d}.png"
        canvas.save(sp)
        sheets.append(sp)

    # manifest 只在全量模式下覆盖；--only 单独存一份，免得把全量清单洗掉
    if only:
        (out / "manifest-pick.json").write_text(json.dumps(entries, ensure_ascii=False, indent=1),
                                               encoding="utf-8")
    else:
        (out / "manifest-candidates.json").write_text(
            json.dumps(entries, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"对照表 {len(sheets)} 张（{'粗筛 48 格/页' if dense else '精看 20 格/页'}）→ {out}")
    for sp in sheets:
        print("   ", sp)
    return len(entries)


def _credit_of(e: dict) -> dict:
    """按候选的**真实来源**生成 credit（供 apply 写库）。

    ★★ 旧版 apply 一律写 `"source": "wikimedia"` + 默认作者
        "Wikimedia Commons 贡献者" —— 配图库的图判 ok 后就成了伪造 CC 署名，
        违反「图片带 credit」红线。老清单没有 `source` 字段，按 URL host 兜底，
        **不能**默认成 wikimedia（那等于把错误又造一遍）。
    """
    src = str(e.get("source") or "")
    if not src:
        u = str(e.get("url") or "")
        src = ("pexels" if "images.pexels.com" in u else
               "unsplash" if "images.unsplash.com" in u else "wikimedia")
    if src == "pexels":
        author, lic, attr = e.get("author") or "Pexels 摄影师", "Pexels License", False
    elif src == "unsplash":
        author, lic, attr = e.get("author") or "Unsplash 摄影师", "Unsplash License", False
    else:
        src = "wikimedia"
        author = e.get("author") or "Wikimedia Commons 贡献者"
        lic = e.get("license") or "见来源页"
        attr = bool(e.get("attributionRequired", True))
    return {
        "source": src,
        "author": author,
        "sourceUrl": e.get("sourceUrl") or e.get("url") or "",
        "license": lic,
        "attributionRequired": attr,
    }


def _tier_of(e: dict) -> str:
    """候选的取图层级。老候选（分层之前抓的）没有 `tier` 字段，按通道兜底：
    坐标通道就是"所在街道"，其余按"本体"。"""
    return (e.get("tier") or ("street" if str(e.get("via", "")).startswith("geo")
                             else "ambience" if str(e.get("via", "")).startswith("stock")
                             else "exact"))


def apply(city: str, *, dry: bool = False) -> int:
    """把判定为 ok 的候选**写进** poi.images；reject 记进全局缓存。"""
    out = OUT / city
    mpath = out / "manifest-candidates.json"
    vpath = out / "verdicts-candidates.jsonl"
    if not mpath.exists() or not vpath.exists():
        print(f"缺 {mpath.name} 或 {vpath.name} —— 先 grab + sheet + 写判定")
        return 0
    manifest = json.loads(mpath.read_text(encoding="utf-8"))
    verdicts: dict[int, str] = {}
    tier_of: dict[int, str] = {}
    for line in vpath.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        row = json.loads(line)
        idx = int(row["idx"])
        v = row.get("verdict")
        verdicts[idx] = v.get("verdict") if isinstance(v, dict) else v
        # ★ 允许逐张改层级：看图才是判层级的唯一依据。地理通道拿到的"店内菜品照"
        #   写 {"idx":18,"verdict":"ok","tier":"inside"} 就能把它提到最高层。
        if row.get("tier"):
            tier_of[idx] = row["tier"]

    today = datetime.now().strftime("%Y-%m-%d")
    # 同城已占用的 URL（防一图多挂）
    city_used: set[str] = set()
    for p in poi_paths(city):
        d = json.loads(p.read_text(encoding="utf-8"))
        city_used.update(im.get("url", "") for im in d.get("images") or [])

    by_file: dict[str, list[dict]] = {}
    for e in manifest:
        v = verdicts.get(e["idx"])
        if v == "ok":
            by_file.setdefault(e["file"], []).append(e)
        elif v == "reject":
            pass

    added = 0
    touched = 0
    for rel, rows in by_file.items():
        path = ROOT / rel
        poi = json.loads(path.read_text(encoding="utf-8"))
        # ★ 重抓通道：本轮所有条目都带 replace ⇒ 旧图整批作废，只用判 ok 的重建。
        #   追加模式（默认）保持原样，避免把"补图"误做成"换图"。
        replace = bool(rows) and all(e.get("replace") for e in rows)
        old_imgs = poi.get("images") or []
        imgs = [] if replace else old_imgs
        before = len(old_imgs)                   # ← 统计口径始终是"原有点位上的张数"
        have = {im.get("url") for im in imgs}
        # ★ 取图优先级：店内 > 门面 > 所在街道（主人的口径）。判 ok 的图按层级排好，
        #   高层的排前面（前端 gallery 从第 0 张起显示），但**不再按张数截断**：
        #   看图已经逐格定过去留，代码再截一次等于替 AI 改判。
        rows.sort(key=lambda e: (TIER_ORDER.get(tier_of.get(e["idx"]) or _tier_of(e), 1), e["idx"]))
        is_food = poi.get("category") == "food"
        # ★ 没写进去只有一种原因：同城已被别的点位占用。单独数出来，
        #   别和"判 ok 但被上限截掉"混为一谈（后者 2026-11-08 起已不存在）。
        skipped_used = 0
        for e in rows:
            if e["url"] in have or e["url"] in city_used:
                skipped_used += 1
                continue
            tier = tier_of.get(e["idx"]) or _tier_of(e)
            alt = e["alt"] or f"{poi.get('name', '')} 实景"
            if tier == "street" and is_food:
                # 餐馆小店的街景图必须在 alt 里说清"不是这家店"，
                # 否则读屏与 SEO 都在撒谎（前端不读 caption，写 alt 才有效）
                alt = f"{poi.get('name', '')}所在的街区实景（非本店门面）"
            imgs.append({
                "url": e["url"],
                "thumbUrl": e["thumb"],
                "width": 1080,
                "height": 720,
                "alt": alt,
                "query": poi.get("name", ""),        # ★ 自愈关键字段
                "credit": _credit_of(e),
                # ★ `via` 留痕：配图库来的图以后能按通道追查，也是"经过看图审查"的凭证
                "review": {"verdict": "ok", "by": "agent-vision", "at": today,
                           "tier": tier, "via": e.get("via", "")},
            })
            have.add(e["url"])
            city_used.add(e["url"])
            added += 1
        if imgs:
            # ★★ 2026-11-08：删除 `added -= max(0, len(imgs)-6)` 与 `imgs[:6]`。
            #   判 ok 的图**全部落盘**；`schema.py` / `schema.ts` 的 8 张硬上限
            #   同步去掉，否则 build 校验会拿旧契约把合法数据判成 ERROR。
            poi["images"] = imgs
            poi["coverIndex"] = 0
            poi.pop("_noImage", None)
            poi["updatedAt"] = today
            touched += 1
            if not dry:
                path.write_text(json.dumps(poi, ensure_ascii=False, indent=2) + "\n",
                                encoding="utf-8")
            # ★ 打印**实际写进去的张数**（与 `added` 现在严格一致）。
            note = []
            if skipped_used:
                note.append(f"占用跳过 {skipped_used}")
            if replace:
                print(f"  ↻ {poi.get('name', '')[:14]:16s} 重抓替换：{before} → {len(imgs)} 张"
                      + (f"（{'，'.join(note)}）" if note else ""))
            else:
                print(f"  + {poi.get('name', '')[:14]:16s} 收 {len(imgs) - before} 张"
                      + (f"（判 ok {len(rows)}，{'，'.join(note)}）" if note else ""))
        elif replace:
            # 判 ok 为 0：**不动旧图**。宁可留着待重抓，也不能把点位清空。
            print(f"  = {poi.get('name', '')[:14]:16s} 重抓无 ok 图，旧 {before} 张保持不动")

    # 判定全部进缓存（ok 也记：同一 URL 下次不必重看）
    lines = [json.dumps({"url": e["url"], "verdict": verdicts[e["idx"]]}, ensure_ascii=False)
             for e in manifest if e["idx"] in verdicts]
    if lines and not dry:
        with CACHE.open("a", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")

    print(f"{'[演练] ' if dry else ''}写回 {touched} 个点位 / 新增 {added} 张图")
    return touched


def main() -> int:
    ap = argparse.ArgumentParser(description="无图点位重新抓图（候选留档 → 逐张看图 → 写回）")
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("grab"); g.add_argument("city"); g.add_argument("--limit", type=int, default=0)
    # ★ 巡检重抓通道：--poi 指定点位（**已有图也抓**），配合 --replace 让 apply 用新图替换旧图。
    #   不带 --poi 时行为不变（只补无图点位），每晚补图与 refill 链路完全不受影响。
    g.add_argument("--poi", default="", help="只抓这些点位 id，逗号分隔（已有图也会重抓）")
    g.add_argument("--replace", action="store_true", help="配合 --poi：用判 ok 的新图替换旧图")
    s = sub.add_parser("sheet"); s.add_argument("city"); s.add_argument("--refresh", action="store_true")
    s.add_argument("--dense", action="store_true", help="第一轮粗筛：8×6=48 格/页 小图")
    s.add_argument("--only", default="", help="第二轮精看：只列这些序号，逗号分隔（3,7,12）")
    a = sub.add_parser("apply"); a.add_argument("city"); a.add_argument("--dry", action="store_true")
    args = ap.parse_args()
    if args.cmd == "grab":
        only = {x.strip() for x in args.poi.replace("，", ",").split(",") if x.strip()} or None
        if args.replace and not only:
            print("★ --replace 必须配 --poi（不指定点位就替换 = 清全城图）")
            return 1
        return 0 if grab(args.city, limit=args.limit, only=only,
                         replace=args.replace) >= 0 else 1
    if args.cmd == "sheet":
        only = [int(x) for x in args.only.replace("，", ",").split(",") if x.strip().isdigit()]
        return 0 if sheet(args.city, refresh=args.refresh, dense=args.dense,
                          only=only or None) >= 0 else 1
    return 0 if apply(args.city, dry=args.dry) >= 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
