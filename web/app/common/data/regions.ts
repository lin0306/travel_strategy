/**
 * 地区行数据 —— 全国视图（省）/ 省级视图（市）的**行形状 + 读取**。
 *
 * ## 为什么从 `data.ts` 拆出来
 * 那边已经顶到单文件行数上限（check_app 的 G 项站着），而"省 / 市这两级的行"
 * 是自成一体的一块：它只依赖区划树，不碰城市文件、不碰边界文件。
 *
 * ## ★★ 本文件替读者守住的头一条：**"市"到底指哪些节点**
 * 直辖市 / 特别行政区在区划树里**没有市那一层**（腾讯对 `110100`「市辖区」返回
 * 0 个下级）—— 省节点的 `children` 直接是区。于是：
 *
 * | 判据 | 后果 |
 * |------|------|
 * | 只扫 `children`（错） | ① 市级那一档铺出一屏「东城 —」「西城 —」… —— **区被当成了市**，且它们 `cityId` 为 null，全显示"待收录"，市标（北京 57）反而一枚没有；② 区级那一档**什么都不出** —— 区分片按**市的 adcode**懒加载，这些"区"cityId 是 null ⇒ 一个都拉不到 |
 * | `level === 'city'` ∪ **自身即市的省**（对） | 市级 = 北京一枚；区级 = 16 个真区 |
 *
 * ★ 判据读树上的 `isCity`（`build.py` 按 adcode 段写入，**与收录状态无关**）。
 *   别拿 `cityId` 反推：那样未收录的直辖市（天津）会被判成普通省，它的区照样被当市。
 */

import { loadDistrictBounds, loadDistrictTree } from './data'
import { PROVINCES } from './provinceAdcodes'

/* ────────────────────────────────────────────────
 * 全国视图的行数据
 * ────────────────────────────────────────────── */

/**
 * 一行省级单位 —— **UI 只认这个形状**，不直接吃 `DistrictProvinceNode`。
 *
 * 多出来的两处 `null` 是刻意的，它们是本项目最容易被做错的语义：
 * - `center: null` → **区划树还没生成**（没跑 `data:build`），地图上撒不了徽标。
 *   与"坐标是 (0,0)"是两件事，所以不能用零值糊弄。
 * - `poiCount: null` → **待收录**，UI 要显示「—」而不是「0」。
 */
export interface ProvinceRow {
  adcode: string
  name: string
  fullname: string
  center: { lng: number; lat: number } | null
  poiCount: number | null
  cityCount: number
  childCount: number
}

export interface NationalView {
  rows: ProvinceRow[]
  /** 区划树是否存在。false 时没有任何坐标，地图只能空着 + 面板给引导 */
  hasTree: boolean
}

/**
 * 全国视图的数据。
 *
 * ★ **区划树缺席时必须仍然可用**：树是采集流水线的产物，在跑完 step7 之前
 *   根本不存在。此时用 34 个省级单位清单兜底 —— 列表照常列出 34 行、
 *   全部显示「待收录」。这比一张"数据加载失败"的卡片诚实得多：
 *   我们确实还没做，不是做不出来。
 */
export async function loadNationalView(): Promise<NationalView> {
  const tree = await loadDistrictTree()

  if (tree) {
    return {
      hasTree: true,
      rows: tree.provinces.map((p) => ({
        adcode: p.adcode,
        name: p.name,
        fullname: p.fullname,
        center: p.center,
        // ⚠️ 树里 poiCount 是必填数字，但 0 在这里的真实含义是"未收录"。
        //    转成 null 让 UI 走「待收录」分支 —— 别把 0 透出去。
        poiCount: p.cityCount > 0 ? p.poiCount : null,
        cityCount: p.cityCount,
        childCount: p.childCount,
      })),
    }
  }

  return {
    hasTree: false,
    rows: PROVINCES.map((p) => ({
      adcode: p.adcode,
      name: p.name,
      fullname: p.fullname,
      center: null,
      poiCount: null,
      cityCount: 0,
      childCount: 0,
    })),
  }
}

/* ────────────────────────────────────────────────
 * 省级视图
 * ────────────────────────────────────────────── */

/** 一行下辖单位 —— 判据是 `cityId !== null`（是否已收录），不是计数 */
export interface CityRow {
  adcode: string
  name: string
  cityId: string | null
  /** 中心点。区划树未生成时为 null */
  center: { lng: number; lat: number } | null
  /** `null` = 待收录。**不要用 0 表达它** */
  poiCount: number | null
}

/** 一行下辖单位 + 它属于哪个省 —— 首页揭示市级时要按视野挑，必须有归属 */
export interface CityRowWithParent extends CityRow {
  provinceAdcode: string
  provinceName: string
}

/**
 * 全国所有**市**，摊平成一维。
 *
 * 用途只有一个：**首页放大到市级时，挑出"当前视野里那些市"**。
 *
 * 为什么不能按"省中心是否在视野内"来挑 —— 首页 fit 之后缩放是 4.4 左右
 * （这个数随容器尺寸变，见 `zoomTiers.ts` 文件头），放大到 6.5 时视野宽度
 * 只有一两个经度，**很可能整块都在省内部**，省中心根本不入镜，
 * 于是"视野内一个省都没有"→ 地图空掉。按市中心筛选就没有这个问题：
 * 视野里看得见哪几个市，就铺哪几个。
 *
 * ## ★★ "市" = `level === 'city'` 的节点 **∪ 自身即市的省节点**（`isCity`）
 * 直辖市 / 特别行政区在区划树里**没有市那一层**：省节点的 children 直接是区
 * （腾讯对 `110100`「市辖区」返回 0 个下级，那一层没有真实节点）。
 * 所以只扫 children 会得到两个错（2026-09-26 用户报的「直辖市的标注不对」）：
 *   ① 市级那一档铺出一屏「东城 —」「西城 —」… —— **区被当成了市**，
 *      而且它们 `cityId` 是 null，全部显示"待收录"，市标（北京 57）反而一枚没有；
 *   ② 区级那一档**什么都不出** —— 区分片是按**市的 adcode**懒加载的，
 *      "区"的 cityId 是 null ⇒ 一个都拉不到 ⇒ 真区（东城 28、西城 8…）永远不上场。
 * 正确做法：这类省**自己**就是那座市，push 它自己，children 一概不进市级清单。
 *
 * ★ 判据读树上的 `isCity`（build 按 adcode 段写入，**与收录状态无关**）：
 *   千万别拿 `cityId` 去反推，那样未收录的直辖市（天津）会被判成普通省，
 *   它的 16 个区照样被当市。
 *
 * 数据全部来自 `district-tree.json`（已在内存里），不额外读文件。
 */
export async function loadAllCityRows(): Promise<CityRowWithParent[]> {
  const tree = await loadDistrictTree()
  if (!tree) return []

  const out: CityRowWithParent[] = []
  for (const p of tree.provinces) {
    if (p.isCity) {
      out.push({
        adcode: p.adcode,
        name: p.name,
        cityId: p.cityId,
        center: p.center,
        poiCount: p.cityId !== null ? p.poiCount : null,
        provinceAdcode: p.adcode,
        provinceName: p.name,
      })
      continue
    }
    for (const c of p.children ?? []) {
      // 保险：区不进市级清单（普通省的下级按 build 的写法都是市）
      if (c.level === 'district') continue
      out.push({
        adcode: c.adcode,
        name: c.name,
        cityId: c.cityId,
        center: c.center,
        poiCount: c.cityId !== null ? c.poiCount : null,
        provinceAdcode: p.adcode,
        provinceName: p.name,
      })
    }
  }
  return out
}

export interface ProvinceDetail {
  /** 省本身。adcode 不在 34 清单里时为 null（URL 手改的情况） */
  province: ProvinceRow | null
  /**
   * 本页的下级单位 —— **市**。
   *
   * ★ 直辖市 / 特别行政区（`isCity`）返回**它自己**那一枚：它的 children 是区，
   *   不在这一级（理由见 `loadAllCityRows` 文件头那段）。
   */
  cities: CityRow[]
  /**
   * 区划树上有多少**下级市** —— 与「已收录几个」必须分开显示。
   *
   * ★ 直辖市是 1（它自己就是那座市），**不是**它的区数 16 ——
   *   UI 那句「已收录 1 / 16」里的 16 会被读成"16 个下级里只收了 1 个"，
   *   而真相是"本页这一级只有 1 个，且已收录"。
   */
  childCount: number
  /** ★ 这个省**自身就是一座市**（直辖市 / 特别行政区）。判据来自树上的 `isCity` */
  isCity: boolean
  hasTree: boolean
  /** 该省的市级边界文件。没有时地图只撒徽标不画面 */
  boundsAvailable: boolean
}

export async function loadProvinceDetail(adcode: string): Promise<ProvinceDetail> {
  const tree = await loadDistrictTree()
  const meta = PROVINCES.find((p) => p.adcode === adcode) ?? null

  if (!tree) {
    return {
      province: meta
        ? {
            adcode: meta.adcode,
            name: meta.name,
            fullname: meta.fullname,
            center: null,
            poiCount: null,
            cityCount: 0,
            childCount: 0,
          }
        : null,
      cities: [],
      childCount: 0,
      isCity: false,
      hasTree: false,
      boundsAvailable: false,
    }
  }

  const node = tree.provinces.find((p) => p.adcode === adcode) ?? null
  const bounds = await loadDistrictBounds(adcode)

  // ★ 直辖市：本页的下级是**它自己**（children 是区，属下一级）。
  //   这不是"省页显示城市页内容"，是这类单位本来就没有中间的市层。
  const isCity = node?.isCity ?? false
  if (node && isCity) {
    return {
      province: {
        adcode: node.adcode,
        name: node.name,
        fullname: node.fullname,
        center: node.center,
        poiCount: node.cityCount > 0 ? node.poiCount : null,
        cityCount: node.cityCount,
        childCount: node.childCount,
      },
      cities: [
        {
          adcode: node.adcode,
          name: node.name,
          cityId: node.cityId,
          center: node.center,
          poiCount: node.cityId !== null ? node.poiCount : null,
        },
      ],
      childCount: 1,
      isCity: true,
      hasTree: true,
      boundsAvailable: bounds !== null,
    }
  }

  return {
    province: node
      ? {
          adcode: node.adcode,
          name: node.name,
          fullname: node.fullname,
          center: node.center,
          poiCount: node.cityCount > 0 ? node.poiCount : null,
          cityCount: node.cityCount,
          childCount: node.childCount,
        }
      : null,
    cities: (node?.children ?? [])
      .filter((c) => c.level !== 'district')
      .map((c) => ({
        adcode: c.adcode,
        name: c.name,
        cityId: c.cityId,
        center: c.center,
        poiCount: c.cityId !== null ? c.poiCount : null,
      })),
    childCount: node?.childCount ?? 0,
    isCity: false,
    hasTree: true,
    boundsAvailable: bounds !== null,
  }
}
