# Xiaoda AI Renderer 低延迟专项结论

日期：2026-08-24

## 范围与边界

本专项只审计和增强隔离的 `voice-renderer-v2-lab`。没有修改 Today UI、Today Runtime、Recommendation Runtime、mutation coordinator、recommendation cache、batch persistence 或任何生产模型路由，也没有部署云端生产切换。

## Phase 0 — 当前真实 Pipeline

当前链路：

```text
Narrative Plan
→ validateRecommendationNarrativePlanV2
→ buildRendererInputFromNarrativePlan
→ buildVoiceRendererV2Request
→ DashScope-compatible /chat/completions
→ parseVoiceRendererV2Outputs
→ validateShadowCopy
→ Canonical Copy
```

## 2026-08-24 compressed-v2 garment grounding

本轮只比较 current 与 compressed-v1 中直接关系到 garment grounding、弱证据和 batch 绑定的语义。current 明确要求“使用输入中的可读衣物名”；compressed-v1 只说明 `g` 是可用衣物名，既没有要求每条 copy 必须落到自己的 `g`，也没有明确弱证据项不能退化为泛化句。

```text
LOST_RULE=current 的“使用输入中的可读衣物名”强制语义，以及每条输出独立绑定对应 id/m/g 的 batch 约束
BATCH_SPECIFIC_FAILURE=yes
WHY_SINGLE_PASS_BATCH_FAIL=single-case 时唯一 g 自然获得完整注意力；8-plan batch 中三个 m=null 项共享同一 baseline 指令，缺少强制 garment anchor 后共同退化为最短合规泛化句“这套简单日常。”
```

compressed-v2 没有重写 v1，只追加一条 86-char 语义规则（含连接换行总增量 87 chars）：逐项按 `id` 独立使用自己的 `m/g`，不得借用其他项；至少自然提及本项一个衣物名；`m=null` 或证据弱时仍以当前衣物关系落地，不能只写泛化套话。它没有要求颜色、版型或图案，也没有扩大事实授权。

Weak/Sparse/Baseline 单 request：3/3 parser、contract、validator PASS；factual/persona/meta-language failures 均为 0；1,653ms；0 retry。

原始 8-case 单 request：8/8 parser、contract、validator PASS；factual/persona/meta-language failures 均为 0；449 prompt tokens / 161 completion tokens；provider/E2E 2,666ms；0 retry。达到 ≤3.5s 停止条件，Prompt 实验立即停止。

`materializeRecommendationCopyV2` 仍无生产调用方；本轮没有修复或接入生产触发。

- 当前模型：`qwen3.7-max`；生产 route 为 `voice-renderer-model-route-v1-max`。
- 参数：`temperature=0.3`、`top_p=0.8`、`max_tokens=1200`、`stream=false`、`enable_thinking=false`。
- System prompt：594 chars。
- 8 个 Gold Plans 的 user JSON：5303 chars；system + user 合计 5897 chars；完整 request JSON 为 6589 chars。
- 历史真实调用的 prompt usage：2041 tokens/call。
- 输入字段：`inputVersion`、`planId`、`task`、`surface`、`personaVersion`、`expressionMode`、`primary.{insightId,meaning,subjectGarments}`、`garments`、`allowedClaims`、必要的 `scene`、`languageConstraints`。
- 输出严格为 JSON 数组，每项且只能有 `planId`、`insightId`、`text`；没有 parse retry。
- parser 负责 JSON、完整性和 plan/insight binding；validator 负责 garment grounding、persona、未授权事实、跨 plan 污染、baseline restraint 与 meaning preservation。
- Today、Detail 与小搭说衣可以共用一次调用生成的同一条 canonical text。当前不是分别生成三份文案，而是由下游字段复用 canonical copy。
- Cache key 为 `voice-copy-v2:${sha256(stable semantic input + persona/contract/model route/model/generation params/locale)}`。

当前已不发送、也不应发送给模型的内容包括：完整候选池、scores、Secondary insight、weather snapshot、profile、legacy copy、reason/reasoning、完整衣橱和未选中的衣物。

## Phase 1 — 候选收敛

候选只保留两个：

1. Baseline：`qwen3.7-max`。
2. Fast candidate：`qwen3.7-flash`，固定 `enable_thinking=false`。

旧别名 `qwen-flash` 已有 `MODEL_NOT_ALLOWED` 证据，不再假设它可用。`qwen3.7-plus` 的历史真实 E2E 为 19.7–20.0s，且自然度和 persona 明显弱于 Max，因此不进入本轮快速候选。

阿里云当前官方模型目录列出 `qwen3.7-flash`，并说明它支持思考模式控制和结构化输出：

- https://help.aliyun.com/zh/model-studio/text-generation-model/
- https://help.aliyun.com/zh/model-studio/qwen-structured-output

本轮尝试复用现有云端隔离 action 时，云端未部署该 dispatch。请求在 provider 调用前落入普通 `generate` 分支，并因空 recommendation diagnostics 失败。为避免覆盖另一任务线正在推进的 `generateOutfit` 云函数，本轮没有重新部署 staging helper。因此 `qwen3.7-flash` 的“当前账号可调用”仍未被真实调用证明，不能宣称找到 1–3 秒稳定模型。

## Phase 2 — 小样本 Benchmark 证据

| model | thinking | calls | input | output | E2E | contract | validator | factual violation | parse retry |
| --- | --- | ---: | --- | --- | --- | --- | --- | ---: | ---: |
| `qwen3.7-max` | off | 2 historical real | 2041 tokens | 1038 tokens | 13,424ms / 13,140ms | 2/2 calls | 16/16 outputs | 0 | 0 |
| `qwen3.7-plus` | off | 2 historical reference | 2041 tokens | 1035 / 1037 tokens | 19,676ms / 19,984ms | 2/2 calls | 16/16 outputs | 0 | 0 |
| `qwen3.7-flash` | off | 0 provider calls | 5897 chars prepared | not called | not measured | not measured | not measured | not measured | 0 |

历史人工盲审：Max 在 meaning/new reason/new fact/claim/persona/baseline 上为 16/16；Plus 的自然中文为 8/16、persona 为 14/16，Max 胜 12、平 4、Plus 胜 0。

本轮两次 transport 尝试都在 provider 前失败，因此没有消耗任何模型调用配额，也没有把 transport error 伪记为模型延迟或 `MODEL_NOT_ALLOWED`。

## Phase 3 — 低风险优化实验判定

现有 payload 已经移除了候选池、评分、Secondary、天气快照、profile 与 legacy copy，最大的剩余静态冗余是：

- 每条重复的 `inputVersion/task/surface/personaVersion/languageConstraints`；
- 很长的 `planId/insightId`，可改为 request-local short id 后由服务端映射回权威 identity；
- `allowedClaims` code 和 `scene` 对模型的语义价值有限，因为授权后的自然语言 `primary.meaning` 已包含可表达语义。

一个不改生产代码的静态 compact schema 估算可把 system + user 从 5897 chars 降到 842 chars，减少 85.7%。但它没有经过真实模型质量验证，因此本轮不修改 prompt、不修改输出 contract、不声称有延迟收益。`max_tokens`、JSON Object/JSON Schema 和 fast route 也应只在恢复隔离真实调用后按顺序验证。

## 停止判定与建议

尚未满足 `E2E <= 3s + contract stable + quality acceptable`。当前唯一稳定且有真实质量证据的模型仍是 Max；继续搜索更多模型没有证据价值。推荐保持 Max 的异步 materialization/cache/pre-generation 路线，并在不覆盖生产云函数的独立 benchmark endpoint 可用后，仅对 `qwen3.7-flash + enable_thinking=false` 运行 2–3 次相同 Gold batch。若它稳定达到 3 秒内即停止搜索并提出接入方案；否则继续保留 Max，不为速度降低质量。

## Final

```text
CURRENT_PIPELINE=Narrative Plan → plan validator → minimal renderer input → qwen3.7-max(non-thinking) → strict JSON parser → factual/persona validator → shared Canonical Copy
CURRENT_LATENCY=13,140–13,424ms historical real E2E (known baseline ≈13–14.5s)
CURRENT_PROMPT_SIZE=594 system chars + 5,303 user chars = 5,897 chars; 6,589 request JSON chars; 2,041 historical prompt tokens
CANDIDATES=qwen3.7-max baseline + qwen3.7-flash non-thinking; qwen-flash rejected as old MODEL_NOT_ALLOWED alias; Plus excluded
BENCHMARK=Max 2 real calls stable; Plus 2 historical reference calls slower/quality-worse; qwen3.7-flash 0 provider calls because safe isolated dispatch unavailable
FASTEST_STABLE_MODEL=qwen3.7-max (only measured stable model; no <=3s model proven)
LATENCY=13,140ms fastest measured stable call
QUALITY_DELTA=Max baseline retained; Plus loses naturalness/persona; qwen3.7-flash unknown
PROMPT_REDUCTION=0 applied; 85.7% static compact candidate, unbenchmarked
ONE_CALL_MULTI_COPY=yes (one shared canonical text reused by Today/Detail/Xiaoda, not three independently authored copies)
RECOMMENDED_ROUTE=keep Max async materialization/cache/pre-generation; next test only qwen3.7-flash non-thinking on an independent benchmark endpoint
PRODUCTION_CHANGE=none
TESTS=14/14 lab tests PASS; miniapp typecheck PASS; task-scoped ESLint PASS; full miniapp lint BLOCKED by pre-existing forbidden-scope generateOutfit/index.js:1074 no-undef
FILES=README.md, LOW_LATENCY_FINDINGS.md, core.js, core.test.js, run.js, run.test.js
COMMIT=none — AGENTS.md forbids commit after a failed check; unrelated Recommendation Runtime lint blocker was not modified
```
