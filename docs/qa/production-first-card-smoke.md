# Production Smoke Enablement

在已登录的微信开发者工具中打开本项目，并保持页面空闲；使用现有 CloudBase 管理员登录态，在仓库根目录运行：

```powershell
cmd /c pnpm first-card:production-smoke
```

不需要选场景、复制 openid、寻找 fingerprint 或部署。命令固定使用当前微信用户、居家、关闭天气、当天 UTC 日期、all_day，通过真实 `wx.cloud.callHTTPFunction` 请求生产 `recommendationStream /recommendations`。它验证微信鉴权、已部署 HTTP 函数、线上数据库和 Provider；不依赖本地内存 fixture。此入口在开发者工具内执行，不等同于手机端 UI 验收。

## 方案决策

| 方案 | 风险 | 改动范围 | 部署 | 人工步骤 |
| --- | --- | --- | --- | --- |
| A 精确清理当前用户首卡 canonical cache | 一条派生文案缓存失效；须备份、校验身份和并发 job | 本地运维脚本；必要时删除 1 条 cache | 不需要 | 一条命令 |
| B 创建测试用户 | 需要另一个微信身份和可推荐衣橱，会新增业务数据 | 登录、用户及衣橱准备 | 通常不需要 | 多步且依赖测试账号 |
| C admin-only smoke reset | 新增生产管理入口、鉴权维护和误用面 | 云函数/API、权限和部署 | 需要 | 部署后仍需 reset + smoke |
| D 改场景/天气/日期寻找自然 MISS | 无法提前确定 fingerprint 是否已缓存 | 无代码改动 | 不需要 | 不确定，需要尝试 |
| D 已有 deterministic QA runner | 不触及线上数据，不能验证生产微信网关/数据库 | 已有工具 | 不需要 | 一条命令，但验收范围不足 |

选择 A，并优先使用自然 MISS：先发一次固定输入请求，从线上 job 读取真实首卡 fingerprint。若 baseline 已自然 MISS 且 AI 成功，直接执行 HIT 验证，不删任何缓存；若 baseline HIT，执行单条 reset 后发 MISS、HIT 两次请求。每次命令最多 3 个请求，不以反复尝试换取通过。

## 存储与清理边界

- `recommendation_canonical_copy_cache_v2`：唯一允许删除的集合，最多一个文档。ID 是 `rcc-` + SHA-256(`openid|rendererVersion|renderInputFingerprint`)；同时核对 `_openid`、version、renderer version、fingerprint、cacheId、source、text。
- `recommendation_copy_jobs_v2`：只读，不删除。ID 是 `rcj-` + SHA-256(`openid|batchId|rendererVersion`)，entry position=0 提供精确 cacheId/fingerprint。新 batch 正常执行 admission，旧 job 的 readyCopies 继续服务旧批次。
- 同用户且引用该 cache 的 job 必须全部处于已知终态；queued/interactive/running/dispatching/dispatched/未知状态、有效 lease、非法 lease 均拒绝。按 `_id` 排序分页读取；分页不完整时拒绝清理。
- `recommendation_batches_v2`、candidate pools 影响候选和批次，但不替代 canonical cache lookup；`outfits` 中 canonical 快照供已有穿搭使用。它们不在清理范围。
- users、clothes、outfits、收藏、历史、偏好和客户端缓存均不删除。正常推荐请求仍会按原逻辑保存推荐批次与派生数据。

依据：`generateOutfit/services/recommendationCopyProductionJobV2.js` 的 identity、prepare、readCachedCopies、canonical writer；`recommendationVoiceRendererShadowV2.js` 的 buildRenderInputFingerprint；`generateOutfit/index.js` 的 prepareFirstCardInteractive；`outfitCompositionV1.js` 的 compareCandidates。

固定输入只更换 auditId/v2BatchId；这两个字段不进入 render fingerprint。排序由 score/item signature 决定，request seed 仅参与 narrative plan identity。因此无需扩大清理范围。执行过程中如果衣橱/偏好等输入变化，后续指纹核对会拒绝 PASS。

## 执行与证据

本地 CLI 使用现有 `@cloudbase/cli` 的 NoSQL 命令和 CLS 函数日志接口，不读取或输出 Provider 密钥，不增加生产 admin endpoint。初次使用需已经完成正常 CloudBase 登录；沙箱可能需要访问 CLI 配置目录的权限，这不表示线上权限缺失。

删除之前，完整原文档与 plan 写入 Git 忽略的 `artifacts/production-first-card-smoke/<timestamp>/cache-backup.private.json`。该文件包含用户标识和文案，应仅在本机保留。计划有效期 10 分钟；删除前重新核对用户、cache、相关 job。DELETE 使用完整原文档作条件，并固定 `limit: 1`，确认实际影响数及删除后不存在。不会自动重试删除，也不覆盖可能已重新生成的 canonical。

每次请求使用独立 auditId，从 CLS 读取完整分页并关联。PASS 必须包含：

```text
CACHE_LOOKUP_DONE=miss
FIRST_CARD_AI_ADMITTED=admitted
PROVIDER_START=started（恰好 1 次）
PROVIDER_COMPLETE=completed
VALIDATOR_COMPLETE=accepted
CANONICAL_PERSISTED=completed 或 tail
summary.executionOutcome=succeeded / validated=true / persisted=true / failure=null
```

再用相同 fingerprint、新 batch 验证 HIT、Provider 0 次、展示 canonical 文案 hash 与存储一致。baseline 仅用于定位目标缓存，其冷启动降级文案不阻止 reset；最终 HIT 仍须严格匹配文案 hash。HIT 的 AI executionOutcome 可为 `not_started`，因为这一请求无需启动 AI。HTTP 必须 200，SSE ready/complete 必须属于本次 batch；尾部持久化以云端 job 与最终审计为准，不能仅看页面或 HTTP complete。

CloudBase 将一个 console 对象拆成多条 CLS 记录。脚本先按唯一 auditId 找到云端 request_id，再按该 request_id 全分页、升序读取并重组对象。同时间戳行保留服务返回顺序，不用包含 auditId 的单行代替完整审计。

`report.json` 和各阶段 JSON 保存脱敏 audit、summary、cacheId、fingerprint、文案 hash、删除数和错误码，不保存文案正文、密钥或完整日志。日志解析只接受字面量 AST，不执行日志中的代码。退出码 0=PASS、1=失败、2=用法错误。失败后先查看报告；若已经删除，保留 private backup，不自动覆盖新缓存。

## Phase1A 时间线对比

两次采样可使用相同日期，例如 `cmd /c pnpm first-card:production-smoke --date 2026-09-03`。
默认仍取当天 UTC 日期，场景、天气和 timeOfDay 保持原固定值；日期非法时拒绝执行。
固定 MISS/HIT 指 canonical 文案缓存，不是候选池命中状态。

时间线读取同 auditId 的 `[RecommendationStage]` 与 `[RecommendationAudit]`：

- PLAN0_READY：真实首卡 plan 构建完成；旧 NARRATIVE_PLAN_READY 不可代替。
- AI_START：PROVIDER_START；admission 不是 Provider 调用。
- AI_COMPLETE：EXECUTION_COMPLETE，即流消费和校验终态；PROVIDER_COMPLETE 只是 execute 返回，不能代替。
- CANONICAL_READY：缓存读取成功或原有 canonical 持久化流程成功，包括 tail。
- FIRST_CARD_VISIBLE：Today 在 nextTick 后查询首卡 native bounding rect，与 viewport 相交且仍为当前 batch/card0。采用现有 develop/trial 诊断开关；release 保持关闭。该观测证明布局可见，不保证所有衣物图片已加载。

服务端时间统一相对 runtime 的 handlerOrigin（不含 HTTP 入口到 runtime 前的准备）；客户端相对本次推荐请求开始。
本轮没有改变预算或原有时钟。客户端日志标签是 `[TodayPerformance]`，包含 batchId、generation、
boundary、clock 和 elapsedFromRequestMs；本地 ledger 继续记录原单调时钟时间。
不能把两个时钟的绝对时间相减。

HTTP runner 不渲染 Today 页面，因此每条记录的 `visibility.status=unavailable`，
FIRST_CARD_VISIBLE 为 null。HTTP complete 和 SSE ready 不作为可见时间。
它负责固定 MISS/HIT 和服务端审计；完整可见验收还需同一请求的 Today UI 采样，
不能拼接另一个批次的页面数据。本阶段没有实现自动驱动页面的端到端采样。

离线比较：

```powershell
cmd /c pnpm first-card:production-smoke:compare before.json after.json
cmd /c pnpm first-card:production-smoke:compare before.json after.json before-evidence.json after-evidence.json
# 缺少 after 时保留 before 实测值并输出不可比，不伪造数据：
cmd /c pnpm first-card:production-smoke:compare before.json -
```

两个可选旁路文件用于导入已采集的远端版本确认与 UI 证据，不修改 report 原文，不覆盖服务端计时。
格式如下；示例中的占位值必须替换为实际证据，不能作为验收输入：

```json
{
  "schemaVersion": "phase1a-production-evidence/v1",
  "runId": "对应报告的 runId",
  "environmentId": "对应环境",
  "userSha256": "对应报告的用户摘要",
  "deploymentEvidence": {
    "verified": true,
    "commit": "已核实远端制品对应的40位git哈希",
    "artifactSha256": "已核实远端制品的64位摘要",
    "environmentId": "对应环境",
    "evidenceRef": "本地远端制品核验记录路径"
  },
  "requests": [{
    "auditId": "对应报告请求的auditId",
    "batchId": "对应报告请求的batchId",
    "stage": "FIRST_CARD_VISIBLE",
    "boundary": "native_selector_bounding_rect",
    "clock": "client_request_date_now",
    "elapsedFromRequestMs": 123.4,
    "evidenceRef": "对应TodayPerformance原始采样记录路径"
  }]
}
```

每个被比较的 MISS/HIT 请求都需要可见证据条目，包含自然 MISS 的 baseline。
旁路请求必须准确匹配 batchId/auditId，并拒绝重复、跨 run 或 HTTP/SSE 代理时间。
部署声明必须来自人工或发布系统的实际远端制品核验；比较器检查元数据和关联，
不自行读取远端，不把本地 sourceCommit 或工具的 `deployed=false` 当成部署版本证明。

输出 `before/after.miss` 和 `before/after.hit`，包含 AI_START、AI_COMPLETE、VISIBLE，
并保留 PLAN0_READY/CANONICAL_READY 用于归因。HIT 的 AI 时间为 null（N/A），预期 Provider 0 次。
比较器要求双方报告/请求成功、远端版本不同、环境/用户/输入/fingerprint 相同、Provider 次数为 MISS=1/HIT=0、
HIT 展示 canonical 一致、同请求 UI 证据及完整 AI/canonical 时间线。旧报告缺 PLAN0 时保持 null，
不妨碍已充分证明的目标指标比较，但限制 barrier 归因。

条件不足时 `comparable=false`，退出码 1；用法或旁路格式错误退出码 2。
条件满足时退出码 0，`deltaMs=after-before`，负数表示更快。
`fastPathImproved` 仅在该 MISS 样本的 AI_START 和 VISIBLE 同时降低时为 true；
它不是统计显著性、p50/p95 或部署放行结论。冷启动、候选池状态和网络差异仍需采样控制。

## 检查命令

```powershell
cmd /c pnpm first-card:production-smoke:test
cmd /c pnpm --filter @starter-template/miniapp typecheck
node node_modules/eslint/bin/eslint.js apps/miniapp/scripts/production-first-card-smoke/*.js eslint.config.mjs
git diff --check
```

推荐逻辑、AI prompt/model/timeout/fallback、生产 admission 与缓存策略均保持原样。没有部署或 push。

## 2026-09-03 09:23 历史生产执行结果（本轮未重跑）

**确定性 MISS enablement 已验证；完整 AI smoke 未通过，不能标记 PASS。**

- 执行目录：`artifacts/production-first-card-smoke/2026-09-03T01-23-49-666Z/`。
- baseline 为 HIT、Provider 0 次；备份后精确删除 1 条 canonical cache，并读回确认不存在。没有删除任何 job 或用户业务数据。
- cacheId：`rcc-c17d148481c2667dea5aa46367bdf99c4eb822edf389ac3f62f2f4dc477a90f0`。
- fingerprint：`62978c1565d324c5939a0531fb340746358bd60f25a9d5d591d21af4aaa8a7e3`。
- 后续请求：`production-smoke-1788398629984-2c113332-miss`。真实微信 HTTP 200，云端观察到 MISS 与 Provider start；同 fingerprint 的 job 最终 `completed`、`missCount=1`、`cacheHitCount=0`、`readyCount=1`、`failureCode` 为空。
- canonical 在北京时间 09:24:31 重新生成，owner/fingerprint 均匹配。备份仍保留，没有自动回滚覆盖新文案。
- 现有生产请求在 AI admission 前已经超出响应预算，审计报告 `PRE_AI_EXHAUSTION`。读取到的 request 日志缺少 Provider complete / validator / canonical persisted 的最终审计链与成功 summary，因此脚本以 `CLOUD_AUDIT_OR_TAIL_NOT_READY`、退出码 1 结束，未继续 HIT 请求。数据库完成状态不被冒充为完整日志验收通过。
- 脱敏证据：`report.json`、`reset-receipt.json`、`post-smoke-storage.json`；完整 backup 在 `cache-backup.private.json`，全部位于 Git 忽略目录。

该次执行只解除“无法确定制造 CACHE MISS”的阻塞。响应预算和尾部审计完整性属于已存在的生产运行问题，当时没有改变推荐/AI 行为或部署来掩盖它。由于该次生产 smoke 未通过，当时按 AGENTS.md 第 15 条保留未提交改动。此次 Phase1A validation 的检查和交付状态见 [验证报告](./phase1a-production-validation.md)。

本次修改文件：`package.json`、`eslint.config.mjs`、`docs/qa/first-card-ai-smoke.md`、本文，以及 `apps/miniapp/scripts/production-first-card-smoke/` 内 `admin.js`、`admin.test.js`、`evidence.js`、`evidence.test.js`、`runner.js`、`runner.test.js`、`safety.js`、`safety.test.js`、`wechat.js`、`wechat.test.js`。
