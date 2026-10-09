"""
pipeline/steps/ —— **采集步骤层**：一个文件 = 一步，编号即执行序

| 模块 | 步骤 | 备注 |
|------|------|------|
| `step3_geocode.py` | ③ 地理编码 | 走 `providers.geoprovider`，产出 `location.point` |
| `step3b_entrance.py` | ③b 到达点/入口 | 高德 `entr_location`（v3），不跑会让路线穿园 |
| `step4_images.py` | ④ 取图 | 外链、零文件；降级链 Unsplash → Pexels → 百度百科 |
| `step6_transit.py` | ⑥ 通勤矩阵 | ★ **死链路** —— 已改为运行时算，绝不预存。见 README |
| `step7_district.py` | ⑦ 区划树 + 聚合计数 | `district-tree.json` 的唯一产出 |
| `step8_subdistricts.py` | ⑧ 市辖区（区级） | 第四级（区）数据与边界 |
| `step9_province_outline.py` | ⑨ 省级自身轮廓 | ★ 换源到高德 |
| `step10_city_outlines.py` | ⑩ 市级自身轮廓 | ★ 换源到高德，按省打包 |
| `step11_district_outlines.py` | ⑪ 区级自身轮廓 | ★ 换源到高德，按市打包 |

★ 编号不连续（没有 step1/2/5）：① 搜索 / ② 抽取 = `seeds/` 里的采编稿本身，
  `seed.py` 就是那两步；⑤ 从未存在过。**编号只表示"历史顺序"，不是计数器** ——
  9/10/11 是后补的轮廓换源，不是"第七个采集步骤"。

★ ⑨⑩⑪ **不进 `run.py pipeline` 全量流程** —— 那会让整条流水线依赖一把高德 key；
  它们是一次性静态数据，抓一次就够（可反复重跑，自动断点续）。
"""