# 市级「自身」轮廓缓存 —— `{省adcode}.geo.json`
#
# 用途：放大到**市这一级**时画"市的面"（市标签 → 市的轮廓）。
#       读取入口：`web/app/common/data/bounds.ts` 的 `loadCityOwnBounds`
#                 → `loadBoundsForLevel('city', …)`（**优先读它**，缺了退回腾讯那份）。
#
# 生成：`python pipeline/run.py cities`（构建期跑一次，**运行时零请求**；可断点续跑）
#       源码：`pipeline/step10_city_outlines.py` + `pipeline/amap.py`
#
# ⚠️ 为什么不让腾讯那份就够：
#   1) **覆盖不全** —— 腾讯的 `districts/<省adcode>.geo.json` 只对"已收录城市所在的省"
#      生成过（`step7` 的既定策略，实测只有 **20/34** 份）⇒ 放大到市这一级时
#      **半个国家没有填充面**（用户 2026-09-30：「轮廓数据好像没抓全」）。
#   2) **精度不够** —— 腾讯给的是**各自独立抽稀**的粗轮廓（陕西 10 个市合计 2884 点，
#      平均 ~288 点/市 ⇒ 点距几公里，在 `z≈9.5` 是几十像素的硬折角）。
#   高德的 `config/district?subdistrict=0&extensions=all` 给的是**该市自身**的全精度轮廓。
#
# 🚨 合规：高德是持牌图商，边界经审图 ⇒ 不破红线的**实质**（"数据必须过审图"）。
#    **绝对禁止**第三方 GeoJSON（Natural Earth / GADM / geoBoundaries…的版图表达不可信）。
#    本节与 `districts/_README.md`、`provinces/_README.md` 同源，见 plans/10 第九节。
#
# ★ 坐标系：高德返回 **GCJ-02**，与腾讯底图 / 腾讯 District / 我们的 POI **同系**
#   ⇒ **零坐标转换**。（天地图是 CGCS2000≈WGS-84，要转，偏移 50~500m —— 在**市**这一级
#   会到 3~16px，肉眼可见，所以更不能用天地图。）
#
# 文件结构（与 districts/*.geo.json 完全同形，前端零改动）：
#   {
#     "adcode": "610000",                   ← 打包粒度是「省」
#     "name": "陕西省",
#     "source": "amap",
#     "level": "city",
#     "simplifyTolM": 100,                  ← 抽稀容差：市的面最深深到 z=9.5（1px≈177m）
#     "coordDecimals": 5,                   ← 5 位小数 ≈ 1.1m ≈ 0.006px
#     "polygons": { "610100": [ [lng,lat,…], … ], … },   ← key 就是**市 adcode**
#     "fetchedAt": "2026-10-01"
#   }
#
# ★ 打包粒度是「省」而不是「市」：市这一级一屏会显示很多个市，逐个市一个文件会变成
#   几十上百次请求；按省打包则一屏只读几个文件（与腾讯那份的加载模式一致）。
#
# ★ 7 个「自身就是市这一级」的省级单位（北京 / 天津 / 上海 / 重庆 / 中国台湾 /
#   中国香港 / 中国澳门）**不发请求** —— 它们的轮廓 == 省自身轮廓，
#   直接从 `provinces/<adcode>.geo.json` 抄过来。
#   （原来在市这一级对它取 `districts/<直辖市adcode>.geo.json`（key 是**区**），
#     与节点 adcode 对不上 ⇒ 这几格在市这一级压根没有面。）
