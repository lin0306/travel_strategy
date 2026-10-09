#!/usr/bin/env python3
"""
pipeline/steps/step8_subdistricts.py —— **市辖区（区级）**数据与边界

## 它补的是哪一级
区划树（step7）只有两级：省 → 市。而地图第四级（省 → 市 → **区** → 景点）
需要"每个市下面有哪几个区"，这一步就是把**第三级**补齐。

## 产物（一个市两个文件，**按需加载**）
| 文件 | 内容 | 谁用 |
|------|------|------|
| `subdistricts/<市adcode>.json` | 区列表：`adcode / name / center` | 树的第三级、区徽标 |
| `districts/<市adcode>.geo.json` | 各区的**面**（扁平坐标串环） | 前端 `loadDistrictBounds()` 直接吃 |

★ 为什么拆成两个文件而不是塞进 `district-tree.json`：把 493 个市的全部区塞进树里，
  树会从 55KB 涨到几百 KB，而首页只需要两级。**按市分片 + 懒加载**之后，
  只有真的走进某座城市才会读它那一份。

## 🚨 实测得到的三条事实（改这个文件前先看）
1. **`getchildren(polygon=1)` 一次请求同时给出 center 与 polygon**
   —— 不必为"区列表"和"区边界"各发一次，本文件每市只发 **1** 次。
2. **`name` 可能是空、`fullname` 一定有**（广州 11 区、成都 20 区全是这样）。
   直接取 `name` 会得到 `null`，一路静默传到 UI 上变成空白徽标。
3. 直辖市 / 港澳台（`11/12/31/50/71/81/82` 开头）**没有中间的市层**：
   腾讯对 `110100`（市辖区）返回 0 个下级，而 `110000` 的下级就是 16 个区。
   它们的"区"已经在树里 ⇒ **不在本步骤范围内**（用户拍板：省与市是同一份数据，
   不再合成虚拟的市辖区节点）。

用法：
    python pipeline/step8_subdistricts.py                  # 全量补（已有的跳过）
    python pipeline/step8_subdistricts.py --force          # 全部重拉
    python pipeline/step8_subdistricts.py --only=440100,510100
"""

from __future__ import annotations

import json
import math
import sys
import time
from datetime import date
from pathlib import Path

if __package__ in (None, ""):
    # ★ 本文件在 pipeline/steps/，往上两级才是仓库根（见 core/layout.py 同处陷阱）
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pipeline.core.layout import (                # noqa: E402
    CITIES, DISTRICTS, GENERATED, read_json, write_json,
)
from pipeline.geo.districtless import normalize_districts  # noqa: E402
from pipeline.providers import tmap                    # noqa: E402

#: 区列表分片目录
SUBDIR = GENERATED / "subdistricts"

TREE_PATH = GENERATED / "district-tree.json"

#: ★ 省级 adcode 前两位。这些单位"省级即市级"，下级已经是区/县，没有中间的市层
FLAT_PROVINCE_PREFIX = ("11", "12", "31", "50", "71", "81", "82")

#: 非行政区划（东海一类），过滤掉
SKIP_ADCODES = {"999999", "000000"}

#: 拉取间隔（秒）。493 个市串行跑，节流是为了不撞 120（每秒请求量上限）
THROTTLE_SEC = 0.12


def is_flat_province(province_adcode: str) -> bool:
    """是否"省级即市级"（直辖市 / 港澳台）—— 它们的下级已经是区，不需要再拉一层。"""
    return str(province_adcode)[:2] in FLAT_PROVINCE_PREFIX


def city_adcodes_from_tree(tree: dict) -> list[tuple[str, str]]:
    """树里所有"需要拉区"的**市级**单位 → [(市 adcode, 市名)]。

    ★ 直辖市 / 港澳台也要进来 —— 而且是以**省自己的 adcode**进来：
      它们"省 = 市"，下级就是区（`children` 那一层已经在树上）。
      这么做的理由不是结构完整，是**精度**：
      实测上海黄浦区的边界，step7 按省级拉下来只有 **5 个点**（轮廓失真到无法判定点在不在区内），
      而本步骤按"市"拉是正常精度。坐标归区一旦用失真的边界，
      点位会整片落到"兜底的最近区中心"上去。
    """
    out: list[tuple[str, str]] = []
    for prov in tree.get("provinces", []):
        pa = str(prov.get("adcode") or "")
        if not pa or pa in SKIP_ADCODES:
            continue
        if is_flat_province(pa):
            out.append((pa, prov.get("name") or ""))
            continue
        for kid in prov.get("children") or []:
            ka = str(kid.get("adcode") or "")
            if ka and ka not in SKIP_ADCODES:
                out.append((ka, kid.get("name") or ""))
    return out


def adcodes_from_data_dirs(known: set[str]) -> list[tuple[str, str]]:
    """★ 数据目录里已有、但**不在区划树市级列表**中的城市 —— 也就是**县级市**。

    为什么需要（2026-10-06）：区划树只有两级（省 → 地级市），
    曲阜 `370881` / 平遥 `140728` / 敦煌 `620982` / 婺源 `361130` / 香格里拉 `533401` /
    凤凰 `433123` / 稻城 `513337` 这类县级城市**不在** `city_adcodes_from_tree()` 的结果里
    ⇒ step8 会直接跳过它们（表现为「待拉取区县数据的市级单位：N 个」里没有它），
    于是拿不到 `subdistricts/<adcode>.json` —— 区级数据与折叠后的面全都没有。
    ⇒ 这里从 `data/cities/*/*/city.json` 读 adcode 补齐，县级城市也能走正常流程。
    """
    out: list[tuple[str, str]] = []
    for city_json in sorted(CITIES.glob("*/*/city.json")):
        doc = read_json(city_json)
        if not doc:
            continue
        a = str(doc.get("adcode") or "")
        if not a or a in known:
            continue
        out.append((a, str(doc.get("name") or city_json.parent.name)))
    return out


def _name_of(node: dict) -> str:
    """★ `name` 可能为空 —— 实测广州 11 区、成都 20 区全是这样，只有 `fullname` 有值。"""
    return str(node.get("name") or node.get("fullname") or "")


def _center_of(node: dict) -> dict:
    loc = node.get("location") or {}
    return {"lng": round(float(loc.get("lng", 0)), 4), "lat": round(float(loc.get("lat", 0)), 4)}


def _read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8")) or {}
    except (json.JSONDecodeError, OSError):
        return {}


def _cache_valid(path: Path, key: str) -> bool:
    """文件存在**且里面真有东西**才算命中缓存（文件存在 ≠ 文件有效）。"""
    if not path.exists():
        return False
    return bool(_read_json(path).get(key))


def fetch_city_subdistricts(
    city_adcode: str, city_name: str, *, force: bool = False
) -> tuple[int, int] | None:
    """拉一座市的区数据 + 区边界 —— **一次请求两样都拿到**（见文件头实测 ①）。

    @return `(区数, 点数)`；命中缓存返回 `None`。
    """
    list_path = SUBDIR / f"{city_adcode}.json"
    bounds_path = DISTRICTS / f"{city_adcode}.geo.json"

    if not force and _cache_valid(list_path, "children") and _cache_valid(bounds_path, "polygons"):
        return None

    try:
        kids = tmap.district_children(city_adcode, polygon=True)
    except RuntimeError as exc:
        print(f"  ⚠️ {city_name}({city_adcode}) 取区失败：{exc}")
        return None

    children: list[dict] = []
    polygons: dict[str, list] = {}
    for k in kids:
        ka = str(k.get("id") or "")
        if not ka or ka in SKIP_ADCODES:
            continue
        name = _name_of(k)
        if not name:
            # 两个字段都空 = 脏数据，宁可不显示也不要一个空徽标（UI 上无从解释）
            print(f"  ⚠️ {city_name}({city_adcode}) 有节点既无 name 也无 fullname，已跳过：{ka}")
            continue
        children.append({"adcode": ka, "name": name, "center": _center_of(k)})
        if k.get("polygon"):
            polygons[ka] = k["polygon"]

    if not children:
        print(f"  ⚠️ {city_name}({city_adcode}) 接口没返回任何区")
        return None

    # ── 不设区的市：这一层拿不到任何边界 ⇒ 折叠成「一个节点 = 市自身」──
    # 规则与实测见 `pipeline/districtless.py`；全国 38 个市是这种情形
    # （东莞/中山/儋州/嘉峪关/海西 + 济源/仙桃/潜江/天门/神农架 + 海南 15 县市 + 新疆兵团 13 市）。
    folded = normalize_districts(city_adcode, city_name, children, polygons)
    if folded:
        children, polygons, why = folded
        print(f"  · {city_name}({city_adcode}) 这一层无边界 ⇒ 折叠为「市自身」一个区（{why}）")
    else:
        # ★ 区政府驻地（接口给的 center）是"哪块是真的"的唯一权威参考 —— **写盘前**洗一遍。
        # ⚠️ 上一版这一步写在 `write_json` **之后**：清洗结果只拿去统计点数了，
        #    磁盘上留的**一直是未清洗的坏环**（2026-10-01 修正顺序）。
        polygons = _drop_stray_parts(polygons, children, city_name)

    today = date.today().isoformat()
    SUBDIR.mkdir(parents=True, exist_ok=True)
    write_json(list_path, {
        "adcode": city_adcode,
        "name": city_name,
        # ★ level 写死：这一层就是"区"。前端按 level 渲染，不靠在树里的深度判断
        #   —— 直辖市的两级结构与普通省的三级结构由此统一
        "level": "district",
        "children": children,
        "fetchedAt": today,
    }, compact=True)

    write_json(bounds_path, {
        "adcode": city_adcode,
        "name": city_name,
        # 形状与省级边界文件一致：`{子adcode: [环, …]}`，环是扁平坐标串。
        # 前端 `loadDistrictBounds(<adcode>)` 不区分省还是市，直接就能吃。
        "polygons": polygons,
        "fetchedAt": today,
    }, compact=True)

    pts = sum(len(ring) for rings in polygons.values() for ring in rings) // 2
    return len(children), pts


# ── 边界清洗：走丢的多边形 ────────────────────────────
#
# 腾讯偶尔返回一个错的多边形成员。实测天津 120102 河东区拿到的第 2 个环，
# 质心落在 **438 km 之外**的邢台一带。它同时污染两件事：
#   · 入口取景 `loadCityBox`：外接框被拉到 4.3°，省级页一进门镜头落在河北；
#   · 构建期归区 `assign_district`："点在多边形"会把远处那块里的点判成属于这个区。
#
# 判据是踩出来的三条（详见 `tools/scan_bad_rings.py` 文件头）：
#   ① 不能只算"环质心到区中心的距离" —— 大片县域的驻地与几何质心天然差几十公里；
#   ② 同一个区里两块互相远离时不能**两边都判坏**（相对距离对称），必须回答留哪一边；
#   ③ 所以：单链聚类 → 按到区政府驻地的距离排序 → 丢掉比"同城尺度"还远好几倍的簇
#      —— 三沙那种辖区本来就横跨南海的城市一个都不许删。

CLUSTER_KM = 50.0        # 单链聚类半径
STRAY_KM = 100.0         # 至少这么远才算"远"
SCALE_FACTOR = 3.0       # 且比同城区间距的 90 分位 × 3 还远


def _km(lng0: float, lat0: float, lng1: float, lat1: float) -> float:
    return math.hypot((lng0 - lng1) * 96.0, (lat0 - lat1) * 111.0)


def _centroid(ring: list[float]) -> tuple[float, float] | None:
    xs = ring[0::2]
    ys = ring[1::2]
    return (sum(xs) / len(xs), sum(ys) / len(ys)) if xs else None


def _nearest_dist(rings: list[list[float]], pt: tuple[float, float]) -> float:
    best = float("inf")
    for r in rings:
        for i in range(len(r) // 2):
            d = _km(r[2 * i], r[2 * i + 1], pt[0], pt[1])
            if d < best:
                best = d
    return best


def _clusters(rings: list[list[float]]) -> list[list[list[float]]]:
    """单链聚类：两簇质心距离 < CLUSTER_KM 就并到一簇"""
    cents = [_centroid(r) for r in rings]
    left = list(range(len(rings)))
    out: list[list[list[float]]] = []
    while left:
        seed = left.pop(0)
        group = [seed]
        changed = True
        while changed:
            changed = False
            for idx in list(left):
                a, b = cents[seed], cents[idx]
                if a and b and _km(a[0], a[1], b[0], b[1]) < CLUSTER_KM:
                    group.append(idx)
                    left.remove(idx)
                    changed = True
        out.append([rings[i] for i in group])
    return out


def _city_scale(centers: list[tuple[float, float]]) -> float:
    """同城各区两两距离的 90 分位 —— "这座城市有多大"的通用尺子"""
    ds = [
        _km(a[0], a[1], b[0], b[1])
        for i, a in enumerate(centers)
        for b in centers[i + 1:]
    ]
    if not ds:
        return 0.0
    ds.sort()
    return ds[min(int(len(ds) * 0.9), len(ds) - 1)]


def _drop_stray_parts(
    polygons: dict[str, list], children: list[dict], city_name: str
) -> dict[str, list]:
    """把每个区里"走丢的那一块"去掉。**最近的那一簇永远留下**。"""
    centers = {
        str(c["adcode"]): (float(c["center"]["lng"]), float(c["center"]["lat"]))
        for c in children
        if c.get("center", {}).get("lng") is not None
    }
    if len(centers) < 2:
        return polygons

    scale = _city_scale(list(centers.values()))
    threshold = max(STRAY_KM, SCALE_FACTOR * scale)

    for adcode, rings in list(polygons.items()):
        center = centers.get(adcode)
        if not center or len(rings) < 2:
            continue
        groups = _clusters(rings)
        if len(groups) < 2:
            continue
        scored = sorted(((_nearest_dist(g, center), g) for g in groups), key=lambda t: t[0])
        # ★ 最近那一簇永远留下（防护：极端情况下所有簇都超阈值也不至于把区删空）
        kept = [scored[0][1]]
        stray = []
        for d, g in scored[1:]:
            if d > threshold:
                stray.append(d)
            else:
                kept.append(g)
        for d in stray:
            print(
                f"  ⚠️ {city_name} 的区 {adcode} 有一块多边形在 {d:.0f} km 外（阈值 "
                f"{threshold:.0f} km）—— 判定为接口返回的错位数据，已丢弃"
            )
        if stray:
            polygons[adcode] = [r for g in kept for r in g]
    return polygons


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    force = "--force" in args
    only: set[str] = set()
    for a in args:
        if a.startswith("--only="):
            only = {x.strip() for x in a.split("=", 1)[1].split(",") if x.strip()}

    try:
        tmap.web_key()
    except tmap.MissingKeyError as exc:
        print(f"❌ {exc}")
        return 2

    tree = read_json(TREE_PATH)
    if not tree.get("provinces"):
        print(f"❌ {TREE_PATH} 为空 —— 先跑 `python pipeline/step7_district.py`")
        return 1

    targets = city_adcodes_from_tree(tree)
    # ★ 县级市不在两级区划树里 ⇒ 从数据目录补齐（见 adcodes_from_data_dirs）
    targets += adcodes_from_data_dirs({a for a, _ in targets})
    if only:
        targets = [t for t in targets if t[0] in only]
    print(f"待拉取区县数据的市级单位：{len(targets)} 个（直辖市 / 港澳台的下级已在树里，不在范围内）")

    done = skipped = failed = 0
    total_children = total_pts = 0
    t0 = time.time()
    for i, (adcode, name) in enumerate(targets, 1):
        try:
            r = fetch_city_subdistricts(adcode, name, force=force)
        except Exception as exc:                      # noqa: BLE001 —— 单城失败不该中断全量
            print(f"  ❌ {name}({adcode}) 异常：{type(exc).__name__}: {exc}")
            failed += 1
            continue

        if r is None:
            skipped += 1
        else:
            n, pts = r
            done += 1
            total_children += n
            total_pts += pts

        if i % 20 == 0 or i == len(targets):
            print(f"  [{i}/{len(targets)}] 新增 {done} · 跳过 {skipped} · 失败 {failed} "
                  f"· {time.time() - t0:.0f}s", flush=True)
        time.sleep(THROTTLE_SEC)

    size = sum(p.stat().st_size for p in SUBDIR.glob("*.json"))
    print(f"\n✅ 区数据：{total_children} 个区 · {total_pts} 个点 · {size / 1024:.0f} KB（{SUBDIR.name}/）")
    print(f"  新增 {done} · 命中缓存 {skipped} · 失败 {failed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
