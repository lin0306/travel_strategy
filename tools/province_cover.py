#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""省级封面（`data/provinces/index.json` 的 `heroImages`）—— 抓候选 / 看图 / 写回。

## 为什么省级要单独一套（2026-11-14）

用户问「省的介绍和图片不抓吗」。查下来省级在 `data/` 里**只有区划与边界**，
一张图都没有 —— 所以省卡只能拿"下辖几个市、收了哪几座"凑一段话。
补内容层时，图不能照城市那套旧做法（`"<名字> China city skyline"` 一条关键词直接落盘）：

| 做法 | 后果 |
|---|---|
| 用**省名**搜图 | Commons 上省名匹配到的多是**行政地图 / 空白轮廓图**，一张都不能用 |
| 用**省里最热门的点位名**搜 | 有真实照片与人工分类（故宫 / 兵马俑 / 泰山），这才是"这个省的门面" |
| 抓完直接落盘 | 库里有大量张冠李戴（城市封面 83 张首图里 30 张不是那座城）⇒ 必须**逐张看图** |

## 口径（与城市封面同一套，只是地标来源换成"全省"）

1. 地标 = 该省**所有已收录城市**的点位，按 `popularity` 降序取前 6 —— 不按城市分组。
   省级不需要再按 bbox / 50km 过滤：华山属渭南，但**属陕西**，当陕西省封面是对的
   （城市封面必须排掉它，那是另一件事）。
2. **只收 Wikimedia**：图库无地理校验，看图也只看得出"是个景点"，判不出在哪。
3. 逐张看图：`grab → sheet → verdicts → apply`。`ok` 的 `alt` **必须中文 ≥8 字**，
   最多 3 张，缺一即整批拒收。
4. 判 ok 不足 1 张 ⇒ **不动旧值**（`heroImages` 允许为空，省卡退回只显示收录情况）。

## 命令

    grab <adcode>…|all      sheet all [--per 6]      sheet <adcode>
    apply <adcode>…|all [--dry]      status

## 判定文件（人/Agent 写，工具只读）

`_tmp/province-cover/<adcode>/verdicts.jsonl`，一行一张：

    {"idx": 3, "verdict": "ok", "alt": "陕西 秦始皇兵马俑一号坑 陶俑阵列"}
    {"idx": 7, "verdict": "reject"}

★ 判 reject 的**不用写理由**：省封面只看"这张是不是这个省"，一张图一句话说不清就换下一张。
"""
from __future__ import annotations

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
from tools.cover_sheet import h8, render                                 # noqa: E402
from tools.review_images import fetch                                    # noqa: E402

DATA = ROOT / "data" / "provinces" / "index.json"
TREE = ROOT / "data" / "_generated" / "district-tree.json"
OUT = ROOT / "_tmp" / "province-cover"
LEDGER = ROOT / "data" / "_generated" / "province-covers.json"
MAX_HERO = 3
PER_MARK = 6
CJK = re.compile(r"[\u3400-\u9fff]")
NOISE = ("演出", "秀", "剧场", "剧院", "《", "》", "夜游", "游船", "索道")
TIER_ORDER = {"landmark": 0, "city": 1}


# ── 基础设施 ────────────────────────────────────────────────
def _index() -> dict:
    return json.loads(DATA.read_text(encoding="utf-8"))


def _names() -> dict[str, str]:
    """adcode → 省简称（北京 / 陕西 …），取自区划树。"""
    if not TREE.exists():
        return {}
    doc = json.loads(TREE.read_text(encoding="utf-8"))
    return {p["adcode"]: p.get("name") or p["adcode"] for p in doc.get("provinces") or []}


def _ledger() -> dict:
    if not LEDGER.exists():
        return {}
    return json.loads(LEDGER.read_text(encoding="utf-8"))


def _mark(adcode: str, state: str, **extra) -> None:
    rows = _ledger()
    row = rows.get(adcode) or {}
    row.update({"state": state, "at": time.strftime("%Y-%m-%d")})
    row.update({k: v for k, v in extra.items() if v not in (None, "")})
    rows[adcode] = row
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    LEDGER.write_text(json.dumps(dict(sorted(rows.items())), ensure_ascii=False, indent=1) + "\n",
                      encoding="utf-8")


def _cities_of() -> dict[str, list[Path]]:
    """省级 adcode → 该省各城市的目录（只读 `city.json` 的 `provinceAdcode`）。"""
    out: dict[str, list[Path]] = {}
    for cj in (ROOT / "data" / "cities").glob("*/*/city.json"):
        try:
            doc = json.loads(cj.read_text(encoding="utf-8"))
        except Exception:                                              # noqa: BLE001
            continue
        out.setdefault(str(doc.get("provinceAdcode") or ""), []).append(cj.parent)
    return out


def _landmarks(adcode: str, n: int = PER_MARK) -> list[dict]:
    """该省**认得出的地标**（全省点位按 popularity 降序）。

    ★ 不过滤到某座城的 bbox：省级就该收全省的（华山算陕西的门面）。
    """
    rows = []
    for cdir in _cities_of().get(adcode, []):
        for p in cdir.glob("pois/*/*.json"):
            try:
                poi = json.loads(p.read_text(encoding="utf-8"))
            except Exception:                                          # noqa: BLE001
                continue
            name = str(poi.get("name") or "")
            pt = (poi.get("location") or {}).get("point") or {}
            lng, lat = pt.get("lng"), pt.get("lat")
            # ★ 美食**不能当省封面**：popularity 排序会把「啤酒鱼 / 桂林米粉」排进前 6，
            #   它们的照片是一盘菜，不是"这个省的门面"。城市封面不用管这条
            #   （地标检索本就只取 scenic），省级要显式排掉 food。
            if str(poi.get("category") or "") == "food":
                continue
            if not name or any(w in name for w in NOISE):
                continue
            if not isinstance(lng, (int, float)) or not isinstance(lat, (int, float)):
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


# ── grab ──────────────────────────────────────────────────
def _candidates_for(adcode: str, prov: str) -> tuple[list[dict], list[dict]]:
    marks = _landmarks(adcode)
    cands: list[dict] = []
    seen: set[str] = set()
    for m in marks:
        for kw in (m["name"], f"{m['name']} {prov}"):
            if len(cands) >= 48:
                break
            pseudo = {"name": m["name"],
                      "location": {"point": {"lng": m["point"][0], "lat": m["point"][1]}}}
            for img in search_wikimedia(kw, per_page=8):
                url = img.get("url") or ""
                if not url or url in seen:
                    continue
                seen.add(url)
                v, why, score = verdict_for(img, pseudo, city=prov)
                if v == "reject":
                    continue
                meta = img.pop("_filterMeta", None) or {}
                gps = gps_of(meta.get("gps") or {})
                dist = (int(_haversine(m["point"][0], m["point"][1], gps[0], gps[1]))
                        if gps else None)
                credit = img.get("credit") or {}
                cands.append({
                    "idx": len(cands), "poi": m["name"], "via": kw, "tier": "landmark",
                    "url": url, "thumb": img.get("thumbUrl"),
                    "alt": img.get("alt") or "",
                    "width": img.get("width"), "height": img.get("height"),
                    "source": credit.get("source", "wikimedia"),
                    "author": credit.get("author", ""),
                    "sourceUrl": credit.get("sourceUrl", ""),
                    "license": credit.get("license", ""),
                    "attributionRequired": credit.get("attributionRequired", True),
                    "filter": v, "why": why, "score": score, "distance_m": dist,
                })
    return cands, marks


def cmd_grab(targets: list[str], force: bool = False) -> int:
    """抓候选。

    ★ **并发按省**：一个省最多 6 地标 × 2 条查询 = 12 次 Commons 请求，
      单次 3~8 秒（`search_wikimedia` 超时 20s、无重试）⇒ 串行跑 34 个省要半小时。
      Commons 没有配额限制，按省并发 5 路是安全的。
    ★ **已抓过的省直接跳过**（`candidates.jsonl` 在就算）：抓取是幂等的，
      但重跑一次就是十几分钟 —— 迭代时不应该为"补剩下的省"付全量代价。
    """
    names = _names()
    idx = _index()
    if "all" in targets:
        targets = [a for a in sorted(idx["provinces"]) if _landmarks(a)]

    todo = []
    for adcode in targets:
        if not force and (OUT / adcode / "candidates.jsonl").exists():
            continue
        todo.append(adcode)
    skipped = len(targets) - len(todo)
    if skipped:
        print(f"跳过已抓 {skipped} 个省（要重抓加 --force）", flush=True)

    def one(adcode: str) -> str:
        prov = names.get(adcode, adcode)
        cands, marks = _candidates_for(adcode, prov)
        if not marks:
            return f"{prov}({adcode})：拿不到地标（该省还没有已收录城市）⇒ 跳过"
        out = OUT / adcode
        out.mkdir(parents=True, exist_ok=True)
        (out / "candidates.jsonl").write_text(
            "\n".join(json.dumps(c, ensure_ascii=False) for c in cands) + "\n", encoding="utf-8")
        (out / "verdicts.jsonl").unlink(missing_ok=True)
        return (f"GRAB {prov}({adcode}) 地标 {len(marks)}"
                f"（{', '.join(m['name'] for m in marks[:4])}…）候选 {len(cands)}")

    bad = 0
    with ThreadPoolExecutor(max_workers=5) as pool:
        for msg in pool.map(one, todo):
            print(msg, flush=True)
            if "跳过" in msg:
                bad += 1
    return 1 if bad else 0


# ── sheet ─────────────────────────────────────────────────
def _rows(adcode: str) -> list[dict]:
    src = OUT / adcode / "candidates.jsonl"
    if not src.exists():
        return []
    return [json.loads(x) for x in src.read_text(encoding="utf-8").splitlines() if x.strip()]


def _thumbs(adcode: str, rows: list[dict]) -> None:
    out = OUT / adcode
    (out / "thumbs").mkdir(parents=True, exist_ok=True)
    for r in rows:
        r["_file"] = out / "thumbs" / f"cand-{r['idx']}-{h8(r['url'])}.jpg"
    with ThreadPoolExecutor(max_workers=10) as pool:
        list(pool.map(lambda r: fetch(r["thumb"] or r["url"], r["_file"]), rows))
    lost = [r["idx"] for r in rows if not r["_file"].exists()]
    if lost:
        print(f"★★ {adcode} 有 {len(lost)} 格取不到缩略图（看不到就不能判）：{lost[:8]}")


def _cell(prov: str, r: dict) -> dict:
    dist = f" {r['distance_m']}m" if r.get("distance_m") is not None else ""
    return {
        "file": r["_file"], "badge": f"#{r['idx']}",
        "lines": [f"{prov}#{r['idx']} {r['poi']}{dist}", f"{r['filter']}"],
        "color": {"ok": (40, 160, 80), "suspect": (220, 170, 30)}.get(r["filter"], (200, 50, 50)),
        "fill": (30, 30, 30),
    }


def cmd_sheet_one(adcode: str) -> int:
    rows = _rows(adcode)
    if not rows:
        print(f"没有 {adcode} 的候选 —— 先跑 `grab {adcode}`")
        return 1
    _thumbs(adcode, rows)
    prov = _names().get(adcode, adcode)
    per = 30
    for s in range(0, len(rows), per):
        chunk = rows[s:s + per]
        p = render([_cell(prov, r) for r in chunk], OUT / adcode / f"sheet-{s // per + 1}.png",
                   cols=5, tile=300, foot=44, font_size=13, bg=(245, 245, 245))
        print("SHEET", p.relative_to(ROOT).as_posix())
    keep = {"idx", "poi", "url", "thumb", "alt", "tier", "via", "source", "author",
            "sourceUrl", "license", "attributionRequired", "distance_m", "filter"}
    (OUT / adcode / "manifest.json").write_text(json.dumps(
        [{k: v for k, v in r.items() if k in keep} for r in rows], ensure_ascii=False, indent=1),
        encoding="utf-8")
    return 0


def cmd_sheet_batch(per: int) -> int:
    """把多个省拼成一张大表 —— 一次看图就能给几个省各挑一张（省着 34 次单独看）。

    ★ 每个省取**每个地标各一张**（轮转），不是取前 `per` 张：
      候选是按地标 popularity 排的，直接切片会让一整行全是同一个地标（故宫 ×6），
      那就等于没得挑 —— 而"这个省拿哪个当门面"正是这张表要回答的问题。
    """
    names = _names()
    rows_all: list[dict] = []
    for adcode in sorted(_index()["provinces"]):
        rows = _rows(adcode)
        if not rows:
            continue
        groups: dict[str, list[dict]] = {}
        for c in rows:
            groups.setdefault(c["poi"], []).append(c)
        pick: list[dict] = []
        depth = 0
        while len(pick) < per and depth < 8:
            for g in groups.values():
                if depth < len(g) and len(pick) < per:
                    pick.append(g[depth])
            depth += 1
        _thumbs(adcode, pick)
        for r in pick:
            r["_prov"] = names.get(adcode, adcode)
            r["_adcode"] = adcode
        rows_all.extend(pick)

    if not rows_all:
        print("一个省的候选都没有 —— 先跑 `grab all`")
        return 1

    per_sheet = per * 4                       # 一张表 4 个省
    for s in range(0, len(rows_all), per_sheet):
        chunk = rows_all[s:s + per_sheet]
        p = render([_cell(r["_prov"], r) for r in chunk], OUT / f"all-{s // per_sheet + 1}.png",
                   cols=per, tile=240, foot=40, font_size=12, bg=(245, 245, 245))
        print("SHEET", p.relative_to(ROOT).as_posix(), f"（{chunk[0]['_prov']} … {chunk[-1]['_prov']}）")
    (OUT / "all-manifest.json").write_text(json.dumps(
        [{k: r.get(k) for k in ("idx", "poi", "url", "thumb", "alt", "source", "author",
                                "sourceUrl", "license", "attributionRequired", "distance_m",
                                "filter", "_adcode", "_prov")} for r in rows_all],
        ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"候选 {len(rows_all)} 张 · all-manifest.json（每省前 {per} 张）")
    return 0


# ── apply ─────────────────────────────────────────────────
def _hero_of(manifest: dict[int, dict], verdicts: dict[int, dict], prov: str) -> list[dict]:
    oks = [i for i in sorted(verdicts) if verdicts[i].get("verdict") == "ok"]
    oks.sort(key=lambda i: int(verdicts[i].get("order", 99)))
    hero = []
    for i in oks:
        e = manifest[i]
        hero.append({
            "url": e["url"], "thumbUrl": e.get("thumb") or e["url"],
            "width": int(e.get("width") or 1080), "height": int(e.get("height") or 720),
            "alt": str(verdicts[i]["alt"]).strip(),
            "query": e.get("poi") or prov,
            "credit": {
                "source": e.get("source") or "wikimedia",
                "author": e.get("author") or "Wikimedia Commons 贡献者",
                "sourceUrl": e.get("sourceUrl") or e["url"],
                "license": e.get("license") or "见来源页",
                "attributionRequired": bool(e.get("attributionRequired", True)),
            },
        })
    return hero


def cmd_apply(targets: list[str], dry: bool) -> int:
    names = _names()
    idx = _index()
    if "all" in targets:
        targets = [a for a in sorted(idx["provinces"]) if (OUT / a / "verdicts.jsonl").exists()]

    wrote = 0
    for adcode in targets:
        base = OUT / adcode
        mpath, vpath = base / "manifest.json", base / "verdicts.jsonl"
        # ★ 合表（`sheet all`）只写 `all-manifest.json`：看图是几个省一起看的，
        #   逐省再存一份 manifest 没必要。这里回退到合表里筛出本省那几行 ——
        #   序号（`idx`）在两种表里是同一个东西，apply 只认它。
        if not vpath.exists():
            print(f"{names.get(adcode, adcode)}：缺 verdicts.jsonl —— 跳过")
            continue
        if mpath.exists():
            manifest = {r["idx"]: r for r in json.loads(mpath.read_text(encoding="utf-8"))}
        elif (OUT / "all-manifest.json").exists():
            rows = json.loads((OUT / "all-manifest.json").read_text(encoding="utf-8"))
            manifest = {r["idx"]: r for r in rows if r.get("_adcode") == adcode}
        else:
            print(f"{names.get(adcode, adcode)}：缺 manifest.json 与 all-manifest.json —— 跳过")
            continue
        prov = names.get(adcode, adcode)
        verdicts = {}
        for line in vpath.read_text(encoding="utf-8").splitlines():
            if line.strip():
                row = json.loads(line)
                verdicts[int(row["idx"])] = row

        oks = [i for i in verdicts if verdicts[i].get("verdict") == "ok"]
        errs = [f"#{i} 的 alt 缺失或不是中文描述（当前「{str(verdicts[i].get('alt'))[:20]}」）"
                for i in sorted(oks)
                if len(str(verdicts[i].get("alt") or "")) < 8
                or not CJK.search(str(verdicts[i].get("alt") or ""))]
        if len(oks) > MAX_HERO:
            errs.append(f"判 ok {len(oks)} 张 > 上限 {MAX_HERO}")
        if not oks:
            errs.append("一张都没判 ok —— 不动旧值（省卡退回只显示收录情况）")
        if errs:
            print(f"★★ {prov} 整批拒收（一条都没写）：")
            for e in errs:
                print("   ·", e)
            continue

        hero = _hero_of(manifest, verdicts, prov)
        if not hero:
            print(f"★★ {prov}：一张都拼不出来 —— 不动旧值")
            continue
        if not dry:
            row = idx["provinces"].setdefault(adcode, {"intro": "", "heroImages": []})
            row["heroImages"] = hero
            idx["updatedAt"] = time.strftime("%Y-%m-%d")
            _mark(adcode, "ok", by="apply", kept=len(hero), why=f"重抓 {len(hero)} 张")
        print(f"{'[演练] ' if dry else ''}{prov}：封面 → {len(hero)} 张")
        for h in hero:
            print(f"   · {h['alt']} · {h['credit']['author'][:20]} · {h['credit']['license']}")
        wrote += 1

    if wrote and not dry:
        DATA.write_text(json.dumps(idx, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"写回 {DATA.relative_to(ROOT).as_posix()}（{wrote} 个省）")
    return 0


def cmd_status() -> int:
    rows = _ledger()
    idx = _index()
    codes = sorted(idx["provinces"])
    ok = [a for a in codes if (rows.get(a) or {}).get("state") == "ok"]
    need = [a for a in codes if (rows.get(a) or {}).get("state") == "need"]
    names = _names()
    print(f"省级单位 {len(codes)} · 封面已换好 {len(ok)} · 待重抓 {len(need)} "
          f"· 未审 {len(codes) - len(ok) - len(need)}（账本 {LEDGER.name}）")
    if need:
        print("待重抓：" + " ".join(names.get(a, a) for a in need))
    return 0


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 2
    cmd = args[0]

    def opt(key: str, default: str = "") -> str:
        return args[args.index(key) + 1] if key in args and args.index(key) + 1 < len(args) else default

    plain = [a for a in args[1:] if not a.startswith('--')]
    if cmd == "grab":
        return cmd_grab(plain or ["all"], "--force" in args)
    if cmd == "sheet":
        if "all" in plain:
            return cmd_sheet_batch(int(opt("--per", "6")))
        return cmd_sheet_one(plain[0] if plain else "")
    if cmd == "apply":
        return cmd_apply(plain or ["all"], "--dry" in args)
    if cmd == "status":
        return cmd_status()
    print(__doc__)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
