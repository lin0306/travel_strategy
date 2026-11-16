#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""历史数据**只读**巡检 —— 每小时定时任务的唯一判据。

## 为什么单独做一个
每晚 00:00 那条任务只管「新抓的 1 城」，历史 4900 个点位是**没人回看**的：
采编稿 desc 短、同城重复图 URL、图片 credit 来源与 URL 不符、索引 poiCount 与磁盘
对不上……这些都是既存事实，`check_app.py` 查的是**代码结构**，一条都抓不到。

## 铁律（改这个脚本前先读）
1. **只读**：绝不写 `data/` `pipeline/seeds/`，不 build / 不 apply / 不 clean / 不 commit。
   报告只落 `_tmp/audit/`，那里不是产物目录。
2. **判据是客观的**：不靠「看图」「猜对不对」，只报能复现的字段 / 一致性问题。
   「这张图是不是这个景点」属于两轮看图链路，不在这里判。
3. **增量才有价值**：既存问题第一次跑记成 BASELINE，之后每小时只报
   `ADDED`（新出现的）/ `RESOLVED`（已消解）。否则每小时重复刷 1300 条噪声。
4. **错报比漏报贵**：`schema_invalid` / `missing_point` 是 error，其余是 warn；
   `_noImage` 本身**不是问题**（待重试），只有「无图却没打标记」才算不一致。

用法（仓库根执行）：
    python tools/audit_history.py              # 巡检 + 与上轮对比，打印摘要
    python tools/audit_history.py --report    # 额外打印新增/消解明细（任务排错用）

stdout 末行 `RESULT: BASELINE|NO_CHANGE|NEW_ISSUES|RESOLVED` 是任务的判据。
退出码：0 = 正常（含新增）；2 = 脚本自身异常。
"""
from __future__ import annotations

import contextlib
import io
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
OUT = REPO / "_tmp" / "audit"
#: 改动流水统一落 `_tmp/patrol/`（巡检的目录）—— 回滚时只需要看这一个地方，
#: 不用在 audit / fetch / patrol 三个目录里翻。
PATCHES = REPO / "_tmp" / "patrol"
LATEST = OUT / "latest.json"
KEEP_HISTORY = 24                     # 只留最近 24 份小时快照


def _issue(code: str, level: str, where: str, detail: str = "") -> dict:
    """key 必须稳定：增量对比全靠它。detail 截断，避免 pydantic 长报错撑爆报告。"""
    detail = str(detail)[:160]
    return {"key": f"{code}|{where}|{detail}", "code": code,
            "level": level, "where": where, "detail": detail}


def _host_source(url: str) -> str | None:
    """从 URL 反推图源，用来抓「credit 硬编码 wikimedia」那类伪造署名。"""
    if "pexels.com" in url:
        return "pexels"
    if "unsplash.com" in url:
        return "unsplash"
    if "wikimedia.org" in url or "wikipedia.org" in url:
        return "wikimedia"
    return None


def audit_pois() -> tuple[dict, list[dict], Counter]:
    """扫全库点位。返回 (规模, 问题, 每城实际 POI 数)。"""
    from schema.schema import Poi

    cities: set[str] = set()
    per_city: Counter = Counter()
    city_urls: dict[tuple[str, str], list[str]] = defaultdict(list)
    issues: list[dict] = []
    n_poi = n_img = 0

    for f in sorted((REPO / "data" / "cities").glob("*/*/pois/*/*.json")):
        city = f.parts[f.parts.index("cities") + 2]
        cities.add(city)
        per_city[city] += 1
        n_poi += 1
        w = f.relative_to(REPO).as_posix()
        try:
            poi = json.loads(f.read_text(encoding="utf-8"))
        except Exception as exc:                                  # noqa: BLE001
            issues.append(_issue("json_broken", "error", w, repr(exc)))
            continue

        try:
            Poi.model_validate(poi)
        except Exception as exc:                                  # noqa: BLE001
            issues.append(_issue("schema_invalid", "error", w, str(exc).splitlines()[0]))

        pt = (poi.get("location") or {}).get("point") or {}
        if not isinstance(pt.get("lat"), (int, float)) or not isinstance(pt.get("lng"), (int, float)):
            issues.append(_issue("missing_point", "error", w, "location.point 缺 lat/lng"))
        if poi.get("_geocodeSuspect"):
            issues.append(_issue("geocode_suspect", "warn", w,
                                 f"_geocodeTitle={poi.get('_geocodeTitle', '')}"))
        if not poi.get("updatedAt"):
            issues.append(_issue("no_updatedAt", "warn", w))
        if not poi.get("sources"):
            issues.append(_issue("no_sources", "warn", w))
        desc = poi.get("description") or ""
        if len(desc) < 98:
            issues.append(_issue("desc_short", "warn", w, f"description {len(desc)} 字 < 98"))

        imgs = poi.get("images") or []
        n_img += len(imgs)
        if not imgs and not poi.get("_noImage"):
            issues.append(_issue("noimg_without_flag", "warn", w, "images 空但缺 _noImage"))
        if imgs and poi.get("_noImage"):
            issues.append(_issue("img_with_noimage_flag", "warn", w, "有图却仍带 _noImage"))
        ci = poi.get("coverIndex")
        if imgs and (not isinstance(ci, int) or ci < 0 or ci >= len(imgs)):
            issues.append(_issue("cover_index_bad", "error", w, f"coverIndex={ci} / {len(imgs)} 张"))

        for x in imgs:
            url = str(x.get("url") or "")
            if not url:
                issues.append(_issue("img_no_url", "error", w))
            credit = x.get("credit") or {}
            if not credit.get("source"):
                issues.append(_issue("img_no_credit_source", "warn", w, url[:70]))
            expect = _host_source(url)
            if expect and credit.get("source") and credit["source"] != expect:
                issues.append(_issue("credit_source_mismatch", "warn", w,
                                     f"url={expect} credit={credit['source']}"))
            if url:
                city_urls[(city, url)].append(w)

    for (city, url), ws in city_urls.items():
        if len(ws) > 1:
            issues.append(_issue("dup_image_url", "warn", city,
                                 f"{url[:80]} × {len(ws)} 处"))
    return {"cities": len(cities), "pois": n_poi, "images": n_img}, issues, per_city


def audit_city_json() -> list[dict]:
    """城市封面 credit：配图库存量图属有意保留，只查署名与 URL 是否对得上。"""
    issues = []
    for f in sorted((REPO / "data" / "cities").glob("*/*/city.json")):
        w = f.relative_to(REPO).as_posix()
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except Exception as exc:                                  # noqa: BLE001
            issues.append(_issue("city_json_broken", "error", w, repr(exc)))
            continue
        for x in d.get("heroImages") or []:
            url = str(x.get("url") or "")
            expect = _host_source(url)
            src = (x.get("credit") or {}).get("source")
            if expect and src and src != expect:
                issues.append(_issue("hero_credit_mismatch", "warn", w,
                                     f"url={expect} credit={src}"))
    return issues


def audit_index(per_city: Counter) -> list[dict]:
    """索引 poiCount 与磁盘是否一致 + 产物是否比数据旧（前端数字写死那件事）。"""
    issues = []
    p = REPO / "data" / "cities.index.json"
    if not p.exists():
        return [_issue("index_missing", "error", "data/cities.index.json")]
    try:
        rows = json.loads(p.read_text(encoding="utf-8"))
    except Exception as exc:                                      # noqa: BLE001
        return [_issue("index_broken", "error", "data/cities.index.json", repr(exc))]
    seen = {r.get("id") for r in rows}
    for r in rows:
        real = per_city.get(r.get("id"), 0)
        if r.get("poiCount") != real:
            issues.append(_issue("index_poi_count", "error", str(r.get("id")),
                                 f"索引 {r.get('poiCount')} / 磁盘 {real}"))
    for city in per_city:
        if city not in seen:
            issues.append(_issue("index_missing_city", "error", city, "磁盘有城、索引没条目"))
    newest = max((f.stat().st_mtime for f in
                  (REPO / "data" / "cities").glob("*/*/pois/*/*.json")), default=0)
    if newest > p.stat().st_mtime:
        issues.append(_issue("index_stale", "warn", "data/cities.index.json",
                             "有 POI 比索引新 ⇒ 需全量 build"))
    return issues


def audit_seeds() -> tuple[int, list[dict]]:
    """复用 check_seed 的唯一判据（不另写一套），捕获输出转成稳定 issue。"""
    from tools import check_seed

    ids = sorted(p.stem for p in (REPO / "pipeline" / "seeds").glob("*.py")
                 if not p.name.startswith("_"))
    issues = []
    for cid in ids:
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                check_seed.check(cid, count=False)
        except Exception as exc:                                  # noqa: BLE001
            issues.append(_issue("seed_import_error", "error", f"seeds/{cid}.py", repr(exc)))
            continue
        for line in buf.getvalue().splitlines():
            # ★ 只收「逐条明细」：`check()` 末尾那行「合计 57 条，问题 53 个 —— ❌ 先修稿」
            #   不以 ❌ 开头，用 startswith 自然排除。若用 `if "❌" in line`，
            #   83 座城的汇总行会混进 issue，增量报告里全是噪声。
            s = line.strip()
            if s.startswith("❌"):
                issues.append(_issue("seed_problem", "warn", f"seeds/{cid}.py",
                                     s.lstrip("❌ ").strip()))
    return len(ids), issues


def fix_safe(dry: bool = False) -> tuple[int, int]:
    """修「语义上只有一种正确解」的字段问题，返回 (改动文件数, 改动项数)。

    只修这四类，**别扩**：
    | code | 修法 | 为什么无歧义 |
    |---|---|---|
    | `cover_index_bad` | `coverIndex=0` | 越界下标没有第二种解释，有图就一定指得到第 0 张 |
    | `img_with_noimage_flag` | 删 `_noImage` | 标记与事实冲突，事实（有图）优先 |
    | `noimg_without_flag` | 打 `_noImage=True` | 缺标记会让前端渲染空图框；标记本身只是"待重试" |
    | `dup_image_url` | 同城只留**最先出现**的那处 | 「同城一张图不许挂两个点位」是既有硬约束，重复即错 |

    ★ `credit_source_mismatch` **故意不修**：把 `source` 改成 `pexels` 而 `author`
      还留着"Wikimedia Commons 贡献者"，等于把错署名改得更像真的 —— 那种必须人看。
    """
    files, changes = 0, 0
    seen: dict[tuple[str, str], str] = {}      # (city, url) → 首个占用者
    dropped: dict[str, dict] = {}              # poi id → {file, urls}（回滚依据）
    today = datetime.now().strftime("%Y-%m-%d")

    for f in sorted((REPO / "data" / "cities").glob("*/*/pois/*/*.json")):
        city = f.parts[f.parts.index("cities") + 2]
        try:
            poi = json.loads(f.read_text(encoding="utf-8"))
        except Exception:                                          # noqa: BLE001
            continue
        imgs = poi.get("images") or []
        touched = False
        keep = []
        for x in imgs:
            url = str(x.get("url") or "")
            if url:
                owner = seen.get((city, url))
                if owner and owner != poi.get("id"):
                    touched = True                 # 同城撞图：后面那个点位让出
                    changes += 1
                    # ★ 必须留痕：这些是**真的挂错**（实测样本：伏波山挂叠彩山的图、
                    #   泉州博物馆挂海丝馆的图、官也街挂猪扒包的图），但删完该点位会
                    #   变无图，靠这条记录才知道原图从哪来、要不要重抓。
                    dropped.setdefault(str(poi.get("id") or f.as_posix()), {
                        "file": f.relative_to(REPO).as_posix(),
                        "urls": []})["urls"].append(url)
                    continue
                seen[(city, url)] = str(poi.get("id") or f.as_posix())
            keep.append(x)
        if len(keep) != len(imgs):
            poi["images"] = keep

        imgs = poi.get("images") or []
        if imgs and poi.get("_noImage"):
            poi.pop("_noImage", None)
            touched, changes = True, changes + 1
        if not imgs and not poi.get("_noImage"):
            poi["_noImage"] = True
            touched, changes = True, changes + 1
        ci = poi.get("coverIndex")
        if imgs and (not isinstance(ci, int) or ci < 0 or ci >= len(imgs)):
            poi["coverIndex"] = 0
            touched, changes = True, changes + 1

        if touched:
            files += 1
            if dry:
                continue
            poi["updatedAt"] = today
            gone = dropped.get(str(poi.get("id") or ""), {}).get("urls") or []
            poi["_patrol"] = {
                "at": today,
                "reason": (f"audit --fix-safe：清掉同城撞图的 {len(gone)} 张（待重抓）"
                           if gone else "audit --fix-safe：标记 / 封面下标修复"),
                "droppedImages": gone,
            }
            f.write_text(json.dumps(poi, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if dropped and not dry:
        PATCHES.mkdir(parents=True, exist_ok=True)
        with (PATCHES / f"patches-{today}.jsonl").open("a", encoding="utf-8") as fh:
            for pid, rec in dropped.items():
                fh.write(json.dumps({"at": datetime.now().strftime("%H:%M:%S"),
                                     "by": "audit --fix-safe", "poi": pid,
                                     "file": rec["file"], "droppedImages": rec["urls"]},
                                    ensure_ascii=False) + "\n")
    return files, changes


def main() -> int:
    show_detail = "--report" in sys.argv[1:]
    if "--fix-safe" in sys.argv[1:]:
        dry = "--dry" in sys.argv[1:]
        nf, nc = fix_safe(dry=dry)
        print(f"FIX_SAFE{'[演练]' if dry else ''} files={nf} changes={nc}")
    scope, issues, per_city = audit_pois()
    issues += audit_city_json()
    issues += audit_index(per_city)
    n_seed, seed_issues = audit_seeds()
    issues += seed_issues
    scope["seeds"] = n_seed

    OUT.mkdir(parents=True, exist_ok=True)
    prev = None
    if LATEST.exists():
        try:
            prev = json.loads(LATEST.read_text(encoding="utf-8"))
        except Exception:                                         # noqa: BLE001
            prev = None
    if prev is None:
        added, resolved, result = [], [], "BASELINE"
    else:
        old = {i["key"] for i in prev.get("issues", [])}
        new = {i["key"] for i in issues}
        added = [i for i in issues if i["key"] not in old]
        resolved = [i for i in prev.get("issues", []) if i["key"] not in new]
        result = "NEW_ISSUES" if added else ("RESOLVED" if resolved else "NO_CHANGE")

    at = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    report = {"at": at, "scope": scope,
              "counts": dict(Counter(i["code"] for i in issues)),
              "issues": issues, "result": result,
              "prev_at": (prev or {}).get("at"),
              "added": added, "resolved": resolved}
    LATEST.write_text(json.dumps(report, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    snap = {"at": at, "scope": scope, "counts": report["counts"],
            "result": result, "added": added, "resolved": resolved}
    (OUT / f"history-{datetime.now():%Y%m%d-%H}.json").write_text(
        json.dumps(snap, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    old_snaps = sorted(OUT.glob("history-*.json"))
    for p in old_snaps[:-KEEP_HISTORY]:
        p.unlink()

    counts = " ".join(f"{k}={v}" for k, v in sorted(report["counts"].items(),
                                                   key=lambda kv: -kv[1]))
    print(f"HISTORY_AUDIT at={at} cities={scope['cities']} pois={scope['pois']} "
          f"images={scope['images']} seeds={scope['seeds']}")
    print(f"ISSUES total={len(issues)}  {counts}")
    print(f"PREV {report['prev_at'] or '(none)'}")
    print(f"ADDED {len(added)} / RESOLVED {len(resolved)}")
    if show_detail:
        for i in added[:30]:
            print(f"  + [{i['code']}] {i['where']} {i['detail']}")
        for i in resolved[:30]:
            print(f"  - [{i['code']}] {i['where']} {i['detail']}")
    print(f"REPORT {LATEST.relative_to(REPO).as_posix()}")
    print(f"RESULT: {result}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as exc:                                      # noqa: BLE001
        print(f"AUDIT_FAILED {type(exc).__name__}: {exc}", file=sys.stderr)
        raise SystemExit(2)
