"""
pipeline/core/fetch.py —— 请求纪律与配额记账

★ 本文件**不能**叫 `http.py`：脚本以 `python step3_geocode.py` 直接运行时，
  Python 会把脚本所在目录塞进 `sys.path[0]`，于是 `import http` 命中本文件、
  遮蔽标准库 —— `urllib.request` 内部的 `import http.client` 会直接炸
  （ImportError: attempted relative import with no known parent package）。
  同理，`layout` / `env` / `build` 这类名字也要避开标准库模块名。

plans/04 第二节写死的请求纪律，全部落在这一个文件里，避免每个 step 各写一套：
  · 统一 UA
  · 1–3s 随机延迟（单域名串行）
  · 指数退避重试 3 次
  · 遵守 robots.txt（由调用方先判，见 step1）
  · 用量记账落 data/_generated/api-usage.json

腾讯 WebService 各接口都是 **10,000 次/日、每日重置**（不像高德只免费 1 年）。
脚本每天能跑的量有限，所以"今天各接口用了多少、还剩多少"必须能一句话回答出来 ——
这也是为什么要记账，而不是等配额打满了才发现。
"""

from __future__ import annotations

import json
import random
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path
from typing import Any

from .layout import CACHE, GENERATED, write_json

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36 TravelStrategy-Harvest/1.0"
)

LEDGER_PATH = GENERATED / "api-usage.json"

#: 腾讯各接口的日配额。None = 不计量（如 JSAPI key 不参与本记账）
#: ★★ `place_search` **实测只有 200/日**（2026-10-01：用到 200 次整就报 121）。
#:    之前这里写 10000，于是账本显示"200 / 10000"，看的人以为还剩 98% ——
#:    实际上那一刻已经一滴不剩了，取点链路正悄悄往高德（月配额）上掉。
#:    ⇒ 配额不是"文档上写的那个数"，是**你用的那个 key 实际有的额度**，
#:      拿不准就照控制台填；填错的代价比不填大。
TMAP_DAILY_QUOTA: dict[str, int] = {
    "geocoder": 10_000,
    "matrix": 10_000,       # ⚠️ 单位是"计算次数"，不是请求次数
    "district": 10_000,
    "place_search": 200,    # ★ 实测值，不是文档值
}

#: ★★ 高德是**月配额**（2026-10-01 用户确认），不是日配额。
#: 这一点决定了记账方式：高德用掉一点就少一点，**一天跑掉的量要等下个月才回来**。
#: 所以它是**稀缺的兜底资源** —— 腾讯还能用的时候不许动它（见 `geoprovider.py` 的路由）。
#: ★ **拿不准的一律写 None（"未知"）** —— 编一个假数比不写更危险：
#:   它会让人以为"还有余额"，而 None 在 `usage_report()` 里显示成没有分母，
#:   看的人自然会去控制台查真数。
AMAP_MONTHLY_QUOTA: dict[str, int | None] = {
    "amap_geocode": None,
    "amap_place": None,
    "amap_district": None,
    # ★★ `amap_entrance`（2026-10-08 补登记）。
    #   `amap.poi_entrance()` 一直在 `count_usage("amap_entrance")`，但这个桶
    #   **漏登记在这里** ⇒ `_bucket_of()` 走 fallback `return "daily"`
    #   ⇒ **高德的月用量被记进日桶、跨零点归零**。
    #   后果有两层，都很隐蔽：
    #     ① `usage_report()` 只遍历这张表 ⇒ 这个桶**根本不显示**，
    #        让人以为"没跑过入口采集"；而它其实已经跑了 1000+ 次。
    #     ② 跨零点后用量归零 ⇒ 月初会以为配额充足，实际上早就见底。
    #   教训：**新增记账桶必须同时登记进这张表**，否则周期判定会静默退回日桶。
    "amap_entrance": None,
}

#: 合并后的总账。`count_usage` / `remaining` 只认这一张
QUOTA: dict[str, int | None] = {**TMAP_DAILY_QUOTA, **AMAP_MONTHLY_QUOTA}

#: ★★ 每个接口的**重置周期**。`daily` 跨零点归零，`monthly` 跨月才归零。
#: 没有这一张表的话，换日会把高德的月用量一起清掉 ——
#: 结果是 `usage` 永远显示"这个月才用了几十次"，而实际早已见底。
QUOTA_PERIOD: dict[str, str] = {
    **{k: "daily" for k in TMAP_DAILY_QUOTA},
    **{k: "monthly" for k in AMAP_MONTHLY_QUOTA},
}

#: 兼容旧代码里的名字（它暗示高德是日配额，是错的；留着只为不破坏既有 import）
AMAP_DAILY_QUOTA = AMAP_MONTHLY_QUOTA
DAILY_QUOTA = QUOTA

#: 上次请求时间（按域名节流，同一个域名串行）
_last_hit: dict[str, float] = {}


# ── 用量记账 ──────────────────────────────────────────────────────

def _period_of(kind: str) -> str:
    """当前周期的字符串。`daily` → `2026-10-01`，`monthly` → `2026-10`。"""
    return date.today().isoformat() if kind == "daily" else date.today().strftime("%Y-%m")


def _bucket_of(api: str) -> str:
    """这个接口记在哪个桶里。没登记过的一律按日记（保守：日桶至少每天能回血）。"""
    return QUOTA_PERIOD.get(api, "daily")


def load_ledger() -> dict:
    """读账本。**旧账本（平面结构）会自动迁移**，不会把已记的量丢掉。

    旧结构：`{"date": "2026-09-30", "apis": {...}}`
    新结构：`{"daily": {"period": "...", "apis": {}}, "monthly": {...}}`
    """
    if not LEDGER_PATH.exists():
        return {}
    try:
        raw = json.loads(LEDGER_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    if "daily" in raw or "monthly" in raw:
        return raw
    if "apis" in raw:
        # 旧格式：平面账本。**按 QUOTA_PERIOD 拆进两个桶** ——
        # ★ 一股脑塞 daily 的话，高德已经用掉的量会被当成"日账"，
        #   明天零点一过就清零，等于把"这个月烧了多少"忘干净。
        out: dict[str, dict] = {}
        for api, entry in raw["apis"].items():
            kind = _bucket_of(api)
            out.setdefault(kind, {"period": raw.get("date"), "apis": {}})["apis"][api] = entry
        # 月桶的周期标记应该是月（`2026-10`），不是日 —— 否则下一天就被判成"过期"
        if "monthly" in out:
            out["monthly"]["period"] = raw.get("date", "")[:7] or _period_of("monthly")
        return out
    return {}


def save_ledger(ledger: dict) -> None:
    write_json(LEDGER_PATH, ledger)


def count_usage(api: str, cost: int = 1) -> dict:
    """记一次用量。**只重置自己那个周期桶** —— 腾讯跨零点归零，高德跨月才归零。

    ★★ 以前是整个账本一起清（`{"date": today, "apis": {}}`），高德的月用量
       **每天被抹掉一次** ⇒ `usage` 永远显示得很少，实际早已见底。

    返回本次记账后的账目快照，方便调用方判断是否该停（如矩阵单城上限告警）。
    """
    kind = _bucket_of(api)
    period = _period_of(kind)
    ledger = load_ledger()
    bucket = ledger.setdefault(kind, {"period": period, "apis": {}})
    if bucket.get("period") != period:
        bucket = {"period": period, "apis": {}}      # ★ 只清这一个桶
        ledger[kind] = bucket
    apis = bucket.setdefault("apis", {})
    entry = apis.setdefault(api, {"requests": 0, "units": 0, "quota": QUOTA.get(api)})
    entry["requests"] += 1
    entry["units"] += cost
    ledger["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    save_ledger(ledger)
    return {"api": api, **entry}


def remaining(api: str) -> int | None:
    """某接口本周期还剩多少额度。没有配额记录时返回 None（未知，不是无限）。"""
    kind = _bucket_of(api)
    period = _period_of(kind)
    ledger = load_ledger()
    bucket = ledger.get(kind)
    if not bucket or bucket.get("period") != period:
        return QUOTA.get(api)                        # 本周期还没用过 —— 满额
    entry = bucket.get("apis", {}).get(api)
    if entry is None:
        return QUOTA.get(api)
    # 同上：分母以现在的表为准（条目里的 quota 可能已被订正前的旧值污染）
    quota = QUOTA.get(api, entry.get("quota"))
    return None if quota is None else max(0, quota - entry.get("units", 0))


def usage_report() -> str:
    """用量报告 —— 跑之前先看一眼，别跑一半才发现余额不够。

    ★★ 日账与月账**分开列**：混在一起会让人以为高德也每天回血，
       从而放心大胆地烧掉一份"要等下个月才回来"的额度。
    """
    ledger = load_ledger()
    if not ledger:
        return f"今日尚无用量记录（{date.today()}）"

    def block(kind: str, title: str) -> list[str]:
        bucket = ledger.get(kind)
        if not bucket or not bucket.get("apis"):
            return []
        out = [f"{title}（周期 {bucket.get('period')}）："]
        for api, e in sorted(bucket["apis"].items()):
            # ★ 分母读**现在的** QUOTA 表，不读条目里存的快照：
            #   快照是记账那一刻抄下来的，一旦表被订正（如 place_search 10000→200）
            #   旧条目还写着旧数 ⇒ 报告会显示"203 / 10000"，看着还剩九成，其实已经见底。
            quota = QUOTA.get(api, e.get("quota"))
            tail = f" / {quota}" if quota else "（配额未知，去控制台查）"
            out.append(f"  {api:14s} {e['units']:>6d}{tail}（{e['requests']} 次请求）")
        return out

    lines = block("daily", "腾讯 · 每日重置")
    monthly = block("monthly", "★ 高德 · **每月**重置")
    if lines and monthly:
        lines.append("")
    lines += monthly
    if monthly:
        lines.append("  ⚠️ 高德用掉的要等下个月才回来 —— 腾讯还能用时不许动它")
    return "\n".join(lines) or f"今日尚无用量记录（{date.today()}）"


# ── 节流与重试 ────────────────────────────────────────────────────

def _throttle(host: str, min_delay: float = 1.0, max_delay: float = 3.0) -> None:
    """单域名串行节流：距上次请求不足则随机 sleep 补齐。**不并发打同一个域名**。"""
    last = _last_hit.get(host)
    if last is not None:
        wait = random.uniform(min_delay, max_delay) - (time.time() - last)
        if wait > 0:
            time.sleep(wait)
    _last_hit[host] = time.time()


def get_bytes(
    url: str,
    *,
    headers: dict[str, str] | None = None,
    timeout: float = 15.0,
    retries: int = 3,
    throttle: bool = True,
) -> bytes:
    """GET 拿原始字节，`4xx` 不重试（是请求本身错，重试没意义）。"""
    host = urllib.parse.urlsplit(url).netloc
    hdrs = {"User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"}
    hdrs.update(headers or {})

    last_err: Exception | None = None
    for attempt in range(retries):
        if throttle:
            _throttle(host)
        try:
            req = urllib.request.Request(url, headers=hdrs)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:          # 4xx：立刻放弃
            if 400 <= exc.code < 500 and exc.code != 429:
                raise RuntimeError(f"GET {url} → HTTP {exc.code}（客户端错误，不重试）") from exc
            last_err = exc
        except (urllib.error.URLError, TimeoutError) as exc:
            last_err = exc
        time.sleep(2 ** attempt)                        # 指数退避：1s, 2s, 4s
    raise RuntimeError(f"GET {url} 重试 {retries} 次仍失败：{last_err}")


def get_json(
    url: str,
    *,
    headers: dict[str, str] | None = None,
    timeout: float = 15.0,
    retries: int = 3,
    throttle: bool = True,
) -> Any:
    """GET + JSON 解析。"""
    raw = get_bytes(url, headers=headers, timeout=timeout, retries=retries, throttle=throttle)
    return json.loads(raw.decode("utf-8"))


def build_url(base: str, params: dict[str, Any]) -> str:
    """拼 URL。值为 None 的参数直接丢弃（避免把 'None' 当字符串传出去）。"""
    clean = {k: v for k, v in params.items() if v is not None}
    return f"{base}?{urllib.parse.urlencode(clean)}"


def head_ok(url: str, timeout: float = 8.0) -> tuple[bool, int]:
    """HEAD 探活 —— 图片巡检靠它（06 文档 6.2）。(是否健康, 状态码/0)。"""
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return 200 <= resp.status < 300, resp.status
    except urllib.error.HTTPError as exc:
        return False, exc.code
    except Exception:                                   # noqa: BLE001 —— 超时/不可达都算失败
        return False, 0


# ── 本地缓存 ──────────────────────────────────────────────────────

def cache_path(name: str) -> Path:
    p = CACHE / name
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def load_cache(name: str) -> dict:
    p = cache_path(name)
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}
    return {}


def save_cache(name: str, obj: dict) -> None:
    write_json(cache_path(name), obj)
