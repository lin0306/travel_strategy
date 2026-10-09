/**
 * 「这一次到底是**点击**，还是**拖地图**？」—— 唯一判据。
 *
 * ## 为什么需要它
 * 地图上的点击事件**不能只看事件本身**。拖动地图是"**按在某个东西上开始**"的 ——
 * 起点随机落在哪枚标记、哪个聚合气泡上都不奇怪。于是"点中了某个覆盖物"这个判定
 * 完全没法区分：
 *
 * ```
 * 用户按在聚合点上 → 拖动看别处 → 松手
 *   · 地图认为：这是一次地图拖动（正确）
 *   · 覆盖物认为：指针离我很近，我被点中了（错误）
 * ```
 * 用户 2026-10-05 报的就是它：「把鼠标选中的功能关掉，有时候我**拖动地图**，
 * 那个**聚合点就被选中了**」。
 *
 * ## 判据
 * **按下到抬起之间，指针移动超过 `slopPx` 像素 ⇒ 不是点击。**
 * 它与"点的是哪一个"（按指针到目标的距离裁）是**两个正交的判据**，谁都不能替代谁：
 * 一个管"算不算点击"，一个管"点的是哪一个"。
 *
 * ★ 这里**不自己实现"点击后触发什么"** —— 只回答两个问题：
 *   `pointer()`（按下时指针在哪）与 `isTap()`（这次算不算点击）。
 */

/**
 * 按下后**移动超过这个距离**（像素）⇒ 判定为"拖地图"。
 *
 * ## 6 是怎么来的
 * 浏览器与地图库普遍把 `3~10px` 视作"手抖"区间（`click` 本身的容差）。
 * 取中段：真想拖地图不可能只移动 6px（那个距离地图几乎没动），
 * 而手抖几乎不会超过 6px。**宁可放过一次真实的点击**（再点一下就是），
 * 也不要让"每次拖动都可能误触发"—— 后者是高频动作。
 *
 * ⚠️ 触摸屏抖动比鼠标大，真要上触摸时这个值该调到 8~10。目前站点以鼠标为主。
 */
export const TAP_SLOP_PX = 6

/**
 * 「禁止选中地图里的文字」的**模块级引用计数**。
 *
 * ## 为什么不能每个实例各存一份原值（2026-10-05 审查发现）
 * 同一张地图上有 **5~6 个** `tapGuard`（`poiClicks` / `poiCluster` / `poiLayer` /
 * `districtLayer` / `markerLayer` / `routeLayer` 各一个），它们**共享同一个容器**。
 * 每个实例各存一份"我创建那一刻的值"会变成：
 * - 先建的抓到原值（多为 `''`），**后建的全部抓到 `'none'`**（被前一个写过了）；
 * - **先建的销毁时会把 `none` 抹掉** —— 而后面那些实例还活着、正依赖它。
 *
 * ⇒ 于是"文字能不能被选中"**取决于销毁顺序**。当前恰好被 `poiLayer.destroy()`
 *   的调用顺序掩盖着（先 `clicks.destroy()` 还原 `''`、紧接着 `cluster.destroy()`
 *   又设回 `'none'`），但只要调整顺序、或 `cluster` 没被建立（数据未就绪就退出页面），
 *   用户报过的「按住底图晃、文字被选中」就会**原样复现**。
 *
 * ⇒ 引用计数：**第一次**置 `none` 时记下原值，**计数归零**才还原。
 */
let selectHold = 0
let selectPrev: { el: HTMLElement; userSelect: string; webkit: string } | null = null

function holdNoSelect(el: HTMLElement): void {
  if (selectHold === 0) {
    selectPrev = {
      el,
      userSelect: el.style.getPropertyValue('user-select'),
      webkit: el.style.getPropertyValue('-webkit-user-select'),
    }
    // ★ 带 `important`：内联样式虽然优先级很高，但压不过 SDK 自己的 `!important`
    el.style.setProperty('user-select', 'none', 'important')
    el.style.setProperty('-webkit-user-select', 'none', 'important')
  }
  selectHold += 1
}

function releaseNoSelect(): void {
  if (selectHold === 0) return
  selectHold -= 1
  if (selectHold > 0 || !selectPrev) return
  // 容器是 SDK 的、会跨页面复用 —— 我们只是借它一段时间，得原样还回去
  selectPrev.el.style.setProperty('user-select', selectPrev.userSelect)
  selectPrev.el.style.setProperty('-webkit-user-select', selectPrev.webkit)
  selectPrev = null
}

export interface TapGuard {
  /**
   * 指针**最后一次按下**时的客户端坐标；从没按过 = `null`。
   * 给"点的是哪一个"那类判据用（例如"簇心离指针多远"）。
   */
  pointer: () => { x: number; y: number } | null
  /** 本次按下累计移动过的最大距离（像素） */
  moved: () => number
  /** 本次按下算不算一次**点击**（移动没超过 `TAP_SLOP_PX`） */
  isTap: () => boolean
  /** 解绑全部监听（图层拆掉时调） */
  destroy: () => void
}

/**
 * 挂到某个地图实例上。
 *
 * ⚠️ **用捕获阶段**：地图自己的手势处理会 `stopPropagation`，冒泡阶段收不到。
 */
export function createTapGuard(map: TMap.Map, slopPx: number = TAP_SLOP_PX): TapGuard {
  let pointer: { x: number; y: number } | null = null
  let moved = 0

  const onDown = (e: MouseEvent) => {
    pointer = { x: e.clientX, y: e.clientY }
    moved = 0
  }
  const onMove = (e: MouseEvent) => {
    if (!pointer) return
    const d = Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y)
    if (d > moved) moved = d
  }

  /**
   * ★★★ **禁止浏览器对图片的"原生拖拽"** —— 这是"拖标记而不是拖底图"的直接原因。
   *
   * ## 现象（用户 2026-10-05）
   * 「我拖动一下地图就把这个数字选中了，然后再拖就是在**拖动这个数字而不是底图**了」
   *
   * ## 为什么会这样
   * 腾讯的标记（数字气泡、景点圆点、独立点图标）画出来都是 **`<img>`**，
   * 而 **`<img>` 在浏览器里默认可拖拽**（`draggable` 默认 `true`）。
   * 按在它上面往旁边拖 ⇒ 浏览器启动一次"**拖这张图片**"的原生拖拽 ⇒
   * 这一串手势**从来没到地图手里**，所以底图纹丝不动、只有那张图在跟手。
   *
   * ⚠️ 与 `isTap()` 是**两条独立的修，缺一不可**：
   * | 判据 | 管什么 |
   * |---|---|
   * | `isTap()` | 拖完之后**别把这一下误当成点击**（否则一拖就误选中） |
   * | 本函数 | 拖动**本身要能落到地图上**（否则根本拖不动底图） |
   * 上一轮我只做了前者，所以你看到的仍然是"拖不动底图"。
   *
   * ★ 用 `dragstart` 的**捕获阶段**拦，而不是给每个 `<img>` 设 `draggable=false`：
   *   标记是聚合器**随视野反复重建**的，逐个设属性必然漏掉新建的那些；
   *   而在容器上拦一次，对**此后任何**新增元素都有效。
   * ★ 顺带拦 `<a>`：有些 SDK 版本的标记外面包了一层链接。
   */
  const onDragStart = (e: Event) => {
    const t = e.target
    if (t instanceof HTMLImageElement || t instanceof HTMLAnchorElement) e.preventDefault()
  }

  const container = map.getContainer?.() ?? null
  container?.addEventListener('mousedown', onDown, true)
  container?.addEventListener('pointerdown', onDown, true)
  container?.addEventListener('mousemove', onMove, true)
  container?.addEventListener('pointermove', onMove, true)
  container?.addEventListener('dragstart', onDragStart, true)

  /**
   * ★★★ **禁止容器内的文本选择**（`user-select: none`）。
   *
   * ## 现象（用户 2026-10-05）
   * 「还是能选中，我是鼠标**按住底图**，然后**左右晃**，然后这个聚合点的**文字**
   * 就被选中了」—— 看图是气泡里那个数字被蓝色高亮。
   *
   * ## 为什么
   * "按住 + 移动"同时是**两种手势**的触发条件：
   * | 起点在哪 | 浏览器认为你在 |
   * |---|---|
   * | **图片**上 | 拖这张图（原生拖拽）—— `dragstart` 那条拦的就是它 |
   * | **文字**上（或划过了文字） | **选中这段文字** ← 本函数拦的是它 |
   *
   * 聚合气泡的数字是**文字节点**，鼠标从它上面划过去就被纳入选区 ⇒
   * 看上去就像"这个点被选中了"。上一轮只拦了前者，
   * 而用户是**按住底图**晃的（起点不在图上、但**划过了**气泡的文字），所以照选不误。
   *
   * ## 为什么直接关整个容器
   * 地图上的文字一律不需要被选中 —— 没有"复制地名"这种场景，各大地图 App 也都不给选。
   * 逐个元素设 `user-select` 反而会漏（标记是聚合器随视野反复重建的）。
   *
   * ★ 销毁时**恢复原值**（不是无脑设成 `''`）：容器是 SDK 的、可能跨页面复用，
   *   我们只是借它一段时间。
   */
  /**
   * ★ **第二道保险：拦 `selectstart`。**
   *
   * `user-select: none` 是**样式层**的约束 —— 一旦 SDK 在某个子元素上
   * 又写了一遍 `user-select: auto`（或带 `!important`），它就被盖掉了，
   * 而那种覆盖**只表现为"某些文字还是能选中"**，很难定位。
   * 所以样式之外再在**事件层**兜一次：`selectstart` 直接 `preventDefault`。
   */
  const onSelectStart = (e: Event) => e.preventDefault()
  container?.addEventListener('selectstart', onSelectStart, true)

  // ★ 引用计数式的禁选（理由见 `holdNoSelect` 上方那段）—— 别退回"每个实例各存一份原值"
  if (container) holdNoSelect(container)

  /**
   * ⚠️ **不要在 `mouseup` / `pointerup` 里清 `pointer`** —— `click` 是在
   * `mouseup` **之后**派发的，提前清掉会让"离指针多远"那类判据一律返回 0（不裁），
   * 于是"点景点却把远处气泡也放大"的老毛病会原样回来。
   * 它由下一次按下重置，留着没有任何副作用。
   */

  return {
    pointer: () => pointer,
    moved: () => moved,
    isTap: () => moved <= slopPx,
    destroy: () => {
      // 解禁选（引用计数归零才真的还原）—— 见 `holdNoSelect`
      if (container) releaseNoSelect()
      container?.removeEventListener('selectstart', onSelectStart, true)
      container?.removeEventListener('dragstart', onDragStart, true)
      container?.removeEventListener('mousedown', onDown, true)
      container?.removeEventListener('pointerdown', onDown, true)
      container?.removeEventListener('mousemove', onMove, true)
      container?.removeEventListener('pointermove', onMove, true)
    },
  }
}
