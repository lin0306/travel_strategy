"""
pipeline/authoring/seedlib.py —— 采编稿 → POI / city.json 的**公共展开器**

★ 为什么要有这一层：
第一座城市（成都）是把展开逻辑直接写在采编稿文件里的（当时的 `seed_chengdu.py`，
自带一份 `_poi()`）。再来 8 座城市，同样的 `_poi()` 就会被复制 8 份 ——
任何字段口径调整都要改 8 处，必然漂。
所以把"展开"抽出来，每个城市只留**纯数据**（采编稿）。
★ 2026-10-07：成都那份也已迁成 `seeds/chengdu.py`，83 城格式彻底统一。

分工：
    seeds/{cityId}.py   ← 只写数据（POI清单 + 城市文案），人/AI 填
    seedlib.py          ← 展开成完整结构，全项目唯一一份
    seed.py             ← 跑：生成 city.json + pois/**/*.json
    steps/step3/step4   ← 补坐标与图片（本层刻意留空，草稿状态是显式的）

⚠️ 数据来源纪律（plans/04 第二节）：
  · 每条 POI 至少带一条来源，写真实可点的 URL，**不做无出处的编造**
  · 价格、开放时间一律带"约 / 起 / 以官方为准"兜底 —— 这类信息会过期，
    宁可模糊也不要给出看起来精确但实际是错的承诺
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

#: 四个大类的展示口径。**全项目唯一真源** —— 与前端 SUBTYPE_META 三处同源。
#: city.json 的 categories 直接由它生成，不每城手抄一遍。
CATEGORIES: list[dict] = [
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
]

#: 大类 → 允许的细类。生成时用它兜底检查，防止把手写错的 subtype 写进数据。
SUBTYPE_OF_CATEGORY: dict[str, set[str]] = {
    c["key"]: set(c["subtypes"]) for c in CATEGORIES
}

#: ★ 与 schema 的枚举严格对齐。写错值在 Pydantic 那头只会报一行 "Input should be"，
#: 排查要翻半天 —— 不如在生成时就拦下（成都那批数据里出现过的 `ugc` 就是这么来的）。
PRICE_LEVELS = {"free", "budget", "mid", "high"}
SOURCE_KINDS = {"gov", "wiki", "official", "travel-platform", "media", "social"}

#: 适游人群（与 `shared/schema.ts` 的 `AudienceEnum` 严格对齐，中文是 `AUDIENCE_META` 的 label）。
AUDIENCES = {"solo", "couple", "kids", "friends", "family", "elders"}

#: ★ 采编稿里的 `aud` 用中文写（人读起来方便），生成时映射成枚举。
#: 映射为空列表 = **丢弃**：兴趣（摄影/美食/文化/户外）、场景（商务）都不是「同行关系」，
#: 枚举里没有这个维度，按红线 12「无数据不显示」**不编造近似值**，直接不写这一项。
AUDIENCE_ALIASES: dict[str, list[str]] = {
    "情侣": ["couple"],
    "独自旅行": ["solo"],
    "独游": ["solo"],
    "亲子": ["kids"],
    "家庭": ["family"],
    "朋友结伴": ["friends"],
    "朋友": ["friends"],
    "中老年": ["elders"],
    "长辈": ["elders"],
    # ↓ 兴趣 / 场景维度：枚举里没有对应项 → 丢弃（信息由 tags 承载，不重复表达）
    "摄影爱好者": [],
    "文艺青年": [],
    "文化爱好者": [],
    "美食爱好者": [],
    "户外爱好者": [],
    "商务宴请": [],
    "商务": [],
}


def expand_audience(raw: str, name: str = "") -> list[str]:
    """把中文 `aud` 展开成合法枚举（去重、保序）。未知词直接报错 —— 宁可拦下也不许漏进数据。"""
    out: list[str] = []
    for w in (raw or "").split():
        if w in AUDIENCES:                      # 已经写成英文枚举也接受
            if w not in out:
                out.append(w)
            continue
        if w not in AUDIENCE_ALIASES:
            raise ValueError(
                f"POI「{name}」适游人群「{w}」无法识别，"
                f"可写：{sorted(AUDIENCE_ALIASES)} 或枚举 {sorted(AUDIENCES)}"
            )
        for a in AUDIENCE_ALIASES[w]:
            if a not in out:
                out.append(a)
    return out


def baike(item: str) -> str:
    """百度百科词条 URL（中文需 percent-encode）。"""
    return f"https://baike.baidu.com/item/{quote(item)}"


def expand_poi(d: dict, category: str, fetched_at: str) -> dict:
    """把一条紧凑的采编稿展开成完整 POI 结构。

    采编稿字段（均为可选，除标注外）：
        id name sub sum desc hl addr dist trans hours ticket pl dur pop acc tips tags src qEn qZh

    ★ 注意 `point` 与 `images` **刻意留空**：坐标只能来自地理编码接口（凭印象写坐标
      违反溯源红线），图片由 step4 补。草稿状态由 `_geocoded: False` 显式标记，
      不会让人误以为已经可用。
    """
    if category not in SUBTYPE_OF_CATEGORY:
        raise KeyError(f"未知大类「{category}」")
    sub = d.get("sub", "")
    if sub and sub not in SUBTYPE_OF_CATEGORY[category]:
        raise KeyError(
            f"POI「{d.get('name')}」的细类「{sub}」不属于大类「{category}」，"
            f"合法值：{sorted(SUBTYPE_OF_CATEGORY[category])}"
        )

    aud: list[str] = expand_audience(d.get("aud") or "", d.get("name", ""))
    src_title, src_url, src_kind = d["src"]          # ★ 缺来源直接 KeyError —— 不许匿名入库
    if src_kind not in SOURCE_KINDS:
        raise ValueError(
            f"POI「{d.get('name')}」来源类型「{src_kind}」非法，合法值：{sorted(SOURCE_KINDS)}"
        )

    pl = d.get("pl")
    if pl and pl not in PRICE_LEVELS:
        raise ValueError(
            f"POI「{d.get('name')}」priceLevel「{pl}」非法，合法值：{sorted(PRICE_LEVELS)}"
        )

    practical: dict[str, Any] = {}
    if d.get("hours"):
        practical["openHours"] = d["hours"]
        practical["openHoursRef"] = 0
    if d.get("ticket"):
        practical["ticket"] = d["ticket"]
        practical["ticketRef"] = 0
    lo, hi = d.get("dur", (60, 90))
    practical["duration"] = f"建议 {lo}-{hi} 分钟"
    practical["durationMinutes"] = [lo, hi]
    if d.get("pl"):
        practical["priceLevel"] = d["pl"]

    return {
        "id": d["id"],
        "name": d["name"],
        "category": category,
        "subtype": sub,
        "summary": d["sum"],
        "description": d["desc"],
        "highlights": d["hl"],
        "location": {
            "point": None,                            # ★ 等 step3_geocode 补
            "address": d.get("addr", ""),
            "district": d.get("dist", ""),
            "transportTip": d.get("trans", ""),
        },
        "practical": practical,
        "audience": aud,
        "accessible": bool(d.get("acc")),
        "tips": d.get("tips", []),
        "images": [],                                 # ★ 等 step4_images 补
        "coverIndex": 0,
        "tags": d.get("tags", []),
        "popularity": d.get("pop", 60),
        "sources": [{
            "title": src_title,
            "url": src_url,
            "kind": src_kind,
            "fetchedAt": fetched_at,
        }],
        "updatedAt": fetched_at,
        # ── 采集期内部标记（不参与前端渲染）──
        "_geocoded": False,
        "_imageQuery": {"en": d.get("qEn", ""), "zh": d.get("qZh", d["name"])},
    }


def build_city(meta: dict, seed: dict, hero_images: list[dict]) -> dict:
    """组装 city.json。

    `meta`  来自 citymeta.resolve()（adcode / center / bbox —— 全部接口实测，不手填）
    `seed`  来自 seeds/{cityId}.py（文案 —— 人写部分）
    """
    return {
        "schemaVersion": 1,
        "id": meta["cityId"],
        "name": seed["name"],
        "province": seed["province"],
        "adcode": meta["adcode"],
        "provinceAdcode": meta["provinceAdcode"],
        "tagline": seed["tagline"],
        "intro": seed["intro"],
        "center": meta["center"],
        "bbox": meta["bbox"],
        "defaultZoom": seed.get("defaultZoom", 10),
        "heroImages": hero_images,
        "facts": seed["facts"],
        "categories": CATEGORIES,
        "credits": {"imageSources": [], "textSources": [], "lastUpdated": seed["fetchedAt"]},
        "updatedAt": seed["fetchedAt"],
    }
