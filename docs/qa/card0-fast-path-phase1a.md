# card0 Fast Path Phase1A 验收

日期：2026-09-03。仅本地实现与验证，未部署、未 push。

## 实现范围

- 完整候选排序、batch 选择、全 batch eligibility reason 分配和校验后，materialize card0、构建 plan0、立即触发既有 onFirstCardReady。
- card1–N 保留原 materialize、planner 和全 batch 返回流程。plan0 对象保留并直接复用；plan0 构建失败也不重试。
- index.js 内汇总既有 planner 的结果与诊断，保留单卡失败降级。HIT 继续使用原完整 materialize → safe styling helper 路径。
- Orchestrator 在准备前锁定唯一 owner；响应竞争、tail 和错误清理接管同一 promise。重复、重入、Core 完成后的延迟回调均不会重复启动 provider。
- canonical 写入仍由原 prepared adapter 在完整 batch 保存/组装之后执行。清理不写 canonical；已取得 prepared adapter 时通过原接口将失败 batch 的 job 标记可重试。
- SSE、客户端、timeout 常量、prompt/model/provider 参数、cache key/fingerprint 算法、候选排序和 batch commit 实现均未改变。

## before / after

确定性 8 卡测试通过真实 materializer 和 planner 记录事件，没有以等待时长代替先后关系。

| 路径 | 事件顺序 |
| --- | --- |
| Before | 完整选择及 reason → materialize0–7 → plan0 → admission → plan1–7 → 完整 batch 保存/组装 → canonical/响应或既有 tail |
| After | 完整选择及 reason → materialize0 → plan0 → admission → materialize1–7 → plan1–7（复用 plan0）→ 完整 batch 保存/组装 → canonical/响应或既有 tail |
| HIT | 保留 Before 的 materialize / plan / admission 边界 |

这里证明的是既有调用链 admission 提前，不是线上延迟数字。生产 admission 仍需等待既有 durable job/cache I/O；Node 的同步计算、网络与缓存状态决定真实 provider 开始时间和最终收益。

## 验证证据

- Fast Path：真实 8 卡结果与原有“全 materialize 后调用 safe styling helper”的调度对照，完整卡片字段、排序、reason、countContract 和全部 plan 相同。
- plan0：同一个对象进入 core.narrativePlans[0]；每个索引只调用一次真实 planner。通过原 renderer entry builder 深比较 outfitKey、planId、输入与 renderInputFingerprint。
- HIT：真实 pool 序列化/重建后，结果、identity、fingerprint 和回调边界一致；另有 canonical cache HIT 测试确认不调用 provider。
- 生命周期：provider 仅一次；early adapter 缺少保存方法时仍由 prepared adapter 保存；batch commit 完成前不发 ready、不写 canonical；Core/prepare/assembler 失败、同步/异步准备失败、provider 延迟拒绝、超时后拒绝都被观察和收尾。
- 失败降级：plan0/plan1 构建异常、entry 构建异常、hook 同步异常/拒绝均保留完整 batch 与原降级语义。
- 回归：SSE ready/complete 顺序、响应结束后 tail 不发新帧、批次保存、缓存及原 renderer/provider 合约。

最终相关测试共 179 项通过，0 失败；其中新 Fast Path 对照 7 项，Orchestrator 40 项。

已校正两条测试假设：已有 provider 审计事件还包括 STREAM_COMPLETE / EXECUTION_COMPLETE；完整 plan 汇总现在可复用 plan0，因此原检查必须定位汇总边界而非固定函数调用文本。

## 检查命令

```powershell
cmd /c pnpm --filter @starter-template/miniapp typecheck
node --test --test-reporter=dot apps/miniapp/cloudfunctions/generateOutfit/runtime/recommendationCore.test.js apps/miniapp/cloudfunctions/generateOutfit/runtime/recommendationRuntime.test.js apps/miniapp/cloudfunctions/generateOutfit/runtime/recommendationOrchestrator.test.js apps/miniapp/cloudfunctions/generateOutfit/card0FastPath.test.js apps/miniapp/cloudfunctions/generateOutfit/recommendationV2Gating.test.js apps/miniapp/cloudfunctions/generateOutfit/services/batchEligibilityReasonSelection.test.js apps/miniapp/cloudfunctions/generateOutfit/services/recommendationStylingShadowV2.test.js apps/miniapp/cloudfunctions/generateOutfit/services/recommendationCopyProductionJobV2.test.js apps/miniapp/cloudfunctions/generateOutfit/services/recommendationFirstCardRenderer.test.js apps/miniapp/cloudfunctions/generateOutfit/services/recommendationVoiceRendererProductionV2.test.js apps/miniapp/cloudfunctions/generateOutfit/services/candidatePool.test.js apps/miniapp/cloudfunctions/generateOutfit/services/candidatePoolStorage.test.js apps/miniapp/cloudfunctions/generateOutfit/services/recommendationV2BatchRepository.test.js apps/miniapp/cloudfunctions/recommendationStream/index.test.js
node node_modules/eslint/bin/eslint.js apps/miniapp/cloudfunctions/generateOutfit/index.js apps/miniapp/cloudfunctions/generateOutfit/runtime/recommendationOrchestrator.js apps/miniapp/cloudfunctions/generateOutfit/runtime/recommendationOrchestrator.test.js apps/miniapp/cloudfunctions/generateOutfit/card0FastPath.test.js apps/miniapp/cloudfunctions/generateOutfit/services/recommendationCopyProductionJobV2.test.js apps/miniapp/cloudfunctions/generateOutfit/services/recommendationStylingShadowV2.test.js --quiet
git diff --check
```

上述检查通过。pnpm exec eslint 在当前工作区因命令 shim 缺失无法启动，改为调用同一工作区已安装的 ESLint 9 入口；没有修改依赖、锁文件或已有未提交的 eslint 配置。未运行全仓 lint 或线上端到端测试。

## 风险与 Phase1B 建议

- 尚未测量线上 p50/p95；本次只验证 admission 提前及业务/协议等价，不据此宣称线上提速数值。
- 提前 admission 后 batch 可能失败，已启动的 provider 会产生无最终交付的计算；本次按现有 tail 时限清理，不前移 canonical 保存。
- Core/prepare 失败时尚无完整 prepared adapter，清理仅有界消费 promise；durable job 的进一步恢复仍依赖原有恢复机制。错误返回可能等待现有 tail 时限（默认 6000ms）。
- index.js 的 plan 汇总必须与既有 helper 保持降级语义同步，动态等价测试作为回归约束。

建议进入 Phase1B 设计与评审；本次没有执行 Phase1B，也没有部署。若 Phase1B 涉及 canonical persistence 前移，应单独验证 batch 失败、幂等/缓存和 durable job 一致性，不沿用本次测试作为放行依据。
