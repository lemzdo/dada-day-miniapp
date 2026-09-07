# Deterministic First Card AI QA smoke

生产微信入口的单命令 smoke 见 [Production Smoke Enablement](./production-first-card-smoke.md)。本文 runner 仍使用隔离内存数据库。

这个 QA runner 通过固定测试输入和全新内存数据库自然获得首卡 MISS，并运行真实的 recommendationStream HTTP handler、generateOutfit runtime、FirstCardRenderer、AI Core 和 Provider。生产 prompt、模型、timeout、fallback、缓存策略保持原样。

## 运行

在仓库根目录执行，要求 Node.js 20.19+，并已通过 pnpm 安装工作区依赖：

```powershell
cmd /c pnpm first-card:smoke:test
cmd /c pnpm first-card:smoke
```

第一条命令使用受控 HTTP 响应运行离线测试，不请求真实 Provider。第二条命令实际执行 `node apps/miniapp/scripts/first-card-ai-smoke/runner.js --live`，使用真实 Provider，可能产生一次调用费用。直接运行 runner 而不指定 `--live` 会输出用法并返回退出码 2。

凭据沿用 AI Core 的环境变量：优先 `BAILIAN_API_KEY`，兼容 `DASHSCOPE_API_KEY`；地址由 `BAILIAN_BASE_URL` 配置，默认使用现有 DashScope compatible endpoint。runner 不自动读取环境文件或云配置，不输出密钥。不要把凭据值写入命令行、文档或提交到仓库。

## 隔离与调用边界

每次 CLI 启动独立进程。CloudBase SDK 的数据库和身份由 QA fixture 提供，生产计算、admission、renderer、AI Core、validator 和 canonical writer 均保持真实。通过现有 handler factory 注入真实 runtime 和 diagnostics，避免依赖云端 staging 的目录布局。

fixture 包含固定的 `first-card-smoke-user`、三件衣物和另一个 sentinel 用户。请求固定为 home 场景、关闭天气、日期 2026-09-02、maxResults=1。两次调用使用不同 auditId/batchId，通过相同 renderInputFingerprint 验证跨 batch 的 durable cache 命中；不需要人工选择场景。

首请求前 AI cache、copy job、outfits、batch 均为空。写入只允许落在内存中的 AI cache、job、candidate pool、batch 和本次测试 outfits；衣物、用户、历史、收藏只读。数据库检查 owner，查询返回副本，事务串行并支持失败回滚。离线测试额外验证其他用户相同 fingerprint 的 cache 不会被当前用户读取。

HTTP 在 127.0.0.1 的临时端口运行，客户端使用 node:http。Provider 的 global fetch 包装仅记录请求次数、模型、HTTP status 和 requestId；live 原样转发 URL、headers、body 和 AbortSignal。离线测试只替换这一网络边界并使用合成凭据，不替换业务 renderer 或 AI Core。

首次成功后才请求第二次。若第二次意外尝试 Provider 调用，QA 网络预算保护会阻止新增请求并判失败，不允许通过重复调用获得成功。

## 通过条件和结果

stdout 输出单个 JSON 报告，包含源码 Git SHA、生产链路文件 SHA-256、runner/fixture SHA-256、阶段日志、summary、网络元数据、cache/job 关联、文案 hash、写入清单和完整脱敏 failure envelope。不会输出 prompt、文案正文、原始异常或请求凭据。

首请求必须按顺序出现：

```text
CACHE_LOOKUP_DONE=miss
→ FIRST_CARD_AI_ADMITTED=admitted
→ PROVIDER_START=started
→ PROVIDER_COMPLETE=completed
→ VALIDATOR_COMPLETE=accepted
→ CANONICAL_PERSISTED=completed 或 tail
→ 最终 summary.executionOutcome=succeeded
```

此外必须满足真实 transport 调用一次且 HTTP 200、STREAM_COMPLETE=completed、最终 summary 中 validated/persisted 为 true、failure 为 null，cache key 与 owner/fingerprint/首卡 job entry 一致。第二次必须 HIT、没有 Provider 调用，并且展示文案的 hash 与已存 canonical 一致。衣物与用户资料等受保护数据内容必须保持不变。

runner 捕获 `[RecommendationAudit]` 和 `[RecommendationAuditSummary]`。SSE complete 可能早于 durable tail，runner 等待 handler Promise 完成后才判定和发起第二次请求。`RecommendationServerDone` 属于 callFunction wrapper，不是本 HTTP runtime 的验收条件。

退出码：0 表示全部断言通过；1 表示 Provider、校验、持久化、初始化或 QA 断言失败；2 表示 CLI 参数不正确。结果使用 PASS/FAIL。失败时不重试，`failure` 保留源阶段、原因码、provider 元数据、failureId/auditId/attemptId/batchId 和 deadline 证据；QA 初始化失败没有业务 envelope 时使用 qaError。

本工具验证本地生产代码与真实 Provider 的连接，不验证已部署 HTTP 网关、微信鉴权或真实 CloudBase 数据库；不部署、不清理任何线上数据。

## 2026-09-02 实际验收

北京时间 23:12:22–23:12:24，完成一次真实 QA runner 执行，结果 PASS，退出码 0。本次只读获取项目已有 recommendationStream 配置中的 Provider 凭据，通过环境变量在父子进程间传递，未将配置或凭据落盘。

- Provider：qwen3.7-max，HTTP 200，真实调用总数 1，阻止的额外调用数 0。
- requestId：`ef1cdb29-620d-94ee-9369-4ada3d4d7e75`。
- 首请求 auditId/batchId：`first-card-qa-miss`。
- attemptId：`53b680a1-c248-404b-891e-aaae20cd512f`。
- CACHE_LOOKUP_DONE miss：41.190 ms；PROVIDER_START：47.821 ms。
- PROVIDER_COMPLETE：677.229 ms；VALIDATOR_COMPLETE accepted：1140.857 ms。
- CANONICAL_PERSISTED：1142.248 ms；最终 executionOutcome=succeeded，failure=null。
- 第二次 `first-card-qa-hit` 在 7.521 ms 时命中，新增 Provider 调用为 0，canonical 文案 hash 一致。
- 执行时生产源码基线：`36b89c0d638556ce408c41ccafd0c5f4e71e510f`；具体文件 hash 保存在报告中。

完整脱敏证据保存在本地 `artifacts/first-card-ai-smoke-20260902/live-result.json`。该目录按仓库规则忽略，不提交生成日志。证据对应的 runner 和 fixture hash 可用于核对本次提交的实现。

离线验收：12/12 通过，覆盖正常 MISS→AI→HIT、401/429 失败、缺凭据、跨用户 cache 隔离、只读数据保护、CLI 参数及 live transport 保护，以及受控响应延迟 2400 ms 后的 tail 持久化。

```powershell
cmd /c pnpm --filter @starter-template/miniapp typecheck
node node_modules/eslint/bin/eslint.js apps/miniapp/scripts/first-card-ai-smoke/runner.js apps/miniapp/scripts/first-card-ai-smoke/fixture.js apps/miniapp/scripts/first-card-ai-smoke/runner.test.js apps/miniapp/scripts/first-card-ai-smoke/transport-fixtures.js
git diff --check
```
