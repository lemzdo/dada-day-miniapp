# A.2.1 / B.0 Findings

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

## Track B — Offline Voice Renderer Lab

实验室固定 8 个 Gold Narrative Plans：Primary Pattern、Silhouette、Color、Scene，Weak Only、Sparse/Low-confidence、Sparse/None、Competing。Competing 输入只包含 Primary 语义，Secondary 不进入 Renderer。

Renderer 模型输入只包含 task、surface、personaVersion、expressionMode、Primary 语义、可读衣物名、allowedClaims、必要 scene 和少量语言约束。输出严格为 `{planId, insightId, text}`，baseline 的 `insightId` 为 `null`。

自动检查覆盖语义保持、新理由/事实、claim 边界、persona/编辑腔、Weak/Sparse 克制；Max 与 Plus 使用同 prompt、同 inputs、同温度/采样/长度参数，每个模型默认重复 2 次。结果写入 git-ignored `artifacts/voice-renderer-v2-lab/raw-runs.json`，并要求人工复核。

本机与仓库没有 `BAILIAN_API_KEY` / `DASHSCOPE_API_KEY`，真实运行在发请求前以 `PROVIDER_KEY_MISSING` 停止；未部署临时 Renderer，也未改线上/Legacy。因此目前没有新 Voice Contract V2 的 Max/Plus 中文输出，尚不具备进入 B.1 Integration 的质量依据。
