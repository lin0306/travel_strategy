#!/usr/bin/env python3
"""
tools/review_images.py —— **二次审查**：采集完，图入库前必须过的那一关（2026-10-29）

## 为什么要有这道关卡

用户 2026-10-28：「抓图的逻辑有点问题……是不是只抓图，没有针对图片内容进行分析」；
次日又补了一句：**「数据采集完，你得做二次的审查，抓完直接入库，数据上可能会有问题的」**。

起因是西安青龙寺的详情页：三张图里一张是对街拍的路景、一张是地铁站的照片，
只有一张真的是那座寺。Wikimedia 按**文字**相关度返回，地铁站文件标题里同时有
「青龙寺」和「西安」，排第一位 —— 采集侧原样收下，中间没有任何"看一眼"的环节。

`pipeline/authoring/image_filter.py` 只拦得掉"说得明白的错"（地铁站 / 地图 / 路牌 /
坐标十万八千里）。**"标题完全对、画面是别的东西"只能看图**，这件事由本工具 + 视觉复核完成。

## 流程（两趟命令，中间是"人/智能体看图"）

    ① python tools/review_images.py sheet  <city>      抓缩略图 + 拼对照表图 + 出清单
    ② （读 `sheets/*.png`，逐格判定，写 `verdicts.jsonl`：`{"idx": 0, "verdict": "ok|reject"}`）
    ③ python tools/review_images.py apply  <city>      按判定删图 / 保图 / 打 review 标记

★ 判定按 **URL 去重缓存**（`verdicts-cache.jsonl`）：同一张图在别的城市/别的点位
  再出现不必重看。**reject 的图永远记住** —— 不记的话下轮重抓又会抓回来。

★ 删图后不补图：剩下的就是剩下的（可能 0 张 → `_noImage`，前端占位卡）。
  补图要重新走 step4，那是另一趟，不要在这里顺手做（顺手补会把新图绕过审查）。
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "_tmp" / "review"

#: 滚动进度账本（哪座城重抓过 / 哪座城审过）。**与 discover-intake.json 分开**，
#: 两件事的进度不能互相污染。
LEDGER = ROOT / ".workbuddy" / "memory" / "image-rebuild.json"

#: 与前端同款镜像（`web/app/common/data/imageMirror.ts`）—— Wikimedia 原图国内直连超时
MIRROR = "https://wsrv.nl/"
MIRROR_HOSTS = ("upload.wikimedia.org", "thumb.wikimedia.org")
#: ★★ UA 必须带**可联系的 URL**：2026-10-31 实测同一张图，
#:    `…(local; low-frequency)` → **HTTP 429**、不带 UA → **403**、带 URL → **200**。
#:    旧 UA 让敦煌 7 格（书法手稿、玉门关信息牌）稳定失败，人却以为"这些格子本来就没图"。
UA = {"User-Agent": "travel-strategy-image-review/1.0 "
                    "(https://www.mediawiki.org/wiki/API:Etiquette; local review tool)"}

TILE = 300
COLS = 4
ROWS = 5


def mirror(url: str, width: int = 400) -> str:
    """与前端 `mirrorUrl()` 同口径：整体 percent-encode，去掉协议。"""
    raw = url.split("?", 1)[0]
    host = raw.split("/")[2].lower() if raw.startswith("http") else ""
    if host in MIRROR_HOSTS:
        raw = raw.split("://", 1)[-1]
        return f"{MIRROR}?url={urllib.parse.quote(raw, safe='')}&w={width}&output=jpg&q=80"
    return url


def poi_paths(city: str) -> list[Path]:
    hits = sorted((ROOT / "data" / "cities").glob(f"*/*/pois/*/*.json"))
    if city:
        hits = [p for p in hits if f"/{city}/" in p.as_posix()]
    return hits


def direct_thumb(url: str, width: int = TILE) -> str:
    """兜底 URL：直连 Wikimedia 官方缩略图（不走镜像）。

    ★★ 2026-10-31 新增，起因是香格里拉：13 格在 wsrv.nl 上稳定失败
    （`Bundesarchiv` 1938 年德国探险队档案照、`in Tomba` 版画等），
    对照表里只显示「[下载失败]」，而**城市照样算审过** —— 那 13 张从来没被人眼看过，
    等于"审了 76 张"里有 13 张是假的。实测试直连官方缩略图 13/13 全部取回。

    ★ 只对 commons 原图有效；其他图床（或已带 `/thumb/` 的）返回空串。
    """
    raw = url.split("?", 1)[0]
    host = raw.split("/")[2].lower() if raw.startswith("http") else ""
    if host not in MIRROR_HOSTS or "/wikipedia/commons/" not in raw or "/thumb/" in raw:
        return ""
    prefix, rest = raw.split("/wikipedia/commons/", 1)
    return f"{prefix}/wikipedia/commons/thumb/{rest}/{width}px-{rest.rsplit('/', 1)[-1]}"


def fetch(url: str, dest: Path) -> bool:
    """★ 重试 2 次：镜像偶发超时会留空格子（西安首轮 57 张里空了 7 张）。

    ★ 镜像全部失败后**必须再试直连**（`direct_thumb`）：镜像对部分历史档案照是
    稳定失败而不是抖动，只重试镜像等于永远看不到那几张。
    """
    if dest.exists() and dest.stat().st_size > 1024:
        return True
    last = ""
    dt = direct_thumb(url)
    #: ★ 直连缩略图也有 400 的（腾冲实测：`Gaoligongshan IMGP5778.jpeg` 三种宽度全 400，
    #:   但原图 200）。所以最后一档是**原图**——审图只要看得清，体积大点无所谓。
    raw = url.split("?", 1)[0]
    #: 调度表而不是"循环里 if"：镜像抖动要多试几次，直连缩略图与**原图**各兜一档。
    #: （原图必须留：`Gaoligongshan IMGP5778.jpeg` 直连缩略图三种宽度全 400，原图 200。）
    plan = [mirror(url, TILE)] * 3 + ([dt] if dt else []) + [raw, raw]
    for cand in plan:
        try:
            req = urllib.request.Request(cand, headers=UA)
            data = urllib.request.urlopen(req, timeout=25).read()
            if len(data) >= 1024:
                dest.write_bytes(data)
                return True
            last = f"too small({len(data)}B)"
        except Exception as e:                  # 取不到就当"没图"，整批不中断
            last = e.__class__.__name__
    print(f"    ! 取图失败 {url[:70]}… {last}")
    return False


def build_sheets(city: str, *, refresh: bool = False, covers_only: bool = False) -> int:
    out = OUT_DIR / city
    cache_dir = out / "thumbs"
    cache_dir.mkdir(parents=True, exist_ok=True)
    if refresh:
        for f in cache_dir.glob("*.jpg"):
            f.unlink()
    scope = "covers" if covers_only else "all"

    entries: list[dict] = []
    for path in poi_paths(city):
        poi = json.loads(path.read_text(encoding="utf-8"))
        for i, im in enumerate(poi.get("images") or []):
            # ★ 封面优先：详情页第一眼就是它，错图的伤害最大 —— 先只审封面，
            #   全量审查（i > 0）可以用同一套命令再来一遍。
            if covers_only and i > 0:
                continue
            entries.append({
                "idx": len(entries),
                "file": path.relative_to(ROOT).as_posix(),
                "imageIndex": i,
                "poi": poi.get("name", ""),
                "url": im.get("url", ""),
                "alt": im.get("alt", ""),
                "source": (im.get("credit") or {}).get("source", ""),
            })

    if not entries:
        print("没有待审的图")
        return 0

    print(f"共 {len(entries)} 张待审（scope={scope}），下载缩略图…")
    # 并发数可用 REVIEW_WORKERS 覆盖：剩 27 城 2200+ 张时 4 并发要跑 9 小时，8 并发约减半。
    # 别超过 12——公共镜像会 429，表现为「取图失败」涨、速度反而降。
    with ThreadPoolExecutor(max_workers=int(os.environ.get("REVIEW_WORKERS", "8"))) as pool:
        list(pool.map(lambda e: fetch(e["url"], cache_dir / f"{scope}-{e['idx']}.jpg"), entries))

    # ★★ 仍失败的格子必须**喊出来**：空格子 = 这张没被人眼看过，
    #    静默带过的话「审完 X 张」就是假的（香格里拉 76 格里 13 格是假的）。
    lost = [e for e in entries if not (cache_dir / f"{scope}-{e['idx']}.jpg").exists()]
    if lost:
        print(f"★★ 仍有 {len(lost)} 格取不到图（**这些格子没看过，不能算审过**）：")
        for e in lost[:20]:
            print(f"     #{e['idx']:<3} {e['poi'][:12]:14s} {(e['alt'] or '')[:48]}")
        print("   处置：`sheet <city> --refresh` 再跑一次；仍不行就单独下载原图看，"
              "**不要**把该城记进 reviewed。")

    sheets: list[Path] = []
    per = COLS * ROWS
    for s in range(0, len(entries), per):
        chunk = entries[s:s + per]
        rows = min(ROWS, (len(chunk) + COLS - 1) // COLS)
        w, h = COLS * (TILE + 4) + 4, rows * (TILE + 24) + 4
        canvas = Image.new("RGB", (w, h), (245, 245, 245))
        draw = ImageDraw.Draw(canvas)
        for k, e in enumerate(chunk):
            c, r = k % COLS, k // COLS
            x, y = 4 + c * (TILE + 4), 4 + r * (TILE + 24)
            p = cache_dir / f"{scope}-{e['idx']}.jpg"
            if p.exists():
                try:
                    img = Image.open(io.BytesIO(p.read_bytes())).convert("RGB")
                    img.thumbnail((TILE, TILE))
                    canvas.paste(img, (x, y))
                except Exception:
                    pass
            else:
                draw.text((x + 6, y + 6), "[下载失败]", fill=(200, 30, 30))
            # ★ 序号**烧进图里**（左上角白底大号）。只在格下方写小字时，读图的一方
            #   会把格与序号错位（长春首审实测：视觉模型把 #5 读成 #1），
            #   序号错位 = 删错图，等于审查白做。
            draw.rectangle((x + 4, y + 4, x + 46, y + 26), fill=(255, 255, 255))
            draw.text((x + 9, y + 9), f"#{e['idx']}", fill=(0, 0, 0))
            draw.text((x + 3, y + TILE + 4), f"#{e['idx']} {e['poi'][:14]}", fill=(20, 20, 20))
        sp = out / f"sheet-{scope}-{len(sheets):02d}.png"
        canvas.save(sp)
        sheets.append(sp)

    # ★★ manifest 必须按 scope 分文件：covers 与 all 的 idx 编号不同，
    #    共用一个 manifest.json 会让 apply 按错序号删图（删掉对的、留下错的）。
    (out / f"manifest-{scope}.json").write_text(
        json.dumps(entries, ensure_ascii=False, indent=1), encoding="utf-8")
    (out / "manifest.json").write_text(
        json.dumps(entries, ensure_ascii=False, indent=1), encoding="utf-8")  # 兼容旧用法
    print(f"对照表 {len(sheets)} 张 → {out}")
    for sp in sheets:
        print("   ", sp)
    return len(entries)


def all_cities() -> list[tuple[str, int]]:
    """(城市 slug, POI 数)，顺序稳定（按目录遍历排序）—— 保证滚动顺序可复现。"""
    counts: dict[str, int] = {}
    for p in sorted((ROOT / "data" / "cities").glob("*/*/pois/*/*.json")):
        # ★ 必须 relative_to：绝对路径切下标会切到盘符/工作区名上（Windows 尤其）
        slug = p.relative_to(ROOT).as_posix().split("/")[3]
        counts[slug] = counts.get(slug, 0) + 1
    return sorted(counts.items())


def read_ledger() -> dict:
    if LEDGER.exists():
        try:
            data = json.loads(LEDGER.read_text(encoding="utf-8"))
            data.setdefault("refetched", [])
            data.setdefault("reviewed", [])
            return data
        except json.JSONDecodeError:
            pass
    return {"refetched": [], "reviewed": []}


def cmd_next(count: int) -> int:
    """打印接下来该重抓的 N 座城（没进过 `refetched` 的，POI 少的先做）。"""
    led = read_ledger()
    done = set(led["refetched"])
    todo = [(slug, n) for slug, n in all_cities() if slug not in done]
    todo.sort(key=lambda kv: (kv[1], kv[0]))          # 小城先做：快、且早点暴露问题
    total = sum(n for _s, n in all_cities())
    done_n = sum(n for s, n in all_cities() if s in done)
    print(f"进度：重抓 {len(done)}/{len(all_cities())} 城（{done_n}/{total} POI）")
    print("本批：")
    for slug, n in todo[:count]:
        print(f"  {slug}\t{n}")
    if not todo[:count]:
        print("  （全部重抓完了，重置账本可再跑一轮）")
    return 0


def cmd_status() -> int:
    led = read_ledger()
    ref, rev = set(led["refetched"]), set(led["reviewed"])
    rows = [(s, n, s in ref, s in rev) for s, n in all_cities()]
    print(f"{'城市':<16}{'POI':>5}  重抓  审查")
    for slug, n, a, b in rows:
        print(f"{slug:<16}{n:>5}  {'✓' if a else '·':<4}  {'✓' if b else '·'}")
    print(f"\n重抓 {sum(1 for r in rows if r[2])}/{len(rows)} · 审查 {sum(1 for r in rows if r[3])}/{len(rows)}")
    pending = [r[0] for r in rows if r[2] and not r[3]]
    if pending:
        print("★ 已重抓但还没审（图没过审查就不许 build）：", ", ".join(pending))
    return 0


def load_cache() -> dict[str, str]:
    p = OUT_DIR / "verdicts-cache.jsonl"
    if not p.exists():
        return {}
    out: dict[str, str] = {}
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if row.get("url"):
            out[row["url"]] = row["verdict"]
    return out


def apply_verdicts(city: str, *, dry: bool = False, scope: str = "covers") -> int:
    """按 `verdicts-<scope>.jsonl` 删图。★ 只删不补 —— 补图要走 step4 再过一遍审查。"""
    out = OUT_DIR / city
    mpath = out / f"manifest-{scope}.json"
    if not mpath.exists():
        mpath = out / "manifest.json"          # 兼容旧用法
    if not mpath.exists():
        print(f"没有 {mpath} —— 先跑 `sheet {city}`")
        return 0
    manifest = json.loads(mpath.read_text(encoding="utf-8"))
    vpath = out / f"verdicts-{scope}.jsonl"
    if not vpath.exists():
        vpath = out / "verdicts.jsonl"
    if not vpath.exists():
        print(f"没有 {vpath}")
        return 0
    today = datetime.now().strftime("%Y-%m-%d")

    verdicts: dict[int, str] = {}
    for line in vpath.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("//"):
            continue
        row = json.loads(line)
        verdicts[int(row["idx"])] = row["verdict"]

    cache = load_cache()
    by_file: dict[str, list[tuple[int, int, str]]] = {}
    # ★ 每个文件在出表那一刻有几张图：必须按**全部** manifest 行算，不能按"带判定的行"算。
    #   2026-10-31 乐山实测：只判了某点位最后一张（如 #6 微缩模型），expect 就被算成 5，
    #   实际 6 张 ⇒ 误报"表格已过期"，5 个点位整批跳过回写、一句报错都没有（只印了跳过）。
    full_of: dict[str, dict[int, str]] = {}
    for e in manifest:
        full_of.setdefault(e["file"], {})[e["imageIndex"]] = e["url"]
        v = verdicts.get(e["idx"]) or cache.get(e["url"])
        if not v:
            continue
        by_file.setdefault(e["file"], []).append((e["imageIndex"], e["idx"], v))

    changed = 0
    stale = 0
    for rel, rows in by_file.items():
        path = ROOT / rel
        poi = json.loads(path.read_text(encoding="utf-8"))
        keep_i = {i for i, _x, v in rows if v == "reject"}
        imgs = poi.get("images") or []
        if not keep_i:
            continue
        # ★★ 过期检测：manifest 的 imageIndex 是**出表那一刻**的序号。apply 之后图变少了，
        #    再跑一次 apply 就会按旧序号删到**别的图**上（零报错、删完还挺像那么回事）。
        #    两条判据：① 出表时的总张数超过现在（图已经变少）；② 序号上的 URL 对不上
        #    （图还在但顺序被洗过 —— 重抓/换图都会导致）。任一条命中就拒绝动这个文件。
        snapshot = full_of.get(rel) or {}
        expect = max(snapshot) + 1 if snapshot else 0
        misaligned = [
            i for i in (i for i, _x, _v in rows)
            if i < len(imgs) and snapshot.get(i) and (imgs[i].get("url") or "") != snapshot[i]
        ]
        if len(imgs) != expect or misaligned:
            why = (f"manifest 记 {expect} 张，实际 {len(imgs)} 张" if len(imgs) != expect
                   else f"序号 {sorted(misaligned)[:4]} 上的 URL 已对不上")
            print(f"     ! 跳过 {Path(rel).stem}：{why}"
                  f"（表格已过期，先 `sheet {city} --refresh` 再看）")
            stale += 1
            continue
        kept = []
        for i, im in enumerate(imgs):
            if i in keep_i:
                continue
            verdicts_i = next((v for ii, _x, v in rows if ii == i), None)
            if verdicts_i:
                im["review"] = {"verdict": verdicts_i, "by": "agent-vision", "at": today}
            kept.append(im)
        poi["images"] = kept
        if not kept:
            poi["_noImage"] = True       # ★ 全删光了要显式标记（build 靠它给 WARN）
        else:
            poi.pop("_noImage", None)
        poi["coverIndex"] = 0
        poi["updatedAt"] = today        # ★ 改业务字段必须写（build 的缓存/增量靠它）
        if not dry:
            path.write_text(json.dumps(poi, ensure_ascii=False, indent=2) + "\n",
                            encoding="utf-8")
        changed += 1
        # ★★ 逐条印出被删的图：序号错位时这是**唯一能当场看出来的地方**。
        #    2026-10-31 福州实测：判据里手写 #{92,93} 想删万福寺，实际那两格是
        #    华林寺的真图（万福寺是 #94-#99），apply 只报"改动 16 个 POI"，
        #    一句都没提华林寺，等回头核对才发现删错。删掉的必须自报家门。
        rm = [im.get("alt") or im.get("url", "") for i, im in enumerate(imgs) if i in keep_i]
        if rm:
            head = poi.get("name") or Path(rel).stem
            for a in rm[:6]:
                print(f"     - {head}: {a[:64]}")
            if len(rm) > 6:
                print(f"     - {head}: …另 {len(rm) - 6} 张")

    # 判定写进全局缓存（按 URL），下次不必重看
    lines = [json.dumps({"url": e["url"], "verdict": v}, ensure_ascii=False)
             for e in manifest for v in [verdicts.get(e["idx"])] if v]
    if lines and not dry:
        with (OUT_DIR / "verdicts-cache.jsonl").open("a", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")

    print(f"{'[演练] ' if dry else ''}改动 {changed} 个 POI（删 {sum(1 for r in by_file.values() for _ in r if True)} 条判定）")
    return changed


def main() -> int:
    ap = argparse.ArgumentParser(description="图片二次审查（图入库前必经）")
    ap.add_argument("mode", choices=("sheet", "apply", "next", "status"))
    ap.add_argument("city", nargs="?", default="", help="城市 slug，如 xian / chengdu")
    ap.add_argument("--refresh", action="store_true", help="重下缩略图")
    ap.add_argument("--covers", action="store_true", help="只审每个点位的封面（第 0 张）")
    ap.add_argument("--all", action="store_true", help="apply 时按全量清单（默认按封面清单）")
    ap.add_argument("--count", type=int, default=2, help="next 模式返回几座城")
    ap.add_argument("--dry", action="store_true", help="只打印，不写文件")
    a = ap.parse_args()
    if a.mode == "sheet":
        build_sheets(a.city, refresh=a.refresh, covers_only=a.covers)
    elif a.mode == "apply":
        apply_verdicts(a.city, dry=a.dry, scope="all" if a.all else "covers")
    elif a.mode == "next":
        return cmd_next(a.count)
    else:
        return cmd_status()
    return 0


if __name__ == "__main__":
    sys.exit(main())
