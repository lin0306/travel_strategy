"""「每日点位拓取」的选城 / 备料 / 记账。

## 为什么有这个脚本

`step12_discover` 的城市池 = 已有 `city.json` 的城市，候选落到
`data/_generated/discover/<slug>.json`。它**没有缓存 TTL**，而 2026-10-22 那轮
已把 83 城全扫过 ⇒ 直接跑会「零请求自停」（候选文件只是被重写一遍，假报进度）。

所以「该扫哪座城」必须由**外部账本**决定，不能让 `discover` 自己撞：

| 状态 | 判据 | 处理 |
|---|---|---|
| `never` | 候选文件不存在 | 直接扫（缓存里没这城，自然会打网络） |
| `empty` | 候选文件 `candidates` 为 0 | 同上（上次多半撞了配额/失败） |
| `stale` | 距上次扫描 > `--days` 天（默认 7） | **先 `prepare` 清缓存**，否则全命中缓存 = 零请求 |

★ `--days 7` 不是"7 天扫一轮全库"：它只是"候选满 7 天就有资格重扫"，
  每晚仍只挑**最久没扫的 1 城**（72 次请求）。83 城一轮实际约 **83 晚**。
  别把 `--days` 调得比 1 还小 —— 那只是让更多城有资格，不会加速挑选。

## 用法

```
python tools/discover_queue.py next [--days 7]     # 选 1 城；无事可做打印 NOTHING_TO_DO
python tools/discover_queue.py prepare <slug>     # 清该城 place_search 缓存（重扫前必做）
python tools/discover_queue.py done  <slug> [n]   # 记账（n = 候选数）
python tools/discover_queue.py fail  <slug>       # 记失败；连续 2 次 → 进 skipped
python tools/discover_queue.py status             # 总览
```

★ `next` 会先查配额：`place_search` 当日已用 ≥ 150 就打印 `QUOTA_LOW` 直接退出。
  一次重扫 `--pages=2` 要 72 次请求（36 关键字 × 2 页），留 50 次冗余。
"""

from __future__ import annotations

import json
import sys
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LEDGER = ROOT / ".workbuddy" / "memory" / "discover-scan.json"
DISCOVER_DIR = ROOT / "data" / "_generated" / "discover"
PLACE_CACHE = ROOT / "pipeline" / ".cache" / "place.json"

QUOTA_SOFT_LIMIT = 150     # place_search 当日已用超过此值就不排重扫
MAX_FAILS = 2              # 连续失败几次后放弃该城（进 skipped 留痕）


# ────────────────────────────── 账本 ──────────────────────────────

def load() -> dict:
    if LEDGER.exists():
        try:
            d = json.loads(LEDGER.read_text(encoding="utf-8"))
        except Exception:                              # noqa: BLE001
            d = {}
    else:
        d = {}
    d.setdefault("scanned", {})
    d.setdefault("attempts", {})
    d.setdefault("skipped", {})
    return d


def save(d: dict) -> None:
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    LEDGER.write_text(json.dumps(d, ensure_ascii=False, indent=1) + "\n",
                      encoding="utf-8")


# ────────────────────────────── 数据读取 ──────────────────────────────

def cities() -> list[tuple[str, str, str]]:
    """[(slug, 城市名, 省目录)]，按 slug 排序。"""
    out = []
    for cj in sorted((ROOT / "data" / "cities").glob("*/*/city.json")):
        try:
            d = json.loads(cj.read_text(encoding="utf-8"))
        except Exception:                              # noqa: BLE001
            continue
        slug = cj.parent.name
        name = d.get("name") or slug
        out.append((slug, name, cj.parent.parent.name))
    return out


def cand_info(slug: str) -> tuple[int, str | None]:
    """(候选数, 候选文件日期)。文件不存在 → (0, None)。"""
    p = DISCOVER_DIR / f"{slug}.json"
    if not p.exists():
        return 0, None
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
        n = len(d.get("candidates") or [])
    except Exception:                                  # noqa: BLE001
        n = 0
    return n, date.fromtimestamp(p.stat().st_mtime).isoformat()


def last_scan(slug: str, file_date: str | None, led: dict) -> str | None:
    """上次扫描日期：账本优先，其次候选文件的 mtime。"""
    v = (led["scanned"].get(slug) or {}).get("date")
    return v or file_date


def quota_used_today() -> int:
    """今日 place_search 已用请求数；读不到返回 -1（不敢拦）。"""
    try:
        # ★ 本脚本以 `tools/discover_queue.py` 方式运行，sys.path[0] 是 tools/，
        #   不补 ROOT 就 import 不到 pipeline ⇒ 静默返回 -1（等于永不拦配额）。
        if str(ROOT) not in sys.path:
            sys.path.insert(0, str(ROOT))
        from pipeline.core import fetch
        daily = fetch.load_ledger().get("daily") or {}
        period = str(daily.get("period") or "")
        if period != date.today().isoformat():
            return 0                                   # 跨周期 ⇒ 惰性归零，视为 0
        return int(((daily.get("apis") or {}).get("place_search") or {})
                   .get("requests") or 0)
    except Exception:                                  # noqa: BLE001
        return -1


# ────────────────────────────── 子命令 ──────────────────────────────

def cmd_next(argv: list[str]) -> int:
    days = 7
    if "--days" in argv:
        try:
            days = int(argv[argv.index("--days") + 1])
        except Exception:                              # noqa: BLE001
            pass

    used = quota_used_today()
    if used >= QUOTA_SOFT_LIMIT:
        print(f"QUOTA_LOW used={used} limit={QUOTA_SOFT_LIMIT}")
        return 0

    led = load()
    today = date.today()
    never, empty, stale = [], [], []

    for slug, name, prov in cities():
        if slug in led["skipped"]:
            continue
        n, fdate = cand_info(slug)
        last = last_scan(slug, fdate, led)
        if last is None:
            never.append((slug, name, None, n))
            continue
        if n == 0:
            empty.append((slug, name, last, n))
            continue
        age = (today - date.fromisoformat(last)).days
        if age > days:
            stale.append((slug, name, last, n, age))

    if not (never or empty or stale):
        print("NOTHING_TO_DO")
        print(f"  候选文件全在、且全在 {days} 天内扫过 ⇒ 本轮不烧配额")
        return 0

    if never:
        slug, name, last, n = never[0]
        kind, extra = "never", "候选文件不存在"
    elif empty:
        slug, name, last, n = empty[0]
        kind, extra = "empty", f"上次扫描 0 候选（{last}）"
    else:
        stale.sort(key=lambda r: r[2])                 # 最久没扫的优先
        slug, name, last, n, age = stale[0]
        kind, extra = "stale", f"距上次扫描 {age} 天（{last}）"

    print(f"CITY={slug}")
    print(f"NAME={name}")
    print(f"KIND={kind}")
    print(f"LAST={last or 'never'}")
    print(f"CAND={n}")
    print(f"NOTE={extra}")
    print(f"QUOTA_USED={used}")
    if kind == "stale":
        print("★ 重扫前必须先 `prepare` 清该城缓存，否则全命中缓存 = 零请求")
    return 0


def cmd_prepare(argv: list[str]) -> int:
    if not argv:
        print("用法: prepare <slug> [--dry]")
        return 2
    slug, dry = argv[0], "--dry" in argv

    name = next((n for s, n, _ in cities() if s == slug), None)
    if name is None:
        print(f"ERROR 未知城市 slug：{slug}")
        return 2
    if not PLACE_CACHE.exists():
        print(f"OK 无 place 缓存文件，无需清理（{slug}）")
        return 0

    cache = json.loads(PLACE_CACHE.read_text(encoding="utf-8"))
    prefix = f"{name}|"
    hit = [k for k in cache if k.startswith(prefix)]
    print(f"{slug}（{name}）缓存键 {len(hit)} 条 / 全库 {len(cache)} 条")
    if dry:
        print("DRY 未删除")
        return 0
    for k in hit:
        del cache[k]
    PLACE_CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    print(f"已删除 {len(hit)} 条")
    return 0


def cmd_done(argv: list[str]) -> int:
    if not argv:
        print("用法: done <slug> [候选数]")
        return 2
    slug = argv[0]
    n = int(argv[1]) if len(argv) > 1 and argv[1].isdigit() else 0
    led = load()
    led["scanned"][slug] = {"date": date.today().isoformat(), "cand": n}
    led["attempts"].pop(slug, None)
    save(led)
    print(f"OK {slug} 已记账：{date.today().isoformat()} / 候选 {n}")
    return 0


def cmd_fail(argv: list[str]) -> int:
    if not argv:
        print("用法: fail <slug>")
        return 2
    slug = argv[0]
    led = load()
    n = int(led["attempts"].get(slug) or 0) + 1
    led["attempts"][slug] = n
    msg = f"{slug} 失败第 {n} 次"
    if n >= MAX_FAILS:
        led["skipped"][slug] = {"date": datetime.now().isoformat(timespec="seconds"),
                                "reason": f"连续失败 {n} 次"}
        msg += f" ⇒ 已放弃并列入 skipped（要恢复：status 看名字，从 skipped 里删掉）"
    save(led)
    print("OK " + msg)
    return 0


def cmd_status(argv: list[str]) -> int:
    led = load()
    today = date.today()
    never = empty = ok = 0
    oldest = None
    for slug, name, prov in cities():
        if slug in led["skipped"]:
            continue
        n, fdate = cand_info(slug)
        last = last_scan(slug, fdate, led)
        if last is None:
            never += 1
        elif n == 0:
            empty += 1
        else:
            ok += 1
            if oldest is None or last < oldest[0]:
                oldest = (last, slug, name)
    total = len([1 for s, _, _ in cities() if s not in led["skipped"]])
    print(f"城 {total} · 有候选 {ok} · 空候选 {empty} · 从未扫描 {never}")
    if oldest:
        age = (today - date.fromisoformat(oldest[0])).days
        print(f"最久未扫：{oldest[2]}({oldest[1]}) {oldest[0]} · {age} 天前")
    if led["skipped"]:
        print("已放弃：" + "、".join(f"{k}({v.get('reason','')})"
                                    for k, v in led["skipped"].items()))
    print(f"今日 place_search 已用 {quota_used_today()} / {QUOTA_SOFT_LIMIT}（软上限）")
    return 0


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    cmd, rest = argv[0], argv[1:]
    table = {"next": cmd_next, "prepare": cmd_prepare, "done": cmd_done,
             "fail": cmd_fail, "status": cmd_status}
    if cmd not in table:
        print(f"未知子命令：{cmd}\n{__doc__}")
        return 2
    return table[cmd](rest)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
