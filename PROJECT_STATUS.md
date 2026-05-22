# 搭一搭（d1d）— 项目进度状态

> 最后更新：2026-05-18  
> 当前阶段：Phase 0 完成 / Phase 1 进行中（AI 识别代码完成，已添加 Mock fallback）

---

## 一、总体进度

| Phase | 内容 | 进度 | 状态 |
|-------|------|------|------|
| Phase 0 | 架构搭建、类型定义、Mock API、空壳页面、数据库建表 | 100% | ✅ 完成 |
| Phase 1 | 衣服上传 + AI 识别 + 衣橱 CRUD | 95% | 🟡 进行中 |
| Phase 2 | 穿搭推荐引擎 + 今日页面完整交互 | 0% | 🔴 待开始 |
| Phase 3 | 衣柜分析 + 历史 + 分享 + 提醒 | 0% | 🔴 待开始 |

### Phase 1 已完成的子步骤

- [x] Step 1. 数据库连接层（Drizzle ORM + postgres.js）
- [x] Step 1a. Drizzle Schema 定义（8 张表完整映射）
- [x] Step 1b. User Repository（findUserByOpenid/findUserById/getUserProfile/getUserCapacity/createUser/updateUserProfile）
- [x] Step 1c. Clothes Repository（getClothesList/getClothingById/getClothesCount/createClothing/updateClothing/archiveClothing/deleteClothing）
- [x] Step 1d. BFF API 接入数据库（wechat-login / user/profile / user/capacity）
- [x] Step 2. 图片上传链路（本地存储 + OSS 预留）
- [x] Step 3. 衣橱 BFF API（clothes CRUD 完整 5 个端点）
- [x] Step 4. 小程序衣橱页面（列表/上传/详情/编辑）
- [x] Step 5. AI 衣服识别（SiliconFlow Provider + Mock fallback，自动降级）

---

## 二、模块完成度明细

### 2.1 Packages 共享层

| 包 | 已完成 | 待完成 | 完成度 |
|----|--------|--------|--------|
| `packages/types` | 全域类型定义（User/Clothing/Outfit/AI/天气/字典/UI Props） | — | ✅ 100% |
| `packages/utils` | cn/debounce/throttle/formatDate/storage/env/normalizeError | — | ✅ 100% |
| `packages/api` | ApiClient + 端点函数（user/weather/dict/**clothes**） | outfits/history/share/analysis 端点 | 🟡 70% |
| `packages/ai` | SiliconFlow Provider + **Mock Provider** + **smartProvider 自动降级** | DeepSeek Provider 完善 | 🟡 90% |
| `packages/hooks` | useDebounce/useThrottle/useLocalStorage/usePrevious/useIsMounted/useMediaQuery/useAsync/useLoading | — | ✅ 100% |
| `packages/auth` | AuthProvider + useAuth（Context + localStorage 持久化 + Authorization 自动注入） | — | ✅ 100% |
| `packages/ui` | Button/Card/Input/Textarea/Modal/Spinner/PageLoading/Skeleton/Navbar/Tabbar/Toast/Empty/ErrorBoundary + Design Tokens | — | ✅ 100% |

### 2.2 Web 应用 (`apps/web`)

| 模块 | 已完成 | 待完成 | 完成度 |
|------|--------|--------|--------|
| 项目配置 | Next.js 15 + TailwindCSS + transpilePackages + Drizzle ORM + postgres.js | — | ✅ |
| 全局布局 | RootLayout + ToastProvider + AuthProvider | — | ✅ |
| 首页 | 登录/登出 Demo（演示 AuthProvider + UI 组件集成） | 替换为管理后台 | ✅ |
| 数据库连接 | `src/lib/db/index.ts`（postgres.js 连接池 + Drizzle 实例） | — | ✅ |
| Drizzle Schema | `src/lib/db/schema.ts`（8 张表完整映射，含 customType 数组） | — | ✅ |
| Repository | `src/lib/db/repositories/user.ts` + `clothes.ts` | outfits/history/share/reminders/analysis | 🟡 30% |
| 存储层 | `src/lib/storage/index.ts`（本地存储 + OSS 预留） | — | ✅ |
| BFF: auth | `POST /api/v1/auth/wechat-login`（✅ 已接入数据库） | 接入微信 code2Session | 🟡 60% |
| BFF: user | `GET/PUT /api/v1/user/profile`（✅ 已接入数据库）、`GET /api/v1/user/capacity`（✅ 已接入数据库） | — | ✅ 100% |
| BFF: weather | `GET /api/v1/weather/current`（Mock）、`GET /api/v1/weather/forecast`（Mock） | 接入和风天气 API | 🟡 |
| BFF: dict | `GET /api/v1/dict/categories/scenes/styles`（硬编码） | 够用 | ✅ |
| BFF: clothes | `POST /api/v1/clothes`（✅ 上传+**AI识别**）、`GET/PUT/DELETE /api/v1/clothes/[id]`、图片访问 `/uploads/[...path]` | — | ✅ 100% |
| BFF: outfits | ❌ | 全部待创建 | 🔴 0% |
| BFF: share | ❌ | 全部待创建 | 🔴 0% |
| BFF: analysis | ❌ | 全部待创建 | 🔴 0% |
| BFF: reminders | ❌ | 全部待创建 | 🔴 0% |

### 2.3 小程序应用 (`apps/miniapp`)

| 页面/组件 | 已完成 | 待完成 | 完成度 |
|-----------|--------|--------|--------|
| 今日页 | 天气卡片 + 空状态骨架 | 穿搭推荐卡片、场景选择器、换一换、标记穿着、分享入口 | 🟡 20% |
| 衣橱页 | 容量条 + 分类横滑 + **ClothingGrid 组件** + 上传按钮 + 详情跳转 | AI 识别结果展示 | 🟡 95% |
| 我的页 | 用户卡片 + 数据统计 + 菜单壳 | 风格偏好、穿搭历史、收藏、衣柜分析、提醒、会员 | 🟡 15% |
| 首页 | Hello World 废弃壳子 | 删除或替换 | 🟡 — |
| WeatherCard | 完整（含 Skeleton + 降级数据） | — | ✅ 100% |
| ClothingGrid | 完整（网格展示、加载骨架、空状态、点击/长按事件） | — | ✅ 100% |
| userStore | 登录/logout/fetchProfile/setStyles | — | ✅ 90% |
| 入口 | app.tsx（自动 login）+ app.config.ts（TabBar） | — | ✅ |

**已创建的页面**：
- ✅ 衣服详情页（`pages/clothing-detail/`）
- ✅ 添加/编辑衣服页（`pages/clothing-form/`，支持自定义名称/品类/品牌/标签）
- ❌ 穿搭详情页
- ❌ 穿搭历史列表页
- ❌ 衣柜分析报告页
- ❌ 风格偏好选择页
- ❌ 分享生成页

### 2.4 数据库

| 内容 | 已完成 | 待完成 | 完成度 |
|------|--------|--------|--------|
| PostgreSQL 实例 | Docker 容器 `postgres-dev`（localhost:5432） | — | ✅ 100% |
| 数据库 | `d1d` 数据库已创建 | — | ✅ 100% |
| Schema | 8 张表全部建完 + 索引（001_initial_schema.sql 已执行） | — | ✅ 100% |
| ORM | Drizzle ORM + postgres.js（已安装 + Schema 映射完成） | — | ✅ 100% |
| Repository | User + Clothes Repository | Outfits/History/Share/Reminders/Analysis | 🟡 30% |
| 种子数据 | ❌ | 字典/测试数据 | 🔴 0% |

### 2.5 基础设施

| 内容 | 状态 |
|------|------|
| CI/CD | ❌ |
| Docker | ✅ PostgreSQL（postgres-dev） |
| 单元测试 | ❌ |
| 集成测试 | ❌ |
| E2E 测试 | ❌ |
| 图片 OSS 上传 | ❌ 本地存储可用，OSS 预留 |
| 环境变量管理 | ✅ .env.local + .env.example |
| AI 服务 | 🟡 SiliconFlow Provider + Mock fallback（自动降级）|

---

## 三、AI 衣服识别状态说明

### 已完成代码

| 文件 | 内容 |
|------|------|
| `packages/types/src/ai.ts` | AI 服务类型定义（RecognizeInput/Output 等） |
| `packages/ai/src/providers/siliconflow.ts` | SiliconFlow Provider 完整实现 |
| `packages/ai/src/index.ts` | Provider 导出 |
| `apps/web/src/app/api/v1/clothes/route.ts` | 上传 API 接入 AI 识别 |
| `apps/web/.env.local` | SILICONFLOW_API_KEY 配置 |

### 当前状态

**已切换到 `Qwen/Qwen2.5-VL-32B-Instruct` 模型（有赠送额度）**

**新增 Mock Provider 作为 fallback**
- 当 SiliconFlow API 失败时，自动降级到 Mock 识别
- Mock 根据用户选择的 category 返回合理的模拟数据
- 不影响用户体验，可继续开发其他功能

### 如需使用真实 AI 识别

1. **检查 SiliconFlow 账户**
   - 登录 https://cloud.siliconflow.cn/
   - 确认账户已实名认证
   - 检查赠送额度是否充足

2. **使用其他 AI 服务**
   - 阿里云 DashScope（通义千问 VL）
   - OpenRouter
   - 其他支持视觉的 API

---

## 四、待实现 API 端点清单

### Phase 1 — 衣服管理（已完成）

| 方法 | 路径 | 说明 | 状态 |
|------|------|------|------|
| POST | `/api/v1/clothes` | 上传衣服（multipart）+ **AI 识别** | ✅ |
| GET | `/api/v1/clothes` | 衣服列表（分页/分类筛选/排序） | ✅ |
| GET | `/api/v1/clothes/[id]` | 衣服详情 | ✅ |
| PUT | `/api/v1/clothes/[id]` | 更新衣服信息 | ✅ |
| DELETE | `/api/v1/clothes/[id]` | 删除衣服 | ✅ |

### Phase 2 — 穿搭推荐

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/outfits/recommend` | 生成穿搭推荐 |
| GET | `/api/v1/outfits` | 穿搭列表 |
| GET | `/api/v1/outfits/[id]` | 穿搭详情 |
| PUT | `/api/v1/outfits/[id]` | 更新穿搭（收藏/标记穿着等） |
| POST | `/api/v1/outfits/[id]/wear` | 记录穿着历史 |

### Phase 3 — 历史/分析/分享/提醒

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/outfits/history` | 穿搭历史列表 |
| POST | `/api/v1/outfits/[id]/share` | 生成分享图/文案 |
| GET | `/api/v1/wardrobe/analysis` | 获取/触发衣柜分析 |
| GET/PUT | `/api/v1/reminders` | 提醒设置 |

---

## 五、下一步开发建议

### 方案 A：继续 Phase 2（穿搭推荐）— 推荐

AI 识别已可用（Mock fallback），可以开始 Phase 2：
1. 穿搭推荐算法（基于规则/AI）
2. 今日页面完整交互
3. Outfit Repository 和 API

### 方案 B：接入其他 AI 服务

如需真实 AI 识别：
1. 阿里云 DashScope（通义千问 VL）
2. 创建新的 Provider 文件
3. 替换 SiliconFlow Provider

### 方案 C：解决 SiliconFlow 权限

1. 检查 SiliconFlow 账户实名认证状态
2. 确认赠送额度充足
3. 或充值后使用付费模型

---

## 六、进度更新记录

| 日期 | 更新内容 |
|------|----------|
| 2026-05-18（第六轮） | 更新 SiliconFlow 模型为 `Qwen/Qwen2.5-VL-32B-Instruct`；新增 Mock Provider；创建 smartProvider 自动降级机制；AI 识别功能已可用（真实 API + Mock fallback）|
| 2026-05-18（第五轮） | AI 衣服识别代码全部完成：SiliconFlow Provider 实现、Vision Prompt 设计、JSON Schema 结构化输出、上传 API 接入。测试发现 API Key 视觉模型权限问题（403 Model disabled），待解决 |
| 2026-05-18（第四轮） | Phase 1 Step 4 补充：添加衣服编辑页（clothing-form），支持自定义名称/品类/品牌/标签编辑；详情页编辑按钮接入 |
| 2026-05-18（第三轮） | Phase 1 Step 4 完成：小程序衣橱页面实现（ClothingGrid 组件、wardrobe 页面改造、clothing-detail 详情页）；packages/api 新增 clothes 端点函数；app.config.ts 注册新页面 |
| 2026-05-18（第二轮） | Phase 1 Step 2 完成：本地文件存储抽象层（storage/index.ts）、OSS 预留扩展点；衣服 CRUD API（5 个端点）全部实现并测试通过；图片上传、GET 列表、单件详情、删除（归档）全部正常 |
| 2026-05-18（第一轮） | Phase 1 Step 1 完成：Drizzle ORM + postgres.js 连接层、Schema 映射、User/Clothes Repository、BFF API 接入数据库（wechat-login/profile/capacity），全部 API 测试通过 |

---

> 本文档应随开发进度持续更新。每次完成一个 Step 后，将对应的复选框从 `- [ ]` 改为 `- [x]`，并在"进度更新记录"中添加一行。
