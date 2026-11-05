#!/usr/bin/env python3
"""无图点位补图队列：选下一座城 / 记账 / 判断是否全库做完。

为什么单独一个脚本：这件事要交给**定时任务**自动跑，而定时任务是独立进程。
“还剩哪些城、下一座做谁、是不是全做完了”这三个判断如果写在 prompt 里让人（模型）
自己算，每天都会算出不同的数字 —— 那就永远不知道什么时候该收尾自删。

用法：
  refill_queue.py next            下一座城（首行 CITY=<slug> NOIMG=<n>；无活可干则首行 ALL_DONE）
  refill_queue.py done <slug>     本城补图完成（写入 refilled）
  refill_queue.py fail <slug>     本城失败（attempts+1；连续 2 次失败自动放弃，记入 skipped）
  refill_queue.py status          全库进度 + 待补清单

账本是 `.workbuddy/memory/image-rebuild.json`：
  refilled  已处理（含“处理完确认没料”的城）
  attempts  失败次数（{slug: n}）
  skipped   放弃的城（{slug: 原因}）—— 有痕，不许静默跳过
★ refilled 是“这座城我处理过了”，不是“所有点位都有图了”。补不到图的点位是终态，
  前端走占位卡（build 里是 WARN，不是 ERROR）。
"""
import glob
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LEDGER = ROOT / ".workbuddy" / "memory" / "image-rebuild.json"
MAX_FAIL = 2


def load():
    if not LEDGER.exists():
        return {"refilled": [], "attempts": {}, "skipped": {}}
    d = json.loads(LEDGER.read_text(encoding="utf-8"))
    d.setdefault("refilled", [])
    d.setdefault("attempts", {})
    d.setdefault("skipped", {})
    return d


def save(d):
    LEDGER.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")


def scan():
    """全库点位与无图统计：[(slug, 无图数, 总数, 目录)]，按 slug 排序。"""
    out = []
    for q in glob.glob(str(ROOT / "data" / "cities" / "*" / "*" / "city.json")):
        cdir = Path(q).parent
        files = glob.glob(str(cdir / "pois" / "*" / "*.json"))
        if not files:
            continue
        noimg = 0
        for f in files:
            try:
                if not (json.loads(Path(f).read_text(encoding="utf-8")).get("images") or []):
                    noimg += 1
            except Exception:
                pass
        out.append((cdir.name, noimg, len(files), str(cdir)))
    out.sort()
    return out


def cmd_next():
    d = load()
    done = set(d["refilled"])
    rows = scan()
    total = sum(r[2] for r in rows)
    noimg = sum(r[1] for r in rows)

    # 完全没有无图点位的城直接记账，省得每轮都占队列（这些城已经不用补了）
    auto = [r[0] for r in rows if r[1] == 0 and r[0] not in done]
    if auto:
        d["refilled"].extend(auto)
        save(d)
        done |= set(auto)
        print("AUTO_DONE %d 城（本来就无图 0）: %s" % (len(auto), " ".join(auto)))

    remain = [r for r in rows if r[1] > 0 and r[0] not in done]
    remain.sort(key=lambda r: (-r[1], d["attempts"].get(r[0], 0), r[0]))

    print("全库 %d 点位 / 无图 %d (%.1f%%) · 已处理 %d 城 / 待补 %d 城"
          % (total, noimg, noimg * 100.0 / max(total, 1), len(done), len(remain)))
    if not remain:
        print("ALL_DONE")
        return 0

    slug, n, t, path = remain[0]
    print("CITY=%s NOIMG=%d TOTAL=%d DIR=%s" % (slug, n, t, path))
    print("队列前 5:", " ".join("%s(%d)" % (r[0], r[1]) for r in remain[:5]))
    return 0


def cmd_done(slug):
    d = load()
    if slug not in d["refilled"]:
        d["refilled"].append(slug)
    d["attempts"].pop(slug, None)
    d["skipped"].pop(slug, None)
    save(d)
    print("done %s · 已处理 %d 城" % (slug, len(d["refilled"])))
    return 0


def cmd_fail(slug):
    d = load()
    n = d["attempts"].get(slug, 0) + 1
    d["attempts"][slug] = n
    if n >= MAX_FAIL:
        if slug not in d["refilled"]:
            d["refilled"].append(slug)
        d["skipped"][slug] = "连续 %d 次抓取失败，已放弃（图源可能无实景）" % n
        save(d)
        print("fail %s ×%d → 已放弃并记账（不再重试）" % (slug, n))
    else:
        save(d)
        print("fail %s ×%d → 下一轮仍会重试（连续 %d 次才放弃）" % (slug, n, MAX_FAIL))
    return 0


def cmd_status():
    d = load()
    done = set(d["refilled"])
    rows = scan()
    total = sum(r[2] for r in rows)
    noimg = sum(r[1] for r in rows)
    print("全库 %d 点位 / 无图 %d (%.1f%%)" % (total, noimg, noimg * 100.0 / max(total, 1)))
    print("已处理 %d 城 / 共 %d 城" % (len(done), len(rows)))
    if d["skipped"]:
        print("已放弃:", ", ".join("%s(%s)" % (k, v) for k, v in d["skipped"].items()))
    rest = [(r[1], r[0]) for r in rows if r[0] not in done]
    rest.sort(reverse=True)
    print("待补 %d 城 / %d 无图" % (len(rest), sum(x[0] for x in rest)))
    for n, s in rest[:15]:
        print("   %-14s 无图 %d" % (s, n))
    return 0


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    c = sys.argv[1]
    if c == "next":
        return cmd_next()
    if c == "status":
        return cmd_status()
    if c in ("done", "fail"):
        if len(sys.argv) < 3:
            print("用法: refill_queue.py %s <slug>" % c)
            return 2
        return cmd_done(sys.argv[2]) if c == "done" else cmd_fail(sys.argv[2])
    print("未知子命令 %s" % c)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
