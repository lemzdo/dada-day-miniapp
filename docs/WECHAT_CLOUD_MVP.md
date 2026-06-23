# 搭一搭微信云开发 MVP 改造清单

> 最后更新：2026-06-23

## 已改造内容

- 小程序启动时在 `apps/miniapp/src/app.tsx` 调用 `initCloud()`。
- 云环境 ID 统一放在 `apps/miniapp/src/config/cloud.ts` 的 `CLOUD_ENV_ID`。
- 小程序主链路已改为 `wx.cloud`：
  - 登录：`login`
  - 衣橱列表/详情/容量：`getWardrobe`
  - 图片上传：`wx.cloud.uploadFile`
  - 上传后识别入库：`processUploadImage` (Pipeline V2)
  - 编辑衣服：`updateClothes`
  - 删除衣服：`deleteClothes`
  - 今日推荐、穿搭详情、收藏、确认穿着：`generateOutfit`
  - 所在地实时天气：`getWeather`（高德 API）
  - 自定义细分类：`getUserClothingSubcategories` / `createUserClothingSubcategory`
  - 自定义材质：`getUserClothingMaterials` / `createUserClothingMaterial`
  - 用户资料更新：`updateUserProfile`
  - 意见反馈：`submitFeedback`
- `apps/miniapp/project.config.json` 已配置 `cloudfunctionRoot`。
- `apps/miniapp` 已移除对自建 BFF API client、`localhost`、`/api/v1` 的使用。

## 云函数清单（25个）

### 用户相关

| 云函数 | 用途 | AI/API 依赖 |
|--------|------|-------------|
| `login` | 微信登录、用户初始化 | 无 |
| `updateUserProfile` | 更新用户资料、风格偏好 | 无 |

### 衣橱相关

| 云函数 | 用途 | AI/API 依赖 |
|--------|------|-------------|
| `getWardrobe` | 衣橱列表查询（分页、筛选） | 无 |
| `createUploadBatch` | 创建上传批次 | 无 |
| `createUploadImage` | 登记上传图片记录 | 无 |
| `processUploadImage` | Pipeline V2 图片处理 | 百炼、VIAPI、OSS |
| `segmentClothImage` | 图片分割增强 | VIAPI、OSS |
| `recognizeClothAttributes` | 属性识别 | 百炼 |
| `confirmClothesDrafts` | 确认保存草稿 | 无 |
| `discardClothesDraft` | 丢弃单个草稿 | 无 |
| `discardUploadBatch` | 丢弃整个批次 | 无 |
| `updateClothes` | 更新衣物信息 | 无 |
| `deleteClothes` | 删除衣物（含影响检查） | 无 |

### 穿搭推荐相关

| 云函数 | 用途 | AI/API 依赖 |
|--------|------|-------------|
| `generateOutfit` | 穿搭推荐、收藏、历史、AI点评 | 百炼（AI点评可选） |

### 天气相关

| 云函数 | 用途 | AI/API 依赖 |
|--------|------|-------------|
| `getWeather` | 天气获取 | 高德 API（AMAP_KEY） |

### 自定义分类相关

| 云函数 | 用途 | AI/API 依赖 |
|--------|------|-------------|
| `getUserClothingSubcategories` | 获取用户自定义细分类 | 无 |
| `createUserClothingSubcategory` | 创建自定义细分类 | 无 |
| `getUserClothingMaterials` | 获取用户自定义材质 | 无 |
| `createUserClothingMaterial` | 创建自定义材质 | 无 |
| `archiveUserClothingMaterial` | 归档自定义材质 | 无 |

### 其他

| 云函数 | 用途 | AI/API 依赖 |
|--------|------|-------------|
| `submitFeedback` | 提交意见反馈 | 无 |
| `backfillClothesThumbnails` | 补填缩略图（运维脚本） | VIAPI、OSS |
| `cleanupDeletedClothes` | 清理已删除衣物（定时触发） | 无 |

## 云数据库集合

请在微信云开发控制台创建这些集合：

### 核心业务集合

| 集合 | 说明 | 权限建议 |
|------|------|----------|
| `users` | 用户信息、风格偏好、容量 | 仅创建者可读写 |
| `clothes` | 衣物数据 | 仅创建者可读写 |
| `upload_batches` | 上传批次记录 | 仅创建者可读写 |
| `upload_images` | 上传图片记录 | 仅创建者可读写 |
| `clothes_drafts` | 衣物草稿 | 仅创建者可读写 |
| `outfits` | 穿搭方案 | 仅创建者可读写 |
| `favorite_outfits` | 收藏穿搭 | 仅创建者可读写 |
| `outfit_history` | 穿搭历史 | 仅创建者可读写 |

### 辅助集合

| 集合 | 说明 | 权限建议 |
|------|------|----------|
| `outfit_ai_reviews` | AI 点评缓存 | 仅创建者可读写 |
| `user_feedback` | 用户意见反馈 | 仅创建者可读写 |
| `weather_cache` | 天气缓存 | 仅创建者可读写 |
| `user_clothing_subcategories` | 用户自定义细分类 | 仅创建者可读写 |
| `user_clothing_materials` | 用户自定义材质 | 仅创建者可读写 |

### Legacy 集合

| 集合 | 说明 |
|------|------|
| `feedback` | legacy 历史行为反馈集合，仅保留旧数据，不再用于用户意见反馈 |
| `ai_tasks` | legacy AI 任务记录，Pipeline V2 后不再使用 |

## 手动配置步骤

### 1. 创建云环境

1. 在微信开发者工具中开通云开发，创建云环境。
2. 把云环境 ID 填到 `apps/miniapp/src/config/cloud.ts`：

```ts
export const CLOUD_ENV_ID = '你的云环境 ID';
```

### 2. 创建数据库集合

在云开发控制台创建上面的数据库集合。

### 3. 配置云函数环境变量

详见 `docs/cloudfunctions-env.md`，关键变量：

**AI 识别必填**：
```text
BAILIAN_API_KEY=sk-xxxx
```

**图片分割必填**：
```text
ALIYUN_ACCESS_KEY_ID=LTAIxxxx
ALIYUN_ACCESS_KEY_SECRET=xxxx
OSS_REGION=oss-cn-shanghai
OSS_BUCKET=d1d-dev-assets
```

**天气获取必填**：
```text
AMAP_KEY=你的高德Web服务Key
```

### 4. 上传部署云函数

在微信开发者工具里上传并部署全部云函数，部署时安装依赖。

### 5. 配置小程序 AppID

确认 `apps/miniapp/project.config.json` 的 `appid` 是你自己的小程序 AppID。

### 6. 构建并预览

```bash
cmd /c pnpm --filter @starter-template/miniapp typecheck
cmd /c pnpm --filter @starter-template/miniapp build:weapp
```

用微信开发者工具打开 `apps/miniapp`，预览并验证。

## 验证清单

- 首次进入自动登录并在 `users` 创建用户。
- 衣橱页上传图片后云存储出现文件。
- `upload_batches`、`upload_images`、`clothes_drafts` 记录正确生成。
- `clothes` 集合新增衣物记录。
- 今日页能基于衣橱生成搭配并写入 `outfits`。
- 收藏能更新 `favorite_outfits`，确认穿着会写入 `outfit_history`。
- 天气卡片能获取真实天气（需配置 AMAP_KEY）。
- 用户意见反馈会写入 `user_feedback`。
- 自定义细分类/材质能正常创建和查询。

## 当前扫描结果

小程序上线链路中没有发现：

- `localhost`
- `127.0.0.1`
- `/api/v1`
- `@starter-template/api`
- 前端硬编码 API Key 或 secret

仓库中仍保留历史 Web/BFF 代码与文档，不参与微信云开发小程序上线链路。

## MVP 限制

- 天气通过 `getWeather` 云函数调用高德 API；定位失败或天气服务失败时使用本地降级数据。
- 风格偏好通过 `updateUserProfile` 持久化到 `users.styleProfile`。
- 当前"穿它 / 穿搭历史"主链路使用 `outfit_history`。
- 用户意见反馈使用 `user_feedback`，不要与 legacy `feedback` 混用。
- 分享功能、衣柜分析报告、消息推送暂未实现。

## 相关文档

- `docs/cloudfunctions-env.md` - 云函数环境变量详细配置
- `docs/PROJECT_STATUS.md` - 项目当前状态和功能清单
- `docs/wardrobe-asset-pipeline-v2.md` - Pipeline V2 技术细节