"""pipeline/core/env.py —— **采集侧**配置的唯一入口（★ 唯一从 .env 读配置的地方）

## ★★ 2026-09-30：配置按**项目**分家

这个仓库其实是**两个工程**，配置也该各归各的：

| 工程 | 配置住哪 | 装什么 |
|------|---------|--------|
| `pipeline/`（抓取，Python） | **`pipeline/.env.local`** | `TMAP_WEB_KEY` · `AMAP_WEB_KEY` · `UNSPLASH_ACCESS_KEY` · `PEXELS_API_KEY` |
| `web/`（前端地图，Vite） | **`web/.env.local`** | `VITE_TMAP_KEY`（会被 Vite 注入 `import.meta.env`） |

以前全塞在 `web/.env.local`（那时只有一个工程），后果是两条：
① **职责反了** —— 采集脚本要反向去读前端工程的配置；
② **风险** —— 那个文件是 Vite 的加载面，任何 `VITE_` 前缀的私密 key 都会**被打进前端产物**。
   采集侧的 key 天生不带 `VITE_` 前缀，但"住在一起"总有人手滑。

## 为什么需要这个模块

采集脚本在终端里跑，**拿不到 Vite 注入的 `import.meta.env`**。
之前只能靠手工 `export TMAP_WEB_KEY=...`，而这一步最容易忘 —— 忘了的表现是
"脚本报缺 key"，或者更糟：带着 `.env.example` 里的占位符 `...` 发出一堆必然失败的请求，
还白白消耗配额。所以把"读 key"收敛成一个模块，脚本一律调它。

加载顺序（前者不覆盖后者 —— 真实环境变量优先级最高）：
  ① 真实环境变量（CI / 临时覆盖最优先）
  ② `pipeline/.env.local`  ← ★ 采集侧配置放这里
  ③ `pipeline/.env`
  ④ `web/.env.local`       ← ⚠️ **兼容期兜底**：老的 key 还在这儿，能找到但会提示迁移
  ⑤ `web/.env`

⚠️ Vite 只认 `.env` / `.env.local` / `.env.[mode]` / `.env.[mode].local` 四种名字，
   而 `pnpm dev` 的 mode 是 **`development` 全称** —— 所以 `.env.dev` 永远匹配不上
   （失败完全静默）。这条只对 **`web/`** 那份有意义。
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from .layout import PIPELINE, WEB

#: ★ 采集侧优先，`web/` 只作兼容兜底 —— 顺序就是优先级（先注入的不被覆盖）
ENV_DIRS=(PIPELINE, WEB)

#: 每个目录下按优先级排的 env 文件名
ENV_FILES = (".env.local", ".env")

#: 一眼可辨的占位值 —— 这些不是真 key，等价于"没配"
PLACEHOLDERS = {"", "...", "your-key", "changeme", "xxx", "null", "none"}

#: 从 `web/` 那边捡到的**非 VITE_** key（= 该搬到 pipeline/ 却还没搬的）
_stale_from_web: set[str] = set()
_warned = False


def _parse_env_file(path: Path) -> dict[str, str]:
    """极简 .env 解析：只认 `KEY=VALUE`，忽略注释与空行。

    支持 `export KEY=VALUE` 前缀、单双引号包裹、行尾 `#` 注释（引号内的 `#` 不切）。
    """
    out: dict[str, str] = {}
    if not path.exists():
        return out
    with open(path, encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("export "):
                line = line[len("export "):].strip()
            if "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip()
            # 去包裹引号
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            else:
                # 行尾注释（仅在未被引号包裹时切）
                value = value.split(" #", 1)[0].strip()
            if key:
                out[key] = value
    return out


def load_env(*, override: bool = False) -> dict[str, str]:
    """把 env 文件里的变量注入 `os.environ`。

    ★ 默认**不覆盖**已存在的环境变量：CI 里显式 export 的值优先级最高，
      也不能被 `web/` 那份兜底配置悄悄改掉 `pipeline/` 里已经写好的值。
      返回实际注入的键值对（便于打印诊断）。
    """
    injected: dict[str, str] = {}
    for base in ENV_DIRS:
        for name in ENV_FILES:
            for key, value in _parse_env_file(base / name).items():
                if key in os.environ and not override:
                    continue
                os.environ[key] = value
                injected[key] = value
                # ★ 记下"从 web/ 捡到的采集侧 key"：能跑 ≠ 放对了地方
                if base == WEB and not key.startswith("VITE_"):
                    _stale_from_web.add(key)
    return injected


def moved_from_web() -> list[str]:
    """还留在 `web/` 里的**采集侧** key（迁移提示用；`VITE_` 前缀的不算）。"""
    load_env()
    return sorted(_stale_from_web)


def _warn_moved_once() -> None:
    """迁移提示只打一次 —— 不让"能跑"掩盖"配置放错地方"。"""
    global _warned
    stale = moved_from_web()
    if _warned or not stale:
        return
    _warned = True
    print(
        "⚠️ 这些**采集侧**的 key 还放在 web/.env.local 里：" + ", ".join(stale) + "\n"
        f"   采集配置现在归 {PIPELINE / '.env.local'} 管（web/ 只留 VITE_ 前缀的前端 key）。\n"
        "   把上面这几行**剪切**过去即可 —— 两边都读，所以现在也不会坏。",
        file=sys.stderr,
    )


def is_placeholder(value: str | None) -> bool:
    """是不是占位值（空 / `...` / 模板里的假 key）。"""
    return (value or "").strip().lower() in PLACEHOLDERS


def get_key(*names: str, required: bool = True, hint: str = "") -> str:
    """按顺序取第一个**真实**的 key。

    ★ 会自动先加载 env 文件，调用方不必记得先调 `load_env()`。
    找不到就抛 `MissingKeyError` 并在提示里带上申请地址 ——
    **宁可早失败，也不要拿着占位符发一堆必然失败的请求。**
    """
    load_env()
    _warn_moved_once()
    for name in names:
        value = (os.environ.get(name) or "").strip()
        if not is_placeholder(value):
            return value
    raise MissingKeyError(
        f"缺少 key（已按顺序尝试：{' → '.join(names)}）\n"
        f"  请把真实 key 写进 {PIPELINE / '.env.local'}"
        f"（该文件已被 .gitignore 忽略，不会进仓库）。\n"
        f"  ★ 采集侧的 key 一律放这里；前端那把 `VITE_` 开头的放 {WEB / '.env.local'}。\n"
        + (f"  {hint}\n" if hint else "")
    )


def key_status(*names: str) -> list[tuple[str, str]]:
    """诊断用：各候选变量当前是什么状态。**不打印值本身**（避免 key 泄露到日志）。"""
    load_env()
    out: list[tuple[str, str]] = []
    for name in names:
        value = (os.environ.get(name) or "").strip()
        if not value:
            state = "未设置"
        elif is_placeholder(value):
            state = "占位符"
        else:
            state = f"已设置(len={len(value)})"
        out.append((name, state))
    return out


class MissingKeyError(RuntimeError):
    """缺 key。带着占位符跑只会得到一堆无效 JSON，不如早失败。"""
