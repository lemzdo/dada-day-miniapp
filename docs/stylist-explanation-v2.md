# Stylist Explanation V2

本文档记录阶段 6 第一任务：Evidence-grounded Stylist Explanation V2。当前实现只升级用户手动触发的“AI 点评这套”，不改变推荐候选、`scores.total`、排序、行为权重或页面视觉设计。

## 目标

V2 链路为：

```text
真实 outfit 结构化数据
-> deterministic stylist evidence compiler
-> constrained stylist prompt v2
-> output validator with evidence reference validation
-> outfit_ai_reviews persistence and reuse
-> legacy title/reason/styleTags/tip compatibility
```

AI 的职责是解释既有 outfit，不是选择衣服，也不参与推荐算法。

## Evidence Compiler

新增 `buildStylistEvidenceV1({ outfit, scene, weather, explicitProfile })`，输出 `schemaVersion=1`、`evidenceVersion=stylist-evidence-v1`、`context`、`outfit`、`scores`、`aesthetic`、`evidence`、`limitations` 和 `inputDigest`。

compiler 是纯函数：

- 不修改输入 outfit。
- evidence code 去重并稳定排序。
- evidence 最多 16 条。
- `strength` 归一到 `1/2/3`。
- `polarity` 归一到 `positive/negative/neutral`。
- facts 只保留结构化基础值。
- 输出可 JSON 序列化，不含 `NaN` 或 `Infinity`。

## 允许输入

允许进入 evidence / prompt 的数据：

- scene、temperatureBand、conditionBucket。
- 衣物 category/type、subcategory、colorPalette 的 name/role、fit、length、silhouette、patternType、designElements、formalityLevel、styleTags、material、thickness。
- `scores.total`、`weatherAdaptation`、`styleUnity`、`freshness`、`preference`。
- `aestheticEvaluation.engineVersion`、`score`、`coverage`、`dimensions`、`evidence`。

## 禁止输入

compiler 和 prompt 不发送：

- 图片 URL、fileID、上传文件路径。
- 原始 AI 结果。
- 数据库内部字段。
- 用户昵称、头像。
- 城市、GPS、经纬度、精确位置。
- learnedProfile 或 `learned_style_profiles` 内容。

item identity 仅作为 digest 内部稳定性输入使用 hash，不暴露原始衣物 id。

## Coverage 与 Limitation

- `coverage >= 0.50`：允许相对明确的组合审美解释，但不得绝对化。
- `0.25 <= coverage < 0.50`：加入 `LIMITED_AESTHETIC_COVERAGE`，prompt 要求谨慎表达。
- `coverage < 0.25` 或 `score=null`：加入 `INSUFFICIENT_AESTHETIC_EVIDENCE`，不得输出整体审美优劣结论。

缺少数据不能被解释为搭配缺点。

## 输出 Schema

V2 输出为：

```ts
interface StylistExplanationPointV2 {
  text: string;
  evidenceCodes: string[];
}

interface StylistExplanationV2 {
  schemaVersion: 2;
  reviewVersion: 'stylist-explanation-v2';
  promptVersion: 'stylist-prompt-v2';
  title: string;
  summary: string;
  strengths: StylistExplanationPointV2[];
  tradeoffs: StylistExplanationPointV2[];
  tip: StylistExplanationPointV2 | null;
  styleTags: string[];
  confidence: 'high' | 'medium' | 'low';
  evidenceCodes: string[];
  limitations: string[];
  source: 'ai' | 'rule_fallback';
  provider: string;
  model: string;
  generatedAt: string;
  inputDigest: string;
}
```

兼容字段继续返回 `title`、`reason`、`styleTags`、`tip`。现有详情页仍按旧四字段展示，不需要立即展示 strengths/tradeoffs。

## Evidence 引用规则

每个 strength、tradeoff 和 tip 必须引用输入中真实存在的 evidence code。validator 会移除不存在的 code；如果一个 point 失去全部 evidence 支撑，则移除该 point。顶层 `evidenceCodes` 只从保留下来的 point 汇总，不信任模型伪造的顶层 code。

## Prompt 安全边界

V2 prompt 明确：

- 你是穿搭解释者，不是衣服选择器。
- 只能使用给定 facts 和 evidence。
- 不得创造不存在的材质、颜色、版型、天气或场景。
- 不得推断身材、体型、年龄、职业、身份、经济状况。
- 不得评价用户本人。
- 禁止“显瘦、遮肉、拉长腿”等身体导向表达。
- 不得声称品牌、价格或品质。
- 不得修改或重新计算分数。
- 只输出严格 JSON，不输出 Markdown。

## Validator

`validateStylistExplanationV2` 校验 schema/version、字段类型、文本长度、数组数量、styleTags 去重、evidence code 引用、limitation 白名单、confidence 与 coverage 一致性，并覆盖模型伪造的 provider/model/generatedAt/inputDigest/source。

schema 外字段会被剥离。

## Rule Fallback

`buildRuleFallbackExplanationV2(evidenceInput)` 是确定性 fallback，不调用网络。以下情况使用：

- 模型 JSON 无法解析。
- schema 严重非法。
- 引用过滤后没有可用内容。
- 模型返回空内容。

fallback 只引用真实 evidence code，`source='rule_fallback'`，根据 coverage 设置 confidence，并使用固定中文模板。

## Input Digest

`inputDigest = sha256(stableStringify(canonicalInput))`。

digest 包含 evidence compiler version、scene、weather context、safe outfit facts、scores、aestheticEvaluation、canonical evidence 和 limitations。

digest 不包含 generatedAt、requestId、recommendationBatchId、页面来源、临时 URL、数据库更新时间、字段顺序、图片、定位或 learnedProfile。

相同语义输入顺序变化不改变 digest；衣物属性、scene、weather、scores、aestheticEvaluation 或 compiler version 改变会改变 digest。

## 复用与重新点评

继续使用 `outfit_ai_reviews`，不新增集合或索引。

普通点击时，如果已有 ready review 满足：

```text
reviewVersion = stylist-explanation-v2
inputDigest = 当前 inputDigest
```

则直接复用，不调用 AI。

输入 digest 改变时，普通点击生成新 V2，不复用旧事实点评。重新点评 `forceRegenerate=true` 时，即使 digest 一致也重新调用 AI，并遵守现有 cooldown。

## V1 兼容

旧 V1 review 不做全量迁移，也不删除。旧记录仍可读取兼容字段；用户下次主动点击点评时会按当前输入生成 V2。旧 V1 不会因为存在而永久阻止升级。

## 并发保护

沿用 `outfit_ai_reviews` 的 transaction + generationToken lease。V2 增加 reviewVersion、inputDigest、evidenceVersion、source、explanationV2 等字段。成功写入前会确认 generationToken 和 inputDigest；晚归旧请求不会覆盖新请求。AI/API 失败会恢复 previousReview 或标记 failed，不清空已有 ready 点评。

## learnedProfile 边界

本轮不读取 `learned_style_profiles`，不调用 `refreshLearnedStyleProfile`，不把 learnedProfile 放入 evidence 或 prompt。显式用户偏好也未新增进入点评输入。

## 推荐边界

本轮不修改 `aestheticCompatibility` 评分规则，不修改 `scores.total`，不修改候选生成、过滤、排序、shadow telemetry、行为事件、收藏、穿它、重命名或详情页视觉布局。

## 部署与下周 Smoke Test

需要部署 `generateOutfit` 云函数后验证真实环境。建议 smoke test：

1. 打开已有穿搭详情，默认模板理由正常。
2. 首次点击 AI 点评生成 V2。
3. 返回包含 title/reason/styleTags/tip。
4. 数据库保存 reviewVersion、inputDigest。
5. 再次进入相同输入直接复用。
6. 不再次调用模型。
7. 点击重新点评可生成新内容。
8. force refresh 不复用。
9. 修改穿搭输入后 digest 变化。
10. 新输入不会复用旧点评。
11. 旧 V1 点评可按需升级 V2。
12. coverage 高时解释相对明确。
13. coverage 低时表达谨慎。
14. 缺少 aestheticFeatures 时仍可安全点评。
15. 模型 malformed 输出时 fallback 正常。
16. AI/API 失败不清空已有点评。
17. 点评不出现身材、年龄或身份推断。
18. 点评不虚构颜色、材质或设计元素。
19. 收藏、穿它和重命名不受影响。
20. 推荐顺序和分数完全不变。
