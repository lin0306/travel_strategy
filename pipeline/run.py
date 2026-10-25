#!/usr/bin/env python3
"""
pipeline/run.py —— 采集流水线入口（plans/04 第五节的落地）

    python pipeline/run.py usage              看今日 API 用量余额 + 取点现在走哪家图商
    python pipeline/run.py geo-check 北京 故宫博物院   真发请求，确认腾讯/高德都能取点
    python pipeline/run.py pipeline chengdu   跑完整流水线（③ ④ ⑦ + build）
    python pipeline/run.py geocode chengdu    只补坐标
    python pipeline/run.py entrance chengdu   只补「到达点 / 入口坐标」（高德 entr_location）
    python pipeline/run.py images chengdu     只取图
    python pipeline/run.py district           生成区划树
    python pipeline/run.py outline            抓「省级单位自身轮廓」（★ 高德，与腾讯不同的图商）
    python pipeline/run.py cities             抓「每个市自身轮廓」（★ 高德；按省打包，可断点续跑）
    python pipeline/run.py district-outline   抓「每个区自身轮廓」（★ 高德；按市打包，可断点续跑）
    python pipeline/run.py build [--strict] [--city=x]   组装 + 校验 + 生成索引

★ 在**仓库根**执行（`python pipeline/run.py`），不要在 pipeline/ 里执行 ——
  本脚本会把仓库根塞进 `sys.path`，`pipeline` 与 `schema` 两个包都从那一层解析。

## ★ 目录分层（2026-10-07）

顶层**只有本文件（唯一入口）**，其余按职责分六层：

    pipeline/
      run.py                    ← 唯一入口（你在顶层看到的就是它）
      core/       env · layout · fetch · fix_noise   基础设施，被全体依赖
      providers/  tmap · amap · geoprovider          图商适配（取点只走 geoprovider）
      geo/        citymeta · districts · districtless · labelgeo    区划与几何
      authoring/  seedlib · seed · images            采编稿与图源（人写数据 → 展开）
      steps/      step3 · 3b · 4 · 6 · 7 · 8 · 9 · 10 · 11        采集步骤
      assemble/   build                                组装与派生产物
      seeds/      83 城采编稿（纯数据）
    tools/        check_app（A–AQ 护栏）· check_seed · audit_suspects · rmdir_dist

★ 依赖方向单向向下：`core` 不import 任何人；`providers` / `geo` / `authoring`
  只 import `core`（+ `providers`）；`steps` import `core` + `providers` + `geo`；
  `assemble` 读以上各层的产物。

★ 步骤顺序不能乱（04 文档 6.3）：③ 地理编码 → ④ 取图 → ⑦ 区划树（读所有已入库 POI）。
  ★ **⑥ 通勤矩阵已移出流水线**（2026-10-06 决策）：通勤时长改为用户实际规划时
  **运行时**请求图商，采集期绝不预存（62 城 × 约 1600 对 × 3 方式要几百 MB）。
  通勤时长**运行时算**（2026-10-06 决策）；矩阵步骤已于 2026-10-25 彻底删除。

⚠️ ③④ 需要腾讯 WebService key；④ 额外需要 Unsplash / Pexels key（缺则降级到百度百科）；
   **`outline` / `cities` / `district-outline` 三条轮廓命令需要高德 Web 服务 key
   （`AMAP_WEB_KEY`）** —— 腾讯拿不到"省/市/区**自身**"的轮廓、下辖的轮廓又太粗，
   这几份只能换源（详见 `pipeline/providers/amap.py` 与 plans/10 §9）。
   它们都是**一次性静态数据、都不在全量流水线里**，抓一次就够；可反复重跑（自动续）。
   没配 key 会直接报错退出，不会带着占位符发一堆必然失败的请求。

## ★ 取点会自动换源（2026-10-01）

③ 地理编码**不再直接调腾讯**，改走 `pipeline/providers/geoprovider.py`：
腾讯优先，**腾讯日配额一尽（status 121）自动换高德**（同为 GCJ-02，坐标零转换）。
两家都没 key / 都受限才真的取不到。想固定用某家：`export GEO_PROVIDER=amap|tencent`。
"""

from __future__ import annotations

import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline.core.fetch import usage_report         # noqa: E402


def cmd_pipeline(args: list[str]) -> int:
    """完整流水线 ③ → ④ → ⑦ → 组装。`args`（城市名 / 开关）透传给需要它的步骤。

    ★ ⑥ 通勤矩阵**不在这里**（2026-10-06 决策）：通勤时长改为用户实际规划时**运行时**请求图商，
      采集期预计算62 城 × 约1600 对 × 3 方式要几百 MB，且半改会造成跨城口径不一致。
      通勤时长运行时算，构建期不再生成任何矩阵。
    """
    from pipeline.assemble import build
    from pipeline.steps import step3_geocode, step4_images, step7_district

    code = 0
    print("═══ ③ 地理编码（拿 GCJ-02 坐标）═══")
    code |= step3_geocode.main(list(args))
    print("\n═══ ④ 取图（Unsplash → Pexels → 百度百科）═══")
    code |= step4_images.main(list(args))
    print("\n═══ ⑦ 区划树 + 聚合计数 ═══")
    code |= step7_district.main([])
    print("\n═══ 组装 · 校验 · 生成索引 ═══")
    code |= build.main(list(args))
    return code


def main() -> int:
    argv = sys.argv[1:]
    cmd = argv[0] if argv else "build"
    rest = argv[1:]

    if cmd == "usage":
        from pipeline.providers import geoprovider
        print(usage_report())
        print()
        # ★ 光看用量还不够：配额打满那一刻真正的出路是"换一家图商"，
        #   所以这里必须把"现在走哪家、备胎还在不在"一起说出来。
        print(geoprovider.status_report())
        return 0

    if cmd == "geo-check":
        """★ 真发两个请求，确认腾讯与高德都能取点。

        为什么要有这个命令：key 有没有配、配的是不是「Web服务」类型、
        配额还剩没剩 —— 这三件事看代码看不出来，只有真跑一次才知道。
        新 key 配完先跑它，别等一座城跑到一半才发现。
        """
        from pipeline.providers import geoprovider
        region = rest[0] if rest else "北京"
        keyword = rest[1] if len(rest) > 1 else "故宫博物院"
        print(f"自检：在「{region}」查「{keyword}」\n")
        res = geoprovider.self_check(region=region, keyword=keyword)
        for name, r in res.items():
            mark = "✅" if r.get("ok") else "❌"
            if r.get("ok"):
                print(f"  {mark} {name:20s} → {r.get('title','')}")
            else:
                print(f"  {mark} {name:20s} → {r.get('error') or '无命中'}")
        # ★ 判"能不能跑"只看腾讯：高德是月配额的兜底，不该被拿来当日常通道。
        #   geocode 查不到店名是正常的（它认地址），所以两家各有一个通就算这家通。
        def up(vendor: str) -> bool:
            return any(r.get("ok") for k, r in res.items() if k.startswith(vendor + "/"))

        print()
        print(geoprovider.status_report())
        if not up("tencent"):
            print("\n⚠️ 腾讯两个接口都没命中 —— 若确认已耗尽，接下来取点会消耗**高德月配额**")
        return 0 if any(r.get("ok") for r in res.values()) else 1

    def passthrough(module: str):
        """把剩余参数**原样**交给子命令。

        ★ 2026-09-21 改：以前只取 `sys.argv[2]` 一个参数并拼成 `--city=x`，
          于是 `run.py build --strict` 的 `--strict` 会被当成城市名吞掉
          （`--city=--strict`）——`pnpm data:validate` 因此静默失效。
          现在参数怎么给就怎么传，子命令自己的 argparse / 手写解析说了算。
        """
        return lambda: __import__(module, fromlist=["main"]).main(rest)

    handlers = {
        "geocode": passthrough("pipeline.steps.step3_geocode"),
        # ★ 到达点 / 入口坐标采集（高德 entr_location，extensions=all）。
        #   不进 `pipeline` 全量流程 —— 它是独立补数的一步，幂等可反复重跑续采。
        "entrance": passthrough("pipeline.steps.step3b_entrance"),
        "images": passthrough("pipeline.steps.step4_images"),
        # ★ ⑥transit 已从 handlers 摘掉（2026-10-06 决策）：通勤时长改运行时算，不再预存。
        #   矩阵步骤已于 2026-10-25 删除（连 `transit.json` 的消费点一起）
        #   ——62 城 × 约1600 对 × 3 方式的矩阵要几百 MB，且当前 key 速率限制下根本跑不完。
        "district": passthrough("pipeline.steps.step7_district"),
        # ★ 省级「自身」轮廓（高德）。**不进 `pipeline` 全量流程** —— 那会让整条流水线
        #   依赖一把高德 key；它是一份静态数据，抓一次就够了。
        "outline": passthrough("pipeline.steps.step9_province_outline"),
        # ★ 市级「自身」轮廓（高德）。同上，静态数据；按省打包、可断点续跑。
        "cities": passthrough("pipeline.steps.step10_city_outlines"),
        # ★ 区级「自身」轮廓（高德）。同上；按"市文件键"打包、可断点续跑。
        #   为什么需要：腾讯给下辖区的轮廓是极度抽稀的（北京有 4 个区只有 4 个点 = 一个矩形），
        #   用户的原话是「这个区的轮廓，怎么方方正正的」。详见 step11 的文件头。
        "district-outline": passthrough("pipeline.steps.step11_district_outlines"),
        # ★ 点位发现（2026-10-08）：按类目关键字搜图商，找库里没有的景点。
        #   落 `data/_generated/discover/{城市}.json` 候选清单，**绝不直接入库**
        #   （实测搜索结果里混着行政地名/道路名/景区内部子景点，见该文件头）。
        #   不带城市= 全 83 城，但 place_search 只有 200/日，建议按城分批跑。
        "discover": passthrough("pipeline.steps.step12_discover"),
        "build": passthrough("pipeline.assemble.build"),
        "pipeline": lambda: cmd_pipeline(rest),
    }
    if cmd not in handlers:
        print(f"未知命令「{cmd}」。可选：{', '.join(['usage', 'geo-check', *handlers])}")
        return 2
    return handlers[cmd]()


if __name__ == "__main__":
    raise SystemExit(main())
