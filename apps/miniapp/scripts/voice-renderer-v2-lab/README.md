# Voice Renderer V2 Lab

隔离实验室，只验证 Narrative Plan 到 canonical recommendation copy 的语言渲染，不接入 Today/Detail，不修改 Legacy。

- `gold-plans.js`：从已确认的 Shadow fixtures 构建 Gold Narrative Plans。
- `core.js`：最小模型输入、Voice Contract V2 prompt、输出绑定与自动检查。
- `run.js`：使用相同 prompt、输入和生成参数，对 `qwen3.7-max` / `qwen3.7-plus` 各重复运行。
- `prepare-cloud-benchmark.js` / `stage-cloud-benchmark.js`：从生产源码创建独立 staging 副本，注入 token 门控的最小云端 benchmark action，生产源码保持不变。
- `cloud-helper-template.js`：固定 Prompt、模型白名单、请求/输出白名单；Key 只从云函数环境读取。
- `smoke-cloud.js` / `run-cloud.js`：经微信开发者工具验证隔离门控并运行真实 B.0 批次。
- `review.js` / `prepare-review.js`：汇总重复稳定性并生成 A/B 盲审表；Sol 填完逐句判断后再解盲汇总。
- `wardrobe-opportunity-probe.js`：只读返回真实衣橱的 schema/value-domain 聚合，不输出衣物 ID、图片或完整属性。

模型实验使用 `generateOutfit` 云函数现有的 `BAILIAN_API_KEY`；Key 不返回客户端、不打印、不复制到本地。结果写入被 git 忽略的 `artifacts/voice-renderer-v2-lab/raw-runs.json`，随后必须由 Sol 人工复核自然度、语义保持、越界事实和模型差异。
