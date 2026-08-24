# A.2.1 / B.0 Findings

## Streaming latency lab (2026-08-24)

Implemented an isolated `voiceRendererLatencyLab` streaming path for the fixed eight Gold Narrative Plans. It sends `qwen3.7-max` with `compressed-v2`, `enable_thinking=false`, and consumes DashScope-compatible SSE (`data: {choices:[{delta:{content}}]}`) inside the cloud function. `id=1` is independently framed, parsed, contract-checked and validator-checked before later ids are accepted. The provider stream is never forwarded to the miniapp.

The result records `T0_REQUEST_SENT`, `TTFT_MS`, `FIRST_ITEM_PARSEABLE_MS`, `FIRST_ITEM_VALIDATED_MS`, `SECOND_ITEM_VALIDATED_MS`, `ALL_8_STREAM_COMPLETE_MS`, `ALL_8_VALIDATED_MS`, token usage, and quality counters. The existing validator remains authoritative; no copy is displayable before validation.

The initial invocation hit a deployed-version mismatch (`EVENT_KEY_NOT_ALLOWED:sequencing`, then one narrow retry without that field returned `EVENT_KEY_NOT_ALLOWED:stream`). These attempts were excluded from samples. The isolated lab function was redeployed successfully, after which the three real provider runs below completed. Local SSE framing and 8/8 validation tests pass.

### Streaming A result after isolated deployment

The lab function was deployed directly from `apps/miniapp/cloudfunctions/voiceRendererLatencyLab` to `cloud1-d8gl3k1vkdf0b7f05`. Three real runs then completed with the same eight Plans and `qwen3.7-max` / `compressed-v2` / non-thinking:

| run | TTFT ms | first parseable ms | first validated ms | second validated ms | stream complete ms | all validated ms | prompt/completion tokens |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 937.49 | 1242.51 | 1243.45 | 1546.70 | 2933.64 | 2934.58 | 467 / 161 |
| 2 | 785.10 | 1090.48 | 1090.55 | 1349.92 | 2662.46 | 2662.69 | 467 / 160 |
| 3 | 860.06 | 1210.24 | 1210.32 | 1505.85 | 3087.74 | 3088.16 | 467 / 161 |

`FIRST_ITEM_VALIDATED`: median **1210.32 ms**, range 1090.55–1243.45 ms. Full batch: median **2934.58 ms**, range 2662.69–3088.16 ms. Every run was parser 8/8, contract 8/8, validator 8/8; factual=0, persona=0, meta-language=0. Since median exceeds 1200 ms, Priority Lane was required.

Priority Lane was implemented as Plan #1 streaming plus Plans #2–8 stable batch in `Promise.all`. Its first attempt and one allowed retry both failed in the DevTools transport with `TCP timeout 9420`, before provider results; therefore Priority metrics are `TEST_INFRA_BLOCKED`, with no quality or token claims.

## Track A — Styling correctness

受控真实衣橱的只读聚合结果：

- 活跃衣物 33 件；2 件带有效 `aestheticFeatures.version=1`，31 件缺少该结构。
- 2 件 V1 衣物的 `patternType` 都是 `solid`，所以 Pattern Focus 机会为 0。
- 只有 1 件上衣具有可靠的 `oversized` / `boxy` 信息；没有具备可靠轮廓字段的下装，所以 top + bottom Silhouette 机会为 0。
- 31 件旧衣物的顶层 `patternType/pattern`、`fit`、`silhouette` 也全部缺失；因此顶层兼容风险不是这批真实数据 Candidate=0 的活跃原因。

生产形状的 `_id/category/subcategory + aestheticFeatures.version=1 + high/medium confidence` 用例已经完整通过 Evidence → Candidate → Resolver：

- `PATTERN_SINGLE_FOCUS` → `PATTERN_FOCUS`（material）
- `SILHOUETTE_BALANCED_CONTRAST` → `SILHOUETTE_CONTRAST`（material）
- 两者共存时 Resolver 为 competing，Primary Pattern、Secondary Silhouette。

结论：分类为 **Sample Opportunity**。没有发现 Candidate bug 或当前真实数据的 schema/normalization mismatch；Styling correctness 不阻塞，无需小修复。

## Track B — Cloud-isolated Voice Renderer Lab

实验室固定 8 个 Gold Narrative Plans：Primary Pattern、Silhouette、Color、Scene，Weak Only、Sparse/Low-confidence、Sparse/None、Competing。Competing 输入只包含 Primary 语义，Secondary 不进入 Renderer。

Renderer 模型输入只包含 task、surface、personaVersion、expressionMode、Primary 语义、可读衣物名、allowedClaims、必要 scene 和少量语言约束。输出严格为 `{planId, insightId, text}`，baseline 的 `insightId` 为 `null`。

自动检查覆盖语义保持、新理由/事实、claim 边界、persona/编辑腔、Weak/Sparse 克制；Max 与 Plus 使用同 prompt、同 inputs、同温度/采样/长度参数，每个模型默认重复 2 次。结果写入 git-ignored `artifacts/voice-renderer-v2-lab/raw-runs.json`，并要求人工复核。

使用独立 staging 副本在 `generateOutfit` 恢复了 token 门控的 `voiceRendererV2Benchmark` action。生产源码未注入该 action；正常请求不会触发，Legacy 路径与结果未改。云端 helper 固定 Prompt、Max/Plus allowlist 和生成参数，只接受最小 Renderer 输入，拒绝客户端 Prompt、reason、完整衣橱/profile 等字段；Key 仅从云函数环境读取，不返回、不打印、不落本地。

Smoke 通过正常 transport、无 token 拒绝、超范围输入拒绝和单条 Max 调用；云函数环境成功读取现有 `BAILIAN_API_KEY`。正式实测为 8 Gold Plans × 2 模型 × 2 次重复：Max/Plus 各 16 条输出，自动 Contract 均为 16/16 PASS。Max 8/8 case 精确重复稳定；Plus 7/8，`sparse-low-confidence-pattern` 的两次表达不同。

Sol 盲审 16 组：Max 胜 12，平 4，Plus 胜 0。两模型在 meaning、new reason、new fact、claim obedience、baseline restraint 均为 16/16；Max 的自然中文与 persona 为 16/16，Plus 的自然中文 8/16、persona 14/16。主要失败模式是 Plus 在 Weak/Sparse 输出“简单日常”式标签片段，以及 Competing 输出“唯一需要表达”这种内部指令口吻。

结论：语义与 Claim Contract 已稳定，问题集中于 Plus 的中文表面自然度。先对 Voice Contract 做小调并复跑 Plus 的 Weak/Sparse/Competing targeted cases；通过后再进入 B.1 Integration，不需要回到 Styling 或建设 AI Gateway。
