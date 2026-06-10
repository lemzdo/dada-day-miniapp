# 搭一搭微信云开发 MVP 改造清单

## 已改造内容

- 小程序启动时在 `apps/miniapp/src/app.tsx` 调用 `initCloud()`。
- 云环境 ID 统一放在 `apps/miniapp/src/config/cloud.ts` 的 `CLOUD_ENV_ID`。
- 小程序主链路已改为 `wx.cloud`：
  - 登录：`login`
  - 衣橱列表/详情/容量：`getWardrobe`
  - 图片上传：`wx.cloud.uploadFile`
  - 上传后识别入库：`analyzeClothes`
  - 编辑衣服：`updateClothes`
  - 删除衣服：`deleteClothes`
  - 今日推荐、穿搭详情、收藏、确认穿着：`generateOutfit`
  - 所在地实时天气：`getWeather`
- 新增云函数目录：
  - `cloudfunctions/login`
  - `cloudfunctions/analyzeClothes`
  - `cloudfunctions/generateOutfit`
  - `cloudfunctions/getWeather`
  - `cloudfunctions/getWardrobe`
  - `cloudfunctions/updateClothes`
  - `cloudfunctions/deleteClothes`
  - `cloudfunctions/submitFeedback`
- `analyzeClothes` 只从云函数环境变量读取 `SILICONFLOW_API_KEY`，小程序前端不包含 API Key。
- `apps/miniapp/project.config.json` 已配置 `cloudfunctionRoot`。
- `apps/miniapp` 已移除对自建 BFF API client、`localhost`、`/api/v1`、`Taro.uploadFile` 的使用。

## 云数据库集合

请在微信云开发控制台创建这些集合：

- `users`
- `clothes`
- `outfits`
- `outfit_history`
- `ai_tasks`
- `user_feedback`
- `feedback`（legacy 历史行为反馈集合，仅保留旧数据，不再用于用户意见反馈）

建议 MVP 阶段集合权限设置为：

- `users`：仅创建者可读写，云函数可管理。
- `clothes`：仅创建者可读写，云函数可管理。
- `outfits`：仅创建者可读写，云函数可管理。
- `outfit_history`：仅创建者可读写，云函数可管理，当前“穿它 / 穿搭历史”主链路写入这里。
- `ai_tasks`：仅创建者可读，写入只通过云函数。
- `user_feedback`：仅创建者可读写，云函数可管理，用于用户意见反馈。
- `feedback`：legacy 历史行为反馈集合，旧数据可能包含 `type: wear_confirm`、`outfitId`、`clothingIds`、`scene`、`wearDate` 等字段；当前不再作为穿搭历史主链路，也不要写入新的用户意见反馈。

## 手动配置步骤

1. 在微信开发者工具中开通云开发，创建云环境。
2. 把云环境 ID 填到 `apps/miniapp/src/config/cloud.ts`：

```ts
export const CLOUD_ENV_ID = '你的云环境 ID';
```

3. 在云开发控制台创建上面的数据库集合；如已有 legacy `feedback`，保留即可，不需要迁移或删除。
4. 在云函数环境变量中配置：

```text
SILICONFLOW_API_KEY=你的硅基流动 API Key
SILICONFLOW_MODEL=Qwen/Qwen2.5-VL-72B-Instruct
```

`SILICONFLOW_MODEL` 可选，不配会使用默认值。

5. 在微信开发者工具里上传并部署全部云函数，部署时安装依赖：
   - `login`
   - `analyzeClothes`
   - `generateOutfit`
   - `getWeather`
   - `getWardrobe`
   - `updateClothes`
   - `deleteClothes`
   - `submitFeedback`
6. 确认 `apps/miniapp/project.config.json` 的 `appid` 是你自己的小程序 AppID。
7. 运行：

```bash
cmd /c pnpm --filter @starter-template/miniapp typecheck
cmd /c pnpm --filter @starter-template/miniapp build:weapp
```

8. 用微信开发者工具打开 `apps/miniapp`，预览并验证：
   - 首次进入自动登录并在 `users` 创建用户。
   - 衣橱页上传图片后云存储出现文件。
   - `clothes` 集合新增衣物记录。
   - `ai_tasks` 记录识别任务状态。
   - 今日页能基于衣橱生成搭配并写入 `outfits`。
   - 收藏能更新 `outfits`，确认穿着会写入 `outfit_history`。
   - 用户意见反馈会写入 `user_feedback`，不会写入 legacy `feedback`。

## 当前扫描结果

小程序上线链路中没有发现：

- `localhost`
- `127.0.0.1`
- `/api/v1`
- `@starter-template/api`
- 前端硬编码 API Key 或 secret

仓库中仍保留历史 Web/BFF 代码与文档，里面还有 `localhost`、mock、`DATABASE_URL`、`WECHAT_APP_SECRET`、`QWEATHER_API_KEY`、`OSS_ACCESS_KEY_*` 等环境变量引用。这些不参与本次微信云开发小程序上线链路；如后续确定完全弃用自建服务，可单独清理 `apps/web`、`packages/api`、`packages/ai` 中的旧 BFF 路径。

## MVP 限制

- 天气通过 `getWeather` 云函数按用户经纬度请求 Open-Meteo 实时天气；定位失败或天气服务失败时使用本地降级数据。
- 风格偏好页面先保存到前端状态，后续可新增 `updateUserProfile` 云函数持久化到 `users.styleProfile`。
- 当前“穿它 / 穿搭历史”主链路使用 `outfit_history`；legacy `feedback` 仅保留早期行为反馈历史数据，不要求迁移或删除。
- 用户意见反馈使用 `user_feedback`，不要与 legacy `feedback` 混用。
