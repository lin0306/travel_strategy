"""
pipeline/seeds/ —— 每座城市一份**纯数据**采编稿

一个文件 = 一座城市。字段口径见 `seedlib.expand_poi`。

写作纪律（plans/04 第二节）：
  · 票价、开放时间一律带"约 / 起 / 以官方为准" —— 会过期的信息宁可模糊，
    也不给看起来精确但实际是错的承诺
  · `src` 必填且可点（kind: gov / wiki / official / travel-platform / media / social）
  · 地址写到区县一级即可，精确坐标交给 step3 地理编码（**不许凭印象写坐标**）
"""
