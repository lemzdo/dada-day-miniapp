# 衣物资产生成 Pipeline V2

> 最后更新：2026-05-26

## 总流程

```text
用户上传图片
-> createUploadBatch / createUploadImage 登记 batch 与 source image
-> processUploadImage 调用 Pipeline V2
-> imageRouter 判断图片类型
-> detectGarments 选择 person_wearing_pipeline 或 non_person_pipeline
-> 每个候选 item 单独 cropGarment
-> 每个 crop 单独 segmentGarment
-> 基于 clean/crop/original 单件图 recognizeAttributes
-> scoreAssetQuality
-> clothes_drafts
-> 用户确认/编辑/丢弃/重新处理图片
-> confirmClothesDrafts
-> clothes
```

核心约束：

- 每件衣服必须是一个独立草稿。
- 每件衣服优先拥有独立 `cropImageUrl`，crop 失败才回退 `originalImageUrl`。
- `cleanImageUrl` 只能来自当前单件 crop 的分割结果。
- 分割失败不阻断草稿生成。
- 属性识别失败不阻断图片资产生成，草稿进入 `needs_review`。
- 多图上传时单张失败不影响其他图片。

## 当前能力边界

- 当前 `person_wearing_pipeline` 已真实接入百炼 AI 试衣图片分割专用 API，endpoint 默认为 `https://dashscope.aliyuncs.com/api/v1/services/vision/image-process/process`，model 默认为 `aitryon-parsing-v1`。
- `aitryon-parsing-v1` 返回的 `crop_img_url`、`parsing_img_url` 是临时 URL，主链路会先下载并持久化到自己的微信云存储，再写入 `cropImageUrl` / `cleanImageUrl`。
- `maskImageUrl` 是 V2 预留字段；当前 `parsing_img_url` 持久化后作为 `cleanImageUrl` 使用，不稳定写入 `maskImageUrl`。
- 主 Pipeline 会按品类选择 `SegmentCloth` / `SegmentCommodity`；`segmentClothImage` 手动“重新处理图片”当前仍以 `SegmentCloth` 为主，暂未完全按品类分流。
- `database/migrations/003_wardrobe_asset_pipeline_v2.sql` 只服务 Web/Drizzle 的 PostgreSQL schema；小程序云数据库是 schema-less 写入字段，不需要单独建列。

## Image Router

输入：source image 临时 URL。

输出：

```json
{
  "imageScene": "person_wearing",
  "hasPerson": true,
  "garmentPresentation": "worn_on_person",
  "estimatedGarmentCount": 2,
  "containsAccessories": false,
  "recommendedPipeline": "person_wearing_pipeline",
  "confidence": 0.86,
  "riskFlags": []
}
```

路由规则：

- `hasPerson=true` 且 `garmentPresentation=worn_on_person`：走 `person_wearing_pipeline`。
- 其他图片：走 `non_person_pipeline`。
- Router 失败：默认 `non_person_pipeline`，记录 `router=failed`，质量分扣分。

## person_wearing_pipeline

适用：真人/模特穿着图。

阶段：

1. 优先调用百炼 AI 试衣图片分割专用 API：`aitryon-parsing-v1`。
2. 请求 endpoint：`https://dashscope.aliyuncs.com/api/v1/services/vision/image-process/process`。
3. 按顺序分别请求 `parameters.clothes_type=upper`、`lower`；如果 upper/lower 有有效结果，不再请求 dress，避免重复。
4. 如果 upper/lower 都无有效结果，再请求 `parameters.clothes_type=dress`。
5. 解析返回的 `bbox`、`crop_img_url`、`parsing_img_url`；其中 bbox 按 `pixel_xyxy` 处理。
6. `crop_img_url` 持久化为 `cropImageUrl`，`parsing_img_url` 持久化为 `cleanImageUrl`。
7. aitryon 无结果、调用失败或返回 bbox 不可用时，降级到 VL bbox 检测。
8. 主服饰识别成功后，用 VL bbox 补充鞋、包、帽子、配饰。
9. 所有候选 item 统一进入 crop/segment/attribute/score。

降级：

- aitryon parsing 失败不阻断，降级 VL bbox。
- 配饰检测失败不影响主服饰草稿。
- bbox 过大或疑似整个人时保留草稿，但加入 `confirmReasons` 并降为 `needs_review`。

## non_person_pipeline

适用：商品图、平铺图、多件商品图、电商截图、衣柜挂拍、鞋包配饰图。

阶段：

1. 使用 `BAILIAN_DETECTION_MODEL` 做 VL bbox 检测。
2. 每个 item 输出 `itemIndex`、`roughCategory`、`bbox`、`confidence`。
3. 每个 item 单独 crop。

降级：

- VL bbox 失败且图片疑似单件商品图时，生成一个 `needs_review` 草稿，使用原图展示。
- 多件图 bbox 缺失时，不生成多个共用整图的假草稿。
- 检测到同一 `sourceImageId` 下多个草稿共用同一个 `cleanImageUrl` 时，清空重复 clean 图并回退 crop 图。

## 阶段输入输出

| 阶段 | 输入 | 输出 |
| --- | --- | --- |
| `imageRouter` | 原图临时 URL | `routerResult`、`stageStatus.router`、`providerTrace` |
| `detectGarments` | 原图临时 URL、routerResult | item candidates、bbox、roughCategory |
| `cropGarment` | originalImageUrl、bbox、batchId、sourceImageId、itemIndex | `cropImageUrl`、规范化后的 0-1 bbox；bbox 无法判断时跳过 crop 并进入 `needs_review` |
| `segmentGarment` | `cropImageUrl`、category | `cleanImageUrl`；`maskImageUrl` 当前为预留字段 |
| `recognizeAttributes` | `cleanImageUrl > cropImageUrl > originalImageUrl` | category、subCategory、colors、material、styleTags、seasonTags、confidence |
| `scoreAssetQuality` | stageStatus、图片字段、属性字段、risk flags | `qualityScore`、`assetStatus`、`needsUserConfirm` |
| `createDraft` | asset | `clothes_drafts` |

`stageStatus`：

```json
{
  "router": "success",
  "detection": "success",
  "crop": "success",
  "segment": "failed",
  "attribute": "success"
}
```

最终落库的 `stageStatus` 只允许 `success`、`failed`、`skipped`。处理中状态不写入最终 `stageStatus`。

`providerTrace`：

```json
[
  {
    "stage": "router",
    "provider": "bailian",
    "model": "qwen3-vl-flash",
    "status": "success",
    "durationMs": 1234,
    "errorMessage": "",
    "estimatedCost": 0
  }
]
```

## bbox normalize

`cropGarment` 在裁剪前会先把 bbox 规范化为 0-1 相对坐标。当前支持：

- `{ x, y, width, height }` 的 0-1 相对坐标。
- 0-100 百分比坐标。
- 0-1000 归一化坐标。
- 结合原图宽高判断的像素坐标。
- `{ x1, y1, x2, y2 }` 或 `{ left, top, right, bottom }` 左上右下格式。

视觉模型应在每个 item 上返回 `bboxFormat`，推荐默认：

```json
{
  "bboxFormat": "relative_0_1",
  "bbox": { "x": 0.1, "y": 0.1, "width": 0.4, "height": 0.4 }
}
```

允许值：

- `relative_0_1`
- `percent_0_100`
- `normalized_0_1000`
- `pixel_xywh`
- `pixel_xyxy`

兼容旧返回时会按数值范围推断：全部数值不超过 1 按 `relative_0_1`；不超过 100 且存在大于 1 的值按 `percent_0_100`；不超过 1000 且原图宽或高明显大于 1000 时可按 `normalized_0_1000`；明显超出 0-1000 且符合原图尺寸时按像素坐标。

无法判断、pixel 与 0-1000 normalized 同时成立、越界、太小或疑似整图/整人框时，不强行裁剪；该 item 回退原图展示，`stageStatus.crop=skipped`，`providerTrace` 记录失败原因，并加入 `confirmReasons`，其中格式歧义会写入 `bbox_format_ambiguous`。

## qualityScore

当前规则评分：

- 有 bbox：`+20`
- crop 成功：`+25`
- clean 成功：`+25`
- 属性识别成功：`+15`
- 图片不是整图复用：`+10`
- category 置信度高：`+5`
- bbox 缺失：`-30`
- 只用原图：`-30`
- 分割失败：`-10`
- 属性缺失：`-15`
- 疑似多件混在一起：`-20`
- router/detection 失败：扣分

状态规则：

- `qualityScore >= 80`：`assetStatus=ready`
- `50 <= qualityScore < 80`：`assetStatus=needs_review`
- `qualityScore < 50` 且有可用图片：`assetStatus=needs_review`
- 完全无可用图片：`assetStatus=failed`

## empty / failed / partial_success

- 单张图 `assets.length=0` 且没有 provider、detection、pipeline 错误时，标记为 `empty`。
- 单张图 `assets.length=0` 且存在 provider、detection、bbox 解析或 pipeline 错误时，标记为 `failed`，并写入失败阶段原因。
- 只要单张图成功创建了草稿，即使部分 item 的 crop/segment/attribute 失败，也不把该图标记为 `failed`。
- batch 的 `totalDetectedClothes` 始终等于实际创建的 draft 数量。
- batch 有 draft 且有图片失败时为 `partial_success`；有 draft 且无失败图片时为 `success`；无 draft 且全部为空图时为 `empty`；无 draft 且存在异常时为 `failed`。

## 图片字段优先级

展示图统一使用：

```text
cleanImageUrl > cropImageUrl > displayImageUrl > imageUrl > originalImageUrl
```

`imageUrl` 入库时写最终展示图：

```text
cleanImageUrl || cropImageUrl || displayImageUrl || originalImageUrl
```

兼容旧字段：

- 旧 `aiSegmentImageUrl` 视作 `cleanImageUrl`。
- 旧 `croppedImageUrl` / `manualCropImageUrl` 视作 crop 类图片。

## 草稿到正式衣柜映射

`confirmClothesDrafts` 保存到 `clothes` 时保留：

- `assetVersion`
- `originalImageUrl`
- `normalizedImageUrl`
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
- `itemIndex`
- `stageStatus`
- `providerTrace`

保存失败时草稿继续保持 `pending`，图片不删除，允许用户重试。
