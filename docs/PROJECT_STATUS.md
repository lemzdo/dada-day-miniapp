# PROJECT_STATUS.md - 搭一搭当前状态

> 最后更新：2026-05-25

## 当前重点

- 上传衣服链路已统一为批量上传草稿链路：选择多张图片 -> `createUploadBatch` -> `createUploadImage` -> `processUploadImage` -> `clothes_drafts` -> 草稿确认 -> `confirmClothesDrafts` 入库 `clothes`。
- 旧的单图直接入库链路已废弃并移除云函数文件：`uploadClothing`、`uploadClothImage`、`processClothUpload`。
- `processUploadImage` 不再使用 Qwen cropBox + `sharp` 矩形裁剪；草稿默认展示原图，后续由分割链路补充干净图。
- 直接 `sharp` 依赖已从业务代码和 package 声明中移除；Next.js lockfile 中仍可能保留框架可选依赖项，不属于上传链路依赖。
- 小程序用户可见文案已把上传、识别、分割、点评相关的 “AI” 表述改为“小搭”。
- 上传链路环境变量已简化，必填项减少，其余参数走代码默认值；后续部署时只需要重点配置百炼 Key/model、阿里云 AccessKey、OSS Bucket/Region。

## 上传链路现状

1. 前端在衣柜页选择 N 张图片并上传到微信云存储。
2. `createUploadBatch` 创建批次，`createUploadImage` 为每张原图登记 `upload_images` 任务。
3. 草稿确认页快速进入，逐张调用 `processUploadImage`。
4. `processUploadImage` 调用阿里云百炼 `qwen3-vl-flash` 识别单图多件衣服，并为每件衣服生成 `clothes_drafts`。
5. 草稿默认 `originalImageUrl = displayImageUrl`、`imageSourceType = original`、`selected = true`、`status = pending`，不等待分割完成。
6. `segmentClothImage` 支持 `draftId`，后台低并发调用 Aliyun VIAPI `SegmentCloth`，将临时结果下载后转存微信云存储，再回写 `aiSegmentImageUrl`。
7. 用户在草稿页决定是否选中、丢弃、编辑字段和选择展示图来源。
8. `confirmClothesDrafts` 只入库 `selected=true` 且 `status=pending` 的草稿，并以用户最终编辑后的草稿字段为准。

## 待完成 / 待确认

- 需要在云开发环境配置并验证百炼、VIAPI、OSS 相关环境变量。
- 手动切割图目前仅预留字段：`manualCropImageUrl`、`manualCropStatus`、`imageSourceType=manual_crop`。
- 草稿分割目前由确认页触发低并发调用；后续可迁移为更稳定的后台队列或定时任务。
- Web `/api/v1/clothes` 仍是 Demo/BFF 入口，已移除本地裁剪依赖，但不是当前小程序上传主链路。
- 数据库迁移文件已描述上传批次和草稿表，正式环境需要确认新增图片与状态字段是否完成迁移或由云数据库字段自动创建承接。
