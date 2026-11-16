#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""已入库图片的**核对表** —— 回答「站上现在挂的这几张图，真的是这个点位吗」。

与 `fetch_candidates.py sheet` 的区别：那张表列的是**候选**（还没入库、正在挑），
这张表列的是**已上线**的封面（已经挂在详情页上）。两件事：
- 候选表用于「补图」：从几十张里挑出对的
- 核对表用于「查错」：已有的图是不是本来就挑错了 —— 没人回看过，只能这样抽

产物：`_tmp/patrol/sheet-<city>-<HHMM>.png` + stdout 的 manifest（格子号 → 点位 / 哪一张）。

用法：
    python tools/patrol_sheet.py --city chengdu            # 与 `patrol_queue next` 同一批点位
    python tools/patrol_sheet.py --city chengdu --n 4      # 只看前 4 个
    python tools/patrol_sheet.py --city chengdu --poi a,b  # 指定点位
"""
from __future__ import annotations

import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from PIL import Image, ImageDraw                                   # noqa: E402

from tools import patrol_queue as pq                              # noqa: E402
from tools.fetch_candidates import _cjk, _fit                     # noqa: E402
from tools.review_images import fetch                             # noqa: E402

OUT = REPO / "_tmp" / "patrol"
TILE, COLS, FOOT = 320, 3, 44      # 6 个点位排 3×2，格大一点才看得清匾额与店招


def _targets(city: str, n: int, ids: set[str]) -> list[tuple[Path, dict]]:
    """核对表的取样口径与 `patrol_queue next` **不同**：

    `next` 优先给无图点位（要补），核对表只能给**有图**点位（要查错）。
    把两者混成一套排序，就会出现"整张表全是无图点位、一格格取图失败"。
    """
    d = next((c for s, _n, c in pq._cities() if s == city), None)
    if d is None:
        return []
    rows = pq._pois(d)
    if ids:
        return [(f, p) for f, p in rows if p.get("id") in ids]
    rows = [(f, p) for f, p in rows if p.get("images")]
    rows.sort(key=lambda fp: (-pq._risk(fp[1]), str(fp[1].get("updatedAt") or "")))
    return rows[:n]


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)

    def opt(key: str, default: str = "") -> str:
        return args[args.index(key) + 1] if key in args and args.index(key) + 1 < len(args) else default

    city = opt("--city")
    if not city:
        print("用法：patrol_sheet.py --city <slug> [--n 6] [--poi id1,id2]")
        return 2
    ids = {x.strip() for x in opt("--poi").replace("，", ",").split(",") if x.strip()}
    try:
        n = max(1, min(12, int(opt("--n", "6"))))
    except ValueError:
        n = 6

    targets = _targets(city, n, ids)
    if not targets:
        print(f"{city}：没有可核对的点位")
        return 1

    out = OUT / "covers"
    out.mkdir(parents=True, exist_ok=True)
    cells: list[tuple[dict, dict, str, Path]] = []       # (poi, image, key, 本地文件)
    jobs = []
    for f, poi in targets:
        imgs = poi.get("images") or []
        if not imgs:
            continue
        ci = poi.get("coverIndex") or 0
        ci = ci if isinstance(ci, int) and 0 <= ci < len(imgs) else 0
        im = imgs[ci]
        key = f"{poi.get('id')}-{ci}"
        dest = out / f"{key}.jpg"
        cells.append((poi, im, key, dest))
        jobs.append((im.get("url") or im.get("thumbUrl") or "", dest))

    print(f"{city}：{len(cells)} 个点位有封面，下载中…")
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda j: fetch(j[0], j[1]), jobs))

    rows = (len(cells) + COLS - 1) // COLS
    if not rows:
        print(f"{city}：命中点位都没有图，无可核对（这类点位走 `grab --poi` 补图）")
        return 1
    canvas = Image.new("RGB", (COLS * TILE, rows * (TILE + FOOT)), (28, 28, 30))
    draw = ImageDraw.Draw(canvas)
    font = _cjk(15)
    for i, (poi, im, key, dest) in enumerate(cells):
        x, y = (i % COLS) * TILE, (i // COLS) * (TILE + FOOT)
        label = f"#{i} {poi.get('name', '')[:12]}"
        try:
            with Image.open(dest) as src:
                thumb = src.convert("RGB")
                thumb.thumbnail((TILE, TILE))
                canvas.paste(thumb, (x + (TILE - thumb.width) // 2,
                                     y + (TILE - thumb.height) // 2))
        except Exception:                                          # noqa: BLE001
            draw.rectangle([x + 2, y + 2, x + TILE - 2, y + TILE - 2], outline=(200, 60, 60))
            draw.text((x + 12, y + 12), "取图失败", font=font, fill=(240, 120, 120))
        draw.text((x + 8, y + TILE + 10), _fit(font, label, TILE - 16), font=font, fill=(245, 245, 245))

    path = OUT / f"sheet-{city}-{time.strftime('%H%M')}.png"
    canvas.save(path)
    print(f"SHEET {path.relative_to(REPO).as_posix()}")
    print(f"CITY={city} CELLS={len(cells)}")
    for i, (poi, im, key, _dest) in enumerate(cells):
        credit = (im.get("credit") or {}).get("source", "?")
        print(f"CELL {i}|{poi.get('id')}|{poi.get('name')}|第{key.rsplit('-', 1)[-1]}张|"
              f"{len(poi.get('images') or [])}图|{credit}|{(im.get('alt') or '')[:30]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
