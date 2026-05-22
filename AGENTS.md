# AGENTS.md - 搭一搭项目长期上下文

本文件面向 Codex / Cursor / Copilot 等 AI 编程工具，用作项目长期记忆。后续开发应优先遵循本文，再结合源码现状做最小、稳妥的改动。

---

## 1. 项目目标

**搭一搭（d1d）** 是一个面向微信小程序用户的智能穿搭助手。

核心目标：

1. 用户上传衣物图片，系统自动识别衣物品类、颜色、风格、季节、材质和适用场景。
2. 用户在衣橱中管理自己的衣物，包括查看、编辑、分类、删除和容量统计。
3. 系统结合天气、场景、用户偏好和衣橱数据，生成今日穿搭推荐。
4. 用户可以收藏穿搭、确认今日穿着、查看历史记录，并逐步获得衣柜分析、提醒和分享能力。

产品定位不是电商导购，而是一个轻量、日常、可信赖的私人衣橱与穿搭决策工具。

---

## 2. 技术架构

项目是 pnpm workspace monorepo。

```text
d1d/
├── apps/
│   ├── web/          # Next.js 15 + React 19，承担 Web Demo / BFF API / 数据访问
│   ├── miniapp/      # Taro 4 + React 18，小程序主应用
│   └── uploads/      # 本地上传图片目录，开发阶段使用
├── packages/
│   ├── types/        # 共享 TypeScript 类型，零运行时依赖
│   ├── utils/        # SSR-safe 工具函数
│   ├── api/          # 共享 API 客户端与端点函数
│   ├── ui/           # Web React UI 组件库
│   ├── hooks/        # 通用 React hooks
│   ├── auth/         # Web AuthProvider
│   └── ai/           # AI Provider 与 AI 服务接口实现
├── database/
│   └── migrations/   # PostgreSQL 初始化迁移
├── tsconfig.base.json
├── turbo.json
└── pnpm-workspace.yaml
```

主要技术：

- 包管理：pnpm 9，禁止 npm / yarn。
- 构建编排：TurboRepo 2。
- Web/BFF：Next.js 15 App Router、React 19、TailwindCSS v3。
- 小程序：Taro 4、React 18、SCSS、Zustand。
- 数据库：PostgreSQL + Drizzle ORM + postgres.js。
- AI：SiliconFlow 视觉模型 Provider + Mock Provider fallback；穿搭推荐当前主要使用服务端规则引擎。
- 类型：TypeScript strict，全局 `noUncheckedIndexedAccess: true`。

内部包引用必须使用 `workspace:*`，禁止 `file:` 或跨包相对路径。

---

## 3. 当前业务模块

已实现或部分实现的模块：

- 用户：mock 微信登录、用户资料、容量信息。
- 衣橱：衣物上传、本地存储、AI 识别、衣物列表、详情、编辑、归档/删除 API。
- 天气：current/forecast mock API，尚未接入真实天气服务。
- 字典：分类、场景、风格等基础字典 API。
- 穿搭推荐：规则推荐引擎、outfits repository、推荐 API、收藏/更新/删除 API。
- 穿着历史：确认穿着、历史列表、满意度评价、简单统计 API。
- 小程序页面：首页占位、今日、衣橱、我的、衣物详情、衣物表单。

仍需重点补齐的模块：

- 真实微信 code2Session 登录与服务端 token 校验。
- 统一小程序 API baseUrl 和鉴权注入。
- 真实天气 API 与天气缓存。
- 穿搭详情页、穿搭历史页、收藏列表、偏好设置页。
- 衣柜分析、提醒、分享图和分享文案。
- 测试、CI、端到端验收。

---

## 4. 代码规范

### TypeScript

- 所有项目必须继承根 `tsconfig.base.json`。
- 保持 `strict: true` 和 `noUncheckedIndexedAccess: true`。
- 仅类型导入必须使用 `import type`。
- package 内部可使用相对路径；跨 package 必须通过 `@starter-template/*` 包名导入。
- `packages/types` 只能包含类型定义，禁止引入运行时依赖。
- 新增共享类型先放到 `packages/types/src/`，再由 `src/index.ts` barrel export。

### React

- 组件使用函数声明，不使用 `React.FC`。
- Props 使用 `interface XxxProps`。
- children 显式声明为 `React.ReactNode`。
- Next.js 页面可使用 HTML 标签；Taro 小程序页面禁止 HTML 标签。

### API

- BFF API 放在 `apps/web/src/app/api/v1/**/route.ts`。
- API 响应统一形态：

```ts
{
  code: number;
  data: T;
  message: string;
}
```

- 新增业务接口时，同步更新：
  1. `packages/types` 中的请求/响应类型。
  2. `apps/web/src/app/api/v1/**` 的 BFF route。
  3. `packages/api/src/**` 的客户端函数。
  4. `packages/api/src/index.ts` 的导出。

### 质量命令

在 PowerShell 执行 pnpm 可能触发脚本策略问题，优先使用：

```bash
cmd /c pnpm typecheck
cmd /c pnpm lint
cmd /c pnpm format
```

提交或交付前至少保证相关 package 的 `typecheck` 通过。全量当前目标是 `cmd /c pnpm typecheck && cmd /c pnpm lint`。

---

## 5. UI 风格

### 小程序

小程序是主产品界面，视觉方向：

- 生活方式工具感：轻、干净、温和、可日常使用。
- 白色/浅灰底色，卡片式信息承载，柔和阴影，清晰层级。
- 重点突出衣物图片、穿搭组合、天气和推荐理由。
- 操作路径要短：上传衣物、查看详情、生成推荐、收藏、确认穿着都应直达。
- 文案应自然、有帮助，不要营销腔。

小程序技术约束：

- 只能使用 `@tarojs/components`，如 `View`、`Text`、`Image`、`ScrollView`。
- 禁止在 miniapp 中写 `div`、`span`、`img`、`button` 等 HTML 标签。
- 页面样式使用 `.scss`，设计稿基准 750px，使用 px，由 Taro 转换。
- 页面目录结构：

```text
apps/miniapp/src/pages/<page>/
├── index.tsx
├── index.config.ts
└── index.scss
```

### Web

Web 目前主要承担 BFF 和 Demo 管理入口，不是核心用户端。

- 使用 Next.js App Router。
- 全局样式在 `apps/web/src/app/globals.css`。
- Web UI 可使用 `packages/ui` 的 Tailwind React 组件。
- 若后续建设管理后台，风格应偏安静、密集、可扫描，不做营销式落地页。

---

## 6. 开发原则

1. **类型先行**：新增业务能力先定义领域类型，再实现 API、数据层和页面。
2. **主链路优先**：优先保证上传衣物 -> 衣橱管理 -> 推荐穿搭 -> 确认穿着 -> 历史记录这条 MVP 链路稳定。
3. **服务端负责核心逻辑**：推荐算法、数据库读写、AI 调用、鉴权校验放在 BFF/服务端，不放在小程序页面里。
4. **共享边界清晰**：可复用类型、工具、API client 放 packages；具体页面状态和交互留在 apps。
5. **渐进式 AI**：先用规则和 mock 保证体验稳定，再逐步引入真实 AI 增强。
6. **可降级**：AI、天气、图片存储等外部能力失败时，应有明确 fallback。
7. **少做无关重构**：除非直接服务当前任务，不做大范围重命名、格式化或架构搬迁。
8. **端到端验证**：功能完成不等于代码写完，至少验证类型、关键接口和核心交互。

---

## 7. 禁止事项

- 禁止使用 npm / yarn，必须使用 pnpm。
- 禁止在 `packages/types` 中引入运行时库。
- 禁止跨 package 使用相对路径导入。
- 禁止在 miniapp 中使用 HTML 标签。
- 禁止使用 `React.FC`。
- 禁止在子 tsconfig 中重复或随意覆盖根配置中的 strict/moduleResolution 等核心选项。
- 禁止引入循环依赖。
- 禁止把真实密钥写入代码或提交到仓库。
- 禁止在前端暴露敏感服务端 API key。
- 禁止让小程序直接调用 AI/天气/数据库第三方密钥服务，必须经 BFF。
- 禁止让推荐接口无控制地制造大量重复数据；推荐保存应考虑幂等、缓存或去重。
- 禁止删除或重置用户已有工作，除非用户明确要求。

---

## 8. AI 模块职责

AI 代码位于 `packages/ai`，类型位于 `packages/types/src/ai.ts`。

当前职责：

1. **衣物识别**
   - 输入衣物图片 URL 和可选品类 hint。
   - 输出品类、子品类、颜色、风格标签、季节标签、材质、场景标签、置信度。
   - 默认优先调用 SiliconFlow，失败时 fallback 到 Mock Provider。

2. **穿搭推荐**
   - 当前主推荐逻辑在 `apps/web/src/lib/recommend/engine.ts`，属于规则引擎。
   - 输入衣橱、天气、场景、偏好、最近穿过记录。
   - 输出穿搭组合、评分、评分解释、推荐理由。
   - 后续可由 AI Provider 增强，但不应破坏规则 fallback。

3. **衣柜分析与文案**
   - Mock Provider 已预留 `analyzeWardrobe` 和 `generateCopywrite`。
   - 未来用于风格分布、颜色分布、缺失单品建议、分享文案生成。

AI 设计原则：

- AI 输出必须经过类型校验、默认值兜底和错误处理。
- AI 不直接写数据库，由 BFF 编排并保存结果。
- AI 失败不应阻断主流程，除非该流程没有合理 fallback。
- 识别结果允许用户后续编辑，不能把 AI 判断视为不可更改事实。

---

## 9. 数据库设计原则

数据库使用 PostgreSQL，迁移文件在 `database/migrations/`，Drizzle schema 在 `apps/web/src/lib/db/schema.ts`。

当前核心表：

- `users`：微信用户、风格偏好、容量、会员、提醒时间。
- `clothes`：衣物图片、AI 识别结果、用户自定义字段、状态、统计。
- `outfits`：穿搭方案、衣物 ID 数组、场景、日期、天气快照、评分、收藏/今日穿着状态。
- `outfit_history`：穿着历史、日期、满意度、备注。
- `share_records`：分享记录。
- `reminders`：提醒设置。
- `wardrobe_analyses`：衣柜分析报告。
- `weather_cache`：天气缓存。

设计原则：

- 所有用户数据必须有 `user_id` 并做用户隔离。
- 软删除/归档优先于物理删除，除非明确需要删除数据。
- 图片存储保存 URL，不把二进制图片写入数据库。
- 外部快照型数据，如天气，写入 outfit/history 时应保存快照，避免历史记录随外部天气变化。
- JSONB 可用于 AI 原始结果、评分解释、风格分布等半结构化数据，但核心查询字段应保持明确列。
- 新增表必须配套 migration、Drizzle schema、repository 和类型。
- Repository 层负责数据库访问，Route Handler 不应散落复杂 SQL。

---

## 10. 页面开发规范

### 小程序页面

主页面：

- `pages/today`：今日天气、场景选择、穿搭推荐、收藏、确认穿着。
- `pages/wardrobe`：衣橱列表、容量、分类筛选、上传入口。
- `pages/profile`：用户信息、统计、功能入口。

详情/辅助页面：

- `pages/clothing-detail`：衣物详情。
- `pages/clothing-form`：新增/编辑衣物信息。
- 未来新增 `pages/outfit-detail`、`pages/outfit-history`、`pages/style-preferences`、`pages/wardrobe-analysis`、`pages/reminders`。

页面开发要求：

- 每个页面必须有清晰 loading、empty、error 状态。
- 能下拉刷新或分页的页面，要避免重复请求和竞态覆盖。
- 页面只做交互编排，不承载复杂业务算法。
- 跳转路径必须注册到 `apps/miniapp/src/app.config.ts`。
- 新增页面时同步创建 `index.config.ts` 和 `index.scss`。

### Web 页面

- 页面放 `apps/web/src/app/**/page.tsx`。
- API route 放 `apps/web/src/app/api/v1/**/route.ts`。
- Web 管理端后续应与小程序主链路区分，不要把 Demo 登录误认为真实用户体系。

---

## 11. 组件复用规范

### packages/ui

`packages/ui` 是 Web React 组件库，使用 TailwindCSS。

- 面向 Next/Web，不默认用于 Taro 小程序。
- 组件签名尽量兼容 React 18/19，但 peer dependency 当前偏 React 19。
- 不使用 `React.FC`。
- 新组件必须从 `packages/ui/src/index.ts` 导出。

### miniapp components

小程序复用组件放在 `apps/miniapp/src/components/`。

当前已有：

- `WeatherCard`：天气卡片。
- `ClothingGrid`：衣物网格。

未来建议新增：

- `OutfitCard`：穿搭推荐卡片。
- `SceneSelector`：场景选择器。
- `ScoreTags` 或 `ScoreBars`：评分展示。
- `HistoryList`：穿搭历史列表。

复用判断：

- 只在一个页面使用且逻辑简单，可先 inline。
- 跨两个以上页面使用，或包含复杂样式/状态，抽到 components。
- 与业务模型强绑定的小程序组件放 miniapp；纯 Web 组件放 packages/ui。

---

## 12. 命名规范

### 文件与目录

- 页面目录使用 kebab-case：`clothing-detail`、`clothing-form`、`outfit-history`。
- React/Taro 组件文件可使用 `index.tsx`，组件名使用 PascalCase。
- repository 文件使用业务单数或领域名：`user.ts`、`clothes.ts`、`outfit.ts`。
- API client 文件按领域命名：`user.ts`、`clothes.ts`、`outfit.ts`、`weather.ts`。

### TypeScript

- interface/type：PascalCase，如 `Clothing`、`OutfitHistory`。
- 函数：camelCase，如 `getClothesList`、`confirmWear`。
- 变量/字段：camelCase。
- 常量：UPPER_SNAKE_CASE，如 `MOCK_WEATHER`。
- React/Taro 组件：PascalCase，如 `WeatherCard`。
- Zustand store hook：`useXxxStore`。

### 业务命名

- 衣物：`clothing` 表示单件；`clothes` 表示集合或 API 领域。
- 穿搭方案：`outfit`。
- 穿着历史：`outfitHistory`。
- 衣柜/衣橱分析：`wardrobeAnalysis`。
- 场景：`scene`。
- 风格偏好：`preferredStyles`。

---

## 13. Roadmap

### 阶段 A：稳定 MVP 基座

- 修复全量 typecheck/lint。
- 补齐 `apps/web` 对 `@starter-template/ai` 等实际依赖的声明和 transpile 配置。
- 统一 API baseUrl：小程序、shared apiClient、BFF 均以 `/api/v1` 为准。
- 统一 Authorization 注入与 token 持久化。
- 衣橱上传前支持品类选择，删除真正接入 API，容量读取 user capacity。

### 阶段 B：穿搭闭环

- 推荐接口增加幂等、去重或缓存策略，避免每次刷新无意义堆积 outfits。
- 今日页完善交互状态、场景切换竞态处理、确认穿着后的状态同步。
- 新增穿搭详情页。
- 新增穿搭历史页，支持满意度评价。
- 我的页接入真实用户数据、衣物数、穿搭数、历史天数。

### 阶段 C：真实外部服务

- 接入微信 code2Session，替换 mock openid。
- 引入服务端 token/JWT/session 校验，保护用户数据。
- 接入真实天气 API，并启用 `weather_cache`。
- 图片存储从本地升级到 OSS/CDN，并保留本地开发 fallback。

### 阶段 D：智能增强

- 衣柜分析：风格分布、颜色分布、品类缺口、低使用率衣物。
- 风格偏好设置：引导用户选择偏好并影响推荐排序。
- AI 推荐增强：在规则引擎结果基础上生成更自然的理由和搭配建议。
- 分享图与分享文案。
- 穿搭提醒与天气变化提醒。

### 阶段 E：工程化

- 单元测试：utils、recommend engine、repository mapper。
- API 集成测试：clothes、outfits、history。
- 小程序关键链路 E2E：上传衣物 -> 推荐 -> 确认穿着 -> 历史。
- CI：typecheck、lint、test。
- 数据库迁移管理流程和种子数据。

---

## 14. 当前开发提醒

截至当前分析，项目已经不是 starter template，而是业务 MVP 中段。不要把 Web 首页 demo、mock 登录、mock 天气误判为最终能力。

优先级最高的是：先让项目可稳定编译，再打通小程序真实主链路。后续所有新增功能都应围绕“衣橱数据质量”和“穿搭推荐闭环”展开。
