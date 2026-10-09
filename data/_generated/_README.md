# 全部脚本生成，禁止手改。
#
# district-tree.json      三级区划树 + 每级 POI 计数（下钻地基，不含边界）
# district-index.json     全国 2894 个区的索引（[adcode, 名, lng, lat, poiCount]）
# subdistricts/<市>.json  一座城市的区列表（区级数据按市拆开，走进某座城才读）
# districts/<键>.geo.json **腾讯**的粗轮廓（区/市；逐级"兜底"用的就是这一份）
# provinces/<省>.geo.json **高德**：省「自身」轮廓（腾讯没有这个接口）
# cities/<省>.geo.json    **高德**：各市「自身」轮廓，按省打包
# districts-own/<市>.geo.json **高德**：各区「自身」轮廓，按市打包（直辖市/特区键 = 省码）
# search-index.json       跨城倒排索引
# image-health.json       月度图片巡检结果（不污染主数据）
# api-usage.json          腾讯 / 高德用量记账（★ 高德是**月**配额）
# manifest.json           校验和 + 更新时间
#
# ★ 边界的**唯一**允许来源是持牌图商 / 官方平台（腾讯 / 高德 / 百度 / 天地图）——
#   见 plans/10 §9.1。**绝对禁止**第三方 GeoJSON（版图表达会出错，违反《地图管理条例》）。
# ★ 为什么"自身轮廓"那一半换成了高德：腾讯只给**下辖子级**，而且给的是各自独立抽稀的
#   粗轮廓（实测：北京有 4 个区只有 4 个点 = 一个矩形、西安莲湖 5 个点）——
#   放大到区/点位档就是方块。高德 `config/district?subdistrict=0&extensions=all`
#   返回"当前查询行政区**自身**"的全精度轮廓，且同为 GCJ-02 ⇒ 零坐标转换。
# ★ 前端读取顺序（都在 `web/app/common/data/`）：`ownBounds.ts` 管"把自身轮廓读出来"，
#   `bounds.ts` 的 `loadBoundsForLevel()` / `loadDistrictFaces()` 管"这一屏铺哪一级的面"，
#   **自身优先、逐级退回腾讯那份**（区这一级是**逐区**退回）。
#
# ⚠️ 生成的脚本若不在本仓库，请确保它已实现 data/README.md 第四节的不变式。
