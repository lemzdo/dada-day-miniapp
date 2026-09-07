# Phase1A.3 首屏 AI 完成路径根因审计

日期：2026-09-07。生产请求为
`production-smoke-1788786394182-b71ad5f1-miss`，部署版本对应本地提交
`505138c`。本轮只读查询 CLS、Copy Job 与 canonical 文档；没有部署、没有发起新的
Provider 请求，也没有修改或删除生产数据。

## 结论

`FAST_PATH_SCHEDULING_VERDICT=PASS`：

```text
PLAN0_READY       1415.024 ms
PROVIDER_START    1812.396 ms
FULL_BATCH_READY  2322.097 ms
```

所谓“canonical 在 57.202 秒后出现”使用了 smoke `runId` 的创建时间作为起点，
混入了 baseline 请求、CLS/job 轮询、备份以及精确 cache reset；它不是 MISS 的
Provider 时长，也不是 response 关闭后的 serverless tail 时长。

```text
smoke runId timestamp                       13:06:34.182Z
baseline job created                        13:06:42.391Z
cache backup/cleanup plan created           13:07:12.894Z
MISS interactive job created                13:07:27.687Z
MISS canonical availableAt/write start      13:07:31.384Z
MISS job settlement timestamp               13:07:31.844Z
```

因此 57.202 秒可拆为：

- smoke 启动到 MISS job 建立：53.505 秒；这是测试编排，不是本次 MISS AI tail；
- MISS job 建立到 canonical write start：3.697 秒；
- canonical write start 到 job settlement timestamp：0.460 秒。

生产 job 的 `createdAt` 在 `prepareRecommendationCopyJob` 函数入口生成，早于
canonical read 和 reservation transaction；`availableAt` 在 canonical transaction
开始前生成；`completedAt` 在 canonical transaction 返回后、job settlement transaction
开始前生成。由同一份 durable job 可得以下保守边界：

```text
PLAN0_READY -> PROVIDER_START                         397.372 ms
Provider start -> canonical write start             <= 3299.628 ms
Canonical transaction + immediate handoff overhead <=  460.000 ms
Provider start -> job settlement timestamp             3759.628 ms
```

现有 CLS 在 `res.end()` 后没有收录 `PROVIDER_COMPLETE`、`STREAM_COMPLETE`、
`VALIDATOR_COMPLETE`、`CANONICAL_PERSISTED` 和最终 execution summary，因此不能把
3299.628ms 再诚实拆成 Provider headers、stream 和 validator 三段。对应字段必须标为
“缺少生产分段证据”，不能用 57 秒或历史本地数据代填。

## Tail ownership

HTTP/SSE 入口先等待 `runtime.aiDone`，发送 `complete` 并调用 `res.end()`，随后仍在同一个
handler Promise 中等待 `runtime.tailDone` 与 `runtime.backgroundDone`。响应关闭后不会再发送
canonical frame。callFunction 入口则直接返回 `runtimeResult.response`，没有把 tail Promise
放进返回等待链。

本次 MISS 的 job 始终是 interactive owner，`BACKGROUND_DISPATCHED=not_reached`，没有
worker dispatch token/retry/resume；最终 job 为 `completed` 且 canonical identity 与该 job
一致。因此完成者是原 SSE invocation 持有的 interactive tail，而不是后续请求或其他执行者。
数据库终态与 CLS 缺失并不矛盾：数据库证明 JS continuation 完成了 durable write；CLS 只证明
response 关闭之后的日志没有进入该 request 的可检索记录。现有证据不支持 freeze/resume。

## Admission 397.372ms

生产可观测分解为：

```text
PLAN0_READY -> CACHE_LOOKUP_DONE    371.679 ms
CACHE_LOOKUP_DONE -> AI_ADMITTED      1.277 ms
AI_ADMITTED -> PROVIDER_START        24.416 ms
合计                              397.372 ms
```

第一段包含 adapter 创建、canonical cache read 与 durable job reservation；现有生产埋点
无法进一步拆分。源码中 cache read 与 reservation transaction 严格串行，属于当前 admission
硬依赖。剩余 cards 的构建、candidate-pool persistence 和 C2 tasks 已与首卡 admission 并行，
没有新证据支持继续优化 selector/card0 Fast Path。若后续要优化 admission，应先在现有 job
写入上附带 read/reservation 分段，而不是为几十毫秒做结构重写。

## Candidate-pool 边界

candidate-pool hit 只复用候选组合，不等于 canonical copy hit。以下组合仍必须进入首卡 AI：

```text
executionMode == candidate_pool_hit
candidatePool cacheHit == true
CACHE_LOOKUP_DONE == miss
PROVIDER_START == occurred
```

当前 production smoke 报告没有保存 candidate-pool executionMode，因此本次样本不能证明或
否定该子路径的生产时序。canonical hit 则应为 Provider 0 次，不能与上述路径混为一类。

## 决策

选择 `CASE A`，但结论限定为：生产 Provider + stream + validation 到 canonical write start
的总上界约 3.300 秒，明确不是几十秒；57 秒主要是 smoke 编排口径错误，而不是运行时 tail。
由于 2300ms 绝对预算在 Provider start 时只剩 487.604ms，当前预算不可能容纳这次已观测的
AI 完成与 persistence，因而无法实现“首卡 + AI 理由一起交付”。

暂不修改 2300ms。单个 smoke 不能给出 P50/P95，也不能给出 Provider/stream/validator 的独立
分布。下一步应在不新增关键路径等待的前提下，把现有内存 audit 的阶段时间附带到已有
canonical/job settlement 写入，并在获准部署后采集 warm/cold 与 candidate-pool-hit +
canonical-miss 样本，再按 P50/P95 设计 response absolute budget 与 AI minimum useful window。
fallback 保持存在，不默认改成异步 overlay。

Phase1B 暂不建议进入：没有证据显示 canonical barrier 是主延迟，也没有证据显示 validator 或
persistence 单独主导。当前首先缺少的是可持久化的生产阶段分段与样本分布。
