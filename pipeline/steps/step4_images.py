#!/usr/bin/env python3
"""
pipeline/steps/step4_images.py —— 给 POI 补外链图片（04 文档第四步）

★ 全部外链，零文件：仓库里只有 URL 字符串。
★ 每张图必带 `query` —— 月度巡检靠它自动重搜补图（没有 query 的图不许入库）。

降级链（04 文档 4.2）：
    ① 实景图      Unsplash / Pexels 搜具体英文名（English 优先）
    ② 氛围图      搜 "{品类} {城市}"
    ③ Wikimedia   CC 许可中式景点兜底（**必须署名**，无需 key、无配额）
    ④ 都没有 → 留空，前端渲染**风格化 SVG 占位卡**（不是破图）

★ 百度百科已于 2026-09-20 从图源中移除：`bkimg.cdn.bcebos.com` 带 Referer 防盗链，
  非百度域名（含自家站点）一律 403 —— 落库的图在线上必然全废。详见 images.py 头部。

三级图源里 Wikimedia 永远可用（无需 key）；Unsplash / Pexels 配了 key 才参与，
没配则自动跳过 —— 取不到图不该中断整条流水线（本项目约定：缺图是 WARN 不是 ERROR）。
"""

from __future__ import annotations

import sys
from pathlib import Path

if __package__ in (None, ""):
    # ★ 本文件在 pipeline/steps/，往上两级才是仓库根（见 core/layout.py 同处陷阱）
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pipeline.authoring.images import configured_sources, pick_images   # noqa: E402
from pipeline.core.layout import (                                  # noqa: E402
    iter_city_dirs, iter_poi_files, read_json, write_json,
)

DEFAULT_PER_POI = 3


def fill_city_images(slug: str, city_id: str, city_dir: Path, *, force: bool = False) -> dict:
    """给一座城市的全部 POI 补图，返回统计。"""
    stats = {"total": 0, "filled": 0, "skipped": 0, "empty": 0, "empty_list": []}

    # ★ 中文城市名 + 英文 slug：把 Wikimedia 查询**限定在本市**。
    #   没有它，苏州「得月楼」会撞上丽江黑龙潭的「得月楼」，氛围图也会跑到新奥尔良。
    city_path = city_dir / "city.json"
    city_doc = read_json(city_path) or {}
    city_name = city_doc.get("name") or city_id

    for category, path in iter_poi_files(slug, city_id):
        poi = read_json(path)
        if not poi:
            continue
        stats["total"] += 1

        have = poi.get("images") or []
        if have and not force:
            stats["skipped"] += 1
            continue

        picked = pick_images(poi, max_keep=DEFAULT_PER_POI,
                             city=city_name, city_slug=city_id)
        if not picked:
            # ★ 必须落一个显式标记：**「跑了但图源没有」≠「没跑」**。
            # build 靠它把这类降级成 WARN（前端渲染占位卡），否则图源覆盖不全时
            # 流水线永远卡在 ERROR —— 与项目里「未收录 ≠ 0」「没内容 ≠ 没做」同一条原则。
            poi["_noImage"] = True
            write_json(path, poi)
            stats["empty"] += 1
            stats["empty_list"].append(f"{category}/{path.stem}（{poi.get('name','')}）")
            continue
        poi.pop("_noImage", None)          # 这次取到了 → 清掉上一次的标记

        # ★ 中文 alt 描述（SEO + a11y 必需）：没有就拿 ipsum」禁用 —— 必须写真实描述
        for i, img in enumerate(picked):
            if not img.get("alt") or len(img.get("alt", "")) < 2:
                img["alt"] = f"{poi.get('name','')} 第 {i + 1} 张"
            # alt 必须是中文可读描述；英文 alt_description 不足以充当 alt
        poi["images"] = picked
        poi["coverIndex"] = 0
        write_json(path, poi)
        stats["filled"] += 1

    # 城市封面
    city = read_json(city_path)
    if city and (not city.get("heroImages") or force):
        picked = pick_images({
            "name": city.get("name", city_id),
            "subtype": "photo",
            "_imageQuery": {"en": f"{city.get('name','')} China city skyline",
                            "zh": f"{city.get('name','')} 城市风光"},
        }, max_keep=3, city=city_name, city_slug=city_id)
        if picked:
            city["heroImages"] = picked
            write_json(city_path, city)

    return stats


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    force = "--force" in args
    only = next((a for a in args if not a.startswith("--")), None)

    print(f"可用图源：{', '.join(configured_sources())}")
    print("（未配 UNSPLASH_ACCESS_KEY / PEXELS_API_KEY 时只用 Wikimedia；"
          "三个图源都取不到则由前端渲染占位卡）")

    targets = [(s, c, d) for s, c, d in iter_city_dirs() if only is None or c == only]
    if not targets:
        print("⚠️ 没有找到城市目录")
        return 1

    for slug, cid, d in targets:
        st = fill_city_images(slug, cid, d, force=force)
        print(
            f"\n{slug}/{cid}：合计 {st['total']} · 已补图 {st['filled']} · "
            f"跳过（已有图）{st['skipped']} · 取不到图 {st['empty']}"
        )
        if st["empty_list"]:
            print("  取不到图（将走前端占位卡兜底）：")
            for x in st["empty_list"]:
                print(f"    · {x}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
