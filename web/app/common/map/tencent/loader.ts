/**
 * SDK 单例加载器。
 *
 * ## 核心原则
 * **地图挂掉绝不能导致页面不可用。** 列表、筛选、详情、三级下钻的区划列表、
 * 以及行程规划的时间计算都是底线功能，必须独立于地图存活。
 * 所以这里的所有失败路径都返回**可识别的错误**，由 UI 渲染降级卡片，而不是抛到顶层炸掉整页。
 *
 * ## 三个必须处理的失败
 * | 场景 | 表现 |
 * |------|------|
 * | key 未配置 / 是占位符 | 引导卡片「配置地图 key 后解锁地图」+ 自备 key 入口 |
 * | key 无效 / 域名不在白名单 | 「地图配置有误，请检查域名白名单」+ 重试 |
 * | 加载失败 / 超时（>10s） | 「地图加载失败」+ 重试 |
 */

import { resolveTmapKey, type KeySource } from './config'

export type MapErrorCode = 'no-key' | 'load-failed' | 'timeout' | 'invalid-key'

export class MapConfigError extends Error {
  constructor(
    readonly code: MapErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'MapConfigError'
  }
}

export interface MapLoadResult {
  sdk: typeof TMap
  keySource: KeySource
}

const LOAD_TIMEOUT_MS = 10_000

let sdkPromise: Promise<MapLoadResult> | null = null

/**
 * 加载 SDK（单例：重复调用不会重复插 script）。
 *
 * 失败后**允许重试** —— 超时往往是网络抖动，把 promise 重置掉让用户可以点重试。
 */
export function loadTMapSdk(): Promise<MapLoadResult> {
  if (sdkPromise) return sdkPromise

  sdkPromise = new Promise<MapLoadResult>((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new MapConfigError('load-failed', '非浏览器环境无法加载地图 SDK'))
      return
    }

    const { key, source } = resolveTmapKey()
    if (!key) {
      reject(new MapConfigError('no-key', '未配置地图 key'))
      return
    }

    // 已经载入过（比如 HMR 或第二次挂载）直接复用
    if (window.TMap) {
      resolve({ sdk: window.TMap, keySource: source })
      return
    }

    let settled = false
    const fail = (err: MapConfigError) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      sdkPromise = null // 允许重试
      reject(err)
    }

    const timer = setTimeout(() => {
      fail(new MapConfigError('timeout', '地图 SDK 加载超时（10s）'))
    }, LOAD_TIMEOUT_MS)

    const script = document.createElement('script')
    // libraries=geometry 供距离/面积计算使用；v=1.exp 是腾讯当前 GL 版本
    script.src = `https://map.qq.com/api/gljs?v=1.exp&key=${encodeURIComponent(key)}&libraries=geometry`
    script.async = true
    script.crossOrigin = 'anonymous'

    script.onload = () => {
      if (settled) return
      if (!window.TMap) {
        // 脚本 200 但没挂上 TMap，通常是 key 被拒（腾讯用这种方式返回错误）
        fail(new MapConfigError('invalid-key', '地图 key 无效或域名不在白名单内'))
        return
      }
      settled = true
      clearTimeout(timer)
      resolve({ sdk: window.TMap, keySource: source })
    }

    script.onerror = () => {
      fail(new MapConfigError('load-failed', '地图 SDK 加载失败'))
    }

    document.head.appendChild(script)
  })

  return sdkPromise
}

/**
 * 腾讯 key 无效时**不会**给一个明确的失败事件，常见表现是脚本能下但地图区域空白、
 * 控制台里有错误码。所以额外提供一个"地图创建后确认"的检查点：
 * 建图后若 3 秒内没触发过任何 ready 类事件，就当作可疑并记日志（不直接判死，避免误伤慢网）。
 */
export function warnIfMapLikelyFailed(map: TMap.Map, onSuspect: (msg: string) => void): () => void {
  const timer = setTimeout(() => {
    try {
      const zoom = map.getZoom()
      if (!Number.isFinite(zoom)) {
        onSuspect('地图未能正常初始化，可能是 key 无效或域名未加入白名单')
      }
    } catch {
      onSuspect('地图实例状态异常')
    }
  }, 3000)
  return () => clearTimeout(timer)
}

/** 错误码 → 给用户看的中文文案 */
export function mapErrorText(err: unknown): string {
  if (err instanceof MapConfigError) {
    switch (err.code) {
      case 'no-key':
        return '尚未配置地图 key'
      case 'invalid-key':
        return '地图配置有误，请检查 key 与域名白名单'
      case 'timeout':
        return '地图加载超时'
      default:
        return '地图加载失败'
    }
  }
  return err instanceof Error ? err.message : '地图加载失败'
}
