"""
pipeline/authoring/images.py —— 图片三级降级（04 文档第四节）

★ 铁律：**全部外链，零文件**。仓库里只有 URL 字符串，绝不下载、绝不存二进制。

图源优先级（★ 按"这张图**是不是这个地方**"排序 —— 攻略站的第一要求，
不是按许可宽松度或响应速度）：
    1 Wikimedia —— 需署名，但**精确 + 可溯源**：alt 直接是 Commons 文件名，
                   用户点开 credit 就能验证。实测抽样 11 个真实点位，8/11 命中。
    2 Pexels    —— Pexels License，允许热链 + **免署名**。实测 8/11。
    3 Unsplash  —— Unsplash License 最宽松，但对中国 POI **实测 0/11**：
                   它的语义搜索命中不到就返回"沾边"的图（搜「洪崖洞」返回砂岩石柱、
                   搜「糖粥」返回塑料碗）。拿这种图当点位封面是**误导**，
                   违反红线 9 的溯源要求 —— 所以只作最后补充，不参与首选。
                   （纯英文风景类查询它仍然出色，只是不适合本项目。）

✗ 百度百科 —— 已彻底移除，两个理由，任一都足以否决：
    ① **Referer 防盗链**。`bkimg.cdn.bcebos.com` 只放行百度自己的域名：不带 Referer
       返回 200，但只要站点域名不是百度（含 localhost、线上域名）一律 **403**。
       实测矩阵：Referer=None→200 / localhost→403 / example.com→403 / netlify.app→403。
       也就是说这 806 张图**在自家站上必然全军覆没**，不是偶发。
    ② **违反红线 7「只用开放许可」**。百科图片多为网友上传，版权归属不清，
       credit 只能写"版权归原作者所有" —— 这恰恰说明我们没有授权。
    （注：`seedlib.baike()` 生成的是**文字资料的溯源链接**，不是图片热链，保留。）

★ 每张图必须带 `query` —— 这是「月度巡检自愈」的前提：
图挂了，巡检脚本用它自动重搜一张新的（04 文档第九节）。**没有 query 的图不许入库**。
"""

from __future__ import annotations

import html
import json
import os
import re
from typing import Any

from pipeline.authoring.image_filter import verdict_for
from pipeline.core.env import is_placeholder, load_env
from pipeline.core.fetch import build_url, get_bytes, get_json

UNSPLASH_SEARCH = "https://api.unsplash.com/search/photos"
PEXELS_SEARCH = "https://api.pexels.com/v1/search"
WIKIMEDIA_API = "https://commons.wikimedia.org/w/api.php"

#: ★ 境外图源主机黑名单（国内不可达）。当前为空 —— **Wikimedia 仍是可用的图源**，
#:   但"可用"要拆成两件事看，2026-09-22 实测（IPv4 / IPv6 各三次，国内网络）：
#:
#:   | 域名                        | 结果              | 结论           |
#:   |---------------------------|-------------------|----------------|
#:   | commons.wikimedia.org（API） | 200 · 3.1s        | 搜索可用 ✅     |
#:   | upload.wikimedia.org（原图） | **000 · 15s 超时** | 取不到图 ❌     |
#:   | thumb.wikimedia.org（缩略图）| **000 · 15s 超时** | 取不到图 ❌     |
#:
#:   即 **搜得到、取不到**。所以：
#:   1. 本模块继续用 Wikimedia 搜索 —— 它仍是许可最清晰、中文点位覆盖最好的源；
#:   2. 写入数据的仍是**原始地址**（可溯源），**不做镜像**；
#:   3. 国内可访问由**前端统一出口**解决：`web/app/common/data/imageMirror.ts`，
#:      那里把 upload/thumb 域名的图改写成 wsrv.nl 镜像后交给 `<img>`。
#:
#: ⚠️ 别把"API 通"外推成"图片也能取" —— 2026-09-20 那次复测就是只打了 API 域名
#:    就推翻了封锁结论，结果 643 张图上线全是空白。**测图源要测图片 URL 本身。**
BLOCKED_HOSTS: tuple[str, ...] = ()


def _unsplash_headers() -> dict[str, str] | None:
    # ★ 先加载 pipeline/.env.local —— 否则终端里跑脚本永远读不到（Vite 的注入只作用于前端产物）
    load_env()
    key = os.environ.get("UNSPLASH_ACCESS_KEY", "").strip()
    if is_placeholder(key):
        return None
    return {"Authorization": f"Client-ID {key}"}


def _pexels_headers() -> dict[str, str] | None:
    load_env()
    key = os.environ.get("PEXELS_API_KEY", "").strip()
    if is_placeholder(key):
        return None
    return {"Authorization": key}


def _is_blocked(url: str) -> bool:
    return any(h in url for h in BLOCKED_HOSTS)


def search_unsplash(query_en: str, per_page: int = 6) -> list[dict]:
    hdrs = _unsplash_headers()
    if hdrs is None:
        return []                                    # 没 key 就静默降级到下一级，不报错
    try:
        data = get_json(build_url(UNSPLASH_SEARCH, {
            "query": query_en, "per_page": per_page,
        }), headers=hdrs)
    except Exception:
        return []

    out: list[dict] = []
    for p in data.get("results", []):
        urls = p.get("urls") or {}
        full = urls.get("regular")                   # ≈1080px
        if not full or _is_blocked(full):
            continue
        out.append(_image_item(
            url=full,
            thumb=urls.get("small"),                 # ≈400px
            width=p.get("width", 1080),
            height=p.get("height", 720),
            alt=p.get("alt_description") or query_en,
            query=query_en,
            source="unsplash",
            author=(p.get("user") or {}).get("name", "Unsplash 摄影师"),
            sourceUrl=(p.get("links") or {}).get("html", "https://unsplash.com/"),
            license="Unsplash License",
            attribution_required=False,
        ))
    return out


def search_pexels(query: str, per_page: int = 6) -> list[dict]:
    hdrs = _pexels_headers()
    if hdrs is None:
        return []
    try:
        data = get_json(build_url(PEXELS_SEARCH, {
            "query": query, "per_page": per_page,
        }), headers=hdrs)
    except Exception:
        return []

    out: list[dict] = []
    for p in data.get("photos", []):
        src = p.get("src") or {}
        full = src.get("large2x") or src.get("large")
        if not full or _is_blocked(full):
            continue
        out.append(_image_item(
            url=full,
            thumb=src.get("medium"),
            width=p.get("width", 1080),
            height=p.get("height", 720),
            alt=p.get("alt") or query,
            query=query,
            source="pexels",
            author=p.get("photographer", "Pexels 摄影师"),
            sourceUrl=p.get("url", "https://www.pexels.com/"),
            license="Pexels License",
            attribution_required=False,
        ))
    return out


#: Wikimedia 的许可字段是自由文本，取值很杂："CC BY-SA 4.0" / "CC0 1.0" /
#: "Public domain" / "PD-old-70" / "Copyrighted free use" ...
#: ★ 只收**真·自由许可**（红线 7）。"Copyrighted free use""Fair use" 看着像能用，
#:   实际是"保留版权但容忍某些用途"，搬来本站就是侵权 —— 宁可少一张图。
FREE_LICENSE = re.compile(
    r"^\s*(cc0|cc-by|cc by|cc-pd|cc pd|public domain|pd-|no restrictions)", re.I
)

#: ★ 只接受这几种**照片位图**。SVG 多为图标地图、TIFF / DjVu 多为扫描件，都不要。
PHOTO_MIME = frozenset({"image/jpeg", "image/png", "image/webp"})

#: 非商用（NC）是致命的一条：只要沾上，整个站点就不能商用。单独否决。
NC_LICENSE = re.compile(r"\bnc\b|non-?commercial", re.I)

_CJK = re.compile(r"[\u3400-\u9fff\uf900-\ufaff]")


_CORE = re.compile(r"[（(\[【]")


def _core_name(name: str) -> str:
    """剥掉店名里的分店 / 州区后缀：「松鹤楼(观前街店)」→「松鹤楼」。

    ★ Commons 上不会有「松鹤楼(观前街店)」这种文件名，但**可能收录了该字号本身** ——
      实测「得月楼(观前街店)」原名 0 张，剥离后拿到 2 张。
      反过来这也是风险：裸核心名会撞到同名异地（见 pick_images 里"以城市限定"的处理）。
    """
    return _CORE.split(name or "", 1)[0].strip() or (name or "").strip()


def _is_latin(s: str) -> bool:
    """是不是"不含中文"的关键词 —— Pexels / Unsplash 的准入门槛。

    只判有没有汉字，不查是不是合法英文：**统称语文近年来也会有 XxxxBank 之类写法**，
    宁可放行也别误杀。
    """
    s = (s or "").strip()
    return bool(s) and not _CJK.search(s)


_TAG1 = re.compile(r"<[^>]+>")


def _plain(value: str) -> str:
    """Commons 的 extmetadata 全是 HTML 片段（`Artist` 常带 `<a href>`）—— 去标签还原纯文本。"""
    return " ".join(html.unescape(_TAG1.sub("", value or "")).split())


def _license_ok(name: str) -> bool:
    """许可白名单。**拿不到许可信息就当不可用** —— 未知许可不等于免费。"""
    n = (name or "").strip()
    if not n or NC_LICENSE.search(n):
        return False
    return bool(FREE_LICENSE.match(n))


def _needs_attribution(name: str) -> bool:
    """是否需要可见署名。CC0 / 公有领域不需要；其余（CC BY / BY-SA 等）一律要。"""
    n = (name or "").strip().lower()
    if n.startswith(("cc0", "public domain", "pd-", "cc-pd", "cc pd", "no restrictions")):
        return False
    return True                                  # 拿不准就署上，多署名不会错


def search_wikimedia(keyword: str, per_page: int = 8) -> list[dict]:
    """Wikimedia Commons —— 无需 key、无配额上限的开放式兜底图源。

    ★ 一次请求拿齐：用 `generator=search` 在 File 命名空间（ns=6）里搜 `imageinfo`，
      URL / 许可 / 作者 / 文件页都在一起，不必再解析 HTML。
    ★ **必须过滤非图片**：File 命名空间里混着 PDF / ogg / webm，且常被排在前面 ——
      实测搜「苏州 面馆」第一个命中是《苏州胜浦方言字音表.pdf》。
      SVG 虽属 `image/*`，但大多是图标和地图，也不是景点照。
    ★ 全部默认带 `query`，图挂了月度巡检能自动重找（04 文档第九节）。
    """
    kw = (keyword or "").strip()
    if not kw:
        return []

    try:
        data = get_json(build_url(WIKIMEDIA_API, {
            "action": "query", "format": "json",
            "generator": "search",
            "gsrsearch": kw,
            "gsrnamespace": 6,                   # File:
            "gsrlimit": max(per_page * 3, 20),   # 多取几个：过滤后所剩不多
            # ★ `categories` 是**人工维护**的，比标题可靠：地铁站照片标题可能只写
            #   「青龙寺」，但分类一定是 "Xi'an Metro stations" —— 过滤靠它抓。
            "prop": "imageinfo|categories",
            "cllimit": 200,
            "iiprop": "url|extmetadata|mime|size",
            "iiurlwidth": 1080,                  # 缩到 1080px，别把原图流量打满
        }), timeout=20.0)
    except Exception:
        # ★ Wikimedia 偶发断连（RemoteDisconnected / HTTPException 等）不应让整脚本崩溃，
        #   降级到 Pexels / Unsplash 兜底即可（图挂了月度巡检还能自动重找）。
        return []

    out: list[dict] = []
    pages = ((data.get("query") or {}).get("pages") or {})
    for page in pages.values():
        info = (page.get("imageinfo") or [{}])[0]
        meta = info.get("extmetadata") or {}

        # ★ mime 必须**精确白名单**，不能写 `startswith("image/")`：
        #   DjVu 是 `image/vnd.djvu` —— 前缀检查会放它过关。实测搜「苏州 面馆」时，
        #   CDAL 上传的古籍扫描件（《蘇州中學行政總則》《唯自勉齋長物志》）正好命中
        #   "苏州"二字，排在最前面。**引申开了说：凡是前缀匹配，都要先问它会漏进什么。**
        if info.get("mime") not in PHOTO_MIME:
            continue
        full = info.get("thumburl") or info.get("url")
        if not full or _is_blocked(full):
            continue

        license_name = (meta.get("LicenseShortName") or {}).get("value", "")
        if not _license_ok(license_name):
            continue

        author = _plain((meta.get("Artist") or {}).get("value", "")) or "Wikimedia Commons 贡献者"
        page_url = (
            (meta.get("Descriptionurl") or {}).get("value")
            or info.get("descriptionurl")
            or "https://commons.wikimedia.org/"
        )
        title = _plain(page.get("title", "")).removeprefix("File:").removeprefix("文件:")

        out.append(_image_item(
            url=full,
            thumb=info.get("thumburl") or info.get("url"),
            width=int(info.get("thumbwidth") or info.get("width") or 1080),
            height=int(info.get("thumbheight") or info.get("height") or 720),
            alt=title[:100] or f"{kw}（Wikimedia Commons）",
            query=kw,
            source="wikimedia",
            author=author[:60],
            sourceUrl=page_url,
            license=license_name or "见来源页",
            attribution_required=_needs_attribution(license_name),   # CC BY / BY-SA 必须署
            # ★★ 只给过滤用的**私有字段**：GPS 与分类不进最终数据（schema 里没有），
            #   `pick_images` 判完会 `pop` 掉。带上它，复核那一层才有"第三方证据"可看。
            filter_meta={
                "gps": meta,                     # 原始 extmetadata，GPS 在 verdict_for 里取
                "categories": " ".join(
                    _plain(c.get("title", "")).removeprefix("Category:")
                    for c in (page.get("categories") or [])
                ),
            },
        ))
        if len(out) >= per_page:
            break
    return out


def _image_item(
    *, url: str, thumb: str | None, width: int, height: int, alt: str, query: str,
    source: str, author: str, sourceUrl: str, license: str, attribution_required: bool,
    filter_meta: dict | None = None,
) -> dict:
    item = {
        "url": url,
        "thumbUrl": thumb,
        "width": int(width),
        "height": int(height),
        "alt": alt[:120],
        "query": query,                              # ★ 自愈关键字段
        "credit": {
            "source": source,
            "author": author,
            "sourceUrl": sourceUrl,
            "license": license,
            "attributionRequired": attribution_required,
        },
    }
    if filter_meta:
        item["_filterMeta"] = filter_meta
    return item


def pick_images(
    poi: dict, *, max_keep: int = 6, city: str = "", exclude_urls: frozenset[str] = frozenset(),
) -> list[dict]:
    """为单个 POI 取图，三级降级。

    `city` / `city_slug` 用来把查询**限定在本市**：
      · 精确图用中文城市名后缀，避免同名异地（苏州「得月楼」会撞丽江黑龙潭「得月楼」）
      · 氛围图用英文 slug 后缀 —— 实测「Chinese noodles Suzhou」直接命中苏州中心面馆，
        而不加限定会返回新奥尔良的中餐厅。

    ★ 数量**不固定三张**（2026-10-29 改）：`max_keep` 是上限不是目标，
      有几张合格就收几张（1 张也行、0 张就走占位卡）。原来固定 3 张，
      全库 4297/4808 个点位**恰好 3 张**——那是把"能搜到多少"裁成了"页面要几张"。

    ★★ 2026-10-29 起，入库前先过 `image_filter.verdict_for()`：
      地铁站 / 地图 / 路牌 / 坐标 10km 外 一律 reject（西安青龙寺那三张里，
      地铁站的标题同时含「青龙寺」「西安」，文字检索排第一 —— 只有这层能拦住它）。
      过滤只挡得住"说得明白的错"，挡不住"标题对、画面错"—— 那一类靠**复核**
      （`run.py review-images`，二次审查的必经关卡）。

    ★★ Pexels / Unsplash **只接受拉丁文关键词**。这一条是血泪换来的：
      数据里 328 个 POI 只有 46 个写了英文 qEn，其余 `en` 是空串；早期版本
      `en_query = q.get("en") or name` 会静默退回**中文名**，然后拿中文去查 Pexels ——
      它的语义搜索对中文基本失效，返回的是完全漂移的结果：
          松鹤楼(观前街店)  → Buddha Tooth Relic Temple（新加坡佛牙寺）
          镇湖苏绣街区      → Harbin Central Avenue（哈尔滨中央大街）
          琼琳阁面庄        → 螺旋书架（同一张图还同时充当了书店的封面）
      这类图看着"有图"，实际是**把别的城市的照片挂在这个点位名下**，比没有图更糟。
      → 拿不到英文就用 `_is_latin()` 卡住，宁可退到品类氛围图（alt 如实写成品类）。

    ★ 顺序 Wikimedia → Pexels → Unsplash 由实测决定（详见文件头）：
      11 个真实点位抽样，精确命中率 Wikimedia 8/11、Pexels 8/11、**Unsplash 0/11**。

    降级顺序（04 文档 4.2）：
        ① 精确图  Wikimedia Commons（核心名+城市 → 中文描述 → 全称）
        ② 实景图  Pexels → Unsplash（**仅当**有真英文关键词）
        ③ 还是没有 → 返回空，前端渲染**风格化 SVG 占位卡**（零外部请求）

    ★ ③ 原来是"品类氛围图兜底"（本地小店垫一张同类图），2026-10-29 **按用户要求删除**：
      垫图的结果就是"看着有图、实际是别的地方"，比没有图更糟 —— 没实景就走占位卡。
    """
    q = poi.get("_imageQuery") or {}
    name = poi.get("name", "")
    en_query = q.get("en") or ""                 # ★ 不再用 `or name` 兜底
    zh_query = q.get("zh") or name
    core = _core_name(name)

    candidates: list[dict] = []

    # ① Wikimedia 精确图。★ 带城市的排前面 —— 同名异地比"取不到图"更难发现：
    #   搜「得月楼」会命中丽江黑龙潭的得月楼，挂到苏州这家店名下就是错的。
    queries: list[str] = []
    if city:
        queries += [f"{core} {city}", f"{zh_query} {city}"]
    queries += [zh_query, core, name]
    # ★ 英文名也要喂 Wikimedia（2026-09-27 天津那批暴露的）：
    #   `en` 原先**只**在 ② 里用，而 Pexels / Unsplash 都要 key —— 没配 key 时
    #   （当前就是这个状态）它等于完全闲置，中文名在 Commons 里没词条的 POI 就永远取不到图。
    #   实测「Tianjin Eye」「Binhai Library Tianjin」这类英文词 Commons 命中率很高。
    #   排在中文之后 —— 中文精确命中优先，英文只在中文本土搜不到时补位。
    if en_query:
        queries += [f"{en_query} {city}" if city else en_query, en_query]
    for kw in dict.fromkeys(k for k in queries if k):   # 去重保序
        if len(candidates) >= max_keep:
            break
        candidates += search_wikimedia(kw)

    # ② Pexels / Unsplash：**停用**（理由见 `USE_STOCK_SOURCES`）
    if USE_STOCK_SOURCES and _is_latin(en_query):
        for search in (search_pexels, search_unsplash):
            if len(candidates) >= max_keep:
                break
            candidates += search(en_query)

    # ③ 相关性过滤 + 排序（★ 入库前这道关卡）
    scored: list[tuple[int, int, dict]] = []          # (score, 原始顺序, 图)
    suspects: list[tuple[int, int, dict]] = []        # 元数据无正面信号 → 排后面，不当封面
    for order, img in enumerate(candidates):
        verdict, _reason, score = verdict_for(img, poi, city=city)
        if verdict == "reject":
            continue                                   # 明确错的，不许入库
        img.pop("_filterMeta", None)                   # ★ 私有字段不进数据
        (scored if verdict == "ok" else suspects).append((score, order, img))

    # 先按分数高低，再按图源给的原始顺序（同分稳住）
    ordered = sorted(scored, key=lambda t: (-t[0], t[1])) + sorted(suspects, key=lambda t: (-t[0], t[1]))

    # 去重（同一 URL 只留一次 + ★ 不许与本城其他点位撞图）
    picked: list[dict] = []
    seen: set[str] = set(exclude_urls)
    for _s, _o, img in ordered:
        if img["url"] in seen:
            continue
        seen.add(img["url"])
        picked.append(img)
        if len(picked) >= max_keep:
            break
    return picked


#: ★★ 配图库（Pexels / Unsplash）**停用**（2026-10-30，西安 + 长春两轮审查实测后）。
#:
#:   它们是**主题配图库，不是地点图库**：搜「Changchun Ice and Snow World」只会得到
#:   一张泛用的冰城堡，搜「Nong'an Liao Pagoda」得到的是**上海**的古塔 ——
#:   画面和点位毫无关系，正是用户 2026-10-28 指出的那类错图（青龙寺挂着地铁站照片）。
#:
#:   更难办的是它们**没有任何地点元数据**（无 GPS、无 Commons 分类），
#:   `verdict_for` 对这类图基本只能靠标题黑名单碰运气 —— 过滤器拦不住。
#:   长春首审 57 张封面里 33 张是错的，两个配图库贡献的几乎全错。
#:
#: ★ 用户定的原则：**没实景就走占位卡，绝不垫一张别的地方的图**。
#:   这条与 2026-10-29 删掉「品类氛围图兜底」是同一条 —— 那次删的是"用同类图垫"，
#:   这次停的是"用配图库的泛用图垫"。
USE_STOCK_SOURCES = False


def configured_sources() -> list[str]:
    """当前环境实际**启用**的图源，**按优先级排列**（不是字母序）。"""
    avail = ["wikimedia"]                        # 无需 key，永远可用；精确命中率最高
    if not USE_STOCK_SOURCES:
        return avail                             # ★ 配了 key 也不启用，理由见常量注释
    if _pexels_headers():
        avail.append("pexels")
    if _unsplash_headers():
        avail.append("unsplash")
    return avail


def _dump(obj: Any) -> str:                          # 调试用
    return json.dumps(obj, ensure_ascii=False, indent=2)
