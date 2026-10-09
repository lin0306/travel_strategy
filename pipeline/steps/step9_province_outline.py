#!/usr/bin/env python3
"""
pipeline/step9_province_outline.py —— 抓**省级单位「自身」的轮廓**（来自高德）

产物：`data/_generated/provinces/{省adcode}.geo.json`

    {
      "adcode": "510000",
      "name": "四川省",
      "source": "amap",              ← ★ 溯源：这一份不是腾讯的（前端/审计都看得见）
      "level": "province",
      "polygons": { "510000": [ [lng,lat,…], … ] },   ← 与腾讯 districts/*.geo.json 同形
      "fetchedAt": "2026-09-30"
    }

## 它补的是哪个洞

腾讯 District **拿不到"省自身"的轮廓**（`getchildren?id=<省>` 只返下辖的**市**，实测表见
`amap.py` 头部）。没有它时，首页的省只能用"该省各市的轮廓"拼，于是**省内部还画着一张市界网**
（用户 2026-09-30 报的现象）。高德的 `extensions=all` 返回的正是"自身轮廓"。

## 为什么落盘而不是运行时请求

- 运行时**零 key、零请求** —— 这是本项目的架构前提（"数据离线固化 `data/`"）；
- 省轮廓是**静态数据**，与用户无关；
- 高德 Web 服务个人开发者有**日调用量上限**，一次全抓完（20 来个省）就不必再碰。

## 三道写盘前自检（★ 缺一不可）

1. **环非空**：`polyline` 缺席（比如中国台湾省，高德文档写明"不支持其详细区划查询"）时
   **不写文件** —— 留着空文件会让前端"以为自己有面"，反而把兜底路径堵死；
2. **坐标落在合理范围**（经度 70~140、纬度 0~56）：防"解析错位"这类**不报错但全错**的情况；
3. **位置对得上**（与腾讯"该省各市"的 bbox **交并比 ≥ 0.5**）+ **面积对照只作参考**。
   ★ 为什么用 IoU 而不是"中心距离"：离岛/飞地会把中心拉得很远 —— 海南含南海诸岛
   （纬度下探到 3.84°），两边中心差 0.49°，但 IoU 是 0.94；中心判据会**误杀好数据**。
   而"拿错行政区"时 IoU ≈ 0，所以 IoU 既宽松又抓得住真错。
   ★ 为什么面积只能是参考：腾讯那份是"该省各市"的多边形，而**各市边界是各自独立抽稀**的，
   直辖市与特别行政区尤其粗（`districts/110000.geo.json` 里每个区只有 4~28 个点）。
   实测：香港"18 个区之和"约 2200km²，真值 ~1114km² —— **参考值自己错了 2 倍**。
   所以面积只打 ✓/⚠/✗ 三级提示，**位置**才是硬判据。

## 抽稀 + 降精度（`SIMPLIFY_TOL_M = 600` · `COORD_DECIMALS = 4`）

省的面**只在省档渲染**（z < 6.5，一到 6.5 就换成市的面），那一档 1px ≈ **1416m**，
z=4.4 时更是 1px ≈ 6.4km ⇒ 600m 只有 **0.42px**、4 位小数（≈11m）只有 **0.008px**，
屏幕上**看不出来**。不处理的话 34 个省级单位是 **7.2MB+**，而首页一进来就要拉它们
（省档的徽标就是 34 个）。
（`--no-simplify` 可关掉；`plans/10` §9.3 的"不得简化到失真"守的就是"看得出来"这条线。）
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
    CITIES,
    DISTRICTS,
    GENERATED,
    PROVINCES,
    REPO,
    read_json,
    write_json,
)

#: 区划树 —— **34 个省级单位的权威名单**就在这里（不再自己硬编码一份）
TREE_PATH = GENERATED / "district-tree.json"

#: 合理经纬度范围（含南海诸岛的最南端；刻意留宽，只用来抓"解析错位"）
LNG_RANGE = (70.0, 140.0)
LAT_RANGE = (0.0, 56.0)

#: 与腾讯那份的 **bbox 重合系数**下限（`inter / min(面积)`）—— 低于它才认定
#: "拿错行政区 / 整体错位"。
#: ★★ 为什么不用"中心距离"也不用 IoU（两个都被真实数据打过脸）：
#:   · 中心距离被**离岛**骗过 —— 海南含南海诸岛，两边中心差 0.49°，但明明是同一个省；
#:   · IoU 被**参考值自己的坏环**骗过 —— 天津 `districts/120000.geo.json` 里有个
#:     438km 外的成员（腾讯偶发，见 TRAPS"坏环"），把参考框撑大 ⇒ IoU 只有 0.14；
#:   · 重合系数对两者都免疫（坏环只会让参考框变大、不会让它偏移）。
BBOX_OVERLAP_MIN = 0.7

#: 面积对照的**软**阈值：几 % 是正常的（两边各自抽稀），超过只提示
AREA_NOTE_TOL = 0.05
#: 面积对照的**硬**阈值：到这一档就该人工看一眼（多半是**参考值**太粗 ——
#: 腾讯给直辖市/特区的"各市/区"是极其粗的多边形，香港那份面积甚至是真值的 2 倍）
AREA_WARN_TOL = 0.20

#: ── 抽稀（Douglas-Peucker）──────────────────────────────────────
#: ★★ 为什么可以抽：省的面**只在省档渲染**。`CITY_REVEAL_ZOOM = 6.5` 一到就换成
#:   市的面，所以省轮廓最深只会出现在 **z < 6.5**。那一档 1px ≈ **1416m**
#:   （`156543 × cos35° / 2^6.5`；z=4.4 更粗，1px ≈ 6.4km）。
#:   600m ⇒ **0.42px** —— 抽到这个粒度以下，屏幕上**看不出来**。
#: ★ 放在这一步是**必要**的：不抽的话 34 个省级单位是 **7.2MB+**（四川一个 818KB / 4 万点），
#:   而首页一进来就要把它们拉下来（省档的徽标就是 34 个）。
#: ⚠️ plans/10 §9.3 的"不得简化到失真"守的就是"看得出来"这条线 —— 0.42px 显然没到。
SIMPLIFY_TOL_M = 600.0

#: 坐标保留几位小数。**6 位 ≈ 0.11m 是浪费**：4 位 ≈ **11m**，
#: 在省档最深的 1416m/px 上是 **0.008px** —— 而且体积能小两成左右。
COORD_DECIMALS = 4


def _dp_keep(pts: list[tuple[float, float]], tol: float) -> list[bool]:
    """Douglas-Peucker：返回每个点"要不要留"。用显式栈，避免长环把递归打爆。"""
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


def simplify_ring(flat: list[float], tol_m: float) -> list[float]:
    """把一个环抽稀到 `tol_m` 的粒度。抽完少于 3 个点就**原样退回**（宁可不抽也不要破面）。"""
    n = len(flat) // 2
    if n < 6 or tol_m <= 0:
        return flat
    # ★ 经度按平均纬度收缩 ⇒ 容差在各方向上是等距的（否则高纬度处会横向抽过头）
    scale = math.cos(math.radians(sum(flat[1::2]) / n)) or 1.0
    tol = tol_m / 111320.0
    pts = [(flat[2 * i] * scale, flat[2 * i + 1]) for i in range(n)]
    keep = _dp_keep(pts, tol)
    out: list[float] = []
    for i, ok in enumerate(keep):
        if ok:
            out.extend((flat[2 * i], flat[2 * i + 1]))
    return out if len(out) >= 6 else flat


def quantize_ring(flat: list[float], nd: int = COORD_DECIMALS) -> list[float]:
    """坐标降到 `nd` 位小数，并丢掉**四舍五入后重合的相邻点**。

    ★ 不降的话每个数要写 10 个字符（`116.666886`），4 位只要 8 个（`116.6669`）——
      34 个省 8.7 万个点，这一项就是几百 KB。
    ★ 相邻点重合必须去掉：留着只会给 SDK 一条零长度的边（`paths` 里的退化线段）。
    """
    out: list[float] = []
    for i in range(len(flat) // 2):
        x, y = round(flat[2 * i], nd), round(flat[2 * i + 1], nd)
        if out and out[-2] == x and out[-1] == y:
            continue
        out.extend((x, y))
    # 首尾也重合（闭环重复点）时去掉尾巴
    if len(out) >= 4 and out[0] == out[-2] and out[1] == out[-1]:
        out = out[:-2]
    return out if len(out) >= 6 else flat


def _bbox(rings: list[list[float]]) -> tuple[float, float, float, float]:
    xs = [r[i] for r in rings for i in range(0, len(r), 2)]
    ys = [r[i] for r in rings for i in range(1, len(r), 2)]
    return min(xs), min(ys), max(xs), max(ys)


def _shoelace(flat: list[float]) -> float:
    """环的有符号面积（度²）。只用于**两边同法对比**，不是真实面积。"""
    n = len(flat) // 2
    if n < 3:
        return 0.0
    a = 0.0
    for i in range(n):
        x1, y1 = flat[2 * i], flat[2 * i + 1]
        x2, y2 = flat[2 * ((i + 1) % n)], flat[2 * ((i + 1) % n) + 1]
        a += x1 * y2 - x2 * y1
    return a / 2.0


def _area_of(polygons: dict[str, list[list[float]]]) -> float:
    return sum(abs(_shoelace(r)) for rings in polygons.values() for r in rings)


def recorded_provinces() -> dict[str, str]:
    """已收录城市所在的省 → `{省adcode: 省名}`。

    ⚠️ 这**不是**默认目标了（2026-09-30 晚改）—— 见 `all_provinces()` 的注释。
    """
    out: dict[str, str] = {}
    for city_json in CITIES.glob("*/*/city.json"):
        try:
            c = read_json(city_json)
        except Exception:                                     # noqa: BLE001
            continue
        ad = str(c.get("provinceAdcode") or "")
        name = str(c.get("province") or "")
        if ad:
            out[ad] = name
    return out


def all_provinces() -> dict[str, str]:
    """**全部 34 个省级单位** → `{adcode: 名称}`（读 `district-tree.json`，不硬编码）。

    ★★ 为什么不只抓"有收录城市的省"（第一版就是这么干的，被用户报掉了）：
    用户 2026-09-30：「这个轮廓数据好像没抓全，**只有部分省的部分区是全的**」——
    因为另外 17 个省级单位（河北 / 山西 / 内蒙古 / 辽宁 / 吉林 / 安徽 / 江西 / 河南 /
    广西 / 贵州 / 西藏 / 甘肃 / 青海 / 宁夏 / 新疆 / 中国台湾 / 中国澳门）压根没有面，
    图上它们只有底图那条淡粉线，看起来就是"没做"。

    ⇒ 全抓。未收录的省自然走**「待收录」灰虚线**样式（`districtStyles` 的 `pending` 档），
    这本来就是 10 文档 §6.3 的视觉语言；顺带把 §9.2「全国图必须包含 34 个省级单位」
    从"靠底图"变成"我们自己也有轮廓"。
    """
    try:
        tree = read_json(TREE_PATH)
    except Exception:                                          # noqa: BLE001
        return {}
    out: dict[str, str] = {}
    for p in tree.get("provinces") or []:
        ad = str(p.get("adcode") or "")
        if ad:
            out[ad] = str(p.get("fullname") or p.get("name") or "")
    return out


def province_file(adcode: str) -> Path:
    return PROVINCES / f"{adcode}.geo.json"


def _cache_ok(adcode: str) -> bool:
    """已有分片且**真含环**才算命中缓存（空文件/半截文件一律重抓）。"""
    p = province_file(adcode)
    if not p.exists():
        return False
    try:
        d = read_json(p)
    except Exception:                                          # noqa: BLE001
        return False
    polys = d.get("polygons")
    if not isinstance(polys, dict) or not polys:
        return False
    return any(rings for rings in polys.values())


def fetch_one(adcode: str, name: str, *, force: bool = False, simplify: bool = True) -> dict | None:
    """抓一个省。@return 统计字典；失败/跳过返回 None（**不写盘**，让前端走兜底）"""
    if not force and _cache_ok(adcode):
        print(f"  · {name or adcode}({adcode}) 已有分片，跳过（--force 可重抓）")
        return {"status": "skipped"}

    try:
        got = amap.district_boundary(adcode, name=name)
    except MissingKeyError:
        raise
    except RuntimeError as exc:
        print(f"  ⚠️ {name or adcode}({adcode}) 抓取失败：{exc}")
        return {"status": "failed", "why": "抓取失败"}

    rings = got["rings"]

    # ── 自检 ①：环非空 ──
    if not rings:
        print(
            f"  ⚠️ {name or adcode}({adcode}) 没拿到轮廓点（可能不支持该行政区，"
            f"如中国台湾省）—— **不写文件**，让前端继续用「各市拼」的兜底"
        )
        return {"status": "failed", "why": "没有轮廓点"}

    # ── 自检 ②：坐标范围 ──
    lngs = [r[i] for r in rings for i in range(0, len(r), 2)]
    lats = [r[i] for r in rings for i in range(1, len(r), 2)]
    bad = (
        min(lngs) < LNG_RANGE[0] or max(lngs) > LNG_RANGE[1]
        or min(lats) < LAT_RANGE[0] or max(lats) > LAT_RANGE[1]
    )
    if bad:
        print(
            f"  ✗ {name or adcode}({adcode}) 坐标越界（经 {min(lngs):.3f}~{max(lngs):.3f}、"
            f"纬 {min(lats):.3f}~{max(lats):.3f}）—— 解析错位？**已中止，不写盘**"
        )
        return {"status": "failed", "why": "坐标越界"}

    # ── 自检 ③：位置对得上（bbox 中心）+ 面积对照（软提示）──
    # ★★ 分工：**位置**是硬判据（拿错行政区 / 整体错位必须拦住）；**面积**只是参考 ——
    #   参考值来自腾讯"该省各市"的多边形，而那些边界是**各自独立抽稀**的，
    #   直辖市与特别行政区尤其粗（`districts/110000.geo.json` 里每个区只有 4~28 个点）。
    #   实测：香港那份的"18 个区之和"约 2200km²，而真值 ~1114km² —— **参考值本身错了 2 倍**。
    ref_path = DISTRICTS / f"{adcode}.geo.json"
    ref_polys = None
    if ref_path.exists():
        try:
            ref_polys = (read_json(ref_path).get("polygons") or {})
        except Exception:                                       # noqa: BLE001
            ref_polys = None
    if ref_polys:
        ref_rings = [r for rs in ref_polys.values() for r in rs]
        if ref_rings:
            a = _bbox(rings)
            b = _bbox(ref_rings)
            # ★★ 判据是 **bbox 重合系数** `inter / min(area)`，不是 IoU、也不是"中心距离"：
            #   · 中心距离会被**离岛/飞地**骗过 —— 海南含南海诸岛（纬度下探到 3.84°），
            #     两边中心差 0.49°，但显然是同一个省；
            #   · IoU 会被**参考值自己的坏环**骗过 —— 天津的 `districts/120000.geo.json`
            #     里有一个 438km 外（邢台）的多边形成员（腾讯偶发，见 TRAPS"坏环"），
            #     把腾讯的框撑得很大 ⇒ IoU 只有 **0.14**，可高德的框**完整落在里面**；
            #   · 重合系数对这两件事都免疫（坏环只会让参考框**变大**，不会让它偏移）。
            #   "拿错行政区"时两个框几乎不挨着 ⇒ 重合系数 ≈ 0，照样拦得住。
            ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
            iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
            inter = ix * iy
            ar_a = (a[2] - a[0]) * (a[3] - a[1])
            ar_b = (b[2] - b[0]) * (b[3] - b[1])
            smaller = min(ar_a, ar_b)
            iou = inter / (ar_a + ar_b - inter) if (ar_a + ar_b - inter) > 0 else 0.0
            overlap = inter / smaller if smaller > 0 else 0.0
            if overlap < BBOX_OVERLAP_MIN:
                print(
                    f"  ✗ {name or adcode}({adcode}) 与腾讯那份的包围框几乎不挨着"
                    f"（重合系数={overlap:.2f} · IoU={iou:.2f}；"
                    f"高德 经{a[0]:.2f}~{a[2]:.2f} 纬{a[1]:.2f}~{a[3]:.2f} / "
                    f"腾讯 经{b[0]:.2f}~{b[2]:.2f} 纬{b[1]:.2f}~{b[3]:.2f}）—— "
                    f"拿错行政区或整体错位？**已中止，不写盘**"
                )
                return {"status": "failed", "why": "包围框不重合"}
        ref_area = _area_of(ref_polys)
        mine = _area_of({adcode: rings})
        diff = (mine - ref_area) / ref_area if ref_area else 0.0
        mark = "✓" if abs(diff) <= AREA_NOTE_TOL else ("⚠" if abs(diff) <= AREA_WARN_TOL else "✗")
        print(
            f"  {mark} {name or adcode}({adcode}) 面积对照：高德 {mine:.4f} / "
            f"腾讯各市之和 {ref_area:.4f}（差 {diff * 100:+.2f}%）"
            + ("  ← 参考值可能太粗（腾讯给直辖市/特区的多边形只有几个点）"
               if abs(diff) > AREA_NOTE_TOL else "")
        )

    raw_pts = sum(len(r) for r in rings) // 2
    if simplify and SIMPLIFY_TOL_M > 0:
        rings = [simplify_ring(r, SIMPLIFY_TOL_M) for r in rings]
    rings = [quantize_ring(r) for r in rings]
    pts = sum(len(r) for r in rings) // 2
    if pts < raw_pts:
        print(
            f"    · 抽稀+降精度 {raw_pts} → {pts} 点（DP {SIMPLIFY_TOL_M:.0f}m ≈ 0.42px · "
            f"{COORD_DECIMALS} 位小数 ≈ 0.008px，都按省档 1px≈1416m 算）"
        )

    p = province_file(adcode)
    write_json(p, {
        "adcode": adcode,
        "name": got["name"] or name,
        # ★ 溯源写进数据本身：这一份来自高德，不是腾讯（边界都过审图，但审计时要说得清）
        "source": "amap",
        "level": "province",
        # ★ 抽稀容差也写进去：将来嫌粗/嫌大，一眼知道当初按什么粒度存的
        "simplifyTolM": SIMPLIFY_TOL_M if simplify else 0,
        # ★ 降精度位数也写进去（和抽稀容差同理：数据自己说清粒度）
        "coordDecimals": COORD_DECIMALS,
        "polygons": {adcode: rings},
        "fetchedAt": date.today().isoformat(),
    }, compact=True)
    print(f"    → 写入 {p.relative_to(REPO)}（{len(rings)} 个环 / {pts} 个点）")
    return {"status": "written", "adcode": adcode, "name": got["name"] or name,
            "rings": len(rings), "points": pts}


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    force = "--force" in argv
    # ★ `--no-simplify` 只在"想看原样"时用：产物体积会大 20 倍以上（7.2MB / 17 省）
    simplify = "--no-simplify" not in argv
    only: set[str] = set()
    for a in argv:
        if a.startswith("--only="):
            only = {x.strip() for x in a.split("=", 1)[1].split(",") if x.strip()}

    # ★★ 默认抓**全部 34 个省级单位**（含未收录的，它们走"待收录"灰虚线）——
    #    第一版只抓"有收录城市的省"，结果图上一半的省没有面（用户 2026-09-30 报的）。
    #    `--recorded-only` 可退回旧行为（只在"想快点试一下"时用）。
    recorded_only = "--recorded-only" in argv
    targets = recorded_provinces() if recorded_only else all_provinces()
    if not targets:
        print(
            "拿不到省级名单 —— 读不到 `data/_generated/district-tree.json`？"
            "先跑 `python pipeline/run.py district`"
        )
        return 1
    if only:
        targets = {k: v for k, v in targets.items() if k in only} or {k: "" for k in only}

    print(f"═══ 省级自身轮廓（高德 District）· 目标 {len(targets)} 个省级单位 ═══")
    for k, v in amap.key_status():
        print(f"  key {k}: {v}")
    PROVINCES.mkdir(parents=True, exist_ok=True)

    done: list[dict] = []
    failed: list[str] = []
    try:
        for adcode, name in sorted(targets.items()):
            st = fetch_one(adcode, name, force=force, simplify=simplify)
            if st["status"] == "written":
                done.append(st)
            elif st["status"] == "failed":
                # ★ 失败**不代表前端没面**：旧的同名分片还在，它会被照常读走
                #   —— 不说清楚就会出现"脚本说没写，页面上却有面"的困惑
                stale = "（⚠️ 旧分片仍在，页面会继续用它，粒度可能是上一版的）" if _cache_ok(adcode) else ""
                failed.append(f"{name or adcode}({adcode})：{st.get('why', '')}{stale}")
    except MissingKeyError:
        print("\n" + amap.missing_key_hint())
        return 2

    print("\n═══ 小结 ═══")
    print(f"  本次写入 {len(done)} 个 / 目标 {len(targets)} 个")
    if done:
        print(f"  合计 {sum(d['points'] for d in done)} 个点")
    if failed:
        print("  ⚠️ 这几个省没有取到新数据：")
        for one in failed:
            print(f"      · {one}")
    print(f"\n  产物目录：{PROVINCES}")
    print("  前端 `loadBoundsForLevel('province')` 会优先读它；缺的省自动退回拼接。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
