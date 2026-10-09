"""
pipeline/providers/tmap.py —— 腾讯位置服务 WebService 封装

★ 本文件集中了 plans/07 与 plans/README 里记过的**全部踩坑点**，逐个写在调用处：

  ① **坐标是 lat,lng（纬度在前）** —— 与 GeoJSON 的 [lng,lat] 相反。
     写反了不报错，只是点位跑到地球另一边，是全项目最易静默出错的一处。
     所以本模块的入参统一规定为 **(lng, lat)** 元组（与数据文件一致），
     只在**拼 URL 的那一行**才转成腾讯要的 `lat,lng` —— 让转换集中在一处。
  ② **地理编码是一对一**（无批量），请求数 = POI 数（~46/城），靠缓存去重。
  ③ **距离矩阵 /ws/distance/v1/matrix** 按"计算次数"计费（from 数 × to 数），
     单侧上限 **25**（25×25=625 对/次）。三种方式（驾车/步行/骑行）**都支持批量**。
  ④ **duration 单位是秒**（路线规划接口是分钟，混用差 60 倍）。
  ⑤ **单个元素可能失败**：起终点 5km 内无路时 status=4，distance 退化为直线且不给 duration。
  ⑥ **缩放范围 3~20**（不是 2 也不是 22）—— 前端用，这里记一笔。
  ⑦ 腾讯 GL JS **无需 securityJsCode**；脚本侧用 WebService key，与前端 JSAPI key 分开。

key 走 `env.get_key()`：**禁止硬编码**（合规红线）。它会自动加载 `pipeline/.env.local`，
优先级为 TMAP_WEB_KEY → TMAP_KEY → VITE_TMAP_KEY（最后一把是前端 key，
仅当腾讯后台同时开通了 WebService 权限时可用）。缺 key 时主动抛出可读的错误，
而不是带着占位符发一堆必然失败的请求。
"""

from __future__ import annotations

import time
from typing import Any, Iterable, Sequence

from pipeline.core.env import MissingKeyError, get_key
from pipeline.core.fetch import build_url, count_usage, get_json, load_cache, save_cache

BASE = "https://apis.map.qq.com"

#: Cache 文件名
GEOCODE_CACHE = "geocode.json"
PLACE_CACHE = "place.json"

#: 矩阵单边上限（腾讯限制）：25 × 25 = 625 对/请求
MATRIX_CHUNK = 25

#: 各方式的直线距离适用上限（米）。0 = 不限。超过就不问接口，直接记"不适用"
MODE_MAX_STRAIGHT_METERS: dict[str, int] = {"driving": 0, "walking": 3000, "bicycling": 8000}

#: matrix 的 mode 取值（注意不是 TravelMode 的六种 —— 六种里打车复用 driving、公交地铁不预计算）
TMAP_MATRIX_MODES = ("driving", "walking", "bicycling")

#: 接口层限流码：120 = 每秒请求量达上限（**等待可恢复**）；121 = 日配额耗尽（等待无用）
RATE_LIMIT_STATUS = {120}
DAILY_QUOTA_STATUS = {121}

#: 120 的退避秒数。★ 实测：免费/复用 key 的矩阵限流窗口很长 ——
#:   退避 5/15/40s **全部无效**（连续 4 次都 120），拉到 30/60/120s 才可能放行。
#:   宁可慢，也别让失败请求白白吃掉配额（失败的那次同样计费）。
RATE_LIMIT_BACKOFF = (30, 60, 120)
MAX_RATE_LIMIT_RETRIES = len(RATE_LIMIT_BACKOFF)

#: ★★ 本次进程里「日配额耗尽」（121）有没有发生过 —— **按接口分别记**。
#: 为什么要单独记：121 是 **HTTP 200 + body 里的错误码**，而调用方看到的
#: 只有 `geocode()` 返回的 `None` —— 与"这个地址真的没命中"**完全无法区分**。
#: 不记下来，整座城会在配额尽之后继续把剩下的 POI 一个个判成"没命中"，
#: 白白标记一堆 `needs_geocode`。
#:
#: ★★ 为什么必须是**按接口**的集合，而不是一个全局 bool（2026-10-01 实测踩到）：
#:   腾讯的 `place_search` 与 `geocoder` 是**两个独立的额度桶** ——
#:   实测 place_search 只有 200/日，geocoder 有 10000/日。
#:   一个全局 bool 的话，place_search 一满就把**整家腾讯**判死，
#:   于是连"还剩九千多次、一分钱不花"的地址解析也被一起发配给高德 ——
#:   而**高德是按月重置的**（用掉一点就少一点，要等下个月）。
#:   ⇒ 判死的粒度必须是接口，不是图商。
_tmap_dead_apis: set[str] = set()

#: 参与"取点"的接口集合。`quota_exhausted()` 不传参时 = 这些**全都**死了
GEO_APIS = ("geocoder", "place_search")


def quota_exhausted(api: str | None = None) -> bool:
    """本次进程里腾讯有没有报过 121（日配额耗尽）。

    ★ **传接口名**做精确判断（`place_search` 满了不代表 `geocoder` 也满了）。
      不传参 = **取点用的两个接口全死** —— 用于"这家还能不能顶上"的整体判断。
    """
    if api:
        return api in _tmap_dead_apis
    return all(a in _tmap_dead_apis for a in GEO_APIS)


def dead_apis() -> set[str]:
    """本次进程里已判死的接口集合（诊断用，如 `run.py usage`）。"""
    return set(_tmap_dead_apis)


def _reset_quota_flag() -> None:
    """仅测试用：清掉配额标志。"""
    _tmap_dead_apis.clear()


def _note_quota(status: object, what: str, api: str = "") -> bool:
    """识别 121 并留下痕迹。**True = 日配额耗尽**（该换源，不是重试）。

    ★ `api` 必须传接口名（`geocoder` / `place_search`）—— 判死是按接口的，
      不传就退化成"整家腾讯都死"，那是上面那个坑的原样复现。
    """
    if status in DAILY_QUOTA_STATUS:
        _tmap_dead_apis.add(api)
        others = [a for a in GEO_APIS if a not in _tmap_dead_apis]
        # ★ 2026-10-08：措辞随「调用方是否强制路线」而变。
        #   判死发生在**请求发出去之后** —— 本模块这时**还不知道**上层
        #   `geoprovider` 有没有设 `GEO_PROVIDER=tencent`（那条路是"不换源"的）。
        #   旧文案一律说"后续改用高德"，在强制 tencent 时是**误导**
        #   （实测：设了 tencent，行为确实只打腾讯，提示却说改用高德）。
        #   ⇒ 这里改成中性的"该接口本轮不可用"，换源由 `geoprovider` 决定后自己讲。
        tail = f"；{'、'.join(others)}仍走腾讯" if others else ""
        print(f"  ⚠️ 腾讯{what}今日配额已耗尽（status={status}）"
              f"{tail}—— 该接口本轮不可用", flush=True)
        return True
    return False


#: key 的候选变量，按优先级。★ 前两个是"正经"的 WebService key。
#: `VITE_TMAP_KEY` 是前端 JSAPI key —— 只有当它在腾讯后台**同时开通了 WebService 权限**
#: 时才可用（很多人为省事申请时勾选了全部服务），所以放在最后兜底并打印提示。
WEB_KEY_VARS = ("TMAP_WEB_KEY", "TMAP_KEY", "VITE_TMAP_KEY")


def web_key() -> str:
    """取腾讯 WebService key。

    取不到或仍是 `.env.example` 里的占位值时抛错 ——
    **宁可停在这里告诉用户"去申请 key"，也不要发出必然失败的请求（还会白烧配额）。**
    """
    try:
        strict = get_key("TMAP_WEB_KEY", "TMAP_KEY")
    except MissingKeyError:
        # 前端 key 兜底：只有它真开通了 WebService 才走得通，跑第一个请求就会见分晓
        strict = get_key(
            "VITE_TMAP_KEY",
            hint="腾讯后台需同时开通「WebService API」权限；建议另建一把独立的 "
                 "WebService key 写进 TMAP_WEB_KEY（两者配额独立）。",
        )
        if not getattr(web_key, "_warned", False):
            print("  ⚠️ 未配置 TMAP_WEB_KEY，复用前端 VITE_TMAP_KEY —— 若腾讯后台未开通 "
                  "WebService 权限，下一步会直接报 status≠0")
            web_key._warned = True          # noqa: SLF001 —— 只提示一次，别刷屏
    return strict


Coord = tuple[float, float]      # ★ (lng, lat) —— 与数据文件里的 GeoPoint 顺序一致


def _to_tmap(points: Sequence[Coord]) -> str:
    """[(lng,lat), ...] → 腾讯要的 'lat,lng;lat,lng'。**全模块唯一一处坐标反转**。"""
    return ";".join(f"{lat:.6f},{lng:.6f}" for lng, lat in points)


# ── 地理编码（一对一，无批量）────────────────────────────────────

def geocode(address: str, *, region: str | None = None, use_cache: bool = True) -> dict | None:
    """地址/POI 名 → GCJ-02 坐标 + 区划信息。

    返回 None 表示**没命中**（调用方应把该 POI 标为 `needs_manual`，不入库）。
    命中时返回：
        { 'lng', 'lat', 'address', 'district', 'city', 'province', 'adcode', 'title' }

    ⚠️ `region` 必须显式传城市名：不传会做全国检索，容易命中同名异地 POI
       （"人民公园"全国都有）。
    """
    cache = load_cache(GEOCODE_CACHE)
    ck = f"{region or ''}|{address}"
    if use_cache and ck in cache:
        # ★ 缓存里用 False 表示"确认没命中"（避免重复计费），但对外只允许 dict | None。
        #   不归一化的话，重跑时 cache 里的 False 会被调用方当成 dict 用 → AttributeError。
        cached = cache[ck]
        return cached if isinstance(cached, dict) else None

    params: dict[str, Any] = {
        "address": address,
        "key": web_key(),
        "policy": 0,              # 0 = 允许附近 POI 召回，更易命中具体点位
    }
    if region:
        params["region"] = region

    data = get_json(build_url(f"{BASE}/ws/geocoder/v1/", params))
    count_usage("geocoder")

    _note_quota(data.get("status"), "地理编码", "geocoder")
    if data.get("status") != 0:
        result = None
    else:
        r = data["result"]
        loc = r.get("location") or {}
        comp = r.get("address_components") or {}
        ad = r.get("ad_info") or {}
        if not loc:
            result = None
        else:
            result = {
                # ⚠️ 腾讯返回 {lat, lng}，这里立刻转成我们统一的 (lng, lat)
                "lng": round(float(loc["lng"]), 6),
                "lat": round(float(loc["lat"]), 6),
                "title": r.get("title", ""),
                "address": r.get("address", ""),
                "province": comp.get("province", ""),
                "city": comp.get("city", ""),
                "district": comp.get("district", ""),
                "adcode": ad.get("adcode", ""),
                "city_code": ad.get("city_code", ""),
                "similarity": r.get("similarity"),
                "reliability": r.get("reliability"),
            }

    if use_cache:
        cache[ck] = result if result is not None else False      # False 缓存"确认没命中"，避免重复计费
        save_cache(GEOCODE_CACHE, cache)
    return result


# ── 地点检索（关键词搜索，可批量返回多条）────────────────────────

def place_search(
    keyword: str, *, region: str, page_size: int = 10, use_cache: bool = True
) -> list[dict]:
    """关键词搜地点 —— **店铺类 POI 的唯一解法**。

    为什么必须有它：`geocoder` 只能编码"有名有姓的门址/景区"，像「交通茶馆」
    「磁器口陈麻花」这类小店直接返回空；而 `/ws/place/v1/search` 能捞到。
    实测重庆 46 个 POI 里有 6 个是 geocode 注定失败、place search 一击命中的。

    ⚠️ 返回**多条**候选，且**第一条未必是想要的**（实测搜"磁器口陈麻花"首条命中的
    是九龙坡区分店）。所以调用方必须做名称 + 区县双重筛选，不许直接取 [0]。

    返回字段对齐 `geocode()`，便于调用方统一处理：
        { 'lng', 'lat', 'title', 'address', 'district', 'adcode', 'category' }
    """
    cache = load_cache(PLACE_CACHE)
    ck = f"{region}|{keyword}|{page_size}"
    if use_cache and ck in cache:
        cached = cache[ck]
        return cached if isinstance(cached, list) else []

    data = get_json(build_url(f"{BASE}/ws/place/v1/search", {
        "keyword": keyword,
        # boundary=region(name,0) —— 0 表示只在指定区域内检索，防止召回外省同名店
        "boundary": f"region({region},0)",
        "page_size": page_size,
        "key": web_key(),
    }))
    count_usage("place_search")

    _note_quota(data.get("status"), "地点搜索", "place_search")
    out: list[dict] = []
    for it in (data.get("data") or []) if data.get("status") == 0 else []:
        loc = it.get("location") or {}
        ad = it.get("ad_info") or {}
        if not loc:
            continue
        out.append({
            "lng": round(float(loc["lng"]), 6),
            "lat": round(float(loc["lat"]), 6),
            "title": it.get("title", ""),
            "address": it.get("address", ""),
            "province": ad.get("province", ""),
            "city": ad.get("city", ""),
            "district": ad.get("district", ""),
            # ⚠️ place API 的 adcode 是 int，而 geocoder 返回的是 str。
            #    两者混用会让人写出 `adcode[:4]` 这种不一致也能跑的代码，
            #    直到某天对着 int 切碎片 → TypeError。所以在封装边界统一转 str。
            "adcode": str(ad.get("adcode", "") or ""),
            "category": it.get("category", ""),
        })

    if use_cache:
        cache[ck] = out
        save_cache(PLACE_CACHE, cache)
    return out


# ── 距离矩阵（三种方式都支持批量，这是选腾讯的决定性理由）──────────

def _norm_element(el: dict) -> tuple[int, int] | None:
    """单个矩阵元素 → (distance米, duration秒)。

    ⚠️ status != 0 或没有 duration → None（落库为 '0000'）。
    例：步行超 5km 时腾讯退化为直线距离且**不返回 duration**；
    直接读会得到 KeyError/undefined 而不是明确报错。
    """
    if el.get("status") != 0:
        return None
    if "duration" not in el or "distance" not in el:
        return None
    try:
        return int(el["distance"]), int(el["duration"])
    except (TypeError, ValueError):
        return None


def matrix(
    origins: Sequence[Coord],
    dests: Sequence[Coord],
    mode: str,
) -> list[list[tuple[int, int] | None]]:
    """批量距离矩阵 → `rows[from][to]`。

    约束：len(origins) ≤ 25 且 len(dests) ≤ 25（腾讯上限 25×25=625 对/请求）。
    超了调用方必须自行分块（见 step6 的 CHUNK 循环）。

    ⚠️ 计费单位是**计算次数** = len(origins) × len(dests)，不是请求次数。
    """
    if mode not in TMAP_MATRIX_MODES:
        raise ValueError(f"矩阵不支持的 mode「{mode}」，合法值：{TMAP_MATRIX_MODES}")
    if len(origins) > MATRIX_CHUNK or len(dests) > MATRIX_CHUNK:
        raise ValueError(
            f"矩阵单侧超过 {MATRIX_CHUNK}：from={len(origins)} to={len(dests)} —— 调用方需先分块"
        )

    # ★ 限流退避：一次矩阵请求带 625 对计算，很容易撞上腾讯的 QPS 上限
    #   （status=120「此key每秒请求量已达到上限」）。它是 HTTP 200 + body 里的错误码，
    #   http 层的网络重试**不会**覆盖到 —— 必须在这里单独识别并等待重试。
    #   121 是"日调用量已达上限"，等待也没用，直接抛错让人明天再来。
    url = build_url(f"{BASE}/ws/distance/v1/matrix", {
        "mode": mode,
        "from": _to_tmap(origins),        # ★ lat,lng（纬度在前）
        "to": _to_tmap(dests),
        "key": web_key(),
    })
    units = len(origins) * len(dests)
    last_msg = ""
    for attempt in range(MAX_RATE_LIMIT_RETRIES + 1):
        data = get_json(url)
        count_usage("matrix", units)                     # ★ 按"计算次数"记账
        status = data.get("status")
        if status == 0:
            rows = data.get("result", {}).get("rows", [])
            return [[_norm_element(e) for e in row.get("elements", [])] for row in rows]

        last_msg = f"status={status} {data.get('message')}"
        if status in RATE_LIMIT_STATUS and attempt < MAX_RATE_LIMIT_RETRIES:
            wait = RATE_LIMIT_BACKOFF[attempt]
            print(f"  ⏳ 矩阵被限流（{last_msg}）—— {wait}s 后重试"
                  f"（{attempt + 1}/{MAX_RATE_LIMIT_RETRIES}）", flush=True)
            time.sleep(wait)
            continue
        break

    if status in DAILY_QUOTA_STATUS:
        raise RuntimeError(
            f"矩阵接口今日配额已耗尽（{last_msg}）—— 请明日再跑；"
            f"进度已逐块落盘，下次跑会自动断点续跑，不重复计费"
        )
    raise RuntimeError(f"距离矩阵请求失败（{mode}）：{last_msg}")


# ── 行政区划（★ 合规红线：边界唯一合法来源）────────────────────────

def district_list() -> dict:
    """全国三级区划列表。result[0] 是一级（省），result[1..] 按 cidx 切分下层。"""
    data = get_json(build_url(f"{BASE}/ws/district/v1/list", {"key": web_key()}))
    count_usage("district")
    if data.get("status") != 0:
        raise RuntimeError(f"区划列表失败：{data.get('message')}")
    return data


def _flatten_nodes(result: Any) -> list[dict]:
    """★ 区划接口的 `result` **不是**清一色的 dict 列表 —— 实测：

        · `/district/v1/list`      → [ 省数组, 市数组, 区数组 ]（元素是数组）
        · `/district/v1/getchildren` → [ [ 子级 dict, ... ] ]（**包了一层数组**）
        · `/district/v1/search`    → [ dict, ... ]（元素是对象）

      三种形状混在一起，调用方各自处理必然有人踩坑（且报错是
      `'list' object has no attribute 'get'`，看不出是数据形状问题）。
      统一在这里展平成 `list[dict]`，调用方只管遍历。
    """
    out: list[dict] = []
    for item in result or []:
        if isinstance(item, dict):
            out.append(item)
        elif isinstance(item, (list, tuple)):
            out.extend(x for x in item if isinstance(x, dict))
    return out


def district_children(adcode: str, *, polygon: bool = False) -> list[dict]:
    """取下辖区划。`get_polygon=1` 时**每个子级**带上自己的边界点串。

    🚨 实测语义（2026-09 核对，别再照抄文档）：

    | 项 | 事实 |
    |----|------|
    | `get_polygon=1/2` | **只返回"子级"的边界**，不含传入的 `id` 自身。1 与 2 返回值完全一致 |
    | `polygon` 形状 | `[环, 环, …]`，环是**扁平坐标串** `[lng, lat, lng, lat, …]`（不是点对象数组） |
    | 省级自身边界 | **拿不到**。`id=100000` 返回 0 个节点，`search` 任何参数都不带 polygon |
    | `max_offset` | 在该接口上**无效**（试到 10000，点数与体积一字不变） |

    所以"全国图的省界"只能交给腾讯矢量底图，别指望从这里拼出来。
    """
    params: dict[str, Any] = {"id": adcode, "key": web_key()}
    if polygon:
        params["get_polygon"] = 1
    data = get_json(build_url(f"{BASE}/ws/district/v1/getchildren", params))
    count_usage("district")
    if data.get("status") != 0:
        raise RuntimeError(f"取下级区划失败（{adcode}）：{data.get('message')}")
    return _flatten_nodes(data.get("result"))


def district_search(keyword: str) -> list[dict]:
    """关键词搜区划 —— **只用于"解析 adcode"，永远拿不到边界**。

    ⚠️ 这里曾经有个 `polygon: bool` 参数，它会给请求拼上 `get_polygon=1`。但实测
    `/district/v1/search` **根本不支持这个参数**：接口会安静地忽略它，返回体里
    连 `polygon` 字段都没有。调用方 `poly[0].get("polygon", [])` 于是拿到 `[]`，
    再把 34 个空数组写进缓存文件 —— 而缓存判定只看"文件是否存在"，于是空文件被
    当成有效缓存永久固化，地图上一条省界都没有，且**没有任何报错**。

    这类"参数被静默忽略"的坑，靠读文档或猜参数是发现不了的，只能实测返回体。
    """
    data = get_json(build_url(f"{BASE}/ws/district/v1/search", {"keyword": keyword, "key": web_key()}))
    count_usage("district")
    if data.get("status") != 0:
        return []
    return _flatten_nodes(data.get("result"))


def iter_chunks(n: int, chunk: int = MATRIX_CHUNK) -> Iterable[range]:
    """[0, n) 按 chunk 切块的索引块，给分块循环用。"""
    for start in range(0, n, chunk):
        yield range(start, min(start + chunk, n))
