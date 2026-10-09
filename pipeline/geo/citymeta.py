"""
pipeline/geo/citymeta.py —— 城市主数据里的**地理部分**（adcode / center / bbox）

★ 为什么要单独抽出来：
`adcode` 是下钻的关联键、`bbox` 用来校验 POI 是否落在市内、`center` 决定地图初始视野 ——
这三个值**手填必错**（记错 adcode 会让整城接不上下钻；bbox 写小了会把真点位判成越界）。
所以统一从腾讯区划接口实测，一处生成，全项目复用。

取值路径：
    adcode / center   → `data/_generated/district-tree.json`（step7 已固化，零请求）
    bbox              → `district_children(cityAdcode, polygon=True)` 的子级边界取并集

⚠️ bbox 为什么绕一圈：腾讯的 `district/v1/search` **不支持** `get_polygon`，
`district/v1/getchildren` 又**只返回子级的边界**（不含传入 id 自身）——
所以"市的边界"只能由它下辖所有区县的边界取并集得到（细节见 tmap.district_children 注释）。
每城 1 次请求，可缓存。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pipeline.core.layout import GENERATED, read_json

TREE_PATH = GENERATED / "district-tree.json"
CACHE_PATH = GENERATED / "city-bbox.json"


def _load_tree() -> dict:
    tree = read_json(TREE_PATH)
    if not tree.get("provinces"):
        raise RuntimeError(
            f"{TREE_PATH} 为空 —— 请先跑 `python pipeline/step7_district.py` 生成区划树"
        )
    return tree


def _norm(name: str) -> str:
    """剥掉"市/自治州/地区/区"等行政后缀，便于比对。

    ⚠️ 单向剥离：`name` 的核心字符要能匹配上接口返回的名称。
    """
    core = name
    for suffix in ("特别行政区", "自治州", "地区", "自治县", "市", "县", "区", "盟", "旗"):
        if core.endswith(suffix) and len(core) > len(suffix):
            core = core[: -len(suffix)]
            break
    return core


def _find_county(city_name: str, prov: dict) -> dict | None:
    """县 / 县级市：区划树**只有两级**（省 → 地级市），县不在树里 ⇒ 按名查接口。

    ★ 曲阜、平遥、敦煌、婺源、香格里拉、凤凰、稻城都属于这一类（2026-10-06 扩城用）。
    ★ 仍然**不手填** adcode / center —— 全部由 `district_search` 实测，
      与本项目"地理值手填必错"的口径一致。
    ★ 校验 `adcode` 前 2 位 == 省码前 2 位，避免同名不同省（如别处也叫"凤凰"的地方）。
    """
    from pipeline.providers import tmap                                         # 局部导入：与 resolve() 同风格
    try:
        hits = tmap.district_search(city_name)
    except Exception:                                          # noqa: BLE001
        return None
    p2 = str(prov.get("adcode") or "")[:2]
    core = _norm(city_name)
    for n in hits or []:
        code = str(n.get("id") or "")
        if not code or (p2 and code[:2] != p2):
            continue                                          # 省码对不上 → 不是本省的同名地
        nm = n.get("fullname") or n.get("name") or ""
        if _norm(nm) == core:
            return {"name": nm, "adcode": code, "center": n.get("location") or {}}
    return None


def find_city_node(city_name: str, province_name: str) -> tuple[dict, dict]:
    """在区划树里定位城市节点 → (省节点, 市节点)。找不到抛 KeyError（不静默返回）。

    ★★ 两级查找：
      ① 省的直接 children（**地级市**）—— 绝大多数城市走这条；
      ② 找不到 ⇒ `_find_county()` 按名查**县级**（树里没有第三层）。
    """
    tree = _load_tree()
    pcore = _norm(province_name)
    prov = next(
        (p for p in tree["provinces"] if _norm(p.get("name", "")) == pcore),
        None,
    )
    if prov is None:
        raise KeyError(f"区划树里找不到省「{province_name}」")

    # ★ 直辖市：城市节点就是省节点本身（北京/上海/天津/重庆）
    if _norm(city_name) == pcore:
        return prov, prov

    ccore = _norm(city_name)
    for ch in prov.get("children") or []:
        if _norm(ch.get("name", "")) == ccore:
            return prov, ch

    # ② 县 / 县级市（不在两级树里）⇒ 按名查接口
    county = _find_county(city_name, prov)
    if county:
        return prov, county
    raise KeyError(
        f"省「{province_name}」下找不到市「{city_name}」。"
        f"可选：{[c.get('name') for c in (prov.get('children') or [])][:20]}"
    )


def _bbox_from_polygons(nodes: list[dict]) -> list[float] | None:
    """把若干节点的 polygon 并起来算 bbox → [minLng, minLat, maxLng, maxLat]。

    polygon 形状：`[环, 环, …]`，环是扁平坐标串 `[lng, lat, lng, lat, …]`。
    """
    lngs: list[float] = []
    lats: list[float] = []
    for n in nodes:
        for ring in n.get("polygon") or []:
            # 环可能是扁平序列，也可能是 [[lng,lat], ...] —— 两种都见过，都兼容
            if ring and isinstance(ring[0], (list, tuple)):
                for pt in ring:
                    lngs.append(float(pt[0]))
                    lats.append(float(pt[1]))
                continue
            for i in range(0, len(ring) - 1, 2):
                lngs.append(float(ring[i]))
                lats.append(float(ring[i + 1]))
    if not lngs:
        return None
    return [
        round(min(lngs), 4), round(min(lats), 4),
        round(max(lngs), 4), round(max(lats), 4),
    ]


def resolve(city_name: str, province_name: str, city_id: str, *, refresh: bool = False) -> dict:
    """解析一座城市的地理元数据。结果按 adcode 缓存，重复跑零请求。"""
    cache: dict[str, Any] = read_json(CACHE_PATH)
    prov, city = find_city_node(city_name, province_name)
    adcode = str(city.get("adcode") or "")

    hit = cache.get(adcode)
    if hit and not refresh:
        return {**hit, "cityId": city_id}

    from pipeline.providers import tmap                                # 局部导入：只有需要发请求时才碰 key

    children = tmap.district_children(adcode, polygon=True)
    bbox = _bbox_from_polygons(children)

    # ★ 县级市 / 不设区的市：子级是**街道、镇**，腾讯不给 polygon ⇒ bbox 拿不到。
    #   这时改用**它自己的轮廓**（`cities/<省>.geo.json`，缺则 `districts-own/<父市>.geo.json`，
    #   见 `districtless.own_city_rings`）。
    #   不这么做就会掉到"中心点外扩 0.5°"—— 对曲阜这种小县等于把邻县一起框进来，
    #   POI 越界校验会**漏报**（真放错的点查不出来）。
    if bbox is None:
        from pipeline.geo.districtless import own_city_rings          # 局部导入：避免模块级互相依赖

        rings = own_city_rings(adcode)
        if rings:
            bbox = _bbox_from_polygons([{"polygon": rings}])

    # 兜底：接口没给边界时，用中心点外扩 0.5°（约 50km）先顶上，并明确标注来源
    if bbox is None:
        c = city.get("center") or {}
        lng, lat = float(c.get("lng", 0)), float(c.get("lat", 0))
        bbox = [round(lng - 0.5, 4), round(lat - 0.5, 4), round(lng + 0.5, 4), round(lat + 0.5, 4)]
        print(f"  ⚠️ {city_name} 未取到边界，bbox 由中心点外扩生成（精度较低）")

    loc = city.get("center") or {}
    meta = {
        "cityId": city_id,
        "adcode": adcode,
        "provinceAdcode": str(prov.get("adcode") or ""),
        "center": {
            "lng": round(float(loc.get("lng", 0)), 6),
            "lat": round(float(loc.get("lat", 0)), 6),
            "coordSystem": "GCJ-02",
        },
        "bbox": bbox,
    }
    cache[adcode] = {k: v for k, v in meta.items() if k != "cityId"}
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(
        json.dumps(cache, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n",
    )
    return meta
