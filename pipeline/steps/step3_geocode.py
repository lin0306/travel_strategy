#!/usr/bin/env python3
"""
pipeline/steps/step3_geocode.py —— 给 POI 草稿补坐标（04 文档第三步）

输入：`data/cities/{省}/{市}/pois/{category}/{poiId}.json` 里的 POI 草稿
输出：原地写回 `location.point` / `location.address` / `location.district`

★ 必须在 step6（通勤矩阵）之前跑 —— 矩阵依赖最终坐标。

三级退化 + 异地同名防护（04 文档 3 步细节）：
    ① 精确名 + region=城市名           → 命中且 adcode 匹配 → 入库
    ② 精确名搜不中 / adcode 不匹配      → 「名称 + 所在区县」再搜一次
    ③ 仍失败 → 标记 needs_geocode，**不入库**（宁可缺一个点，也不要错坐标）

⚠️ 腾讯返回 ad_info.adcode 是**区县**级 adcode（6 位，如武侯区 510107），
   而城市 adcode 是市级（成都市 510100）。判"是否落在目标城市"用前 4 位比对更稳
   —— 同一地级市下各区县的前 4 位相同。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

if __package__ in (None, ""):                       # 允许 `python step3_geocode.py` 直接跑
    # ★ 本文件在 pipeline/steps/，往上两级才是仓库根（见 core/layout.py 同处陷阱）
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pipeline.core.layout import (                # noqa: E402
    iter_city_dirs, iter_poi_files, read_json, write_json,
)
# ★ 取点**只走 geoprovider** —— 它内部按「腾讯优先、腾讯日配额尽自动换高德」分发。
#   这里若直接调 tmap，配额耗尽时的表现就是"整城 POI 一个个被判没命中"，
#   而真实原因是额度没了（换一家立刻能取到）。详见 geoprovider.py 文件头。
from pipeline.providers import geoprovider as geo       # noqa: E402

GEOCODED_FLAG = "_geocoded"
#: 命中了坐标，但**返回的 title 与我们要的 POI 名对不上** —— 存疑，交给人工核
SUSPECT_FLAG = "_geocodeSuspect"

#: 名称匹配失败的容差：允许 title 比 name 多字（常带城市前缀/分店后缀），
#: 但**不允许 title 缺字** —— "成都自然博物馆"被解析成"成都博物馆"就是典型事故。
CITY_PREFIXES = ("成都市", "成都", "中国")


def _core(s: str) -> str:
    """名称核心：去括号内容、去标点、去城市前缀。用于**名称一致性**比对。

    ⚠️ 必须去城市前缀：name 常写"成都大熊猫繁育研究基地"，而接口返回的 title
       可能是"大熊猫繁育研究基地"（或反之），不去前缀会造成大量假不匹配。
    """
    s = re.sub(r"[（(].*?[)）]", "", s or "")            # 去括号内容
    # ★ 去装饰符号（《》「」等）。演出类 POI 常写成「《印象·武隆》实景演出」，
    #   而接口返回的 title 是「印象武隆」—— 不去符号，名称判据永远 False。
    s = re.sub(r"[\s·、，,。.\-—/《》「」【】『』]", "", s)
    for p in CITY_PREFIXES:
        if s.startswith(p) and len(s) > len(p):
            s = s[len(p):]
            break
    return s


def _name_matches(name: str, title: str) -> bool:
    """接口返回的 title 是否就是我们要找的那个点：**name 的核心字符必须全部出现在 title 里**。

    ★ 这条判据拦下的是**最危险的一类错误**：坐标合法（在市内、adcode 也对），
      但其实是另一个点 —— 静默错误，只有名字比对能发现。

    ⚠️ 为什么**不能**用"双向子串"（一方包含另一方即可）：
       "成都自然博物馆"被解析成"成都博物馆"时，core 分别是"自然博物馆"与"博物馆"，
       "博物馆"是"自然博物馆"的子串 → 双向判据会误判为匹配（实测踩过）。
       只允许 **name ⊆ title**（title 可更长，如"飘香火锅玉林西路店"），
       不允许 title 比 name 短 —— 短就意味着丢了关键字。
    """
    a, b = set(_core(name)), set(_core(title))
    if not a or not b:
        return False
    return a.issubset(b)


#: 反向包含（title ⊆ name）时要求 title 核心至少这么长。
#: 「玉林串串香(总店)」丢的是"总店"这种分店限定词，放心放行；
#: 而历史错案「成都自然博物馆」↔「成都博物馆」只差 3 字的核心，**必须拦住**。
REVERSE_MIN_CORE = 4


def _name_matches_loose(name: str, title: str) -> bool:
    """名称近似判据：允许 title ⊆ name（丢后缀限定词），但要求核心词足够长。

    ⚠️ 只在**区县已确认吻合**时调用。名称单独判不出对错 —— 见 `REVERSE_MIN_CORE`。
    """
    return _name_matches(name, title) or (
        set(_core(title)).issubset(set(_core(name))) and len(_core(title)) >= REVERSE_MIN_CORE
    )


def _same_city(adcode_found: str, city_adcode: str) -> bool:
    """命中结果是否与目标城市同城。

    ⚠️ 比较位数**不能一律取前 4 位**（实测踩过）：
      · 地级市：adcode 形如 `510100`（成都），下辖 `510104`（锦江）→ 前 4 位成立
      · 直辖市：adcode 形如 `500000`（重庆，省本级），下辖 `500103`（渝中）
        → 前 4 位是 `5000` vs `5001`，**永远判不中**，46 个点全部被误判为"异地同名"

    判据：市级 adcode 后四位为 0（即省本级）时比前 2 位，否则比前 4 位。
    这样 500000 vs 500103 → `50` == `50` ✓；而四川省 510000 与渝中区 500103 → `51` != `50` ✗。
    """
    if not adcode_found or not city_adcode:
        return False
    n = 2 if city_adcode[2:] == "0000" else 4
    return adcode_found[:n] == city_adcode[:n]


def _hit_ok(hit: dict | None, city_adcode: str, name: str) -> bool:
    """命中结果是否可用：同城 **且** 名称对得上（两条都要，缺一不可）。"""
    if hit is None:
        return False
    if city_adcode and not _same_city(hit.get("adcode", ""), city_adcode):
        return False
    return _name_matches(name, hit.get("title", ""))


#: 名称里可以剥掉的**通用后置词**。演出/景区类 POI 的正式名常带这些，
#: 而地图收录的 title 往往没有（「《印象·武隆》实景演出」→ 实际 title「印象武隆」）。
#: 只在严格匹配无果时才剥 —— 不能一上来就剥，否则「玻璃博物馆」会被剥成「玻璃」。
GENERIC_SUFFIXES = (
    "实景演出", "演出", "大型演出", "旅游区", "风景区", "风景名胜区",
    "旅游景区", "AAAAA级景区", "AAAA级景区", "景区",
)


def _strip_generic_suffix(name: str) -> str:
    """剥掉末尾的通用后置词；剥完不能为空，也不许剥过头（保留至少 2 个字）。"""
    s = _core(name)
    for suf in GENERIC_SUFFIXES:
        if s.endswith(suf) and len(s) > len(suf) + 1:
            return s[: -len(suf)]
    return s


def _pick_from_place(
    name: str, city_name: str, city_adcode: str, district_hint: str
) -> dict | None:
    """从 place/search 的多条候选里挑出**最可能是我们要的那个**。

    ★ 绝不取 `results[0]`：实测搜「磁器口陈麻花」首条命中的是九龙坡区分店，
      而数据要的是磁器口古镇内那家 —— 直接取首条会静默写错坐标。

    筛选与排序：
      ① 必须同城（adcode）
      ② 必须名称对得上（沿用 `_name_matches`，拦住同品类的其他店）
      ③ 多条命中时，**区县吻合的优先** —— 分歧不在"是不是这家店"而在"哪家分店"，
         此时区县是唯一可靠的判别依据（数据里的 district 是人工写的，可信度高）
    """
    cands = geo.place_search(_core(name), region=city_name)

    core_district = re.sub(r"[市区县]$", "", district_hint or "")       # 沙坪坝区 → 沙坪坝

    def in_district(c: dict) -> bool:
        if not core_district:
            return False
        return core_district in (c.get("address", "") + c.get("district", ""))

    def rank(c: dict) -> int:
        """0 = 完全相等，1 = name⊆title，2 = title⊆name，3 = 不吻合（不用）。"""
        t = c.get("title", "")
        if _core(name) == _core(t):
            return 0
        if _name_matches(name, t):
            return 1
        if set(_core(t)).issubset(set(_core(name))) and len(_core(t)) >= REVERSE_MIN_CORE:
            return 2
        return 3

    # ① 区县吻合的候选里放宽名称判据 —— 区县比名称可靠（实测依据见函数注释）
    pool = [c for c in cands if city_adcode and _same_city(c.get("adcode", ""), city_adcode)]
    same_district = [c for c in pool if in_district(c)]
    if same_district:
        best = min(same_district, key=rank)
        if rank(best) < 3:
            return best
    # ② 区县对不上或判据太严 → 退回严格判据（宁可不命中，也不写错坐标）
    strict = [c for c in pool if _name_matches(name, c.get("title", ""))]
    return strict[0] if strict else None


def find_duplicate_points(slug: str, city_id: str) -> dict[tuple[float, float], list[str]]:
    """★ 坐标完全重合，且**至少一个是存疑命中** → 几乎可以确定解析错了。

    ⚠️ 为什么要求"至少一个存疑"：同一条街上的 POI 本来就可能撞点。
       实测西安「贾三灌汤包」与「回民街」相距 8 米 —— 两者都精确命中、
       title 各不相同，贾三总店确实就在北院门街上。那是真实相邻，不是 bug。
       放开这个条件会把真·相邻误报成错，掩盖真正要修的那些。
    """
    from pipeline.core.layout import iter_poi_files, read_json

    seen: dict[tuple[float, float], list[str]] = {}
    for category, path in iter_poi_files(slug, city_id):
        poi = read_json(path)
        pt = (poi.get("location") or {}).get("point")
        if not pt:
            continue
        key = (round(float(pt["lng"]), 4), round(float(pt["lat"]), 4))
        seen.setdefault(key, []).append(f"{category}/{path.stem}（{poi.get('_geocodeTitle') or '?'}）")

    # 逐个回 disks 查是否存疑 —— 上面已经读过一次，这里按同一个口径重查即可
    from pipeline.core.layout import iter_poi_files as _it
    suspect_points: set[tuple[float, float]] = set()
    for _cat, p in _it(slug, city_id):
        poi = read_json(p)
        pt = (poi.get("location") or {}).get("point")
        if pt and poi.get(SUSPECT_FLAG):
            suspect_points.add((round(float(pt["lng"]), 4), round(float(pt["lat"]), 4)))

    return {
        k: v for k, v in seen.items()
        if len(v) > 1 and k in suspect_points
    }


def geocode_city(slug: str, city_id: str, city_dir: Path, *, force: bool = False) -> dict:
    """给一座城市的全部 POI 草稿补坐标，返回统计。"""
    city = read_json(city_dir / "city.json")
    if not city:
        return {"error": f"{city_dir}/city.json 不存在"}

    city_name = city.get("name", city_id)
    city_adcode = city.get("adcode", "")
    stats = {"total": 0, "hit": 0, "retry_hit": 0, "rejected": 0, "mismatch": 0,
             "place_hit": 0, "addr_hit": 0, "suspect": 0, "failed": 0,
             "skipped": 0, "failed_list": []}

    for category, path in iter_poi_files(slug, city_id):
        poi = read_json(path)
        if not poi:
            continue
        stats["total"] += 1

        # 已有坐标且不强制 → 跳过（幂等，避免重复计费）
        existing = (poi.get("location") or {}).get("point")
        if existing and not force:
            stats["skipped"] += 1
            continue

        name = poi.get("name", "")
        district_hint = (poi.get("location") or {}).get("district") or ""
        addr_hint = (poi.get("location") or {}).get("address") or ""

        # ① 精确名 + 城市限定
        hit = geo.geocode(name, region=city_name)
        # ★ 异地同名（如"人民公园"全国都有）→ 直接作废。
        #   原写法会把这个错结果保留到二次重试失败时入库，等于写进一个地球另一端的坐标。
        if hit is not None and city_adcode and not _same_city(hit.get("adcode", ""), city_adcode):
            stats["rejected"] += 1
            hit = None
        # ★ 名称对不上 → 同样作废。这是**最隐蔽的一类错**：坐标在市内、adcode 也对，
        #   但其实是另一个点（实测"成都自然博物馆"被解析成了"成都博物馆"，
        #   两者相距 10 公里，靠 adcode 永远查不出来）。
        if hit is not None and not _name_matches(name, hit.get("title", "")):
            stats["mismatch"] += 1
            hit = None

        # ② 没命中 / 刚被作废 → 加区县再试一次
        if hit is None and district_hint and _hit_ok(
            (hit2 := geo.geocode(f"{district_hint}{name}", region=city_name)),
            city_adcode, name,
        ):
            hit = hit2
            stats["retry_hit"] += 1

        # ③ 关键词检索（place/search）—— ★ 店铺类 POI 的唯一解法
        #    「交通茶馆」「磁器口陈麻花」这类小店在 geocoder 里压根没有条目，
        #    但 place search 能捞到。少了这一步，它们会一路掉到地址兜底，
        #    落到「黄桷坪正街」这种街道质心 —— 坐标合法但指向错误，静默错。
        place_title = None
        if hit is None:
            hit = _pick_from_place(name, city_name, city_adcode, district_hint)
            if hit is not None:
                place_title = hit.get("title", "")
                stats["place_hit"] = stats.get("place_hit", 0) + 1

        # ④ 地址兜底：地址比店名精确得多，能救回被模糊匹配掉的点位
        via_address = False
        if hit is None and addr_hint:
            hit3 = geo.geocode(addr_hint, region=city_name)
            # 用地址检索时 title 是路名，不再要求名称匹配 —— 只校验同城
            if hit3 is not None and (not city_adcode or _same_city(hit3.get("adcode", ""), city_adcode)):
                hit = hit3
                via_address = True
                stats["addr_hit"] += 1

        if hit is None:
            stats["failed"] += 1
            stats["failed_list"].append(f"{category}/{path.stem}（{name}）")
            poi[GEOCODED_FLAG] = False
            write_json(path, poi)
            continue

        loc = poi.setdefault("location", {})
        loc["point"] = {"lng": hit["lng"], "lat": hit["lat"], "coordSystem": "GCJ-02"}
        # 地址优先用 POI 草稿里人工写的（可能更准），没有才用接口返回的
        loc["address"] = loc.get("address") or hit.get("address") or ""
        loc["district"] = loc.get("district") or hit.get("district") or ""
        poi[GEOCODED_FLAG] = True
        # 留痕：接口实际命中的是什么，便于人工核对与后续离线判重
        poi["_geocodeTitle"] = hit.get("title", "")
        # ★ 存疑判据：**地址兜底本身就是存疑**（它命中的是路名/镇名质心，不是 POI 本体），
        #   外加名称对不上。
        #   ⚠️ 曾经的写法是 `False if via_address else ...` —— 把**最可疑的一条路径**
        #   判成了"没问题"（实测三个重庆 POI 因此无声地落在街道质心上）。
        poi[SUSPECT_FLAG] = via_address or not _name_matches(name, hit.get("title", ""))
        if poi[SUSPECT_FLAG]:
            stats["suspect"] += 1
        write_json(path, poi)
        stats["hit"] += 1

    return stats


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    only = None
    force = False
    for a in args:
        if a == "--force":
            force = True
        else:
            only = a

    # ★ 先自检 key：腾讯或高德**至少一家**能用即可，别跑一半才失败
    ready, why = geo.ensure_ready()
    if not ready:
        print(f"❌ 没有可用的地图 key —— {why}")
        print("   腾讯：https://lbs.qq.com/ → WebService API → TMAP_WEB_KEY")
        print("   高德：https://lbs.amap.com/ → Web服务 → AMAP_WEB_KEY")
        return 2
    print(geo.status_report())

    targets = [
        (slug, cid, d) for slug, cid, d in iter_city_dirs()
        if only is None or cid == only
    ]
    if not targets:
        print("⚠️ 没有找到城市目录（data/cities/{省}/{市}/city.json）")
        return 1

    for slug, cid, d in targets:
        print(f"\n── {slug}/{cid} ──────────────────────────────")
        st = geocode_city(slug, cid, d, force=force)
        if "error" in st:
            print(f"❌ {st['error']}")
            continue
        print(
            f"  合计 {st['total']} · 精确名 {st['hit'] - st.get('place_hit', 0) - st['addr_hit'] - st['retry_hit']} · "
            f"区县重试 {st['retry_hit']} · 关键词检索 {st.get('place_hit', 0)} · "
            f"地址兜底 {st['addr_hit']} · 异地同名作废 {st['rejected']} · "
            f"名称不符作废 {st['mismatch']} · 存疑 {st['suspect']} · "
            f"跳过（已有坐标）{st['skipped']} · 失败 {st['failed']}"
        )
        if st["failed_list"]:
            print("  失败清单（已标 needs_geocode，不入库）：")
            for x in st["failed_list"]:
                print(f"    · {x}")

        # ★ 坐标重合检测：不同 POI 撞到同一点，至少有一个是错的
        dups = find_duplicate_points(slug, cid)
        if dups:
            print(f"  ⚠️ {len(dups)} 组坐标重合且至少一个存疑（需人工核）：")
            for (lng, lat), members in dups.items():
                print(f"    · {lng},{lat} → {', '.join(members)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
