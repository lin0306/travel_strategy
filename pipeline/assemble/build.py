#!/usr/bin/env python3
"""
pipeline/assemble/build.py —— 组装 · 校验 · 生成派生产物

三件事：
  ① **组装**：把 `city.json` + `pois/{category}/*.json` + `transit.json` 合成一份完整 City
  ② **校验**：跑 Pydantic（`shared/schema.py`）+ 04 文档第八节的溯源/不变式红线
  ③ **生成**：`cities.index.json`（首页索引）+ `credits/{省}/{市}.md`（人工 review 用）

★ 为什么要一个 build 步骤，而不是让前端自己拼：
  分片的目的是让**人改起来舒服**（一个点位一个文件、PR diff 干净）；
  校验的目的是让**脏数据进不了站点**。这两件事都不该在运行时做 ——
  运行时只该消费已验证过的数据。

用法：
    python pipeline/run.py build              # 组装全部城市 + 生成索引（默认）
    python pipeline/run.py build --strict     # CI 模式：任一告警也算失败
    python pipeline/run.py build --city chengdu
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

if __package__ in (None, ""):
    # ★ 本文件在 pipeline/assemble/，往上两级才是仓库根（见 core/layout.py 同处陷阱）
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pipeline.core.layout import (                # noqa: E402
    CATEGORY_DIRS, CITY_BOUNDS, DATA, DISTRICT_OWN, DISTRICTS, GENERATED, PROVINCES,
    SUBDISTRICTS, iter_city_dirs, iter_poi_files, read_city_json, read_json, write_json,
)
from pipeline.providers import tmap                    # noqa: E402
# ★ "省级即市级"的判据与 step8 同源（同一个 adcode 段表），两处各写一份必然漂
from pipeline.steps.step8_subdistricts import is_flat_province   # noqa: E402
from schema.schema import SUBTYPE_CATEGORY          # noqa: E402

Issue = tuple[str, str, str]                        # (级别 INFO/WARN/ERROR, 归属, 描述)


# ── ① 组装 ────────────────────────────────────────────────────────

def assemble_city(slug: str, city_id: str) -> dict:
    """合并分片 → 完整 City dict。**不做校验**（校验单独一步，这样能一次报全问题）。"""
    city = dict(read_city_json(slug, city_id))

    pois: list[dict] = []
    for category, path in iter_poi_files(slug, city_id):
        poi = read_json(path)
        if not poi:
            continue
        poi = dict(poi)
        # POI 文件里可以不写 category（目录已经表达了）—— 这里补上，保持数据自包含
        poi.setdefault("category", category)
        pois.append(poi)

    city["pois"] = pois
    transit = read_json(DATA / "cities" / slug / city_id / "transit.json")
    if transit:
        city["transit"] = transit
    return city


# ── ② 校验 ────────────────────────────────────────────────────────

def check_city(slug: str, city_id: str, city: dict) -> list[Issue]:
    """04 文档第八节 + data/README 2.1 不变式。返回问题清单（不抛错 —— 一次报全）。"""
    issues: list[Issue] = []
    add = lambda lvl, msg, scope="city": issues.append((lvl, scope, msg))  # noqa: E731

    for field in ("schemaVersion", "id", "name", "province", "adcode", "provinceAdcode",
                  "tagline", "intro", "center", "bbox", "categories"):
        if not city.get(field):
            add("ERROR", f"城市缺必填字段 `{field}`")

    if len(city.get("tagline", "")) > 30:
        add("ERROR", f"tagline 超过 30 字：{len(city['tagline'])}")
    if len(city.get("intro", "")) < 150:
        add("ERROR", f"intro 不足 150 字：{len(city.get('intro', ''))}")

    adcode = city.get("adcode", "")
    if adcode and not (len(adcode) == 6 and adcode.isdigit()):
        add("ERROR", f"adcode 非法：{adcode}（应为 6 位数字）")

    # ── 区级（第四级）的数据齐不齐 ──
    # ★ 判 WARN 不判 ERROR：这两份是 **step8 从腾讯抓的**，没网 / 配额打满时缺席是
    #   预期内的降级（城市页退化成"只有景点"，其余一切照旧）。但**必须报出来** ——
    #   区这一级缺席是**静默**的：不报错、不崩、控制台干净，只是用户再也看不到它。
    if adcode:
        if not (GENERATED / "subdistricts" / f"{adcode}.json").exists():
            add("WARN",
                f"缺 subdistricts/{adcode}.json —— 城市页的**区级永远不会出现**"
                f"（跑 `python pipeline/steps/step8_subdistricts.py --only={adcode}`）")
        if not (GENERATED / "districts" / f"{adcode}.geo.json").exists():
            add("WARN",
                f"缺 districts/{adcode}.geo.json —— 区没有面、点区取景退化为飞到市中心"
                f"（同一次 step8 请求产出，缺了就是那次没跑成）")

    bbox = city.get("bbox") or []
    min_lng, min_lat, max_lng, max_lat = (bbox + [0, 0, 0, 0])[:4]

    pois = city.get("pois", [])
    if not pois:
        add("ERROR", "没有任何 POI")
    ids: list[str] = []
    for p in pois:
        pid = p.get("id", "<无 id>")
        scope = f"poi:{pid}"

        if pid in ids:
            add("ERROR", f"POI id 重复：{pid}", scope)
        ids.append(pid)

        # 类型一致性：细类必须归属且只归属一个大类（不一致 = 配置错误，阻断）
        sub, cat = p.get("subtype"), p.get("category")
        if sub not in SUBTYPE_CATEGORY:
            add("ERROR", f"细类「{sub}」不在 12 个枚举内", scope)
        elif SUBTYPE_CATEGORY[sub] != cat:
            add("ERROR", f"类型不一致：subtype={sub} 应属 {SUBTYPE_CATEGORY[sub]}，但 category={cat}", scope)

        if len(p.get("summary", "")) > 80:
            add("ERROR", f"summary 超过 80 字：{len(p['summary'])}", scope)
        desc = p.get("description", "")
        if len(desc) < 80:
            add("ERROR", f"description 不足 80 字：{len(desc)}", scope)
        if len(p.get("highlights", [])) < 2:
            add("ERROR", "highlights 少于 2 条", scope)

        aud = p.get("audience", [])
        if len(aud) < 1:
            add("ERROR", "audience 至少 1 项（一个都填不出 = 对这个点位理解不够）", scope)
        if len(set(aud)) != len(aud):
            add("ERROR", f"audience 有重复项：{aud}", scope)

        # ★ 坐标：POI 必须落在城市 bbox 内 —— 落点跑出城市说明地理编码错了
        pt = (p.get("location") or {}).get("point")
        if not pt:
            add("ERROR", "缺坐标 location.point（需跑 step3_geocode）", scope)
        elif bbox and not (min_lng <= pt["lng"] <= max_lng and min_lat <= pt["lat"] <= max_lat):
            add("ERROR", f"坐标 ({pt['lng']}, {pt['lat']}) 落在 bbox {bbox} 之外", scope)

        imgs = p.get("images", [])
        if not imgs:
            # ★ 与 transit 同口径：「step4 没跑」才是 ERROR；
            #   「跑过但图源确实没有」（step4 会落下 `_noImage`）是**预期内的降级**，
            #   前端渲染风格化 SVG 占位卡 —— 不判 ERROR，否则图源覆盖不全时永远发不了版。
            if p.get("_noImage"):
                add("WARN", "取不到图（已跑 step4，图源无结果）—— 前端走占位卡兜底", scope)
            else:
                add("ERROR", "至少要有 1 张图（需跑 step4_images）", scope)
        for i, im in enumerate(imgs):
            if not im.get("query"):
                add("ERROR", f"图 {i} 缺 query（缺了它月度巡检就无法自愈重搜）", scope)
            cr = im.get("credit") or {}
            for f in ("source", "author", "sourceUrl", "license"):
                if not cr.get(f):
                    add("ERROR", f"图 {i} 的 credit 缺字段 `{f}`", scope)

        srcs = p.get("sources", [])
        if not srcs:
            add("ERROR", "sources 至少 1 条（不做无出处的编造）", scope)
        for i, s in enumerate(srcs):
            if not s.get("fetchedAt"):
                add("ERROR", f"sources[{i}] 缺 fetchedAt", scope)
        for ref_field in ("openHoursRef", "ticketRef", "reservationRef"):
            r = (p.get("practical") or {}).get(ref_field)
            if r is not None and r >= len(srcs):
                add("ERROR", f"{ref_field}={r} 越界（sources 只有 {len(srcs)} 条）", scope)

        if p.get("_geocoded") is False:
            add("WARN", "该点位已被 step3 标记为地理编码失败（needs_geocode）", scope)

    # 通勤矩阵 —— 最容易写错的一块
    tr = city.get("transit")
    if not tr:
        # ★ 降级为 WARN 而非 ERROR：矩阵要调付费接口，配额打满时缺它是**预期内的状态**，
        #   前端会走「直线估算 + 如实标注」。只有"矩阵存在但写坏了"才值得判 ERROR。
        add("WARN", "缺 transit（通勤矩阵）—— 行程页时长降级为直线估算，配额恢复后跑 step6_transit 补上")
    else:
        if not tr.get("generatedAt"):
            add("ERROR", "transit 缺 generatedAt（缺了就无法如实告知「时长是快照」）")
        idx = tr.get("poiIndex", [])
        if idx != ids:
            add("ERROR", f"transit.poiIndex 与 pois 的 id 顺序不一致（共 {len(ids)} 个 POI）")
        n = len(idx)
        expect = (n * (n - 1)) // 2 * 4 if n > 1 else 0
        for mode in tmap.TMAP_MATRIX_MODES:
            ch = (tr.get("modes") or {}).get(mode)
            if not ch:
                add("ERROR", f"transit.modes 缺通道 {mode}")
                continue
            for f in ("distance", "duration"):
                got = len(ch.get(f, ""))
                if got != expect:
                    add("ERROR", f"transit.modes.{mode}.{f} 长度应为 {expect}，实为 {got}")
        drv = (tr.get("modes") or {}).get("driving", {})
        if drv.get("duration"):
            cells = len(drv["duration"]) // 4
            na = drv["duration"].count("0000")
            cover = (cells - na) / cells if cells else 0
            if cover <= 0.95:
                add("WARN", f"驾车覆盖率 {cover:.1%} 未超过 95% 门槛（{na}/{cells} 格不适用）")

    return issues


# ── ③ 生成派生产物 ────────────────────────────────────────────────

def build_index(cities: list[dict]) -> list[dict]:
    """cities.index.json —— 首页列表 + 下钻计数。★ 只含**已收录**城市。

    ⚠️ **顶层必须是数组**，不是 `{ count, cities }` —— 前端 `CityIndexSchema` 就是
    `z.array(CityIndexItemSchema)`。写成对象会让 safeParse 失败、静默退回"就地派生"，
    页面上只表现为一行 console.error，很容易被忽略（实测踩过）。
    """
    items = []
    for c in cities:
        cover = ""
        hero = c.get("heroImages") or []
        if hero:
            cover = hero[0].get("thumbUrl") or hero[0].get("url", "")
        elif c.get("pois"):
            first = c["pois"][0].get("images") or [{}]
            cover = first[0].get("thumbUrl") or first[0].get("url", "")
        items.append({
            "id": c.get("id"),
            "name": c.get("name"),
            "province": c.get("province"),
            "tagline": c.get("tagline"),
            "coverImage": cover,
            "poiCount": len(c.get("pois", [])),
            "adcode": c.get("adcode"),                 # ★ 下钻靠它把"市的计数"接到详情数据
            "provinceAdcode": c.get("provinceAdcode"),
            "updatedAt": c.get("updatedAt"),
        })
    # 按名称排序 —— 与前端 `deriveIndexItem` 兜底路径的排序保持一致，
    # 免得"有索引文件"和"没索引文件"两种情况下首页顺序不一样。
    items.sort(key=lambda it: it.get("name") or "")
    return items


def _poi_cover(poi: dict) -> str | None:
    """点位的封面图（搜索结果列表里的缩略图）—— 取**第一张图**。

    ★ 优先 `thumbUrl`：它本来就是给列表 / 图集用的小图，而 `url` 是 800px 主图，
      拿去当 40px 的缩略图是白花流量。
    ★ 取不到返回 `None`，**不要退回空串** —— 前端靠 `null` 判断"这张没有图"，
      空串会让它去请求一个空地址（破图）。
    ★ 存**原始**地址：镜像由前端出口统一做（`imageMirror.ts`），写进数据里就等于
      "将来换镜像要重跑整条流水线"。
    """
    for im in poi.get("images") or []:
        u = im.get("thumbUrl") or im.get("url")
        if u:
            return u
    return None


def build_district_index() -> dict:
    """`district-index.json` —— 全国**区**节点的索引（给首页 / 省级页在区这一级铺徽标）。

    ## 为什么需要它（2026-10-01）
    区徽标原来只从**已收录城市**的 `subdistricts/<市>.json` 里取 —— `useHomeView` 那个
    `cityId !== null` 的筛，理由是"给没内容的城市撒满 `0` 个区徽标 = 谎报没景点"。
    用户要求区这一级也**全国铺**（省 / 市两级已经全量了），而"读 374 份分片"= 374 个
    请求 ⇒ 合成一份（约 130KB / gzip ~35KB），前端**一次**读走。

    ## 只收录**有面的**节点
    key 必须在 `districts/<市>.geo.json` 的 `polygons` 里 —— 徽标与面**一一对应**，
    否则会出现"点了没反应"的孤立徽标（如草湖 `659013`：高德不认这个兵团团场，
    拿不到轮廓，于是它在区这一级不出现，如实回落到"市"档）。

    ## `poiCount` 缺失写 `null`（**不是 0**）
    未收录城市的区没有 `poiCount` 字段（那是 `sync_subdistrict_counts` 只对已收录城市回填的）。
    这里如实写 `null` ⇒ 前端 `nodeStatusLabel` 输出 `「XX区 —」`（待收录）。
    ★ 红线：「未收录 = 待收录灰虚线，**绝不显示 0**」—— 写成 0 就是谎报"这个区有 0 个景点"。
    """
    subdir = GENERATED / "subdistricts"
    items: list[list] = []
    for f in sorted(subdir.glob("*.json")):
        bl = DISTRICTS / f"{f.stem}.geo.json"
        if not bl.exists():
            continue
        polys = (read_json(bl) or {}).get("polygons") or {}
        for c in (read_json(f) or {}).get("children") or []:
            ad = str(c.get("adcode") or "")
            if not ad or ad not in polys:
                continue
            ctr = c.get("center") or {}
            n = c.get("poiCount")
            items.append([
                ad,
                c.get("name") or "",
                round(float(ctr.get("lng") or 0), 4),
                round(float(ctr.get("lat") or 0), 4),
                n if isinstance(n, int) else None,
            ])
    return {"fetchedAt": date.today().isoformat(), "items": items}


def build_search_index(cities: list[dict]) -> dict:
    """search-index.json —— 顶栏搜索用的**轻量**索引（跨城市）。

    ## 为什么必须构建期生成
    景点数据是**按城市整包**加载的（一城 1 个 `city.json` + 57 个 poi 分片 + 1 个
    `transit.json`）—— 搜索框要是为了拿到名字去 `loadCity` 全部城市，首屏就要发
    几百个请求。索引只留"够用来找"的东西，一个文件（约 100KB，gzip 后 ~30KB）。

    ## 两类条目
    | 字段 | 内容 |
    |------|------|
    | `regions` | 34 个省级单位 + 493 个下级（来自 `district-tree.json`），带 center / cityId / poiCount |
    | `pois` | 已收录城市的全部景点，**按热度降序**（并列时前端直接沿用文件顺序） |

    ## 刻意**不**放的字段
    · `category` —— 由 `subtype` 在 `SUBTYPE_META` 里唯一决定；
    · `popularity` —— 排序信息已经体现在文件顺序里，再存一份就是第二份会漂的副本；
    · 中文标签（`subtype` 的中文名）—— 前端现查 `SUBTYPE_META`；
    · `fullname`（"四川省"）—— 靠前端把查询去后缀（省/市/区/县…）解决，一条省 4 个字 × 527 条。
    ★ 这几条的共同点：**存了就有第二份会漂的副本，而"漂了"是静默的**（只是搜不到），
      所以宁可让前端从唯一出处现取。
    """
    regions: list[dict] = []
    # ★ 收录信息**只能从已收录城市本身取**，有两件事不能照抄 `district-tree.json`：
    #   ① 它的 `poiCount` 对直辖市是 0（北京明明收录了 57 个）—— 照着写会变成
    #      「北京 0 个」，正是项目红线「未收录 ≠ 0」要防的骗人显示；
    #   ② 它的 `cityId` 是**那次生成时**的快照，之后新加的城它不知道
    #      （实测 9 城只对上 4 城）。快照过期在这里是**静默**的：只是那几座城市
    #      在搜索里显示成"未收录"，而点进去明明是有的。
    by_adcode: dict[str, tuple[str, int]] = {}
    by_name: dict[tuple[str | None, str | None], tuple[str, int]] = {}
    for c in cities:
        hit = (c.get("id"), len(c.get("pois", [])))
        if c.get("adcode"):
            by_adcode[c["adcode"]] = hit
        by_name[(c.get("province"), c.get("name"))] = hit

    def lookup(adcode: str | None, province: str | None, name: str | None) -> tuple[str | None, int | None]:
        """(cityId, 景点数) —— 先按 adcode 配，配不上再按「省 + 市」配。

        adcode 优先：它是区划编号，比名字可靠（名字在不同层级可能重名）。
        """
        hit = by_adcode.get(adcode) if adcode else None
        if hit is None:
            hit = by_name.get((province, name))
        return hit if hit else (None, None)

    def collect_count(rows: list[tuple[str | None, int | None]]) -> int | None:
        """合计已收录的景点数。一个都没收录 → `None`（≠ 0）"""
        hits = [n for _cid, n in rows if n is not None]
        return sum(hits) if hits else None

    tree_path = GENERATED / "district-tree.json"
    if tree_path.exists():
        tree = read_json(tree_path)
        for prov in tree.get("provinces", []):
            c = prov.get("center") or {}
            prov_name = prov.get("name")
            child_rows: list[dict] = []
            child_hits: list[tuple[str | None, int | None]] = []
            for child in prov.get("children", []):
                cc = child.get("center") or {}
                city_id, n = lookup(child.get("adcode"), prov_name, child.get("name"))
                child_hits.append((city_id, n))
                child_rows.append({
                    "adcode": child.get("adcode"),
                    "name": child.get("name"),
                    "level": "city",
                    "provinceAdcode": prov.get("adcode"),
                    # ★ 只有**已收录**的市才有 cityId —— 前端据此才知道"这一条能不能下钻到点位"
                    "cityId": city_id,
                    "lng": cc.get("lng"),
                    "lat": cc.get("lat"),
                    "poiCount": n,
                })
            # ★ 省级要**连它自己一起算**：直辖市的 adcode 既是省也是市（北京 110000），
            #   它的景点不在"下辖区"里 —— 只加下辖会得到 null，
            #   于是"北京已收录 57 个"变成"未收录"
            own_id, own_n = lookup(prov.get("adcode"), None, prov_name)
            regions.append({
                "adcode": prov.get("adcode"),
                "name": prov_name,
                "level": "province",
                "lng": c.get("lng"),
                "lat": c.get("lat"),
                "cityId": own_id,
                "poiCount": collect_count([(own_id, own_n)] + child_hits),
            })
            regions.extend(child_rows)

    pois: list[dict] = []
    for city in cities:
        for poi in city.get("pois", []):
            pt = (poi.get("location") or {}).get("point") or {}
            pois.append({
                "id": poi.get("id"),
                "name": poi.get("name"),
                "cityId": city.get("id"),
                "cityName": city.get("name"),
                "lng": pt.get("lng"),
                "lat": pt.get("lat"),
                "subtype": poi.get("subtype"),
                "tags": poi.get("tags") or [],
                "cover": _poi_cover(poi),
                "popularity": int(poi.get("popularity") or 0),
            })
    # 热度降序 → 前端"同样命中"时沿用文件顺序即可，索引里不必再存 popularity
    pois.sort(key=lambda x: -x["popularity"])
    for it in pois:
        del it["popularity"]

    return {
        "version": 1,
        "generatedAt": date.today().isoformat(),
        "regions": regions,
        "pois": pois,
    }


def _norm_name(name: str) -> str:
    """剥掉行政后缀（"广州市" → "广州"），用于树节点与 city.json 的名字兜底比对。"""
    core = str(name or "")
    for suffix in ("特别行政区", "自治州", "地区", "自治县", "市", "县", "区", "盟", "旗"):
        if core.endswith(suffix) and len(core) > len(suffix):
            return core[: -len(suffix)]
    return core


def reindex_poi_districts(slug: str, city_id: str, city: dict) -> tuple[int, int]:
    """把这座城的每个点位归到**它所在的区**，写回 POI 文件的 `district` 字段。

    ## 为什么是"坐标点在区多边形内"而不是解析地址字符串
    POI 没有行政区字段，只有一整串 `location.address`。按字符串解析要穷举
    "XX区 / XX县 / 自治县…"的写法，而几何判定只有一种写法，且天然处理飞地与新区划。

    ★ **只写有变化的那些文件** —— 684 个 POI 每次 build 全量重写会让 PR diff 变成
      看不出改了什么的噪声；归区是幂等的，第二次跑应当一个字节都不动。

    @return `(归到区的点数, 其中靠'最近区中心'兜底的点数)`。
    """
    from pipeline.geo.districts import assign_district    # 局部导入：它的依赖只在归区时才需要

    city_adcode = str(city.get("adcode") or "")
    if not city_adcode:
        return 0, 0

    # ★ adcode → 区名，与 `subdistricts/<市>.json` **同源** ⇒ 徽标名 / 徽标数字 /
    #   「点区筛景点」三者口径一致。
    #   ⚠️ 修复前这里只写**顶层** `district`（= adcode，几何归区），而前端 `poisOf`
    #   筛的是 `location.district`（**采编稿里手写的 `dist`**）—— 两套口径。
    #   实测 105 处对不上（北京东城：徽标写 28、点进去筛出 21），用户看到的
    #   是"数字和清单一栏对不上"。现在两边都由几何归区说了算。
    #   ★ 不去改采编稿的 `dist`：build 每次都重写 POI，它才是权威（稿子只喂一次）。
    names = {
        str(c.get("adcode")): c.get("name")
        for c in (read_json(SUBDISTRICTS / f"{city_adcode}.json") or {}).get("children") or []
    }

    assigned = 0
    fallback = 0
    for _category, path in iter_poi_files(slug, city_id):
        poi = read_json(path)
        if not poi:
            continue
        pt = (poi.get("location") or {}).get("point") or {}
        lng, lat = pt.get("lng"), pt.get("lat")
        if lng is None or lat is None:
            continue
        district, used_fallback = assign_district(city_adcode, float(lng), float(lat))
        if district is None:
            continue
        assigned += 1
        if used_fallback:
            fallback += 1
        changed = False
        if poi.get("district") != district:
            poi["district"] = district
            changed = True
        name = names.get(district)
        loc = poi.setdefault("location", {})
        if name and loc.get("district") != name:
            loc["district"] = name
            changed = True
        # ★ 只写**有变化**的（归区是幂等的，第二次跑应当一个字节都不动）
        if changed:
            write_json(path, poi)

    # 一并同步内存里那份 city（后面的校验与搜索索引读它）
    if assigned:
        by_id = {}
        for _category, path in iter_poi_files(slug, city_id):
            p = read_json(path)
            if p:
                by_id[p.get("id")] = p
        for poi in city.get("pois", []):
            src = by_id.get(poi.get("id"))
            if not src:
                continue
            poi["district"] = src.get("district")
            # ★ `location.district` 也要同步 —— 前端"点区筛景点"筛的就是它
            if isinstance(poi.get("location"), dict) and isinstance(src.get("location"), dict):
                poi["location"]["district"] = src["location"].get("district")
    return assigned, fallback


def sync_district_tree() -> int:
    """★ 把**已收录城市**回填进 `district-tree.json` 的 `cityId` / `poiCount` / `cityCount`。

    ## 为什么必须有这一步（2026-09-25 实测事故）
    树是 step7 **一次性抓取**的产物，每个市节点的 `cityId` 是**那次生成时**的快照。
    之后新录的城市（广州 / 深圳 / 南京 / 香港 …）在树里 `cityId` 仍是 `None`，
    而前端 `loadProvinceDetail` / `loadAllCityRows` 恰恰用 `cityId !== null`
    判"能不能下钻" —— 于是：

        data/cities/guangdong/guangzhou/ 下 57 个 POI 一个不少，
        广东省页却显示「待收录」，地图上连广州深圳的徽标都没有。

    ★ 这是**静默**的：`cities.index.json` 里有它、顶栏搜索也能搜到它，
      唯独地图上不存在 —— 不报错、不告警，只能靠肉眼发现。

    ## 两条必须守住的边界
    1. 收录集合取**磁盘上的全部城市**（`iter_city_dirs`），**不是本次 `targets`**
       —— 否则 `--city=guangzhou` 增量跑会把其余 11 座城抹成"未收录"。
    2. `poiCount` 未收录时写 `0`（schema 要求 `int`，不接受 `null`）；
       "待收录"的语义由 `cityId: null` 承载，前端据此显示「—」。

    @return 回填上的城市数。
    """
    tree_path = GENERATED / "district-tree.json"
    if not tree_path.exists():
        print("⚠️ district-tree.json 不存在（未跑 step7）—— 跳过收录信息回填")
        return 0

    # ── ① 已收录清单：只读 city.json（很轻）+ 数 POI 文件，不发任何请求 ──
    by_adcode: dict[str, tuple[str, int]] = {}
    by_name: dict[tuple[str, str], tuple[str, int]] = {}
    #: ★ 额外留一份 name / center —— ③ 补挂县级节点时要写进树，而 `hair` 只带 (cityId, n)
    city_info: dict[str, dict] = {}
    for slug, cid, _dir in iter_city_dirs():
        head = read_city_json(slug, cid)
        if not head:
            continue
        n = sum(1 for _cat, _p in iter_poi_files(slug, cid))
        hit = (cid, n)
        if head.get("adcode"):
            by_adcode[str(head["adcode"])] = hit
            city_info[str(head["adcode"])] = {
                "cityId": cid,
                "name": head.get("name"),
                "center": head.get("center"),
            }
        by_name[(str(head.get("province") or ""), _norm_name(head.get("name")))] = hit

    def lookup(adcode: object, prov_name: object, name: object) -> tuple[str | None, int]:
        """adcode 优先（区划编号比名字可靠，名字会重名），配不上再按「省 + 市名」兜底。"""
        hit = by_adcode.get(str(adcode)) if adcode else None
        if hit is None:
            hit = by_name.get((str(prov_name or ""), _norm_name(name)))
        return hit if hit else (None, 0)

    # ── ② 回填 ──
    tree = read_json(tree_path)
    matched = 0
    n_flat = 0
    #: 已在树上匹配到的 adcode —— ③ 用它找出"树里根本没有节点"的县级城市
    matched_adcodes: set[str] = set()
    for prov in tree.get("provinces", []):
        counts: list[int] = []
        n_city = 0
        # ★★ "这个省自己就是一座市" 的判据必须是 **adcode 段**，与收录状态无关。
        #    曾写成 `own_id`（= 这座市被收录了）→ 天津（未收录）被判成普通省，
        #    于是它的 16 个区在市级那一档被当成 16 座「待收录市」，
        #    而真正的市徽标（天津本身）一枚都没有；反过来北京上海这些已收录的
        #    又会出现"该显示市标时铺了一屏区标"（2026-09-26 用户报的现象）。
        #    `isCity` 写进树里，前端只读它、不许自己猜（理由见 schema 的字段注释）。
        prov["isCity"] = is_flat_province(prov.get("adcode"))
        if prov["isCity"]:
            n_flat += 1
        # ★ 直辖市 / 特别行政区：省节点自身就是市（北京 110000、香港 810000），
        #   它的景点不在"下辖区"里 —— 只扫 children 会得到"未收录"
        own_id, own_n = lookup(prov.get("adcode"), None, prov.get("name"))
        if own_id:
            prov["cityId"] = own_id
            n_city += 1
            matched += 1
            counts.append(own_n)
        prov["level"] = "province"

        for child in prov.get("children") or []:
            cid, n = lookup(child.get("adcode"), prov.get("name"), child.get("name"))
            child["cityId"] = cid
            child["poiCount"] = n
            # ★ level 由"这个省是不是本身就是市"决定 —— 前端按它渲染，不靠深度：
            #   普通省的下级是市（下面还有一级区，在 subdistricts/ 分片里按需加载），
            #   而直辖市没有中间的市层，它的下级直接是区。腾讯对 110100（市辖区）
            #   返回 0 个下级，所以那一层**没有真实节点**，不能靠接口补。
            child["level"] = "district" if prov["isCity"] else "city"
            if cid:
                n_city += 1
                matched += 1
                matched_adcodes.add(str(child.get("adcode")))
                counts.append(n)

        prov["cityCount"] = n_city
        prov["poiCount"] = sum(counts)

    # ── ③ 县级城市补挂（2026-10-06）────────────────────────────────────────
    # 区划树**只有两级**（省 → 地级市），曲阜 370881 / 平遥 140728 / 敦煌 620982 这类
    # 县级城市在树里**根本没有节点** ⇒ ② 回填时匹配不到 ⇒ `cityId` 挂不上 ⇒
    # 护栏 AB 报「磁盘上有、树上没有 cityId」——后果是**它在地图上等于不存在**
    # （省页显示「待收录」、连徽标都没有），尽管 57 个 POI 一个不少。
    #
    # ★ 为什么补到**省的 children（市层）**，而不是父市（济宁 / 晋中）下面：
    #   父市本身**未被收录**（cityId=null），而前端用 `cityId !== null` 判「能不能下钻」，
    #   挂到父市下 ⇒ 曲阜照样看不见。在本站语境里曲阜就是一座被收录的目的地城市。
    extra = 0
    for adcode, (cid, n) in by_adcode.items():
        if adcode in matched_adcodes:
            continue
        prov = next(
            (p for p in tree.get("provinces", [])
             if str(p.get("adcode") or "")[:2] == adcode[:2]),
            None,
        )
        if prov is None:
            continue
        info = city_info.get(adcode) or {}
        prov.setdefault("children", []).append({
            "adcode": adcode,
            "name": info.get("name") or adcode,
            "cityId": cid,
            "poiCount": n,
            "level": "district" if prov.get("isCity") else "city",
            "center": info.get("center") or {},
        })
        prov["cityCount"] = int(prov.get("cityCount") or 0) + 1
        prov["poiCount"] = int(prov.get("poiCount") or 0) + n
        matched += 1
        extra += 1

    write_json(tree_path, tree)
    print(
        f"区划树收录信息已同步：{matched} 座城市挂上 cityId、"
        f"{n_flat} 个省标记为「省即市」（{tree_path.name}）"
    )
    if extra:
        print(f"  其中 {extra} 座是县级城市 —— 树只有两级没有它们的节点，"
              f"已补挂到所属省的 children（市层），否则地图上不显示徽标")
    return matched


def sync_label_centers() -> tuple[int, int, int]:
    """把省 / 市 / 区三级的**徽标落点**从"政府驻地"改成"面内视觉中心"。

    ## 为什么（2026-10-01 用户报）
    > 「这些省市区的标签，现在你是定位到市政府这种了吗，很多都不是展示在市中心的，
    >   而是展示在市靠某一侧的」

    腾讯 `getchildren` 给的 `center` 是**行政中心**（省 = 省会、市 = 市政府、区 = 区政府）。
    实测它与"面内视觉中心"的偏差：**省中位 113km、市 28km、区 9.6km**。
    而地图上标行政区名，惯例是落在**面内视觉中心** —— 高德 / 百度的市名也不在政府门口。

    ## 算什么
    `labelgeo.label_point()`：在「bbox 中心」与「面积加权质心」里挑**离边界更远**的那个
    （"居中"的直接度量就是"四面八方都有地方"），两者都不在面内 / 都贴边时退到网格法。
    ★ 不写死优先谁：**内蒙古**要 bbox 中心（质心被东部拉偏）、**黑龙江**要质心
      （bbox 中心被大兴安岭拉北 200km）。细节与实测见 `labelgeo.py` 文件头。

    ## 影响面
    `district-tree.json`（省 / 市）+ `subdistricts/*.json`（区）的 `center` 字段。
    **前端零改动** —— 它读的就是这个字段。拿不到面的（雄安 / 草湖）保持原值。

    @return `(省数, 市数, 区数)`。
    """
    from pipeline.geo.labelgeo import label_point, to_dict   # 局部导入：几何算法只在回填时用

    tree_path = GENERATED / "district-tree.json"
    tree = read_json(tree_path)
    if not tree:
        return 0, 0, 0

    def polys_of(path) -> dict:
        return (read_json(path) or {}).get("polygons") or {}

    n_p = n_c = 0
    for prov in tree.get("provinces") or []:
        pa = str(prov.get("adcode") or "")
        if not pa:
            continue
        pp = polys_of(PROVINCES / f"{pa}.geo.json")
        pt = label_point(pp.get(pa) or []) if pp else None
        if pt:
            prov["center"] = to_dict(pt)
            n_p += 1
        cp = polys_of(CITY_BOUNDS / f"{pa}.geo.json")
        if not cp:
            continue
        for kid in prov.get("children") or []:
            ka = str(kid.get("adcode") or "")
            kpt = label_point(cp.get(ka) or []) if ka else None
            if kpt:
                kid["center"] = to_dict(kpt)
                n_c += 1
    write_json(tree_path, tree)

    n_d = 0
    for f in sorted(SUBDISTRICTS.glob("*.json")):
        # ★★ 区的"面内视觉中心"必须用**高德那份**（`districts-own/`）—— 腾讯给下辖区的
        #   轮廓极粗（实测有的区只有 4 个点 = 一个矩形），拿矩形算"离边界更远的点"
        #   等于算了个包围框中心，那是"标签偏到某一侧"的另一种成因。
        #   没有高德分片的城退回腾讯那份（老行为，不倒退）。
        dp = polys_of(DISTRICT_OWN / f"{f.stem}.geo.json") or polys_of(DISTRICTS / f"{f.stem}.geo.json")
        if not dp:
            continue
        sub = read_json(f)
        changed = False
        for ch in sub.get("children") or []:
            dpt = label_point(dp.get(str(ch.get("adcode") or "")) or [])
            if dpt:
                ch["center"] = to_dict(dpt)
                changed = True
                n_d += 1
        if changed:
            write_json(f, sub, compact=True)

    print(f"徽标落点已按「面内视觉中心」重算：省 {n_p} / 市 {n_c} / 区 {n_d}")
    return n_p, n_c, n_d


def build_credits_md(slug: str, city_id: str, city: dict) -> str:
    """credits/{省}/{市}.md —— 给 PR review 用的人类可读来源清单（06 文档 4.4）。"""
    lines = [f"# {city.get('name', city_id)} · 数据来源与图片版权", ""]
    lines.append(f"> 生成于 {date.today().isoformat()} · 城市数据最后更新 {city.get('updatedAt', '—')}")
    lines.append("")
    lines.append(f"## 概览")
    lines.append("")
    lines.append(f"- 省份：{city.get('province', '—')}")
    lines.append(f"- adcode：{city.get('adcode', '—')}")
    lines.append(f"- POI 数量：{len(city.get('pois', []))}")
    lines.append("")
    lines.append("## 文本内容来源")
    lines.append("")
    lines.append("| POI | 来源标题 | 类型 | 抓取日期 |")
    lines.append("|-----|---------|------|---------|")
    for p in city.get("pois", []):
        for s in p.get("sources", []):
            title = s.get("title", "").replace("|", "\\|")
            url = s.get("url", "")
            lines.append(
                f"| {p.get('name','—')} | [{title}]({url}) | {s.get('kind','—')} | {s.get('fetchedAt','—')} |"
            )
    lines.append("")
    lines.append("## 图片版权")
    lines.append("")
    lines.append("| 归属 | 作者 | 协议 | 来源链接 |")
    lines.append("|------|------|------|---------|")

    def dump_images(prefix: str, imgs: list[dict]) -> None:
        for im in imgs:
            cr = im.get("credit") or {}
            author = str(cr.get("author", "—")).replace("|", "\\|")
            lines.append(
                f"| {prefix} | {author} | {cr.get('license','—')} | "
                f"[{cr.get('source','—')}]({cr.get('sourceUrl','')}) |"
            )

    dump_images("城市封面", city.get("heroImages") or [])
    for p in city.get("pois", []):
        dump_images(p.get("name", "—"), p.get("images") or [])
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    strict = "--strict" in args
    only = None
    for a in args:
        if a.startswith("--city="):
            only = a.split("=", 1)[1]
        elif not a.startswith("--") and not only:
            only = a

    targets = [(s, c) for s, c, _ in iter_city_dirs() if only is None or c == only]
    if not targets:
        print("⚠️ 没有找到城市目录：data/cities/{省}/{市}/city.json")
        return 1

    all_issues: dict[str, list[Issue]] = {}
    assembled: list[dict] = []

    for slug, cid in targets:
        city = assemble_city(slug, cid)

        # ★ 点位归区：必须在 assemble 之后、校验之前 —— 归区结果要随这轮的
        #   Schema 校验与搜索索引一起出去，否则城市页拿到的是上一版的归属。
        n_assigned, n_fallback = reindex_poi_districts(slug, cid, city)
        if n_assigned:
            tail = f"（其中 {n_fallback} 个靠最近区中心兜底）" if n_fallback else ""
            print(f"    归区：{n_assigned}/{len(city.get('pois', []))} 个点位落到区上{tail}")

        assembled.append(city)
        issues = check_city(slug, cid, city)
        all_issues[f"{slug}/{cid}"] = issues

        n_poi = len(city.get("pois", []))
        errs = [i for i in issues if i[0] == "ERROR"]
        warns = [i for i in issues if i[0] == "WARN"]
        mark = "✅" if not errs else "❌"
        print(f"{mark} {slug}/{cid} · {n_poi} POI · {len(errs)} 错误 / {len(warns)} 告警")
        for lvl, scope, msg in issues[:40]:
            print(f"    [{lvl}] {scope}: {msg}")
        if len(issues) > 40:
            print(f"    … 还有 {len(issues) - 40} 条")

        # Pydantic 严格校验。
        # ★ 这里**不能**只在"零 ERROR"时才跑：实测 transit 缺失（1 个 ERROR）就把
        #   `sources.kind` 用了非法枚举值这件事完全掩盖了 —— 等到配额恢复、transit 补上
        #   才突然冒出来，排查成本翻倍。形状错误是根本性的，任何时候都要报。
        #   只在错误已经很多时（>20）才让位于可读性，避免两类错误互相淹没。
        if len(errs) <= 20:
            try:
                from schema.schema import City
                City.model_validate(city)
                print("    Schema 校验通过")
            except Exception as exc:                  # noqa: BLE001 —— 校验错误要完整打印
                all_issues[f"{slug}/{cid}"].append(("ERROR", "schema", str(exc)[:400]))
                print(f"    ❌ Schema 校验失败：{str(exc)[:300]}")

        from pipeline.core.layout import credits_md_path
        md = build_credits_md(slug, cid, city)
        p = credits_md_path(slug, cid)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(md, encoding="utf-8", newline="\n")

    # 生成索引（无论是否有错都生成，方便本地看效果）
    write_json(DATA / "cities.index.json", build_index(assembled))
    # ★ 区划树收录信息回填 —— 不跑这一步，新录的城市在地图上等于不存在
    #   （树里 cityId 是抓取时的快照；详见 sync_district_tree 的注释）
    sync_district_tree()
    # ★ 区级计数：普通省的区分片 + 直辖市的树上区节点。**必须在归区之后**
    #   （它读的就是 POI 文件里刚写回的 `district`）
    from pipeline.geo.districts import (
        scan_district_counts, sync_city_bbox, sync_flat_province_counts,
        sync_subdistrict_counts,
    )
    # ★ 城市 bbox 回填：`city-bbox.json` 是**按 adcode 的缓存**，命中就不再重算 ——
    #   所以后来在区边界上做的清洗（`step8._drop_stray_parts` 丢掉错位的那一块）
    #   不会自己反映到 bbox 上，缓存里会一直留着被坏环撑开的旧值。
    #   详见 `districts.sync_city_bbox` 的注释（天津就是这么中招的）。
    n_bbox = sync_city_bbox()
    if n_bbox:
        print(f"城市 bbox 已按清洗后的边界重算：{n_bbox} 条")
    table = scan_district_counts()
    files, n_poi_d = sync_subdistrict_counts(table)
    n_flat = sync_flat_province_counts(table)
    print(f"区级计数已同步：{files} 个分片 + 树上 {n_flat} 个直辖市 / 特区区节点（{n_poi_d} 个点位已归区）")
    # 搜索索引：派生物，放 `_generated/`。compact 写 —— 它是**给输入框读的**，
    # 没人手动编辑，体积直接等于下载量（约 100KB → 70KB）
    # ★ 徽标落点：把三级 `center` 从"政府驻地"换成"面内视觉中心" —— 必须在
    #   所有会写 `district-tree.json` / `subdistricts` 的步骤之后
    sync_label_centers()
    write_json(GENERATED / "search-index.json", build_search_index(assembled), compact=True)
    # ★ 区级节点索引：**必须在 `sync_subdistrict_counts` 之后** —— 它读的就是刚回填的
    #   `poiCount`（缺失 ⇒ 写 null ⇒ 前端显示「—」而不是「0」）
    write_json(GENERATED / "district-index.json", build_district_index(), compact=True)
    write_json(GENERATED / "build-summary.json", {
        "generatedAt": date.today().isoformat(),
        "cities": {k: {"errors": sum(1 for i in v if i[0] == "ERROR"),
                       "warnings": sum(1 for i in v if i[0] == "WARN")}
                   for k, v in all_issues.items()},
    })
    print(f"\n索引已写入 data/cities.index.json（{len(assembled)} 城）")
    print("搜索索引已写入 data/_generated/search-index.json")

    total_err = sum(1 for v in all_issues.values() for i in v if i[0] == "ERROR")
    total_warn = sum(1 for v in all_issues.values() for i in v if i[0] == "WARN")
    print(f"合计：{total_err} 错误 / {total_warn} 告警")
    if total_err:
        print("❌ 存在 ERROR —— 这些数据不允许进站点")
        return 1
    if strict and total_warn:
        print("❌ --strict 模式下 WARN 也算失败")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
