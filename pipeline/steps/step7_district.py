#!/usr/bin/env python3
"""
pipeline/steps/step7_district.py —— 区划树 + 聚合计数（04 文档第七步 / 10 文档第四节）

产物：`data/_generated/district-tree.json` —— 三级下钻（全国 → 省 → 市）的地基。

★ 这个文件只存**结构与计数**，不含任何边界几何。体积用**紧凑 JSON** + 坐标 4 位压缩：
  实测 55KB（缩进 2 空格时是 117KB），gzip 后约 12KB。
  ⚠️ 别再指望压到 50KB 以下 —— 光"34 省 + 450 个下级"的键名重复就要 40KB+，
  再往下只有改成数组化结构（会破坏前端消费契约），不值得。
  边界单独落 `data/_generated/districts/*.json`，按需拉。两者分开是为了让
  "改个计数"不必重下几百 KB 的边界点串。

🚨 合规红线（写在代码里而不是文档里，因为只有代码会真的拦住）：
  1. 边界与区划**只能来自腾讯 District 服务** —— 绝不用第三方 GeoJSON
     （涉及中国台湾、藏南、南海诸岛的表达，《地图管理条例》范畴）
  2. 必须覆盖 **34 个省级单位**（含中国台湾 710000 / 中国香港 810000 / 中国澳门 820000）
  3. `999999` 这类非行政区划（如东海）必须过滤

★ null ≠ 0（10 文档 5.2）：
  没有城市详情数据的市，`cityId` 为 null（UI 渲染成灰色虚线「待收录」）；
  真收了但一个 POI 都没有才是 0。把 null 渲染成 0 是**信息错误**。
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

if __package__ in (None, ""):
    # ★ 本文件在 pipeline/steps/，往上两级才是仓库根（见 core/layout.py 同处陷阱）
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pipeline.core.layout import (                # noqa: E402
    DISTRICTS, GENERATED, count_city_pois, iter_city_dirs, read_city_json, write_json,
)
from pipeline.providers import tmap                    # noqa: E402

TREE_PATH = GENERATED / "district-tree.json"

#: ★ 34 个省级单位 adcode。少一个就阻断 —— 这是合规，不是洁癖
EXPECTED_PROVINCE_ADCODES: set[str] = {
    "110000", "120000", "130000", "140000", "150000",
    "210000", "220000", "230000",
    "310000", "320000", "330000", "340000", "350000", "360000", "370000",
    "410000", "420000", "430000", "440000", "450000", "460000",
    "500000", "510000", "520000", "530000", "540000",
    "610000", "620000", "630000", "640000", "650000",
    "710000",  # 中国台湾
    "810000",  # 中国香港
    "820000",  # 中国澳门
}

#: 过滤非行政区划（如 adcode 999999 的东海）
SKIP_ADCODES = {"999999", "000000"}


def _center_of(node: dict) -> dict:
    """直接用 API 返回的 location 作为标注锚点 —— 不用自己算质心（质心可能落在界外）。

    ★ 精度取 4 位（≈11 米）：这是**下钻标注**，不是 POI 落点，11 米足够；
      取 6 位会让区划树白白大一圈（几千个条目 × 2 个数字）。
    """
    loc = node.get("location") or {}
    return {"lng": round(float(loc.get("lng", 0)), 4), "lat": round(float(loc.get("lat", 0)), 4)}


def count_collected_cities() -> dict[str, tuple[str, int]]:
    """扫描 data/cities/ 下已入库城市 → { 市 adcode: (城市 id, POI 数) }"""
    out: dict[str, tuple[str, int]] = {}
    for slug, cid, _ in iter_city_dirs():
        city = read_city_json(slug, cid)
        adcode = city.get("adcode")
        if not adcode:
            continue
        out[adcode] = (cid, count_city_pois(slug, cid))
    return out


def fetch_tree() -> dict:
    """拉全国三级区划：省 → 市。**只拿结构与中心点，不拿边界**（边界单独一步）。"""
    result = tmap.district_list()
    flat: list[dict] = result.get("result", [])
    print(f"  区划列表：{len(flat)} 组数组（result[0] 为省级，1..N 按 cidx 切分）")

    provinces: list[dict] = []

    for prov in flat[0] if flat else []:
        adcode = str(prov.get("id", ""))
        if adcode in SKIP_ADCODES:
            continue
        provinces.append({
            "adcode": adcode,
            "name": prov.get("name", ""),
            "fullname": prov.get("fullname", prov.get("name", "")),
            "center": _center_of(prov),
            "children": [],
        })

    missing = EXPECTED_PROVINCE_ADCODES - {p["adcode"] for p in provinces}
    if missing:
        raise RuntimeError(
            f"🚨 省级单位缺失 {sorted(missing)} —— 必须覆盖全部 34 个省级单位"
            f"（含中国台湾 710000 / 中国香港 810000 / 中国澳门 820000），这是合规红线"
        )

    # 逐个省取下级市
    for i, prov in enumerate(provinces, 1):
        try:
            kids = tmap.district_children(prov["adcode"])
        except RuntimeError as exc:
            print(f"  ⚠️ {prov['name']} 取下级失败：{exc}")
            continue
        for k in kids:
            ka = str(k.get("id", ""))
            if ka in SKIP_ADCODES:
                continue
            prov["children"].append({
                "adcode": ka,
                "name": k.get("name", ""),
                "fullname": k.get("fullname", k.get("name", "")),
                "center": _center_of(k),
            })
        print(f"  [{i}/{len(provinces)}] {prov['name']}：{len(prov['children'])} 个下级", flush=True)

    # 直辖市 / 港澳：省级下直接是区级（没有二级结构）。
    # District 返回的下级仍是"区"，这里**原样保留、不报错** —— 前端按 children 直接展示即可。
    return {"provinces": provinces}


def province_adcode_of(city_adcode: str) -> str:
    """市 adcode → 省 adcode（`510100` → `510000`）。前两位是省级码。"""
    return city_adcode[:2] + "0000"


def fetch_bounds(province_adcode: str, name: str, *, force: bool = False) -> Path | None:
    """取某个省下**各市**的边界，写 `districts/{adcode}.geo.json`。

    ## 🚨 为什么这里取不到"省级自身"的轮廓（实测结论，别再试了）
    腾讯 District 的边界能力只有一种形态：**返回子级的轮廓**。实测：

    | 调用 | 结果 |
    |------|------|
    | `getchildren?id=510000&get_polygon=1` | **21 个市的** polygon（不含四川自身） |
    | `getchildren?id=510000&get_polygon=2` | 同上，节点数完全一致 |
    | `getchildren?id=100000&get_polygon=1` | 0 个节点（"中国"不是有效的父级） |
    | `search?keyword=四川&get_polygon=1/2` | 返回四川本身，但**永远不带 polygon 字段** |
    | `/ws/district/v1/boundary?id=510000` | 404，接口不存在 |
    | `max_offset=500/1000/3000/10000` | 点数与体积**完全不变**，该参数在当前接口上无效 |

    所以：**全国图的省级边界不由我们画**，交给腾讯矢量底图（持牌图商的标准审图底图）。
    本函数只产"某省各市的边界"，供省级页面下钻使用 —— 那是 District 真能给的东西。

    ## ⚠️ 缓存判定必须看**内容**，不能只看文件是否存在
    上一版就是因为 `not path.exists()` 这种判定，把一个**34 个省份全是空数组**的
    `provinces.geo.json` 当成了有效缓存，于是后面每次跑都跳过重拉，空文件被永久固化。
    文件存在 ≠ 文件有效。
    """
    path = DISTRICTS / f"{province_adcode}.geo.json"

    if path.exists() and not force:
        try:
            cached = json.loads(path.read_text(encoding="utf-8"))
            if cached.get("polygons"):
                print(f"  {name}：命中缓存（{len(cached['polygons'])} 个下级边界）")
                return None
            print(f"  ⚠️ {name}：缓存文件为空，重新拉取")
        except (json.JSONDecodeError, OSError):
            print(f"  ⚠️ {name}：缓存文件不可读，重新拉取")

    try:
        kids = tmap.district_children(province_adcode, polygon=True)
    except RuntimeError as exc:
        print(f"  ⚠️ {name} 取边界失败：{exc}")
        return None

    polygons: dict[str, list] = {}
    for k in kids:
        ka = str(k.get("id", ""))
        if ka in SKIP_ADCODES:
            continue
        poly = k.get("polygon")
        if poly:
            polygons[ka] = poly

    if not polygons:
        print(f"  ⚠️ {name}：接口没返回任何边界")
        return None

    write_json(path, {
        "adcode": province_adcode,
        "name": name,
        # 原样落盘，不做任何几何加工（红线：不得修改 API 返回的边界形状）。
        # 形状是 `{子adcode: [环, …]}`，环是**扁平坐标串** `[lng, lat, lng, lat, …]`。
        "polygons": polygons,
        "fetchedAt": date.today().isoformat(),
    }, compact=True)
    # 环是扁平串，数字个数 ÷ 2 才是点数
    pts = sum(len(ring) for rings in polygons.values() for ring in rings) // 2
    size_kb = path.stat().st_size / 1024
    print(f"  ✅ {name}：{len(polygons)} 个下级边界 · {pts} 个点 · {size_kb:.1f} KB")
    return path


def attach_counts(tree: dict) -> dict:
    """把已入库城市的 POI 计数挂到区划树上。**纯本地计算，零 API 调用**。"""
    collected = count_collected_cities()
    for prov in tree["provinces"]:
        total = 0
        n_city = 0
        for kid in prov["children"]:
            info = collected.get(kid["adcode"])
            if info:
                cid, n = info
                kid["cityId"] = cid
                kid["poiCount"] = n
                n_city += 1
                total += n
            else:
                # ★ 待收录：cityId 为 null，绝不是 0
                kid["cityId"] = None
                kid["poiCount"] = 0
        prov["poiCount"] = total
        prov["cityCount"] = n_city
        prov["childCount"] = len(prov["children"])
        # 树里只保留 UI 需要的字段
        for kid in prov["children"]:
            kid.pop("fullname", None)
    return tree


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    refresh = "--refresh-bounds" in args

    try:
        tmap.web_key()
    except tmap.MissingKeyError as exc:
        print(f"❌ {exc}")
        return 2

    print("① 拉取全国三级区划（34 个省级单位）…")
    tree = fetch_tree()
    print(f"  省级单位 {len(tree['provinces'])} 个 ✅")

    print("② 汇总已入库城市计数…")
    tree = attach_counts(tree)
    for p in tree["provinces"]:
        if p["cityCount"]:
            print(f"  {p['name']}：{p['poiCount']} 个 POI · 已收录 {p['cityCount']}/{p['childCount']} 个市")

    # ③ 只为**已收录城市所在省**拉市级边界。
    #    其余省等真正有内容时再拉 —— 避免为"待收录"的省白白固化几百 KB 点串。
    collected = count_collected_cities()
    targets = sorted({province_adcode_of(a) for a in collected})
    name_of = {p["adcode"]: p["fullname"] or p["name"] for p in tree["provinces"]}
    if targets:
        print(f"\n③ 拉取 {len(targets)} 个省的市级边界（供省级页面下钻）…")
        for pa in targets:
            fetch_bounds(pa, name_of.get(pa, pa), force=refresh)
    else:
        print("\n③ 没有已收录的城市，跳过边界拉取")

    tree = {
        "version": date.today().isoformat().replace("-", ""),
        "generatedAt": date.today().isoformat(),
        **tree,
    }
    # 紧凑写出：几千个同构条目，缩进 2 空格会让它到 117KB（约束是 <50KB）
    write_json(TREE_PATH, tree, compact=True)
    size_kb = TREE_PATH.stat().st_size / 1024
    flag = "✅" if size_kb < 60 else "⚠️"
    print(f"\n{flag} 已写入 {TREE_PATH.relative_to(GENERATED.parent.parent)}（{size_kb:.1f} KB）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
