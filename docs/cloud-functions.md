# 云函数维护文档

本文档维护 `apps/miniapp/cloudfunctions/` 下微信云函数的结构化信息。当前仅基于每个云函数的 `index.js`、`package.json`、`config.json` 和 `docs/PROJECT_STATUS.md` 中相关信息整理，未追踪页面调用来源。

## 1. 文档维护规则

- 新增、删除、重命名云函数时，同步更新总览表和对应详细说明。
- 修改 `exports.main` 的 `event` 入参、返回结构、`db.collection`、`process.env`、`cloud.callFunction`、第三方 SDK 或 `config.json` 触发器时，同步更新本文档。
- 不在本文档大段复制源码，只记录调用契约、依赖和部署注意事项。
- 无法从云函数核心文件确认的信息统一标记为“待确认”，不要为了补全调用来源读取无关页面代码。
- 云函数保持 Node16 兼容；涉及原生依赖或外部服务的函数部署前需单独检查云端依赖安装和环境变量。
- 每次更新请在对应云函数的“更新记录”追加日期和变更摘要。

## 2. 云函数总览

| 云函数 | 入口文件 | 当前状态 | 主要作用 | 数据集合 | 环境变量 | 第三方/重型依赖 |
| --- | --- | --- | --- | --- | --- | --- |
| `cleanupDeletedClothes` | `apps/miniapp/cloudfunctions/cleanupDeletedClothes/index.js` | 使用中 | 定时物理清理软删除衣物和云存储文件 | `clothes` | 无 | 微信云存储 |
| `confirmClothesDrafts` | `apps/miniapp/cloudfunctions/confirmClothesDrafts/index.js` | 待确认 | 将上传草稿确认成正式衣物 | `clothes`, `clothes_drafts`, `upload_batches` | 无 | 无 |
| `createUploadBatch` | `apps/miniapp/cloudfunctions/createUploadBatch/index.js` | 待确认 | 创建/查询多图上传批次 | `clothes_drafts`, `upload_batches`, `upload_images` | 无 | 无 |
| `createUploadImage` | `apps/miniapp/cloudfunctions/createUploadImage/index.js` | 待确认 | 为上传批次登记单张图片 | `upload_batches`, `upload_images` | 无 | 无 |
| `deleteClothes` | `apps/miniapp/cloudfunctions/deleteClothes/index.js` | 待确认 | 软删除衣物并维护穿搭快照 | `clothes`, `outfits`, `favorite_outfits`, `outfit_history` | 无 | 无 |
| `discardClothesDraft` | `apps/miniapp/cloudfunctions/discardClothesDraft/index.js` | 待确认 | 丢弃衣物草稿 | `clothes_drafts` | 无 | 无 |
| `generateOutfit` | `apps/miniapp/cloudfunctions/generateOutfit/index.js` | 使用中 | 生成穿搭、详情、收藏、穿着历史、AI 点评 | `clothes`, `users`, `outfits`, `favorite_outfits`, `outfit_history` | `BAILIAN_API_KEY`, `DASHSCOPE_API_KEY`, `BAILIAN_BASE_URL`, `AI_COMMENT_PROVIDER`, `AI_COMMENT_MODEL`, `AI_COMMENT_TIMEOUT_MS` | `node-fetch`, 阿里云百炼 |
| `getWardrobe` | `apps/miniapp/cloudfunctions/getWardrobe/index.js` | 待确认 | 查询衣橱列表、分页和容量 | `clothes`, `users` | 无 | 无 |
| `getWeather` | `apps/miniapp/cloudfunctions/getWeather/index.js` | 待确认 | 按经纬度获取并缓存天气 | `weather_cache` | `AMAP_KEY`, `WEATHER_CACHE_TTL_MS` | 高德地图 Web 服务 |
| `login` | `apps/miniapp/cloudfunctions/login/index.js` | 待确认 | 基于微信 OpenID 创建/更新用户 | `users` | 无 | 无 |
| `processClothUpload` | `apps/miniapp/cloudfunctions/processClothUpload/index.js` | 待确认 | 单图上传编排：建衣物、抠图、可选识别 | 无直接集合 | 无 | 内部调用云函数 |
| `processUploadImage` | `apps/miniapp/cloudfunctions/processUploadImage/index.js` | 待确认 / 待重构 | 当前代码为 Qwen VL 自动检测 + `sharp` 自动裁剪 + 生成草稿；与“上传后手动裁剪、服饰识别走阿里云 AccessKey”的目标方案不一致 | `clothes_drafts`, `upload_batches`, `upload_images` | 当前代码使用 `BAILIAN_API_KEY`, `BAILIAN_BASE_URL`, `BAILIAN_MODEL`, `QWEN_TIMEOUT_MS`；目标方案待确认 | 当前代码使用 `node-fetch`, `sharp`, 阿里云百炼；目标服务待确认 |
| `recognizeClothAttributes` | `apps/miniapp/cloudfunctions/recognizeClothAttributes/index.js` | 待确认 | 识别单件衣物属性并回写 | `clothes` | `BAILIAN_API_KEY`, `BAILIAN_BASE_URL`, `BAILIAN_MODEL`, `QWEN_TIMEOUT_MS` | `node-fetch`, 阿里云百炼 |
| `segmentClothImage` | `apps/miniapp/cloudfunctions/segmentClothImage/index.js` | 待确认 | 调用阿里云分割能力抠图并回写展示图 | `clothes` | `ALIYUN_ACCESS_KEY_ID`, `ALIYUN_ACCESS_KEY_SECRET`, `ALIYUN_OSS_ACCESS_KEY_ID`, `ALIYUN_OSS_ACCESS_KEY_SECRET`, `ALIYUN_OSS_BUCKET`, `ALIYUN_OSS_REGION`, `ALIYUN_OSS_URL_EXPIRES_SECONDS`, `ALIYUN_OSS_USE_SIGNED_URL`, `ALIYUN_VIAPI_REGION`, `SEGMENT_TIMEOUT_MS` | `@alicloud/pop-core`, `ali-oss`, `node-fetch`, 阿里云 VIAPI/OSS |
| `updateClothes` | `apps/miniapp/cloudfunctions/updateClothes/index.js` | 待确认 | 更新衣物可编辑字段 | `clothes` | 无 | 无 |
| `updateUserProfile` | `apps/miniapp/cloudfunctions/updateUserProfile/index.js` | 待确认 | 更新用户资料和推荐偏好 | `users` | 无 | 无 |
| `uploadClothImage` | `apps/miniapp/cloudfunctions/uploadClothImage/index.js` | 待确认 | 创建待处理衣物记录 | `clothes` | 无 | 无 |
| `uploadClothing` | `apps/miniapp/cloudfunctions/uploadClothing/index.js` | 待确认 | 创建基础衣物记录 | `clothes` | 无 | 无 |

## 3. 关键业务链路

### 3.1 上传衣服逻辑链

本节只基于上传衣服相关云函数核心文件整理，未读取页面代码。调用来源无法确认时统一写为“前端/待确认”。

当前存在两条上传链路：

- 批量上传草稿链路：`createUploadBatch` -> `createUploadImage` -> `processUploadImage` -> `confirmClothesDrafts` / `discardClothesDraft`。当前代码支持一次上传多张图片，也支持一张图片检测出多件衣服并生成多条草稿，但 `processUploadImage` 仍使用 Qwen VL + `sharp` 自动裁剪，和“上传后手动裁剪、服饰识别走阿里云 AccessKey”的目标方案不一致，状态为待确认 / 待重构。
- 单图直接入库链路：`uploadClothing` 或 `uploadClothImage` 创建 `clothes`；`processClothUpload` 可编排 `uploadClothImage` -> `segmentClothImage` -> 可选 `recognizeClothAttributes`。该链路偏单件衣物，不确认支持一图多衣。

`cleanupClothingImageFields` 已删除，不再参与当前链路。历史图片字段的删除后回收兜底仍在 `cleanupDeletedClothes` 中保留。

#### 上传衣服流程总览表

| 步骤 | 触发方 | 调用云函数 | 主要作用 | 输入 | 输出 | 依赖集合 | 依赖环境变量 | 第三方服务/模型 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 前端/待确认 | `createUploadBatch` | 创建 N 张图片的上传批次；`action: detail` 可查询批次明细 | `totalImages` 或 `action: detail`, `batchId` | `batch` 或 `{ batch, images, drafts }` | `upload_batches`, `upload_images`, `clothes_drafts` | 无 | 无 |
| 2 | 前端/待确认 | `createUploadImage` | 为批次登记单张图片任务，并将批次置为 `processing` | `batchId`, `fileID` 或 `originalImageUrl` | `uploadImage` | `upload_batches`, `upload_images` | 无 | 微信云存储 fileID |
| 3 | 前端/待确认 | `processUploadImage` | 当前代码：处理单张图片，Qwen VL 检测多件衣服，`sharp` 自动裁剪，生成草稿 | `imageId` 或 `uploadImageId` | `{ imageId, drafts, errorMessage? }` | `upload_images`, `upload_batches`, `clothes_drafts` | 当前代码使用 `BAILIAN_API_KEY`, `BAILIAN_BASE_URL`, `BAILIAN_MODEL`, `QWEN_TIMEOUT_MS` | 当前代码使用阿里云百炼 Qwen VL、`sharp`、微信云存储；目标方案待确认 |
| 4 | 前端/待确认 | `discardClothesDraft` | 用户丢弃某条草稿 | `draftId` 或 `id` | `{ id }` | `clothes_drafts` | 无 | 无 |
| 5 | 前端/待确认 | `confirmClothesDrafts` | 用户确认草稿，将选中草稿写入 `clothes` | `batchId`, `drafts?` | `{ list, count }` | `upload_batches`, `clothes_drafts`, `clothes` | 无 | 无 |
| 6 | 前端/待确认 | `getWardrobe` | 查询入库后的衣橱列表和容量 | `page`, `pageSize`, `status`, `category`, `id` | `{ list, pagination, capacity }` | `clothes`, `users` | 无 | 无 |
| A | 前端/待确认 | `uploadClothing` | 旧/基础入口：直接创建基础衣物记录 | `fileID`, `category?` | `clothing` | `clothes` | 无 | 微信云存储 fileID |
| B | 前端/待确认 / `processClothUpload` | `uploadClothImage` | 创建待处理衣物记录 | `fileID`, `category?` | `{ clothId, clothingId, originalImageUrl, item }` | `clothes` | 无 | 微信云存储 fileID |
| C | 前端/待确认 | `processClothUpload` | 单图编排：创建衣物、抠图、可选识别 | `fileID`, `category?`, `recognizeNow?` | 抠图后的衣物或创建结果 | 无直接集合 | 无 | 内部调用 `uploadClothImage`, `segmentClothImage`, `recognizeClothAttributes` |
| D | `processClothUpload` / 前端待确认 | `segmentClothImage` | 阿里云 VIAPI 抠图/分割，并回写 `displayImageUrl` | `clothId` 或 `clothingId` | `clothing` | `clothes` | `ALIYUN_ACCESS_KEY_ID`, `ALIYUN_ACCESS_KEY_SECRET`, `ALIYUN_OSS_*`, `ALIYUN_VIAPI_REGION`, `SEGMENT_TIMEOUT_MS` | 阿里云 VIAPI、OSS、微信云存储 |
| E | `processClothUpload` / 前端待确认 | `recognizeClothAttributes` | 识别单件衣物属性并回写 | `clothId` 或 `clothingId` | `clothing` | `clothes` | `BAILIAN_API_KEY`, `BAILIAN_BASE_URL`, `BAILIAN_MODEL`, `QWEN_TIMEOUT_MS` | 阿里云百炼 Qwen VL |
| F | 前端/待确认 | `updateClothes` | 用户编辑衣物字段，维护 `manualFields` | `id`, `data` | `clothing` | `clothes` | 无 | 无 |
| G | 前端/待确认 | `deleteClothes` | 软删除衣物，并维护穿搭/收藏/历史快照 | `id`, `action?: inspect`, `dryRun?` | 影响计数或删除结果 | `clothes`, `outfits`, `favorite_outfits`, `outfit_history` | 无 | 无 |
| H | 定时触发器/手动待确认 | `cleanupDeletedClothes` | 物理删除软删除衣物和关联云存储文件 | `dryRun?`, `retentionDays?`, `allUsers?` | `{ scanned, removed, deletedFiles }` | `clothes` | 无 | 微信云存储 `deleteFile` |

#### N 张图片上传流程

1. 前端选择 N 张图片：具体页面调用来源待确认；原始图片上传到微信云存储的前端步骤未在云函数核心文件中确认。
2. 创建 upload batch：调用 `createUploadBatch`，写入 `upload_batches`，记录 `totalImages`、`processedImages`、`totalDetectedClothes`、`status`。
3. 每张图片创建 image task：对每张图片调用 `createUploadImage`，写入 `upload_images`，记录 `batchId`、`originalImageUrl`、`cloudFileId`、`status`。
4. 上传云存储：云函数只接收 `fileID` / `originalImageUrl`，原始图片具体上传路径待确认。
5. 逐张处理：调用 `processUploadImage`，读取 `upload_images` 和 `upload_batches`，将图片任务置为 `processing`。
6. AI 识别/裁剪：当前代码使用 Qwen VL 返回 `items` 和 `cropBox`，再用 `sharp` 自动裁剪；这与目标方案“上传后手动裁剪、服饰识别走阿里云 AccessKey”不一致，需确认是否重构。
7. 生成草稿：`processUploadImage` 为检测出的每件衣服写入一条 `clothes_drafts`，并更新 `upload_images.detectedCount` 和批次进度。
8. 用户确认：调用 `confirmClothesDrafts`，可先用 `drafts` 入参更新草稿字段和选中状态。
9. 写入 clothes：`confirmClothesDrafts` 将 `selected: true` 且 `status: pending` 的草稿转换为 `clothes` 正式衣物，并将草稿置为 `confirmed`；未选中草稿会置为 `discarded`。

当前支持情况：

- 一次上传多张图片：当前代码支持，核心是 `upload_batches` + `upload_images`。
- 一张图片多件衣服：`processUploadImage` 当前代码支持，会按 Qwen VL 返回的 `items` 创建多条 `clothes_drafts`；但该实现是否符合目标方案待确认。
- 上传后手动裁剪：云函数中未确认到完整手动裁剪处理；当前 `processUploadImage` 是自动裁剪，手动裁剪应视为待确认/预留。

#### AI 与环境变量配置表

| 用途 | 云函数 | 服务商 | 模型 | 环境变量 | 是否必填 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| 批量上传单图多衣检测 | `processUploadImage` | 当前代码：阿里云百炼；目标方案待确认 | 当前代码默认 `qwen3-vl-flash` | `BAILIAN_API_KEY`, `BAILIAN_BASE_URL`, `BAILIAN_MODEL`, `QWEN_TIMEOUT_MS` | `BAILIAN_API_KEY` 对当前代码必填；其余有默认值 | 当前实现与“阿里云服饰识别 + AccessKey”目标不一致 |
| 单件衣物属性识别 | `recognizeClothAttributes` | 阿里云百炼 | 默认 `qwen3-vl-flash` | `BAILIAN_API_KEY`, `BAILIAN_BASE_URL`, `BAILIAN_MODEL`, `QWEN_TIMEOUT_MS` | `BAILIAN_API_KEY` 必填；其余有默认值 | 识别品类、颜色、材质、风格、季节、分数、搭配建议 |
| 单件衣物抠图/分割 | `segmentClothImage` | 阿里云 VIAPI + OSS | `SegmentCloth`, `SegmentCommodity`, `SegmentCommonImage` | `ALIYUN_ACCESS_KEY_ID`, `ALIYUN_ACCESS_KEY_SECRET`, `ALIYUN_OSS_ACCESS_KEY_ID`, `ALIYUN_OSS_ACCESS_KEY_SECRET`, `ALIYUN_OSS_BUCKET`, `ALIYUN_OSS_REGION`, `ALIYUN_OSS_URL_EXPIRES_SECONDS`, `ALIYUN_OSS_USE_SIGNED_URL`, `ALIYUN_VIAPI_REGION`, `SEGMENT_TIMEOUT_MS` | `ALIYUN_ACCESS_KEY_ID`, `ALIYUN_ACCESS_KEY_SECRET`, `ALIYUN_OSS_BUCKET` 对当前代码必填；OSS 专用 Key 可回退到主 Key | 用 OSS 临时承载 VIAPI 输入图，处理后删除 OSS 临时对象 |
| 删除后云文件清理 | `cleanupDeletedClothes` | 微信云存储 | 无 | 无 | 否 | 根据衣物图片字段收集 `cloud://` 文件并调用 `cloud.deleteFile` |

#### 数据库集合流转表

| 集合名 | 写入函数 | 读取函数 | 主要字段 | 说明 |
| --- | --- | --- | --- | --- |
| `upload_batches` | `createUploadBatch`, `createUploadImage`, `processUploadImage` | `createUploadBatch`, `createUploadImage`, `processUploadImage`, `confirmClothesDrafts` | `_openid`, `totalImages`, `processedImages`, `totalDetectedClothes`, `status`, `createdAt`, `updatedAt` | 批量上传任务总进度 |
| `upload_images` | `createUploadImage`, `processUploadImage` | `createUploadBatch`, `processUploadImage` | `_openid`, `batchId`, `originalImageUrl`, `cloudFileId`, `status`, `detectedCount`, `errorMessage`, `aiRawResult` | 批次中的单张图片任务 |
| `clothes_drafts` | `processUploadImage`, `confirmClothesDrafts`, `discardClothesDraft` | `createUploadBatch`, `confirmClothesDrafts`, `discardClothesDraft` | `_openid`, `batchId`, `sourceImageId`, `originalImageUrl`, `croppedImageUrl`, `cropBox`, `type`, `categoryName`, `colors`, `material`, `style`, `confidence`, `selected`, `status` | 用户确认前的衣物草稿 |
| `clothes` | `uploadClothing`, `uploadClothImage`, `confirmClothesDrafts`, `segmentClothImage`, `recognizeClothAttributes`, `updateClothes`, `deleteClothes` | `getWardrobe`, `segmentClothImage`, `recognizeClothAttributes`, `updateClothes`, `deleteClothes`, `cleanupDeletedClothes` | `_openid`, `originalImageUrl`, `displayImageUrl`, `category`, `subcategory`, `colors`, `styleTags`, `seasonTags`, `material`, `cutoutStatus`, `aiRecognizeStatus`, `manualFields`, `status` | 正式衣物数据 |
| `users` | 待确认 | `getWardrobe` | `_openid`, `capacityTotal` | 用于衣橱容量统计 |
| `outfits` | `deleteClothes` 更新快照 | `deleteClothes` | `clothingIds`, `snapshotItems`, `incomplete`, `deletedItemCount` | 删除衣物时维护历史推荐快照 |
| `favorite_outfits` | `deleteClothes` 更新快照 | `deleteClothes` | `clothingIds`, `itemsSnapshot`, `snapshotItems` | 删除衣物时维护收藏快照 |
| `outfit_history` | `deleteClothes` 更新快照 | `deleteClothes` | `clothingIds`, `itemsSnapshot`, `snapshotItems` | 删除衣物时维护穿着历史快照 |

#### 状态流转表

| 状态 | 含义 | 设置函数 | 下一步 |
| --- | --- | --- | --- |
| `upload_batches.pending` | 批次已创建，尚未处理图片 | `createUploadBatch` | 调用 `createUploadImage` 登记图片 |
| `upload_batches.processing` | 批次处理中 | `createUploadImage`, `processUploadImage` | 继续处理每张 `upload_images` |
| `upload_batches.completed` | 批次全部图片处理成功 | `processUploadImage` | 用户确认草稿 |
| `upload_batches.failed` | 批次全部图片处理失败 | `processUploadImage` | 前端展示失败/重试，具体待确认 |
| `upload_batches.partial_failed` | 批次部分图片失败 | `processUploadImage` | 用户确认成功草稿，失败图片处理待确认 |
| `upload_images.pending` | 单张图片已登记，尚未处理 | `createUploadImage` | 调用 `processUploadImage` |
| `upload_images.processing` | 单张图片处理中 | `processUploadImage` | AI 检测/裁剪/生成草稿 |
| `upload_images.completed` | 单张图片处理成功 | `processUploadImage` | 等待用户确认草稿 |
| `upload_images.failed` | 单张图片处理失败 | `processUploadImage` | 前端展示失败/重试，具体待确认 |
| `clothes_drafts.pending` | 草稿待确认 | `processUploadImage` | `confirmClothesDrafts` 或 `discardClothesDraft` |
| `clothes_drafts.confirmed` | 草稿已确认入库 | `confirmClothesDrafts` | 写入 `clothes` 后在衣橱展示 |
| `clothes_drafts.discarded` | 草稿已丢弃 | `discardClothesDraft`, `confirmClothesDrafts` | 不写入 `clothes` |
| `clothes.active` | 正式衣物可见 | `uploadClothing`, `uploadClothImage`, `confirmClothesDrafts` | 可编辑、推荐、删除 |
| `clothes.deleted` | 衣物已软删除 | `deleteClothes` | 等待 `cleanupDeletedClothes` 物理清理 |
| `cutoutStatus.pending` | 等待抠图/分割 | `uploadClothImage` | 调用 `segmentClothImage` |
| `cutoutStatus.success` | 抠图/分割成功 | `segmentClothImage` 或草稿确认默认值 | 用 `displayImageUrl` 展示 |
| `cutoutStatus.failed` | 抠图/分割失败 | `segmentClothImage` | 保留原图或错误提示，具体前端处理待确认 |
| `aiRecognizeStatus.pending` | 等待 AI 属性识别 | `uploadClothImage`, `recognizeClothAttributes` | 调用 `recognizeClothAttributes` |
| `aiRecognizeStatus.success` | AI 属性识别成功 | `recognizeClothAttributes`, `confirmClothesDrafts` | 可编辑、可用于推荐 |
| `aiRecognizeStatus.failed` | AI 属性识别失败 | `recognizeClothAttributes` | 保留衣物并展示失败状态，具体前端处理待确认 |

#### 云存储路径与文件流

- 原始图片：云函数接收 `fileID` / `originalImageUrl` / `cloudFileId`，具体前端上传路径待确认。
- `processUploadImage` 自动裁剪图：当前代码上传到 `wardrobe_uploads/crops/{openid}/{imageId}-{index}-{timestamp}.jpg`。
- `segmentClothImage` 临时 OSS 源图：当前代码上传到 `wardrobe/{openid}/viapi-source/{clothingId}-{timestamp}.{ext}`，处理结束后删除 OSS 对象。
- `segmentClothImage` 微信云抠图结果：当前代码上传到 `wardrobe/{openid}/clothes/cutout/{clothingId}-{timestamp}.png`。
- `cleanupDeletedClothes` 会从衣物记录中的图片字段收集 `cloud://` 文件并调用 `cloud.deleteFile`；旧字段仍作为删除回收兜底保留。

#### 待确认事项

- `processUploadImage` 是否仍要保留；若保留，是否应从 Qwen VL + `sharp` 自动裁剪改为阿里云服饰识别 + 手动裁剪预留。
- 阿里云服饰识别目标服务名称、接口、模型/能力名称，以及对应环境变量是否统一使用 `ALIYUN_ACCESS_KEY_ID` / `ALIYUN_ACCESS_KEY_SECRET`。
- 批量上传链路的前端调用入口和原始图片云存储上传路径。
- 手动裁剪的最终落点：是在前端完成并写入草稿，还是新增/改造云函数处理。
- `uploadClothing` 与 `uploadClothImage` 是否都是有效入口，还是应废弃其中一个。

### 3.2 穿搭推荐逻辑链

待补充。当前已知主入口为 `generateOutfit`，本次未围绕推荐链路读取更多文件。

### 3.3 AI点评逻辑链

待补充。当前已知 `generateOutfit` 支持 `action: 'aiComment'`，本次未围绕 AI 点评链路读取更多文件。

## 4. 云函数详情

### `cleanupDeletedClothes`

- 云函数名：`cleanupDeletedClothes`
- 入口文件路径：`apps/miniapp/cloudfunctions/cleanupDeletedClothes/index.js`
- 当前状态：使用中；`config.json` 存在定时触发器 `dailyCleanupDeletedClothes`。
- 主要作用：物理删除超过保留期的 `status: deleted` 衣物记录，并尝试删除关联云存储文件。
- 调用来源：定时触发器；`config.json` 配置为每日 03:00。
- 入参：`dryRun?: boolean`、`retentionDays?: number`、`allUsers?: boolean`。
- 出参：`{ code, data: { dryRun, cutoff, retentionDays, scanned, removed, deletedFiles }, message }`。
- 依赖数据库集合：`clothes`。
- 依赖环境变量：无。
- 第三方服务依赖：微信云存储 `cloud.deleteFile`。
- 建议内存：256 MB。
- 建议超时时间：60 秒。
- 部署注意事项：部署时同步上传 `config.json` 触发器；首次运行建议 `dryRun`；确认保留期和跨用户范围。
- 更新记录：2026-05-25 首次整理。

### `confirmClothesDrafts`

- 云函数名：`confirmClothesDrafts`
- 入口文件路径：`apps/miniapp/cloudfunctions/confirmClothesDrafts/index.js`
- 当前状态：待确认
- 主要作用：将选中的 `clothes_drafts` 转换为 `clothes` 正式衣物，并丢弃未选中的 pending 草稿。
- 调用来源：待确认；本次未读取页面代码。
- 入参：`batchId: string`、`drafts?: Array<{ id, type, categoryName, color, colors, material, style, selected }>`。
- 出参：`{ code, data: { list, count }, message }`。
- 依赖数据库集合：`clothes`、`clothes_drafts`、`upload_batches`。
- 依赖环境变量：无。
- 第三方服务依赖：无。
- 建议内存：256 MB。
- 建议超时时间：30 秒。
- 部署注意事项：确认批次归属校验通过；并发确认同一批次时可能产生重复衣物，建议后续补幂等保护。
- 更新记录：2026-05-25 首次整理。

### `createUploadBatch`

- 云函数名：`createUploadBatch`
- 入口文件路径：`apps/miniapp/cloudfunctions/createUploadBatch/index.js`
- 当前状态：待确认
- 主要作用：创建多图上传批次；`action: detail` 时返回批次、图片和草稿详情。
- 调用来源：待确认；本次未读取页面代码。
- 入参：创建：`totalImages?: number`；详情：`action: 'detail'`、`batchId: string`。
- 出参：创建返回批次对象；详情返回 `{ batch, images, drafts }`；统一包裹 `{ code, data, message }`。
- 依赖数据库集合：`upload_batches`、`upload_images`、`clothes_drafts`。
- 依赖环境变量：无。
- 第三方服务依赖：无。
- 建议内存：128 MB。
- 建议超时时间：15 秒。
- 部署注意事项：详情接口会读取同批次图片和草稿，需确保集合索引能支撑 `batchId + _openid` 查询。
- 更新记录：2026-05-25 首次整理。

### `createUploadImage`

- 云函数名：`createUploadImage`
- 入口文件路径：`apps/miniapp/cloudfunctions/createUploadImage/index.js`
- 当前状态：待确认
- 主要作用：为上传批次登记一张图片，并将批次状态置为 `processing`。
- 调用来源：待确认；本次未读取页面代码。
- 入参：`batchId: string`、`fileID?: string`、`originalImageUrl?: string`。
- 出参：`{ code, data: uploadImage, message }`。
- 依赖数据库集合：`upload_batches`、`upload_images`。
- 依赖环境变量：无。
- 第三方服务依赖：无。
- 建议内存：128 MB。
- 建议超时时间：15 秒。
- 部署注意事项：调用前需先创建上传批次；只登记元数据，不处理图片内容。
- 更新记录：2026-05-25 首次整理。

### `deleteClothes`

- 云函数名：`deleteClothes`
- 入口文件路径：`apps/miniapp/cloudfunctions/deleteClothes/index.js`
- 当前状态：待确认
- 主要作用：软删除单件衣物，并为受影响的推荐、收藏、历史记录补全或标记快照。
- 调用来源：待确认；本次未读取页面代码。
- 入参：`id: string`、`action?: 'inspect'`、`dryRun?: boolean`。
- 出参：`inspect/dryRun` 返回影响计数；删除返回 `{ id, deletedAt, affectedFavoriteCount, affectedHistoryCount, affectedOutfitCount }`；统一包裹 `{ code, data, message }`。
- 依赖数据库集合：`clothes`、`outfits`、`favorite_outfits`、`outfit_history`。
- 依赖环境变量：无。
- 第三方服务依赖：无。
- 建议内存：256 MB。
- 建议超时时间：45 秒。
- 部署注意事项：先用 `action: 'inspect'` 检查影响；函数会读取最多 500 条相关记录，数据变大后需分页或索引优化。
- 更新记录：2026-05-25 首次整理。

### `discardClothesDraft`

- 云函数名：`discardClothesDraft`
- 入口文件路径：`apps/miniapp/cloudfunctions/discardClothesDraft/index.js`
- 当前状态：待确认
- 主要作用：将衣物草稿标记为未选中并置为 `discarded`。
- 调用来源：待确认；本次未读取页面代码。
- 入参：`draftId?: string`、`id?: string`。
- 出参：`{ code, data: { id }, message }`。
- 依赖数据库集合：`clothes_drafts`。
- 依赖环境变量：无。
- 第三方服务依赖：无。
- 建议内存：128 MB。
- 建议超时时间：10 秒。
- 部署注意事项：仅处理当前用户拥有的草稿。
- 更新记录：2026-05-25 首次整理。

### `generateOutfit`

- 云函数名：`generateOutfit`
- 入口文件路径：`apps/miniapp/cloudfunctions/generateOutfit/index.js`
- 当前状态：使用中；`PROJECT_STATUS.md` 已确认推荐闭环使用该函数。
- 主要作用：按衣橱、天气、场景和偏好生成穿搭；支持详情、收藏、确认穿着、列表、历史和 AI 点评等动作。
- 调用来源：推荐/今日/穿搭相关入口待确认；状态文档确认该云函数已实现并处于主链路。
- 入参：`action?: 'generate' | 'detail' | 'favorite' | 'wear' | 'list' | 'saveFavoriteOutfit' | 'removeFavoriteOutfit' | 'listFavoriteOutfits' | 'addOutfitHistory' | 'listOutfitHistory' | 'aiComment'`；生成动作还使用 `scene`、`date`、`timeOfDay`、`weather`、`excludeClothingIdSets`；其他动作按需使用 `id`、`outfit`、`isFavorite`、`favoriteOutfitId`、`source`、`aiComment` 等。
- 出参：统一 `{ code, data, message }`；生成动作返回 `{ outfits, weather, recommendationNotice }`；收藏/历史/详情/AI 点评按 action 返回对应对象。
- 依赖数据库集合：`clothes`、`users`、`outfits`、`favorite_outfits`、`outfit_history`。
- 依赖环境变量：`BAILIAN_API_KEY`、`DASHSCOPE_API_KEY`、`BAILIAN_BASE_URL`、`AI_COMMENT_PROVIDER`、`AI_COMMENT_MODEL`、`AI_COMMENT_TIMEOUT_MS`。
- 第三方服务依赖：阿里云百炼兼容 OpenAI 接口；`node-fetch`。
- 建议内存：256 MB。
- 建议超时时间：30 秒；启用 `aiComment` 时建议至少 45 秒。
- 部署注意事项：AI 点评缺少密钥时会 fallback；推荐保存逻辑涉及去重/快照，修改前需确认幂等策略；保持 Node16 可运行。
- 更新记录：2026-05-25 首次整理。

### `getWardrobe`

- 云函数名：`getWardrobe`
- 入口文件路径：`apps/miniapp/cloudfunctions/getWardrobe/index.js`
- 当前状态：待确认
- 主要作用：查询当前用户衣橱列表，支持分页、状态、品类过滤，并返回容量信息。
- 调用来源：待确认；本次未读取页面代码。
- 入参：`page?: number`、`pageSize?: number`、`status?: string`、`id?: string`、`category?: string`。
- 出参：`{ code, data: { list, pagination, capacity }, message }`。
- 依赖数据库集合：`clothes`、`users`。
- 依赖环境变量：无。
- 第三方服务依赖：无。
- 建议内存：128 MB。
- 建议超时时间：15 秒。
- 部署注意事项：`pageSize` 最大 50；品类过滤含历史中文值映射，后续字段归一化时需同步调整。
- 更新记录：2026-05-25 首次整理。

### `getWeather`

- 云函数名：`getWeather`
- 入口文件路径：`apps/miniapp/cloudfunctions/getWeather/index.js`
- 当前状态：待确认
- 主要作用：根据经纬度调用高德逆地理和实时天气接口，并将结果写入 `weather_cache`。
- 调用来源：待确认；本次未读取页面代码。
- 入参：`latitude: number`、`longitude: number`。
- 出参：`{ code, data: { location, weather, source, updatedAt }, message }`；缓存命中时 `source: 'cache'`。
- 依赖数据库集合：`weather_cache`。
- 依赖环境变量：`AMAP_KEY`、`WEATHER_CACHE_TTL_MS`。
- 第三方服务依赖：高德地图 Web 服务；Node `https`。
- 建议内存：128 MB。
- 建议超时时间：15 秒。
- 部署注意事项：`AMAP_KEY` 必须是 Web 服务 Key；天气和逆地理各有超时控制；缓存 TTL 默认约 10 分钟。
- 更新记录：2026-05-25 首次整理。

### `login`

- 云函数名：`login`
- 入口文件路径：`apps/miniapp/cloudfunctions/login/index.js`
- 当前状态：待确认
- 主要作用：读取微信上下文 OpenID，存在用户则更新登录时间，不存在则创建默认用户。
- 调用来源：待确认；本次未读取页面代码。
- 入参：无显式业务入参。
- 出参：`{ code, data: user, message }`。
- 依赖数据库集合：`users`。
- 依赖环境变量：无。
- 第三方服务依赖：微信云函数上下文 `cloud.getWXContext`。
- 建议内存：128 MB。
- 建议超时时间：10 秒。
- 部署注意事项：当前默认昵称文本存在编码显示异常，修正文案时需注意文件编码。
- 更新记录：2026-05-25 首次整理。

### `processClothUpload`

- 云函数名：`processClothUpload`
- 入口文件路径：`apps/miniapp/cloudfunctions/processClothUpload/index.js`
- 当前状态：待确认
- 主要作用：编排单图衣物上传流程：调用 `uploadClothImage` 创建衣物，调用 `segmentClothImage` 抠图，可选调用 `recognizeClothAttributes` 识别属性。
- 调用来源：待确认；本次未读取页面代码。
- 入参：`fileID: string`、`category?: string`、`recognizeNow?: boolean`。
- 出参：成功返回 `{ code: 0, data, message: 'ok' }`；建衣物失败时透传 `uploadClothImage` 结果。
- 依赖数据库集合：无直接集合。
- 依赖环境变量：无。
- 第三方服务依赖：内部云函数 `uploadClothImage`、`segmentClothImage`、`recognizeClothAttributes`。
- 建议内存：256 MB。
- 建议超时时间：90 秒；抠图和识别链路开启时需更长。
- 部署注意事项：依赖的三个内部云函数必须已部署；分割或识别失败会降级保留衣物记录。
- 更新记录：2026-05-25 首次整理。

### `processUploadImage`

- 云函数名：`processUploadImage`
- 入口文件路径：`apps/miniapp/cloudfunctions/processUploadImage/index.js`
- 当前状态：待确认 / 待重构
- 主要作用：当前代码处理批量上传中的单张图片，调用 Qwen VL 检测多件衣物，使用 `sharp` 按 `cropBox` 自动裁剪后保存草稿。
- 调用来源：待确认；本次未读取页面代码。
- 入参：`imageId?: string`、`uploadImageId?: string`。
- 出参：`{ code, data: { imageId, drafts, errorMessage? }, message }`；图片级失败时仍返回 `code: 0` 并写入失败状态。
- 依赖数据库集合：`upload_images`、`upload_batches`、`clothes_drafts`。
- 依赖环境变量：当前代码使用 `BAILIAN_API_KEY`、`BAILIAN_BASE_URL`、`BAILIAN_MODEL`、`QWEN_TIMEOUT_MS`；如果该函数应改为阿里云服饰识别，则目标环境变量应另行确认，可能与 `ALIYUN_ACCESS_KEY_ID`、`ALIYUN_ACCESS_KEY_SECRET` 相关。
- 第三方服务依赖：当前代码使用阿里云百炼兼容 OpenAI 接口、`node-fetch`、`sharp`、微信云存储下载/上传；与“上传后手动裁剪、服饰识别走阿里云 AccessKey”的目标方案不一致。
- 建议内存：1024 MB。
- 建议超时时间：120 秒。
- 部署注意事项：部署前先确认该函数是否仍应使用。若保留当前实现，`sharp` 是原生依赖，需确认云函数运行环境可安装；若改为手动裁剪预留流程，应移除自动裁剪和 `sharp` 依赖；若改为阿里云服饰识别，应替换百炼/Qwen VL 调用和环境变量。
- 更新记录：2026-05-25 首次整理；2026-05-25 补充当前实现与目标方案不一致的说明。

### `recognizeClothAttributes`

- 云函数名：`recognizeClothAttributes`
- 入口文件路径：`apps/miniapp/cloudfunctions/recognizeClothAttributes/index.js`
- 当前状态：待确认
- 主要作用：调用 Qwen VL 识别单件衣物品类、颜色、材质、风格、季节、分数和搭配建议，并回写 `clothes`。
- 调用来源：`processClothUpload` 可选调用；页面直接调用待确认。
- 入参：`clothId?: string`、`clothingId?: string`。
- 出参：`{ code, data: clothing, message }`；AI 失败时会回写失败状态后返回衣物对象。
- 依赖数据库集合：`clothes`。
- 依赖环境变量：`BAILIAN_API_KEY`、`BAILIAN_BASE_URL`、`BAILIAN_MODEL`、`QWEN_TIMEOUT_MS`。
- 第三方服务依赖：阿里云百炼兼容 OpenAI 接口；`node-fetch`；微信云临时文件 URL。
- 建议内存：256 MB。
- 建议超时时间：45 秒。
- 部署注意事项：缺少 `BAILIAN_API_KEY` 会导致识别失败但不删除衣物；会尊重 `manualFields`，避免覆盖用户手动编辑字段。
- 更新记录：2026-05-25 首次整理。

### `segmentClothImage`

- 云函数名：`segmentClothImage`
- 入口文件路径：`apps/miniapp/cloudfunctions/segmentClothImage/index.js`
- 当前状态：待确认
- 主要作用：下载微信云存储原图，上传临时 OSS，依次尝试阿里云 `SegmentCloth`、`SegmentCommodity`、`SegmentCommonImage`，再将分割结果保存回微信云存储并更新衣物展示图。
- 调用来源：`processClothUpload` 会调用；页面直接调用待确认。
- 入参：`clothId?: string`、`clothingId?: string`。
- 出参：`{ code, data: clothing, message }`；失败时回写 `cutoutStatus: failed` 并返回衣物对象。
- 依赖数据库集合：`clothes`。
- 依赖环境变量：`ALIYUN_ACCESS_KEY_ID`、`ALIYUN_ACCESS_KEY_SECRET`、`ALIYUN_OSS_ACCESS_KEY_ID`、`ALIYUN_OSS_ACCESS_KEY_SECRET`、`ALIYUN_OSS_BUCKET`、`ALIYUN_OSS_REGION`、`ALIYUN_OSS_URL_EXPIRES_SECONDS`、`ALIYUN_OSS_USE_SIGNED_URL`、`ALIYUN_VIAPI_REGION`、`SEGMENT_TIMEOUT_MS`。
- 第三方服务依赖：阿里云 VIAPI、阿里云 OSS、`@alicloud/pop-core`、`ali-oss`、`node-fetch`、微信云存储。
- 建议内存：512 MB。
- 建议超时时间：90 秒。
- 部署注意事项：原图必须是微信云 `cloud://` 文件；OSS 临时对象会在处理后删除；需确认 VIAPI 和 OSS 区域、权限、Bucket 配置。
- 更新记录：2026-05-25 首次整理。

### `updateClothes`

- 云函数名：`updateClothes`
- 入口文件路径：`apps/miniapp/cloudfunctions/updateClothes/index.js`
- 当前状态：待确认
- 主要作用：更新衣物允许编辑字段，并维护 `manualFields`。
- 调用来源：待确认；本次未读取页面代码。
- 入参：`id: string`、`data: object`。
- 出参：`{ code, data: clothing, message }`。
- 依赖数据库集合：`clothes`。
- 依赖环境变量：无。
- 第三方服务依赖：无。
- 建议内存：128 MB。
- 建议超时时间：15 秒。
- 部署注意事项：仅 `ALLOWED_FIELDS` 内字段会被写入；图片和 AI 状态字段不会计入手动字段。
- 更新记录：2026-05-25 首次整理。

### `updateUserProfile`

- 云函数名：`updateUserProfile`
- 入口文件路径：`apps/miniapp/cloudfunctions/updateUserProfile/index.js`
- 当前状态：待确认
- 主要作用：更新用户昵称、头像、头像类型、资料完成状态和推荐偏好。
- 调用来源：待确认；本次未读取页面代码。
- 入参：`nickname?: string`、`avatarUrl?: string`、`avatarType?: 'wechat' | 'preset' | 'default'`、`profileCompleted?: boolean`、`recommendationProfile?: object`。
- 出参：`{ code, data: { styleProfile, recommendationProfile, nickname, avatarUrl, avatarType, profileCompleted, updatedAt }, message }`。
- 依赖数据库集合：`users`。
- 依赖环境变量：无。
- 第三方服务依赖：无。
- 建议内存：128 MB。
- 建议超时时间：10 秒。
- 部署注意事项：当前默认昵称文本存在编码显示异常，修正文案时需注意文件编码。
- 更新记录：2026-05-25 首次整理。

### `uploadClothImage`

- 云函数名：`uploadClothImage`
- 入口文件路径：`apps/miniapp/cloudfunctions/uploadClothImage/index.js`
- 当前状态：待确认
- 主要作用：基于上传文件创建一条待抠图/待识别的衣物记录。
- 调用来源：`processClothUpload` 会调用；页面直接调用待确认。
- 入参：`fileID: string`、`category?: string`。
- 出参：`{ code, data: { clothId, clothingId, originalImageUrl, item }, message }`。
- 依赖数据库集合：`clothes`。
- 依赖环境变量：无。
- 第三方服务依赖：无。
- 建议内存：128 MB。
- 建议超时时间：15 秒。
- 部署注意事项：只创建记录，不执行抠图或识别；后续链路依赖 `clothId/clothingId`。
- 更新记录：2026-05-25 首次整理。

### `uploadClothing`

- 云函数名：`uploadClothing`
- 入口文件路径：`apps/miniapp/cloudfunctions/uploadClothing/index.js`
- 当前状态：待确认
- 主要作用：基于上传文件创建基础衣物记录，AI 状态为 pending。
- 调用来源：待确认；本次未读取页面代码。
- 入参：`fileID: string`、`category?: string`。
- 出参：`{ code, data: clothing, message }`。
- 依赖数据库集合：`clothes`。
- 依赖环境变量：无。
- 第三方服务依赖：无。
- 建议内存：128 MB。
- 建议超时时间：15 秒。
- 部署注意事项：与 `uploadClothImage` 职责相近，后续需确认是否保留两套上传入口。
- 更新记录：2026-05-25 首次整理。
