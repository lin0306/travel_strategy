#!/usr/bin/env python3
"""报入口坐标覆盖进度（只读，零配额）。

定时任务每天跑它、只为在报告里写一句"覆盖了多少"——
**不要**因为"还有缺口"就建议任何动作：补齐要很多天，是既定节奏。

用法（在**仓库根**执行）：
    python tools/arrival_progress.py
"""
from __future__ import annotations

import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
#: 入口坐标只对「大范围景区」有意义（step3b 的作用范围是nature/park）。
#: 小店与狭窄街区本来就会标 out_of_scope，所以**分母只算范围内的那批** ——
#: 拿 4731 全量当分母会让人以为缺口巨大，其实那些永远不会被采。
IN_SCOPE = {"scenic", "food"}


def main() -> int:
    have = total = 0
    by_cat: dict[str, list[int]] = {}
    for f in (REPO / "data" / "cities").rglob("pois/*/*.json"):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except Exception:                              # noqa: BLE001 —— 只读报表，不许崩
            continue
        cat = f.parent.name
        if cat not in IN_SCOPE:
            continue
        total += 1
        slot = by_cat.setdefault(cat, [0, 0])
        slot[1] += 1
        if (d.get("location") or {}).get("entrance"):
            have += 1
            slot[0] += 1

    print(f"入口坐标覆盖（范围内 {sum(v[1] for v in by_cat.values())} 条）")
    for cat in sorted(by_cat):
        h, t = by_cat[cat]
        pct = h / t * 100 if t else 0
        print(f"  {cat:<9} {h:>4}/{t:<4} ({pct:5.1f}%)")
    pct_all = have / total * 100 if total else 0
    print(f"  {'合计':<9} {have:>4}/{total:<4} ({pct_all:5.1f}%)")
    print()
    print("★ 覆盖会随每日续采缓慢上升，**不需要为缺口采取行动**。")
    print("  只有 >300m 的入口会被规划链路采用（见 web 的 arrivalOf / py 的 arrival_of）。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
