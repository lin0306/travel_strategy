"""
pipeline/geo/ —— **区划与几何层**：adcode / 边界 / 归区 / 徽标落点

| 模块 | 职责 |
|------|------|
| `citymeta.py` | 城市主数据的地理部分（adcode / center / bbox）—— 全部接口实测，**不手填** |
| `districts.py` | 区级几何与"点位归区"（第四级显示的地基） |
| `districtless.py` | 全国38 个不设区的市：把"这一层一个面都没有"折叠成**一个节点 = 市自身** |
| `labelgeo.py` | 徽标落点= **面内视觉中心**（腾讯给的 `center` 是政府驻地，不对） |

★ 这一层只 import `core/`（+ `providers/`，citymeta 要发请求）——
  绝不含组装逻辑（那是 `assemble/`）与采集步骤（那是 `steps/`）。
"""