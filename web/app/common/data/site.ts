/**
 * 站点级常量 —— **唯一出处**。
 *
 * ## 为什么要单独一个文件
 * 仓库地址要出现在**两个地方**（顶栏那枚 GitHub 图标 + 「关于」弹窗的「开源」一节）。
 * 两处各写一遍字符串，等于给"改仓库地址"这件事留一个必然漏改的点 ——
 * 而漏改的后果是**顶栏按钮指向一个已失效或别人的仓库**，比没有按钮严重得多。
 *
 * ★ 同类理由见 `map/tencent/config.ts` 的 `KEY_APPLY_URL`：外链一律走常量，不散落字符串。
 *
 * ## 改地址时只改这一处
 * `GITHUB_REPO_URL` 是**仓库根**，其余路径由它派生 —— 不要在别处再拼 `'/issues'`。
 */

/** 仓库根（唯一的真源，git remote origin）。 */
export const GITHUB_REPO_URL = 'https://github.com/lin0306/travel_strategy'

/** 提 issue —— 「关于」弹窗里"内容有误请反馈"真正要指向的地方。 */
export const GITHUB_ISSUES_URL = `${GITHUB_REPO_URL}/issues`

/** 许可证名。与仓库根的 `LICENSE` 文件一致 —— 改一处要记得改另一处。 */
export const LICENSE_NAME = 'Apache-2.0'

/**
 * 站名。顶栏站标（`Brand.tsx`）、关于弹窗、海报页脚三处用的是同一个词，
 * 所以 `document.title` 也从这里取 —— 别在 `root.tsx` 里再写一遍字面量，
 * 否则改站名时标签页会留旧名（而标签页恰恰是最不容易被自己看到的地方）。
 */
export const SITE_NAME = '行迹'

/** 副标题 / 一句话定位。窄屏顶栏会藏掉它，但标签页与分享卡片必须有。 */
export const SITE_TAGLINE = '城市旅游攻略'

/** `document.title` 的完整形态 */
export const SITE_TITLE = `${SITE_NAME} · ${SITE_TAGLINE}`

/**
 * `<meta name="description">` 与 `og:description` 的正文。
 *
 * 写给**没打开过这个站的人**看的一句话（搜索结果、分享卡片、社交平台预览）：
 * 说清「是什么」+「能做到哪一步」，不堆形容词。
 */
export const SITE_DESCRIPTION =
  '把地图当目录的旅游攻略：全国 → 省 → 市 → 景点一路缩放钻下去，点位、图片、开放时间与门票都在同一张地图上。'