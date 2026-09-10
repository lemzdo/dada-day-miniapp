# Phase1A Fast Path audit

日期：2026-09-03。本文是对 commit `281bee0` 的只读审计；未部署、未修改业务逻辑。

## 结论

card0 的候选 identity、plan0 复用和 provider 单次调用均满足 Phase1A 约束。
`generateRuleRecommendations` 先完成 card0 materialization 和 eligibility reason 固定，再调用回调（`apps/miniapp/cloudfunctions/generateOutfit/index.js:4664-4673`）。plan0 只在该回调中构建，汇总逻辑从 index 1 开始（`index.js:766-785`），并复用原对象。Orchestrator 以 `earlyCardOwner` 保存唯一 promise（`runtime/recommendationOrchestrator.js:177-224`），response race、tail 和 prepared path 都使用它。

## Failure cleanup 的可达性和影响

生产默认 early adapter 在 `index.js:877-907` 创建 `firstCardCopyJobPromise`。只有在完整候选计算已经触发 card0 回调后、`runRecommendationOrchestrator` 仍未完成 Core 时，以下异常才会进入这个窗口：

1. Core 在 card0 回调之后的后续 card materialization、plan 汇总或相关同步步骤抛错；
2. `prepareRecommendationWork` 内构建完整 entries 时同步抛错；其 Copy Job promise 本身的 cache read、transaction reserve 或数据库错误则由该 promise 的既有 catch/owner catch 观察；
3. assembler 在 prepared work 返回后失败。这个分支已有 prepared interactive adapter，能够走 `markCopyJobRetryable`，因此不是本风险的来源。

前两类异常进入 `runtime/recommendationOrchestrator.js:406-415`，调用 `drainEarlyCardOwner`；此时通常还没有 `prepared.firstCardInteractive`，而生产 early adapter 没有 `markCopyJobRetryable`。因此 cleanup 会有界等待并观察 provider rejection，但无法把已经 reserve 的 interactive job 显式写回失败状态。

这不会造成永久 pending lease。`prepareRecommendationCopyJob` 对 interactive job 的初始状态是 `interactive`（`recommendationCopyProductionJobV2.js:60-103`），不设置 worker `leaseUntil` 或 dispatch token。后台 worker 的 `acquireRecommendationCopyJob` 只处理带有效 dispatch token 的 queued/dispatched job（`recommendationCopyProductionJobV2.js:243-276`），所以该 job 不会被后台自动恢复或自动完成。

实际影响是：本次请求可能因 Core/prepare 原始错误失败，provider 结果若随后完成也不会写 canonical；job 留在 `interactive`，直到下一次相同 identity 的请求重新取得它并再次执行，或人工/后续恢复逻辑处理。相同用户重试不会被 job 状态硬阻塞，因为 `reserveJob` 会复用 identity 相同的 interactive job；但会留下短期 durable residue，并且不会有自动 lease recovery。这是 P2 运维/恢复完整性风险，低于数据丢失或永久阻塞的 P1；若发布标准要求所有 early admission 失败都必须立即转为可重试状态，则它仍是该标准的放行项。

## 验证

```text
node --test apps/miniapp/cloudfunctions/generateOutfit/card0FastPath.test.js apps/miniapp/cloudfunctions/generateOutfit/runtime/recommendationOrchestrator.test.js
47 passed, 0 failed

git diff --check
passed
```

现有测试覆盖 plan0/card0 等价性、HIT、重复 callback/provider、provider failure、Core/prepare/assembler bounded drain；测试中的 injected adapter 显式提供 retry hook，因此没有证明 production default early adapter 能更新 job 状态。

## 放行建议

Phase1A 的 identity、单实例和 provider 去重证据足够继续 production smoke。部署前是否阻塞取决于团队是否把“Core/prepare 失败后立即标记 interactive job 可重试”列为硬门槛；从当前 job 状态和重试行为看，这不是永久泄漏或用户重试阻塞。Phase1B 没有因本审计而必须修改 canonical barrier 的证据。
