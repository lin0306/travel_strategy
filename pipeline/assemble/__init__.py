"""
pipeline/assemble/ —— **组装层**：把采编稿的产物合成最终 `data/`

| 模块 | 职责 |
|------|------|
| `build.py` | 三件事：① 组装 city.json + pois + ② Pydantic 校验与红线检查 ③ 生成索引与 credits |

★ 它是**唯一**往 `data/_generated/` 写派生产物的地方
  （`district-tree.json` / `cities.index.json` / `search-index.json` / `district-index.json` …）。
  别的模块想产出派生产物，一律走它—— 否则会出现"两个地方各写一半索引"的烂摊子。

★ 入口是 `pipeline/run.py build`（**不是**直接跑本文件）。
"""