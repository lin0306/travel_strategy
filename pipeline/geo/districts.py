"""
pipeline/geo/districts.py —— **区级**几何与"点位归区"

01 之前的版本只有 省 → 市 两级，地图揭示到市就到底了；第四级（区）需要回答
两个问题，本模块就是它们的唯一出处：

| 问题 | 答案在哪 |
|------|---------|
| 这个点位属于哪个区？ | `assign_district()` —— **坐标点在多边形内**判定 |
| 每个区有多少个可玩的地方？ | `sync_subdistrict_counts()` —— 从 POI 的 `district` 字段汇总 |

## 🚨 三条实测事实（写在本模块而不是文档里，因为只有这里会真的拦住人）

1. **判定必须用几何，不能用地址字符串**。POI 数据里**没有**行政区字段，
   只有 `location.address`（"广州市海珠区阅江西路222号"这样的一整串）。
   解析字符串要穷举"XX区/XX县/XX市/自治县…"的写法，而多边形判定只有一种写法。

2. **形状是「扁平坐标串」且一个区可能有多个环**（飞地 / 江心岛）：
   `polygons[adcode] = [环, 环, …]`，环 = `[lng, lat, lng, lat, …]`。
   ★ 腾讯把同一区划的多个环**平铺**在同一个数组里，没有"块"这一层 ——
     别自己加一层，也别按 `[[lng,lat], …]` 点数组解（详见 `data.ts` 的注释）。

3. **一个点应当落在某个区里**（区是无缝铺满全市的），命中不了只可能是
   边界精度或数据本身的问题。兜底用"最近区中心"，但**要留痕**
   （返回值里的第二项），让 build 能记一条 WARN —— 静默兜底就是下次排查时的黑箱。

## 为什么不把结果写进 `district-tree.json`
    5000 个区塞进树里，树会从 55KB 涨到几百 KB，而首页只需要两级。
    区的清单按市分片在 `subdistricts/<市adcode>.json`，计数回填到那里。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable

from pipeline.core.layout import (  # noqa: E402
    DISTRICT_OWN, DISTRICTS, GENERATED, SUBDISTRICTS, iter_city_dirs, iter_poi_files,
    read_city_json, read_json, write_json,
)


def load_polygons(adcode: str) -> dict[str, list[list[float]]]:
    """读某个父级的下级边界 → `{子 adcode: [环, …]}`。

    ★ 同一个函数既吃**省级**（`440000` → 各市的面）也吃**市级**（`440100` → 各区的面）——
      两者文件形状完全一致，只是父级层级不同，而 `loadDistrictBounds()` 前端同样不区分。
    """
    path = DISTRICTS / f"{adcode}.geo.json"
    if not path.exists():
        return {}
    data = read_json(path)
    polys = data.get("polygons") or {}
    return {k: v for k, v in polys.items() if v}


def point_in_ring(lng: float, lat: float, ring: Iterable[float]) -> bool:
    """射线法判定点是否在一个环里。`ring` 是扁平串 `[lng, lat, lng, lat, …]`。"""
    pts = list(ring)
    n = len(pts) // 2
    if n < 3:
        return False
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = pts[2 * i], pts[2 * i + 1]
        xj, yj = pts[2 * j], pts[2 * j + 1]
        # 只有在目标纬度跨越了这条边时才继续；除以 0 的情况由上面的跨越判断排除
        if (yi > lat) != (yj > lat):
            x_cross = (xj - xi) * (lat - yi) / (yj - yi) + xi
            if lng < x_cross:
                inside = not inside
        j = i
    return inside


def point_in_polygons(lng: float, lat: float, rings: list[list[float]]) -> bool:
    """点是否落在某个区划里。**命中任意一个环**即在区内（多环 = 飞地 / 岛）。"""
    return any(point_in_ring(lng, lat, r) for r in rings)


def assign_district(city_adcode: str, lng: float, lat: float) -> tuple[str | None, bool]:
    """判定一个点位属于哪个区。

    @return `(区 adcode, 是否兜底)`。`None` = 连兜底都做不到（该市没有区数据）。
    """
    polys = load_polygons(city_adcode)
    if not polys:
        return None, False

    for adcode, rings in polys.items():
        if point_in_polygons(lng, lat, rings):
            return adcode, False

    # 兜底：最近区中心。走到这里说明边界精度不够或点位落在界外，
    # 返回值会把"这是兜底"告诉调用方，让它留一条 WARN
    sub_file = SUBDISTRICTS / f"{city_adcode}.json"
    centers: list[tuple[str, float, float]] = []
    if sub_file.exists():
        for c in read_json(sub_file).get("children") or []:
            ctr = c.get("center") or {}
            centers.append((str(c.get("adcode")), float(ctr.get("lng", 0)), float(ctr.get("lat", 0))))
    if not centers:
        return None, False
    best = min(centers, key=lambda t: (t[1] - lng) ** 2 + (t[2] - lat) ** 2)
    return best[0], True


def scan_district_counts() -> dict[str, dict[str, int]]:
    """扫描**磁盘上全部** POI 的 `district` 字段 → `{市 adcode: {区 adcode: 点数}}`。

    ★ 为什么扫全盘而不是用本次 `targets`：与 `sync_district_tree()` 同一条纪律 ——
      `--city=xx` 增量跑时传进来的只有那座城，其余城市的区分片会被当成"没变"而跳过，
      下一次全量跑才发现它们其实早就漂了。核对对象永远是磁盘。
    """
    out: dict[str, dict[str, int]] = {}
    for slug, cid, _dir in iter_city_dirs():
        head = read_city_json(slug, cid)
        cad = str(head.get("adcode") or "")
        if not cad:
            continue
        bucket = out.setdefault(cad, {})
        for _cat, path in iter_poi_files(slug, cid):
            ad = (read_json(path) or {}).get("district")
            if ad:
                key = str(ad)
                bucket[key] = bucket.get(key, 0) + 1
    return out


def sync_subdistrict_counts(counts: dict[str, dict[str, int]] | None = None) -> tuple[int, int]:
    """把"每个区有多少个点位"回填到 `subdistricts/<市adcode>.json`。

    ★ 区列表是 step8 抓取的**快照**，计数是 POI 的**派生** ——
      两边分开就意味着会漂，所以每次 build 都重算一遍。

    @return `(更新文件数, 归到区的点数)`
    """
    table = counts if counts is not None else scan_district_counts()

    files = 0
    pois = 0
    for city_adcode, counts_by_d in table.items():
        path = SUBDISTRICTS / f"{city_adcode}.json"
        if not path.exists():
            continue
        data = read_json(path)
        changed = False
        for child in data.get("children") or []:
            n = counts_by_d.get(str(child.get("adcode")), 0)
            pois += n
            # ★ 区这一级的语义与市不同：它不是"待收录"，没有景点就是 0
            if child.get("poiCount") != n or child.get("level") != "district":
                child["poiCount"] = n
                child["level"] = "district"
                changed = True
        if changed:
            write_json(path, data, compact=True)
            files += 1
    return files, pois


def sync_flat_province_counts(
    counts: dict[str, dict[str, int]] | None = None, tree_path: Path | None = None
) -> int:
    """直辖市 / 港澳台：把区级计数回填到**区划树**上（它们的区在树里，没有分片文件）。

    普通省的下辖区在 `subdistricts/` 里按需加载；而直辖市没有"市"这一层，
    树上省节点的 `children` 直接就是区 —— 所以它们走另一条路。

    @return 回填上的区数
    """
    path = tree_path or (GENERATED / "district-tree.json")
    if not path.exists():
        return 0

    table = counts if counts is not None else scan_district_counts()
    if not table:
        return 0

    tree = read_json(path)
    touched = 0
    for prov in tree.get("provinces", []):
        # ★ "省 = 市" 的判据：省 adcode 能直接在城市计数表里命中
        #   （普通省是 510000 这种，不会作为城市 adcode 出现在表里）
        hit = table.get(str(prov.get("adcode") or ""))
        if hit is None:
            continue
        for child in prov.get("children") or []:
            n = hit.get(str(child.get("adcode")), 0)
            if child.get("poiCount") != n or child.get("level") != "district":
                child["poiCount"] = n
                child["level"] = "district"
                touched += 1

    if touched:
        write_json(path, tree, compact=True)
    return touched


def sync_city_bbox() -> int:
    """用**已清洗的**区边界重算 `city-bbox.json` 的 bbox（零请求）。

    ★ 为什么必须有这一步：
    `citymeta.resolve()` 把 bbox 按 adcode 缓存在 `city-bbox.json`，**命中就不再重算**
    (`refresh=True` 才会重新请求)。所以后来在 `districts/<adcode>.geo.json` 上做的
    任何清洗（典型是 `step8._drop_stray_parts` 丢弃了接口返回的错位多边形）**都不会
    反映到 bbox 上** —— 缓存里留着污染值，而它同时是：

    - `city.json` 的 `bbox`（seed 写入）→ 前端判断"POI 有没有越界"的尺子；
    - 入口取景的兜底框。

    天津就是这么中招的：河东区有个环落在 438km 外的邢台，清完边界之后 bbox 仍写着
    西到 113.74°（比真实西界偏了近 3°），一进天津页镜头就往河北退。

    它不替代 `resolve()`（新城市第一次仍要靠接口拿），只是让既有缓存**跟着 geo 走**。

    @return 改了几条
    """
    path = GENERATED / "city-bbox.json"
    if not path.exists():
        return 0
    cache = read_json(path)

    def bbox_of(adcode: str) -> list[float] | None:
        # ★★ 优先用**高德那份"区自身轮廓"**（`districts-own/`，2026-10-02 起）：
        #   腾讯给下辖区的轮廓极粗（实测有的区只有 4 个点 = 一个矩形），
        #   而矩形之间会互相越界 ⇒ 并集出来的市 bbox 会**偏大**（入口取景跟着偏松）。
        #   高德缺了就退回腾讯那份 —— 与前端 `loadDistrictFaces()` 的优先级一致。
        geo = DISTRICT_OWN / f"{adcode}.geo.json"
        if not geo.exists():
            geo = DISTRICTS / f"{adcode}.geo.json"
        if not geo.exists():
            return None
        file = read_json(geo)
        lngs: list[float] = []
        lats: list[float] = []
        for rings in (file.get("polygons") or {}).values():
            for ring in rings:
                for i in range(0, len(ring) - 1, 2):
                    lngs.append(float(ring[i]))
                    lats.append(float(ring[i + 1]))
        if not lngs:
            return None
        return [round(min(lngs), 4), round(min(lats), 4),
                round(max(lngs), 4), round(max(lats), 4)]

    touched = 0
    for adcode, item in cache.items():
        box = bbox_of(adcode)
        if box is None or item.get("bbox") == box:
            continue
        item["bbox"] = box
        touched += 1

    if touched:
        write_json(path, cache)
    return touched
