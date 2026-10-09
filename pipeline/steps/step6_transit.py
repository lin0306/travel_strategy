#!/usr/bin/env python3
"""
pipeline/steps/step6_transit.py —— 通勤矩阵（04 文档第六步）

把 n×n 种通勤组合在**构建期**算完固化，让运行时行程规划 O(1) 查表、**零 API 调用**。

产物：`data/cities/{省}/{市}/transit.json`（独立文件 —— 它是派生数据，不和人写的 city.json 混）

★ 三条硬约束（04 文档 6.3）：
  1. 必须在 step3 之后跑（要有最终坐标）
  2. 采样时段选工作日上午（驾车含实时路况，最贴近典型出行）
  3. 断点续跑 + 单城 15,000 计算次数上限告警（防脚本 bug 打满当日配额）

★ 对称上三角优化（比文档示意更省）：
  矩阵只存上三角，对称读取。所以只需请求 **i 块 ≥ j 块** 的分块，
  n=46 时每个方式从 4 块降到 3 块 —— 三方式共 **9 次请求**（而非 12 次），
  计算次数也从 ~7,500 降到 ~3,900。省下来的是真金白银的配额。
"""

from __future__ import annotations

import sys
import time
from datetime import date, datetime
from pathlib import Path

if __package__ in (None, ""):
    # ★ 本文件在 pipeline/steps/，往上两级才是仓库根（见 core/layout.py 同处陷阱）
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pipeline.core.layout import (                # noqa: E402
    GENERATED, iter_city_dirs, iter_poi_files, read_json, transit_json_path, write_json,
)
from pipeline.providers import tmap                    # noqa: E402
from schema.schema import (                         # noqa: E402
    alloc_matrix, haversine_meters, set_cell,
)

#: ★ 单城中止阈值（计算次数）。正常约 4,800，超了说明分块写错在重复全量跑
CITY_UNIT_LIMIT = 15_000

#: 分块之间的额外等待秒数（避开 QPS 上限，见 tmap.RATE_LIMIT_STATUS）。
#: ★ 实测 3s 远远不够：连续请求会被判 120 并长时间锁住，之后退避 40s 也救不回来。
BLOCK_GAP_SECONDS = 60

PROGRESS = GENERATED / "transit.progress.json"


def load_progress() -> dict:
    if PROGRESS.exists():
        import json
        try:
            return json.loads(PROGRESS.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}
    return {}


def save_progress(p: dict) -> None:
    write_json(PROGRESS, p)


def collect_pois(slug: str, city_id: str) -> list[tuple[str, str, tuple[float, float]]]:
    """按大类目录顺序收集 (poiId, category, (lng, lat))。

    ⚠️ **顺序决定矩阵下标**。同一个城市每次跑必须得到相同顺序，
    否则 poiIndex 与 pois 错位 → 行程规划静默取到别人的时长。
    所以这里严格按 CATEGORY_DIRS 顺序 + 文件名字典序。
    """
    out: list[tuple[str, str, tuple[float, float]]] = []
    for category, path in iter_poi_files(slug, city_id):
        poi = read_json(path)
        pt = (poi.get("location") or {}).get("point")
        if not pt:
            continue                                 # 没坐标的不进矩阵（step3 会单独报缺失）
        out.append((path.stem, category, (float(pt["lng"]), float(pt["lat"]))))
    return out


def build_channel(
    coords: list[tuple[float, float]],
    mode: str,
    *,
    city_key: str,
    progress: dict,
) -> dict:
    """算一种通行方式的 distance / duration 两串。"""
    n = len(coords)
    d_cells = alloc_matrix(n)
    t_cells = alloc_matrix(n)
    max_straight = tmap.MODE_MAX_STRAIGHT_METERS[mode]
    units_used = 0

    blocks = list(tmap.iter_chunks(n))
    for bi, ri in enumerate(blocks):
        for bj, rj in enumerate(blocks):
            # ★ 对称上三角：只请求 i 块 ≥ j 块，另一半由对称性覆盖
            if bi < bj:
                continue
            key = f"{city_key}|{mode}|{bi}|{bj}"
            if progress.get(key):
                for gi in ri:
                    for gj in rj:
                        if gi <= gj:
                            continue
                        v = progress[key].get(f"{gi},{gj}")
                        if v:
                            d, t = v
                            set_cell(d_cells, n, gi, gj, d)
                            set_cell(t_cells, n, gi, gj, t)
                continue

            origins = [coords[i] for i in ri]
            dests = [coords[j] for j in rj]
            rows = tmap.matrix(origins, dests, mode)
            units_used += len(ri) * len(rj)

            if units_used > CITY_UNIT_LIMIT:
                raise RuntimeError(
                    f"城市 {city_key} 的 {mode} 通道已用 {units_used} 计算次数，"
                    f"超过单城上限 {CITY_UNIT_LIMIT} —— 疑似分块写错在重复全量跑，已中止"
                )

            saved: dict[str, list[int]] = {}
            for r, gi in enumerate(ri):
                for c, gj in enumerate(rj):
                    if gi <= gj:
                        continue                     # 只留上三角
                    val = rows[r][c]
                    if val is None:                  # 接口无结果 → 保持哨兵 0000
                        continue
                    if max_straight and haversine_meters(
                        coords[gi][0], coords[gi][1], coords[gj][0], coords[gj][1]
                    ) > max_straight:
                        continue                     # 超出该方式合理距离 → 不适用
                    d, t = val
                    if t <= 0:
                        continue                     # 时长为 0 一律视为无效数据
                    set_cell(d_cells, n, gi, gj, d)
                    set_cell(t_cells, n, gi, gj, t)
                    saved[f"{gi},{gj}"] = [d, t]

            progress[key] = saved
            save_progress(progress)                  # ★ 每块落盘，中断可续跑
            # 块间留白：矩阵一次带 625 对计算，连着打很容易撞 QPS 上限（status=120）。
            # 与其被限流后重试（失败的那次同样计费），不如主动等。
            time.sleep(BLOCK_GAP_SECONDS)

    return {
        "distance": "".join(d_cells),
        "duration": "".join(t_cells),
        "maxStraightMeters": max_straight,
    }


def build_city_transit(slug: str, city_id: str, *, force: bool = False) -> str | None:
    """为一座城市生成 transit.json。返回状态串。"""
    target = transit_json_path(slug, city_id)
    pois_geo = collect_pois(slug, city_id)
    if len(pois_geo) < 2:
        return "skip：有效坐标不足 2 个"

    existing = read_json(target)
    poi_index_now = [p[0] for p in pois_geo]
    same = existing.get("poiIndex") == poi_index_now

    # 幂等（04 文档 6.4）：180 天内跳过，避免重复计费
    if same and existing.get("generatedAt") and not force:
        gen = existing["generatedAt"]
        try:
            age = (date.today() - date.fromisoformat(gen)).days
            if 0 <= age <= 180:
                return f"skip：已有矩阵且 {gen} 距今 {age} 天（≤180 天），如需重算加 --force"
        except ValueError:
            pass

    coords = [c for _, _, c in pois_geo]
    city_key = f"{slug}/{city_id}"
    progress = load_progress() if not force else {}

    now = datetime.now()
    modes = {
        mode: build_channel(coords, mode, city_key=city_key, progress=progress)
        for mode in tmap.TMAP_MATRIX_MODES
    }

    obj = {
        "generatedAt": now.date().isoformat(),
        # ★ 驾车时长含路况，是"生成时刻的快照"—— 必须在 UI 上如实标注，绝不能说成实时
        "sampledAtLabel": f"{'工作日' if now.weekday() < 5 else '周末'}"
                          f"{'上午' if now.hour < 12 else '下午'} · 含路况",
        "poiIndex": poi_index_now,
        "modes": modes,
    }
    write_json(target, obj)
    save_progress(progress)

    tri = len(pois_geo) * (len(pois_geo) - 1) // 2
    parts = [f"{m}:{modes[m]['duration'].count('0000')}/{tri}不适用" for m in modes]
    return f"ok：{len(pois_geo)} POI · {tri} 格 · " + " · ".join(parts)


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    force = "--force" in args
    only = next((a for a in args if not a.startswith("--")), None)

    try:
        tmap.web_key()
    except tmap.MissingKeyError as exc:
        print(f"❌ {exc}")
        return 2

    from pipeline.core.fetch import remaining, usage_report
    print(usage_report())
    left = remaining("matrix")
    if left is not None and left < 4_000:
        print(f"⚠️ 矩阵接口今日余额仅 {left} 计算次数，单城约需 3,900 —— 够跑再看，不够请明日再来")

    targets = [(s, c) for s, c, _ in iter_city_dirs() if only is None or c == only]
    if not targets:
        print("⚠️ 没有找到城市目录")
        return 1

    code = 0
    for slug, cid in targets:
        try:
            print(f"{slug}/{cid} → {build_city_transit(slug, cid, force=force)}")
        except RuntimeError as exc:
            print(f"❌ {slug}/{cid}：{exc}")
            code = 1
    print("\n" + usage_report())
    return code


if __name__ == "__main__":
    raise SystemExit(main())
