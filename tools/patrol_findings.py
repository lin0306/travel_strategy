#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""巡检发现的**生命周期管理** —— 让「待人工复核」有出口、有结案、不再只增不减。

## 为什么要有这个文件（不是又一个 json 工具）

每小时巡检第一版把所有发现 append 进 `findings-<city>.json`，日志里再抄 3~4 条
「待人工判断」。无人值守跑一晚上之后必然出现三件事：

1. **同一 `(点位, 字段)` 被反复报** —— 门牌 23/73/136 号、人均 15/32/49 元这类
   B/C 档冲突**永远等不到官方口径**，第二轮再查还是那几个 OTA 页面；
2. **文件只增不减** —— 5 轮 32 条，没人会去翻；
3. **存下来之后没有任何机制回头看** —— 下一轮照样扫新点，「发现→存起来→再也不看」。
   而 `patrol_queue` 的排班根本不读 findings，所以自己标的问题永远不会被复查。

所以 findings 需要的是**状态机**，不是一个数组：

| 状态 | 含义 | 去向 |
|---|---|---|
| `open` | 刚发现，等下一轮再核一次 | `patrol_queue next` 优先复查，**不进日志** |
| `stale` | 第二次仍是 B/C 档 ⇒ 信息本身没有唯一答案 | 自动结案，从此不报 |
| `closed` | 已修（`resolved`）/ 明确不修（`wontfix`） | 归档 |

## 三条出口（2026-11-09 起，按「谁来收尾」分，不按「问题严重不严重」分）

| 出口 | 收什么 | 谁收尾 |
|---|---|---|
| `PENDING.md`（自动） | **有明确时间点**的（`--due`：公示期、授牌日、工期、季节性闭园）；**到期就动手**，不用人 | 下一轮巡检自己跑 |
| `PENDING.md` 的「待仲裁」区 | **查到好几种值拿不准**的（`--alt 甲 --alt 乙`）：不是没答案，是没找到**更权威**的那份 | 下一轮巡检按权威链比对，以权威为准 |
| `TODO.md`（人工） | 只有 `human=true` —— **不可逆的取舍**（两个点位其实是同一个、要不要合并）；以及 `level=A 且 seen>=2`（连着两轮有官方口径却没落地，说明卡住了） | 人 |

★ 用户 2026-11-09 的原话：「有些需要人工复核的，是因为数据不对导致的，比如还没挂牌，
这些都可以记录到一个文件里面，下次定时任务执行的时候扫一下待办，有些需要更新了就开始更新；
还有一些是查到了好几种数据拿捏不准用哪个，这种应该去找权威的数据比对，以权威的数据为准。」

所以：**「还没到时间」不等于「需要人」，「拿不准」也不等于「需要人」** ——
前者等日期，后者等权威源。真正要人的只剩不可逆决策。

`TODO.md` / `PENDING.md` 都由 `patrol_report.py` 每轮**覆盖重写**（不 append）。

## 子命令

```
patrol_findings.py note --city <slug> --poi <id> --field <f> --level A|B|C \
        --found "查到什么" [--old "原值"] [--source <url>] [--note "..."] \
        [--due YYYY-MM-DD] [--alt "候选甲（出处）" --alt "候选乙（出处）"] [--human]
patrol_findings.py list [--city <slug>] [--state open|stale|closed] [--poi <id>]
patrol_findings.py close --city <slug> --poi <id> --field <f> --as resolved|wontfix|stale [--why "..."]
patrol_findings.py auto-stale [--city <slug>] [--min-seen 2] [--overdue-days 14] [--dry]
patrol_findings.py open-index <city>         # 给 patrol_queue 排班用
patrol_report.py pending                     # 覆盖重写 _tmp/patrol/PENDING.md（自动待办）
patrol_report.py todo [--limit 10]           # 覆盖重写仓库根 TODO.md（人工待办，末行 HUMAN=n）
```

★ `--due` 是「等官方公示期满 / 等授牌 / 等改造完工」这类**有明确时间点**的挂起：
到期前静默，到期后进 `PENDING.md` 的「已到期」区，**由下一轮巡检直接改，不进 TODO**。

★ `--alt` 是「查到好几种值拿不准」的正规记法：每个候选值配一句出处，同一 `--alt`
重复给。带 `--alt` 的条目自动进 `PENDING.md` 的「待仲裁」区，任务是去**找权威源**
（政府 / 官网 / 官媒 / 景区官方号）比对并采纳，而不是挑一个看着顺眼的。
"""
from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
CITIES = REPO / "data" / "cities"
OUT = REPO / "_tmp" / "patrol"
TODO = OUT / "TODO.md"

#: 允许出现的 field —— 与 `patrol_queue.py` 的 FIXABLE 对齐，外加只有人看图/判断才能得的几类。
#: 故意宽松：这里只是分类标签，写错一个字就报错反而会让任务卡住。
FIELD_OK = {
    "ticket", "hours", "address", "transport", "name", "summary", "district", "tips",
    "image", "cover", "point", "level", "closed", "other",
}
LEVEL_OK = {"A", "B", "C"}


# ─────────────────────────── 读写 ───────────────────────────

def path_of(slug: str) -> Path:
    return OUT / f"findings-{slug}.json"


def load(slug: str) -> list[dict]:
    """读一城的 findings。★ 兼容旧格式：第一版写的是**裸 list**，没有 state/seen。"""
    p = path_of(slug)
    if not p.exists():
        return []
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
    except Exception:                                          # noqa: BLE001
        print(f"★ {p.name} 读不动，当空处理（文件坏了别静默丢，先看一眼）")
        return []
    items = raw if isinstance(raw, list) else (raw.get("items") or [])
    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        it.setdefault("state", "open")
        it.setdefault("seen", 1)
        it.setdefault("firstAt", it.get("at") or it.get("lastAt") or "")
        it.setdefault("lastAt", it.get("at") or "")
        it.setdefault("human", False)
        it.setdefault("dueAt", None)
        it.setdefault("alternatives", [])
        it.setdefault("level", "C")
        out.append(it)
    return out


def save(slug: str, items: list[dict]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    path_of(slug).write_text(json.dumps(
        {"city": slug, "updatedAt": date.today().isoformat(), "items": items},
        ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def _key(it: dict) -> tuple[str, str]:
    return str(it.get("poi") or ""), str(it.get("field") or "")


def _due_hit(it: dict) -> bool:
    """--due 到期了没。没写 due ⇒ 不算到期（靠 auto-stale 收敛）。"""
    d = it.get("dueAt")
    if not d:
        return False
    try:
        return date.fromisoformat(str(d)[:10]) <= date.today()
    except ValueError:
        return False


def _overdue(it: dict) -> int:
    """到期几天了（未到期 / 没写 due ⇒ 0）。用于判断「等了太久也没人动」的兜底结案。"""
    if not _due_hit(it):
        return 0
    try:
        return (date.today() - date.fromisoformat(str(it["dueAt"])[:10])).days
    except ValueError:
        return 0


def need_arb(it: dict) -> bool:
    """是否需要**权威仲裁**：手上有多个候选值，却不知道该信哪个。

    ★ 判据只看「有候选值」+「还没有 A 档口径」，不看 level —— B/C 只是当时的证据强弱，
      真正决定它能不能自己收尾的是「有没有多个值在打架」。
    A 档已拿到就不必仲裁：那已经是权威口径，只差落地。
    """
    if it.get("state") != "open" or it.get("level") == "A":
        return False
    return bool(it.get("alternatives")) or bool(it.get("arb"))


def pending_kind(it: dict) -> str:
    """`due` 到期 / `ready` 证据已齐待落地 / `wait` 等日子 / `arb` 待权威仲裁 / `''` 归人或无关。

    ★ `ready` 是 2026-11-09 第二次收窄加上的一档：**A 档口径已经拿到、只是没落地**
      （连查两轮都确认官网这么写，库里还是旧值）。这类以前进 TODO「等你处理」，
      但它根本不需要判断 —— 需要的是**下一轮把它改掉**。
      只有 `seen>=4`（四轮都没落地）才转人工：那已经不是排班问题，是卡住了。

    ★ `ready` 不要求 `seen>=2`，但**要求 source 是真 URL**：A 档的价值全在出处，
      一句「官方说的」而没有链接，等于没证据 —— 那种让它继续 open 等下一轮补链接，
      不进自动落地队列（否则就是拿"AI 说官方"去改线上数据）。
    """
    if it.get("state") != "open":
        return ""
    if _due_hit(it):
        return "due"
    if it.get("dueAt"):
        return "wait"
    if need_arb(it):
        return "arb"
    if it.get("level") == "A":
        if int(it.get("seen") or 1) >= 4:
            return ""                      # 四轮还没落地 ⇒ 转人工（TODO）
        return "ready" if str(it.get("source") or "").startswith("http") else ""
    return ""


def open_index(slug: str) -> dict[str, dict]:
    """给排班用：`{poi_id: {"open": n, "due": n, "arb": n}}`。只数 open，stale/closed 不参与。

    `arb` 单独计数：那类点位不是「再查一遍」能解决的，得带着候选值去撞权威源，
    排班要给它们更前面 —— 否则它们会在「查过就歇 30 天」的池子里泡到天荒地老。
    """
    idx: dict[str, dict] = {}
    for it in load(slug):
        if it.get("state") != "open":
            continue
        pid = str(it.get("poi") or "")
        if not pid:
            continue
        rec = idx.setdefault(pid, {"open": 0, "due": 0, "arb": 0})
        rec["open"] += 1
        if _due_hit(it):
            rec["due"] += 1
        elif need_arb(it):
            rec["arb"] += 1
    return idx


def _all_cities() -> list[str]:
    return sorted({p.stem.replace("findings-", "") for p in OUT.glob("findings-*.json")})


# ─────────────────────────── 子命令 ───────────────────────────

def _opt(argv: list[str], key: str, default: str = "") -> str:
    return argv[argv.index(key) + 1] if key in argv and argv.index(key) + 1 < len(argv) else default


def cmd_note(argv: list[str]) -> int:
    """记一条发现。同一 (点位, 字段) 重复记 ⇒ `seen+1` 合并，不是新增一行。"""
    slug, poi = _opt(argv, "--city"), _opt(argv, "--poi")
    field, level = _opt(argv, "--field"), (_opt(argv, "--level", "C") or "C").upper()
    found = _opt(argv, "--found")
    if not (slug and poi and field and found):
        print("用法：patrol_findings.py note --city <slug> --poi <id> --field ticket "
              "--level B --found \"查到什么\" [--old ...] [--source <url>] [--due 2026-11-12] "
              "[--alt \"候选甲（出处）\" ...] [--human]")
        return 2
    if field not in FIELD_OK:
        print(f"★ 未知 field「{field}」（可用：{'/'.join(sorted(FIELD_OK))}）")
        return 2
    if level not in LEVEL_OK:
        print(f"★ level 只能是 A/B/C，给的是「{level}」")
        return 2

    items = load(slug)
    today = date.today().isoformat()
    # --alt 可重复：每个候选值一条，必须自带出处，否则「拿不准」会退化成「瞎猜」
    alts = [argv[i + 1] for i, a in enumerate(argv) if a == "--alt" and i + 1 < len(argv)]
    hit = next((x for x in items if _key(x) == (poi, field)), None)
    if hit is None:
        hit = {"poi": poi, "name": _opt(argv, "--name", poi), "field": field,
               "state": "open", "seen": 1, "firstAt": today}
        items.append(hit)
    elif hit.get("state") == "closed":
        # 已结案又被重新发现 ⇒ 说明当时的结论不成立，重新开张
        hit.update({"state": "open", "seen": 1, "firstAt": today, "closeAs": None, "why": None})
    else:
        hit["seen"] = int(hit.get("seen") or 1) + 1

    hit.update({
        "level": level, "found": found, "lastAt": today,
        "old": _opt(argv, "--old", hit.get("old") or ""),
        "source": _opt(argv, "--source", hit.get("source") or ""),
        "note": _opt(argv, "--note", hit.get("note") or ""),
        "name": _opt(argv, "--name", hit.get("name") or poi),
        "dueAt": _opt(argv, "--due") or hit.get("dueAt"),
        "human": True if "--human" in argv else bool(hit.get("human")),
    })
    if alts:                                   # 新候选覆盖旧的：候选值是「当前掌握的几个版本」
        hit["alternatives"] = alts
    # A 档证据一旦拿到，就不再是「口径冲突」——auto-stale 不该把它结掉
    if level == "A":
        hit["state"] = "open"
        hit["alternatives"] = []               # 已有权威口径，候选值作废
    save(slug, items)
    print(f"NOTE {slug}/{poi} {field} [{level}] state={hit['state']} seen={hit['seen']}"
          f"{' due=' + hit['dueAt'] if hit.get('dueAt') else ''}"
          f"{' alt=' + str(len(hit.get('alternatives') or [])) if hit.get('alternatives') else ''}"
          f"{' HUMAN' if hit.get('human') else ''}")
    return 0


def cmd_list(argv: list[str]) -> int:
    slug = _opt(argv, "--city")
    want = _opt(argv, "--state")
    only_poi = _opt(argv, "--poi")
    slugs = [slug] if slug else _all_cities()
    total = 0
    for s in slugs:
        items = load(s)
        for it in items:
            if want and it.get("state") != want:
                continue
            if only_poi and it.get("poi") != only_poi:
                continue
            total += 1
            due = " DUE" if _due_hit(it) else ""
            human = " HUMAN" if it.get("human") else ""
            print(f"{s:12s} {it.get('state'):6s} [{it.get('level')}] {it.get('poi')}"
                  f" {it.get('field'):10s} seen={it.get('seen')}{due}{human}")
            print(f"    {str(it.get('found') or '')[:150]}")
    print(f"TOTAL={total}")
    return 0


def cmd_close(argv: list[str]) -> int:
    slug, poi, field = _opt(argv, "--city"), _opt(argv, "--poi"), _opt(argv, "--field")
    as_ = _opt(argv, "--as", "resolved")
    if not (slug and poi and field):
        print("用法：patrol_findings.py close --city <slug> --poi <id> --field <f> "
              "--as resolved|wontfix|stale [--why \"...\"]")
        return 2
    if as_ not in ("resolved", "wontfix", "stale"):
        print("★ --as 只能是 resolved / wontfix / stale")
        return 2
    items = load(slug)
    hit = next((x for x in items if _key(x) == (poi, field)), None)
    if hit is None:
        print(f"没有这条发现：{slug}/{poi} {field}")
        return 1
    hit["state"] = "closed" if as_ in ("resolved", "wontfix") else "stale"
    hit["closeAs"] = as_
    hit["closedAt"] = date.today().isoformat()
    hit["why"] = _opt(argv, "--why", "")
    save(slug, items)
    print(f"CLOSED {slug}/{poi} {field} ⇒ {as_}")
    return 0


def cmd_auto_stale(argv: list[str]) -> int:
    """把「查了几轮还是没有 A 档」的 B/C 档自动结案 —— 这是防止 findings 只增不减的关键。

    ★ 只动 B/C。A 档哪怕 seen=9 也不能结：它有官方口径，是还没落地，该催落不是该闭嘴。
    ★ `human=true` 的不动：那类要的是人，不是自动闭嘴。
    ★ `dueAt` 未到期的不动（等日子）；到期后**留 14 天**给巡检去执行 —— 一直没执行才认栽，
      否则「到期」会被 auto-stale 悄悄吞掉，正好砸在「到点该更新却没人更新」上。
    ★ `alternatives`（待权威仲裁）的**多给一轮**（seen>=3）：两轮就埋，等于根本没去找权威源。
    """
    slug, dry = _opt(argv, "--city"), "--dry" in argv
    try:
        min_seen = max(2, int(_opt(argv, "--min-seen", "2")))
    except ValueError:
        min_seen = 2
    try:
        overdue_days = max(0, int(_opt(argv, "--overdue-days", "14")))
    except ValueError:
        overdue_days = 14
    slugs = [slug] if slug else _all_cities()
    n = 0
    for s in slugs:
        items, changed = load(s), 0
        for it in items:
            if it.get("state") != "open" or it.get("level") == "A":
                continue
            if it.get("human"):
                continue
            seen = int(it.get("seen") or 1)
            if it.get("dueAt"):
                if _overdue(it) <= overdue_days:
                    continue
                why = f"到期 {_overdue(it)} 天仍未执行，放弃本轮计划"
            elif need_arb(it):
                if seen < max(3, min_seen + 1):
                    continue
                why = f"连续 {seen} 轮找不到权威口径，按现有多数来源保留"
            else:
                if seen < min_seen:
                    continue
                why = f"连续 {seen} 轮只有 B/C 档口径，无官方来源可依"
            it["state"] = "stale"
            it["closeAs"] = "stale"
            it["closedAt"] = date.today().isoformat()
            it["why"] = why
            changed += 1
        if changed:
            n += changed
            if not dry:
                save(s, items)
            print(f"STALE {s}: {changed} 条")
    print(f"AUTO_STALE {n} 条{'（演练，未写）' if dry else ''}")
    return 0


def cmd_todo(argv: list[str] | None = None) -> int:
    """薄壳：真正的渲染已迁到 `patrol_report.py`（人工出口与自动待办放一起才看得清分工）。"""
    from tools import patrol_report
    return patrol_report.cmd_todo(list(argv or []))


def cmd_open_index(argv: list[str]) -> int:
    if not argv:
        print("用法：patrol_findings.py open-index <city>")
        return 2
    idx = open_index(argv[0])
    print(json.dumps(idx, ensure_ascii=False))
    return 0


def auto_close(slug: str, poi: str, fields: list[str], why: str) -> int:
    """改动落地后**顺手结案** —— 让「改完了发现还挂着 open」不可能发生。

    ★ 这是闭环的另一半。`fix` 落了字段、`retire` 下了架，对应的发现就该自动结束；
      否则要靠 AI 记得再敲一遍 `close`，而它十次有三次会忘（实跑 5 轮验证过：
      maojiao-huola 地址明明已改，findings 里还挂着 open，于是又被算进「待人工」）。
    """
    if not fields:
        return 0
    items, n = load(slug), 0
    want = set(fields)
    for it in items:
        if it.get("poi") != poi or it.get("field") not in want or it.get("state") != "open":
            continue
        it["state"] = "closed"
        it["closeAs"] = "resolved"
        it["closedAt"] = date.today().isoformat()
        it["why"] = why
        n += 1
    if n:
        save(slug, items)
        print(f"CLOSED {slug}/{poi} {','.join(sorted(want))} × {n}（{why}）")
    return n


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args:
        print(__doc__[:400])
        return 2
    table = {"note": cmd_note, "list": cmd_list, "close": cmd_close,
             "auto-stale": cmd_auto_stale, "todo": cmd_todo, "open-index": cmd_open_index}
    if args[0] not in table:
        print(f"未知子命令：{args[0]}（可用：{'/'.join(table)}）")
        return 2
    return table[args[0]](args[1:])


if __name__ == "__main__":
    raise SystemExit(main())
