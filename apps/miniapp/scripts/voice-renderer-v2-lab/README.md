# Voice Renderer V2 Lab

隔离实验室，只验证 Narrative Plan 到 canonical recommendation copy 的语言渲染，不接入 Today/Detail，不修改 Legacy。

- `gold-plans.js`：从已确认的 Shadow fixtures 构建 Gold Narrative Plans。
- `core.js`：最小模型输入、Voice Contract V2 prompt、输出绑定与自动检查。
- `run.js`：使用相同 prompt、输入和生成参数运行受控模型对比，并记录输入/输出字符与 token、E2E、Contract、validator、事实越界和 parse retry；当前云端入口只比较 `qwen3.7-max` / `qwen3.7-flash`，不继续优化 Plus。
- `low-latency-matrix.js`：只运行 B=Max/compressed、C=Flash/current、D=Flash/compressed；D 受 C 的质量门禁约束，并实现两次模型不可用/连续契约事实失败停止规则。A=Max/current 只引用历史基线。
- `prepare-cloud-benchmark.js` / `stage-cloud-benchmark.js`：从生产源码创建独立 staging 副本，注入 token 门控的最小云端 benchmark action，生产源码保持不变。
- `cloud-helper-template.js`：固定 Prompt、模型白名单、请求/输出白名单；Key 只从云函数环境读取。
- `smoke-cloud.js` / `run-cloud.js`：经微信开发者工具验证隔离门控并运行真实 B.0 批次。
- `review.js` / `prepare-review.js`：汇总重复稳定性并生成 A/B 盲审表；Sol 填完逐句判断后再解盲汇总。
- `wardrobe-opportunity-probe.js`：只读返回真实衣橱的 schema/value-domain 聚合，不输出衣物 ID、图片或完整属性。

模型实验使用 `generateOutfit` 云函数现有的 `BAILIAN_API_KEY`；Key 不返回客户端、不打印、不复制到本地。结果写入被 git 忽略的 `artifacts/voice-renderer-v2-lab/raw-runs.json`，随后必须由 Sol 人工复核自然度、语义保持、越界事实和模型差异。

低延迟矩阵可在本地提供 `BAILIAN_API_KEY` 或 `DASHSCOPE_API_KEY` 后运行：

```bash
node apps/miniapp/scripts/voice-renderer-v2-lab/low-latency-matrix.js
```

当前任务禁止 DevTools/GUI 自动化，因此不得用 `run-cloud.js` 绕过本地凭据门禁。未到达 provider 的调度错误不能记作模型调用、模型延迟或 `MODEL_NOT_ALLOWED`。
