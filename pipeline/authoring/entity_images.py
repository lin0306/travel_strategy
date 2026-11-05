"""
pipeline/authoring/entity_images.py —— 图源第二通道：**先对齐实体，再取实体自己的图**

为什么需要它（2026-10-31 全库审图之后）：
    Commons 关键词检索在本土小类点位上已经挖干了 —— 全库 2859 个点位取不到图，
    且**全部**带 `_noImage`（跑过、图源确实没有），不是漏跑。剩下的空间只有两类：
      ⓐ 名称搜不到（中文名不带地名词、或 Commons 文件名用英文/拼音）；
      ⓑ 名称能搜到，但搜出来的都是别的意思（同名异地、姓氏撞车）。

    实体对齐能同时解掉这两类：只要 Wikidata 有该对象的条目，`P18` 就是**这个对象**
    的照片（不是"搜到沾边"），`P373` 指向的 Commons 分类里也是这个对象的图库。

三条取图路径（按精确度排序，命中即停）：
    ① `P18`（image）—— 主图，语义最准，一张就够当封面
    ② zh.wikipedia 条目主图（pageimages）—— 条目用的图通常就是该对象
    ③ `P373`（Commons category）—— 分类的前几张；博物馆/寺庙这类分类里常有几十张，
       只是文件名不含中文名，关键词检索永远搜不到

✗ **不做 geosearch**（2026-10-31 实测否决）：
   按坐标 800m 抓附近照片，样本 24 个点位覆盖 33%（看着很高），但看图/看文件名后
   基本全错 —— 「余孃脆皮洋芋粑」（贵阳小吃）拿到贵阳站平面图与人民广场、
   「庐山高山土豆」拿到庐山电影院与基督教堂、「临江屯晨雾」拿到额尔古纳大酒店。
   它就是**"附近随便一张"**，正是用户明令禁止的那类垫图（见 images.py 的
   `USE_STOCK_SOURCES` 注释）。覆盖率不是判据，**这张图是不是这个地方**才是。

★ 429：匿名调 Wikimedia/Wikidata 会被限流，而且 `fetch.get_json` 的 3 次重试是在
  1 秒内打完 —— 全 429，异常被上层吞掉后表现为「一张图都没有」。所以这里自己控速
  （默认 1.1s 一次）并对 429 指数退避。探针首轮就栽在这上面（geo=0 的假象）。
"""

from __future__ import annotations

import json
import os
import threading
import time
import urllib.error
from typing import Any

from pipeline.authoring.images import (
    PHOTO_MIME,
    _image_item,
    _license_ok,
    _needs_attribution,
    _plain,
)
from pipeline.core.fetch import build_url, get_json

WIKIDATA_API = "https://www.wikidata.org/w/api.php"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
ZHWIKI_API = "https://zh.wikipedia.org/w/api.php"

#: 每次请求之间的最小间隔（秒）。可调 —— 入库跑全库时值得调快，但别低于 0.5。
THROTTLE = float(os.environ.get("WM_THROTTLE", "1.1"))

_last_request = 0.0
#: 预约时隙用的锁。★ 并发抓取时必须这样：锁内**只算时间点**，sleep 放到锁外。
#: 把 sleep 包在锁里 ⇒ 所有线程排队睡 1.1s ⇒ 并发退化回串行，白改。
_slot_lock = threading.Lock()

#: 本进程累计撞 429 的次数。
#: ★★ 为什么必须单独计（2026-11-01 凤凰城踩到）：`_api` 重试 4 次都撞 429 后返回 `None`，
#:    对调用方来说与"这个点位/这条查询确实没结果"**一字不差**。于是抓图会静默写成
#:    "候选 0"，整座城被误判成没有素材 —— 而真相只是短时间内请求打太密。
#:    实测：同一坐标单独测返回 10 张，紧接着 4 并发 grab 就全 0。
#:    调用方用 `hits_429()` 的**前后差值**判断"这段时间到底是被限流了，还是真没图"。
_HITS_429 = 0


def hits_429() -> int:
    """本进程累计撞 429 的次数。用前后差值判断一段抓取是否被限流。"""
    return _HITS_429


def throttle_slot() -> None:
    """向"发请求时隙"预约一格，然后在锁外等到自己的点。

    串行时等价于 `sleep(THROTTLE)`；并发 N 个线程时它们按 THROTTLE 间隔依次发出，
    RTT 互相重叠 —— 这是把 3 秒/请求的串行抓取提到接近 1.1 秒/请求的唯一办法
    （实测单请求 RTT 1.2-2.6s，串行时 RTT 与节流是相加的）。
    """
    global _last_request
    with _slot_lock:
        now = time.monotonic()
        wait = max(0.0, _last_request + THROTTLE - now)
        _last_request = now + wait
    if wait > 0:
        time.sleep(wait)


def _api(url: str, *, timeout: float = 20.0) -> Any:
    """带节流的 JSON GET。429 指数退避；其它异常直接返回 None（缺图是 WARN 不是 ERROR）。

    ★ 每次撞 429 都会累加 `_HITS_429`，供调用方区分"限流"与"真没结果" —— 见 `hits_429()`。
    """
    global _HITS_429
    for attempt in range(4):
        throttle_slot()
        try:
            return get_json(url, timeout=timeout, retries=1)
        except urllib.error.HTTPError as exc:
            if exc.code == 429:
                _HITS_429 += 1
                time.sleep(6 * (attempt + 1))
                continue
            return None
        except Exception as exc:                      # RuntimeError 里裹着 429 的情形
            if "429" in str(exc):
                _HITS_429 += 1
                time.sleep(6 * (attempt + 1))
                continue
            return None
    return None


def _candidate(page: dict, info: dict, *, query: str, source_url: str) -> dict | None:
    """Commons 文件页 → 统一图结构。许可/格式不过就返回 None。"""
    if info.get("mime") not in PHOTO_MIME:
        return None
    meta = info.get("extmetadata") or {}
    license_name = (meta.get("LicenseShortName") or {}).get("value", "")
    if not _license_ok(license_name):
        return None
    url = info.get("thumburl") or info.get("url")
    if not url:
        return None
    title = _plain(page.get("title", "")).removeprefix("File:").removeprefix("文件:")
    author = _plain((meta.get("Artist") or {}).get("value", "")) or "Wikimedia Commons 贡献者"
    return _image_item(
        url=url,
        thumb=info.get("thumburl") or info.get("url"),
        width=int(info.get("thumbwidth") or info.get("width") or 1080),
        height=int(info.get("thumbheight") or info.get("height") or 720),
        alt=title[:100] or f"{query}（Wikimedia Commons）",
        query=query,                                  # ★ 自愈关键字段，必须有
        source="wikimedia",
        author=author[:60],
        sourceUrl=(meta.get("Descriptionurl") or {}).get("value") or source_url,
        license=license_name or "见来源页",
        attribution_required=_needs_attribution(license_name),
        filter_meta={
            "gps": meta,
            "categories": " ".join(
                _plain(c.get("title", "")).removeprefix("Category:")
                for c in (page.get("categories") or [])
            ),
        },
    )


def _imageinfo(files: list[str], *, query: str, source_url: str) -> list[dict]:
    """批量取 imageinfo（一次请求最多 20 个标题，比逐个省得多）。"""
    out: list[dict] = []
    for i in range(0, len(files), 10):
        batch = files[i:i + 10]
        data = _api(build_url(COMMONS_API, {
            "action": "query", "format": "json",
            "titles": "|".join(batch),
            "prop": "imageinfo|categories", "cllimit": 100,
            "iiprop": "url|extmetadata|mime|size", "iiurlwidth": 1080,
        }))
        if not data:
            continue
        for page in ((data.get("query") or {}).get("pages") or {}).values():
            info = (page.get("imageinfo") or [{}])[0]
            cand = _candidate(page, info, query=query, source_url=source_url)
            if cand:
                out.append(cand)
    return out


def _find_entity(name: str) -> dict | None:
    """名称 → Wikidata 实体（label 必须与点位名互相包含，挡住「大观园」撞红楼梦）。"""
    data = _api(build_url(WIKIDATA_API, {
        "action": "wbsearchentities", "format": "json", "language": "zh",
        "uselang": "zh", "search": name, "limit": 5, "type": "item",
    }))
    if not data:
        return None
    for hit in data.get("search") or []:
        label = (hit.get("label") or "").strip()
        if not label or len(label) < 2:
            continue
        # ★ 只认「同一对象」：互相包含即可（「蓬莱阁」↔「蓬莱阁」、
        #   「太室山（峻极峰）」↔「太室山」）。要防的是「大观园」→「红楼梦」这种
        #   主题相关但对象不同的命中 —— 那种 label 与点位名不构成包含关系，直接跳过。
        if label in name or name in label:
            return {"id": hit["id"], "label": label}
    return None


def _entity_detail(qid: str) -> dict:
    data = _api(build_url(WIKIDATA_API, {
        "action": "wbgetentities", "format": "json", "ids": qid,
        "props": "claims|sitelinks|labels", "sitefilter": "zhwiki",
    }))
    ent = ((data or {}).get("entities") or {}).get(qid) or {}
    claims = ent.get("claims") or {}

    def _strings(prop: str) -> list[str]:
        out = []
        for c in claims.get(prop) or []:
            try:
                out.append(str(c["mainsnak"]["datavalue"]["value"]))
            except Exception:
                continue
        return out

    return {
        "p18": [f"File:{f}" for f in _strings("P18")],
        "category": next((c for c in _strings("P373")), ""),
        "en_label": ((ent.get("labels") or {}).get("en") or {}).get("value", ""),
        "zh_title": (((ent.get("sitelinks") or {}).get("zhwiki") or {}).get("title") or ""),
    }


def _pageimage(title: str, *, query: str) -> list[dict]:
    data = _api(build_url(ZHWIKI_API, {
        "action": "query", "format": "json", "titles": title, "redirects": 1,
        "prop": "pageimages", "piprop": "name|original",
    }))
    if not data:
        return []
    for page in ((data.get("query") or {}).get("pages") or {}).values():
        if page.get("missing") is not None:
            continue
        file_name = page.get("pageimage") or ((page.get("original") or {}).get("source") or "")
        if file_name.startswith("http"):
            file_name = file_name.rsplit("/", 1)[-1]
        if file_name:
            return _imageinfo([f"File:{file_name}"], query=query,
                              source_url=f"https://zh.wikipedia.org/wiki/{title}")
    return []


def _category_files(category: str, *, limit: int = 8) -> list[str]:
    data = _api(build_url(COMMONS_API, {
        "action": "query", "format": "json",
        "list": "categorymembers", "cmtitle": f"Category:{category}",
        "cmtype": "file", "cmlimit": limit,
    }))
    if not data:
        return []
    return [m["title"] for m in ((data.get("query") or {}).get("categorymembers") or [])
            if str(m.get("title", "")).startswith("File:")]


#: 坐标通道的默认半径（米）。★ POI 是 GCJ-02、Commons 的 GPS 是 WGS-84，
#: 同一地点两套坐标差 100-500 米，所以半径不能压到 200 —— 会漏掉真正拍到的那张。
GEO_RADIUS = 800


def geosearch_images(lat: float, lng: float, *, radius: int = GEO_RADIUS,
                     limit: int = 20) -> list[dict]:
    """按坐标抓「附近拍的照片」，**只作候选记录，绝不直接入库**。

    ★★ 为什么只作候选（2026-10-31 实测）：样本 24 个无图点位里 33% 能拿到图，
       但逐条看文件名/分类，几乎全是**隔壁的东西** ——
         「余孃脆皮洋芋粑」（贵阳小吃）→ 贵阳站平面图、人民广场
         「庐山高山土豆」→ 庐山电影院、基督教堂、美庐别墅
         「临江屯晨雾」→ 额尔古纳大酒店、331 国道
       它是"附近随便一张"，属于被明令禁止的垫图。**但**对「古镇/山/湖/街区」这类
       有大范围实体的点位，附近照片可能正是该景点 —— 所以不丢，交给逐张看图判定。

    带 `distance_m`（照片自带 GPS 时）—— 出对照表时要显示，看图的判断强依赖它：
    距离 30 米的是"就在这里拍的"，800 米的是"同一个街区"。
    """
    data = _api(build_url(COMMONS_API, {
        "action": "query", "format": "json",
        "generator": "geosearch", "ggscoord": f"{lat}|{lng}", "ggsradius": int(radius),
        "ggsnamespace": 6, "ggslimit": max(limit, 10),
        "prop": "imageinfo|categories", "cllimit": 200,
        "iiprop": "url|extmetadata|mime|size", "iiurlwidth": 1080,
    }))
    if not data:
        return []

    out: list[dict] = []
    for page in ((data.get("query") or {}).get("pages") or {}).values():
        info = (page.get("imageinfo") or [{}])[0]
        cand = _candidate(page, info, query="", source_url="https://commons.wikimedia.org/")
        if not cand:
            continue
        meta = (info.get("extmetadata") or {})
        gps = _gps(meta)
        cand["distance_m"] = _haversine(lat, lng, gps[1], gps[0]) if gps else None
        out.append(cand)
    out.sort(key=lambda c: (c["distance_m"] is None, c["distance_m"] or 0))
    return out[:limit]


def _gps(meta: dict) -> tuple[float, float] | None:
    """Commons extmetadata → (lng, lat)。缺坐标是常态，返回 None 不代表"坐标不对"。"""
    try:
        lng = float(str((meta.get("GPSLongitude") or {}).get("value")).strip())
        lat = float(str((meta.get("GPSLatitude") or {}).get("value")).strip())
    except (TypeError, ValueError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return None
    return lng, lat


def _haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> int:
    """两点距离（米）。粗略即可 —— 只用来给看图的人一个"近不近"的量级。"""
    from math import asin, cos, radians, sin, sqrt

    dlat, dlng = radians(lat2 - lat1), radians(lng2 - lng1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng / 2) ** 2
    return int(2 * 6371000 * asin(sqrt(a)))


def entity_images(poi_name: str, *, limit: int = 4) -> list[dict]:
    """实体对齐取图。取不到就返回 `[]`（调用方走占位卡，不垫图）。"""
    name = (poi_name or "").strip()
    if not name:
        return []
    ent = _find_entity(name)
    if not ent:
        return []
    detail = _entity_detail(ent["id"])

    out: list[dict] = []
    src = f"https://www.wikidata.org/wiki/{ent['id']}"
    if detail["p18"]:
        out += _imageinfo(detail["p18"][:limit], query=name, source_url=src)
    if not out and detail["zh_title"]:
        out += _pageimage(detail["zh_title"], query=name)
    if not out and detail["category"]:
        files = _category_files(detail["category"], limit=limit * 2)
        if files:
            out += _imageinfo(files, query=name, source_url=f"https://commons.wikimedia.org/wiki/Category:{detail['category']}")
    return out[:limit]


def _dump(obj: Any) -> str:                            # 调试用
    return json.dumps(obj, ensure_ascii=False, indent=2)
