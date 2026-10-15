#!/usr/bin/env python3
"""清理采编稿里混入中文文案的英文噪声词。

背景：一次性生成长中文内容时，模型注意力衰减会把英文词插进中文句子里
（"来代替 afterwards 成为"）。这些词是**纯插入噪声**，删掉后句子依然通顺。

保守策略（宁可漏删，不可错删）：
  ① 只处理「被中文字符夹住」的英文词 —— Python 语法里的 key=/quote 不会命中
  ② 白名单里的合法英文（PSA / UCCA / iPhone 等）原样保留
  ③ 全大写缩写（PSA、UCCA）默认视为合法保留
  ④ 报告每一处删除，便于人工复核

用法： python -m pipeline.core.fix_noise <seed文件名，不含.py>
      （必须用 `-m` 从**仓库根**跑：相对 import 要求包上下文，直接
        `python pipeline/core/fix_noise.py` 会报 "attempted relative import"）
"""
from __future__ import annotations

import re
import sys

from .layout import PIPELINE

#: 采编稿目录。与 `authoring/seed.py:list_seed_ids()` **同一口径**（都从 PIPELINE 根算）——
#:   本文件在 `pipeline/core/`，`seeds/` 是它的兄弟目录的兄弟，直接 `parent / "seeds"`
#:   会指向 `pipeline/core/seeds`（不存在）⇒ glob 返回空 ⇒ **静默零操作**。
#: ★ 2026-10-15 修正：这里原是硬编码绝对路径 `E:\code\travel_strategy\web\scripts\harvest\seeds`，
#:   ① 暴露本地目录结构，② seeds 早搬到 `pipeline/seeds/` 后该路径**已失效**，
#:   别人 clone 必然报错。现在一律走 layout 的单一真源。
SEEDS = PIPELINE / "seeds"

#: 合法英文：这些在中文语境里是有意义的专有名词，不许删
ALLOW = {
    "PSA", "UCCA", "AR", "VR", "IP", "CBD", "WiFi", "iPhone", "PDF",
    "Disney", "Disneyland", "ART", "DECO", "SHOW",
}

#: ★ 允许连着的多个英文词一起删（"Urban Renewal" 这种是一个词组，删一半更不通顺），
#:   但只要词组里**任何一个词**在白名单里，整组都保留。
PAT = re.compile(
    r"(?<=[\u4e00-\u9fff，。；、：？」』】])"          # 左侧是中文
    r"[ ]*(?:[A-Za-z][A-Za-z\u0300-\u036f']*[ ]*)+"  # 中间的英文词组（可多个词）
    r"(?=[\u4e00-\u9fff，。；、：？「『【])"          # 右侧是中文
)


def clean(text: str) -> tuple[str, int, list[tuple[str, str]]]:
    """返回 (清理后文本, 删除数, [(删除词, 上下文)])"""
    removed: list[tuple[str, str]] = []
    n = 0

    def sub(m: re.Match) -> str:
        nonlocal n
        phrase = m.group(0).strip()
        words = phrase.split()
        # ★ 词组里含任何一个白名词 → 整组保留（避免把 "Disney X" 里的一半删掉）
        if any(w in ALLOW or (w.isupper() and len(w) >= 2) for w in words):
            return m.group(0)
        n += 1
        removed.append((phrase, m.string[max(0, m.start() - 14):m.end() + 14]))
        return ""                      # 连同两侧空格一起删掉

    return PAT.sub(sub, text), n, removed


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    name = sys.argv[1]
    p = SEEDS / f"{name}.py"
    if not p.is_file():
        # ★ 别让 FileNotFoundError 裸崩 —— 列出真实存在的稿子，否则要翻目录树才知道叫什么
        near = sorted(q.stem for q in SEEDS.glob("*.py"))[:20] if SEEDS.is_dir() else []
        print(f"❌ 采编稿不存在：{p}")
        if near:
            print(f"   现有稿子（前 20 个）：{', '.join(near)}")
        return 1
    src = p.read_text(encoding="utf-8")
    out, n, removed = clean(src)
    p.write_text(out, encoding="utf-8", newline="\n")
    print(f"{name}.py：删除 {n} 处噪声")
    for word, ctx in removed[:60]:
        print(f"   -{word}-  ← …{ctx}…")
    if n > 60:
        print(f"   … 其余 {n - 60} 处省略")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
