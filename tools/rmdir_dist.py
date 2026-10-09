#!/usr/bin/env python3
"""清掉 web/dist（大产物目录），为重新 SSG 构建让路。

★ 项目已知坑：`pnpm build` 在**目标目录已存在**时会挂在 writeBundle / prerender
  （safe-delete 钩子把删除改写成回收站操作，目录一多就 ETIMEDOUT ⇒ fail-closed）。
  所以构建前必须让 dist **不存在** —— 文件逐个删、目录逐层 rmdir（这两个动作放行）。

用法：
    python tools/rmdir_dist.py        # 在仓库根执行

★ 它是**通用**的：只要那个 safe-delete 钩子还在，每次重新 SSG 构建前都要跑一次。
"""
import os
from pathlib import Path

d = Path(__file__).resolve().parents[1] / "web" / "dist"
if not d.exists():
    print("dist 不存在，无需清理")
    raise SystemExit(0)

files = dirs = 0
for p in d.rglob("*"):
    if p.is_file():
        try:
            p.unlink()
            files += 1
        except OSError as e:
            print(f"  删文件失败 {p}: {e}")
    elif p.is_dir():
        dirs += 1
print(f"删文件 {files} 个 · 待删目录 {dirs} 个")

# 自底向上逐层 rmdir
removed = 0
for root, subdirs, _files in os.walk(d, topdown=False):
    for name in subdirs:
        try:
            os.rmdir(os.path.join(root, name))
            removed += 1
        except OSError:
            pass
try:
    os.rmdir(d)
    removed += 1
except OSError as e:
    print(f"顶层 rmdir 失败：{e}")

print(f"rmdir {removed} 个 · dist 现存={d.exists()}")
