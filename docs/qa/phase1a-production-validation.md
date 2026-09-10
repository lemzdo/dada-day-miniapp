# Phase1A production validation

日期：2026-09-03。验证对象为 `281bee0`（首卡 Fast Path）及本轮旁路观测、smoke 工具。本轮不部署、不 push、不调用生产推荐或清理线上缓存。

## 当前结论

**尚不能证明 Fast Path 已降低线上 AI_START 和 FIRST_CARD_VISIBLE。** Phase1A 尚未部署，现有生产记录也不包含完整的 before 时间线。本地调度顺序、身份等价和生命周期测试不能替代线上延迟测量。

- **当前不具备完整部署放行条件**：仍缺线上 after 和完整 UI 时间线，failure cleanup 存在下述 P2 限制，且 ledger 检查存在已在 HEAD 复现的失败。本地类型、定向回归及制品闭包检查通过不能替代这些门槛。
- 暂不进入 Phase1B 实现。先取得可比的 Phase1A 前后 MISS/HIT 数据，再决定下一阶段。
- 目前没有证据证明必须修改 canonical barrier。本轮保留 barrier 及其完整 batch 保存、一致性和失败恢复语义。

## 已有生产证据

本机只读复核 `artifacts/production-first-card-smoke/2026-09-03T01-23-49-666Z/report.json`。该报告 `sourceCommit=68ebfc5` 只标识当时本地工具源码，不构成远端部署版本证明；报告状态为 `FAIL / CLOUD_AUDIT_OR_TAIL_NOT_READY`。

服务端计时原点为 runtime 的 handlerOrigin，不含 HTTP 入口到 runtime 前的准备。以下 AI_START 取真实 `PROVIDER_START`，不取较早的 admission，也不取曾记录 `not_admitted` 的 summary 时间。

| canonical cache | 版本 | AI_START | AI_COMPLETE | VISIBLE |
| --- | --- | ---: | --- | --- |
| MISS | before，已有失败样本 | 3474.136 ms | 缺失 | 缺失 |
| MISS | after，未部署 | 未采集 | 未采集 | 未采集 |
| HIT | before，已有 baseline | N/A，Provider 0 次 | N/A | 缺失 |
| HIT | after，未部署 | 未采集 | 未采集 | 未采集 |

MISS 的 `CORE_READY=2146.626 ms`，旧 `NARRATIVE_PLAN_READY=2765.138 ms`，`CACHE_LOOKUP_DONE=3374.600 ms`；响应预算为 2300 ms，最终 Provider 在原有 tail 路径中启动。旧 NARRATIVE_PLAN_READY 是全量准备边界，不能改名冒充 PLAN0_READY。已有存储检查表明后来生成了 canonical，但没有同次请求的完整执行审计，不能倒推 AI_COMPLETE 或客户端可见时间。

HIT baseline 虽通过缓存定位检查，`canonicalTextMatched=false` 且响应为 deadline 降级；它不能作为完整 HIT 展示验收的成功样本。

## 测量与判定边界

AI_START 定义为 Provider 调用开始；AI_COMPLETE 定义为完整流消费和校验的执行终态。旧 PROVIDER_COMPLETE 只表示 execute 返回或抛错，不能替代 AI_COMPLETE。PLAN0_READY 取首个真实 plan 构建完成；CANONICAL_READY 表示可复用 canonical 已从缓存取得或完成原持久化流程。

服务端阶段使用同一请求的单调时钟。客户端可见时间使用客户端请求开始为原点，保留 batch 关联与测量方式。两个时钟的绝对时间不能直接相减。HTTP 完成、SSE ready 到达、React 状态提交和首卡进入可见区域是不同边界；缺少真正可见证据时 VISIBLE 必须标为缺失。

固定 MISS/HIT 指 canonical 文案缓存状态，并非 candidate-pool 状态；两者必须分开记录。两组输入须保持相同用户、日期、场景、天气、衣橱/偏好及 fingerprint，并记录远端版本、冷/热启动条件。HIT 预期 Provider 0 次，AI 时间是 N/A，不能写成 0 ms 的提速。

完整对比需要每个版本分别收集同条件 MISS/HIT，保留 provider 调用次数、成功校验、canonical 持久化、UI 可见及失败比例。单次成功样本仅是 smoke，不用于宣称 p50/p95 改善。

## 审计结论

card0 identity 冻结、plan0 单实例复用、请求内 Provider 去重通过。现有定向测试覆盖重复/重入/延迟 callback、Core/prepare/assembler 失败和 provider 延迟拒绝。

Failure cleanup 的 promise 消费和有界等待通过，但 durable 状态清理不完整：如果早期 job 已保留，而 Core/prepare 在完整 prepared adapter 返回前失败，默认 early adapter 无 retry hook，job 可能保留 `interactive`。该状态没有自动 lease 恢复；同 identity 的请求仍可复用，并非永久阻塞。按 P2 记录，不能把“不会产生 unhandled rejection”表述为“durable job 已完整清理”。本轮禁止修改业务逻辑，因此只记录问题，不修改恢复行为。

## Phase1B 决策条件

只有在有效样本中反复观察到 AI 提前完成，但仍明显等待完整 batch 保存/组装或 canonical 持久化，且该等待主导首卡可见时间，才值得提出 barrier 改动设计。还需单独测量 batch commit 完成和 canonical 写入开始/结束，区分 barrier 等待、数据库写入耗时、Provider 耗时和客户端渲染耗时。

如果 AI_START 仍很晚，应先定位 PLAN0_READY 之前的工作及 admission/cache I/O；如果 AI_COMPLETE 主导耗时，应先评估 Provider；如果服务端已 ready 而 VISIBLE 仍很晚，应先定位传输和客户端。现有 before 证据只支持 pre-AI 预算耗尽，不能归因于 canonical barrier。

## 检查与审计

| 检查 | 结果 |
| --- | --- |
| miniapp typecheck | 通过 |
| production smoke + Fast Path + Orchestrator + HTTP/SSE 定向回归 | 123/123 通过 |
| 定向 ESLint | 通过，0 errors / 106 warnings，未进行无关 warning 清理 |
| 制品闭包与隔离启动 | 13/13 通过 |
| todayPerformanceLedger | 5 通过 / 1 失败 |
| 同一 ledger 测试读取未修改 HEAD 源码 | 同一用例失败，确认是已有问题 |
| 旧生产报告 + 缺失 after 的离线 compare | 按预期返回不可比、退出码 1；保留 AI_START=3474.136 ms |
| git diff --check | 通过 |

失败用例为 `todayPerformanceLedger.test.js:29` 的 `restore decisions use fixed privacy-safe reasons and preserve exceptions`：要求 Today 页面包含 `recordTodayRestoreException(error)` 后重新抛出错误，HEAD 中该调用路径已不存在。本轮不恢复或重写业务流程，也不削弱测试断言。

依照 AGENTS.md 第 15 条，检查失败时禁止 commit，因此**本次无 commit hash / message**，改动全部保留为未提交状态。没有部署、push 或生产数据库操作。仅修改文档的审计部分不单独运行代码检查；本轮应用/工具改动已运行以上相关检查。

实际命令：

```powershell
cmd /c pnpm --filter @starter-template/miniapp typecheck
node --test apps/miniapp/scripts/production-first-card-smoke/*.test.js apps/miniapp/cloudfunctions/generateOutfit/card0FastPath.test.js apps/miniapp/cloudfunctions/generateOutfit/runtime/recommendationOrchestrator.test.js apps/miniapp/cloudfunctions/recommendationStream/index.test.js
node node_modules/eslint/bin/eslint.js apps/miniapp/scripts/production-first-card-smoke/*.js apps/miniapp/cloudfunctions/generateOutfit/index.js apps/miniapp/cloudfunctions/generateOutfit/runtime/recommendationOrchestrator.js apps/miniapp/cloudfunctions/generateOutfit/runtime/recommendationOrchestrator.test.js apps/miniapp/cloudfunctions/recommendationStream/index.js apps/miniapp/cloudfunctions/recommendationStream/index.test.js apps/miniapp/src/lib/performance/todayPerformanceLedger.ts apps/miniapp/src/pages/today/index.tsx eslint.config.mjs
node --test --test-reporter=dot apps/miniapp/scripts/check-recommendation-artifacts.test.js apps/miniapp/scripts/stage-recommendation-stream.test.js
node --test apps/miniapp/src/lib/performance/todayPerformanceLedger.test.js
node --test artifacts/phase1a-validation/ledger-baseline.cjs
cmd /c pnpm first-card:production-smoke:compare artifacts/production-first-card-smoke/2026-09-03T01-23-49-666Z/report.json -
git status --short
git diff --stat
git diff --check
```

检查日志及离线对比保存在本机 Git 忽略目录 `artifacts/phase1a-validation/`。`ledger-baseline.cjs` 只在测试进程中从 `git show HEAD:...` 读取两个原始源码，不替换工作区文件。

审计详见 [Phase1A 审计](./phase1a-audit.md)，smoke 使用方式详见 [production smoke](./production-first-card-smoke.md)。当前 HTTP runner 不驱动页面：五个里程碑的服务端记录、客户端布局观测、离线导入与比较均已提供，但全自动生产 UI 采样尚未完成，不能宣称端到端验证完成。

## 本轮直接修改文件

```text
apps/miniapp/cloudfunctions/generateOutfit/index.js
apps/miniapp/cloudfunctions/generateOutfit/runtime/recommendationOrchestrator.js
apps/miniapp/cloudfunctions/generateOutfit/runtime/recommendationOrchestrator.test.js
apps/miniapp/cloudfunctions/recommendationStream/index.js
apps/miniapp/cloudfunctions/recommendationStream/index.test.js
apps/miniapp/src/lib/performance/todayPerformanceLedger.ts
apps/miniapp/src/pages/today/index.tsx
apps/miniapp/scripts/production-first-card-smoke/evidence.js
apps/miniapp/scripts/production-first-card-smoke/evidence.test.js
apps/miniapp/scripts/production-first-card-smoke/runner.js
apps/miniapp/scripts/production-first-card-smoke/runner.test.js
apps/miniapp/scripts/production-first-card-smoke/compare.js
apps/miniapp/scripts/production-first-card-smoke/compare.test.js
docs/qa/phase1a-audit.md
docs/qa/phase1a-production-validation.md
docs/qa/production-first-card-smoke.md
eslint.config.mjs
package.json
```

已有未提交的 production smoke 基础文件、`docs/qa/first-card-ai-smoke.md`、`_tmp_luna_final/` 和 `_tmp_luna_r8/` 均保留。本轮的旁路观测没有新增业务数据库读写，没有改变 SSE payload、缓存算法、Provider 参数、请求预算、候选顺序或 canonical barrier。
