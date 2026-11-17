#!/usr/bin/env node
/**
 * 把 `data/cities/**` 的**分片**数据聚合成「每城一个 JSON」。
 *
 * ── 为什么需要这一步 ────────────────────────────────────────────
 * 源数据刻意是分片的（一 POI 一文件，PR diff 才看得清），但 `import.meta.glob`
 * 的每个文件都会变成 Rollup 的**一个模块**。当前 5066 个数据文件 + 1191 个边界文件
 * ⇒ 6585 个模块，构建内存峰值 **3.9 GB**。
 *
 * Netlify 的构建容器被 Node 判定为 4 GB（所以 V8 默认堆上限只有 2 GB），
 * 实测 `pnpm build` 在 SSR 阶段就 OOM（exit 134）。本地能过只是因为本机 31 GB 内存
 * ⇒ 默认堆上限 4144 MB，只比峰值高 25 MB，纯属侥幸。
 *
 * 聚合后文件数 5066 → 83，模块数降 75%，内存峰值随之落到容器容得下的范围。
 *
 * ── 契约 ──────────────────────────────────────────────────────
 * 输出 `data/_generated/web/cities/{cityId}.json`：
 *   { "city": { ...city.json 原样 }, "pois": [ ...已排序、已补 category ] }
 *
 * ★ 排序规则必须与 `cityRegistry.ts` 原来那段完全一致（大类顺序 + poiId 字典序），
 *   否则 POI 数组顺序变了会牵连搜索、地图图例、以及一切按下标取值的逻辑。
 *   两边都用 JS 的 `localeCompare` —— 不要在这写成 Python，排序规则会静默漂。
 *
 * ★ 这是**产物**，不进 git。`pnpm dev` / `pnpm build` 都会经 pre 钩子重跑，
 *   所以改了 POI 文件不需要手动执行；单独重跑：`node scripts/gen-web-data.mjs`。
 */

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const REPO = path.dirname(WEB)
const SRC = path.join(REPO, 'data', 'cities')
const OUT = path.join(REPO, 'data', '_generated', 'web', 'cities')

/** 与 `cityRegistry.ts` 的 CATEGORY_ORDER 必须一致（check_app 会断言） */
const CATEGORY_ORDER = ['scenic', 'food', 'hotspot', 'culture']
const rank = (c) => {
  const i = CATEGORY_ORDER.indexOf(c)
  return i === -1 ? CATEGORY_ORDER.length : i
}

async function readJson(p) {
  return JSON.parse(await readFile(p, 'utf8'))
}

async function main() {
  if (!existsSync(SRC)) {
    console.error(`✗ 源数据目录不存在：${SRC}`)
    process.exit(1)
  }

  // 目录整体重建 —— 否则删掉/改名的城市会留在产物里成为幽灵路由
  await rm(OUT, { recursive: true, force: true })
  await mkdir(OUT, { recursive: true })

  const provinces = (await readdir(SRC, { withFileTypes: true })).filter((d) => d.isDirectory())
  let cityCount = 0
  let poiCount = 0
  const ids = []

  for (const prov of provinces) {
    const provDir = path.join(SRC, prov.name)
    const cities = (await readdir(provDir, { withFileTypes: true })).filter((d) => d.isDirectory())

    for (const cityEnt of cities) {
      const cityDir = path.join(provDir, cityEnt.name)
      const cityFile = path.join(cityDir, 'city.json')
      if (!existsSync(cityFile)) continue

      const city = await readJson(cityFile)
      const pois = []

      const poisDir = path.join(cityDir, 'pois')
      if (existsSync(poisDir)) {
        const cats = (await readdir(poisDir, { withFileTypes: true })).filter((d) => d.isDirectory())
        for (const cat of cats) {
          const files = (await readdir(path.join(poisDir, cat.name))).filter((f) => f.endsWith('.json'))
          for (const f of files) {
            const poi = await readJson(path.join(poisDir, cat.name, f))
            // POI 文件里可以不写 category（所在目录已经表达了），补上保持自包含
            if (poi.category === undefined) poi.category = cat.name
            pois.push({ poiId: f.replace(/\.json$/, ''), category: cat.name, data: poi })
          }
        }
      }

      pois.sort((a, b) => rank(a.category) - rank(b.category) || a.poiId.localeCompare(b.poiId))

      // ★ 文件名必须是**目录名**（cityId，如 chengdu），不是 city.json 里的中文 name ——
      //   后者是展示名（三亚），拿它当键会让 `cityIds` 与路由参数全部错位。
      await writeFile(
        path.join(OUT, `${cityEnt.name}.json`),
        JSON.stringify({ city, pois: pois.map((p) => p.data) }),
        'utf8',
      )
      ids.push(cityEnt.name)
      cityCount += 1
      poiCount += pois.length
    }
  }

  // 城市 id 列表：`prerender()` 与客户端都要，且**顺序**要与 glob 的键序一致（字典序）
  ids.sort()
  await writeFile(path.join(path.dirname(OUT), 'ids.json'), JSON.stringify(ids), 'utf8')

  console.log(`✓ 聚合 ${cityCount} 城 / ${poiCount} 个点位 → data/_generated/web/cities/`)
}

await main()
