"""
pipeline 包 —— 采集流水线（plans/04 的七步）

★ 与展示工程彻底分家：本包只**写** `data/`，不 import `web/` 的任何东西；
  展示工程只**读** `data/`，不 import 本包。`data/` 是二者唯一的交接面。
  两侧共用的字段契约在仓库根的 `schema/`（`schema.py` ↔ `schema.ts`）。

模块职责：
    layout         data/ 目录布局的**单一真源**（路径只在这里拼）
    env            env 文件与 key 读取（含占位符兜底判断）
    fetch         请求纪律（UA / 节流 / 退避重试）+ 配额记账
    tmap          腾讯位置服务 WebService 封装（集中处理坐标反转等踩坑点）
    images        图片三级降级
    citymeta       城市元信息（中心点 / 区划树读取）
    seedlib        种子稿 → POI 的公共构造（大类归属由 `seedlib.CATEGORIES` 定死）
    seed           跑种子稿生成 city.json + POI 分片
    fix_noise      长中文里的英文噪声清理
    step3_geocode  给 POI 草稿补 GCJ-02 坐标
    step4_images   补图片
    step6_transit  通勤矩阵（构建期预计算，运行时零调用）
    step7_district 区划树 + 聚合计数（三级下钻地基）
    build          组装 / 校验 / 生成索引与来源清单

用法（在**仓库根**执行）：
    python pipeline/run.py pipeline chengdu    # 完整流水线 ③④⑥⑦ + 组装
    python pipeline/run.py build               # 组装 + 校验 + 生成索引
    python pipeline/run.py build --strict      # CI 模式：任一告警也算失败
"""

__all__ = ["layout", "env", "fetch", "tmap", "images", "citymeta", "seedlib", "build"]
