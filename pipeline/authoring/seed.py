"""
pipeline/authoring/seed.py —— 按城市跑"① 搜索 → ② 抽取"，生成 city.json + POI 分片

用法（在**仓库根**执行，`pipeline/` 与 `schema/` 都在这一层）：
    python pipeline/authoring/seed.py chongqing
    python pipeline/authoring/seed.py --all            # 跑 seeds/ 下全部城市
    python pipeline/authoring/seed.py chongqing --no-hero   # 跳过取城市头图（离线时用）

产出后还要跑两步才算可用：
    python pipeline/steps/step3_geocode.py chongqing    # 补坐标
    python pipeline/steps/step4_images.py  chongqing    # 补图片

★ 本脚本**只写内容**，坐标与图片一律留空并打 `_geocoded: False` ——
草稿状态必须是显式的，否则人会误以为"数据齐了可以直接上线"。
"""

from __future__ import annotations

import argparse
import importlib
import sys
from pathlib import Path

# ★ 本文件在 pipeline/authoring/，往上两级才是仓库根（见 core/layout.py 同处陷阱）
REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from pipeline.geo import citymeta                 # noqa: E402
from pipeline.core.layout import (                # noqa: E402
    PIPELINE, city_json_path, ensure_city_tree, poi_json_path, province_slug,
    write_json,
)
from pipeline.authoring.seedlib import (               # noqa: E402
    build_city, expand_poi,
)

SEEDS_PKG = "pipeline.seeds"
GROUPS = (("scenic", "SCENIC"), ("food", "FOOD"), ("hotspot", "HOTSPOT"), ("culture", "CULTURE"))


def list_seed_ids() -> list[str]:
    """列出全部采编稿 id（`pipeline/seeds/` 下的 .py）。

    ★ 本文件在 `pipeline/authoring/`，而 `seeds/` 是它的**兄弟目录**——
      直接 `parent / "seeds"` 会指向 `pipeline/authoring/seeds`（不存在），
      `glob` 返回空、**`seed.py --all` 于是静默跑零座城市**（2026-10-07 分层时踩过）。
      所以从 `PIPELINE` 根算，且目录缺失时**直接抛**，不返回空列表糊过去。
    """
    d = PIPELINE / "seeds"
    if not d.is_dir():
        raise FileNotFoundError(
            f"采编稿目录不存在：{d} —— 它应是 pipeline/seeds/（与 authoring/ 平级）"
        )
    return sorted(p.stem for p in d.glob("*.py") if not p.name.startswith("_"))


def pick_hero(city_name: str, want: int = 3) -> list[dict]:
    """城市头图。

    图源顺序与 `images.pick_images` 保持一致：Unsplash / Pexels 优先（免署名、
    允许热链），都取不到再退 Wikimedia（CC 许可，需署名）。
    ★ 不再走百度百科 —— `bkimg.cdn.bcebos.com` 有 Referer 防盗链，自家站点加载必 403。
    """
    from pipeline.authoring.images import (
        search_pexels, search_unsplash, search_wikimedia,
    )

    imgs: list[dict] = []
    for query in (f"{city_name} China city skyline", f"{city_name} 城市风光", city_name):
        for search in (search_unsplash, search_pexels, search_wikimedia):
            if len(imgs) >= want:
                break
            imgs += search(query)
        if len(imgs) >= want:
            break

    if not imgs:
        raise RuntimeError(f"「{city_name}」没取到头图 —— city.json 要求 heroImages 至少 1 张")
    # width/height 未知时给个 16:9 的保守值：前端只用来算占位比例，不影响展示
    out = []
    for im in imgs[:want]:
        im.setdefault("width", 1080)
        im.setdefault("height", 720)
        out.append(im)
    return out


def run(city_id: str, *, no_hero: bool = False, refresh_meta: bool = False) -> int:
    try:
        mod = importlib.import_module(f"{SEEDS_PKG}.{city_id}")
    except ModuleNotFoundError as exc:
        print(f"❌ 没有城市「{city_id}」的采编稿（{exc}）")
        print(f"   现有：{list_seed_ids()}")
        return 1

    seed = {
        "name": mod.NAME,
        "province": mod.PROVINCE,
        "tagline": mod.TAGLINE,
        # ★ INTRO 是「相邻字符串字面量按逗号拼成的元组」，必须 join 成一段字符串再落盘，
        #   否则 city.json 里会是数组，pydantic 的 `intro: str` 直接炸（详见 build 的 ERROR）。
        "intro": "".join(mod.INTRO) if isinstance(mod.INTRO, (list, tuple)) else mod.INTRO,
        "facts": mod.FACTS,
        "fetchedAt": getattr(mod, "FETCHED_AT", "2026-09-19"),
        "defaultZoom": getattr(mod, "DEFAULT_ZOOM", 10),
    }

    print(f"\n=== {seed['name']}（{city_id}）===")
    meta = citymeta.resolve(seed["name"], seed["province"], city_id, refresh=refresh_meta)
    print(f"  adcode {meta['adcode']} · center {meta['center']['lng']},{meta['center']['lat']}")
    print(f"  bbox {meta['bbox']}")

    slug = province_slug(seed["province"])
    ensure_city_tree(slug, city_id)

    # ── POI ──
    total = 0
    for category, attr in GROUPS:
        items = getattr(mod, attr, [])
        for d in items:
            poi = expand_poi(d, category, seed["fetchedAt"])
            write_json(poi_json_path(slug, city_id, category, poi["id"]), poi)
            total += 1
        print(f"  {category:<8} {len(items)} 个")

    # ── city.json ──
    hero = [] if no_hero else pick_hero(seed["name"])
    city = build_city(meta, seed, hero)
    write_json(city_json_path(slug, city_id), city)

    print(f"✅ 已写入 {total} 个 POI + city.json（头图 {len(hero)} 张）")
    print("   下一步：step3_geocode → step4_images")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="生成城市主数据与 POI 分片")
    ap.add_argument("city", nargs="?", help=f"城市 id，如 chongqing；可选：{list_seed_ids()}")
    ap.add_argument("--all", action="store_true", help="跑 seeds/ 下全部城市")
    ap.add_argument("--no-hero", action="store_true", help="不取城市头图（离线时用）")
    ap.add_argument("--refresh-meta", action="store_true", help="忽略 bbox 缓存重新拉取")
    a = ap.parse_args()

    ids = list_seed_ids() if a.all else ([a.city] if a.city else [])
    if not ids:
        ap.error("请给城市 id 或加 --all")
    rc = 0
    for cid in ids:
        rc |= run(cid, no_hero=a.no_hero, refresh_meta=a.refresh_meta)
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
