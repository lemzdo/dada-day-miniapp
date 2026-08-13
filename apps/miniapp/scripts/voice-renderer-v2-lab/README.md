# Voice Renderer V2 Lab

离线实验室，只验证 Narrative Plan 到 canonical recommendation copy 的语言渲染，不接入 Today/Detail，不修改 Legacy，不部署云函数。

- `gold-plans.js`：从已确认的 Shadow fixtures 构建 Gold Narrative Plans。
- `core.js`：最小模型输入、Voice Contract V2 prompt、输出绑定与自动检查。
- `run.js`：使用相同 prompt、输入和生成参数，对 `qwen3.7-max` / `qwen3.7-plus` 各重复运行。
- `review.js` / `prepare-review.js`：汇总重复稳定性并生成 A/B 盲审表；Sol 填完逐句判断后再解盲汇总。
- `wardrobe-opportunity-probe.js`：只读返回真实衣橱的 schema/value-domain 聚合，不输出衣物 ID、图片或完整属性。

模型实验需要本机进程提供 `BAILIAN_API_KEY` 或 `DASHSCOPE_API_KEY`。结果写入被 git 忽略的 `artifacts/voice-renderer-v2-lab/raw-runs.json`，随后必须由 Sol 人工复核自然度、语义保持、越界事实和模型差异。
