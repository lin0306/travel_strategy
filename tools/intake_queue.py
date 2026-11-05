"""「每日候选入库」的选城 / 记账。

## 为什么要有它

「哪座城该入库、是不是全做完了」必须由**脚本**回答。写在定时任务 prompt 里让模型自己数，
每天算出来的数字都不一样 ⇒ 要么同城反复做，要么永远不知道该收尾。

## 判定顺序

| 顺序 | 条件 | 意义 |
|---|---|---|
| ① 首次入库 | `done[slug]` 为空 且 候选 > 0 | 还没碰过的城，候选多的优先 |
| ② 复扫补入 | 候选文件 mtime > `dates[slug]` | 入库之后又拓到新候选 ⇒ 回头补 |
| ③ 全做完 | 都不满足 | 打印 `ALL_DONE` |

★ 复扫那条关键：`discover` 每晚可能重扫一城（`discover_queue`），候选文件会更新。
  只看 `done` 是否为空，就会**永远漏掉这些新候选**。

## 用法

```
python tools/intake_queue.py next              # 选 1 城；无事可做打印 ALL_DONE
python tools/intake_queue.py done <slug> <id,id,...>   # 记账（追加，去重）
python tools/intake_queue.py skip <slug> <原因>        # 放弃该城（无料/无法核实）
python tools/intake_queue.py status            # 总览
```

账本：`.workbuddy/memory/discover-intake.json`（`done` / `dates` / `skipped`）。
★ `done[slug]` 存的是**已入库的 POI id 列表**，别改成计数 —— 老账本就是这个格式。
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LEDGER = ROOT / ".workbuddy" / "memory" / "discover-intake.json"
DISCOVER_DIR = ROOT / "data" / "_generated" / "discover"


# ────────────────────────────── 账本 ──────────────────────────────

def load() -> dict:
    d = {}
    if LEDGER.exists():
        try:
            d = json.loads(LEDGER.read_text(encoding="utf-8"))
        except Exception:                              # noqa: BLE001
            d = {}
    d.setdefault("_note", "候选入库账本：done[city]=已入库 POI id 列表；dates=最后入库日期；skipped=放弃")
    d.setdefault("done", {})
    d.setdefault("dates", {})
    d.setdefault("skipped", {})
    return d


def save(d: dict) -> None:
    LEDGER.write_text(json.dumps(d, ensure_ascii=False, indent=1) + "\n",
                      encoding="utf-8")


# ────────────────────────────── 数据 ──────────────────────────────

def cand_of(slug: str) -> tuple[int, float]:
    """(候选数, 候选文件 mtime 时间戳)。不存在 → (0, 0)。"""
    p = DISCOVER_DIR / f"{slug}.json"
    if not p.exists():
        return 0, 0.0
    try:
        n = len(json.loads(p.read_text(encoding="utf-8")).get("candidates") or [])
    except Exception:                                  # noqa: BLE001
        n = 0
    return n, p.stat().st_mtime


def is_fresh(slug: str, mt: float, last: str | None) -> bool:
    """候选文件是否比「最后入库日期」新。

    ★ 必须**两边都化成日期**再比。拿 `date.toordinal()*86400`（约 6.4e10）去比
      文件 mtime（约 1.79e9）恒为假 —— 复扫分支会永远不触发，而且零报错。
    """
    if not last or mt <= 0:
        return False
    try:
        return date.fromtimestamp(mt) > date.fromisoformat(last)
    except Exception:                                  # noqa: BLE001
        return False


def cities() -> list[tuple[str, str]]:
    """[(slug, 城市名)]。以 city.json 为「已收录」的唯一真源。"""
    out = []
    for cj in sorted((ROOT / "data" / "cities").glob("*/*/city.json")):
        try:
            name = json.loads(cj.read_text(encoding="utf-8")).get("name") or cj.parent.name
        except Exception:                              # noqa: BLE001
            name = cj.parent.name
        out.append((cj.parent.name, name))
    return out


# ────────────────────────────── 子命令 ──────────────────────────────

def cmd_next(argv: list[str]) -> int:
    led = load()
    first, revisit = [], []

    for slug, name in cities():
        if slug in led["skipped"]:
            continue
        n, mt = cand_of(slug)
        if n <= 0:
            continue
        ids = led["done"].get(slug) or []
        if not ids:
            first.append((n, slug, name, 0))
            continue
        # 候选文件比「最后入库日期」新 ⇒ 中间又拓到了新候选
        if is_fresh(slug, mt, led["dates"].get(slug)):
            revisit.append((n, slug, name, len(ids)))

    if not (first or revisit):
        print("ALL_DONE")
        print(f"  {len(led['done'])} 城已入库、且没有比入库日期更新的候选文件")
        return 0

    pool = first or revisit
    pool.sort(key=lambda r: (-r[0], r[1]))
    n, slug, name, done_n = pool[0]
    print(f"CITY={slug}")
    print(f"NAME={name}")
    print(f"CAND={n}")
    print(f"DONE_POIS={done_n}")
    print(f"MODE={'first' if first else 'revisit'}")
    print(f"REMAIN_CITIES={len(pool)}")
    return 0


def cmd_done(argv: list[str]) -> int:
    if not argv:
        print("用法: done <slug> <id1,id2,...>")
        return 2
    slug = argv[0]
    ids = [x.strip() for x in (argv[1] if len(argv) > 1 else "").split(",") if x.strip()]
    led = load()
    cur = led["done"].setdefault(slug, [])
    added = [i for i in ids if i not in cur]
    cur.extend(added)
    led["dates"][slug] = date.today().isoformat()
    save(led)
    print(f"OK {slug} 记账：新增 {len(added)} 个 id，累计 {len(cur)} 个")
    if ids and not added:
        print("  ★ 一条都没加上 —— 检查传进来的 id 是不是已经有了")
    return 0


def cmd_skip(argv: list[str]) -> int:
    if not argv:
        print("用法: skip <slug> <原因>")
        return 2
    slug = argv[0]
    reason = " ".join(argv[1:]) or "（未写原因）"
    led = load()
    led["skipped"][slug] = {"date": date.today().isoformat(), "reason": reason}
    save(led)
    print(f"OK {slug} 已放弃：{reason}")
    return 0


def cmd_status(argv: list[str]) -> int:
    led = load()
    todo = rev = 0
    for slug, name in cities():
        if slug in led["skipped"]:
            continue
        n, mt = cand_of(slug)
        if n <= 0:
            continue
        ids = led["done"].get(slug) or []
        if not ids:
            todo += 1
        elif is_fresh(slug, mt, led["dates"].get(slug)):
            rev += 1
    total_pois = sum(len(v) for v in led["done"].values())
    print(f"已入库 {len(led['done'])} 城 / 共 {total_pois} 个 POI")
    print(f"待首次入库 {todo} 城 · 待复扫补入 {rev} 城")
    if led["skipped"]:
        print("已放弃：" + "、".join(f"{k}" for k in led["skipped"]))
    return 0


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    table = {"next": cmd_next, "done": cmd_done, "skip": cmd_skip, "status": cmd_status}
    if argv[0] not in table:
        print(f"未知子命令：{argv[0]}\n{__doc__}")
        return 2
    return table[argv[0]](argv[1:])


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
