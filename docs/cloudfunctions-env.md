# 云函数环境变量

> 最后更新：2026-05-26

不要在代码或仓库中写入真实 key。以下示例值只用于说明格式。

## 最小可跑配置

Pipeline V2 真实联调时，通常只需要先配置这三个云函数：

### processUploadImage

负责图片路由、衣物检测、单件 crop、分割增强、属性识别和生成草稿。

必填变量：

```text
BAILIAN_API_KEY=sk-xxxx
```

建议配置变量：

```text
BAILIAN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
BAILIAN_ROUTER_MODEL=qwen3-vl-flash
BAILIAN_DETECTION_MODEL=qwen3-vl-flash
BAILIAN_ATTRIBUTE_MODEL=qwen3-vl-flash
BAILIAN_TRYON_PARSING_ENDPOINT=https://dashscope.aliyuncs.com/api/v1/services/vision/image-process/process
BAILIAN_TRYON_PARSING_MODEL=aitryon-parsing-v1
ALIYUN_ACCESS_KEY_ID=LTAIxxxx
ALIYUN_ACCESS_KEY_SECRET=xxxx
ALIYUN_REGION=cn-shanghai
ALIYUN_SEGMENT_CLOTH_ENDPOINT=https://imageseg.cn-shanghai.aliyuncs.com
ALIYUN_SEGMENT_COMMODITY_ENDPOINT=https://imageseg.cn-shanghai.aliyuncs.com
OSS_REGION=oss-cn-shanghai
OSS_BUCKET=d1d-dev-assets
OSS_USE_SIGNED_URL=false
AI_TIMEOUT_MS=30000
AI_MAX_RETRY=1
ASSET_PIPELINE_VERSION=v2
```

可不配变量：

```text
OSS_ACCESS_KEY_ID=
OSS_ACCESS_KEY_SECRET=
```

说明：

- `BAILIAN_TRYON_PARSING_ENDPOINT` 是真人/模特图 `person_wearing_pipeline` 使用的百炼 AI 试衣图片分割专用 API，不是 OpenAI compatible chat completions。
- `BAILIAN_TRYON_PARSING_MODEL` 默认是 `aitryon-parsing-v1`。
- aitryon parsing 返回的 `crop_img_url` / `parsing_img_url` 是临时 URL，主链路会下载并持久化到微信云存储后再写入草稿。
- 真实调用需要可访问该服务地域的百炼 API Key；当前按北京地域百炼服务准备 key。
- `ALIYUN_SEGMENT_CLOTH_ENDPOINT` 对应 SegmentCloth。
- `ALIYUN_SEGMENT_COMMODITY_ENDPOINT` 对应 SegmentCommodity。
- 这两个 endpoint 默认都可以使用 `https://imageseg.cn-shanghai.aliyuncs.com`。
- `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` 不配时会复用 `ALIYUN_ACCESS_KEY_ID` / `ALIYUN_ACCESS_KEY_SECRET`。
- 如果不配置 Aliyun/OSS 分割变量，流程仍可生成 crop/original 草稿，但 clean 图可能失败并进入 `needs_review`。

### segmentClothImage

负责用户点击“重新处理图片”时，对单件 crop 图重新分割增强。

必填变量：

```text
ALIYUN_ACCESS_KEY_ID=LTAIxxxx
ALIYUN_ACCESS_KEY_SECRET=xxxx
OSS_REGION=oss-cn-shanghai
OSS_BUCKET=d1d-dev-assets
```

建议配置变量：

```text
ALIYUN_REGION=cn-shanghai
ALIYUN_SEGMENT_CLOTH_ENDPOINT=https://imageseg.cn-shanghai.aliyuncs.com
OSS_USE_SIGNED_URL=false
SEGMENT_TIMEOUT_MS=60000
```

可不配变量：

```text
OSS_ACCESS_KEY_ID=
OSS_ACCESS_KEY_SECRET=
OSS_URL_EXPIRES_SECONDS=1800
```

说明：

- 当前手动重处理主要使用 SegmentCloth。
- `ALIYUN_SEGMENT_CLOTH_ENDPOINT` 对应 SegmentCloth，默认可以是 `https://imageseg.cn-shanghai.aliyuncs.com`。
- `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` 不配时会复用 `ALIYUN_ACCESS_KEY_ID` / `ALIYUN_ACCESS_KEY_SECRET`。

### recognizeClothAttributes

负责用户点击“重新识别信息”时，基于 clean/crop 单件图重新识别属性。

必填变量：

```text
BAILIAN_API_KEY=sk-xxxx
```

建议配置变量：

```text
BAILIAN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
BAILIAN_ATTRIBUTE_MODEL=qwen3-vl-flash
AI_TIMEOUT_MS=30000
```

可不配变量：

```text
BAILIAN_MODEL=
```

## 不需要 AI 变量的云函数

以下云函数不直接调用 AI，也不需要配置百炼、Aliyun VIAPI 或 OSS 中转变量：

| 云函数 | 说明 |
| --- | --- |
| `createUploadBatch` | 创建/查询上传批次，不调用 AI。 |
| `createUploadImage` | 登记 source image，不调用 AI。 |
| `confirmClothesDrafts` | 保存用户确认后的草稿，不调用 AI。 |
| `getWardrobe` | 查询正式衣柜数据，不调用 AI。 |
| `updateClothes` | 更新衣物信息，不调用 AI。 |

## 变量速查

| 变量 | 用途 | 建议 |
| --- | --- | --- |
| `BAILIAN_API_KEY` | 百炼视觉模型调用 key | AI 识别必填 |
| `BAILIAN_BASE_URL` | 百炼 OpenAI compatible endpoint | 建议配置 |
| `BAILIAN_ROUTER_MODEL` | Image Router 模型 | 建议配置在 `processUploadImage` |
| `BAILIAN_DETECTION_MODEL` | VL bbox 检测模型 | 建议配置在 `processUploadImage` |
| `BAILIAN_ATTRIBUTE_MODEL` | 属性识别模型 | 建议配置在 `processUploadImage` / `recognizeClothAttributes` |
| `BAILIAN_TRYON_PARSING_ENDPOINT` | aitryon parsing 专用 endpoint | 建议配置在 `processUploadImage` |
| `BAILIAN_TRYON_PARSING_MODEL` | aitryon parsing 专用模型 | 默认 `aitryon-parsing-v1` |
| `ALIYUN_ACCESS_KEY_ID` | Aliyun VIAPI AccessKey | 分割必填 |
| `ALIYUN_ACCESS_KEY_SECRET` | Aliyun VIAPI Secret | 分割必填 |
| `ALIYUN_REGION` | VIAPI 区域 | 建议 `cn-shanghai` |
| `ALIYUN_SEGMENT_CLOTH_ENDPOINT` | SegmentCloth endpoint | 默认 `https://imageseg.cn-shanghai.aliyuncs.com` |
| `ALIYUN_SEGMENT_COMMODITY_ENDPOINT` | SegmentCommodity endpoint | 默认 `https://imageseg.cn-shanghai.aliyuncs.com` |
| `OSS_REGION` | OSS region | 分割必填 |
| `OSS_BUCKET` | OSS 中转 bucket | 分割必填 |
| `OSS_ACCESS_KEY_ID` | OSS 专用 AccessKey | 可不配，默认复用 Aliyun key |
| `OSS_ACCESS_KEY_SECRET` | OSS 专用 Secret | 可不配，默认复用 Aliyun secret |
| `OSS_USE_SIGNED_URL` | OSS 中转图是否使用签名 URL | 建议 `false` |
| `AI_TIMEOUT_MS` | AI/图片下载超时 | 建议 `30000` |
| `AI_MAX_RETRY` | AI 阶段重试次数 | 建议 `1` |
| `ASSET_PIPELINE_VERSION` | 资产管线版本 | 建议 `v2` |

## 历史兼容变量

新环境优先使用上面的标准变量。以下旧变量仍被代码兼容，但不建议新配置继续使用：

| 历史变量 | 对应标准变量 |
| --- | --- |
| `QWEN_TIMEOUT_MS` | `AI_TIMEOUT_MS` |
| `BAILIAN_MODEL` | `BAILIAN_ROUTER_MODEL` / `BAILIAN_DETECTION_MODEL` / `BAILIAN_ATTRIBUTE_MODEL` 的 fallback |
| `ALIYUN_VIAPI_REGION` | `ALIYUN_REGION` |
| `ALIYUN_OSS_BUCKET` | `OSS_BUCKET` |
| `ALIYUN_OSS_REGION` | `OSS_REGION` |
| `ALIYUN_OSS_ACCESS_KEY_ID` | `OSS_ACCESS_KEY_ID` |
| `ALIYUN_OSS_ACCESS_KEY_SECRET` | `OSS_ACCESS_KEY_SECRET` |
| `ALIYUN_OSS_USE_SIGNED_URL` | `OSS_USE_SIGNED_URL` |
