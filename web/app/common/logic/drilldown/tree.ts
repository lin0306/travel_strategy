/**
 * 区划树读取与计数查询 —— 全在内存里，**运行时零 API 调用**。
 *
 * 这是三级下钻的地基：`data/_generated/district-tree.json` 在构建期把
 * 「全国三级区划 + 每级 POI 计数」算完固化，前端只做 O(1)/O(n) 查表。
 *
 * ## ★ 一条必须刻进骨子里的语义：null ≠ 0
 *
 * | 值 | 含义 | UI |
 * |----|------|-----|
 * | `cityId === null` | **待收录** —— 我们还没做，是**进度问题** | 灰 + 虚线 + 「待收录」 |
 * | `cityId !== null` | 已收录 | 蓝 + 实线 + 「N 个」 |
 *
 * 把 `null` 渲染成 `0` 是**信息错误**：用户会以为"这地方没景点"。
 * 所以本文件只暴露 `isCollected()`，不给"计数为 0"这种可直接误用的判据。
 */

import { PROVINCES } from '~/common/data/provinceAdcodes'

import type { DistrictCityNode, DistrictProvinceNode, DistrictTree } from '~shared/schema'

export interface CityLookup {
  province: DistrictProvinceNode
  city: DistrictCityNode
}

export interface DrilldownIndex {
  provinces: DistrictProvinceNode[]
  provinceByAdcode: Map<string, DistrictProvinceNode>
  cityByAdcode: Map<string, CityLookup>
}

const EMPTY_INDEX: DrilldownIndex = {
  provinces: [],
  provinceByAdcode: new Map(),
  cityByAdcode: new Map(),
}

/** 建索引。树为 null（还没跑 step7）时返回空索引，所有查询都安全地落空 */
export function buildDrilldownIndex(tree: DistrictTree | null): DrilldownIndex {
  if (!tree) return EMPTY_INDEX

  const provinceByAdcode = new Map<string, DistrictProvinceNode>()
  const cityByAdcode = new Map<string, CityLookup>()

  for (const p of tree.provinces) {
    provinceByAdcode.set(p.adcode, p)
    for (const c of p.children) {
      // 同名 adcode 理论上不该出现；真出现了以先入者为稳，并留一条警告
      if (cityByAdcode.has(c.adcode)) {
        console.warn(`[drilldown] adcode ${c.adcode} 在多个省下重复出现，已保留先出现的那个`)
        continue
      }
      cityByAdcode.set(c.adcode, { province: p, city: c })
    }
  }

  return { provinces: tree.provinces, provinceByAdcode, cityByAdcode }
}

/** 是否已收录（判据只看 `cityId`，不看计数 —— 见文件头说明） */
export function isCollected(node: DistrictCityNode): boolean {
  return node.cityId !== null
}

/**
 * 省级页那一行汇总：`'已收录 1 / 共 21 个市'`。
 *
 * ★ `cityCount` 与 `childCount` 必须分开：四川下辖 21 个地级市（`childCount`），
 *   但可能只有 1 个已收录（`cityCount`）。要让用户知道这是**进度问题**，不是内容问题。
 */
export function provinceProgress(p: DistrictProvinceNode): { collected: number; total: number } {
  return { collected: p.cityCount, total: p.childCount }
}

/**
 * 计数文案 —— 统一用「可玩的地方」而不是"景点"，
 * 因为它涵盖了美食与打卡点（10 文档 4.3）。
 */
export function countLabel(poiCount: number): string {
  return `${poiCount} 个可玩的地方`
}

/** 待收录节点的展示文案。**不显示 0** */
export function nodeStatusLabel(node: DistrictCityNode): string {
  return isCollected(node) ? `${node.poiCount} 个` : '待收录'
}

/* ────────────────────────────────────────────────
 * 合规自检
 * ────────────────────────────────────────────── */

export interface ProvinceCoverage {
  expected: number
  actual: number
  /** 在树里缺失的省级单位 —— **必须为空**，否则违反版图完整性要求 */
  missing: Array<{ adcode: string; name: string }>
  /** 树里有、但不在 34 清单里的省级 adcode（通常是 999999 这类非行政区划，应被过滤掉） */
  unexpected: string[]
}

/**
 * 34 个省级单位的完整性核对（10 文档第九节的验收方式）。
 *
 * 开发期会在控制台报警；`scripts/validate.py` 里是硬断言（失败即阻断合并）。
 */
export function checkProvinceCoverage(index: DrilldownIndex): ProvinceCoverage {
  const actual = new Set(index.provinces.map((p) => p.adcode))
  const expected = new Set(PROVINCES.map((p) => p.adcode))

  return {
    expected: PROVINCES.length,
    actual: index.provinces.length,
    missing: PROVINCES.filter((p) => !actual.has(p.adcode)).map((p) => ({ adcode: p.adcode, name: p.fullname })),
    // 999999（东海这类"中国范围内非行政区划区域"）应被构建脚本过滤掉，不该出现在树里
    unexpected: [...actual].filter((a) => !expected.has(a)),
  }
}

/** 是否所有省级单位齐全（含中国台湾 / 中国香港 / 中国澳门） */
export function coverageComplete(c: ProvinceCoverage): boolean {
  return c.missing.length === 0
}

/* ────────────────────────────────────────────────
 * adcode 特例（10 文档 3.3）—— 处理错了下钻会崩
 * ────────────────────────────────────────────── */

/** 省直辖县：第 3、4 位为 90（如 419001 济源市）→ 视同地级市处理 */
export function isProvinceDirectCounty(adcode: string): boolean {
  return /^\d{2}90\d{2}$/.test(adcode)
}

/** 中国范围内非行政区划区域（如东海 999999）→ 过滤掉，不入树、不显示 */
export function isNonDistrict(adcode: string): boolean {
  return adcode === '999999'
}

/**
 * 直辖市与港澳：省级下**直接是区级**，没有二级结构。
 * 下钻时若发现 children 的第一项是区级，**不能报错** —— 直接展示即可
 * （用户点"北京"看到各区的情况是完全合理的）。
 */
export { MUNICIPALITY_ADCODES, NON_DISTRICT_ADCODE } from '~/common/data/provinceAdcodes'
