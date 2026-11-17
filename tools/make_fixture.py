#!/usr/bin/env python3
"""
tools/make_fixture.py —— 生成 data/_fixtures/ 下的开发占位数据

两个用途：
  1. 真实数据就绪前，让页面能跑起来看效果（fixtures 只在 DEV 且 cities/ 为空时生效）
  2. ★ 充当「什么算一份合法的城市数据」的参照物 —— 字段该怎么填
     看采集脚本时对着它看，比读 schema 更直观

用法（在**仓库根**执行）：
    python tools/make_fixture.py

★ 归属说明：它是**开发工具**，不是抓取流水线的一环（不碰网络、只写死数据），
  所以放 `tools/` 而不是 `pipeline/`。与 `check_app.py` 同一层。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]     # 仓库根：data/ 与 schema/ 在这一层
sys.path.insert(0, str(REPO))

NOW = "2026-09-18"

# ── 六个点位（近似坐标，仅供开发占位；真实数据由采集流水线产出）──────────
# 字段顺序：(id, 名称, category, subtype, 中文名, lng, lat, 建议停留分钟)
POIS = [
    ("kuanzhai-alley", "宽窄巷子", "scenic", "historic", "古迹古建", 104.05770, 30.66900, 90),
    ("peoples-park", "人民公园", "scenic", "park", "公园园林", 104.05600, 30.65710, 60),
    ("wuhou-shrine", "武侯祠", "scenic", "historic", "古迹古建", 104.04920, 30.64480, 120),
    ("jinli", "锦里", "culture", "street", "特色街区", 104.04800, 30.64320, 75),
    ("panda-base", "大熊猫繁育研究基地", "scenic", "nature", "自然景观", 104.14700, 30.73330, 180),
    ("xiaolongkan", "小龙坎老火锅", "food", "local", "本地菜", 104.08200, 30.66000, 75),
]


def _placeholder_image(name: str) -> dict:
    """占位图。

    ⚠️ 这里刻意用真实图床域名 + 占位 photo id：URL 形状是对的，图片本身大概率 404。
    这正是有意为之 —— 它顺带验证了前端 ImageLazy 的三级降级（主图挂 → 下一张候选 → 风格化 SVG 占位卡）。
    真实数据必须带上可用的外链与完整 credit（见 data/README.md 第二节）。
    """
    return {
        "url": f"https://images.unsplash.com/photo-placeholder-{abs(hash(name)) % 10**9}?w=1080&q=70",
        "thumbUrl": f"https://images.unsplash.com/photo-placeholder-{abs(hash(name)) % 10**9}?w=400&q=60",
        "width": 1080,
        "height": 720,
        "alt": f"{name} —— 开发占位图（非真实内容）",
        "query": f"Chengdu {name}",
        "credit": {
            "source": "unsplash",
            "author": "占位（fixture）",
            "sourceUrl": "https://unsplash.com/",
            "license": "Unsplash License",
            "attributionRequired": False,
        },
    }


def _poi(row: tuple) -> dict:
    pid, name, cat, sub, subname, lng, lat, dwell = row
    lo = max(15, dwell - 15)
    hi = dwell + 30
    return {
        "id": pid,
        "name": name,
        "category": cat,
        "subtype": sub,
        "summary": f"{name} —— 开发占位数据，用于跑通链路",
        "description": (
            f"这是 {name} 的开发占位描述，仅用于验证页面渲染与行程时间链推导，"
            "不是真实内容。真实数据由采集流水线产出，会带完整的正文、亮点、避坑建议、"
            "开放时间与票价（含字段级溯源），以及可用的外链图片与版权署名。"
        ),
        "highlights": ["占位亮点一", "占位亮点二"],
        "location": {
            "point": {"lng": lng, "lat": lat, "coordSystem": "GCJ-02"},
            "address": f"成都市（占位地址 · {subname}）",
            "district": "占位区",
            "transportTip": "占位交通提示",
        },
        "practical": {
            "duration": f"建议 {lo}-{hi} 分钟（占位）",
            "durationMinutes": [lo, hi],
            "priceLevel": "free" if cat in ("scenic", "culture") else "mid",
        },
        "audience": ["solo", "couple", "friends"],
        "accessible": False,
        "tips": ["占位提示"],
        "images": [_placeholder_image(name)],
        "coverIndex": 0,
        "tags": ["占位"],
        "popularity": 90 - row[7] // 10,  # 停留越久热度越高（仅占位用，真实值由脚本按公开热度信号打分）
        "sources": [
            {
                "title": f"{name} · 占位来源（非真实）",
                "url": "https://example.com/placeholder",
                "kind": "media",
                "fetchedAt": NOW,
            }
        ],
        "updatedAt": NOW,
    }


def main() -> int:
    n = len(POIS)

    city = {
        "schemaVersion": 1,
        "id": "chengdu",
        "name": "成都",
        "province": "四川",
        "adcode": "510100",
        "provinceAdcode": "510000",
        "tagline": "天府之国，慢生活之都",
        "intro": (
            "这是成都的开发占位数据，用来在真实采集数据就绪前跑通「地图撒点 → 下钻 → 详情 → 行程规划」全链路，"
            "不代表任何真实内容。真实数据会包含城市概览、气候与建议天数、交通提示，"
            "四大类内容（景点 / 美食 / 网红打卡 / 城市特色）的分组说明与筛选色，"
            "以及每城约 46 个点位的完整正文、亮点、避坑建议、开放时间、票价（均带字段级溯源）、"
            "适游群体标注与无障碍说明，图片一律外链并附完整版权署名。"
        ),
        "center": {"lng": 104.066541, "lat": 30.572269, "coordSystem": "GCJ-02"},
        "bbox": [103.75, 30.30, 104.65, 30.93],
        "defaultZoom": 11,
        "heroImages": [_placeholder_image("成都")],
        "facts": {
            "bestSeason": "3-6 月 / 9-11 月",
            "suggestedDays": "2-3 天",
            "transitTip": "地铁覆盖主要景点，占位文案",
            "climateTip": "占位文案",
        },
        "categories": [
            {
                "key": "scenic",
                "label": "旅游景点",
                "desc": "自然景观、博物馆、古迹古建、公园园林、宗教场所",
                "icon": "scenic",
                "color": "#2F7BE8",
                "subtypes": ["nature", "museum", "historic", "park", "temple"],
            },
            {
                "key": "food",
                "label": "特色美食",
                "desc": "本地菜老字号、小吃夜市、咖啡馆茶馆",
                "icon": "food",
                "color": "#E8672F",
                "subtypes": ["local", "snack", "cafe"],
            },
            {
                "key": "hotspot",
                "label": "网红打卡",
                "desc": "拍照机位、艺术区创意园",
                "icon": "hotspot",
                "color": "#E8389B",
                "subtypes": ["photo", "art"],
            },
            {
                "key": "culture",
                "label": "城市特色",
                "desc": "特色街区、演出剧场",
                "icon": "culture",
                "color": "#12A67A",
                "subtypes": ["street", "performance"],
            },
        ],
        "pois": [_poi(r) for r in POIS],
        "credits": {
            "imageSources": ["Unsplash（占位）"],
            "textSources": ["fixture 生成器（非真实来源）"],
            "lastUpdated": NOW,
        },
        "updatedAt": NOW,
    }

    # 写盘前先自校验 —— 这正是采集脚本该有的习惯
    from schema.schema import City

    City.model_validate(city)

    out_dir = REPO / "data" / "_fixtures"
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / "chengdu.json"
    out.write_text(json.dumps(city, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"✅ 已写入 {out.relative_to(REPO)}")
    print(f"   {n} 个 POI")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
