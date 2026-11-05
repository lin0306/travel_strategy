#!/usr/bin/env python3
"""把已确认的单点位图片连同 credit 写回 poi.images。

用法：
    python _tmp/fetch/refill_manual.py <slug> <poiName> <file1> <file2> ...

`<fileN>` 是 Commons 文件名（不带 `File:` 前缀）。本脚本负责：
  1. 一次批量取 imageinfo（url / 尺寸 / 许可 / 作者 / 文件页）
  2. 按 poi 的 images 结构追加，已存在的 URL 跳过
  3. 落 `_noImage=False`、`updatedAt`

★ 为什么要单独一个脚本：`fetch_candidates` 的流程是"整城 grab → 出表 → apply"，
  对**已补完的城市里单个高价值点位**（月沼这种情况）不适用 —— 重跑 grab 会覆盖
  该城的 `candidates.jsonl` / `manifest-candidates.json`，而 `apply` 是按 idx 认位，
  序号一错就会把图写到别的点位上（零报错）。所以单点位走这条独立通道。
"""

from __future__ import annotations

import json
import sys
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

API = "https://commons.wikimedia.org/w/api.php"
UA = {"User-Agent": "travel-strategy/1.0 (poi image refill)"}


def imageinfo(names: list[str]) -> dict[str, dict]:
    """批量取 imageinfo。一次请求查完，别逐个查（会被 429）。"""
    out: dict[str, dict] = {}
    BATCH = 20
    for i in range(0, len(names), BATCH):
        chunk = names[i : i + BATCH]
        q = {
            "action": "query",
            "format": "json",
            "prop": "imageinfo",
            "iiprop": "url|size|extmetadata",
            "iiurlwidth": "1280",
            "titles": "|".join("File:" + n for n in chunk),
        }
        url = API + "?" + urllib.parse.urlencode(q)
        req = urllib.request.Request(url, headers=UA)
        data = json.load(urllib.request.urlopen(req, timeout=40))
        for page in (data.get("query") or {}).get("pages", {}).values():
            info = (page.get("imageinfo") or [{}])[0]
            if not info:
                continue
            meta = info.get("extmetadata") or {}

            def g(key: str) -> str:
                v = meta.get(key) or {}
                return str(v.get("value", "")).strip()

            title = page.get("title", "")[5:]
            out[title] = {
                "url": info.get("url", ""),
                "thumbUrl": info.get("thumburl") or info.get("url", ""),
                "width": info.get("width"),
                "height": info.get("height"),
                "license": g("LicenseShortName"),
                "author": g("Artist"),
                "sourceUrl": info.get("descriptionurl", ""),
            }
    return out


def strip_html(s: str) -> str:
    """extmetadata 的 Artist 常带 <a> / <span>，前端不解析 HTML。"""
    out, depth = [], 0
    for ch in s:
        if ch == "<":
            depth += 1
        elif ch == ">":
            depth = max(0, depth - 1)
        elif depth == 0:
            out.append(ch)
    return " ".join("".join(out).split())


def main() -> int:
    if len(sys.argv) < 4:
        print(__doc__)
        return 2
    slug, poi_name, *files = sys.argv[1:]
    files = [f for f in files if f.strip()]

    hits = []
    for p in ROOT.glob(f"data/cities/*/{slug}/pois/*/*.json"):
        d = json.loads(p.read_text(encoding="utf-8"))
        if d.get("name") == poi_name:
            hits.append((p, d))
    if not hits:
        print(f"找不到点位 {slug} / {poi_name}")
        return 1
    if len(hits) > 1:
        print(f"点位名撞车 {len(hits)} 个，拒绝写：{[str(h[0]) for h in hits]}")
        return 1
    path, poi = hits[0]

    info = imageinfo(files)
    missing = [f for f in files if f not in info]
    if missing:
        print("取不到元数据：", missing)
    imgs = poi.get("images") or []
    have = {im.get("url") for im in imgs}

    added = 0
    for f in files:
        m = info.get(f)
        if not m or not m["url"] or m["url"] in have:
            continue
        imgs.append({
            "url": m["url"],
            "thumbUrl": m["thumbUrl"],
            "width": m["width"] or 1280,
            "height": m["height"] or 853,
            "alt": poi_name,
            "query": poi_name,                 # 自愈关键字段
            "credit": {
                "source": "wikimedia",
                "author": strip_html(m["author"]) or "Wikimedia Commons 贡献者",
                "license": m["license"] or "CC BY-SA",
                "sourceUrl": m["sourceUrl"],
                "attributionRequired": True,
            },
        })
        have.add(m["url"])
        added += 1
        print(f"  + {f}  [{m['license']}] {strip_html(m['author'])[:30]}")

    if not added:
        print("没有新增")
        return 0

    poi["images"] = imgs
    if poi.get("_noImage"):
        poi["_noImage"] = False
    poi["updatedAt"] = datetime.now().isoformat(timespec="seconds")
    path.write_text(json.dumps(poi, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{poi_name}：现在 {len(imgs)} 张图 → {path.relative_to(ROOT).as_posix()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
