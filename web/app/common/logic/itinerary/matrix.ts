/**
 * 通勤矩阵编解码 —— 运行时零 API 调查表的入口。
 *
 * ## 编码
 * 只存**对称上三角**，定长 4 位 base36 扁平串，按行优先展开：
 *
 *     idx(i, j) = i × (i − 1) / 2 + j        (i > j)
 *     读取时对称取值：i > j ? idx(i,j) : idx(j,i)
 *     '0000' = 不适用（超出该方式直线距离上限，或接口无数据）
 *
 * ### 为什么存上三角
 * 路网上 A→B 与 B→A 时长理论上不等（单行道、掉头限制），但市内短途的往返差异通常
 * 只有 5–15%，而用户对"42 分钟 vs 45 分钟"并不敏感。全矩阵要多存一倍数据
 * （12,696 个数字 → 上三角 6,210 个，gzip 后 18KB → 9KB），换来的精度提升不值。
 * 这个近似**必须写在 UI 上**（段的说明里标「时长按往返均值估算」），不能偷偷省。
 *
 * ### 为什么是定长切片而不是建索引
 * 定长切片的读取是 **O(1) 字符串操作**，46 个点的量级下整个矩阵解析是亚毫秒级。
 * 建 Map 索引反而多一次分配、还多一份可能不一致的缓存。
 *
 * ⚠️ 不做 delta 编码：当前体积（gzip 约 9KB）远未触及单城 300KB 的预算，
 *    过早优化只会增加脚本复杂度。
 */

import {
  MATRIX_CHANNEL,
  type CityTransitMatrix,
  type MatrixChannelData,
  type MatrixChannelKey,
  type TravelMode,
} from '~shared/schema'

/** 每格固定 4 位 */
export const CELL_LEN = 4

/** 不适用哨兵 */
export const NA = '0000'

/** 4 位 base36 的上限：36⁴ − 1 = 1,679,615（距离约 1,680 km，时长约 466 小时） */
export const B36_MAX = 36 ** 4 - 1

/**
 * 上三角线性下标。对称：`triIndex(3,1) === triIndex(1,3)`。
 * 例（n=4，共 6 格）：(1,0)→0 (2,0)→1 (2,1)→2 (3,0)→3 (3,1)→4 (3,2)→5
 */
export function triIndex(i: number, j: number): number {
  if (i === j) throw new Error('同一个点没有通勤段')
  const hi = i > j ? i : j
  const lo = i > j ? j : i
  return (hi * (hi - 1)) / 2 + lo
}

/** 一条通道应有的字符串长度（n 个点） */
export function channelLength(n: number): number {
  return (n * (n - 1)) / 2 * CELL_LEN
}

export interface LegHit {
  /** 米 */
  distance: number
  /** 秒 */
  duration: number
}

/**
 * 按下标读取一段通勤。
 * 返回 `null` 表示**该方式不适用**（哨兵 `0000`）—— 注意这与"算不出来"是两件事：
 * 前者是设计上的判定（步行 12 km 算了也没意义），UI 要引导换方式而不是报错。
 */
export function readLegByIndex(
  m: CityTransitMatrix,
  i: number,
  j: number,
  channel: MatrixChannelKey,
): LegHit | null {
  if (i === j) return { distance: 0, duration: 0 }

  const ch: MatrixChannelData = m.modes[channel]
  const k = triIndex(i, j) * CELL_LEN
  const d = ch.distance.slice(k, k + CELL_LEN)
  const t = ch.duration.slice(k, k + CELL_LEN)

  // 字符串被截断（数据损坏）时也按不适用处理，避免 parseInt('') → NaN 流进时间链
  if (d.length < CELL_LEN || t.length < CELL_LEN || d === NA || t === NA) return null

  const distance = parseInt(d, 36)
  const duration = parseInt(t, 36)
  if (!Number.isFinite(distance) || !Number.isFinite(duration)) return null

  return { distance, duration }
}

/** POI id → 矩阵下标。构建一次复用（46 个 POI，构造成本可忽略） */
export function buildPoiIndex(m: CityTransitMatrix): Map<string, number> {
  return new Map(m.poiIndex.map((id, i) => [id, i]))
}

/**
 * 按 POI id 读取一段。
 * 任一 id 不在矩阵里（理论上不该发生，poiIndex 与 pois 必须一致）→ 返 `null`。
 */
export function readLegByPoi(
  m: CityTransitMatrix,
  index: Map<string, number>,
  fromPoiId: string,
  toPoiId: string,
  mode: TravelMode,
): LegHit | null {
  const channel = MATRIX_CHANNEL[mode]
  if (!channel) return null // 公交/地铁不在矩阵里（运行时按需算）

  const i = index.get(fromPoiId)
  const j = index.get(toPoiId)
  if (i === undefined || j === undefined) return null

  return readLegByIndex(m, i, j, channel)
}

/**
 * 矩阵健康度快照 —— 给自检与数据质量报告用。
 * 驾车覆盖率是硬指标（02 文档质量红线要求 > 95%）。
 */
export interface MatrixStats {
  poiCount: number
  cells: number
  byChannel: Record<MatrixChannelKey, { applicable: number; coverage: number }>
}

export function matrixStats(m: CityTransitMatrix): MatrixStats {
  const n = m.poiIndex.length
  const cells = (n * (n - 1)) / 2
  const byChannel = {} as MatrixStats['byChannel']

  for (const key of ['driving', 'walking', 'bicycling'] as MatrixChannelKey[]) {
    const ch = m.modes[key]
    let applicable = 0
    for (let k = 0; k < cells; k++) {
      const d = ch.distance.slice(k * CELL_LEN, k * CELL_LEN + CELL_LEN)
      const t = ch.duration.slice(k * CELL_LEN, k * CELL_LEN + CELL_LEN)
      if (d !== NA && t !== NA) applicable++
    }
    byChannel[key] = { applicable, coverage: cells ? applicable / cells : 0 }
  }

  return { poiCount: n, cells, byChannel }
}

/**
 * 矩阵时间戳的展示文案 —— 产品诚实度的落点。
 *
 * 驾车时长含实时路况，是**生成时刻的快照**，不是恒定量。
 * 必须如实标出 `generatedAt` 与采样时段，**绝不能把快照说成实时**：
 * 一个 9 月生成的矩阵在 12 月被当成"实时路况"展示，就是在误导用户。
 */
export function matrixProvenanceLabel(m: CityTransitMatrix): string {
  return `${m.generatedAt} ${m.sampledAtLabel}`
}

/** 矩阵是否已过"新鲜期"（默认 180 天）—— 超了 UI 上加一句提示，但不阻止使用 */
export function isMatrixStale(m: CityTransitMatrix, now: Date = new Date(), days = 180): boolean {
  const t = Date.parse(m.generatedAt)
  if (!Number.isFinite(t)) return false
  return now.getTime() - t > days * 86_400_000
}
