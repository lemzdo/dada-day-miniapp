# 云函数维护文档

> 最后更新：2026-05-25

## 上传衣服主链路

当前只保留批量上传草稿主链路：

```text
前端选择 N 张图片
-> createUploadBatch
-> createUploadImage
-> processUploadImage
-> clothes_drafts 草稿
-> segmentClothImage 后台补充分割图
-> 用户确认/丢弃/编辑/选择展示图
-> confirmClothesDrafts
-> clothes
```

## 已删除旧云函数

- `uploadClothing`
- `uploadClothImage`
- `processClothUpload`

旧的“单图上传后直接入库 clothes”链路不再保留。前端云函数封装也已移除这些调用。

## 保留云函数

| 云函数 | 职责 |
| --- | --- |
| `createUploadBatch` | 创建上传批次；`action: detail` 查询批次、图片任务和草稿。 |
| `createUploadImage` | 为每张原图登记 `upload_images` 图片级任务。 |
| `processUploadImage` | 读取单张 `upload_images`，调用百炼 `qwen3-vl-flash` 识别多件衣服，生成 `clothes_drafts`，不等待分割，不直接写入 `clothes`。 |
| `segmentClothImage` | 优先支持 `draftId`，调用 Aliyun VIAPI `SegmentCloth` 生成分割图，转存微信云存储后回写草稿；兼容 `clothingId` 正式衣物分割。 |
| `confirmClothesDrafts` | 更新用户编辑后的草稿字段，只将 `selected=true` 且 `status=pending` 的草稿写入 `clothes`。 |
| `discardClothesDraft` | 将草稿置为未选中和 `discarded`。 |
| `getWardrobe` | 查询正式衣柜列表、分页和容量。 |
| `updateClothes` | 更新正式衣物字段，保留图片来源、识别和分割状态字段。 |
| `deleteClothes` | 软删除正式衣物。 |
| `cleanupDeletedClothes` | 定时清理软删除衣物和云存储文件。 |

## 职责边界

- `qwen3-vl-flash`：负责图片理解、一图多衣草稿、基础属性，如品类、颜色、材质、风格、季节和置信度。
- Aliyun VIAPI `SegmentCloth`：只负责分割图生成。
- 草稿生成不等待分割完成。
- 分割失败不影响草稿确认入库，展示图回退或保持原图。
- Aliyun VIAPI 返回的是临时 URL，禁止长期保存；必须下载后转存到微信云存储，再把微信云存储 `fileID` 写入 `aiSegmentImageUrl`。
- 用户最终决定 `displayImageUrl` 使用原图、小搭生成图或后续手动切割图。

## 数据字段

`upload_images` 是图片级任务，不保存每件衣服的分割图。核心字段：

- `batchId`
- `originalImageUrl`
- `cloudFileId`
- `status`: `pending` / `detecting` / `detected` / `failed`
- `detectedCount`
- `errorMessage`
- `aiRawResult`

`clothes_drafts` 是每件候选衣服。核心字段：

- `batchId`
- `sourceImageId`
- `originalImageUrl`
- `displayImageUrl`
- `imageSourceType`: `original` / `ai_segment` / `manual_crop`
- `aiSegmentImageUrl`
- `manualCropImageUrl`
- `detectStatus`
- `segmentStatus`
- `manualCropStatus`
- `type`
- `categoryName`
- `colors`
- `material`
- `styleTags`
- `seasonTags`
- `confidence`
- `detectProvider`
- `detectModel`
- `segmentProvider`
- `segmentModel`
- `selected`
- `status`: `pending` / `confirmed` / `discarded`

`clothes` 正式表保留：

- `originalImageUrl`
- `displayImageUrl`
- `imageSourceType`
- `aiSegmentImageUrl`
- `manualCropImageUrl`
- `aiRecognizeStatus` / `detectStatus`
- `cutoutStatus` / `segmentStatus`
- `detectProvider`
- `detectModel`
- `segmentProvider`
- `segmentModel`
- `type`
- `categoryName`
- `colors`
- `material`
- `styleTags`
- `seasonTags`
- `status`

## 环境变量

上传链路环境变量分为“必须配置”和“代码默认值”。百炼 Key 和模型由你在云开发环境变量中配置；阿里云 AccessKey、OSS Bucket、OSS Region 也由你在云开发环境变量中配置。其他值后期需要调优时再单独配置。

必须配置：

- `BAILIAN_API_KEY`
- `BAILIAN_MODEL`
- `ALIYUN_ACCESS_KEY_ID`
- `ALIYUN_ACCESS_KEY_SECRET`
- `ALIYUN_OSS_BUCKET`
- `ALIYUN_OSS_REGION`

代码默认：

- `BAILIAN_BASE_URL = https://dashscope.aliyuncs.com/compatible-mode/v1`
- `QWEN_TIMEOUT_MS = 30000`
- `ALIYUN_OSS_ACCESS_KEY_ID = 默认复用 ALIYUN_ACCESS_KEY_ID`
- `ALIYUN_OSS_ACCESS_KEY_SECRET = 默认复用 ALIYUN_ACCESS_KEY_SECRET`
- `ALIYUN_OSS_URL_EXPIRES_SECONDS = 1800`
- `ALIYUN_OSS_USE_SIGNED_URL = true`
- `ALIYUN_VIAPI_REGION = cn-shanghai`
- `SEGMENT_TIMEOUT_MS = 60000`

注意：VIAPI 返回的是临时 URL，仍必须转存微信云存储，不能长期保存阿里临时 URL。
- `ALIYUN_OSS_URL_EXPIRES_SECONDS`
- `ALIYUN_OSS_USE_SIGNED_URL`
- `ALIYUN_VIAPI_REGION`
- `SEGMENT_TIMEOUT_MS`

## 用户文案

小程序用户可见文案统一使用“小搭”，不使用“AI识别”“AI分割”“AI推荐”“使用AI图”“等待AI”等表达。

示例：

- “小搭正在整理衣服”
- “小搭正在生成干净图”
- “使用小搭生成图”
- “小搭暂时没处理好，已先使用原图”

## 失败降级

- `processUploadImage` 单张失败只更新该图片任务为 `failed`，不阻塞其他图片。
- `segmentClothImage` 分割失败写入 `segmentStatus=failed`，保留 `displayImageUrl=originalImageUrl` 或用户已有选择。
- `confirmClothesDrafts` 不重新识别、不覆盖用户已编辑字段，只入库仍为 `pending` 且被选中的草稿。
