#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""城市封面**对照表** —— 「已上线的」与「候选的」两类渲染（`tools/city_cover.py` 共用）。

★ 为什么单独一个文件：审查（看已上线的）与重抓（看候选的）**长得一样**，
  差别只在格数与标签 —— 两处各写一遍，下次改字号就要改两次，而漏改不会报错。

★ 中文必须显式传字体（`_cjk`）：`ImageDraw.text()` 默认字体只有 ASCII 字形，
  不传 font 时所有中文渲染成「□□□□」（2026-11-01 实测）。
"""
from __future__ import annotations

import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image, ImageDraw

from pipeline.core.layout import iter_city_dirs
from tools.fetch_candidates import _cjk, _fit
from tools.review_images import fetch


def h8(url: str) -> str:
    """缩略图缓存键里的 URL 指纹。

    ★ 只用 `cand-<idx>.jpg` 当键会串图：换一批候选后同序号命中旧缩略图，
      对照表张冠李戴而且零报错（黄山 2026-11-09 实测 #48 贴出黄山松）。
    """
    return hashlib.sha1(url.encode("utf-8")).hexdigest()[:8]


def render(
    cells: list[dict],
    path: Path,
    *,
    cols: int,
    tile: int,
    foot: int,
    font_size: int = 13,
    bg: tuple[int, int, int] = (28, 28, 30),
) -> Path:
    """把一个格子的列表画成一张表。

    每个 cell：
        file   本地缩略图（取不到就画「取图失败」红框）
        lines  底部文字行（0~2 行；多了不看）
        color  格子外框颜色（提示用，**不是结论**）
        badge  左上角白底黑字（一般写 `#idx`）
    """
    nrow = (len(cells) + cols - 1) // cols
    canvas = Image.new("RGB", (cols * tile, nrow * (tile + foot)), bg)
    draw = ImageDraw.Draw(canvas)
    font = _cjk(font_size)

    for i, c in enumerate(cells):
        x, y = (i % cols) * tile, (i // cols) * (tile + foot)
        f = Path(c["file"])
        if f.exists():
            try:
                with Image.open(f) as src:
                    im = src.convert("RGB")
                    im.thumbnail((tile, tile))
                    canvas.paste(im, (x + (tile - im.width) // 2, y + (tile - im.height) // 2))
            except Exception:                                          # noqa: BLE001
                pass
        else:
            draw.rectangle([x + 2, y + 2, x + tile - 2, y + tile - 2], outline=(200, 60, 60))
            draw.text((x + 10, y + 10), "取图失败", font=font, fill=(240, 120, 120))

        if c.get("color"):
            draw.rectangle([x + 1, y + 1, x + tile - 1, y + tile - 1], outline=c["color"], width=3)
        if c.get("badge"):
            draw.rectangle([x + 4, y + 4, x + 52, y + 25], fill=(255, 255, 255))
            draw.text((x + 9, y + 9), c["badge"], fill=(0, 0, 0), font=font)

        for k, line in enumerate((c.get("lines") or [])[:2]):
            draw.text((x + 4, y + tile + 5 + k * (font_size + 4)),
                      _fit(font, line, tile - 10), font=font,
                      fill=c.get("fill") or (245, 245, 245))

    path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(path)
    return path


def audit_covers(ledger_path: Path, out: Path, *, all_: bool, root: Path) -> int:
    """把**已上线**的 `heroImages` 拼成对照表（每城 3 张连着排，一行两城）。

    ★ 账本里已判 ok 的城市默认跳过 —— 审过的不要再审，否则每次都要重看 83 城。
    """
    rows = json.loads(ledger_path.read_text(encoding="utf-8")) if ledger_path.exists() else {}
    items = []
    for _prov, slug, d in iter_city_dirs():
        if not all_ and (rows.get(slug) or {}).get("state") == "ok":
            continue
        doc = json.loads((d / "city.json").read_text(encoding="utf-8"))
        for k, im in enumerate(doc.get("heroImages") or []):
            items.append((slug, doc.get("name", slug), k, im))
    if not items:
        print("AUDIT none（账本里所有城市都已是 ok，`--all` 可强制重看）")
        return 0

    jobs, cells = [], []
    (out / "thumbs").mkdir(parents=True, exist_ok=True)
    for i, (slug, name, k, im) in enumerate(items):
        dest = out / "thumbs" / f"{i:03d}-{h8(im.get('url', ''))}.jpg"
        jobs.append((im.get("thumbUrl") or im.get("url") or "", dest))
        src = (im.get("credit") or {}).get("source", "?")[:2]
        cells.append({"file": dest, "badge": f"#{i}", "lines": [f"#{i} {name} {k + 1}/3 · {src}"]})
    with ThreadPoolExecutor(max_workers=10) as pool:
        list(pool.map(lambda j: fetch(j[0], j[1]), jobs))

    per, sheets = 48, 0
    for s in range(0, len(cells), per):
        p = render(cells[s:s + per], out / f"sheet-{s // per + 1}.png",
                   cols=6, tile=240, foot=32, font_size=14)
        sheets += 1
        print("SHEET", p.relative_to(root).as_posix())
    print(f"CITY_COUNT={len({it[0] for it in items})} CELL_COUNT={len(items)} SHEETS={sheets}")
    for i, (slug, _name, k, im) in enumerate(items):
        print(f"CELL {i}|{slug}|{k + 1}|{(im.get('credit') or {}).get('source', '?')}|"
              f"{(im.get('alt') or '')[:44]}")
    return 0
