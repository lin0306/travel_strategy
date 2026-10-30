"""
pipeline/authoring/image_filter.py —— 候选图的**相关性过滤**（2026-10-29 新增）

## 这条为什么要单独一个模块

用户 2026-10-28 指着西安青龙寺的详情页说「和青龙寺没有任何关系」。查下来三张图是：

    ① Qinglong Temple, Xi'an (Aug 3, 2023).jpg     ← 对街拍的路景
    ② 西安地铁青龙寺站.jpg                           ← **地铁站**
    ③ 西安青龙寺-世界和平祈念塔.jpg                   ← 唯一对的

Wikimedia 的 `generator=search` 是**按文字相关度**返回的，地铁站文件的标题里恰好
同时有「青龙寺」和「西安」，于是排在前面 —— 采集侧原样收下前三条，中间**没有任何**
"这张图是不是这个地方"的判断。这就是那三张图的来历。

## 过滤能做多少（诚实边界）

文字/元数据过滤只拦得掉**说得明白的错**：
  · 地铁站 / 车站 / 线路图 / 地图 → 标题 + Commons **分类**一票否决（② 号图就是这关）
  · 坐标离点位 10km 以上 → 否决（同名异地的典型特征）
  · 标题含点位核心名 → 优先
拦不掉的是"标题完全对、画面是别的东西"（① 号图）。那一类**只能看图**，
由 `tools/review_images.py` + 人工/视觉复核处理（结果写回 `images[].review`）。

★ 所以本模块输出的是 `verdict`，不是"最终真相"：
    reject  = 明确错，不许入库
    suspect = 说不清，**留着但降级**（排在后面，别当封面）
    ok      = 元数据这一层过了
"""

from __future__ import annotations

import math
import re
from typing import Any

#: ★★ 一票否决词。分三组，别混在一起写：
#:   ① 交通设施（地铁站 / 机场 / 火车站）—— 青龙寺那张就是它
#:   ② 图表类（地图 / 线路图 / 平面图）—— 不是照片
#:   ③ 标识类（路牌 / 站牌 / 指示牌）—— 图里有字≠图里是这个地方
#:
#: ★ CJK 用子串即可（`地铁` 不会误伤别的词）；拉丁词必须加 `\b`，
#:   否则 `map` 会砍掉 `mapping`，`sign` 会砍掉 `design`。
BAD_CJK = (
    "地铁", "車站", "车站", "火车站", "高铁", "机场", "航站楼", "收费站", "服务区",
    "线路图", "路線圖", "地图", "地圖", "導覽圖", "导览图", "平面图", "示意图",
    "站牌", "路牌", "指示牌", "门牌", "招牌",
)
BAD_LATIN = re.compile(
    r"\b(metro|subway|station|railway|airport|terminal|toll|map|diagram|"
    r"sign|signage|signboard|billboard|blueprint|floorplan|logotype)\b",
    re.I,
)

#: ★★ 曾经给"老街类点位"留过例外（STREET_SUBTYPES），2026-10-29 审查时抓到它放走了
#:   真错图：洒金桥（historic）的封面是「Artwork of SAJINQIAO Station, Xi'an Metro」——
#:   地铁站艺术墙。**黑名单没有例外**：`station/metro` 对任何点位都是噪声，
#:   "老街"这个词根本不在 BAD_LATIN 里，不需要豁免。别再把豁免加回来。

#: Commons 分类里的噪声。分类是**人工维护**的，比标题可靠得多 ——
#:   地铁站照片标题可能只写「青龙寺」，但分类一定是 "Xi'an Metro stations"。
BAD_CATEGORY = re.compile(
    r"(metro|subway|station|railway|airport)\s*(stations?|lines?|maps?)?|"
    r"maps?\s+of|diagrams|logos?|signage",
    re.I,
)

#: 坐标门限（米）。★ Commons 的 GPS 是 **WGS-84**，点位坐标是 **GCJ-02**，
#:   两者在中国境内差 300~800m —— 所以"近"的阈值给到 2km，不放 500m。
NEAR_M = 2000
FAR_M = 10000

_CJK = re.compile(r"[\u3400-\u9fff\uf900-\ufaff]")
_CORE = re.compile(r"[（(\[【]")


def core_name(name: str) -> str:
    """「松鹤楼(观前街店)」→「松鹤楼」。与 `images._core_name` 同口径，这里独立一份
    是为了让过滤模块不反向依赖采集模块。"""
    return _CORE.split(name or "", 1)[0].strip() or (name or "").strip()


def _haversine(lng1: float, lat1: float, lng2: float, lat2: float) -> float:
    """两点大圆距离（米）。"""
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def poi_point(poi: dict) -> tuple[float, float] | None:
    """点位坐标（GCJ-02）。没有坐标就没有距离判据 —— 不报错，只是这一条判据缺席。"""
    pt = ((poi.get("location") or {}).get("point") or {})
    lng, lat = pt.get("lng"), pt.get("lat")
    if not isinstance(lng, (int, float)) or not isinstance(lat, (int, float)):
        return None
    return float(lng), float(lat)


def gps_of(meta: dict[str, Any]) -> tuple[float, float] | None:
    """从 Commons 的 extmetadata 里取 GPS。

    ★ 缺坐标是**常态**（多数照片不带定位）⇒ 取不到返回 None，调用方不得据此否决，
      只当作"这一条判据缺席"。**别把"没有坐标"当成"坐标不对"** ——
      那是把沉默误读成否定，正好是这个项目反复踩的坑（见 `infocode 121`）。
    """
    def num(key: str) -> float | None:
        v = (meta.get(key) or {}).get("value")
        try:
            return float(str(v).strip())
        except (TypeError, ValueError):
            return None

    lat, lng = num("GPSLatitude"), num("GPSLongitude")
    if lat is None or lng is None:
        return None
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return None
    return lng, lat


def verdict_for(
    candidate: dict, poi: dict, *, city: str = "", categories: str = ""
) -> tuple[str, str, int]:
    """判一张候选图。返回 `(verdict, reason, score)`，score 越大越像"就是这里"。

    ★★ 返回 `suspect` 而不是一律 `reject`：宁可降级也别丢图 ——
       本地小店本来就没几张图，一刀切会把它们全打到占位卡。
    """
    # ★ GPS 与分类是**每张图自己**的（不是 POI 的）—— 从候选图带的 `_filterMeta` 取。
    #   图源没给（Pexels / Unsplash 就没有这两项）时当作"判据缺席"，不否决。
    meta = candidate.get("_filterMeta") or {}
    categories = categories or str(meta.get("categories") or "")

    title = str(candidate.get("alt") or "")
    query = str(candidate.get("query") or "")
    text = f"{title} {categories}"
    name = str(poi.get("name") or "")
    core = core_name(name)

    # ── ① 一票否决：交通设施 / 图表 / 标识（★ 无例外，见 STREET_SUBTYPES 的教训）──
    for w in BAD_CJK:
        if w in text:
            return "reject", f"命中否决词「{w}」", 0
    m = BAD_LATIN.search(text)
    if m:
        return "reject", f"命中否决词「{m.group(1)}」", 0
    if BAD_CATEGORY.search(categories):
        return "reject", "分类属于交通设施/地图/标识", 0

    score = 0
    reasons: list[str] = []

    # ── ② 标题命中点位名（最强信号）──
    if core and core in title:
        score += 3
        reasons.append("标题含点位名")
    elif name and name in title:
        score += 2
        reasons.append("标题含全名")

    # ── ③ 坐标距离 ──
    poi_pt = poi_point(poi)
    gps = gps_of(meta.get("gps") or {})
    if poi_pt and gps:
        d = _haversine(poi_pt[0], poi_pt[1], gps[0], gps[1])
        if d > FAR_M:
            return "reject", f"坐标距点位 {d / 1000:.1f}km", 0
        if d <= NEAR_M:
            score += 3
            reasons.append(f"坐标 {d / 1000:.1f}km")
        else:
            score -= 1
            reasons.append(f"坐标偏 {d / 1000:.1f}km")

    # ── ④ 城市名在场（同名异地的反向证据）──
    if city and (city in text or city in query):
        score += 1

    # ── ⑤ 元数据层完全无信号 → 降级，别当封面 ──
    if score <= 0:
        return "suspect", "元数据无正面信号（标题/坐标都没对上）", score
    return "ok", "；".join(reasons) or "元数据通过", score


def sort_key(score: int, order: int) -> tuple[int, int]:
    """排序键：`score` 高的在前，`order` 是图源给的原始顺序（稳住同分次序）。"""
    return (-score, order)


def is_cjk(s: str) -> bool:
    return bool(_CJK.search(s or ""))
