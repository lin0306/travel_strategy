#!/usr/bin/env python3
"""
tools/intake_candidates.py —— 把**人/AI 审过的候选**落成正式 POI。

## 为什么不是「跑 seed.py」
`seed.py` 会按采编稿**整体重建**某城的 `pois/**`，`point` 与 `images` 会被清空
（坐标要重跑 geocode、图要重跑 images —— 83 城 × 4000+ 条，代价不可接受）。
所以新增点位走**增量**：只写本次这几条，一个字都不动别的。

## 一次入库分三处写，缺一处就会"两边不一致"
1. `pipeline/seeds/{city}.py` —— **真源**。追加到对应大类列表末尾（文本插入，不动注释与顺序）。
2. `data/cities/<省>/<城>/pois/<cat>/<id>.json` —— 产物。由 `seedlib.expand_poi()` 展开。
3. 坐标**不在这里补**：写完必须跑 `run.py geocode <city>`，否则 `point` 为空，
   护栏 AL（坐标入库质量）会直接红 —— 地图上那枚点根本不出现，而"已收录 N"照旧显示。

## 用法（仓库根）
    python tools/intake_candidates.py --city beijing --items _tmp/intake.json
    python tools/intake_candidates.py --city beijing --items _tmp/intake.json --dry-run
    python tools/intake_candidates.py --city beijing --items _tmp/intake.json --no-seed

`--items` 是 JSON 数组，每项：
    {"cat":"scenic", "id":"...", "name":"...", "sub":"museum", "pop":72, "pl":"mid",
     "dur":[90,120], "aud":"couple kids", "acc":false,
     "sum":"一句话", "desc":"长文", "hl":["亮点1","亮点2"],
     "addr":"...", "dist":"...", "trans":"...", "hours":"...", "ticket":"...",
     "tips":["..."], "tags":["..."], "src":["来源标题","https://...","gov"],
     "qEn":"English Name", "qZh":"中文名"}

★ 幂等：id 已存在则跳过；同名（归一化后）与库内重复则拒收。
★ 任何一条校验失败 ⇒ **整批不写**（不做半批入库，避免"一半进了一半没进"）。
"""
from __future__ import annotations

import argparse
import ast
import importlib
import json
import py_compile
import sys
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from pipeline.authoring import seedlib                                  # noqa: E402

CATS = ("SCENIC", "FOOD", "HOTSPOT", "CULTURE")
CAT_OF_ATTR = {a: a.lower() for a in CATS}


def _city_dir(city_id: str) -> Path:
    hits = sorted((REPO / "data" / "cities").glob(f"*/{city_id}/city.json"))
    if not hits:
        raise SystemExit(f"找不到城市「{city_id}」的 city.json（data/cities/*/{city_id}/）")
    if len(hits) > 1:
        raise SystemExit(f"城市「{city_id}」匹配到多份 city.json：{hits}")
    return hits[0].parent


def _seed_path(city_id: str) -> Path:
    p = REPO / "pipeline" / "seeds" / f"{city_id}.py"
    if not p.is_file():
        raise SystemExit(f"采编稿不存在：{p.relative_to(REPO)}")
    return p


def _norm(name: str) -> str:
    """与 step12_discover 同一套保守归一化：只去括号、剥景区后缀、去空格。"""
    import re
    s = re.sub(r"[（(][^）)]*[）)]", "", name.strip())
    strip = ("风景区", "风景名胜区", "景区", "旅游景区", "风景名胜",
             "保护区", "公园", "旅游区", "景区门票")
    changed = True
    while changed:
        changed = False
        for suf in strip:
            if s.endswith(suf) and len(s) > len(suf):
                s = s[: -len(suf)]
                changed = True
    return s.replace(" ", "").replace("　", "")


def _load_seed_names(city_id: str) -> set[str]:
    """现存 POI 名（归一化），用来拦"同址两名"。"""
    mod = importlib.import_module(f"pipeline.seeds.{city_id}")
    out: set[str] = set()
    for attr in CATS:
        for d in getattr(mod, attr, []) or []:
            out.add(_norm(d["name"]))
    return out


def _j(v: str) -> str:
    """中文安全的 Python 字符串字面量（双引号）。"""
    return json.dumps(v, ensure_ascii=False)


def _fmt_entry(d: dict, cat: str) -> str:
    """把一条采编 dict 格式化成源码文本（风格对齐现有 seeds/*.py：1 空格缩进）。"""
    head = ", ".join([
        f"id={_j(d['id'])}", f"name={_j(d['name'])}", f"sub={_j(d.get('sub', ''))}",
        *[f"{k}={d[k]}" for k in ("pop",) if d.get(k) is not None],
        *([f"pl={_j(d['pl'])}"] if d.get("pl") else []),
        *([f"dur=({d['dur'][0]}, {d['dur'][1]})"] if d.get("dur") else []),
    ])
    lines = [" dict(" + head + ","]
    lines.append(f"   aud={_j(d.get('aud') or '')}, acc={bool(d.get('acc'))},")
    lines.append(f"   sum={_j(d['sum'])},")
    lines.append(f"   desc={_j(d['desc'])},")
    lines.append(f"   hl=[{', '.join(_j(x) for x in d.get('hl') or [])}],")
    lines.append(f"   addr={_j(d.get('addr', ''))}, dist={_j(d.get('dist', ''))}, "
                 f"trans={_j(d.get('trans', ''))},")
    if d.get("hours") or d.get("ticket"):
        lines.append(f"   hours={_j(d.get('hours', ''))}, ticket={_j(d.get('ticket', ''))},")
    lines.append(f"   tips=[{', '.join(_j(x) for x in d.get('tips') or [])}],")
    src = d["src"]
    lines.append(f"   tags=[{', '.join(_j(x) for x in d.get('tags') or [])}], "
                 f"src=({_j(src[0])}, {_j(src[1])}, {_j(src[2])}),")
    lines.append(f"   qEn={_j(d.get('qEn', ''))}, qZh={_j(d.get('qZh') or d['name'])}),")
    return "\n".join(lines)


def _insert_into_seed(src: str, attr: str, blocks: list[str]) -> str:
    """把若干条目插到 `attr = [...]` 列表末尾（`]` 行之**前**），不动其它任何字符。"""
    tree = ast.parse(src)
    node = None
    for n in tree.body:
        if isinstance(n, ast.Assign):
            names = [t.id for t in n.targets if isinstance(t, ast.Name)]
            if names and names[0] == attr and isinstance(n.value, ast.List):
                node = n
                break
    if node is None:
        raise SystemExit(f"采编稿里找不到 `{attr} = [...]` 列表")
    line_no = node.end_lineno                      # 1-based，`]` 所在行
    lines = src.splitlines(keepends=True)
    # 插到 `]` 行之前；`]` 行本身保持不动
    insert_at = line_no - 1
    if "]" not in lines[insert_at]:
        raise SystemExit(f"`{attr}` 的 end_lineno={line_no} 那行不是 `]` —— 采编稿格式变了")
    return "".join(lines[:insert_at]) + "".join(b + "\n" for b in blocks) + "".join(lines[insert_at:])


def _validate(items: list[dict], city_id: str, existing_norm: set[str]) -> tuple[list[dict], list[str]]:
    ok: list[dict] = []
    errs: list[str] = []
    seen_id: set[str] = set()
    seen_norm: dict[str, str] = {}
    for i, d in enumerate(items):
        tag = f"[{i}] {d.get('name') or d.get('id') or '?'}"
        cat = (d.get("cat") or "").lower()
        if cat not in seedlib.SUBTYPE_OF_CATEGORY:
            errs.append(f"{tag}: cat「{cat}」非法，应为 {sorted(seedlib.SUBTYPE_OF_CATEGORY)}")
            continue
        for k in ("id", "name", "sum", "desc", "hl", "src"):
            if not d.get(k):
                errs.append(f"{tag}: 缺必填字段 `{k}`")
        if errs and errs[-1].startswith(tag):
            continue
        if d["id"] in seen_id:
            errs.append(f"{tag}: id 在本批内重复")
            continue
        n = _norm(d["name"])
        if n in seen_norm:
            errs.append(f"{tag}: 与同批「{seen_norm[n]}」同名（归一化后）")
            continue
        if n in existing_norm:
            errs.append(f"{tag}: 与库内已有点位同名（归一化后）—— 同址两名请按一条主条目收")
            continue
        src = d["src"]
        if not (isinstance(src, (list, tuple)) and len(src) == 3):
            errs.append(f"{tag}: src 必须是 [标题, URL, kind] 三元组")
            continue
        # 交给 seedlib 做最后一道口径校验（sub / pl / aud / src_kind）
        try:
            seedlib.expand_poi({**d, "src": tuple(src)}, cat, date.today().isoformat())
        except Exception as e:                                  # noqa: BLE001
            errs.append(f"{tag}: {type(e).__name__}: {e}")
            continue
        seen_id.add(d["id"])
        seen_norm[n] = d["name"]
        ok.append(d)
    return ok, errs


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="把审过的候选落成正式 POI（增量，不重建）")
    ap.add_argument("--city", required=True, help="城市 id，如 beijing")
    ap.add_argument("--items", required=True, help="条目 JSON 文件")
    ap.add_argument("--dry-run", action="store_true", help="只校验与预览，不落盘")
    ap.add_argument("--no-seed", action="store_true", help="不写采编稿（仅落 pois，慎用）")
    a = ap.parse_args(argv)

    city_id = a.city
    city_dir = _city_dir(city_id)
    seed_path = _seed_path(city_id)
    raw = json.loads(Path(a.items).read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise SystemExit("--items 必须是 JSON 数组")

    existing_norm = _load_seed_names(city_id)
    ok, errs = _validate(raw, city_id, existing_norm)

    # id 已存在（幂等重跑）⇒ 跳过而不是报错
    skipped: list[str] = []
    fresh: list[dict] = []
    for d in ok:
        p = city_dir / "pois" / d["cat"].lower() / f"{d['id']}.json"
        if p.exists():
            skipped.append(d["id"])
        else:
            fresh.append(d)

    print(f"▶ 城市 {city_id} · 提交 {len(raw)} 条 · 通过 {len(ok)} · 新增 {len(fresh)} · 已存在跳过 {len(skipped)}")
    for s in skipped:
        print(f"   · 已存在，跳过：{s}")
    if errs:
        print(f"✗ 校验失败 {len(errs)} 条（**整批不写**）：")
        for e in errs[:20]:
            print("   -", e)
        return 1
    if not fresh:
        print("（没有需要写入的条目）")
        return 0

    fetched = date.today().isoformat()
    # ── 预生成全部内容，再一次性落盘（任何一步失败都不留半批）──
    planned: list[tuple[Path, dict, str, str]] = []
    for d in fresh:
        cat = d["cat"].lower()
        poi = seedlib.expand_poi({**d, "src": tuple(d["src"])}, cat, fetched)
        attr = cat.upper()
        planned.append((city_dir / "pois" / cat / f"{d['id']}.json", poi, attr, _fmt_entry(d, cat)))

    if a.dry_run:
        print("\n── dry-run 预览（第一条）──")
        print(planned[0][3])
        print(f"\n预览 {len(planned)} 条，未落盘。")
        return 0

    # 1) 采编稿：追加到各列表末尾（真源先写，写坏了下面能发现）
    if not a.no_seed:
        src = seed_path.read_text(encoding="utf-8")
        by_attr: dict[str, list[str]] = {}
        for _p, _poi, attr, block in planned:
            by_attr.setdefault(attr, []).append(block)
        backup = src
        for attr, blocks in by_attr.items():
            try:
                src = _insert_into_seed(src, attr, blocks)
            except SystemExit as e:
                print(f"✗ 写采编稿失败：{e}；已回滚，未改动任何文件")
                return 1
        seed_path.write_text(src, encoding="utf-8")
        try:
            py_compile.compile(str(seed_path), doraise=True)
        except py_compile.PyCompileError as e:
            seed_path.write_text(backup, encoding="utf-8")          # ★ 回滚
            print(f"✗ 采编稿语法错误，已回滚：{e}")
            return 1
        print(f"✓ 采编稿已追加 {len(planned)} 条：{seed_path.relative_to(REPO)}")

    # 2) pois：逐条写（expand_poi 已校验过，这里只做 IO）
    for path, poi, _attr, _block in planned:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(poi, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"✓ 已写入 {len(planned)} 个 POI 分片（{city_dir.relative_to(REPO)}/pois/）")

    ids = ", ".join(p.stem for p, _a, _b, _c in planned)
    print(f"\n★ 下一步（必做，否则 point 为空 ⇒ 护栏 AL 红、地图上不显示）：")
    print(f"   E:/BASIC/python/python.exe pipeline/run.py geocode {city_id}")
    print(f"   python tools/check_seed.py {city_id}")
    print(f"   E:/BASIC/python/python.exe pipeline/run.py build")
    print(f"\n本批 id：{ids}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
