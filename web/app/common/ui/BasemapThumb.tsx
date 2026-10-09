/**
 * 底图缩略图 —— 底图菜单里每个类型左边那一小张「这张图长什么样」。
 *
 * ## 为什么是自绘 SVG，而不是真实瓦片截图
 * 缩略图要回答的问题只有一个：**这两种底图看起来差在哪**。为它去请求一张真图，
 * 代价是给纯静态站引入一个新的网络失败点（腾讯静态图还要单独开通产品权限），
 * 而收益只是"更像真的"。自绘的三个好处是实的：
 *   · 零请求、离线可用，与"数据全部构建期固化"的架构一致；
 *   · 色板可以**故意拉开**（矢量冷灰白 / 影像暗橄榄），比两张真图更容易一眼分辨；
 *   · 不会因为将来换了底图服务商而变成一张过时的图。
 * ⚠️ 它**不是**地图预览 —— 不要拿它去对齐真实底图的配色，那样只会两头不像。
 *
 * ## 为什么颜色是硬编码 hex
 * 这里画的不是界面，是**地图外观的示意图**。它不该跟随主题 token（夜间主题下
 * "矢量图长什么样"也不会变），所以刻意不用 `--color-*`。与 `Icon` 的 sprite
 * 用裸路径是同一个态度。
 *
 * ## 画的是什么
 * | | 内容 |
 * |---|---|
 * | 矢量 | 浅底 · 绿地 · 水系 · 白色路网 · 建筑块（对应 `base` 那一层的样子） |
 * | 影像 | 暗橄榄地表 · 田块/植被斑块 · 浅色路网（对应 `base` 的卫星影像） |
 */

import type { BasemapKind } from '~/common/map/tencent'

export interface BasemapThumbProps {
  kind: BasemapKind
  className?: string
}

/** 画布比例接近地图窗口（3:2 偏扁），圆角与菜单里其它小方块一致 */
const VIEW = '0 0 40 28'

export function BasemapThumb({ kind, className }: BasemapThumbProps) {
  return (
    <svg
      viewBox={VIEW}
      width={40}
      height={28}
      role="img"
      aria-label={kind === 'vector' ? '矢量底图示意' : '影像底图示意'}
      className={className}
    >
      {kind === 'vector' ? <Vector /> : <Satellite />}
    </svg>
  )
}

function Vector() {
  return (
    <>
      <rect width="40" height="28" fill="#eef2f7" />
      {/* 绿地与水系：这两样是底图里最容易被忽略、又最能区分"矢量/影像"的地物 */}
      <path d="M0 19 L11 13 L23 17 L31 12 L40 15 L40 28 L0 28 Z" fill="#cfe3c8" />
      <path d="M0 7 Q9 4.5 17 8 T40 7 L40 11 Q30 12.5 17 9.5 T0 11 Z" fill="#bcd8f2" />
      {/* 建筑块：矢量底图上最典型的"灰色小方块" */}
      <rect x="14" y="15" width="6" height="5" fill="#d3d9e3" />
      <rect x="22" y="16.5" width="5" height="4" fill="#d3d9e3" />
      <rect x="6" y="20" width="5" height="4" fill="#d3d9e3" />
      {/* 路网：白色描线，压在绿地上 */}
      <path d="M1 25 L39 5" stroke="#ffffff" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M7 1 L12 27" stroke="#ffffff" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M27 0.5 L31 27.5" stroke="#ffffff" strokeWidth="1.7" strokeLinecap="round" />
    </>
  )
}

function Satellite() {
  return (
    <>
      <rect width="40" height="28" fill="#3f4a34" />
      {/* 地表斑块：不求真实，只求"像航拍"（颜色块互不相同的碎拼） */}
      <path d="M0 0 H17 V12 H0 Z" fill="#55603f" />
      <path d="M22 0 H40 V9 H22 Z" fill="#6d6549" />
      <path d="M0 15 H13 V28 H0 Z" fill="#4a5540" />
      <path d="M18 13 H40 V28 H18 Z" fill="#5d5240" />
      <path d="M12 0 H17 V9 H12 Z" fill="#7a7255" />
      <path d="M13 19 H18 V28 H13 Z" fill="#38492f" />
      {/* 建筑/田垄的细碎高光 */}
      <rect x="2.5" y="17" width="3" height="2" fill="#6f6a52" opacity="0.9" />
      <rect x="6" y="21.5" width="4" height="2.5" fill="#6f6a52" opacity="0.75" />
      <rect x="25" y="16" width="4" height="3" fill="#7b7358" opacity="0.8" />
      <rect x="31" y="21" width="5" height="3" fill="#7b7358" opacity="0.7" />
      <rect x="26" y="2" width="5" height="3" fill="#8b8365" opacity="0.7" />
      {/* 路网比矢量底图更细、偏米白 */}
      <path d="M2 23 L38 6" stroke="#ded8c9" strokeWidth="2" strokeLinecap="round" />
      <path d="M29 1 L33 27" stroke="#d0c9b9" strokeWidth="1.3" strokeLinecap="round" />
    </>
  )
}
