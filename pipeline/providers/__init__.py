"""
pipeline/providers/ —— **图商适配层**：把三家的接口封成统一调用

| 模块 | 职责 |
|------|------|
| `tmap.py` | 腾讯位置服务 WebService 封装（坐标 lat,lng 在前等全部踩坑点收在这里） |
| `amap.py` | 高德 Web 服务（轮廓 / 入口坐标 / 地理编码备用） |
| `geoprovider.py` | ★ **取点唯一入口**：腾讯优先，日配额尽（status 121）自动换高德 |

★ 为什么要有这一层：以前调用链是 `step3_geocode.py → tmap.geocode()`，
  腾讯配额耗尽时返回 `None`，与"这个地址真的没命中"**一字不差** ——
  不换源的话，一次配额耗尽 = 一座城当天报废。
  业务层只 import `geoprovider`，绝不直接碰 `tmap` / `amap`（护栏 `AM` 守这条）。
"""