# Xiaoda Voice Bank V2 与推荐文案 Contract 设计

## 目标

把用户可见的默认推荐文案收口为一条确定性链路：事实与受支持洞察进入 Narrative Planner，Planner 选择表达动作与证据，Voice Bank V2 提供完整人工句簇，Recommendation Copy Contract 负责选句与填槽，Acceptance Gate 只做通过或拒绝，最终得到 Canonical Copy Result。

默认文案不依赖 AI，不修改用户标题，也不与用户主动生成的真实 AI 点评共用版本或缓存失效条件。

## 方案比较

### 方案 A：在现有 `generateOutfit/services` 内收口（采用）

保留 `recommendationLanguageV3` 作为兼容编排层，把最终文案生产权交给新的 Planner、Voice Bank、Contract 和 Acceptance Gate。生成、详情、收藏、历史都由同一个 `generateOutfit` 云函数返回，因此这些服务可以被所有响应路径直接共享。

优点是没有新增云函数请求、数据库查询或打包边界，迁移风险可控；缺点是 `generateOutfit/index.js` 仍然较大，需要通过聚焦的规范化函数保持边界清晰。

### 方案 B：新增跨云函数共享 package

把纯 JS 文案引擎放入 workspace package，再由云函数打包引用。长期复用性较强，但当前相关读写链路都在一个云函数中，新增 package 会引入部署打包和 workspace 解析风险，没有实际收益。

### 方案 C：重写 `recommendationLanguageV3`

删除旧 V3 并从事实层重新搭建全部编排。边界最干净，但回归面包含排序、卡片模型、AI 兼容字段和大量既有测试，不符合本轮“收回文案所有权而不改推荐与 AI 行为”的范围。

## 架构与职责

### Recommendation Narrative Planner

Planner 只返回结构，不渲染句子。输入包括 scene、weather、outfitCopyFacts、supportedOutfitInsights、wearability、scene eligibility 和 batch context。输出包括首页与详情 action、dimension、evidence IDs，以及 sceneTone、heroItemId、allowedSlots、unsupportedClaims 和 blockedActions。

Planner 对证据采用白名单映射：天气动作必须有温度或天气证据；鞋子动作必须存在鞋类事实；材质、轻薄、透气、版型、显瘦、显白等主张只有在明确事实存在时才允许。首页与详情通过允许的 action pair 表选择，禁止同 action 扩写和证据复用。

### Xiaoda Voice Bank V2

Voice Bank 是静态、纯 JS、无随机副作用的完整句簇集合。每条记录包含 id、scene、surface、action、dimension、requiredFacts、forbiddenFacts、allowedSlots、text 和 toneTags。句子只能填 1–2 个显式槽位，缺槽时该句不可用。

句库分为 `today`、`detail`、`safeFallback` 与 `productStateCopy` 四个 namespace。默认推荐只能从前三类的完整句簇中选择；limited、empty、loading 等状态只能从产品状态 namespace 读取，不能成为穿搭理由。

### Recommendation Copy Contract

Contract 是唯一默认文案生产者。它接收事实、洞察、场景、天气、NarrativePlan、batch diversity constraints 与稳定 seed，筛选可用完整句簇、确定性排序、填槽、调用 Acceptance Gate，并在拒绝时选择另一条完整句簇。

输出固定带有：

- `copyContractVersion = recommendation-copy-contract-v1`
- `voiceBankVersion = xiaoda-voice-bank-v2`
- 首页和详情的文本、action、dimension、evidence IDs、sentence cluster ID
- 风险标记与选择诊断，仅用于测试和诊断，不作为第二文案出口

Contract 不接收 `userTitle`、`title` 或 `displayTitle`。

### Copy Acceptance Gate

Gate 返回 `PASS` 或 `REJECT`，不返回修改后的字符串。它检查反模式、语法完整性、槽位数量、证据要求、场景匹配、首页详情重复和批次句式重复。任何失败都由 Contract 重选完整句簇。

### 兼容编排层

`recommendationLanguageV3` 继续负责把现有事实、洞察、卡片和内容计划字段组装到 Outfit，但 `reason`、`reasoning`、`contentPlan.defaultTodayReason`、`contentPlan.defaultDetailExplanation` 与 `detailNarrativeViewModel.defaultText` 只能复制 Contract 结果。

`pageCopyComposer` 降级为事实/洞察适配器或兼容代理；`batchCopyDiversity` 只产生结构化 diversity constraints；`copyQualityGate` 变成 Acceptance Gate 兼容导出；`xiaodaVoicePolicy` 和 `xiaodaContentPlan` 不再拥有默认句子出口。旧规则 reason 只可作为内部推荐诊断，不进入用户可见字段。

## 数据流

生成链路先产出推荐组合，再为每套构建 facts 和 supported insights。Planner 结合批次上下文选择首页与详情动作，Contract 从 Voice Bank 选择句簇并通过 Gate，V3 编排层复制 Canonical Copy Result 到所有兼容字段，之后才保存 outfit 快照。

详情、收藏与历史读取已有 `snapshotItems`、`scene`、`weatherSnapshot`，在 `toSnapshotOutfit` 或统一响应规范化边界重建 facts 并调用同一个 Contract。该过程不查询额外衣物、不写回数据库、不触发额外云函数请求。真实 AI 点评原样保留；只有规则默认别名复制新的 Contract 文案。

## 客户端与缓存

客户端用 `copyContractVersion` 判断默认文案是否有效。版本缺失或不等于 `recommendation-copy-contract-v1` 的本地草稿、今日恢复快照、详情页缓存、收藏首屏缓存、历史首屏缓存一律不展示默认理由，并等待服务端规范化结果。

缓存 key 或 envelope 同步 bump：generateOutfit 30 秒响应缓存 namespace、`TODAY_SCENE_COPY_VERSION`、今日恢复 snapshot、`outfitDetailDraft`、详情页、收藏首屏和历史首屏。`voiceBankVersion` 仅用于诊断，不作为客户端有效性主条件。

卡片 meta 只展示温度/天气、场景或件数事实，不生成“适合今天/适合某场景”。加载和空状态使用 `productStateCopy`，前端不拼接衣物名生成推荐理由。

## 错误处理

如果首选句簇缺少事实、槽位或被 Gate 拒绝，Contract 按稳定顺序选择下一条完整句簇。常规句簇全部不可用时，只能选择满足最低事实条件的安全 fallback。若连安全 fallback 都无法通过，返回无默认文案的中性状态和风险标记，不能调用旧生成器或前端拼句兜底。

## 测试与验收

单元测试覆盖 Planner 动作优先级与配对、Voice Bank 元数据和数量、Contract 确定性与字段复制、Acceptance Gate 的纯 PASS/REJECT、batch diversity 不改字符串、缓存版本拒收和前端中性 fallback。

产品矩阵覆盖 home/work/date/sport，以及少衣服、普通、大量复杂、缺鞋、大量相似、图案/亮色、属性不完整、高温、常温、低温。快照记录事实、Plan、两端文案、动作、维度、证据、句簇、版本和风险标记。

人工验收文档完整列出句库，并提供四场景各至少八组首页与详情文案。最终运行目标文件指定的全部 Node 测试、miniapp typecheck、lint、build、`git diff --check` 与 `git status --short`。

## 非目标与硬约束

- 不修改 AI prompt、schema、validator 或生成行为。
- 不增加数据库查询、云函数请求或全量数据迁移。
- 不修改用户标题、收藏状态、穿过状态或真实 AI 点评。
- 不清空数据库，不部署。
- 不执行 `git add`、`git commit` 或 `git push`。
