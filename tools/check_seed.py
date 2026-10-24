#!/usr/bin/env python3
"""采编稿体检 —— 入库前把「写错的字段」一次拦下来。

用法（在**仓库根**执行）：
    python tools/check_seed.py yixian
    python tools/check_seed.py --all

★ 为什么需要它：`expand_poi` / Pydantic 的报错一次只说一行，
  像 `hl` 写成字符串、`dist` 写成数字这类错误会在 57×N 条里刷屏，
  排查要翻半天。不如在 seed 之前先把稿子过一遍。

★ 它是**通用**的：`--all` 扫 `pipeline/seeds/` 下全部城市，与批次无关。
  每类应写多少条的口径（WANT）是项目的硬约定 —— 改它之前先想清楚。
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from pipeline.authoring.seedlib import SUBTYPE_OF_CATEGORY, expand_poi  # noqa: E402

GROUPS = (("scenic", "SCENIC"), ("food", "FOOD"), ("hotspot", "HOTSPOT"), ("culture", "CULTURE"))
WANT = {"scenic": 26, "food": 15, "hotspot": 10, "culture": 6}


def check(city_id: str, *, count: bool = True) -> int:
    try:
        mod = importlib.import_module(f"pipeline.seeds.{city_id}")
    except Exception as e:
        print(f"❌ 导入失败 {city_id}: {e}")
        return 1

    bad = 0
    total = 0
    for cat, attr in GROUPS:
        items = getattr(mod, attr, [])
        want = WANT[cat]
        # ★ `--no-count` 时数量只提示、不计错。判据：`WANT` 是**扩城目标配额**，
        #   而已入库城市本来就有偏差（实测北京加条目前是 22/16/12/7 共 57 条，
        #   四条全 ❌ 但数据是好的）⇒ 拿它卡"增量入库"会天天误报。
        flag = "  " if len(items) == want else ("❌" if count else "·")
        print(f"{flag} {cat:<8} {len(items)}/{want}")
        if count and len(items) != want:
            bad += 1
        ids: set[str] = set()
        for d in items:
            total += 1
            pid = d.get("id", "?")
            if pid in ids:
                print(f"   ❌ id 重复: {pid}")
                bad += 1
            ids.add(pid)
            for k in ("hl", "tags"):
                if not isinstance(d.get(k), list):
                    print(f"   ❌ {pid} 的 {k} 不是 list: {type(d.get(k)).__name__}")
                    bad += 1
            if not isinstance(d.get("dist"), str):
                print(f"   ❌ {pid} 的 dist 不是字符串（区县名）: {d.get('dist')!r}")
                bad += 1
            if not isinstance(d.get("dur"), tuple):
                print(f"   ❌ {pid} 的 dur 不是元组（写 dur=(60,90)）")
                bad += 1
            if "src" not in d:
                print(f"   ❌ {pid} 缺 src")
                bad += 1
            desc = d.get("desc", "")
            if len(desc) < 98:
                print(f"   ❌ {pid} 的 desc 只有 {len(desc)} 字（需 ≥98）")
                bad += 1
            sub = d.get("sub", "")
            if sub and sub not in SUBTYPE_OF_CATEGORY[cat]:
                print(f"   ❌ {pid} 细类 {sub!r} 不属于 {cat}，合法：{sorted(SUBTYPE_OF_CATEGORY[cat])}")
                bad += 1
            try:
                expand_poi(d, cat, "2026-10-07")
            except Exception as e:
                print(f"   ❌ {pid} 展开失败: {e}")
                bad += 1
    print(f"合计 {total} 条，问题 {bad} 个 —— {'✅ 可以入库' if bad == 0 else '❌ 先修稿'}")
    return 0 if bad == 0 else 1


def main() -> int:
    argv = sys.argv[1:]
    if not argv:
        print("用法：python tools/check_seed.py <城市id>|--all [--no-count]")
        print("      --no-count  只查字段级错误，不拿 WANT 目标配额卡数量")
        return 2
    count = "--no-count" not in argv
    args = [a for a in argv if not a.startswith("--")]
    if not args:
        print("用法：python tools/check_seed.py <城市id>|--all [--no-count]")
        return 2
    if args[0] == "--all":
        d = REPO / "pipeline" / "seeds"
        ids = sorted(p.stem for p in d.glob("*.py") if not p.name.startswith("_"))
    else:
        ids = args
    rc = 0
    for cid in ids:
        print(f"── {cid} ──")
        rc |= check(cid, count=count)
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
