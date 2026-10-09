"""一次性：把**存量**数据里"不设区的市"折叠成「市自身」。

规则已经固化进 `pipeline/step8_subdistricts.py`（+ `pipeline/districtless.py`），
这个脚本只用来修**在规则之前生成的那批数据** —— 重跑 step8 要重新请求腾讯区划接口
（耗配额，而且那批数据本身没问题），不值当。

跑完可以删（或者留着，它**幂等**：已经是折叠态的市不会二次折叠 —— 折叠后的
`children` 只有一个节点、且它在 `polygons` 里有几何，第一个条件就不成立）。

用法：
    python tools/fix_districtless.py --dry     # 只看会改哪些
    python tools/fix_districtless.py           # 真写
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline.geo.districtless import normalize_districts     # noqa: E402
from pipeline.core.layout import GENERATED, read_json, write_json  # noqa: E402

SUB = GENERATED / "subdistricts"
DIS = GENERATED / "districts"


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    dry = "--dry" in argv

    fixed: list[tuple[str, str, str]] = []
    for f in sorted(SUB.glob("*.json")):
        ad = f.stem
        bl = DIS / f"{ad}.geo.json"
        if not bl.exists():
            continue
        sub = read_json(f)
        bnd = read_json(bl)
        out = normalize_districts(ad, sub.get("name") or "", sub.get("children") or [],
                                  bnd.get("polygons") or {})
        if not out:
            continue
        children, polys, why = out
        sub["children"] = children
        bnd["polygons"] = polys
        if not dry:
            write_json(f, sub, compact=True)
            write_json(bl, bnd, compact=True)
        fixed.append((ad, sub.get("name") or "", why))

    print(f'{"[dry] " if dry else ""}整理 {len(fixed)} 个市'
          f'（{"未写盘" if dry else "已写盘"}）：')
    for ad, nm, why in fixed:
        print(f"  {ad} {nm}  ← {why}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
