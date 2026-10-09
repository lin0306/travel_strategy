#!/usr/bin/env python3
"""
pipeline/step10_city_outlines.py —— 抓**每个市「自身」的轮廓**（来自高德），按省打包

产物：`data/_generated/cities/{省adcode}.geo.json`

    {
      "adcode": "610000", "name": "陕西省",
      "source": "amap", "level": "city",
      "simplifyTolM": 100, "coordDecimals": 5,
      "polygons": { "610100": [ [lng,lat,…], … ], "610200": [ … ], … },
      "fetchedAt": "2026-10-01"
    }

`polygons` 的 key 就是**市 adcode** —— 与 `districts/<省adcode>.geo.json`（腾讯版）完全同形，
所以前端 `loadBoundsForLevel('city', …)` 只是**多一层优先**，`districtLayer` 零改动。

## 为什么要有它

市这一级的"面"原本来自腾讯的 `districts/<省adcode>.geo.json`（`getchildren(id=<省>)`
一次给出该省所有市的轮廓）。两个毛病，都是实测出来的：

1. **覆盖不全** —— 那份文件只对"已收录城市所在的省"生成过（`step7` 的既定策略），
   于是放大到市这一级时**半个国家没有填充面**（用户 2026-09-30：「轮廓数据好像没抓全」）。
   实测：`districts/` 里「省→市」分片只有 **20/34** 份。
2. **精度不够** —— 腾讯给的是**各自独立抽稀**的粗轮廓（陕西 10 个市合计 2884 点，
   平均 ~288 点/市）。而市的面在 `DISTRICT_REVEAL_ZOOM = 9.5` 之前一直显示，
   那一档 `1px ≈ 177m` ⇒ 点距几公里就是**几十像素的折角**，看得出来。

高德的 `config/district?subdistrict=0&extensions=all` 给的是**该市自身**的全精度轮廓
（与省级同一个接口、同为 GCJ-02 ⇒ **零坐标转换**）。

## 抽稀容差为什么是 100m（不是省级那种 600m）

市的面在 **z < 9.5** 渲染，最深那一档 `1px ≈ 177m`（`156543 × cos35° / 2^9.5`）
⇒ 100m = **0.56px**，还是看不出来。省级能放到 600m，是因为省的面最深深到 6.5 就换级了。

## 7 个「自身就是市这一级」的省级单位（北京/天津/上海/重庆/中国台湾/中国香港/中国澳门）

它们的轮廓 == 省自身轮廓，**`provinces/<adcode>.geo.json` 里已经有了**（step9 抓的）
⇒ 直接抄进本目录，**不再发请求**。这一步同时补上了一个缺口：市这一级原来对它们
取 `districts/<直辖市adcode>.geo.json`（key 是**区**），与节点 adcode 对不上 ⇒ 没面。

## 幂等 / 断点续跑

367 个市、按省打包 ⇒ **按"省"判断完成度**：某省的包里已含它全部的市就跳过；
只缺几个就只补那几个（`--force` 才整省重抓）。中断了直接重跑。
"""

from __future__ import annotations

import math
import sys
from datetime import date
from pathlib import Path

if __package__ in (None, ""):
    # ★ 本文件在 pipeline/steps/，往上两级才是仓库根（见 core/layout.py 同处陷阱）
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pipeline.providers import amap                         # noqa: E402
from pipeline.core.env import MissingKeyError          # noqa: E402
from pipeline.core.layout import (                     # noqa: E402
    CITY_BOUNDS,
    DISTRICTS,
    GENERATED,
    PROVINCES,
    REPO,
    read_json,
    write_json,
)

TREE_PATH = GENERATED / "district-tree.json"

#: 合理经纬度范围（与 step9 同一口径）
LNG_RANGE = (70.0, 140.0)
LAT_RANGE = (0.0, 56.0)

#: 与腾讯那份的 bbox 重合系数下限 —— 低于它视为"拿错行政区"
BBOX_OVERLAP_MIN = 0.7

#: 面积对照：软提示 / 硬警示（腾讯区之和是"各自独立抽稀"的粗数据，只能当参考）
AREA_NOTE_TOL = 0.05
AREA_WARN_TOL = 0.20

#: 抽稀容差（米）与坐标小数位。
#: ★ 100m ≈ 0.56px @z=9.5（市的面最深那一档）；5 位小数 ≈ 1.1m ≈ 0.006px。
SIMPLIFY_TOL_M = 100.0
COORD_DECIMALS = 5


def _shoelace(flat: list[float]) -> float:
    n = len(flat) // 2
    if n < 3:
        return 0.0
    a = 0.0
    for i in range(n):
        x1, y1 = flat[2 * i], flat[2 * i + 1]
        x2, y2 = flat[2 * ((i + 1) % n)], flat[2 * ((i + 1) % n) + 1]
        a += x1 * y2 - x2 * y1
    return a / 2.0


def _area(rings: list[list[float]]) -> float:
    return sum(abs(_shoelace(r)) for r in rings)


def _bbox(rings: list[list[float]]) -> tuple[float, float, float, float]:
    xs = [r[i] for r in rings for i in range(0, len(r), 2)]
    ys = [r[i] for r in rings for i in range(1, len(r), 2)]
    return min(xs), min(ys), max(xs), max(ys)


def _overlap(a, b) -> tuple[float, float]:
    """(bbox 重合系数, IoU)"""
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    ar_a = (a[2] - a[0]) * (a[3] - a[1])
    ar_b = (b[2] - b[0]) * (b[3] - b[1])
    smaller = min(ar_a, ar_b)
    union = ar_a + ar_b - inter
    return (inter / smaller if smaller > 0 else 0.0,
            inter / union if union > 0 else 0.0)


def _dp_keep(pts, tol: float) -> list[bool]:
    n = len(pts)
    keep = [False] * n
    keep[0] = keep[n - 1] = True
    tol2 = tol * tol
    stack = [(0, n - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        x1, y1 = pts[i]
        x2, y2 = pts[j]
        dx, dy = x2 - x1, y2 - y1
        l2 = dx * dx + dy * dy
        best, bi = -1.0, -1
        for k in range(i + 1, j):
            px, py = pts[k]
            if l2 == 0.0:
                d2 = (px - x1) ** 2 + (py - y1) ** 2
            else:
                t = ((px - x1) * dx + (py - y1) * dy) / l2
                t = 0.0 if t < 0.0 else (1.0 if t > 1.0 else t)
                d2 = (px - (x1 + t * dx)) ** 2 + (py - (y1 + t * dy)) ** 2
            if d2 > best:
                best, bi = d2, k
        if best > tol2 and bi > 0:
            keep[bi] = True
            stack.append((i, bi))
            stack.append((bi, j))
    return keep


def trim_ring(flat: list[float], tol_m: float, nd: int) -> list[float]:
    """抽稀（DP）+ 降精度 + 去重合点。抽完不成面就原样退回。"""
    n = len(flat) // 2
    if n >= 6 and tol_m > 0:
        scale = math.cos(math.radians(sum(flat[1::2]) / n)) or 1.0
        pts = [(flat[2 * i] * scale, flat[2 * i + 1]) for i in range(n)]
        keep = _dp_keep(pts, tol_m / 111320.0)
        step1: list[float] = []
        for i, ok in enumerate(keep):
            if ok:
                step1.extend((flat[2 * i], flat[2 * i + 1]))
        if len(step1) >= 6:
            flat = step1
    out: list[float] = []
    for i in range(len(flat) // 2):
        x, y = round(flat[2 * i], nd), round(flat[2 * i + 1], nd)
        if out and out[-2] == x and out[-1] == y:
            continue
        out.extend((x, y))
    if len(out) >= 4 and out[0] == out[-2] and out[1] == out[-1]:
        out = out[:-2]
    return out if len(out) >= 6 else flat


# ── 目标 ──────────────────────────────────────────────────────────

def targets() -> list[dict]:
    """每个省级单位 → 它这一级要抓哪些节点。

    @return `[{prov, provName, selfCity, nodes: [(adcode, name), …]}]`
      · `selfCity=True`（直辖市/特区）→ `nodes` 空，轮廓**抄 `provinces/` 已有的**
      · 否则 `nodes` = 该省的市级子节点
    """
    try:
        tree = read_json(TREE_PATH)
    except Exception:                                          # noqa: BLE001
        return []
    out: list[dict] = []
    for p in tree.get("provinces") or []:
        ad = str(p.get("adcode") or "")
        if not ad:
            continue
        name = str(p.get("fullname") or p.get("name") or ad)
        if p.get("isCity"):
            out.append({"prov": ad, "provName": name, "selfCity": True, "nodes": []})
            continue
        nodes = [
            (str(k.get("adcode")), str(k.get("fullname") or k.get("name") or ""))
            for k in (p.get("children") or [])
            # ★ 只收**市**这一级：省直辖县级市（如湖北仙桃）也在 children 里，
            #   它们的 adcode 是 6 位、level 仍是 city —— 一并收下（它们确实会出现在市这一级）
            if k.get("adcode")
        ]
        if nodes:
            out.append({"prov": ad, "provName": name, "selfCity": False, "nodes": nodes})
    return out


def bundle_file(prov: str) -> Path:
    return CITY_BOUNDS / f"{prov}.geo.json"


def _existing(prov: str) -> dict:
    p = bundle_file(prov)
    if not p.exists():
        return {}
    try:
        d = read_json(p)
    except Exception:                                          # noqa: BLE001
        return {}
    polys = d.get("polygons")
    return polys if isinstance(polys, dict) else {}


def _own_province_rings(prov: str) -> list[list[float]] | None:
    """抄 step9 抓好的「省自身轮廓」（直辖市/特区用它当"市"这一级的面）。"""
    p = PROVINCES / f"{prov}.geo.json"
    if not p.exists():
        return None
    try:
        d = read_json(p)
    except Exception:                                          # noqa: BLE001
        return None
    rings: list[list[float]] = []
    for rs in (d.get("polygons") or {}).values():
        rings.extend(rs)
    return rings or None


# ── 单个市 ────────────────────────────────────────────────────────

def fetch_city(adcode: str, name: str, *, simplify: bool) -> dict | None:
    """抓一个市自身的轮廓。@return `{status, adcode, name, rings, points}`"""
    try:
        got = amap.district_boundary(adcode, name=name)
    except MissingKeyError:
        raise
    except RuntimeError as exc:
        print(f"    ⚠️ {name or adcode}({adcode}) 抓取失败：{exc}")
        return {"status": "failed", "why": "抓取失败"}

    rings = got["rings"]
    if not rings:
        print(f"    ⚠️ {name or adcode}({adcode}) 没拿到轮廓点 —— 不写盘")
        return {"status": "failed", "why": "没有轮廓点"}

    lngs = [r[i] for r in rings for i in range(0, len(r), 2)]
    lats = [r[i] for r in rings for i in range(1, len(r), 2)]
    if (min(lngs) < LNG_RANGE[0] or max(lngs) > LNG_RANGE[1]
            or min(lats) < LAT_RANGE[0] or max(lats) > LAT_RANGE[1]):
        print(f"    ✗ {name}({adcode}) 坐标越界（经 {min(lngs):.2f}~{max(lngs):.2f}、"
              f"纬 {min(lats):.2f}~{max(lats):.2f}）—— 不写盘")
        return {"status": "failed", "why": "坐标越界"}

    # 位置自检：拿**该市的区之和**当参考（`districts/<市adcode>.geo.json`）。
    # 用 bbox 重合系数（不用中心距/IoU 的理由见 step9 的注释）。
    ref_path = DISTRICTS / f"{adcode}.geo.json"
    if ref_path.exists():
        try:
            ref = (read_json(ref_path).get("polygons") or {})
        except Exception:                                       # noqa: BLE001
            ref = {}
        ref_rings = [r for rs in ref.values() for r in rs]
        if ref_rings:
            ov, iou = _overlap(_bbox(rings), _bbox(ref_rings))
            if ov < BBOX_OVERLAP_MIN:
                print(f"    ✗ {name}({adcode}) 与腾讯那份的包围框几乎不挨着"
                      f"（重合系数={ov:.2f} · IoU={iou:.2f}）—— 不写盘")
                return {"status": "failed", "why": "包围框不重合"}

    raw = sum(len(r) for r in rings) // 2
    if simplify:
        rings = [trim_ring(r, SIMPLIFY_TOL_M, COORD_DECIMALS) for r in rings]
    else:
        rings = [trim_ring(r, 0, COORD_DECIMALS) for r in rings]
    pts = sum(len(r) for r in rings) // 2
    return {"status": "ok", "adcode": adcode, "name": got["name"] or name,
            "rings": rings, "points": pts, "raw": raw}


def run_province(t: dict, *, force: bool, simplify: bool) -> dict:
    """处理一个省级单位，返回统计。"""
    prov, pname = t["prov"], t["provName"]
    polys = {} if force else _existing(prov)

    if t["selfCity"]:
        rings = _own_province_rings(prov)
        if not rings:
            print(f"  ⚠️ {pname}({prov}) 自身就是市级，但 `provinces/{prov}.geo.json` 不在"
                  f" —— 先跑 `run.py outline`")
            return {"written": 0, "failed": 1}
        polys[prov] = rings
        stats = {"written": 1, "failed": 0}
    else:
        stats = {"written": 0, "failed": 0}
        for ad, nm in t["nodes"]:
            if polys.get(ad):
                continue                       # 断点续跑：已有就不重复请求
            r = fetch_city(ad, nm, simplify=simplify)
            if r["status"] == "ok":
                polys[ad] = r["rings"]
                stats["written"] += 1
            else:
                stats["failed"] += 1

    if not polys:
        return stats
    pts = sum(len(r) for rings in polys.values() for r in rings) // 2
    write_json(bundle_file(prov), {
        "adcode": prov,
        "name": pname,
        "source": "amap",
        "level": "city",
        "simplifyTolM": SIMPLIFY_TOL_M if simplify else 0,
        "coordDecimals": COORD_DECIMALS,
        "polygons": polys,
        "fetchedAt": date.today().isoformat(),
    }, compact=True)
    print(f"  → {pname}({prov})：{len(polys)} 个市 / {pts} 个点"
          f"（{bundle_file(prov).stat().st_size / 1024:.0f} KB）")
    return stats


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    force = "--force" in argv
    simplify = "--no-simplify" not in argv
    only: set[str] = set()
    for a in argv:
        if a.startswith("--only="):
            only = {x.strip() for x in a.split("=", 1)[1].split(",") if x.strip()}

    ts = targets()
    if only:
        ts = [t for t in ts if t["prov"] in only]
    if not ts:
        print("拿不到省级名单 —— 先跑 `python pipeline/run.py district`")
        return 1

    total_nodes = sum(len(t["nodes"]) for t in ts)
    print(f"═══ 市级自身轮廓（高德）· {len(ts)} 个省级单位 / {total_nodes} 个市 ═══")
    for k, v in amap.key_status():
        print(f"  key {k}: {v}")
    CITY_BOUNDS.mkdir(parents=True, exist_ok=True)

    done = failed = 0
    bad: list[str] = []
    try:
        for t in ts:
            st = run_province(t, force=force, simplify=simplify)
            done += st["written"]
            failed += st["failed"]
            if st["failed"]:
                bad.append(f"{t['provName']}({t['prov']}) ×{st['failed']}")
    except MissingKeyError:
        print("\n" + amap.missing_key_hint())
        return 2

    print("\n═══ 小结 ═══")
    print(f"  本次写入 {done} 个市的轮廓 · 失败 {failed} 个")
    if bad:
        print("  有失败的省级单位：" + "、".join(bad))
    print(f"\n  产物目录：{CITY_BOUNDS}")
    print("  前端 `loadBoundsForLevel('city')` 会**优先**读它，缺了退回腾讯的 districts/。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
