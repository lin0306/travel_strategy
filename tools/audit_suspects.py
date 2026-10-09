#!/usr/bin/env python3
"""列出全站所有 `_geocodeSuspect` 点位（只读），人工核的第一步。

打印：城市/大类/id · name · dist · 当前坐标 · _geocodeTitle
★ 判据一句话：**看 `_geocodeTitle` 与 `name` 是不是同一个东西**，不是就重查。

用法（在**仓库根**执行）：
    python tools/audit_suspects.py

★ 它是**通用**的：扫全站、不绑任何城市；只读，绝不写盘。
  核完改坐标请走 step3（重查）或 tools/check_seed.py（体检）。
"""
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]

rows = []
for f in sorted((REPO / "data").glob("cities/*/*/pois/*/*.json")):
    try:
        poi = json.loads(f.read_text(encoding="utf-8"))
    except Exception:
        continue
    if not poi.get("_geocodeSuspect"):
        continue
    parts = f.parts
    city = parts[parts.index("cities") + 2]
    cat = f.parent.name
    loc = poi.get("location") or {}
    pt = loc.get("point") or {}
    rows.append(
        {
            "city": city,
            "cat": cat,
            "id": f.stem,
            "name": poi.get("name", ""),
            "dist": loc.get("district", ""),
            "lng": pt.get("lng"),
            "lat": pt.get("lat"),
            "title": poi.get("_geocodeTitle", ""),
        }
    )

print(f"共 {len(rows)} 条存疑\n")
cur = None
for r in rows:
    if r["city"] != cur:
        cur = r["city"]
        n = sum(1 for x in rows if x["city"] == cur)
        print(f"════ {cur}（{n} 条）════")
    print(
        f"  [{r['cat']:<7}] {r['id']:<28} name={r['name']:<14} "
        f"dist={r['dist']:<8} title={r['title']:<22} "
        f"({r['lng']},{r['lat']})"
    )
