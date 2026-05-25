# PROJECT_STATUS.md - 搭搭 day 当前状态

> 最后更新：2026-05-22  
> 用途：给后续 Codex session 快速接手，减少重复扫描和上下文消耗。  
> 维护原则：优先记录已确认事实；不确定内容标记为“待确认”。

---

## 1. 项目定位

- 产品名：搭搭 day。
- 形态：微信小程序。
- 核心链路：用户上传衣服到衣柜 -> AI 识别衣物属性 -> 按天气、场景、衣柜生成穿搭推荐。
- 产品方向：年轻化、AI 感、穿搭潮流风格。
- 产品边界：轻量日常穿搭助手，不是电商导购。

---

## 2. 技术栈

- 仓库：pnpm workspace / monorepo。
- 根包管理：`pnpm@9.15.0`，根 `package.json` 仍显示 `starter-template` 名称，后续是否改名待确认。
- 小程序：Taro 4 + React 18 + Zustand，目标平台为微信小程序。
- 微信能力：`apps/miniapp/project.config.json` 确认 `cloudfunctionRoot` 为 `cloudfunctions/`。
- 云开发：存在微信云函数，已确认 `generateOutfit` 云函数。
- 云函数说明与配置维护见 `docs/cloud-functions.md`。
- AI 模块：衣物识别/推荐相关模块已接入到小程序链路，细节以云函数和页面实现为准。
- 天气能力：`generateOutfit` 可接收 `event.weather`，并有 fallback weather；真实天气接入状态待确认。
- Web/BFF、数据库、共享 packages 的当前落地状态：待确认，本次低上下文更新未重新读取。

---

## 3. 当前模块状态

| 模块 | 状态 | 已确认依据 |
| --- | --- | --- |
| 衣柜上传 / 衣物管理 | 部分实现 | `wardrobe` 页面包含衣柜列表、分页、分类、上传入口、删除入口。 |
| 图片裁剪 / 衣物展示 | 部分实现 | 衣柜页已确认上传前图片压缩；裁剪能力待确认。 |
| AI 识别衣物属性 | 部分实现 | 衣柜页存在 `recognizeClothAttributes` 和批量上传后确认流程；`recognizeClothing` 云函数文件本次未确认存在。 |
| 场景选择卡片 UI | 待确认 | 本次未读取到相关页面。 |
| `generateOutfit` 云函数 | 已实现 | 已确认支持 `generate/detail/favorite/wear/list` 行为。 |
| 推荐页 / 穿搭展示 | 待确认 | 本次未读取到 `outfit` 页面入口。 |
| 真实天气接入 | 待确认 | 仅确认推荐云函数支持传入天气和 fallback。 |
| 收藏穿搭 | 部分实现 | `generateOutfit` 支持 `favorite` 行为和 `isFavorite/favoritedAt` 字段。 |
| 穿搭历史 / 穿他按钮 | 部分实现 | `generateOutfit` 支持 `wear` 行为、`wornAt/wornDate/isWornToday` 和 `feedback` 记录。具体 UI 待确认。 |
| 一图多衣 | 设计中 | 已列为后续重要能力，本次未确认实现。 |
| 多图上传 | 部分实现 | 衣柜页 `chooseMedia` count 为 9，并创建 upload batch。 |

---

## 4. 最近关键决策

- 删除衣服不能简单硬删，需要考虑软删除、历史快照或引用关系。
- 同一套穿搭可以同时存在于收藏记录和穿搭历史。
- “换一套”不应该无脑保存推荐记录，应该明确用户行为后再入库。
- AI 点评倾向短点评，后续可考虑详情页直接展示或按钮按需生成。
- 一张图多件衣服、一次上传多张图片是后续重要能力，需要分阶段改造。
- 为节省 Codex 额度，后续任务需要小范围读取、最小改动、避免全仓库扫描。

---

## 5. Git 与验证状态

- Git 仓库：已初始化。
- GitHub 远程：`origin` 为 `https://github.com/lemzdo/dada-day-miniapp.git`。
- 当前分支：`main`。
- 当前状态：用户说明此前已确认 clean；本次执行 `git status --short` 也为 clean。
- 本次未运行 `pnpm install`、`pnpm build`、`pnpm typecheck`、`pnpm test`。
- 历史验证，本次未重新执行：
  - 曾运行 `pnpm typecheck -- --pretty false`，通过，9 个 workspace successful。
  - 曾运行 `node --check apps\miniapp\cloudfunctions\generateOutfit\index.js`，通过。

---

## 6. 当前开发约束

- 不要全仓库扫描。
- 每次 Codex 任务优先读取 `PROJECT_STATUS.md`。
- 小程序端避免引入重型依赖。
- 云函数保持 Node16 兼容。
- UI 保持年轻化、干净、圆角卡片、轻 AI 感。
- 新功能优先最小改动。
- 修改前先看 `git status --short`，修改后用 `git diff -- <file>` 检查。
- 不要读取或输出真实 API key / secret / token。

---

## 7. 下一步建议

1. 优先梳理收藏穿搭 / 穿搭历史 / 穿他 的数据模型和状态关系。
2. 再做 AI 点评 / 推荐语生成。
3. 再做一图多衣和批量上传的完整体验。
4. 每完成一个小功能就提交 Git，避免改动堆积。

---

## 8. 后续接手建议

- 先读本文件，再按任务只读必要文件。
- 如果任务涉及推荐闭环，优先查看：
  - `apps/miniapp/cloudfunctions/generateOutfit/index.js`
  - 推荐/今日/穿搭相关页面入口，具体路径待确认。
- 如果任务涉及衣柜，优先查看：
  - `apps/miniapp/src/pages/wardrobe/index.tsx`
  - 衣物详情、上传确认、云函数封装文件，具体路径按任务再确认。
