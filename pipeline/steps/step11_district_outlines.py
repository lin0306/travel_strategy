#!/usr/bin/env python3
"""
pipeline/step11_district_outlines.py —— 抓**每个区「自身」的轮廓**（来自高德），按市打包

产物：`data/_generated/districts-own/{市adcode}.geo.json`

    {
      "adcode": "610100", "name": "西安市",
      "source": "amap", "level": "district",
      "simplifyTolM": 30, "coordDecimals": 5,
      "polygons": { "610104": [ [lng,lat,…], … ], "610113": [ … ], … },
      "fetchedAt": "2026-10-02"
    }

`polygons` 的 key 就是**区 adcode** —— 与 `districts/<市adcode>.geo.json`（腾讯版）完全同形，
所以前端 `loadDistrictFaces()` 只是**逐个区优先读它**，`districtLayer` 零改动。

## 为什么要有它（用户原话：「这个区的轮廓，怎么方方正正的，这轮廓数据不对吧」）

区这一级的"面"原来只有腾讯 `districts/<市>.geo.json`（`getchildren(id=<市>, get_polygon=1)`）。
腾讯给下辖区的轮廓是**极度抽稀**的，实测：

| 区 | 腾讯 | 高德（本步） |
|----|------|-------------|
| 北京 16 个区里的 4 个 | **4 个点**（一个矩形） | 数百点 |
| 西安 莲湖区 `610104` | 5 个点 | 556 点 |
| 西安 雁塔区 `610113` | 15 点 | 1042 点（3 个环） |

而区的面从 `DISTRICT_REVEAL_ZOOM = 9.5` 一直到**点位档（z≥12）**都在画 ——
"方方正正"就是这个原因，不是渲染问题。

高德的 `config/district?subdistrict=0&extensions=all` 给的是**该区自身**的全精度轮廓
（与省/市两级同一个接口、同为 GCJ-02 ⇒ **零坐标转换**）。
★ 实测确认：`subdistrict=1` 时子级**不带 `polyline`**（点数 0），
  所以只能**逐个区**发请求（不能"一个市一次拿全"）—— 2768 个区就是 2768 次请求。

## 抽稀容差为什么是 30m（不是市级的 100m）

区面最深画到 **z≥12**（点位档的参考底），那一档 `1px ≈ 156543 × cos(lat) / 2^12`
（西安 ~34° ⇒ **≈31.7m**）⇒ 30m ≈ **0.95px**，看不出折角。
市级能放到 100m，是因为市的面到 z=9.5 就换级了（1px ≈ 177m）。
实测体积（5 位小数）：莲湖 2.4KB / 雁塔 5.7KB / 北京朝阳 9.9KB。

## 断点续跑 / 配额

按"市文件键"判断完成度：某份包里**要的区齐了**就跳过，只缺几个就只补那几个
（`--force` 才整份重抓）。高德是**月配额**，所以：
  · `--only=<省码|市码>` 只跑其中一部分（省码 = 它下辖全部市）
  · `--limit=N` 本次最多成功抓 N 个区（配额见底时留着下次续）
  · 撞到配额类 infocode 会**当场收工并打印续跑命令**，已落盘的不丢。

用法：
    python pipeline/run.py district-outline                 # 全量（可反复重跑，自动续）
    python pipeline/run.py district-outline --only=610000   # 只跑陕西
    python pipeline/run.py district-outline --only=610100   # 只跑西安
    python pipeline/run.py district-outline --limit=500     # 本次最多 500 个区
"""

from __future__ import annotations

import re
import sys
from datetime import date
from pathlib import Path

if __package__ in (None, ""):
    # ★ 本文件在 pipeline/steps/，往上两级才是仓库根（见 core/layout.py 同处陷阱）
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pipeline.providers import amap                                     # noqa: E402
from pipeline.core.env import MissingKeyError                      # noqa: E402
from pipeline.core.fetch import build_url, get_json                # noqa: E402
from pipeline.core.layout import (                                 # noqa: E402
    DISTRICT_OWN,
    DISTRICTS,
    GENERATED,
    read_json,
    write_json,
)

# ★★ 抽稀与自检的口径**必须与市级那一份（step10）一致**，所以直接复用它的实现 ——
#    几何算法两处各写一份会立刻分叉（一边改了 cos 修正、另一边没改）。
#    容差是**参数**，所以"市级 100m / 区级 30m"这个差别不会被这次复用抹掉。
from pipeline.steps.step10_city_outlines import (                   # noqa: E402
    BBOX_OVERLAP_MIN,
    COORD_DECIMALS,
    LAT_RANGE,
    LNG_RANGE,
    _bbox,
    _overlap,
    trim_ring,
)

TREE_PATH = GENERATED / "district-tree.json"

#: 抽稀容差（米）。★ 见文件头：30m ≈ 0.95px @z=12（区面最深那一档）
SIMPLIFY_TOL_M = 30.0


def bundle_file(parent: str) -> Path:
    """区面按**"市文件键"**打包。键 = 市码；直辖市/特区没有中间市层，键 = 省码。"""
    return DISTRICT_OWN / f"{parent}.geo.json"


# ── 目标 ──────────────────────────────────────────────────────────

def targets() -> list[dict]:
    """这一级要抓哪些区，以及它们分别装进哪一份包。

    @return `[{parent, parentName, kind, nodes: [(区adcode, 区名), …]}]`

    ★★ **树只到市这一级**（`district-tree.json` 的市节点**没有 `children`**，区列表住在
      `subdistricts/<市>.json` 分片里）⇒ 目标不能从树上取。以**腾讯那份包的成员**为准：
      它就是"现在前端画得出来的那一批面"，也正是要换掉的对象。

    ★★ 文件键（= 产物文件名）由**树的形状**决定，不用 adcode 段式猜 ——
      段式在直辖市上是错的（北京东城区 `110101` 会推出 `110100`，而它的包挂在省码 `110000` 下）：
        · `isCity` 的省级单位（北京/天津/上海/重庆/中国台湾/中国香港/中国澳门）
          ⇒ 没有中间市层，键 = **省码**
        · 其余省 ⇒ 键 = **市码**（该省 children 里 level == `city` 的节点）
      ★ 只收**腾讯那份存在**的键：没有腾讯包的地方现在一个面也不画，先不花配额。
    """
    try:
        tree = read_json(TREE_PATH)
    except Exception:                                          # noqa: BLE001
        return []

    def name_of(v: object) -> str:
        return str(v or "")

    # ① 哪些键的成员是**区**（而不是市）：市码 ∪「isCity 的省码」
    keys: dict[str, str] = {}
    for p in tree.get("provinces") or []:
        ad = str(p.get("adcode") or "")
        if not ad:
            continue
        pname = name_of(p.get("fullname") or p.get("name") or ad)
        if p.get("isCity"):
            keys[ad] = pname
            continue
        for c in p.get("children") or []:
            cid = str(c.get("adcode") or "")
            if cid:
                keys[cid] = name_of(c.get("fullname") or c.get("name") or cid)

    # ② 逐键读腾讯那份包，成员就是区；区名从 `subdistricts/<键>.json` 拿（拿不到就算了，
    #    它只进日志 —— 真正的名字由高德响应里的 `name` 兜底）
    out: list[dict] = []
    for parent in sorted(keys):
        path = DISTRICTS / f"{parent}.geo.json"
        if not path.exists():
            continue
        try:
            polys = read_json(path).get("polygons") or {}
        except Exception:                                      # noqa: BLE001
            continue
        if not isinstance(polys, dict) or not polys:
            continue
        names: dict[str, str] = {}
        sub_path = GENERATED / "subdistricts" / f"{parent}.json"
        if sub_path.exists():
            # ★ 键是 **`children`**（与全仓库另外 15 处一致），不是 `rows` ——
            #   `rows` 是 `tmap.py` 里腾讯 API **原始响应**的形状，不是落盘分片的形状。
            #   2026-10-02 修：原来读 `rows` ⇒ 区名全空 ⇒ `run_bundle` 里「按名字对齐」
            #   那条兜底对**所有**城市静默失效（中国香港 18 个区全靠它：腾讯 8111xx /
            #   高德 8100x，码不同而名字一样），症状 = 抓取全失败 + 前端悄悄退回方块。
            try:
                for r in read_json(sub_path).get("children") or []:
                    if isinstance(r, dict) and r.get("adcode"):
                        names[str(r["adcode"])] = name_of(r.get("name"))
            except Exception:                                  # noqa: BLE001
                names = {}
        out.append({"parent": parent, "parentName": keys[parent],
                    "kind": "self-city" if parent.endswith("0000") else "city",
                    "nodes": sorted((str(k), names.get(str(k), "")) for k in polys)})
    return out


def _existing(parent: str) -> dict:
    p = bundle_file(parent)
    if not p.exists():
        return {}
    try:
        d = read_json(p)
    except Exception:                                          # noqa: BLE001
        return {}
    polys = d.get("polygons")
    return polys if isinstance(polys, dict) else {}


# ── 单个区 ────────────────────────────────────────────────────────

#: 名字归一：去掉行政级别后缀。★ "九龙" vs "九龙城区"（腾讯 / 高德对同一个区叫法不同）
#: 就是靠这个 + 前缀匹配对齐的 —— 与前端 `sameDistrict()` 是同一类容差。
_NAME_TAIL = re.compile(r'(特别行政区|自治区|自治县|自治州|城区|区|市|县|旗)$')


def _name_key(s: str) -> str:
    return _NAME_TAIL.sub('', (s or '').strip())


def _same_name(a: str, b: str) -> bool:
    ka, kb = _name_key(a), _name_key(b)
    if not ka or not kb:
        return False
    return ka == kb or ka.startswith(kb) or kb.startswith(ka)


def amap_children(parent: str) -> list[tuple[str, str]]:
    """问高德要某个行政区的**下一级名单**（`[(adcode, name)]`，不取边界）。

    ★ 只为"按名字对齐"服务：腾讯的区码高德**不认**（实测中国香港：腾讯是
      `811100 / 811200 / …`，高德是 `810001 … 810018`，两边**名字一样、码完全不同**）
      ⇒ 按码查会 18 个区全部失败，然后前端静默退回腾讯那份（还是方块）。
    """
    data = get_json(build_url(amap.BASE, {
        "key": amap.web_key(),
        "keywords": parent,
        "subdistrict": 1,
        # ★ base 就够（只要名单）—— 别用 all，那会把 18 个子级的边界一起拉下来白花流量
        "extensions": "base",
        "output": "JSON",
    }))
    ds = (data.get("districts") or [{}])[0]
    return [(str(k.get("adcode") or ""), str(k.get("name") or ""))
            for k in (ds.get("districts") or []) if k.get("adcode")]


def match_child(name: str, kids: list[tuple[str, str]]) -> str | None:
    """在这份名单里按**名字**找一个区，返回它的 adcode（找不到返回 `None`）。"""
    return next((ad for ad, nm in kids if _same_name(name, nm)), None)


def fetch_district(adcode: str, name: str, *, ref_rings: list[list[float]], simplify: bool) -> dict | None:
    """抓一个区自身的轮廓。@return `{status, adcode, name, rings, points}`

    @param ref_rings 腾讯那份里**同一个区**的环（粗轮廓），只用来做位置自检；
                     空列表 = 没有参考，跳过这项检查。
    """
    try:
        got = amap.district_boundary(adcode, name=name)
    except MissingKeyError:
        raise
    except RuntimeError as exc:
        # ★★ 配额/权限类错误**必须往上抛**：这一批有两三千个区，把"额度没了"当成
        #   "这一个区没抓到"继续跑，等于把剩下的请求全部打空（而且高德是月配额，
        #   打空的每一次都是白掉的）。`main` 会在这里收工并打印续跑命令。
        msg = str(exc)
        if '额度' in msg or '权限' in msg:
            raise
        print(f"      ⚠️ {name or adcode}({adcode}) 抓取失败：{exc}")
        return {"status": "failed", "why": "抓取失败"}

    rings = got["rings"]
    if not rings:
        print(f"      ⚠️ {name or adcode}({adcode}) 没拿到轮廓点 —— 不写盘（前端会退回腾讯那份）")
        return {"status": "failed", "why": "没有轮廓点"}

    lngs = [r[i] for r in rings for i in range(0, len(r), 2)]
    lats = [r[i] for r in rings for i in range(1, len(r), 2)]
    if (min(lngs) < LNG_RANGE[0] or max(lngs) > LNG_RANGE[1]
            or min(lats) < LAT_RANGE[0] or max(lats) > LAT_RANGE[1]):
        print(f"      ✗ {name}({adcode}) 坐标越界（经 {min(lngs):.2f}~{max(lngs):.2f}、"
              f"纬 {min(lats):.2f}~{max(lats):.2f}）—— 不写盘")
        return {"status": "failed", "why": "坐标越界"}

    # ★ 位置自检：拿**腾讯同一区的粗轮廓**当参考（它在 `<市>.geo.json` 里，不是单独一个文件）。
    #   用 bbox 重合系数而不是中心距/IoU —— 理由见 step9/step10（腾讯给的矩形框其实 ≈
    #   真实外接框，IoU 会被"矩形比真形状大"压得很低，那是参考值自己的形状问题）。
    if ref_rings:
        ov, iou = _overlap(_bbox(rings), _bbox(ref_rings))
        if ov < BBOX_OVERLAP_MIN:
            print(f"      ✗ {name}({adcode}) 与腾讯那份的包围框几乎不挨着"
                  f"（重合系数={ov:.2f} · IoU={iou:.2f}）—— 不写盘")
            return {"status": "failed", "why": "包围框不重合"}

    raw = sum(len(r) for r in rings) // 2
    rings = [trim_ring(r, SIMPLIFY_TOL_M, COORD_DECIMALS) if simplify
             else trim_ring(r, 0, COORD_DECIMALS) for r in rings]
    pts = sum(len(r) for r in rings) // 2
    return {"status": "ok", "adcode": adcode, "name": got["name"] or name,
            "rings": rings, "points": pts, "raw": raw}


# ── 一个包（= 一个市 / 直辖市）────────────────────────────────────

def run_bundle(t: dict, *, force: bool, simplify: bool, budget: list[int]) -> dict:
    """处理一个包，返回统计。`budget` 是**可变**的剩余额度（[n] 形式，跨包共享）。"""
    parent, pname = t["parent"], t["parentName"]
    polys = {} if force else _existing(parent)
    stats = {"written": 0, "failed": 0, "skipped": 0}

    # 腾讯那份（同一个父键）—— 逐区取来当"位置自检"的参考。只读一次，别在循环里重复读盘。
    ref: dict = {}
    ref_path = DISTRICTS / f"{parent}.geo.json"
    if ref_path.exists():
        try:
            ref = read_json(ref_path).get("polygons") or {}
        except Exception:                                      # noqa: BLE001
            ref = {}
    # 高德这一级的名单（只在"按码查不到"时才去取 —— 见下面的按名字对齐）
    kids: list[tuple[str, str]] | None = None

    for ad, nm in t["nodes"]:
        if polys.get(ad):
            stats["skipped"] += 1
            continue
        if budget[0] <= 0:
            break
        r = fetch_district(ad, nm, ref_rings=ref.get(ad) or [], simplify=simplify)
        budget[0] -= 1
        if r["status"] != "ok":
            # ★★ 兜底：**按名字对齐**。腾讯的区码高德可能不认（中国香港就是这样：
            #   腾讯 811100… / 高德 810001…，名字一样、码完全不同）。
            #   拿父级的名单按名字找一次，找到就用**高德那个码**去取轮廓，
            #   但**存回腾讯那个键**（前端按 adcode 查表，契约不能变）。
            if kids is None:
                try:
                    kids = amap_children(parent)
                except Exception as exc:                       # noqa: BLE001
                    print(f"      ⚠️ {pname}({parent}) 取高德下级名单失败：{exc}")
                    kids = []
            alt = match_child(nm, kids)
            if alt and alt != ad:
                r2 = fetch_district(alt, nm, ref_rings=ref.get(ad) or [], simplify=simplify)
                budget[0] -= 1
                if r2["status"] == "ok":
                    print(f"      · {nm}({ad}) 高德用的是 {alt} —— 按名字对齐成功，存回 {ad}")
                    r = {**r2, "adcode": ad}
        if r["status"] == "ok":
            polys[ad] = r["rings"]
            stats["written"] += 1
        else:
            stats["failed"] += 1

    if not polys:
        return stats
    pts = sum(len(r) for rings in polys.values() for r in rings) // 2
    write_json(bundle_file(parent), {
        "adcode": parent,
        "name": pname,
        "source": "amap",
        "level": "district",
        "simplifyTolM": SIMPLIFY_TOL_M if simplify else 0,
        "coordDecimals": COORD_DECIMALS,
        "polygons": polys,
        "fetchedAt": date.today().isoformat(),
    }, compact=True)
    if stats["written"]:
        print(f"    → {pname}({parent})：{len(polys)} 个区 / {pts} 点"
              f"（{bundle_file(parent).stat().st_size / 1024:.0f} KB）")
    return stats


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    force = "--force" in argv
    simplify = "--no-simplify" not in argv
    only: set[str] = set()
    limit: int | None = None
    for a in argv:
        if a.startswith("--only="):
            only = {x.strip() for x in a.split("=", 1)[1].split(",") if x.strip()}
        elif a.startswith("--limit="):
            try:
                limit = int(a.split("=", 1)[1])
            except ValueError:
                print("--limit 要给整数")
                return 2

    ts = targets()
    if only:
        # 省码（`610000`）＝ 该省下辖全部市；市码（`610100`）＝ 这一个包；
        # 直辖市的包键就是省码，两种写法都命中。
        ts = [t for t in ts if t["parent"] in only
              or t["parent"][:2] + "0000" in only]
    if not ts:
        print("拿不到目标 —— 先跑 `python pipeline/run.py district` 生成区划树")
        return 1

    total_nodes = sum(len(t["nodes"]) for t in ts)
    already = sum(1 for t in ts for ad, _ in t["nodes"] if _existing(t["parent"]).get(ad))
    print(f"═══ 区自身轮廓（高德）· {len(ts)} 个包 / {total_nodes} 个区"
          f"（已有 {already} 个）═══")
    for k, v in amap.key_status():
        print(f"  key {k}: {v}")
    DISTRICT_OWN.mkdir(parents=True, exist_ok=True)

    budget = [limit if limit is not None else 10 ** 9]
    done = failed = skipped = 0
    bad: list[str] = []
    try:
        for t in ts:
            st = run_bundle(t, force=force, simplify=simplify, budget=budget)
            done += st["written"]
            failed += st["failed"]
            skipped += st["skipped"]
            if st["failed"]:
                bad.append(f"{t['parentName']}({t['parent']}) ×{st['failed']}")
            if budget[0] <= 0:
                print("\n  ⏸ 达到 --limit 上限，收工（已落盘的都已写入）")
                break
    except MissingKeyError:
        print("\n" + amap.missing_key_hint())
        return 2
    except RuntimeError as exc:                     # 配额类错误（amap 里已分拣）
        print(f"\n  ⏸ 中断：{exc}")
        print(f"  已落盘的都在 {DISTRICT_OWN}；明天/下个月直接重跑同一条命令即可续抓")
        return 3

    print("\n═══ 小结 ═══")
    print(f"  本次写入 {done} 个区 · 跳过（已有）{skipped} 个 · 失败 {failed} 个")
    if bad:
        print("  有失败的包：" + "、".join(bad[:12]))
    print(f"\n  产物目录：{DISTRICT_OWN}")
    print("  前端 `loadDistrictFaces()` 会**逐区优先**读它，缺了退回腾讯的 districts/。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
