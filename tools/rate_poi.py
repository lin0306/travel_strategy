#!/usr/bin/env python3
"""tools/rate_poi.py —— 候选/点位的**风评打分**（入库前的质量闸门）。

## 为什么要有这个
`discover` 抓候选只看「关键词命中」：图商每个关键词最多返回 20 条，按相关度/距离排，
**与景点好坏完全无关**。所以候选池里必然混着「同名小庙」「已废弃的旧址」
「差评一片的商业街」「连锁复刻古镇」。以前靠 A 段 AI 目测挑，判据不可复现 ——
换一轮、换个人结论就会变，而且没有任何留痕。

现在把它落成可查的分数：4 个维度加权成 0~5，写进
`data/_generated/reviews/<city>.json`（**独立文件**：重扫候选只覆盖
`discover/<city>.json`，评分不会跟着丢）。

## 打分卡（维度权重和为 1）
| 维度 | 权重 | 看什么 |
|---|---|---|
| 口碑 | 0.40 | 点评/携程/马蜂窝评分 + 差评密度（「避雷 / 踩雷 / 不值 / 宰客」占比） |
| 独特 | 0.25 | 是否「只有这里有」；连锁、复刻商业街、随处可见的公园给低分 |
| 密度 | 0.20 | 一次能看多少（看点数量、可玩时长）；单体小店、单块碑给低分 |
| 可信 | 0.15 | 官方/官媒背书、是否长期闭馆、是否已停业、是否只是地名 |

## 判档
| 档 | 区间 | 含义 |
|---|---|---|
| `go` | score ≥ 3.5 | 入库 |
| `maybe` | 2.5 ≤ score < 3.5 | **仅当该城该子类还空着**才入，否则攒着 |
| `no` | score < 2.5 | 不入（避雷/差评为主/已废弃/纯复刻） |

★ 分数是**判断留痕，不是真理**：这轮判 no，下轮官方公告说改造完成、重新开放，
  再 `rate` 一次覆盖即可（同名后一条覆盖前一条，`at` 记录日期）。
★ 四个维度**必须给全**。只给总分等于又回到"拍脑袋"，工具直接拒。
★ 证据只认：官方/官媒/监管处罚 > OTA 评分 > 自媒体。评分里出现"避雷"类词要单独记
  进 `--why`，那是热点巡检（每小时任务）后续要复查的线索。

## 用法
```
# 打分（4 维必填；--src 可多次，记的是真链接）
python tools/rate_poi.py rate --city shenzhen --name "深圳博物馆" \
    --dim 口碑=4.5 --dim 独特=4.0 --dim 密度=4.5 --dim 可信=5 \
    --why "市属大馆，官方免费，常设展口碑好" --src https://www.szmuseum.com/

# 看全城评分（按分数降序）
python tools/rate_poi.py show --city shenzhen --min 3.5

# 查单条（入库前确认是否已评过）
python tools/rate_poi.py check --city shenzhen --name "深圳博物馆"
```
退出码：`0` 正常；`2` = 参数/维度不合法（**不是**"分数低"，别拿退出码判好坏）。
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "data" / "_generated" / "reviews"

#: 维度 → 权重。**改这里就要同步改 A 段 prompt 里的打分卡**（两处描述必须一致，
#: 否则 AI 按 0.5/0.3/0.2 打分、工具按 0.4/0.25/0.2 算，分数会静默偏移）。
WEIGHTS = {"口碑": 0.40, "独特": 0.25, "密度": 0.20, "可信": 0.15}
GO_MIN = 3.5
MAYBE_MIN = 2.5


def _verdict(score: float) -> str:
    if score >= GO_MIN:
        return "go"
    if score >= MAYBE_MIN:
        return "maybe"
    return "no"


def _path(city: str) -> Path:
    return OUT / f"{city}.json"


def _load(city: str) -> dict:
    p = _path(city)
    if not p.is_file():
        return {"version": 1, "city": city, "items": {}}
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:                                     # noqa: BLE001
        raise SystemExit(f"评分文件读不动（{p}）：{e}")
    d.setdefault("items", {})
    return d


def _save(city: str, d: dict) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    d["updatedAt"] = date.today().isoformat()
    _path(city).write_text(
        json.dumps(d, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def _parse_dim(raw: list[str]) -> dict[str, float]:
    dims: dict[str, float] = {}
    for item in raw:
        if "=" not in item:
            raise SystemExit(f"--dim 要写成 维度=分值，收到「{item}」")
        k, v = item.split("=", 1)
        k = k.strip()
        if k not in WEIGHTS:
            raise SystemExit(f"未知维度「{k}」，只能是 {'/'.join(WEIGHTS)}")
        try:
            f = float(v)
        except ValueError:
            raise SystemExit(f"「{k}」的分值不是数字：「{v}」")
        if not 0 <= f <= 5:
            raise SystemExit(f"「{k}」的分值 {f} 越界，0~5")
        dims[k] = f
    missing = [k for k in WEIGHTS if k not in dims]
    if missing:
        raise SystemExit(f"缺维度：{'/'.join(missing)} —— 四维必须给全"
                         f"（只给总分等于拍脑袋，工具不认）")
    return dims


def cmd_rate(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="rate")
    ap.add_argument("--city", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--dim", action="append", required=True, metavar="维度=分值")
    ap.add_argument("--why", required=True, help="一句话理由（含关键证据）")
    ap.add_argument("--src", action="append", default=[], help="真链接，可多次")
    a = ap.parse_args(argv)

    dims = _parse_dim(a.dim)
    score = round(sum(dims[k] * w for k, w in WEIGHTS.items()), 2)
    verdict = _verdict(score)
    name = a.name.strip()
    if not name:
        raise SystemExit("--name 不能为空")

    d = _load(a.city)
    old = d["items"].get(name)
    d["items"][name] = {
        "name": name, "dims": dims, "score": score, "verdict": verdict,
        "why": a.why.strip(), "src": [s for s in a.src if s.strip()],
        "at": date.today().isoformat(),
    }
    _save(a.city, d)

    if old:
        print(f"覆盖旧分 {old.get('score')}（{old.get('at')}）")
    print(f"SCORE={score} VERDICT={verdict} NAME={name} CITY={a.city}")
    if verdict == "no":
        print("  ⇒ 不入库。理由已留痕，下一轮若情况变了重跑 rate 覆盖即可")
    elif verdict == "maybe":
        print("  ⇒ 仅当该城该子类还空着才入，否则攒着")
    return 0


def cmd_show(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="show")
    ap.add_argument("--city", required=True)
    ap.add_argument("--min", type=float, default=0.0)
    ap.add_argument("--limit", type=int, default=40)
    a = ap.parse_args(argv)

    d = _load(a.city)
    rows = [v for v in d["items"].values() if float(v.get("score", 0)) >= a.min]
    rows.sort(key=lambda r: -float(r.get("score", 0)))
    if not rows:
        print(f"{a.city}：没有 ≥{a.min} 的评分（共 {len(d['items'])} 条）")
        return 0
    print(f"{a.city}：{len(rows)} 条（共 {len(d['items'])} 条评分，阈值 ≥{a.min}）")
    for r in rows[:a.limit]:
        print(f"{r['score']:>4.2f} {r['verdict']:<5} {r['name']} | {r.get('why', '')[:50]}")
    return 0


def cmd_check(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="check")
    ap.add_argument("--city", required=True)
    ap.add_argument("--name", required=True)
    a = ap.parse_args(argv)

    d = _load(a.city)
    r = d["items"].get(a.name.strip())
    if not r:
        print(f"UNRATED {a.name}（{a.city}）⇒ 还没评过，入库前先 rate")
        return 0
    print(f"SCORE={r['score']} VERDICT={r['verdict']} AT={r.get('at')} "
          f"NAME={r['name']}")
    if r.get("why"):
        print(f"  why: {r['why']}")
    for s in r.get("src") or []:
        print(f"  src: {s}")
    return 0


def main(argv: list[str]) -> int:
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__.split("## 用法")[1].split("```")[1].strip())
        return 0
    table = {"rate": cmd_rate, "show": cmd_show, "check": cmd_check}
    fn = table.get(argv[0])
    if fn is None:
        print(f"未知子命令 {argv[0]}（rate / show / check）")
        return 2
    return fn(argv[1:])


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
