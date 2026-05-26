# PROJECT_STATUS.md - 搭一搭当前状态

> 最后更新：2026-05-25

## 当前重点

- 上传衣服链路已升级为 Pipeline V2：多图上传 -> source image -> Image Router -> 分路线检测 -> 单件 crop -> 单件 segment -> 单件属性识别 -> qualityScore -> 草稿确认 -> 保存衣柜。
- 旧的单图直接入库链路已废弃并移除云函数文件：`uploadClothing`、`uploadClothImage`、`processClothUpload`。
- `processUploadImage` 不再执行旧的“整图识别后多个草稿共用整图/分割图”逻辑，核心阶段已集中到 `services/wardrobeAssetPipeline.js`。
- `segmentClothImage` 只对单件 crop 图生成 `cleanImageUrl`，失败会回退 crop/original 并进入 `needs_review`。
- 小程序草稿页使用 `displayImageUrl` 展示图片，并用 `ready` / `needs_review` / `failed` 表示处理状态。
- 云函数环境变量清单已独立维护在 `docs/cloudfunctions-env.md`。

## 上传链路现状

1. 前端在衣柜页选择 N 张图片并上传到微信云存储。
2. `createUploadBatch` 创建批次，`createUploadImage` 为每张原图登记 `upload_images`。
3. 草稿确认页逐张调用 `processUploadImage`。
4. `processUploadImage` 调用 Pipeline V2，按 `person_wearing_pipeline` / `non_person_pipeline` 生成单件草稿。
5. 草稿字段保留 `originalImageUrl`、`cropImageUrl`、`cleanImageUrl`、`displayImageUrl`、`imageSourceType`、`qualityScore`、`assetStatus`、`bbox`、`stageStatus` 和 `providerTrace`。
6. 用户可在草稿页编辑字段、重新处理图片、丢弃或保存。
7. `confirmClothesDrafts` 将选中的草稿保存到正式衣柜，并保留 V2 图片资产字段。
8. 衣柜列表、详情页、编辑页统一按 `cleanImageUrl > cropImageUrl > displayImageUrl > imageUrl > originalImageUrl` 展示。

## 待完成 / 待确认

- 需要在云开发环境配置并实测百炼、VIAPI、OSS 相关环境变量。
- `aitryon-parsing-v1` 的真实返回结构需要用线上样例继续收敛解析器；当前已提供 VL bbox 降级。
- `Jimp` 已作为云函数裁剪依赖声明，部署后需要在微信云函数环境完成安装验证。
- Web `/api/v1/clothes` 仍是 Demo/BFF 入口，不是当前小程序上传主链路。
- 正式数据库需要执行 `database/migrations/003_wardrobe_asset_pipeline_v2.sql`。
