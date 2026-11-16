#!/usr/bin/env python3
"""tools/ai_review.py —— **AI 点评**的批量生成入口与落盘闸门。

## 这是什么
景点详情页那张「AI 点评」卡片的内容（`PoiReview`，见 `schema/schema.py`）。
一段话讲清"值不值得去、好在哪、坑在哪"，并给一个可排序的综合分。

## 与入库打分的关系（★★ 最容易搞混的一处）
| | 入库打分 `rate_poi.py` | AI 点评 `ai_review.py` |
|---|---|---|
| 回答 | 这个点位**该不该收录** | 这个点位**值不值得去** |
| 维度 | 固定四维（口碑/独特/密度/可信） | 按点位性质自取（展陈/人流/排队…） |
| 阈值 | 3.5 入库线 | 无闸门，全量都要有 |
| 可否互相校验 | **不行** —— 两者刻意不构成算术关系 |

★ `score` 沿用四维加权口径（与 `rate_poi` 同源），所以列表排序与入库判断不会打架；
  但 `facets` 是**解释**，别拿它求平均去对 `score`。

## 免责是硬要求（用户 2026-11-10 明确要求）
分数与点评来自网络公开信息的 AI 归纳，**不保证准确**：
  · `basis` 必须诚实：`web` = 联网查过风评与官方口径；`corpus` = 只用站内已核实资料合成
  · 前端卡片 + 「关于」弹窗都必须有免责说明（`check_app` AZ 组有判据）
  · 绝不包装成"用户评分 / 官方评定"—— 那是伪造权威

## facets 该写什么（按点位性质取，别硬凑四条）
| 类型 | 常见分项 |
|---|---|
| 博物馆/展馆 | 展陈 · 人流 · 讲解 · 免费程度 · 亲子友好 |
| 山/公园 | 体力 · 视野 · 遮阴 · 配套 · 时长 |
| 古城/街区 | 商业化 · 拍照 · 逛街时长 · 小吃 · 人流 |
| 餐饮 | 口味 · 价格 · 排队 · 环境 · 分量 |
| 演出/夜游 | 观演位置 · 时长 · 性价比 · 交通 |

## 用法
```
# ① 取下一批待写点评的点位（未生成的优先，按热度降序）
python tools/ai_review.py next --city shenzhen --n 20

# ② AI 写好后整批落盘（schema 校验不过整批拒收）
python tools/ai_review.py write --file _tmp/reviews-shenzhen-1.json

# ③ 进度
python tools/ai_review.py status                # 全库
python tools/ai_review.py status --city shenzhen

# ④ 重做某条（覆盖已有）
python tools/ai_review.py next --city shenzhen --n 5 --force
```
`write` 的输入：
```json
{"city":"shenzhen","items":[
  {"id":"shenzhen-museum","score":4.2,"verdict":"值得一去",
   "facets":[{"label":"展陈","score":4.5,"note":"常设展从新石器铺到改革开放"},
             {"label":"人流","score":2.5,"note":"周末上午十点后亲子团多"}],
   "body":"……至少一句负面……","fits":["带娃","避暑"],"avoid":["专程追镇馆之宝"],
   "basis":"corpus","sources":[]}
]}
```
退出码：`0` 正常；`2` = 校验不过（**整批不写**，按报错改完重跑）。
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CITIES = REPO / "data" / "cities"

#: verdict 的四档与分数下界。**改这里就要同步改前端文案与 A 段/巡检 prompt**。
#: 3.5 是入库线（`rate_poi.GO_MIN`），所以详情页正常只会出现这四档里的后三档。
#: ★ 3.6 而不是 3.7：离入库线只有 0.1 的那一小段（3.5~3.6）几乎不会出现，
#:   把「顺路看看」的下界放到 3.6，才不至于让刚过线的点位全部掉进最差档。
VERDICT_BANDS: list[tuple[float, str]] = [
    (4.5, "专程去"),
    (4.0, "值得一去"),
    (3.6, "顺路看看"),
    (0.0, "时间富余再说"),
]

#: 正文必须含**至少一句负面**。只夸不贬的点评没有信息量，也没人信。
#: 词表刻意放宽（宁可漏判也别逼着硬塞"不"字），命中任一即通过。
NEGATIVE_MARKERS = (
    "缺点", "不足", "可惜", "遗憾", "短板", "差", "吵", "挤", "贵", "坑",
    "排队", "一般", "偏", "弱", "破旧", "失望", "避雷", "注意", "别指望",
    "不建议", "没什么", "只能", "略显", "商业化", "限", "停", "远",
)

FACET_LABEL_MIN, FACET_LABEL_MAX = 2, 6
BODY_MIN, BODY_MAX = 40, 400

#: 报错里要给 AI 看的四档提示。**从 `VERDICT_BANDS` 现算，不手写** ——
#: 曾经手写成「≥3.7 顺路看看」，而真阈值是 3.6，写点评的那一侧会照着错的口径自查，
#: 于是 3.6~3.7 的点位被反复退回重写（改了阈值只改一处就够）。
_BAND_HINT = " / ".join(
    f"≥{lo:g} {name}" for lo, name in VERDICT_BANDS[:-1]
) + f" / <{VERDICT_BANDS[-2][0]:g} {VERDICT_BANDS[-1][1]}"


def _verdict_for(score: float) -> str:
    """分数 → 结论档。★ 严格按阈值，**不留四舍五入容差**：
    留了容差，3.98 会被抬成「值得一去」、4.49 会被抬成「专程去」，
    结论与分数看起来对不上，用户第一眼就会觉得这分数是编的。"""
    for lo, name in VERDICT_BANDS:
        if score >= lo:
            return name
    return "时间富余再说"


def _poi_files(slug: str | None = None) -> list[Path]:
    pat = f"*/{slug}/pois/*/*.json" if slug else "*/*/pois/*/*.json"
    return sorted(p for p in CITIES.glob(pat) if not p.parent.parent.parent.name.startswith("_"))


def _slug_of(path: Path) -> str:
    return path.parents[2].name


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _save(path: Path, poi: dict) -> None:
    path.write_text(json.dumps(poi, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


# ── ① 取待写清单 ────────────────────────────────────────────────────

def _brief(poi: dict) -> dict:
    """喂给 AI 的精简资料 —— 只带写点评用得上的，省 token。"""
    pr = poi.get("practical") or {}
    return {
        "id": poi["id"],
        "name": poi["name"],
        "cat": poi.get("category"),
        "sub": poi.get("subtype"),
        "pop": poi.get("popularity"),
        "summary": poi.get("summary"),
        "description": poi.get("description"),
        "highlights": poi.get("highlights"),
        "tips": poi.get("tips") or [],
        "hours": pr.get("openHours"),
        "ticket": pr.get("ticket"),
        "duration": pr.get("duration"),
        "tags": poi.get("tags") or [],
        "audience": poi.get("audience") or [],
        "sources": [s.get("title") for s in (poi.get("sources") or [])],
    }


def cmd_next(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="next")
    ap.add_argument("--city")
    ap.add_argument("--n", type=int, default=20)
    ap.add_argument("--force", action="store_true", help="连已有点评的也算进来（重做）")
    a = ap.parse_args(argv)

    rows: list[tuple[int, Path, dict]] = []
    for path in _poi_files(a.city):
        poi = _load(path)
        if not a.force and poi.get("review"):
            continue
        rows.append((int(poi.get("popularity") or 50), path, poi))
    # 热度降序：热门点位先有点评，用户先看到的就有内容
    rows.sort(key=lambda r: -r[0])

    if not rows:
        print("ALL_DONE 该范围内所有点位都已有 AI 点评"
              + ("" if a.force else "（要重做加 --force）"))
        return 0

    picks = rows[:a.n]
    print(f"TODO total={len(rows)} batch={len(picks)} city={a.city or 'ALL'}")
    for rank, (_pop, path, poi) in enumerate(picks, 1):
        print(f"--- [{rank}] {poi['id']}（{_slug_of(path)}）")
        print(json.dumps(_brief(poi), ensure_ascii=False))
    return 0


# ── ② 校验 + 落盘 ───────────────────────────────────────────────────

def _check_item(it: dict, tag: str) -> list[str]:
    errs: list[str] = []
    score = it.get("score")
    if not isinstance(score, (int, float)) or not 0 <= score <= 5:
        errs.append(f"{tag}: score 必须是 0~5 的数字，收到 {score!r}")
        score = None

    verdict = it.get("verdict")
    if verdict not in {n for _, n in VERDICT_BANDS}:
        errs.append(f"{tag}: verdict「{verdict}」非法，只能是 {'/'.join(n for _, n in VERDICT_BANDS)}")
    elif score is not None and verdict != _verdict_for(float(score)):
        # 硬判：分数与结论打架时排序与文案会自相矛盾，宁可退回重写
        errs.append(f"{tag}: score={score} 应配「{_verdict_for(float(score))}」，"
                    f"实际写「{verdict}」（四档：{_BAND_HINT}）")

    facets = it.get("facets") or []
    if not 2 <= len(facets) <= 5:
        errs.append(f"{tag}: facets 要 2~5 条，收到 {len(facets)} 条")
    for j, f in enumerate(facets):
        label = (f.get("label") or "").strip()
        if not FACET_LABEL_MIN <= len(label) <= FACET_LABEL_MAX:
            errs.append(f"{tag}: facets[{j}] label「{label}」长度须 {FACET_LABEL_MIN}~{FACET_LABEL_MAX} 字")
        fs = f.get("score")
        if not isinstance(fs, (int, float)) or not 0 <= fs <= 5:
            errs.append(f"{tag}: facets[{j}] score 必须是 0~5 的数字")
        note = f.get("note") or ""
        if len(note) > 40:
            errs.append(f"{tag}: facets[{j}] note 超过 40 字（一行放不下）")

    body = (it.get("body") or "").strip()
    if not BODY_MIN <= len(body) <= BODY_MAX:
        errs.append(f"{tag}: body 长度 {len(body)}，须 {BODY_MIN}~{BODY_MAX} 字")
    elif not any(m in body for m in NEGATIVE_MARKERS):
        # ★ 只夸不贬 = 广告。这是 B 段最容易糊弄过去的一条，所以硬拦。
        errs.append(f"{tag}: body 没有一句负面（缺点/可惜/挤/排队/偏… 一个都没出现）—— "
                    f"只夸不贬的点评没有信息量，请补一句具体短板")

    basis = it.get("basis")
    if basis not in ("web", "corpus"):
        errs.append(f"{tag}: basis 只能是 web（联网复核）或 corpus（站内资料）")
    if basis == "web" and not (it.get("sources") or []):
        errs.append(f"{tag}: basis=web 必须给 sources（联网复核的证据链接）")

    for k in ("fits", "avoid"):
        v = it.get(k) or []
        if not isinstance(v, list) or any(not isinstance(x, str) for x in v):
            errs.append(f"{tag}: {k} 须为字符串数组")
    return errs


def cmd_write(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="write")
    ap.add_argument("--file", required=True)
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args(argv)

    src = Path(a.file)
    if not src.is_file():
        print(f"ERROR 文件不存在：{src}")
        return 2
    try:
        payload = json.loads(src.read_text(encoding="utf-8"))
    except Exception as e:                                     # noqa: BLE001
        print(f"ERROR JSON 解析失败：{e}")
        return 2

    city = payload.get("city")
    items = payload.get("items") or []
    if not city or not items:
        print("ERROR 需要 {\"city\": \"<slug>\", \"items\": [...]}")
        return 2

    errs: list[str] = []
    prepared: list[tuple[Path, dict, dict]] = []
    today = date.today().isoformat()

    for i, it in enumerate(items):
        tag = f"[{i}] {it.get('id') or '?'}"
        errs += _check_item(it, tag)
        pid = it.get("id")
        if not pid:
            errs.append(f"{tag}: 缺 id")
            continue
        hits = [p for p in CITIES.glob(f"*/{city}/pois/*/{pid}.json")]
        if len(hits) != 1:
            errs.append(f"{tag}: 在 {city} 下找到 {len(hits)} 个同名 POI 文件（应恰好 1 个）")
            continue
        review = {k: it[k] for k in
                  ("score", "verdict", "facets", "body", "basis", "at")
                  if k in it}
        review.setdefault("at", today)
        review["fits"] = it.get("fits") or []
        review["avoid"] = it.get("avoid") or []
        review["sources"] = it.get("sources") or []
        prepared.append((hits[0], {"review": review}, it))

    if errs:
        print(f"REJECT {len(errs)} 处问题 —— **整批不写**（按报错改完重跑）")
        for e in errs[:40]:
            print("  " + e)
        if len(errs) > 40:
            print(f"  …还有 {len(errs) - 40} 条")
        return 2

    if a.dry:
        print(f"DRY OK {len(prepared)} 条校验通过，未写盘")
        return 0

    for path, patch, _it in prepared:
        poi = _load(path)
        poi.update(patch)
        # ★ 业务字段改了就要写 updatedAt —— 全站「更新于」与巡检过期判定都读它
        poi["updatedAt"] = today
        _save(path, poi)

    print(f"OK 写入 {len(prepared)} 条（{city}）")
    print("  ⇒ 有数据改动，收尾要全量 build + check_app")
    return 0


# ── ③ 进度 ──────────────────────────────────────────────────────────

def cmd_status(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="status")
    ap.add_argument("--city")
    a = ap.parse_args(argv)

    rows: dict[str, list[int]] = {}
    basis_cnt = {"web": 0, "corpus": 0}
    for path in _poi_files(a.city):
        poi = _load(path)
        slug = _slug_of(path)
        r = rows.setdefault(slug, [0, 0])
        r[0] += 1
        rv = poi.get("review")
        if rv:
            r[1] += 1
            basis_cnt[rv.get("basis", "corpus")] = basis_cnt.get(rv.get("basis", "corpus"), 0) + 1

    done = sum(r[1] for r in rows.values())
    total = sum(r[0] for r in rows.values())
    pct = (done * 100 // total) if total else 0
    print(f"覆盖 {done}/{total}（{pct}%） · web={basis_cnt['web']} corpus={basis_cnt['corpus']}")
    if a.city:
        return 0
    empty = [(s, r[0]) for s, r in rows.items() if r[1] == 0]
    print(f"未开始的城 {len(empty)} / {len(rows)}")
    for s, n in sorted(empty, key=lambda x: -x[1])[:15]:
        print(f"  {s}: {n} 点")
    return 0


def main(argv: list[str]) -> int:
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__.split("## 用法")[1].split("```")[1].strip())
        return 0
    table = {"next": cmd_next, "write": cmd_write, "status": cmd_status}
    fn = table.get(argv[0])
    if fn is None:
        print(f"未知子命令 {argv[0]}（next / write / status）")
        return 2
    return fn(argv[1:])


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
