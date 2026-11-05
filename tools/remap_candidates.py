#!/usr/bin/env python3
"""按序号改写候选图的归属点位（manifest 的 file / poi 两字段）。

为什么需要：`grab` 是按**坐标最近**分配点位的，它不知道照片内容属于谁。大同实测：
12 张九龙壁挂给了「华严寺辽塑」、3 张城墙挂给了「代王府夜景」、2 张关帝庙挂给了
「鼓楼街」—— 照片本身没错，只是挂错了点位。看图时认出来，改对归属，
`apply` 就会写到正确点位；否则这批好图只能全部 reject 扔掉。

用法：
  python tools/remap_candidates.py <city> '{"8": "大同关帝庙", "24": "大同鼓楼"}'
  python tools/remap_candidates.py <city> map.json
值可以只给**点位名**（自动在本城 pois 里定位文件），也可以给 ["文件路径", "点位名"]。

★ 只改 manifest，不碰数据文件。改完照常写 verdicts 再 apply。
★ 点位名必须精确匹配；重名/找不到会直接报错并列出相近的，不会猜。
"""
import glob
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def city_dir(slug):
    hits = glob.glob(str(ROOT / "data" / "cities" / "*" / slug))
    hits = [h for h in hits if Path(h, "city.json").exists()]
    if not hits:
        sys.exit("找不到城市目录: %s" % slug)
    return Path(hits[0])


def poi_index(slug):
    idx = {}
    for f in glob.glob(str(city_dir(slug) / "pois" / "*" / "*.json")):
        try:
            name = json.loads(Path(f).read_text(encoding="utf-8")).get("name", "")
        except Exception:
            continue
        if name:
            idx.setdefault(name, []).append(f)
    return idx


def resolve(slug, want, idx):
    if isinstance(want, list):
        path, name = want
        return (ROOT / path), name
    hits = idx.get(want) or []
    if len(hits) == 1:
        return Path(hits[0]), want
    if len(hits) > 1:
        sys.exit("点位名有 %d 个同名文件，请改用 [路径, 名称] 形式:\n  %s"
                 % (len(hits), "\n  ".join(hits)))
    near = [n for n in idx if want[:2] in n or n[:2] in want][:8]
    sys.exit("没有名为「%s」的点位。相近的: %s" % (want, " / ".join(near) or "（无）"))


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    slug, mp = sys.argv[1], sys.argv[2]
    if mp.lstrip().startswith("{"):
        mapping = json.loads(mp)
    else:
        mapping = json.loads(Path(mp).read_text(encoding="utf-8"))

    p = ROOT / "_tmp" / "fetch" / slug / "manifest-candidates.json"
    if not p.exists():
        sys.exit("没有 manifest（先跑 grab）: %s" % p)
    m = json.loads(p.read_text(encoding="utf-8"))
    by_idx = {e["idx"]: e for e in m}
    idx = poi_index(slug)

    ok = 0
    for key, want in mapping.items():
        i = int(key)
        e = by_idx.get(i)
        if e is None:
            print("! idx %d 不存在" % i)
            continue
        target, name = resolve(slug, want, idx)
        if not target.exists():
            print("! 目标不存在 %s" % target)
            continue
        print("  %3d %-14s → %-14s %s" % (i, e["poi"][:14], name[:14],
                                           e["alt"][:34]))
        e["file"] = str(target.relative_to(ROOT)).replace("\\", "/")
        e["poi"] = name
        ok += 1

    p.write_text(json.dumps(m, ensure_ascii=False, indent=1), encoding="utf-8")
    print("已改写 %d/%d 条 → %s" % (ok, len(mapping), p))
    return 0 if ok == len(mapping) else 1


if __name__ == "__main__":
    raise SystemExit(main())
