#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""城市封面（`city.json.heroImages`）的**审查与重抓** —— 2026-11-12。

## 为什么城市封面要单独一套

83 城 × 3 张 hero 全部由 `pipeline/steps/step4_images.fill_city_images` 用
`"<城市> China city skyline" / "<城市> 城市风光"` 搜出来，中间**没有"看一眼"**。
逐格看下来，83 张首图里 ≥30 张不是这座城：

| 城市 | 现在挂的是什么 |
|---|---|
| 杭州 / 承德 / 大连 | 明星写真 / 1926 年**十元纸币** / 寒假聚会**合影** |
| 西安 | **南京**城墙（文件名自带「南京城市风光」） |
| 西宁 / 大同 / 开封 | **上海**东方明珠 / **北京**白塔 |
| 兰州 / 扬州 | **广州**天际线 |
| 武汉 / 镇江 / 九江 / 南昌 / 天津 | **南京**天际线 |
| 福州 / 重庆 / 平遥 | 春晚舞台照 / 机场航站楼 / 位置示意图 |

两类坏法，跟 6602 张主题图污染同源：
  ① **张冠李戴** —— 图库的语义搜索对"城市名"只做"看起来像城市"的匹配，没有地理校验，
     `alt` 里甚至直接写着 Guangzhou / Nanjing / Qingdao / Shanghai；
  ② **画面根本不是城市** —— 纸币、地图、合影、壁画、演出、饭店大堂。

## 口径（与 POI 图不同，别混用）

1. **城市封面 = 这座城里认得出的地标，不是"城市天际线"** ⇒ 查询词只用该城
   `popularity` 最高的几个**点位名**（故宫 / 大雁塔 / 西湖），不用"城市名 + skyline"。
   点位名在 Commons 有真实照片与人工分类，城市名没有。
2. **只收 Wikimedia**。图库**无法验证地理**：看图也只看得出"是个城市"，
   看不出是哪座城 —— 这一条对 Pexels/Unsplash 是原理性的，不是抽样结论。
3. **逐张看图**（本工具存在的理由）：候选表 → verdicts → apply。没有 AI 看图那一关，
   元数据过滤只拦得掉"说得明白的错"（见 `pipeline/authoring/image_filter.py`）。
4. 判 ok 不足 1 张 ⇒ **不动旧值**（schema 要求 `heroImages` 至少 1 张），账本记 `need`。

## 命令（python tools/city_cover.py …）

    audit [--all]  mark <slug> keep|need --why  grab <slug>…  sheet <slug> [--dense|--only]
    apply <slug> [--dry]  status            # 不带参数时打印完整用法

## 判定文件（人/Agent 写，工具只读）

`_tmp/city-cover/<slug>/verdicts.jsonl`，一行一张：

    {"idx": 3, "verdict": "ok", "alt": "西安 大雁塔 与 大慈恩寺 建筑群"}
    {"idx": 7, "verdict": "reject"}

★ `ok` 的 `alt` **必须写**（中文，≥8 字）：Commons 文件名不符合本项目
  「alt 必须中文描述」的口径，而且常年带着 `- panoramio (2).jpg` 这种噪声。
  缺 alt / 没中文 ⇒ **整批拒收**（不做"写一半"）。
★ `ok` 最多 3 张（schema 上限），多判了同样整批拒收 —— 让"到底要哪三张"是人的决定。
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pipeline.authoring.image_filter import (                            # noqa: E402
    _haversine, core_name, gps_of, verdict_for,
)
from pipeline.authoring.images import search_wikimedia                   # noqa: E402
from pipeline.core.layout import iter_city_dirs                          # noqa: E402
from tools.cover_sheet import audit_covers, h8, render                   # noqa: E402
from tools.review_images import fetch                                    # noqa: E402

OUT = ROOT / "_tmp" / "city-cover"
LEDGER = ROOT / "data" / "_generated" / "city-covers.json"
MAX_HERO = 3
CJK = re.compile(r"[\u3400-\u9fff]")
#: 地标名里的噪声：演出/剧场是"活动"不是"地"，Commons 只能搜到舞台灯
NOISE = ("演出", "秀", "剧场", "剧院", "《", "》", "夜游", "游船", "索道")

#: 候选来源渠道 → 排序权重（地标图优先于城市名搜到的空镜）
TIER_ORDER = {"landmark": 0, "city": 1}


# ── 基础设施 ────────────────────────────────────────────────
def _load(slug: str) -> tuple[Path, dict] | None:
    for _prov, cid, d in iter_city_dirs():
        if cid == slug:
            p = d / "city.json"
            return p, json.loads(p.read_text(encoding="utf-8"))
    return None


def _ledger() -> dict:
    if not LEDGER.exists():
        return {}
    return json.loads(LEDGER.read_text(encoding="utf-8"))


def _mark(slug: str, state: str, **extra) -> None:
    rows = _ledger()
    row = rows.get(slug) or {}
    row.update({"state": state, "at": time.strftime("%Y-%m-%d")})
    row.update({k: v for k, v in extra.items() if v not in (None, "")})
    rows[slug] = row
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    LEDGER.write_text(json.dumps(dict(sorted(rows.items())), ensure_ascii=False, indent=1) + "\n",
                      encoding="utf-8")


def _poi_used_urls(city_dir: Path) -> set[str]:
    """本城所有点位已占用的图 URL —— 城市封面**不许**和本城点位撞图。"""
    used: set[str] = set()
    for p in city_dir.glob("pois/*/*.json"):
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
        except Exception:                                              # noqa: BLE001
            continue
        used.update((im or {}).get("url", "") for im in (d.get("images") or []))
    return used


def _landmarks(city_dir: Path, doc: dict, n: int = 6) -> list[dict]:
    """该城**认得出的地标**（popularity 降序），用于生成 Commons 查询词。

    ★ bbox 之外的点位要排掉：西安 popularity 第 4 的「华山」属渭南，
      拿它当西安封面就是"别的城市"—— 与这次要修的病同型。
    ★ 还要再加一道**距市中心 50km**：西安库里那条「华山」坐标是错的
      （落在 108.23/33.81，真身在 110.08/34.48），只靠 bbox 拦不住它。
    """
    bbox = doc.get("bbox") or []
    c = doc.get("center") or {}
    cpt = (float(c.get("lng") or 0), float(c.get("lat") or 0)) if c else None
    rows = []
    for p in city_dir.glob("pois/*/*.json"):
        poi = json.loads(p.read_text(encoding="utf-8"))
        pt = (poi.get("location") or {}).get("point") or {}
        lng, lat = pt.get("lng"), pt.get("lat")
        if not isinstance(lng, (int, float)) or not isinstance(lat, (int, float)):
            continue
        if isinstance(bbox, list) and len(bbox) == 4 and not (
                bbox[0] <= lng <= bbox[2] and bbox[1] <= lat <= bbox[3]):
            continue
        if cpt and _haversine(cpt[0], cpt[1], lng, lat) > 50_000:
            continue
        name = str(poi.get("name") or "")
        if any(w in name for w in NOISE):
            continue
        # ★ 美食**不能当地标**：popularity 排序会把「广州酒家 / 陶陶居 / 崇善米粉」
        #   排进前 6，它们的 Commons 照片是一盘点心，不是这座城的门面。
        #   省级早就排掉了（`province_cover._landmarks`），城市这边当年漏了
        #   —— 2026-11-14 重做 14 城封面时抓出来（九江 12 张候选全是菜）。
        if str(poi.get("category") or "") == "food":
            continue
        rows.append({"name": core_name(name), "point": [float(lng), float(lat)],
                     "pop": int(poi.get("popularity") or 0)})
    rows.sort(key=lambda r: -r["pop"])
    seen, out = set(), []
    for r in rows:
        if r["name"] in seen:
            continue
        seen.add(r["name"])
        out.append(r)
        if len(out) >= n:
            break
    return out


# ── grab：抓地标候选 ──────────────────────────────────────
def _candidates_for(cpath: Path, doc: dict) -> tuple[list[dict], list[dict]]:
    city_name = doc.get("name", doc.get("id", ""))
    used = _poi_used_urls(cpath.parent)
    marks = _landmarks(cpath.parent, doc, 6)
    queries: list[tuple[str, str, list | None]] = []
    for m in marks:
        queries += [(f"{m['name']} {city_name}", m["name"], m["point"]),
                    (m["name"], m["name"], m["point"])]
    # 兜底通道：地标图太少时才用城市名（它的图质量差，但比没有强）
    queries += [(f"{city_name} 城市风光", city_name, None),
                (f"{city_name} skyline", city_name, None)]

    cands: list[dict] = []
    seen: set[str] = set()
    for kw, label, point in queries:
        if len(cands) >= 48:
            break
        pseudo = {"name": label}
        if point:
            pseudo["location"] = {"point": {"lng": point[0], "lat": point[1]}}
        for img in search_wikimedia(kw, per_page=8):
            url = img.get("url") or ""
            if not url or url in seen:
                continue
            seen.add(url)
            v, why, score = verdict_for(img, pseudo, city=city_name)
            if v == "reject":
                continue
            meta = img.pop("_filterMeta", None) or {}
            dist = None
            gps = gps_of(meta.get("gps") or {})
            if point and gps:
                dist = int(_haversine(point[0], point[1], gps[0], gps[1]))
            credit = img.get("credit") or {}
            cands.append({
                "idx": len(cands), "poi": label, "via": kw,
                "tier": "landmark" if point else "city",
                "url": url, "thumb": img.get("thumbUrl"),
                "alt": img.get("alt") or "",
                "width": img.get("width"), "height": img.get("height"),
                "source": credit.get("source", "wikimedia"),
                "author": credit.get("author", ""),
                "sourceUrl": credit.get("sourceUrl", ""),
                "license": credit.get("license", ""),
                "attributionRequired": credit.get("attributionRequired", True),
                "filter": v, "why": why, "score": score,
                "distance_m": dist, "taken": url in used,
            })
    return cands, marks


def cmd_grab(slugs: list[str]) -> int:
    bad = 0
    for slug in slugs:
        got = _load(slug)
        if got is None:
            print(f"★★ 没有这座城市：{slug}")
            bad += 1
            continue
        cpath, doc = got
        cands, marks = _candidates_for(cpath, doc)
        if not marks:
            print(f"{slug}：拿不到地标（点位没有坐标）⇒ 跳过")
            bad += 1
            continue
        out = OUT / slug
        out.mkdir(parents=True, exist_ok=True)
        (out / "candidates.jsonl").write_text(
            "\n".join(json.dumps(c, ensure_ascii=False) for c in cands) + "\n", encoding="utf-8")
        (out / "verdicts.jsonl").unlink(missing_ok=True)
        print(f"GRAB {slug} 地标 {len(marks)}（{', '.join(m['name'] for m in marks[:4])}…）"
              f" 候选 {len(cands)}")
    return 1 if bad else 0


# ── sheet：候选对照表 ────────────────────────────────────
def cmd_sheet(slug: str, dense: bool, only: list[int]) -> int:
    src = OUT / slug / "candidates.jsonl"
    if not src.exists():
        print(f"没有 {src} —— 先跑 `grab {slug}`")
        return 1
    rows = [json.loads(x) for x in src.read_text(encoding="utf-8").splitlines() if x.strip()]
    if only:
        by = {r["idx"]: r for r in rows}
        miss = [i for i in only if i not in by]
        if miss:
            print(f"★★ 这些序号不在候选里：{miss}")
        rows = [by[i] for i in only if i in by]
    if not rows:
        print("候选为空")
        return 1

    out = OUT / slug
    (out / "thumbs").mkdir(parents=True, exist_ok=True)
    for r in rows:
        r["_file"] = out / "thumbs" / f"cand-{r['idx']}-{h8(r['url'])}.jpg"
    with ThreadPoolExecutor(max_workers=10) as pool:
        list(pool.map(lambda r: fetch(r["thumb"] or r["url"], r["_file"]), rows))
    lost = [r["idx"] for r in rows if not r["_file"].exists()]
    if lost:
        print(f"★★ {len(lost)} 格取不到缩略图（看不到就不能判）：{lost[:10]}")

    cols, tile, foot = (8, 160, 24) if dense else (5, 300, 44)
    per = cols * 6
    for s in range(0, len(rows), per):
        chunk = rows[s:s + per]
        cells = []
        for r in chunk:
            dist = f" {r['distance_m']}m" if r.get("distance_m") is not None else ""
            sub = "已属本城点位" if r["taken"] else f"{r['tier']} · {r['via'][:22]}"
            cells.append({
                "file": r["_file"], "badge": f"#{r['idx']}",
                "lines": [f"#{r['idx']} {r['poi']}{dist}"] + ([] if dense else [sub]),
                "color": (150, 150, 150) if r["taken"] else
                         {"ok": (40, 160, 80), "suspect": (220, 170, 30)}.get(
                             r["filter"], (200, 50, 50)),
                "fill": (150, 150, 150) if r["taken"] else (30, 30, 30),
            })
        stem = "dense" if dense else ("pick" if only else "cand")
        p = render(cells, out / f"sheet-{stem}-{s // per + 1}.png",
                   cols=cols, tile=tile, foot=foot, font_size=12 if dense else 13, bg=(245, 245, 245))
        print("SHEET", p.relative_to(ROOT).as_posix())

    keep = {"idx", "poi", "url", "thumb", "alt", "tier", "via", "source", "author",
            "sourceUrl", "license", "attributionRequired", "distance_m", "taken", "filter"}
    (out / "manifest.json").write_text(json.dumps(
        [{k: v for k, v in r.items() if k in keep} for r in rows], ensure_ascii=False, indent=1),
        encoding="utf-8")
    print(f"候选 {len(rows)} 张 · manifest.json 已更新")
    return 0


# ── apply：写回 heroImages ───────────────────────────────
def cmd_apply(slug: str, dry: bool) -> int:
    base = OUT / slug
    mpath, vpath = base / "manifest.json", base / "verdicts.jsonl"
    if not mpath.exists() or not vpath.exists():
        print(f"缺 {mpath.name} 或 {vpath.name} —— 先 grab + sheet + 写判定")
        return 1
    got = _load(slug)
    if got is None:
        print(f"没有这座城市：{slug}")
        return 1
    cpath, doc = got
    manifest = {r["idx"]: r for r in json.loads(mpath.read_text(encoding="utf-8"))}
    verdicts = {}
    for line in vpath.read_text(encoding="utf-8").splitlines():
        if line.strip():
            row = json.loads(line)
            verdicts[int(row["idx"])] = row

    oks = [i for i in sorted(verdicts) if verdicts[i].get("verdict") == "ok"]
    errs = [f"#{i} 的 alt 缺失或不是中文描述（当前「{str(verdicts[i].get('alt'))[:20]}」）"
            for i in oks
            if len(str(verdicts[i].get("alt") or "")) < 8 or not CJK.search(str(verdicts[i]["alt"]))]
    if len(oks) > MAX_HERO:
        errs.append(f"判 ok {len(oks)} 张 > 上限 {MAX_HERO} —— 到底留哪三张是人的决定")
    if not oks:
        errs.append("一张都没判 ok —— 不动旧值（schema 要求至少 1 张），改完 verdicts 再跑")
    if errs:
        print("★★ 整批拒收（一条都没写）：")
        for e in errs:
            print("   ·", e)
        return 2

    used = _poi_used_urls(cpath.parent)
    # ★ 城市封面**允许**与本城点位同图（钟楼既是一个点位、也是西安的门面），
    #   与「同城点位之间一图不挂两处」是两件事：后者是张冠李戴，前者是同一个东西。
    #   顺序由判定里的 `order` 决定（没写就按 地标优先 / 候选序号）。
    oks.sort(key=lambda i: (int(verdicts[i].get("order", 99)),
                            TIER_ORDER.get(manifest[i].get("tier"), 9), i))
    hero, same = [], 0
    for i in oks:
        e = manifest[i]
        if e["url"] in {h["url"] for h in hero}:
            continue
        if e.get("taken") or e["url"] in used:
            same += 1
        hero.append({
            "url": e["url"], "thumbUrl": e.get("thumb") or e["url"],
            "width": int(e.get("width") or 1080), "height": int(e.get("height") or 720),
            "alt": str(verdicts[i]["alt"]).strip(),
            "query": e.get("poi") or doc.get("name", slug),
            "credit": {
                "source": e.get("source") or "wikimedia",
                "author": e.get("author") or "Wikimedia Commons 贡献者",
                "sourceUrl": e.get("sourceUrl") or e["url"],
                "license": e.get("license") or "见来源页",
                "attributionRequired": bool(e.get("attributionRequired", True)),
            },
        })
    if not hero:
        print("★★ 一张都拼不出来 —— 不动旧值")
        return 2

    before = len(doc.get("heroImages") or [])
    if not dry:
        doc["heroImages"] = hero
        doc["updatedAt"] = time.strftime("%Y-%m-%d")
        cpath.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        _mark(slug, "ok", by="apply", kept=len(hero), why=f"重抓 {len(hero)} 张")
    print(f"{'[演练] ' if dry else ''}{slug}：封面 {before} → {len(hero)} 张"
          + (f"（其中 {same} 张与本城点位同图）" if same else ""))
    for h in hero:
        print(f"   · {h['alt']} · {h['credit']['author'][:20]} · {h['credit']['license']}")
    return 0


# ── status ──────────────────────────────────────────────
def cmd_status() -> int:
    rows = _ledger()
    cities = [(slug, (rows.get(slug) or {}).get("state")) for _p, slug, _d in iter_city_dirs()]
    ok = [s for s, st in cities if st == "ok"]
    need = [s for s, st in cities if st == "need"]
    print(f"城市 {len(cities)} · 封面已换好 {len(ok)} · 待重抓 {len(need)} "
          f"· 未审 {len(cities) - len(ok) - len(need)}（账本 {LEDGER.name}）")
    if need:
        print("待重抓：" + " ".join(need[:24]) + (" …" if len(need) > 24 else ""))
    return 0


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 2
    cmd = args[0]

    def opt(key: str, default: str = "") -> str:
        return args[args.index(key) + 1] if key in args and args.index(key) + 1 < len(args) else default

    if cmd == "audit":
        return audit_covers(LEDGER, OUT / "audit", all_="--all" in args, root=ROOT)
    if cmd == "mark":
        slug, state = (args[1] if len(args) > 1 else ""), (args[2] if len(args) > 2 else "")
        if state not in ("keep", "need"):
            print('用法：mark <slug> keep|need --why "..."')
            return 2
        _mark(slug, "ok" if state == "keep" else "need", why=opt("--why"))
        print(f"MARK {slug} → {'ok' if state == 'keep' else 'need'}")
        return 0
    if cmd == "grab":
        return cmd_grab([a for a in args[1:] if not a.startswith("--")])
    if cmd == "sheet":
        only = [int(x) for x in opt("--only").replace("，", ",").split(",") if x.strip()]
        return cmd_sheet(args[1] if len(args) > 1 else "", "--dense" in args, only)
    if cmd == "apply":
        return cmd_apply(args[1] if len(args) > 1 else "", "--dry" in args)
    if cmd == "status":
        return cmd_status()
    print(__doc__)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
