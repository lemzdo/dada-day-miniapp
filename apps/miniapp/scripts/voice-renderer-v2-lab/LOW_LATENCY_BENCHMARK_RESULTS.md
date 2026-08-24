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
