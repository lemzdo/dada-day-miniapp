# 云函数维护文档

> 最后更新：2026-05-25

## 上传衣服主链路

当前上传识别链路已升级为 Pipeline V2：

```text
前端选择 N 张图片
-> createUploadBatch
-> createUploadImage
-> processUploadImage
-> imageRouter
-> person_wearing_pipeline / non_person_pipeline
-> 单件 crop / 单件 segment / 单件属性识别 / qualityScore
-> clothes_drafts 草稿
-> 用户确认/编辑/重新处理图片/丢弃
-> confirmClothesDrafts
-> clothes
```

详细阶段、降级和字段映射见 [wardrobe-asset-pipeline-v2.md](./wardrobe-asset-pipeline-v2.md)。

## 已删除旧云函数

- `uploadClothing`
- `uploadClothImage`
- `processClothUpload`

旧的“单图上传后直接入库 clothes”链路不再保留。前端云函数封装也已移除这些调用。

## 保留云函数

| 云函数 | 职责 |
| --- | --- |
| `createUploadBatch` | 创建上传批次；`action: detail` 查询 batch、source image 和 V2 草稿。 |
| `createUploadImage` | 为每张原图登记 `upload_images` source image。 |
| `processUploadImage` | Pipeline V2 主函数，负责 router、检测、crop、segment、属性识别、qualityScore 和草稿生成。 |
| `segmentClothImage` | 重新处理单件图片，优先使用 `cropImageUrl`，成功写 `cleanImageUrl`；兼容正式衣物和草稿。 |
| `recognizeClothAttributes` | 基于 `cleanImageUrl > cropImageUrl > originalImageUrl` 重新识别单件属性。 |
| `confirmClothesDrafts` | 保存用户确认后的草稿，只将 `selected=true` 且 `status=pending` 的草稿写入 `clothes`。 |
| `discardClothesDraft` | 将草稿置为未选中和 `discarded`。 |
| `getWardrobe` | 查询正式衣柜列表、分页和容量，返回 V2 图片字段。 |
| `updateClothes` | 更新正式衣物字段，保留 V2 图片资产字段。 |
| `deleteClothes` | 软删除正式衣物。 |
| `cleanupDeletedClothes` | 定时清理软删除衣物和云存储文件。 |

## 数据字段

`upload_images` 是图片级 source image 任务：

- `assetVersion`
- `originalImageUrl`
- `normalizedImageUrl`
- `cloudFileId`
- `status`
- `detectStatus`
- `segmentStatus`
- `detectedCount`
- `routerResult`
- `aiRawResult`
- `errorMessage`

`clothes_drafts` 是每件候选衣服：

- `assetVersion`
- `originalImageUrl`
- `normalizedImageUrl`
- `cropImageUrl`
- `maskImageUrl`
- `cleanImageUrl`
- `displayImageUrl`
- `imageUrl`
- `imageSourceType`: `clean` / `crop` / `original`
- `assetStatus`: `ready` / `needs_review` / `failed`
- `qualityScore`
- `needsUserConfirm`
- `confirmReasons`
- `bbox`
- `itemIndex`
- `sourceImageId`
- `batchId`
- `stageStatus`
- `providerTrace`
- 属性字段：`type`、`categoryName`、`colors`、`material`、`styleTags`、`seasonTags`、`confidence`

`clothes` 正式衣柜保存草稿确认后的 V2 资产字段：

- `assetVersion`
- `originalImageUrl`
- `cropImageUrl`
- `cleanImageUrl`
- `displayImageUrl`
- `imageUrl`
- `imageSourceType`
- `qualityScore`
- `assetStatus`
- `bbox`
- `sourceImageId`
- `batchId`
- `stageStatus`
- `providerTrace`

## 图片优先级

```text
cleanImageUrl > cropImageUrl > displayImageUrl > imageUrl > originalImageUrl
```

旧字段兼容：

- `aiSegmentImageUrl` 视作 clean 图。
- `croppedImageUrl` / `manualCropImageUrl` 视作 crop 图。

## 环境变量

完整清单见 [cloudfunctions-env.md](./cloudfunctions-env.md)。

上传链路主要变量：

- `BAILIAN_API_KEY`
- `BAILIAN_ROUTER_MODEL`
- `BAILIAN_DETECTION_MODEL`
- `BAILIAN_ATTRIBUTE_MODEL`
- `BAILIAN_TRYON_PARSING_MODEL`
- `ALIYUN_ACCESS_KEY_ID`
- `ALIYUN_ACCESS_KEY_SECRET`
- `OSS_BUCKET`
- `OSS_REGION`
- `AI_TIMEOUT_MS`
- `AI_MAX_RETRY`
- `ASSET_PIPELINE_VERSION`

## 失败降级

- Router 失败：默认 `non_person_pipeline`，写 trace，质量分扣分。
- 单张图失败：只影响该图，不阻塞同 batch 其他图片。
- 单件 crop 失败：该 item 使用原图展示，进入 `needs_review`。
- 单件 segment 失败：清空 `cleanImageUrl`，回退 crop/original，不影响草稿保存。
- 属性识别失败：保留图片资产和 rough category，进入 `needs_review`。
- 多图部分成功：batch 为 `partial_success`；只要有草稿，batch 不应为 `failed`。

## 用户文案

小程序用户可见文案统一使用“小搭”，不使用“AI识别”“AI分割”“AI推荐”“使用AI图”等表达。
