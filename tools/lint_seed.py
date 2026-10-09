# -*- coding: utf-8 -*-
"""采编稿体检：按**字段名**判定，只对真正的正文报噪声。

为什么要认字段名：直接扫全文会把 `dict(id="...", sub="historic")` 这类正常的键值当成
噪声，几百条误报之后这条检查会被习惯性忽略 —— 那就等于没有检查。
所以走 AST：只看 sum / desc / hl / addr / dist / trans / hours / ticket / aud / tags，
这些字段应当是纯中文（允许数字、标点、英文是有意为之的极少数）。

用法：python _tmp/_lint_seed.py <city> [<city2> ...]
"""
import ast
import re
import sys
from pathlib import Path

TEXT_FIELDS = {
    "sum", "desc", "hl", "addr", "dist", "trans", "hours", "ticket", "aud", "tags",
    "tags", "tips", "intro", "tagline",
}
# ★ 阈值是 2 不是 3：正文里混入过 `IP` / `mall` 这类两三个字母的词，
#   按 3 个字母查会整批漏过去（2026-09-24 深圳稿实测）。正文字段本应纯中文，
#   所以放宽到 2 也不会误报 —— id / sub / pl 这些字段不在检查范围内。
LATIN = re.compile(r"[A-Za-z]{2,}")
NON_CJK = re.compile(r"[Ѐ-ӿ぀-ヿ가-힯]")
# 生成中文正文时会夹带繁体字（邊 / 灣 / 狀 / 朳 这类），不报错也会静默上页面。
# ★ 不含「瞭」：读 liào 时（瞭望）是规范简体，不是繁体误用 —— 广州稿的「瞭望塔」正确。
TRADITIONAL = re.compile(
    "[邊灣國學華體場處車佔狀朳湧鬆衹裡麵餘幾將於為個從發現點線]")


def walk_text(src: str):
    """产出 (行号, 字段名, 字符串内容)。"""
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        for kw in node.keywords:
            if kw.arg not in TEXT_FIELDS:
                continue
            v = kw.value
            parts = []
            if isinstance(v, ast.Constant) and isinstance(v.value, str):
                parts.append((v.lineno, kw.arg, v.value))
            elif isinstance(v, (ast.List, ast.Tuple)):
                for el in v.elts:
                    if isinstance(el, ast.Constant) and isinstance(el.value, str):
                        parts.append((el.lineno, kw.arg, el.value))
            elif isinstance(v, ast.JoinedStr):      # f-string（采编稿里不该有）
                parts.append((v.lineno, kw.arg, "<f-string>"))
            yield from parts


def lint(city: str) -> int:
    path = Path("pipeline/seeds") / f"{city}.py"
    src = path.read_text(encoding="utf-8")
    problems = 0
    for lineno, field, text in walk_text(src):
        for pat, tag in (
            (LATIN, "拉丁词"),
            (NON_CJK, "非中日韩字符"),
            (TRADITIONAL, "繁体字"),
        ):
            seen: set[str] = set()
            for m in pat.finditer(text):
                if m.group(0) in seen:      # 同一段里重复的词只报一次
                    continue
                seen.add(m.group(0))
                problems += 1
                i = m.start()
                print(f"  ✗ {city}:{lineno} [{field}][{tag}] {m.group(0)!r} <- {text[max(0, i-25):i+30]}")
    return problems


if __name__ == "__main__":
    total = 0
    for c in sys.argv[1:]:
        n = lint(c)
        total += n
        if n == 0:
            print(f"  ✓ {c} 正文干净")
    print(f"噪声项：{total}")
    raise SystemExit(1 if total else 0)
