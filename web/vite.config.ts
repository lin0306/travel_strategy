import { reactRouter } from '@react-router/dev/vite'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

/**
 * 路径基准用 fileURLToPath 而不是 __dirname —— 配置文件本身是 ESM，
 * 没有 __dirname；也不要用 process.cwd()（从子目录起命令时会指错仓库根）。
 *
 * ★ 本文件位于 `web/`，所以 `abs('./x')` 指 `web/x`，`abs('../x')` 指仓库根的 `x`。
 *   这条基准区别是本仓库唯一的路径陷阱：`data/` 在仓库根，其余都在 `web/` 里。
 */
const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const abs = (p: string) => fileURLToPath(new URL(p, import.meta.url))

/*
 * ⚠️ 这里曾经想加一个「`app/**` 改动就整页重载」的插件来根治 dev server 的
 *    HMR 双实例崩溃（改完代码后页面报「useMapShell 只能在 map-shell 布局路由内
 *    使用」）。**实测该插件无效，已撤掉**（`_tmp/cdp_hmr.mjs`）：
 *      · 页面开着不动、只 `utimes` 改 `app/map/tencent/useTMap.ts` → 依然崩；
 *      · 而且崩后不再自愈（不加插件时碰下一个文件反而会恢复）。
 *    原因是崩溃发生在 **React Router 自己重新生成路由清单**的那段窗口里 ——
 *    它会把布局路由从清单里摘掉再放回，此刻整页重载正好读到"没有布局"的中间态。
 *    所以正确的恢复方式不是"抢着重载"，而是**重启 dev server**。
 *    在拿到可靠反证之前，不要再往这里加同类插件。
 */

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  resolve: {
    alias: {
      // 仓库根的两个目录（在 web/ 之外，所以都要 `../`）
      //   data/   —— 抓取的出口、展示的入口（「数据目录可整体拿走复用」）
      //   schema/ —— 两端共享的字段契约（schema.ts ↔ schema.py，抓取侧同一份）
      '~data': abs('../data'),
      '~shared': abs('../schema'),
      /*
       * ⚠️ 契约目录在 `web/` 之外，于是它的 bare import 找不着 node_modules ——
       *    Rollup / esbuild 都是从**文件自身所在目录**往上找的，
       *    而 `<repo>/schema/` 之上没有 node_modules。
       *    实测（2026-09-21）：漏了这条，`pnpm build` 直接死在
       *    `Rollup failed to resolve import "zod" from ".../schema/schema.ts"`。
       *
       *    `schema.ts` 的运行时依赖**只有 zod**。加新依赖时：
       *      ① 这里加一条；② `tsconfig.json` 的 `paths` 加同一条（tsc 也要）；
       *      ③ `tools/check_app.py` 的 J 项会断言两边同步 —— 只改一边会红。
       */
      zod: abs('./node_modules/zod'),
      '~': abs('./app'),
    },
  },
  server: {
    port: 5173,
    // 同时监听 IPv4 / IPv6 回环，手机连同一局域网调试时可用
    host: true,
    fs: {
      // Vite 默认只允许读取 root 内的文件；~data / ~shared 指向仓库根，必须显式放行
      allow: [repoRoot],
    },
  },
  build: {
    // 地图 SDK 单独异步 chunk，不阻塞首屏（性能预算：首屏 JS ≤ 200KB gzip）
    chunkSizeWarningLimit: 800,
    target: 'es2022',
  },
  define: {
    // 构建期注入**仓库根**绝对路径（不是 web/）—— data/ 在那一层
    __REPO_ROOT__: JSON.stringify(repoRoot),
  },
})
