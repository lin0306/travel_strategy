"""
pipeline/authoring/ —— **采编稿层**：人/AI 写数据，流水线展开成产物

| 模块 | 职责 |
|------|------|
| `seedlib.py` | 采编稿 → POI / city.json 的**公共展开器**（字段口径全项目唯一一份） |
| `seed.py` | 跑 `seeds/{city}.py` 生成 `city.json` + POI 分片 |
| `images.py` | 图片三级降级（Unsplash → Pexels → 百度百科）+ 带站外 Referer 的探活 |

★ `seeds/{cityId}.py` 是**纯数据**（人写的结构化候选清单），
  展开逻辑一律走 `seedlib.expand_poi()` —— 采编稿文件里不许再出现展开代码。

★ 图片**全部外链、零文件**：仓库里只有 URL 字符串，绝不下载、绝不存二进制。
"""