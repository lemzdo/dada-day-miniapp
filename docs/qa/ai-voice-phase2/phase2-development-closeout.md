# 小搭 AI Voice Phase 2 开发验证收尾

## 结论

`NOT_READY`。Phase A、Styling Brief v2、token 去冗余、Plus-only 开发 harness、冻结/holdout 门禁和临时 helper 恢复链路已经形成可复用工程结果；但 `qwen3.7-plus` 在 4 轮有明确假设的开发迭代后，仍不能稳定满足小搭的自然中文与事实安全契约。按预设纪律停止继续堆 Prompt，未冻结、未打开真实 holdout、未切换 Today、未部署生产 AI Voice。

## Phase A 与 Brief v2

- 审计 24 条高信息样本：14 条真实 production capture + 10 条 synthetic 难例。原始 capture 的 `repositoryHead=3b65fd...`，与本轮基线 `cf82984` 不同，结论保留 provenance caveat。
- 旧链路主要问题是 raw primary insight 与规范化 evidence 的选择/绑定不一致、Brief 暴露过多内部算法字段，以及 Prompt 把关系术语翻译成中文。
- v2 只把已经选定的穿搭点投影为受控语义；`primary`、`weak`、`omit` 明确分流。未知关系和稀疏证据允许 omit，天气必须同时具备 `evidenceAuthorized` 与非空 evidence IDs。
- 模型输入只含 `id`、schema、delivery、scene、可选 meaningful weather、garments、primary/supporting point 和 inference boundary；内部 provenance、evidence IDs、cache dependencies 在调用前剥离。
- 未修改 Scene Evidence V4、Eligibility、Wearability、Candidate Pool 或 ranking。

## Prompt 与 token

- 当前开发版本：Prompt `xiaoda-today-voice-v2-dev4`、Brief `xiaoda-styling-brief-v2`、Voice Insight `xiaoda-voice-insight-v1`、Persona `xiaoda-persona-v6`、模型 `qwen3.7-plus`。
- 当前 Prompt 文件 SHA-256 为 `0cc1e4b264d3912727eedc5732ebe7eea334fd6dd46d5f3963606b64c8e4d2f2`。这是失败开发轮次后的工作哈希，不是冻结哈希；不存在 Phase 2 freeze manifest。
- 8 条序列化输入的本地 byte audit 从 24,640 bytes 降至 5,598 bytes，降低 77.28%。这是估算审计，不冒充 provider tokenizer 数据。
- 第 4 轮第一批 8 条的 provider input 为 1,983 tokens；对比旧 spike 约 43.7K/8，约降低 95.5%。去除了内部候选、评分、冗余关系、逐条重复规则和 deterministic 中文。
- 语义点连续性没有因压缩而丢失；剩余失败来自模型表达/服从一致性，不能把它归因于 Brief token 压缩。

## 四轮 Plus development

开发集固定为 20 条 synthetic 高信息难例；每轮按 8/8/4 调用，均只允许并确认返回 `qwen3.7-plus`。

| 轮次 | 修改层 | 假设 | provider input/output | 结果 |
|---|---|---|---:|---|
| 1 | Brief + Prompt dev1 | 紧凑受控语义可保持 insight 并减少算法中文 | 4,685 / 842 | 结构稳定；仍有“视觉焦点/色彩中心/连成一体”等编辑或算法腔 |
| 2 | Prompt dev2 | 明确整身意义与禁止语可改善自然度 | 4,787 / 627 | 出现 sparse/weather 空理由，仍有“打破单一感/适合工作场合”等越界表达 |
| 3 | Prompt dev3 | 非空、omit/weather 模板可修空输出 | 4,988 / 782 | 20 条非空且天气安全；仍有“有型/张弛有度/轻盈/温和”等未授权审美效果 |
| 4 | Prompt dev4 | 每个效果词绑定 user-facing meaning/allowed judgments | 5,192 / 772 | JSON/ID/模型均稳定；sparse 与 weather 再次为空，且仍有“适合上班穿/结构感/更聚焦/层次比例清晰” |

第 4 轮 Sol 结论为 `STOP`：Insight selection 与 Brief binding 已不是活跃瓶颈；当前瓶颈是 Plus 在严格自然度/安全契约下的 instruction-following consistency。继续加规则会向开发集过拟合。

另有两项工程事故单独记录，不粉饰也不计为产品迭代：首次 full helper 覆盖后云端包缺 `services/aestheticCompatibility`，在 provider 调用前失败；另一次 dev2 三次调用完成后，旧 runner 因 attempt 编号正则错误未持久化 usage，成本为 `NOT_OBSERVED`。runner 已改为调用前预留 attempt、逐调用原子持久化、失败保留证据并在第 4 轮后预调用拒绝。

## Holdout 纪律

- 16 条真实 production holdout 已准备并保持 `sealed=true, opened=false`。
- 当前 sealed 文件 SHA-256 为 `10ccceb25d868c35d3e9d298ea31f8ed81a2d67cec41cb9ff6251da802b63dea`。
- 因 development 未获人工冻结批准，没有生成 `08-prompt-freeze.json`，也没有 provider holdout 输出。不得列出虚构的 worst 5、best 8 或跨场景实测示例。

## 性能、成本与并行边界

- 第 4 轮 1×8：provider 7,028 ms，客户端 7,930 ms；1,983 input / 360 output tokens；按记录价格约 ¥0.006846/8。
- 第 4 轮全 20 条：5,192 input / 772 output tokens，约 ¥0.01656；HTTP error 0、parse error 0、自动 safety/persona 拒绝批次 2。
- 四个可审计轮次的估算总成本约 ¥0.063488；不含上述 usage 未落盘的事故调用。未测 2×4，避免扩展矩阵。
- 产品化边界应是推荐 candidate/ranking 完成后一次形成 8 个 Brief；AI Voice 与客户端后续图片加载并行，不得反向阻塞或改变推荐计算。

## Cache identity

建议/本地实现字段：`outfitFingerprint`、`primaryInsightFingerprint`、`scene`、`weatherFingerprint`、`voiceInsightVersion`、`briefVersion`、`personaVersion`、`promptVersion`、`model`、`locale=zh-CN`。weather 只有在穿法证据明确授权且有 evidence IDs 时才进入 fingerprint；普通温度数字变化不应使缓存失效。

## 临时 helper 与恢复

- 只覆盖既有共享开发环境 `cloud1-d8gl3k1vkdf0b7f05` 的 `generateOutfit`，高熵 token 保护、Plus-only、固定 action；没有创建其他云函数。
- 首次 full 覆盖事故后使用 pre-download 恢复并补齐 `services/shared`；后续使用 `inc-deploy` 按 helper → index 安装，并在每轮后立即恢复原 index。
- 最终 pre/post `index.js` SHA-256 均为 `052041b64b8d42743679b5c32972cbadf547f2fc210805112b7aa8e9ec044eba`；下载包 integrity PASS（151 文件、58 runtime dependencies），函数状态 Active，真实普通 transport probe 返回原 build version。
- 云端仍有一个无引用的 `benchmarkXiaodaVoicePhase2.js` 孤儿文件；最终 index 无 require/dispatch，runtime 不可达。为避免危险的全量覆盖/删除，本轮不再为清除不可达文件扩大变更。
- 本地 staging 与明文 token 已移除；production source 未修改，Today 未切换，`docs/PROBLEM_LIST.md` 的用户改动未触碰。

## Artifact 索引

- Phase A：`docs/qa/ai-voice-phase2/phase-a-styling-intelligence-review.md`
- Development 根目录：`artifacts/xiaoda-ai-voice-phase2/phase2-development-gate`
- Prompt/Brief/token：`01-prompt.md`、`02-brief-schema.json`、`05-token-audit.json`
- 四轮结果：`06-development-attempt-{1..4}.json`
- 人工审稿：`07-editorial-review-attempt-1.json`、`07-editorial-review-attempt-{2..4}.md`
- 性能成本：`10-performance-cost-summary.json`
- 部署恢复：`deployment-audit.json`、`artifacts/xiaoda-ai-voice-phase2/cloud-before-phase2-20260812`、`artifacts/xiaoda-ai-voice-phase2/cloud-after-phase2-development-20260812`
