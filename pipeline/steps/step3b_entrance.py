#!/usr/bin/env python3
"""
pipeline/step3b_entrance.py —— 给 POI 补「到达点 / 入口坐标」

输入：`data/cities/{省}/{市}/pois/{category}/{poiId}.json`
      （要求 step3 已经把 `location.point` 落好 —— 入口只在已有中心点时才有意义）
输出：原地写回 `location.entrance: {lng, lat, coordSystem:"GCJ-02"}`

★ 背景（用户诉求）：行程规划的落点现在直接落到 POI 中心坐标，导致路线**穿园**
  （青城山差 4.0km、熊猫基地差 1.5km）。景点应有出入口，落点一般只到园区入口。
  高德 `place/text`（extensions=all）返回的 `entr_location` 正好是「POI 的到达点」，
  免费、同为 GCJ-02、零坐标转换。

★ 阈值不在这里做：是否真的用入口（入口距中心 > 300m 才用）属于**消费口径**，
  单一真相源在 Web 的 `arrivalOf` 与 Python 的 `arrival_of`。本脚本只负责把
  `entr_location` 原样存下来；距离判断留给消费端，避免两处口径漂移。

两层防错（数据是 3477 个 POI，错一个都是静默错）：
  ① 名称校验：高德返回的首条未必是我们要的点（与 `place_search` 同理），
     用 step3 现成的 `_name_matches_loose`（宽松版）拦"同城同名异物"——
     允许"高德名 ⊆ 库名"（库名带风景区/公园后缀、高德没带），反向要求核心≥4字，
     既救回带后缀的大景区，又不至于把"成都自然博物馆↔成都博物馆"这类误判成匹配。
  ② 距离护栏（分大类）：food/hotspot 入口离中心 > 2km、scenic/culture > 15km
     就当接口顶错了同名点（另一家分店 / 中心取到别处）——
     实测 陈麻婆豆腐 被顶到 14km、钢管厂串串 6km 就是这类，必须拦。
     大园区的入口离质心几公里是正常的（青城山 1.7km、都江堰 0.9km）。

幂等：已有 `location.entrance` 且非 `--force` 时跳过（不重复计费）。
配额：高德按月重置，`amap_entrance` 桶判死即整批停（不浪费剩余额度去打注定失败的请求）。

★⚠️ 2026-10-16：**`v3/place/text` 已被高德风控封禁**（该 key 因「流量异常、
  涉嫌违反服务协议 4.12.3——禁止爬虫/抓取工具」被限权，返回 HTML 拦截页而非 API 响应）。
  本脚本依赖的 `entr_location` 只有 v3 会返回 ⇒ **申诉解封前本命令跑不出新数据**。
  现状不是故障：已落盘的 2799 条入口坐标照常可用，缺的落回 POI 中心
  （消费端 `arrivalOf` 的 >300m 阈值本就允许这个回落）。
  **不要反复重跑** —— 继续打会被判得更像爬虫，反而拖累申诉。

★ 范围（用户 2026-10-05 收窄）：**只给大范围景区补入口** —— `TARGET_SUBTYPES = {"nature","park"}`
  （自然景观 / 公园园林）。其余细类（博物馆/古迹/宗教 + 全部美食/街区/演出）落到中心即可，
  没必要烧高德额度。腾讯无 `entr_location` 等价字段 ⇒ 入口只能走高德，故更该省着用。
  ★ 想扩到古城/大围墙古迹（故宫/平遥这种）就往 `TARGET_SUBTYPES` 加 subtype，一行的事。
"""

from __future__ import annotations

import math
import sys
from datetime import date
from pathlib import Path

if __package__ in (None, ""):                       # 允许 `python step3b_entrance.py` 直接跑
    # ★ 本文件在 pipeline/steps/，往上两级才是仓库根（见 core/layout.py 同处陷阱）
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pipeline.core.layout import (                # noqa: E402
    iter_city_dirs, iter_poi_files, read_json, write_json,
)
from pipeline.providers import amap            # noqa: E402
# ★ 复用 step3 的名称判据（同名异物是最隐蔽的静默错，判据已实测打磨过）。
#   ★★ 这里用 **宽松版** `_name_matches_loose`：允许"高德名 ⊆ 库名"（库名带
#      "风景区/公园"等后缀、高德没带的情况），反向要求核心≥4字；且仍先试严格匹配。
#      安全前提：本脚本已经 `citylimit=true` 锁死城市 + scenic 类 15km 距离护栏，
#      即便名字判松了，顶错同名点也会被距离护栏挡掉（实测会稽山被顶到 20.9km 就是这么拦的）。
from pipeline.steps.step3_geocode import _name_matches_loose  # noqa: E402

#: ★★ 入口离中心超过下面这个数（km）就当接口顶错了同名点 —— 宁可不写。
#: 分大类给不同上限：
#:   · food / hotspot（店、小吃、网红点）：入口本就该贴在中心附近，
#:     超过 2km 几乎可以确定是同名异物（另一家分店 / 腾讯中心取到了别处），
#:     实测 陈麻婆豆腐 被顶到 14km、钢管厂串串 6km、双流老妈兔头 4.8km 都是这类。
#:   · scenic / culture（园区、景区）：园区本身就有几公里纵深，入口（售票口）离
#:     质心几公里是正常的（青城山 1.7km、都江堰 0.9km、西岭雪山可能十几 km）。
MAX_ENTRANCE_OFFSET_KM: dict[str, float] = {
    "food": 2.0, "hotspot": 2.0, "scenic": 15.0, "culture": 15.0,
}

#: ★★ 只给「大范围景区」补入口 —— 用户明确要求：只有范围性景点（自然景观/公园园林）
#: 才需要入口坐标，小景点/美食/街区落到中心即可，没必要烧高德额度。
#: 依据：12 细类里 `nature`(自然景观) / `park`(公园园林) 是天然"园区纵深几公里"的类型，
#: 路线穿园（青城山 4km、熊猫基地 1.5km）正好是这类；`museum`/`historic`/`temple`
#: （博物馆/古迹/宗教）与全部 food/hotspot/culture 都是"到点即到门"，中心≈入口，不补。
#: ★ 想扩到古城/古迹（故宫/平遥这种大围墙）就往这个集合加 subtype，一行的事。
TARGET_SUBTYPES: set[str] = {"nature", "park"}

#: 统计入口相对中心的距离分桶（方便先成都试点时肉眼验收质量）
DIST_BUCKETS_KM = (0.1, 0.3, 1.0, 2.0, 4.0, 15.0)


def _haversine_km(a: dict, b: dict) -> float:
    """两点 GCJ-02 球面距离（km）。同坐标系即可，无需转换。"""
    r = 6371.0088
    lon1, lat1, lon2, lat2 = map(math.radians, (a["lng"], a["lat"], b["lng"], b["lat"]))
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(h)))


def _bucket(km: float) -> str:
    for top in DIST_BUCKETS_KM:
        if km <= top:
            return f"≤{top}km"
    return ">15km"


def entrance_city(slug: str, city_id: str, city_dir: Path, *, force: bool = False) -> dict:
    """给一座城市的全部 POI 补入口坐标，返回统计。"""
    city = read_json(city_dir / "city.json")
    if not city:
        return {"error": f"{city_dir}/city.json 不存在"}

    city_name = city.get("name", city_id)
    stats = {
        "total": 0, "written": 0, "skipped": 0,
        "no_match": 0, "offset_reject": 0, "no_entrance": 0,
        "out_of_scope": 0,
        "quota_stop": False, "dist": {}, "offset_list": [],
    }

    for category, path in iter_poi_files(slug, city_id):
        poi = read_json(path)
        if not poi:
            continue
        loc = poi.get("location") or {}
        point = loc.get("point")
        if not point:
            continue                                    # step3 还没落坐标，跳过
        # ★★ 范围外细类跳过（省高德额度）：只有大范围景区才补入口
        if poi.get("subtype") not in TARGET_SUBTYPES:
            stats["out_of_scope"] += 1
            continue
        stats["total"] += 1

        existing = loc.get("entrance")
        # 已有入口且不强制 → 跳过（幂等）
        if existing and not force:
            stats["skipped"] += 1
            continue

        # ★★ 配额判死即整批停：高德按月配额，别把剩余额度浪费在注定失败的请求上
        if amap.quota_exhausted("amap_entrance"):
            stats["quota_stop"] = True
            return stats

        name = poi.get("name", "")
        # ★ 加兜底：这个调用只走高德，key 一旦被风控封禁，异常会一路冒到 main
        #   把整个脚本炸掉（2026-10-16 封禁后实测：`JSONDecodeError` 直接中断，
        #   连"已落盘多少"的小结都打不出来）。这里按"没入口"处理，
        #   并让下一轮循环开头的 `quota_exhausted` 整批停。
        try:
            hit = amap.poi_entrance(name, region=city_name)
        except Exception as exc:                          # noqa: BLE001
            print(f"  ⚠️ {name}：入口查询失败（{type(exc).__name__}: {exc}）—— 跳过")
            stats["no_entrance"] += 1
            if amap.quota_exhausted("amap_entrance"):
                stats["quota_stop"] = True
                return stats
            continue

        entrance: dict | None = None
        if hit is None:
            stats["no_entrance"] += 1
        # ① 名称校验：接口顶上来的可能根本不是这家（同城同名异物）。
        #    ★★ 用宽松版：库名带"风景区/公园"后缀、高德名更短的情况也能匹配上；
        #       反向要求核心≥4字 + 后续 15km 距离护栏兜底，误救风险可控。
        elif not _name_matches_loose(name, hit.get("name", "")):
            stats["no_match"] += 1
        else:
            km = _haversine_km(point, hit)
            cap = MAX_ENTRANCE_OFFSET_KM.get(category, 2.0)
            if km > cap:
                # ② 距离护栏：超类上限基本是顶错了同名点（另一家分店）
                stats["offset_reject"] += 1
                stats["offset_list"].append(f"{category}/{path.stem}（{name}）{km:.1f}km")
            else:
                entrance = {"lng": hit["lng"], "lat": hit["lat"], "coordSystem": "GCJ-02"}
                stats["written"] += 1
                b = _bucket(km)
                stats["dist"][b] = stats["dist"].get(b, 0) + 1

        # ★ 写回或清掉旧入口：force 重跑时，曾被宽松 50km 护栏写错的入口必须删掉，
        #   否则脏数据会一直躺在 JSON 里（即使消费端 300m 阈值不用它，也是隐患）。
        if entrance:
            loc["entrance"] = entrance
            poi["location"] = loc
            # ★ 数据变了，"最后更新"也得跟着变（2026-10-16 加）。
            #   原来采集只改业务字段、不碰 `updatedAt`，于是「关于」弹窗对外报
            #   的是**采编稿最后重写的那天**，而入口坐标这批刷新它完全不知道 ——
            #   实测 4731 条全被刷新过，日期却停在 10-07。
            poi["updatedAt"] = date.today().isoformat()
            write_json(path, poi)
        elif existing:                          # 原来有入口，但这次被判拒/无命中 → 清掉
            loc.pop("entrance", None)
            poi["location"] = loc
            poi["updatedAt"] = date.today().isoformat()
            write_json(path, poi)

    return stats


def _fmt_dist(dist: dict) -> str:
    if not dist:
        return "（无）"
    order = [f"≤{t}km" for t in DIST_BUCKETS_KM] + [">50km"]
    return " · ".join(f"{k} {dist.get(k, 0)}" for k in order if dist.get(k, 0))


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    only = None
    force = False
    for a in args:
        if a == "--force":
            force = True
        else:
            only = a

    # ★ 先自检 key：至少高德可用（入口只走高德，腾讯无等价字段）
    if not amap.web_key():  # 取不到会抛错，这里只是确认存在
        pass
    try:
        amap.web_key()
    except Exception as e:  # noqa: BLE001
        print(f"❌ 缺少高德 Web 服务 key —— {e}")
        print("   申请：https://lbs.amap.com/ → 控制台 → 应用管理 → 创建应用 → 添加 Key → "
              "服务平台选「Web服务」")
        return 2

    targets = [
        (slug, cid, d) for slug, cid, d in iter_city_dirs()
        if only is None or cid == only
    ]
    if not targets:
        print("⚠️ 没有找到城市目录（data/cities/{省}/{市}/city.json）")
        return 1

    print(f"▶ 入口坐标采集：目标 {len(targets)} 城"
          + ("（--force 全量重采）" if force else "（幂等，已有入口跳过）")
          + " · 范围：nature/park 大范围景区")
    grand = {"written": 0, "skipped": 0, "no_match": 0, "offset_reject": 0,
             "no_entrance": 0, "total": 0, "out_of_scope": 0, "dist": {}}

    for slug, cid, d in targets:
        print(f"\n── {slug}/{cid} ──────────────────────────────")
        st = entrance_city(slug, cid, d, force=force)
        if "error" in st:
            print(f"❌ {st['error']}")
            continue

        grand["total"] += st["total"]
        for k in ("written", "skipped", "no_match", "offset_reject", "no_entrance", "out_of_scope"):
            grand[k] += st[k]
        for b, n in st["dist"].items():
            grand["dist"][b] = grand["dist"].get(b, 0) + n

        print(
            f"  POI {st['total']} · 写入入口 {st['written']} · 已有跳过 {st['skipped']} · "
            f"名称不符 {st['no_match']} · 超距拒 {st['offset_reject']} · 无入口 {st['no_entrance']}"
            f" · 范围外跳过 {st['out_of_scope']}"
        )
        print(f"  入口距离分布：{_fmt_dist(st['dist'])}")
        if st["offset_list"]:
            print("  超距明细：")
            for x in st["offset_list"]:
                print(f"    · {x}")
        if st["quota_stop"]:
            if amap.quota_exhausted("amap_entrance") and amap.dead_apis():
                print("  ⛔ 高德入口接口**已被风控封禁**（返回 HTML 拦截页）—— 整批停止。\n"
                      "     · 这不是配额问题，重跑无用，**请勿反复重试**（会加重风控判定）。\n"
                      "     · 已落盘的数据完好；缺口暂时落回 POI 中心，页面照常可用。\n"
                      "     · 恢复途径：向高德开放平台提工单申诉解封（协议 4.12.3）。\n"
                      "     · 解封前 `location.entrance` 维持现状即可，无需任何操作。")
            else:
                print("  ⛔ 高德入口接口判死（额度/权限受限），整批停止。已落盘的不重复抓，"
                      "待额度恢复后重跑本脚本续跑。")
            break

    print("\n══ 汇总 ═════════════════════════════════════════")
    print(f"  POI 合计 {grand['total']} · 写入入口 {grand['written']} · 已有跳过 {grand['skipped']} · "
          f"名称不符 {grand['no_match']} · 超距拒 {grand['offset_reject']} · 无入口 {grand['no_entrance']}"
          f" · 范围外跳过 {grand['out_of_scope']}")
    print(f"  入口距离分布：{_fmt_dist(grand['dist'])}")
    print("  ★ 提示：>300m 的入口才会被规划链路采用（见 web 的 arrivalOf / py 的 arrival_of）。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
