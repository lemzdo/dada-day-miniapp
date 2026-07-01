# 推荐语言 V3

## 目标

Recommendation Language V3 继续保留 `reasonVersion=recommendation-reason-v3`，本轮在其上建立“小搭语言系统 V1”，把普通推荐理由和小搭点评拆成四层：

- Facts：只保存结构化事实，不含图片 URL、fileID、OPENID、昵称、页面名、batchId、原始 AI 输出或调试文案。
- Insights：只表达搭配关系，不写用户文案。
- User Benefits：把搭配关系翻译成用户当天穿着收益，不是最终文案。
- Xiaoda Voice Copy：消费 facts、insights 和 benefits，输出 Today reason、详情 reasoning、小搭点评正文和建议。

本轮只改变展示字段：`reason`、`reasoning`、`reasonVersion`、展示标签、AI review copy/version。不得改变 outfit 组合、候选过滤、推荐数量、排序、scores、`scores.total`、`aestheticEvaluation`、`outfitKey`、`recommendationBatchId`、收藏、穿着、行为事件、learnedProfile、衣橱容量或上传确认流程。

## Facts

V3 facts 结构包含：

- `items[]`：`slot/category/subcategory/colors/primaryColor/fit/length/silhouette/patternType/designElements/formalityLevel/styleTags/material/thickness/confidence`
- `outfit`：`itemCount/categories/colorFamilies/styleTags`
- `context`：`scene/temperatureBand/conditionBucket`
- `scores`：只复制展示判断需要的分数字段，不参与重新排序
- `aesthetic`：只保留安全结构化摘要

低置信度高级属性不会作为强事实；`unknown/null` 不转成虚构事实。数组稳定排序，输入 item 顺序变化不改变语义结果。

## Insights Allowlist

支持的 insight code：

- Color：`COLOR_SOFT_HARMONY`、`COLOR_LIGHT_NEUTRAL_BALANCE`、`COLOR_NEUTRAL_BALANCES_ACCENT`、`COLOR_CLEAR_LIGHT_DARK_CONTRAST`、`COLOR_SINGLE_ACCENT`、`COLOR_TOO_MANY_COMPETING_ACCENTS`
- Pattern：`PATTERN_SINGLE_FOCUS`、`PATTERN_FOCUS_WITH_SIMPLE_BOTTOM`、`PATTERN_BALANCED_BY_SOLID_ITEMS`、`PATTERN_COMPETITION`
- Silhouette / proportion：`SILHOUETTE_RELAXED_BALANCE`、`SILHOUETTE_TOP_RELAXED_BOTTOM_CLEAN`、`PROPORTION_SHORT_TOP_LONG_BOTTOM`、`PROPORTION_LAYERED_BALANCE`、`SILHOUETTE_UNIFIED`
- Formality：`FORMALITY_ALIGNED`、`FORMALITY_CASUAL_BALANCE`、`FORMALITY_SOFTENED_BY_CASUAL_ITEM`、`FORMALITY_CONFLICT`
- Style / scene：`STYLE_COHERENT`、`STYLE_CASUAL_EASY`、`SCENE_HOME_EASY`、`SCENE_WORK_CLEAN`、`SCENE_DATE_SOFT`、`SCENE_SPORT_ACTIVE`
- Weather：`WEATHER_MILD_COMFORT`、`WEATHER_LAYERING_MATCH`、`WEATHER_THICKNESS_MATCH`
- Detail：`DETAIL_SINGLE_FOCUS`、`DETAIL_BALANCED`、`DETAIL_COMPETITION`

优先级：图案、配色、轮廓比例、正式度、细节 > 风格 > 场景 > 天气。天气和场景只做辅助，不应成为同批每套的主理由。

## Human Copy Policy

普通 `reason`、`reasoning`、AI fallback、小搭点评正文、小搭建议都必须经过 `human-copy-v1`。

禁用词包括：识别、识别结果、识别记录、真实识别、识别线索、证据、审美证据、组合证据、线索、可观察线索、维度、卡片、详情、详情页、输入、输出、候选、覆盖率、置信度、权重、观察点、系统判断、重点更清楚、更容易读出来、fallback、快照、模板、字段。

敏感表达包括：显瘦、遮肉、显高、拉长腿、修饰身材、显腿长、适合某种体型、适合某年龄、适合某职业、高级感、贵气、廉价、品质好。

小搭机械表达新增禁用：克制、稳定、干净稳定、比较稳定、明显冲突、基础单品、延续休闲感、更完整、正式度接近、视觉重量、视觉关系、色彩关系、视觉重点、完成度、保持统一、形成平衡、增强层次、整体有秩序、主要观察点、关系清楚。

命中禁用词时丢弃整条候选，重新选择其他 insight 或安全 fallback；不得只删除单词后保留残句。

## User Benefits V1

`deriveUserBenefitsV1(facts, insights, context)` 输出稳定、可测试、可去重的收益结构：

```js
{
  code: 'HOT_DAY_LIGHT_AND_EASY',
  strength: 3,
  sourceInsightCodes: ['WEATHER_THICKNESS_MATCH'],
  subjectSlots: ['top', 'bottom'],
  facts: {}
}
```

allowlist 覆盖高温、低温、居家、通勤、约会、运动、省心搭配和日常可用性。收益只在事实足够时产生：高温必须有偏热温度和短袖/短裤/轻薄/运动单品，低温必须有外套/长袖/厚度/层搭，居家临时出门必须有日常单品和鞋或完整搭配，省心搭配必须有颜色少、无图案竞争或风格接近等依据。

禁止无依据生成体感词：舒服、不闷、透气、保暖、柔软、软糯、活动方便、轻便、不勒、亲肤。

## 重复门禁

- 分句按 `，。！？；、` 拆分，标准化后不得重复。
- 相邻分句不得出现明显重复短语。
- `reasoning` 不得完整包含 `reason`。
- 小搭点评不重复详情 reasoning，advice 不重复点评正文。
- 同批次不允许完全相同 reason，不允许数字后缀，不允许“这组线索更突出”式兜底。

## Batch Planner

`planBatchCopyV3()` 按最终推荐顺序处理：

- 先生成每套 facts 和 insight candidates。
- 优先使用未出现过的 insight code。
- 再优先使用未出现过的 dimension。
- 为不同套装分配不同句式 family。
- 限制天气和场景作为主 insight 的次数。
- 高度相似套装优先使用真实次强关系或不同具体单品事实，不虚构差异。

## 展示规则

Today「小搭推荐」只回答“今天为什么值得穿这套？”，建议 28-58 个中文字符，优先用户当天收益，其次具体单品关系、场景或天气。

详情「为什么推荐这套」回答“为什么这些衣服放在一起合适，以及今天穿它有什么好处？”，建议两句话，第一句讲衣物关系，第二句讲天气、场景或用户收益，不逐字复用 Today 文案。

小搭点评只展示：

```text
小搭点评                         重新点评

点评正文

小搭建议
建议正文
```

不展示模型 title，不展示 AI styleTags，不显示空建议区。

## 标签来源

Today 和详情顶部标签只来自可靠结构化信息：

- 真实 `styleTags`
- `patternType`
- `fit/silhouette`
- 明确 scene

最多 3 个。禁止从 `reason/reasoning` 关键词反推。禁止自动生成“轻盈气质、软糯舒服、轻便好活动、高级感、耐看、氛围感”。

小搭点评区域不再渲染标签。数据库和 API 可继续保存旧 `styleTags` 用于兼容。

## AI Stylist V4 / Xiaoda Voice V1

版本：

- `reviewVersion=stylist-explanation-v4`
- `promptVersion=stylist-prompt-v4`
- `copyPolicyVersion=human-copy-v1`
- `voicePolicyVersion=xiaoda-voice-v1`

V4 prompt 只允许输出 `overallComment` 和 `advice`，要求像懂穿搭的贴心朋友，不卖弄专业术语，不解释识别/算法/生成过程，不使用机械设计词，不虚构舒适、材质、透气、保暖，不推断身体、年龄、职业或经济情况。validator 检查内部术语、机械表达、敏感词、事实颜色/材质约束、重复、comment/advice 相似度、长度和空值。AI 输出不合格时使用 Xiaoda rule fallback，不能把不合格内容展示给用户。

复用已有点评必须同时满足：`inputDigest` 相同、`reviewVersion` 为 V4、`promptVersion` 为 V4、`copyPolicyVersion` 正确、`voicePolicyVersion` 正确。旧 V1/V2/V3 记录不批量迁移，用户下一次主动点评时重新生成 V4。

## Golden Fixtures

当前 fixtures 覆盖 20 组以上场景，并新增 persona golden 字段。截图匿名样例：

```text
白色短袖T恤 + 灰色短裤 + 运动鞋 + 30°C + home
```

目标输出锁定为：

- Today：今天温度高，白T配灰色短裤穿着更轻松，运动鞋也方便临时出门。
- Detail：白T和灰色短裤放在一起很日常，颜色不会互相抢。今天温度比较高，短袖、短裤这类单品穿起来更轻松，运动鞋也方便临时出门。
- Comment：白T配灰色短裤很适合今天想穿得简单一点的时候，颜色清爽，出门也不费劲。
- Advice：想再利落一点，可以让上衣或小包呼应运动鞋里的颜色。

## 部署与人工验收

部署前运行相关 tests、miniapp typecheck/lint/build、`node --check` 和 `git diff --check`。

人工验收重点：

- Today 每套文案具体自然，无内部术语、重复短句或数字后缀。
- Detail 解释 2 到 3 个真实关系，不重复 Today，不虚构材质、颜色、版型。
- 小搭点评不展示 title/tags，只显示正文和建议。
- 旧点评主动点击后升级 V3，重新点评 cooldown 仍为 5 秒，AI 失败保留旧内容。
