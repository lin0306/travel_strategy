/**
 * 本地唯一 id。
 *
 * ★ 单独一个文件是为了**打断循环依赖**：`store.ts`（行程）与 `planStops.ts`（规划点位）
 *   都要发 id，而两者之间不能互相 import（`planStops` 被 `planStore` 用，
 *   `store` 迟早要反向依赖 `planStore`）—— 同 `emptyDay.ts` 的理由。
 *
 * ★ 为什么不用 `crypto.randomUUID()`：它要求**安全上下文**（HTTPS / localhost），
 *   而这几页会通过内网 IP + http 打开（真机联调），那时 `crypto.randomUUID` 直接是
 *   `undefined`，报错出现在"新建一个点位"这种核心动作上。时间戳 + 自增计数器
 *   在同一毫秒内也不会撞，且零依赖、任何环境都有。
 */

let counter = 0

/** 前缀区分用途（`it` 点位 / `stay` 住宿段 / `plan` 规划），便于看日志时一眼认出 */
export function newUid(prefix = 'it'): string {
  counter += 1
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`
}
