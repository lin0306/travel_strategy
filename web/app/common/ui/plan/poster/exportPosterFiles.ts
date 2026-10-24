/**
 * 海报导出编排（2026-10-17 用户两轮定稿）：
 * **只导当前选中的那一天**，一张 PNG 直接触发下载。
 *
 * ## 与首版的差别
 * - 首版"全部门打包 zip"→ 用户改为逐文件 → 再改为**只导当天**（导出按钮在详情
 *   面板里，选的是哪一天就导哪一天 —— 语义天然对齐，第二天没内容的问题随之消失）。
 * - **底图**：高德静态图 `v3/staticmap`（实测响应带 `Access-Control-Allow-Origin: *`，
 *   画进 canvas 不污染；腾讯静态图实测不带，走不通）。
 * - **路线**：每段调 `fetchRouteOptions`（腾讯 direction，**与行程页「拉方案」
 *   同一个函数**），取首选方案解码好的 `path` —— 用户原话「和地图上的规划效果
 *   一样，而不是一条直线」。拉不到的段画直线并如实标注。
 *
 * ## API 消耗（都发生在用户点「导出海报」这一次）
 * 底图 1 次高德调用 + 每段 1 次腾讯 direction（走 `canCallRouteOptions` 配额账本，
 * 拒绝时该段退化为直线）。导出是低频主动动作，这个量级可接受。
 *
 * ## 数据诚实（红线 10）
 * 到达时间缺段显示「—」；路径缺失段画直线 + 统计条标注「部分路段为直线示意」。
 */

import { buildAdjacentLegs } from '~/common/logic/itinerary/adjacentLegs'
import type { LegContext, LegResult, Place } from '~/common/logic/itinerary/resolveLeg'
import { makePlaceOfItem, makePoiLookup } from '~/common/logic/itinerary/places'
import type { City, DayItem, RoutePlan, Stay } from '~shared/schema'
import {
  FALLBACK_LINE_COLORS,
  W,
  amapStaticZoom,
  fitZoom,
  makeMercator,
  type PosterDayData,
  type PosterLeg,
  type PosterProgress,
  type PosterStop,
} from './posterAtom'
import { drawDayPoster, mapHeightOf } from './posterDraw'
import type { BaseMap, MapProjection } from './posterAtom'
import { fetchLegPaths, type LegGeometry } from './posterRoutes'

/** 阶段文案（进度行显示）—— 定义在原子层，这里转出去保持旧调用方不动 */
export type { PosterProgress }

export interface PosterExportInput {
  plan: RoutePlan
  city: City
  /** 只导这一天（0 起）—— 详情面板选的是哪天就传哪天 */
  dayNo: number
  legCtx: LegContext | null
  stays: Stay[]
  /**
   * uid → 用户手选的方案 key（`store.chosenOption`）。
   * 有它就用手选那条方案（连几何带时长），海报不必再走 `getOverride` 那条路。
   */
  chosenOption: Record<string, string>
  /** 腾讯 WebService key（direction 接口；行程页同一把） */
  webKey: string
  /** 高德 WebService key（静态图底图） */
  amapKey: string
  onProgress?: PosterProgress
}

/** `DayItem` → 坐标与名字。自由取点（item 自带坐标）也覆盖 —— 行程页同一套查找器 */
function makeLookup(city: City): (it: DayItem) => Place | null {
  return makePlaceOfItem(makePoiLookup(city))
}

/**
 * 从 store 数据整形出一天的海报数据（段几何后面单独补）。
 *
 * ★ 导出是给**离屏回归验证**用的（`_tmp/poster-check.ts`，用 @napi-rs/canvas 真画一张图）。
 *   这个函数的三条规则肉眼看不出来：段/点下标必须严格配对、真实方案时长优先、
 *   只有直线估算才标 `estimated` —— 2026-10-24 就是靠它抓到「有 2 段以上必有 1 段
 *   路线消失」的（`posterMap.offsetPolyline` 的 off=0 分支没转画布坐标）。
 */
export function buildDayData(
  input: PosterExportInput,
  placeOfItem: (it: DayItem) => Place | null,
  legsByUid: Map<string, LegResult>,
  legGeoByUid: Map<string, LegGeometry>,
): PosterDayData | null {
  const { plan } = input
  const day = plan.days[input.dayNo]
  if (!day) return null

  /**
   * ★★ 先只收「画得出来的点」，并记住它在 `items` 里的下标 —— **段必须由相邻的两个
   * 有效点生成**。
   *
   * 为什么非两遍不可：原实现「按 items 逐项 push leg、只在有坐标时 push stop」。当中间
   * 某个 `kind:'poi'` 的 poiId 已不存在（城市数据重建后 id 会变，见 `DayItemSchema`
   * 注释）时，stops 少一个而 legs 不少 ⇒ **清单段标签与地图直线段整体错位一格**，
   * 且 `posterMap` 里 `stops[i] → stops[i+1]` 连的是错的两个点。
   */
  const kept: Array<{ idx: number; item: DayItem; name: string; lng: number; lat: number }> = []
  day.items.forEach((item, idx) => {
    const p = placeOfItem(item)
    const lng = p?.lng ?? item.lng
    const lat = p?.lat ?? item.lat
    // 坐标都没有的点画不进地图 —— 如实跳过（清单与地图必须一致）
    if (typeof lng !== 'number' || typeof lat !== 'number') return
    kept.push({ idx, item, name: p?.name ?? item.poiId, lng, lat })
  })

  /* 时间累计：startTime 起步，段时长推进；缺段就断表（之后全是 null） */
  const [sh = 0, sm = 0] = day.startTime.split(':').map(Number)
  let clock = sh * 60 + sm
  let broken = false

  const stops: PosterStop[] = []
  const legs: PosterLeg[] = []

  kept.forEach((cur, k) => {
    if (k > 0) {
      const prev = kept[k - 1]
      if (!prev) return
      // 中间有被跳过的点 ⇒ 这一段其实跨了两段以上，几何与时长都不可信
      const adjacent = cur.idx === prev.idx + 1
      const l = adjacent ? (legsByUid.get(prev.item.uid) ?? null) : null
      const geo = adjacent ? legGeoByUid.get(prev.item.uid) : undefined
      // ★ 每条 leg 专属颜色：调色板按段序轮换（相邻必不同色）——
      //   地图的线 / 方向箭头 / 清单色点三处同色（2026-10-17 用户定）
      const color =
        FALLBACK_LINE_COLORS[legs.length % FALLBACK_LINE_COLORS.length] ?? C_PRIMARY_FALLBACK

      // ★★ 真实方案时长优先（本次 direction 响应 / 24h 缓存里那条方案的数），
      //    其次才是 `resolveLegSync` 的结果（矩阵 / legCache / 直线估算）。
      const realSec = geo?.durationSec ?? null
      const durSec = realSec ?? (l ? l.duration : null)
      // `not-applicable`（超距）给的是 duration: 0 —— 不许显示「约 0 分钟」，
      // 也不许拿 0 推进时间（红线 10：null ≠ 0）
      if (!broken && l && durSec !== null && durSec > 0) {
        clock += durSec / 60
        legs.push({
          mode: l.mode,
          durationSec: durSec,
          /**
           * 只有「没用到真实方案、且 resolveLegSync 说这是直线估算」才算估算。
           * 原判据 `source !== 'matrix' && source !== 'live'` 把 `cache`（过了 TTL
           * 校验的真实值）也算成估算 ⇒ 统计条误报「时长含估算」。
           */
          estimated: realSec === null && l.source === 'estimate',
          path: geo?.path ?? null,
          ...(geo?.lineItems ? { lineItems: geo.lineItems } : {}),
          color,
        })
      } else {
        broken = true
        legs.push({
          mode: l?.mode ?? 'driving',
          durationSec: null,
          estimated: false,
          path: null,
          color,
        })
      }
    }

    stops.push({
      seq: stops.length + 1,
      name: cur.name,
      lng: cur.lng,
      lat: cur.lat,
      dwellMin: cur.item.dwellMinutes,
      arriveMin: broken ? null : clock,
    })
    // 不是最后一点就把停留时间算进去（被跳过点的停留不计 —— 它不在海报上）
    if (!broken && k < kept.length - 1) clock += cur.item.dwellMinutes
  })

  const stay = input.stays.find((s) => s.id === day.stayId) ?? null

  return {
    cityName: input.city.name,
    dayNo: input.dayNo + 1,
    dayCount: plan.days.length,
    stops,
    legs,
    stayPoint: stay ? { name: stay.name, lng: stay.lng, lat: stay.lat } : null,
  }
}

/** 调色板兜底（与 posterAtom 的主色同值） */
const C_PRIMARY_FALLBACK = '#1677ff'

/**
 * 段几何的拉取在 `./posterRoutes`（2026-10-24 拆出）：
 * 那里带 24h 缓存复用、手选方案优先、真实时长回填 —— 本文件只管版面编排。
 */

/**
 * 计算投影 + 加载底图。
 *
 * ## ★ 高德静态图的 `size` 是**星号分隔**（`580*740`），不是 `x`
 * 2026-10-17 用户实测抓到的：写成 `x` 高德返回 200 + `{"infocode":"20003"}` JSON 错误
 * （不是 4xx！），img onerror ⇒ 底图整块消失。格式错一个字符，整块地图没了。
 *
 * ## 投影与底图解耦
 * `proj`（zoom/center/k）**永远返回** —— 底图失败时路线和标记照样画（灰底上）。
 * k 恒为 contain 式（`min(W/spanX, mapH/spanY) × 0.82`）；底图侧靠「请求尺寸盖满画布
 * ＋分辨率提升」来保证不露边、不糊，**不动 k**（动 k 就是拿对齐换外观）。
 *
 * ★ 导出（export）只为离屏回归（`_tmp/poster-real.ts` 用真图真路线验证投影对齐）——
 *   底图与路线的比例关系肉眼几乎看不出错，只能靠像素比对；2026-10-24 的
 *   「路线和地图对不上」就是这么抓到的。
 */
export async function loadBaseMap(
  input: PosterExportInput,
  d: PosterDayData,
): Promise<{ proj: MapProjection; base: BaseMap | null; note?: string }> {
  const pts = d.stayPoint ? [...d.stops, d.stayPoint] : d.stops
  const mapH = mapHeightOf(d)
  const fallback = {
    proj: { zoom: 10, centerLng: 104, centerLat: 30, k: 1 } as MapProjection,
    base: null as BaseMap | null,
  }
  if (pts.length === 0) return { ...fallback, note: '没有可绘制的点位' }

  const lngs = pts.map((p) => p.lng)
  const lats = pts.map((p) => p.lat)
  for (const leg of d.legs) {
    if (!leg.path) continue
    for (const [lng, lat] of leg.path) {
      lngs.push(lng)
      lats.push(lat)
    }
  }
  const bbox = {
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
  }
  const centerLng = (bbox.minLng + bbox.maxLng) / 2
  const centerLat = (bbox.minLat + bbox.maxLat) / 2
  /**
   * ★★ 视窗 = 820×820：**底图输出上限 1024 ÷ 余量系数 1.25**。
   * 「留余地」（2026-10-18 用户：点位不能贴边）要求底图范围比点位 bbox 大
   * 1/MARGIN ≈ 1.22 倍 ⇒ fitZoom 的视窗必须相应缩小，否则请求超 1024 被拒。
   */
  const zoom = fitZoom(bbox, 820, 820)
  const m = makeMercator(zoom)
  const spanX = m.lngToX(bbox.maxLng) - m.lngToX(bbox.minLng)
  const spanY = m.latToY(bbox.minLat) - m.latToY(bbox.maxLat)

  /**
   * ★★ **k = contain × MARGIN**——zoom 按「1 墨卡托px = 1 画布px」视窗选的，
   * k 放大（cover）会整体超框；k 精确 contain 又会让 bbox 边缘点位**贴边/半出框**
   * （2026-10-18 用户：「③半个标记在画布外，看起来没连起来」）。
   * MARGIN=0.82：点位区域占画布 82%、四周各留 ~9% —— 标记（r=18）完整可见。
   */
  const MARGIN = 0.82
  const k = Math.min(W / spanX, mapH / spanY) * MARGIN

  /**
   * ★ 无 key 的降级必须在 `k` **算出来之后**再返回 —— `containProj()` 读的就是 `k`，
   * 之前这段放在 `const k` 之前 ⇒ 走这条路直接 `ReferenceError: Cannot access 'k'
   * before initialization`（TDZ），所谓"无底图照画路线"从来没生效过，整个导出会抛错。
   * 常见触发场景：key 是在 dev server 启动后才写进 `.env.local`（vite 只在启动时读 env）。
   */
  if (!input.amapKey) {
    console.warn('[poster] 未配置 VITE_AMAP_WEB_KEY，海报无底图（路线与标记照画）')
    return { proj: containProj(), base: null, note: '未配置 VITE_AMAP_WEB_KEY，底图未生成' }
  }

  /**
   * 底图**必须盖满整个地图区**，否则露浅色空带。
   *
   * 只按 bbox/MARGIN 要图是不够的：`mapHeightOf()` 有 420~1400 的上下限，一旦触发
   * 截断，地图区的高宽比就不再等于 bbox 的高宽比 —— contain 式的底图必然短一条边
   * （2026-10-24 修完 zoom 偏移后，用户看到左右两条浅色空带就是这个）。
   * ⇒ 尺寸取两者的较大者：既留够余量，又保证 `coverW*k ≥ W`、`coverH*k ≥ mapH`。
   */
  const needW = Math.max(spanX / MARGIN, W / k)
  const needH = Math.max(spanY / MARGIN, mapH / k)

  /**
   * ★ 分辨率提升：同一片区域，请求「更大的 zoom + 更大的 size」能拿到更清晰的底图。
   * `size × 2^n` 配 `zoom + n`，覆盖范围不变（1 图像px = 2^-n 个墨卡托px），
   * 而 `coverW/coverH` 记的始终是墨卡托px ⇒ 对齐不受影响，只是不再被拉伸糊掉。
   *
   * 上限三重：图像边长 ≤ 1024、高德静态图 zoom ≤ 17（再大接口直接报错 ⇒ 底图整块没有）。
   */
  const MAX_PX = 1024
  const amapZoomBase = amapStaticZoom(zoom)
  const boost = Math.max(
    0,
    Math.min(
      Math.floor(Math.log2(MAX_PX / needW)),
      Math.floor(Math.log2(MAX_PX / needH)),
      17 - amapZoomBase,
    ),
  )
  const pxScale = 2 ** boost
  const reqW = Math.min(MAX_PX, Math.ceil(needW * pxScale))
  const reqH = Math.min(MAX_PX, Math.ceil(needH * pxScale))
  // 图像实际像素 = coverW × pxScale；画布只认 coverW（见 posterAtom.BaseMap）
  const coverW = reqW / pxScale
  const coverH = reqH / pxScale

  /**
   * ★★★ 请求的 `zoom` **必须比投影用的标准 zoom 小一档**（`amapStaticZoom`）。
   * 高德静态图的 zoom 语义是"标准 z+1"：直接传 `zoom` 的话，同一数字下底图会比
   * 路线放大一倍 ⇒ 路线缩在中心、越往外偏得越多（2026-10-24 用户报的"路线和地图
   * 对不上"）。反过来传 `zoom-1` 后，**1 图像px = 1 个标准 zoom 级墨卡托px**，
   * 于是 `needW` 的推导（= spanX/MARGIN 个墨卡托px）依然成立，`k` 不用动。
   * 分辨率提升再加回 `boost` 档（`size` 同步放大 2^boost）。
   */
  const url =
    `https://restapi.amap.com/v3/staticmap?` +
    `location=${centerLng.toFixed(6)},${centerLat.toFixed(6)}` +
    `&zoom=${amapZoomBase + boost}&size=${reqW}*${reqH}` +
    `&key=${encodeURIComponent(input.amapKey)}`

  // ★ 用 fetch（响应带 CORS 头，可读）而不是直接 img.crossOrigin ——
  //   高德对错误**也回 HTTP 200 + JSON**（如 size 格式错的 20003），
  //   img.onerror 只知道"挂了"不知道为什么；fetch 能把错误体打出来。
  try {
    const res = await fetch(url)
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.startsWith('image/')) {
      const body = await res.text()
      console.error(`[poster] 底图接口返回错误：${body.slice(0, 200)}`)
      // 把错误 infocode 提出来（高德错误也是 HTTP 200，UI 上要能看见）
      const info = /"info":"([^"]*)"/.exec(body)?.[1] ?? '接口返回异常'
      return { proj: containProj(), base: null, note: `底图接口错误（${info}）` }
    }
    const blob = await res.blob()
    // blob:URL 是同源 —— 画进 canvas 不会污染（腾讯静态图不带 CORS 头，那条路走不通）
    const objectUrl = URL.createObjectURL(blob)
    const image = await new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = objectUrl
    })
    if (!image) {
      URL.revokeObjectURL(objectUrl)
      return { proj: containProj(), base: null, note: '底图图片解码失败' }
    }
    // ★ objectUrl 交给编排层：**画完 canvas 才 revoke**（这里 revoke 会让图还没落笔就失效）
    return { proj: { zoom, centerLng, centerLat, k }, base: { image, coverW, coverH, objectUrl } }
  } catch (err) {
    console.error('[poster] 底图请求失败：', err)
    const msg = err instanceof Error ? err.message : String(err)
    return { proj: containProj(), base: null, note: `底图请求失败（${msg}）` }
  }

  /** 无底图时的投影：与有底图同一 contain 公式（k 一致，切换底图无跳变） */
  function containProj(): MapProjection {
    return { zoom, centerLng, centerLat, k }
  }
}

/**
 * 导出**当前选中那一天**的海报 PNG 并触发下载。
 * @returns 文件名 + 底图失败原因（`note` 非空 = 底图没生成，toast 里如实带上 ——
 *          用户「控制台日志看不到」：关键信息必须上 UI，不能只打 console）。
 * @throws toBlob 失败时抛出。
 */
export async function exportDayPoster(
  input: PosterExportInput,
): Promise<{ filename: string; note?: string }> {
  const { city, onProgress } = input
  onProgress?.('整理行程…')

  const placeOfItem = makeLookup(city)
  const day = input.plan.days[input.dayNo]
  if (!day) throw new Error('这一天不存在')

  const legsByUid: Map<string, LegResult> = input.legCtx
    ? buildAdjacentLegs(day, placeOfItem, input.legCtx)
    : new Map()

  // ① 逐段取几何与**真实时长**（先吃 24h 方案缓存，命中即零请求；与行程页共享同一份）
  const { paths: legGeoByUid, failures } = await fetchLegPaths(
    { dayItems: day.items, webKey: input.webKey, chosenOption: input.chosenOption },
    legsByUid,
    onProgress,
  )

  // ② 组装 + 投影/底图（底图失败也返回投影 —— 路线和标记照画）
  const d = buildDayData(input, placeOfItem, legsByUid, legGeoByUid)
  if (!d || d.stops.length === 0) throw new Error('这一天没有可绘制的点位')
  onProgress?.('加载地图…')
  const { proj, base, note } = await loadBaseMap(input, d)
  // ★ 失败原因汇总上 UI（用户「控制台日志看不到」）：底图问题 + 路线拉取失败段
  const notes = [...(note ? [note] : []), ...failures.slice(0, 3)]

  try {
    // ③ 绘制 + 下载
    onProgress?.('生成图片…')
    const canvas = document.createElement('canvas')
    drawDayPoster(canvas, d, proj, base)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('图片生成失败（canvas 不可用）')

    const url = URL.createObjectURL(blob)
    const filename = `${city.name}-${input.plan.name || '行程'}-第${input.dayNo + 1}天.png`
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    // ★ 立即 revoke 在部分浏览器会打断下载 —— 留 4s 再收
    setTimeout(() => URL.revokeObjectURL(url), 4000)
    return { filename, note: notes.length > 0 ? notes.join('；') : undefined }
  } finally {
    // ★ 底图的 blob: 地址用完必须收 —— 不 revoke 每导一次就漏一份留在内存里
    if (base?.objectUrl) URL.revokeObjectURL(base.objectUrl)
  }
}