# 审美 Shadow 采样 V1 操作手册

本文档用于下周真实环境采集 `generateOutfit` 审美排名预演日志。当前实现只输出脱敏 shadow 日志，不改变生产排序，不写数据库，不启用正式 `rankingScore`。

## 部署前

1. 部署阶段 1 的五个云函数：`processUploadImage`、`confirmClothesDrafts`、`getWardrobe`、`updateClothes`、`recognizeClothAttributes`。
2. 部署包含 shadow telemetry 的 `generateOutfit`。
3. 重新构建并上传小程序体验版。
4. 仅在人工 smoke test 期间临时设置：

```text
AESTHETIC_SHADOW_LOG_SAMPLE_RATE=1
```

不要长期保持 `1`，也不要把该变量写入代码默认值。

## 人工 Smoke Test

覆盖以下样本组合：

- `home`、`work`、`date`、`sport` 四个 scene。
- 新上传衣服和已有老衣服。
- 有完整 `aestheticFeatures`、部分缺失和全部旧数据的衣服。
- 单批多套候选。
- 换一批推荐。
- 不同天气区间。

## 日志检查

1. 确认云日志存在固定前缀 `[AESTHETIC_SHADOW_V1]`。
2. 确认日志为单行 JSON。
3. 确认日志不包含 `_openid`、`openid`、`clothingIds`、`itemIds`、`outfitKey`、`imageUrl`、`fileID`、`city`、`latitude`、`longitude`、`userTitle`、`nickname`、`avatar`、`prompt`、`rawResult`、`avoidTags`。
4. 确认推荐顺序、`scores.total`、`outfitKey` 与旧版本逻辑无异常。
5. 导出日志为文本或 JSONL。
6. 不把真实日志提交到 Git。

## 分析

导出后在本地运行：

```bash
node apps/miniapp/cloudfunctions/generateOutfit/services/aestheticShadowReport.js <日志文件> --markdown
```

也可以输出 JSON：

```bash
node apps/miniapp/cloudfunctions/generateOutfit/services/aestheticShadowReport.js <日志文件> --json
```

报告只给出统计和安全异常，不会自动修改配置或启用正式排序融合。

## 测试结束

1. 将 `AESTHETIC_SHADOW_LOG_SAMPLE_RATE` 恢复为 `0`。
2. 若需要短期小流量观察，可改为 `0.05`。
3. 不建议长期保持 `1`。
4. 删除本地导出的真实日志。
5. 不提交真实日志。

## 正式启用前审计标准

正式让审美评分参与排序前，至少满足：

1. 收集不少于 50 个有效推荐批次。
2. 四个 scene 均有样本。
3. 新衣服和老衣服均有样本。
4. `coverage >= 0.50` 的候选比例可接受。
5. top1 preview change rate 不异常偏高，具体阈值由真实数据和人工复核决定。
6. 12 分保护违规为 0。
7. coverage 门控违规为 0。
8. 敏感字段异常为 0。
9. 性能和日志量可接受。
10. 人工检查不存在明显审美倒挂。
11. 阶段 1 smoke test 通过。
12. 再决定是否实现正式排名融合。
