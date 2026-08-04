# Candidate Pool V2 索引迁移

本文只描述 CloudBase 控制台的人工操作。代码不会自动创建、删除索引，也不会自动删除旧文档。

## V2 写入协议

`recommendation_candidate_pools` 仍由云函数读写，客户端不可直接访问。每个文档使用确定性 `_id`：

```text
pool-v2:<sha256(ownerHash)>:<sha256(candidatePoolId)>:manifest
pool-v2:<sha256(ownerHash)>:<sha256(candidatePoolId)>:chunk:<chunkIndex>
```

manifest 和 chunk 都使用 `doc(_id).set({ data })`，因此同一请求重试和同一 identity 的并发写入是幂等的。manifest 只有在所有 chunk 写入成功并通过 checksum 校验后才写入 `status: "ready"`。读取时只接受 ready manifest，并且只 hydrate manifest 声明范围内、索引连续且 checksum 正确的 chunk；超出范围的旧孤儿 chunk 不参与 hydrate。

当前生产保存路径使用 lightweight projection。manifest 和 chunk 均写入 `ownerHash`、`candidatePoolId`，候选数量完整保留，不做截断。

### 查询索引合同

用于 manifest/chunk 查询的索引名称必须为 `idx_candidate_pool_v2_lookup`，属性为 `NON-UNIQUE`。其实际过滤字段及顺序为：

| 顺序 | 字段 | 排序 | Unique |
| --- | --- | --- | --- |
| 1 | `ownerHash` | ASC | 否 |
| 2 | `candidatePoolId` | ASC | 否 |
| 3 | `recordType` | ASC | 否 |
| 4 | `schemaVersion` | ASC | 否 |

该索引仅用于 manifest/chunk 查询，不负责文档唯一性。`chunkIndex` 不加入过滤索引，避免索引合同把多个 chunk 错误约束成一条记录。确定性 `_id` 才是文档唯一性的来源；确定性 `_id` 也无法绕过旧 `idx1` 的唯一约束。

另外必须将 `expiresAt` 明确配置为 TTL 自动过期索引，而不是只创建一个普通 `expiresAt` 索引。代码仍会用 `expiresAtMs` 在读取时立即拒绝过期数据，不能依赖 TTL 调度的实时性。

在 CloudBase 控制台确认：

- `idx_candidate_pool_v2_lookup` 的类型为非唯一复合索引，字段顺序与上表一致，状态显示正常；
- `expiresAt` 的 TTL 自动过期开关已启用，TTL 索引状态显示正常；
- 真实文档中的 `expiresAt` 类型符合 CloudBase TTL 要求，为日期/时间类型，而不是字符串或数值。

## 安全迁移顺序

1. 关闭微信开发者工具和测试客户端，停止所有推荐请求。
2. 创建非唯一 `idx_candidate_pool_v2_lookup`，字段顺序为 `ownerHash ASC, candidatePoolId ASC, recordType ASC, schemaVersion ASC`。
3. 等待新索引状态显示正常，并确认 TTL 自动过期配置已启用且状态正常。
4. 记录当前集合文档数量和旧 `idx1` 状态，作为回滚基线。云端现有旧 `idx1` 为 `UNIQUE(ownerHash ASC, candidatePoolId ASC)`。
5. 删除旧 UNIQUE `idx1`。
6. 立即部署新版 `generateOutfit`。
7. 重新编译小程序。
8. 仅执行一次 sport 首次请求和一次 refresh。
9. 验证：
   - 首次 `candidatePoolSaveStatus=saved`；
   - `successfulChunkCount === chunkCount`；
   - `manifestWritten=true`；
   - `recommendationBatchIdPresent=true`；
   - refresh 的 `executionMode=candidate_pool_hit`；
   - `cacheHit=true`；
   - 无前后批重复；
   - 无 `CandidatePoolWriteError`。
10. 验证成功后，再处理旧 V1 和孤儿文档。
11. 最后确认 TTL 自动清理在真实文档上生效。

不得改为“先部署验证、最后删除 `idx1`”。旧 `idx1` 存在时，多 chunk 写入必然触发 `E11000`；新版保存失败本身必须保持推荐非致命并记录脱敏 diagnostic。

回滚必须按以下场景处理：

- 场景 A：删除 `idx1` 后，新代码尚未成功部署，且期间没有任何推荐请求。重新创建原 UNIQUE `idx1`，确认索引恢复，再开放客户端。
- 场景 B：新版已部署，但首次验证失败。不立即回滚旧代码，不立即重建 UNIQUE `idx1`；保持客户端停止请求，保存 `CandidatePoolWriteError` 和集合文档状态。新版保存失败本身必须保持推荐非致命。确认集合中不存在多个共享旧唯一键的 V2 文档后，才能决定是否恢复旧 `idx1`。
- 场景 C：已成功写入 V2 多 chunk。禁止重建旧 UNIQUE `idx1`，否则索引创建必然失败或再次破坏 V2 写入。

成功验证前不删除任何数据。成功后才允许处理：manifest 不存在或未 ready 的孤儿 chunk、已过期 V1 文档、以及 checksum/identity 不匹配的不可加载文档。清理前必须先 dry-run 统计并输出预计删除数；不得删除仍在 TTL 内且 manifest ready 的 V2 池。

## 轻量 Projection 字段消费矩阵

候选池只保存可重放的稳定事实，不保存运行时完整候选对象。当前生产保存路径使用 lightweight projection，字段消费关系如下：

| Projection 字段 | 消费位置 | 约束 |
| --- | --- | --- |
| `itemIds`, `roleItemIds`, `itemFactRefs`, `archetype` | 组合选择、衣物回填、标题事实 | 保持顺序和角色映射，不截断候选数 |
| `eligibility`, `weatherEligibility`, `sceneEligibility`, `aggregateEligibilityFacts` | eligibility 复核与推荐重放 | 只保存稳定代码、布尔值和数值事实 |
| `reasonCodes`, `selectedReasonCode` | reason descriptor、todayReason、标题关系事实 | 代码顺序稳定；文案由当前 canonical pipeline 重建 |
| `scores`, `scoreBreakdown`, `totalScore`, `rankingScore`, `reusePenalty` | 排序、响应评分、等价性校验 | 保留实际数值，不重新随机计算 |
| `selectionSignatures`, `stableSortId`, `outfitKey` | 排序稳定性、去重、pool/full equivalence | 作为 identity 内的稳定键 |
| `sceneIntent`, `benefits`, `observationFocus` | canonical presentation 和 QA 事实引用 | 仅保留稳定、可解释的事实 |
| `items`, `derivedFacts`, `copyContract`, `title`, `todayReason`, 原始 evidence | 不直接持久化 | 运行时按衣橱快照、reason code 和事实重新生成 |

写入前、manifest 写入前和读取 hydrate 前都必须完成字段/数量/checksum 校验。120 和 320 候选的实测 projection profile 记录 source/optimized bytes、p50/p95/max、manifest bytes、chunk bytes/count 和 reduction bytes/ratio；候选数必须与 manifest 一致，不能用截断换取通过。

文档中 helper 的 `182,930→163,510` 和 `488,730→437,310` 仅是合成 fixture 数据，不作为生产部署证据。正式生产证据如下：

| 场景 | 候选数 | runtimeBytes | projectionBytes | chunksBytes | manifestBytes | totalBytes | chunkBytes | 最大文档 | 候选是否完整 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- |
| sport | 120 | 5,720,206 | 278,230 | 279,762 | 1,211 | 280,973 | 244,224 / 35,538 | 244,224B | 是，120 条完整保留 |
| home | 320 | 11,918,247 | 695,422 | 697,721 | 1,210 | 698,931 | 244,577 / 246,105 / 207,039 | 246,105B | 是，320 条完整保留 |

因此正式部署依据是 sport 120 为 `280,973B / 2 chunks`、home 320 为 `698,931B / 3 chunks`；候选数量未减少或截断。
