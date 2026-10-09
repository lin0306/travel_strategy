"""不设区的市：把"这一层一个面都没有"折叠成**一个节点 = 市自身**。

## 为什么需要它（2026-10-01 实测）

全国有 **38 个市**在"区"这一级拿不到任何边界，两种形态：

| 形态 | 例子 | 腾讯给的 children |
|------|------|------------------|
| 「自身」占位 | 东莞 `441900` · 中山 · 儋州 · 嘉峪关 · 海西 `632800` | 一个 `前4位 + 99` 的节点（`441999` / `632899`），**没有 polygon** |
| 一串街道 | 济源 `419001` · 仙桃/潜江/天门/神农架 · 海南 15 个县市 · 新疆兵团 13 个市 | 3~26 个 **9 位码**的街道/镇，**全都没有 polygon** |

两端的源都不给这一级的边界：

* 腾讯 `getchildren(…, get_polygon=1)` 对这些节点**不返回 `polygon` 字段**；
* 高德按镇名查会被**模糊匹配**带回市级 —— `amap.district_boundary('黄江镇')` 实际返回
  `441900`（东莞），`amap.py` 的自检直接中止。所以"退到高德取镇街"这条路是**堵死**的。

⇒ 这一层没有"区"可画。折叠成**一个节点 = 市自身**（与腾讯对东莞的表达同义），
面用**这个市自己的轮廓**（`cities/<省>.geo.json`，高德抓的，见 `step10_city_outlines.py`）。
前端零改动 —— 它就是一个普通区，只是这个名字等于市名。

★ 折叠后的 adcode 用**市自身**（`441900`）而不是腾讯的 `441999`，三个理由：
  ① 与 `cities/` 的 polygons key 直接对应；② 不依赖"前 4 位 + 99"这个腾讯私有约定；
  ③ `parentCityOf()` 按前 4 位反推所属市，两者都能对上，但用市码更直白。

★ 两条整理动作，都在 `normalize_districts()` 里：

  ① **剔除无面的「自身」占位**（`前 4 位 + 99`）：海西 `632800` 有 7 个真区**是有面的**，
     却还挂着一个 `632899`「海西蒙古族藏族自治州」占位（无面）—— 它不是真实的区，
     徽标点下去只有镜头没有面。剔掉它，保留 7 个真区。
     ★ **只剔没有面的**：有面的说明腾讯给了真边界，那就不动（宁可不改）。
  ② **一个面都没有 ⇒ 折叠成「市自身」一个节点**，面用市自己的轮廓。

★ 拿不到市轮廓的（雄安 `133100` / 草湖 `659013` —— 高德都不认这两个行政区划）
  **保持原样**：至少 `center` 是好的，点徽标仍会取景，只是没有面。
"""

from __future__ import annotations

from pathlib import Path

from pipeline.core.layout import CITY_BOUNDS, DISTRICT_OWN, read_json


def own_city_rings(city_adcode: str) -> list[list[float]] | None:
    """这个市**自己**的轮廓；拿不到返回 `None`。

    两处来源，按顺序试：
      ① `cities/<省>.geo.json` 的 `polygons[adcode]`（高德抓的**地级市**轮廓，`run.py cities`）
      ② ★ **县级市/县**：① 里只有地级市，县查不到 ⇒ 退回
         `districts-own/<父市>.geo.json` 的 `polygons[adcode]`
         —— 父市码 = 县码前 4 位 + `00`（如 曲阜 `370881` → 济宁 `370800`），
         这份数据里**县和区是同级**的，所以县界本来就在里面。

    ★★ 为什么要 ②（2026-10-06）：把**县级市当一座城市**入库时，它的下级是
       12 个街道/镇（腾讯返回的**全都没有 polygon**）⇒ 走本模块折叠成「市自身」，
       而折叠后的面就靠这里给。没有 ② 的话曲阜/平遥/敦煌/婺源/香格里拉/凤凰/稻城
       七城**只有镜头、没有轮廓**。
    ★ 两份数据都是**可选**的 —— 缺席时静默不生效，与"先试新源、缺了退回旧源"的口径一致。
    """
    prov = f"{city_adcode[:2]}0000"
    f: Path = CITY_BOUNDS / f"{prov}.geo.json"
    if f.exists():
        try:
            polys = (read_json(f) or {}).get("polygons") or {}
        except Exception:                                     # noqa: BLE001
            polys = {}
        rings = polys.get(city_adcode)
        if rings:
            return rings

    # ② 县级：退回所属地级市的那份（县与区同级，面在里面）
    parent = city_adcode[:4] + "00"
    g: Path = DISTRICT_OWN / f"{parent}.geo.json"
    if g.exists():
        try:
            polys = (read_json(g) or {}).get("polygons") or {}
        except Exception:                                     # noqa: BLE001
            return None
        rings = polys.get(city_adcode)
        if rings:
            return rings
    return None


def bbox_center(rings: list[list[float]]) -> dict:
    """外接框中心（扁平坐标串：`[lng, lat, lng, lat, …]`）。"""
    xs = [r[i] for r in rings for i in range(0, len(r), 2)]
    ys = [r[i] for r in rings for i in range(1, len(r), 2)]
    return {
        "lng": round((min(xs) + max(xs)) / 2, 4),
        "lat": round((min(ys) + max(ys)) / 2, 4),
    }


def is_self_placeholder(node: dict, city_adcode: str) -> bool:
    """腾讯给"不设区的市"塞的那个「自身」占位节点（`前 4 位 + 99`）。

    实测两种后缀：东莞 `441999`（`4419` + `99`）、海西 `632899`（`6328` + `99`）。
    它的 `name` 就是市名本身，**不是**一个真实的区 —— 所以它没有自己的边界，
    `getchildren` 也不会给它 `polygon`。
    """
    a = str(node.get("adcode") or "")
    return a[:4] == city_adcode[:4] and a[4:] in ("99", "9999")


def normalize_districts(
    city_adcode: str,
    city_name: str,
    children: list[dict],
    polygons: dict[str, list],
) -> tuple[list[dict], dict[str, list], str] | None:
    """把"这一层"整理成前端能画的样子。**无需改动时返回 `None`**。

    两步，都为真才动手：

    ① **剔除无面的「自身」占位** —— 海西 `632800` 有 7 个真区是有面的，却还挂着一个
       `632899`「海西蒙古族藏族自治州」的占位（无面）⇒ 那个徽标点下去只有镜头、没有面，
       且它在语义上也不是一个区。剔掉它，保留 7 个真区。
    ② **一个面都没有 ⇒ 折叠成「市自身」一个节点** —— 东莞/济源这类。面用市自己的轮廓。

    @return `(children, polygons, 说明)`。
    """
    if not children:
        return None

    # ① 剔占位：**只剔没有面的**（有面的说明腾讯给了真边界，那就留着 —— 宁可不改）
    kids = [
        c for c in children
        if not (is_self_placeholder(c, city_adcode)
                and str(c.get("adcode") or "") not in polygons)
    ]
    dropped = len(children) - len(kids)

    # ② 剩下的一个面都没有 ⇒ 折叠
    if not any(str(c.get("adcode") or "") in polygons for c in kids):
        rings = own_city_rings(city_adcode)
        if not rings:
            # 拿不到这个市自己的轮廓（如雄安 / 草湖：高德不认它们这个行政区划）
            # ⇒ 保留原样。至少 `center` 是好的，点徽标仍会取景。
            return None
        holder = next((c for c in children if is_self_placeholder(c, city_adcode)), None)
        center = holder["center"] if holder else bbox_center(rings)
        why = (
            f"沿用腾讯给的「{holder['name']}」占位中心" if holder
            else f"{len(kids)} 个下一级都无边界（首个是「{kids[0].get('name')}」）"
        )
        return ([{"adcode": city_adcode, "name": city_name, "center": center}],
                {city_adcode: rings}, why)

    # ③ 只剔了占位
    if dropped:
        return (kids, polygons, f"剔除 {dropped} 个无面的「自身」占位（不是真实的区）")
    return None
