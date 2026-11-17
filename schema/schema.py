"""
shared/schema.py —— Pydantic 镜像（与 shared/schema.ts 字段一一对应）

用途：采集脚本产出的 JSON 在写盘前先用这里校验一遍。
在 CI 里跑一次字段 diff，两边不一致就直接失败（06 文档「闸门 1」）。

依赖：pip install pydantic>=2.7
"""

from __future__ import annotations

from typing import Literal, Optional, Tuple

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

SCHEMA_VERSION = 1

# ══════════════════════════════════════════════════════════════════
# 一、两级类型体系
# ══════════════════════════════════════════════════════════════════

Category = Literal["scenic", "food", "hotspot", "culture"]

SubType = Literal[
    "nature", "museum", "historic", "park", "temple",
    "local", "snack", "cafe",
    "photo", "art",
    "street", "performance",
]

#: 细类 → (中文名, 归属大类, marker 颜色)。★ 与 schema.ts 的 SUBTYPE_META 必须逐字一致
SUBTYPE_META: dict[str, tuple[str, str, str]] = {
    "nature": ("自然景观", "scenic", "#3B8C4E"),
    "museum": ("博物馆", "scenic", "#6B5BC7"),
    "historic": ("古迹古建", "scenic", "#8A6A3B"),
    "park": ("公园园林", "scenic", "#2A9D8F"),
    "temple": ("宗教场所", "scenic", "#B4553D"),
    "local": ("本地菜", "food", "#E76F2E"),
    "snack": ("小吃夜市", "food", "#D99B1A"),
    "cafe": ("咖啡馆", "food", "#A9805A"),
    "photo": ("拍照机位", "hotspot", "#D4537E"),
    "art": ("艺术园区", "hotspot", "#9B5FB0"),
    "street": ("特色街区", "culture", "#56707F"),
    "performance": ("演出剧场", "culture", "#A33B6B"),
}

SUBTYPE_CATEGORY: dict[str, str] = {k: v[1] for k, v in SUBTYPE_META.items()}

CATEGORY_META: dict[str, tuple[str, str]] = {
    "scenic": ("旅游景点", "#2F7BE8"),
    "food": ("特色美食", "#E8672F"),
    "hotspot": ("网红打卡", "#E8389B"),
    "culture": ("城市特色", "#12A67A"),
}

Audience = Literal["solo", "couple", "kids", "friends", "family", "elders"]

TravelMode = Literal["driving", "taxi", "transit", "subway", "bicycling", "walking"]

#: 停留时长的分类默认值（09 文档 4.2 降级第 ② 级）
DURATION_DEFAULT_MINUTES: dict[str, int] = {
    "scenic": 120, "food": 60, "hotspot": 45, "culture": 45,
}

# ══════════════════════════════════════════════════════════════════
# 二、基础结构
# ══════════════════════════════════════════════════════════════════


class GeoPoint(BaseModel):
    """GCJ-02 坐标。

    ⚠️ 腾讯的 SDK 与 WebService 都用**纬度在前**（TMap.LatLng(lat, lng)、from=lat,lng），
    而本字段按 GeoJSON 惯例是 lng, lat。跨边界处必须显式转换 —— 写反了不报错，
    只是点位跑到地球另一边。
    """

    lng: float = Field(ge=73, le=136, description="经度。中国范围粗筛，挡住经纬度写反")
    lat: float = Field(ge=3, le=54, description="纬度")
    coordSystem: Literal["GCJ-02"] = "GCJ-02"


class ImageCredit(BaseModel):
    source: Literal["unsplash", "pexels", "baike", "wikimedia", "gov-site", "self", "other"]
    author: str
    sourceUrl: str
    license: str
    attributionRequired: bool = False


class ImageItem(BaseModel):
    url: str
    thumbUrl: Optional[str] = None
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    alt: str = Field(min_length=2, description="必须写中文描述，兼顾 a11y 与 SEO")
    caption: Optional[str] = None
    query: str = Field(min_length=2, description="自愈关键：图挂了用这个关键词自动重搜")
    credit: ImageCredit


class SourceRef(BaseModel):
    title: str
    url: str
    kind: Literal["gov", "wiki", "official", "travel-platform", "media", "social"]
    publishedAt: Optional[str] = None
    fetchedAt: str = Field(description="抓取时间，必填 —— 不做无出处的编造")


class PoiPractical(BaseModel):
    openHours: Optional[str] = None
    openHoursRef: Optional[int] = Field(default=None, ge=0)
    ticket: Optional[str] = None
    ticketRef: Optional[int] = Field(default=None, ge=0)
    duration: Optional[str] = Field(default=None, description="给人看的自然语言：'建议 3-4 小时'")
    durationMinutes: Optional[Tuple[int, int]] = Field(
        default=None, description="★ 给机器算的结构化停留时长 [最短, 最长]（分钟）"
    )
    bestSeason: Optional[str] = None
    priceLevel: Optional[Literal["free", "budget", "mid", "high"]] = None
    reservation: Optional[str] = None
    reservationRef: Optional[int] = Field(default=None, ge=0)

    @field_validator("durationMinutes")
    @classmethod
    def _check_duration(cls, v: Optional[Tuple[int, int]]) -> Optional[Tuple[int, int]]:
        if v is None:
            return v
        lo, hi = v
        if lo <= 0 or hi <= 0:
            raise ValueError("durationMinutes 必须为正数")
        if lo > hi:
            raise ValueError(f"durationMinutes 应为 [最短, 最长]，实际 {v} 反了：{lo} > {hi}")
        return v


class ReviewFacet(BaseModel):
    """AI 点评里的**一条分项判断**（这一方面好不好）。

    ★ 与入库打分的四维（`tools/rate_poi.py` 的口碑/独特/密度/可信）是**两回事**，
      别把两者对齐或互相换算：
        · 四维是**闸门** —— 固定口径、可复现，回答"这个点位该不该收录"；
        · facet 是**解释** —— 按点位自己的性质取，回答"它好在哪、差在哪"。
      博物馆关注展陈与人流，爬山关注体力与视野，美食街关注口味与排队 ——
      固定四维翻译不出这些，硬套会让所有卡片长得一样。
    """

    label: str = Field(min_length=2, max_length=6, description="2~6 字，如「展陈」「人流」「排队」")
    score: float = Field(ge=0, le=5)
    note: Optional[str] = Field(default=None, max_length=40, description="一句话依据，一行内说得完")


class PoiReview(BaseModel):
    """**AI 点评** —— 详情页那张卡片的全部内容，也是列表分数徽标的来源。

    ## 为什么要单独一段而不是复用 description
    `description` 是**中立的事实介绍**（哪年建的、有什么、怎么看），它不能带立场。
    用户要的恰恰是立场：值不值得去、谁适合去、有什么坑。两件事写在同一段里，
    就变成"介绍里夹私货"，两边都做不好。

    ## 免责是硬要求（用户 2026-11-10 明确要求）
    分数来自网络公开信息的 AI 归纳，**不保证准确**。所以：
      · `basis` 必须标清这份点评是「联网复核过」还是「只根据站内资料」；
      · 前端卡片与「关于」弹窗都必须出现免责说明（`check_app` 的 AZ 组有判据）；
      · 绝不把它包装成"用户评分"或"官方评定" —— 那是伪造权威。
    """

    score: float = Field(ge=0, le=5, description="综合分，与入库打分同源（四维加权），列表按它排序")
    verdict: Literal["专程去", "值得一去", "顺路看看", "时间富余再说"]
    facets: list[ReviewFacet] = Field(min_length=2, max_length=5,
                                      description="2~5 条，按这点位自己的性质取，不必凑满")
    body: str = Field(min_length=40, max_length=400,
                      description="点评正文。必须含**至少一句负面** —— 只夸不贬等于没写")
    fits: list[str] = Field(default_factory=list, description="适合谁，2~6 字短标签")
    avoid: list[str] = Field(default_factory=list, description="不适合谁 / 什么情况别来")
    basis: Literal["web", "corpus"] = Field(
        description="web = 联网查过风评与官方口径；corpus = 只用站内已核实资料合成")
    sources: list[str] = Field(default_factory=list, description="basis=web 时的真实链接")
    at: str = Field(description="生成日期 YYYY-MM-DD —— 点评会过期，必须能看出多旧")


class PoiLocation(BaseModel):
    point: GeoPoint
    # ★ 到达点：高德 entr_location（入口坐标）。
    # 仅当"入口距园区中心 > 300m"时才在规划链路使用（见 arrival_of），
    # 小景点差 200m 不挪，保护锦里类点位。展示类（标记/详情/飞入）一律用 point。
    entrance: Optional[GeoPoint] = None
    address: str = Field(min_length=2)
    district: Optional[str] = None
    transportTip: Optional[str] = None


# ══════════════════════════════════════════════════════════════════
# 三、POI
# ══════════════════════════════════════════════════════════════════


class Poi(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(pattern=r"^[a-z0-9-]+$")
    name: str = Field(min_length=2)
    category: Category
    subtype: SubType
    summary: str = Field(max_length=80)
    description: str = Field(min_length=80, description="正文 ≥ 80 字，质量门槛")
    highlights: list[str] = Field(min_length=2)
    location: PoiLocation
    practical: PoiPractical = Field(default_factory=PoiPractical)
    audience: list[Audience] = Field(min_length=1)
    accessible: bool = Field(default=False, description="★ 默认 false —— 未核实就不声称")
    tips: list[str] = Field(default_factory=list)
    # ★ 允许 0 张：图源（Unsplash / Pexels / 百科）覆盖不全时必然有 POI 取不到图，
    #   04 文档 4.2 第 ④ 条就是「留空 + 前端渲染占位卡」。把它定成 min_length=1
    #   等于宣布"图源不全就不许发版"。「step4 没跑」由 build 用 `_noImage` 标记区分。
    # ★ 2026-11-08 去掉 `max_length=8`：候选补图链路已取消张数上限，
    #   AI 逐张看图判 ok 的图全部写回。这里再留 8 会让 build 把合法数据判成
    #   ValidationError。张数由「看图判定」把关，不再由契约数字把关。
    images: list[ImageItem] = Field(default_factory=list)
    coverIndex: int = Field(default=0, ge=0)
    tags: list[str] = Field(default_factory=list)
    popularity: int = Field(
        default=50, ge=0, le=100,
        description="★ 必填：自研标注避让依赖它排序，缺了该点在低 zoom 下永远不显示标注",
    )
    sources: list[SourceRef] = Field(min_length=1)
    # ★ 可选：没生成点评的点位**不写这个字段**（不是写空对象）。
    #   前端判据是 `poi.review` 有无，有才渲染卡片；没有就整块不出现。
    review: Optional[PoiReview] = None
    updatedAt: str
    # ★ 派生字段（由 `build` 用坐标点在区多边形内判定后写回，**人手不填**）。
    #   它回答"这个点位属于哪个区"，是四级下钻里「区 → 景点」这一跳的唯一依据。
    #   `None` = 还没归区（第一次跑 build 之前的状态），UI 不该把它当错误。
    district: str | None = Field(default=None, description="所属区 adcode（build 判定后写回）")

    @model_validator(mode="after")
    def _check_invariants(self) -> "Poi":
        # 类型一致性：subtype 必须归属其 category（不一致即配置错误，阻断入库）
        expect = SUBTYPE_CATEGORY.get(self.subtype)
        if expect != self.category:
            raise ValueError(
                f"POI「{self.id}」类型不一致：subtype={self.subtype} 应属 {expect}，但 category={self.category}"
            )
        # 适游群体不得重复
        if len(set(self.audience)) != len(self.audience):
            raise ValueError(f"POI「{self.id}」audience 有重复项：{self.audience}")
        # coverIndex 不得越界
        # ★ images 可以为空（取不到图），那时 coverIndex 无从比较，跳过即可
        if self.images and self.coverIndex >= len(self.images):
            raise ValueError(f"POI「{self.id}」coverIndex={self.coverIndex} 越界（images 长度 {len(self.images)}）")
        # 溯源下标不得越界
        for fname in ("openHoursRef", "ticketRef", "reservationRef"):
            ref = getattr(self.practical, fname, None)
            if ref is not None and ref >= len(self.sources):
                raise ValueError(f"POI「{self.id}」{fname}={ref} 越界（sources 长度 {len(self.sources)}）")
        return self


# ══════════════════════════════════════════════════════════════════
# 四、城市
# ══════════════════════════════════════════════════════════════════


class CityCategory(BaseModel):
    key: Category
    label: str
    desc: str
    icon: str
    color: str = Field(description="筛选 chip 主色，不是 marker 颜色")
    subtypes: list[SubType]


class CityFacts(BaseModel):
    bestSeason: Optional[str] = None
    suggestedDays: Optional[str] = None
    transitTip: Optional[str] = None
    climateTip: Optional[str] = None


class CityCredits(BaseModel):
    imageSources: list[str] = Field(default_factory=list)
    textSources: list[str] = Field(default_factory=list)
    lastUpdated: str


class City(BaseModel):
    schemaVersion: int = Field(ge=1)
    id: str = Field(pattern=r"^[a-z0-9-]+$")
    name: str = Field(min_length=2)
    province: str = Field(min_length=2)
    adcode: str = Field(pattern=r"^\d{6}$", description="★ 与区划树的关联键")
    provinceAdcode: str = Field(pattern=r"^\d{6}$")
    tagline: str = Field(max_length=30)
    intro: str = Field(min_length=150)
    center: GeoPoint
    bbox: Tuple[float, float, float, float] = Field(description="[minLng, minLat, maxLng, maxLat]")
    defaultZoom: float = Field(default=11, ge=3, le=20, description="腾讯 GL 缩放范围 3~20")
    heroImages: list[ImageItem] = Field(min_length=1, max_length=3)
    facts: CityFacts = Field(default_factory=CityFacts)
    categories: list[CityCategory]
    pois: list[Poi] = Field(min_length=1)
    credits: CityCredits
    updatedAt: str

    @model_validator(mode="after")
    def _check_invariants(self) -> "City":
        ids = [p.id for p in self.pois]
        if len(set(ids)) != len(ids):
            raise ValueError(f"城市「{self.id}」POI id 有重复：{[x for x in ids if ids.count(x) > 1]}")

        # POI 必须落在城市 bbox 内
        min_lng, min_lat, max_lng, max_lat = self.bbox
        if not (min_lng < max_lng and min_lat < max_lat):
            raise ValueError(f"城市「{self.id}」bbox 顺序错误，应为 [minLng, minLat, maxLng, maxLat]")
        for p in self.pois:
            pt = p.location.point
            if not (min_lng <= pt.lng <= max_lng and min_lat <= pt.lat <= max_lat):
                raise ValueError(
                    f"POI「{p.id}」坐标 ({pt.lng}, {pt.lat}) 落在城市 bbox {self.bbox} 之外"
                )
        return self


# ══════════════════════════════════════════════════════════════════
# 五之二、省级展示层（data/provinces/index.json，2026-11-14）
# ══════════════════════════════════════════════════════════════════


class ProvinceContent(BaseModel):
    """一个省级单位的**可读内容**。

    ★ 省级在 `data/` 里原本只有区划与边界（`_generated/provinces/*.geo.json`），
      没有任何可以给人读的东西 —— 首页省卡只能拿"下辖几个市/收了哪几座"凑一段话。
      这里补的是「这个省是什么样」，与市级的 `City.intro` / `heroImages` 对齐。

    ★ `heroImages` 允许为空：省封面要逐张看图后才写回（`tools/province_cover.py`），
      没审完之前整块不渲染 —— 不像 `City.heroImages` 那样 `min_length=1`，
      因为城市封面是"点进这座城市唯一的视觉锚点"，省卡没有它也成立。
    """

    intro: str = Field(min_length=60, description="采编正文，真实人文地理，不编数据")
    heroImages: list[ImageItem] = Field(default_factory=list, max_length=3)


class ProvinceIndex(BaseModel):
    """`data/provinces/index.json` 的整体形状。键 = 6 位省级 adcode。"""

    updatedAt: str
    provinces: dict[str, ProvinceContent] = Field(default_factory=dict)


# ══════════════════════════════════════════════════════════════════
# 五、区划树
# ══════════════════════════════════════════════════════════════════


#: 区划层级名。
#: ★ 前端**按这个字段渲染**，不靠"节点在树里的深度" —— 因为直辖市没有中间的市层
#:   （腾讯给 `110100` 返回 0 个下级），它的 `children` 直接就是 `district`。
#:   靠深度判断就会得出"北京只有两级"，正是这次要消掉的不一致。
DistrictLevelName = Literal["province", "city", "district"]


class DistrictCityNode(BaseModel):
    """区划树上的一个**非省级**节点 —— 可能是市，也可能是区。

    ★ `children` 递归是刻意的：普通省是 市 → 区 两级子节点，而直辖市的
      子节点只有区一级。两者在**树里的深度不同、但 level 语义一致**，
      这是唯一能同时满足「数据自然」与「前端统一」的表达方式。
    """

    adcode: str = Field(pattern=r"^\d{6}$")
    name: str
    center: dict[str, float]
    level: DistrictLevelName = Field(default="city", description="province / city / district")
    cityId: Optional[str] = Field(
        default=None, description="null = 待收录（≠ 0）。UI 必须显示「待收录」"
    )
    poiCount: int = Field(default=0, ge=0)
    children: list["DistrictCityNode"] = Field(default_factory=list)


# 自引用模型：pydantic 需要显式 rebuild 才能解析上面的前向引用
DistrictCityNode.model_rebuild()


class SubdistrictFile(BaseModel):
    """`data/_generated/subdistricts/<市adcode>.json` —— 一座城市的**区列表**。

    ## 为什么不把它并进 `district-tree.json`
    全国 493 个市 × 约 11 个区 ≈ 5000 个节点，全塞进树里会让树从 55KB 涨到几百 KB，
    而首页与省级页只需要两级。**按市分片 + 懒加载**之后，只有真的走进某座城市
    才会读它那一份（约 1KB）。

    ## 边界在哪
    同一座市的区边界在 `districts/<市adcode>.geo.json`（形状与省级边界文件一致），
    前端 `loadDistrictBounds()` 不区分省还是市，直接按 adcode 取。
    """

    adcode: str = Field(pattern=r"^\d{6}$")
    name: str
    level: Literal["district"] = Field(default="district")
    children: list[DistrictCityNode] = Field(default_factory=list)
    fetchedAt: str


class DistrictProvinceNode(BaseModel):
    adcode: str = Field(pattern=r"^\d{6}$")
    name: str
    fullname: str
    center: dict[str, float]
    level: DistrictLevelName = Field(default="province")
    cityId: Optional[str] = Field(
        default=None, description="直辖市 / 港澳台：省节点自身就是那座城市"
    )
    isCity: bool = Field(
        default=False,
        description=(
            "★ 省节点**自身就是一座市**（直辖市 / 特别行政区）—— 它的 children 直接是区，"
            "中间没有市这一层（腾讯对 110100「市辖区」返回 0 个下级）。\n"
            "★ 为什么不能让前端靠 `cityId` 或 children 的 level 去猜：那是**收录状态**的副产物，"
            "天津（未收录）就会被判成普通省，它的 16 个区在市级那档被当成 16 座「待收录市」。"
            "判据必须与收录无关，所以由 build 按 adcode 段写入（见 build.sync_district_tree）。"
        ),
    )
    poiCount: int = Field(default=0, ge=0)
    cityCount: int = Field(default=0, ge=0, description="已收录城市数")
    childCount: int = Field(default=0, ge=0, description="区划树上的下辖数量，与内容无关")
    children: list[DistrictCityNode] = Field(default_factory=list)


class DistrictTree(BaseModel):
    version: str
    generatedAt: str
    provinces: list[DistrictProvinceNode]


# ══════════════════════════════════════════════════════════════════
# 六之二、搜索索引（顶栏搜索用；build.py 写盘前用它自校）
# ══════════════════════════════════════════════════════════════════


class SearchRegion(BaseModel):
    """一条地区（省 / 市）。★ 与区划树节点刻意分开：那份给徽标用，这份给输入框用"""

    adcode: str = Field(pattern=r"^\d{6}$")
    name: str
    level: Literal["province", "city"]
    lng: Optional[float] = None
    lat: Optional[float] = None
    provinceAdcode: Optional[str] = None
    cityId: Optional[str] = Field(
        default=None, description="null = 待收录（≠ 0）：前端据此判断能不能下钻到点位"
    )
    poiCount: Optional[int] = Field(
        default=None, ge=0, description="已收录景点数；null = 未收录，不要当 0 用"
    )


class SearchPoi(BaseModel):
    """一条景点（只有"够用来找 + 够用来飞过去"的字段）"""

    id: str
    name: str
    cityId: str
    cityName: str
    lng: float
    lat: float
    subtype: SubType
    tags: list[str] = Field(default_factory=list)
    cover: str | None = Field(
        default=None,
        description=(
            "结果列表里的缩略图 —— 该点位第一张图的**原始**地址"
            "（镜像由前端出口统一做，别在这里写镜像地址）"
        ),
    )


class SearchIndex(BaseModel):
    version: int = 1
    generatedAt: str
    regions: list[SearchRegion]
    pois: list[SearchPoi] = Field(
        description="按热度降序 —— 分数相同时前端沿用文件顺序，故不必再存 popularity"
    )


# ══════════════════════════════════════════════════════════════════
# 六、行程（只存 localStorage，不参与 data/ 产出）
# ══════════════════════════════════════════════════════════════════


class Stay(BaseModel):
    id: str
    name: str
    lng: float = Field(ge=73, le=136)
    lat: float = Field(ge=3, le=54)
    source: Literal["poi", "geocoded", "picked"]
    ref: Optional[dict[str, Optional[str]]] = None
    fromDay: int = Field(ge=1)
    toDay: int = Field(ge=1)


class DayItem(BaseModel):
    uid: str
    poiId: str
    dwellMinutes: int = Field(ge=5)
    modeToNext: Optional[TravelMode] = None
    note: Optional[str] = None
    # ── 这一站自己带着坐标（2026-09-25 加，见 plans/13 §3.2）──
    # 全部可选 ⇒ 老数据（只有 poiId）依然合法。
    # ★ 坐标冗余存一份的理由：自由取点没有 poiId；画点不该为了一个坐标去读城市数据；
    #   城市数据重建后 poiId 变化会让"只存 poiId"的行程静默丢点。
    kind: Optional[Literal["poi", "point"]] = None  # 缺省视为 poi
    name: Optional[str] = None
    lng: Optional[float] = Field(default=None, ge=73, le=136)
    lat: Optional[float] = Field(default=None, ge=3, le=54)
    cityId: Optional[str] = None


class ItineraryDay(BaseModel):
    stayId: str
    startTime: str = Field(pattern=r"^\d{2}:\d{2}$")
    items: list[DayItem] = Field(default_factory=list)


class ItineraryExport(BaseModel):
    v: Literal[1] = 1
    cityId: str
    stays: list[Stay]
    days: list[ItineraryDay]
    exportedAt: str


# ── 路线规划记录（plans/13）──────────────────────────────────


class MapPoint(BaseModel):
    """折线上的一个坐标。

    ★ 刻意不复用 `GeoPoint`：那个带 coordSystem 字面量（对数据文件是必要的自证），
      对一条 500~2000 点的折线就是纯浪费。折线坐标必然来自腾讯接口，就是 GCJ-02。
    """

    lng: float = Field(ge=73, le=136)
    lat: float = Field(ge=3, le=54)


class PlanLeg(BaseModel):
    fromUid: str
    toUid: str
    distance: float
    duration: float
    path: list[MapPoint] = Field(default_factory=list)


class PlanRoute(BaseModel):
    """已经算好的一条整条路线（落盘缓存）。

    ★ 只落"不会变的东西"：几何 + 耗时。实时路况不落盘（十分钟就过期），
      所以必须有 at（计算时刻），UI 要显示它并给「重新规划」。
    """

    at: float
    path: list[MapPoint] = Field(default_factory=list)
    distance: float
    duration: float
    taxiFare: Optional[float] = None
    legs: Optional[list[PlanLeg]] = None
    note: Optional[str] = None


class RoutePlan(BaseModel):
    """一份规划记录 = 一份行程（plans/13 §3.4）。

    ★ 没有 stops 字段（与 plans/13 §3.2 初稿不同）：途经点序列由 days[].items
      按天序摊平得到，不另存一份 —— 存两份就要在每次换序时同步两处。
    """

    id: str
    name: str
    cityId: str
    createdAt: float
    updatedAt: float
    mode: TravelMode
    # 逐段选中的备选方案（DayItem.uid → 'A'|'B'|'C'）。
    # ★ 这是用户意图不是结果：备选随时能重拉，但"我选的是 B"丢了就是丢了。
    chosenOption: dict[str, str] = Field(default_factory=dict)
    stays: list[Stay] = Field(default_factory=list)
    days: list[ItineraryDay] = Field(default_factory=list)
    route: Optional[PlanRoute] = None
