"""
pipeline/geoprovider.py —— **点位取坐标的唯一入口**（腾讯优先，配额尽自动换高德）

## 为什么需要这一层

以前的调用链是 `step3_geocode.py → tmap.geocode()`。腾讯日配额耗尽时（status 121）：

  · `geocode()` 返回 `None` —— 与"这个地址真的没命中"**一字不差**
  · 于是整座城剩下的 POI 会被一个个判成"没命中"，标 `needs_geocode`
  · 而真实原因是**配额没了**，换一家图商立刻就能取到

也就是说：**不换源的话，一次配额耗尽 = 一座城的数据当天报废**。
高德与腾讯同为 GCJ-02（坐标零转换），是成本最低的降级目标。

## 路由规则（就三条）

| 情形 | 走谁 |
|------|------|
| 正常 | 腾讯 |
| 腾讯**这一路**报过 121（日配额尽）| **高德**（只换这一路） |
| 高德没配 key / 这一路也报了额度受限 | 退回腾讯（并说明原因）|

★★ **"这一路" = 按接口分别判，不是按图商整体判**（2026-10-01 实测修正）：
  腾讯的 `place_search` 与 `geocoder` 是**两个独立的额度桶** ——
  实测 place_search 只有 **200/日**，geocoder 有 **10000/日**。
  早期版本用一个全局 bool，place_search 一满就把**整家腾讯**判死，
  于是连"还剩九千多次地址解析、一分钱不花"的请求也被发配给高德；
  而**高德是按月重置的**（用掉一点就少一点，要等下个月才回来）。
  ⇒ 判死粒度必须是接口：`quota_exhausted("place_search")` / `quota_exhausted("geocoder")`。

★ 判断依据是**进程内**的 `tmap.quota_exhausted(api)`：一旦该接口报过 121，
  后续请求**一次都不再发给它**（发出去也是白烧，且失败同样计费）。

★ 切换**只提示一次**：一座城 57 个 POI，每个打一行会把真正的失败信息淹掉。

## 手动干预

    export GEO_PROVIDER=amap       # 强制走高德（调试/对比两家召回时用）

## ⚠️ 不做什么

换源**只用于"取坐标"这一件事**。行政区的面（省/市/区轮廓）**不走这里** ——
它们是另一条链（step8/step9/step10），有各自的合规约束与缓存，混进来会让
"某个区的边界是哪来的"说不清楚。
"""

from __future__ import annotations

import os
from typing import Any

from pipeline.providers import amap, tmap

#: 强制指定图商的环境变量（`amap` / `tencent`）。空 = 自动
FORCE_VAR = "GEO_PROVIDER"

#: 两家都试过且都不可用时的兜底提示
_switch_noted = False
_amap_dead_reason = ""


def _forced() -> str:
    """环境变量强制指定的图商（小写），没有则空串。"""
    return (os.environ.get(FORCE_VAR) or "").strip().lower()


def _amap_usable(api: str | None = None) -> tuple[bool, str]:
    """高德现在能不能用。返回 (可用?, 不可用的原因)。

    ★ 只检查"能不能发请求"，**不发请求** —— 探测本身也要花额度。

    ★★ `api` 传接口名做**按接口**判断（`amap_geocode` / `amap_place`）。
       不传 = "两个取点接口全死"的整体判断。
       高德是**月配额**，一个接口受限不该牵连另一个。
    """
    global _amap_dead_reason
    if _amap_dead_reason:
        return False, _amap_dead_reason
    if amap.quota_exhausted(api):
        return False, "高德额度/权限受限（已报 infocode）"
    try:
        amap.web_key()
    except amap.MissingKeyError:
        _amap_dead_reason = "未配置 AMAP_WEB_KEY"
        return False, _amap_dead_reason
    return True, ""


def _note_switch(reason: str) -> None:
    """切换提示只打一次。"""
    global _switch_noted
    if _switch_noted:
        return
    _switch_noted = True
    print(f"  🔁 取点改用高德 —— {reason}（想固定用某家：export {FORCE_VAR}=amap|tencent）",
          flush=True)


def active_provider() -> str:
    """当前这一刻会走哪家：`'tencent'` / `'amap'`。诊断与测试用。"""
    forced = _forced()
    if forced in ("amap", "tencent"):
        return forced
    # 不传参 = 腾讯两个取点接口**全**死了才算"这家不行"
    if tmap.quota_exhausted() and _amap_usable()[0]:
        return "amap"
    return "tencent"


def geocode(address: str, *, region: str | None = None, use_cache: bool = True) -> dict | None:
    """地址/地名 → 坐标。**签名与 `tmap.geocode()` 完全一致**，调用方可原地替换。

    两家返回的字段已对齐（`lng/lat/title/address/province/city/district/adcode`），
    所以调用方的判据（同城、名称匹配）对两家一视同仁。
    """
    forced = _forced()
    if forced == "amap":
        ok, why = _amap_usable("amap_geocode")
        if ok:
            return amap.geocode(address, region=region, use_cache=use_cache)
        _note_switch(f"高德不可用（{why}）")
        return tmap.geocode(address, region=region, use_cache=use_cache)
    if forced == "tencent":
        return tmap.geocode(address, region=region, use_cache=use_cache)

    # ★ 只问"地址解析"这一个接口满没满 —— 地点搜索满了不影响它
    if not tmap.quota_exhausted("geocoder"):
        return tmap.geocode(address, region=region, use_cache=use_cache)
    # 腾讯地址解析额度尽了 —— 换高德
    ok, why = _amap_usable("amap_geocode")
    if not ok:
        print(f"  ⚠️ 两家都不可用：腾讯地址解析日配额尽 + {why} —— 本次返回空", flush=True)
        return None
    _note_switch("腾讯地址解析日配额已耗尽")
    return amap.geocode(address, region=region, use_cache=use_cache)


def place_search(
    keyword: str, *, region: str, page_size: int = 10, use_cache: bool = True
) -> list[dict]:
    """关键字搜地点。**签名与 `tmap.place_search()` 完全一致**。"""
    forced = _forced()
    if forced == "amap":
        ok, why = _amap_usable("amap_place")
        if ok:
            return amap.place_search(keyword, region=region, page_size=page_size,
                                     use_cache=use_cache)
        _note_switch(f"高德不可用（{why}）")
        return tmap.place_search(keyword, region=region, page_size=page_size, use_cache=use_cache)
    if forced == "tencent":
        return tmap.place_search(keyword, region=region, page_size=page_size, use_cache=use_cache)

    # ★ 只问"地点搜索"这一个接口 —— 它实测只有 200/日，是最先见底的那个
    if not tmap.quota_exhausted("place_search"):
        return tmap.place_search(keyword, region=region, page_size=page_size, use_cache=use_cache)
    ok, why = _amap_usable("amap_place")
    if not ok:
        print(f"  ⚠️ 两家都不可用：腾讯地点搜索日配额尽 + {why} —— 本次返回空", flush=True)
        return []
    _note_switch("腾讯地点搜索日配额已耗尽（地址解析不受影响，仍走腾讯）")
    return amap.place_search(keyword, region=region, page_size=page_size, use_cache=use_cache)


def ensure_ready() -> tuple[bool, str]:
    """跑之前先问一句：**两家至少有一家能用吗**。

    返回 `(能不能跑, 不能跑的原因)`。为什么要这一步：缺 key 时 `web_key()` 会抛错，
    但那是**跑到第一个请求才抛** —— 一座城跑到第 30 个才发现没 key，
    前面的时间就白等了（每个请求还带 1–3s 节流）。
    """
    reasons: list[str] = []
    try:
        tmap.web_key()
        return True, ""
    except tmap.MissingKeyError:
        reasons.append("未配置 TMAP_WEB_KEY")
    ok, why = _amap_usable()
    if ok:
        return True, ""                     # 腾讯没 key，但高德能顶上
    reasons.append(why)
    return False, "；".join(reasons)


def status_report() -> str:
    """一句话说清"现在取点走哪家、另一家备着没有"。给 `run.py usage` 用。

    ★★ **逐接口**列状态。整体写"腾讯：可用"会盖住"地点搜索已满、只剩地址解析"
       这个最常见也最要紧的半死状态 —— 它决定了这一轮取点会不会去烧高德的月额度。
    """
    def t_line(api: str, label: str) -> str:
        return f"    {label}：{'日配额已耗尽' if tmap.quota_exhausted(api) else '可用'}"

    t_state = "\n".join([
        t_line("place_search", "地点搜索（200/日，最先见底）"),
        t_line("geocoder", "地址解析（10000/日）"),
    ])
    ok, why = _amap_usable()
    a_state = "可用" if ok else f"不可用（{why}）"
    forced = _forced()
    tail = f"（已用 {FORCE_VAR} 强制指定）" if forced in ("amap", "tencent") else ""
    return (
        f"取点图商：当前 **{active_provider()}**{tail}\n"
        f"  腾讯 WebService：\n{t_state}\n"
        f"  高德 WebService：{a_state}"
    )


def self_check(region: str = "北京", keyword: str = "故宫博物院") -> dict[str, Any]:
    """★ 冒烟自检：**真发请求**，确认两家都通。返回各家的命中结果。

    为什么要真发：配置对不对、key 类型对不对（Web服务 vs JS API）、
    配额还剩没剩 —— 这三件事光看代码看不出来，只有真跑一次才知道。

    ★★ **两个接口都要测**，而且要看清各自的语义：
      · `geocode`（地址解析）—— 喂**地址**，对店名/别名天生不敏感
      · `place_search`（关键字搜索）—— 喂**店名/景点名**
    早期版本只拿 `geocode` 去查店名，腾讯必然"无命中"，于是报"腾讯不可用" ——
    这个误报的代价是：**白白把请求发配给高德，烧掉按月重置的那份额度**。
    """
    out: dict[str, Any] = {}
    for label, fn_name in (("geocode", "geocode"), ("place_search", "place_search")):
        for name, mod in (("tencent", tmap), ("amap", amap)):
            try:
                fn = getattr(mod, fn_name)
                if fn_name == "place_search":
                    res = fn(keyword, region=region, page_size=3, use_cache=False)
                    ok, brief = bool(res), (res[0]["title"] if res else "")
                else:
                    hit = fn(keyword, region=region, use_cache=False)
                    ok, brief = hit is not None, (hit["title"] if hit else "")
                out[f"{name}/{label}"] = {"ok": ok, "title": brief}
            except Exception as exc:                    # noqa: BLE001 —— 自检要能报出任何错
                out[f"{name}/{label}"] = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
    return out


__all__ = [
    "active_provider",
    "ensure_ready",
    "geocode",
    "place_search",
    "self_check",
    "status_report",
]
