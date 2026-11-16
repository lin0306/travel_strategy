"""「每日点位拓取」的选城 / 备料 / 记账。

## 为什么有这个脚本

`step12_discover` 的城市池 = 已有 `city.json` 的城市，候选落到
`data/_generated/discover/<slug>.json`。它**没有缓存 TTL**，而 2026-10-22 那轮
已把 83 城全扫过 ⇒ 直接跑会「零请求自停」（候选文件只是被重写一遍，假报进度）。

所以「该扫哪座城」必须由**外部账本**决定，不能让 `discover` 自己撞：

| 状态 | 判据 | 处理 |
|---|---|---|
| `never` | 候选文件不存在 | 直接扫（缓存里没这城，自然会打网络） |
| `empty` | 候选文件 `candidates` 为 0 | 同上（上次多半撞了配额/失败） |
| `stale` | 距上次扫描 > `--days` 天（默认 7） | **先 `prepare` 清缓存**，否则全命中缓存 = 零请求 |

★ `--days 7` 不是"7 天扫一轮全库"：它只是"候选满 7 天就有资格重扫"，
  每晚仍只挑**最久没扫的 1 城**（72 次请求）。83 城一轮实际约 **83 晚**。
  别把 `--days` 调得比 1 还小 —— 那只是让更多城有资格，不会加速挑选。

## 用法

```
python tools/discover_queue.py run                # ★ 定时任务用这条：跑一城→看额度→还有就再跑
python tools/discover_queue.py run --dry          # 只看会跑哪几城、预计烧多少次
python tools/discover_queue.py next [--days 7]    # 只读计划（手动排查用），无事打印 NOTHING_TO_DO
python tools/discover_queue.py prepare <slug>     # 清该城两家 place_search 缓存（重扫前必做）
python tools/discover_queue.py done  <slug> [n]   # 记账（n = 候选数）
python tools/discover_queue.py fail  <slug>       # 记失败；连续 2 次 → 进 skipped
python tools/discover_queue.py status             # 总览
```

★★ **`run` 与 `next` 的分工（2026-11-10 改）**
`next` 是**预算式**静态切分：把当日剩余额度切成 72/72/36 的城，200 不能被 72 整除
⇒ 每天固定扔掉 20 次（实测 2026-11-09 只跑到 177/200，连续几天都是"跑不满"）。
`run` 是**循环式**：每城跑完再看 `remaining`，`> 0` 就开下一城；跑的过程中腾讯见底，
`discover_city` 会把本城剩下的关键词切高德补完，然后当天收手（高德是月配额，
不用它开新城）。定时任务只用 `run`。

★ `run` 每城固定先清**两家**缓存（腾讯 `place.json` + 高德 `amap_place.json`，
键名同为 `城名|关键词|页大小`）。只清一家，切过去就全命中缓存 = 零请求。

★ `run` 还会避开**今晚 A 段刚入库**的城（读 `discover-intake.json` 的 `dates`）：
  B 段重扫它会把候选文件 mtime 刷新，次日 `intake_queue.is_fresh()` 误判成
  "又拓到新候选"，同一座城被反复 revisit。
"""

from __future__ import annotations

import json
import sys
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LEDGER = ROOT / ".workbuddy" / "memory" / "discover-scan.json"
DISCOVER_DIR = ROOT / "data" / "_generated" / "discover"
PLACE_CACHE = ROOT / "pipeline" / ".cache" / "place.json"

#: ★ 腾讯「地点搜索」实测 **200/日**（用到 200 整就报 121，见 `core/fetch.py`）。
TENCENT_DAILY = 200
#: ★★ 2026-11-10 改：原来留 8 次防「撞 121」，代价是一天白扔 8 次额度，
#:   而且**预算式预判**（切 72/72/36）还会再扔 12 次 —— 一天最多只花 180。
#:   现在改成「跑完一城再看 remaining」：`count_usage()` 是**发请求前**记账，
#:   所以 remaining 精确；真撞 121 时 `discover_city` 会把本城剩余关键词
#:   切到高德补完（候选已落盘），不存在"白跑"。⇒ 预留归零，把 200 用干净。
RESERVE = 0
MAX_CITIES = 6             # 一次 `run` 最多连跑几座城（防止日志与失败定位糊掉）

#: 候选数达到这个量才值得双页深扫（`pages=2`：每词 page_size 10 → 20，
#: 实测净增约 10 条/词，同城候选翻倍：合肥 212→432、厦门 216→419）。
#: 实测 83 座城里 81 座都 ≥ 89 条（中位 205），所以绝大多数城建档即双页。
FULL_SCAN_MIN = 60

MAX_FAILS = 2              # 连续失败几次后放弃该城（进 skipped 留痕）


# ────────────────────────────── 账本 ──────────────────────────────

def load() -> dict:
    if LEDGER.exists():
        try:
            d = json.loads(LEDGER.read_text(encoding="utf-8"))
        except Exception:                              # noqa: BLE001
            d = {}
    else:
        d = {}
    d.setdefault("scanned", {})
    d.setdefault("attempts", {})
    d.setdefault("skipped", {})
    return d


def save(d: dict) -> None:
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    LEDGER.write_text(json.dumps(d, ensure_ascii=False, indent=1) + "\n",
                      encoding="utf-8")


# ────────────────────────────── 数据读取 ──────────────────────────────

def cities() -> list[tuple[str, str, str]]:
    """[(slug, 城市名, 省目录)]，按 slug 排序。"""
    out = []
    for cj in sorted((ROOT / "data" / "cities").glob("*/*/city.json")):
        try:
            d = json.loads(cj.read_text(encoding="utf-8"))
        except Exception:                              # noqa: BLE001
            continue
        slug = cj.parent.name
        name = d.get("name") or slug
        out.append((slug, name, cj.parent.parent.name))
    return out


def cand_info(slug: str) -> tuple[int, str | None]:
    """(候选数, 候选文件日期)。文件不存在 → (0, None)。"""
    p = DISCOVER_DIR / f"{slug}.json"
    if not p.exists():
        return 0, None
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
        n = len(d.get("candidates") or [])
    except Exception:                                  # noqa: BLE001
        n = 0
    return n, date.fromtimestamp(p.stat().st_mtime).isoformat()


def last_scan(slug: str, file_date: str | None, led: dict) -> str | None:
    """上次扫描日期：账本优先，其次候选文件的 mtime。"""
    v = (led["scanned"].get(slug) or {}).get("date")
    return v or file_date


def quota_used_today() -> int:
    """今日 place_search 已用请求数；读不到返回 -1（不敢拦）。"""
    try:
        # ★ 本脚本以 `tools/discover_queue.py` 方式运行，sys.path[0] 是 tools/，
        #   不补 ROOT 就 import 不到 pipeline ⇒ 静默返回 -1（等于永不拦配额）。
        if str(ROOT) not in sys.path:
            sys.path.insert(0, str(ROOT))
        from pipeline.core import fetch
        daily = fetch.load_ledger().get("daily") or {}
        period = str(daily.get("period") or "")
        if period != date.today().isoformat():
            return 0                                   # 跨周期 ⇒ 惰性归零，视为 0
        return int(((daily.get("apis") or {}).get("place_search") or {})
                   .get("requests") or 0)
    except Exception:                                  # noqa: BLE001
        return -1


def _amap_available() -> bool:
    """只读账本探一次高德「地点搜索」能不能用（**不发网络请求**）。

    ★ 探不准时返回 True：宁可让 `step12._quota_dead()` 在真正开跑时再判一次，
      也不能因为探测本身出错就把一整晚的拓取拦掉。
    """
    try:
        if str(ROOT) not in sys.path:
            sys.path.insert(0, str(ROOT))
        from pipeline.providers import geoprovider
        ok, _why = geoprovider._amap_usable("amap_place")   # noqa: SLF001
        return bool(ok)
    except Exception:                                  # noqa: BLE001
        return True


def _avoid_today() -> set[str]:
    """今晚 A 段已入库的城，B 段不重扫（避免候选文件 mtime 被刷新成"新候选"）。"""
    p = ROOT / ".workbuddy" / "memory" / "discover-intake.json"
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
    except Exception:                                  # noqa: BLE001
        return set()
    today = date.today().isoformat()
    return {s for s, dt in (d.get("dates") or {}).items() if dt == today}


# ────────────────────────────── 额度规划 ──────────────────────────────

def _kw_count() -> int:
    """一页要打多少次请求 = 关键词总数（`step12_discover.KEYWORDS` 现算）。

    ★ 不硬编码 36：加了关键词这函数跟着变，配额规划不会与真实开销脱节。
      读不到时退回 36（当前实测值：scenic18 + food9 + hotspot5 + culture4）。
    """
    try:
        if str(ROOT) not in sys.path:
            sys.path.insert(0, str(ROOT))
        from pipeline.steps.step12_discover import KEYWORDS
        n = sum(len(v) for v in KEYWORDS.values())
        return n or 36
    except Exception:                                  # noqa: BLE001
        return 36


def _pages_for(n: int) -> int:
    """这座城该扫几页 —— **只看城市规模，不看腾讯余额**。

    ★ 2026-11-10 改：原来按「余额够不够 72 次」定（`left >= 2*kw`）。那是预算式
      思维 —— 拿剩余次数去决定扫多深，跟这城有多少景点毫无关系。后果是余额快见底时，
      一座 400 候选的大城被按「浅扫」处理（每词只取 10 条），而它恰恰最该深扫；
      反过来一座 15 个景点的小城，余额充足时照样吃 72 次。

    现在的口径：**抓的时候只判腾讯还有没有额度，剩多少不管**。有一城跑一城，
    跑到额度尽就由 `discover_city` 切高德把本城补完，当天收手。

    `n` = 这城上次扫出的候选数（文件不存在 / 0 条 ⇒ 先单页摸底，够了下轮自动升双页）。
    """
    return 2 if n >= FULL_SCAN_MIN else 1


# ────────────────────────────── 子命令 ──────────────────────────────

def _build_pool(days: int = 7, led: dict | None = None) -> tuple[list, set[str]]:
    """候选池：`never` → `empty` → `stale`（最久没扫的在前），并给出今晚要避开的城。

    `next`（手动排查）与 `run`（定时任务）共用这一份排序 —— 两处各写一遍必然分家。
    """
    led = load() if led is None else led
    today = date.today()
    avoid = _avoid_today()
    never, empty, stale = [], [], []

    for slug, name, prov in cities():
        if slug in led["skipped"] or slug in avoid:
            continue
        n, fdate = cand_info(slug)
        last = last_scan(slug, fdate, led)
        if last is None:
            never.append((slug, name, None, n, "never", "候选文件不存在"))
            continue
        if n == 0:
            empty.append((slug, name, last, n, "empty", f"上次扫描 0 候选（{last}）"))
        else:
            age = (today - date.fromisoformat(last)).days
            if age > days:
                stale.append((slug, name, last, n, "stale",
                              f"距上次扫描 {age} 天（{last}）"))

    stale.sort(key=lambda r: r[2])                     # 最久没扫的优先
    return never + empty + stale, avoid


def cmd_next(argv: list[str]) -> int:
    """**只读计划**：按当前额度排出 tonight 的几座城（给人 / 排查用，不执行）。

    ★ 定时任务走 `run`（边跑边看额度），不要用 `next` 的静态切分 ——
      它假设"一城 72 次"能整除 200，实际每天都会扔掉 20 次（2026-11-09 实测 177/200）。
    """
    days = 7
    if "--days" in argv:
        try:
            days = int(argv[argv.index("--days") + 1])
        except Exception:                              # noqa: BLE001
            pass
    max_cities = 3
    if "--max-cities" in argv:
        try:
            max_cities = max(1, int(argv[argv.index("--max-cities") + 1]))
        except Exception:                              # noqa: BLE001
            pass

    used = quota_used_today()
    left = _tencent_left()
    #: ★ 只判「腾讯还有没有额度」，**不按剩余次数切城**。
    #:   读不到（None）就当有 —— 探测失败不该让当晚停工。
    prefer_amap = left is not None and left <= 0
    if prefer_amap and not _amap_available():
        print(f"QUOTA_LOW used={used} daily={TENCENT_DAILY} amap=unavailable")
        print("  腾讯已无额度且高德不可用 ⇒ 本轮不拓取")
        return 0

    led = load()
    pool, avoid = _build_pool(days, led)
    if not pool:
        print("NOTHING_TO_DO")
        print(f"  候选文件全在、且全在 {days} 天内扫过 ⇒ 本轮不烧配额")
        return 0

    picks = pool[:max_cities]
    pages_seq = ",".join(str(_pages_for(p[3])) for p in picks)
    print(f"PLAN used={used if used >= 0 else '?'} daily={TENCENT_DAILY} "
          f"left={left if left is not None else '?'} "
          f"cities={len(picks)} pages={pages_seq}")
    for i, (slug, name, last, n, kind, extra) in enumerate(picks, 1):
        print(f"--- {i}/{len(picks)} ---")
        print(f"CITY={slug}")
        print(f"NAME={name}")
        print(f"KIND={kind}")
        print(f"LAST={last or 'never'}")
        print(f"CAND={n}")
        print(f"PAGES={_pages_for(n)}")
        print(f"NOTE={extra}")
    print(f"QUOTA_USED={used}")
    print(f"PROVIDER={'amap' if prefer_amap else 'tencent'}")
    if prefer_amap:
        print("AMAP_FALLBACK=1")
        print("★ 每条 discover 命令前加 `GEO_PROVIDER=amap ` 前缀 ⇒ 走高德月配额")
    if avoid:
        print(f"AVOID={','.join(sorted(avoid))}（今晚 A 段已入库，不重扫）")
    if any(k == "stale" for *_x, k, _e in picks):
        print("★ stale 城在重扫前必须先 `prepare <slug>` 清该城缓存，否则全命中缓存 = 零请求")
    return 0


def _tencent_left() -> int | None:
    """腾讯 place_search 今天还剩多少次；读不到返回 None（不敢拦）。

    ★ 必须走 `fetch.remaining()` —— 它内含跨零点归零（账本 period 还是昨天时
      直接返回满额），裸读账本会把"昨天用光了"当成"今天也没额度"。
    """
    try:
        if str(ROOT) not in sys.path:
            sys.path.insert(0, str(ROOT))
        from pipeline.core import fetch
        return fetch.remaining("place_search")
    except Exception:                                  # noqa: BLE001
        return None


def cmd_run(argv: list[str]) -> int:
    """跑一座城 → 看额度 → 还有就再跑一座。**定时任务走这条，不再做预算切分**。

    ## 判据只有一条
    **腾讯剩余 > 0 就开下一城**，不看"够不够一整页 / 一整城"。跑到某一城时
    腾讯见底，`discover_city` 会把本城剩下的关键词切到高德补完（`switchedAmap`），
    本轮随即收手 —— 高德是**月**配额，不用它去开新城。

    这与旧的 `next` 预算式切分（72/72/36 = 180，剩下 20 次白扔）的差别：
    一天真花满 200 次，而不是 180。

    ## 页数怎么定
    **只看这城候选规模**（`_pages_for`：`>= FULL_SCAN_MIN` 双页，否则单页摸底），
    **与腾讯余额无关** —— 余额只剩 20 次也照样按规模扫，扫不完的由高德兜底。
    ★ 别改回「按 left 定页数」：那是拿剩余次数决定扫多深，与城市规模脱钩，
      余额见底时会把 400 候选的大城按浅扫处理（用户 2026-11-10 明确否掉）。

    ## 为什么每城先清缓存
    `step12` 用 `use_cache=True`，stale 城不清缓存就是零请求（假进度）。
    两家缓存都要清（`amap_place.json` 的键名与腾讯**完全相同**）。
    """
    dry = "--dry" in argv
    days, max_cities = 7, MAX_CITIES
    for flag, cast in (("--days", int), ("--max-cities", int)):
        if flag in argv:
            try:
                v = cast(argv[argv.index(flag) + 1])
                if flag == "--days":
                    days = v
                else:
                    max_cities = max(1, v)
            except Exception:                          # noqa: BLE001
                pass

    led = load()
    pool, avoid = _build_pool(days, led)
    if avoid:
        print(f"AVOID={','.join(sorted(avoid))}（今晚 A 段已入库，不重扫）")
    if not pool:
        print("NOTHING_TO_DO 候选文件全在、且都在 "
              f"{days} 天内扫过 ⇒ 本轮不烧配额")
        print("NEXT=stop")
        print("STOP=nothing_to_do")
        return 0

    kw = _kw_count()
    left = _tencent_left()
    used = quota_used_today()
    print(f"B_START pool={len(pool)} max={max_cities} kw={kw} "
          f"tencent_left={left if left is not None else '?'} "
          f"used={used if used >= 0 else '?'}")

    done = 0
    stop = "max_cities"
    sim_left = left                                   #: DRY 用：模拟额度递减（真跑时每城重查）
    for slug, name, last, n, kind, extra in pool[:max_cities]:
        # ★ 唯一判据：腾讯还有额度就继续。<=0 当天收手（不开新城）。
        left = sim_left if dry else _tencent_left()
        if left is not None and left <= 0:
            stop = "tencent_exhausted"
            break
        # ★ 页数只看这城规模（见 `_pages_for`），**不因余额不足而降级**：
        #   余额只剩 20 次也照样双页跑，跑完腾讯切高德补完本城，当天收手。
        pages = _pages_for(n)
        print(f"\n── [{done + 1}] {slug}（{name}）─────")
        print(f"CITY={slug} NAME={name} KIND={kind} LAST={last or 'never'} "
              f"CAND={n} LEFT_BEFORE={left if left is not None else '?'} PAGES={pages}")
        print(f"NOTE={extra}")
        if dry:
            exp_t = (min(left, pages * kw) if left is not None else pages * kw)
            exp_a = max(0, pages * kw - exp_t)
            print(f"DRY 不执行；本城需 {pages * kw} 次 ⇒ 腾讯 {exp_t}"
                  + (f" + 高德补 {exp_a} 后当天收手" if exp_a else ""))
            done += 1
            if exp_a:                                  # 腾讯不够这一城 ⇒ 补完即停
                stop = "amap_tail"
                break
            if left is not None:
                sim_left = left - exp_t                # 模拟递减，后面几城的预估才是真的
            continue

        _clear_cache(slug, name)
        try:
            if str(ROOT) not in sys.path:
                sys.path.insert(0, str(ROOT))
            from pipeline.steps.step12_discover import discover_city
            st = discover_city(slug, name, pages=pages)
        except Exception as e:                         # noqa: BLE001
            print(f"   ⚠️ 该城失败：{type(e).__name__}: {str(e)[:100]}")
            cmd_fail([slug])
            continue

        out = DISCOVER_DIR / f"{slug}.json"
        try:
            total = len(json.loads(out.read_text(encoding="utf-8")).get("candidates") or [])
        except Exception:                              # noqa: BLE001
            total = st.get("new", 0)
        req_t = st.get("netRequests", 0)
        req_a = st.get("netRequestsAmap", 0)
        print(f"  搜 {st['searched']} 次 · 腾讯 {req_t} · 高德 {max(0, req_a)} · "
              f"回 {st['returned']} 条 · 已在库 {st['in_lib']} · 重复 {st['dup']} · "
              f"类目排除 {st['excluded']} · 子景点 {st['subspot']} · 新增 {st['new']} · "
              f"候选 {n} → {total}")
        if st.get("switchedAmap"):
            print(f"  ★ 腾讯在第 {st.get('switchAtKw', 0) + 1} 个关键词处用尽 ⇒ "
                  f"本城剩余 {kw - st.get('switchAtKw', 0)} 个关键词改走高德（月配额）")
        if st.get("quotaHit"):
            print(f"  ★ 两家都不可用，本城停在 {st.get('doneKw', '?')}/{kw} 个关键词")

        led = load()
        led["scanned"][slug] = {"date": date.today().isoformat(), "cand": total,
                                "pages": pages, "req": req_t, "amap": max(0, req_a)}
        led["attempts"].pop(slug, None)
        save(led)
        done += 1
        left_after = _tencent_left()
        print(f"CITY_DONE={slug} req_tencent={req_t} req_amap={max(0, req_a)} "
              f"cand={total} left_after={left_after if left_after is not None else '?'}")

        if st.get("switchedAmap"):
            stop = "amap_tail"
            break

    left_end = _tencent_left()
    print(f"\nB_DONE cities={done} tencent_left={left_end if left_end is not None else '?'}"
          + ("（DRY 未执行，额度未消耗）" if dry else ""))
    if stop == "max_cities":
        print("NEXT=continue")
        print(f"STOP=max_cities（已跑 {done} 城，额度还有剩 ⇒ 再调一次 `run` 可继续）")
    else:
        print("NEXT=stop")
        print(f"STOP={stop}"
              + ("（腾讯当日额度已用尽，明天 0 点回满）" if stop == "tencent_exhausted"
                 else "（本城已由高德补完，当天不再开新城）" if stop == "amap_tail" else ""))
    return 0


#: 两家的 place_search 缓存是**两个文件**（键名恰好都是 `城名|关键词|页大小`）。
#: 清缓存必须两个都清 —— 只清腾讯，切高德后整城关键词会全命中高德旧缓存 ⇒ 零请求。
CACHES = (PLACE_CACHE, ROOT / "pipeline" / ".cache" / "amap_place.json")


def _clear_cache(slug: str, name: str, dry: bool = False) -> int:
    """清掉某城在两家的 place_search 缓存，返回清掉的键总数。"""
    total = 0
    prefix = f"{name}|"
    for path in CACHES:
        if not path.exists():
            continue
        try:
            cache = json.loads(path.read_text(encoding="utf-8"))
        except Exception:                              # noqa: BLE001
            continue
        hit = [k for k in cache if k.startswith(prefix)]
        total += len(hit)
        print(f"  {path.name}：命中 {len(hit)} 条 / 全库 {len(cache)} 条"
              + ("（DRY 未删）" if dry else ""))
        if dry or not hit:
            continue
        for k in hit:
            del cache[k]
        path.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    if total == 0:
        print(f"  两套缓存都没有 {name} 的键（首扫）")
    return total


def cmd_prepare(argv: list[str]) -> int:
    if not argv:
        print("用法: prepare <slug> [--dry]")
        return 2
    slug, dry = argv[0], "--dry" in argv

    name = next((n for s, n, _ in cities() if s == slug), None)
    if name is None:
        print(f"ERROR 未知城市 slug：{slug}")
        return 2
    _clear_cache(slug, name, dry=dry)
    return 0


def cmd_done(argv: list[str]) -> int:
    if not argv:
        print("用法: done <slug> [候选数]")
        return 2
    slug = argv[0]
    n = int(argv[1]) if len(argv) > 1 and argv[1].isdigit() else 0
    led = load()
    led["scanned"][slug] = {"date": date.today().isoformat(), "cand": n}
    led["attempts"].pop(slug, None)
    save(led)
    print(f"OK {slug} 已记账：{date.today().isoformat()} / 候选 {n}")
    return 0


def cmd_fail(argv: list[str]) -> int:
    if not argv:
        print("用法: fail <slug>")
        return 2
    slug = argv[0]
    led = load()
    n = int(led["attempts"].get(slug) or 0) + 1
    led["attempts"][slug] = n
    msg = f"{slug} 失败第 {n} 次"
    if n >= MAX_FAILS:
        led["skipped"][slug] = {"date": datetime.now().isoformat(timespec="seconds"),
                                "reason": f"连续失败 {n} 次"}
        msg += f" ⇒ 已放弃并列入 skipped（要恢复：status 看名字，从 skipped 里删掉）"
    save(led)
    print("OK " + msg)
    return 0


def cmd_status(argv: list[str]) -> int:
    led = load()
    today = date.today()
    never = empty = ok = 0
    oldest = None
    for slug, name, prov in cities():
        if slug in led["skipped"]:
            continue
        n, fdate = cand_info(slug)
        last = last_scan(slug, fdate, led)
        if last is None:
            never += 1
        elif n == 0:
            empty += 1
        else:
            ok += 1
            if oldest is None or last < oldest[0]:
                oldest = (last, slug, name)
    total = len([1 for s, _, _ in cities() if s not in led["skipped"]])
    print(f"城 {total} · 有候选 {ok} · 空候选 {empty} · 从未扫描 {never}")
    if oldest:
        age = (today - date.fromisoformat(oldest[0])).days
        print(f"最久未扫：{oldest[2]}({oldest[1]}) {oldest[0]} · {age} 天前")
    if led["skipped"]:
        print("已放弃：" + "、".join(f"{k}({v.get('reason','')})"
                                    for k, v in led["skipped"].items()))
    used, kw = quota_used_today(), _kw_count()
    left = (TENCENT_DAILY if used < 0 else max(0, TENCENT_DAILY - used))
    print(f"今日 place_search 已用 {used} / {TENCENT_DAILY}"
          f"（剩 {left} 次 ≈ {left // (2 * kw)} 座整城，`run` 会一路跑到 0）")
    return 0


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    cmd, rest = argv[0], argv[1:]
    table = {"next": cmd_next, "run": cmd_run, "prepare": cmd_prepare,
             "done": cmd_done, "fail": cmd_fail, "status": cmd_status}
    if cmd not in table:
        print(f"未知子命令：{cmd}\n{__doc__}")
        return 2
    return table[cmd](rest)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
