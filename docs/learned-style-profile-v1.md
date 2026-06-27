# learnedProfile Shadow V1

本文档记录阶段 4 第一任务：`learnedProfile` shadow 聚合基础。当前实现只生成和持久化当前用户的行为画像，不接入推荐排序，不修改 UI，不调用 AI，不自动刷新。

## Profile 边界

- `explicitProfile`：用户在偏好页明确填写的偏好，继续拥有最高解释权。
- `learnedProfile`：从当前用户行为事件推断出的 shadow 数据，只写入独立集合。
- `contextProfile`：`learnedProfile` 内按 `home`、`work`、`date`、`sport` 拆分的场景切片。

本轮禁止写入 `recommendationProfile`、`preferredStyles`、`colorPreference`、`avoidTags`、`temperatureSensitivity`，也不把学习结果伪装成用户手动选择。

## 数据来源

云函数：`refreshLearnedStyleProfile`

集合：

- 读取：`outfit_behavior_events`
- 读取：`clothes`
- 写入：`learned_style_profiles`

云函数只使用 `cloud.getWXContext().OPENID`。客户端传入的 `_openid`、`openid`、`userId` 被忽略。事件读取限制为当前 `_openid` 最近 180 天，最多 1000 条；衣物读取从事件里的 `clothingIds` 收集，分批查询且每次都限制当前 `_openid`。

## 数据结构

`LearnedStyleProfileV1` 已在 `packages/types/src/learned-style-profile.ts` 定义，核心结构：

- `schemaVersion: 1`
- `profileVersion: 'learned-style-v1'`
- `status: 'insufficient_data' | 'shadow_ready'`
- `global`
- `contexts`
- `source`
- `quality`
- `generatedAt`

每个维度输出 `positive`、`negative` 和 `observedValueCount`。信号包含 `value`、`score`、`confidence`、`supportWeight`、`positiveWeight`、`negativeWeight`、`distinctOutfitCount`。

## 七个学习维度

- `fit`
- `silhouette`
- `patternType`
- `designElement`
- `formalityLevel`
- `colorFamily`
- `styleTag`

`aestheticFeatures` 仅在对应字段 confidence 为 `high` 或 `medium` 时参与；`low`、`unknown`、缺失或 unsupported version 不产生正负偏好。普通 `styleTags` 和可解析颜色可以参与，但仍受 support、coverage 和门控约束。

## 行为权重

V1 固定权重：

```text
recommendation_exposure      0
outfit_detail_view           +0.5
outfit_favorite              +2.0
outfit_unfavorite            -2.5
outfit_wear                  dynamic
recommendation_batch_refresh -0.2
```

重复穿着：

```text
第一次 wear：+4.0
第二次 wear：+5.5
第三次及以后：+7.0
```

同一 outfit 的 wear 按 `occurredAt` 和 `eventId` 稳定排序后计算，每次 wear 都保留独立贡献，权重封顶不无限增长。

## 时间衰减

使用指数半衰期：

```text
detail_view      45 天
favorite         120 天
unfavorite       120 天
wear             180 天
batch_refresh    30 天
```

公式：

```js
decay = Math.pow(0.5, ageDays / halfLifeDays)
effectiveWeight = baseWeight * decay
```

超过 180 天或非法 `occurredAt` 的事件不参与。未来 `occurredAt` 按 `age=0` 处理。服务端优先使用行为事件文档的 `occurredAt`，不使用客户端 `clientOccurredAt` 计算权重。

## Exposure 和 Refresh

`recommendation_exposure` 只计曝光数量和覆盖，不产生负偏好。“曝光但无操作”不能被当作不喜欢。

`recommendation_batch_refresh` 只对同一 `recommendationBatchId` 中已经真实曝光过、且位于 `batchOutfitKeys` 的 outfit 产生极弱负向。找不到对应 exposure 时跳过。同一 outfit 同一自然日最多 3 次有效 refresh 负向贡献。

## Per-outfit 归一化

每个事件关联的 outfit 先按维度提取唯一特征值，再把该事件有效权重平均分配给该维度内的唯一值。同一 outfit 中重复颜色、重复设计元素或重复 style tag 只计算一次，避免衣物数量越多权重越大。

## Score 和 Confidence

每个维度和值累计：

```text
supportWeight = positiveWeight + negativeWeight
score = clamp((positiveWeight - negativeWeight) / supportWeight, -1, 1)
supportConfidence = clamp(supportWeight / 12, 0, 1)
diversityConfidence = clamp(distinctOutfitCount / 4, 0, 1)
confidence = supportConfidence * diversityConfidence * featureCoverage
```

输出门槛：

- `supportWeight < 1` 不进入 positive/negative。
- `score >= 0.15` 进入 positive。
- `score <= -0.15` 进入 negative。
- 每个维度每侧最多 5 项。
- 排序为 confidence 降序、`abs(score)` 降序、supportWeight 降序、value 字典序。

## 门控

全局 `shadow_ready` 必须同时满足：

```text
eligibleEventCount >= 8
distinctOutfitCount >= 4
effectiveActionWeight >= 8
featureCoverage >= 0.35
```

否则为 `insufficient_data`。即使数据不足，也可以保存质量指标和弱信号用于调试，但不得接入推荐。

单个 context 输出必须满足：

```text
eligibleEventCount >= 4
distinctOutfitCount >= 3
effectiveActionWeight >= 4
```

不达标的 scene 不输出，禁止用全局画像伪装成场景画像。

## 幂等和并发保护

`learned_style_profiles` 每个用户一个文档，`_id = lspv1_ + sha256(OPENID)`，不包含明文 OPENID。文档内仍保存服务端 `_openid` 用于隔离和审计。

`sourceDigest` 使用排序后的有效事件标识、版本信息和贡献摘要生成短 hash，不保存完整 eventId/outfitKey/clothingIds 列表。持久化使用 transaction：

- profileVersion 和 sourceDigest 相同时不重复写入，返回 `unchanged: true`。
- 现有 `lastEventAt` 晚于本次聚合时不覆盖，避免旧聚合覆盖新画像。
- 只有来源不旧于现有文档时才更新。

云函数返回只包含安全摘要，不返回 OPENID、eventId、outfitKey、clothingIds、衣物详情或完整画像。

## 集合权限

`learned_style_profiles` 仅云函数读写。本轮使用确定性 `_id` 直接读写，不新增跨用户查询索引、排行榜索引或群体统计索引。

## 当前 Shadow 状态

当前没有自动调用链，不在 `trackOutfitBehaviorEvents`、Today、Profile、收藏、穿它、`generateOutfit` 或定时任务中触发刷新。这样可以避免行为写入主链路增加延迟，并先通过手动调用或云函数控制台验证数据质量。

## 下周 Smoke Test

1. 先部署阶段 3 的 `outfit_behavior_events` 和 `trackOutfitBehaviorEvents`。
2. 创建 `learned_style_profiles`，权限设为仅云函数访问。
3. 部署 `refreshLearnedStyleProfile`。
4. 当前用户产生 exposure/detail/favorite/wear/refresh 事件。
5. 事件不足时刷新返回 `insufficient_data`。
6. 增加足够有效行为后刷新可返回 `shadow_ready`。
7. 相同数据重复刷新返回 `unchanged: true`。
8. 新增事件后 digest 改变并更新。
9. 不同 scene 只在达标时形成独立 context。
10. exposure only 不产生负偏好。
11. 重复 wear 权重大于首次 wear。
12. batch refresh 只对已曝光 outfit 产生弱负向。
13. profile 不含原始 eventId/outfitKey/clothingIds。
14. profile 不修改 `recommendationProfile`。
15. 推荐结果和排序完全不变。
16. 删除或缺失衣物不导致函数失败。
17. 只读取当前 `_openid` 数据。
18. 不把真实事件或画像导出提交到 Git。

后续刷新策略尚未启用。阶段 4 的权重接入应等待真实 shadow 数据验证后再决策；下一开发阶段可按计划进入阶段 6 Stylist Explanation V2。
