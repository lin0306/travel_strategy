#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""省 / 市封面的**定期复核** —— 「这张还该挂着吗」（2026-11-14）。

## 为什么需要它（与 `audit_covers` 不是一回事）

`cover_sheet.audit_covers` 回答的是**「还没审过的都长什么样」**：账本 `state=ok` 的
一律跳过（审过的不再花时间）。它服务的是**一次性清洗**（83 城 30 张错图那一轮）。

而封面上线之后会**慢慢变得不对**，这四种坏法 `audit_covers` 一个都看不见：

| 坏法 | 怎么发生的 | 为什么静态审查看不出来 |
|---|---|---|
| **依据消失** | 封面 `query` 记的是「华山」，那个点位后来被 `retire` 归档 / 改名 | 图还在、还能显示，只是这张图不再代表本辖区任何东西 |
| **重点景区换人** | 新收录一个爆火点位（popularity 99），封面还是三年前那三个 | 那三张本身没错，只是不再是"门面" |
| **来自城市名兜底通道** | 当年地标图不够，用了「<城市> skyline」补位 —— 30 张错图全是这条通道出来的 | 账本 state 是 ok（人看过），但看过 ≠ 该留 |
| **图挂掉** | Wikimedia 改名 / 删除 / 版权下架 | 只有真发一次请求才知道（`--urls`，抽样轮转） |

所以这个工具的产出不是"表"，是**一份按风险排序的复核清单**：巡检每轮取前 2 个，
出对照表真看一遍，看完 `keep` 记 `reviewedAt`（**不改 `at`** —— 那是数据改动日）。

## 判据与权重（分数越高越该先看）

| 项 | 分 | 判据 |
|---|---|---|
| 账本 `need` | 10 | 明确判过"要换"，还没换 |
| **图源不是 Wikimedia** | 4/张 | `credit.source != wikimedia` —— 项目红线，图库没有地理校验 |
| 张数不足 | 3 | `heroImages` < 3（只剩 1~2 张，图集缩略条会显得空） |
| **依据消失** | 3/张 | `query` 经 `core_name()` 后在辖区点位里找不到 |
| 来自城市名通道 | 2/张 | `query` == 单位名 / 含 skyline（说明不是地标图） |
| alt 无中文 | 2/张 | `alt` 里一个汉字都没有（Commons 文件名） |
| 重点景区零覆盖 | 2 | 辖区 popularity 前 3 一个都没上封面 |
| 久未复核 | 1 | `reviewedAt` 缺失或 > `STALE_DAYS`(90) 天（缺失时拿 `at` 兜底） |

★ 分数只用来**排队**，不是结论。图上到底对不对，只有看图那一关能判。

## 命令

    next [--kind city|province|both] [--n 6]          体检清单（机读行，巡检直接照着做）
    sheet --picks city:beijing,province:610000        看**已上线**的（每单位 3 张连排）
    cands --picks city:guangzhou,city:guilin [--per 6]  看**候选**（多城合表，每地标一张）
    keep --picks city:beijing,...                     看完记 reviewedAt（不动 at）
    urls [--n 12] [--kind …]                          抽查图 URL 是否还活着（联网，轮转）

## 台账

复用两份现成账本（`data/_generated/city-covers.json` / `province-covers.json`），
只增两个字段：`reviewedAt`（最近一次**看图**复核日）与 `urlCheckedAt`（最近一次探活日）。
`at` / `state` / `by` / `why` / `kept` 的语义不变，别混用。
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tools import city_cover as cc                                          # noqa: E402
from tools import province_cover as pc                                     # noqa: E402
from tools.cover_sheet import h8, render                                   # noqa: E402
from tools.review_images import fetch                                      # noqa: E402

from pipeline.authoring.image_filter import core_name                      # noqa: E402
from pipeline.core.layout import iter_city_dirs                             # noqa: E402

OUT = ROOT / "_tmp" / "cover-review"
CITY_LEDGER = ROOT / "data" / "_generated" / "city-covers.json"
PROV_LEDGER = ROOT / "data" / "_generated" / "province-covers.json"
CJK = re.compile(r"[\u3400-\u9fff]")
STALE_DAYS = 90
MAX_HERO = 3


# ── 台账 ───────────────────────────────────────────────────
def _read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def _write(path: Path, rows: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(dict(sorted(rows.items())), ensure_ascii=False, indent=1) + "\n",
                    encoding="utf-8")


def _ledger_of(kind: str) -> Path:
    return CITY_LEDGER if kind == "city" else PROV_LEDGER


def _age_days(stamp: str) -> int:
    """`YYYY-MM-DD` → 距今天数。读不出来按"很旧"算（宁可多复核一次）。"""
    try:
        return (date.today() - date.fromisoformat(str(stamp)[:10])).days
    except Exception:                                                  # noqa: BLE001
        return 10_000


# ── 单位清单（省 / 市共用一套形状） ─────────────────────────
def _units(kind: str) -> list[dict]:
    """`[{kind, key, name, hero, marks, ledger_row, city_dirs}]`。

    `marks` 一定与各自封面的**抓图口径同源**：市带 bbox + 50km 过滤，省不过滤
    （华山属渭南但属陕西，当陕西省封面是对的 —— 见 `province_cover` 文件头）。
    """
    out: list[dict] = []
    if kind == "city":
        led = _read(CITY_LEDGER)
        for _prov, slug, d in iter_city_dirs():
            doc = json.loads((d / "city.json").read_text(encoding="utf-8"))
            out.append({
                "kind": "city", "key": slug, "name": doc.get("name") or slug,
                "hero": doc.get("heroImages") or [],
                "marks": cc._landmarks(d, doc), "ledger_row": led.get(slug) or {},
                "dtag": str(doc.get("updatedAt") or ""),
            })
    else:
        led = _read(PROV_LEDGER)
        names = pc._names()
        idx = pc._index()
        by_prov = pc._cities_of()
        for adcode in sorted(idx["provinces"]):
            out.append({
                "kind": "province", "key": adcode, "name": names.get(adcode, adcode),
                "hero": (idx["provinces"][adcode] or {}).get("heroImages") or [],
                "marks": pc._landmarks(adcode),
                "ledger_row": led.get(adcode) or {},
                "dtag": str(idx.get("updatedAt") or ""),
                "_dirs": by_prov.get(adcode, []),
            })
    return out


# ── 判据 ──────────────────────────────────────────────────
def _score(u: dict) -> tuple[int, list[str]]:
    hero, marks, row = u["hero"], u["marks"], u["ledger_row"]
    score = 0
    why: list[str] = []

    if row.get("state") == "need":
        score += 10
        why.append("账本 need 待重抓")

    n = len(hero)
    if n == 0:
        score += 8
        why.append("一张封面都没有")
    elif n < MAX_HERO:
        score += 3
        why.append(f"只有 {n} 张")

    # ★ 依据消失 / 城市名兜底 —— 这两条是"图还在、但已经不是这件事"的唯一线索
    have = {core_name(m["name"]) for m in marks}
    lost, fallback, no_alt, not_free = [], [], [], []
    for im in hero:
        q = str(im.get("query") or "").strip()
        qc = core_name(q)
        if not qc:
            lost.append("（query 为空）")
        elif qc == core_name(u["name"]) or "skyline" in q.lower():
            fallback.append(q)
        elif qc not in have:
            lost.append(q)
        if not CJK.search(str(im.get("alt") or "")):
            no_alt.append(q or "?")
        if str((im.get("credit") or {}).get("source") or "") != "wikimedia":
            not_free.append(str((im.get("credit") or {}).get("source") or "?"))
    if not_free:
        score += 4 * len(not_free)
        why.append(f"{len(not_free)} 张图源不是 Wikimedia（{'/'.join(sorted(set(not_free)))}）")
    if lost:
        score += 3 * len(lost)
        why.append("封面依据已不在库：" + "、".join(lost[:3]))
    if fallback:
        score += 2 * len(fallback)
        why.append(f"{len(fallback)} 张来自城市名兜底通道（不是地标图）")
    if no_alt:
        score += 2 * len(no_alt)
        why.append(f"{len(no_alt)} 张 alt 无中文")

    # 重点景区零覆盖：辖区前 3 一个都没上封面（封面自己没错，只是不再是门面）
    # ★ 只在 ≥2 张时才判：1 张封面最多只对应 1 个地标，拿它判"没覆盖前 3"是必然成立，
    #   纯噪音 —— 那种情况已经被上一条「只有 1 张」说过了。
    top3 = {core_name(m["name"]) for m in marks[:3]}
    if n >= 2 and top3 and not top3 & {core_name(str(im.get("query") or "")) for im in hero}:
        score += 2
        why.append("前 3 重点景区一个都没上封面")

    # ★ `reviewedAt` 缺失时拿 `at` 兜底：`at` 是最后一次**改动**日，而改动必然伴随看图
    #   （apply 前必须写 verdicts）。不兜底的话，老账本 117 个单位会全部判成"从未复核"，
    #   清单前排被"久未复核 +1"占满，真正的缺陷反而排不上来。
    seen = str(row.get("reviewedAt") or row.get("at") or "")
    if _age_days(seen) > STALE_DAYS:
        score += 1
        why.append(f"上次看图复核：{seen[:10] or '从未'}")

    return score, why


def cmd_next(kind: str, n: int) -> int:
    kinds = ["city", "province"] if kind == "both" else [kind]
    rows: list[dict] = []
    stat = []
    for k in kinds:
        us = _units(k)
        ok = sum(1 for u in us if u["ledger_row"].get("state") == "ok")
        need = sum(1 for u in us if u["ledger_row"].get("state") == "need")
        stat.append(f"{k}_total={len(us)} {k}_ok={ok} {k}_need={need}")
        for u in us:
            s, why = _score(u)
            if s <= 0:
                continue
            rows.append({"kind": k, "key": u["key"], "name": u["name"],
                         "score": s, "why": why,
                         "reviewed": u["ledger_row"].get("reviewedAt") or "-"})
    # ★ 按 kind 分组后**交错**输出，不按分数全局排：34 省全是「只有 1 张」(3 分)，
    #   全局排序会让省份长期压在城市的 2 分项前面 —— 城市那条线几周不动。
    #   交错之后每一轮都同时往前推一步，两条线都不会饿死。
    by_kind = {k: sorted([r for r in rows if r["kind"] == k],
                         key=lambda r: (-r["score"], r["reviewed"])) for k in kinds}
    rows, i = [], 0
    while any(len(v) > i for v in by_kind.values()):
        for v in by_kind.values():
            if i < len(v):
                rows.append(v[i])
        i += 1
    for r in rows[:n]:
        print(f"PICK {r['kind']}|{r['key']}|{r['name']}|{r['score']}|"
              f"{r['reviewed']}|{'；'.join(r['why'])}")
    print(" ".join(stat))
    print(f"SUSPECT {len(rows)} · 已列前 {min(n, len(rows))}（`next --n 更多` 可看全）")
    if not rows:
        print("CLEAN 所有封面都还成立（`--all` 没有这个开关，要强制覆盖看用 `--kind both`）")
    return 0


# ── 对照表 ────────────────────────────────────────────────
def _parse_picks(raw: str) -> list[tuple[str, str]]:
    """`city:beijing,province:610000` → `[('city','beijing'), ('province','610000')]`。

    ★ 必须带前缀：`beijing` 与 `610000` 长得不像，但巡检脚本里一个写错就是
      "把省 adcode 当城市 slug 查" ⇒ 静默查不到，表格少一行而没人发现。
    """
    out = []
    for part in raw.replace("，", ",").split(","):
        part = part.strip()
        if not part:
            continue
        k, _, v = part.partition(":")
        if k not in ("city", "province") or not v:
            print(f"★★ 跳过无法解析的 pick「{part}」（要 `city:<slug>` / `province:<adcode>`）")
            continue
        out.append((k, v))
    return out


def cmd_sheet(raw: str) -> int:
    picks = _parse_picks(raw)
    if not picks:
        print("用法：sheet --picks city:beijing,province:610000")
        return 2
    pack = {(u["kind"], u["key"]): u for k in ("city", "province") for u in _units(k)}

    cells, jobs, meta = [], [], []
    for k, key in picks:
        u = pack.get((k, key))
        if u is None:
            print(f"★★ 没有这个单位：{k}:{key}")
            continue
        s, why = _score(u)
        for i, im in enumerate(u["hero"]):
            dest = OUT / "thumbs" / f"{k}-{key}-{i}-{h8(im.get('url', ''))}.jpg"
            jobs.append((im.get("thumbUrl") or im.get("url") or "", dest))
            q = str(im.get("query") or "")[:14]
            cells.append({
                "file": dest, "badge": f"{u['name']}{i + 1}",
                "lines": [f"{u['name']} {i + 1}/{len(u['hero'])} · {q}", (im.get("alt") or "")[:26]],
                "color": (40, 160, 80) if s == 0 else (220, 170, 30) if s < 5 else (200, 50, 50),
            })
        meta.append((k, key, u["name"], s, why))
    if not cells:
        return 1

    (OUT / "thumbs").mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=10) as pool:
        list(pool.map(lambda j: fetch(j[0], j[1]), jobs))
    p = render(cells, OUT / f"sheet-{time.strftime('%H%M%S')}.png",
               cols=6, tile=240, foot=40, font_size=13, bg=(245, 245, 245))
    print("SHEET", p.relative_to(ROOT).as_posix())
    for k, key, name, s, why in meta:
        print(f"UNIT {k}|{key}|{name}|{s}|{'；'.join(why) or '无缺陷'}")
    print("★ 逐格看图判「这张是不是这个单位」，判完 `keep --picks …` 记 reviewedAt")
    return 0


# ── 记账 ──────────────────────────────────────────────────
def cmd_keep(raw: str, why: str) -> int:
    picks = _parse_picks(raw)
    if not picks:
        print("用法：keep --picks city:beijing,province:610000 [--why \"三张都对\"]")
        return 2
    today = time.strftime("%Y-%m-%d")
    for k in ("city", "province"):
        rows = _read(_ledger_of(k))
        hit = 0
        for kk, key in picks:
            if kk != k:
                continue
            row = rows.get(key) or {}
            # ★ 只写 reviewedAt，**不碰 `at`** —— `at` 是"这份数据最后一次改动"，
            #   看完说"还行"没改任何东西，把它推到今天会让"多久没改过"失真。
            row["reviewedAt"] = today
            row.setdefault("state", "ok")
            if why:
                row["reviewWhy"] = why
            rows[key] = row
            hit += 1
        if hit:
            _write(_ledger_of(k), rows)
            print(f"KEEP {k} × {hit} → reviewedAt={today}")
    return 0


# ── URL 探活 ──────────────────────────────────────────────
def _alive(url: str) -> bool:
    """HEAD 一次（3 秒超时）。**只判"还能不能取"，不判内容对不对。**"""
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=3) as r:            # noqa: S310
            return 200 <= r.status < 400
    except Exception:                                                  # noqa: BLE001
        return False


def cmd_urls(kind: str, n: int) -> int:
    """抽查 `n` 个**最久没探活**的单位的封面 URL（轮转，每轮推进一小段）。"""
    kinds = ["city", "province"] if kind == "both" else [kind]
    todo: list[tuple[str, str, str, dict]] = []
    for k in kinds:
        led = _read(_ledger_of(k))
        for u in _units(k):
            age = _age_days(led.get(u["key"], {}).get("urlCheckedAt") or "")
            for im in u["hero"]:
                todo.append((age, k, u["key"], im))
    todo.sort(key=lambda t: -t[0])
    batch = todo[:n]
    if not batch:
        print("URL none（没有可探活的封面）")
        return 0

    with ThreadPoolExecutor(max_workers=6) as pool:
        res = list(pool.map(lambda t: (t, _alive(t[3].get("url") or "")), batch))
    dead: dict[tuple[str, str], list[str]] = {}
    for (t, ok) in res:
        _age, k, key, im = t
        if not ok:
            dead.setdefault((k, key), []).append(str(im.get("alt") or im.get("query") or "?")[:24])
    today = time.strftime("%Y-%m-%d")
    for k in kinds:
        rows = _read(_ledger_of(k))
        hit = 0
        # ★ **探过的全记**，不只是挂了的 —— 否则最旧的那批永远是最旧，
        #   每轮都在探同一批 URL，后面的永远轮不到（`reviewedAt` 同理）。
        for _age, kk, key, _im in batch:
            if kk != k:
                continue
            row = rows.get(key) or {}
            row["urlCheckedAt"] = today
            rows[key] = row
            hit += 1
        if hit:
            _write(_ledger_of(k), rows)

    print(f"URL 探活 {len(batch)} 张 · 挂了 {sum(len(v) for v in dead.values())} 张")
    for (k, key), alts in dead.items():
        print(f"DEAD {k}:{key} → {'；'.join(alts)}")
        print(f"     ⇒ 该单位的图要重抓（`{'city_cover' if k == 'city' else 'province_cover'}.py grab …`）")
    return 0


# ── 多城候选合表（重做时用：一次看完几座城的候选） ──────────
def cmd_cands(raw: str, per: int, depth: int = 1) -> int:
    """把几个城市的候选**拼成一张表** —— 每个城市每个地标各一张（轮转）。

    ★ 为什么不能直接取前 `per` 张：候选是按地标 popularity 排的，切片会让
      一整行全是第一个地标（故宫 ×6），"这座城市拿哪个当门面"就没得挑了。
      省级合表（`province_cover.py sheet all`）踩过同一个坑，这里同口径。
    ★ `--depth` 是**每个地标各取几张**（默认 1 张/地标）。判完一轮发现某城
      凑不满 3 张（绍兴 6 格里 5 格是废的）时，把它抬到 2~3 再看一轮 ——
      比"再 grab 一次"省得多：候选本来就有 40+ 张，只是没上表。
    ★ 只有 `city` 有意义：省的候选在 `_tmp/province-cover/<adcode>/`，
      省级本来就 34 个、一张表能放 4 个省，用 `province_cover.py sheet all`。
    """
    picks = [p for p in _parse_picks(raw) if p[0] == "city"]
    if not picks:
        print("用法：cands --picks city:guangzhou,city:guilin [--per 6] [--depth 2]")
        return 2
    cells, jobs, meta = [], [], []
    for _k, slug in picks:
        src = cc.OUT / slug / "candidates.jsonl"
        if not src.exists():
            print(f"MISS {slug}：没有候选 —— 先 `city_cover.py grab {slug}`")
            continue
        rows = [json.loads(x) for x in src.read_text(encoding="utf-8").splitlines() if x.strip()]
        groups: dict[str, list[dict]] = {}
        for c in rows:
            groups.setdefault(c.get("poi") or "?", []).append(c)
        pick, d = [], 0
        while len(pick) < per and d < max(1, depth):
            for g in groups.values():
                if d < len(g) and len(pick) < per:
                    pick.append(g[d])
            d += 1
        for r in pick:
            dest = OUT / "thumbs" / f"cand-{slug}-{r['idx']}-{h8(r.get('url', ''))}.jpg"
            jobs.append((r.get("thumb") or r.get("url") or "", dest))
            cells.append({
                "file": dest, "badge": f"{slug}#{r['idx']}",
                "lines": [f"{slug}#{r['idx']} {r.get('poi') or '?'}",
                          f"{r.get('filter') or '?'} {r.get('distance_m') or ''}m".strip()],
                "color": (40, 160, 80) if r.get("filter") == "ok" else (220, 170, 30),
            })
        # ★ apply 只认 `_tmp/city-cover/<slug>/manifest.json`（`cmd_sheet` 写的）。
        #   合表不写这一份，`apply` 会直接报「缺 manifest.json」—— 判定白写。
        #   ★★ 写**全部候选**而不是上表的这 `per` 张：判定时常常要从"没上表的那几张"里
        #   补一个（同一地标第 3 张），manifest 只收上表的会让 apply 认不出那个 idx。
        keep = {"idx", "poi", "url", "thumb", "alt", "tier", "via", "source", "author",
                "sourceUrl", "license", "attributionRequired", "distance_m", "filter", "taken"}
        (cc.OUT / slug).mkdir(parents=True, exist_ok=True)
        (cc.OUT / slug / "manifest.json").write_text(json.dumps(
            [{k: v for k, v in r.items() if k in keep} for r in rows], ensure_ascii=False, indent=1),
            encoding="utf-8")
        meta.append((slug, len(rows), len(pick)))
    if not cells:
        return 1

    (OUT / "thumbs").mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(lambda j: fetch(j[0], j[1]), jobs))
    # ★ 列数固定 6，**不跟着 `--per` 走**：per=12 时若排成一行 12 格，
    #   整张表宽 2880、看图时被缩到 1080，每格只剩 100px —— 匾额和招牌全糊了。
    p = render(cells, OUT / f"cands-{'-'.join(s for _k, s in picks)[:60]}-{time.strftime('%H%M%S')}.png",
               cols=6, tile=240, foot=42, font_size=12, bg=(245, 245, 245))
    print("SHEET", p.relative_to(ROOT).as_posix())
    for slug, n, used in meta:
        print(f"CITY {slug} 候选 {n} 张 · 本表 {used} 格")
    print("★ 判 ok 的写 `_tmp/city-cover/<slug>/verdicts.jsonl`（alt 必须中文 ≥8 字），再 apply")
    return 0


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 2
    cmd = args[0]
    kind = "both"
    for i, a in enumerate(args):
        if a == "--kind" and i + 1 < len(args):
            kind = args[i + 1]
    if kind not in ("city", "province", "both"):
        print(f"★★ --kind 只能是 city / province / both（收到「{kind}」）")
        return 2

    def opt(key: str, default: str = "") -> str:
        return args[args.index(key) + 1] if key in args and args.index(key) + 1 < len(args) else default

    if cmd == "next":
        return cmd_next(kind, int(opt("--n", "6")))
    if cmd == "sheet":
        return cmd_sheet(opt("--picks"))
    if cmd == "cands":
        return cmd_cands(opt("--picks"), int(opt("--per", "6")), int(opt("--depth", "1")))
    if cmd == "keep":
        return cmd_keep(opt("--picks"), opt("--why"))
    if cmd == "urls":
        return cmd_urls(kind, int(opt("--n", "12")))
    print(__doc__)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
