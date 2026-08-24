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
