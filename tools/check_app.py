#!/usr/bin/env python3
"""应用结构静态校验。

## 为什么需要它
A–K 是**纯正则**的结构约定检查，不装依赖也能跑，专抓"最贵的那类错误"：

| 检查项 | 抓的是哪类真实 bug |
|--------|------------------|
| A. barrel 导出的符号是否真的存在 | 凭印象写 `export { hasBuiltinKey }`，实际没这个函数 |
| B. 引擎隔离（业务层不碰 `TMap.*`） | 换引擎只改一层的承诺是否成立 |
| C. HTML `title` 属性 / 浮层尺寸 token | 全局约定与 05 文档的尺寸口径 |
| D. 数据契约口径 | 34 个省级单位、六方式映射三通道 |
| E. 未使用的具名导入 | 死代码，以及"以为在用其实没接上" |
| F. 导入的符号确实被源模块导出 | 拼错一个字母就构建失败的**外形正确**错误 |
| G. 单文件行数上限 | 超大文件会把上下文挤爆（AI 每读一次拉全文） |
| H. 行程组件完整性与业务红线 | 承诺（顺序由用户定 / 仅存本机 / 预估）是否落到代码里 |
| I. `import.meta.glob` 的路径基准 | 代码在 `web/`、`data/` 在仓库根，相对深度差一层就静默读不到数据 |
| J. 仓库布局归属 | 顶层归属漂移（`data/` 被误建到 `web/` 里、`netlify.toml` 挪了位置）不会报错，只会让人照错的地方找 |
| K. 应用入口文件完整性 | 缺 `app/entry.server.tsx` 会让 React Router **自动改写 package.json 并执行一次 install**，包管理器不一致时直接崩掉 dev server |
| L. 真实类型检查（tsc） | ★ A–K 全是正则匹配，**根本不解析 TypeScript** |
| AD. 规划记录存储层 | IndexedDB 的每个出入口都不抛错（只返回 `null`/`false`）⇒ "没写进去""折线没解出来"全都没有界面反馈，只能静态钉住 |
| M. env 文件命名与忽略规则 | 文件名不在 Vite 清单里 → key 静默不生效（UI 只说"地图未解锁"）；gitignore 没兜住 → key 进 git |
| N. 浮层可命中（地图层是层叠上下文 + 浮层自带正 z-index） | 腾讯 GL 自建 `z-index:1000` 的透明层，`.map-layer` 若是 `z-index:auto` 会逃到页面级、把浮层压死 —— 地图看得见，按钮点不到 |
| O. TMap SDK 调用契约 | 自写的 `.d.ts` 会**凭空捏造**参数名：`tsc` 只证明"声明与调用一致"，不证明"声明与 SDK 一致"。腾讯对未知字段**静默忽略** —— `fontSize` 不报错但字号悄悄退回默认、`style.text` 不报错但**一个文字标签都渲染不出来** |
| P. 图层重刷管道 | **回调存在、但没人传 / 没人登记** → 静默空转。`useTMap` 早就支持 `onViewportChange`、图层也早有重刷方法，但两边都以为对方会接；结果是圆点/徽标/标注只在**数据到达**那一刻算过一次（那一刻地图还停在上一页的缩放），之后怎么缩放都不重算 |
| Q. 顶栏信息条与底图署名 | ① `TopBar` 左上角曾整块"可选渲染"，首页谁都没传 → **顶部轨道空白**，用户以为功能没做（`crumbs` 已改必填）② 底图署名换过两次位置：底部图例条 → 右下角自绘；而腾讯 SDK **本来就在左下角自带带审图号的版权**（`.logo-text`），自绘那份纯重复 → 已撤。护栏反向守：**不得再自绘**，且**不得用 CSS 隐藏 SDK 那份**（撤掉自绘后它是唯一署名） |
| R. 图标 sprite 挂载点与图标名 | `<IconSprite />` 定义了却**没人渲染** → 每个 `<Icon>` 的 `<use href="#i-…">` 指向不存在的 id，**全站图标静默变空白**，而 tsc 干净、A–Q 全绿、控制台零报错。静态只能守"挂载点存在 + 图标名有定义"，"真的画出来了"必须运行时数 `[id^="i-"]` |
| S. 缩放揭示 | 层级改由缩放决定后，图层归 `useMapReveal` 独占 —— 页面再自己 `createDistrictLayer(…)` 就会**同一份内容画两遍**（缩放闪烁、点击命中错层，类型不报错）；某页顺手写 `getZoom() >= 7` 则让**揭示阈值分叉**，改标定必然漏改一处 |
| T. 点位准入与三级地区下拉 | ① 点位的**唯一闸门**是档位准入（`zoom < 8` 整体不铺），其余全铺、交给聚合。★ 而"抽稀 + 像素去重"那套（`pickDots`）2026-09-22 已整体删除 —— 它做的是**把点扔掉**，会让气泡上的数字变成"抽稀后的数字"，**不报错、看着还挺对**，所以反向守死符号 ② 顶栏首级下拉是"从任意一级换城市"的唯一出口（面包屑只读） ③ 未收录的市判据是 `cityId === null`，写成可点会进空白页 |

### ★ 为什么还必须有 L 项
实测过一次很典型的翻车（2026-09-18）：A–K **全部报 ALL_CLEAN**，
而 `tsc --noEmit` 一口气报出 **50+ 个类型错误**，外加一个「多了一个 `}`」的语法错误
（后者让 dev server 对**每条路由**都返回 500）。正则永远抓不到这些。

所以口径要分清：
  · A–K = 结构约定的快速兜底（不装依赖也能跑）
  · L   = 真正的编译关卡（装好依赖后必须跑）

**结构全绿 ≠ 能构建 ≠ 能运行。** 三者要分别验。

每项都带**最小命中数断言** —— 正则写坏导致命中 0 时会报错，而不是"空集假通过"。
这是原型阶段用血换来的教训。
"""

from __future__ import annotations

import importlib.util
import inspect
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

# ★ 路径基准：本文件在**仓库根的 `tools/`** 下（2026-09-21 从 `web/scripts/` 搬出）
#   REPO = 仓库根（`data/` `plans/` `pipeline/` `schema/` `tools/` `web/` 都在这一层）
#   WEB  = 展示工程根（`app/` `public/` 在这一层）
#   混用这两个，是本仓库最容易犯的路径错误。
REPO = Path(__file__).resolve().parent.parent
WEB = REPO / 'web'
#: 采集侧的工程根。**配置按工程分家**（2026-09-30）：`pipeline/.env.local` 装采集 key，
#: `web/.env.local` 只装前端那把 `VITE_` 开头的。M 项两边都要查。
PIPELINE_DIR = REPO / 'pipeline'

# ★★ pipeline 的模块路径 → 文件路径映射表（2026-10-07 分层时加）。
#
# 为什么要有这张表：pipeline 从「26 个模块全平铺」改成按依赖分三层
# （`core/` 基础设施 · `providers/` 图商适配 · `steps/` 采集步骤）之后，
# 本文件里 40+ 处护栏（AM / AO 等）都要读这些文件的**内容**做断言。
# 如果它们各自拼 `'pipeline/xxx.py'`，改一次布局就要改 46 处 —— 漏一处，
# 那一项护栏就静默变成"文件不存在 ⇒ 恒 FAIL"或更糟：恒 PASS 失去意义。
#
# ★ 往后**只在这里**加模块，不要在护栏体里写死路径。
PIPELINE_MODULES = {
    # ── core：基础设施，被全体依赖 ──
    'env': 'core/env.py',
    'layout': 'core/layout.py',
    'fetch': 'core/fetch.py',
    'fix_noise': 'core/fix_noise.py',
    # ── providers：图商适配 ──
    'tmap': 'providers/tmap.py',
    'amap': 'providers/amap.py',
    'geoprovider': 'providers/geoprovider.py',
    # ── steps：采集步骤 ──
    'step3_geocode': 'steps/step3_geocode.py',
    'step3b_entrance': 'steps/step3b_entrance.py',
    'step4_images': 'steps/step4_images.py',
    'step7_district': 'steps/step7_district.py',
    'step8_subdistricts': 'steps/step8_subdistricts.py',
    'step9_province_outline': 'steps/step9_province_outline.py',
    'step10_city_outlines': 'steps/step10_city_outlines.py',
    'step11_district_outlines': 'steps/step11_district_outlines.py',
    # ── geo：区划与几何（adcode / 边界 / 归区 / 徽标落点）──
    'citymeta': 'geo/citymeta.py',
    'districts': 'geo/districts.py',
    'districtless': 'geo/districtless.py',
    'labelgeo': 'geo/labelgeo.py',
    # ── authoring：采编稿与图源（人写数据 → 展开成产物）──
    'seedlib': 'authoring/seedlib.py',
    'seed': 'authoring/seed.py',
    'images': 'authoring/images.py',
    # ── assemble：组装与派生产物（唯一往 data/_generated 写的）──
    'build': 'assemble/build.py',
    # ── 顶层：只有入口 ──
    'run': 'run.py',
}


def pmod(name: str) -> Path:
    """pipeline 模块名 → 绝对路径。模块名不在表里会直接 KeyError（别静默）。"""
    return PIPELINE_DIR / PIPELINE_MODULES[name]


def prel(name: str) -> str:
    """pipeline 模块名 → 相对仓库根的路径字符串（给报错文案用，避免两处写法漂移）。"""
    return 'pipeline/' + PIPELINE_MODULES[name]


def _balanced_paren_block(src: str, name: str) -> str | None:
    """从 `name = (` 起手，**数括号直到配平**，返回整个赋值块的内容。

    ★★ 为什么不能用 `re.search(rf'{name}\\s*=\\s*\\((.*?)\\)', src, re.S)`：
    非贪婪匹配会在**第一个** `)` 处截断，而 `fetch.py` 的 UA 字面量里自带右括号 ——
    `"(KHTML, like Gecko) Chrome/126.0.0.0"`。用它只会截到
    `"Mozilla/5.0 (Windows NT 10.0; Win64; x64"`，
    真正要查的采集标识全在截断点之后 ⇒ **判据永远抓不到**（形同虚设）。
    （真实案例：AS 项反证时把 `TravelStrategy-Harvest/1.0` 加回 fetch.py，
    护栏依然 ALL_CLEAN。）
    ⇒ 这里手写括号配平，遇到字符串字面量里的括号要跳过。
    """
    m = re.search(rf'^{re.escape(name)}\s*=\s*\(', src, re.M)
    if not m:
        return None
    depth = 1
    i = m.end()
    quote: str | None = None
    while i < len(src):
        ch = src[i]
        if quote:
            # 字符串字面量内部：只认同种引号的闭合（不处理转义 —— UA 里没有转义）
            if ch == quote:
                quote = None
        elif ch in ('"', "'"):
            quote = ch
        elif ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
            if depth == 0:
                return src[m.end():i]
        i += 1
    return None

#: 🚨 边界数据**唯一**允许的来源主机 —— 持牌图商 / 官方平台（数据过审图）。
#: 加入新图商前先确认它在 plans/10 §9 的允许清单里（腾讯 / 高德 / 百度 / 天地图）。
#: **第三方数据集（Natural Earth / GADM / geoBoundaries / 各种开源 GeoJSON）一律不在列**
#: —— 中国台湾省、藏南地区、南海诸岛、阿克赛钦的表达常出错，违反《地图管理条例》。
ALLOWED_BOUNDARY_HOSTS = frozenset({
    'restapi.amap.com',   # 高德 Web 服务（省级自身轮廓，GCJ-02）
    'lbs.amap.com',       # 高德控制台（申请 key 的提示链接）
    'apis.map.qq.com',    # 腾讯 District（市级 / 区级边界，GCJ-02）
    'lbs.qq.com',         # 腾讯位置服务控制台
    'api.tianditu.gov.cn',  # 天地图（官方平台，CGCS2000 —— 用之前必须转 GCJ-02）
})

failures: list[str] = []
notes: list[str] = []


def check(label: str, problems: list[str], min_count: int, count: int) -> None:
    """统一断言：命中数不足 → 认为检查本身失效，而不是"没问题" """
    if count < min_count:
        problems = problems + [
            f'检查自身失效：只命中 {count} 处，期望至少 {min_count} 处（正则可能写坏了）'
        ]
    if problems:
        failures.append(label)
        for p in problems[:12]:
            print(f'  [FAIL] {label}: {p}')
    else:
        print(f'  [ ok ] {label}')


# ────────────────────────────────────────────────
# A. barrel 导出的一致性
# ────────────────────────────────────────────────

EXPORT_RE = re.compile(r'^export\s+(?:async\s+)?(?:function|const|class|interface|type|enum)\s+([A-Za-z_]\w*)', re.M)
# 形如  export { a, b as c, type D } from './x'
REEXXPORT_RE = re.compile(r'export\s*\{([^}]*)\}\s*from\s*[\'"]([^\'"]+)[\'"]', re.S)


def declared_names(path: Path) -> set[str]:
    src = path.read_text(encoding='utf-8')
    names = set(EXPORT_RE.findall(src))
    # `export default` 与再导出也算"存在"
    for block, _ in REEXXPORT_RE.findall(src):
        for item in block.split(','):
            item = item.strip().replace('type ', '')
            if not item:
                continue
            names.add(item.split(' as ')[-1].strip())
    # 内联导出的类型别名（一行多个）
    for m in re.finditer(r'^export\s+type\s+([A-Za-z_]\w*)\s*=', src, re.M):
        names.add(m.group(1))
    return names


def resolve_relative(from_file: Path, spec: str) -> Path | None:
    base = (from_file.parent / spec).resolve()
    for cand in (base.with_suffix('.ts'), base.with_suffix('.tsx'), base / 'index.ts', base / 'index.tsx', base):
        if cand.exists() and cand.is_file():
            return cand
    return None


def check_barrels() -> None:
    problems: list[str] = []
    hits = 0

    for src_file in WEB.glob('app/**/*.ts'):
        text = src_file.read_text(encoding='utf-8')
        rel = src_file.relative_to(WEB)

        # A1: 再导出的目标文件存在吗？符号真的在那个文件里吗？
        for block, spec in REEXXPORT_RE.findall(text):
            if not spec.startswith('.'):
                continue
            target = resolve_relative(src_file, spec)
            if target is None:
                problems.append(f'{rel}: 导入了不存在的文件 {spec}')
                continue
            available = declared_names(target)
            for item in block.split(','):
                item = item.strip().replace('type ', '')
                if not item:
                    continue
                name = item.split(' as ')[0].strip()
                hits += 1
                if name and name not in available:
                    problems.append(f'{rel}: 从 {spec} 导出了不存在的符号 `{name}`')

        # A2: 相对导入的路径存在吗？
        for m in re.finditer(r'^\s*(?:import|export)[^\'"]*from\s*[\'"](\.[^\'"]+)[\'"]', text, re.M):
            spec = m.group(1)
            if spec.endswith(('.css', '.json')):
                continue
            if resolve_relative(src_file, spec) is None:
                problems.append(f'{rel}: 无法解析相对导入 {spec}')

    check('A. barrel 导出与相对导入路径', problems, min_count=20, count=hits)

    # A3: 路由表里的模块路径是否存在。
    #     `routes.ts` 用的是 `layout('routes/x.tsx', …)` 这种**字符串**形式，
    #     不在 import 语法里，上面那两条正则都不覆盖 —— 路由文件改个名就静默 404。
    routes_file = WEB / 'app' / 'routes.ts'
    r_problems: list[str] = []
    r_hits = 0
    if routes_file.exists():
        text = routes_file.read_text(encoding='utf-8')
        for spec in set(re.findall(r'[\'"]((?:routes|components|lib)/[\w./-]+\.tsx?)[\'"]', text)):
            r_hits += 1
            if not (WEB / 'app' / spec).exists():
                r_problems.append(f'routes.ts 引用了不存在的模块 app/{spec}')
    else:
        r_problems.append('缺少 app/routes.ts')

    check('A3. 路由表引用的模块存在', r_problems, min_count=4, count=r_hits)


# ────────────────────────────────────────────────
# B. 引擎隔离：业务层不得直接碰 TMap 全局
# ────────────────────────────────────────────────

ENGINE_DIR = WEB / 'app' / 'common' / 'map' / 'tencent'
ALLOWED_TMAP_TYPE_FILES = {ENGINE_DIR / 'tmap.d.ts'}

# ★ 「调用侧」目录 —— **单一真源**。
#
# 好几项检查要区分定义侧与调用侧：图层工厂、视野读取、缩放阈值的**定义**
# 在  里（那正是它们该在的地方），扫进去只会得到一串假失败。
#
# 2026-09-22 展示工程重排后，调用侧的构成变了（components/hooks 归入 common，
# 两端视图独立成块）—— 若各处仍各写一份目录列表，这次一定会漏改其中一处，
# 而漏改的表现是**检查范围悄悄变小、依然全绿**。所以只在这里写一次。
CALLER_DIRS = (
    WEB / 'app' / 'routes',          # 路由薄壳（取数 + 按端分派）
    WEB / 'app' / 'desktop',         # PC 端视图
    WEB / 'app' / 'mobile',          # 移动端视图
    WEB / 'app' / 'common' / 'logic',  # 共用逻辑（钩子都在这儿）
    WEB / 'app' / 'common' / 'ui',     # 共用展示件
)


def check_engine_isolation() -> None:
    problems: list[str] = []
    hits = 0

    for f in list(WEB.glob('app/**/*.ts')) + list(WEB.glob('app/**/*.tsx')):
        if ENGINE_DIR in f.parents or f in ALLOWED_TMAP_TYPE_FILES:
            continue
        text = f.read_text(encoding='utf-8')
        rel = f.relative_to(WEB)
        # 去注释后再找，避免文档里提到 TMap 就误报
        stripped = re.sub(r'/\*.*?\*/', '', text, flags=re.S)
        stripped = re.sub(r'^\s*//.*$', '', stripped, flags=re.M)
        for m in re.finditer(r'\bTMap\s*\.\s*[A-Za-z_]', stripped):
            hits += 1
            line = stripped[: m.start()].count('\n') + 1
            problems.append(f'{rel}:{line} 直接使用 `{m.group(0)}` —— 请从 `~/map/tencent` 取能力')

    # 反向确认：引擎层内部**应该**大量使用 TMap（否则说明这个检查跑到空目录去了）
    inner = 0
    for f in ENGINE_DIR.glob('*.ts'):
        inner += len(re.findall(r'\bTMap\s*\.\s*[A-Za-z_]', f.read_text(encoding='utf-8')))
    notes.append(f'引擎层内部 TMap 引用 {inner} 处 · 业务层越界 {len(problems)} 处')

    check('B. 引擎隔离（业务层不直接引用 TMap）', problems, min_count=1, count=max(inner, 1))


# ────────────────────────────────────────────────
# C. 全局约定：禁 HTML title 属性 / 浮层尺寸 token
# ────────────────────────────────────────────────

# ★ 宽匹配（原来是 `left|preview|detail|locate|itinerary` 的枚举）：枚举会让
#   "删掉一个 token 却忘了删期望值"互相掩护 —— 宽匹配 + 下面的反向检查才能抓住
#   "定义了却没人用"的死 token（`preview` / `locate` 就是这么留下来的）。
TOKEN_RE = re.compile(r'--panel-([a-z][a-z-]*)\s*:\s*(\d+)px')


def check_conventions() -> None:
    problems: list[str] = []
    # 覆盖度指标：扫到多少个**小写 HTML 标签**。用它来断言"检查真的在跑"，
    # 而不是用 title 命中数 —— 因为理想情况下 title 命中数就该是 0，
    # 拿 0 当"检查失效"的判据会让这个检查永远无法通过。
    tag_hits = 0

    for f in list(WEB.glob('app/**/*.ts')) + list(WEB.glob('app/**/*.tsx')):
        text = f.read_text(encoding='utf-8')
        rel = f.relative_to(WEB)
        stripped = re.sub(r'/\*.*?\*/', '', text, flags=re.S)
        stripped = re.sub(r'^\s*//.*$', '', stripped, flags=re.M)

        # ⚠️ 只匹配**小写**标签名 —— 大写的（`<EmptyState title="…">`）是 React 组件 prop，
        #    那是我们自己定义的接口，跟"用 HTML title 当提示"是两码事。
        #    第一版没做这个区分，一次报了 12 个假阳性（含 `let title = …` 这种变量）。
        for m in re.finditer(r'<([a-z][a-z0-9-]*)\b[^>]*>', stripped, re.S):
            tag_hits += 1
            if re.search(r'\stitle\s*=\s*[\'"{]', m.group(0)):
                line = stripped[: m.start()].count('\n') + 1
                problems.append(
                    f'{rel}:{line} <{m.group(1)}> 上使用了 HTML title 属性'
                    '（约定：提示统一用 Tooltip；移动端 title 根本不显示）',
                )

    check('C1. 禁用 HTML title 属性', problems, min_count=50, count=tag_hits)

    # token 定义必须存在且值正确 —— 值只在**一处**定义（CSS 变量），别处引用
    css_files = list(WEB.glob('app/**/*.css'))
    tok_problems: list[str] = []
    found = {}
    for f in css_files:
        for name, value in TOKEN_RE.findall(f.read_text(encoding='utf-8')):
            found[name] = int(value)
    # ★ 2026-09-23 晚：`preview`(326) 与 `locate`(300) 随"简卡"与"位置卡"一起删掉了 ——
    #   前者被**就地详情**取代，后者并进了详情正文（用户：「右侧那个简要信息不需要」）。
    #   删浮层而忘了删 token，就会留下一份**没人用却仍被守着**的规格。
    # ★ 2026-09-26：`itinerary`(420) 删了 —— 旧 `/city/:cityId/plan` 那一页的浮层
    #   已整个搬进右侧规划浮层（plans/13 §6.6，用户要求「把旧的完整行程的内容，
    #   搬到现在的行程详情弹窗里」）。删浮层而不删 token，就会留下一份
    #   **没人用却仍被守着**的规格。
    # ★ `plan` 从 360 加宽到 420：详情态现在是**完整时间链**（六列），360 塞不下。
    expected = {'left': 348, 'detail': 620, 'plan': 420}
    for k, v in expected.items():
        if k not in found:
            tok_problems.append(f'缺少 --panel-{k} 定义')
        elif found[k] != v:
            tok_problems.append(f'--panel-{k} = {found[k]}px，应为 {v}px')
    # 反向：不许再冒出**没进期望表**的浮层 token —— 多出来的那块浮层正是返工的源头
    for k in found:
        if k not in expected:
            tok_problems.append(
                f'--panel-{k} 定义了却不在期望表里 —— 要么是新增了浮层（把期望值补上），'
                '要么是删掉的浮层留下了死 token（那说明还有地方在引用它）'
            )

    check('C2. 浮层尺寸 token 齐全且取值正确', tok_problems, min_count=3, count=len(found))


# ────────────────────────────────────────────────
# D. 数据契约口径
# ────────────────────────────────────────────────

def check_contract() -> None:
    schema = (REPO / 'schema' / 'schema.ts').read_text(encoding='utf-8')
    prov = (WEB / 'app' / 'common' / 'data' / 'provinceAdcodes.ts').read_text(encoding='utf-8')

    problems: list[str] = []

    # ⚠️ 只能扫 `PROVINCES` 数组**体内** —— 整个文件里还有
    #    `NON_DISTRICT_ADCODE = '999999'` 这类 6 位串，全文扫会数成 35 个。
    #    （这正是"最小命中数断言"的价值：检查写坏了要报错，而不是给个好看的数字）
    body = re.search(r'export const PROVINCES[^=]*=\s*\[(.*?)\n\]', prov, re.S)
    if body is None:
        problems.append('无法定位 PROVINCES 数组 —— 检查失效')
        uniq: list[str] = []
    else:
        uniq = sorted(set(re.findall(r'[\'"](\d{6})[\'"]', body.group(1))))

    if len(uniq) != 34:
        problems.append(f'省级单位应为 34 个，实际 {len(uniq)} 个')
    for must, label in (('710000', '中国台湾'), ('810000', '中国香港'), ('820000', '中国澳门')):
        if must not in uniq:
            problems.append(f'缺少 {label}（{must}）—— 合规红线')

    # 六方式 → 三通道：条目数与映射完整性
    ch_block = re.search(r'MATRIX_CHANNEL[^=]*=\s*\{(.*?)\n\}', schema, re.S)
    ch = re.findall(r'^\s{2}([a-z]+):', ch_block.group(1), re.M) if ch_block else []
    if len(ch) != 6:
        problems.append(f'MATRIX_CHANNEL 应有 6 条，实际 {len(ch)} 条')
    for mode in ('driving', 'taxi', 'transit', 'subway', 'bicycling', 'walking'):
        if mode not in ch:
            problems.append(f'MATRIX_CHANNEL 缺少方式 `{mode}`')

    notes.append(f'省级单位 {len(uniq)} 个 · MATRIX_CHANNEL {len(ch)} 条')

    check('D. 数据契约口径（34 省级单位 / 六方式映射）', problems, min_count=1, count=len(uniq))


# ────────────────────────────────────────────────
# E. 未使用的具名导入
# ────────────────────────────────────────────────

def iter_app_files() -> list[Path]:
    return sorted(list(WEB.glob('app/**/*.ts')) + list(WEB.glob('app/**/*.tsx')))


def check_unused() -> None:
    """未使用的具名导入。

    `tsc` 的 `noUnusedLocals` 也能抓这个，但在依赖装好之前跑不了 —— 而这类问题
    在依赖装好之前就已经在被写出来。所以用脚本先兜一层。

    ⚠️ 只扫**具名导入**。默认导入与命名空间的用法太灵活（可能只在 JSX 里出现、
    可能通过成员访问使用），静态判断容易误报，宁可不查。
    """
    problems: list[str] = []
    hits = 0

    for f in iter_app_files():
        src = f.read_text(encoding='utf-8')
        rel = f.relative_to(WEB)

        names: list[str] = []
        for m in re.finditer(r'^import\s+(?:type\s+)?\{([^}]*)\}\s*from', src, re.M):
            for item in m.group(1).split(','):
                item = item.strip().replace('type ', '')
                if item:
                    names.append(item.split(' as ')[-1].strip())
        if not names:
            continue

        hits += len(names)
        # 去掉导入语句后再搜，避免"导入行自己算一次使用"
        body = re.sub(r'^import[\s\S]*?from\s*[\'\"][^\'\"]+[\'\"];?', '', src, flags=re.M)
        unused = [n for n in names if re.search(r'\b' + re.escape(n) + r'\b', body) is None]
        if unused:
            problems.append(f'{rel}: 未使用的导入 {", ".join(unused)}')

    check('E. 无未使用的具名导入', problems, min_count=300, count=hits)


# ────────────────────────────────────────────────
# F. 跨模块「导入的符号确实被导出」
# ────────────────────────────────────────────────

# 别名 → 真实目录（**绝对路径**，相对谁一目了然）。
# 必须与 vite.config.ts / tsconfig.json 的 paths 保持一致：
#   `~`      → web/app        （展示工程内部）
#   `~shared`→ schema/        （仓库根：两端共享的字段契约，展示与抓取同一份）
#   `~data`  → data/          （仓库根：抓取的出口、展示的入口）
# ★ 以前这里存的是相对 WEB 的字符串，`~data` 得写成 `'../data/'` —— 那种"用 .. 表示
#   另一个根"的写法一旦再多一个根就会互相绕晕。直接存绝对路径，加根不用改解析。
ALIASES: list[tuple[str, Path]] = [
    ('~/', WEB / 'app'),
    ('~shared/', REPO / 'schema'),
    ('~data/', REPO / 'data'),
]

_EXPORT_CACHE: dict[Path, set[str]] = {}


def resolve_exact(base: Path) -> Path | None:
    """按 bundler 语义补后缀 / 找 index"""
    for cand in (
        base.with_suffix('.ts'),
        base.with_suffix('.tsx'),
        base / 'index.ts',
        base / 'index.tsx',
    ):
        if cand.is_file():
            return cand
    return None


def resolve_spec(from_file: Path, spec: str) -> Path | None:
    """解析模块标识符（含 `~/` 这类别名）到仓库内的真实文件。非本地模块返回 None"""
    if spec.startswith('.'):
        return resolve_relative(from_file, spec)

    for alias, target in ALIASES:
        if spec == alias.rstrip('/'):
            return resolve_exact(target)
        if spec.startswith(alias):
            return resolve_exact(target / spec[len(alias):])
    return None


def module_exports(path: Path, seen: set[Path] | None = None) -> set[str]:
    """一个模块对外暴露的具名符号（**含递归解开的再导出**）。

    递归是必须的：`~/map/tencent` 是 barrel，它自己一个符号都不定义，
    全靠 `export { … } from './config'`。只看一层的话，所有经 barrel
    导入的符号都会被误报成"不存在"。
    """
    if path in _EXPORT_CACHE:
        return _EXPORT_CACHE[path]
    seen = seen or set()
    if path in seen:
        return set()
    seen.add(path)

    src = path.read_text(encoding='utf-8')
    names = set(EXPORT_RE.findall(src))
    names |= set(re.findall(r'^export\s+type\s+([A-Za-z_]\w*)\s*=', src, re.M))

    # 再导出：export { a, b as c } from './x'  /  export * from './x'
    for block, spec in REEXXPORT_RE.findall(src):
        target = resolve_spec(path, spec)
        if target:
            names |= module_exports(target, seen)
    for spec in re.findall(r'^export\s*\*\s*from\s*[\'"]([^\'"]+)[\'"]', src, re.M):
        target = resolve_spec(path, spec)
        if target:
            names |= module_exports(target, seen)

    _EXPORT_CACHE[path] = names
    return names


def check_import_exports() -> None:
    """导入的每个具名符号，必须在源模块里真的被导出。

    ## 为什么这条值得单独查
    这是**一类不需要类型系统就能确定会炸**的错误：
    `import { fetchRouteOptions } from '~/itinerary/routeOptions'` 里名字拼错一个字母，
    构建期直接失败，而它看起来和正确代码一模一样。A 项只覆盖了 barrel 的再导出，
    普通导入全靠人眼。
    """
    problems: list[str] = []
    hits = 0

    for f in iter_app_files():
        src = f.read_text(encoding='utf-8')
        rel = f.relative_to(WEB)

        for m in re.finditer(
            r'^import\s+(?:type\s+)?(?:\{([^}]*)\})?\s*(?:from\s*)?[\'"]([^\'"]+)[\'"]',
            src,
            re.M,
        ):
            block, spec = m.group(1), m.group(2)
            if not block:
                continue  # 默认导入 / 副作用导入：跳过
            target = resolve_spec(f, spec)
            if target is None:
                continue  # 第三方包 / 非本地路径
            available = module_exports(target)
            for item in block.split(','):
                item = item.strip().replace('type ', '')
                if not item:
                    continue
                name = item.split(' as ')[0].strip()
                hits += 1
                if name and name not in available:
                    line = src[: m.start()].count('\n') + 1
                    problems.append(f'{rel}:{line} `{name}` 未被 {spec} 导出')

    check('F. 导入的具名符号确实被源模块导出', problems, min_count=80, count=hits)


# ────────────────────────────────────────────────
# G. 文件行数上限（拆分约定）
# ────────────────────────────────────────────────

# 超过这个行数就该按职责拆。理由不是"代码洁癖"，而是**每读一次文件
# 都会把全文拉进上下文** —— 一个 1100 行的路由文件会挤掉别的材料。
MAX_LINES = 420

# 白名单：由外部契约决定长度，拆不了
LINE_LIMIT_EXEMPT = {
    'app/common/map/tencent/tmap.d.ts',  # 第三方 SDK 的类型声明，按对象结构组织
}


def check_file_size() -> None:
    problems: list[str] = []
    files = 0
    worst = ('', 0)

    for f in iter_app_files():
        rel = f.relative_to(WEB).as_posix()
        if rel in LINE_LIMIT_EXEMPT:
            continue
        n = len(f.read_text(encoding='utf-8').split('\n'))
        files += 1
        if n > worst[1]:
            worst = (rel, n)
        if n > MAX_LINES:
            problems.append(f'{rel}: {n} 行 > {MAX_LINES}，请按职责拆分')

    notes.append(f'最大文件 {worst[0]}（{worst[1]} 行）· 上限 {MAX_LINES}')
    check('G. 单文件行数在上限内', problems, min_count=40, count=files)


# ────────────────────────────────────────────────
# H. 行程页组件完整性与业务红线
# ────────────────────────────────────────────────

PLAN_COMPONENTS = [
    'ItineraryPanel',
    'TimelineRail',
    'DayTabs',
    'StayRow',
    'StayPicker',
    'ModeSwitcher',
    'RouteOptionList',
    'DaySummary',
    'OverloadWarnings',
    'DegBar',
    'ConfirmBar',
    'PlanDetailView',
    # 2026-09-22 两端拆分后新增的共用件（原来那层壳 PlanLayout 已删：
    # 它的两端分支各归 desktop/ui/PlanView 与 mobile/ui/PlanView）
    'DegBars',
    'PlanPanel',
    'PlanChrome',
]

PLAN_DIR = 'app/common/ui/plan'


def read_app(rel: str) -> str:
    p = WEB / rel
    return p.read_text(encoding='utf-8') if p.exists() else ''


def strip_comments(src: str) -> str:
    out = re.sub(r'/\*.*?\*/', '', src, flags=re.S)
    return re.sub(r'^\s*//.*$', '', out, flags=re.M)


def strip_comments_keep_lines(src: str) -> str:
    """剥注释但**保留换行**（行号与原文件一致，报错能直接定位到行）。

    ⚠️ 只删**独占一行**的 `//` 注释，不动行内 `//` —— 行内可能有 `https://…`
    这样的 URL，按 `//[^\\n]*` 删会把字符串截断，导致引号/括号配对全乱。
    """
    out = re.sub(r'/\*.*?\*/', lambda m: '\n' * m.group(0).count('\n'), src, flags=re.S)
    return re.sub(r'^\s*//.*$', '', out, flags=re.M)


def check_plan() -> None:
    problems: list[str] = []
    hits = 0

    for name in PLAN_COMPONENTS:
        rel = f'{PLAN_DIR}/{name}.tsx'
        hits += 1
        if not (WEB / rel).is_file():
            problems.append(f'缺少行程组件 {rel}')

    # 业务红线：这些字符串不是"文案好不好看"，而是承诺是否落到代码里
    rail = read_app(f'{PLAN_DIR}/TimelineRail.tsx')
    for need, why in (
        ('moveItem(', '「顺序由用户定」必须有真实的换序入口，否则它只是句文案'),
        ('setDwell(', '停留时长要写回 store 后重算，不能只改显示的数字'),
        ('chev-up', '上移按钮 —— 同一天内换序'),
    ):
        hits += 1
        if need not in rail:
            problems.append(f'TimelineRail 缺少 `{need}` —— {why}')

    # 跨天移动的调用在**面板层**：多住宿段下它可能要先弹确认，
    # 而那个"待确认"状态属于面板（要显示在面板顶部，不能被滚走）
    panel = read_app(f'{PLAN_DIR}/ItineraryPanel.tsx')
    for need, why in (
        ('moveItemToDay(', '跨天移动入口'),
        ('crossDayStayWarning(', '跨天移动前的住宿段校验（6.2）'),
    ):
        hits += 1
        if need not in panel:
            problems.append(f'ItineraryPanel 缺少 `{need}` —— {why}')

    opts = read_app(f'{PLAN_DIR}/RouteOptionList.tsx')
    for need, why in (
        ('预估', '打车费必须标「预估」（不含动态调价与拥堵溢价）'),
        ('查询时刻', '路况是查询时刻快照，不能暗示"出发时就是这样"'),
        ("'single'", '接口只返回 1 条是正常情况，要紧凑展示'),
        ("'no-fare'", '打车费缺失要整行隐藏，不显示"费用未知"'),
    ):
        hits += 1
        if need not in opts:
            problems.append(f'RouteOptionList 缺少 `{need}` —— {why}')

    stay = read_app(f'{PLAN_DIR}/StayRow.tsx')
    hits += 1
    if '仅存本机' not in stay:
        problems.append('StayRow 未声明住宿点「仅存本机」（隐私红线）')

    mode = read_app(f'{PLAN_DIR}/ModeSwitcher.tsx')
    hits += 1
    if '不会重新拉取' not in mode:
        problems.append('ModeSwitcher 未说明切换方式不影响已缓存结果')

    summary = read_app(f'{PLAN_DIR}/DaySummary.tsx')
    hits += 1
    if '顺序由你决定' not in summary:
        problems.append('DaySummary 缺少「顺序由你决定，系统只算时间」—— 核心产品承诺')

    # 反向红线：这一页是"计时器"不是"优化器"，不得出现排序优化的暗示。
    # 只看**去注释后的代码** —— 顶部说明里写清"不做 TSP"是应该的。
    #
    # ★ 2026-09-22：这条原先只扫 `routes/plan.tsx`。重排后路由只剩分派，
    #   真代码在共用钩子与两端视图里 —— 继续只扫路由会变成"永远通过"的空检查，
    #   所以改成扫全部四处（钩子 + 两个视图 + 路由）。
    # ★ 2026-09-26：两个页壳（desktop/mobile 的 PlanView）已删 —— 行程的唯一界面
    #   是右侧浮层的详情态（plans/13 §6.6），所以清单跟着换成它。
    for rel in (
        'app/common/logic/usePlanView.ts',
        'app/common/ui/plan/PlanDetailView.tsx',
        'app/routes/plan.tsx',
    ):
        src = strip_comments(read_app(rel))
        for word in ('已为你优化', '已自动排序', 'TSP', '2-opt'):
            hits += 1
            if word in src:
                problems.append(f'{rel} 出现了 `{word}` —— 这一页不做排序优化')

    check('H. 行程组件完整性与业务红线', problems, min_count=20, count=hits)


# ────────────────────────────────────────────────
# I. `import.meta.glob` 的路径基准
# ────────────────────────────────────────────────

# `import.meta.glob` 必须写**字面量相对路径**，别名（`~data`）在 glob 里不可用 ——
# 于是它的正确性完全依赖"本文件在目录树里的深度"。而深度写错**不会报任何错**：
# 只会静默匹配到 0 个文件，页面走进空态。本仓库布局是「代码在 web/、data/ 在仓库根」，
# 正好差一层，是最容易踩进去的地方，所以单独查。
GLOB_RE = re.compile(r'import\.meta\.glob[^(]*\(\s*[\'"]([^\'"]+)[\'"]')


def check_glob_bases() -> None:
    """glob 的相对路径必须解析到**它该在的那个根**。

    判据不是"文件存在吗" —— `data/_generated/` 这类产物在采集脚本跑完前本来就不存在。
    判据是**归属**：指向 `data/` 的 glob 必须落在仓库根的 data/ 下，其余必须落在 web/ 下。
    这样即便目标目录还没生成，也能确定路径深度是对的。
    """
    problems: list[str] = []
    hits = 0

    data_root = (REPO / 'data').resolve()
    web_root = WEB.resolve()

    for f in iter_app_files():
        src = f.read_text(encoding='utf-8')
        rel = f.relative_to(WEB)
        for spec in GLOB_RE.findall(src):
            hits += 1
            # 取第一个通配符之前的字面目录
            literal = re.split(r'[*?{]', spec)[0]
            literal_dir = literal.rsplit('/', 1)[0] if '/' in literal else ''
            resolved = (f.parent / literal_dir).resolve() if literal_dir else f.parent.resolve()

            expect = data_root if re.search(r'(^|/)data/', spec) else web_root
            if resolved != expect and expect not in resolved.parents:
                problems.append(
                    f'{rel}: glob `{spec}` 解析到 {resolved}，应在 {expect} 之下'
                    '（相对深度写错了？）'
                )

    check('I. import.meta.glob 路径基准', problems, min_count=5, count=hits)


# ────────────────────────────────────────────────
# J. 仓库布局归属（代码在 web/、内容在仓库根）
# ────────────────────────────────────────────────

def check_layout() -> None:
    """顶层归属不能漂移。

    ## 为什么比 I 项还值得单独查
    I 项查的是"glob 能不能读到数据"，它是**按深度**解析的 —— 就算 `web/data/`
    被误建出来（空目录或一份残留副本），I 项照样全绿，但人会以为数据在 `web/` 下。
    归属比可达性更容易悄悄漂移，而且漂移之后要花很久才发现"改的不是那份文件"。
    """
    problems: list[str] = []
    hits = 0

    # 内容 / 文档 / 抓取 / 契约 / 守则：骨架**都在仓库根**
    #   ★ 2026-09-21：pipeline（抓取）· schema（契约）· tools（守则）从 web/ 搬到根，
    #     这条正是"前端工程里不许混 Python"的护栏化。
    #   ★ 2026-10-07：prototype/ 整体删除 —— 早期原型（低保真线框 + 高保真）已完成
    #     使命，布局与交互全部落地进 web/app/。设计意图改由 plans/ 承载（人读、git 追踪），
    #     不再靠一份会过期的 HTML 原型"看效果"。**它曾进过git 历史**（前两次提交），
    #     要找回来从 git log取，不要在仓库里留副本。
    for name in ('plans', 'data', 'pipeline', 'schema', 'tools'):
        hits += 1
        if not (REPO / name).is_dir():
            problems.append(f'{name}/ 应在仓库根，实际不存在')
        hits += 1
        if (WEB / name).exists():
            problems.append(f'web/{name}/ 不该存在（{name} 归仓库根，代码那一层不该有它）')

    # ★ 已删除的目录不许复活 —— 它曾是"顶层目录清单"的一员，只删清单不钉这条的话，
    #   下次谁再 mkdir 一个prototype/ 进去，J 项照样全绿。
    for name in ('prototype',):
        hits += 1
        if (REPO / name).exists():
            problems.append(
                f'{name}/ 已于 2026-10-07 删除，不该复活 —— '
                '布局与交互已落地进 web/app/，设计意图见 plans/；'
                '需要看早期原型请从 git 历史取'
            )

    # 展示工程：骨架在 web/
    for name in ('app', 'public'):
        hits += 1
        if not (WEB / name).is_dir():
            problems.append(f'web/{name}/ 应存在')

    # ★ web/ 下不许有任何 Python —— 抓取归 pipeline/、工程守则归 tools/
    hits += 1
    stray_py = sorted(
        p.relative_to(REPO).as_posix()
        for p in WEB.rglob('*.py')
        if 'node_modules' not in p.parts
    )
    if stray_py:
        problems.append(
            'web/ 下不该有 Python（抓取归 pipeline/、守则归 tools/）：' + ', '.join(stray_py[:6])
        )

    # ★ 契约目录在仓库根 → 它的 bare import 需要**两端各架一条桥**
    #   （Rollup 与 tsc 都从"文件自身所在目录"往上找 node_modules，而
    #    `<repo>/schema/` 之上没有 node_modules）。
    #   只改一边的后果都是构建期才暴露：漏 vite 一侧 → Rollup 解析失败整包构建失败；
    #   漏 tsconfig 一侧 → tsc 报 100+ 条假错误（找不到模块 + implicit any 连锁）。
    #   所以这里先把两边钉在一起，别等 CI 才知道。★ 本项的反证：删掉 vite 那条 alias，
    #   `pnpm build` 立刻死在 `Rollup failed to resolve import "zod"`。
    hits += 1
    schema_ts = REPO / 'schema' / 'schema.ts'
    if not schema_ts.is_file():
        problems.append('schema/schema.ts 不在仓库根 —— 两端共享的契约必须在根')
    else:
        bare_deps = sorted(set(
            re.findall(r"^import\s+.*?from\s+'([^./][^']*)'", schema_ts.read_text(encoding='utf-8'), re.M)
        ))
        vite_src = (WEB / 'vite.config.ts').read_text(encoding='utf-8')
        ts_src = (WEB / 'tsconfig.json').read_text(encoding='utf-8')
        for dep in bare_deps:
            if not re.search(rf"^\s*['\"]?{re.escape(dep)}['\"]?\s*:", vite_src, re.M):
                problems.append(
                    f'schema.ts 依赖 `{dep}`，但 web/vite.config.ts 缺 resolve.alias —— '
                    f'Rollup 会解析失败，整包构建挂掉'
                )
            if not re.search(rf'"{re.escape(dep)}"\s*:', ts_src):
                problems.append(
                    f'schema.ts 依赖 `{dep}`，但 web/tsconfig.json 的 paths 缺 `{dep}` —— '
                    f'tsc 会报一堆假错误'
                )

    # ★ pipeline/ 的路径层级：脚本搬过两次家（web/scripts/harvest/ → 仓库根 pipeline/
    #   → 2026-10-07 按依赖分三层 pipeline/{core,providers,steps}/），`parents[N]` 的 N
    #   必须跟着变。漏改**不会报错**，只会把仓库根算成仓库的上一级
    #   （`sys.path` 塞错目录 → import 失败或读到别的同名包）。2026-09-21 实测漏改了 5 个文件，
    #   全靠人工 grep 才发现 —— 所以钉在这里。
    #
    # ★ 判据改成**按文件所在深度算期望值**，而不是写死 1：
    #   文件在 pipeline/<sub>/x.py → 到仓库根是parents[2]；
    #   文件在 pipeline/x.py       → 到仓库根是 parents[1]。
    #   这样以后再搬目录，只需改 `pmod()` 映射表，护栏本身不用动。
    hits += 1
    wrong_depth = []
    pipeline_root = REPO / 'pipeline'
    # ★ 唯一例外：`core/layout.py` 是 `data/` 布局的单一真源，它需要的是
    #   **流水线根 `pipeline/`**（用来定位 .cache / .env），不是仓库根。
    #   那里已经是`parents[1]` 拿 pipeline/，再往上 `.parent` 才是仓库根。
    depth_exception = {'core/layout.py'}
    for py in pipeline_root.rglob('*.py'):
        if '__pycache__' in py.parts:
            continue
        rel_in_pipeline = py.relative_to(pipeline_root).as_posix()
        if rel_in_pipeline in depth_exception:
            continue
        # 本文件在 pipeline/ 下第几层 ⇒到仓库根就 parents[几]
        want = len(py.relative_to(pipeline_root).parts)   # pipeline/x.py → 1；pipeline/core/x.py → 2
        for m in re.finditer(r'parents\[(\d+)\]', py.read_text(encoding='utf-8')):
            if int(m.group(1)) != want:
                wrong_depth.append(
                    f'{py.relative_to(REPO).as_posix()} 用了 parents[{m.group(1)}]，'
                    f'按其所在深度应为 parents[{want}]'
                )
    if wrong_depth:
        problems.append(
            'pipeline/ 里的 parents[N] 必须等于该文件到仓库根的层数'
            f'（pipeline/x.py → [1]，pipeline/core|x.py → [2]；例外：{", ".join(sorted(depth_exception))}）—— '
            + '；'.join(sorted(set(wrong_depth))[:4])
        )

    # Netlify 配置必须在仓库根（Netlify 只在这里、或已配置的 base 目录里找它）
    netlify = REPO / 'netlify.toml'
    hits += 1
    if not netlify.is_file():
        problems.append('netlify.toml 必须在仓库根（Netlify 只在此或 base 目录寻找配置）')
    elif 'base = "web"' not in netlify.read_text(encoding='utf-8'):
        problems.append('netlify.toml 缺少 base = "web" —— 部署会找不到 web/ 里的工程')
    hits += 1
    if (WEB / 'netlify.toml').exists():
        problems.append('netlify.toml 不该放在 web/ 里（Netlify 找不到它，等于没配）')

    check('J. 仓库布局归属', problems, min_count=15, count=hits)


# ────────────────────────────────────────────────
# K. 应用入口文件完整性与依赖自洽
# ────────────────────────────────────────────────

# 这两个入口**必须由我们自己提供**，不能依赖框架的默认模板。原因见 K 函数说明。
ENTRY_FILES = ('app/entry.client.tsx', 'app/entry.server.tsx')


def check_entries() -> None:
    """两个入口文件必须存在，且入口里引用的裸模块要在 package.json 里声明。

    ## 为什么"少一个文件"能让 dev server 崩掉
    `@react-router/dev` 的 `resolveEntryFiles()` 在没有 `app/entry.server.tsx` 时，
    并不是"用一下默认模板就完事"，而是：
      1. 发现 `package.json` 里没有 `isbot` →
      2. **自动改写你的 `package.json`**（写入 `"isbot": "^5"`）→
      3. 用 `detectPackageManager()` 猜包管理器（它读 `npm_config_user_agent`，
         也就是**启动 dev 的那个包管理器**）并执行 `<pm> install`。

    第 3 步是硬失败点：当 `node_modules` 是 pnpm 装的、而 dev 是用 npm 启的时候，
    npm 去读 pnpm 的树会直接崩 —— dev server 根本起不来，报的还是

        npm error Cannot read properties of null (reading 'matches')

    这种完全看不出因果的错（实测于 2026-09-18）。

    换句话说：**少一个文件 → dev server 崩**，现象与原因隔了十万八千里。
    与其让人记住这条因果链，不如把"入口必须自己提供"变成一条断言。
    """
    problems: list[str] = []
    hits = 0

    for rel in ENTRY_FILES:
        hits += 1
        if not (WEB / rel).is_file():
            problems.append(
                f'缺少 {rel} —— React Router 会退回内置默认入口，'
                '并自动改写 package.json、执行一次 `<包管理器> install`；'
                '包管理器不一致时会直接崩掉 dev server（报 npm 的 matches 错）'
            )

    # 入口里 import 的裸模块必须已在 package.json 声明，否则运行时解析失败
    pkg_path = WEB / 'package.json'
    declared: set[str] = set()
    if pkg_path.is_file():
        pkg = json.loads(pkg_path.read_text(encoding='utf-8'))
        declared = set(pkg.get('dependencies', {})) | set(pkg.get('devDependencies', {}))
    else:
        problems.append('web/package.json 不存在')

    for rel in ENTRY_FILES:
        f = WEB / rel
        if not f.is_file():
            continue
        for spec in re.findall(r"from\s+'(?!\.|node:)([^']+)'", f.read_text(encoding='utf-8')):
            bare = '/'.join(spec.split('/')[:2]) if spec.startswith('@') else spec.split('/')[0]
            hits += 1
            if bare not in declared:
                problems.append(f'{rel} 引用了未在 package.json 声明的模块 `{bare}`')

    check('K. 应用入口文件完整性', problems, min_count=3, count=hits)


# ────────────────────────────────────────────────
# L. 真实类型检查（tsc --noEmit）
# ────────────────────────────────────────────────

def check_typecheck() -> None:
    """跑一次真实的 `tsc --noEmit`。

    A–K 全部是正则匹配，**不解析 TypeScript**。实测过（2026-09-18）：
    A–K 报 ALL_CLEAN 的同时，`tsc` 报出 50+ 个类型错误
    （含"坐标少了一层 `.point`"这类**不会崩、只会静默出错**的误用）
    以及 1 个语法错误（多一个 `}`，让每条路由都返回 500）。

    这类问题只能靠编译器发现。正则也许能加一百条规则，但它永远不知道什么是"类型不对"。

    依赖未装 / typegen 产物缺失时**跳过而不判失败** —— 那种情况下它本来也跑不了，
    强行报红只会变成噪声，进而被习惯性忽略。跳过时打 note 说明原因。
    """
    tsc = WEB / 'node_modules' / 'typescript' / 'lib' / 'tsc.js'
    node = shutil.which('node')

    if not tsc.is_file():
        notes.append('L 项跳过：未安装依赖（找不到 typescript）。装好依赖后本项才会真正执行。')
        return
    if node is None:
        notes.append('L 项跳过：PATH 里找不到 node。')
        return
    if not (WEB / '.react-router' / 'types').is_dir():
        notes.append(
            'L 项跳过：缺少 .react-router/types（路由类型产物）——'
            '先跑一次 `pnpm dev` 或 `pnpm typecheck` 生成它。'
        )
        return

    proc = subprocess.run(
        [node, str(tsc), '--noEmit', '-p', 'tsconfig.json'],
        cwd=str(WEB),
        capture_output=True,
        text=True,
        encoding='utf-8',
        errors='replace',
    )
    out = (proc.stdout or '') + (proc.stderr or '')
    errors = [ln for ln in out.splitlines() if re.match(r'^\S.+\(\d+,\d+\): error', ln)]

    problems: list[str] = []
    if proc.returncode != 0:
        problems.append(f'tsc 退出码 {proc.returncode}，共 {len(errors)} 条类型错误')
        problems.extend(errors[:10])

    check('L. 真实类型检查（tsc --noEmit）', problems, min_count=1, count=1)


# ────────────────────────────────────────────────
# M. env 文件命名合法性 + 是否被 gitignore 兜住
# ────────────────────────────────────────────────

# Vite **只会**加载这几种名字，其它名字一概静默跳过（不报错、不打日志）。
# 实测踩过：`.env.dev` 里的 key 从未生效 —— 因为 `pnpm dev` 的 mode 是
# `development` 全称，不是 `dev`；而页面只会说"地图未解锁"，完全看不出是文件名问题。
ENV_NAME_OK = re.compile(r'^\.env(\.example|\.local|\.(development|production|test)(\.local)?)?$')


def check_env_files() -> None:
    """env 文件：名字必须是 Vite 认的，内容必须被 gitignore 挡住。

    两件事都会**静默失败**，所以单独查：

    | 错误 | 后果 |
    |------|------|
    | 名字不在 Vite 的清单里（如 `.env.dev`） | key 不生效，UI 只说"地图未解锁"，排查成本极高 |
    | 名字合法但 gitignore 没覆盖 | key 被 git 跟踪，一次 push 就泄露 |
    """
    problems: list[str] = []
    hits = 0

    env_files = sorted(p for p in WEB.glob('.env*') if p.is_file())

    # ① 命名合法性
    for p in env_files:
        hits += 1
        if not ENV_NAME_OK.match(p.name):
            problems.append(
                f'{p.name} 不是 Vite 会加载的文件名（静默跳过）—— '
                f'改成 .env.local（dev 与 build 都生效）或 .env.development（仅 dev）'
            )

    # ② .gitignore 必须用通配兜底。
    #    逐个枚举文件名必然漏：Vite 的合法名字有 6 种，漏掉的那个正好是放 key 的那个。
    # ★★ 2026-09-30：配置**按工程分家** —— `web/` 是前端的（Vite 会加载并注入
    #    `import.meta.env`），`pipeline/` 是采集侧的（Python 脚本读）。
    #    **两边都要通配兜底**：只写 web/ 那份的话，`pipeline/.env.local` 里的腾讯/高德 key
    #    会直接进 git —— 而那边的 key 恰恰都是**服务端**的，泄露后果更重。
    gi = (REPO / '.gitignore').read_text(encoding='utf-8')
    hits += 1
    if '/web/.env*' not in gi:
        problems.append('缺少 /web/.env* 通配规则（枚举式写法漏掉新名字 = key 进 git）')
    hits += 1
    if '!/web/.env.example' not in gi:
        problems.append('缺少 !/web/.env.example —— 模板要提交，需开白名单')
    hits += 1
    if '/pipeline/.env*' not in gi:
        problems.append(
            '缺少 /pipeline/.env* 通配规则 —— 采集侧的 key（腾讯 WebService / 高德 / Unsplash…）'
            '全在 `pipeline/.env.local` 里，不忽略就是**服务端 key 进 git**'
        )
    hits += 1
    if '!/pipeline/.env.example' not in gi:
        problems.append('缺少 !/pipeline/.env.example —— 采集侧模板要提交，需开白名单')

    # ③ 用 git 自己的语义实测，不自己实现 gitignore 规则（那套顺序/取反语义很容易写错）
    ignorable = [p for p in env_files if p.name != '.env.example']
    ignorable += [p for p in PIPELINE_DIR.glob('.env*') if p.is_file() and p.name != '.env.example']
    if ignorable:
        rel = [p.relative_to(REPO).as_posix() for p in ignorable]
        try:
            # ★ 用**位置参数**而不是 `--stdin`：`--stdin` 在本机（Windows + Git Bash）会给
            #   行尾带上 `\r`，git 会把整条路径当成"含特殊字符"再包一层引号回显
            #   —— 于是 `web/.env.local` 永远不等于输出里的 `"web/.env.local\r"`，
            #   检查**假红**。以前 `rel` 只有一条时侥幸没触发，加了第二条才暴露。
            r = subprocess.run(
                ['git', 'check-ignore', *rel],
                cwd=REPO, capture_output=True, text=True, timeout=10,
            )
        except (OSError, subprocess.SubprocessError):
            r = None
        if r is None or r.returncode not in (0, 1):
            notes.append('M: git 不可用，跳过「env 文件确实被忽略」的实测（文本规则检查仍在）')
        else:
            # 再兜一层：去引号、去 CR、去空白
            ignored = {
                line.strip().strip('"').strip()
                for line in r.stdout.splitlines()
                if line.strip()
            }
            hits += len(rel)
            for path in rel:
                if path not in ignored:
                    problems.append(f'{path} 未被 gitignore 覆盖 —— 提交会连带 key 泄露')

    check('M. env 文件命名与忽略规则', problems, min_count=4, count=hits)


# ────────────────────────────────────────────────
# N. 浮层可命中：地图层必须是层叠上下文
# ────────────────────────────────────────────────
#
# 实测踩过（2026-09-19）：浮层看着好好的，但里面**点什么都没反应、一拖就在拖地图**。
# 根因不在浮层，而在地图层：
#
#   腾讯 GL 会在容器内部建一个 **z-index: 1000** 的透明层（标注/覆盖物宿主），
#   它铺满整个视口且 `pointer-events: auto`。`.map-layer` 是
#   `position:absolute` + `z-index:auto` —— 这**不构成层叠上下文**，
#   于是那个 1000 逃到页面级，把 z-index 只有 20~40 的浮层全部压在下面。
#   视觉上毫无异常（那层是透明的），但**命中测试全落到它头上**，
#   所有点击/拖动/滚轮都被交给地图。
#
# 这类"看不见的层"没法靠肉眼发现，所以固化成检查：
#   ① `.map-layer` 必须建立层叠上下文（z-index 数值 或 isolation:isolate）
#   ② 每个浮层根必须自带正 z-index，否则地图层一旦拿到 0 就会被盖住
#
# ★ `min_count` 从 5 降到 4（2026-10-16）
#   `StayPicker` 的遮罩原先**误挂** `data-overlay`，凑够了这个下限。
#   2026-10-16 统一遮罩时把它摘掉了 —— 遮罩是**临时遮挡**（开着时用户在那块弹窗里，
#   不在看地图），参与 `fitView` 的"地图可用区"实测只会让下一次 `fit` 把点位挤到一侧。
#   ⇒ 样本从 5 个文件降到 4 个，这是**修正**而非退化，故同步下调下限。
#   真正的护栏在下面：一旦再有浮层漏掉正 z-index，照样会被逐个报出来。

MAP_LAYER_RE = re.compile(r'\.map-layer\s*\{([^}]*)\}', re.S)
CSS_COMMENT_RE = re.compile(r'/\*.*?\*/', re.S)


def check_overlay_stacking() -> None:
    problems: list[str] = []
    hits = 0

    # ⚠️ 必须先剥注释再匹配：`.map-layer` 的注释里就写着「z-index: 1000」，
    #    不剥的话正则会被注释喂饱，检查变成**永远通过**（反证测试实测过一次）。
    css = CSS_COMMENT_RE.sub('', (WEB / 'app' / 'app.css').read_text(encoding='utf-8'))
    hits += 1
    m = MAP_LAYER_RE.search(css)
    if not m:
        problems.append('app.css 里找不到 .map-layer 规则')
    else:
        block = m.group(1)
        has_z = re.search(r'z-index\s*:\s*-?\d+', block)
        has_iso = re.search(r'isolation\s*:\s*isolate', block)
        if not (has_z or has_iso):
            problems.append(
                '.map-layer 不是层叠上下文（缺 `z-index: 0` 或 `isolation: isolate`）'
                '—— SDK 内部 z-index:1000 的透明层会逃到页面级，'
                '把所有浮层的点击/拖动/滚轮都吃掉交给地图（表现为"浮层没用"）'
            )

    z_re = re.compile(r'\bz-\[?(\d+)\]?')
    default_z_re = re.compile(r'\bz\s*=\s*(\d+)')
    for f in sorted(WEB.glob('app/**/*.tsx')):
        text = f.read_text(encoding='utf-8')
        # ⚠️ 必须剥注释，且必须匹配**带等号的 JSX 属性** ——
        #    `querySelectorAll('[data-overlay]')` 和注释里都会出现这个词，
        #    第一版按子串匹配，直接把 map-shell 报成假阳性。
        stripped = re.sub(r'/\*.*?\*/', '', text, flags=re.S)
        stripped = re.sub(r'^\s*//.*$', '', stripped, flags=re.M)
        if not re.search(r'data-overlay\s*=', stripped):
            continue
        hits += 1
        rel = f.relative_to(WEB)
        vals = [int(v) for v in z_re.findall(text)] + [int(v) for v in default_z_re.findall(text)]
        if not vals:
            problems.append(
                f'{rel} 用了 data-overlay 却没有正 z-index —— '
                '地图层是 z-index:0 的层叠上下文，没有 z-index 的浮层会被它盖住'
            )
            continue
        for v in vals:
            if v < 1:
                problems.append(f'{rel} 的 z-index={v} 不是正数，会被地图层盖住')

    check('N. 浮层可命中（地图层是层叠上下文 + 浮层自带正 z-index）', problems, min_count=4, count=hits)


# ────────────────────────────────────────────────
# O. TMap SDK 调用契约（自写 .d.ts 拦不住的那一类）
# ────────────────────────────────────────────────
#
# 为什么必须有这一项：`app/common/map/tencent/tmap.d.ts` 是**我们自己手写的**声明。
# `tsc` 只能证明「声明与调用一致」，**证明不了「声明与 SDK 一致」**。
# 于是同一类 bug 反复出现，而且全都是**静默**的（不报错、不崩溃，只是没效果）：
#
#   · `MarkerCluster.setData()` —— SDK 上根本没有这个方法（正确的是 `setGeometries`），
#     移动端一进市级页**整页白屏**
#   · 几何写成 `style: { text }` —— `MultiLabel` 只读 `content`，于是 34 个省级徽标
#     **一个都不渲染**，看起来像"标注功能没做"
#   · `LabelStyle({ fontSize })` —— 参数名不存在（正确的是 `size`），字号静默退回 14px
#   · `PolygonStyle({ borderWidth: 1.2 })` —— 小数会被样式校验器刷一条 console.error，
#     把真正的错误淹掉
#
# 白名单来源：**CDP 读 SDK 实例的 own properties 实测**，不是文档、不是猜。
# 要改白名单，先重新实测一遍再改。

STYLE_KEY_WHITELIST: dict[str, set[str]] = {
    'LabelStyle': {
        'color', 'backgroundColor', 'borderColor', 'borderWidth', 'borderRadius',
        'padding', 'offset', 'strokeColor', 'strokeWidth',
        'alignment', 'verticalAlignment',
        'size', 'width', 'height', 'scale', 'angle', 'wrapOptions',
    },
    'PolygonStyle': {'color', 'showBorder', 'borderColor', 'borderWidth', 'borderDash'},
    'PolylineStyle': {
        'color', 'width', 'borderWidth', 'borderColor', 'lineCap', 'lineJoin', 'dashArray',
    },
    'MarkerStyle': {'width', 'height', 'anchor', 'src', 'color', 'opacity', 'rotation', 'zIndex'},
}

#: 看起来很像、但实测不存在的字段 → 正确写法。用于把报错写成"该怎么改"而不是"你错了"
STYLE_KEY_SUGGEST: dict[str, str] = {
    'fontSize': 'size',
    'fontFamily': '（LabelStyle 不支持下设字体）',
    'fontWeight': '（LabelStyle 不支持字重）',
    'align': 'alignment',
    'verticalAlign': 'verticalAlignment',
    'cursor': '（LabelStyle 不支持 cursor）',
}

STYLE_CALL_RE = re.compile(
    r'new\s+TMap\.(LabelStyle|PolygonStyle|PolylineStyle|MarkerStyle)\s*\(\s*\{'
)

#: 装了文字的图层变量名 —— 命名约定即契约：这些图层的几何必须带 `content`
LABEL_LAYER_RE = re.compile(r'\b(labels|badges)\s*\.\s*setGeometries\s*\(')


def _balanced_block(text: str, open_idx: int, opener: str = '{', closer: str = '}') -> str:
    """取出与 `open_idx` 处开括号配对的一整块（含首尾）。跳过字符串与注释。"""
    depth = 0
    quote = ''
    i = open_idx
    n = len(text)
    while i < n:
        ch = text[i]
        if quote:
            if ch == '\\':
                i += 2
                continue
            if ch == quote:
                quote = ''
            i += 1
            continue
        if ch in '\'"`':
            quote = ch
            i += 1
            continue
        if ch == '/' and i + 1 < n and text[i + 1] == '/':
            while i < n and text[i] != '\n':
                i += 1
            continue
        if ch == '/' and i + 1 < n and text[i + 1] == '*':
            j = text.find('*/', i + 2)
            i = n if j < 0 else j + 2
            continue
        if ch == opener:
            depth += 1
        elif ch == closer:
            depth -= 1
            if depth == 0:
                return text[open_idx:i + 1]
        i += 1
    return ''


def _keys_at_depth1(block: str) -> list[str]:
    """取出对象字面量里**第 1 层**的键名（跳过 `anchor: { x, y }` 这类嵌套）。"""
    keys: list[str] = []
    depth = 0
    quote = ''
    i = 0
    n = len(block)
    while i < n:
        ch = block[i]
        if quote:
            if ch == '\\':
                i += 2
                continue
            if ch == quote:
                quote = ''
            i += 1
            continue
        if ch in '\'"`':
            quote = ch
            i += 1
            continue
        if ch == '/' and i + 1 < n and block[i + 1] == '/':
            while i < n and block[i] != '\n':
                i += 1
            continue
        if ch == '/' and i + 1 < n and block[i + 1] == '*':
            j = block.find('*/', i + 2)
            i = n if j < 0 else j + 2
            continue
        if ch in '{[(':
            depth += 1
            i += 1
            continue
        if ch in '}])':
            depth -= 1
            i += 1
            continue
        if depth == 1 and (ch.isalpha() or ch == '_'):
            j = i
            while j < n and (block[j].isalnum() or block[j] == '_'):
                j += 1
            k = j
            while k < n and block[k] in ' \t':
                k += 1
            if k < n and block[k] == ':':
                keys.append(block[i:j])
                i = k + 1
                continue
            i = j
            continue
        i += 1
    return keys


def check_tmap_contract() -> None:
    problems: list[str] = []
    hits = 0

    for f in sorted(ENGINE_DIR.glob('*.ts')):
        if f.name == 'tmap.d.ts':
            continue
        rel = f.relative_to(WEB)
        # 🚨 **必须先剥注释**。这里踩过第二次同样的坑：
        #    解释 `content` 用法的注释里就写着 `content`，不剥的话
        #    `'content' not in block` 永远为假 —— 检查变成**永远通过**。
        #    （第一次是 `.map-layer` 的注释里写着「z-index: 1000」。）
        raw = f.read_text(encoding='utf-8')
        text = strip_comments_keep_lines(raw)
        line_of = lambda idx: text[:idx].count('\n') + 1  # noqa: E731

        for m in STYLE_CALL_RE.finditer(text):
            style_name = m.group(1)
            allowed = STYLE_KEY_WHITELIST[style_name]
            open_idx = text.index('{', m.end() - 1)
            block = _balanced_block(text, open_idx)
            if not block:
                problems.append(f'{rel}:{line_of(m.start())} 解析不出 new TMap.{style_name}({{…}}) 的字面量')
                continue
            hits += 1
            for key in _keys_at_depth1(block):
                if key in allowed:
                    continue
                fix = STYLE_KEY_SUGGEST.get(key)
                tail = f'，实测的正确写法是 `{fix}`' if fix else ''
                problems.append(
                    f'{rel}:{line_of(m.start())} TMap.{style_name} 里的 `{key}` 不是实测存在的参数{tail} —— '
                    '腾讯对未知字段是**静默忽略**的，不报错但样式会悄悄失效'
                )

        # 装了文字的图层必须传 `content`：SDK 只读这个字段
        for m in LABEL_LAYER_RE.finditer(text):
            open_idx = text.index('(', m.end() - 1)
            block = _balanced_block(text, open_idx, '(', ')')
            hits += 1
            if not block:
                problems.append(f'{rel}:{line_of(m.start())} 解析不出 setGeometries(…) 的实参块')
            elif re.fullmatch(r'\(\s*\[\s*\]\s*\)', block):
                # `setGeometries([])` 是清空调用，本来就不该有几何，跳过
                continue
            elif 'content' not in block:
                problems.append(
                    f'{rel}:{line_of(m.start())} 文字图层的 setGeometries 没有传 `content` —— '
                    'SDK 只读这个字段（`style: { text }` 是被忽略的），'
                    '漏了不报错但**一个文字标签都渲染不出来**'
                )

    if problems:
        failures.append('O. TMap SDK 调用契约（样式参数名 / 文字几何字段）')
        for p in problems:
            print(f'  [FAIL] O. {p}')
    else:
        print(f'  [ ok ] O. TMap SDK 调用契约（校验 {hits} 处）')


# ────────────────────────────────────────────────
# P. 图层重刷管道
# ────────────────────────────────────────────────
#
# 这一类 bug 的形态很固定：**回调存在、但没人传 / 没人登记** —— 于是它静默地什么都不做。
#
# 实测踩过两轮（2026-09-19）：
#   第 1 轮：`useTMap` 早就支持 `onViewportChange`，`map-shell` 却从未传它；
#            页面上也从没人调重刷。两边都以为对方会接。后果链条：
#            圆点/徽标/标注只在**数据到达**那一刻算过一次 → 那一刻地图还停在上一页的视野
#            （从首页进城市页是全国视野）→ 分档表按错误的缩放定档
#            → 城市页 46 个点位**一个名字都不显示**、34 个省级徽标**一个都不渲染**。
#            而且**不报任何错**，页面看着完全正常。
#   第 2 轮：管道接通后，`home` / `province` 两个用 `districtLayer` 的页面却**没有登记**
#            （只有城市页登记了）—— 窄屏下的徽标避让要按缩放重算，不登记就只算一次。
#            根因是"登记"当时只是一处约定，没有检查项。
#
# 所以本项现在查三件事：
#   ① 每个 `useTMap({…})` 必须传 `onViewportChange`
#   ② **凡创建了点位/区划图层的文件，必须登记 `registerRefresh(`**（不再是"至少有一处"）
#   ③ 登记的函数必须是图层的 `refreshView`（防止登记了个空函数应付检查）

USE_TMAP_CALL_RE = re.compile(r'\buseTMap\s*\(')
REGISTER_CALL_RE = re.compile(r'\bregisterRefresh\s*\(')
LAYER_FACTORY_RE = re.compile(r'\bcreate(?:Poi|District)Layer\s*\(')
REFRESH_VIEW_RE = re.compile(r'\brefreshView\s*\(')


def check_view_refresh_pipeline() -> None:
    label = 'P. 图层重刷管道（视野广播有消费者 + 每个图层都已登记）'
    problems: list[str] = []
    hits = 0

    # ① 每一处 useTMap({…}) 都必须把视野广播接走。
    #    只在 routes/ 里找 —— `useTMap.ts` 自己的 `export function useTMap(` 会误命中。
    for f in sorted((WEB / 'app' / 'routes').rglob('*.ts*')):
        text = strip_comments_keep_lines(f.read_text(encoding='utf-8'))
        rel = f.relative_to(WEB)
        for m in USE_TMAP_CALL_RE.finditer(text):
            line = text[:m.start()].count('\n') + 1
            open_idx = text.index('{', m.end() - 1)
            block = _balanced_block(text, open_idx)
            hits += 1
            if not block:
                problems.append(f'{rel}:{line} 解析不出 useTMap({{…}}) 的参数块')
            elif 'onViewportChange' not in block:
                problems.append(
                    f'{rel}:{line} useTMap({{…}}) 没有传 `onViewportChange` —— '
                    '视野广播会空转：圆点/徽标/标注只在数据到达那一刻算过一次，之后缩放/平移都不再重算'
                )

    # ② 凡建了图层（点位 / 区划）的文件，必须**在同一文件里**登记重刷。
    #    判据用"同文件"而不是"整个 app 里有一处"，因为登记的是**这个文件自己**的图层；
    #    只要有一个图层没登记，它就会永远停在"数据到达那一刻"的档位。
    #
    #    ⚠️ 只扫「调用侧」目录。`app/common/map/tencent/*` 是**定义**图层工厂的地方
    #       （`export function createPoiLayer(`），扫进去会得到一串假失败 ——
    #       工厂自己当然不会去调 `registerRefresh`，它连外壳都不认识。
    for f in sorted(
        p for root in CALLER_DIRS
        for p in root.rglob('*.ts*')
    ):
        raw = f.read_text(encoding='utf-8')
        text = strip_comments_keep_lines(raw)
        if not LAYER_FACTORY_RE.search(text):
            continue
        hits += 1
        rel = f.relative_to(WEB)
        if not REGISTER_CALL_RE.search(text):
            m = LAYER_FACTORY_RE.search(text)
            line = text[: m.start()].count('\n') + 1 if m else 1
            problems.append(
                f'{rel}:{line} 建了图层却没有登记 `registerRefresh(` —— '
                '该图层只会按"数据到达那一刻"的视野算一次，之后缩放/平移都不重刷'
            )
            continue
        if not REFRESH_VIEW_RE.search(text):
            problems.append(
                f'{rel} 登记了 `registerRefresh(` 却没有调用图层的 `refreshView(` —— '
                '登记了个空函数，检查通过但视野变化时什么都不会发生'
            )

    check(label, problems, 2, hits)


# ────────────────────────────────────────────────
# Q. 顶栏信息条与底图署名
# ────────────────────────────────────────────────
#
# 三条各自都踩过一次，而且失效时**都不报错**：
#
#   ① `TopBar` 早期把左上角整块设成"可选渲染"（`onHome || onSearch` 才渲染）。
#      首页两个都没传 → 左上角空白 → 顶部轨道什么都没有，用户问"这上面是没做还是被挡住了"。
#      现在左上角是站标（`Brand` 在每一级都渲染）+ 搜索框，都不靠调用方传参开关；
#      所以本项只做**结构性**断言：每个 `<TopBar>` 必须传 `shell`（组件契约的必填项，
#      漏传 tsc 也拦，但多一道不亏）。
#      ★ 2026-09-19 改：这里原来查 `crumbs`（面包屑数组）；
#      ★ 2026-09-22 改：`region`（地区文字）也删了 —— 见下面 ②。
#   ② ★ **顶栏不再回答"我在哪"**（2026-09-22 定稿，改了三轮，别再往回加）：
#      地区选择器 ▾ → 换成只读文字 → **连文字也删**。理由是它和地图的缩放揭示
#      是两套并行的"我在哪"：文字按 URL 说"我在四川"，地图按 zoom 已经把市徽标
#      铺出来了；而它改 URL 时视野不动 —— 用户看到的是"选了西安、西安还在屏幕上"。
#      同一轮还删了站点导航里的「城市」：那是"当前板块"的自我描述，全站只有
#      这一个板块，零信息量。完整叙事写在 `common/ui/TopBar.tsx` 文件头。
#      本项**反向守**：TopBar 源码里不得再出现 `region`，也不得渲染 `<RegionPicker`。
#   ③ 底图署名换过两次位置：先挂在底部图例条里（图例条一删就跟着没了），
#      后来改成右下角自绘 `<MapAttribution>` —— 但腾讯 GL SDK **本来就在左下角
#      画一份带审图号的版权**（实测 `.logo-text` = `©2026 Tencent - GS(2026)1190号`），
#      我们那份「© 腾讯地图」是纯重复、信息量还更低。已撤掉，本项反向守"不再自绘"。
#   ④ 撤掉自绘那份之后，SDK 那份成了页面上**唯一**的署名 —— 于是它变成红线：
#      CSS 里不得出现隐藏 `.logo-text` 的规则（有人会为了"干净"把它 display:none）。

TOPBAR_RE = re.compile(r'<TopBar\b')
SHELL_ATTR_RE = re.compile(r'\bshell\s*=')
REGION_PICKER_RE = re.compile(r'<RegionPicker\b')
# ⚠️ 必须带词边界。第一版写的是 `'region' not in attrs`，反证时喂 `regionx="全国"`
#    竟然**通过**了 —— 子串匹配把错拼的属性当成了正品（同 R 项那类"检查永远为真"的毛病）
REGION_ANY_RE = re.compile(r'\bregion\b')
LEGACY_ATTR_RE = re.compile(r'<MapAttribution\b|\bBASEMAP_ATTRIBUTION\b')
BOTTOM_BAR_MODULE_RE = re.compile(r"common/ui/LegendBar")
# 针对 SDK 自带署名的隐藏式规则。只认"同一个规则块里既选中它又把它藏起来"，
# 允许将来为可读性调它的颜色/字号
HIDE_SDK_LOGO_RE = re.compile(
    r'logo-text[^{}]*\{[^{}]*?(display\s*:\s*none|visibility\s*:\s*hidden)'
)


def check_top_bar() -> None:
    label = 'Q. 顶栏信息条与底图署名（不再显示"我在哪" + 不自绘署名 + 不隐藏 SDK 署名）'
    problems: list[str] = []
    hits = 0

    for f in sorted((WEB / 'app').rglob('*.tsx')):
        text = strip_comments_keep_lines(f.read_text(encoding='utf-8'))
        rel = f.relative_to(WEB)

        if BOTTOM_BAR_MODULE_RE.search(text):
            problems.append(
                f'{rel} 仍在引用已删除的 `LegendBar` —— 底部图例条已拆解：'
                '地区进顶栏、底图署名由 SDK 自带、图例并入各自面板'
            )
            continue

        m = LEGACY_ATTR_RE.search(text)
        if m:
            line = text[: m.start()].count('\n') + 1
            problems.append(
                f'{rel}:{line} 又出现了自绘底图署名 —— 腾讯 SDK 在左下角自带 '
                '`.logo-text`（含审图号），自绘那份是重复；"现在用哪张图"由顶栏底图下拉表达'
            )

        for m in TOPBAR_RE.finditer(text):
            hits += 1
            line = text[: m.start()].count('\n') + 1
            # 取这个 JSX 开标签的属性块：`<TopBar … />`
            end = text.find('/>', m.end())
            attrs = text[m.end() : end if end != -1 else m.end() + 400]
            if not SHELL_ATTR_RE.search(attrs):
                problems.append(
                    f'{rel}:{line} <TopBar> 没有传 `shell` —— '
                    '地图外壳上下文是必填项（底图下拉就读它），漏了顶栏落地图就动不了'
                )

    # ★ 顶栏不得再回答"我在哪"（见文件头 ②）。判据落在 TopBar 源码上，
    #   不是落在调用处的属性上 —— 组件契约里已经没有 `region` 这个入口了。
    tb = WEB / 'app' / 'common' / 'ui' / 'TopBar.tsx'
    hits += 1
    tb_text = strip_comments_keep_lines(tb.read_text(encoding='utf-8'))
    if REGION_PICKER_RE.search(tb_text):
        problems.append(
            'app/common/ui/TopBar.tsx 又渲染了 `<RegionPicker` —— 顶栏不得再回答"我在哪"：'
            '它与地图的缩放揭示是两套并行的答案，且改 URL 时视野不动'
            '（2026-09-22 删，理由见该文件头）。换级入口只有搜索'
        )
    if REGION_ANY_RE.search(tb_text):
        problems.append(
            'app/common/ui/TopBar.tsx 里又出现了 `region` —— "我在哪"这一步在顶栏上'
            '已经删干净了（选择器 → 只读文字 → 连文字也删，2026-09-22 走完，'
            '用户要的是这一格**整个消失**）。要加回去先读该文件头：它为什么与缩放揭示打架'
        )

    # 别把 SDK 那份也藏了 —— 它是撤掉自绘署名之后唯一的署名
    for css in sorted((WEB / 'app').rglob('*.css')):
        ctext = css.read_text(encoding='utf-8')
        if HIDE_SDK_LOGO_RE.search(ctext):
            problems.append(
                f'{css.relative_to(WEB)} 隐藏了腾讯 SDK 自带的版权（`.logo-text`）—— '
                '自绘署名已撤，那一份是页面上唯一的底图署名，属审图合规标识，不得遮挡或隐藏'
            )

    check(label, problems, 2, hits)


# ────────────────────────────────────────────────
# U. 底图类型 + 详细度开关（要素名合法 + 单一出处 + 旧契约不得残留）
# ────────────────────────────────────────────────
#
# ## 为什么必须静态守这一项：**腾讯对未知 features 是静默忽略的**
# 两轮实测（2026-09-19 `_tmp/cdp_layers.mjs`；2026-09-25 `_tmp/cdp_layer_matrix.mjs`，
# hook `Map.prototype.setBaseMap` 拿实例，逐配置截图 + **按字节数逐张比对** + `getBaseMap()` 回读）：
#
#   · 矢量合法要素：base / building2d / building3d / point / label / arrow
#   · 卫星合法要素：base / road
#   · `getBaseMap()` 会把传进去的东西**原样回读** —— 所以"回读到了"≠"生效了"
#
# 而旧代码写的是 `{ type: 'vector', features: ['base', 'road', 'building'] }`：
# `road`（那是卫星的要素）与 `building`（真实名字是 building2d / building3d）
# 双双被静默丢掉，实际等于 `['base']` → 矢量底图**几乎没有地名**
# （实测同一视野截图：552KB vs 全量 740KB，差别就是满屏 POI 名字）。
# 当时 tsc 干净、控制台零报错、`getBaseMap()` 还回读得一模一样。
#
# ★ **官方文档里有、实测却完全没效果的，一律不入白名单**：`arrow`（道路箭头）
#   在三个视野（zoom 4.6 / 16.2 / 18）下加了与不加是**同一张图**（字节数完全相同）。
#   所以白名单收的是"测出效果的名字"，不是"文档里列的名字"。
#
# 所以本项查四件事：
#   ① `BASEMAP_DETAILS` 里每一项的 `feature` 都在**实测白名单**里，且与它的 `kind` 匹配
#      （矢量不许出现 `road`，卫星不许出现 `building2d` —— 正是踩过的那类错）；
#      底面 `base` 也**不得**出现在这张表里（能关掉底面 = 只剩飘着的文字）；
#   ② 底面恒在：`BASEMAP_BASE_FEATURE` 必须是 `'base'`，且真的被 `basemapConfig` 拼进 features；
#   ③ 界面单一出处：`TopBar` 必须渲染 `<BasemapMenu>` 且不得写死底图名；
#      `BasemapMenu` 必须引用引擎层的 `BASEMAP_KINDS` / `detailsOfKind`，不得写死类型名；
#   ④ 旧契约不得残留（四档预设那套 `BASEMAP_OPTIONS` / `basemapPreset`
#      —— 两套并存时"改了新的、页面还在读旧的"是最难发现的一种）。

BASEMAP_SRC = WEB / 'app' / 'common' / 'map' / 'tencent' / 'basemap.ts'
# ★ 实测白名单（**不是**官方文档清单）：`arrow` 文档里有、实测完全无效，故不收。
#   加名字之前先跑 `_tmp/cdp_layer_matrix.mjs`，看到字节数真的变了再往这里加。
BASEMAP_ALLOWED = {
    'vector': {'base', 'building2d', 'building3d', 'point', 'label'},
    'satellite': {'base', 'road'},
}
# 逐项开关表里的每个对象字面量（表项里没有嵌套花括号，所以 `[^{}]*` 能框住一项）
BASEMAP_ENTRY_RE = re.compile(r'\{([^{}]*)\}', re.S)
BASEMAP_TABLE_RE = re.compile(r'BASEMAP_DETAILS[^=]*=\s*\[(.*?)\n\]', re.S)
BASEMAP_MENU_RE = re.compile(r'<BasemapMenu\b')
HARDCODED_BASEMAP_NAME_RE = re.compile(r'[\'"](?:矢量图|影像图)[\'"]')
# ⚠️ 词边界不能省：反证时把引用改成 `BASEMAP_KINDS_DELIBERATELY_BROKEN`，
#    子串匹配让它"通过"了 —— 检查项自己在骗人（同 R 项那类"检查永远为真"的毛病）
BASEMAP_KINDS_RE = re.compile(r'\bBASEMAP_KINDS\b')
BASEMAP_DETAILS_USE_RE = re.compile(r'\bdetailsOfKind\b|\bBASEMAP_DETAILS\b')
BASEMAP_LEVEL_RE = re.compile(r'\bBASEMAP_LEVEL_LABEL\b')
BASE_FEATURE_DECL_RE = re.compile(r"BASEMAP_BASE_FEATURE\s*=\s*'base'")
BASE_FEATURE_USE_RE = re.compile(r'features\s*:\s*\[\s*BASEMAP_BASE_FEATURE\b')
# ★ 旧契约（四档预设）的符号。残留下来的话，"改了新的、页面还在读旧的"会静默失效
LEGACY_BASEMAP_RE = re.compile(
    r'\bBASEMAP_OPTIONS\b|\bBASEMAP_GROUPS?\b|\bBASEMAP_GROUP_LABEL\b'
    r'|\bbasemapPreset\b|\bsetBasemapPreset\b|\bDEFAULT_BASEMAP_ID\b|\bisBasemapId\b'
)


def check_basemap_presets() -> None:
    label = 'U. 底图类型 + 详细度开关（要素名合法 + 单一出处 + 旧契约不残留）'
    problems: list[str] = []
    hits = 0

    text = strip_comments_keep_lines(BASEMAP_SRC.read_text(encoding='utf-8'))

    # ① 逐条校验 `BASEMAP_DETAILS` 表项：feature 必须是实测合法名，且与 kind 匹配
    table = BASEMAP_TABLE_RE.search(text)
    hits += 1
    if not table:
        problems.append(
            'basemap.ts 里找不到 `BASEMAP_DETAILS` 数组 —— 逐项开关表是详细度配置的唯一出处，'
            '拼不出来就没法校验要素名（腾讯对未知要素**静默忽略**，不校验迟早悄悄少一块）'
        )
    else:
        body = table.group(1)
        entries = list(BASEMAP_ENTRY_RE.finditer(body))
        hits += 1
        if not entries:
            problems.append('`BASEMAP_DETAILS` 是空数组 —— 详细度就没有任何可开关的项了')
        for m in entries:
            entry = m.group(1)
            kid = re.search(r"\bid\s*:\s*'(\w+)'", entry)
            kkind = re.search(r"\bkind\s*:\s*'(\w+)'", entry)
            kfeat = re.search(r"\bfeature\s*:\s*'(\w+)'", entry)
            line = text[: table.start(1) + m.start()].count('\n') + 1
            if not (kid and kkind and kfeat):
                problems.append(
                    f'basemap.ts:{line} 这条 `BASEMAP_DETAILS` 项缺 `id` / `kind` / `feature` —— '
                    '三项都要显式写，缺一个就没法校验它到底会往 features 里塞什么'
                )
                continue
            kind, feat = kkind.group(1), kfeat.group(1)
            allowed = BASEMAP_ALLOWED.get(kind)
            if allowed is None:
                problems.append(
                    f'basemap.ts:{line} 认不出这条开关属于哪种底图（kind={kind!r}）—— '
                    "只能是 `'vector' | 'satellite'`（腾讯第三类 traffic 是叠加层，不是可选类型）"
                )
                continue
            if feat == 'base':
                problems.append(
                    f'basemap.ts:{line} `base`（底面）出现在可开关项里 —— '
                    '底面是底图的载体，关掉它整张图就只剩飘着的文字；它必须由 '
                    '`BASEMAP_BASE_FEATURE` 恒量、永远拼进去'
                )
            elif feat not in allowed:
                problems.append(
                    f'basemap.ts:{line} `{kind}` 底图的要素 `{feat}` 不是**实测**合法名 —— '
                    '腾讯对未知要素静默忽略（不报错、`getBaseMap()` 还原样回读），'
                    f'结果是这一项勾了没反应。实测合法值：{sorted(allowed)}'
                )

    # ② 底面恒在：常量声明 + 真的被拼进 features
    hits += 1
    if not BASE_FEATURE_DECL_RE.search(text):
        problems.append(
            "basemap.ts 里没有 `BASEMAP_BASE_FEATURE = 'base'` —— 底面常量缺失，"
            '各处的 features 会各写各的，改一处漏一处'
        )
    hits += 1
    if not BASE_FEATURE_USE_RE.search(text):
        problems.append(
            'basemap.ts 拼 features 时没有把 `BASEMAP_BASE_FEATURE` 放在最前 —— '
            '（`features: [BASEMAP_BASE_FEATURE, …]`）少了它用户勾任何项都得到一张空底图'
        )

    # ③ 界面单一出处：TopBar 用组件且不写死名字
    topbar = strip_comments_keep_lines(
        (WEB / 'app' / 'common' / 'ui' / 'TopBar.tsx').read_text(encoding='utf-8')
    )
    hits += 1
    if not BASEMAP_MENU_RE.search(topbar):
        problems.append(
            'TopBar.tsx 没有渲染 <BasemapMenu> —— 底图控件必须走引擎层的表，'
            '自己写死的选项会与引擎层漂移，而"界面上有的、引擎不认"是静默失效'
        )
    if HARDCODED_BASEMAP_NAME_RE.search(topbar):
        problems.append(
            'TopBar.tsx 里出现了写死的底图名（「矢量图」/「影像图」）—— '
            '名字只能来自 `BASEMAP_KINDS` 的 `label`'
        )

    # ④ 面板每一段都从引擎层的表派生：类型选项、开关项、档位名，一个都不许写死
    hits += 1
    menu = WEB / 'app' / 'common' / 'ui' / 'BasemapMenu.tsx'
    if not menu.exists():
        problems.append('app/common/ui/BasemapMenu.tsx 不存在 —— 底图菜单的实现缺位')
    else:
        menu_text = strip_comments_keep_lines(menu.read_text(encoding='utf-8'))
        for name, rex, why in (
            ('BASEMAP_KINDS', BASEMAP_KINDS_RE, '底图类型的名字与说明'),
            ('detailsOfKind', BASEMAP_DETAILS_USE_RE, '逐项开关的清单与说明'),
            ('BASEMAP_LEVEL_LABEL', BASEMAP_LEVEL_RE, '「简略 / 详细」那对按钮的文字'),
        ):
            if not rex.search(menu_text):
                problems.append(
                    f'BasemapMenu.tsx 没有引用 `{name}` —— {why}必须由引擎层的表派生，'
                    '写死在 UI 里会与引擎层悄悄分家'
                )
        if HARDCODED_BASEMAP_NAME_RE.search(menu_text):
            problems.append(
                'BasemapMenu.tsx 里出现了写死的底图名（「矢量图」/「影像图」）—— '
                '名字只能来自 `BASEMAP_KINDS` 的 `label`'
            )

    # ⑤ 旧契约（四档预设）不得残留
    hits += 1
    for f in sorted((WEB / 'app').rglob('*.ts')) + sorted((WEB / 'app').rglob('*.tsx')):
        t = strip_comments_keep_lines(f.read_text(encoding='utf-8'))
        m = LEGACY_BASEMAP_RE.search(t)
        if m:
            line = t[: m.start()].count('\n') + 1
            problems.append(
                f'{f.relative_to(WEB)}:{line} 还留着旧底图契约的符号 `{m.group(0)}` —— '
                '四档预设已换成「类型 + 详细度开关」（2026-09-25）；'
                '两套并存时"改了新的、页面还在读旧的"是最难发现的一种失效'
            )

    check(label, problems, 7, hits)


# ────────────────────────────────────────────────
# R. 图标 sprite 的挂载点与图标名
# ────────────────────────────────────────────────
#
# 这一类 bug 的特殊之处：**运行时静默、静态全绿**。
#
#   `<Icon name="nav" />` 输出的是 `<svg><use href="#i-nav"></svg>`。
#   它能不能画出东西，取决于**同一份文档里**是否存在由 sprite 定义的
#   `<g id="i-nav">`。这份 sprite 由 `<IconSprite />` 渲染，而它当时
#   只在 `Icon.tsx` 里被定义、**没有任何地方渲染**（注释还写着"挂在外壳里"）。
#
#   后果：**全站每一个图标都是空白的**，而
#     · `tsc --noEmit` 干净（JSX 用法完全正确）；
#     · A–Q 全绿（没有一处违反约定）；
#     · 控制台零报错（`<use>` 指向不存在的 id 不产生任何错误）。
#   判据只能来自运行时：数 `document.querySelectorAll('[id^="i-"]').length`。
#   静态这边能守的是**挂载点必须存在**，以及**图标名必须在 sprite 名单里**
#   （后者 tsc 的 `Record<IconName, string>` 也会拦，但多一层正则不亏，
#    因为本项本来就要解析 Icon.tsx 才能拿到名单）。

ICON_NAME_DEF_RE = re.compile(r'^\s*\|\s*\'([a-z][a-z0-9-]*)\'', re.M)
ICON_USE_RE = re.compile(r'<Icon\s+name=[\'"]([a-z][a-z0-9-]*)[\'"]')
ICON_SPRITE_USE_RE = re.compile(r'<IconSprite\b')


def check_icon_sprite() -> None:
    label = 'R. 图标 sprite 有挂载点 + 图标名都有定义'
    problems: list[str] = []
    hits = 0

    icon_src = (WEB / 'app' / 'common' / 'ui' / 'Icon.tsx').read_text(encoding='utf-8')
    # ① 从 `IconName` 联合类型里抽出全部合法名字（形如 `  | 'nav'`）
    names = set(ICON_NAME_DEF_RE.findall(icon_src))
    if len(names) < 10:
        problems.append(
            f'只从 Icon.tsx 解析出 {len(names)} 个图标名，明显偏少 ——'
            '解析正则可能已经不匹配 IconName 的写法了'
        )

    # ② sprite 必须有渲染点，且必须在 root.tsx（覆盖所有路由 + 错误边界）
    root_text = strip_comments_keep_lines((WEB / 'app' / 'root.tsx').read_text(encoding='utf-8'))
    if not ICON_SPRITE_USE_RE.search(root_text):
        problems.append(
            'app/root.tsx 没有渲染 <IconSprite /> —— 所有 <Icon> 的 <use href="#i-…"> '
            '都会指向不存在的 id，**全站图标静默变空白**（tsc 与控制台都不报错）'
        )

    mounted = 0
    for f in sorted((WEB / 'app').rglob('*.tsx')):
        if f.name == 'Icon.tsx':
            continue
        text = strip_comments_keep_lines(f.read_text(encoding='utf-8'))
        if ICON_SPRITE_USE_RE.search(text):
            mounted += 1

    # ③ 每个用到图标名字的地方，名字都得在名单里
    for f in sorted((WEB / 'app').rglob('*.tsx')):
        text = strip_comments_keep_lines(f.read_text(encoding='utf-8'))
        rel = f.relative_to(WEB)
        for m in ICON_USE_RE.finditer(text):
            hits += 1
            if m.group(1) not in names:
                line = text[: m.start()].count('\n') + 1
                problems.append(
                    f'{rel}:{line} <Icon name="{m.group(1)}"> 不在 IconName 名单里 —— '
                    'sprite 里没有这个 id，画出来是个空白（不报错）'
                )

    if hits < 4:
        problems.append(f'全文只找到 {hits} 处 <Icon name="…">，期望至少 4 处（正则可能写坏）')

    check(label, problems, 4, hits)
    if mounted == 0 and not problems:
        notes.append('sprite 挂载点：仅 root.tsx')


# ────────────────────────────────────────────────
# S. 缩放揭示
# ────────────────────────────────────────────────
#
# 从 2026-09-19 起「哪个缩放显示哪一级」由 `zoomTiers.deepestLevel` 决定，
# 图层不再由页面各自持有 —— 页面把**数据源**交给 `useMapReveal`，钩子持有那两个图层。
#
# 这个改动带进两类**只在运行时才看得见**的错：
#   ① **图层双份**：页面既用了钩子、又自己 `createDistrictLayer(…)`，
#      同一份内容画两遍 —— 缩放时徽标闪、点击命中到"下面那一层"。
#      类型与静态检查都不会报错。
#   ② **阈值分叉**：某页顺手写 `if (map.getZoom() >= 7) …`，与 `zoomTiers` 的标定值
#      不一致。之后有人改 `CITY_REVEAL_ZOOM`，只有一处跟着变，另一处按旧阈值跳档 ——
#      表现为"同一张图在两个页面上出现的层级不一样"。
#
# 另外 `base` 必须**显式传**：它决定"放大能揭示到哪一级"，
# 靠默认值会让"这页是国家视图还是省级视图"变成需要读实现才知道的事。

REVEAL_HOOK_RE = re.compile(r'\buseMapReveal\s*\(')
BASE_OPT_RE = re.compile(r"\bbase\s*:\s*'([a-z]+)'")
# ⚠️ 不能写成 `getZoom\s*\(\s*\)\s*[<>]=?\s*\d` —— 那样只抓得到
#   `map.getZoom() >= 7` 这一种写法，而现实中更常见的是**带 null 兜底**的
#   `(map?.getZoom() ?? 0) >= 7`（本项目的地图实例可空，几乎都会这么写）。
#   反证时就是栽在这里：喂进去违例却报 [ ok ]。所以允许 `getZoom()` 与比较符
#   之间夹少量字符，但**限制在同一行内**，避免跨行误伤。
RAW_ZOOM_CMP_RE = re.compile(r'\bgetZoom\s*\(\s*\)[^\n;]{0,24}?[<>]=?\s*\d')
VALID_BASE = ('city', 'poi', 'province')


def check_zoom_reveal() -> None:
    label = 'S. 缩放揭示（图层归钩子独占 + base 显式 + 阈值唯一出处）'
    problems: list[str] = []
    hits = 0

    for f in sorted(
        p for root in CALLER_DIRS
        for p in root.rglob('*.ts*')
    ):
        # 钩子自己的定义文件当然会建图层 —— 它正是那两个图层的归属者
        if f.name == 'useMapReveal.ts':
            continue

        text = strip_comments_keep_lines(f.read_text(encoding='utf-8'))
        rel = f.relative_to(WEB)

        # ③ 业务层不得自己写缩放阈值
        for m in RAW_ZOOM_CMP_RE.finditer(text):
            hits += 1
            line = text[: m.start()].count('\n') + 1
            problems.append(
                f'{rel}:{line} 直接拿 `getZoom()` 和数字比大小 —— 揭示阈值的唯一出处是 '
                '`app/common/map/tencent/zoomTiers.ts`。就地写一个数，以后改标定必然漏改这一处'
            )

        for m in REVEAL_HOOK_RE.finditer(text):
            hits += 1
            line = text[: m.start()].count('\n') + 1

            # ① 图层所有权
            if LAYER_FACTORY_RE.search(text):
                problems.append(
                    f'{rel}:{line} 用了 `useMapReveal(` 却又自己 `createDistrictLayer(` / '
                    '`createPoiLayer(` —— 同一份内容会画两遍（缩放时闪烁、点击命中错层）'
                )

            # ② base 必须显式且合法。取到 `})` 为止的参数块
            open_idx = text.find('(', m.end() - 1)
            end = text.find('})', open_idx)
            block = text[open_idx : end if end != -1 else open_idx + 1500]
            bm = BASE_OPT_RE.search(block)
            if not bm:
                problems.append(
                    f'{rel}:{line} `useMapReveal({{…}})` 没有显式传 `base: \'…\'` —— '
                    '基准层级决定"放大能揭示到哪一级"，省略掉就只能靠读实现才知道'
                )
            elif bm.group(1) not in VALID_BASE:
                problems.append(
                    f"{rel}:{line} `base: '{bm.group(1)}'` 不是合法层级"
                    f"（只能是 {' / '.join(VALID_BASE)}）"
                )

    # ★ 反证输入要挑对：写成 `getZoom() >= 7` 必须被拦下。
    #   而 `getZoom() >= CITY_REVEAL_ZOOM` 是**合法**写法（常量同源），
    #   所以正则只匹配"后面跟数字"的形式，别扩大成"和任何东西比大小"。
    check(label, problems, 2, hits)


# ────────────────────────────────────────────────
# T. 点位准入与「未收录不可点」
# ────────────────────────────────────────────────
#
# ① 点位必须先过**档位准入**再交给聚合层：`poiTierForZoom(z).admitsPoints`。
#    `zoom < 8` 整体不铺（"视野已经离开这座城市"），其余**全铺** ——
#    屏幕上最后是几个簇、几个气泡，由 MarkerCluster 决定（`plans/12-poi-aggregation.md`）。
#    ★ 这是**唯一还在的闸门**，所以要守住"它还在 `repaint()` 里"。
#
# ② 抽稀 / 像素去重的实现必须**彻底不在**。2026-09-22 之前本项守的是
#    "必须经过 `pickDots`"，而那套做法（`dotBudget.ts`）已整体删除 ——
#    它做的是**把多余的点扔掉**（成都 46 个候选最后只上屏 20 枚），
#    与"气泡上的数字必须如实"直接冲突。
#    ★ 反向判据为什么必要：那种改法**不报错、不崩、看着还挺对**，
#      只是气泡上的数字变成"抽稀后的数字" —— 等于把用户提的问题换个样子。
#      所以查死符号：全树不得有 `pickDots` / `DOT_MIN_GAP_PX`，
#      `poiLayer.ts` 里不得有 `hypot(`（去重的原语）。
#
# ③ 「顶栏不得再显示『我在哪』」原本也在这里查，2026-09-22 搬到 Q 项 ——
#    那是**顶栏**的契约，跟点位准入摆在一起不搭。Q 项现在同时守两个反向判据：
#    源码里不得出现 `region`、不得渲染 `<RegionPicker`。
#    这里只留一句提醒：换级入口只有搜索，跨级跳在搜索做出来之前得一级一级走。
#
# ④ 未收录的市必须 `disabled`。判据是 `cityId === null`（不是 poiCount ——
#    0 是"采过、确实是零"，null 是"还没采"）。摆一个能点但进去空白的市，
#    用户会当成"这个站坏了"。选择器删掉后，这条判据的落点搬到清单本体
#    `common/ui/city/ProvinceList.tsx` —— 省级页的清单仍然要守住它。
#
# ⑤ 读视野必须走 `readViewport`，且**不得自己按视野筛点位** ——
#    聚合器自己只算 `mapBounds` 内的点（实测"簇成员数 == 视野内点数"），
#    自己再筛一遍只会与它的边界打架。（这条原来是 V④ 的"先 pickDots 再分端"，
#    那件事随聚合一起消失了，判据跟着换成新的不变量。）

ADMITS_RE = re.compile(r'\.admitsPoints\b')
REPAINT_DEF_RE = re.compile(r'function\s+repaint\s*\(')
NEXT_FN_RE = re.compile(r'\n  function\s+\w+')
READ_VIEWPORT_RE = re.compile(r'\breadViewport\s*\(')
PROJECT_PIXEL_RE = re.compile(r'\bprojectToPixel\s*\(')
# ★ 这里曾经还有一条 `hypot(` 判据。2026-09-23 删掉：`hypot` 只是通用距离函数，
#   而 `poiCluster.pointerDistance`（"这次点击的指针离簇心多远"）正当地用它。
#   真正不可替代的原语是 `projectToPixel(` —— 想把**点位**换算成屏幕像素再筛，
#   只有这一条路（`viewport.ts` 是唯一出处），留着它就够守住"不得按像素抽稀"。
DECLUTTER_SYMBOL_RE = re.compile(r'\bpickDots\s*\(|\bDOT_MIN_GAP_PX\b')
CITY_NULL_RE = re.compile(r'cityId\s*===\s*null')
TODO_DISABLED_RE = re.compile(r'disabled=\{\s*(todo|pending|c\.cityId\s*===\s*null)\s*\}')


def check_point_admission() -> None:
    label = 'T. 点位准入与「未收录不可点」（过档位准入 + 抽稀去重已删净 + 待收录禁用）'
    problems: list[str] = []
    hits = 0

    # ── ① 准入必须还在 repaint() 里 ──
    poi = WEB / 'app' / 'common' / 'map' / 'tencent' / 'poiLayer.ts'
    text = strip_comments_keep_lines(poi.read_text(encoding='utf-8'))
    rm = REPAINT_DEF_RE.search(text)
    if not rm:
        problems.append(
            'app/common/map/tencent/poiLayer.ts 找不到 `function repaint(` —— 结构已改，本项检查需要同步'
        )
    else:
        hits += 1
        # 取 repaint 的函数体：它缩进 2 空格（在 createPoiLayer 闭包内），
        # 所以下一个 `\n  function ` 就是边界
        rest = text[rm.end():]
        nxt = NEXT_FN_RE.search(rest)
        body = rest[: nxt.start() if nxt else len(rest)]

        # ★ 判据必须落在**函数体内**，不能取整文件。踩过一次：把
        #   `const dots = pickDots(…)` 改成 `const dots = points`（正是绕过去重的那个改法），
        #   取整文件的版本**报 ALL_CLEAN** —— 因为函数**定义**处那行本身就含关键字。
        #   检查看着在工作，其实一直在放行。
        if not ADMITS_RE.search(body):
            problems.append(
                'app/common/map/tencent/poiLayer.ts 的 `repaint()` 没有读 `poiTierForZoom(…).admitsPoints`'
                ' —— 点位绕过了唯一的档位准入（`zoom < 8` 该整体收起）'
            )
        cl = strip_comments_keep_lines((WEB / POI_CLUSTER_REL).read_text(encoding='utf-8'))
        if PROJECT_PIXEL_RE.search(text + cl):
            problems.append(
                '点位管线（poiLayer.ts / poiCluster.ts）里出现了 `projectToPixel(` / `hypot(` —— '
                '又在按屏幕像素筛点或去重了。聚合器自己只算视野内的点、自己只按 gridSize 并簇，'
                '自己再算一遍会与它分叉（表现为气泡上的数字不对）'
            )

    # ── ② 抽稀 / 去重的死符号必须全树绝迹 ──
    hits += 1
    leftovers: list[str] = []
    for f in sorted((WEB / 'app').rglob('*.ts*')):
        t = strip_comments_keep_lines(f.read_text(encoding='utf-8'))
        if DECLUTTER_SYMBOL_RE.search(t):
            leftovers.append(str(f.relative_to(WEB)))
    if leftovers:
        problems.append(
            '抽稀/去重的死符号又出现了（'
            + '、'.join(leftovers)
            + '）—— `pickDots` / `DOT_MIN_GAP_PX` 已随 `dotBudget.ts` 一起删除；'
            '把点扔掉会让气泡上的数字变成"抽稀后的数字"，而**不报错、看着还挺对**'
        )

    # ── ③ 未收录的市必须禁用（顶栏那半 2026-09-22 搬去 Q 项） ──
    pl = WEB / 'app' / 'common' / 'ui' / 'city' / 'ProvinceList.tsx'
    if not pl.exists():
        problems.append(
            'app/common/ui/city/ProvinceList.tsx 不存在 —— 省级清单缺位，本项检查需要同步'
        )
    else:
        hits += 1
        pl_text = strip_comments_keep_lines(pl.read_text(encoding='utf-8'))
        if not CITY_NULL_RE.search(pl_text):
            problems.append(
                'ProvinceList.tsx 里找不到 `cityId === null` 判据 —— '
                '「是否已收录」的判据是 cityId，不是 poiCount（0 与"还没采"是两件事）'
            )
        if not TODO_DISABLED_RE.search(pl_text):
            problems.append(
                'ProvinceList.tsx 里待收录的市没有落到 `disabled={…}` —— '
                '能点进一个空白城市页，用户会当成"这个站坏了"'
            )

    check(label, problems, 3, hits)


# ────────────────────────────────────────────────
# V. 视野闭环（读视野唯一出处 + 取景不补刷 + 判定收在管线里）
# ────────────────────────────────────────────────
#
# 这一项守的是「缩放 → 显示」这条链路的**形状**。2026-09-20 之前它同时有四种病，
# 每一种都**不报错、不报类型错、控制台干净**，只表现成各种"内容不对"：
#
#   ① 读视野有**三份**实现（揭示 / 撒点 / 徽标各一份）。地图正在移动时
#      `getCenter()` 每次调用都可能返回不同的值 → 同一帧里三处按不同中心算 →
#      「点在这一侧、名字在那一侧、徽标又偏了一截」。
#   ② 页面在 `shell.fit()` 之后补一次 `refreshView()`。`fitBounds` 是**动画**，
#      补的那次读到的是第 0 帧 → 先按旧缩放错铺一次、动画结束再铺一次（闪一下）。
#   ③ 揭示判据只看缩放、不看内容 → 视野里没有内容时铺一张**空白地图**，
#      而且不会退回上一级（回流只做了 点位→市徽标 那一段）。
#   ④ 移动端走 `MarkerCluster`，`repaint()` 第一行就 `return` →
#      分档**一次都没跑过**。"缩放决定显示什么"在两端是两套实现，
#      而 `zoomTiers` 还在文件头自称唯一出处。
#      ★ 2026-09-22：两端都交给聚合，"分端"这件事本身消失了 —— 但这条判据
#        换成了**新的不变量**：`repaint()` 必须用 `readViewport(` 读视野
#        （自己 `getZoom()` / `getBounds()` 就是长出第二份口径）。
#
# 四条都只能静态守：运行时的表现是"内容少了/多了/挂了"，跟这四条没有直接对应。

VIEW_READ_RE = re.compile(r'\bget(?:Zoom|Center)\s*\(')
SHELL_FORCE_REFRESH_RE = re.compile(r'\bshell\s*\.\s*refreshView\s*\(')
DECIDE_REVEAL_RE = re.compile(r'\bdecideReveal\s*\(')


def check_view_loop() -> None:
    label = 'V. 视野闭环（读视野唯一出处 + 取景不补刷 + 判定收在管线里）'
    problems: list[str] = []
    hits = 0

    # ── ① 视野只在引擎层读，业务层一律走 `readViewport` ──
    for f in sorted(
        p
        for root in CALLER_DIRS
        for p in root.rglob('*.ts*')
    ):
        text = strip_comments_keep_lines(f.read_text(encoding='utf-8'))
        rel = f.relative_to(WEB)
        for m in VIEW_READ_RE.finditer(text):
            hits += 1
            line = text[: m.start()].count('\n') + 1
            problems.append(
                f'{rel}:{line} 直接读地图视野（`getZoom(` / `getCenter(`）—— '
                '视野的唯一读法是 `app/common/map/tencent/viewport.ts` 的 `readViewport()`。'
                '就地再读一次，同一帧里几处就会拿到不同的中心（地图移动时 '
                'getCenter() 每次调用都可能返回不同的值）'
            )

    # ── ② 页面不得在取景后强制整图重刷 ──
    for f in sorted((WEB / 'app' / 'routes').rglob('*.ts*')):
        # `map-shell.tsx` 是 refreshView 的**定义方**，也是"浮层增删但地图没动"
        # 那个合法出口 —— 它的调用不在此列
        if f.name == 'map-shell.tsx':
            continue
        text = strip_comments_keep_lines(f.read_text(encoding='utf-8'))
        rel = f.relative_to(WEB)
        for m in SHELL_FORCE_REFRESH_RE.finditer(text):
            hits += 1
            line = text[: m.start()].count('\n') + 1
            problems.append(
                f'{rel}:{line} 调了 `shell.refreshView()` —— `shell.fit()` 是**动画**，'
                '紧跟其后读视野读到的是第 0 帧（于是先按旧缩放错铺一次、'
                '动画结束再铺一次）。动画结束后的重刷由 `useTMap` 的稳定检测负责，'
                '页面不需要也不该补'
            )

    # ── ③ 揭示必须走决策管线 ──
    reveal_hook = WEB / 'app' / 'common' / 'logic' / 'useMapReveal.ts'
    if not reveal_hook.exists():
        problems.append('app/common/logic/useMapReveal.ts 不存在')
    else:
        hits += 1
        hook_text = strip_comments_keep_lines(reveal_hook.read_text(encoding='utf-8'))
        if not DECIDE_REVEAL_RE.search(hook_text):
            problems.append(
                'app/common/logic/useMapReveal.ts 没有调用 `decideReveal(` —— '
                '「这一屏铺哪一级」的判定与回流必须收在 `app/common/map/tencent/reveal.ts`。'
                '写回钩子里就会重新长出"只看缩放、不看内容"的那种判据'
                '（视野里没内容时铺一张空白地图，且不退级）'
            )

    # ── ④ 点位图层必须走 `readViewport` 读视野 ──
    #
    # 原来这里是"先 pickDots 再分端"（守"移动端不许绕过分档"）。那件事随聚合消失了 ——
    # 现在两端同一套、没有分端可绕，但"读视野"这件事仍然只能有一个出处：
    # 图层自己 `getZoom()` / `getBounds()` 就等于长出第二份视野判据。
    poi = WEB / 'app' / 'common' / 'map' / 'tencent' / 'poiLayer.ts'
    text = strip_comments_keep_lines(poi.read_text(encoding='utf-8'))
    rm = REPAINT_DEF_RE.search(text)
    if not rm:
        problems.append(
            'app/common/map/tencent/poiLayer.ts 找不到 `function repaint(` —— 结构已改，本项检查需要同步'
        )
    else:
        hits += 1
        rest = text[rm.end() :]
        nxt = NEXT_FN_RE.search(rest)
        body = rest[: nxt.start() if nxt else len(rest)]
        if not READ_VIEWPORT_RE.search(body):
            problems.append(
                'app/common/map/tencent/poiLayer.ts 的 `repaint()` 没有用 `readViewport(` 读视野 —— '
                '缩放只有一个读法（`viewport.ts` 是唯一出处）；'
                '自己 `getZoom()` 会与揭示判据的口径分叉'
            )

    check(label, problems, 2, hits)


# ────────────────────────────────────────────────
# W. 三块划分与端别分派（common / desktop / mobile + 薄壳路由）
# ────────────────────────────────────────────────
#
# 这一项守的是 2026-09-22 的展示工程重排。它要防的不是"写错一行"，而是
# **结构偷偷回退** —— 这类回退全都不报错、不影响构建，只让代码慢慢长回去：
#
#   ① 逻辑被抄成两份：以后每个字段改动都要改两遍，漏改一处**不会报错**，
#      只让两端"看起来不太一样"。所以两端视图只许摆外壳，逻辑必须在 common。
#   ② 分层反向依赖：`common` 反过来 import `routes` / `desktop` / `mobile`，
#      环出现了也能跑，但"这块能不能单独拿走"就再没人答得上来。
#   ③ 路由不再是薄壳：页面形态重新长回路由文件里（端别判断散在各处）。
#
# ★ 判据是**目录归属**，不是"文件里有没有某个字符串"—— 前者改不动就红，
#   后者能被注释绕过去。

# ★ 2026-09-26：行程页退出"两端各一份"的清单 —— 它的完整界面已搬进右侧规划浮层
#   （plans/13 §6.6，用户要求「把旧的完整行程的内容，搬到现在的行程详情弹窗里」）。
#   `/city/:cityId/plan` 现在是"渲染城市页 + 打开面板"的深链（判据见 check_blocks ③b）。
BLOCK_PAGES = ('City', 'Province', 'Poi')
COMMON_LAYER_FORBIDDEN = ('~/routes/', '~/desktop/', '~/mobile/')


def check_blocks() -> None:
    label = 'W. 三块划分与端别分派（每页两端各一份 + 分层不反转 + 路由是薄壳）'
    problems: list[str] = []
    hits = 0

    # ── ① 四页两端各一份视图 ──
    for page in BLOCK_PAGES:
        for end in ('desktop', 'mobile'):
            hits += 1
            f = WEB / 'app' / end / 'ui' / f'{page}View.tsx'
            if not f.exists():
                problems.append(
                    f'app/{end}/ui/{page}View.tsx 不存在 —— 这一页的{end}形态缺位。'
                    '两端各一份是"看目录就知道哪端长什么样"的前提'
                )

    # ── ② 分层方向：common 不得反向依赖 ──
    for f in list(WEB.glob('app/common/**/*.ts')) + list(WEB.glob('app/common/**/*.tsx')):
        hits += 1
        text = strip_comments_keep_lines(f.read_text(encoding='utf-8'))
        rel = f.relative_to(WEB).as_posix()
        for bad in COMMON_LAYER_FORBIDDEN:
            if f"from '{bad}" in text:
                problems.append(
                    f'{rel} 从 `{bad}…` 导入 —— 公共层反向依赖了上层。'
                    '契约与共用逻辑必须待在 common（外壳 context 就是因此搬到 '
                    'common/logic/mapShell.ts 的），否则"这块能不能单独拿走"永远没有答案'
                )
    for end, other in (('desktop', 'mobile'), ('mobile', 'desktop')):
        for f in list(WEB.glob(f'app/{end}/**/*.tsx')):
            hits += 1
            text = strip_comments_keep_lines(f.read_text(encoding='utf-8'))
            if f"from '~/{other}/" in text:
                problems.append(
                    f'{f.relative_to(WEB).as_posix()} 从 `~/{other}/` 导入 —— '
                    f'两端之间不得互相依赖（跨端 import 会让"只想加载一端"变成不可能；'
                    '共用件要提到 common）'
                )

    # ── ③ 路由是薄壳：有端别差异的页必须"两端都 import + 用端别判据" ──
    for page in BLOCK_PAGES:
        route = WEB / 'app' / 'routes' / f'{page.lower()}.tsx'
        hits += 1
        text = strip_comments_keep_lines(route.read_text(encoding='utf-8'))
        for end in ('desktop', 'mobile'):
            if f'~/{end}/ui/{page}View' not in text:
                problems.append(
                    f'routes/{page.lower()}.tsx 没有引用 `~/{end}/ui/{page}View` —— '
                    '路由必须显式分派到两端视图，否则形态又会长回路由文件里'
                )
        if 'useIsMobile()' not in text:
            problems.append(
                f'routes/{page.lower()}.tsx 没有调用 `useIsMobile()` —— '
                '端别分派必须走唯一判据（媒体查询），不得自己判 UA'
            )

    # ── ③b 行程路由：界面已搬进面板，它的"薄壳"就是委托给城市页 ──
    hits += 1
    plan_route = WEB / 'app/routes/plan.tsx'
    ptext = strip_comments_keep_lines(plan_route.read_text(encoding='utf-8'))
    if 'CityRoute' not in ptext:
        problems.append(
            'routes/plan.tsx 没有渲染 `CityRoute` —— 行程的唯一界面已搬进规划浮层，'
            '这条 URL 只负责「渲染城市页 + 把面板开在这座城的规划上」'
        )
    if 'openPlanDetail(' not in ptext and 'openPanel(' not in ptext:
        problems.append(
            'routes/plan.tsx 没有打开规划面板 —— 这条深链的意义就是"打开这座城的规划"'
        )

    # ── ④ 端别判据唯一出处：别处不得自己嗅探 ──
    UA_RE = re.compile(r'navigator\s*\.\s*userAgent|userAgent\s*\.\s*(match|includes|indexOf)')
    for f in list(WEB.glob('app/**/*.ts')) + list(WEB.glob('app/**/*.tsx')):
        if f.name == 'useViewport.ts':
            continue
        hits += 1
        text = strip_comments_keep_lines(f.read_text(encoding='utf-8'))
        if UA_RE.search(text):
            problems.append(
                f'{f.relative_to(WEB).as_posix()} 在用 UA 判端别 —— '
                '判据只能是媒体查询（`common/logic/useViewport`）：断点决定的是**浮层形态**，'
                '而形态取决于可用宽度，一个 800px 宽的桌面窗口同样塞不下侧栏 + 预览卡'
            )

    check(label, problems, 4, hits)


# ────────────────────────────────────────────────
# X. 图片出口走镜像（Wikimedia 图片域名国内不可达）
# ────────────────────────────────────────────────
#
# 守的是 2026-09-22 的教训：Wikimedia **搜得到、取不到** ——
# Commons API 国内可达（200 / 3.1s），但图片域名 `upload` / `thumb.wikimedia.org`
# 在 IPv4 与 IPv6 各测三次**全部 15s 超时**。所以数据里存原始地址是对的（可溯源），
# 但**渲染前必须过镜像**，否则国内用户看到的是 643 张空白。
#
# ★ 它防的是"悄悄绕过"：只要有人删掉 `mirrorCityImages(city)` 那一行调用，
#   全站图片立刻空白 —— 而**不报错、构建照过、typecheck 也过**（类型一点没变）。
#   在组件里手写 wikimedia 直链同样会绕过统一出口，且换镜像时必然漏改。

WIKI_IMG_HOSTS = ('upload.wikimedia.org', 'thumb.wikimedia.org')
MIRROR_REL = 'app/common/data/imageMirror.ts'


def check_image_mirror() -> None:
    label = 'X. 图片出口走镜像（Wikimedia 直链不可达 + 出口唯一）'
    problems: list[str] = []
    hits = 0

    mirror_file = WEB / MIRROR_REL
    hits += 1
    if not mirror_file.exists():
        problems.append(
            f'{MIRROR_REL} 不存在 —— 图片镜像的唯一出口没了：'
            'Wikimedia 图片域名国内不可达，直连等于全站空白'
        )
        check(label, problems, 4, hits)
        return

    # ── ① 城市数据出口必须接上镜像 ──
    reg = WEB / 'app/common/data/cityRegistry.ts'
    hits += 1
    reg_text = strip_comments_keep_lines(reg.read_text(encoding='utf-8')) if reg.exists() else ''
    # ★ 判据必须是**调用形式**而不是"出现过这个标识符" ——
    #   `import { mirrorCityImages } from './imageMirror'` 里也有它，
    #   只查子串的话，把真正的调用删光了检查还是绿的（反证时实测踩到）。
    if not re.search(r'\bmirrorCityImages\s*\(', reg_text):
        problems.append(
            'app/common/data/cityRegistry.ts 没有调用 `mirrorCityImages` —— '
            '所有页面都从 `loadCity()` 取数，漏了这一处 POI 图与城市 hero 图会全部直连'
        )

    # ── ② 城市索引是脚本产物、且不走 loadCity，必须自己过一遍 ──
    data_file = WEB / 'app/common/data/data.ts'
    hits += 1
    dt_text = strip_comments_keep_lines(data_file.read_text(encoding='utf-8')) if data_file.exists() else ''
    if not re.search(r'\bmirrorIndexItems\s*\(', dt_text):   # 同上：查调用，不查子串
        problems.append(
            'app/common/data/data.ts 没有调用 `mirrorIndexItems` —— '
            '`cities.index.json` 存的是原始地址且这条路径不经过 `loadCity()`，'
            '漏了会出现「详情页有图、首页封面全白」这种最迷惑的不一致'
        )

    # ── ②b 搜索索引**也是脚本产物**，走的是 `loadSearchIndex`（同样不经 `loadCity`）──
    #   2026-09-25 加：搜索结果列表开始显示景点缩略图，于是又多了一条"存原始地址、
    #   又不走 loadCity"的读取路径。它与 ② 是同一个坑的两个入口，必须各自守。
    si = WEB / 'app/common/data/searchIndex.ts'
    hits += 1
    si_text = strip_comments_keep_lines(si.read_text(encoding='utf-8')) if si.exists() else ''
    if not re.search(r'\bmirrorSearchCovers\s*\(', si_text):   # 同 ① ②：查调用，不查子串
        problems.append(
            'app/common/data/searchIndex.ts 没有调用 `mirrorSearchCovers` —— '
            '搜索索引是脚本产物、里面存的是原始图片地址，而这条读取路径同样不经过 '
            '`loadCity()`；漏了会出现「搜索结果缩略图全白、点进详情却有图」这种最难查的不一致'
        )

    # ── ③ 别处不得硬编码 Wikimedia 图片直链（绕过统一出口）──
    for f in list(WEB.glob('app/**/*.ts')) + list(WEB.glob('app/**/*.tsx')):
        if f.relative_to(WEB).as_posix() == MIRROR_REL:
            continue                      # 唯一允许出现域名的地方（MIRROR_HOSTS 清单）
        hits += 1
        text = strip_comments_keep_lines(f.read_text(encoding='utf-8'))
        for host in WIKI_IMG_HOSTS:
            if host in text:
                problems.append(
                    f'{f.relative_to(WEB).as_posix()} 硬编码了 `{host}` —— '
                    '图片地址一律由 imageMirror 统一改写；在这里写死直链会绕过出口'
                    '（国内不可达），换镜像时也必然漏改'
                )
                break

    check(label, problems, 5, hits)


# ────────────────────────────────────────────────
# Y. 地图点击闭环（点空白收起选中 + 事件必须注销 + 抑制覆盖物冒泡）
# ────────────────────────────────────────────────
#
# 它守的是三件**不会报错、只会静默失效**的事：
#
#   ① "点开详情之后怎么关掉"的出口。顶栏那格"我在哪"删掉之后，出口只剩两个：
#      卡片自己的关闭按钮，和**点地图空白**。后者容易写错 —— 页面自己
#      `map.on('click')` 看似可行，但腾讯 GL **点中覆盖物时地图 click 照样派发**
#      （官方 v1.7.6 更新日志：「几何覆盖物上新增 `isStopPropagation`
#      控制是否冒泡到 Map 上」—— 专门开个开关来说明默认就是冒泡）。
#      于是"点圆点"会紧接着被判成"点空白"，预览卡闪一下就没了。
#      所以判定必须在**图层**里做（只有它知道这一下有没有命中），
#      并且要有一个时间窗把那次冒泡隔开。
#
#   ② 腾讯的 `on()` **返回 map 实例，不是取消函数** —— 注册了就必须在
#      `destroy()` 里拿同一个引用 `off()`。漏掉的后果不是崩溃，是**切页之后
#      旧图层的空白点击还在生效**（表现为"多点一次"），几乎没有归因线索。
#
#   ③ 接线断了不会报错：`createPoiLayer` 收了 `onBlank` 却没人传，或者传了
#      却写错回调 —— 静态全绿、交互失效。
#
#   ④ **地图点击的分工**（2026-09-22 起，2026-09-23 修正）：
#      原先写成"点地图上的任何东西都只放大"—— **那是错的**（过于笼统，
#      用户随即报了：「点景点的标签和图标，不应该是打开景点详情吗，怎么缩放地图了」）。
#      正确分工是**按点的是什么分开**：
#        · 省 / 市**徽标** → 放大到对应的比例（`shell.fit`）。徽标表达的是
#          "这一级有什么"，点它就该看得更清。用户 2026-09-22 的诉求只针对它。
#        · 景点**图标 / 名字** → **就地打开详情**（桌面 620px 面板 / 移动底部 Sheet）。
#          两条都不许：不许 `shell.fit(`（镜头被推走，用户想看的那一枚被甩出屏幕）、
#          不许 `openPoi(`（跳详情页 = URL 变了、刷新还停在那儿）。
#          用户 2026-09-23 的两句话分别对应这两条：「怎么缩放地图了」、
#          「点那个看详情，会触发跳转，这个跳转不需要，url 不需要有任何变化」。
#        · 地图**空白** → 收起详情。
#      三条都**不换路由**（URL 一变 → 刷新还停在那儿，而首页/省级页没有回全国的出口）。
#      ★ 清单里的点击（如省级页的城市清单 `pickCity`）**仍然换页** —— 那不是地图点击。
#      ★ 把三者合成一条判据，就是本轮返工的原因 —— 所以 ⑤ 拆成了两段分别守。

POI_LAYER_REL = 'app/common/map/tencent/poiLayer.ts'
POI_CLICKS_REL = 'app/common/map/tencent/poiClicks.ts'
POI_CLUSTER_REL = 'app/common/map/tencent/poiCluster.ts'
POI_STYLES_REL = 'app/common/map/tencent/poiStyles.ts'
REVEAL_HOOK_REL = 'app/common/logic/useMapReveal.ts'
MAP_CLICK_NAV_RE = re.compile(r'\bnavigate\s*\(')
# 标签锚点：**必须**是 middle —— 实测 `bottom` 时"画的框"与"命中的框"差约 11px
# （名字看得见却点不动），`middle` 时 offset 就是盒中心、两者重合
LABEL_ANCHOR_MIDDLE_RE = re.compile(r"verticalAlignment\s*:\s*'middle'")
# 标签让开的距离**必须从"看得见的圆点半径"算出来**，不是又一个猜数。
# ★ 2026-09-23 晚：选中态与未选中态改用**同一个常量** `LABEL_LIFT_PX`
#   （两者的圆点一样大，让开的距离本来就该一样）—— 所以先钉住"两份样式都引用它"，
#   再钉住"它的定义里带着 `DOT_SIZE` 与 `LABEL_GAP_PX`"。
# ★★ 2026-09-24：基从 `POI_ICON_PX`（画布 24）改成 `DOT_SIZE`（看得见的圆点 11）——
#   画布只是**命中区**，按它算等于让标签凭空高出 6.5px（用户报的「间距偏大」，
#   实测 15px 里有 6.5px 是它）。这一条防的正是"又改回画布半径"。
LABEL_OFFSET_LIFT_RE = re.compile(r'offset:\s*\{\s*x:\s*0,\s*y:\s*LABEL_LIFT_PX\s*\}')
LABEL_LIFT_DEF_RE = re.compile(
    r'const\s+LABEL_LIFT_PX\s*=\s*-\(\s*(?:Math\.ceil\(\s*)?DOT_SIZE\s*/?\s*2?\s*\)?\s*\+'
    r'\s*LABEL_GAP_PX\s*\+'
)
# 独立点由**我们**画（细类色）：样式表必须按 `SUBTYPE_KEYS` 生成两档
DOT_SUBTYPE_STYLE_RE = re.compile(r'styles\[`sub-\$\{key\}`\]')
DOT_SUBTYPE_ACTIVE_RE = re.compile(r'styles\[`sub-\$\{key\}_A`\]')
# 单点层必须存在、且**自己接点击**（SDK 那枚被藏了，它接不到）
DOT_LAYER_CLICK_RE = re.compile(r"dots\.on\('click',\s*onDotClick\)")
# ★ 异步落地的重算必须用**最新**参数 —— `refreshView()` 要把合并结果落盘
REFRESH_PERSIST_RE = re.compile(r'lastOpts\s*=\s*\{\s*\.\.\.\s*lastOpts\s*,\s*\.\.\.\s*env\s*\}')
# ★ 等 worker 回话期间，独立点集合要顶上"上一次落地"的答案（否则整批消失一拍）
SINGLES_CACHE_RE = re.compile(
    r'if\s*\(\s*list\.length\s*===\s*0\s*&&\s*waiting\s*\)\s*return\s+lastSingles'
)
# ★ 藏 SDK 的标记图只能靠**静态 CSS**（`img[height]` 直接不出来）：
#   元素一插入就命中规则，没有时间窗。下面两个是"建完元素再补 class"那套老办法，
#   实测**缩放时整批一闪**（`_tmp/cdp_leak_probe.mjs`：484 帧里 17 帧漏出来、单帧最多 13 枚）
#   —— 所以这里反过来守：**它们不许复活**。
DYNAMIC_HIDE_MARK_RE = re.compile(r'function\s+markSingles\s*\(')
DYNAMIC_HIDE_OBSERVER_RE = re.compile(r'new\s+MutationObserver\s*\(')
# `MarkerStyle.anchor` 收的是**像素**（SDK：`iconAnchor: [t.anchor.x || 17, t.anchor.y || 50]`）。
# 写成小数比例（别的地图库的约定）= 锚点落在图标左上角 → 整枚图标往右下挂约 17px。
# 标定实验见 `_tmp/calib_marker_anchor.mjs`，结论表在 `poiStyles.ts` 文件头。
MARKER_ANCHOR_RATIO_RE = re.compile(r'anchor:\s*\{\s*x:\s*0?\.\d+\s*,\s*y:\s*0?\.\d+\s*\}')
# 圆点的锚点必须是**画布中心**（圆心落在坐标上）
MARKER_ANCHOR_CENTER_RE = re.compile(
    r'anchor:\s*\{\s*x:\s*POI_ICON_PX\s*/\s*2\s*,\s*y:\s*POI_ICON_PX\s*/\s*2\s*\}'
)
POI_ICON_CONST_RE = re.compile(r'export\s+const\s+POI_ICON_PX\s*=\s*(\d+)')
# 覆盖物点击的指针过滤：`pointerDistance(…) > CLUSTER_CLICK_SLOP_PX` 之后**返回**
# ★ 只查"常量名在不在"是不够的（把比较改成 `> 0` 名字还在）—— 判据要落在**动作**上
CLUSTER_POINTER_FILTER_RE = re.compile(
    r'pointerDistance\([^)]*\)\s*>\s*CLUSTER_CLICK_SLOP_PX\s*\)\s*\{?\s*return'
)
# 「下一个 4 空格缩进的键」= `useMapReveal({...})` 里某个键的正文边界
REVEAL_KEY_END_RE = re.compile(r'\n    [a-zA-Z]+\s*:')


def reveal_value(text: str, key: str) -> str | None:
    """取 `useMapReveal({...})` 里某个键的正文（到下一个同级键为止）。

    ★ 边界**不能写死键名**（第一版写的是"直到 `districts:` 为止"）：
      那样 `onBlank: () => setSelectedId(null)` 会被算进 `onSelectPoi` 的正文，
      于是"点景点不再选中"这个改动也能判绿 —— 反证当场抓出来了。
    """
    m = re.search(rf'\n    {key}\s*:', text)
    if not m:
        return None
    rest = text[m.end() :]
    nxt = REVEAL_KEY_END_RE.search(rest)
    return rest[: nxt.start() if nxt else len(rest)]

CITY_VIEW_REL = 'app/common/logic/useCityView.ts'
# 城市页的 `onBlank` 回调必须**两个选中源一起清**（页面选中 + 搜索命中，见 AA 项）。
# ★ 不写整串字面量：搜索命中成为第二个源之后，这一行从"一行"变成了"多行语句"，
#   写死字面量会把**正确**的代码判成错（改成多行时当场踩到）。
CITY_ONBLANK_RE = re.compile(
    r'onBlank:[^\n]*=>\s*\{?[^}]*setSelectedId\(null\)[^}]*clearPick\('
)

# ★ 双击放大只能**临时**卸（`poiClicks`）—— 三种写法各自对应一个失败形态：
#   · 忘了卸 → 双击景点把镜头推走（用户报的就是这个）
#   · 忘了装回 → 从那以后**整张图**都不能双击放大（含空白，且不报错）
#   · 建图时关掉 → 空白也不能双击放大（顺便把地图的常规手势废了）
DBL_ZOOM_OFF_DEF_RE = re.compile(r'function\s+turnOffDblZoom\s*\(')
DBL_ZOOM_ON_DEF_RE = re.compile(r'function\s+turnOnDblZoom\s*\(')
DBL_ZOOM_CALL_OFF_RE = re.compile(r'setDoubleClickZoom\?\.\(\s*false\s*\)')
DBL_ZOOM_CALL_ON_RE = re.compile(r'setDoubleClickZoom\?\.\(\s*true\s*\)')
# 抑制窗必须真的被判断（只留两个常量名不算）
MAP_CLICK_SUPPRESS_USE_RE = re.compile(r'if\s*\(\s*now\s*<\s*suppressUntil\s*\)\s*return')


def check_map_click() -> None:
    label = 'Y. 地图点击闭环（空白收起 + 事件必注销 + 徽标放大/景点开详情 + 详情只留一块浮层）'
    problems: list[str] = []
    hits = 0

    poi_text = strip_comments_keep_lines((WEB / POI_LAYER_REL).read_text(encoding='utf-8'))
    # ★ 2026-09-24：点击的**时序语义**（选中 / 双击窗口 / 双击放大 / 点空白）拆到了
    #   `poiClicks.ts`（`poiLayer` 涨到 416 行、上限 420）。①②的判据跟着搬过去，
    #   ③④（契约与接线）仍然落在 `poiLayer`。
    clicks_text = strip_comments_keep_lines((WEB / POI_CLICKS_REL).read_text(encoding='utf-8'))

    # ── ① 注册了地图 click，就必须有对应的注销 ──
    hits += 1
    if "map.on('click'" not in clicks_text:
        problems.append(
            f'{POI_CLICKS_REL} 里找不到 `map.on(\'click\')` —— '
            '"点地图空白收起详情"没有入口，用户只能靠卡片上的关闭按钮'
        )
    elif "map.off('click'" not in clicks_text:
        problems.append(
            f'{POI_CLICKS_REL} 注册了 `map.on(\'click\')` 却没有对应的 `off()` —— '
            '腾讯的 `on()` 不返回取消函数，漏了它会让**切页之后旧图层的空白点击仍然生效**'
        )
    elif 'clicks.destroy()' not in poi_text:
        problems.append(
            f'{POI_LAYER_REL} 的 `destroy()` 没有调 `clicks.destroy()` —— '
            '地图实例是**跨页面复用**的：地图 click 不注销、双击放大卸掉后不装回，'
            '都会静默影响后面每一个页面'
        )

    # ── ② 抑制窗（覆盖物点击会冒泡到 map，不隔开就会"点圆点顺手把卡关掉"）──
    #   ★ 判据落在**执行**上，不是"名字在不在"：只算窗口不判断它（`if (now < suppressUntil) return`
    #     被删）时，两个常量名都还在，光查名字会永远放行 —— 反证第一版就是这么漏的。
    hits += 1
    if (
        'suppressUntil' not in clicks_text
        or 'MAP_CLICK_SUPPRESS_MS' not in clicks_text
        or not MAP_CLICK_SUPPRESS_USE_RE.search(clicks_text)
    ):
        problems.append(
            f'{POI_CLICKS_REL} 里没有**生效的**抑制窗（缺 `suppressUntil` / '
            '`MAP_CLICK_SUPPRESS_MS`，或没在判断它）—— 腾讯 GL 点中覆盖物时地图 click '
            '也会派发且**顺序不保证**，不隔开就会"点圆点顺手把详情关掉"'
        )

    # ── ③ 契约：图层必须收 onBlank ──
    hits += 1
    if 'onBlank' not in poi_text:
        problems.append(f'{POI_LAYER_REL} 的 `PoiLayerOptions` 里没有 `onBlank`')

    # ── ④ 接线：城市页必须真的传，且落到清空选中 ──
    #   ★ 判据**不能写整串字面量**（原来是 `onBlank: () => setSelectedId(null)`）：
    #     搜索命中成为**第二个选中源**之后，这一行变成了多行语句（清了页面选中
    #     还要清搜索命中）—— 写死字面量会把**正确**的代码判成错。
    #     改判"`onBlank` 的正文里有没有清空"，顺带钉住"两个源都要清"。
    hits += 1
    city_text = strip_comments_keep_lines((WEB / CITY_VIEW_REL).read_text(encoding='utf-8'))
    ob = CITY_ONBLANK_RE.search(city_text)
    if not ob:
        problems.append(
            f'{CITY_VIEW_REL} 的 `onBlank` 回调里没有 `setSelectedId(null)` —— '
            '点了地图空白处详情面板不会收起（静态看不出，只有交互时暴露）'
        )
    elif 'clearPick' not in ob.group(0):
        problems.append(
            f'{CITY_VIEW_REL} 的 `onBlank` 只清了页面自己的选中、**没清搜索命中** —— '
            '搜索打开面板后点地图空白，面板会被搜索命中重新渲染出来（用户看到的是"关不掉"）'
        )

    # ── ⑤ 地图点击的**分工**（见文件头 ④）──
    #
    # 两个页面钩子里那两个地图点击回调**语义不同**，不能再合成一条判据 ——
    # 合成过，结果是"点景点也去缩放"，用户当场报错。
    #   · `onSelectDistrict`（省 / 市徽标）→ 只 `shell.fit(`，**不得 `navigate(`**
    #   · `onSelectPoi`（景点）→ **就地开详情**：不得 `shell.fit(`（推镜头）、
    #     不得 `openPoi(`（跳详情页，URL 会变），且必须落到 `setSelectedId(`
    #
    # ★ 用"键的出现顺序"切段是个约定 —— 改了调用处的键顺序，
    #   本项会先报"结构已改，需要同步"（宁可吵，也不要静默放行）。
    hits += 1
    for rel in ('app/common/logic/useHomeView.ts', 'app/common/logic/useProvinceView.ts'):
        hook_text = strip_comments_keep_lines((WEB / rel).read_text(encoding='utf-8'))
        district_seg = reveal_value(hook_text, 'onSelectDistrict')
        poi_seg = reveal_value(hook_text, 'onSelectPoi')
        if district_seg is None or poi_seg is None:
            problems.append(
                f'{rel} 里找不到 `onSelectDistrict:` / `onSelectPoi:` 这两个键 —— '
                '结构已改，本项检查需要同步'
            )
            continue
        if MAP_CLICK_NAV_RE.search(district_seg):
            problems.append(
                f'{rel} 的**徽标**点击回调里出现了 `navigate(` —— 点徽标只该放大'
                '（`shell.fit(...)`）：URL 一变，刷新就停在新页面上，用户会觉得'
                '"这一级关不掉"（清单里的点击不算，那走 `pickCity`）'
            )
        if 'shell.fit(' in poi_seg:
            problems.append(
                f'{rel} 的**景点**点击回调里出现了 `shell.fit(` —— 点景点应当**打开详情**，'
                '不该缩放地图（用户原话：「点景点的标签和图标，不应该是打开景点详情吗，'
                '怎么缩放地图了」）。镜头被推走的代价是：用户想看的那一枚被甩出屏幕'
            )
        if 'openPoi(' in poi_seg:
            problems.append(
                f'{rel} 的**景点**点击回调里出现了 `openPoi(` —— 点景点只该**就地**打开详情'
                '（桌面 620px 面板 / 移动底部 Sheet），**不该跳到详情页**：URL 一变、'
                '刷新就停在那儿（用户原话：「点那个看详情，会触发跳转，这个跳转不需要，'
                'url 不需要有任何变化」）'
            )
        if 'setSelectedId(' not in poi_seg:
            problems.append(
                f'{rel} 的**景点**点击回调里没有 `setSelectedId(` —— 点景点不会浮出详情'
            )

    # ── ⑥ 揭示钩子必须把"点空白"透传给图层 ──
    #   首页 / 省级页的图层是 `useMapReveal` 建的：它不透传，那两页的卡片
    #   就只能靠卡上的关闭按钮（点空白没反应）。**静态全绿、只有交互才暴露**，
    #   所以判据查"调用形式"，而不是"文件里有没有 onBlank 这个词"。
    hits += 1
    reveal_text = strip_comments_keep_lines((WEB / REVEAL_HOOK_REL).read_text(encoding='utf-8'))
    if 'onBlank: () => oRef.current.onBlank?.()' not in reveal_text:
        problems.append(
            f'{REVEAL_HOOK_REL} 没有把 `onBlank` 透传给 `createPoiLayer` —— '
            '首页 / 省级页点地图空白收不起详情（点击判定只在图层里做得出来）'
        )

    # ── ⑦ 城市页的「详情」出口也不许换页 ──
    #   清单里那个「详情」按钮原来 `navigate('/city/:id/poi/:pid')`，
    #   而用户的要求是"看详情**不换 URL**"—— 它和"点地图上的景点"是同一件事。
    hits += 1
    city_text = strip_comments_keep_lines((WEB / CITY_VIEW_REL).read_text(encoding='utf-8'))
    open_poi_seg = reveal_value(city_text, 'openPoi')
    if open_poi_seg is None:
        problems.append(
            f'{CITY_VIEW_REL} 里找不到 `openPoi:` 的实现 —— 结构已改，本项检查需要同步'
        )
    elif MAP_CLICK_NAV_RE.search(open_poi_seg):
        problems.append(
            f'{CITY_VIEW_REL} 的 `openPoi` 里出现了 `navigate(` —— 清单里的「详情」按钮'
            '也会把 URL 改掉。用户原话：「点那个看详情，会触发跳转，这个跳转不需要，'
            'url 不需要有任何变化」。详情页留给外链 / SEO，不该由点击进入'
        )

    # ── ⑧ 详情只有一块浮层，位置信息砌在正文里 ──
    #   用户原话：「右侧是会显示一个景点的简要信息，这个不需要，点击直接看详情就行」。
    #   上一轮只把左边那张简卡换成了详情，右边那块 300px 的位置卡**忘了删** ——
    #   屏幕上仍是两块，"简略信息"根本没消失。所以这一条查的是**数量**，不是"有没有"。
    hits += 1
    det_ov = strip_comments_keep_lines(
        (WEB / 'app/desktop/ui/PoiDetailOverlay.tsx').read_text(encoding='utf-8')
    )
    if det_ov.count('<Overlay') != 1:
        problems.append(
            'app/desktop/ui/PoiDetailOverlay.tsx 里的 `<Overlay` 不是 1 个 —— '
            '点景点弹出来的应当**只有一块浮层**。多出来的那块既是遮挡，也是第二个出口'
            '（上一轮就是"左边换成详情、右边位置卡没删"，用户才又报了一次）'
        )
    detail_body = strip_comments_keep_lines(
        (WEB / 'app/common/ui/city/PoiDetail.tsx').read_text(encoding='utf-8')
    )
    if '<PoiLocation' not in detail_body:
        problems.append(
            'app/common/ui/city/PoiDetail.tsx 里没有 `<PoiLocation` ——「位置与交通」'
            '必须砌在详情**正文**里（桌面那块独立的 300px 位置卡已删）'
        )
    # `PoiLocation` 只许有**一个**装配点：三处外壳共用同一份详情，各自再拼一段必然漂
    loc_users: list[str] = []
    for f in list(WEB.glob('app/**/*.tsx')):
        if f.name == 'PoiLocation.tsx':
            continue
        t = strip_comments_keep_lines(f.read_text(encoding='utf-8'))
        if 'PoiLocation' in t and f.name != 'PoiDetail.tsx':
            loc_users.append(str(f.relative_to(WEB)))
    if loc_users:
        problems.append(
            '除了 `PoiDetail.tsx`，还有别处装配 `PoiLocation`：' + '、'.join(loc_users) +
            ' —— 详情外壳只负责摆壳，内容的装配点只能有一个'
        )
    # 已删的浮层 token 不许再被引用（定义侧由 C2 管，这里管引用侧）
    for f in (
        list(WEB.glob('app/**/*.ts'))
        + list(WEB.glob('app/**/*.tsx'))
        + list(WEB.glob('app/**/*.css'))
    ):
        raw = f.read_text(encoding='utf-8')
        body = CSS_COMMENT_RE.sub('', raw) if f.suffix == '.css' else strip_comments_keep_lines(raw)
        for tok in ('--panel-preview', '--panel-locate'):
            if tok in body:
                problems.append(
                    f'{f.relative_to(WEB)} 里还在引用已删的 `{tok}` —— '
                    '那块浮层（简卡 / 位置卡）已经不存在了'
                )

    # ── ⑨ **双击景点不许放大**（2026-09-24 新增，用户要求）──
    #   用户原话：「正常双击地图不是会放大吗，现在双击点和标签，也会触发地图放大，
    #   这两个能不能不放大地图，**景点，不包括区域和那个聚合点**」。
    #   放大是 SDK 内部挂在 `dblclick` 上的 handler，所以只能**临时卸掉**：
    #   卸了不装回 → 往后整张图（含空白）都不能双击放大；建图时关掉 → 连空白也一起废。
    #   两条都要守，写法落在这三处调用上（`poiClicks` 里）。
    hits += 1
    if not DBL_ZOOM_OFF_DEF_RE.search(clicks_text):
        problems.append(
            f'{POI_CLICKS_REL} 里没有 `turnOffDblZoom` —— 用户要求"双击景点不放大"，'
            '这半边是卸掉 SDK 那个 `dblclick` handler'
        )
    if not DBL_ZOOM_ON_DEF_RE.search(clicks_text):
        problems.append(
            f'{POI_CLICKS_REL} 里没有 `turnOnDblZoom` —— 卸了必须装回：空白 / 徽标 / 气泡'
            '**都要**能双击放大（用户原话：「不包括区域和那个聚合点」）'
        )
    for _pat, _what in (
        (DBL_ZOOM_CALL_OFF_RE, '`setDoubleClickZoom?.(false)`'),
        (DBL_ZOOM_CALL_ON_RE, '`setDoubleClickZoom?.(true)`'),
    ):
        if not _pat.search(clicks_text):
            problems.append(
                f'{POI_CLICKS_REL} 里缺少真的开关调用 {_what} —— '
                '只写个状态位不算数，SDK 那个 `dblclick` handler 照样在'
            )
    # ★ 销毁时必须**装回**：地图实例是**跨页面复用**的，漏了就是"从这一页之后，
    #   双击再也放不大"，而且不报任何错。判据切在 `destroy()` 那一段里。
    _d = clicks_text.find('destroy() {')
    if _d == -1:
        problems.append(f'{POI_CLICKS_REL} 里找不到 `destroy() {{` —— 结构已改，本项检查需要同步')
    elif 'turnOnDblZoom()' not in clicks_text[_d:]:
        problems.append(
            f'{POI_CLICKS_REL} 的 `destroy()` 里没有 `turnOnDblZoom()` —— '
            '地图实例**跨页面复用**，卸掉的双击放大不还回去，后面每个页面都不能双击放大'
        )
    # 建图时**不许**关掉整张图的双击放大（那样双击空白也不放了）
    map_shell_text = strip_comments_keep_lines(
        (WEB / 'app/common/map/tencent/useTMap.ts').read_text(encoding='utf-8')
    )
    if 'doubleClickZoom: true' not in map_shell_text:
        problems.append(
            'app/common/map/tencent/useTMap.ts 建图时没有显式 `doubleClickZoom: true` —— '
            '地图的常规手势（双击空白放大）必须留着；"景点不放大"只能在 `poiClicks` 里临时卸'
        )

    # ── ⑩ **右侧规划面板也是一块浮层**（2026-09-26 新增，plans/13 §6.4）──
    #   同 ⑧ 的道理：列表态与详情态是**同一块**浮层的两种内容，不是两块并排。
    #   拆成两块就同时出现"列表 + 详情"，而两块都锚右侧 ⇒ 后渲染的那块把前一块盖住，
    #   表现是"点了没反应"（第一版就是这样设计的，评审时看出来的）。
    #   判据落在**数量**上：外壳里 1 个 `<Overlay`；两个"态"各自 0 个
    #   （它们是浮层**内容**，自己再包一层就又是一块浮层）。
    hits += 1
    plan_panel_rel = 'app/common/ui/plan/RoutePlanPanelBody.tsx'
    plan_panel = strip_comments_keep_lines((WEB / plan_panel_rel).read_text(encoding='utf-8'))
    if plan_panel.count('<Overlay') != 0:
        problems.append(
            f'{plan_panel_rel} 里出现了 `<Overlay` —— 它是面板的**内容**，容器由两端各自给'
            '（桌面 `Overlay` / 移动 `Sheet`）。内容里再包一层就是同一时刻两块规划浮层'
            '（两块都锚右侧 ⇒ 互相盖住，看起来像点了没反应）'
        )
    for rel in ('app/common/ui/plan/PlanListView.tsx', 'app/common/ui/plan/PlanDetailView.tsx'):
        body = strip_comments_keep_lines((WEB / rel).read_text(encoding='utf-8'))
        if '<Overlay' in body:
            problems.append(
                f'{rel} 里出现了 `<Overlay` —— 它是浮层的**内容**，不该自己再包一层；'
                '再包一层就等于同一时刻存在两块规划浮层'
            )
    # ★ 地图侧只许**一套线**：`usePlanRouteLayer`（整条沿路折线）与
    #   `usePlanMapLayers`（按天逐段）不能同时挂在面板上 —— 两套线两套序号
    #   叠在一张图上，而且不报错。判据：面板体里不许 import 逐段那个。
    hits += 1
    if 'usePlanMapLayers' in plan_panel:
        problems.append(
            f'{plan_panel_rel} 里出现了 `usePlanMapLayers` —— '
            '它的地图侧是**整条沿路折线**（`usePlanRouteLayer`）；'
            '逐段那个是旧完整行程页的地图侧，两个一起挂 = 同一趟行程画两条线'
        )

    # ── ⑪ 规划面板详情态的「添加景点」**不得换 URL**（2026-09-27 用户定，plans/13 §6.9）──
    #
    # 用户原话：「现在点击是会跳转一个新的链接的，改成不跳链接，左侧打开对应城市的
    #   景点列表，如果之前打开了景点详情，记得隐藏」。
    #
    # 三件事各治一个静默病，缺哪一件都不会报错：
    #   ① 不许 `navigate(` —— 旧判据是 `pathname === '/city/<id>'` **精确相等**，
    #      于是 `/city/<id>/plan`（它就是城市页！）与 `/city/<id>/poi/<pid>`
    #      都被判成"不在那座城" ⇒ 点一下换个 URL，用户"离开"了原来那一页。
    #   ② 必须先 `closePagePoi()` —— 已打开的景点详情盖住的正是要用的那块地方。
    #   ③ 必须有"本页自己就有清单"这一支（`pageSpotListCity()`）—— 少了它，
    #      在城市页会**再浮一块同样的清单**（同一屏两份，用户不知道该点哪份）。
    #
    # 反证：① 把 `openSpotPicker(` 那支换回 `navigate(` ⇒ FAIL；
    #      ② 删掉 `pageSpotListCity()` 那一支 ⇒ FAIL；③ 删掉 `closePagePoi()` ⇒ FAIL。
    hits += 1
    detail_rel = 'app/common/ui/plan/PlanDetailView.tsx'
    detail_text = strip_comments_keep_lines((WEB / detail_rel).read_text(encoding='utf-8'))
    seg = re.search(r'function onAddSpot\(\)\s*\{(.*?)\n  \}', detail_text, re.S)
    if not seg:
        problems.append(
            f'{detail_rel} 里找不到 `function onAddSpot()` 的函数体 —— '
            '结构已改，本项检查需要同步'
        )
    else:
        add = seg.group(1)
        if MAP_CLICK_NAV_RE.search(add):
            problems.append(
                f'{detail_rel} 的 `onAddSpot` 里出现了 `navigate(` —— 「添加景点」'
                '**不许换 URL**：用户原话「改成不跳链接，左侧打开对应城市的景点列表」。'
                '本页有清单就用（`pageSpotListCity()`），没有就浮一块出来'
                '（`openSpotPicker(` → `common/ui/plan/SpotPicker`）'
            )
        if 'closePagePoi(' not in add:
            problems.append(
                f'{detail_rel} 的 `onAddSpot` 里没有 `closePagePoi()` —— '
                '用户要求「如果之前打开了景点详情，记得隐藏」：那张卡盖住的正是'
                '要用的地方（点地图空白能收起，但这里得主动收）'
            )
        if 'pageSpotListCity(' not in add:
            problems.append(
                f'{detail_rel} 的 `onAddSpot` 里没有 `pageSpotListCity(` —— '
                '少了"本页左边是不是已经有这座城的清单"这一支，城市页会**再浮一块'
                '同样的清单**（同一屏两份）。判据要来自页面注册，不能用 URL 猜'
            )
        if 'openSpotPicker(' not in add:
            problems.append(
                f'{detail_rel} 的 `onAddSpot` 里没有 `openSpotPicker(` —— '
                '没有清单的页面（首页 / 省级页 / 点位页 / 别的城市）就没东西可挑，'
                '这个按钮等于没反应'
            )

    # 浮层本体必须**被外壳挂上**（挂在页面上 = 只有那一页能用）
    hits += 1
    shell_rel = 'app/routes/map-shell.tsx'
    shell_text = strip_comments_keep_lines((WEB / shell_rel).read_text(encoding='utf-8'))
    if '<SpotPicker' not in shell_text:
        problems.append(
            f'{shell_rel} 里没有渲染 `<SpotPicker` —— 「挑景点」清单要长在**外壳**上：'
            '触发点在规划面板里，而面板本身就挂在外壳上（挂进页面 = 那四个入口'
            '各要一份实例，且首页 / 省级页根本挂不上去）'
        )

    # ── ⑫ 景点详情浮层必须**高于**「挑景点」清单（2026-09-27 用户定）──
    #
    # 用户原话：「点击后，打开景点详情弹窗，**景点详情弹窗的层级是在这个景点列表的
    #   层级之上的**」。层级反了**看不出来**：DOM 里两块都在、文案也对、控制台也干净，
    # 只是详情被清单盖住 —— 用户读到的是"点详情没反应"。所以把两个数读出来直接比。
    #
    # 反证：把 `PoiDetailOverlay` 的 z 改回 22（低于清单的 26）⇒ 必须 FAIL。
    hits += 1
    spot_src = strip_comments_keep_lines(
        (WEB / 'app/common/ui/plan/SpotPicker.tsx').read_text(encoding='utf-8')
    )
    detail_src = strip_comments_keep_lines(
        (WEB / 'app/desktop/ui/PoiDetailOverlay.tsx').read_text(encoding='utf-8')
    )
    # ★ 只认**主浮层**那一处：它带 `tall`（`PoiDetailOverlay` 里另有一个"找不到点位"
    #   的窄分支，那个 z 不参与这条比较）
    spot_z = re.search(r'tall\s+z=\{(\d+)\}', spot_src)
    detail_z = re.search(r'tall\s+z=\{(\d+)\}', detail_src)
    if not spot_z or not detail_z:
        problems.append(
            '读不到「挑景点」/ 详情浮层的 `tall z={...}` —— 结构已改，本项检查需要同步'
        )
    elif int(detail_z.group(1)) <= int(spot_z.group(1)):
        problems.append(
            f'详情浮层的 z（{detail_z.group(1)}）**不高于**「挑景点」清单的 z'
            f'（{spot_z.group(1)}）—— 用户要求详情盖在清单之上；反了的表现是'
            '"点详情没反应"（其实渲染了，只是被清单盖住）'
        )

    # ── ⑬ 「挑景点」里**写库只有那个按钮一条路**（2026-09-27，改过三轮）──
    #
    # 三代形态，每一代都是用户当场提的：
    #   ① 整行就是"加入"     → 挑景点时手指一滑点中一行就多一条行程（用户报过）
    #   ② 行点击什么都不做   → 用户又要「点卡片就打开景点详情」
    #   ③ 行点击 = **详情**，加入只由右侧按钮触发（用户：「只有点加入行程按钮，
    #      才会加入到右侧的行程里面」）
    # 判据落在 `PoiList` 那个**唯一决定行点击目标**的变量上：它可以是 `onOpen` / `onSelect`，
    # **不许是 `onAddToPlan`** —— 那等于把"写库"重新接到行上（不看按钮文案，只看看接的是谁）。
    #
    # 反证：把那行改成 `pick ? onAddToPlan : onSelect` ⇒ 必须 FAIL。
    hits += 1
    poi_list_rel = 'app/common/ui/city/PoiList.tsx'
    poi_list_src = strip_comments_keep_lines((WEB / poi_list_rel).read_text(encoding='utf-8'))
    row_action = re.search(r'const rowAction = pick \?([^:]+):([^\n]+)', poi_list_src)
    if not row_action:
        problems.append(
            f'{poi_list_rel} 里找不到 `const rowAction = pick ? … : …` —— '
            '行点击的目标应当是**一处**决定的（结构已改，本项检查需要同步）'
        )
    elif 'onAddToPlan' in row_action.group(0):
        problems.append(
            f'{poi_list_rel} 的 `rowAction` 里出现了 `onAddToPlan` —— '
            '「挑景点」里**只有右侧那个按钮**能写库（用户原话：「只有点加入行程按钮，'
            '才会加入到右侧的行程里面」）。点卡片要打开的是**详情**'
        )

    # ── ⑭ 「添加到当前行程」：判据一处 + 文案一处（2026-09-28）──
    #
    # 用户原话：「整体的功能没有闭环，感觉逻辑上有点重复了……如果打开了路线规划的详情页面，
    #   景点详情的添加行程按钮改一下，改成添加到当前行程，前提是景点和规划是同一个城市，
    #   才显示这个，点击后，不出弹窗，直接添加到右侧的行程里面」。
    #
    # 两条：
    #   ① **短路必须在** `useAddToPlan.run()` 里（`currentPlanForCity(cityId)` → 直接
    #      `addStopToPlan`）—— 删了就退回"每次都弹选组窗"，而按钮上还写着"添加到当前行程"；
    #   ② **文案不许在四个按钮里各写一遍**（`'添加到当前行程'` 只许出现在
    #      `useAddToPlan.ts`）—— 各写一遍就会出现"按钮说一套、点下去做另一套"
    #      （判据改了、四处文案忘了改，而且不报错）。
    #
    # 反证：见 `_tmp/falsify_y.py` 的 `Y⑭a` / `Y⑭b`。
    hits += 1
    use_add_rel = 'app/common/logic/useAddToPlan.ts'
    use_add_src = strip_comments_keep_lines((WEB / use_add_rel).read_text(encoding='utf-8'))
    if 'currentPlanForCity(cityId)' not in use_add_src or 'addStopToPlan(cur.id' not in use_add_src:
        problems.append(
            f'{use_add_rel} 里找不到"正在看这条规划就直接加"那条短路'
            '（`currentPlanForCity(cityId)` + `addStopToPlan(cur.id, …)`）—— '
            '少了它，景点详情的按钮写着「添加到当前行程」却仍然弹选组窗'
        )
    for rel in (
        'app/desktop/ui/PoiDetailOverlay.tsx',
        'app/mobile/ui/PoiDetailSheet.tsx',
        'app/desktop/ui/PoiView.tsx',
        'app/mobile/ui/PoiView.tsx',
    ):
        body = strip_comments_keep_lines((WEB / rel).read_text(encoding='utf-8'))
        if '添加到当前行程' in body:
            problems.append(
                f'{rel} 里**写死了**「添加到当前行程」文案 —— 文案只能来自 '
                f'{use_add_rel} 的 `addToPlanLabel()`（判据与 `run()` 里那条短路同一个函数）。'
                '各写一遍 = 哪天判据改了、四处文案有一处忘了改，而按钮上写的与点下去干的事不一致'
            )

    # ── ⑮ 「地图取点」那一行的名字：**两态 + 勾永远点得动**（2026-09-28 用户两轮）──
    #
    # 第一轮：「你这个输入框的确定怎么点不了，**一直是灰的**」—— 第一版写的是
    #   "没改动就 `disabled` + 淡灰"，而输入框**一出现**名字就已经是默认的「地图取点」
    #   ⇒ 用户打开的第一眼就是一颗点不动的按钮（CDP 真实鼠标点过，确实毫无反应）。
    # 第二轮：「点了勾选图标，**没有任何反应**啊，应该是点完勾选图标，就不显示输入框和勾选了，
    #   直接显示名字，然后名字右侧显示一个**编辑图标**……**只有第一次在地图上选点**，
    #   就显示输入框，**刷新之后就不显示了**」。
    #
    # ⇒ 四条判据（每一条都对应一个会被用户当场撞上的静默病）：
    #   ① 那颗勾上**不许出现 `disabled`** —— 它的职责是"收起"，点下去必须有反应；
    #   ② 空输入必须回落成默认名（否则清空再点勾会把**空名字**写进库）；
    #   ③ 必须有「**名字 + ✎**」那一态（`aria-label="改这一站的名字"` + `pencil` 图标）——
    #      少了它，输入框要么永远收不起来，要么收起来之后没法再改；
    #   ④ "是否自动打开输入框"必须由**会话态**决定（读 `planUi.freshPoint`）——
    #      若把它写进 `DayItem`（落盘），刷新之后输入框还会自己弹出来，与要求正好相反。
    #
    # 反证：见 `_tmp/falsify_y.py` 的 Y⑮a / Y⑮b / Y⑮c。
    hits += 1
    pn_rel = 'app/common/ui/plan/PointNameField.tsx'
    pn_src = strip_comments_keep_lines((WEB / pn_rel).read_text(encoding='utf-8'))
    save_btn = re.search(r'<button\b[^>]*aria-label="保存这一站的名字"[^>]*>', pn_src, re.S)
    if not save_btn:
        problems.append(
            f'{pn_rel} 里找不到 `aria-label="保存这一站的名字"` 那颗勾 —— '
            '结构已改，本项检查需要同步'
        )
    elif 'disabled' in save_btn.group(0):
        problems.append(
            f'{pn_rel} 的「保存这一站的名字」那颗勾上又出现了 `disabled` —— '
            '用户原话「你这个输入框的确定怎么点不了，一直是灰的」：'
            '它一出现就处在"没改动"那一档（名字本来就是默认的「地图取点」），'
            '禁用 = 打开的第一眼就是一颗点不动的按钮。强弱只许用颜色表达'
        )
    if not re.search(r'v\.trim\(\)\s*\|\|\s*DEFAULT_POINT_NAME', pn_src):
        problems.append(
            f'{pn_rel} 里没有把"清空"回落成默认名（`v.trim() || DEFAULT_POINT_NAME`）—— '
            '清空输入框后再点勾，会把**空名字**写进库：那一行从此认不出是什么'
        )
    if 'aria-label="改这一站的名字"' not in pn_src or '<Icon name="pencil"' not in pn_src:
        problems.append(
            f'{pn_rel} 里没有「名字 + ✎」那一态（缺 `aria-label="改这一站的名字"` 或 '
            '`<Icon name="pencil"`）—— 用户要求「直接显示名字，然后名字右侧显示一个编辑图标，'
            '点编辑图标，再次打开修改」；少了它，收起之后就再也改不了名字'
        )
    if 's.freshPoint === uid' not in pn_src:
        problems.append(
            f'{pn_rel} 没有读会话态 `planUi.freshPoint` —— 用户要求「**只有第一次在地图上选点**，'
            '就显示输入框，**刷新之后就不显示了**」：这个判据必须在**内存**里（`planUi`），'
            '写进 `DayItem` 就会跟着落盘、刷新之后输入框又自己弹出来'
        )

    # ── ⑯ 规划详情态下：停靠点位置的景点**让位**、序号标记**接点击**（2026-09-28）──
    #
    # 用户原话：「打开规划详情之后，地图会显示点位顺序，有些点位是标在景点上的，
    #   会出现两个点位，没办法打开景点详情，而且现在的效果是**盖在景点的点位上的，
    #   而不是替换**」。
    #
    # 三代形态，每一代都是用户当场看出来的：
    #   ① 序号标记（z 32）盖住景点圆点（z 20），而它**没接点击**
    #      ⇒ 那个位置命中的是一枚没有处理器的覆盖物，**彻底点不开**；
    #   ② 只给序号挂点击 ⇒ 能点了，但两枚仍然叠着（用户要的是"替换"）；
    #   ③（现在）**景点让位**：景点图层不画它们、也不把它们交给聚合，
    #      位置上只留序号标记，点击由它接（`loadCity` → `setSearchPick` 开详情）。
    #
    # 四条判据，缺哪一条都会**静默**退回上一代：
    #   ① 景点图层真把名单用在过滤上（不只是类型里有这个字段）
    #   ② 序号标记必须接点击 —— 少了它，那个位置又变成"点不动的覆盖物"
    #   ③ 外壳必须把名单**发出去**（写进 `ViewportEnv`）—— 少了它图层永远收不到
    #   ④ 名单的判据必须是"面板开着 **且** 详情态" —— 少了后半句，
    #      列表态也会把景点撤掉；少了前半句，面板关掉之后景点圆点回不来
    #
    # 反证：`_tmp/falsify_y.py` 的 Y⑯a（拿掉 `onClick`）/ Y⑯b（名单发成空集）。
    hits += 1
    poi_layer_src = strip_comments_keep_lines(
        (WEB / 'app/common/map/tencent/poiLayer.ts').read_text(encoding='utf-8')
    )
    plan_layer_src = strip_comments_keep_lines(
        (WEB / 'app/common/logic/usePlanRouteLayer.ts').read_text(encoding='utf-8')
    )
    if 'claimed.has(p.id)' not in poi_layer_src:
        problems.append(
            'app/common/map/tencent/poiLayer.ts 里没有用 `claimed.has(p.id)` 过滤候选 —— '
            '规划详情态下停靠点的景点又会画一遍，位置上就是两枚标记'
            '（用户原话：「会出现两个点位……盖在景点的点位上的，而不是替换」）'
        )
    if 'onClick: (id) => openRef.current(id)' not in plan_layer_src:
        problems.append(
            'app/common/logic/usePlanRouteLayer.ts 建标记层时没接 `onClick` —— '
            '景点已经让位，那个位置上只剩序号标记；它不接点击 = 用户报的'
            '「没办法打开景点详情」原地复发'
        )
    if 'claimed: claimedPoiIds()' not in shell_text:
        problems.append(
            f'{shell_rel} 的 `refreshView` 没把认领名单写进 `ViewportEnv` —— '
            '名单发不出去，图层永远收不到（打开规划详情后景点圆点照旧叠着，而且不报错）'
        )
    #
    # ★★ 2026-10-05 判据④的**宿主搬了**：从 `map-shell.tsx` 搬到 `common/logic/planFocus.ts`。
    #    原因是"规划态"多了**第二个消费者** —— 城市页的区图层要据此把徽标切成 `reference`
    #    （规划态地图上只留这条行程）。两个地方各写一遍 `panelOpen && activeId` 迟早漂移，
    #    而漂移的表现是"某个地方少了点东西"，**不报错**。
    #    ⇒ 现在这四条判据各查各的宿主；判据的**字符串**照旧原样匹配。
    #
    # ★★ 另加判据⑤：规划态必须**发得出去**（写进 `ViewportEnv.planFocus`）。
    #    少了它，景点层/区图层根本不知道自己在规划态 —— 而这件事**只在打开面板时才看得见**，
    #    既不影响类型检查、也不报错。
    focus_rel = 'app/common/logic/planFocus.ts'
    focus_src = strip_comments_keep_lines((WEB / focus_rel).read_text(encoding='utf-8'))
    if 'if (!panelOpen || !activeId) return NO_CLAIM' not in focus_src:
        problems.append(
            f'{focus_rel} 的 `claimedPoiIds()` 判据不完整 —— '
            '必须同时要求「面板开着」与「在详情态」：只在详情态会把列表态也算上，'
            '只看面板开着则关掉面板后景点圆点回不来'
        )
    if 'panelOpen && Boolean(activeId)' not in focus_src:
        problems.append(
            f'{focus_rel} 的 `isPlanFocused()` 判据不完整 —— '
            '「规划态」= 面板开着 **且** 选中了某条规划；少了后半句会把"还没挑规划"'
            '也算成规划态，地图上的景点/区徽标会平白消失'
        )
    if 'planFocus: isPlanFocused()' not in shell_text:
        problems.append(
            f'{shell_rel} 的 `refreshView` 没把规划态写进 `ViewportEnv.planFocus` —— '
            '信号发不出去，图层不知道该把自己收起来（打开规划详情后其余景点与区徽标'
            '照旧铺着，而且不报错）'
        )

    # ── ⑰ 行程序号标记**不许挡住景点名字标签**（2026-09-28 用户第三轮）──
    #
    # 用户原话：「还有这个标记，会挡住景点的**标签**，这个标记缩小一点试试」。
    #
    # 名字标签的**盒中心**在坐标上方 `|LABEL_LIFT_PX|`
    # （= `ceil(DOT_SIZE/2) + LABEL_GAP_PX + LABEL_BOX_PX/2` = 20），盒高 `LABEL_BOX_PX`（22）
    # ⇒ **盒底边在坐标上方 9px**。而序号标记的圆心**就落在坐标上**，
    # 圆的**可见**半径 = `SEQ_DOT_PX / 2 − 描边 / 2`（描边以圆周为中心，向内吃掉一半）：
    #   · 30px 时可见半径 14 ⇒ 圆顶在 −14，比标签盒底边**高出 5px**（用户看到的"挡住"）；
    #   · 20px 时可见半径 9 ⇒ 与盒底边**齐平**，名字文字离圆顶还有 5~7px。
    # 两个数都是**在截图上逐像素量出来的**，不是估的：
    # `_tmp/cdp_planclaim_verify.mjs` 的 ②′ + `_tmp/diag_badge_col.mjs`（列剖面）。
    #
    # ⇒ 判据是一条不等式：**可见半径 ≤ 标签盒底边到坐标的距离**。
    #   它把"标记多大"和"标签抬高多少"**绑在一起** —— 以后谁单独动其中一个都会被拦住
    #   （只调大标记 = 挡名字；只把标签往下挪 = 同样挡名字）。
    #   另一条：画布尺寸变了必须一起改 `anchor`（它是**像素**不是比例）——
    #   漏改的后果是整枚标记相对坐标偏移，用户看到的是"点位跳了一下"。
    #
    # 反证：`_tmp/falsify_y.py` 的 Y⑰a（把 SEQ_DOT_PX 改回 30）必须 FAIL。
    hits += 1
    styles_rel = 'app/common/map/tencent/poiStyles.ts'
    styles_src = strip_comments_keep_lines((WEB / styles_rel).read_text(encoding='utf-8'))

    def _const(name: str) -> float | None:
        m = re.search(rf'const\s+{name}\s*=\s*(-?\d+(?:\.\d+)?)', styles_src)
        return float(m.group(1)) if m else None

    # 序号圆点的描边宽度：从 `seqSVG` 自己的那段 SVG 里读（写死在另一个常量里就跟它脱节了）
    seq_body = re.search(r'export function seqSVG.*?</svg>', styles_src, re.S)
    seq_stroke = None
    if seq_body:
        sm = re.search(r'stroke-width="(\d+(?:\.\d+)?)"', seq_body.group(0))
        seq_stroke = float(sm.group(1)) if sm else None

    seq_box = _const('SEQ_BOX_PX')
    seq_dot = _const('SEQ_DOT_PX')
    dot_size = _const('DOT_SIZE')
    label_gap = _const('LABEL_GAP_PX')
    label_box = _const('LABEL_BOX_PX')
    if None in (seq_box, seq_dot, dot_size, label_gap, label_box) or seq_stroke is None:
        problems.append(
            f'{styles_rel} 里读不到 SEQ_BOX_PX / SEQ_DOT_PX / DOT_SIZE / LABEL_GAP_PX / '
            'LABEL_BOX_PX / 序号圆点的 stroke-width —— 常量被改名或搬走了，'
            '本项检查需要同步（它守的是"序号标记不许压住景点的名字标签"）'
        )
    else:
        visible_r = seq_dot / 2 - seq_stroke / 2
        # 盒底边到坐标的距离 = 盒中心偏移 − 半高
        label_bottom = (-(-dot_size // 2) + label_gap + label_box / 2) - label_box / 2
        if visible_r > label_bottom:
            problems.append(
                f'{styles_rel} 的序号圆点可见半径 {visible_r:g}px 超过了名字标签盒底边到坐标的'
                f'距离 {label_bottom:g}px —— 标记会**压住景点的名字标签**'
                '（用户原话：「这个标记会挡住景点的标签」）。'
                '要么调小 SEQ_DOT_PX，要么把标签整体抬高（后者影响所有景点，'
                '且会连带改 LABEL_LIFT_PX 的算法）'
            )
        if seq_box < seq_dot + seq_stroke:
            problems.append(
                f'{styles_rel} 的序号画布 {seq_box:g}px 装不下 {seq_dot:g}px 的圆 + '
                f'{seq_stroke:g}px 的描边 —— 圆会被裁掉边'
            )
        if 'anchor: { x: SEQ_BOX_PX / 2, y: SEQ_BOX_PX / 2 }' not in styles_src:
            problems.append(
                f'{styles_rel} 的序号样式锚点不再是**画布中心** —— '
                '`MarkerStyle.anchor` 是像素不是比例；漏改的后果是整枚标记相对坐标偏移'
                '（用户看到的是"点位跳了一下"）'
            )

    # ── ⑱ 点景点 → 把它搬到可视区中心：**只许有一个出处**（2026-09-28 用户复报）──
    #
    # 用户原话：「我之前提的，点景点的时候，要偏移地图，把景点放到地图中间，这个你没做」。
    #
    # 上一版把它写在**城市页的 `openPoi`** 里 —— 而"打开一枚景点的详情"有**四个入口**：
    #   ① 地图点圆点（走图层 `onSelect`，那里内联 `setSelectedId`，**绕过了 `openPoi`**）；
    #   ② 左侧清单行（走 `openPoi`）· ③ 顶栏搜索命中 · ④ 「挑景点」/序号标记（后两者走 `searchPick`）。
    # 于是只有 ② 会居中，其余三个全是**偏差 121px**（`_tmp/cdp_centering_verify.mjs` 的改前基线）。
    #
    # 修法：把"选中就把它摆到看得见的地方"收进 `useSearchPick` 的 effect —— 那是
    # **"生效的是哪一枚"的唯一出处**，四入口 × 三页因此自动全覆盖。
    #
    # 四条判据（都是这次踩过的具体坑）：
    #   ① 全仓 `centerOn(` 的**调用**只许出现在 `useSearchPick.ts` 一处 ——
    #      多一处就是"同一件事两处实现"，而这正是上一版漏掉三条路的形状；
    #   ② effect 必须挂在"生效的那一枚"上（依赖里有 `effectiveId`）—— 否则选中变了它不跑；
    #   ③ 必须是**两帧**（`rAF(rAF(...))`）：详情浮层这次才挂上，一帧时 `freeRect` 还没算上它
    #      （实测差 ~140px，点落在面板边上）；
    #   ④ 收起（`null`）那支**只清记忆、不许动镜头** —— 合上卡片时地图不该自己跳一下。
    #
    # 反证：`_tmp/falsify_y.py` 的 Y⑱a（在城市页加回第二处调用）/ Y⑱b（把两帧改成单帧）。
    hits += 1
    pick_rel = 'app/common/logic/useSearchPick.ts'
    pick_src = strip_comments_keep_lines((WEB / pick_rel).read_text(encoding='utf-8'))

    center_callers = []
    for p in sorted(WEB.rglob('*.ts*')):
        if 'node_modules' in p.parts:
            continue
        t = strip_comments_keep_lines(p.read_text(encoding='utf-8'))
        if re.search(r'\bcenterOn\s*\(', t):
            # ★ `as_posix()`：Windows 上 `str(PurePath)` 是反斜杠，比对字符串会永远不等
            center_callers.append(p.relative_to(WEB).as_posix())
    if center_callers != [pick_rel]:
        problems.append(
            '「选中景点 → 平移到可视区中心」的**调用点**不是唯一一处：'
            f'{center_callers}（期望只有 `{pick_rel}`）。'
            '上一版写在地图上点不动的那条路上就是这么漏的 —— 用户原话'
            '「点景点的时候，要偏移地图，把景点放到地图中间，这个你没做」'
        )
    if '}, [effectiveId, shell])' not in pick_src:
        problems.append(
            f'{pick_rel} 的居中 effect 没有挂在"生效的那一枚"（`effectiveId`）上 —— '
            '选中变了它不跑，等于没做'
        )
    if 'requestAnimationFrame(() => requestAnimationFrame(() => shell.centerOn(' not in pick_src:
        problems.append(
            f'{pick_rel} 的居中不是**两帧**之后再动 —— 详情浮层是这次选中才挂上的，'
            '只等一帧时 `freeRect` 还没把它算进去（实测差 ~140px，点落在面板边上）'
        )
    if not re.search(r'if \(!poi\) \{\s*centeredIdRef\.current = null\s*return\s*\}', pick_src):
        problems.append(
            f'{pick_rel} 的收起分支不对 —— 它只许清记忆、**不许动镜头**'
            '（收起时地图自己跳一下是"我没点它啊"的那种意外）'
        )

    check(label, problems, 20, hits)


# ────────────────────────────────────────────────
# Z. 聚合接线（zoomOnClick 关掉 + 气泡放大自己接 + 参数走唯一出处）
# ────────────────────────────────────────────────
#
# 判据全部来自**读 SDK 真源码**（`plans/12-poi-aggregation.md` §2.3），
# 每一条写错都**不报错、不崩、控制台干净**，只是行为悄悄不对：
#
#   ① `zoomOnClick` 必须显式 `false`。默认 `true` 时它做的是
#      `fitBounds(簇的 bounds)`（簇心向外扩 gridSize）→ 一次跳 3~4 级，
#      **连单个点也会跳**：用户点一枚景点是为了看详情，镜头不该被推走。
#   ② 分派因此必须自己写：气泡 → `zoomInCluster(`（用户要的"点击后再放大"），
#      单点 → `onSelect(`。少了哪一半都是"点了没反应"。
#   ③ 聚合层（`poiCluster.ts`）里**不得出现 `evt.geometry`**：`click` 载荷里只有
#      `cluster`（单点也是"长度 1 的簇"），`geometry` 永远不会被赋值 —— 写了就是死分支。
#      ★ 适用范围只有聚合层：名字层恰好相反（见 ⑥）。
#   ④ `maxZoom` / `gridSize` 必须来自常量。它们是**标定过**的数
#      （16 是实测出来的，见 `zoomTiers.POI_CLUSTER_MAX_ZOOM`），
#      散成魔数之后下一次改只会改一处，而另一处继续生效。
#   ⑤ 名字只挂**独立点**（方案 A）：候选集必须来自 `getClusters()`，
#      且必须订阅 `cluster_changed`（聚类在 worker 里异步算，不订阅就永远是上一轮的答案）。
#   ⑥ 名字层必须**可点**（2026-09-23 新增）。`MultiLabel` 是画布层，默认不接受任何点击；
#      屏幕上摆着一个名字却点不动，用户只会当成"这个站坏了"（用户原话：
#      「点标签也不显示景点信息」）。而它的载荷与聚合层**正好相反** ——
#      `MultiOverlay._emitGeoEvent(t, geometry, extra)` → 这里读 `evt.geometry`。
#      ③ 与 ⑥ 是一对：两层的载荷字段不能互换，写反了都**静默失效**。
#   ⑦ SDK 默认单点标记是 **DOM `<img>`**，现在必须被**一条静态 CSS 整个藏掉**
#      （`.map-layer img[height] { display: none !important }`）—— 独立点已改由我们的
#      `dots` 层按细类色画，不藏就会两套叠着画。为什么必须静态、不能"建完元素补 class"：
#      实测（`_tmp/cdp_leak_probe.mjs`，逐帧采样）484 帧里 17 帧看得到 SDK 的红水滴。
#      ★ 还顺带钉住**尺寸与标签锚点**：图标多大，标签就该让开多少 ——
#        两处不一致时标签会贴到图标上（用户原话：「标签和图标重叠了」）。
#        图标尺寸的常量在 `poiStyles.ts`（CSS 不能 import TS），标签锚点必须是
#        `verticalAlignment: 'middle'`（`bottom` 时"画的框"与"命中的框"差约 11px →
#        看得见的名字点不动）。
#   ⑧ 覆盖物点击必须**按指针位置裁一次**。实测一次点击会来**多条** `click` 载荷：
#      点一枚单点图标，同时收到它自己 + 一个 3.4km 之外的气泡（屏幕差 ~95px），
#      而 DOM 事件只给了那枚单点（`_tmp/cdp_payload.mjs` / `cdp_dom_events.mjs`）。
#      不裁的后果就是用户报的「点景点怎么缩放地图了」—— 开详情的**同时**镜头被推走。
#   ⑨ 点位样式必须按**细类**生成两档（`sub-<key>` / `sub-<key>_A`），
#      `anchor` 用**像素**不是比例（写 `{x:0.5,y:1}` 等于把锚点放左上角，整枚挂 17px）。
#   ⑩ 独立点归我们画 + SDK 画的那一枚必须藏住 + 单点层**自己接点击**
#      （被藏的 DOM 收不到 pointer 事件）。
#   ⑪ **异步落地的重算不许拿过期上下文**（2026-09-24 新增，用户报的"标签不恢复"）：
#      聚合落地比触发它的那次重刷晚，`onSettled` 靠 `lastOpts` 复原上下文，而
#      `lastOpts` 只在 `update()` 里写的话会停在"点下那个景点的那一刻" ——
#      取消选中之后那次落地拿着旧 `selectedId` 把名字**又画回选中态**。
#      触发条件正是"先拖一下地图"：`d.pois` 按视野粗筛，视野一动签名就变 → `update()` 跑。
#   ⑫ 等 worker 回话期间 `singleIds()` 必须顶上**上一次落地**的答案：
#      `setGeometries()` 同步清空 `getClusters()`，而紧随其后的重画正是读它 ——
#      不顶上则我们画的点和名字**整批消失**一拍（实测空窗 2ms ~ 146ms）。

ZOOM_ON_CLICK_OFF_RE = re.compile(r'zoomOnClick\s*:\s*false')
ZOOM_IN_CLUSTER_RE = re.compile(r'\bzoomInCluster\s*\(')
CLUSTER_CLICK_ON_RE = re.compile(r"cluster\s*(?:\?\.)?\s*\.\s*on\s*\(\s*'click'")
# ★ 名字层与聚合层的**事件源不同**：`labels.on('click'` / `cluster.on('click'`
LABEL_CLICK_ON_RE = re.compile(r"labels\s*(?:\?\.)?\s*\.\s*on\s*\(\s*'click'")
LABEL_CLICK_OFF_RE = re.compile(r"labels\s*\??\s*\.\s*off\s*\(\s*'click'")
# SDK 自己画的单点标记（`<img>`）必须被**一条静态规则**整个藏掉。
# 它只可能是"当前是独立点"的那些（多成员的簇是 `<div>` 气泡），所以不误伤气泡。
CSS_MARKER_HIDE_RE = re.compile(
    r'\.map-layer\s+img\s*\[height\]\s*\{[^}]*display\s*:\s*none\s*!important', re.S
)
CLUSTER_CHANGED_ON_RE = re.compile(r"\.\s*on\s*\(\s*'cluster_changed'")
EVT_GEOMETRY_RE = re.compile(r'\b(?:evt|event)\s*\.\s*geometry')
MAXZOOM_FROM_CONST_RE = re.compile(r'maxZoom\s*:\s*POI_CLUSTER_MAX_ZOOM')
GRID_FROM_CONST_RE = re.compile(r'gridSize\s*:\s*CLUSTER_GRID_PX')


def check_cluster_wiring() -> None:
    label = 'Z. 聚合接线（参数唯一出处 + 名字可点 + 独立点自绘 + 异步落地不拿过期上下文）'
    problems: list[str] = []
    hits = 0
    # ★ 聚合行为住在 `poiCluster.ts`（2026-09-22 从 poiLayer 拆出来，同一个"聚合层"职责）；
    #   名字层仍在 `poiLayer.ts`。两个文件的 click 载荷字段**正好相反**，所以分开读
    cluster_text = strip_comments_keep_lines((WEB / POI_CLUSTER_REL).read_text(encoding='utf-8'))
    layer_text = strip_comments_keep_lines((WEB / POI_LAYER_REL).read_text(encoding='utf-8'))

    # ── ① zoomOnClick 必须显式关掉 ──
    hits += 1
    if not ZOOM_ON_CLICK_OFF_RE.search(cluster_text):
        problems.append(
            f'{POI_LAYER_REL} 里没有 `zoomOnClick: false` —— '
            'SDK 默认开着它，动作是 `fitBounds(簇的 bounds)`（簇心外扩 gridSize），'
            '一次跳 3~4 级，**点单个点也会跳**（点景点是为了看详情，镜头不该被推走）'
        )

    # ── ② 分派自己接：气泡放大 / 单点开详情 ──
    hits += 1
    if not CLUSTER_CLICK_ON_RE.search(cluster_text):
        problems.append(
            f'{POI_LAYER_REL} 里没有 `cluster.on(\'click\'` —— `zoomOnClick: false` 之后'
            '点击没人接，点气泡和点单点都不会有任何反应'
        )
    if not ZOOM_IN_CLUSTER_RE.search(cluster_text):
        problems.append(
            f'{POI_LAYER_REL} 里没有调 `zoomInCluster(` —— '
            '用户要的"点气泡放大一级、还密就再点"就断在这里'
        )

    # ── ③ 死分支：`evt.geometry` 在**聚合层**永远是 undefined ──
    #   ★ 只查 `poiCluster.ts` —— 名字层恰好相反（见 ⑥），两个文件的载荷字段
    #     必须分头守，合成一个"两处都不许有"的判据就会把 ⑥ 判成错
    hits += 1
    if EVT_GEOMETRY_RE.search(cluster_text):
        problems.append(
            f'{POI_CLUSTER_REL} 里出现了 `evt.geometry` —— 聚合层的 click 载荷里'
            '**只有 `evt.cluster`**（单点也是长度 1 的簇），`geometry` 永远是 undefined，'
            '这是一条死分支（判断气泡还是单点要读 `cluster.geometries.length`）'
        )

    # ── ④ 参数只走常量 ──
    hits += 1
    if not MAXZOOM_FROM_CONST_RE.search(cluster_text):
        problems.append(
            f'{POI_LAYER_REL} 的 `maxZoom` 不是取自 `POI_CLUSTER_MAX_ZOOM` —— '
            '那是实测标定过的值（16，不是 15），写成魔数之后下一次调参只会改一处'
        )
    if not GRID_FROM_CONST_RE.search(cluster_text):
        problems.append(
            f'{POI_LAYER_REL} 的 `gridSize` 不是取自 `CLUSTER_GRID_PX` —— '
            '"两个点多近算一个"只能有一个数（原来那个 `DOT_MIN_GAP_PX` 已删）'
        )

    # ── ⑤ 名字只挂独立点：候选来自 getClusters()，且订阅 cluster_changed ──
    hits += 1
    if 'getClusters(' not in cluster_text:
        problems.append(
            f'{POI_LAYER_REL} 里没有 `getClusters(` —— 名字层的候选集必须来自聚合器自己的结论'
            '（"哪些点没被聚合"），自己拿距离再算一遍必然与它分叉'
        )
    if not CLUSTER_CHANGED_ON_RE.search(cluster_text):
        problems.append(
            f'{POI_LAYER_REL} 没有订阅 `cluster_changed` —— 聚类在 worker 里**异步**算，'
            '不订阅就会永远按上一轮的簇挂名字（表现为名字与气泡对不上）'
        )

    # ── ⑥ 名字层必须可点（且与聚合层读**相反**的字段） ──
    hits += 1
    if not LABEL_CLICK_ON_RE.search(layer_text):
        problems.append(
            f'{POI_LAYER_REL} 里没有 `labels.on(\'click\'` —— `MultiLabel` 是画布层，'
            '**默认不接受任何点击**。屏幕上有名字却点不动，用户会当成"站坏了"'
            '（用户原话：「点标签也不显示景点信息」）'
        )
    # ★ 判据必须落在**名字层那一段**里：单点层（`onDotClick`）读的也是 `geometry`，
    #   拿整份文件去搜 = "只要文件里出现过就算过" —— 名字层写错了照样放行。
    #   （2026-09-24 由 `_tmp/_falsify_z.py` 的 Z⑥ 用例抓出来的：那条反证一度变成 ALL_CLEAN）
    _a = layer_text.find('const onLabelClick')
    _b = layer_text.find('const onDotClick', _a + 1) if _a >= 0 else -1
    label_seg = layer_text[_a:_b] if _a >= 0 and _b > _a else None
    if label_seg is None:
        problems.append(
            f'{POI_LAYER_REL} 里找不到 `onLabelClick` → `onDotClick` 这一段 —— '
            '结构已改，本项检查需要同步'
        )
    elif not EVT_GEOMETRY_RE.search(label_seg):
        problems.append(
            f'{POI_LAYER_REL} 的名字点击里没有读 `evt.geometry` —— '
            '`MultiOverlay` 走 `_emitGeoEvent(t, geometry, extra)`，载荷在 `geometry` 上；'
            '写成 `evt.cluster`（聚合层那套）拿到的是 undefined，**静默无反应**'
        )
    if not LABEL_CLICK_OFF_RE.search(layer_text):
        problems.append(
            f'{POI_LAYER_REL} 的 `destroy()` 没有 `labels.off(\'click\'` —— '
            '腾讯的 `on()` **返回实例而不是取消函数**，不显式 `off` 就会漏；'
            '换页后旧图层的名字点击还活着（不报错，只是"多点一次"）'
        )

    # ── ⑦ 标记图不得被 Tailwind Preflight 压成 0×0；尺寸与标签锚点必须配套 ──
    #   ★ 失效形态极隐蔽：类型干净、控制台干净、**气泡正常**，只有单个点整个不见
    hits += 1
    css = CSS_COMMENT_RE.sub('', (WEB / 'app' / 'app.css').read_text(encoding='utf-8'))
    styles = strip_comments_keep_lines((WEB / POI_STYLES_REL).read_text(encoding='utf-8'))
    # ★ 2026-09-24 这条判据**换了方向**：原来守的是"**救活** SDK 的标记图"
    #   （Preflight 把它压成 0×0 → "气泡正常、单点全不见"）；现在独立点由我们自己的层画，
    #   SDK 那一枚必须**看不见** —— 所以要守的是"它被藏掉"。
    if not CSS_MARKER_HIDE_RE.search(css):
        problems.append(
            'app.css 里没有 `.map-layer img[height] { display: none !important }` —— '
            'SDK 自己画的那枚**红色水滴**就是 `<img>`（多成员的簇是 `<div>`，不受影响）；'
            '不藏它就会和我们按细类色画的圆点叠在一起'
        )
    if not POI_ICON_CONST_RE.search(styles):
        problems.append(
            f'{POI_STYLES_REL} 里找不到 `export const POI_ICON_PX = <数字>` —— '
            '画布尺寸必须有一个出处的常量（标签让开多少是按它算的）'
        )
    # 标签锚点必须是 middle（画与命中一致），且让开距离从图标尺寸算出来
    if len(LABEL_ANCHOR_MIDDLE_RE.findall(styles)) < 2:
        problems.append(
            f'{POI_STYLES_REL} 的两份标签样式没有都用 `verticalAlignment: \'middle\'` —— '
            '实测 `bottom` 时"画出来的框"与"命中的框"差约 11px（名字看得见却点不动）；'
            '`middle` 时 offset 就是盒中心，两者才重合'
        )
    if len(LABEL_OFFSET_LIFT_RE.findall(styles)) < 2:
        problems.append(
            f'{POI_STYLES_REL} 的两份标签样式没有都用 `offset: {{ x: 0, y: LABEL_LIFT_PX }}` —— '
            '选中与未选中的圆点一样大，让开的距离就该是同一个数（各写一份迟早分叉）'
        )
    if not LABEL_LIFT_DEF_RE.search(styles):
        problems.append(
            f'{POI_STYLES_REL} 的 `LABEL_LIFT_PX` 不是从 `DOT_SIZE + LABEL_GAP_PX` 算出来的 —— '
            '让开的是**看得见的圆点半径**（画布 24px 只是命中区，按它算标签会凭空高出 6.5px）'
        )
    # 独立点必须按**细类**生成两档样式（细类色圆点 + 白色底座）
    if not (DOT_SUBTYPE_STYLE_RE.search(styles) and DOT_SUBTYPE_ACTIVE_RE.search(styles)):
        problems.append(
            f'{POI_STYLES_REL} 没有按 `SUBTYPE_KEYS` 生成 `sub-<key>` 与 `sub-<key>_A` —— '
            '用户要的是「每种类型的点位样式不一样」；少了哪一档，那一档就退回 SDK 的样式'
        )
    # `anchor` 必须是像素写法：小数比例 = 锚点落到图标左上角，整枚图标往右下挂 17px
    if MARKER_ANCHOR_RATIO_RE.search(styles):
        problems.append(
            f'{POI_STYLES_REL} 的 `MarkerStyle.anchor` 用了**小数比例** —— '
            'SDK 收的是**像素**（源码 `iconAnchor: [t.anchor.x || 17, t.anchor.y || 50]`），'
            '比例写法等于把锚点放在图标左上角，整枚图标会往右下挂约 17px'
            '（用户报的「位置也偏了」）。标定见 `_tmp/calib_marker_anchor.mjs`'
        )
    if not MARKER_ANCHOR_CENTER_RE.search(styles):
        problems.append(
            f'{POI_STYLES_REL} 的圆点没有用**画布中心**当锚点 '
            '（应为 `anchor: { x: POI_ICON_PX / 2, y: POI_ICON_PX / 2 }`）—— '
            '圆心必须落在坐标上，否则点中前后会跳位'
        )

    # ── ⑧ 覆盖物点击必须按指针位置裁一次（一次点击会来多条载荷，见文件头 ⑧） ──
    hits += 1
    if not CLUSTER_POINTER_FILTER_RE.search(cluster_text):
        problems.append(
            f'{POI_CLUSTER_REL} 没有按**指针距离**裁掉点击载荷（缺 '
            '`pointerDistance(…) > CLUSTER_CLICK_SLOP_PX` 后返回）—— 实测一次点击会收到'
            '多条 `click`，其中可能包含一个远在几公里外的气泡；不裁就会出现'
            '"点景点开详情的同时镜头被推走"'
        )

    # ── ⑨ 点位按**细类**生成样式（判据体在 ⑦ 段里 —— 那里已经读好了 `styles`） ──
    #   ★ 别把新判据悄悄塞进 ⑦ 的额度里，那样"哪一条在守"就说不清了。
    hits += 1

    # ── ⑩ 独立点归我们画 · SDK 画的那一枚靠**静态 CSS** 藏掉 ──
    #   第一版是"SDK 建完元素 → 我们补一个 class"，**缩放时整批一闪**：
    #   逐帧采样（`_tmp/cdp_leak_probe.mjs`）484 帧里 17 帧看得到红水滴、单帧最多 13 枚。
    #   静态规则是**元素一插入就命中**，没有时间窗 —— 所以这一条守两件事：
    #   单点层得自己接点击、以及那套"补 class"的动态标注**不许复活**。
    hits += 1
    layer_text = strip_comments_keep_lines((WEB / POI_LAYER_REL).read_text(encoding='utf-8'))
    if not DOT_LAYER_CLICK_RE.search(layer_text):
        problems.append(
            f"{POI_LAYER_REL} 的单点层没有自己接点击（缺 `dots.on('click', onDotClick)`）—— "
            'SDK 画的那枚独立点被藏了（`display:none` 的元素收不到 pointer 事件），'
            '不自己接就变成"点单点没反应"'
        )
    for _pat, _what in (
        (DYNAMIC_HIDE_MARK_RE, '`markSingles()`'),
        (DYNAMIC_HIDE_OBSERVER_RE, '`new MutationObserver(`'),
    ):
        if _pat.search(cluster_text):
            problems.append(
                f'{POI_CLUSTER_REL} 里又出现了 {_what} —— 那是"建完元素再补 class"的老办法，'
                '实测**缩放时整批一闪**（`_tmp/cdp_leak_probe.mjs`：484 帧里 17 帧漏出来、'
                '单帧最多 13 枚）。藏 SDK 的标记图只能靠 app.css 里那条**静态规则**'
            )

    # ── ⑪ 异步落地不许拿**过期上下文**（2026-09-24 新增，用户报的"标签不恢复"）──
    #   聚合落地在 worker 里，比触发它的那次重刷晚；`onSettled` 靠 `lastOpts` 复原上下文。
    #   `lastOpts` 只在 `update()` 里写的话会**停在"点下那个景点的那一刻"** ——
    #   于是取消选中之后那次落地拿着旧 `selectedId` 把名字**又画回选中态**：
    #   用户原话「那个点的标注会恢复，但是那个标签不会恢复」，触发条件正是"先拖一下地图"
    #   （`d.pois` 按视野粗筛 → 视野一动点集签名就变 → `update()` 跑一次 → 旧值被固化）。
    #   ★ 判据切在 `refreshView` 的正文里，不拿整份文件搜 —— 同一个坑踩过：
    #     文件里别处也有 `lastOpts = …`（`update()` 里就有一处），整份搜会永远放行。
    hits += 1
    a = layer_text.find('refreshView(env) {')
    b = layer_text.find('setNames(', a + 1) if a != -1 else -1
    if a == -1 or b == -1:
        problems.append(
            f'{POI_LAYER_REL} 里找不到 `refreshView(env) {{` → `setNames(` 这一段 —— '
            '结构已改，本项检查需要同步'
        )
    else:
        seg = layer_text[a:b]
        if not REFRESH_PERSIST_RE.search(seg):
            problems.append(
                f'{POI_LAYER_REL} 的 `refreshView()` 没有把最新参数**落盘** '
                '（缺 `lastOpts = { ...lastOpts, ...env }`）—— 聚合落地的重算是异步的，'
                '它会拿着旧 `selectedId` 把已取消选中的名字又画成选中态：'
                '用户看到「圆点恢复了、标签不恢复」（`_tmp/cdp_label_stale.mjs` 复现）'
            )
        if 'repaint(lastOpts)' not in seg:
            problems.append(
                f'{POI_LAYER_REL} 的 `refreshView()` 没有用落盘后的 `lastOpts` 重画 —— '
                '那"落盘"与"这一帧画什么"就成了两份参数，迟早分叉'
            )

    # ── ⑫ 等 worker 回话期间，独立点集合必须顶上"上一次落地"的答案 ──
    #   `setGeometries()` **同步清空** `getClusters()`（`_resetViewport()`），
    #   而紧随其后的 `repaintSingles()` / `repaintLabels()` 正是读它 —— 不顶上的话
    #   我们自己画的点和名字会**整批消失**一拍（实测空窗 2ms ~ **146ms**，肉眼是闪白）。
    hits += 1
    a2 = cluster_text.find('singleIds() {')
    if a2 == -1:
        problems.append(
            f'{POI_CLUSTER_REL} 里找不到 `singleIds() {{` —— 结构已改，本项检查需要同步'
        )
    else:
        seg2 = cluster_text[a2 : a2 + 900]
        if not SINGLES_CACHE_RE.search(seg2):
            problems.append(
                f'{POI_CLUSTER_REL} 的 `singleIds()` 没有在"等 worker 回话"期间交出 '
                '`lastSingles`（缺 `if (list.length === 0 && waiting) return lastSingles`）'
                '—— 刚 `setGeometries()` 过时 `getClusters()` 是空的，不顶上就会让'
                '我们自己画的点和名字整批消失一拍'
            )

    check(label, problems, 12, hits)


# ────────────────────────────────────────────────
# AA. 顶栏搜索（2026-09-24 新增）
# ────────────────────────────────────────────────
#
# 它是**唯一"从任意一级直接找到目标"**的入口 —— 顶栏那个"我在哪"已撤掉（见 Q 项），
# 换级只剩这一条路。五条判据，每一条对应一种**不报错、只是不对**的失效：
#
#   ① 索引的路径要**两端同源**：`pipeline/build.py` 写、`searchIndex.ts` 读。
#      路径写错时 `import.meta.glob` 会**静默匹配 0 个文件**（不报错、不崩），
#      表现是"搜索框永远说没找到"——而数据其实好好地躺在盘上。
#      还要走 `SearchIndexSchema` 校验：索引是构建期产物，字段漂移不会报错，
#      只会让搜索悄悄少匹配一些（少几个字段，多数查询仍然是对的）。
#   ② 搜索链路**不许换 URL**。与"点地图上的东西不换 URL"同一条规矩：
#      URL 一变，刷新就停在那一页，而省 / 城市页**没有回全国的出口**。
#      它做的是飞镜头（`shell.fit`）+ 交棒给页面开详情（`setSearchPick`），都不进路由。
#   ③ 三个页面钩子都要**真的消费** `searchPick`（`useSearchPick`），
#      并把 `sel.layerId` 交给图层。漏一个的表现是"在那一页搜景点：镜头飞过去了、
#      详情不弹"（不报错，而且另外两页是好的 —— 最难查的那种）。
#   ④ 命中之后**换页要清空** `searchPick`（外壳盯 `pathname`）：不清的话，
#      下一个页面一进来就弹出一枚它根本没在显示的点位的详情。
#   ⑤ 详情面板的"关闭"要**两个选中源一起清**（页面选中 + 搜索命中）。
#      只清一个 = 面板被另一个重新渲染出来，用户看到的是"关不掉"。

SEARCH_INDEX_TS_REL = 'app/common/data/searchIndex.ts'
SEARCH_LOGIC_REL = 'app/common/logic/search.ts'
SEARCH_HOOK_REL = 'app/common/logic/useSearch.ts'
SEARCH_BOX_REL = 'app/common/ui/SearchBox.tsx'
SEARCH_SHELL_REL = 'app/routes/map-shell.tsx'
# 「搜索命中的坐标交给图层」那一段要跨的三个文件（见 ⑥）
POI_TYPES_REL = 'app/common/map/tencent/poiTypes.ts'
SEARCH_REVEAL_REL = 'app/common/logic/useMapReveal.ts'
SEARCH_PICK_REL = 'app/common/logic/useSearchPick.ts'
# `useMapReveal` 的两条出口都 must 转发 `picked`（理由见 ⑥）
MAP_UPDATE_PICKED_RE = re.compile(r'update\(\s*d\.pois\s*,\s*\{[^}]*\bpicked\b', re.S)
MAP_REFRESH_PICKED_RE = re.compile(r'refreshView\(\s*\{[^}]*\bpicked\b', re.S)
# 三页各自"把坐标交下去"的形状不同（城市页直接调图层、首页/省级页走揭示钩子），
# 所以判据也各写各的 —— 统一成"查 `sel.pickedPoint` 在不在这份文件里"会放行
# 一句 `void sel.pickedPoint`（反证实测）。
CITY_LAYER_PICKED_RE = re.compile(r'update\(\s*toPoiPoints\(visible\)\s*,\s*\{[^}]*\bpicked\b', re.S)
REVEAL_HOOK_PICKED_RE = re.compile(r'pickedPoint\s*:\s*sel\.pickedPoint')
# ── ⑦ 的判据：优先级必须是"**搜索命中 > 页面自己的选中**"（2026-09-25 改）──
#   旧写法（页面优先）会让"先点开 A、再搜 B"变成：面板不换、B 不画、A 一直挂着打开样式。
SEARCH_PICK_WINS_RE = re.compile(r'pick\?\.poi\s*\?\?\s*page\.poi')
SEARCH_PICK_ID_WINS_RE = re.compile(r'pick\?\.poi\.id\s*\?\?\s*page\.id')
SEARCH_PAGE_WINS_RE = re.compile(r'page\.poi\s*\?\?\s*pick\?\.poi')
SEARCH_PAGE_ID_WINS_RE = re.compile(r'page\.id\s*\?\?\s*pick\?\.poi\.id')
# 城市页的 `openPoi` 必须先清搜索命中再写选中（不变量见 `useSearchPick` 文件头）
CITY_OPENPOI_CLEARS_PICK_RE = re.compile(r'openPoi[^\n]*\(\w*\)\s*=>\s*\{[^}]*clearPick\(\)[^}]*setSelectedId\(')
SEARCH_PICKED_WIRINGS = (
    (CITY_VIEW_REL, '城市页', CITY_LAYER_PICKED_RE, '`layer.update(toPoiPoints(visible), { picked })`'),
    (
        'app/common/logic/useHomeView.ts',
        '首页',
        REVEAL_HOOK_PICKED_RE,
        '`useMapReveal({ pickedPoint })`',
    ),
    (
        'app/common/logic/useProvinceView.ts',
        '省级页',
        REVEAL_HOOK_PICKED_RE,
        '`useMapReveal({ pickedPoint })`',
    ),
)
# 索引文件名 —— 构建期写、前端读，**必须逐字一致**
SEARCH_INDEX_NAME = 'search-index.json'
# 换页清空：`setSearchPick(null)` 必须挂在 `[pathname]` 这个 effect 里
#   （光有这一句不算 —— 挂在别处的调用清不掉"带着命中切页"那一瞬间的状态）
SEARCH_PICK_CLEAR_RE = re.compile(r'setSearchPick\(null\)\s*\}?\s*,\s*\[\s*\w*pathname\w*\s*\]')
# 关闭面板要清两个源。★ 用"定义体"而不是"文件里有没有这两个名字"：
#   两个名字分开出现时（比如 `clearPick` 只用在 `isCurrent` 旁边）光查名字会放行。
CLOSE_POI_CLEARS_BOTH_RE = re.compile(
    r'closePoi[^\n]*\(\)\s*=>\s*\{[^}]*setSelectedId\(null\)[^}]*clearPick\('
)
# 三个页面钩子（名称用于报错文案）
SEARCH_CONSUMERS = {
    'app/common/logic/useHomeView.ts': '首页',
    'app/common/logic/useProvinceView.ts': '省级页',
    'app/common/logic/useCityView.ts': '城市页',
}
# 「不许换 URL」复用 Y 项的判据（同一条规矩：搜索命中与点地图一样都不进路由）
NAV_RE = MAP_CLICK_NAV_RE
# 索引必须**真的过一遍 schema** —— 认调用而不是名字（`import` 那一行也带着这个名字，
# 只查"名字在不在"会被它骗过；反证第一版就是这么漏的）。
SEARCH_SCHEMA_PARSE_RE = re.compile(r'SearchIndexSchema\s*\.\s*safeParse\s*\(')


def check_search() -> None:
    label = 'AA. 顶栏搜索（索引同源 + 不换 URL + 三页消费 + 两个源一起清 + 坐标交给图层 + **命中优先**）'
    problems: list[str] = []
    hits = 0

    idx_ts = (WEB / SEARCH_INDEX_TS_REL).read_text(encoding='utf-8')
    build_py = pmod('build').read_text(encoding='utf-8')

    # ── ① 索引：两端同源 + 走 schema 校验 ──
    hits += 1
    if SEARCH_INDEX_NAME not in idx_ts:
        problems.append(
            f'{SEARCH_INDEX_TS_REL} 里找不到 `{SEARCH_INDEX_NAME}` —— 前端读的路径必须与'
            '构建期写的**逐字一致**；写错时 `import.meta.glob` 静默匹配 0 个文件'
            '（不报错、不崩），表现是"搜索永远没结果"，而数据就在盘上'
        )
    if SEARCH_INDEX_NAME not in build_py:
        problems.append(
            f'pipeline/build.py 没有产出 `{SEARCH_INDEX_NAME}` —— 搜索的数据源必须由 '
            '`build` 生成（那是"运行时零 API 调用"的前提）'
        )
    if not SEARCH_SCHEMA_PARSE_RE.search(idx_ts):
        problems.append(
            f'{SEARCH_INDEX_TS_REL} 没有真的走 `SearchIndexSchema.safeParse(...)` 校验 —— '
            '索引是构建期产物，字段漂移不报错，只会让搜索悄悄少匹配一些'
            '（★ 判据认的是**调用**，不是名字：只查"名字在不在"会被 `import` 那一行骗过）'
        )

    # ── ② 搜索链路不许换 URL ──
    hits += 1
    for rel in (SEARCH_INDEX_TS_REL, SEARCH_LOGIC_REL, SEARCH_HOOK_REL, SEARCH_BOX_REL):
        text = strip_comments_keep_lines((WEB / rel).read_text(encoding='utf-8'))
        if NAV_RE.search(text):
            problems.append(
                f'{rel} 里出现了 `navigate(` —— 搜索命中只允许**飞镜头 + 就地开详情**，'
                '不许换 URL（与"点地图上的东西不换 URL"同一条规矩：URL 一变，'
                '刷新就停在那页，而省 / 城市页没有回全国的出口）'
            )

    # ── ③ 三个页面钩子都要消费 searchPick ──
    hits += 1
    for rel, name in SEARCH_CONSUMERS.items():
        text = strip_comments_keep_lines((WEB / rel).read_text(encoding='utf-8'))
        if 'useSearchPick(' not in text:
            problems.append(
                f'{rel} 没有调用 `useSearchPick(` —— {name}不会消费"搜索命中的那一枚"，'
                '表现是"在那一页搜景点：镜头飞过去了、详情不弹"'
                '（不报错，而且另外两页是好的）'
            )
        elif 'sel.layerId' not in text:
            problems.append(
                f'{rel} 没有把 `sel.layerId` 交给图层 —— 搜索命中的那一枚不会被高亮'
                '（详情能开，但地图上看不出是哪一枚）'
            )

    # ── ④ 换页必须清空 searchPick ──
    hits += 1
    shell_text = strip_comments_keep_lines((WEB / SEARCH_SHELL_REL).read_text(encoding='utf-8'))
    if not SEARCH_PICK_CLEAR_RE.search(shell_text):
        problems.append(
            f'{SEARCH_SHELL_REL} 没有"换页清空 searchPick"（缺挂在 `[pathname]` 上的 '
            '`setSearchPick(null)`）—— 搜索命中之后切页，下一个页面一进来就会弹出'
            '一枚它根本没在显示的点位的详情'
        )

    # ── ⑤ 关闭必须两个源一起清 ──
    hits += 1
    for rel, name in SEARCH_CONSUMERS.items():
        text = strip_comments_keep_lines((WEB / rel).read_text(encoding='utf-8'))
        if 'closePoi' not in text:
            continue
        if not CLOSE_POI_CLEARS_BOTH_RE.search(text):
            problems.append(
                f'{rel} 的 `closePoi`（{name}）没有**两个选中源一起清**（页面选中 + 搜索命中）'
                '—— 只清一个的话，面板会被另一个重新渲染出来，用户看到的是"关不掉"'
            )

    # ── ⑥ 搜索命中的**坐标**必须交给图层 ──
    #   用户原话（2026-09-24）：「搜索不在当前地图界面上的景点，点击后，地图会偏移过去、
    #   详情也会显示，**但是地图没有渲染点位**」。
    #   根因：选中层是从**本页候选集**按 id 反查坐标的（`byId.get(selectedId)`），
    #   而候选集**按页划定** —— 城市页只有本城、省级页只有本省已收录城市；
    #   搜索却能在任意一级命中**任何一座城**。解析不出坐标 ⇒ 选中层与名字层都拿到空。
    #   ★ 这条失效**不报错、不崩**，而且"详情面板照样打开"，很容易被当成没问题。
    #   ★ 判据分三段，缺任何一段链路都断：
    #     a) 契约里有 `picked` 这一栏（`poiTypes.ts`）
    #     b) 图层**真的用它兜底**（`poiLayer.ts` 读 `o.picked`）——
    #        只声明不读 = 白声明，而 tsc 不报（可选字段）
    #     c) 三个页面把 `sel.pickedPoint` 交下去，`useMapReveal` 两条出口都转发
    hits += 1
    types_text = strip_comments_keep_lines((WEB / POI_TYPES_REL).read_text(encoding='utf-8'))
    # `poiLayer` 的正文（与 `check_map_click` 里那份同源，只是各读一次，互不依赖）
    layer_text = strip_comments_keep_lines((WEB / POI_LAYER_REL).read_text(encoding='utf-8'))
    if not re.search(r'\bpicked\??\s*:', types_text):
        problems.append(
            f'{POI_TYPES_REL} 的 `PoiUpdateOptions` 里没有 `picked` —— '
            '"搜索命中的那一枚"必须有一条独立的坐标信道（它可能不在本页候选集里）'
        )
    if not re.search(r'\bo\.picked\b', layer_text):
        problems.append(
            f'{POI_LAYER_REL} 没有**真的用** `o.picked` 兜底 —— 只声明不读等于白声明，'
            '而 tsc 不会报（可选字段）：搜到别的城的景点时那一枚还是画不出来'
        )
    # 三页各自把坐标交下去 —— ★★ 判据认的是"**交给它的那个键**"，
    #   不是"文件里出现过 `sel.pickedPoint`"：写一句 `void sel.pickedPoint`
    #   名字也在、却什么都没传。反证第一版就是这么漏的（判据查名字，故意改坏后 ALL_CLEAN）。
    for rel, name, _pat, _what in SEARCH_PICKED_WIRINGS:
        text = strip_comments_keep_lines((WEB / rel).read_text(encoding='utf-8'))
        if not _pat.search(text):
            problems.append(
                f'{rel}（{name}）没有把搜索命中的坐标**交给图层**（缺 {_what}）—— '
                '搜到**本页数据里没有**的景点时，镜头会飞过去、详情会开，'
                '但**地图上那一枚不画**（用户报的就是这个）'
            )
    reveal_text = strip_comments_keep_lines((WEB / SEARCH_REVEAL_REL).read_text(encoding='utf-8'))
    for pat, what in (
        (MAP_UPDATE_PICKED_RE, '`pl.update(d.pois, {…})`'),
        (MAP_REFRESH_PICKED_RE, '`pl.refreshView({…})`'),
    ):
        if not pat.search(reveal_text):
            problems.append(
                f'{SEARCH_REVEAL_REL} 的 {what} 没有转发 `picked` —— '
                '选中项与"搜索命中的那一枚"必须**两条路都传**：'
                '`update` 管候选集变化，`refreshView` 管"只是换了选中项"'
                '（那时签名比对会跳过 update）'
            )

    # ── ⑦ 优先级：搜索命中必须**压过**页面自己的选中 ──
    #   用户原话（2026-09-25）：「我点击打开一个景点的详情，然后顶部搜索地图上其他地方的景点，
    #   景点详情弹窗内容**没有切换到新的景点的内容**，地图上的标点**也没有显示**，
    #   我再找到前面打开的那个景点，那个图标**是打开的样式**」——
    #   三个症状同一个原因：`page.id` 还停在更早那次地图点击上，新命中的 B 全被挡住。
    #   ⇒ 规则是"**后发生的那次意图赢**"（`pick` 只在刚点过搜索结果时存在）。
    #   ★ 三层都要守，缺一层就退化成半成品：
    #     a) `selected`（面板内容）b) `layerId`（地图高亮）—— 两者必须同一口径；
    #     c) 一条**不变量**：任何写入页面选中的入口都要先清 pick
    #        （城市页的清单行曾直接调 `setSelectedId` 绕过它 → "点了清单没反应"）。
    hits += 1
    pickhook_text = strip_comments_keep_lines((WEB / SEARCH_PICK_REL).read_text(encoding='utf-8'))
    if not SEARCH_PICK_WINS_RE.search(pickhook_text):
        problems.append(
            f'{SEARCH_PICK_REL} 里"生效的那一枚"**不是**搜索命中优先（缺 `pick?.poi ?? page.poi`）'
            '—— 先点开 A、再搜 B 时面板不会切换到 B（用户报的就是这个）'
        )
    if not SEARCH_PICK_ID_WINS_RE.search(pickhook_text):
        problems.append(
            f'{SEARCH_PICK_REL} 里"交给图层的 id"**不是**搜索命中优先'
            '（缺 `pick?.poi.id ?? page.id`）—— 面板换了、地图高亮没换（B 不画、A 还挂着打开样式）'
        )
    if SEARCH_PAGE_WINS_RE.search(pickhook_text) or SEARCH_PAGE_ID_WINS_RE.search(pickhook_text):
        problems.append(
            f'{SEARCH_PICK_REL} 里又出现了"页面自己的选中优先"的顺序 —— '
            '那正是"先点开 A、再搜 B 不切换"那个 bug；规则是**后发生的那次意图赢**'
        )
    city_parts_text = strip_comments_keep_lines(
        (WEB / 'app/common/ui/city/CityParts.tsx').read_text(encoding='utf-8')
    )
    if 'view.setSelectedId' in city_parts_text:
        problems.append(
            'app/common/ui/city/CityParts.tsx 绕过 `openPoi` 直接写选中（`view.setSelectedId`）—— '
            '那条路不清"搜索命中"，在"命中优先"的规则下会被吃掉（表现：点了清单没反应）。'
            '清单只能走 `view.openPoi`'
        )
    # `useCityView` 的正文（与 `check_map_click` 里那份同源，各读一次，互不依赖）
    city_view_text = strip_comments_keep_lines((WEB / CITY_VIEW_REL).read_text(encoding='utf-8'))
    if not CITY_OPENPOI_CLEARS_PICK_RE.search(city_view_text):
        problems.append(
            f'{CITY_VIEW_REL} 的 `openPoi` 没有"先清搜索命中、再写选中" '
            '（缺 `clearPick()` → `setSelectedId(`）—— 这是"命中优先"能成立的前提'
        )

    check(label, problems, 7, hits)


def check_district_sync() -> None:
    """AB. 区划树收录同步（**磁盘有城市 ⇒ 树上必须挂 cityId**）

    ## 这条护栏是 2026-09-25 事故的产物（选题理由 = 反证成立）
    现象：`data/cities/guangdong/guangzhou/` 下 57 个 POI 一个不少、
    `cities.index.json` 里也有广州，但**地图上广州深圳根本不存在** ——
    广东省页显示「待收录」，连徽标都没有。

    根因：`district-tree.json` 是 step7 **一次性抓取**的产物，每个市节点的
    `cityId` 是**那次生成时**的快照（停在那时候的 4 座城）。而前端
    `drilldown/tree.ts` 的 `isCollected()` 判据**只看 `cityId !== null`** ——
    于是新录的城"数据齐全但不可见"，且全程**静默**：不报错、不告警、
    索引里有、搜索也能搜到，只能靠肉眼发现。

    ## 三条判据（各自都能独立拦住这次事故）
    ① 磁盘每座城市 → 树上必须有对应节点挂着它的 cityId
    ② 已收录城市所在省 → `districts/<省adcode>.geo.json` 必须存在（省页要画面）
    ③ `build.py` 必须调用 `sync_district_tree()`（否则下次新录城市又会漂）
    """
    label = 'AB. 区划树收录同步（磁盘城市 ⇄ 树上 cityId · 省边界齐 · build 会回填）'
    problems: list[str] = []
    hits = 0

    tree_path = REPO / 'data' / '_generated' / 'district-tree.json'
    cities_root = REPO / 'data' / 'cities'

    # ── ① 磁盘城市 vs 树上 cityId ──
    hits += 1
    if not tree_path.exists():
        problems.append(
            'data/_generated/district-tree.json 不存在 —— 三级下钻没有地基，'
            '地图上不会有省市徽标（跑 `python pipeline/steps/step7_district.py` 生成）'
        )
    else:
        tree = json.loads(tree_path.read_text(encoding='utf-8'))
        on_tree: dict[str, str] = {}          # 城市 id → 它在树上的显示名
        for prov in tree.get('provinces', []):
            if prov.get('cityId'):            # 直辖市 / 港澳：省节点自身就是市
                on_tree[prov['cityId']] = prov.get('name', '')
            for kid in prov.get('children') or []:
                if kid.get('cityId'):
                    on_tree[kid['cityId']] = kid.get('name', '')

        on_disk: list[str] = []
        prov_needed: set[str] = set()
        if cities_root.is_dir():
            for prov in sorted(cities_root.iterdir()):
                if not prov.is_dir() or prov.name.startswith('_'):
                    continue
                for city in sorted(prov.iterdir()):
                    head = city / 'city.json'
                    if not head.exists():
                        continue
                    meta = json.loads(head.read_text(encoding='utf-8'))
                    on_disk.append(str(meta.get('id') or city.name))
                    pa = str(meta.get('provinceAdcode') or '')
                    if pa:
                        prov_needed.add(pa)

        missing = [c for c in on_disk if c not in on_tree]
        if missing:
            problems.append(
                f'磁盘上有、但区划树里没有 cityId 的城市：{missing} —— '
                '它们在地图上等于不存在（省页显示「待收录」、连徽标都没有），'
                '尽管数据一个不少。跑一次 `python pipeline/build.py` 让 '
                '`sync_district_tree()` 把收录信息回填进 district-tree.json'
            )
        stale = [c for c in on_tree if c not in on_disk]
        if stale:
            problems.append(
                f'区划树上挂着、但磁盘上已经没有数据的城市：{stale} —— '
                '点进去会是空页（同样是 build 回填没跟上）'
            )

        # ── ② 已收录城市所在省要有市级边界 ──
        hits += 1
        if on_disk:
            dists = REPO / 'data' / '_generated' / 'districts'
            for pa in sorted(prov_needed):
                f = dists / f'{pa}.geo.json'
                if not f.exists():
                    problems.append(
                        f'缺 {f.name} —— 该省有已收录城市，省页却拿不到市级边界（只撒徽标、画不出面）'
                    )
                else:
                    try:
                        if not json.loads(f.read_text(encoding='utf-8')).get('polygons'):
                            problems.append(f'{f.name} 的 polygons 是空的 —— 文件存在 ≠ 有效')
                    except (json.JSONDecodeError, OSError):
                        problems.append(f'{f.name} 不可解析')

    # ── ③ build 必须会回填 ──
    hits += 1
    build_py = pmod('build')
    if build_py.exists():
        text = build_py.read_text(encoding='utf-8')
        if 'def sync_district_tree(' not in text:
            problems.append(
                'pipeline/build.py 里没有 `sync_district_tree()` —— 区划树的 cityId '
                '永远停在 step7 抓取那一刻，之后每录一座新城都会重演"数据有、地图上看不见"'
            )
        elif not re.search(r'^\s{4}sync_district_tree\(\)', text, re.M):
            problems.append(
                'pipeline/build.py 定义了 `sync_district_tree()` 却没在 `main()` 里调用 —— '
                '定义了不调用等于没修'
            )
    else:
        problems.append('pipeline/build.py 不存在')

    check(label, problems, 3, hits)


def check_four_levels() -> None:
    """AC. 四级显示（省 → 市 → **区** → 景点）

    ## 这条护栏守什么
    「城市往下先显示区、再显示景点」是**结构**承诺，不是画法问题。它由三截拼起来，
    任何一截断掉都**不报错**，只是那一级再也不出现：

    | 截 | 断了会怎样 |
    |----|-----------|
    | ① 前端层级表少了 `district` | 缩放判据永远停在市 / 直接跳景点 |
    | ② `subdistricts/<市adcode>.json` 缺失或形状不对 | 区徽标**一枚都不铺**（`loadSubdistricts` 失败路径是静默 null） |
    | ③ POI 没归区（`poiCount` 全 0） | 区徽标铺了但每个都写「0」—— 比不铺更糟，那是**假话** |

    ② 的形状判据尤其值得写死：区节点**没有 `cityId`**（一个区不存在"对应的城市 slug"），
    而 `DistrictCityNodeSchema` 曾把它写成必填 —— 于是一整份分片 `safeParse` 失败、
    静默返回 null，区这一级永远出不来、控制台干干净净（2026-09-25 实测踩到）。

    ## 形状的来源（生成链）
    `step8_subdistricts.py` 抓 → `districts.py` 归区并回填计数 → `build.py` 调用。
    """
    label = 'AC. 四级显示（层级表四档 · 每城有区分片 · POI 真的归了区 · 页面 base 正确）'
    problems: list[str] = []
    hits = 0

    gen = REPO / 'data' / '_generated'
    cities_root = REPO / 'data' / 'cities'

    # ── ① 前端层级表：四档，顺序与阈值都要对 ──
    hits += 1
    tiers_rel = 'app/common/map/tencent/zoomTiers.ts'
    tiers = WEB / tiers_rel
    if not tiers.exists():
        problems.append(f'{tiers_rel} 不存在 —— 层级判据没有出处')
    else:
        text = strip_comments_keep_lines(tiers.read_text(encoding='utf-8'))
        want = "['province', 'city', 'district', 'poi']"
        if want not in text:
            problems.append(
                f"{tiers_rel} 的 `LEVEL_ORDER` 不是 {want} —— 四级显示的地基就是这一行，"
                '少一档或次序错，深一层的内容永远不会被揭示'
            )
        zooms: dict[str, float] = {}
        for name in ('CITY_REVEAL_ZOOM', 'DISTRICT_REVEAL_ZOOM', 'POI_REVEAL_ZOOM'):
            m = re.search(rf'export const {name}\s*=\s*([\d.]+)', text)
            if not m:
                problems.append(f'{tiers_rel} 里没有 `{name}` —— 阈值必须逐个具名，不许内联魔数')
            else:
                zooms[name] = float(m.group(1))
        if len(zooms) == 3 and not (
            zooms['CITY_REVEAL_ZOOM'] < zooms['DISTRICT_REVEAL_ZOOM'] < zooms['POI_REVEAL_ZOOM']
        ):
            problems.append(
                f'三个揭示阈值不是严格递增的（{zooms}）—— 区比市深、景点比区深，'
                '次序一乱就会"先看到景点再看到区"'
            )

    # ── ② 每座已收录城市都要有区分片，且形状合法 ──
    hits += 1
    # ③ 的计数也在这里记：它只在"真有城市"时才是一次有效判断
    if cities_root.is_dir():
        hits += 1
    disk_cities: list[tuple[str, str, str]] = []   # (城市 id, 市 adcode, POI 数)
    if cities_root.is_dir():
        for prov in sorted(cities_root.iterdir()):
            if not prov.is_dir() or prov.name.startswith('_'):
                continue
            for city in sorted(prov.iterdir()):
                head = city / 'city.json'
                if not head.exists():
                    continue
                meta = json.loads(head.read_text(encoding='utf-8'))
                n = len(list((city / 'pois').glob('*/*.json'))) if (city / 'pois').is_dir() else 0
                disk_cities.append((str(meta.get('id') or city.name), str(meta.get('adcode') or ''), n))

    for cid, adcode, n_poi in disk_cities:
        if not adcode:
            continue
        shard = gen / 'subdistricts' / f'{adcode}.json'
        bounds = gen / 'districts' / f'{adcode}.geo.json'
        if not shard.exists():
            problems.append(
                f'{cid}（{adcode}）没有 `subdistricts/{adcode}.json` —— '
                '城市页的区级永远出不来（跑 `python pipeline/steps/step8_subdistricts.py --only=' + adcode + '`）'
            )
            continue
        try:
            data = json.loads(shard.read_text(encoding='utf-8'))
        except (json.JSONDecodeError, OSError) as e:
            problems.append(f'subdistricts/{adcode}.json 不可解析：{e}')
            continue

        kids = data.get('children') or []
        if not kids:
            problems.append(f'subdistricts/{adcode}.json 的 children 是空的 —— 文件存在 ≠ 有效')
            continue
        bad_level = [k.get('adcode') for k in kids if k.get('level') != 'district']
        if bad_level:
            problems.append(
                f'subdistricts/{adcode}.json 里有节点的 level 不是 `district`：{bad_level[:4]} —— '
                '分片里只能是区（市这一级在区划树上）'
            )
        if any('cityId' in k and k['cityId'] is not None for k in kids):
            problems.append(
                f'subdistricts/{adcode}.json 的区节点带了非空 cityId —— '
                '区不存在"对应的城市 slug"，这个字段在分片里只能是 null（且应当缺省）'
            )

        # ── ③ POI 真的归了区：各区计数之和 = 该城 POI 数 ──
        if n_poi:
            s = sum(int(k.get('poiCount') or 0) for k in kids)
            if s != n_poi:
                problems.append(
                    f'{cid} 的区级计数之和 {s} ≠ 该城 POI 数 {n_poi} —— '
                    '说明有 POI 没归到任何区（`districts.assign_district` 没跑 / 边界精度不够）。'
                    '区徽标会显示比真实内容少的数字，而用户看到的是"这里就这么点东西"'
                )
        if not bounds.exists():
            problems.append(
                f'{cid}（{adcode}）没有 `districts/{adcode}.geo.json` —— '
                '点区飞过去与区的面都拿不到（同一次 step8 请求产出，缺了就是那次没跑成）'
            )

    # ── ⑨ 「点区筛景点」与「徽标数字」必须同源（2026-10-01 修完的那条）──
    # 徽标数字 = `subdistricts` 的 `poiCount`（`scan_district_counts` 读 POI **顶层**
    # `district` —— 那是 `build.reindex_poi_districts` 按**几何**写回的 adcode）；
    # 而前端"点区筛景点"（`poisOf`）筛的是 `location.district` —— **区名**。
    # 两边不同源时用户看到的是"徽标写 28、点进去只有 21"（实测修前 105 处）。
    # ★ 抽查前 2 座城就够：它是"数据生成链路"的属性，不是逐城偶发。
    hits += 1
    checked = 0
    for cj in sorted((REPO / 'data/cities').glob('*/*/city.json')):
        c0 = json.loads(cj.read_text(encoding='utf-8'))
        sp = REPO / 'data/_generated/subdistricts' / f"{c0.get('adcode')}.json"
        if not sp.exists():
            continue
        names = {
            str(k.get('adcode')): str(k.get('name') or '')
            for k in (json.loads(sp.read_text(encoding='utf-8')).get('children') or [])
        }
        if not names:
            continue
        for pf in sorted((cj.parent / 'pois').rglob('*.json')):
            q = json.loads(pf.read_text(encoding='utf-8'))
            ad = str(q.get('district') or '')
            nm = names.get(ad)
            if nm is None:
                continue            # 区列表里没这个 adcode（分片过期）—— 由 ③ 那条管
            got = str((q.get('location') or {}).get('district') or '')
            # 宽容比较："东城" vs "东城区" 视为一致（`sameDistrict` 的同款口径）
            if not (got == nm or got.startswith(nm) or nm.startswith(got)):
                problems.append(
                    f'{pf.relative_to(REPO)} 的 `location.district`（{got}）与顶层 `district`'
                    f'（{ad} → {nm}）**对不上** —— 前者是"点区筛景点"筛的，后者是徽标数字数的；'
                    '不同源 ⇒ 用户看到"徽标写 N、点进去却是 M 个"。'
                    '修 `build.reindex_poi_districts`（它要**一起**写 `location.district`）'
                )
                break
        checked += 1
        if checked >= 2:
            break

    # ── ④ 三个页面的 base 层级 ──
    hits += 1
    base_want = {
        'app/common/logic/useHomeView.ts': "'province'",
        'app/common/logic/useProvinceView.ts': "'city'",
    }
    for rel, want in base_want.items():
        f = WEB / rel
        if not f.exists():
            problems.append(f'{rel} 不存在')
            continue
        text = strip_comments_keep_lines(f.read_text(encoding='utf-8'))
        if f'base: {want}' not in text:
            problems.append(f'{rel} 的揭示 `base` 不是 {want} —— 首页看全国、省级页看本省的市')
        # 省 / 首页在 district 这一级要**按层级分支**，不能把市徽标当区徽标铺
        # ★ 判据认的是**分支**（`lvl === 'district'` / `lvl !== 'district'`），不是"出现过
        #   `district` 这个词" —— 光查词会被注释或别的数组骗过，而这条护栏要拦的正是
        #   "忘了给新层级写分支"（那时它会拿市徽标顶上，屏幕上看着像"区这一级不存在"）
        if "lvl === 'district'" not in text and "lvl !== 'district'" not in text:
            problems.append(
                f'{rel} 的 `districts()` 没有按 `district` 这一级分支 —— '
                '放大到区级时会拿市徽标顶上，看起来像"区这一级不存在"'
            )

    city_view = WEB / 'app/common/logic/useCityView.ts'
    if city_view.exists():
        text = strip_comments_keep_lines(city_view.read_text(encoding='utf-8'))
        if "base: 'district'" not in text:
            problems.append(
                'useCityView.ts 的日志/基准层级不是 `district` —— '
                '城市页的立身之本现在是"先看区"，写回 `poi` 会让这一页退化成只有景点'
            )
        if 'useCityDistrictLayer(' not in text:
            problems.append(
                'useCityView.ts 没有挂 `useCityDistrictLayer(` —— 城市页拿不到区图层，'
                '四级显示在最重要的那一页断掉'
            )

    # ── ⑤ 「省的面」与"待收录"档的可见性（2026-09-30 用户：「省市区的所有轮廓都不明显」）
    # ★ 守的是**静默退化**：三层都"有面"这件事，少任何一环都不报错 ——
    #   用户看到的只是"轮廓不清楚"，会以为那些线是底图自带的。
    hits += 1
    reveal_f = WEB / 'app/common/logic/useMapReveal.ts'
    data_f = WEB / 'app/common/data/data.ts'
    style_f = WEB / 'app/common/map/tencent/districtStyles.ts'
    if not reveal_f.exists():
        problems.append('app/common/logic/useMapReveal.ts 不存在')
    else:
        rv = strip_comments_keep_lines(reveal_f.read_text(encoding='utf-8'))
        # ★★ 面的层级必须与徽标一致（用户：「显示省标签的时候显示省的轮廓，
        #   显示市标签的时候显示市的轮廓，显示区的时候显示区的轮廓」）。
        #   固定一个 `districtFile` 时，放大揭示到下一级后新徽标在文件里**查不到
        #   自己的 adcode** ⇒ 整片没有面。实测（首页，镜头钉成都）：
        #   z=4.4 省徽标 → 19 个面 ✓；z=6.8 市徽标 → 还是那 7 个省的面 ✗；
        #   z=9.8 区徽标 → **0 个面** ✗
        if 'loadBoundsForLevel(d.faceLevel' not in rv:
            problems.append(
                '揭示层没有按**这一屏要画的面的层级**去取面（`loadBoundsForLevel(d.faceLevel, …)`）—— '
                '固定一个 `districtFile`、或按 `d.level` 取（点位档是 `poi`，取不到面）'
                '都会让某些档整片没有面'
            )
        if 'districtFile' in rv:
            problems.append(
                '揭示层又出现了 `districtFile` —— 那会把面**钉死在某一个层级**上'
                '（"显示市标签却画着省的面"就是这么来的）'
            )
    # ★★ 边界那几条在 2026-10-01 被拆到 `app/common/data/bounds.ts`（data.ts 撞了 420 行上限）。
    #   所以查符号时**两个文件拼起来看** —— 只盯 data.ts 会立刻假红，而更糟的写法是
    #   把断言删掉（那就再也守不住了）。
    bounds_f = WEB / 'app/common/data/bounds.ts'
    bounds_raw = bounds_f.read_text(encoding='utf-8') if bounds_f.exists() else ''
    bounds_nc = strip_comments_keep_lines(bounds_raw)
    # ★ 2026-10-02：三个「自身轮廓」读取器拆到了 `ownBounds.ts`（bounds.ts 撞 420 行）。
    #   ⇒ 所有"某条链路在不在"的断言都改成**三个文件拼起来查**：
    #   只盯 data.ts 会立刻假红，而更糟的写法是把断言删掉（那就再也守不住了）。
    own_f = WEB / 'app/common/data/ownBounds.ts'
    own_raw = own_f.read_text(encoding='utf-8') if own_f.exists() else ''
    own_nc = strip_comments_keep_lines(own_raw)
    bounds_all = bounds_raw + own_raw
    bounds_all_nc = bounds_nc + own_nc
    bounds_plain = strip_comments(bounds_raw)
    if not data_f.exists():
        problems.append('app/common/data/data.ts 不存在')
    else:
        dt = strip_comments_keep_lines(data_f.read_text(encoding='utf-8'))
        # ★ 三个文件拼起来看（见上面那段注释：边界链路 2026-10-01 搬去 bounds.ts、
        #   2026-10-02 "自身轮廓"读取器再拆去 ownBounds.ts）
        dt_all = dt + bounds_all_nc
        for sym in (
            'export async function loadProvinceOutlines(',
            'export async function loadBoundsForLevel(',
        ):
            if sym not in dt_all:
                problems.append(
                    f'`bounds.ts`（或 `data.ts`）没有 `{sym}` —— 前者是"省的面"的兜底'
                    '（该省各市的环拼出来的），后者是"按层级取面"的统一入口；'
                    '少了它就只能退回"页面各传一个固定文件"'
                )
    if style_f.exists():
        st = strip_comments_keep_lines(style_f.read_text(encoding='utf-8'))
        # ★「待收录」档的描边**不许退回极淡**：省级页上整片待收录的市就看它认出这是哪儿
        if "'#B4B2A9'" in st:
            problems.append(
                '「待收录」档的描边又回到 `#B4B2A9` —— 那在浅色底图上等于没有，'
                '一整个省的轮廓会看不出来（档位表见 `districtStyles.ts` 文件头）'
            )

    # ── ⑥ 省**自身**的轮廓（2026-09-30：腾讯拿不到 ⇒ 换高德，仍是持牌图商）
    # ★ 守的是**静默降级**：少了这条链路，省的面会自动退回"用各市拼"，
    #   于是省**内部**又出现市界网 —— 不报错，只是看起来"轮廓不对"。
    hits += 1
    for mod_name in ('amap', 'step9_province_outline'):
        if not pmod(mod_name).exists():
            problems.append(
                f'{prel(mod_name)} 不存在 —— 腾讯没有"省自身"轮廓的接口，这一份只能换源取；'
                '少了它省的面会退回"各市拼"，把省内市界一起描出来'
            )
    amap_f = pmod('amap')
    if amap_f.exists():
        am = strip_comments(amap_f.read_text(encoding='utf-8'))
        # ★★ "取自身轮廓"的契约就在这两个参数上：`subdistrict=0`（不要下级）
        #    + `extensions=all`（要边界点）。文档原话是「只返回当前查询 district 的边界值，
        #    不返回子节点的边界值」—— 改动任一个都会静默变成"拿到的是下级"或"没有坐标"。
        for token, why in (
            ('"subdistrict": 0', '不传 `subdistrict=0` 会带回下级的边界（就是腾讯那种情形）'),
            ('"extensions": "all"', '不传 `extensions=all` 拿不到边界坐标点（默认 base 没有坐标）'),
            ('restapi.amap.com', '边界只能取自**持牌图商 / 官方平台**'),
        ):
            if token not in am:
                problems.append(f'pipeline/providers/amap.py 里没有 `{token}` —— {why}')
        # 🚨 合规：边界数据**只许来自持牌图商 / 官方平台**（腾讯 / 高德 / 百度 / 天地图）。
        #    做法是把文件里出现的**所有 URL 主机名**跟白名单比 —— 比"搜第三方数据集关键词"
        #    可靠得多（后者会被注释/说明文字里的词误伤，而这个文件恰好要解释"为什么不能用第三方"）。
        hosts = set(re.findall(r'https?://([^/"\'\s:]+)', am))
        bad_hosts = sorted(h for h in hosts if h not in ALLOWED_BOUNDARY_HOSTS)
        if bad_hosts:
            problems.append(
                f'pipeline/providers/amap.py 里出现了白名单外的主机名：{bad_hosts} —— '
                '🚨 合规红线：中国边界只能用持牌图商/官方平台的数据。第三方 GeoJSON'
                '（Natural Earth / GADM 之类）的版图表达不可信，违反《地图管理条例》'
            )
    step9_f = pmod('step9_province_outline')
    if step9_f.exists():
        if 'PROVINCES' not in strip_comments(step9_f.read_text(encoding='utf-8')):
            problems.append(
                'step9 没有写进 `PROVINCES` —— 产物落错目录时前端读不到，'
                '表现是"跑了脚本但省的面没变"（不报错）'
            )
    layout_f = pmod('layout')
    if layout_f.exists() and 'PROVINCES = GENERATED / "provinces"' not in layout_f.read_text(
        encoding='utf-8'
    ):
        problems.append(
            '`pipeline/core/layout.py` 里没有 `PROVINCES = GENERATED / "provinces"` —— '
            '路径拼法只有那一处说了算（散在各脚本里必然漏改一处，而 vite 的 glob 静默匹配 0 个文件）'
        )
    run_f = pmod('run')
    if run_f.exists() and '"outline"' not in run_f.read_text(encoding='utf-8'):
        problems.append('`pipeline/run.py` 没有 `outline` 子命令 —— 这份数据没法重新生成')
    # ★★ 配置**按工程分家**（2026-09-30）：采集侧的模板在 `pipeline/.env.example`，
    #    `web/.env.example` 只该有前端那把 `VITE_` 开头的。查的是**赋值**（`KEY=`）
    #    而不是"出现过这个名字"—— 两边文档都会解释性提到对方的名字，只查名字等于没查。
    env_f = PIPELINE_DIR / '.env.example'
    if env_f.exists() and 'AMAP_WEB_KEY=' not in env_f.read_text(encoding='utf-8'):
        problems.append(
            '`pipeline/.env.example` 里没有 `AMAP_WEB_KEY=` —— 新克隆的人不知道要配这把 key，'
            '而缺它只会静默退回"各市拼"'
        )
    web_env_f = WEB / '.env.example'
    if web_env_f.exists():
        wt = web_env_f.read_text(encoding='utf-8')
        # ★ 必须**行首锚定**（2026-10-16 修）：原先用子串 `'TMAP_WEB_KEY=' in wt`，
        #   而前端那个键叫 `VITE_TMAP_WEB_KEY=` —— **子串正好命中**，整条判据变成永远报错。
        #   更糟的是它会把人往错的方向引：为了让检查变绿，去删掉一个正确的配置项。
        #   要禁的是「**裸**采集侧键名」—— `VITE_` 前缀的那把是前端自己的、就该在这儿。
        for leaked in ('TMAP_WEB_KEY', 'AMAP_WEB_KEY', 'UNSPLASH_ACCESS_KEY', 'PEXELS_API_KEY'):
            if re.search(rf'^\s*{leaked}\s*=', wt, re.M):
                problems.append(
                    f'`web/.env.example` 里出现了采集侧的 `{leaked}=` —— 这个文件是 **Vite 的加载面**，'
                    '私密 key 和前端配置住在一起，迟早有人手滑加个 `VITE_` 前缀就把它发到浏览器上。'
                    '采集侧模板归 `pipeline/.env.example`'
                )
    # ★ 采集侧的加载顺序：`pipeline/` 优先，`web/` 只作兼容兜底（否则老位置会一直赢）
    envpy = pmod('env')
    if envpy.exists() and 'ENV_DIRS=(PIPELINE, WEB)' not in envpy.read_text(encoding='utf-8'):
        problems.append(
            '`pipeline/core/env.py` 的 `ENV_DIRS` 不再是 `(PIPELINE, WEB)` —— '
            '采集侧的配置必须**优先**从 `pipeline/` 读，`web/` 只是兼容兜底'
        )
    if data_f.exists():
        dt2 = strip_comments_keep_lines(data_f.read_text(encoding='utf-8'))
        dt2 += bounds_all_nc
        for sym in ('loadProvinceOwnOutline(', 'loadProvinceFaces('):
            if sym not in dt2:
                problems.append(
                    f'`data.ts` 没有 `{sym}` —— 省这一级要先试"自身轮廓"、'
                    '读不到才退回"各市拼"；少了它就一直是那张市界网'
                )
        # ★ 省分支必须真的走新入口，否则"函数写了但没人调"（不报错，行为不变）
        if 'loadProvinceFaces(adcodes)' not in dt2:
            problems.append(
                '`loadBoundsForLevel` 的省分支没有调 `loadProvinceFaces(adcodes)` —— '
                '函数写了但没人调，等于没做'
            )
        # ★ 用**原始文本**（不剥注释）查这条：glob 串里带着 `/*`，
        #   而注释剥离器会把它当成块注释的起始、把后面整段吞掉（踩过一次）。
        if '_generated/provinces/*.geo.json' not in data_f.read_text(encoding='utf-8') + bounds_all:
            problems.append(
                '`data.ts` 的 glob 没指向 `_generated/provinces/*.geo.json` —— '
                '路径写错时 vite 静默匹配 0 个文件，省的面会一直是"各市拼"'
            )

    # ── ⑦ 市**自身**的轮廓（2026-09-30：市这一级也要"抓全"，且要细）
    # ★ 守的还是**静默降级**：少了这条链路，市的面自动退回腾讯那份（只有 20/34 份省、
    #   且是各自独立抽稀的粗轮廓）—— 不报错，只是"半个国家没有面 + 折角很硬"。
    hits += 1
    step10_f = pmod('step10_city_outlines')
    if not step10_f.exists():
        problems.append(
            'pipeline/steps/step10_city_outlines.py 不存在 —— 市这一级会退回腾讯的 `districts/`'
            '（实测只有 20/34 份省 ⇒ 放大到市时半个国家没有面）'
        )
    else:
        s10 = strip_comments(step10_f.read_text(encoding='utf-8'))
        if 'CITY_BOUNDS' not in s10:
            problems.append(
                'step10 没有写进 `CITY_BOUNDS` —— 产物落错目录时前端读不到，'
                '表现是"跑了脚本但市的面没变"（不报错）'
            )
        # ★ 7 个直辖市/特区**自身就是市这一级**，它们的轮廓要抄 `provinces/` 里已有的，
        #   不该再发一次请求、也不该漏掉（漏了它们在市这一级就没面）
        # ⚠️ 判据要**按整行**匹配：写 `'PROVINCES' not in s10` 会被 `PROVINCES_GONE` 骗过
        #    （子串包含），而反证正好抓到了这一点。
        if not re.search(r'^\s+PROVINCES,\s*$', s10, re.M):
            problems.append(
                'step10 没有 import `PROVINCES` —— 北京/天津/上海/重庆/中国台湾/中国香港/中国澳门'
                '自身就是"市"这一级，轮廓要从 `provinces/` 抄过来，否则这几格在市这一级没面'
            )
    layout_f2 = pmod('layout')
    if layout_f2.exists() and 'CITY_BOUNDS = GENERATED / "cities"' not in layout_f2.read_text(
        encoding='utf-8'
    ):
        problems.append(
            '`pipeline/core/layout.py` 里没有 `CITY_BOUNDS = GENERATED / "cities"` —— '
            '路径拼法只有那一处说了算'
        )
    run_f2 = pmod('run')
    if run_f2.exists() and '"cities"' not in run_f2.read_text(encoding='utf-8'):
        problems.append('`pipeline/run.py` 没有 `cities` 子命令 —— 这份数据没法重新生成')
    if data_f.exists():
        dt3 = strip_comments_keep_lines(data_f.read_text(encoding='utf-8')) + bounds_all_nc
        if 'loadCityOwnBounds(' not in dt3:
            problems.append(
                '`data.ts` 没有 `loadCityOwnBounds(` —— 市这一级要**先试自身轮廓**、'
                '读不到才退回腾讯那份；少了它就一直是"半个国家没有面"'
            )
        if 'loadCityOwnBounds(p)' not in dt3:
            problems.append(
                '`loadBoundsForLevel` 的市分支没有调 `loadCityOwnBounds(p)` —— '
                '函数写了但没人调，等于没做'
            )
        # ★ 兜底必须还在：分片是按需抓的，缺一个省不能把整片降级成空白
        if 'loadDistrictBounds(p)' not in dt3:
            problems.append(
                '`loadBoundsForLevel` 的市分支没有 `loadDistrictBounds(p)` 兜底 —— '
                '缺分片的省会**整片空白**（应该退回腾讯那份）'
            )
    # ★ 同 ⑥：glob 串带 `/*`，必须用**原始文本**查
    if '_generated/cities/*.geo.json' not in data_f.read_text(encoding='utf-8') + bounds_all:
        problems.append(
            '`data.ts` 的 glob 没指向 `_generated/cities/*.geo.json` —— '
            '路径写错时 vite 静默匹配 0 个文件，市的面会一直是腾讯那份'
        )

    # ── ⑧ 区级：**全国铺**（2026-10-01 用户：「把所有的区的数据都补全」）──
    # 以前区徽标只从**已收录城市**的区分片里取（`useHomeView` 那个 `cityId !== null` 的筛，
    # 理由是"给没内容的城市撒满 0 个区徽标 = 谎报没景点"）。现在改读构建期合成的
    # `district-index.json`（全国 2894 个区 · gzip 45KB）—— 否则"读 374 份分片"= 374 个请求。
    hits += 1
    build_f = pmod('build')
    if not build_f.exists():
        problems.append('pipeline/build.py 不存在')
    else:
        bs = strip_comments_keep_lines(build_f.read_text(encoding='utf-8'))
        if 'def build_district_index(' not in bs:
            problems.append(
                '`pipeline/build.py` 没有 `build_district_index` —— '
                '区索引是它的产物，少了它前端读不到"全国区节点"'
            )
        # ★ 顺序：这个函数读的就是 `sync_subdistrict_counts` 刚回填的 `poiCount`。
        #   ⚠️ 判据取**写盘那一行**（`GENERATED / "district-index.json"`）而不是
        #   `build_district_index()` —— 后者会先匹配到 `def build_district_index():` 的定义，
        #   于是永远"排在 sync 之前"（这条断言自己踩过一次，写松了）。
        i_call = bs.find('GENERATED / "district-index.json"')
        i_sync = bs.find('sync_subdistrict_counts(')
        if i_call == -1:
            problems.append('`build_district_index()` 没有被调用 —— 函数写了但不生成文件')
        elif i_sync != -1 and i_call < i_sync:
            problems.append(
                '`build_district_index()` 排在 `sync_subdistrict_counts(` **之前** —— '
                '它读的就是刚回填的 `poiCount`，顺序反了会整片读成"缺失" ⇒ 全国的区都显示「—」'
            )

    hits += 1
    di_rel = 'app/common/data/districtIndex.ts'
    di_f = WEB / di_rel
    if not di_f.exists():
        problems.append(f'{di_rel} 不存在')
    else:
        di_raw = di_f.read_text(encoding='utf-8')
        if '_generated/district-index.json' not in di_raw:
            problems.append(
                f'{di_rel} 的 glob 没指向 `_generated/district-index.json` —— '
                '路径写错时 vite 静默匹配 0 个文件，区这一级会退回"只有已收录城市"'
            )
        # ★ `null` = 待收录（显示「—」）。写成 `0` 就是谎报"这个区有 0 个景点"（红线）。
        #   ⚠️ 判据必须是**整串**：只查 `poiCount: typeof n` 的话，把尾巴的 `null` 换成 `0`
        #   也照样通过（这条断言自己踩过一次，写松了）。
        if "poiCount: typeof n === 'number' ? n : null" not in strip_comments_keep_lines(di_raw):
            problems.append(
                f'{di_rel} 没有"是数字才当数字、其余当 null"的守卫 —— '
                '未收录城市的区会显示「0」而不是「—」（红线：未收录绝不显示 0）'
            )

    hits += 1
    for rel in ('app/common/logic/useHomeView.ts', 'app/common/logic/useProvinceView.ts'):
        f = WEB / rel
        if not f.exists():
            problems.append(f'{rel} 不存在')
            continue
        t = strip_comments_keep_lines(f.read_text(encoding='utf-8'))
        if 'useDistrictIndex()' not in t:
            problems.append(f'{rel} 没有调 `useDistrictIndex()` —— 区这一级只覆盖已收录城市')
        # ★ 防退回：区徽标不许再从 `subRows` 拼（它只覆盖已收录城市，留着就成了幽灵分支）
        if re.search(r'Object\.(values|entries)\(subRows\)', t):
            problems.append(
                f'{rel} 的区级还在用 `Object.values/entries(subRows)` —— '
                '那是"只有已收录城市"的老路（`subRows` 现在只服务"点市徽标框哪一片"）'
            )

    # 数据侧：`null`（待收录）必须**占多数** —— 谁把它写成 0，这条立刻红
    hits += 1
    di_data = REPO / 'data/_generated/district-index.json'
    if di_data.exists():
        try:
            its = (json.loads(di_data.read_text(encoding='utf-8')) or {}).get('items') or []
            n_null = sum(1 for x in its if isinstance(x, list) and len(x) == 5 and x[4] is None)
            if its and n_null < len(its) // 2:
                problems.append(
                    f'`district-index.json` 里只有 {n_null}/{len(its)} 条的 `poiCount` 是 null —— '
                    '未收录城市的区**必须**是 null（前端显示「—」）；写成 0 就是谎报'
                    '"这地方有 0 个景点"。多半是 `build_district_index` 把"缺失"当成了 0'
                )
        except Exception as exc:                       # noqa: BLE001
            problems.append(f'`district-index.json` 读不出来：{exc}')

    # ── ⑩ 徽标落点 = **面内视觉中心**（2026-10-01 用户：「定位到市政府…靠某一侧」）──
    # 腾讯 `getchildren` 的 `center` 是**政府驻地**（省 = 省会 / 市 = 市政府 / 区 = 区政府），
    # 实测与"面内视觉中心"的偏差：省中位 113km、市 28km、区 9.6km。
    # `build.sync_label_centers()` + `pipeline/labelgeo.py` 负责重算。
    hits += 1
    lg_f = pmod('labelgeo')
    if not lg_f.exists():
        problems.append('pipeline/labelgeo.py 不存在 —— 徽标落点（面内视觉中心）的算法在那儿')
    elif 'def label_point(' not in strip_comments(lg_f.read_text(encoding='utf-8')):
        problems.append('`pipeline/labelgeo.py` 没有 `label_point(` —— 落点全靠它')
    b_f2 = pmod('build')
    if b_f2.exists():
        bs2 = strip_comments_keep_lines(b_f2.read_text(encoding='utf-8'))
        i_def = bs2.find('def sync_label_centers(')
        # ⚠️ `def sync_label_centers()` 那一行**自己也含** `sync_label_centers()` ⇒
        #   不能用 `find`/`rfind` 比位置（差 4 个字符，"没调用"判不出来 —— 这条断言
        #   第一版就写松了，被反证 ㉗ 抓到）。**数出现次数**最稳：定义 1 + 调用 1 = 2。
        n_occ = bs2.count('sync_label_centers()')
        i_call = bs2.rfind('sync_label_centers()')
        i_tree = bs2.find('sync_district_tree()')
        if i_def == -1:
            problems.append(
                '`pipeline/build.py` 没有 `sync_label_centers` —— 徽标会退回腾讯给的**政府驻地**'
            )
        elif n_occ < 2:
            problems.append(
                '`sync_label_centers()` 没有被调用 —— 函数写了但不回填（徽标会退回政府驻地）'
            )
        elif i_tree != -1 and i_call < i_tree:
            problems.append(
                '`sync_label_centers()` 排在 `sync_district_tree()` **之前** —— '
                '后者会重写 `district-tree.json`，顺序反了落点会被打回政府驻地'
            )
    # 数据抽查：抽查 3 个省的 `center` 必须与算法结果一致（证明"回填真的跑过了"）
    hits += 1
    try:
        if str(REPO) not in sys.path:
            sys.path.insert(0, str(REPO))
        from pipeline.geo.labelgeo import label_point as _lp          # noqa: PLC0415
        tree_d = json.loads((REPO / 'data/_generated/district-tree.json').read_text(encoding='utf-8'))
        for prov in (tree_d.get('provinces') or [])[:3]:
            pa = str(prov.get('adcode') or '')
            pf = REPO / f'data/_generated/provinces/{pa}.geo.json'
            if not pf.exists():
                continue
            rings = (json.loads(pf.read_text(encoding='utf-8')).get('polygons') or {}).get(pa) or []
            pt = _lp(rings)
            if not pt:
                continue
            got = prov.get('center') or {}
            if (abs(float(got.get('lng', 0)) - pt[0]) > 1e-3
                    or abs(float(got.get('lat', 0)) - pt[1]) > 1e-3):
                problems.append(
                    f'`district-tree.json` 里 {prov.get("name")} 的 `center` 与"面内视觉中心"'
                    f'（{pt[0]:.4f},{pt[1]:.4f}）不一致 —— 落点没回填'
                    '（跑 `python pipeline/run.py build`；徽标会退回政府驻地）'
                )
    except Exception as exc:                                   # noqa: BLE001
        problems.append(f'徽标落点抽查失败：{exc}')

    # ── ⑪ 点位档「区轮廓不消失」：面与徽标在这一档**分家**（2026-10-02）──
    # 用户：「区的轮廓，能不能一直都显示，现在区在放大到显示景点的时候就不会显示了，
    #   **就不知道这个到底在哪个区**」。
    #
    # 这条链上有四个文件，**缺任何一处都会退回去**，所以四处都钉：
    #   判据（给面）→ 消费（用面 + 不清屏）→ 城市页（切 reference 而不是 clear）
    #   → 图层（reference 必须同时关徽标与点击）
    hits += 1
    rev_f = WEB / 'app/common/map/tencent/reveal.ts'
    rev = strip_comments_keep_lines(rev_f.read_text(encoding='utf-8')) if rev_f.exists() else ''
    if "faceLevel: 'district'" not in rev:
        problems.append(
            "`reveal.ts` 的点位档没有给出「面」的来源（缺 `faceLevel: 'district'`）—— "
            '点位档的 `districts`（徽标）本来就是空的，面再不给 ⇒ 放大到景点时区轮廓消失，'
            '用户就看不出这些景点在哪个区'
        )
    if 'faces: faceNodes' not in rev:
        problems.append('`reveal.ts` 的点位档没有把区级节点放进 `faces` —— 同上')

    rv2_f = WEB / 'app/common/logic/useMapReveal.ts'
    rv2 = strip_comments_keep_lines(rv2_f.read_text(encoding='utf-8')) if rv2_f.exists() else ''
    if 'const faceNodes = d.faces' not in rv2:
        problems.append(
            '`useMapReveal.ts` 没有用 `d.faces` 铺几何 —— 用 `d.districts` 在点位档是空数组，'
            '面会被清掉'
        )
    if "d.level !== 'poi'" not in rv2:
        problems.append(
            '`useMapReveal.ts` 在 `faces` 为空时没有"**点位档不清屏**"的守卫 —— '
            '区数据还没到的那一帧会把轮廓清掉（闪一下白，再铺回来）'
        )

    cl_f = WEB / 'app/common/logic/useCityDistrictLayer.ts'
    cl = strip_comments_keep_lines(cl_f.read_text(encoding='utf-8')) if cl_f.exists() else ''
    if "'reference'" not in cl:
        problems.append(
            '城市页 `useCityDistrictLayer.ts` 没有 `reference` 模式 —— '
            '放大到景点时区轮廓会跟着徽标一起消失'
        )
    if re.search(r'POI_REVEAL_ZOOM\)\s*return\s+clear\(\)', cl):
        problems.append('城市页在点位档又直接 `clear()` 了 —— 面会跟着徽标一起消失')

    # ★★ 日志读数必须如实：`onSettled` 漏传区图层读数时 `polys` 恒为 0，
    #   而它**总是最后落盘**（聚合异步结算）⇒ 覆盖掉 paint 那条正确读数。
    #   2026-10-02 排查"点位档面也没了"就是被这个假 0 骗着去翻图层代码的。
    cv_f = WEB / 'app/common/logic/useCityView.ts'
    cv = strip_comments_keep_lines(cv_f.read_text(encoding='utf-8')) if cv_f.exists() else ''
    if 'logCity(layerRef.current?.stats())' in cv:
        problems.append(
            '`useCityView.ts` 的 `onSettled` 漏传了区图层读数（`logCity(…)` 只有一个参数）—— '
            '`polys` 会恒为 0 且它最后落盘 ⇒ 日志/探针看到的永远是"这一屏没有面"'
        )

    dl_f = WEB / 'app/common/map/tencent/districtLayer.ts'
    dl = strip_comments_keep_lines(dl_f.read_text(encoding='utf-8')) if dl_f.exists() else ''
    # 四处，**一处都不能少**：① 徽标重绘早退（不生成徽标）② 多边形不接 click
    # ③ 徽标不接 click ④ 不接 hover。
    # ★ 只关一半就会出问题：面是大块填充、几乎覆盖整屏，留着 click ⇒
    #   用户"点景点附近"命中面 ⇒ 飞到区中心（想点景点，镜头却飞走）。
    #
    # ★★ 2026-10-02：判据从"`mode === 'reference'` 出现 ≥ 4 次"改成**逐处判**。
    #   起因是反向验证（`_tmp/falsify_ac.py` 的 ㉟）**失效**了 ——
    #   当天给 `styleIdOf` 加了一处同名判断（"点位档的面切 `reference` 样式"），
    #   总数变成 5 ⇒ 只把 `polygons.on('click')` 的闸门拆掉，计数仍是 4，检查照旧报绿。
    #   计数法的前提是"只此四处"，任何人**正当**地多写一处就会静默削弱它。
    #   ⇒ 改成对**每个门**各取一小段上下文判一次：窗口小到不会误伤重构，
    #     又精确到"拆掉哪一处就报哪一处"。
    gates = [
        ("polygons.on('click'", '多边形不接 click'),
        ("badges.on('click'", '徽标不接 click'),
        ('function onHover(', '不接 hover'),
    ]
    missing = []
    for anchor, what in gates:
        at = dl.find(anchor)
        if at < 0:
            missing.append(f'{what}（找不到锚点 `{anchor}`）')
        elif "mode === 'reference'" not in dl[at:at + 220]:
            missing.append(what)
    # 徽标重绘那一处的闸门在 `setGeometries` **之前**，而且 `clear()` / `destroy()` 里
    # 也有同名调用 ⇒ 判据是"**至少有一处**前面带着闸门"，不能只取第一个命中
    # （只取第一个就会命到 `clear()` 里那个，于是基线自己假红）。
    gated = any(
        "mode === 'reference'" in dl[max(0, m.start() - 220):m.start()]
        for m in re.finditer(re.escape('badges.setGeometries([])'), dl)
    )
    if not gated:
        missing.append('徽标重绘要早退（点位档不生成徽标）')
    if missing:
        problems.append(
            '`districtLayer.ts` 的 `reference` 模式没有把关到位：' + ' / '.join(missing) + ' —— '
            '只关一半时，用户"点景点附近"会命中面而飞到区中心'
        )

    # ── ⑫ 重复计算：拖拽时"渲染过了就不再算"（2026-10-02）──
    # 用户：「像区和景点的点位，拖拽时如果渲染过了就不需要再重复计算了吧，
    #   现在放大到一定比例，拖拽的时候会卡一下，拖拽到屏幕之外后再拖拽进来，会重新渲染」。
    # 三条短路分别住在三个文件里，**少一条就有一处白算**（而且都不报错，只是变慢）。
    hits += 1
    pc_f = WEB / 'app/common/map/tencent/poiCluster.ts'
    pc = strip_comments_keep_lines(pc_f.read_text(encoding='utf-8')) if pc_f.exists() else ''
    if 'lastSentSig' not in pc or 'if (sig === lastSentSig)' not in pc:
        problems.append(
            '`poiCluster.ts` 的 `setDots` 没有点集签名短路 —— 每次拖拽都会 '
            '`setGeometries`（同步清空聚类结果 + 触发 worker 重聚类 = "拖一下卡一下"）'
        )
    if 'if (!waiting) {' not in pc:
        problems.append(
            '`poiCluster.ts` 的短路没有 `if (!waiting)` 守卫 —— 每帧都给 `deadline` '
            '续期，结算永远等不到（名字层不更新）'
        )
    dl2_f = WEB / 'app/common/map/tencent/districtLayer.ts'
    dl2 = strip_comments_keep_lines(dl2_f.read_text(encoding='utf-8')) if dl2_f.exists() else ''
    if 'contentSig !== badgeSig' not in dl2:
        problems.append(
            '`districtLayer.ts` 的 `repaintBadges` 没有内容签名短路 —— '
            '拖拽时反复重设同一批徽标几何（内容逐字节相同）'
        )
    if dl2.count("badgeSig = ''") < 2:
        problems.append(
            "`districtLayer.ts` 的 `reference` 分支没有作废 `badgeSig` —— "
            '切回徽标档时几何已被清空、签名却还相等 ⇒ 徽标永远不回来'
        )
    # ★ 解码与缓存在 2026-10-02 拆到 `districtGeometry.ts`（districtLayer 撞了 420 行）
    dg_f = WEB / 'app/common/map/tencent/districtGeometry.ts'
    dg = strip_comments_keep_lines(dg_f.read_text(encoding='utf-8')) if dg_f.exists() else ''
    if 'GEOMETRY_CACHE_MAX' not in dg or 'cache.size >= max' not in dg:
        problems.append(
            '`districtGeometry.ts` 的几何解码缓存没有上限 —— 全国 2894 个区会把内存吃光'
        )
    rv3 = strip_comments_keep_lines((WEB / 'app/common/map/tencent/reveal.ts').read_text(encoding='utf-8'))
    if 'export const FACE_VIEW_PAD = 2' not in rv3:
        problems.append(
            '`reveal.ts` 的 `FACE_VIEW_PAD` 不是 2 —— 面比徽标多留一圈是刻意的'
            '（"拖出去一点点"不该让面消失，且集合更稳 ⇒ 更少的 `setNodes`）'
        )

    check(label, problems, 12, hits)


# ────────────────────────────────────────────────
# AD. 规划记录存储层（IndexedDB 唯一出口 + 写库前过契约 + 折线真的被解出来）
# ────────────────────────────────────────────────
#
# 这一层全是**静默失败**：`idb.ts` 的每个出入口都刻意返回 `null` / `false` 而不抛错
# （因为"存不了"不该让页面崩），于是"没写进去""读不出来""折线没解"三件事
# 都不会有任何界面反馈。所以只能静态把它们钉住：
#
#   ① **IndexedDB 只有一个出口**（`common/data/idb.ts`）
#      —— 同 X 项"图片出口唯一"的道理：别处直接 `indexedDB.open` 就会绕开
#      单例连接、`versionchange` 处理、`undefined→null` 归一化，那三条都是踩过才知道要写的
#   ② `planStore` 写库前必须过 `RoutePlanSchema`
#      —— 契约在 `schema/`，绕过去之后坏数据会平静地进库，直到某天读出来才炸
#   ③ `wholeRoute` 必须真的调用 `decodePolyline`
#      —— 接不上就是"路线画成两点直连"（旧形态），不报错
#   ④ `planStore` 里**不许**出现 `localStorage` / `readJson`
#      —— 用户 2026-09-25 定的"只有可用/不可用两态，不写降级链"
#   ⑤ `planMigrate` **不许删旧键**（迁移 = 复制一份过去，旧键留着当回滚点）
#   ⑥ `itinerary/store.ts` 的 `persist()` 里**不许**再往 localStorage 写行程
#      —— 双写会让"哪边是对的"变成运气问题
#
# 反证：把 `decodePolyline(` 从 `wholeRoute.ts` 注掉 → ③ 必须 FAIL。


def check_plan_storage() -> None:
    label = 'AD. 规划记录存储层（IDB 唯一出口 + 写库过契约 + 折线真的解出来）'
    problems: list[str] = []
    hits = 0

    idb_rel = 'app/common/data/idb.ts'
    store_rel = 'app/common/logic/itinerary/planStore.ts'
    whole_rel = 'app/common/logic/itinerary/wholeRoute.ts'
    migrate_rel = 'app/common/logic/itinerary/planMigrate.ts'
    itin_rel = 'app/common/logic/itinerary/store.ts'

    # ① IndexedDB 唯一出口
    hits += 1
    offenders: list[str] = []
    for f in list(WEB.glob('app/**/*.ts')) + list(WEB.glob('app/**/*.tsx')):
        if str(f.relative_to(WEB)).replace('\\', '/') == idb_rel:
            continue
        body = strip_comments_keep_lines(f.read_text(encoding='utf-8'))
        # 只看"真的去开库"的写法；`typeof indexedDB` 这种探测不算
        if re.search(r'indexedDB\s*\.\s*open\b', body):
            offenders.append(str(f.relative_to(WEB)))
    if offenders:
        problems.append(
            '除了 `' + idb_rel + '` 还有别处直接 `indexedDB.open`：' + '、'.join(offenders) +
            ' —— 会绕开单例连接 / `versionchange` 处理 / `undefined→null` 归一化这三条'
        )

    # ② 写库前过契约
    hits += 1
    store_text = strip_comments_keep_lines((WEB / store_rel).read_text(encoding='utf-8'))
    if 'RoutePlanSchema.safeParse' not in store_text:
        problems.append(
            f'{store_rel} 里没有 `RoutePlanSchema.safeParse` —— 写库前必须过契约。'
            '绕过去之后坏数据会平静地进 IndexedDB，直到某天读出来才炸'
        )

    # ③ 折线解码真的接上了
    hits += 1
    whole_text = strip_comments_keep_lines((WEB / whole_rel).read_text(encoding='utf-8'))
    if 'decodePolyline(' not in whole_text:
        problems.append(
            f'{whole_rel} 里没有调用 `decodePolyline(` —— 接不上就是"路线画成两点直连"'
            '（那正是改造前的形态），而且**不报错**'
        )

    # ④ 不许有第二套持久化
    hits += 1
    if 'localStorage' in store_text or 'readJson' in store_text:
        problems.append(
            f'{store_rel} 里出现了 `localStorage` / `readJson` —— '
            '用户 2026-09-25 定：只有「可用 / 不可用」两态，**不写降级链**，'
            '也不许把规划再抄一份到 localStorage'
        )

    # ⑤ 迁移不删旧键
    hits += 1
    migrate_text = strip_comments_keep_lines((WEB / migrate_rel).read_text(encoding='utf-8'))
    if re.search(r'(localStorage|removeRaw)\s*\.?\s*removeItem|removeRaw\(', migrate_text):
        problems.append(
            f'{migrate_rel} 里在删旧键 —— 迁移是**复制一份过去**，不是搬走。'
            '旧键留着当回滚点（而且 `itinerary/store.ts` 切完之前还在用它）'
        )

    # ⑥ 行程落盘不再写 localStorage
    hits += 1
    itin_text = strip_comments_keep_lines((WEB / itin_rel).read_text(encoding='utf-8'))
    _p = itin_text.find('function persist(')
    if _p == -1:
        problems.append(f'{itin_rel} 里找不到 `function persist(` —— 结构已改，本项检查需要同步')
    elif 'STORAGE_KEYS.itinerary' in itin_text[_p:]:
        problems.append(
            f'{itin_rel} 的 `persist()` 里还在写 `STORAGE_KEYS.itinerary(...)` —— '
            '行程已经落在 IndexedDB 的那条规划上；两边都写会让"哪边是对的"变成运气问题'
        )

    check(label, problems, 6, hits)


def check_district_focus() -> None:
    """AE. 区取景（点区 = **往里走**，且至少落到景点级）

    ## 这条护栏守什么（2026-09-26 用户报的「区的放大等级不对，怎么还缩小地图了」）
    「点徽标 = 放大」这件事在第四级（区）上是**默认不成立**的，而且反过来：

    | 断掉的那截 | 屏幕上发生什么 |
    |------------|----------------|
    | `focusPointsFor` 没有 `boxOf`（省级页 / 首页） | 三级数据源全空 → 掉到 0.5° 的近似**市域**方块 → 比区级那一屏还浅，**镜头往外退** |
    | 只 fit 区的行政外接框 | 大区（从化跨 0.8°）≈ z10.4，点位要 z≥12 才揭 → "点了这个区"看着什么都没发生 |
    | `fitPoints` 不认 `minZoom` | 上面两件事一起回来，而且**没有任何报错** |

    实测（真浏览器，广州荔湾 / 从化，三页各一次）：修好后 z 10.6→13.04、9.43→13.04。

    ## 2026-09-29 追加：**落点钉得越高，丢的景点越多**
    用户原话：「有些区可能就一个景点，放大后我都不知道景点在哪，
    **景点在当前展示的地图之外**」。

    上一轮为了"点区后看得清个体"，把落点钉到了 `DISTRICT_FOCUS_ZOOM`(14)。
    但 `minZoom` 的语义是"**装不下才收缩**"，而收缩**以框中心为锚** ——
    于是它只在"会丢景点"的区上生效。实测（`_tmp/cdp_districtfocus_verify.mjs`，
    真鼠标点徽标 + 墨卡托投影逐点判可见）：

    | 区 | 景点 | 落点 | 屏内 |
    |----|------|------|------|
    | 成都·都江堰市 | 4 | z=14 | **1** |
    | 成都·锦江区 | 11 | z=14 | 4 |
    | 成都·成华区 | 6 | z=14 | 4 |
    | 成都·青羊区 | 19 | z=14 | 2 |

    ⇒ 落点只钉 `POI_ADMIT_MIN_ZOOM`（**地板**：低于它点位层不铺）。"看得清"靠
    **框得准**（框景点自己）+ **锚得准**（`densestPoint`），不靠钉高落点。

    还有一处同时修的：**收缩的锚点**。默认以框的**几何中心**为锚，而景点散在四周时
    那是**一片空地** —— 收缩之后一个景点都看不见。改成"最密的那一枚"（medoid）后，
    重庆渝中从"看得见 0 个"变成"看得见 24 个"。

    同一轮还修了另一处静默失效：**区名宽容匹配**（直辖市的徽标名不带"区"，
    `东城` vs 点位的 `东城区`）—— 4 个直辖市 228 个点位全踩在这一格上。
    """
    label = 'AE. 区取景（区有自己的框 · 落点只钉揭示地板 · 锚点=最密的那枚 · 区名宽容 · 四处都传）'
    problems: list[str] = []
    hits = 0

    # ── ① `fitPoints` 真的实现了 minZoom ──
    hits += 1
    fit_rel = 'app/common/map/tencent/fitView.ts'
    span_rel = 'app/common/map/tencent/zoomSpan.ts'
    fit = WEB / fit_rel
    span = WEB / span_rel
    if not fit.exists():
        problems.append(f'{fit_rel} 不存在')
    else:
        fit_text = strip_comments_keep_lines(fit.read_text(encoding='utf-8'))
        if 'minZoom?: number' not in fit_text:
            problems.append(
                f'{fit_rel} 的 `FitOptions` 没有 `minZoom?: number` —— '
                '取景只能回答"框不框得下"，答不了"落点该到哪一档"'
            )
        if 'shrinkForMinZoom(' not in fit_text:
            problems.append(
                f'{fit_rel} 的 `fitPoints` 没有调 `shrinkForMinZoom(` —— '
                '字段在、实现没接上等于没做（而且不报错，只是落点浅一档）'
            )
        # ★ 兜底跨度必须**只有一份**：`boundsOf` 若自己再写一个 0.02，
        #   刚收缩完的框会被它重新撑回 2km，`minZoom` 白给
        if 'DEGENERATE_SPAN_DEG' not in fit_text or re.search(r'=\s*0\.02\b', fit_text):
            problems.append(
                f'{fit_rel} 里出现了写死的兜底跨度（或没用 `DEGENERATE_SPAN_DEG`）—— '
                '它必须与 `shrinkForMinZoom` 是同一个常量，否则收缩完又被 `boundsOf` 撑开'
            )
    if not span.exists():
        problems.append(f'{span_rel} 不存在（缩放 ↔ 跨度换算被搬走了？）')
    else:
        span_text = span.read_text(encoding='utf-8')
        for sym in ('export const DEGENERATE_SPAN_DEG', 'export function shrinkForMinZoom'):
            if sym not in span_text:
                problems.append(f'{span_rel} 里没有 `{sym}` —— `fitView` 会从这里取它')

    # ── ② `POI_ADMIT_MIN_ZOOM`：地板与"点位层准入下界"必须是同一个数 ──
    hits += 1
    tiers_rel = 'app/common/map/tencent/zoomTiers.ts'
    tiers = WEB / tiers_rel
    if not tiers.exists():
        problems.append(f'{tiers_rel} 不存在')
    else:
        t_text = strip_comments_keep_lines(tiers.read_text(encoding='utf-8'))
        if 'export const POI_ADMIT_MIN_ZOOM' not in t_text:
            problems.append(
                f'{tiers_rel} 没有导出 `POI_ADMIT_MIN_ZOOM` —— 它必须同时是'
                '"点位层准入的下界"与"点区取景的落点地板"；两处各写一个 11.5 会静默分叉'
            )
        n_half = t_text.count('POI_REVEAL_ZOOM - 0.5')
        if n_half != 1:
            problems.append(
                f'{tiers_rel} 里 `POI_REVEAL_ZOOM - 0.5` 出现了 {n_half} 次 —— '
                '只该在 `POI_ADMIT_MIN_ZOOM` 的定义里出现一次，别处一律引用常量名'
            )
        if 'zoom < POI_ADMIT_MIN_ZOOM' not in t_text:
            problems.append(
                f'{tiers_rel} 的 `poiTierForZoom` 没有用 `POI_ADMIT_MIN_ZOOM` 判准入 —— '
                '那样"揭示阈值"与"点区落点地板"会各走各的'
            )

    # ── ③ `focusPointsFor`：区有自己的框，且落点钉在地板上、锚点钉在最密的那枚 ──
    hits += 1
    focus_rel = 'app/common/logic/districtFocus.ts'
    focus = WEB / focus_rel
    if not focus.exists():
        problems.append(f'{focus_rel} 不存在')
    else:
        focus_text = strip_comments_keep_lines(focus.read_text(encoding='utf-8'))
        if 'boxOf?:' not in focus_text:
            problems.append(
                f'{focus_rel} 的 `FocusSources` 没有 `boxOf?:` —— '
                '省级页 / 首页点区时三级数据源全空，会掉到 0.5° 的近似市域方块（那就是"缩小"）'
            )
        if 'minZoom: POI_ADMIT_MIN_ZOOM' not in focus_text:
            problems.append(
                f'{focus_rel} 点区的落点没有钉在 `POI_ADMIT_MIN_ZOOM`（点位层真的会铺的那一档）—— '
                '低于它 `poiTierForZoom` 判 `admitsPoints: false`，屏幕上只剩区徽标，点区等于什么都没发生'
            )
        # ★★ 锚点必须给 `densestPoint`：收缩框默认以**几何中心**为锚，而景点散在
        #   四周时几何中心是**空地** —— 收缩之后一个景点都看不见。
        #   实测（`_tmp/sim_district_focus.py` 全量）：重庆渝中 25 个点，
        #   几何中心锚点 → 看得见 0 个；medoid 锚点 → 看得见 24 个。
        if 'anchor: densestPoint(' not in focus_text:
            problems.append(
                f'{focus_rel} 点区时没有给 `anchor: densestPoint(...)` —— '
                '收缩框会以框的几何中心为锚，而景点散在四周时那是空地（收缩后一个都看不见）'
            )
        # ★★ 徽标写 0 个的区**不许去筛景点**：`poiCount` 是用户看得见的那句话，
        #   而 `poisOf` 筛的是采编稿手写的 `dist` —— 两套口径会打架。
        #   实例（2026-09-30 用户：「我点西安未央区，这个区都没有景点，
        #   点了之后直接跳到咸阳的汉景帝陵去了」）：西安「汉景帝阳陵」的稿子写
        #   `dist="未央区"`、几何归区却在**高陵区** ⇒ 未央区徽标 **0**，
        #   按名字筛却筛得出 1 条 ⇒ 框住它 + 锚点是它自己 ⇒ 镜头飞走 20km。
        if 'node.poiCount === 0 ? []' not in focus_text:
            problems.append(
                f'{focus_rel} 点区时没有按 `poiCount` 短路 —— '
                '徽标写 0 个的区会被"按名字筛出来的一条"拉走（用户看到的是"跳到别的地方去了"）'
            )
        # ★★ 反过来：**不许**再引入一个"点区专属"的更高档。
        #   2026-09-29 之前这里钉的是 `DISTRICT_FOCUS_ZOOM = 14`（"气泡散开的拐点"），
        #   被用户报掉：「有些区可能就一个景点，放大后我都不知道景点在哪，
        #   **景点在当前展示的地图之外**」。根因是 `shrinkForMinZoom` **以框中心为锚**
        #   收缩，而 `minZoom` **只在"框装不下"时才生效** ⇒ 调高它调不出"更清楚"，
        #   只调出"更看不全"。实测（`_tmp/cdp_districtfocus_verify.mjs`：真鼠标点徽标
        #   + 墨卡托投影逐点判可见，成都 4 个区）：
        #     都江堰 4 个点 → 屏内只剩 1；青羊区 19 个 → 只剩 2；锦江区 11 个 → 4。
        if re.search(r'minZoom:\s*(?:DISTRICT_FOCUS_ZOOM|1[3-9]\b)', focus_text):
            problems.append(
                f'{focus_rel} 给点区单独钉了一个比揭示阈值更高的档 —— '
                '`minZoom` 只在"框装不下"时生效，钉得越高丢的景点越多'
                '（实测：钉 14 时都江堰 4 个点只剩 1 个在屏内、青羊区 19 个只剩 2 个）。'
                '"看得清"该靠**框得准**（框景点自己），不是靠把落点钉更高'
            )
        # ★★ 区名匹配必须宽容：直辖市的徽标名不带"区"（`东城` vs 点位的 `东城区`），
        #   裸 `===` 恒 false ⇒ `poisOf` 恒空 ⇒ 点区静默掉进"行政框"那一支
        #   （锚点是行政中心，不是景点）。4 个直辖市共 228 个点位全在这一格上。
        if 'export function sameDistrict' not in focus_text:
            problems.append(
                f'{focus_rel} 没有 `sameDistrict()` —— 区名比较必须剥掉行政后缀再比，'
                '否则直辖市的"东城区"对不上"东城"，点区会静默走到行政框那一支'
            )

    # ── ④ 三个页面的接线 ──
    hits += 1
    # 城市页：区图层自己处理点击，两处 fit（有边界 / 退化到区中心）都要带
    city_layer_rel = 'app/common/logic/useCityDistrictLayer.ts'
    city_layer = WEB / city_layer_rel
    if not city_layer.exists():
        problems.append(f'{city_layer_rel} 不存在')
    else:
        cl_text = strip_comments_keep_lines(city_layer.read_text(encoding='utf-8'))
        # ★★ 2026-09-29 起，城市页的 `onSelect` 也走 `focusPointsFor` ——
        #   它原来是**自己一份**（只框区的行政外框），与省级页/首页分叉：
        #   大区（都江堰跨 0.5°）被 `DISTRICT_FOCUS_ZOOM` 以**框中心**为锚收缩到 ~5km，
        #   而景点不在框中心 ⇒ 落点 z=14 却**一个点位都没有**（实测"点 0"）。
        #   现在三页同一条：**区里有景点就框那些景点**，没有才退回行政框。
        if 'focusPointsFor(' not in cl_text:
            problems.append(
                f'{city_layer_rel} 的 `onSelect` 没有走 `focusPointsFor` —— '
                '点区框哪一片会与省级页/首页分叉（只框行政框时，大区会把镜头落到一片空地上）'
            )
        if 'minZoom: t.minZoom' not in cl_text:
            problems.append(
                f'{city_layer_rel} 的 `onSelect` 没把 `t.minZoom` 交给 `shell.fit` —— '
                '算出来了不传等于没算（落点会退回 fit 自己的结果）'
            )
        # ★ 省级页 / 首页直接传 `node`（`DistrictGeoNode` 自带 `poiCount`），
        #   城市页这里是**手写对象** —— 漏了这个字段就不享受"徽标说几个就是几个"。
        if 'poiCount: node.poiCount' not in cl_text:
            problems.append(
                f'{city_layer_rel} 调 `focusPointsFor` 时没带 `poiCount` —— '
                '省级页/首页的 node 自带它，城市页是手写对象，漏了就不享受"徽标说几个就是几个"'
            )

    for rel in ('app/common/logic/useProvinceView.ts', 'app/common/logic/useHomeView.ts'):
        f = WEB / rel
        if not f.exists():
            problems.append(f'{rel} 不存在')
            continue
        text = strip_comments_keep_lines(f.read_text(encoding='utf-8'))
        if 'boxOf: async' not in text:
            problems.append(
                f'{rel} 的 `focusSources` 没有 `boxOf` —— 点区会掉到近似市域方块，镜头往外退'
            )
        if 'minZoom: t.minZoom' not in text:
            problems.append(
                f'{rel} 的 `onSelectDistrict` 没有把 `t.minZoom` 交给 `shell.fit` —— '
                '算出来了不传等于没算'
            )

    # ── ⑤ 三个页面筛"区里的景点"都走宽容比较（不许裸 `===`）──
    # ★ 这条守的是**静默失效**：`===` 在普通地级市上完全有效（"锦江区" === "锦江区"），
    #   只有直辖市会恒 false，而那时表现是"点了区，景点在屏幕外"——看不出是名字的问题。
    hits += 1
    for rel in (city_layer_rel, 'app/common/logic/useProvinceView.ts', 'app/common/logic/useHomeView.ts'):
        f = WEB / rel
        if not f.exists():
            problems.append(f'{rel} 不存在')
            continue
        text = strip_comments_keep_lines(f.read_text(encoding='utf-8'))
        if 'sameDistrict(' not in text:
            problems.append(
                f'{rel} 筛"这个区里面的景点"没走 `sameDistrict(` —— '
                '直辖市的"东城区"（点位）对不上"东城"（徽标），恒空 ⇒ 点区看不到景点'
            )
        if re.search(r'location\.district\s*===', text):
            problems.append(
                f'{rel} 里还有裸比较 `location.district ===` —— 必须换成 `sameDistrict(...)`'
            )

    # ── ⑥ 四个 `shell.fit(...)` 调用点都要把**锚点**传下去 ──
    # ★ 算出来了不传 = 没算：收缩仍以框的几何中心为锚（见 `FocusTarget.anchor`）。
    #   四个点：城市页区图层 / 省级页 / 首页 / 搜索命中地区。
    hits += 1
    for rel in (city_layer_rel, 'app/common/logic/useProvinceView.ts',
                'app/common/logic/useHomeView.ts', 'app/common/logic/useSearch.ts'):
        f = WEB / rel
        if not f.exists():
            problems.append(f'{rel} 不存在')
            continue
        text = strip_comments_keep_lines(f.read_text(encoding='utf-8'))
        if 'anchor: t.anchor' not in text:
            problems.append(
                f'{rel} 的 `shell.fit` 没把 `t.anchor` 传下去 —— '
                '`focusPointsFor` 算出来了不用，等于没算（收缩仍以框几何中心为锚）'
            )

    check(label, problems, 6, hits)



# ────────────────────────────────────────────────
# AF. 常驻浮层的「门」不持有状态（关掉再打开必须回到初始态）
# ────────────────────────────────────────────────
#
# 这三块浮层都挂在**外壳**上、常年存在（`routes/map-shell.tsx`），靠"没有 payload 就
# `return null`"来表现"关着"。而 `return null` **只是不渲染内容，组件实例还在** ——
# 它内部的 `useState` 会一直活着。第一版就是这样翻车的：
#
# > 用户原话：「我新建组后，再点添加行程出现的弹窗，弹窗内容没恢复到之前的状态，
# >   还是显示了个输入框，而是按钮」
#
# 这类 bug 的根源**不是忘了重置某个值**，而是把状态放在了一个"关掉也不消失"的组件里。
# 所以纪律是：**门只判断开不开（零状态），状态住在"内容"那一半**（它随开关真正挂载/卸载）。
# 补 `useEffect` 去重置是跟在 bug 后面跑 —— 以后再加一个局部状态就又要记得重置一次。
#
# 反证：把 `AddToPlanPicker` 的 `PickerBody` 拆掉、把 `useState` 移回门里 → 必须 FAIL。
#
# ★ 静态只能挡"结构又长回去了"；**行为**那一半（关掉再打开真的回到初始态）
#   由 `_tmp/cdp_planflow_verify.mjs` 的 ⑧″ 段守 —— 动这三块浮层就要跑它。

GATE_FILES = (
    'app/common/ui/plan/AddToPlanPicker.tsx',
    'app/common/ui/plan/DuplicateConfirm.tsx',
    'app/common/ui/plan/SpotPicker.tsx',
    'app/desktop/ui/RoutePlanPanel.tsx',
    'app/mobile/ui/RoutePlanPanel.tsx',
)


def check_resident_gates() -> None:
    label = 'AF. 常驻浮层的「门」不持有状态（关掉再打开必须回到初始态）'
    problems: list[str] = []
    hits = 0

    for rel in GATE_FILES:
        hits += 1
        text = strip_comments_keep_lines((WEB / rel).read_text(encoding='utf-8'))
        m = re.search(r'^export function (\w+)\(', text, re.M)
        if not m:
            problems.append(f'{rel} 里找不到导出的门组件 —— 结构已改，本项检查需要同步')
            continue
        name = m.group(1)
        end = text.find('return null', m.start())
        if end == -1:
            problems.append(
                f'{rel} 的 `{name}` 里没有 `return null` —— 门应当在"关着"时返回 null'
            )
            continue
        seg = text[m.start():end]
        bad = [t for t in ('useState(', 'useRef(', 'useEffect(') if t in seg]
        if bad:
            problems.append(
                f'{rel}: 门组件 `{name}` 里出现了 {"、".join(bad)} —— '
                '它挂在外壳上常年存在，`return null` 只是不渲染、**状态还在**，'
                '于是"上次留在草稿/展开态"会被带到下一次打开。'
                '把状态挪到内部那个"内容"组件（它随开关真正挂载/卸载）'
            )
        # 有状态 ⇒ 必须拆成"门 + 内容"两个组件
        if 'useState(' in text and not re.search(r'^function \w+\(', text, re.M):
            problems.append(
                f'{rel} 里有 `useState` 却只有一个组件 —— '
                '应当是「门（零状态）+ 内容（每次打开都是新实例）」两个'
            )

    check(label, problems, 4, hits)


# ────────────────────────────────────────────────
# AG. 直辖市的市/区分级（「市」判据 ∪ 自身即市的省）
# ────────────────────────────────────────────────
#
# 2026-09-26 用户报的原文：「直辖市的地图标注不对，该显示市标的时候显示了区标，
# 该显示区标的时候却什么都不显示了」。两件事其实是**同一个判据错**，且全程静默：
#
# | 错在哪 | 现象 |
# |--------|------|
# | 把省节点的 `children` 一律当"市" | 市级那一档铺一屏「东城 —」「西城 —」…（它们 `cityId` 是 null ⇒ 全显示"待收录"），真正的市标（北京 57）一枚没有 |
# | 区级按"市的 adcode"去懒加载分片 | 那些"被当成市的区" `cityId` 是 null ⇒ 一个都拉不到 ⇒ 区这一级**什么都不出** |
#
# 错的根子在于**没有"哪些节点是市"的唯一判据**。判据现在是树上的 `isCity`
# （`build.py` 按 adcode 段写入，**与收录状态无关**）—— 千万别改成用 `cityId` 反推：
# 那样未收录的直辖市（天津）会被判成普通省，它的 16 个区照样被当市。
#
#   ① 双生契约两侧都要有 `isCity`（缺一侧 = TS 的 `safeParse` 拿到 undefined）
#   ② `build.py` 必须**用它自己写的**（写入 + 派生 children 的 level），不能只注释里提一句
#   ③ 数据：每个 `isCity` 的省，children 非空且**全是 `district`**（混进 `city` 就说明判据漏了）
#   ④ 前端 `regions.ts`：**既许 `p.isCity` 分支，也不许用 `cityId` 反推**
#   ⑤ `loadProvinceDetail` 也要认（`isCity` 时本体返回自己，否则省级页只有一屏区）
#   ⑥ 每个 `isCity` 的省都得有它自己那份区分片（`subdistricts/<市adcode>.json` —— 这里 adcode 就是省码）
#
# 反证：见 `_tmp/falsify_ag.py`（6 个变异，逐个必须 FAIL）。


def check_flat_city_levels() -> None:
    label = 'AG. 直辖市的市/区分级（isCity 判据 · 契约两侧齐 · 区不当市 · 本体进清单）'
    problems: list[str] = []
    hits = 0

    gen = REPO / 'data' / '_generated'

    # ── ① 双生契约：`schema.py` 与 `schema.ts` 都要有 `isCity` ──
    hits += 1
    for rel, pat in (
        ('schema/schema.py', r'isCity\s*:\s*bool\s*='),
        ('schema/schema.ts', r'isCity\s*:\s*z\.boolean\(\)'),
    ):
        f = REPO / rel
        if not f.exists():
            problems.append(f'{rel} 不存在')
            continue
        if not re.search(pat, f.read_text(encoding='utf-8')):
            problems.append(
                f'{rel} 里没有 `isCity` 字段 —— 双生契约只写一侧，'
                'TS 侧 `safeParse` 会把它吞成 undefined，前端的判据静默退化成 false'
            )

    # ── ② 生产侧：build 必须真的写 `isCity`，并用它派生 children 的 level ──
    hits += 1
    build = pmod('build')
    if not build.exists():
        problems.append('pipeline/build.py 不存在')
    else:
        text = strip_comments_keep_lines(build.read_text(encoding='utf-8'))
        m = re.search(r'prov\["isCity"\]\s*=\s*([A-Za-z_][\w.]*\()', text)
        if not m:
            problems.append(
                'build.py 没有给省节点赋 `prov["isCity"]` —— 判据必须写进树里，'
                '让前端只读不猜（前端按名字或按 cityId 猜都会错，见本项文件头）'
            )
        elif not re.search(r'is_flat_province', m.group(1)):
            problems.append(
                f'build.py 的 `prov["isCity"]` 来自 `{m.group(1)}` 而不是 `is_flat_province(` —— '
                'adcode 段判定必须只有一处实现'
            )
        if 'if prov["isCity"]' not in text and 'if prov.get("isCity")' not in text:
            problems.append(
                'build.py 写了 `isCity` 却没用它 —— 少了这一段，直辖市自身这座城市不会被算进收录，'
                '它的区就会被当成市'
            )
        if '"district" if prov["isCity"] else "city"' not in text:
            problems.append(
                'build.py 没有按 `prov["isCity"]` 派生 children 的 level —— '
                '直辖市的下级必须是 `district`（它没有中间的市层）'
            )

    # ── ③ 数据侧：每个 isCity 的省，children 非空且全是 district ──
    hits += 1
    tree_path = gen / 'district-tree.json'
    if not tree_path.exists():
        problems.append('data/_generated/district-tree.json 不存在 —— 先跑 `python pipeline/build.py`')
    else:
        tree = json.loads(tree_path.read_text(encoding='utf-8'))
        flatcities = [p for p in tree.get('provinces') or [] if p.get('isCity')]
        if not flatcities:
            problems.append(
                '区划树里没有 `isCity: true` 的省 —— 直辖市一个都没标出来，'
                '它们的区会被当成市（正是本项要拦的那个 bug）'
            )
        for p in flatcities:
            ad = str(p.get('adcode'))
            kids = p.get('children') or []
            if not kids:
                problems.append(f'{ad} {p.get("name")} 标了 isCity 却没有 children —— 它下辖的区丢了')
                continue
            wrong = [k.get('name') for k in kids if k.get('level') != 'district']
            if wrong:
                problems.append(
                    f'{ad} {p.get("name")} 的下级里有 level 不是 `district` 的：{wrong[:4]} —— '
                    '直辖市没有中间的市层，把它的下级标成 `city` 会让"区"跑到市级那一档去'
                )
            # 分片按**市的 adcode**取 —— 直辖市这个 adcode 就是省码（110000 / 810000…）
            if not (gen / 'subdistricts' / f'{ad}.json').exists():
                problems.append(
                    f'{ad} {p.get("name")} 没有 `subdistricts/{ad}.json` —— '
                    '区分片按市的 adcode 取，而直辖市的"市 adcode"就是它自己的省码；'
                    '缺了它区这一级什么都铺不出来'
                )

    # ── ④ 前端：要么用 `isCity` 分支，要么用 cityId 反推（后者要拦） ──
    hits += 1
    regions_rel = 'app/common/data/regions.ts'
    regions = WEB / regions_rel
    if not regions.exists():
        problems.append(f'{regions_rel} 不存在 —— 市/省行数据的唯一出处丢了')
    else:
        text = strip_comments_keep_lines(regions.read_text(encoding='utf-8'))
        if 'p.isCity' not in text:
            problems.append(
                f'{regions_rel} 的 `loadAllCityRows` 没有读 `p.isCity` —— '
                '少了这一句，直辖市的下级（它的区）会被当成市，市标那一档铺一屏"待收录"'
            )
        # ⑤ 省级页的行数据同理
        if 'const isCity' not in text:
            problems.append(
                f'{regions_rel} 的 `loadProvinceDetail` 没有按 `isCity` 分支 —— '
                '省级页会拿它的区充当下级市，childCount 也会写成 16 而不是 1'
            )
        # ★ 用 cityId 反推是本项要堵的那条错路：未收录的直辖市会被判成普通省
        body = text[text.find('export async function loadAllCityRows'):]
        body = body[: body.find('\nexport')] if '\nexport' in body else body
        if re.search(r'isCity\b[^\n]*\bcityId\b|cityId[^\n]*\bisCity\b', body):
            problems.append(
                f'{regions_rel} 把 `isCity` 写成依赖 `cityId` 的表达式 —— '
                '收录状态不能反过来决定区划形状：未收录的直辖市会被判成普通省'
            )

    check(label, problems, 4, hits)


def check_doc_pages() -> None:
    label = 'AH. 「关于」= 顶栏一枚按钮 + 弹窗（不跳页 · 内容一份 · 旧两页已删）'
    problems: list[str] = []
    hits = 0

    # ── ① 顶栏那枚必须是**按钮 + 打开弹窗**，不许是跳转链接 ──
    #
    # 这一段改过两轮，进度记在这里免得翻回去：
    #   1. 最早是 `disabled` + 「待开发」的占位（原型上就有，见 `TodoTag` 文件头）；
    #   2. 2026-09-29 上午做成两个**独立页面**（`/about` / `/credits`）+ 两枚 `<Link>`；
    #   3. 同日下午用户：「这两个感觉内容偏重复，整合一下，**不要跳页面**，也是用弹窗的形式」
    #      ⇒ 合成一枚按钮 + 一块弹窗（`AboutModal`），两个路由页与预渲染项一并删除。
    #
    # ⇒ 判据：TopBar 里**不许再出现文档页链接**，且那枚按钮必须真的调 `openAbout()`。
    #   （"按钮在、但没接动作"= 点下去什么都没发生 —— 这类空操作本仓库踩过。）
    hits += 1
    topbar_rel = 'app/common/ui/TopBar.tsx'
    topbar_f = WEB / topbar_rel
    if not topbar_f.exists():
        problems.append(f'{topbar_rel} 不存在')
    else:
        text = strip_comments_keep_lines(topbar_f.read_text(encoding='utf-8'))
        if re.search(r"""<Link|to=["']/(about|credits)["']""", text):
            problems.append(
                f'{topbar_rel} 里又出现了指向文档页的链接 —— '
                '「关于」应该是**按钮 + 弹窗**（用户：不要跳页面），不是 `<Link>`'
            )
        if 'onClick={openAbout}' not in text or 'useDocUi' not in text:
            problems.append(
                f'{topbar_rel} 的那枚「关于」没有接 `docUi` / 没调 `openAbout()` —— '
                '点了不会有任何反应（或又退回跳页）'
            )

    # ── ② 两个旧文档页必须**彻底删掉**（文件 + 路由 + 预渲染）──
    #
    # 留着它们的后果不是"多两页"，而是**同一份内容两处渲染**：
    # 弹窗改了、页面还是旧的 —— 用户下次点开那个深链就会发现两套说法。
    hits += 1
    for rel in ('app/routes/about.tsx', 'app/routes/credits.tsx'):
        if (WEB / rel).exists():
            problems.append(
                f'{rel} 又出现了 —— 内容已并进弹窗（`common/ui/doc/AboutContent`），'
                '独立页面留着就是"同一份内容两处渲染"'
            )
    routes_f = WEB / 'app/routes.ts'
    if routes_f.exists():
        text = strip_comments_keep_lines(routes_f.read_text(encoding='utf-8'))
        for p in ('about', 'credits'):
            if f"route('{p}'" in text:
                problems.append(f'app/routes.ts 里又注册了 `{p}` 路由 —— 它已经不是页面了')
    cfg_f = REPO / 'web' / 'react-router.config.ts'
    if cfg_f.exists():
        text = strip_comments_keep_lines(cfg_f.read_text(encoding='utf-8'))
        m = re.search(r'const routes = \[([^\]]*)\]', text)
        if m and re.search(r"'/(about|credits)'", m.group(1)):
            problems.append(
                'react-router.config.ts 的预渲染列表里又出现了 `/about` 或 `/credits` —— '
                '那两个路由已经删了，列在这里只会产出空页或构建报错'
            )

    # ── ③ 内容只有一份：弹窗必须用它，旧版式不许残留 ──
    hits += 1
    doc_dir = WEB / 'app/common/ui/doc'
    content_f = doc_dir / 'AboutContent.tsx'
    modal_f = doc_dir / 'AboutModal.tsx'
    if not content_f.exists():
        problems.append('app/common/ui/doc/AboutContent.tsx 不存在 —— 内容没有唯一出处')
    elif 'export function AboutContent(' not in content_f.read_text(encoding='utf-8'):
        problems.append('AboutContent.tsx 里没有 `export function AboutContent(`')
    if not modal_f.exists():
        problems.append('app/common/ui/doc/AboutModal.tsx 不存在')
    elif '~/common/ui/doc/AboutContent' not in modal_f.read_text(encoding='utf-8'):
        problems.append('AboutModal 没有使用唯一那份内容组件（`AboutContent`）—— 又会分叉')
    if (doc_dir / 'DocPage.tsx').exists():
        problems.append(
            'doc/DocPage.tsx 还在 —— 那是"独立页面"时代的版式，页面删了它就是死代码'
        )

    # ── ④ 弹窗必须关得掉（Esc / 点卡片外面）──
    #
    # 模态最典型的"打不开也关不掉"就是忘了接 `useDismiss`。而这块浮层**盖住整屏**，
    # 关不掉等于把站点锁死（比一块关不掉的小面板严重得多）。
    hits += 1
    if modal_f.exists():
        text = strip_comments_keep_lines(modal_f.read_text(encoding='utf-8'))
        if 'useDismiss<HTMLDivElement>(true, closeAbout)' not in text:
            problems.append(
                'AboutModal 没有接 `useDismiss(true, closeAbout)` —— '
                'Esc 与"点卡片外面"都关不掉；一块盖住整屏的浮层关不掉 = 把站点锁死'
            )

    check(label, problems, 4, hits)


def check_fullscreen() -> None:
    label = 'AI. 全屏（唯一调用点 · 目标是整个文档 · 真按钮 · 占位时代已收尾）'
    problems: list[str] = []
    hits = 0

    FS_SRC = 'app/common/logic/useFullscreen.ts'
    fs_rel = FS_SRC
    fs_f = WEB / FS_SRC

    # ── ① 全屏 API 的调用点**只剩一处** ──
    #
    # 这个 API 有个坑：`requestFullscreen` 的**接收者**决定谁能进全屏。
    #   · `document.documentElement`（**正确的**那个）→ 顶栏 / 清单 / 详情 / 规划面板全部跟进去；
    #   · `.map-layer`（直觉上最像"我要地图全屏"）→ 浮层都在这一层**之外**，
    #     进去之后屏幕上只剩一张裸地图：**没有搜索、没有底图下拉、也没有回首页的出口**。
    # 本站 UI 全是盖在地图上的浮层，两者必须同进同出 —— 所以调用写在一处，
    # UI 层只拿到 `{ supported, active, toggle }`。
    hits += 1
    callers: list[str] = []
    for f in sorted(iter_app_files()):
        text = strip_comments_keep_lines(f.read_text(encoding='utf-8'))
        rel = f.relative_to(WEB).as_posix()
        if re.search(r'\b(?:webkit)?(?:requestFullscreen|exitFullscreen)\b', text):
            callers.append(rel)
    if not callers:
        problems.append(
            f'全站没有调用 Fullscreen API —— {FS_SRC} 被删了？'
            '（顶栏那枚按钮会变成"点了没反应"）'
        )
    elif set(callers) != {fs_rel}:
        extra = [c for c in callers if c != fs_rel]
        problems.append(
            f'Fullscreen API 的调用点不止一处（还出现在 {", ".join(extra)}）—— '
            f'唯一出处必须是 {FS_SRC}：换个目标元素进去就是一张没有 UI 的裸地图'
        )

    # ── ② 目标是**整个文档**，不是某一层 ──
    #
    # ⚠️ 不能只看"文件里有没有 `documentElement`" —— 这个文件里它会出现两次
    #    （能力探测一次、真正请求一次），改坏其中一处、另一处还在，检查照样是绿的。
    #   这正是反证要抓的那种"永远通过"的护栏，所以判据收在** `toggle` 那一段**：
    #   那一段必须有 documentElement，且不许出现任何别的候选元素。
    hits += 1
    if fs_f.exists():
        body = strip_comments_keep_lines(fs_f.read_text(encoding='utf-8'))
        i = body.find('const toggle')
        toggle_body = body[i:] if i >= 0 else ''
        if 'documentElement' not in toggle_body:
            problems.append(
                f'{fs_rel} 的 `toggle` 里找不到 `document.documentElement` —— '
                '全屏必须作用于整个文档（UI 是盖在地图上的浮层，不是在地图里）。'
                '换成 `.map-layer` / `body` → 进去之后整屏没有 UI、也没有出口'
            )
        for bad in ('.body', 'getElementById', 'querySelector', 'containerRef'):
            if bad in toggle_body:
                problems.append(
                    f'{fs_rel} 的 `toggle` 里出现了 `{bad}` —— 全屏的目标只能是'
                    ' `document.documentElement`；对准地图层会让浮层（顶栏 / 清单 / 详情）'
                    '全部留在全屏之外'
                )
    else:
        problems.append(f'{fs_rel} 不存在 —— 全屏没有唯一出处')

    # ── ③ 顶栏那枚必须**接了动作**、可盛、
    #      且用 `aria-pressed` 表达两态（图标会换，读屏看不到图标）──
    hits += 1
    topbar_f = WEB / 'app/common/ui/TopBar.tsx'
    if not topbar_f.exists():
        problems.append('app/common/ui/TopBar.tsx 不存在')
    else:
        tb = strip_comments_keep_lines(topbar_f.read_text(encoding='utf-8'))
        if '<FullscreenButton' not in tb:
            problems.append(
                'app/common/ui/TopBar.tsx 已经不再渲染 `<FullscreenButton` —— '
                '这个功能等于没做（又退回"有 UI 没有动作"）'
            )
        for need in ('onClick={toggle}', 'useFullscreen(', 'aria-pressed={active}'):
            if need not in tb:
                problems.append(f'app/common/ui/TopBar.tsx 缺少 `{need}`')
        # ★ 判据落在**组件本体**上（`<button …>`那一段），不是落在调用处 ——
        #   调用处只有一句 `<FullscreenButton />`，那么短的一句里怎么查都查不出东西。
        i = tb.find('function FullscreenButton()')
        end = tb.find('\n}', i) if i >= 0 else -1
        block = tb[i:end] if i >= 0 and end != -1 else ''
        if i < 0:
            problems.append('app/common/ui/TopBar.tsx 里没有 `FullscreenButton` 这个组件')
        else:
            for need, why in (
                ('onClick={toggle}', '那枚按钮没有接 `toggle`（点了没反应，本仓库踩过）'),
                ('aria-pressed={active}', '两态共用一枚按钮却不写 `aria-pressed`，读屏永远念旧的那句'),
                ('useFullscreen(', '没有从 `common/logic/useFullscreen` 取状态 —— 又会分叉出第二份实现'),
            ):
                if need not in block:
                    problems.append(f'TopBar 的 `FullscreenButton` 缺少 `{need}` —— {why}')
            # ★ 反过来：「disabled 的占位」不许回来。它与"环境不支持"是两件事
            #   （详情写在 TopBar 里 `FullscreenButton` 那段注释）——
            #   不支持就**不渲染**，不要留一枚永远按不动的按钮骗人。
            if re.search(r'\bdisabled\b', block):
                problems.append(
                    'TopBar 的 `FullscreenButton` 又变成 `disabled` 了 —— '
                    '不支持的环境应当**整枚不渲染**（`if (!supported) return null`），'
                    '不是摆一枚按不动的占位'
                )

    # ── ④ SSR 安全：必须 `useSyncExternalStore`，不能在渲染期读 `document` ──
    #
    # 本站是 SSG —— 预渲染时没有 `document`。写成
    # `useState(() => document.fullscreenElement !== null)` 要么直接崩掉预渲染，
    # 要么制造 hydration mismatch（`useViewport` 文件头记过那条连带报错的代价）。
    hits += 1
    if fs_f.exists():
        body = strip_comments_keep_lines(fs_f.read_text(encoding='utf-8'))
        # ⚠️ 只看"文件里出没出现 `useSyncExternalStore`"是不够的：它在 import 与调用处各有一次，
        #    反证时把调用改成 `useState` 之后，import 那一次还在 ⇒ 检查仍然全绿。
        #    所以判据是"**真的发生了两处调用**"，且文件里**不许有** `useState`。
        calls = re.findall(r'useSyncExternalStore\([^\n]*serverSnapshot\)', body)
        if len(calls) < 2:
            problems.append(
                f'{fs_rel} 里 `useSyncExternalStore(subscribe, get, getServer)` 只有 {len(calls)} 处'
                '（应有 2 处：`supported` 与 `active`）—— '
                '预渲染阶段没有 `document`，绕开它会让整份 SSG 挂掉或水合不匹配'
            )
        if re.search(r'\buseState\b', body):
            problems.append(
                f'{fs_rel} 里出现了 `useState` —— 这个钩子没有局部状态可言'
                '（两帧快照都来自外部对象）；用它读 `document` 初值会打出 hydration mismatch'
            )
        if re.search(r'\buseState\w*\(\s*\(\s*\)\s*=>\s*document\b', body):
            problems.append(
                f'{fs_rel} 用 `useState(() => document.…)` 取初值 —— '
                '服务端没有 `document`；必须走 `useSyncExternalStore` + `getServerSnapshot`'
            )

    # ── ⑤ 占位时代收尾：`TodoTag` 连组件一起删干净 ──
    #
    # 全屏是最后一枚占位（2026-09-29 做成真功能）。留着这个组件，
    # 将来又会被顺手挂到别的未实现控件上，于是"待开发"重新变成一种常态。
    # ✓ 将来真需要时去 git 历史里找它，别写第二份。
    hits += 1
    todo = WEB / 'app/common/ui/TodoTag.tsx'
    if todo.exists():
        problems.append(
            'app/common/ui/TodoTag.tsx 又回来了 —— 顶栏四枚占位（搜索 / 关于 / 数据来源 / 全屏）'
            '已经全部做成真功能，这枚「待开发」标记没有控件可贴了'
        )
    for f in sorted(iter_app_files()):
        text = strip_comments_keep_lines(f.read_text(encoding='utf-8'))
        if "common/ui/TodoTag" in text or '<TodoTag' in text:
            problems.append(
                f'{f.relative_to(WEB).as_posix()} 仍在引用 `TodoTag` —— 组件已随占位时代一并删除'
            )

    check(label, problems, 5, hits)


def check_poi_coords() -> None:
    label = 'AL. 坐标入库质量（存疑必须核完 · 坐标系必带 · 不许有空点）'
    problems: list[str] = []
    hits = 0

    # 2026-09-29 一次性清掉 56 条历史 `_geocodeSuspect` 之后立的护栏。
    # 这三条的共同点是**都不报错**：
    #   · 存疑标记留在库里 ⇒ 数据带着"我没核过"的标记上线，而页面上完全看不出来；
    #   · `coordSystem` 漏写 ⇒ 前端按缺省坐标系解，点位整体偏移几百米（手工修坐标时最容易漏）；
    #   · `point` 为空 ⇒ 该点位在地图上根本不出现，而"已收录 57"这个数字照旧显示 57。
    cities_root = REPO / 'data' / 'cities'

    suspects: list[str] = []
    no_system: list[str] = []
    empty_pt: list[str] = []
    total = 0
    if cities_root.is_dir():
        for f in sorted(cities_root.glob('*/*/pois/*/*.json')):
            try:
                poi = json.loads(f.read_text(encoding='utf-8'))
            except Exception:
                continue
            total += 1
            who = f'{f.parent.parent.parent.name}/{f.parent.parent.name}/{f.parent.name}/{f.stem}'
            if poi.get('_geocodeSuspect'):
                suspects.append(who)
            pt = ((poi.get('location') or {}).get('point')) or {}
            if not pt.get('lng') or not pt.get('lat'):
                empty_pt.append(who)
            elif str(pt.get('coordSystem') or '') != 'GCJ-02':
                no_system.append(who)
    hits += 1

    if total < 500:                       # 17 城 = 969 条；低得离谱说明 glob 路径写坏了
        problems.append(f'只扫到 {total} 条点位（17 城应为 969）—— 路径基准可能变了')

    hits += 1
    if suspects:
        problems.append(
            f'{len(suspects)} 条仍带 `_geocodeSuspect`：{suspects[:6]} —— '
            '存疑的意思是"接口命中的可能不是这个点"，必须逐条人工核：'
            '坐标对的就去掉标记，错的就改坐标（判据与流程见 skill `city-seed-pipeline` 的'
            '「历史 `_geocodeSuspect` 的批量清理」一节）。★ 直接删标记等于谎称已核实'
        )

    hits += 1
    if no_system:
        problems.append(
            f'{len(no_system)} 条的 `coordSystem` 不是 `GCJ-02`：{no_system[:6]} —— '
            '坐标系漏写不报错，但前端会按缺省值解，点位整体偏移'
        )

    hits += 1
    if empty_pt:
        problems.append(
            f'{len(empty_pt)} 条没有坐标：{empty_pt[:6]} —— '
            '它们在地图上不出现，而城市徽标里的条数照旧把它们算在内'
        )

    check(label, problems, 4, hits)


def check_session_state() -> None:
    # ★ 段落号取 **AJ**：另一个会话同时也加了一段（AI. 全屏）—— 两个 AI 会在报告里撞车
    label = 'AJ. 刷新保持（会话状态唯一出口 · 该存的都接了 · 视野恢复优先于入口取景）'
    problems: list[str] = []
    hits = 0

    # ── ① 唯一出口：全仓只有 `uiState.ts` 碰 sessionStorage ──
    #
    # 用户 2026-09-29：「我不管怎么弄，**打开什么东西，我只要刷新页面，就又回到了最开始
    #   打开时的样子**，这个页面保持的功能得完善一下」。
    #
    # 解法是 sessionStorage（刷新保留 / 关掉标签页清空 —— 正是用户描述的那两条），
    # 但它必须只有一个出口：散着写就会出现"某个角落自己存了一份、格式还不一样"，
    # 而且隐私模式下**裸用会抛**（iOS 无痕 / 微信 WebView），一处没包住就整页白屏。
    hits += 1
    ui_rel = 'app/common/data/uiState.ts'
    found: list[str] = []
    for f in sorted(WEB.rglob('*.ts*')):
        if 'node_modules' in f.parts:
            continue
        if 'sessionStorage' in strip_comments_keep_lines(f.read_text(encoding='utf-8')):
            found.append(f.relative_to(WEB).as_posix())
    if found != [ui_rel]:
        problems.append(
            f'sessionStorage 的唯一出口是 `{ui_rel}`，现在还有：{found}'
        )

    ui_f = WEB / ui_rel
    ui_src = ui_f.read_text(encoding='utf-8') if ui_f.exists() else ''
    if not ui_f.exists():
        problems.append(f'{ui_rel} 不存在 —— 会话状态没有出处')

    # ── ② 版本号 + 读失败一律退化（不抛）──
    hits += 1
    if 'const VERSION = ' not in ui_src or 'parsed.v !== VERSION' not in ui_src:
        problems.append(
            f'{ui_rel} 缺少版本校验（`v`）—— 改了结构之后，旧的会话值会被当成新格式读进去'
        )
    if 'catch' not in ui_src:
        problems.append(
            f'{ui_rel} 没有任何 `catch` —— 隐私模式下 sessionStorage 会直接抛，'
            '而它是在 store 初始化时读的，抛出去就是整页白屏'
        )

    # ── ③ 该存的都接了（每一处都对应一类"刷新就回到初始"的抱怨）──
    hits += 1
    wired = {
        'app/common/logic/itinerary/planUi.ts': ['readUiState', 'patchPlanUi'],
        'app/common/logic/itinerary/planStore.ts': ['readUiState', 'patchPlanUi'],
        'app/common/logic/useCityView.ts': ['useSessionPick', 'useSessionFilter'],
        'app/common/logic/useHomeView.ts': ['useSessionPick'],
        'app/common/logic/useProvinceView.ts': ['useSessionPick'],
    }
    for rel, needles in wired.items():
        f = WEB / rel
        if not f.exists():
            problems.append(f'{rel} 不存在')
            continue
        text = strip_comments_keep_lines(f.read_text(encoding='utf-8'))
        for n in needles:
            # ★ 判"**调用**"而不是"出现"：光留一行 import 也满足"出现"，
            #   而把调用换回 useState 正是本项要拦的那种回退（反证第一次就这么判错了）
            if not re.search(rf'\b{n}\s*\(', text):
                problems.append(
                    f'{rel} 里没有用 `{n}` —— 那一处的状态刷新就丢'
                    '（用户原话：打开什么东西，刷新就又回到了最开始的样子）'
                )

    # ── ④ **视野恢复优先于入口取景** ──
    #
    # 少了这一条，刷新后各页的入口取景会把镜头重新推回"全城/全图" ——
    # 恢复的视野当场被覆盖，用户看到的还是"回到最开始"。
    hits += 1
    fit_f = WEB / 'app/common/logic/useFitOnce.ts'
    if not fit_f.exists():
        problems.append('app/common/logic/useFitOnce.ts 不存在')
    elif not re.search(r'\brestoredViewFor\s*\(', strip_comments_keep_lines(fit_f.read_text(encoding='utf-8'))):
        problems.append(
            'useFitOnce 没有检查"这一页是否恢复了视野" —— '
            '刷新时入口取景会把刚恢复的镜头又推回全图'
        )

    # ── ⑤ **一次性的动作态不许进会话状态** ──
    #
    # 搜索命中的那一枚 / 挑景点浮层 / 加到哪个规划 / 重复确认 / toast / 刚落下的取点
    # 都是"某一次交互"的中间态：刷新把它们恢复了反而是怪（用户要的是"打开着的东西还在"，
    # 不是"半截动作还在半空中"）。
    hits += 1
    for bad in ('searchPick', 'spotPicker', 'addPicker', 'dupConfirm', 'toast', 'freshPoint'):
        if re.search(rf'^\s*{bad}\s*[:?]', ui_src, re.M):
            problems.append(
                f'{ui_rel} 里存了 `{bad}` —— 它是"某一次交互"的中间态，'
                '刷新清掉才对（存了会让用户看到一个半截动作）'
            )

    check(label, problems, 5, hits)


def _code_only(src: str) -> str:
    """剥掉 `#` 注释与三引号文档字符串 —— 只留下真正的代码。

    ★ 为什么需要它：`strip_comments` 只管 `#`，而管线脚本的文件头普遍有一大段
      docstring 解释"这个坑是怎么踩的"。那些说明文字里会出现 `tmap.geocode()`、
      `v5/place/text` 这类**正是判据要找的字面量** —— 不剥掉的话，判据会被
      自己的说明文字永久满足，变成一条永远报绿的死检查。
      反证 AM 时 M2/M3 就是因为这一点而假绿（详见 `_tmp/falsify_am.py`）。

    ⚠️ 只剥**模块/函数级**的三引号块，不处理行内字符串 —— 后者往往是判据
       真正要看的值（如 `PLACE_URL = "…/v5/place/text"`）。
    """
    src = strip_comments(src)
    return re.sub(r'"""[\s\S]*?"""', '""', src)


def _load_module(path: Path, name: str):
    """按文件路径加载一个 python 模块（**不**经过包导入，避免触发 `pipeline/__init__`）。

    ★ 为什么要这个：有些判据要查**运行时真值**（比如 `QUOTA_PERIOD` 这张表）。
      查源码文本会被两件事骗 —— 注释里的同名字符串（假绿）与不同的写法
      （字典推导 vs 逐行字面量，正则假红）。真值不受写法影响。

    加载失败时返回 None（判据应报"本条失效"，而不是悄悄跳过）。
    """
    try:
        # ① 先按**包名**导入（如 `pipeline.core.fetch`）—— 它内部有相对导入
        #    （`from .layout import ...`），按文件加载会因为没有父包而失败。
        rel = path.resolve().relative_to(REPO)
        dotted = '.'.join(rel.with_suffix('').parts)
        if (REPO / rel.parts[0] / '__init__.py').exists():
            if str(REPO) not in sys.path:
                sys.path.insert(0, str(REPO))
            # ★★ 必须 reload：`sys.modules` 会缓存第一次导入的模块。
            #    不 reload 的话，同一次进程里第二次调用读到的是**旧源码** ——
            #    反证脚本改完文件再跑，判据仍然报绿（假绿），护栏形同虚设。
            #    （反证 M6/M7 第一轮就是这样漏掉的。）
            return importlib.reload(importlib.import_module(dotted))
        # ② 独立脚本才走文件加载
        spec = importlib.util.spec_from_file_location(name, str(path))
        if spec is None or spec.loader is None:
            return None
        mod = importlib.util.module_from_spec(spec)
        sys.modules[name] = mod
        spec.loader.exec_module(mod)
        return mod
    except Exception:                                # noqa: BLE001 —— 判据本身不许崩
        return None


def check_geo_provider() -> None:
    label = ('AM. 取点图商可降级（唯一入口 · 腾讯配额尽能换高德 · 高德用 v5 · '
             '121 有信号 · 高德按月记账）')
    problems: list[str] = []
    hits = 0

    # 2026-10-01 立的护栏。它守的是**一件只在月底/批量扩城时才会发生的事**：
    # 腾讯日配额打满那一刻，`geocode()` 返回 `None` —— 与"这个地址真的没命中"
    # 一字不差。于是整座城剩下的 POI 会被一个个判成没命中、标 `needs_geocode`，
    # 而真实原因是额度没了（换一家图商立刻能取到）。
    #
    # ⇒ 一次配额耗尽 = 一座城当天报废，且**没有任何报错**。
    # 所以"能不能换源"必须能被静态检查按住 —— 下面每条都能被单独推翻
    # （反证见 `_tmp/falsify_geoprovider.py`，10 条全红才算真）。

    pipe = REPO / 'pipeline'
    gp = pmod('geoprovider')
    step3 = pmod('step3_geocode')
    amap_f = pmod('amap')
    tmap_f = pmod('tmap')

    # ── ① 唯一入口要有出处 ──
    hits += 1
    if not gp.exists():
        problems.append(
            'pipeline/providers/geoprovider.py 不存在 —— 取点没有统一入口，'
            '各家各调 `tmap.geocode()`，配额耗尽时谁也不会换源'
        )
    else:
        g = strip_comments(gp.read_text(encoding='utf-8'))
        for fn in ('def geocode(', 'def place_search('):
            if fn not in g:
                problems.append(
                    f'geoprovider.py 里没有 `{fn}` —— 两个入口必须齐：'
                    '少了 `place_search`，店铺类 POI（小店在地理编码里根本没有条目）'
                    '在换源后一律取不到'
                )

    # ── ② step3 不许绕过入口直连腾讯 ──
    # ★ 这是最容易"悄悄退化"的一条：改代码时为省事直接 `tmap.geocode()`，
    #   本地跑得好好的（配额没满），等到批量扩城那天全城报废。
    #
    # ★★ 判据必须**只看代码**：注释与文档字符串里讲"`tmap.geocode()` 返回 None"
    #    是常有的事，不剥掉的话，判据会因为这些说明文字永远为真（假绿）——
    #    那是比"没判据"更糟的情形。反证时 M2 就是靠剥不剥 docstring 才分出真假。
    hits += 1
    if step3.exists():
        s = _code_only(step3.read_text(encoding='utf-8'))
        for bad in ('tmap.geocode(', 'tmap.place_search('):
            if bad in s:
                problems.append(
                    f'step3_geocode.py 里出现了 `{bad}` —— 取点必须走 `geoprovider`；'
                    '直连腾讯的话，配额耗尽时整城 POI 会被逐个判成"没命中"而无声报废'
                )

    # ── ③ 高德搜索必须走 v5 ──
    # ★ v3 的 `pois[].adcode` 恒为 `None`（实测），而 step3 判"是不是落在目标城市"
    #   只认 adcode ⇒ 用 v3 的话每条候选都被判成异地同名，高德降级等于白接。
    # ★ 同样只认**赋值那一行**：文件头的表格里就写着 `v5/place/text`，
    #   光搜字符串会因为那行说明而永远通过。
    hits += 1
    if amap_f.exists():
        a = _code_only(amap_f.read_text(encoding='utf-8'))
        m = re.search(r'^PLACE_URL\s*=\s*["\']([^"\']+)', a, re.M)
        if not m:
            problems.append('amap.py 里找不到 `PLACE_URL` 的赋值 —— 搜索接口的出处没了')
        elif '/v5/' not in m.group(1):
            problems.append(
                f'amap.py 的 `PLACE_URL` 是 `{m.group(1)}`（应为 v5）—— '
                '高德关键字搜索必须用 v5：v3 的 `pois[].adcode` 恒为空，同城判据会全部失效'
            )
        if 'citylimit' not in a:
            problems.append(
                'amap.py 的搜索请求没带 `citylimit` —— 不锁城市会召回外省同名店'
            )

    # ── ④ 腾讯侧必须有「配额耗尽」的信号 ──
    # 121 是 HTTP 200 + body 里的错误码，调用方只看到 `None`；
    # 不留信号的话，路由层永远不知道"该换源了"。
    hits += 1
    if tmap_f.exists():
        t = strip_comments(tmap_f.read_text(encoding='utf-8'))
        if 'def quota_exhausted(' not in t:
            problems.append(
                'tmap.py 里没有 `quota_exhausted()` —— 腾讯 121（日配额尽）是静默的，'
                '不留这个信号，geoprovider 就无从判断该不该换高德'
            )

    # ── ⑤ 高德的 key 要在模板里，下一个人配环境时才知道要申请 ──
    # ★ 同样只认**赋值行**：注释里出现 `AMAP_WEB_KEY` 太常见了（说明文字会讲它），
    #   光搜字符串会因为注释而永远通过。
    hits += 1
    example = pipe / '.env.example'
    if not example.exists():
        problems.append('pipeline/.env.example 不存在 —— 环境变量没有清单')
    elif not re.search(r'^\s*(?:export\s+)?AMAP_WEB_KEY\s*=',
                       example.read_text(encoding='utf-8'), re.M):
        problems.append(
            'pipeline/.env.example 里没有成行的 `AMAP_WEB_KEY=` —— '
            '配环境的人不会知道还要申请高德 key，降级链路等于不存在'
        )

    # ── ⑥ 高德配额必须按**月**记账 ──
    # ★★ 2026-10-01 用户确认：高德按月重置（不是按日）。
    #    以前账本换日就整体清空，高德用掉的量每天"看起来回来了" ⇒
    #    `usage` 永远显示得很少，直到某天突然全部拒绝才发现这个月早超了。
    # ★★ 判据落在 `QUOTA_PERIOD` 上，而不是"文件里有没有 monthly 这个词" ——
    #    后者会被注释里的说明永久满足（假绿）。以后新增任何 `amap_*` 接口，
    #    忘了把它登记成 monthly，这条就会红。
    hits += 1
    fetch_f = pmod('fetch')
    if not fetch_f.exists():
        problems.append('pipeline/core/fetch.py 不存在 —— 用量记账没了，配额烧光也不会有人知道')
    else:
        # ★ 查**运行时真值**而不是源码文本：周期表用字典推导登记时，
        #   源码里根本没有 `"amap_place": "monthly"` 这行（正则会假红）；
        #   而真值不受写法影响，也不会被注释里的同名字符串骗（那才是真绿）。
        mod = _load_module(fetch_f, 'pipeline_fetch_probe')
        if mod is None:
            problems.append('pipeline/core/fetch.py 无法导入 —— 配额周期查不了，本条判据失效')
        else:
            period = getattr(mod, 'QUOTA_PERIOD', None)
            amap_q = getattr(mod, 'AMAP_MONTHLY_QUOTA', None) or {}
            if not isinstance(period, dict) or not period:
                problems.append(
                    'fetch.py 里没有可用的 `QUOTA_PERIOD` —— 没有周期表的话记账只能按日，'
                    '高德的月用量会被每天清零（用超了才发现）'
                )
            else:
                for api in amap_q:
                    if period.get(api) != 'monthly':
                        problems.append(
                            f'`QUOTA_PERIOD[{api!r}]` = {period.get(api)!r}，应为 "monthly" —— '
                            '高德是月配额，按日记账会让本月用量每天被抹掉一次'
                        )
                # ★★ 反向判据（2026-10-08 补）：**代码里在记的桶，表里必须登记**。
                #   只遍历 `amap_q` 的话，表里漏登记的桶永远查不到——
                #   而漏登记的后果正是 `_bucket_of()` 静默退回 "daily"，
                #   高德月用量被记进日桶、跨零点归零（真实踩过：amap_entrance）。
                #   判据：从 amap.py 的源码里找出所有 count_usage("amap_*") 的桶名，
                #   与 `amap_q` 求差集。差集非空 ⇒ 有桶没登记。
                amap_f = pmod('amap')
                if amap_f.exists():
                    amap_src = amap_f.read_text(encoding='utf-8')
                    used_buckets = set(re.findall(r'count_usage\(\s*[\'"](amap_\w+)[\'"]', amap_src))
                    undeclared = sorted(used_buckets - set(amap_q))
                    if undeclared:
                        problems.append(
                            f'amap.py 里有 {len(undeclared)} 个记账桶没登记进 '
                            f'`AMAP_MONTHLY_QUOTA`：{", ".join(undeclared)} —— '
                            '**漏登记 ⇒ `_bucket_of()` 静默退回 "daily"，高德月用量被记进日桶、'
                            '跨零点归零**（真实事故：amap_entrance 漏了很久，'
                            'usage 里根本不显示、跨月也没人发现）'
                        )
            # 逐个桶重置：换日只清日桶，月桶要留着。
            # ★ 判据只看"有没有整体重建"这一个坏模式，**不要加前置条件** ——
            #   加了的后果是：只要源码里还留着一行看着像正确写法的代码，
            #   整条判据就被短路（反证 M7 第一轮就是这么漏掉的）。
            src = inspect.getsource(mod.count_usage)
            if re.search(r'ledger\s*=\s*\{\s*["\']date["\']', src):
                problems.append(
                    '`count_usage()` 还在整体重建账本（`ledger = {"date": ...}`）—— '
                    '换日会把高德的月账一起清掉，本月用量被抹掉一次'
                )

    # ── ⑦ 判死必须按接口，不能按图商整体 ──
    # ★★ 2026-10-01 实测修正：腾讯 `place_search` 与 `geocoder` 是**两个独立额度桶**
    #    （place_search 实测只有 200/日，geocoder 有 10000/日）。一个全局 bool 会把
    #    **整家腾讯**判死 ⇒ 连"还剩九千次、一分钱不花"的地址解析也被发配给高德；
    #    而**高德按月重置**（用掉一点就少一点，要等下个月才回来）。
    # ⇒ 查运行时真值：quota_exhausted 必须支持按接口判（签名带 api），
    #    且 geoprovider 两个入口各自只问自己那一路，互不连坐。
    hits += 1
    tmap_mod = _load_module(tmap_f, 'pipeline_tmap_probe')
    gp_mod = _load_module(gp, 'pipeline_gp_probe')
    if tmap_mod is None:
        problems.append('tmap.py 无法导入 —— 配额判死粒度查不了，本条失效')
    else:
        try:
            params = inspect.signature(tmap_mod.quota_exhausted).parameters
            if 'api' not in params:
                problems.append(
                    'tmap.quota_exhausted() 不接受 `api` 参数 —— 判死仍是"整家腾讯"粒度，'
                    'place_search 满会把还剩九千次的地址解析也发配给高德'
                )
        except (ValueError, TypeError):
            problems.append('tmap.quota_exhausted() 签名读不出 —— 配额判死粒度查不了')
    if gp_mod is None:
        problems.append('geoprovider.py 无法导入 —— 路由粒度查不了，本条失效')
    else:
        if 'quota_exhausted("geocoder")' not in inspect.getsource(gp_mod.geocode):
            problems.append(
                'geoprovider.geocode 没有按 `geocoder` 接口判死 —— '
                '地址解析会跟着别的接口一起被换源'
            )
        if 'quota_exhausted("place_search")' not in inspect.getsource(gp_mod.place_search):
            problems.append(
                'geoprovider.place_search 没有按 `place_search` 接口判死 —— '
                '地点搜索满了会误伤整家腾讯（白烧高德月额度）'
            )

    check(label, problems, 5, hits)


def check_vendor_risk() -> None:
    """AS. 图商风控（UA 不许自曝采集身份 · 拦截页必须被识别成"被封"）"""
    label = ('AS. 图商风控（UA 不许自曝采集身份 · 被封接口要被认出来 · 记账在请求前）')
    problems: list[str] = []
    hits = 0

    # ★★ 这条护栏来自一次真实事故：2026-10-16 高德以「流量异常、涉嫌违反服务协议
    #   4.12.3——禁止爬虫/网络蜘蛛/抓取工具」为由，**封禁了 `v3/place/text` 接口**
    #   （返回 HTTP 200 + 阿里 `punish` HTML 页，不是 JSON）。诱因之一就是 UA 里
    #   自曝了 `TravelStrategy-Harvest/1.0` —— 协议禁的正是"抓取工具"，
    #   而 UA 明写采集器标识等于**把判据递给风控**。
    #   两个坏后果各有各的隐蔽：① UA 那行看着无害，加回去没人发现；
    #   ② 拦截页是 HTML，`get_json` 抛 `JSONDecodeError`，**绕过了按 infocode 的
    #   判死逻辑** ⇒ 接口永远不被标记不可用 ⇒ 每次重跑继续打，越打越像爬虫。

    # ── ① UA 里不许出现自曝采集身份的字样 ──
    fetch_f = pmod('fetch')
    if not fetch_f.exists():
        problems.append('pipeline/core/fetch.py 不存在 —— UA 与拦截页判据都查不了')
    else:
        hits += 1
        src = fetch_f.read_text(encoding='utf-8')
        #★★ 必须用**括号配对**截取，不能用 `UA\s*=\s*\((.*?)\)`：
        #   UA 字面量里自带右括号（`... Chrome/126.0.0.0)`），非贪婪匹配会在
        #   **第一个** `)` 处截断，只抓到 `"Mozilla/5.0 (Windows NT 10.0; Win64; x64"` ——
        #   采集标识全在截断点之后，判据于是永远抓不到（反证实测：把
        #   `TravelStrategy-Harvest/1.0` 加回去，护栏仍然 ALL_CLEAN）。
        # ⇒ 从 `UA = (` 起手，一路**数括号**直到配平，才算整个赋值块。
        ua_blob = _balanced_paren_block(src, 'UA')
        if not ua_blob:
            problems.append(
                'fetch.py 里读不出 `UA = (...)` 的赋值 —— UA 是本条判据的锚点，出处没了'
            )
        else:
            # 采集器/自动化身份标识。判定用「词边界 + 忽略大小写」，
            # 避免 `robot` 之类误伤正常 UA（浏览器 UA 里没有这些词）。
            banned = re.findall(
                r'\b(?:harvest|harvester|crawler|crawling|spider|scraper|scraping'
                r'|bot|spiderbot|python-requests|scrapy)\b',
                ua_blob, re.I)
            if banned:
                problems.append(
                    f'UA 里出现了自曝采集身份的字样：{", ".join(sorted(set(banned)))} —— '
                    '**协议 4.12.3 禁的正是"爬虫/抓取工具"，UA 明写采集器标识等于把判据'
                    '递给风控**。真实事故：2026-10-16 高德据此封禁了 `v3/place/text`。'
                    '⇒ UA 就是一个普通浏览器，靠"低频 + 串行 + 带 Referer"合规，不靠伪装'
                )

        # ── ② 风控拦截页必须被识别成一种独立结局 ──
        # ★ 判据方向：异常类定义在 `get_json()` **之后**（异常一般后置），
        #   所以要看的是「定义之后还有没有 `raise BlockedByVendor`」，
        #   不是定义之前 —— 之前那段是 `get_bytes`，压根不该引用它。
        if 'class BlockedByVendor' not in src:
            problems.append(
                'fetch.py 里没有 `BlockedByVendor` —— 被封接口返回的是 **HTTP 200 + HTML**，'
                '没有它就会被当成 `JSONDecodeError`（"格式坏了"），'
                '**完全绕过按 infocode 的判死逻辑** ⇒ 接口永不被标记不可用，'
                '每次重跑继续打被封接口，越打越像爬虫'
            )
        elif 'raise BlockedByVendor' not in src.split('class BlockedByVendor', 1)[1]:
            problems.append(
                '`BlockedByVendor` 定义了但**没有任何地方 `raise` 它** —— '
                '拦截页识别没接上（定义等于没写）'
            )
        elif not re.search(r'x5secdata', src):
            problems.append(
                '`get_json()` 的拦截页判据里没有 `x5secdata` —— '
                '阿里风控页的稳定特征是 `x5secdata` cookie 清零，'
                '换判据要连响应特征一起换（实测被封时返回 HTTP 200，不看状态码）'
            )
        else:
            hits += 1

    # ── ③ 记账必须在发请求**之前**（失败/被拒同样计费）──
    #★ 记在后面 ⇒ 失败请求不记账，`usage` 显示 94 次而实际打了 3547 次，
    #   看用量做决策的人会被误导（真实失真案例：2026-10-16 封禁复盘）。
    amap_f = pmod('amap')
    if amap_f.exists():
        hits += 1
        asrc = amap_f.read_text(encoding='utf-8')
        fn = re.search(r'def poi_entrance\(.*?(?=\ndef |\Z)', asrc, re.S)
        if fn and 'BlockedByVendor' not in fn.group(0):
            problems.append(
                '`amap.poi_entrance()` 没有捕获 `BlockedByVendor` —— '
                '接口被封时异常会一路冒到脚本顶层，**在第一个 POI 就崩**，'
                '连"已落盘多少"的小结都打不出来'
            )
        elif fn:
            body = fn.group(0)
            cu = body.find('count_usage(')
            gj = body.find('get_json(')
            if cu == -1 or gj == -1:
                problems.append('`poi_entrance()` 里读不到 `count_usage` / `get_json` 的调用位置')
            elif cu > gj:
                problems.append(
                    '`poi_entrance()` 把 `count_usage()` 写在 `get_json()` **之后** —— '
                    '被封/失败的请求同样计费，记在后面等于**失败请求不记账** ⇒ '
                    '`usage` 显示的数字是失真的（2026-10-16 实测：账本 94 次 vs 实际 3547 次）'
                )

    check(label, problems, 3, hits)


def check_reveal_deep() -> None:
    label = 'AK. 「放大到深处」不许把上层徽标留在屏上（点位不回流 · pending 只挡点位 · 点位分批读）'
    problems: list[str] = []
    hits = 0

    # 用户 2026-09-29：「我点那个区，放大到区级了，**我再怎么放大这个标签都不会消失**，
    #   一直显示」+「地图的渲染怎么变得好慢」。
    #
    # 实机量出来的根因是**两处**，都在这条链上：
    #   · `decideReveal` 在 `poi` 这一级**也会回流**：站在 z=16（街道尺度）上，
    #     视野里没有点位就退回市级 ⇒ 屏幕上冒出「成都 57」这枚市徽标。它钉在市中心，
    #     离用户看的地方几十公里，却一直不走（放大越深越容易没有点位 ⇒ 越一直不走）。
    #     代价还是双份的：回流要走 `setNodes()`，重建多边形几何 + 重算避让 ——
    #     放大过程中反复回流 = 反复重建，那就是"变慢"。
    #   · `useMapReveal` 的 `pending`（数据未就绪）分支**整套跳过**，把上层的徽标
    #     也一起保住了。首页放大到景点级要读**全部收录城市**的点位（17 座，实测 4s+），
    #     这段时间屏幕上就一直是那 20 个区徽标。
    #
    # ⇒ 三条判据，每条都能被单独推翻（反证见 `_tmp/falsify_ak.py`）。

    reveal_rel = 'app/common/map/tencent/reveal.ts'
    reveal_f = WEB / reveal_rel
    if not reveal_f.exists():
        problems.append(f'{reveal_rel} 不存在')
    else:
        # ── ① `poi` 这一级**不许回流** ──
        # 点位是最细的一级，它没有退路：退回去拿到的是**尺度完全不对的徽标**。
        hits += 1
        t = strip_comments_keep_lines(reveal_f.read_text(encoding='utf-8'))
        i = t.find("if (level === 'poi')")
        # ★ 区划分支的取数语句改名过（`const nodes = (src.districts…` →
        #   `const all = src.districts(level) ?? []`，2026-10-02 加 `faces` 时改的）——
        #   这条边界锚点要跟着走，否则 AK 会假红成"结构已改"。
        j = t.find("const all = src.districts", i)
        if i < 0 or j < 0:
            problems.append(
                f'{reveal_rel} 里找不到 `poi` 分支（结构已改，本项检查需要同步）'
            )
        else:
            branch = t[i:j]
            if 'continue' in branch:
                problems.append(
                    f'{reveal_rel} 的 `poi` 分支又出现了 `continue`（回流）—— '
                    '那会让"站在街道尺度上、视野内没点位"退回**市级**，'
                    '把一枚离用户几十公里远的市徽标钉在屏幕上（用户：'
                    '"我再怎么放大这个标签都不会消失"），而且每次缩放都重建一次几何'
                )
            if 'districts: []' not in branch:
                problems.append(
                    f'{reveal_rel} 的 `poi` 分支没有返回 `districts: []` —— '
                    '那上（几）级的徽标就不会被清掉'
                )

    # ── ② `pending` 只许挡住**点位层**：它必须夹在 district 同步**之后**、poi 同步**之前** ──
    #
    # `pending` 的语义本来就是"**点位**数据没到，别用空数组去清点位层"，
    # 与"上层徽标该不该在"无关 —— 决策已经说了这一级是 `poi`，那就照它清。
    hits += 1
    modal_rel = 'app/common/logic/useMapReveal.ts'
    modal_f = WEB / modal_rel
    if not modal_f.exists():
        problems.append(f'{modal_rel} 不存在')
    else:
        t = strip_comments_keep_lines(modal_f.read_text(encoding='utf-8'))
        dl = t.find('const dl = districtRef.current')
        pd = t.find('if (d.pending)')
        pl = t.find('const pl = poiRef.current')
        if min(dl, pd, pl) < 0:
            problems.append(
                f'{modal_rel} 里三段（district 同步 / pending / poi 同步）没找齐 —— '
                '结构已改，本项检查需要同步'
            )
        elif not (dl < pd < pl):
            problems.append(
                f'{modal_rel} 的 `if (d.pending)` 位置不对（应当在 district 同步之后、'
                'poi 同步之前）—— 它若排在 district 之前，就成了"整天跳过"，'
                '数据未就绪期间上层的区徽标会一直挂在屏幕上'
            )

    # ── ③ 点位**分批**读：先把眼前那几座城铺出来 ──
    #
    # 一次全读是 4 秒上下的空窗（收录城市数还会一直涨），用户看到的是"放大之后半天没反应"。
    hits += 1
    home_rel = 'app/common/logic/useHomeView.ts'
    home_f = WEB / home_rel
    if not home_f.exists():
        problems.append(f'{home_rel} 不存在')
    else:
        t = strip_comments_keep_lines(home_f.read_text(encoding='utf-8'))
        if 'preloadCities(' not in t:
            problems.append(
                f'{home_rel} 的点位懒加载没有走 `preloadCities`（分批读）—— '
                '一次把全部收录城市读完，实测 4s 空窗，期间屏幕上没有任何点位'
            )
        if 'loadCity(id)' in t:
            problems.append(
                f'{home_rel} 里又出现了 `loadCity(id)`（一次全读的老写法）—— '
                '应当交给 `preloadCities` 按"离地图中心多远"分批读'
            )
        if not (WEB / 'app/common/logic/preloadCities.ts').exists():
            problems.append('app/common/logic/preloadCities.ts 不存在 —— 分批加载的实现没有出处')

    check(label, problems, 3, hits)


def _brace_body(src: str, header_re: str) -> str:
    """从 `header_re` 命中处起、按花括号配对切出一段函数体（含嵌套与结尾的 `}`）。抓不到返回 `''`。"""
    m = re.search(header_re, src)
    if not m:
        return ''
    i = src.find('{', m.end())
    if i < 0:
        return ''
    depth = 0
    for j in range(i, len(src)):
        if src[j] == '{':
            depth += 1
        elif src[j] == '}':
            depth -= 1
            if depth == 0:
                return src[i:j + 1]
    return ''


def check_layer_style_ids() -> None:
    label = 'AN. 图层样式 id 不许分家（徽标一套 · 面一套 · 描边只能整数）'
    problems: list[str] = []
    hits = 0

    # 2026-10-02 用户：「你这改的什么玩意，标签的背景色没了，区的标签和轮廓也不显示了」。
    # 一次事故里其实压着**三条互不报错**的错：
    #   ① `districtLayer.repaintBadges` 把**面**用的 `styleIdOf()` 原样传给 `MultiLabel`，
    #      而徽标样式表的 key 是另一套（`badge/badgePending/badgeHover`）⇒ 交集为空。
    #      腾讯对未知 styleId **不报错**，只让每个牌子退回默认样式：
    #      **白底 + 圆角 + 描边全没了，剩一行黑字压在底图上**（"标签的背景色没了"）。
    #   ② `dense / hover / active` 的 `borderWidth: 2.5` —— SDK 判**无效**
    #      （`MultiPolyline.styles: 样式id dense 对应的PolylineStyle.width属性无效`），
    #      被判定无效的样式会丢掉我们要的描边 ⇒ 部分面的颜色/粗细不受控。
    #   ③ 待收录档的描边原来是不透明实心色、填充只有 0.08，两个极端并存 ⇒
    #      有的面"像马克笔描的"，有的面在街道底图上**根本看不见**。
    # ⇒ 这一项的判据全部建立在"**样式表与样式 id 必须同源**"上。
    ds_rel = 'app/common/map/tencent/districtStyles.ts'
    dl_rel = 'app/common/map/tencent/districtLayer.ts'
    ds_f, dl_f = WEB / ds_rel, WEB / dl_rel
    if not ds_f.exists() or not dl_f.exists():
        check(label, [f'{ds_rel} / {dl_rel} 不存在'], 4, hits)
        return
    ds = strip_comments_keep_lines(ds_f.read_text(encoding='utf-8'))
    dl = strip_comments_keep_lines(dl_f.read_text(encoding='utf-8'))

    # ── ① 徽标样式表的 key 必须**逐一**等于 `BadgeStyleId` 联合 ──
    hits += 1
    um = re.search(r'export type BadgeStyleId\s*=([^\n]+(?:\s*\|\s*\'?\w+\'?[^\n]*)*)', ds)
    union = set(re.findall(r"'(\w+)'", um.group(1))) if um else set()
    bb = _brace_body(ds, r'export function buildBadgeStyles\(')
    badge_keys = set(re.findall(r'(\w+)\s*:\s*new TMap\.LabelStyle', bb))
    if not union or not badge_keys:
        problems.append(
            f'{ds_rel} 里取不到 `BadgeStyleId` 联合（{sorted(union)}）或 `buildBadgeStyles` 的 key'
            f'（{sorted(badge_keys)}）—— 检查自身的正则可能被改坏了'
        )
    elif union != badge_keys:
        problems.append(
            f'徽标样式 id 与样式表**分家**（联合 {sorted(union)} ≠ 表 key {sorted(badge_keys)}）—— '
            '腾讯对未知 styleId 不报错，只会让徽标退回默认样式：白底/圆角/描边全丢，'
            '表现成"标签的背景色没了"。两处必须逐字对齐'
        )

    # ── ② `badgeStyleIdOf` 的返回值必须都在样式表里 ──
    hits += 1
    fb = _brace_body(ds, r'export function badgeStyleIdOf\(')
    lits = set(re.findall(r"'(\w+)'", fb)) - {'pending', 'sparse', 'medium', 'dense'}
    if not lits:
        problems.append(f'{ds_rel} 的 `badgeStyleIdOf` 取不到任何样式 id 字面量')
    else:
        stray = lits - badge_keys
        if stray:
            problems.append(
                f'`badgeStyleIdOf` 会返回样式表里**没有**的 id {sorted(stray)} —— '
                '这些徽标会静默退回默认样式'
            )

    # ── ③ 徽标几何只能由 `badgeStyleOf()` 出 id，**禁止**复用面的 `styleIdOf()` ──
    hits += 1
    if 'const contentSig = shown.map((n) => `${n.adcode}|${badgeStyleOf(n)}`)' not in dl:
        problems.append(
            f'{dl_rel} 的 `repaintBadges` 内容签名没有用 `badgeStyleOf(n)` —— '
            '签名与几何必须同源，否则 hover 换了样式而几何不重设'
        )
    geo_i = dl.find('badges.setGeometries(')
    if geo_i < 0:
        problems.append(f'{dl_rel} 找不到 `badges.setGeometries(`')
    else:
        blk = dl[geo_i:geo_i + 900]
        if 'badgeStyleOf(n)' not in blk:
            problems.append(
                f'{dl_rel} 的徽标几何没有用 `badgeStyleOf(n)` 设 styleId —— '
                '复用 `styleIdOf()` 就是"标签背景色没了"那次事故的复现路径'
            )
        if 'styleIdOf(n)' in blk:
            problems.append(
                f'{dl_rel} 的徽标几何里又出现了 `styleIdOf(n)`（面用的那套 id）—— '
                '两套样式 id 混用，SDK 不报错、徽标静默退化'
            )

    # ── ④ 面样式表必须覆盖 `styleIdOf` 会返回的每一个 id ──
    hits += 1
    pb = _brace_body(ds, r'export function buildDistrictStyles\(')
    poly_keys = set(re.findall(r'(\w+)\s*:\s*new TMap\.PolygonStyle', pb))
    sb = _brace_body(dl, r'function styleIdOf\(')
    face_ids = set(re.findall(r"return '(\w+)'", sb)) | set(
        re.findall(r'return densityTier\(', sb) and ['pending', 'sparse', 'medium', 'dense'] or []
    )
    if not poly_keys or not face_ids:
        problems.append(f'取不到面样式表的 key（{sorted(poly_keys)}）或 `styleIdOf` 的取值（{sorted(face_ids)}）')
    else:
        stray = face_ids - poly_keys
        if stray:
            problems.append(
                f'`styleIdOf` 会返回面样式表里没有的 id {sorted(stray)} —— 那些面会静默退回默认样式'
            )
    # ★ 点位档的面必须有自己的一档（它不按收录密度分档，见 `buildDistrictStyles.reference`）
    if 'reference' not in poly_keys:
        problems.append(
            f'{ds_rel} 的面样式表缺 `reference` 一档 —— 点位档的面会沿用 `pending`（待收录的灰虚线），'
            '而"这一片在哪个区"正是那一档唯一要回答的问题'
        )
    elif "if (mode === 'reference') return 'reference'" not in sb:
        problems.append(
            f'{dl_rel} 的 `styleIdOf` 没有在 `reference` 模式下切到 `reference` 样式 —— '
            '点位档的面会带着"待收录"的视觉，用户看不出自己站在哪个区'
        )

    # ── ⑤ 描边宽度只能是整数（SDK 实测拒绝小数，且会让整条样式失效）──
    hits += 1
    bad_w = re.findall(r'borderWidth\s*:\s*(\d+\.\d+)', pb)
    if bad_w:
        problems.append(
            f'{ds_rel} 的描边宽度出现小数 {bad_w} —— 腾讯的样式校验会拿 PolylineStyle 的 '
            '`width` 规则过一遍并判**无效**（console.error「样式id … width属性无效」），'
            '那条样式会丢掉描边。只能写整数'
        )
    if 'borderWidth: 2' not in pb:
        problems.append(f'{ds_rel} 的面样式表里没有一条 `borderWidth: 2` —— 正则或实现可能被改坏了')
    # ★ 描边颜色必须带透明度（用户 2026-10-02：「这个轮廓的这种颜色，透明度能不能调低」）
    solid = re.findall(r"borderColor:\s*'(#[0-9A-Fa-f]{3,8})'", pb)
    if solid:
        problems.append(
            f'{ds_rel} 的描边还是**不透明实心色** {solid} —— 用户要的是"透明度调低"；'
            '用 rgba(...) 让线不再压过底图'
        )

    check(label, problems, 5, hits)


def check_district_outline_source() -> None:
    label = 'AO. 区轮廓换源（高德优先 · **逐区**退回腾讯 · 直辖市按省码 · 唯一入口）'
    problems: list[str] = []
    hits = 0

    # 2026-10-02 用户：「这个区的轮廓，怎么方方正正的，这轮廓数据不对吧」。
    # 实测根因：区这一级的"面"只有腾讯 `districts/<市>.geo.json`，而腾讯给下辖区的轮廓
    # **极度抽稀** —— 北京 16 个区里 4 个只有 **4 个点**（一个矩形），西安莲湖区 5 个点。
    # 换高德 `config/district?subdistrict=0&extensions=all`（莲湖 556 点、雁塔 1042 点）。
    # 这一项守的是**静默降级**：少了任何一环，区面都会悄悄退回那几个点的矩形，**不报错**。
    own_f = WEB / 'app/common/data/ownBounds.ts'
    bd_f = WEB / 'app/common/data/bounds.ts'
    own = own_f.read_text(encoding='utf-8') if own_f.exists() else ''
    bd = bd_f.read_text(encoding='utf-8') if bd_f.exists() else ''
    city_layer_f = WEB / 'app/common/logic/useCityDistrictLayer.ts'
    city_layer = city_layer_f.read_text(encoding='utf-8') if city_layer_f.exists() else ''

    # ① 三个"自身轮廓"读取器拆到 ownBounds.ts 后，glob 必须还在（写错路径 = vite 静默 0 文件）
    hits += 1
    if '_generated/districts-own/*.geo.json' not in own:
        problems.append(
            '`ownBounds.ts` 的 glob 没指向 `_generated/districts-own/*.geo.json` —— '
            '路径写错时 vite **静默**匹配 0 个文件，区面会一直是腾讯那几个点的矩形'
        )
    if 'export async function loadOwnDistrictBounds(' not in own:
        problems.append('`ownBounds.ts` 没有 `loadOwnDistrictBounds(` —— 区自身轮廓没有读取器')

    # ② 唯一入口：区面只能由 `loadDistrictFaces()` 出，且必须**逐区合并**（不是整份二选一）
    hits += 1
    if 'export async function loadDistrictFaces(' not in bd:
        problems.append(
            '`bounds.ts` 没有 `loadDistrictFaces(` —— 区面的"高德优先/腾讯兜底"没有唯一入口'
        )
    if '...(teng?.polygons ?? {}), ...own' not in bd:
        problems.append(
            '`loadDistrictFaces` 没有**逐区合并**（应为 `{...(teng?.polygons ?? {}), ...own}`）—— '
            '抓取是分批做的（2768 个区、高德月配额），整份二选一会让"只抓到一半"变成'
            '"另一半整片没有面"'
        )
    if 'loadOwnDistrictBounds(' not in bd:
        problems.append('`loadDistrictFaces` 没有调 `loadOwnDistrictBounds(` —— 高德那份没人读')

    # ③ 揭示层取区面必须走同一个入口（走 `loadDistrictBounds` 就等于只读腾讯）
    hits += 1
    if 'loadDistrictFaces(key)' not in bd:
        problems.append(
            "`loadBoundsForLevel` 的区分支没有走 `loadDistrictFaces(key)` —— "
            '首页/省级页放大到区级时还是腾讯那几个点的矩形'
        )
    # ★ 直辖市/特区：它们的区面挂在**省码**下（`110101` 的前 4 位 + 00 = `110100` 不存在）
    if not re.search(r'`\$\{ad\.slice\(0, 2\)\}0000`', bd):
        problems.append(
            '`loadBoundsForLevel` 的区分支没有"省码"兜底（`${ad.slice(0, 2)}0000`）—— '
            '直辖市/特区没有中间市层，它们的区面挂在省码下；少了这条，'
            '北京/上海/天津/重庆在首页放大到区级时**一个面都没有**（而且不报错）'
        )

    # ④ 城市页（最常看区面的页面）也必须走同一入口
    hits += 1
    if 'loadDistrictFaces(cityAdcode)' not in city_layer:
        problems.append(
            '`useCityDistrictLayer.ts` 没有用 `loadDistrictFaces(cityAdcode)` —— '
            '城市页是"看区轮廓"最常走的那条路，直接用 `loadDistrictBounds` 会只读腾讯那份'
        )
    if 'loadDistrictBounds(cityAdcode)' in city_layer:
        problems.append(
            '`useCityDistrictLayer.ts` 又出现了 `loadDistrictBounds(cityAdcode)` —— '
            '那是腾讯那份（极粗）；同一个入口只能有一个，否则两条链路会分叉'
        )

    # ④′ 取景框（点区飞过去 / 城市入口视野）也必须读同一份几何
    #    ★ 只改画面不改取景，会出现"框是按方块算的、线是精确的"——
    #      点一个区，镜头落到的地方与屏幕上画的那个形状对不上。
    hits += 1
    sub_f = WEB / 'app/common/data/subdistricts.ts'
    sub = sub_f.read_text(encoding='utf-8') if sub_f.exists() else ''
    if 'loadDistrictFaces(cityAdcode)' not in sub:
        problems.append(
            '`subdistricts.ts` 的取景框没有走 `loadDistrictFaces(cityAdcode)` —— '
            '点区飞过去 / 城市入口视野会按腾讯那份**方块**算，与画出来的轮廓对不上'
        )
    if re.search(r'loadDistrict(?:Bounds)\s*\(', sub):
        problems.append(
            '`subdistricts.ts` 里还有直接调 `loadDistrictBounds(` 的地方 —— '
            '"哪份几何说了算"只能有一个入口（`loadDistrictFaces`）'
        )

    # ⑤ 抓取脚本：产物目录、自检、断点续跑、run.py 入口
    hits += 1
    s11_f = pmod('step11_district_outlines')
    if not s11_f.exists():
        problems.append(
            'pipeline/steps/step11_district_outlines.py 不存在 —— 区自身轮廓没法重新生成'
        )
    else:
        s11 = strip_comments(s11_f.read_text(encoding='utf-8'))
        # ★ 判据用**用到的那个表达式**，不用符号名 —— 符号名会被 `X_GONE` 这类
        #   子串包含骗过去（本仓库踩过：`'PROVINCES' not in s` 被 `PROVINCES_GONE` 骗过）。
        for needle, why in (
            ('LNG_RANGE[0]', '没有坐标范围自检 —— 拿错行政区会静默写进一份跑到地球另一边的几何'),
            ('BBOX_OVERLAP_MIN', '没有"与腾讯那份的包围框重合"自检 —— 拿错区也不报错'),
            ('DISTRICT_OWN / f"{parent}.geo.json"', '产物落错目录时前端读不到（"跑了脚本但区面没变"，不报错）'),
            ('SIMPLIFY_TOL_M = ', '没有抽稀容差常量 —— 全精度写盘会让分片大好几倍'),
        ):
            if needle not in s11:
                problems.append(f'step11 里没有 `{needle}` —— {why}')
        # ★ 实测结论：高德 `subdistrict=1` 时子级**不带 polyline**（点数 0）
        #   ⇒ 只能逐个区发请求。写回 subdistrict=1 会静默拿到一堆空环。
        if '"subdistrict": 0' in s11:
            problems.append(
                'step11 自己拼了 `subdistrict: 0` 的请求 —— 取自身轮廓只走 '
                '`amap.district_boundary()`（唯一出处，节流/记账/模糊匹配防护都在那里）'
            )
    layout_f3 = pmod('layout')
    if layout_f3.exists() and 'DISTRICT_OWN = GENERATED / "districts-own"' not in layout_f3.read_text(
        encoding='utf-8'
    ):
        problems.append(
            '`pipeline/core/layout.py` 里没有 `DISTRICT_OWN = GENERATED / "districts-own"` —— '
            '路径拼法只有那一处说了算'
        )
    run_f3 = pmod('run')
    if run_f3.exists() and '"district-outline"' not in run_f3.read_text(encoding='utf-8'):
        problems.append('`pipeline/run.py` 没有 `district-outline` 子命令 —— 这份数据没法重新生成')

    # ⑥ 记账：这一步一次会发几百上千个请求，不记账等于"用掉多少完全不知道"
    hits += 1
    amap_f = pmod('amap')
    am = strip_comments(amap_f.read_text(encoding='utf-8')) if amap_f.exists() else ''
    if 'count_usage("amap_district")' not in am:
        problems.append(
            '`amap.district_boundary()` 没有 `count_usage("amap_district")` —— '
            '高德是**月配额**，区/市/省三大批轮廓一次几百上千个请求，不记账就完全看不到消耗'
        )

    check(label, problems, 7, hits)


def check_province_tier() -> None:
    """AP. 面只留边框（不分数量档 · 不高亮 · 不填充）

    2026-10-03 用户连着提了三条，把面的视觉职责一路砍到只剩"边界在哪"：
      ① 「这个轮廓的不同数量显示不同的颜色区分也去掉，现在标签已经有做区分了，
         不做重复处理」⇒ 撤掉按收录数量的四档（`pending`/`sparse`/`medium`/`dense`）；
      ② 「这个轮廓的悬浮高亮去掉，会卡」⇒ 撤掉 `hover` 档（并在 `onHover` 里
         把 `repaint()` 换成 `repaintBadges()`，见护栏 AQ）；
      ③ 「这个轮廓的所有颜色区分都去掉，背景色不需要，只需要边框」
         「悬浮到区域上，标签显示高亮就行了，不需要整个轮廓都高亮」
         ⇒ 撤掉 `active` 档，并把 `color` 改成**全透明**（不填充）。

    ## 为什么这几条是同一件事
    区域的三层信息**都已经在徽标上**：身份（「成都 57」）· 状态（「西藏 —」）·
    高亮（`badgeHover` / `badgeActive`）。面再表达一遍就是重复；
    而面是大块填充，重复表达在国家尺度上铺开，观感就是"有的深有的浅、像没做完"。

    ## 这一项守什么
    守"**别把视觉权重加回来**"。最容易发生的成瘾性改动：有人觉得"面太单调了"，
    于是把填充或数量档接回去 —— 而那正好会连带 `repaint()`（全量 `setGeometries`），
    就是用户报过的"会卡"。要表达进度或高亮，加在徽标上。
    """
    label = 'AP. 面只留边框（不分数量档 · 不高亮 · 不填充）'
    problems: list[str] = []
    hits = 0

    ds_rel = 'app/common/map/tencent/districtStyles.ts'
    dl_rel = 'app/common/map/tencent/districtLayer.ts'
    ds_f, dl_f = WEB / ds_rel, WEB / dl_rel
    if not ds_f.exists() or not dl_f.exists():
        check(label, [f'{ds_rel} / {dl_rel} 不存在'], 4, hits)
        return
    ds = strip_comments_keep_lines(ds_f.read_text(encoding='utf-8'))
    dl = strip_comments_keep_lines(dl_f.read_text(encoding='utf-8'))

    # ── ① 面样式表里不许再有数量档名 ──
    hits += 1
    pb = _brace_body(ds, r'export function buildDistrictStyles\(')
    if not pb:
        problems.append(f'{ds_rel} 里取不到 `buildDistrictStyles` 的函数体 —— 自身的正则可能失效了')
    else:
        keys = set(re.findall(r'(\w+)\s*:\s*new TMap\.PolygonStyle', pb))
        # 两类都**不许**回来，但理由不同 ⇒ 报错文案分开，免得看到的人往错的方向改
        count_tiers = sorted(keys & {'pending', 'sparse', 'medium', 'dense'})
        hl_tiers = sorted(keys & {'hover', 'active'})
        if count_tiers:
            problems.append(
                f'{ds_rel} 的面样式表里又出现了**按收录数量分的档** {count_tiers} —— '
                '用户 2026-10-03：「这个轮廓的不同数量显示不同的颜色区分也去掉，'
                '标签已经有做区分了，不做重复处理」。面只该有 `face` / `reference` 两个 key'
            )
        if hl_tiers:
            problems.append(
                f'{ds_rel} 的面样式表里又出现了**高亮档** {hl_tiers} —— '
                '用户 2026-10-03：「悬浮到区域上，标签显示高亮就行了，'
                '不需要整个轮廓都高亮」。而且面的高亮必然连带 `repaint()`'
                '（全量 `setGeometries`）⇒ 就是用户报过的"会卡"'
            )
        if 'face' not in pb:
            problems.append(
                f'{ds_rel} 的面样式表里没有 `face` 一档 —— 那是唯一的一档普通面，'
                '删了它所有面都会退回 SDK 默认样式（而且**不报错**）'
            )

    # ── ② `styleIdOf` 不许再看数量 ──
    hits += 1
    sb = _brace_body(dl, r'function styleIdOf\(')
    if not sb:
        problems.append(f'{dl_rel} 里取不到 `styleIdOf` 的函数体')
    else:
        for bad in ('poiCount', 'cityCount', 'isUncollected', 'densityTier'):
            if bad in sb:
                problems.append(
                    f'`styleIdOf` 里出现了 `{bad}` —— 面又开始看收录数量了。'
                    "面只回答'这一片是哪块区划'（一律 `return 'face'`），收录情况由徽标表达"
                )
        if "'face'" not in sb:
            problems.append("`styleIdOf` 没有返回 `'face'` —— 普通面会拿不到样式")

    # ── ③ `reference` 必须仍在（它不是数量档，也**不是**高亮档）──
    hits += 1
    if pb and 'reference' not in pb:
        problems.append(
            '面样式表里缺 `reference` 一档 —— 它服务的是**点位档**（z≥12 的街道底图上'
            '边框要更深才看得见），既不是收录数量档、也不是高亮档，别跟着一起删'
        )
    if "if (mode === 'reference') return 'reference'" not in sb:
        problems.append(
            f'{dl_rel} 的 `styleIdOf` 没有在 `reference` 模式下切到 `reference` 样式 —— '
            '点位档的面会跟普通面一样深，压在 POI 圆点上'
        )

    # ── ④ 徽标必须仍分「待收录 / 已收录」两态（信息现在只剩它一个出口）──
    hits += 1
    bb = _brace_body(ds, r'export function buildBadgeStyles\(')
    if not bb:
        problems.append(f'{ds_rel} 里取不到 `buildBadgeStyles` 的函数体')
    else:
        for need in ('badge', 'badgePending'):
            if not re.search(r'\b' + need + r'\s*:\s*new TMap\.LabelStyle', bb):
                problems.append(
                    f'徽标样式表里缺 `{need}` —— 面不再表达收录状态之后，'
                    '「待收录」这个信息**只剩徽标一个出口**，不能也丢了'
                )
    fb = _brace_body(ds, r'export function badgeStyleIdOf\(')
    if fb and 'isUncollected' not in fb:
        problems.append(
            '`badgeStyleIdOf` 没有用 `isUncollected(` 判待收录 —— '
            '那是"待收录"的**唯一判据出处**（`poiCount === null || 0`），'
            '散落成内联判断就会两处漂移'
        )

    # ── ⑤ 面**不许有填充**（`color` 必须显式全透明）──
    hits += 1
    if pb:
        # `pb` 是 `buildDistrictStyles` 的函数体 ⇒ 里面全是 PolygonStyle。
        # （徽标 LabelStyle 的 `color` 是**文字色**，不在这个 body 里，不会误伤。）
        fills = re.findall(
            r"color:\s*'rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)'", pb
        )
        opaque = [a for a in fills if float(a) > 0]
        if opaque:
            problems.append(
                f'{ds_rel} 的面又有填充了（alpha={opaque}）—— 用户 2026-10-03：'
                '「这个轮廓的所有颜色区分都去掉，背景色不需要，只需要边框」。'
                '面只该画边框'
            )
        if not fills:
            problems.append(
                f'{ds_rel} 的面样式里找不到 `color: rgba(…,0)` —— 必须**显式**写出全透明。'
                '省略 `color` 会走 SDK 的默认填充色（不受控的颜色），'
                '等于把"背景色"又加回来了'
            )

    check(label, problems, 5, hits)


def check_seed_imports() -> None:
    """AR. 每份采编稿都要能真import（分层时漏了 seeds/ 目录，83 城全挂）

    ★ 这条是 2026-10-08 补的，起因是一次**真实事故**：
    pipeline 从「26 模块平铺」改成按依赖分三层（`authoring/` 收了 seedlib）之后，
    `pipeline/seeds/*.py` 里那 83 处 `from ..seedlib import baike` **全部失效**
    （`..` = `pipeline/`，而 seedlib 搬到了 `pipeline/authoring/`）。
    ⇒ `check_seed --all` 83 城全部「导入失败」、`seed.py --all` 跑零座城。

    ★★ 为什么别的地方没抓到：
      · `check_app` 当时**完全没有覆盖采编稿导入** —— 只查结构不查"能不能跑"
      · 我手工验的 `list_seed_ids()` 与 `expand_poi()` **都不经过 seeds/*.py 的顶层 import**，
        所以那两条验���恰好绕开了出问题的地方
      · 采编稿是**纯数据**，读它不需要 import ⇒ 静态正则抓不到这个错

    ⇒ 唯一可靠的办法就是**真导入一遍**。这正是本项存在的理由。
    """
    label = 'AR. 采编稿可导入（分层后 83 处相对 import 要一起改）'
    problems: list[str] = []
    hits = 0

    seeds_dir = REPO / 'pipeline' / 'seeds'
    hits += 1
    if not seeds_dir.is_dir():
        problems.append('pipeline/seeds/ 不存在 —— 采编稿目录应在仓库根的 pipeline/ 下')
        check(label, problems, 1, hits)
        return

    ids = sorted(
        p.stem for p in seeds_dir.glob('*.py')
        if not p.name.startswith('_')
    )
    hits += 1
    if not ids:
        problems.append('pipeline/seeds/ 下一个城市都没有 —— seed.py --all 会静默跑零座城')

    # ★ 真导入。这是本项唯一能抓到「相对 import 指向已搬走的模块」的手段
    if str(REPO) not in sys.path:
        sys.path.insert(0, str(REPO))
    failed: list[str] = []
    for cid in ids:
        try:
            mod = importlib.import_module(f'pipeline.seeds.{cid}')
        except Exception as e:                # noqa: BLE001 —— 判据本身不许崩
            failed.append(f'{cid}（{type(e).__name__}: {e}）')
    hits += 1
    if failed:
        problems.append(
            f'{len(failed)}/{len(ids)} 份采编稿导入失败：' + '；'.join(failed[:5])
            + '　★ 搬 `pipeline/` 的模块时**`seeds/` 里的相对 import 也要一起改**'
            + '（`from ..seedlib` → `from ..authoring.seedlib`）'
        )

    # 顺带钉住相对 import 的目标：`seedlib` 现在住在 authoring/，seeds/ 必须写 `..authoring.`
    hits += 1
    stale = [
        p.name for p in seeds_dir.glob('*.py')
        if re.search(r'from \.\.seedlib import', p.read_text(encoding='utf-8'))
    ]
    if stale:
        problems.append(
            f'{len(stale)} 份采编稿还写着 `from ..seedlib import` —— '
            'seedlib 已搬到 `pipeline/authoring/`，应写 `from ..authoring.seedlib import`'
            f'（{", ".join(sorted(stale)[:5])}）'
        )

    check(label, problems, 3, hits)


def check_no_face_hover() -> None:
    """AQ. 面的 hover 高亮不许加回来（它会全量重设几何 ⇒ 卡）

    2026-10-03 用户：「这个轮廓的悬浮高亮去掉，会卡」。

    卡的原因**不是那一档样式**，而是触发机制：`onHover` 一变就调 `repaint()`，
    而 `repaint()` 是**全量** `polygons.setGeometries(geo)` ——
    面**没有**内容签名短路（只有 `repaintBadges` 有）。
    区这一级一屏几百个面、每个面几百到上千个顶点 ⇒
    鼠标每划过一条边界就重建整批多边形。

    ⇒ 这一项守两条：`styleIdOf` 不许再判 `hovered`；`onHover` 不许再 `repaint()`。
    两条是**一对**：只去掉样式档而留着 `repaint()`，就是白跑一次全量重设；
    只去掉 `repaint()` 而留着样式档，hover 会"看着像好了"（其实徽标亮、面没变），
    下次有人为了"修好它"再把 `repaint()` 加回去 —— 卡就回来了。
    """
    label = 'AQ. 面的 hover 高亮不许加回来（全量重设几何 ⇒ 卡）'
    problems: list[str] = []
    hits = 0

    dl_rel = 'app/common/map/tencent/districtLayer.ts'
    dl_f = WEB / dl_rel
    if not dl_f.exists():
        check(label, [f'{dl_rel} 不存在'], 3, hits)
        return
    dl = strip_comments_keep_lines(dl_f.read_text(encoding='utf-8'))

    # ── ① `styleIdOf` 不许再判 `hovered` ──
    hits += 1
    sb = _brace_body(dl, r'function styleIdOf\(')
    if not sb:
        problems.append(f'{dl_rel} 里取不到 `styleIdOf` 的函数体 —— 自身的正则可能失效了')
    elif 'hovered' in sb:
        problems.append(
            '`styleIdOf` 又在判 `hovered` —— 面的悬停高亮被加回来了。'
            '它会连带把 `onHover` 变成全量 `repaint()`（面没有内容签名短路），'
            '区级一屏几百个多边形、鼠标每划过一条边界就重建一次，'
            '就是 2026-10-03 用户报的「会卡」'
        )

    # ── ② `onHover` 只许刷徽标，不许 `repaint()` ──
    hits += 1
    hb = _brace_body(dl, r'function onHover\(')
    if not hb:
        problems.append(f'{dl_rel} 里取不到 `onHover` 的函数体')
    else:
        if 'repaint()' in hb:
            problems.append(
                '`onHover` 里又出现了 `repaint()` —— 那是**全量** `polygons.setGeometries()`，'
                '悬停时每一帧都会重建所有面。悬停只该刷徽标'
            )
        if 'repaintBadges()' not in hb:
            problems.append(
                '`onHover` 里没有 `repaintBadges()` —— 徽标的悬停联动会失效'
                '（徽标 hover 是**保留**的，见 `badgeHover`；别把两者一起删掉）'
            )

    # ── ③ `hovered` 必须仍被徽标消费（否则是个死变量，早晚被误删）──
    hits += 1
    if 'badgeStyleIdOf(node, active, hovered)' not in dl:
        problems.append(
            f'{dl_rel} 的 `badgeStyleIdOf` 不再接收 `hovered` —— 那它就成了死变量'
            '（面的 hover 已取消，它现在**只**服务徽标联动）'
        )

    check(label, problems, 3, hits)


def check_scroll_chain() -> None:
    """AT. 浮层能滚（`.scroll` 不许截断滚动链 · 嵌套容器必须能冒泡）"""
    label = ('AT. 浮层能滚（`.scroll` 不许截断滚动链 · 页面兜底在 · Sheet 内容区接过拉）')
    problems: list[str] = []
    hits = 0

    # ★★★ 这条护栏来自一次**修了两轮才修对**的事故（2026-10-27）。
    #   用户报「浮层的滚动没办法用，鼠标直接拖、按住拖都不行」。第一次查的是
    #   Sheet 把手拖拽 + 城市页滚动，两个都绿，于是以为修好了 —— 但用户还在报。
    #   真正的原因在 CSS：`.scroll` 带着 `overscroll-behavior: contain`，
    #   而 `PoiDetail` / `PlanDetailView` / `PlanListView` 的根节点**自己也是 `.scroll`**，
    #   移动端又把它塞进 `Sheet` 的 `.scroll` 里 ⇒ 两层滚动容器。
    #   内层那层 `scrollHeight === clientHeight`（自己不滚），可它**仍然是滚动容器**，
    #   `contain` 的意思是"滚动到此为止、不许传给祖先" ⇒ 滚轮落在内层 → 内层滚不动
    #   → 外层也不许接 → **整块浮层纹丝不动**。
    #   单变量对照实测（`_tmp/cdp-nested-fix-test.mjs`）：contain 时位移 0px，改 auto 后 240px。
    #   ⇒ 这个失效**不报错、不告警**，只在"详情页/行程页"这种嵌套结构上发作。

    css_f = WEB / 'app' / 'app.css'
    if not css_f.exists():
        problems.append('web/app/app.css 不存在 —— 滚动样式查不了')
        check(label, problems, 1, hits)
        return

    hits += 1
    src = css_f.read_text(encoding='utf-8')

    # ── ① `.scroll` 的**纵向** overscroll-behavior 不许是 contain / none ──
    #   注意只抓纵向：`.scroll-x` 上的 `overscroll-behavior-x: contain` 是**对的**
    #   （横向滚动不该带动纵向），不要连它一起判。
    block = re.search(r'(?<![\w-])\.scroll\s*\{([^}]*)\}', src)
    if not block:
        problems.append(
            'app.css 里找不到 `.scroll { ... }` —— 滚动容器类没了，本条判据失去锚点'
        )
    else:
        om = re.search(r'overscroll-behavior(?:-y)?\s*:\s*([^;]+);', block.group(1))
        if om and om.group(1).strip() in ('contain', 'none'):
            problems.append(
                f'`.scroll` 的纵向 `overscroll-behavior` 又是 `{om.group(1).strip()}` 了 —— '
                '它会在**嵌套**时把滚动链截断在一个滚不动的容器上（内层 scrollHeight==clientHeight '
                '但仍算滚动容器），于是详情页/行程页整块浮层**滚不动且不报错**。'
                '2026-10-27 的真实根因，删掉它交给 `html, body` 兜底'
            )

    # ── ② 兜底必须在：去掉 contain 之后靠"页面本身没有可滚祖先"来防链式滚动 ──
    if not re.search(r'html,\s*body\s*\{[^}]*overscroll-behavior\s*:\s*none', src):
        problems.append(
            '`html, body` 的 `overscroll-behavior: none` 没了 —— 它是 `.scroll` 去掉 `contain` '
            '之后的唯一兜底（不然滚到底会带动整页回弹）'
        )
    if not re.search(r'(?<![\w-])body\s*\{[^}]*overflow\s*:\s*hidden', src):
        problems.append(
            '`body { overflow: hidden }` 没了 —— 「地图即画布」要求页面本身不滚动；'
            '页面一旦可滚，`.scroll` 去 contain 之后就会把滚动漏给整个文档'
        )

    # ── ③ Sheet 的内容区必须既是滚动容器、又接过拉拖动 ──
    sheet_f = WEB / 'app' / 'mobile' / 'ui' / 'Sheet.tsx'
    if not sheet_f.exists():
        problems.append('web/app/mobile/ui/Sheet.tsx 不存在')
    else:
        hits += 1
        s = sheet_f.read_text(encoding='utf-8')
        if 'scroll min-h-0 flex-1' not in s:
            problems.append(
                'Sheet 的内容区没挂 `.scroll min-h-0 flex-1` —— 移动端浮层就没有滚动容器了'
            )
        # ★ 判据刻意宽松（只看有没有把处理函数挂上去），不锁变量名/常量名：
        #   这里要防的是"整块能力被删掉"，不是防止别人重命名。
        if 'onPointerDown={onContentDown}' not in s:
            problems.append(
                'Sheet 丢了「内容区过拉拖动」(`onPointerDown={onContentDown}`) —— '
                '那样整块浮层又只剩顶部那 26px 的把手能拖，而用户不会去挑那一条 ⇒ '
                '看起来就是"怎么拖都没反应"'
            )

    check(label, problems, 2, hits)


def check_mobile_shell() -> None:
    """AU. 移动端外壳（顶栏只剩搜索 · 右下角四枚工具 · 关于不贴边 · 日志只在开发）"""
    label = 'AU. 移动端外壳（顶栏只剩搜索 · 右下角四枚工具 · 关于不贴边 · 日志只在开发）'
    problems: list[str] = []
    hits = 0

    # ── ① 地图显示日志：**只认构建期 DEV**，`?dbg` 后门不许回来 ──
    #
    # 用户 2026-10-27：「底部那个日志，在开发模式显示，生产模式不显示」。
    # 之前线上留了 `?dbg` —— 它意味着产物里永远躺着一块盖在真地图上的浮层，
    # 谁拿到链接都能打开、随时可能被截图当成产品的一部分。
    hits += 1
    log_f = WEB / 'app' / 'common' / 'ui' / 'MapLogPanel.tsx'
    if not log_f.exists():
        problems.append('app/common/ui/MapLogPanel.tsx 不存在 —— 诊断面板被删了？')
    else:
        t = strip_comments_keep_lines(log_f.read_text(encoding='utf-8'))
        if 'import.meta.env.DEV' not in t:
            problems.append(
                'MapLogPanel 不再用 `import.meta.env.DEV` 判断 —— 生产构建里也会渲染这块'
                '诊断浮层（用户明确要"只在开发模式显示"）'
            )
        if re.search(r'URLSearchParams|has\(\s*[\'"]dbg[\'"]', t):
            problems.append(
                'MapLogPanel 里又出现了 URL 参数后门（`?dbg`）—— 线上不该有任何开关能打开它'
            )

    # ── ② 「关于」弹窗不许再挂 `.flt` ──
    #
    # `.flt` 是未分层 CSS 且带 `position: absolute`：卡片一旦绝对定位，
    # `w-full` 的百分比就按"最近定位祖先的 **padding box**"解析 —— 遮罩的 `p-4`
    # 是 padding，于是卡片撑满视口、左右贴死（2026-10-27 用户：「完全贴着左右的边了，很丑」）。
    # 这个坑**只在窄屏显形**（桌面被 `max-w-[640px]` 提前封顶），肉眼很难从代码上看出来。
    hits += 1
    about_f = WEB / 'app' / 'common' / 'ui' / 'doc' / 'AboutModal.tsx'
    if not about_f.exists():
        problems.append('app/common/ui/doc/AboutModal.tsx 不存在')
    else:
        t = strip_comments_keep_lines(about_f.read_text(encoding='utf-8'))
        if re.search(r'className="[^"]*(?<![\w-])flt(?![\w-])', t):
            problems.append(
                'AboutModal 的卡片又挂上了 `.flt` —— 它带 `position: absolute`，'
                '`w-full` 会按遮罩的 padding box 解析 ⇒ 手机上左右贴死（不报错，只在窄屏显形）。'
                '白底/圆角/投影用工具类写'
            )
        if 'max-w-[640px]' not in t:
            problems.append('AboutModal 丢了 `max-w-[640px]` —— 桌面上会拉成一整条')
        if '<AboutContent' not in t:
            problems.append('AboutModal 不再渲染 `<AboutContent` —— 内容没有唯一出处')

    # ── ③ 关于弹窗里必须有**品牌块**（移动端顶栏撤掉 logo 之后，它是唯一展示处）──
    hits += 1
    content_f = WEB / 'app' / 'common' / 'ui' / 'doc' / 'AboutContent.tsx'
    if not content_f.exists():
        problems.append('app/common/ui/doc/AboutContent.tsx 不存在')
    else:
        t = strip_comments_keep_lines(content_f.read_text(encoding='utf-8'))
        if '<SiteMark' not in t:
            problems.append(
                'AboutContent 里没有 `<SiteMark` —— 用户要求「logo 等信息放到关于弹窗里面」，'
                '移动端顶栏已经不显示站标了，这里再没有就彻底没有品牌呈现'
            )
        if '城市旅游攻略' not in t:
            problems.append('AboutContent 里没有副标题「城市旅游攻略」—— 站名单独出现读不出是干什么的')

    # ── ④ 移动端顶栏：站标必须撤走，只剩搜索 ──
    #
    # ★ 判据落在 `MobileBar` 的实现上（按函数切块）：
    #   "顶栏不许有站标"这件事只有在这块里查才有意义 —— 桌面 `TopBar` 的 `<Brand` 是必须保留的。
    hits += 1
    topbar_f = WEB / 'app' / 'common' / 'ui' / 'TopBar.tsx'
    if not topbar_f.exists():
        problems.append('app/common/ui/TopBar.tsx 不存在')
    else:
        t = strip_comments_keep_lines(topbar_f.read_text(encoding='utf-8'))
        i = t.find('function MobileBar(')
        j = t.find('\nfunction ', i + 1) if i >= 0 else -1
        block = t[i:j] if i >= 0 and j > i else ''
        if not block:
            problems.append(
                'TopBar 里找不到 `function MobileBar(` —— 移动端顶栏又回到"桌面那行 + 一堆断点"'
                '的老路（那行在 390px 宽时会把右侧按钮挤出屏外）'
            )
        else:
            if re.search(r'<Brand\b', block):
                problems.append(
                    '移动端顶栏又渲染 `<Brand` 了 —— 用户要求「最左侧的 logo 也隐藏掉」'
                    '（品牌信息改在关于弹窗里）'
                )
            if 'openSearch' not in block:
                problems.append('移动端顶栏没有接手搜索（`openSearch`）—— 那顶栏就什么都不剩了')

    # ── ⑤ 右下角工具条：**钉在屏幕底** · 竖排一列 · 四个入口都在 · **低于浮层** ──
    #
    # 用户五次定稿：「四个按钮放到右下角」→「不是聚合在一块的，是右侧一列」+
    # 「这个层级也不对」→「这四个图标，放右下角」→「右下角那四个悬浮按钮，是固定在底部的，
    # 不会被其他东西往上挤」→「浮层永远在最上」（2026-10-28 第三次，层级方向定稿）。
    #   · 竖排一列，`z-[27]`（**低于**浮层 `z-28`，内容压住工具）；
    #   · 位置 `bottom: var(--flt-inset)` **固定**，不读任何浮层高度。
    # ★★ 上一版让它跟着 `--sheet-h` 上移（为了浮层升起时仍然可见），被用户否掉了 ——
    #   "在半屏处飘着"看起来像被顶上去。所以这里**反向**断言：不许出现 `var(--sheet-h`。
    # ★★ 中间有一版抬到 `z-[29]`（怕城市页的常驻浮层把四枚埋掉）。用户 2026-10-28
    #   第三次选了「浮层永远在最上」，于是回到 `z-[27]`，代价（城市页四枚被盖住）
    #   已在 `MapTools` 文件头写明 —— 别再凭"城市页会埋掉"这一条把它抬回去，
    #   那会同时破坏"三块浮层一个规矩"。
    hits += 1
    tools_f = WEB / 'app' / 'mobile' / 'ui' / 'MapTools.tsx'
    if not tools_f.exists():
        problems.append(
            'web/app/mobile/ui/MapTools.tsx 不存在 —— 移动端右下角那四枚（路线规划/图层/'
            '关于/GitHub）没有实现'
        )
    else:
        t = strip_comments_keep_lines(tools_f.read_text(encoding='utf-8'))
        for need, why in (
            ('usePlanUi', '路线规划入口'),
            ('BasemapSheet', '图层浮层（必须走通用的浮层基座）'),
            ('useDocUi', '关于入口'),
            ('GITHUB_REPO_URL', 'GitHub 入口（地址只能走 `common/data/site` 的唯一常量）'),
            ('flex-col', '竖排一列（用户：「是右侧一列，四个图标」）'),
            ('data-sheet-keep', '点工具条不算"点浮层外面"（否则详情会被顺带关掉）'),
            ('bottom-[var(--flt-inset)]', '工具条必须钉在屏幕右下角'),
        ):
            if need not in t:
                problems.append(f'MapTools 缺少 `{need}` —— {why}没接上')
        # ★ 角标的判据必须是**调用处**：`const load = usePlanStore((s) => s.load)` 里也带着
        #   `s.load`，只查 token 永远为真（反证当场验证过：把 `void load()` 改成 `void 0`，
        #   旧判据依然全绿）。
        if not re.search(r'void\s+load\(\)', t):
            problems.append(
                'MapTools 没有在挂载时 `void load()` —— 条数角标要等用户点开过一次面板才出现'
            )
        if 'grid-cols-2' in t:
            problems.append(
                'MapTools 又变回 2×2 聚合方块了 —— 用户明确要「右侧一列，四个图标」'
                '（2×2 只在屏幕上占一块四方的白斑，还盖住列表右端）'
            )
        if 'z-[29]' in t:
            problems.append(
                'MapTools 又抬回 `z-[29]`（高于浮层）—— 用户 2026-10-28 定稿「浮层永远在最上」，'
                '三块浮层必须一个规矩（`z-28` > 工具条 `z-[27]`）。'
                '抬上去会让图层/详情两块又变成"按钮压着浮层"，正是这次要修的不统一'
            )
        if 'z-[27]' not in t:
            problems.append(
                '工具条的层级不是 `z-[27]` —— 它必须**低于**浮层(`z-28`)、高于提示条(`z-[26]`)'
            )
        # ★ 这条也是"判据落在行为上"：`planOpen` 参与 `aria-expanded` 是正常的，
        #   不许的是它**决定要不要渲染**（那会让工具条在规划浮层开着时整条消失 = 第二套行为）
        if re.search(r'if\s*\(\s*planOpen\s*\)\s*return\s+null', t):
            problems.append(
                'MapTools 又在 `planOpen` 时 `return null` —— 工具条会整条消失，'
                '看起来像"规划浮层压住了按钮"，正是用户说的"三种浮层层级没统一"'
            )
        if 'var(--sheet-h' in t:
            problems.append(
                '工具条又跟着浮层高度走了（`var(--sheet-h)`）—— 用户 2026-10-28：'
                '「是固定在底部的，不会被其他东西往上挤」。浮层升起时被盖住是可以接受的'
            )
        # ★ `(?<![\w-])`：条数徽标写的是 `-top-1`，只用 `\b` 会把那个也算成"顶部定位"
        if re.search(r'className="[^"]*(?<![\w-])(?:top|inset-y)-', t):
            problems.append(
                'MapTools 又用 `top-` 定位了 —— 用户要的是「固定在底部」（右下角）'
            )

    # ── ⑤′ 浮层基座：三档 + **自由拉伸**两种尺寸模式 ──
    #
    # 用户 2026-10-28：「这个浮层（图层），不做固定三个大小，改成用户默认拉，
    # 限制最大高度和最小高度」。所以 `Sheet` 必须同时支持两种模式，而**只有图层**走自由模式。
    # ★ 判据落在"调用处"：只看文件里出现 `size` 这种词永远为真。
    hits += 1
    sheet_f = WEB / 'app' / 'mobile' / 'ui' / 'Sheet.tsx'
    if not sheet_f.exists():
        problems.append('app/mobile/ui/Sheet.tsx 不存在')
    else:
        t = strip_comments_keep_lines(sheet_f.read_text(encoding='utf-8'))
        for pat, why in (
            (r'size\?:\s*SheetSize', '`Sheet` 丢了自由拉伸模式（`size`）—— 图层只能回到三档'),
            (r'onResize', '自由模式下松手高度没有回传通道 —— 拉一次就弹回原位'),
            (r'minSvh', '手势层拿不到最小高度 —— 收起判据退化成"在 peek 档再拉一次"'),
        ):
            if not re.search(pat, t):
                problems.append(f'Sheet 里 {why}')

    hits += 1
    drag_f2 = WEB / 'app' / 'mobile' / 'ui' / 'useSheetDrag.ts'
    if not drag_f2.exists():
        problems.append('app/mobile/ui/useSheetDrag.ts 不存在')
    else:
        t = strip_comments_keep_lines(drag_f2.read_text(encoding='utf-8'))
        for pat, why in (
            (r'target\s*<\s*minPx', '收起判据不是"拖到最小高度以下" —— 从 full 一把拉到底只会降到 peek'),
            (r'startH', '松手时没记起手高度 ⇒ 判不出"拉到底了没有"'),
            (r'FLICK_V', '「甩得快也直接隐藏」的速度判据没了'),
        ):
            if not re.search(pat, t):
                problems.append(f'useSheetDrag 里 {why}')




    # ── ⑥ 浮层基座：三档 + 下拉收起（距离 **或** 速度）+ 点外部收起 ──
    #
    # 用户：「这个浮窗上下拉现在是有三种展现形式的，这个保留……点浮窗之外的界面自动
    # 隐藏，或者往下拉到一定程度也自动隐藏（你看是下拉的速度快一点的时候触发，
    # 还是拉到底部某一个位置触发隐藏）」——两套判据都实现了，缺一条就有一半手势失灵。
    hits += 1
    tier_f = WEB / 'app' / 'mobile' / 'ui' / 'sheetTier.ts'
    if not tier_f.exists():
        problems.append('web/app/mobile/ui/sheetTier.ts 不存在 —— 三档高度没有唯一出处')
    else:
        t = strip_comments_keep_lines(tier_f.read_text(encoding='utf-8'))
        for need in ("'peek'", "'half'", "'full'", 'SHEET_TIER_SVH'):
            if need not in t:
                problems.append(f'sheetTier 缺少 {need} —— 三档被改了，移动端浮层会少一档')

    hits += 1
    drag_f = WEB / 'app' / 'mobile' / 'ui' / 'useSheetDrag.ts'
    if not drag_f.exists():
        problems.append('web/app/mobile/ui/useSheetDrag.ts 不存在 —— 下拉收起的手势没了')
    else:
        t = strip_comments_keep_lines(drag_f.read_text(encoding='utf-8'))
        for need, why in (
            ('DISMISS_PX', '「拉到某个位置就收起」那条判据'),
            ('FLICK_V', '「甩得快就收起」那条判据'),
            ('data-sheet-keep', '点浮层之上的东西（选择器/工具条）不该顺带关掉浮层'),
            ('passive: false', '触摸拖动必须 preventDefault，否则原生滚动会一起动'),
        ):
            if need not in t:
                problems.append(f'useSheetDrag 缺少 `{need}` —— {why}没了')

    # ── ⑦ 详情 / 规划 / 图层三块浮层：统一基座 + 主操作在标题右侧 + 没有底部按钮栏 ──
    hits += 1
    # ★ 判据是 `onClose={`（**真的传给了 `<Sheet>`**），不是"文件里出现过 onClose" ——
    #   后者在 props 类型与解构里必然出现，等于永远为真（写反证时当场验证过：
    #   把传参删掉，旧判据依然全绿）。
    for rel in (
        'app/mobile/ui/PoiDetailSheet.tsx',
        'app/mobile/ui/PoiView.tsx',
        'app/mobile/ui/RoutePlanPanel.tsx',
        'app/mobile/ui/BasemapSheet.tsx',
    ):
        f = WEB / rel
        if not f.exists():
            problems.append(f'{rel} 不存在')
            continue
        t = strip_comments_keep_lines(f.read_text(encoding='utf-8'))
        if "from '~/mobile/ui/Sheet'" not in t:
            problems.append(f'{rel} 没有用统一的浮层基座 `Sheet` —— 形态会各写一套')
        # 必须出现在 `<Sheet ...>` 的**开标签里**：只看"文件里有 onClose{" 不够 ——
        # `BasemapSheet` 的门组件自己也传了一个 `onClose={onClose}` 给内容组件，
        # 光凭 token 存在就永远为真（反证 ⑤ 当场验证过）。
        # ★ 必须用 `<Sheet(?=[\s>])`：`t.find('<Sheet')` 会先命中 `<SheetHead`，
        #   而"找不到这个点位"那种分支的 `<Sheet>` 本来就不需要 onClose ⇒ 误报。
        tags = [t[m.start() : m.start() + 900] for m in re.finditer(r'<Sheet(?=[\s>])', t)]
        if not any('onClose={' in tag for tag in tags):
            problems.append(f'{rel} 没有把 `onClose` 传给 `<Sheet>` —— 点外面 / 下拉都收不起来')
    # 「添加行程」不许再做成底部整条按钮（用户：「不做单独的底部按钮，放到最顶上的标题右侧」）
    hits += 1
    for rel in ('app/mobile/ui/PoiDetailSheet.tsx', 'app/mobile/ui/PoiView.tsx'):
        t = strip_comments_keep_lines((WEB / rel).read_text(encoding='utf-8'))
        if 'footer=' in t:
            problems.append(f'{rel} 又给浮层塞了 `footer=` —— 添加行程必须挂在标题右侧')
        if 'action=' not in t:
            problems.append(f'{rel} 的 `SheetHead` 没有 `action` —— 添加行程按钮丢了')

    # ── ⑦′ 图层浮层：自由拉伸 · 标题不带副标题（2026-10-28 用户定）──
    hits += 1
    bm_f = WEB / 'app/mobile/ui/BasemapSheet.tsx'
    if not bm_f.exists():
        problems.append('app/mobile/ui/BasemapSheet.tsx 不存在')
    else:
        t = strip_comments_keep_lines(bm_f.read_text(encoding='utf-8'))
        if 'size={SHEET_FREE_SVH}' not in t:
            problems.append(
                'BasemapSheet 没走自由拉伸（`size={SHEET_FREE_SVH}`）—— 用户：'
                '「这个浮层，不做固定三个大小，改成用户默认拉，限制最大高度和最小高度」'
            )
        if re.search(r'\btier=', t):
            problems.append('BasemapSheet 又传 `tier=` 了 —— 图层不做三档吸附')
        if re.search(r'<SheetHead[^>]*\bsub=', t):
            problems.append(
                '图层浮层的 `SheetHead` 又带 `sub=` —— 用户：「这个标题的副标题不需要」'
                '（下面第一条选项就是当前底图名，同一屏说两遍）'
            )

    # ── ⑦″ 规划面板头部：移动端「新建规划」= 主色胶囊 · 没有关闭键（2026-10-28 用户定）──
    hits += 1
    ph_f = WEB / 'app/common/ui/plan/PanelHeader.tsx'
    if not ph_f.exists():
        problems.append('app/common/ui/plan/PanelHeader.tsx 不存在')
    else:
        t = strip_comments_keep_lines(ph_f.read_text(encoding='utf-8'))
        if 'useIsMobile' not in t:
            problems.append('PanelHeader 没按端分家（缺 `useIsMobile`）—— 移动端会沿用桌面的头部')
        if 'rounded-full bg-primary' not in t:
            problems.append(
                '移动端「新建规划」不是主色胶囊 —— 用户要求与景点详情的「添加行程」保持统一'
            )
        if not re.search(r'mobile\s*\?\s*null\s*:', t):
            problems.append(
                '移动端又渲染了「关闭」按钮 —— 用户：「关闭按钮也去掉」'
                '（浮层能下拉收起、也能点外面收起，不需要第三个出口）'
            )


    # ── ⑦‴ 浮层互斥：同一时刻只有一块「可选浮层」（2026-10-28 用户定）──
    #
    # 用户原话：「还有这个浮层，同时只显示一个吧，不要隐藏一个下方还有一个」。
    # 做法是 `mobile/ui/sheetHub` 的仲裁表：有出口的三块（详情/规划/图层）谁新开谁关别人，
    # 页面主体（城市/省级清单、点位详情页）挂载时清场、自己不被关。
    # ★ 判据落在**调用点**上：只查 `sheetHub.ts` 里有没有 `claimSheet` 永远为真
    #   （没人调它，浮层照样能叠三层）。
    hits += 1
    hub_f = WEB / 'app/mobile/ui/sheetHub.ts'
    if not hub_f.exists():
        problems.append('web/app/mobile/ui/sheetHub.ts 不存在 —— 浮层互斥没有唯一出处')
    else:
        t = strip_comments_keep_lines(hub_f.read_text(encoding='utf-8'))
        for need, why in (
            ('export function claimSheet', '占位（关掉别的浮层）'),
            ('export function releaseSheet', '让位（浮层收起时）'),
            ('export function useSheetClaim', '挂载即占位 / 卸载即让位的钩子'),
            ('PAGE_SHEET', '页面主体不参与互斥这条规矩'),
        ):
            if need not in t:
                problems.append(f'sheetHub 缺少 `{need}` —— {why}没接上')

    hits += 1
    for rel, key in (
        ('app/mobile/ui/PoiDetailSheet.tsx', 'detail'),
        ('app/mobile/ui/PoiView.tsx', 'detail'),
        ('app/mobile/ui/RoutePlanPanel.tsx', 'plan'),
        ('app/mobile/ui/BasemapSheet.tsx', 'layers'),
    ):
        f = WEB / rel
        if not f.exists():
            problems.append(f'{rel} 不存在')
            continue
        t = strip_comments_keep_lines(f.read_text(encoding='utf-8'))
        if f"useSheetClaim('{key}'" not in t:
            problems.append(
                f"{rel} 没有 `useSheetClaim('{key}', …)` —— 这块浮层开着时还能再开另一块，"
                '关掉上面那块会露出下面那一块（用户：「不要隐藏一个下方还有一个」）'
            )

    hits += 1
    for rel in ('app/mobile/ui/CityView.tsx', 'app/mobile/ui/ProvinceView.tsx'):
        f = WEB / rel
        if not f.exists():
            problems.append(f'{rel} 不存在')
            continue
        t = strip_comments_keep_lines(f.read_text(encoding='utf-8'))
        if 'usePageSheet()' not in t:
            problems.append(
                f'{rel} 没有 `usePageSheet()` —— 从别处带着规划/图层浮层进来时，'
                '清单底下会压着一块收不起来的浮层'
            )

    check(label, problems, 8, hits)


def main() -> int:
    print('=== 应用结构静态校验 ===\n')
    check_barrels()
    check_engine_isolation()
    check_conventions()
    check_contract()
    check_unused()
    check_import_exports()
    check_file_size()
    check_plan()
    check_glob_bases()
    check_layout()
    check_entries()
    check_typecheck()
    check_env_files()
    check_overlay_stacking()
    check_tmap_contract()
    check_view_refresh_pipeline()
    check_top_bar()
    check_zoom_reveal()
    check_icon_sprite()
    check_point_admission()
    check_basemap_presets()
    check_view_loop()
    check_blocks()
    check_image_mirror()
    check_map_click()
    check_cluster_wiring()
    check_search()
    check_district_sync()
    check_four_levels()
    check_district_focus()
    check_plan_storage()
    check_resident_gates()
    check_flat_city_levels()
    check_doc_pages()
    check_session_state()
    check_reveal_deep()
    check_fullscreen()
    check_poi_coords()
    check_geo_provider()
    check_layer_style_ids()
    check_district_outline_source()
    check_province_tier()
    check_no_face_hover()
    check_seed_imports()
    check_vendor_risk()
    check_scroll_chain()
    check_mobile_shell()

    print('')
    for n in notes:
        print(f'  note: {n}')

    print('')
    if failures:
        print(f'RESULT: {len(failures)} 项失败 → ' + ' / '.join(failures))
        return 1
    print('RESULT: ALL_CLEAN')
    return 0


if __name__ == '__main__':
    sys.exit(main())
