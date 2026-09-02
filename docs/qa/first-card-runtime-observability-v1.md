# First Card Runtime Observability Contract v1 实施验收

日期：2026-09-02。仅实现诊断合同，未部署、未请求真实 AI 服务。

## 日志读取

`[RecommendationAudit]` 与 `[RecommendationAuditSummary]` 的 `failure` 遵循
`first-card-runtime-observability/v1`，类型从 `@starter-template/types` 导出。

- `stage` / `code`：失败源阶段和固定原因码。
- `provider.httpStatus` / `requestId` / `errorCode`：已有响应或异常中的结构化证据。
- `retryability`：诊断建议，不触发重试。
- `providerIssue` / `businessRejected` / `deadline.causedFailure`：yes/no/unknown，证据不足保留 unknown。
- `auditId` / `attemptId` / `failureId`：请求、实际执行尝试、同一失败的跨层关联。
- `evidence`：经过过滤的异常类型、网络码、校验码。不记录正文、prompt、凭据或原始异常对象。

同一失败由 Core → consumer → Renderer → Orchestrator 传播时保持 failureId。
`PROVIDER_COMPLETE` 仍表示 execute 返回或抛错；`STREAM_COMPLETE` 与
`EXECUTION_COMPLETE` 分别补充流消费和执行终态。诊断不进入 SSE payload 或数据库。

`responseSummary` 固定保存响应时快照；后续 summary 的 `snapshot` 标记
response/tail/execution。`responseDeadlineReached` 和 `tailWaitExpired` 不等于 provider
失败。已有执行链在 tail 等待结束后观察到结果，仍可记录诊断，不延长等待或追加调用。

## 必需场景

| 证据 | stage / code | retryability | providerIssue | businessRejected | deadline.causedFailure |
|---|---|---|---|---|---|
| HTTP 401 | http_response / PROVIDER_HTTP_ERROR | not_retryable | no | no | no |
| HTTP 429，明确临时限流码 | http_response / PROVIDER_HTTP_ERROR | retryable | yes | no | no |
| HTTP 503 | http_response / PROVIDER_HTTP_ERROR | retryable | yes | no | no |
| ECONNRESET | request 或 stream_read / NETWORK_ERROR | retryable | unknown | no | no |
| 已确认 provider/renderer timer 超时 | request 或 stream_read / PROVIDER_TIMEOUT | retryable | unknown | no | yes |
| 通用 provider SSE error event | stream_read / PROVIDER_STREAM_ERROR | unknown | unknown | no | no |
| 失败输出含无法解析的 JSON | output_parse / OUTPUT_PARSE_FAILED | unknown | unknown | no | no |
| 明确业务 validator reject | validation / VALIDATION_REJECTED | unknown | no | yes | no |

另外覆盖未知 429、来源未知 AbortError、结构校验拒绝、Core 加载失败、冻结异常、
原生 Response headers、二次归一化、日志异常与 tail 生命周期。
结构拒绝不能自动归为业务拒绝；已被原逻辑容忍的解析异常仍允许后续成功。

## 验证结果

- 合同及关联回归：99/99 通过。
- 本地制品闭包、staging、隔离启动门禁：13/13 通过；没有部署操作。
- ai-core、types、miniapp typecheck：通过。
- 所有改动代码的定向 ESLint：通过，0 errors / 48 warnings。
- `git diff --check`：通过。
- 基于 HEAD 的 AST/源码对比：provider fetch 参数、withDeadline 参数、prompt、请求构造、
  validator、原 parser、timer 预算、Promise.race 参与者、policy.js 保持不变。
- SSE 对比测试：增加 failure 后，事件字节、响应头与原行为完全一致。

运行命令（仓库根目录）：

```powershell
node --test packages/ai-core/src/ai-core.test.js packages/ai-core/src/provider.test.js packages/ai-core/test/secret.test.js apps/miniapp/cloudfunctions/generateOutfit/services/recommendationFirstCardRenderer.test.js apps/miniapp/cloudfunctions/generateOutfit/services/recommendationVoiceRendererProductionV2.test.js apps/miniapp/cloudfunctions/generateOutfit/runtime/recommendationOrchestrator.test.js apps/miniapp/cloudfunctions/generateOutfit/runtime/recommendationRuntime.test.js apps/miniapp/cloudfunctions/recommendationStream/index.test.js apps/miniapp/cloudfunctions/generateOutfit/recommendationServerDone.test.js apps/miniapp/cloudfunctions/generateOutfit/services/aiCoreLocalResolution.test.js
node --test apps/miniapp/scripts/check-recommendation-artifacts.test.js apps/miniapp/scripts/stage-recommendation-stream.test.js
cmd /c pnpm --filter @d1d/ai-core --filter @starter-template/types --filter @starter-template/miniapp typecheck
node node_modules/eslint/bin/eslint.js eslint.config.mjs packages/ai-core/src/failure.js packages/ai-core/src/provider.js packages/ai-core/src/index.js packages/ai-core/src/provider.test.js packages/ai-core/src/ai-core.test.js packages/ai-core/src/index.d.ts packages/types/src/index.ts packages/types/src/first-card-runtime-observability.ts apps/miniapp/cloudfunctions/generateOutfit/index.js apps/miniapp/cloudfunctions/generateOutfit/runtime/recommendationOrchestrator.js apps/miniapp/cloudfunctions/generateOutfit/runtime/recommendationOrchestrator.test.js apps/miniapp/cloudfunctions/generateOutfit/services/firstCardObservability.js apps/miniapp/cloudfunctions/generateOutfit/services/recommendationFirstCardRenderer.js apps/miniapp/cloudfunctions/generateOutfit/services/recommendationFirstCardRenderer.test.js apps/miniapp/cloudfunctions/generateOutfit/services/recommendationVoiceRendererProductionV2.js apps/miniapp/cloudfunctions/generateOutfit/services/recommendationVoiceRendererProductionV2.test.js apps/miniapp/cloudfunctions/recommendationStream/index.test.js
git diff --check
```

此环境的 `pnpm exec eslint` 未解析到命令，因此直接使用仓库已安装的 ESLint 入口。
根 ESLint 配置仅补齐这些 CommonJS 文件的 Node 环境；既有异构 task executor 的
`Promise<any>` 声明保留，避免此次诊断工作改变已有调用方类型合同。

## 修改文件（21）

```text
packages/types/src/first-card-runtime-observability.ts
packages/types/src/index.ts
packages/ai-core/src/failure.js
packages/ai-core/src/provider.js
packages/ai-core/src/index.js
packages/ai-core/src/index.d.ts
packages/ai-core/src/provider.test.js
packages/ai-core/src/ai-core.test.js
packages/ai-core/package.json
pnpm-lock.yaml
apps/miniapp/cloudfunctions/generateOutfit/services/firstCardObservability.js
apps/miniapp/cloudfunctions/generateOutfit/services/recommendationFirstCardRenderer.js
apps/miniapp/cloudfunctions/generateOutfit/services/recommendationVoiceRendererProductionV2.js
apps/miniapp/cloudfunctions/generateOutfit/runtime/recommendationOrchestrator.js
apps/miniapp/cloudfunctions/generateOutfit/index.js
apps/miniapp/cloudfunctions/generateOutfit/services/recommendationFirstCardRenderer.test.js
apps/miniapp/cloudfunctions/generateOutfit/services/recommendationVoiceRendererProductionV2.test.js
apps/miniapp/cloudfunctions/generateOutfit/runtime/recommendationOrchestrator.test.js
apps/miniapp/cloudfunctions/recommendationStream/index.test.js
eslint.config.mjs
docs/qa/first-card-runtime-observability-v1.md
```

共享类型为开发期依赖，无新增运行时依赖。原有 `_tmp_luna_final/`、`_tmp_luna_r8/` 未改动。
