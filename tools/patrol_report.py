#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""巡检的两个**出口文件** —— 一个给机器，一个给人。分开写、分开看得清楚。

| 文件 | 谁消费 | 收什么 |
|---|---|---|
| `_tmp/patrol/PENDING.md` | **下一轮巡检自己** | ① 有明确日期且已到期（`--due`）② 日期未到（只是提醒）③ 多个候选值打架（`--alt`，去查权威源） |
| 仓库根 `TODO.md` | **人** | 只有不可逆取舍（`--human`）+ 连续四轮有官方口径却没落地（卡住了） |

★ 这两件事以前混在一起，结果是「还没挂牌」「三个门牌号不知道信哪个」全堆进 TODO，
  每次跑完都要人看 —— 但这两类**根本不需要人**：前者等日期，后者等权威源。
  用户 2026-11-09 的原话就是这个意思（见 `patrol_findings.py` 顶部）。

★ 人的出口放**仓库根**而不是 `_tmp/patrol/`：待办写在 git 忽略的一次性目录里，
  等于没人看得见。定时任务还会把 `HUMAN=n` 写进任务名（`⚠️n 条待确认`），
  让 WorkBuddy 的完成通知与侧边栏直接显示条数 —— 通知标题只显示任务名，不显示正文。

```
patrol_report.py pending [--limit 40]     # 覆盖重写 PENDING.md，并打印机读行
patrol_report.py todo [--limit 10]        # 覆盖重写根目录 TODO.md，末行打印 HUMAN=n
```

机读行（任务用来决定本轮干什么，**不要靠读 markdown 猜**）：
```
DUE  <city>|<poi>|<field>|<dueAt>|<name>
WAIT <city>|<poi>|<field>|<dueAt>|<name>
ARB  <city>|<poi>|<field>|<name>|<候选1> / <候选2>
PENDING due=N wait=M arb=K
```
"""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
from tools import patrol_findings as F                            # noqa: E402

OUT = REPO / "_tmp" / "patrol"
PENDING = OUT / "PENDING.md"
TODO = REPO / "TODO.md"
#: ★ 人的出口放**仓库根**，不放 `_tmp/patrol/`：`_tmp/` 是 git 忽略的一次性目录，
#:   人和 IDE 都不会去翻它 —— 待办写在那里等于没通知到人（2026-11-09 用户提的正是这点）。
LVL = {"A": 0, "B": 1, "C": 2}


def _opt(argv: list[str], key: str, default: str = "") -> str:
    return argv[argv.index(key) + 1] if key in argv and argv.index(key) + 1 < len(argv) else default


def _land_hint(s: str, it: dict) -> str:
    """这条发现**怎么落库** —— 按字段给不同出路，别一律甩一句 `fix`。

    ★ `level` 是个典型陷阱：景区 A 级变化在点位侧**没有对应字段**，写 `--set level=`
      会被白名单直接拒。PENDING.md 如果还教人这么写，下一轮必然卡在同一个地方 ——
      这正是「同一件事反复要人复核」的老病根。
    """
    f = str(it.get("field") or "")
    key = {"cover": "coverIndex"}.get(f, f)
    poi, src = it.get("poi"), it.get("source") or "<url>"
    try:
        from tools import patrol_queue as Q
        fixable = key in Q.FIXABLE
    except Exception:                                              # noqa: BLE001
        fixable = False
    if fixable:
        return (f'`patrol_queue.py fix --city {s} --poi {poi} --set {key}=<值> '
                f'--source "{src}" --reason "..."`（改完自动结案）')
    if f == "level":
        return ("`level` 在点位侧**没有这个字段** ⇒ 把新等级写进 `summary`"
                f"（`fix --set summary=<一句话>`），再 `close --as resolved`；"
                "没授牌就 `--due <授牌日>` 留到那天")
    if f in ("image", "cover"):
        return (f"图片走重抓：`fetch_candidates.py grab {s} --poi {poi} --replace` → "
                "看图 → `apply`（≥1 张即自动结案）")
    return (f'`patrol_findings.py close --city {s} --poi {poi} --field {f} '
            '--as resolved --why "查证后现行值本来就对"')


def _days_left(due: str) -> int:
    try:
        return (date.fromisoformat(str(due)[:10]) - date.today()).days
    except ValueError:
        return 0


def _buckets() -> dict[str, list[tuple[str, dict]]]:
    """一次扫全库，按出口分桶 —— 别对每个出口都 `_all_cities()+load()` 一遍（83 城 ×4 次读盘）。"""
    out: dict[str, list[tuple[str, dict]]] = {"due": [], "ready": [], "wait": [], "arb": []}
    for s in F._all_cities():
        for it in F.load(s):
            k = F.pending_kind(it)
            if k in out:
                out[k].append((s, it))
    return out


# ─────────────────────────── PENDING（交给下一轮的自己） ───────────────────────────

def cmd_pending(argv: list[str]) -> int:
    try:
        limit = max(1, int(_opt(argv, "--limit", "40")))
    except ValueError:
        limit = 40
    b = _buckets()
    due = sorted(b["due"], key=lambda r: str(r[1].get("dueAt") or ""))
    ready = sorted(b["ready"], key=lambda r: -int(r[1].get("seen") or 1))
    wait = sorted(b["wait"], key=lambda r: str(r[1].get("dueAt") or ""))
    arb = sorted(b["arb"], key=lambda r: (LVL.get(str(r[1].get("level")), 3),
                                          str(r[1].get("firstAt") or "")))

    lines = ["# 巡检待办（自动执行，不需要人）", "",
             f"> 生成于 {date.today().isoformat()}　"
             f"到期 {len(due)} · 待落地 {len(ready)} · 等待 {len(wait)} · 待仲裁 {len(arb)}", "",
             "这份文件是给**下一轮巡检**看的，它自己消费：一、二区直接改，四区去查权威源。",
             "**不要往这里手写东西** —— 加条目的唯一入口是 `patrol_findings.py note",
             "--due/--alt`，手写的条目排不进排班、也不会被结案。", ""]

    lines += ["## 一、已到期 ⇒ 本轮动手", ""]
    if not due:
        lines += ["（无）", ""]
    for i, (s, it) in enumerate(due[:limit], 1):
        od = F._overdue(it)
        lines += [f"### {i}. {it.get('name')}（{s} / {it.get('poi')}）— {it.get('field')}"
                  f"　`到期 {it.get('dueAt')}（已过 {od} 天）`", "",
                  f"- 库内现值：{it.get('old') or '（未记）'}",
                  f"- 到期该做：{it.get('note') or it.get('found') or ''}"]
        if it.get("source"):
            lines.append(f"- 当时来源：{it['source']}")
        lines += [f"- 怎么落：{_land_hint(s, it)}", ""]

    lines += ["## 二、证据已齐、等落地（A 档，别再查了，改掉就行）", ""]
    if not ready:
        lines += ["（无）", ""]
    for i, (s, it) in enumerate(ready[:limit], 1):
        lines += [f"### {i}. {it.get('name')}（{s} / {it.get('poi')}）— {it.get('field')}"
                  f"　`第 {it.get('seen')} 轮`", "",
                  f"- 库内现值：{it.get('old') or '（未记）'}",
                  f"- 官方口径：{it.get('found') or ''}"]
        if it.get("source"):
            lines.append(f"- 来源：{it['source']}")
        lines += [f"- 怎么落：{_land_hint(s, it)}",
                  "- ★ 字段真改不了就把结论写进 `summary` 再 close，**不要留在 open**；"
                  "第 4 轮还落不了会转人工（`TODO.md`）", ""]

    lines += ["## 三、等待中（未到日期，本轮不用动）", ""]
    if not wait:
        lines += ["（无）", ""]
    else:
        lines += ["| 还有 | 到期 | 城市 / 点位 | 字段 | 等什么 |", "|---|---|---|---|---|"]
        for s, it in wait[:limit]:
            lines.append(f"| {_days_left(it.get('dueAt'))} 天 | {it.get('dueAt')} | "
                         f"{it.get('name')}（{s} / {it.get('poi')}） | {it.get('field')} | "
                         f"{(it.get('note') or it.get('found') or '')[:60]} |")
        lines.append("")

    lines += ["## 四、待权威仲裁（多个候选值打架）", "",
              "★ **不是让人挑一个** —— 是让下一轮带着这几个候选去找**权威源**（政府/文旅局公告 >",
              "景区官网/官方公众号/官媒 > OTA > 自媒体）。权威说哪个就是哪个，落地后自动结案。", ""]
    if not arb:
        lines += ["（无）", ""]
    for i, (s, it) in enumerate(arb[:limit], 1):
        alts = it.get("alternatives") or []
        lines += [f"### {i}. {it.get('name')}（{s} / {it.get('poi')}）— {it.get('field')}"
                  f"　`[{it.get('level')} 档 · 第 {it.get('seen')} 轮]`", "",
                  f"- 库内现值：{it.get('old') or '（未记）'}",
                  f"- 候选（{len(alts)} 个）："]
        lines += [f"  {j}. {a}" for j, a in enumerate(alts, 1)] or ["  （未逐条记，见下方查到）"]
        lines += [f"- 查到：{it.get('found') or ''}"]
        if it.get("source"):
            lines.append(f"- 主来源：{it['source']}")
        lines += [f"- 怎么收尾：查到权威口径 ⇒ `fix` 落地（自动结案）；"
                  f"权威源与库内一致 ⇒ `patrol_findings.py close --city {s} --poi "
                  f"{it.get('poi')} --field {it.get('field')} --as resolved --why \"官网与库内一致\"`；"
                  "**禁止**在候选里挑一个看着顺眼的直接写", ""]

    OUT.mkdir(parents=True, exist_ok=True)
    PENDING.write_text("\n".join(lines) + "\n", encoding="utf-8")

    for s, it in due:
        print(f"DUE  {s}|{it.get('poi')}|{it.get('field')}|{it.get('dueAt')}|{it.get('name')}")
    for s, it in ready:
        print(f"READY {s}|{it.get('poi')}|{it.get('field')}|{it.get('seen')}|{it.get('name')}")
    for s, it in wait:
        print(f"WAIT {s}|{it.get('poi')}|{it.get('field')}|{it.get('dueAt')}|{it.get('name')}")
    for s, it in arb:
        alts = " / ".join(str(a)[:40] for a in (it.get("alternatives") or []))
        print(f"ARB  {s}|{it.get('poi')}|{it.get('field')}|{it.get('name')}|{alts}")
    print(f"PENDING due={len(due)} ready={len(ready)} wait={len(wait)} arb={len(arb)}"
          f"  ⇒ {PENDING.relative_to(REPO).as_posix()}")
    return 0


# ─────────────────────────── TODO（交给人的，越少越好） ───────────────────────────

def cmd_todo(argv: list[str]) -> int:
    """重写仓库根 `TODO.md` —— 全局唯一的人工出口。

    ★ **覆盖写**，不是 append：这一份永远是「此刻真的需要人」的全集，
      所以它短、可读、能一眼看完。需要历史的看 `findings-*.json`。
    ★ 到期项 / 等待项 / 待仲裁项**一律不收**：它们有自动出口（见 `cmd_pending`）。
      收进来就等于把「机器能干完的活」重新摊到人身上，这正是要修的病。
    """
    try:
        limit = max(1, int(_opt(argv, "--limit", "10")))
    except ValueError:
        limit = 10
    rows = []
    for s in F._all_cities():
        for it in F.load(s):
            if it.get("state") != "open":
                continue
            #: `human=true` 的**优先于人**，哪怕它同时带 due/alt —— 人已经明确说了要自己决定。
            if not it.get("human") and F.pending_kind(it):
                continue
            # 两类才配占用人：AI 明确标记「需要人决定」的；以及**连着四轮都拿到 A 档、
            # 却始终没落地的**（前 2~3 轮在 PENDING 里自动执行，4 轮还不行说明真的卡住了）。
            stuck = it.get("level") == "A" and int(it.get("seen") or 1) >= 4
            if not (it.get("human") or stuck):
                continue
            why = it.get("why") or ("连续四轮都有官方口径但没落地，需要人看卡在哪"
                                    if stuck else "涉及不可逆的取舍，自动化判不了")
            rows.append((LVL.get(str(it.get("level")), 3), str(it.get("firstAt") or ""), s, it, why))
    rows.sort(key=lambda r: (r[0], r[1]))
    OUT.mkdir(parents=True, exist_ok=True)
    lines = ["# 巡检待人工处理", "",
             f"> 生成于 {date.today().isoformat()}　共 {len(rows)} 条"
             "（只收「需要人做不可逆决定」的。到期的、等日期的、多来源打架的都已分流到 "
             "`PENDING.md`，由下一轮巡检自动处理，不占用人）", ""]
    if not rows:
        lines += ["**当前没有需要人工处理的项。**", "",
                  "巡检在自行收敛：能修的已修，到期的按时改，口径冲突的去查权威源，"
                  "图错的每轮 ≤2 点重抓。",
                  "想看到期与仲裁队列：`patrol_report.py pending`。"]
    for i, (_lvl, _at, s, it, why) in enumerate(rows[:limit], 1):
        lines += [f"## {i}. {it.get('name')}（{s} / {it.get('poi')}）— {it.get('field')}",
                  "", f"- 现状：{it.get('old') or '（未记）'}",
                  f"- 查到：{it.get('found') or ''}"]
        if it.get("note"):
            lines.append(f"- 备注：{it['note']}")
        if it.get("source"):
            lines.append(f"- 来源：{it['source']}")
        lines += [f"- 为什么需要人：{why}",
                  f"- 怎么结案：`patrol_findings.py close --city {s} --poi {it.get('poi')} "
                  f"--field {it.get('field')} --as resolved`", ""]
    if len(rows) > limit:
        lines.append(f"（还有 {len(rows) - limit} 条，`--limit` 可放开）")
    TODO.write_text("\n".join(lines) + "\n", encoding="utf-8")
    #: `HUMAN=n` 是给定时任务读的：>0 时它会把任务名改成带 `⚠️n 条待确认`，
    #: 这样 WorkBuddy 的完成通知与侧边栏直接显示条数（通知标题只显示任务名，不显示正文）。
    print(f"TODO {TODO.relative_to(REPO).as_posix()} 写入 {min(len(rows), limit)}/{len(rows)} 条"
          f"　HUMAN={len(rows)}")
    return 0


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args:
        print(__doc__[:600])
        return 0
    table = {"pending": cmd_pending, "todo": cmd_todo}
    if args[0] not in table:
        print(f"未知子命令：{args[0]}（可用：{'/'.join(table)}）")
        return 2
    return table[args[0]](args[1:])


if __name__ == "__main__":
    sys.exit(main())
