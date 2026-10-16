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