# Homepage AI-First Reason 生产验收

验收日期：2026-09-13（Asia/Shanghai）

## 结论

Homepage AI-first critical path 已完成并在 CloudBase 生产环境验证。首先部署并验收基线提交 `66fdb1e31ba41243b7ac5a6c28132ad7f3d54bb8` 的 `qwen3.7-max + compressed-v2`：Canonical HIT 达标，但 deterministic MISS 的 AI 首屏率为 0%，三次均触发 `SAFE_DEADLINE`。持久化 Job 审计证明主要 AI 瓶颈是 Max Provider latency，而不是 PLAN0 前置工作。

因此按预设条件进入精简 Fast Renderer Model Race。最终 `qwen-flash + compressed-v2 production-4` 在 8 组纯合成 NarrativePlan 上 8/8 通过既有 validator，事实边界、中文自然度和小搭克制语气经逐条检查通过。生产 renderer 已切换到 Flash；切换后的真实 Today HIT 与 deterministic MISS 均达到 AI 首屏率 100% 和 `CONTENT_VISIBLE max < 3000ms`。

## 真实 Today 结果

| 指标 | Max Canonical HIT | Max deterministic MISS | Flash Canonical HIT | Flash deterministic MISS |
| --- | ---: | ---: | ---: | ---: |
| `AI_REASON_FIRST_VISIBLE_RATE` | 1.000 | 0.000 | 1.000 | 1.000 |
| `PROVIDER_FRESH_RATE` | 0.000 | 0.000 | 0.000 | 1.000 |
| `SAFE_DEADLINE_RATE` | 0.000 | 1.000 | 0.000 | 0.000 |
| `SAFE_PROVIDER_ERROR_RATE` | 0.000 | 0.000 | 0.000 | 0.000 |
| `SAFE_VALIDATION_FAILED_RATE` | 0.000 | 0.000 | 0.000 | 0.000 |
| `CONTENT_VISIBLE P50` | 2919.9ms | 3678.2ms | 1797.6ms | 2314.4ms |
| `CONTENT_VISIBLE P95` | 2988.2ms | 4369.0ms | 2030.8ms | 2531.4ms |
| `CONTENT_VISIBLE max` | 2988.2ms | 4369.0ms | 2030.8ms | 2531.4ms |

Flash deterministic MISS 的关键路径：

| 指标 | min | P50 | P95 | max |
| --- | ---: | ---: | ---: | ---: |
| `PLAN0_TO_PROVIDER_START` | 53.532ms | 53.915ms | 157.627ms | 157.627ms |
| `PROVIDER_START_TO_FIRST_VALIDATED` | 441.592ms | 548.054ms | 595.891ms | 595.891ms |

对照 Max deterministic MISS：

| 指标 | min | P50 | P95 | max |
| --- | ---: | ---: | ---: | ---: |
| `PLAN0_TO_PROVIDER_START` | 57.617ms | 66.064ms | 66.448ms | 66.448ms |
| `PROVIDER_START_TO_FIRST_VALIDATED` | 1543.537ms | 1618.774ms | 1878.964ms | 1878.964ms |

Max 三次 `FIRST_VALIDATED` 分别在 handler 起点后的 1994.357ms、2056.924ms、2371.097ms，均晚于 1605ms Server Response Deadline。Flash 三次分别在 898.554ms、1026.955ms、930.132ms 完成验证并全部成为首屏 `PROVIDER_FRESH`。

验收证据：

- Max HIT：`artifacts/today-first-card-visible-acceptance/visible-20260913020022-ecbe0c29/report.json`
- Max MISS：`artifacts/today-first-card-visible-acceptance/visible-20260913020435-f07b58f7/report.json`
- Max MISS terminal Job 尾段：`artifacts/today-first-card-visible-acceptance/visible-20260913020435-f07b58f7/job-audit.json`
- Flash HIT：`artifacts/today-first-card-visible-acceptance/visible-20260913023721-5be077ad/report.json`
- Flash MISS：`artifacts/today-first-card-visible-acceptance/visible-20260913024845-b9361739/report.json`

Flash HIT/MISS 的微信开发者工具未触发图片 `onLoad`，因此报告中的 image timing 保持 `null`，没有推算或伪造。正文可见由 `wx.nextTick + SelectorQuery` 独立观测，正是本轮 `<3000ms` 产品门槛。

## 精简 Model Race

最终决策 cohort 使用 8 个 Flash 样本和 2 个同期 Max control，不重复 Max 历史全量验证。两者使用相同 NarrativePlan、`compressed-v2 production-4` prompt、generation parameters 与生产 validator。

| 指标 | qwen3.7-max control | qwen-flash |
| --- | ---: | ---: |
| 样本数 | 2 | 8 |
| Validator pass | 2/2（100%） | 8/8（100%） |
| Provider error | 0% | 0% |
| First Validated P50 | 1204.181ms | 370.962ms |
| First Validated P95 | 1265.003ms | 397.348ms |
| Complete P50 | 1227.613ms | 404.580ms |
| Complete P95 | 1288.003ms | 446.760ms |
| 观测单次成本 | ¥0.004974 | ¥0.000085875 |

Flash 代表性输出包括“上衣是这套搭配的图案重点，其他单品保持简单。”“上衣和下装一紧一松，轮廓有了对比。”“上衣和下装是同一色系，整体看起来很协调。”；弱证据样本只陈述“上衣和下装搭配，简单日常。”，没有添加身体效果、材质、天气或便利性推断。

最终 Race 证据：`artifacts/homepage-first-card-model-race/race-1789266458149.json`。

## 部署与门禁

基线 `66fdb1e` 已先部署并完成 Max 真实 Today HIT/MISS。Flash 切换提交 `c02df19` 随后部署到环境 `cloud1-d8gl3k1vkdf0b7f05`：

- `generateOutfit` 远端 manifest SHA-256：`8b1ad67144d525cacd4043f2e6267c183bc4e08bbf9206046c8d9a32e31df307`
- `recommendationStream` 远端 manifest SHA-256：`fdc66e606ce3b5eadcf31a7c21203373074858accbc4e9d5343943747330a2dd`
- 两个函数均通过远端依赖闭包、必需文件、隔离启动、manifest 完整性与 installed dependencies 校验。
- 部署证据：`artifacts/homepage-ai-first-flash-deploy-c02df19/deploy/deployment-report.json`

最终门禁：

- generateOutfit 回归：887/887 通过。
- 首页 Race、Today 验收、admin 与 cleanup safety：31/31 通过。
- `cmd /c pnpm typecheck`：11/11 packages 通过。
- `cmd /c pnpm lint`：通过，0 errors；439 个仓库既有 warnings。

deterministic MISS 仍使用 exact CAS 删除单条 cache、私有备份和删除后复查。关联 Job 只有在 `interactive`、无活跃 lease 且至少 5 分钟未更新时才可视为过期遗留；当前目标 Job 本身始终必须是 terminal。
