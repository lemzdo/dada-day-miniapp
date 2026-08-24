# Xiaoda Renderer 低延迟 Benchmark 结果

日期：2026-08-24

## 实验矩阵

| ID | 模型 | Prompt | 最大调用 | 本轮状态 |
| --- | --- | --- | ---: | --- |
| A | `qwen3.7-max` | current | 历史基线，不重复 | 13,140 / 13,424ms；已有稳定质量证据 |
| B | `qwen3.7-max` | compressed | 2 | 0 provider calls；调度前缺少本地 provider credential |
| C | `qwen3.7-flash` | current | 3 | 0 provider calls；调度前缺少本地 provider credential |
| D | `qwen3.7-flash` | compressed | 3 | 受 C 质量门禁约束，未运行 |

没有把调度失败计为模型调用、延迟或 `MODEL_NOT_ALLOWED`。因此本轮不能判断当前账号是否允许 `qwen3.7-flash`。

## Prompt compression

| 变体 | system chars | user chars | prompt chars | request chars |
| --- | ---: | ---: | ---: | ---: |
| current | 594 | 5,303 | 5,897 | 6,589 |
| compressed | 272 | 446 | 718 | 1,063 |

静态 prompt chars 减少 87.8%。压缩只移除模型不需要的传输重复：每条重复的版本/任务/surface/persona/语言约束、长 plan/insight ID 和 claim code。每条仍携带权威 `primary.meaning` 与可用衣物名；baseline 明确使用 `m=null`。服务端以 request-local `id` 恢复原始 `planId` / `insightId`，再运行原有 strict contract 与 factual/persona validator。

压缩 prompt 仍明确保留：Narrative Plan ownership、AI 不重新搭配、只表达唯一授权语义、baseline 克制、禁止第二分析点与新理由/事实/效果/衣物、persona 边界、最多两句、JSON object structured output。Today/Detail/Xiaoda 的 canonical text 复用关系没有改变。

## 调度边界与停止原因

本地环境仅检测凭据是否存在，不读取或打印值。结果为：`BAILIAN_API_KEY=false`、`DASHSCOPE_API_KEY=false`、`CLOUDBASE_APIKEY=false`、Tencent Cloud service credentials=false。低延迟 runner 因 `PROVIDER_KEY_MISSING` 在 HTTP 请求前退出。

现有云端密钥属于 `generateOutfit` 函数环境。创建独立函数不会自动继承该 secret；普通 CloudBase HTTP API / server SDK 调用又需要 Access Token、API Key 或 Tencent service credentials。本任务同时禁止 DevTools/GUI 自动化，因此没有通过小程序运行时调用现有函数，也没有为了不可调用的实验覆盖部署 `generateOutfit`。生产 route、provider 默认模型与 Recommendation Runtime 均未改变。

## 结论

- `qwen3.7-flash`：未验证，不可报告为 available，也不可报告为 provider 拒绝。
- Max compressed：只有静态 `-87.8%` 和 18/18 lab tests 证据，没有真实延迟/质量结果。
- 当前最快且有真实稳定证据的路线仍是 Max/current，最快历史调用 13,140ms。
- 在提供本地百炼 key，或提供不依赖 DevTools 自动化的 token-gated lab endpoint 后，直接运行现有条件矩阵；无需再改生产代码。
- 在取得真实证据前，生产路由保持不变；若 Flash 不稳定，则维持 Max 并转向 async cache / pre-generation。

## 2026-08-24 第一次真实调用尝试

独立 `voiceRendererLatencyLab` 已部署且平台 timeout 为 60 秒。Phase 0 按要求只发起一次 `max + current + primary-pattern-focus` 云函数 invocation；CloudBase 在 event 中自动注入 `tcbContext`，旧的严格事件白名单在 provider 请求前返回 `EVENT_KEY_NOT_ALLOWED:tcbContext`。

- 云函数 invocation：1 次。
- 真实 provider/model calls：0 次。
- Max current / Flash current / Flash compressed / Max compressed：均无模型结果。
- 没有把 transport contract failure 记为模型延迟、质量失败或模型不可用。
- 按 Phase 0 停止条件，没有继续其他组合。

Lab-only contract 已修正为允许并忽略 CloudBase 自动注入的 `tcbContext` / `userInfo`，同时补齐 canonical copy 返回、Gold meaning preservation 与 secondary 越界 validator。生产路径和模型路由没有改动。下一次任务只需重新执行 Phase 0 smoke；本记录不构成任何模型/Prompt 胜出证据。

## 2026-08-24 首次真实低延迟矩阵

上述 transport blocker 修复并重新部署后，本轮按“一次 invocation 只执行一次模型调用”完成 5 次真实调用。所有请求均为 `enable_thinking=false`；current 使用 strict JSON array，compressed 使用 `response_format=json_object`。没有 retry。

| phase | caseId | model | prompt | request chars | prompt / completion tokens | provider / E2E | parser | contract | validator | factual | Sol persona / naturalness | canonical copy |
| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- | --- | --- | --- |
| smoke | `primary-pattern-focus` | `qwen3.7-max` | current | 1,708 | 389 / 112 | 2,310 / 2,310ms | PASS | PASS | PASS | no | PASS | 条纹上衣是这套搭配里唯一的图案重点，纯色长裤保持简单就好。 |
| C1 | `primary-pattern-focus` | `qwen3.7-flash` | current | 1,710 | 389 / 111 | 1,155 / 1,155ms | PASS | PASS | PASS | no | PASS | 条纹上衣是这套搭配唯一明确的图案重点，纯色长裤保持简单。 |
| C2 | `competing-pattern-and-silhouette` | `qwen3.7-flash` | current | 1,754 | 407 / 123 | 1,282 / 1,282ms | PASS | PASS | PASS | no | FAIL | 条纹修身上衣是这套搭配唯一需要表达的图案重点，纯色阔腿裤保持简单。 |
| B1 | `primary-pattern-focus` | `qwen3.7-max` | compressed | 1,046 | 203 / 24 | 1,757 / 1,757ms | PASS | PASS | PASS | no | PASS | 条纹上衣是这套唯一的图案重点，纯色长裤保持简单。 |
| B2 | `competing-pattern-and-silhouette` | `qwen3.7-max` | compressed | 1,070 | 212 / 28 | 1,744 / 1,744ms | PASS | PASS | PASS | no | PASS | 条纹修身上衣是这套的图案重点，纯色阔腿裤保持简单。 |

Flash/current 的第二条虽通过自动禁词和事实 validator，但“唯一需要表达”是在谈写作任务，不像朋友直接评价衣服。Sol 将其判为明显 persona/naturalness regression，因此 Flash/current 没有满足“两次均过质量门”，Flash/compressed 按条件没有执行。

### 分变量结论

- Model effect：同一 `primary-pattern-focus + current` 下，Flash 为 1,155ms，Max 为 2,310ms，Flash 减少 1,155ms（50.0%，约 2.00×）；但 Flash 在 Competing case 出现人工质量失败，所以速度优势未形成稳定路线。
- Prompt effect：同一 `primary-pattern-focus + Max` 下，compressed 为 1,757ms，current 为 2,310ms，减少 553ms（23.9%，约 1.31×）；prompt tokens 从 389 降至 203（47.8%）。这证明压缩不只是减少静态字符，也降低了真实模型 E2E。
- Quality effect：Max/compressed 两个代表 case 均保持 Narrative Plan ownership、事实边界、contract、validator 与自然朋友语气；Flash/current 为 1/2 人工自然度通过。所有 5 次均无事实越界、parse/contract failure 或 retry。

历史 13,140–13,424ms 基线是 8-case batch；本轮为 single-case invocation，不能把 13s 与 1.7–2.3s 的全部差值归因于模型或 prompt。可严格比较的是同 case 的受控差值。当前最快稳定有效路线是 `qwen3.7-max + compressed`：1,744–1,757ms，达到原始 ≤3s excellent 目标。推荐它作为后续选型评审候选，但本轮不改生产路由。

## 2026-08-24 生产接入前最终验证

### 最新生产执行语义

本节基于合入 `origin/main@dec28de` 后的最新生产代码，不以旧 lab 行为反推生产：

- Render unit：生产固定 `mode='batch'`；一次 provider request 最多携带 8 个 Narrative Plans，并返回最多 8 条 canonical copies。分组逻辑见 `recommendationVoiceRendererShadowV2.js:155-165`，生产调用见 `generateOutfit/index.js:777-781`。
- Calls per 8 cards：batch 模式最多 1 次 provider call；single 模式才会最多 8 次。groups 由 `Promise.all` 并行执行；生产 8-card batch 只有 1 group，single 没有额外 concurrency limiter。
- Persist：推荐 batch 在 generate 返回前 `await persistRecommendationBatchV2`；copy materialization 是独立 `materializeRecommendationCopyV2` action，它在 action 内等待 renderer 和最多 8 条 canonical writes 完成。
- Trigger：仓库只导出 `materializeCloudRecommendationCopyV2` helper，没有发现 Today/Detail/runtime 的实际调用方。因此当前 AI materialization 不在 Today acquisition 关键路径，也没有生产自动触发者。
- Cache：per Narrative Plan/card，以 `voice-copy-v2:<renderInputFingerprint>` 为 key。fingerprint 包含 semantic meaning、expression mode、subject garments、garments、allowed claims、scene、persona/contract/model-route 版本、model、generation parameters 与 locale。
- Reuse：同一 canonical text 以 composition key 匹配 outfit，写入 `reason` 与 `copyContract.todayReason`；Detail/Xiaoda 从 canonical copy 派生/复用，不需要重复模型调用。
- Historical baseline：13,140–13,424ms 是一次 Max/current provider request 携带 8 Gold Plans、返回 8 outputs，不是 8 次单 plan 调用。

### Max/compressed：8 次独立 invocation

顺序 runner 对既有 8 个 Gold cases 各执行一次独立 CloudBase invocation，每次只含一次 Max/compressed provider call。`requestChars` 为函数记录的 UTF-8 request bytes；provider token 字段均可用。

| caseId | category | request chars | prompt/completion tokens | provider/E2E ms | parser/contract/validator | factual | Sol persona/naturalness | retry | canonical copy |
| --- | --- | ---: | ---: | ---: | --- | --- | --- | ---: | --- |
| `primary-pattern-focus` | Pattern | 1,046 | 203/24 | 1,940/1,940 | PASS/PASS/PASS | no | PASS | 0 | 条纹上衣是这套唯一的图案重点，纯色长裤保持简单。 |
| `primary-silhouette-contrast` | Silhouette | 1,019 | 206/27 | 3,010/3,010 | PASS/PASS/PASS | no | PASS | 0 | 修身上衣配阔腿裤，一紧一松的轮廓对比。 |
| `primary-monochromatic` | Color | 1,037 | 205/26 | 1,236/1,236 | PASS/PASS/PASS | no | PASS | 0 | 蓝色上衣配藏青长裤，同属蓝色系，色调统一。 |
| `scene-primary-work-structure` | Scene | 1,039 | 203/25 | 1,116/1,116 | PASS/PASS/PASS | no | PASS | 0 | 衬衫、西装长裤配商务鞋，是一套清楚完整的上班搭配。 |
| `weak-formality-only` | Weak | 962 | 189/21 | 1,899/1,899 | PASS/PASS/PASS | no | PASS | 0 | 基础上衣配基础长裤，简单日常的一套。 |
| `sparse-low-confidence-pattern` | Sparse | 962 | 189/21 | 2,023/2,023 | PASS/PASS/PASS | no | PASS | 0 | 图案上衣配印花长裤，简单日常的一套。 |
| `sparse-basic-no-evidence` | Baseline | 960 | 190/22 | 873/873 | PASS/PASS/PASS | no | PASS | 0 | 白色T恤配灰色长裤，简单日常的一套。 |
| `competing-pattern-and-silhouette` | Competing | 1,070 | 212/28 | 1,506/1,506 | PASS/PASS/PASS | no | PASS | 0 | 条纹修身上衣是这套的图案重点，纯色阔腿裤保持简单。 |

统计：runner wall-clock 21,141ms；provider latency sum 13,603ms；per-case range 873–3,010ms；median 1,702.5ms；retries=0。8/8 parser、contract、validator、事实授权、Narrative Plan ownership、自然中文、无元语言和无模板泄漏均通过。该执行方式包含 8 次云调用开销，不是生产 batch 的推荐替代。

### Apples-to-apples：单请求 8-output batch

为匹配历史执行语义，lab-only batch event 在一次 CloudBase invocation 内只发起一次 Max/compressed provider request，并携带相同 8 个 Gold cases：

```text
prompt=272 system chars + 446 user chars = 718 chars
request=1,837 UTF-8 bytes
usage=393 prompt tokens / 143 completion tokens
provider latency=E2E=2,455ms
outputs=8
parser=8/8 PASS
contract=8/8 PASS
validator=5/8 PASS
factual violations=0
persona/meta-language failures=0
retries=0
```

失败集中在 Weak、Sparse、Baseline：三条都输出“这套简单日常。”，自然且无事实越界，但没有提到任何输入衣物，触发 `GARMENT_GROUNDING`。Pattern、Silhouette、Color、Scene、Competing 均通过。由于不是单一 case 缺陷，而是同一缺失约束在 3 个 baseline-like cases 上复现，本轮按规则不追加 compressed prompt delta。

### 最终判断

- Batch latency：compressed 2,455ms 对历史 current 13,140–13,424ms，观察绝对减少 10,685–10,969ms，相对减少 81.3%–81.7%。模型固定为 Max，因此这是 Prompt/请求形状的观测效应，不是 Model Effect。
- Quality：独立 single-case 为 8/8，但真实生产语义 batch 只有 5/8 validator PASS。压缩 prompt 删除了 current 中“使用输入中的可读衣物名”的强制规则，在 batch baseline-like outputs 上暴露稳定 grounding 回退。
- Model decision：保持 `qwen3.7-max`，不重新搜索 Flash/Plus。
- Prompt decision：当前 `compressed` 不能直接替代生产 `current`；`READY_FOR_PRODUCTION_INTEGRATION=no`。下一次应先做一个仅恢复 garment-grounding 规则的最小 prompt delta，再只测 3 个失败 case 与相关回归 case。
- Execution decision：只换 Prompt 不足以完成生产接入。生产 batch renderer/cache/write 结构本身无需改成 per-card parallel；但当前没有 production materialization trigger，正式接入需要新增非阻塞、fail-open 的触发编排，并继续保持 AI 退出 Today 首屏关键路径。

## 2026-08-24 compressed-v2 batch grounding regression

### Phase 0 — 定向根因

只比较 current 与 compressed-v1 的 garment grounding、弱/稀疏/baseline 和 batch binding 语义，并复核上一轮三条失败 input/output/reason：三条输入均为 `expressionMode=baseline`、`primary=null`，输出均为“这套简单日常。”，唯一 validator failure 均为 `GARMENT_GROUNDING`。

```text
LOST_RULE=current 的“使用输入中的可读衣物名”强制语义，以及每条输出独立绑定对应 id/m/g 的 batch 约束
BATCH_SPECIFIC_FAILURE=yes
WHY_SINGLE_PASS_BATCH_FAIL=single-case 时唯一 g 自然获得完整注意力；8-plan batch 中三个 m=null 项共享同一 baseline 指令，缺少强制 garment anchor 后共同退化为最短合规泛化句
```

### Phase 1 — compressed-v2

```text
compressed-v1 chars=718
compressed-v2 chars=805
added chars=87（86-char rule + 1 newline）
added semantic rule=逐项按 id 独立使用自己的 m/g，不借用相邻项；每条至少自然提及本项一个衣物名；m=null 或证据弱时仍以本项衣物关系落地，不得只写泛化套话
```

没有要求必须写颜色、版型或图案，没有添加 case template，也没有扩大 Narrative Plan 的事实授权。

### Phase 2 — Weak/Sparse/Baseline 单 request

| outputs | prompt chars | prompt/completion tokens | provider/E2E | parser | contract | validator | factual | persona | meta-language | retry |
| ---: | ---: | ---: | ---: | --- | --- | --- | ---: | ---: | ---: | ---: |
| 3 | 480 | 280/58 | 1,653/1,653ms | 3/3 PASS | 3/3 PASS | 3/3 PASS | 0 | 0 | 0 | 0 |

三条输出分别落到各自衣物：`基础上衣/基础长裤`、`图案上衣/印花长裤`、`白色T恤/灰色长裤`；均只表达简单日常的当前衣物组合，没有新推断。

### Phase 3 — 原始 8-case 单 request

| outputs | prompt chars | prompt/completion tokens | provider/E2E | parser | contract | validator | factual | persona | meta-language | retry |
| ---: | ---: | ---: | ---: | --- | --- | --- | ---: | ---: | ---: | ---: |
| 8 | 805 | 449/161 | 2,666/2,666ms | 8/8 PASS | 8/8 PASS | 8/8 PASS | 0 | 0 | 0 | 0 |

相对 compressed-v1 的 2,455ms 增加 211ms（8.6%），仍保持 2–3 秒级。相对 Max/current 历史 13,140–13,424ms 减少 79.7%–80.1%，约 4.93–5.04× faster。质量与 ≤3.5s 性能门槛同时满足，按 Stop Rule 停止 Prompt 实验。

```text
MODEL=qwen3.7-max
PROMPT=compressed-v2
READY_FOR_PRODUCTION_INTEGRATION=yes
PRODUCTION_TRIGGER_STILL_MISSING=yes
```

本结论只批准后续单独 Goal 进入 production integration；本轮没有修改 `materializeRecommendationCopyV2` 调用方、生产 Renderer、Today、Recommendation Runtime、cache、canonical writer 或 provider 默认模型。
