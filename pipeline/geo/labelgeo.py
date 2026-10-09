"""徽标定位点 —— 把一个行政区的**面**算成"视觉中心"。

## 为什么不用腾讯给的 `center`（2026-10-01 用户报）

腾讯 `getchildren` 的 `center` 是**行政中心 / 主要城区**（省 = 省会、市 = 市政府、
区 = 区政府）。实测它与"面质心"的偏差：

| 级 | 中位 | 90% | 最大 |
|----|------|-----|------|
| 省 | **112.8 km** | 319 | 457（青海：西宁在省界东侧） |
| 市 | **28.4 km** | 83 | 1026（三沙，特殊） |
| 区 | **9.6 km** | 26 | 281 |

用户原话：「这些省市区的标签，**很多都不是展示在市中心的，而是展示在市靠某一侧的**」。
地图上标行政区名，惯例是落在**面内视觉中心** —— 高德 / 百度的市名也不在政府门口。

## 算法（两步，只有 ~1% 的面会走到第二步）

① **最大环的面积加权质心** —— 对绝大多数面这就是视觉中心，`O(点数)`；
② 质心**掉在面外**（凹多边形：甘肃、新疆巴州、以及 40 个区）或**贴着边界**时，
   退化到**网格法**：在 bbox 上撒 `grid × grid`，取"到边界最远"的那个**面内**点
   （polylabel 的简化版；不做 quadtree 细化 —— 走到这一步的面本来就少，且
   徽标是个点，再精细也看不出来）。

★ 「到边界的距离」按**该级自身的尺度**归一（`edge_margin`），不写死公里数 ——
  省要 60km 才算"贴边"，区可能 1km 就够了。
"""

from __future__ import annotations

import math

#: 扁平坐标串：`[lng, lat, lng, lat, …]`
Ring = list[float]
LatLng = tuple[float, float]


def shoelace(r: Ring) -> float:
    """有向面积（鞋带公式）。正负表示绕向，取绝对值才是有向面积大小。"""
    s = 0.0
    n = len(r) // 2
    for i in range(n):
        j = (i + 1) % n
        s += r[2 * i] * r[2 * j + 1] - r[2 * j] * r[2 * i + 1]
    return s / 2


def largest_ring(rings: list[Ring]) -> Ring | None:
    """面积最大的那个环 —— 只在"完全没有可用环"时用作兜底。"""
    cand = [r for r in rings if len(r) >= 6]
    return max(cand, key=lambda r: abs(shoelace(r))) if cand else None


def major_rings(rings: list[Ring], *, keep: float = 0.01) -> list[Ring]:
    """丢掉"小岛"—— 面积不足总面积 `keep` 的环。

    ★★ **必须按所有环算，不能只取最大环**（2026-10-01 实测踩到）：内蒙古的环里
      面积最大的是**呼伦贝尔**那一块（东北角），只取它算出来的"中心"就钉在
      `(121.8, 49.6)` —— 离内蒙古的视觉中心几百公里。把锡林郭勒那块一起算才对。
    ★ 丢小岛是为了**控耗时**：网格法要算"候选点到每一条边的距离"，环越多越慢，
      而小岛（几百个）对"中心在哪"没有任何影响。
    """
    usable = [r for r in rings if len(r) >= 6]
    if not usable:
        return []
    areas = [abs(shoelace(r)) for r in usable]
    total = sum(areas)
    if total <= 0:
        return [largest_ring(usable)] if usable else []
    keep_rings = [r for r, a in zip(usable, areas) if a >= keep * total]
    return keep_rings or [max(usable, key=lambda r: abs(shoelace(r)))]


def centroid(r: Ring) -> LatLng | None:
    """单个环的面积加权质心（退化环返回 `None`）。"""
    a = 0.0
    cx = cy = 0.0
    n = len(r) // 2
    for i in range(n):
        j = (i + 1) % n
        x0, y0, x1, y1 = r[2 * i], r[2 * i + 1], r[2 * j], r[2 * j + 1]
        cross = x0 * y1 - x1 * y0
        a += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    a /= 2
    if abs(a) < 1e-12:
        return None
    return cx / (6 * a), cy / (6 * a)


def centroid_all(rings: list[Ring]) -> LatLng | None:
    """**所有主要环**的面积加权质心（把飞地/多块一起算）。"""
    a_sum = cx = cy = 0.0
    for r in rings:
        c = centroid(r)
        if not c:
            continue
        a = abs(shoelace(r))
        a_sum += a
        cx += a * c[0]
        cy += a * c[1]
    if a_sum < 1e-12:
        return None
    return cx / a_sum, cy / a_sum


def inside(pt: LatLng, r: Ring) -> bool:
    """射线法（只看这一个环 —— 洞与飞地不参与"中心点"的判断）。"""
    x, y = pt
    n = len(r) // 2
    ins = False
    for i in range(n):
        j = (i + 1) % n
        y0, y1 = r[2 * i + 1], r[2 * j + 1]
        if (y0 > y) != (y1 > y):
            xin = (r[2 * j] - r[2 * i]) * (y - y0) / (y1 - y0) + r[2 * i]
            if x < xin:
                ins = not ins
    return ins


def bbox(rings: list[Ring]) -> tuple[float, float, float, float]:
    xs = [r[i] for r in rings for i in range(0, len(r), 2)]
    ys = [r[i] for r in rings for i in range(1, len(r), 2)]
    return min(xs), min(ys), max(xs), max(ys)


def _dist_to_edges(pt: LatLng, r: Ring) -> float:
    """点到该环**所有边**的最短距离（度。只用来比大小，不做真实距离换算）。"""
    x, y = pt
    best = float("inf")
    n = len(r) // 2
    for i in range(n):
        j = (i + 1) % n
        x0, y0, x1, y1 = r[2 * i], r[2 * i + 1], r[2 * j], r[2 * j + 1]
        dx, dy = x1 - x0, y1 - y0
        d2 = dx * dx + dy * dy
        t = 0.0 if d2 == 0 else max(0.0, min(1.0, ((x - x0) * dx + (y - y0) * dy) / d2))
        ex, ey = x0 + t * dx, y0 + t * dy
        best = min(best, math.hypot(x - ex, y - ey))
    return best


def _thin(r: Ring, max_pts: int = 120) -> Ring:
    """均匀抽稀到 ≤ `max_pts` 个点。

    ★ 网格法要算「候选点到**每一条边**的距离」：不抽稀的话，一个 2000 点的省 ×
      48×48 网格 = 460 万次距离计算，**每个面 ~8s**。抽到 120 点后降到 27 万次。
      徽标落点是个"点"，这点几何误差（几十米）看不出来。
    """
    n = len(r) // 2
    if n <= max_pts:
        return r
    step = n / max_pts
    out: Ring = []
    for i in range(max_pts):
        k = int(i * step)
        out.extend(r[2 * k : 2 * k + 2])
    return out


def inside_any(pt: LatLng, rings: list[Ring]) -> bool:
    """点在**任一**环内（多块 / 飞地一起判；洞不参与 —— 见文件头）。"""
    return any(inside(pt, r) for r in rings)


def _dist_to_any(pt: LatLng, rings: list[Ring]) -> float:
    """点到**任一**环的最近距离。"""
    return min((_dist_to_edges(pt, r) for r in rings), default=float("inf"))


def _grid_polylabel(rings: list[Ring], grid: int) -> LatLng | None:
    """网格法：bbox 上撒 `grid × grid`，取"到边界最远"的**面内**点。

    ★ polylabel（最大内切圆圆心）的简化版 —— 不做 quadtree 细化：徽标是个点，
      48 格在省档 ≈ 28km/格（1px≈6.4km ⇒ 4px），够用。
    ★ 环**已抽稀**（见 `_thin`）：判定与测距用同一份，保证一致。
    """
    x0, y0, x1, y1 = bbox(rings)
    best: LatLng | None = None
    best_d = -1.0
    for iy in range(1, grid):
        y = y0 + (y1 - y0) * iy / grid
        for ix in range(1, grid):
            x = x0 + (x1 - x0) * ix / grid
            if not inside_any((x, y), rings):
                continue
            d = _dist_to_any((x, y), rings)
            if d > best_d:
                best_d = d
                best = (x, y)
    return best


def label_point(rings: list[Ring], *, grid: int = 48, edge_margin: float = 0.02) -> LatLng | None:
    """这个行政区的**徽标落点**（经纬度）。拿不到合适的点返回 `None`（调用方保持原值）。

    ## 三级判据，从"最像眼睛看到的中心"往外退

    ① **在 bbox 中心与面积加权质心里挑"离边界更远"的那个** —— "居中"的直接度量就是
       "四面八方都有地方"。两个候选各有胜场，**不能固定优先谁**：
       · **内蒙古**：bbox 中心（锡林郭勒一带）对，质心被东部拉偏；
       · **黑龙江**：质心对，bbox 中心被大兴安岭拉北 200km。
    ② **网格法**（polylabel 简化版）：上面两个都**不在面内**或**都贴着边界**时用，
       保证给出一个面内且尽量远离边界的点（甘肃、阿拉善那类凹/散形）。

    @param edge_margin "够不够居中"的门槛（以 bbox 对角线为单位）。**别定太大** ——
        0.06 时内蒙古的 bbox 中心（离边界 0.06×对角线）会被判"贴边"而落到呼伦贝尔。
    """
    rs = major_rings(rings)
    if not rs:
        return None

    x0, y0, x1, y1 = bbox(rs)
    diag = math.hypot(x1 - x0, y1 - y0)
    if diag <= 0:
        return None
    margin = edge_margin * diag

    best: LatLng | None = None
    best_d = -1.0
    for pt in (((x0 + x1) / 2, (y0 + y1) / 2), centroid_all(rs)):
        if not pt or not inside_any(pt, rs):
            continue
        d = _dist_to_any(pt, rs)
        if d > best_d:
            best_d = d
            best = pt
    if best is not None and best_d >= margin:
        return best
    return _grid_polylabel([_thin(r) for r in rs], grid) or best


def to_dict(pt: LatLng) -> dict:
    """转成数据里 `center` 的写法（4 位小数，与腾讯那份同形）。"""
    return {"lng": round(pt[0], 4), "lat": round(pt[1], 4)}
