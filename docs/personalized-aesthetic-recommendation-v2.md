# 搭搭day 个性化审美穿搭推荐 V2

本文档是“搭搭day 个性化审美穿搭推荐 V2”的唯一设计和实施基线。后续每完成一个阶段，都应在本文档中更新已完成内容、实际修改文件、数据库变化、部署要求、测试要求、未完成事项和 commit hash，不再为每个小阶段新建重复文档。

本轮范围仅建立文档，不修改业务代码、不修改类型、不新增集合、不提交、不部署。

## 版本目标

核心目标：

1. 推荐从“天气和属性适配”升级为“组合级审美推荐”。
2. 在大众审美基础上支持不同穿搭风格的独立规则。
3. 用户主动选择的风格参与推荐。
4. 用户收藏、取消收藏、穿它、查看详情、换一批等行为逐渐影响其本人推荐。
5. 用户个人行为当前只用于本人推荐，不参与其他用户推荐。
6. 行为数据保留，为未来匿名化群体审美模型预留基础。
7. 小搭点评必须基于推荐引擎真实输出的结构化审美证据，不允许凭空编造。
8. 不直接让大模型从整个衣橱自由选衣。
9. 推荐架构采用规则候选生成、组合级审美评分、个性化排序、探索混排和 AI 拟人化解释。

## 核心架构

唯一目标架构：

```text
CandidateGenerator
    ↓
AestheticCompatibility
    ↓
PersonalTasteModel
    ↓
ExplorationMixer
    ↓
StylistExplanation
```

### CandidateGenerator

负责：

- active clothes
- 温度、季节、场景硬约束
- 上衣、下装、裙装、连衣裙、外套、鞋等基础组合
- 无效衣物和不完整组合排除

不负责最终审美判断。

### AestheticCompatibility

负责：

- 色彩关系
- 廓形平衡
- 长短比例
- 繁简关系
- 视觉焦点
- 材质关系
- 正式度
- 风格表达
- 有意反差
- 场景审美

除明显不可穿条件外，审美规则以软评分为主。

### PersonalTasteModel

用户审美偏好分为三层：

- `explicitProfile`：用户主动选择
- `learnedProfile`：系统从行为学习
- `contextProfile`：不同场景、季节、温度下的偏好

`learnedProfile` 和 `contextProfile` 不得覆盖用户主动设置，只作为排序增益或惩罚。

### ExplorationMixer

保证每批推荐不是完全重复已知偏好。

支持：

- 稳妥推荐
- 相邻风格探索
- 有依据的惊喜

不得做无依据随机搭配。

### StylistExplanation

只消费：

- `aestheticEvidence`
- `personalizationEvidence`
- `riskNotes`
- `optionalTip`

AI 只负责拟人化表达，不重新选衣，不修改评分，不虚构理由。

## 已确定的产品原则

### 大众审美是底线，不是唯一标准

- 不同风格使用不同审美权重。
- 极简允许基础款组合。
- 街头允许宽松叠加。
- 甜酷奖励甜与酷的张力。
- 先锋允许多焦点和不规则比例。
- 违反常规时必须存在统一逻辑，例如色盘、线条、材质或主题。

### 用户偏好不能取消审美判断

系统目标是：

```text
在成立的搭配中，优先推荐用户更可能喜欢的
```

而不是：

```text
用户喜欢什么就无限重复什么
```

### 持久化客观特征，运行时推导审美结论

适合持久化：

- 颜色角色和比例
- `fit`
- `length`
- `silhouette`
- `patternType`
- `designElements`
- `formalityLevel`

不建议作为永久事实直接存储：

- 当前搭配中的视觉焦点
- 整套繁简平衡
- 色彩和谐度
- 设计感最终评分
- 风格完整度
- 有意反差是否成立

这些应在组合评分时计算。

### 第一阶段高级属性不向用户展示或编辑

高级审美属性：

- 由 AI 识别
- 暂不出现在衣服编辑页
- 暂不加入 `manualFields`
- 先验证识别准确率和推荐价值
- 后续再决定是否开放“高级属性”折叠编辑区

## 服装审美特征 V2

第一阶段计划结构：

```ts
aestheticFeatures: {
  version: 1,

  fit: 'fitted' | 'regular' | 'relaxed' | 'oversized' | 'unknown',

  length: string,

  silhouette: string,

  patternType:
    | 'solid'
    | 'stripe'
    | 'plaid'
    | 'floral'
    | 'graphic'
    | 'polkaDot'
    | 'animal'
    | 'abstract'
    | 'other'
    | 'unknown',

  designElements: string[],

  formalityLevel: 1 | 2 | 3 | 4 | 5 | null,

  confidence: {
    fit?: number,
    length?: number,
    silhouette?: number,
    patternType?: number,
    designElements?: number,
    formalityLevel?: number
  },

  provider?: string,
  model?: string,
  recognizedAt?: Date
}
```

说明：

- 具体枚举需在实施阶段结合现有 `category` / `subcategory` 确认。
- `length` 和 `silhouette` 可能需要按品类使用不同枚举。
- 未识别字段使用 `unknown` 或 `null`。
- 不因识别失败阻断衣服入库。

### colorPalette 扩展

不新增平行的 `primaryColor` / `secondaryColors` 顶层字段。

在现有 `colorPalette` 中扩展：

```ts
{
  name: string,
  hex?: string,
  role?: 'primary' | 'secondary' | 'accent',
  proportion?: number
}
```

运行时从颜色值推导：

- 色相
- 冷暖
- 明度
- 饱和度
- 中性色
- 同色、邻近、互补关系

避免重复保存：

- `colorTemperature`
- `colorValue`
- `colorChroma`
- `primaryColor`
- `secondaryColors`

## 组合级审美评分设计

计划评分结构：

```ts
aestheticScores: {
  colorHarmony: number,
  silhouetteBalance: number,
  proportionQuality: number,
  complexityBalance: number,
  focalPointClarity: number,
  materialRelationship: number,
  formalityCoherence: number,
  styleExpression: number,
  intentionalContrast: number,
  total: number
}
```

### 色彩关系

考虑：

- 主辅色关系
- 中性色锚点
- 明暗层次
- 饱和度关系
- 颜色数量
- 点缀色面积
- 不同风格对冲突色的容忍度

### 廓形与比例

考虑：

- 上松下紧
- 上紧下松
- 上短下长
- 宽松叠加是否有层次
- 外套和内搭长度
- 上下体积感
- 风格是否允许夸张比例

### 繁简平衡

根据：

- 图案
- 颜色数量
- `designElements`
- 廓形夸张程度
- 材质存在感
- 剪裁特点

运行时推导每件衣物和整套的信息量。

### 视觉焦点

判断：

- 是否有明确主角
- 是否没有主角
- 是否多个焦点互相冲突
- 多焦点是否符合先锋或 maximalist 风格

### 材质关系

第一阶段通过 `material` 规则表推导：

- 软硬
- 轻重
- 挺括
- 垂坠
- 光泽
- 粗糙 / 细腻
- 休闲 / 精致

不在第一阶段增加大量材质气质字段。

### 正式度

结合：

- 单品 `formalityLevel`
- 场景
- 风格目标
- 是否属于有意混搭

### 风格语法

每种风格将来需要独立的规则权重，例如：

- 极简
- 韩系
- 温柔
- 甜酷
- 法式
- 复古
- 街头
- 运动
- 通勤
- 先锋

本文档只定义方向，不在本轮写死最终规则表。

## 用户行为体系

行为当前只影响本人 `_openid`。

计划新增：

```text
outfit_behavior_events
```

初始事件类型：

```text
exposure
detail_view
favorite
unfavorite
wear
batch_refresh
```

信号强度原则：

```text
重复穿着 > 穿它 > 收藏 > 详情查看 > 普通曝光
```

其中：

- `unfavorite` 是明确负反馈。
- `batch_refresh` 是非常弱的负反馈。
- “曝光但未操作”不能直接视为强负反馈。
- 收藏和穿它不能使用相同权重。

建议事件结构：

```ts
{
  _openid,
  eventType,
  outfitKey,
  clothingIds,
  scene,
  weatherBand,
  batchId,
  rank,
  source,

  styleIntent,

  aestheticFeatureSnapshot: {
    colors,
    silhouettePair,
    complexityPattern,
    formality,
    styleComposition
  },

  createdAt
}
```

不需要复制完整图片和庞大 outfit snapshot。

## 用户审美画像

计划新增独立：

```text
learned_style_profiles
```

或者等实施审计后确认是否放入 `users` 子字段。

不能覆盖现有 `recommendationProfile`。

设计内容：

```ts
{
  _openid,

  styleWeights,
  colorAffinity,
  colorPairAffinity,
  silhouettePairAffinity,
  complexityPreference,
  formalityPreference,
  texturePreference,
  categoryAffinity,
  noveltyTolerance,

  contextBuckets,

  sampleSize,
  version,
  updatedAt
}
```

行为少时主要依赖：

- 大众审美
- 用户主动风格

行为增多后逐渐增加 `learnedProfile` 权重。

必须支持：

- 时间衰减
- 重复信号饱和
- 场景分桶
- 探索位
- 冷启动降级

当前阶段不建设群体审美模型，但为未来匿名化群体审美模型预留行为数据基础。

## 小搭点评 V2

推荐引擎计划输出：

```ts
aestheticEvidence: {
  colorRelation,
  silhouetteRelation,
  proportionRelation,
  complexityBalance,
  focalPoint,
  materialRelation,
  formalityRelation,
  styleComposition,
  intentionalContrast
}
```

同时输出：

```ts
personalizationEvidence: {
  explicitReasons: string[],
  learnedReasons: string[],
  contextReasons: string[]
}
```

以及：

```ts
riskNotes: string[]
optionalTip: string
```

AI 点评负责表达：

1. 为什么这套成立
2. 为什么适合该用户
3. 哪处是有意反差
4. 有什么风险
5. 怎样调整成另一种感觉

AI 不得编造未出现在 evidence 中的：

- 显高
- 显瘦
- 显腿长
- 色彩呼应
- 松紧平衡
- 材质层次
- 用户历史偏好

## 实施阶段

### 阶段 0：设计和现状基线

状态：

```text
进行中
```

内容：

- 建立本设计文档
- 锁定产品原则
- 锁定阶段边界

### 阶段 1：服装审美特征 V2

内容：

- 确认字段枚举
- 修改识别 prompt
- 新上传衣物写入 `aestheticFeatures`
- 已有衣服重新识别写入 `aestheticFeatures`
- 扩展 `colorPalette` 的 `role` / `proportion`
- `getWardrobe` 和类型兼容
- 旧衣服无字段时降级
- 不开放用户编辑
- 不全量 backfill

### 阶段 2：组合级审美引擎

内容：

- `AestheticCompatibility`
- 风格语法
- 调整天气 / 场景权重结构
- `aestheticScores`
- `aestheticEvidence`
- outfit snapshot 保存 evidence
- 旧衣物降级评分

### 阶段 3：行为事件采集

内容：

- `outfit_behavior_events`
- `exposure` / `detail_view` / `favorite` / `unfavorite` / `wear` / `batch_refresh`
- 幂等和用户隔离
- 先采集，暂不强力影响推荐

### 阶段 4：用户审美学习

内容：

- `learnedStyleProfile`
- 初始历史聚合
- 增量更新
- 时间衰减
- 场景画像
- 个性化排序

### 阶段 5：探索混排

内容：

- 稳妥推荐
- 相邻探索
- 有依据惊喜
- 一批最多 8 套的分配策略

### 阶段 6：小搭点评 V2

内容：

- 新 evidence 输入
- `promptVersion` 升级
- `inputHash` 升级
- 旧点评自然失效
- 拟人化多角度输出

### 阶段 7：统一部署与人工验收

内容：

- 集合
- 权限
- 索引
- 云函数部署
- 小程序构建
- 分模块测试
- 回滚预案

## 阶段实施记录

### 阶段 0：设计和现状基线

- 状态：进行中
- 开始日期：2026-06-25
- 完成日期：未完成
- commit：本轮按要求不提交
- 修改文件：`docs/personalized-aesthetic-recommendation-v2.md`
- 新增字段：无
- 新增集合：无
- 新增索引：无
- 环境变量：无
- 部署云函数：无
- 数据迁移：无
- 自动检查：`git status --short`、`git branch --show-current`、`git log --oneline -5`、`git diff --stat`
- 人工测试：不适用，本轮只新增文档
- 已知问题：无
- 后续事项：进入阶段 1 前需先审计现有类型、AI 识别输出、衣物数据结构和推荐引擎降级路径

### 后续阶段更新模板

```md
### 阶段名称

- 状态：
- 开始日期：
- 完成日期：
- commit：
- 修改文件：
- 新增字段：
- 新增集合：
- 新增索引：
- 环境变量：
- 部署云函数：
- 数据迁移：
- 自动检查：
- 人工测试：
- 已知问题：
- 后续事项：
```

## 非目标

当前版本不做：

- 用户间行为共享
- 群体审美训练
- 大模型自由选衣
- 全量历史衣服重新识别
- 高级审美字段用户编辑
- Web / BFF 同步
- 体型和身材推断
- 根据照片推断用户敏感身体特征
- 自动购买建议
- 配饰完整推荐体系

## 风险

1. 视觉模型无法稳定识别过细字段。
2. 字段过多导致数据质量差。
3. 旧衣服缺字段造成评分不公平。
4. 天气和场景权重调整可能影响现有推荐稳定性。
5. 行为学习造成推荐越来越窄。
6. 负反馈误判。
7. AI 点评编造审美理由。
8. 云开发与 Web schema 继续分叉。
9. 新 evidence 影响 outfitKey、缓存和 AI review inputHash。
10. 新字段写入与重新识别并发覆盖。

## 本轮检查要求

创建文档后执行：

```bash
git status --short
git diff --stat
```

本轮只新增文档，不运行 typecheck / lint，不提交 commit，不继续阶段一代码修改。
