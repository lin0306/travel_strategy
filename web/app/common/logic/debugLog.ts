/**
 * 控制台调试输出口 —— 一个开关、一种前缀、零依赖。
 *
 * ## 为什么单独成文件（而不是并进 `mapLog.ts`）
 * `mapLog.ts` 是**显示结果的日志**（store + 面板 + 文本导出），它 `import type`
 * 了 `~/common/map/tencent` 的层级类型；而引擎层（`map/tencent/useTMap.ts`）需要打
 * **手势事实**的日志。若让它直接 import `mapLog.ts`，就形成
 * `map/tencent → lib/mapLog → map/tencent` 的环（哪怕只是类型，也把两个层次绑死）。
 *
 * 所以这里只留最薄的一层：**前缀 + 开关**。谁都能依赖它，它不依赖任何人。
 *
 * ## 开关策略
 * **DEV 常开、线上带 `?dbg` 才开。** 这条链每一步都可能刷屏（缩放一次会连发
 * `zoom` + `center_changed` + `bounds_changed`），线上无脑打会淹没真正的报错；
 * 而开发时它恰恰是最该常开的信息。
 *
 * 运行时开关：`window.__mapLog.off()` / `window.__mapLog.on()`。
 */

let enabled = ((): boolean => {
  if (import.meta.env.DEV) return true
  if (typeof window === 'undefined') return false
  return /[?&]dbg\b/.test(window.location.search)
})()

/**
 * 打一条调试日志。
 *
 * @param channel 频道名，如 `显示` / `手势` —— 用户在控制台里按
 *   `地图·显示` 过滤就能只看"屏幕上有什么"，按 `地图·手势` 只看操作时序。
 * @param text 多行文本。**多行是有意的**：层级 / 屏幕内容 / 候选 / 名字是并列
 *   关系，挤一行得自己找分隔符，分行之后"哪一项是 0"一眼可见 ——
 *   而"明明是市徽标那一级，圆点却是 0"正是要抓的东西。
 */
export function debugLog(channel: string, text: string): void {
  if (!enabled) return
  console.log(
    `%c[地图·${channel}]%c ${text}`,
    'color:#e5a13a;font-weight:700',
    '',
  )
}

export function setDebugLog(on: boolean): void {
  enabled = on
  if (on) debugLog('提示', '调试日志已开启（输入 __mapLog.off() 可关闭）')
}
