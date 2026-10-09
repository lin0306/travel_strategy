"""
pipeline/core/layout.py —— data/ 目录布局的**单一真源**

★ 为什么要有这个文件：
  目录结构一旦散落在各个脚本里用字符串拼，改布局时必然漏改一处，
  而 vite 的 `import.meta.glob` **写错不报错、只静默匹配 0 个文件**（页面进空态），
  排查成本极高。所以：路径怎么拼，只有这一个地方说了算，脚本与前端契约都引用它。

★ 2026-09-21 起，本文件属于**仓库根的 `pipeline/`**（不再是 `web/scripts/harvest/`）：
  抓取只做抓取，展示只做展示。`data/` 是两者唯一的交接面 —— 抓取只往里写，
  展示只从里读，谁都不 import 对方。

目录布局（用户要求：按省市单独建文件夹，景点按大类也单独建）：

    data/
    ├─ cities.index.json                    脚本生成
    ├─ cities/
    │  └─ {province_slug}/                  省（拼音，如 sichuan）
    │     ├─ _province.json                 省元信息（名称/adcode）
    │     └─ {city_id}/                     市（英文 id，如 chengdu）
    │        ├─ city.json                   ★ 城市主数据（人写，唯一真源）
    │        ├─ pois/
    │        │  ├─ scenic/{poiId}.json      ★ 一个大类一个文件夹
    │        │  ├─ food/{poiId}.json
    │        │  ├─ hotspot/{poiId}.json
    │        │  └─ culture/{poiId}.json
    │        └─ transit.json                通勤矩阵（脚本生成，派生数据）
    ├─ credits/{province_slug}/{city_id}.md
    └─ _generated/                          全部脚本生成

为什么 city.json 与 pois/ 分开：
  单个大城市 JSON 会超过 400 行，AI 每次读文件整篇进上下文（本项目有 ~420 行/文件约定）。
  分片后每个 POI 是一个 60 行左右的小文件，改一个点位只产生一个文件的 diff，PR 能看清。

为什么 transit.json 独立：
  它是**派生数据**（由坐标算出来），不是人写的。和 POI 混在一起会让人误以为可以手动改，
  也会让"改一个 POI 文案"的 PR 带上几千字符的矩阵噪声。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterator

# ★ 本文件在 `pipeline/core/layout.py`，所以往上两级才是流水线根（不是一级 ——
#   2026-10-07 分层时踩过：写成 parents[1] 会把 REPO 指到 pipeline/ 上，所有 data 路径全错，
#   而且**不会报错**、只在运行时表现为"文件不存在"）。
PIPELINE = Path(__file__).resolve().parents[1]   # 采集流水线根：pipeline/
REPO = PIPELINE.parent                # 仓库根：data/ 与 schema/ 在这一层
WEB = REPO / "web"                             # 展示工程根（只读 `.env`；抓取不写它）
DATA = REPO / "data"
CITIES = DATA / "cities"
CREDITS = DATA / "credits"
GENERATED = DATA / "_generated"
DISTRICTS = GENERATED / "districts"
#: 一座城市的**区列表**分片（`{市adcode}.json`）。区级数据按市拆开，
#: 是为了不让 5000 个区把 `district-tree.json` 撑到几百 KB —— 只有走进某座城才读它那份。
SUBDISTRICTS = GENERATED / "subdistricts"
#: **省级单位「自身」的轮廓**分片（`{省adcode}.geo.json`）。
#: ★ 为什么单独一份：腾讯拿不到"省自身"的轮廓（`getchildren?id=<省>` 返的是它下辖的**市**），
#:   所以这一份来自高德 `config/district?subdistrict=0&extensions=all`（持牌图商，同为 GCJ-02
#:   ⇒ **不做坐标转换**）。前端 `loadBoundsForLevel('province')` **优先读它**，
#:   读不到才退回"用各市拼"（那会把省内市界也描出来）。
PROVINCES = GENERATED / "provinces"
#: **每个市「自身」的轮廓**，按省打包（`{省adcode}.geo.json`，key = 市 adcode）。
#: ★ 与 `districts/<省adcode>.geo.json`（腾讯版）**同形** —— 前端只是多一层"优先读它"。
#: 为什么要它：腾讯那份只对"已收录城市所在的省"生成过（实测只有 20/34 份）⇒
#: 放大到市这一级时半个国家没有面；而且腾讯给的是各自独立抽稀的粗轮廓
#: （点距几公里，在 z≈9.5 是几十像素的折角）。高德给的是该市自身的全精度轮廓。
CITY_BOUNDS = GENERATED / "cities"
#: **每个区「自身」的轮廓**，按市打包（`{市adcode}.geo.json`，key = 区 adcode）。
#: ★★ 为什么要它（2026-10-02 用户：「这个区的轮廓，怎么方方正正的，这轮廓数据不对吧」）：
#:   区这一级的"面"原来只有腾讯那份 `districts/<市adcode>.geo.json`，而腾讯给下辖区的
#:   是**极度抽稀**的轮廓 —— 实测北京 16 个区里 4 个只有 **4 个点**（一个矩形），
#:   西安莲湖区 **5 个点**、雁塔区 15 个点。放大到 z≥9.5 之后就是"方块"，一眼假。
#:   高德 `config/district?subdistrict=0&extensions=all` 给的是该区**自身**的全精度轮廓
#:   （莲湖区 556 点、雁塔区 1042 点），与省/市两级同一个接口、同为 GCJ-02 ⇒ 零坐标转换。
#: ★ **文件名 = 该区所属的"市文件键"**：普通市就是市码（`610100`），
#:   直辖市/特区没有中间市层，键是**省码**（`110000`）—— 与 `districts/` 那份一致。
#: ★ 前端 `loadDistrictFaces()` **优先读它、逐区缺了退回腾讯**（不是整份二选一），
#:   所以只抓到一半也有用。见 `web/app/common/data/bounds.ts`。
DISTRICT_OWN = GENERATED / "districts-own"
CACHE = PIPELINE / ".cache"                    # 采集缓存，不进仓库

#: 大类 → 目录名。★ 顺序即前端遍历顺序
CATEGORY_DIRS: dict[str, str] = {
    "scenic": "scenic",
    "food": "food",
    "hotspot": "hotspot",
    "culture": "culture",
}

#: 每城的目标 POI 规模（02 文档第二节：景点 15 / 美食 15 / 网红 10 / 特色 6）
POI_QUOTA: dict[str, int] = {"scenic": 15, "food": 15, "hotspot": 10, "culture": 6}


# ── 省份 slug ─────────────────────────────────────────────────────
#: 34 个省级单位 → 目录名。**省经理 Table 手写**，不引入拼音库依赖。
#: ⚠️ 必须覆盖全部 34 个省级单位（含中国台湾 / 中国香港 / 中国澳门），缺一个下钻就少一块。
PROVINCE_SLUGS: dict[str, str] = {
    "北京": "beijing", "天津": "tianjin", "河北": "hebei", "山西": "shanxi",
    "内蒙古": "neimenggu", "辽宁": "liaoning", "吉林": "jilin", "黑龙江": "heilongjiang",
    "上海": "shanghai", "江苏": "jiangsu", "浙江": "zhejiang", "安徽": "anhui",
    "福建": "fujian", "江西": "jiangxi", "山东": "shandong", "河南": "henan",
    "湖北": "hubei", "湖南": "hunan", "广东": "guangdong", "广西": "guangxi",
    "海南": "hainan", "重庆": "chongqing", "四川": "sichuan", "贵州": "guizhou",
    "云南": "yunnan", "西藏": "xizang", "陕西": "shaanxi", "甘肃": "gansu",
    "青海": "qinghai", "宁夏": "ningxia", "新疆": "xinjiang",
    "台湾": "taiwan", "香港": "xianggang", "澳门": "aomen",
}

#: 反向：slug → 省名
SLUG_PROVINCES: dict[str, str] = {v: k for k, v in PROVINCE_SLUGS.items()}


def province_slug(province_name: str) -> str:
    """省名 → 目录名。省名可能带"省/市/自治区"后缀，先剥掉再查表。"""
    core = province_name
    for suffix in ("特别行政区", "壮族自治区", "回族自治区", "维吾尔自治区", "自治区", "省", "市"):
        if core.endswith(suffix) and len(core) > len(suffix):
            core = core[: -len(suffix)]
            break
    if core in PROVINCE_SLUGS:
        return PROVINCE_SLUGS[core]
    raise KeyError(
        f"未知省份「{province_name}」（剥后缀后为「{core}」）—— "
        f"请把它加进 layout.PROVINCE_SLUGS。34 个省级单位一个都不能少"
    )


# ── 路径构造 ──────────────────────────────────────────────────────

def province_dir(slug: str) -> Path:
    return CITIES / slug


def province_meta_path(slug: str) -> Path:
    return province_dir(slug) / "_province.json"


def city_dir(slug: str, city_id: str) -> Path:
    return province_dir(slug) / city_id


def city_json_path(slug: str, city_id: str) -> Path:
    return city_dir(slug, city_id) / "city.json"


def pois_root(slug: str, city_id: str) -> Path:
    return city_dir(slug, city_id) / "pois"


def poi_dir(slug: str, city_id: str, category: str) -> Path:
    """某个大类的 POI 文件夹。category 非法时抛错 —— 静默建出野目录很难查。"""
    if category not in CATEGORY_DIRS:
        raise KeyError(f"未知大类「{category}」，合法值：{sorted(CATEGORY_DIRS)}")
    return pois_root(slug, city_id) / CATEGORY_DIRS[category]


def poi_json_path(slug: str, city_id: str, category: str, poi_id: str) -> Path:
    return poi_dir(slug, city_id, category) / f"{poi_id}.json"


def transit_json_path(slug: str, city_id: str) -> Path:
    return city_dir(slug, city_id) / "transit.json"


def credits_md_path(slug: str, city_id: str) -> Path:
    return CREDITS / slug / f"{city_id}.md"


# ── 遍历 ──────────────────────────────────────────────────────────

def iter_city_dirs() -> Iterator[tuple[str, str, Path]]:
    """遍历所有城市目录 → (省 slug, 城市 id, 城市目录)。

    约定：`cities/{slug}/{city_id}/city.json`。不以 `_` 开头的目录才算省。
    """
    if not CITIES.exists():
        return
    for prov in sorted(CITIES.iterdir()):
        if not prov.is_dir() or prov.name.startswith("_"):
            continue
        for city in sorted(prov.iterdir()):
            if not city.is_dir() or city.name.startswith("_"):
                continue
            if not (city / "city.json").exists():
                continue
            yield prov.name, city.name, city


def iter_poi_files(slug: str, city_id: str) -> Iterator[tuple[str, Path]]:
    """遍历某城的 POI 文件 → (大类, 文件路径)。按大类目录顺序输出。"""
    root = pois_root(slug, city_id)
    if not root.exists():
        return
    for cat in CATEGORY_DIRS.values():
        d = root / cat
        if not d.is_dir():
            continue
        for f in sorted(d.glob("*.json")):
            yield cat, f


def count_city_pois(slug: str, city_id: str) -> int:
    """某城已落盘的 POI 数（四个大类文件夹合计）。"""
    return sum(1 for _ in iter_poi_files(slug, city_id))


def read_city_json(slug: str, city_id: str) -> dict:
    """读某城的 city.json（城市主数据）。"""
    return read_json(city_json_path(slug, city_id))


def ensure_city_tree(slug: str, city_id: str) -> Path:
    """建好城市目录骨架（含四个 POI 子文件夹），幂等。"""
    cdir = city_dir(slug, city_id)
    (cdir / "pois").mkdir(parents=True, exist_ok=True)
    for cat in CATEGORY_DIRS.values():
        (cdir / "pois" / cat).mkdir(parents=True, exist_ok=True)
    return cdir


# ── 读写小工具 ────────────────────────────────────────────────────

def read_json(path: Path) -> dict:
    """读 JSON。文件不存在返回空 dict —— 采集脚本里"还没生成"是常态，不该炸。"""
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, obj: object, *, compact: bool = False) -> None:
    """写 JSON。★ 统一 2 空格缩进 + UTF-8 + LF —— 为了让 PR diff 人能读，这与纯文本化是同一条原则。

    `compact=True` 用于**纯机器消费**的大文件（如 district-tree.json）：
    它有几千个结构相同的条目，2 空格缩进能让它膨胀到 117KB（设计约束是 <50KB）。
    这类文件没人做 diff，紧凑写出即可（约 1/3 体积）。
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(
        obj, ensure_ascii=False, indent=None if compact else 2,
        separators=(",", ":") if compact else None,
    )
    # newline='\n' 避免 Windows 上写出 CRLF，让 checkout 的人看到一堆整文件 diff
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)
        fh.write("\n")
