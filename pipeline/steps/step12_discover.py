#!/usr/bin/env python3
"""
pipeline/steps/step12_discover.py —— **点位发现**：按类目搜图商，找出一座城市里
"库还没有的景点"，落成**候选清单**待人审。

## 它做什么、为什么不直接入库
按类目关键字（古镇/博物馆/祠堂/…）+ 城市名调 `place_search`，把结果与
`seeds/{city}.py` 里已有的 POI 名做去重，**新点位写进候选清单**，
**绝不直接写进正式库**。

★ 为什么不自动入库（这是本脚本最重要的设计决定）：
  实测（2026-10-08黟县）：172 个候选里有大量**不能进库的东西**——
    ·「古城」是**行政地名**、「红门祠堂弄」是**道路名**（图商 category 末级值写得很清楚）
    ·「西递古村景区-戏台」「-绣楼」「-桃李园」是**景区内部的子景点**，
      进库会与「西递古镇」重复，且在四级下钻里是噪声
    ·「黄山 · 碧山村精酿博物馆」在**邻市**（黟县是县，`region` 只锁到市一级）
  ⇒ 自动入库会直接污染数据。**候选清单 + 人审**是唯一稳妥的姿势。

## 它**不做什么**（非目标）
  · **不写文案**。`summary` / `description` / `highlights` 是带判断的内容
    （"像翻地方志"这种），图商 API 里根本不存在，仍由人/AI 写。
  · **不补坐标**。候选清单里已经有 `lng`/`lat`（place_search 直接返的），
    等人确认后跑 `run.py geocode` 正式入库时自然会补。
  · **不入库**。想入库得人工把候选条目搬进 `seeds/{city}.py`，再跑 seed。

用法（在**仓库根**执行）：
    python pipeline/run.py discover                # 全 83 城（配额消耗大，见下）
    python pipeline/run.py discover yixian         # 只跑一城
    python pipeline/run.py discover yixian --pages 2  # 每类目多翻一页

★ 配额：`place_search` 是**腾讯 200/日**的桶（最先见底的那个）。
  33 个类目关键字 × 83 城 = 2700 次请求 ⇒ **全量跑不可能**。
  所以：① 幂等（已处理的城市直接跳过）② 建议按城市分批、手动跑
  ③ 定时任务每次只跑**一城**。
"""
from __future__ import annotations

import importlib
import json
import os
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from pipeline.core.layout import GENERATED, write_json                     # noqa: E402
from pipeline.providers import geoprovider as geo                         # noqa: E402

#: 候选清单落这里。放`_generated/` 下 —— 它是**派生产物**，
#: 不进正式库、不参与 build、删了重跑就行。
DISCOVER_DIR = GENERATED / "discover"

#: 类目关键字 → 猜的大类。**只是猜**，供人参考；真实归属以 `seedlib.CATEGORIES` 为准。
KEYWORDS: dict[str, list[str]] = {
    "scenic": ["古镇", "博物馆", "祠堂", "风景区", "风景名胜", "园林", "故居",
               "遗址", "牌坊", "古村", "寺", "庙", "塔", "陵园", "美术馆",
               "纪念馆", "山庄", "度假区"],
    "food": ["特色美食", "小吃", "面馆", "酒楼", "小吃店", "咖啡厅", "茶馆",
             "农家菜", "烧烤"],
    "hotspot": ["网红打卡", "文创园", "艺术区", "创意园", "书店"],
    "culture": ["历史文化街区", "古街", "非遗", "民俗"],
}

#: ★ 图商category 末级值里的**排除词**。实测（2026-10-08黟县）必须排掉这些：
#:   「行政地名」「道路名」——搜"古镇"会返回"古城"这种地名条目，不是景点；
#:   「数码家电」等—— 关键字命中的是**店名里带类目词**的无关店铺。
#: 命中任一即丢弃。**这是让候选清单可用的关键**，不是锦上添花。
#: ★「度假村/酒店」也是实测加的：搜"度假区""山庄"会把
#:   「艺龙安云野奢度假酒店(宏村景区店)」这类**住宿**拉进来 —— 住宿是另一类数据
#:   （本站的住宿点只存localStorage），混进 POI 里是噪声。
EXCLUDE_CATEGORIES = ("行政地名", "道路名", "地名地址", "数码家电", "汽车",
                      "房地产", "金融保险", "公司企业", "医疗", "教育", "酒店",
                      "度假村", "度假酒店", "宾馆", "民宿", "旅行社",
                      # ★ 下面三项是实测（2026-10-08黟县）加的：
                      #   「商务楼宇」「产业园区」——搜"文创园""艺术区"会把
                      #     「徽酒文化产业园」「…梦工厂办公楼」这类**写字楼/厂区**拉进来；
                      #   「公墓」「墓园」——  cemeteries 不是可游览点位。
                      #   ★ 注意 category 是**嵌套**的（实测 `汽车:加油站:充电站`），
                      #     所以排除词要同时检查**整串**而不只是末级 ——
                      #     只查末级会让「充电站」以「加油站」的身份溜进来。
                      "商务楼宇", "产业园区", "公墓", "墓园",
                      "加油站", "充电站", "停车场", "出入口")

#: ★ 标题里出现这些词 ⇒ 住宿/餐饮连锁/纪念性单体，不是景点本体
EXCLUDE_TITLE_WORDS = ("度假酒店", "度假村", "温泉", "民宿", "宾馆", "快捷酒店",
                       # ★ 「纪念碑/纪念塔」是**单体纪念物**，不可游览。
                       #   注意图商把「黟县人民英雄纪念碑」归成 `旅游景点:纪念馆`，
                       #   **类目拦不住它**，只能按标题词拦。
                       "纪念碑", "纪念塔", "烈士陵园")

#: ★ 景区内部子景点：标题里带这些分隔符 + 短后缀的，多半是某个大景点的一部分。
#:   实测「西递古村景区-戏台 / -绣楼 / -桃李园 / -观光亭」全属此类，
#:   进库会与「西递古镇」重复。
SUBSPOT_SEPARATORS = ("-", "·", "－", "—")

#: ★ 守时循环开关（由 `--loop` 置位）。做成模块级是因为
#:   `_should_stop()` 要读它，而那个函数不接收参数、才好单独复用/测试。
_LOOP = False


def _leaf(cat: str) -> str:
    """图商 category 形如「旅游景点:其它旅游景点」→ 取末级。"""
    return (cat or "").split(":")[-1]


def _load_existing(city_id: str) -> dict[str, str]:
    """该城已有的 POI 名 → 所属大类（用于标记"已在库"）。城市没稿子时返回空。"""
    try:
        mod = importlib.import_module(f"pipeline.seeds.{city_id}")
    except ModuleNotFoundError:
        return {}
    out: dict[str, str] = {}
    for cat, attr in (("scenic", "SCENIC"), ("food", "FOOD"),
                      ("hotspot", "HOTSPOT"), ("culture", "CULTURE")):
        for d in getattr(mod, attr, []) or []:
            out[d["name"]] = cat
    return out


def _is_subspot(title: str) -> bool:
    """判断是不是某个大景点的内部子景点。

    判据：标题含分隔符，且分隔符后的部分较短（≤5 字）——
    「西递古村景区-戏台」命中；「黄山 · 碧山村精酿博物馆」因后半段长而不命中。
    """
    for sep in SUBSPOT_SEPARATORS:
        if sep in title:
            tail = title.split(sep)[-1].strip()
            if 0 < len(tail) <= 5:
                return True
    return False


#: ★ 名称归一化时剥掉的后缀。图商爱加景区后缀，库里的写法常常没有：
#:   图商「青城山风景区」vs 库内「青城山」★ 实测踩过，精确名去重挡不住
#:   图商「都江堰风景名胜区」vs 库内「都江堰景区」
#:   图商「西递古镇」vs 库内「西递古村古建筑群」……（后者只能靠人去判）
NORMALIZE_STRIP = (
    "风景区", "风景名胜区", "景区", "旅游景区", "风景区", "风景区",
    "风景名胜", "保护区", "公园", "景区", "旅游区", "景区门票",
)


def _norm(name: str) -> str:
    """名称归一化：去掉括号内容、剥离景区类后缀、去空格。

    ★ 只做**保守**归一化 —— 宁可漏判（把已在库的当候选，人一眼看出来）
    也不能误杀（把真新点位当已存在丢掉）。同义词（西递古镇 / 西递古村古建筑群）
    不在能自动判定的范围内，留给人在候选清单里判断。
    """
    s = name.strip()
    # 去掉括号及内容：「梵高星空美术馆(春熙路旗舰店)」→「梵高星空美术馆」
    s = re.sub(r"[（(][^）)]*[）)]", "", s)
    # 剥离景区类后缀（可能叠加多层，如「XX风景区景区」）
    changed = True
    while changed:
        changed = False
        for suf in NORMALIZE_STRIP:
            if s.endswith(suf) and len(s) > len(suf):
                s = s[: -len(suf)]
                changed = True
    return s.replace(" ", "").replace("　", "")


def discover_city(city_id: str, city_name: str, pages: int = 1) -> dict:
    """拓一座城的候选点位。返回统计字典。"""
    existing = _load_existing(city_id)
    # ★ 本城开工前的账本快照。「有没有真发请求」只能靠它判，见 `_ps_requests()`。
    before_period, before_req = _ps_requests()
    # ★ 归一化索引：图商「青城山风景区」与库内「青城山」是同一处，
    #   精确名去重挡不住（实测成都 5 个国家级景点里3 个被误列为候选）。
    existing_norm = {_norm(n) for n in existing}
    stat = {"searched": 0, "returned": 0, "in_lib": 0,
            "dup": 0, "excluded": 0, "subspot": 0, "new": 0,
            # ★ quotaHit=1 表示本城中途撞上配额见底（候选已保留），
            #   外层据此判定"该收手了"，而不是再去撞一次墙。
            "quotaHit": 0}
    seen: set[str] = set()
    candidates: list[dict] = []

    # ★ 进关键字循环**之前**先探一次配额。
    #   否则配额已满时，会从第 1 个关键字打起、36 次全废才停（实测每城白打 36 次）。
    #   这里一次就拦下，整座城0 次请求。
    if _quota_dead():
        print(f"    ⛔ 腾讯 place_search 配额已用尽，本城跳过（0 次请求）")
        stat["quotaHit"] = 1
        stat["skippedByQuota"] = 1     # ★ 见落盘处的说明：区别于"搜了但没结果"
        return stat

    for guess_cat, kws in KEYWORDS.items():
        for kw in kws:
            for page in range(pages):
                stat["searched"] += 1
                try:
                    # ★ 用 get_json 已有的缓存：同一关键字重复跑不重复烧配额
                    r = geo.place_search(kw, region=city_name,
                                         page_size=10 * (page + 1), use_cache=True)
                except Exception as e:                # noqa: BLE001 —— 单个关键字失败不影响整城
                    print(f"    ⚠️ 「{kw}」失败：{type(e).__name__}: {str(e)[:60]}")
                    continue
                if not r:
                    # ★★ 关键：空结果要分清是「真没有」还是「配额耗尽」。
                    #   `geoprovider.place_search` 在两家都判死时返回 `[]` 并打一行警告，
                    #   若不区分就会**继续打剩下全部关键字** ——
                    #   实测配额中途耗尽时刷了 10+ 行「两家都不可用」，
                    #   明知失败还在烧请求、还把日志淹掉。
                    #   这里直接**中止本城**：`_quota_dead()` 已经是「腾讯用尽」的判据。
                    if _quota_dead():
                        # ★ 不直接 return —— 那会**跳过下面的落盘**，
                        #把这一城已经搜到的候选全丢掉。改成跳出双层循环、
                        # 走正常落盘流程，只是 `quotaHit` 标记让外层知道该收手了。
                        stat["quotaHit"] = 1
                        print(f"    ⛔ 配额见底，中止本城剩余关键字"
                              f"（已搜 {stat['searched']} 次，候选 {len(candidates)} 个已保留）")
                        break
                    break
                if stat.get("quotaHit"):
                    break
                stat["returned"] += len(r)
                for x in r:
                    title = (x.get("title") or "").strip()
                    if not title:
                        continue
                    if title in seen:
                        stat["dup"] += 1
                        continue
                    seen.add(title)

                    # ★ 检查**整串** category 而不是只查末级：图商的值是嵌套的
                    #   （实测 `汽车:加油站:充电站`），只查末级会让「充电站」
                    #   以「加油站」的身份溜进来（真实踩过）。
                    cat_raw = x.get("category") or ""
                    leaf = _leaf(cat_raw)
                    if any(bad in cat_raw or bad in leaf for bad in EXCLUDE_CATEGORIES):
                        stat["excluded"] += 1
                        continue
                    if any(w in title for w in EXCLUDE_TITLE_WORDS):
                        stat["excluded"] += 1
                        continue
                    if _is_subspot(title):
                        stat["subspot"] += 1
                        continue
                    if title in existing or _norm(title) in existing_norm:
                        # ★ 记一笔"疑似已在库"：归一化可能把两个不同点位合并了，
                        #   让人能反查（`exactHit` 为 False 时说明是靠归一化判掉的）
                        stat["in_lib"] += 1
                        continue

                    stat["new"] += 1
                    candidates.append({
                        "title": title,
                        "guessCategory": guess_cat,
                        "matchedKeyword": kw,
                        "amapCategory": x.get("category") or "",
                        "address": x.get("address") or "",
                        "province": x.get("province") or "",
                        "city": x.get("city") or "",
                        "district": x.get("district") or "",
                        "adcode": x.get("adcode"),
                        "lng": x.get("lng"),
                        "lat": x.get("lat"),
                        # ★ 显式标注"还没入库"，避免有人误把它当已收录数据
                        "status": "candidate",
                    })

    out_path = DISCOVER_DIR / f"{city_id}.json"
    # ★★ 本城**零请求**（全是缓存命中）时**不重写**已存在的 JSON。
    #   理由有两条，第二条更狠：
    #     ① 白写一遍没有任何新信息；
    #     ② 却会刷新 mtime ⇒ 破坏「真新增看文件清单差集」这个唯一可靠判据
    #        （清单看不出差别，但 `ls -lt` 会显示"刚刚才跑过"，等于假报进度）。
    after_period, after_req = _ps_requests()
    same_period = after_period == before_period
    net_requests = max(0, after_req - before_req) if same_period else 0
    stat["netRequests"] = net_requests
    touched = (not same_period) or net_requests > 0
    if not touched and out_path.is_file():
        print(f"   （本城全命中缓存，0 次请求 ⇒ 不重写 {out_path.name}）")
        return stat
    # ★ `skippedByQuota` 必须落盘：**0 个候选**有两种完全不同的情况——
    #   「配额耗尽、一个请求都没发」 vs 「真去搜了、这城就是没有」。
    #   不区分的话，隔天看清单会误判成"这城没景点"，而真相是没跑成。
    #   （实测 2026-10-09 夜跑：重庆、澳门留下 0 条，就是配额正好在轮到它们时耗尽。）
    write_json(out_path, {
        "cityId": city_id,
        "cityName": city_name,
        # ★ 明写"这是候选、不是数据"。build 不会读它（不在 data/cities/ 下）。
        "note": "候选清单，尚未入库。需要人确认后搬进 pipeline/seeds/{city}.py 再跑 seed。",
        "stat": stat,
        "skippedByQuota": bool(stat.get("skippedByQuota")),
        "candidates": candidates,
    })
    return stat


def _ps_requests() -> tuple[str, int]:
    """读账本里 `place_search` 的（周期, 累计请求数）快照。

    ★★ 用途：判「这一轮到底有没有真发请求」。`discover_city` 走
      `use_cache=True`，缓存命中时**不打网络、不烧配额**，而 `stat["searched"]`
      是**关键字循环次数**（缓存命中照样 +1）⇒ 它不能用来判断有没有真干活。
      实测 2026-10-22：83 城全缓存后 `--loop` 会一直跑到 07:00，
      每轮把 83 个 JSON 重写一遍、零请求 —— 定时任务挂 7 小时必被判失败。

    ★ 返回 `("", -1)` 表示读不到账本。调用方据「周期相同 且 请求数相同」判空转，
      周期变了（跨零点）就不敢判 —— 宁可多跑一轮，也不能误停。
    """
    try:
        from pipeline.core import fetch
        daily = fetch.load_ledger().get("daily") or {}
        api = (daily.get("apis") or {}).get("place_search") or {}
        return str(daily.get("period") or ""), int(api.get("requests") or 0)
    except Exception:                                  # noqa: BLE001 —— 判据不该崩
        return "", -1


def _deadline(until: str) -> datetime:
    """把 `--until HH:MM` 折算成**下一个**该时刻的绝对时间。

    ★★ 2026-10-22 踩过：原来直接字符串比 `now >= until`
      ⇒ 22:51 跑 `--until=07:00` 时 `"22:51" >= "07:00"` 为真，
      **开局第一城都没跑就判"到点"退出**（日志：已跑 0 城）。
      跨零点场景（夜里跑到次日凌晨）在这套写法下**必然**踩中。
    """
    hh, mm = (int(x) for x in until.split(":")[:2])
    now = datetime.now()
    target = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
    if target <= now:            # 今天这个点已经过了 ⇒ 指的是明天早上那个点
        target += timedelta(days=1)
    return target


def _should_stop(deadline: datetime | None, done: int, quota_dead: bool) -> tuple[bool, str]:
    """守时循环的停止判据。返回 (是否停, 原因)。

    ★ `deadline` 必须是**启动时算好的绝对时刻**（`_deadline()` 的结果），
      不许在每次检查时重算 —— 那样到了 07:00 那一刻又会滚到次日同点，
      循环永远等不到"到点"。

    三条停止条件，**优先级从高到低**：
      1. **配额见底** —— 最重要的那条。硬跑只会得到一堆失败请求，
         还会把 `place_search` 的额度白烧在注定失败的调用上。
         ★ 只看**腾讯这一家**（高德额度已满，见 `_quota_dead`）。
      2. **到点**（`--until HH:MM`）—— 用户说的"跑到 7 点"。
      3. **城市跑完** —— 没指定 `--loop` 时跑一轮就退（默认行为）。
    """
    if quota_dead:
        return True, "配额见底（腾讯 place_search 日配额用尽）"
    if deadline and datetime.now() >= deadline:
        return True, f"到点 {deadline:%H:%M}"
    if done and not _LOOP:
        return True, "城市清单已跑完（未开 --loop）"
    return False, ""


def _quota_dead() -> bool:
    """腾讯「地点搜索」配额是否已用尽（**两条判据，取或**）。

    ★★ 2026-10-08 用户确认：**高德额度已满，不可用**。
      所以判据只看腾讯 —— `place_search` 用尽即整批停止。

    ## 为什么要两条判据（第一条是实测踩出来的）
    `tmap.quota_exhausted()` 只看**本次进程**的内存集合（`_tmap_dead_apis`），
    它靠响应里的 `status=121` 才置位。⇒ **新进程启动时它必定是"没死"**，
    于是配额明明已满，脚本仍会从第 1 个关键字打起、**36 次全废才停**
    （实测：配额已满的情况下又白打了 252 次请求）。

    判据一（账本预判，不花请求）：`used >= quota` ⇒ 必然发不出去了，直接判死。
      ★ 只在 `quota` 有明确上限时生效；`None`（未知）一律不拦，避免误杀。
    判据二（响应判死，本进程内累积）：与 `tmap` 共享同一个内存集合。

    ★ 注意这只影响**本脚本的停止判据**，不动 `geoprovider` 本身的路由 ——
      那个是全站共用的（geocode 还要用腾讯的 `geocoder`，那个桶还有余量），
      改成"任何地方都不许切高德"会误伤其它链路。
    """
    # 判据一：账本预判（零请求）
    #   ★★ 必须走 `fetch.remaining()`，**不能裸读账本的 daily.apis**。
    #   裸读会漏掉「跨零点归零」：账本 period 还是昨天、units 已超限，
    #   而腾讯配额其实在 0 点就回满了 ⇒ 判死误判 ⇒ 守时循环 0 请求秒退，
    #   整夜（0:00→7:00）一城不跑。`remaining()` 内部会比对 period，
    #   旧周期直接返回满额，正是这里要的语义。
    try:
        from pipeline.core import fetch
        left = fetch.remaining("place_search")
        if left is not None and left <= 0:      # None = 配额未知，不拦（避免误杀）
            return True
    except Exception:                                  # noqa: BLE001
        pass
    # 判据二：本进程已收到过 121
    try:
        from pipeline.providers import tmap
        return tmap.quota_exhausted("place_search")
    except Exception:                                  # noqa: BLE001 —— 判据不该崩
        return False


#: ★ 配额耗尽而被跳过的城市，**下一轮优先补**（它们连一次请求都没发，
#:   不补就永远是 0 条）。判据读落盘里的 `skippedByQuota`。
#:   排序只动**优先级**、不丢城市 —— 城市池始终是全量（有序遍历便于轮转）。
def _was_skipped(cid: str) -> bool:
    """这座城上次是不是**因配额耗尽被掐断**（一个请求都没发成）。"""
    f = DISCOVER_DIR / f"{cid}.json"
    if not f.is_file():
        return False
    try:
        return bool(json.loads(f.read_text(encoding="utf-8")).get("skippedByQuota"))
    except Exception:                                  # noqa: BLE001
        return False


def main(argv: list[str] | None = None) -> int:
    global _LOOP
    args = sys.argv[1:] if argv is None else argv
    only: str | None = None
    pages = 1
    until: str | None = None
    _LOOP = False
    # ★★ 固定只用腾讯（2026-10-08 用户确认：高德额度已满、不再用）。
    #   设 `GEO_PROVIDER=tencent` 后，`geoprovider.place_search` 会**直接走腾讯、
    #   完全不碰高德** —— 省掉"撞腾讯墙 → 再探一次已关的高德门"那几十次白费请求，
    #   也少刷一屏"两家都不可用"的警告。
    #   ★ 只在本进程内设（`setdefault` 之外的直接赋值），不污染系统环境变量。
    os.environ.setdefault(geo.FORCE_VAR, "tencent")
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--loop":
            _LOOP = True
        elif a.startswith("--pages"):
            if "=" in a:
                pages = int(a.split("=", 1)[1])
            else:
                i += 1
                pages = int(args[i])
        elif a.startswith("--until"):
            if "=" in a:
                until = a.split("=", 1)[1]
            else:
                i += 1
                until = args[i]
        else:
            only = a
        i += 1

    DISCOVER_DIR.mkdir(parents=True, exist_ok=True)

    # 城市清单从已入库的 city.json 取（那是"已收录"的唯一真源）
    all_targets: list[tuple[str, str]] = []
    for cj in sorted((REPO / "data" / "cities").glob("*/*/city.json")):
        try:
            d = json.loads(cj.read_text(encoding="utf-8"))
        except Exception:                              # noqa: BLE001
            continue
        cid = d.get("id")
        if cid:
            all_targets.append((cid, d.get("name") or cid))

    targets = [t for t in all_targets if only is None or t[0] == only]
    if not targets:
        print("⚠️ 没有找到已收录的城市（data/cities/*/*/city.json）")
        return 1

    skipped_first = [t for t in targets if _was_skipped(t[0])]
    if skipped_first:
        targets = skipped_first + [t for t in targets if not _was_skipped(t[0])]
        print(f"★ 优先补跑上次被配额掐断的城市（{len(skipped_first)} 个）："
              + "、".join(c for c, _ in skipped_first[:8]))

    # ★ 截止时刻**只算一次**（绝对时间），循环里不再重算
    deadline = _deadline(until) if until else None

    # ★ 守时循环的三个开关，打印清楚，别让人以为它只跑一轮
    if _LOOP or until:
        print(f"▶ 点位发现：守时循环模式")
        print(f"   · 城市池 {len(targets)} 城（反复跑，直到时间/配额到顶）")
        print(f"   · 每类目 {pages} 页")
        print(f"   · 停止条件：到点 {until or '不限'}"
              + (f"（绝对 {deadline:%m-%d %H:%M}）" if deadline else "")
              + " · 或配额见底 · 或手动 Ctrl+C")
        print(f"★ **配额是硬约束**：腾讯 place_search 200/日 ÷ 36 次/城 ≈ **5 城/日**；")
        print(f"  用尽即整批停止（高德额度已满，本任务固定 `GEO_PROVIDER=tencent` 不用它）。")
    elif only:
        print(f"▶ 点位发现：只跑 {only}")
    else:
        print(f"▶ 点位发现：{len(targets)} 城 · 每类目 {pages} 页")
        print("   ★ place_search 是腾讯 200/日 的桶，全量跑必然撞限；"
              "要长时间抓取加 `--loop --until=07:00`")

    grand = {"searched": 0, "returned": 0, "in_lib": 0,
             "dup": 0, "excluded": 0, "subspot": 0, "new": 0}
    cities_done = 0
    round_no = 0
    try:
        while True:
            round_no += 1
            # ★ 本轮真实网络请求数累计（缓存命中不计数）。轮末据此判空转。
            round_net = 0
            print(f"\n════ 第 {round_no} 轮 "
                  f"（{datetime.now().strftime('%H:%M:%S')}）════")
            for cid, cname in targets:
                stop, why = _should_stop(deadline, cities_done, _quota_dead())
                if stop:
                    print(f"\n⏹ 停止：{why}")
                    print(f"   已跑 {cities_done} 城（{cities_done * 36} 次搜索）")
                    return 0

                print(f"\n── [{cities_done + 1}] {cid}（{cname}）─────")
                try:
                    st = discover_city(cid, cname, pages=pages)
                except KeyboardInterrupt:
                    raise
                except Exception as e:                # noqa: BLE001
                    # ★ 单城失败**不终止整个循环** —— 一个城市的数据问题
                    #   不该让整晚的进度白费。
                    print(f"   ⚠️ 该城失败：{type(e).__name__}: {str(e)[:80]}")
                    continue
                cities_done += 1
                round_net += st.get("netRequests", 0)
                for k in grand:
                    grand[k] += st[k]
                print(f"  搜 {st['searched']} 次 · 回 {st['returned']} 条 · "
                      f"已在库 {st['in_lib']} · 重复 {st['dup']} · "
                      f"类目排除 {st['excluded']} · 子景点 {st['subspot']} · "
                      f"★候选 {st['new']}")
                # ★ 本城中途撞上配额见底 ⇒ 立刻收手（下一城只会全部失败）
                if st.get("quotaHit"):
                    print("\n⏹ 停止：配额见底（已在该城中途发现）")
                    print(f"   已跑 {cities_done} 城（{cities_done * 36} 次搜索）")
                    print(f"   ★ 这一城搜到的 {st['new']} 个候选**已落盘**，没丢")
                    return 0

            # ★★ 一整轮跑完，却一次请求都没发 ⇒ 全城命中缓存 ⇒ 再循环也是空转。
            #   实测 2026-10-22：83 城全缓存后 `--loop` 会一路空转到 07:00，
            #   每轮只是把 83 个 JSON 重写一遍（连 mtime 都变成"刚跑过"，
            #   等于假报进度）。定时任务挂在这样的进程上必然被判超时/失败。
            #   ⇒ 这里主动收工，把"该由人决定的事"（加缓存 TTL / 清缓存）留在日报里。
            if round_net == 0:
                print(f"\n⏹ 停止：本轮 {len(targets)} 城**零请求**（全部命中 place_search 缓存）")
                print("   ★ 没有未缓存的城市可拓 ⇒ 继续 --loop 只会空转、不会产出新候选。")
                print("   ★ 想重扫老城：清掉 place_search 缓存，或给缓存加 TTL。")
                return 0
    except KeyboardInterrupt:
        print(f"\n⏹ 被手动中断（Ctrl+C）—— 已完成的城**候选都已落盘**，不会丢")

    print("\n══ 汇总 ═════════════════════════")
    print(f"  跑了 {cities_done} 城（{round_no} 轮）· 搜了 {grand['searched']} 次 · "
          f"回 {grand['returned']} 条")
    print(f"  已在库 {grand['in_lib']} · 重复 {grand['dup']} · "
          f"类目排除 {grand['excluded']} · 子景点 {grand['subspot']}")
    print(f"  ★ 新候选 {grand['new']} 个")
    print(f"\n  候选清单：{DISCOVER_DIR.relative_to(REPO)}/{{城市}}.json")
    print("  ★ **尚未入库** —— 要入库得人工把条目搬进 seeds/{城市}.py，再跑 seed。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())