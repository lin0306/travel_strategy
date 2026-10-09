#!/usr/bin/env python3
"""
pipeline/amap.py —— 高德 Web 服务

两个用途，各有一份说明：

| 用途 | 接口 | 为什么用它 |
|------|------|-----------|
| **省自身轮廓**（`district_boundary`） | `v3/config/district` | 腾讯**拿不到**省级自身的边界（实测，见下） |
| **景点取坐标**（`geocode` / `place_search`） | `v3/geocode/geo` · `v5/place/text` | 腾讯日配额耗尽（status 121）时的**降级通道** |

## ★ 点位降级：腾讯 → 高德

腾讯的日配额是**按接口**计的，且 `place_search` 与 `geocoder` 是两份额度 ——
`place_search` 打满（status 121，**静默返回 0 条**）时 `geocoder` 往往还能用。
两个都打满时，坐标就再也取不到了。高德是**另一家的另一份额度**，
且同为 GCJ-02（坐标零转换），所以是最好的降级目标。

路由不在本文件里做（本文件只提供"高德怎么调"），统一入口见 **`geoprovider.py`** ——
它按「腾讯优先、配额尽自动换高德」分发，`step3_geocode.py` 只认它。

## 为什么引入第二个图商（轮廓这块的理由）

腾讯拿不到"省自身"的轮廓，这是实测过的硬事实（见 `tmap.py`）：

    | 调用                                        | 结果                      |
    |---------------------------------------------|---------------------------|
    | `getchildren?id=510000&get_polygon=1`       | **21 个市的**轮廓（不含四川自身） |
    | `search?keyword=四川&get_polygon=1/2`       | 返回四川本身，**但永不带 polygon** |
    | `/district/v1/boundary`                     | 不存在                    |
    | `id=100000`（中国）                          | 0 个节点                  |
    | `max_offset=500…10000`                      | 点数与体积**一字不变**（无效） |

于是首页只能"用该省各市的轮廓拼出省界"，代价是**省内部还画着市界**（一张网）。
高德 `v3/config/district` 的 `extensions=all` 按官方文档是
「**只返回当前查询 district 的边界值，不返回子节点的边界值**」——
正好就是"自身轮廓"。

## 🚨 合规：为什么换高德**不破**红线

`plans/10-map-drilldown.md` §9 的红线是"**边界只能来自持牌图商/官方平台，绝不用第三方
GeoJSON**"。禁第三方的理由是版图表达（中国台湾 / 藏南 / 南海诸岛 / 阿克赛钦 常被画错，
违反《地图管理条例》）。高德是持牌图商，边界同样经过审图 ⇒ **换源不破红线**。
（§9.1 原话写的是"只能腾讯"，已同步改成"持牌图商/官方平台"。）

## ★ 坐标系：选高德而不是天地图的原因

高德 Web 服务返回 **GCJ-02**，与腾讯底图、腾讯 District、我们的 POI **全部同系**
⇒ 拿来的坐标**直接用，不做任何转换**。

天地图是 **CGCS2000（≈WGS-84）**，要 WGS84→GCJ02，偏移量级 **50~500m**：在 `z≈4~6`
（省这一档）是亚像素、看不出来，但在 `z=12`（区/点位档）就是 10px 以上、一眼假。
所以"换源"只在**省**这一级成立 —— 市/区/点位继续用腾讯，同级同源同坐标系。
"""

from __future__ import annotations

from typing import Any

from pipeline.core.env import MissingKeyError, get_key, load_env
from pipeline.core.fetch import build_url, count_usage, get_json, load_cache, save_cache
from pipeline.core.layout import PIPELINE

#: 行政区划查询。`extensions=all` 才是"带边界"，默认 `base` 没有坐标。
BASE = "https://restapi.amap.com/v3/config/district"

#: 取 key 的候选变量名（按序）。★ 必须是「Web服务」类型的 key，
#: 不是 JS API 的 key —— 后者调不了这个接口（会返回 INVALID_USER_KEY）。
KEY_VARS = ("AMAP_WEB_KEY", "AMAP_KEY", "VITE_AMAP_KEY")

#: 配额/权限类 infocode（不是参数错，重试也没用）。官方 infocode 表：
#: 10001 无效 key · 10003 日访问量已超限 · 10009 请求 key 与绑定平台不符 ·
#: 10044 个人开发者日调用量超限 · 10019/10020/10021 配额类
QUOTA_INFOCDES = {"10003", "10019", "10020", "10021", "10044"}


def web_key() -> str:
    """取高德 Web 服务 key。取不到就抛错 —— 不拿占位符去发必然失败的请求。"""
    return get_key(
        *KEY_VARS,
        hint="申请：https://lbs.amap.com/ → 控制台 → 应用管理 → 创建应用 → 添加 Key → "
        "服务平台选「Web服务」（★ 不是「Web端(JS API)」）",
    )


def key_status() -> list[tuple[str, str]]:
    """诊断用：候选变量各自是什么状态（**不打印 key 本身**）。"""
    from pipeline.core.env import key_status as _status

    return _status(*KEY_VARS)


def parse_polyline(polyline: str) -> list[list[float]]:
    """把高德的 `polyline` 字符串解成**与腾讯同形**的环列表。

    格式（官方文档）：一个行政区由多块不相连的地块组成时，每块的坐标串用 `|` 分隔；
    块内每个点用 `;` 分隔；点的经度与纬度用 `,` 分隔。

        "116.1,39.1;116.2,39.2|117.1,38.1;117.2,38.2"
        → [[116.1,39.1, 116.2,39.2], [117.1,38.1, 117.2,38.2]]   ← 扁平串，步长 2

    ★ 输出刻意做成**扁平 `number[]`**（`[lng,lat,lng,lat,…]`），与腾讯 District 的
      `polygon` 字段、`data/_generated/districts/*.geo.json` 完全一致 ——
      前端 `data.ts` / `districtLayer` 才能零改动地吃下它。
      两边形状若不一致，前端会抛 `ring.filter is not a function` 或解出
      `LatLng(undefined, undefined)`，而且不报坐标问题。
    """
    rings: list[list[float]] = []
    for block in (polyline or "").split("|"):
        flat: list[float] = []
        for pair in block.split(";"):
            pair = pair.strip()
            if not pair:
                continue
            parts = pair.split(",")
            if len(parts) < 2:
                continue
            flat.extend([float(parts[0]), float(parts[1])])
        # ★ 首尾重复点丢掉：腾讯那边的环是**开口**的（闭合交给前端），留着只是白白多传一个点
        if len(flat) >= 4 and flat[0] == flat[-2] and flat[1] == flat[-1]:
            flat = flat[:-2]
        # 少于 3 个点连不成面，留着只会让 SDK 报「paths 属性无效」
        if len(flat) >= 6:
            rings.append(flat)
    return rings


def district_boundary(adcode: str, *, name: str = "") -> dict[str, Any]:
    """取**某个行政区自身**的轮廓（不是它的下级）。

    @param adcode 行政区划代码，如 `'510000'`（四川省）、`'110000'`（北京市）
    @return `{adcode, name, level, rings, center}`；`rings` 是扁平串列表（见 `parse_polyline`）

    ★ 用 **adcode** 而不是中文名查：`keywords` 只支持单个关键词且中文名是**模糊匹配**
      （"朝阳区"全国有两个，"城关区"满地都是），拿名字查会静默拿到别的行政区。
    """
    url = build_url(
        BASE,
        {
            "key": web_key(),
            "keywords": adcode,
            # 0 = 不返回下级行政区。★ 我们只要它"自己"这一块
            "subdistrict": 0,
            # all = 返回边界坐标点（文档原话：只返回当前查询 district 的边界值）
            "extensions": "all",
            "output": "JSON",
        },
    )
    data = get_json(url)  # ★ 自带按 host 节流 + 指数退避
    # ★ 记账：高德是**月配额**，而这一步（区/市/省自身轮廓）一次会发几百上千个请求
    #   —— 不记账就等于"用掉多少完全不知道"。桶名与 `AMAP_MONTHLY_QUOTA` 里那一条对齐。
    count_usage("amap_district")

    if not isinstance(data, dict):
        raise RuntimeError(f"高德区划接口返回了非对象：{type(data).__name__}")
    if str(data.get("status")) != "1":
        info = data.get("info") or "未知错误"
        code = str(data.get("infocode") or "")
        if code in QUOTA_INFOCDES:
            raise RuntimeError(
                f"高德区划今日额度/权限受限：{info}（infocode={code}）—— "
                f"明日再跑；已落盘的分片不会重复抓（见 step9 的缓存判断）"
            )
        raise RuntimeError(f"高德区划请求失败：{info}（infocode={code}）")

    districts = data.get("districts") or []
    if not districts:
        raise RuntimeError(f"高德没返回 {adcode} 的任何区划（可能不支持该行政区）")
    d = districts[0]

    got = str(d.get("adcode") or "")
    if got and got != str(adcode):
        # ★ 拿 adcode 查却换了个对象回来 = 查询被"模糊匹配"带偏了。宁可失败也不要写错数据。
        raise RuntimeError(f"拿 {adcode} 查却返回了 {got}（{d.get('name')}）—— 查询被模糊匹配带偏，已中止")

    rings = parse_polyline(d.get("polyline") or "")
    return {
        "adcode": str(adcode),
        "name": name or str(d.get("name") or ""),
        "level": str(d.get("level") or ""),
        "center": d.get("center"),
        "rings": rings,
    }


# ─────────────────────────────────────────────────────────────────
# 点位取坐标（腾讯配额耗尽时的降级通道）
# ─────────────────────────────────────────────────────────────────

#: 地理编码（地址/地名 → 坐标）
GEOCODE_URL = "https://restapi.amap.com/v3/geocode/geo"

#: 关键字搜索。**★ 必须用 v5**：v3 的 `pois[].adcode` 恒为 `None`（实测），
#: 而 `step3_geocode._same_city()` 判"是不是落在目标城市"**只认 adcode** ——
#: 用 v3 的话每条候选都会因为 adcode 为空被判成异地同名，高德降级等于白接。
PLACE_URL = "https://restapi.amap.com/v5/place/text"

#: v3 关键字搜索。**★ 专供入口坐标（entr_location）**：v5 的 `place/text` 即便带
#: `extensions=all` 也**不返回** `entr_location` 字段（实测，POI 对象里压根没有这个 key）；
#: 而 v3 的 `place/text` + `extensions=all` 会带 `entr_location` 与 `exit_location`。
#: 取入口不需要 adcode（我们靠名称判据 + 距离护栏），所以 v3 的"adcode 恒空"在这里无害。
PLACE_URL_V3 = "https://restapi.amap.com/v3/place/text"

#: 缓存文件名（★ 与腾讯分开存：两家召回质量不同，混在一个缓存里会让
#: "腾讯没命中"的假阴性永久挡住高德的重查）
GEOCODE_CACHE = "amap_geocode.json"
PLACE_CACHE = "amap_place.json"

#: 入口坐标（entr_location）缓存：与上面两家**再分开** —— 这是第三类用途，
#: 跑全量时一次几千次调用，混在 geocode/place 缓存里会让"没查过入口"的
#: 点被已存在的 place 缓存假阳性挡住。
ENTRANCE_CACHE = "amap_entrance.json"

#: 配额/权限类 infocode（不是参数错，重试也没用）。见上面的 QUOTA_INFOCDES
#: ★★ 与腾讯一样按**接口**分别记（见 `tmap._tmap_dead_apis` 那条注释）：
#:   高德是**月配额**，比腾讯的日配额稀缺得多，更经不起"一家判死"。
_amap_dead_apis: set[str] = set()

#: 参与"取点"的接口集合。`quota_exhausted()` 不传参时 = 这些**全都**死了
GEO_APIS = ("amap_geocode", "amap_place")


def quota_exhausted(api: str | None = None) -> bool:
    """本次进程里高德有没有报过「额度/权限受限」。给路由层判断是否该放弃。

    ★ 传接口名做精确判断；不传参 = 取点用的两个接口全死。
    """
    if api:
        return api in _amap_dead_apis
    return all(a in _amap_dead_apis for a in GEO_APIS)


def dead_apis() -> set[str]:
    """本次进程里已判死的高德接口集合（诊断用）。"""
    return set(_amap_dead_apis)


def _reset_quota_flag() -> None:
    """仅测试用：清掉配额标志。"""
    _amap_dead_apis.clear()


#: 接口响应的三种结局（**不用 bool**：bool 分不清"额度没了"和"这次没查到"，
#:   而两者该做的下一件事完全不同 —— 前者换源，后者只是这一个点没命中）
OK, QUOTA, EMPTY = "ok", "quota", "empty"


def _check_response(data: dict, what: str, api: str = "") -> str:
    """判高德的响应。**返回 `OK` / `QUOTA` / `EMPTY`**。

    ★ `api` 传接口名（`amap_geocode` / `amap_place`）—— 判死是按接口的。
      高德按月重置，把"某接口受限"当成"整家挂了"会白白浪费剩余的那个接口。

    ★ 高德的失败**不在 HTTP 层**：永远是 200 + `status="0"` + `infocode`。
      所以必须在这里读 infocode，不能靠 `fetch` 的重试（那只会白等 7 秒）。

    ★★ 为什么非配额错误**不抛异常**（曾经是 `_check_quota` 里 raise）：
      `step3_geocode` 一次要跑一整城 57 个 POI，其中总有几个查不到
      （生僻店名、写法特殊）。抛异常会让**整城在第 N 个中断**，
      前面的进度白跑；而腾讯侧同样情况是退化成 `None` → 该点标
      `needs_geocode` 继续跑下一个。两家行为必须一致，否则换源之后
      "换了个图商反而更容易整城崩"—— 那是更糟的静默回退。
      所以：非配额错误 = 这一个点没命中（打印一次），不是致命错。
    """
    if str(data.get("status")) == "1":
        return OK
    code = str(data.get("infocode") or "")
    info = data.get("info") or "未知错误"
    if code in QUOTA_INFOCDES:
        _amap_dead_apis.add(api)
        print(f"  ⚠️ 高德{what}额度/权限受限：{info}（infocode={code}）—— "
              f"该接口停用，另一个接口不受影响（高德按月重置，省着用）", flush=True)
        return QUOTA
    print(f"  · 高德{what}未返回数据：{info}（infocode={code}）—— 这一个点当没命中，继续跑",
          flush=True)
    return EMPTY


def _split_loc(s: str) -> tuple[float, float] | None:
    """★ 高德的 `location` 是 **"lng,lat"（经度在前）** —— 与腾讯的 `lat,lng` **相反**。

    写反了不报错，只是点跑到地球另一边（哈尔滨 126E,45N 反过来成 45E,126N，
    落在北冰洋里）。这是两家混用时**最容易静默出错的一处**，所以单独封一个函数，
    全模块只此一处解析高德坐标串。
    """
    parts = (s or "").split(",")
    if len(parts) < 2:
        return None
    try:
        return round(float(parts[0]), 6), round(float(parts[1]), 6)
    except ValueError:
        return None


def geocode(address: str, *, region: str | None = None, use_cache: bool = True) -> dict | None:
    """地址/地名 → GCJ-02 坐标 + 区划信息。**返回结构与 `tmap.geocode()` 严格对齐**。

    对齐的目的是让 `step3_geocode.py` 换源时零改动 —— 字段少一个或多一个，
    调用方要么 KeyError，要么静默拿到 None 而判据失效。
    返回：`{'lng','lat','title','address','province','city','district','adcode','level'}`

    ⚠️ `title` 用的是 `formatted_address`（高德没有腾讯那种"命中点名"字段）。
       这是**刻意**的：对小店 POI，高德返回的是门址而不含店名，
       于是 `step3` 的名称判据会判它"对不上" → 自动掉到 `place_search`
       去找真正的门店 —— 与腾讯的行为一致，不需要为高德改判据。
    """
    cache = load_cache(GEOCODE_CACHE)
    ck = f"{region or ''}|{address}"
    if use_cache and ck in cache:
        cached = cache[ck]
        return cached if isinstance(cached, dict) else None

    data = get_json(build_url(GEOCODE_URL, {
        "key": web_key(),
        "address": address,
        # ★ 限定城市：不限的话"人民公园"会命中全国任何一个同名点
        "city": region,
    }))
    count_usage("amap_geocode")

    result = None
    if _check_response(data, "地理编码", "amap_geocode") == OK:
        codes = data.get("geocodes") or []
        if codes:
            g = codes[0]
            loc = _split_loc(g.get("location") or "")
            if loc:
                result = {
                    "lng": loc[0],
                    "lat": loc[1],
                    "title": g.get("formatted_address", ""),
                    "address": g.get("formatted_address", ""),
                    "province": g.get("province", ""),
                    "city": g.get("city", ""),
                    "district": g.get("district", ""),
                    "adcode": str(g.get("adcode", "") or ""),
                    # 高德独有：命中精度（"兴趣点"/"道路"/"村庄"…），人工核存疑时有用
                    "level": g.get("level", ""),
                }

    if use_cache:
        cache[ck] = result if result is not None else False     # False = 确认没命中，别重复计费
        save_cache(GEOCODE_CACHE, cache)
    return result


def place_search(
    keyword: str, *, region: str, page_size: int = 10, use_cache: bool = True
) -> list[dict]:
    """关键字搜地点 —— 店铺类 POI 的解法。**返回结构与 `tmap.place_search()` 对齐**。

    ⚠️ 与腾讯一样：**第一条未必是想要的那家**（实测「老厨家」首条是友谊路总店，
       而数据在意的可能是中央大街店）。调用方必须做名称 + 区县双重筛选。
    ⚠️ `citylimit=true` 必传：不传会召回外省同名店。
    """
    cache = load_cache(PLACE_CACHE)
    ck = f"{region}|{keyword}|{page_size}"
    if use_cache and ck in cache:
        cached = cache[ck]
        return cached if isinstance(cached, list) else []

    data = get_json(build_url(PLACE_URL, {
        "key": web_key(),
        "keywords": keyword,
        "city": region,
        "citylimit": "true",                    # ★ 锁死在目标城市内
        "offset": min(int(page_size), 25),      # v5 单页上限 25
        "page": 1,
    }))
    count_usage("amap_place")

    out: list[dict] = []
    if _check_response(data, "地点搜索", "amap_place") == OK:
        for p in data.get("pois") or []:
            loc = _split_loc(p.get("location") or "")
            if not loc:
                continue
            out.append({
                "lng": loc[0],
                "lat": loc[1],
                "title": p.get("name", ""),
                "address": p.get("address", ""),
                "province": p.get("pname", ""),
                "city": p.get("cityname", ""),
                "district": p.get("adname", ""),
                "adcode": str(p.get("adcode", "") or ""),
                "category": p.get("type", ""),
            })

    if use_cache:
        cache[ck] = out
        save_cache(PLACE_CACHE, cache)
    return out


def poi_entrance(
    name: str, *, region: str, use_cache: bool = True
) -> dict | None:
    """取 POI 的高德**入口坐标**（`entr_location`）。

    ★ 用途：「到达点」优化 —— 把行程规划里的落点从园区**中心**挪到**入口**，
      避免路线穿园（用户原话：景点应有出入口，现在规划直接到对应点位，一般只到园区入口）。

    ★★ 必须带 `extensions=all` 且**走 v3**：高德 `v5/place/text` 即便带 `extensions=all`
      也**不返回** `entr_location` 字段（实测，POI 对象里压根没有这个 key）；
      而 `v3/place/text` + `extensions=all` 才会带「POI 的入口经纬度」
      （官方文档原话："也可用作于 POI 的到达点"）。所以这里用 `PLACE_URL_V3`。

    ★ 坐标仍是 GCJ-02、仍是 `"lng,lat"` 格式 —— 复用 `_split_loc()`，与 `place_search` 同口径。
      写回 `data/.../location.entrance` 后，**不做任何坐标转换**，前端展示/规划都直接吃。

    ★ `citylimit=true` 必传：不传会召回外省同名点（与 `place_search` 同样理由）。

    @return `{'lng','lat'}` 或 None（没命中 / 该 POI 没有入口字段）。
            配额受限时返回 None 并在模块级把 `"amap_entrance"` 标死，
            调用方（step3b）用 `quota_exhausted("amap_entrance")` 判断是否整批中止。
            ★★ 故意**不**在这里用 near 点做距离校验：阈值（>300m 才用入口）属于
            消费口径，写在 Web 的 `arrivalOf` 与 Python 的 `arrival_of`，保持单一真相源。
    """
    cache = load_cache(ENTRANCE_CACHE)
    ck = f"{region}|{name}"
    if use_cache and ck in cache:
        cached = cache[ck]
        return cached if isinstance(cached, dict) else None

    data = get_json(build_url(PLACE_URL_V3, {
        "key": web_key(),
        "keywords": name,
        "city": region,
        "citylimit": "true",                    # ★ 锁死在目标城市内
        "extensions": "all",                    # ★★ 关键：v3 带这个才有 entr_location
        "offset": 10,
        "page": 1,
    }))
    count_usage("amap_entrance")

    result = None
    if _check_response(data, "入口坐标", "amap_entrance") == OK:
        for p in data.get("pois") or []:
            entr = _split_loc(p.get("entr_location") or "")
            if entr:
                result = {"lng": entr[0], "lat": entr[1], "name": p.get("name", "")}
                break

    if use_cache:
        cache[ck] = result if result is not None else False     # False = 确认没入口，别重复计费
        save_cache(ENTRANCE_CACHE, cache)
    return result


#: 给"缺 key"时打印的提示（脚本入口用）
def missing_key_hint() -> str:
    load_env()
    state = ", ".join(f"{k}={v}" for k, v in key_status())
    # ⚠️ 别在 f-string 里嵌同种引号：本机 `build` 走的是系统 python 3.11，
    #    嵌套引号（PEP 701）要 3.12+ 才合法，会直接 SyntaxError。
    where = PIPELINE / '.env.local'
    return (
        f"未取到高德 Web 服务 key（候选：{state}）。\n"
        f"  请到 https://lbs.amap.com/ 申请「Web服务」类型的 Key，\n"
        f"  写进 {where}：AMAP_WEB_KEY=<你的 key>（采集侧配置统一放那儿；\n"
        f"  .gitignore 已忽略，不会进仓库）。"
    )


__all__ = [
    "MissingKeyError",
    "district_boundary",
    "geocode",
    "key_status",
    "missing_key_hint",
    "parse_polyline",
    "place_search",
    "poi_entrance",
    "quota_exhausted",
    "web_key",
]
