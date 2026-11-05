#!/usr/bin/env python3
"""
tools/clean_images.py —— **存量图全量清洗**（2026-10-31）

## 为什么需要它

`tools/review_images.py` 只管"重抓之后的新图"，而库里躺着 **13674 张历史图**，
其中一半是旧管线留下的。2026-10-31 全库扫了一遍，三个硬事实：

    · 6602 张（48%）来自 images.pexels.com —— **主题图库，不是地点图库**。
      一张 `pexels-photo-32686464.jpeg`（美食氛围图）挂在 **298 个餐饮点位**上、
      横跨 **48 座城**；2127 个点位（45%）的图**全部**是这种。
    · 410 张命中 `image_filter.BAD_CJK/BAD_LATIN` 否决词（地铁站 / 机场 / 招牌）。
    · 7931 张 verdict=`suspect`（标题、坐标都对不上点位名）——安徽名人馆配亚洲餐厅、
      呈坎永兴湖配香港起飞的飞机。

旧管线的 `USE_STOCK_SOURCES` 已在 10-29 关掉，但**存量从没清过**。本工具就是那把扫帚。

## 分级（★ 不是所有错都能自动删）

| rule | 判据 | 默认动作 |
|---|---|---|
| `stock` | 域名属于 Pexels / Unsplash | **删**（主题图库无 GPS/分类，过滤器拦不住） |
| `reject` | `verdict_for` 命中否决词 | **删**（说得明白的错） |
| `dup` | 同一 URL 被 ≥3 个点位使用 | 只标记，等看图 |
| `suspect` | 元数据层无正面信号 | 只标记，等看图 |

★★ `dup` / `suspect` **不许自动删**：Wikimedia 里"景区大图挂景区内几个子点位"
是合理的，只有看图能分清。自动删它们等于把有真图的点位也清空。

## 用法

    python tools/clean_images.py scan                    # 全库只读报告
    python tools/clean_images.py scan --city xian        # 只扫一城
    python tools/clean_images.py apply --rules stock     # 演练+执行（先看 --dry）
    python tools/clean_images.py apply --rules stock,reject --dry

★ apply 只删不补。删空了 → `_noImage=True`（前端占位卡、build 记 WARN），
  补图要重跑 `run.py images <city>`，那是另一趟。
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))

from authoring.image_filter import verdict_for  # noqa: E402

REPORT = ROOT / "_tmp" / "review" / "clean-report.json"

#: 主题图库域名。★ 与 `authoring/images.py` 的 `USE_STOCK_SOURCES=False` 是同一条原则：
#: 它们按**关键词**返回配图，没有地点对应关系（搜「农安辽塔」给上海古塔）。
STOCK_HOSTS = ("images.pexels.com", "images.unsplash.com", "pexels.com", "unsplash.com")

#: 同一 URL 被多少个点位共用，才怀疑是"错挂"。实测 Wikimedia 92% 的 URL 只用 1 次，
#: ≥3 次的是 162 个 URL / 725 张图 —— 景区大图挂子点位也会落进这一档，所以只标记不删。
REUSE_LIMIT = 3

#: 优先级：一张图命中多条时，按这个顺序归类（越靠前越"确定是错"）
RULE_ORDER = ("stock", "reject", "dup", "suspect")
AUTO_RULES = ("stock", "reject")


def poi_paths(city: str = "") -> list[Path]:
    """`data/cities/<省>/<市>/pois/<类>/<slug>.json`。city 传的是**目录名 slug**。"""
    hits = sorted((ROOT / "data" / "cities").glob("*/*/pois/*/*.json"))
    if city:
        hits = [p for p in hits if p.as_posix().split("/")[3] == city]
    return hits


def city_of(path: Path) -> str:
    """★ 不能按绝对路径切 `/` 取第 3 段 —— Windows 下那是盘符（`E:`）。
    `.../cities/<省>/<市>/pois/<类>/<slug>.json` ⇒ parents[2] 才是市。"""
    return path.parents[2].name


def host_of(url: str) -> str:
    if not url.startswith("http"):
        return ""
    return url.split("/")[2].lower()


def bare(url: str) -> str:
    """去 query —— 同一张 Wikimedia 图的 1280px / 800px 两个缩略地址是同一张。"""
    return (url or "").split("?")[0]


def scan(city: str = "") -> dict:
    """两遍：先数 URL 复用次数（要全库口径，单城看不出跨城污染），再逐张判定。"""
    paths = poi_paths(city)

    reuse: Counter[str] = Counter()
    for p in paths:
        poi = json.loads(p.read_text(encoding="utf-8"))
        for im in poi.get("images") or []:
            reuse[bare(im.get("url") or "")] += 1

    rows: list[dict] = []
    stat: Counter[str] = Counter()
    for p in paths:
        poi = json.loads(p.read_text(encoding="utf-8"))
        city_slug = city_of(p)
        city_name = str(poi.get("name") or "")
        for i, im in enumerate(poi.get("images") or []):
            url = im.get("url") or ""
            u = bare(url)
            hit: list[str] = []
            why: dict[str, str] = {}

            if host_of(url) in STOCK_HOSTS:
                hit.append("stock")
                why["stock"] = f"主题图库 {host_of(url)}，全库共用 {reuse[u]} 次"

            v, reason, _score = verdict_for(im, poi, city=city_name)
            if v == "reject":
                hit.append("reject")
                why["reject"] = reason
            elif v == "suspect":
                hit.append("suspect")
                why["suspect"] = reason

            if reuse[u] >= REUSE_LIMIT and "stock" not in hit:
                hit.append("dup")
                why["dup"] = f"同一 URL 被 {reuse[u]} 个点位共用"

            rule = next((r for r in RULE_ORDER if r in hit), "ok")
            stat[rule] += 1
            if rule == "ok":
                continue
            rows.append({
                "file": p.relative_to(ROOT).as_posix(),
                "city": city_slug,
                "poi": poi.get("name"),
                "index": i,
                "url": url,
                "alt": (im.get("alt") or "")[:120],
                "rule": rule,
                "all_rules": hit,
                "why": why.get(rule, ""),
            })

    return {
        "at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "city": city or "ALL",
        "poi_count": len(paths),
        "image_count": sum(stat.values()),
        "stat": dict(stat),
        "rows": rows,
    }


def print_scan(rep: dict) -> None:
    st = rep["stat"]
    total = rep["image_count"] or 1
    print(f"\n扫描 {rep['city']} · {rep['poi_count']} 个 POI · {rep['image_count']} 张图\n")
    print(f"  {'ok':8s} {st.get('ok', 0):6d}  {st.get('ok', 0) / total:6.1%}")
    for r in RULE_ORDER:
        n = st.get(r, 0)
        tag = "删" if r in AUTO_RULES else "标记"
        print(f"  {r:8s} {n:6d}  {n / total:6.1%}   [{tag}]")

    by_city: dict[str, Counter[str]] = defaultdict(Counter)
    for row in rep["rows"]:
        by_city[row["city"]][row["rule"]] += 1
    if by_city:
        print("\n按城市（只列有命中的）：")
        rank = sorted(by_city.items(),
                      key=lambda kv: -(kv[1]["stock"] + kv[1]["reject"]))
        for c, cnt in rank[:20]:
            print(f"  {c:14s} stock {cnt['stock']:4d}  reject {cnt['reject']:4d}"
                  f"  dup {cnt['dup']:4d}  suspect {cnt['suspect']:4d}")

    print("\n样例（每类 5 条）：")
    for r in RULE_ORDER:
        hits = [x for x in rep["rows"] if x["rule"] == r][:5]
        if not hits:
            continue
        print(f"  ── {r} ──")
        for x in hits:
            print(f"    {x['poi'][:16]:18s} {x['alt'][:52]:54s} {x['why'][:40]}")


def apply(rules: list[str], rep: dict, *, dry: bool = False) -> int:
    """按报告删图。★ 只删不补，删空就打 `_noImage`。"""
    bad = {r for r in rules if r in AUTO_RULES}
    if not bad:
        print(f"没有可自动执行的规则（{rules}）—— 只有 {AUTO_RULES} 能自动删")
        return 0

    by_file: dict[str, list[dict]] = defaultdict(list)
    for row in rep["rows"]:
        if row["rule"] in bad:
            by_file[row["file"]].append(row)

    today = datetime.now().strftime("%Y-%m-%d")
    changed = 0
    removed = 0
    for rel, rows in by_file.items():
        path = ROOT / rel
        poi = json.loads(path.read_text(encoding="utf-8"))
        drop = {x["index"] for x in rows}
        imgs = poi.get("images") or []
        kept = [im for i, im in enumerate(imgs) if i not in drop]
        removed += len(imgs) - len(kept)
        poi["images"] = kept
        if kept:
            poi.pop("_noImage", None)
        else:
            poi["_noImage"] = True          # build 靠它给 WARN，前端给占位卡
        poi["coverIndex"] = 0               # ★ 删完必须归零，否则指向没审过的图
        poi["updatedAt"] = today            # ★ 改业务字段必须写（build 的增量缓存靠它）
        if not dry:
            path.write_text(json.dumps(poi, ensure_ascii=False, indent=2) + "\n",
                            encoding="utf-8")
        changed += 1

    print(f"{'[演练] ' if dry else ''}改动 {changed} 个 POI，删除 {removed} 张图")
    return changed


def main() -> int:
    ap = argparse.ArgumentParser(description="存量图全量清洗（主题图库 / 否决词 / 复用）")
    ap.add_argument("mode", choices=("scan", "apply"))
    ap.add_argument("--city", default="", help="城市 slug，如 xian；缺省=全库")
    ap.add_argument("--rules", default="stock", help="apply 要执行的规则，逗号分隔")
    ap.add_argument("--dry", action="store_true", help="只打印，不写文件")
    ap.add_argument("--no-report", action="store_true", help="不落盤报告")
    args = ap.parse_args()

    if args.mode == "apply" and REPORT.exists() and not args.city:
        rep = json.loads(REPORT.read_text(encoding="utf-8"))
        print(f"（复用报告 {REPORT.relative_to(ROOT)} · {rep['at']}）")
    else:
        rep = scan(args.city)

    if args.mode == "scan":
        print_scan(rep)
        if not args.no_report:
            REPORT.parent.mkdir(parents=True, exist_ok=True)
            REPORT.write_text(json.dumps(rep, ensure_ascii=False, indent=1) + "\n",
                              encoding="utf-8")
            print(f"\n报告 → {REPORT.relative_to(ROOT)}")
        return 0

    rules = [r.strip() for r in args.rules.split(",") if r.strip()]
    apply(rules, rep, dry=args.dry)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
