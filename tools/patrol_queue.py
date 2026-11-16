#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""内容巡检队列 —— 决定「这一轮去核实哪座城的哪几个点位」，并承接核实后的落改动。

## 和 audit_history.py 的分工（别混）

| | audit_history.py | patrol_queue.py |
|---|---|---|
| 查什么 | **字段级**：JSON 坏了没、credit 对不对、索引过期没 | **内容级**：这个景点还开着吗、门票变了吗、图是不是它 |
| 谁判 | 脚本自己（客观可复现） | **会话里的 AI**（WebSearch + 看图），脚本只排班与记账 |
| 频率 | 每轮全库，2.5 秒 | 每轮 1 城 6~8 个点位，约 10~20 分钟 |
| 产出 | BASELINE / NEW_ISSUES 报告 | 改数据、重抓图、待入库线索 |

## 为什么要有排班表

全库 4900 个点位**没有人回看过**：`updatedAt` 停在入库那天，景点可能已经闭馆修缮、
门票从 60 涨到 80、地铁站改名、图库里那张封面其实是隔壁的塔。这类问题
`check_app.py`（代码结构）和 `audit_history.py`（字段格式）**一条都抓不到** ——
只能联网核、只能看图。所以必须有队列：谁最久没查过，谁先查。

排班依据（`_risk` 的打分，可调）：
- `_geocodeSuspect` +3 —— 坐标存疑，最可能是"异地同名"错位
- 无图 `+2` / 缺 `updatedAt` +2 —— 数据不完整
- `updatedAt` 越老分越高（30 天 +1，封顶 +4）
- `popularity` 越高越先查（封顶 +2）—— 热门点位错一天成本最高
- 30 天内已查过（`_patrol.at`）⇒ **直接排除**，避免同一批反复查

## 子命令

```
patrol_queue.py next [--n 8]                    # 选城 + 待核实点位（任务的唯一入口）
patrol_queue.py done <city> --checked a,b --fixed 2 --new 1 --note "..."
patrol_queue.py status                          # 全库巡检进度
patrol_queue.py fix --city <slug> --poi <id> --set ticket=免费 --source <url> --reason "..." [--dry]
```

`fix` 只改**白名单字段**（见 `FIXABLE`），每次必带 `--source` 与 `--reason`，并写 `_patrol`
留痕 + `sources[]` 溯源 + `updatedAt`。改不了的一律不碰 —— 删条目、改分类属于破坏性操作。

★★ 白名单在 2026-11-09 扩容过（`district` / `tips` / `coverIndex` / `geocodeTitle`）。
理由：巡检实跑 5 轮发现，「A 档证据够了却改不了」是「每轮都要人复核」的最大来源 ——
区归属、贴士矛盾、封面排序、坐标反查名全都是**判断清楚、证据硬**的，却因为工具没这个
字段被推给人。这类必须自动化，人只该处理不可逆的取舍（见 `patrol_findings.py` 的 TODO）。
★ 2026-11-10 再加 `popularity`：热点巡检发现「被曝光避雷 / 突然爆火」时，
  只有它能表达"这点位在排序里该降还是该升"，塞进 tips 不影响排序。

账本 `_tmp/patrol/ledger.json`（不是产物目录）；改动流水 `_tmp/patrol/patches-YYYY-MM-DD.jsonl`
（可回滚依据，append-only）。
"""
from __future__ import annotations

import json
import re
import sys
from datetime import date, datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
from tools import patrol_findings                            # noqa: E402  （排班要看未结发现）

CITIES = REPO / "data" / "cities"
OUT = REPO / "_tmp" / "patrol"
LEDGER = OUT / "ledger.json"
RECHECK_DAYS = 30          # 30 天内查过的不再进队列

#: `fix` 能改的字段 → (写入路径, 中文名, 类型)。**故意不包含** category / subtype / id / images：
#: 分类改错要重建索引、图片归看图链路，都不是「一条命令改个字符串」能了事的。
#: `level`（景区 A 级）也不在：POI 侧根本没有这个字段，写进去是空写（等级变化走 `findings --due`，
#: 等正式授牌那天再复查）。
FIXABLE = {
    "ticket": (("practical", "ticket"), "门票", "str"),
    "hours": (("practical", "openHours"), "开放时间", "str"),
    "address": (("location", "address"), "地址", "str"),
    "transport": (("location", "transportTip"), "交通提示", "str"),
    "name": (("name",), "名称", "str"),
    "summary": (("summary",), "一句话简介", "str"),
    "tips": (("tips",), "贴士（用 | 分隔多条，整体替换）", "list"),
    "coverIndex": (("coverIndex",), "封面序号", "int"),
    "geocodeTitle": (("_geocodeTitle",), "坐标反查名（只改名字，不动坐标）", "str"),
    "district": (("location", "district"), "所属区（自动同步 adcode）", "district"),
    #: ★ 2026-11-10 加：热点巡检（每小时任务 P6.5）发现「被曝光/评分暴跌/上榜爆火」时，
    #: 热度是唯一能表达"该点位在排序里重不重要"的字段（前端按它排同分顺序，
    #: 也决定低 zoom 下标注避让的优先级）。没有它，避雷信息只能塞 tips，排序照旧。
    "popularity": (("popularity",), "热度（0-100）", "int"),
}


# ─────────────────────────── 数据读取 ───────────────────────────

def _cities() -> list[tuple[str, str, Path]]:
    """(slug, 中文名, 城市目录) —— 只认有 POI 的城。"""
    out = []
    for cj in sorted(CITIES.glob("*/*/city.json")):
        try:
            d = json.loads(cj.read_text(encoding="utf-8"))
        except Exception:                                          # noqa: BLE001
            continue
        slug = cj.parent.name
        out.append((slug, d.get("name") or slug, cj.parent))
    return out


def _pois(city_dir: Path) -> list[tuple[Path, dict]]:
    rows = []
    for f in sorted(city_dir.glob("pois/*/*.json")):
        try:
            rows.append((f, json.loads(f.read_text(encoding="utf-8"))))
        except Exception:                                          # noqa: BLE001
            pass
    return rows


def load() -> dict:
    if LEDGER.exists():
        try:
            return json.loads(LEDGER.read_text(encoding="utf-8"))
        except Exception:                                          # noqa: BLE001
            pass
    return {"cities": {}, "updatedAt": None}


def save(led: dict) -> None:
    led["updatedAt"] = datetime.now().strftime("%Y-%m-%dT%H:%M")
    OUT.mkdir(parents=True, exist_ok=True)
    LEDGER.write_text(json.dumps(led, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


# ─────────────────────────── 排班 ───────────────────────────

def _days_ago(s: str | None) -> int:
    if not s:
        return 9999
    try:
        return max(0, (date.today() - date.fromisoformat(str(s)[:10])).days)
    except Exception:                                              # noqa: BLE001
        return 9999


def _risk(poi: dict, find: dict | None = None) -> float:
    """越该查分越高。看着"完备"的点位也会因为 updatedAt 老而浮上来。

    `find` 来自 `patrol_findings.open_index()` —— 上一轮自己标过的问题
    （`{open: n, due: n}`）。**这是闭环的关键**：没有这一项，巡检就是
    「发现 → 存进 json → 再也不看」，同一批疑点永远不会被回头复核。
    """
    score = 0.0
    if find:
        #: 有未结发现 ⇒ 优先回头（自己挖的坑自己填）。
        #: 到期（该改了）> 待仲裁（候选打架）> 一般未结 —— 三类分开计分，
        #: 否则「到期 3 天没动」和「上一轮刚记的一条」会排在同一档。
        score += (5 * min(2, int(find.get("open") or 0))
                  + 6 * int(find.get("due") or 0)
                  + 4 * int(find.get("arb") or 0))
    if poi.get("_geocodeSuspect"):
        score += 3
    if (poi.get("_patrol") or {}).get("droppedImages"):
        # ★ 明确「图被判定挂错、已删掉、等重抓」的点位 —— 比泛泛的无图更急：
        #   它曾经有图，说明素材是找得到的，缺的只是一次正确抓取。
        score += 4
    if not poi.get("images"):
        score += 2
    if not poi.get("updatedAt"):
        score += 2
    score += min(4.0, _days_ago(poi.get("updatedAt")) / 30.0)
    try:
        score += min(2.0, float(poi.get("popularity") or 0) / 25.0)
    except (TypeError, ValueError):
        pass
    return score


def cmd_next(argv: list[str]) -> int:
    n = 8
    if "--n" in argv:
        i = argv.index("--n")
        try:
            n = max(1, min(20, int(argv[i + 1])))
        except (IndexError, ValueError):
            pass
    led = load()
    #: 顺手建目录：任务里 `findings-*.json` / `suggest-*.json` / `patches-*.jsonl`
    #: 都由 AI 现写，`_tmp` 被清过就会写失败。
    OUT.mkdir(parents=True, exist_ok=True)
    meta = {slug: (name, d) for slug, name, d in _cities()}
    if not meta:
        print("NO_CITY")
        return 0

    # 选城：**先看有没有到期/待仲裁的旧账**，再按最久没查过排；同分按 POI 数降序。
    # ★ 只按「最久没查」选会出一个死角：待办挂在刚查过的城，那城 30 天内不会再被选中，
    #   到期项就永远等不到执行 —— 「到点就更新」变成「到点就记着，永不执行」。
    ranked = []
    for slug, (name, d) in meta.items():
        rows = _pois(d)
        if not rows:
            continue
        rec = led["cities"].get(slug) or {}
        pend = patrol_findings.open_index(slug)
        n_urgent = sum((v.get("due") or 0) + (v.get("arb") or 0) for v in pend.values())
        #: ★ `-_days_ago` 的负号不能省：升序排 + 取第一个，正着写会选中**最近查过的城**
        #:   （成都连查 8 轮就是这么来的，另外 82 城一直饿着）。
        ranked.append((-n_urgent, -_days_ago(rec.get("lastChecked")),
                       -len(rows), slug, name, rows, rec))
    if not ranked:
        print("NO_CITY")
        return 0
    ranked.sort(key=lambda r: r[:4])
    _neg_urgent, _neg_n, _days, slug, name, rows, rec = ranked[0]

    find = patrol_findings.open_index(slug)     #: 上一轮留下的未结发现 ⇒ 优先回头
    done_before = set(rec.get("checked") or [])

    def _eligible(p: dict) -> bool:
        #: ★ 有未结发现的点位**不受「查过就歇 30 天」约束**。否则会出现最难看的死角：
        #:   上一轮刚标了「这张图是隔壁的塔」，下一轮排班直接把它排除 30 天，
        #:   发现永远没人回头核 —— 这就是第一版「发现问题→存起来→再也不看」的机制成因。
        if find.get(str(p.get("id"))):
            return True
        return (p.get("id") not in done_before
                and _days_ago((p.get("_patrol") or {}).get("at")) >= RECHECK_DAYS)

    pool = [(f, p) for f, p in rows if _eligible(p)]
    if not pool:                       # 全查过一轮 ⇒ 重新开一轮，别让城饿死
        pool = [(f, p) for f, p in rows]
        done_before = set()

    def _key(fp: tuple) -> tuple:
        return (-_risk(fp[1], find.get(str(fp[1].get("id")))),
                str(fp[1].get("updatedAt") or ""))

    #: ★ 这一步不能少：`pool` 出来是**目录扫描顺序**（文件名按字母），不排序的话
    #:   `sticky[:cap]` 等于「按文件名取前 3 个」，到期项和待仲裁项照样被挤掉。
    pool.sort(key=_key)

    def _finfo(fp: tuple) -> dict:
        return find.get(str(fp[1].get("id"))) or {}

    #: ★ 三档分开排队，**不能只靠打分混排**：一条"到期"（+6）打不过"两条普通未结"
    #:   （5×2=10），到期项照样被挤到名额之外 —— 用户要的「到点就更新」就落不了地。
    urgent = [fp for fp in pool if _finfo(fp).get("due") or _finfo(fp).get("arb")]
    sticky = [fp for fp in pool if _finfo(fp) and fp not in urgent]
    fresh = [fp for fp in pool if not _finfo(fp)]
    #: 到期/待仲裁先吃名额（最多一半，防止一座城全是有问题的点位把新点饿死）；
    #: 剩下的名额仍然「旧账一半、新点一半」。
    cap = max(1, n // 2)
    head = urgent[:cap]
    rest = n - len(head)
    targets = (head + sticky[:max(0, (rest + 1) // 2)]
               + fresh[:max(0, rest - len(sticky[:(rest + 1) // 2]))])[:n]

    noimg = sum(1 for _f, p in rows if not p.get("images"))
    print(f"CITY={slug}")
    print(f"NAME={name}")
    print(f"TOTAL={len(rows)}")
    print(f"CHECKED={len(done_before)}")
    print(f"LAST_CHECKED={rec.get('lastChecked') or '(never)'}")
    print(f"ROUND={int(rec.get('rounds') or 0) + 1}")
    print(f"TARGETS={len(targets)}")
    print(f"NOIMG={noimg}")
    print(f"OPEN_FINDINGS={sum(v['open'] for v in find.values())}")
    print(f"DUE_FINDINGS={sum(v.get('due') or 0 for v in find.values())}")
    print(f"ARB_FINDINGS={sum(v.get('arb') or 0 for v in find.values())}")
    for f, p in targets:
        imgs = len(p.get("images") or [])
        fn = find.get(str(p.get("id"))) or {}
        flag = "/".join(x for x in (
            "SUGEO" if p.get("_geocodeSuspect") else "",
            "DUE" if fn.get("due") else "",
            "ARB" if fn.get("arb") else "") if x)
        if fn:
            tags = []
            if fn.get("due"):
                tags.append(f"{fn['due']} 条**已到期，本轮必须改**")
            if fn.get("arb"):
                tags.append(f"{fn['arb']} 条待权威仲裁")
            print(f"  ★ {p.get('id')} 有 {fn['open']} 条未结发现"
                  f"{'（' + '；'.join(tags) + '）' if tags else ''}"
                  f" ⇒ 先跑 `patrol_findings.py list --city {slug} --poi {p.get('id')}`")
        print(f"POI {p.get('id')}|{p.get('name')}|{p.get('updatedAt') or '-'}|"
              f"{imgs}|{p.get('location', {}).get('address', '')[:40]}|{flag}|{f.as_posix()}")
    return 0


def cmd_done(argv: list[str]) -> int:
    if not argv:
        print("用法：patrol_queue.py done <city> [--checked a,b] [--fixed N] [--new N] [--note ...]")
        return 2
    slug = argv[0]

    checked = [x for x in re.split(r"[,\s]+", _opt(argv, "--checked")) if x]
    led = load()
    rec = led["cities"].setdefault(slug, {"checked": [], "rounds": 0, "fixed": 0, "newFound": 0})
    merged = list(dict.fromkeys(list(rec.get("checked") or []) + checked))
    rec.update({"checked": merged, "rounds": int(rec.get("rounds") or 0) + 1,
                "lastChecked": date.today().isoformat(),
                "fixed": int(rec.get("fixed") or 0) + int(_opt(argv, "--fixed", "0") or 0),
                "newFound": int(rec.get("newFound") or 0) + int(_opt(argv, "--new", "0") or 0),
                "note": _opt(argv, "--note")})
    save(led)
    print(f"DONE {slug} checked={len(merged)} round={rec['rounds']} "
          f"fixed={rec['fixed']} new={rec['newFound']}")
    return 0


def cmd_status(argv: list[str]) -> int:
    led = load()
    meta = {slug: (name, d) for slug, name, d in _cities()}
    rows = []
    for slug, (name, d) in meta.items():
        n = len(list(d.glob("pois/*/*.json")))
        rec = led["cities"].get(slug) or {}
        rows.append((_days_ago(rec.get("lastChecked")), slug, name, n,
                     len(rec.get("checked") or []), rec.get("rounds") or 0))
    rows.sort(reverse=True)
    never = sum(1 for r in rows if r[0] >= 9999)
    print(f"CITIES={len(rows)} NEVER_CHECKED={never} "
          f"CHECKED_POIS={sum(r[4] for r in rows)}")
    for age, slug, name, n, ck, rd in rows[:12]:
        print(f"  {slug:14s} {name[:8]:10s} POI={n:3d} 查过={ck:3d} 轮次={rd:2d} "
              f"{(str(age) + ' 天前') if age < 9999 else '从未'}")
    return 0


# ─────────────────────────── 落改动 ───────────────────────────

def _opt(argv: list[str], key: str, default: str = "") -> str:
    return argv[argv.index(key) + 1] if key in argv and argv.index(key) + 1 < len(argv) else default


def _find_field(fix_key: str) -> str:
    """`fix` 的字段名 → findings 的字段名（只有两处不一致，见 FIELD_OK）。"""
    return {"coverIndex": "cover", "geocodeTitle": "point"}.get(fix_key, fix_key)


def _set_path(obj: dict, path: tuple[str, ...], value) -> None:
    cur = obj
    for k in path[:-1]:
        cur = cur.setdefault(k, {})
    cur[path[-1]] = value


def _get_path(obj: dict, path: tuple[str, ...]):
    cur = obj
    for k in path:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(k)
    return cur


def _districts(slug: str) -> dict[str, str]:
    """本城真实区表 `{区名: adcode}` —— 从 `data/_generated/subdistricts/` 读，不猜。

    ★ 为什么要查表而不是让 AI 直接给 adcode：手打 6 位码迟早写错一位，
      错位后 `poiCount` 会算到隔壁区、下钻点进去空空如也，而且**不报错**。
    """
    for cj in CITIES.glob("*/*/city.json"):
        if cj.parent.name != slug:
            continue
        try:
            city_ad = str(json.loads(cj.read_text(encoding="utf-8")).get("adcode") or "")
            kids = json.loads((REPO / "data" / "_generated" / "subdistricts" /
                               f"{city_ad}.json").read_text(encoding="utf-8")).get("children") or []
        except Exception:                                      # noqa: BLE001
            return {}
        return {str(k.get("name") or "").strip(): str(k.get("adcode") or "") for k in kids}
    return {}


def cmd_fix(argv: list[str]) -> int:
    slug, poi_id = _opt(argv, "--city"), _opt(argv, "--poi")
    pairs = [argv[i + 1] for i, a in enumerate(argv)          # --set 可重复出现
             if a == "--set" and i + 1 < len(argv)]
    source, reason = _opt(argv, "--source"), _opt(argv, "--reason")
    dry = "--dry" in argv
    if not slug or not poi_id or not pairs:
        print("用法：patrol_queue.py fix --city <slug> --poi <id> --set ticket=免费 "
              "[--set hours=08:00-17:00] --source <url> --reason \"...\" [--dry]")
        return 2
    if not source.startswith("http"):
        print("★ 必须给 --source（真搜到的链接），不做无出处的编造")
        return 2
    if not reason:
        print("★ 必须给 --reason（为什么改），半年后才知道这条是谁改的")
        return 2

    hit = list((CITIES.glob(f"*/*/pois/*/{poi_id}.json")))
    hit = [p for p in hit if f"/{slug}/" in p.as_posix()]
    if not hit:
        print(f"找不到点位 {slug}/{poi_id}")
        return 1
    path = hit[0]
    poi = json.loads(path.read_text(encoding="utf-8"))
    today = date.today().isoformat()
    changes, touched = [], []
    for pair in pairs:
        if "=" not in pair:
            print(f"忽略非法 --set：{pair}")
            continue
        key, val = pair.split("=", 1)
        key = key.strip()
        if key == "point":
            try:
                lat, lng = [float(x) for x in val.split(",")]
            except ValueError:
                print(f"point 格式应为 lat,lng：{val}")
                return 2
            old = dict(poi.get("location", {}).get("point") or {})
            poi.setdefault("location", {})["point"] = {
                "lat": lat, "lng": lng, "coordSystem": old.get("coordSystem", "GCJ-02")}
            changes.append({"field": "point", "old": old, "new": [lat, lng]})
            touched.append("point")
            continue
        if key not in FIXABLE:
            print(f"★ 不允许改 {key}（白名单：{'/'.join(FIXABLE)}/point）")
            return 2
        tgt, label, typ = FIXABLE[key]
        old = _get_path(poi, tgt)
        if typ == "district":
            # 只收中文区名，adcode 由本城真实区表决定 —— 让 AI 手打 6 位码迟早写错
            table = _districts(slug)
            ad = table.get(val.strip())
            if not ad:
                print(f"★ 本城没有「{val}」这个区。可选：{'/'.join(table) or '（区表读不到）'}")
                return 2
            old_ad = poi.get("district")
            if str(old or "") == val and str(old_ad or "") == ad:
                print(f"  = {label} 已是「{val}/{ad}」，跳过")
                continue
            _set_path(poi, tgt, val)
            poi["district"] = ad
            changes.append({"field": label, "old": f"{old or '-'}/{old_ad or '-'}",
                            "new": f"{val}/{ad}"})
            touched.append(key)
            continue
        if typ == "list":
            new: object = [x.strip() for x in val.split("|") if x.strip()]
            same = old == new
        elif typ == "int":
            try:
                new = int(val)
            except ValueError:
                print(f"★ {label} 需要整数，给的是「{val}」")
                return 2
            if key == "coverIndex" and not (0 <= new < len(poi.get("images") or [])):
                print(f"★ coverIndex={new} 越界：该点位只有 {len(poi.get('images') or [])} 张图")
                return 2
            if key == "popularity" and not (0 <= new <= 100):
                print(f"★ popularity={new} 越界：0~100（schema 的 ge=0/le=100）")
                return 2
            same = old == new
        else:
            new = val
            same = str(old or "") == val
        if same:
            print(f"  = {label} 已是「{val}」，跳过")
            continue
        _set_path(poi, tgt, new)
        changes.append({"field": label, "old": old, "new": new})
        touched.append(key)
    if not changes:
        print("没有实际改动")
        return 0

    poi.setdefault("sources", []).append(
        {"title": reason[:40], "url": source, "kind": _opt(argv, "--kind", "media"),
         "fetchedAt": today})
    poi["_patrol"] = {"at": today, "changes": changes, "source": source, "reason": reason[:120]}
    poi["updatedAt"] = today

    kind = "演练" if dry else "已改"
    print(f"{kind} {poi.get('name')}（{poi_id}）{len(changes)} 处：")
    for c in changes:
        print(f"  · {c['field']}：{str(c['old'])[:40]} → {str(c['new'])[:40]}")
    if dry:
        return 0
    path.write_text(json.dumps(poi, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    OUT.mkdir(parents=True, exist_ok=True)
    with (OUT / f"patches-{today}.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps({"at": datetime.now().strftime("%H:%M:%S"), "city": slug,
                            "poi": poi_id, "file": path.relative_to(REPO).as_posix(),
                            "changes": changes, "source": source, "reason": reason},
                           ensure_ascii=False) + "\n")
    print(f"PATCHED {path.relative_to(REPO).as_posix()}  ⇒ 需全量 build 才上站")
    #: ★ 改完顺手把对应的未结发现结掉。不这么做就得靠 AI 记得再敲一遍 close，
    #:   而它十次有三次会忘 —— 忘掉的那条会一直算在「待人工」里，这正是原来的病根。
    patrol_findings.auto_close(
        slug, poi_id, [_find_field(k) for k in touched], "本轮 fix 已落地")
    return 0


def cmd_retire(argv: list[str]) -> int:
    """把「确认永久关闭」的点位归档，**不删**（`data/_archived/` 不在 build 扫描范围）。

    ★ 只允许在**官方公告明确说永久关闭 / 拆除 / 改作他用**时用。
      「暂停营业」「闭馆修缮」是临时状态 ⇒ 改 `summary` 或 `tips` 说明，别下架：
      半年后重开又得重新录一遍，而且坐标/描述全丢。
    """
    slug, poi_id = _opt(argv, "--city"), _opt(argv, "--poi")
    reason, source = _opt(argv, "--reason"), _opt(argv, "--source")
    if not (slug and poi_id and reason and source.startswith("http")):
        print("用法：patrol_queue.py retire --city <slug> --poi <id> --reason \"官方公告拆除\" "
              "--source <url> [--dry]")
        return 2
    hit = [p for p in CITIES.glob(f"*/*/pois/*/{poi_id}.json") if f"/{slug}/" in p.as_posix()]
    if not hit:
        print(f"找不到点位 {slug}/{poi_id}")
        return 1
    src = hit[0]
    dst = REPO / "data" / "_archived" / "pois" / slug / f"{poi_id}.json"
    print(f"{'[演练] ' if '--dry' in argv else ''}下架 {src.relative_to(REPO).as_posix()}"
          f" → {dst.relative_to(REPO).as_posix()}")
    print(f"  原因：{reason}\n  来源：{source}")
    if "--dry" in argv:
        return 0
    dst.parent.mkdir(parents=True, exist_ok=True)
    src.replace(dst)
    OUT.mkdir(parents=True, exist_ok=True)
    with (OUT / "retired.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps({"at": datetime.now().strftime("%Y-%m-%dT%H:%M"), "city": slug,
                            "poi": poi_id, "from": src.relative_to(REPO).as_posix(),
                            "to": dst.relative_to(REPO).as_posix(),
                            "reason": reason, "source": source}, ensure_ascii=False) + "\n")
    print("RETIRED ⇒ 需全量 build 才从站上消失；反悔就把文件搬回去")
    patrol_findings.auto_close(slug, poi_id, ["closed", "hours", "summary"], "已按 A 档下架归档")
    return 0


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args:
        print(__doc__[:400])
        return 2
    cmd, rest = args[0], args[1:]
    table = {"next": cmd_next, "done": cmd_done, "status": cmd_status,
             "fix": cmd_fix, "retire": cmd_retire}
    if cmd not in table:
        print(f"未知子命令：{cmd}（可用：{'/'.join(table)}）")
        return 2
    return table[cmd](rest)


if __name__ == "__main__":
    raise SystemExit(main())
