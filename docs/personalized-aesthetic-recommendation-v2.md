# 搭搭day 个性化审美穿搭推荐 V2

本文档是“搭搭day 个性化审美穿搭推荐 V2”的唯一设计和实施基线。后续每完成一个阶段，都应在本文档中更新已完成内容、实际修改文件、数据库变化、部署要求、测试要求、未完成事项和 commit hash，不再为每个小阶段新建重复文档。

截至 2026-06-26，阶段 0 已完成，阶段 1 代码与最终闭环审计已完成，阶段 2 第一任务“组合级审美兼容引擎基础”和第二任务“影子评分分布离线校准与融合方案”已完成；阶段 1 的 5 个云函数仍待部署和真实小程序 smoke test，阶段 2 整体仍进行中，审美评分仍未正式参与排序。

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

- 由 AI 识别和系统 normalize 写入。
- 暂不出现在衣服编辑页。
- 暂不加入 `manualFields`。
- 先验证识别准确率和推荐价值。
- 后续再决定是否开放“高级属性”折叠编辑区。

## 阶段 1 第一步审计结论

阶段 1 第一步“服装审美特征识别与写入边界审计”已完成。本次审计只分析现状，没有修改业务代码。

### 当前新上传识别链路

真实链路为：

```text
createUploadBatch
    ↓
createUploadImage
    ↓
processUploadImage
    ↓
router
    ↓
detection
    ↓
crop
    ↓
segment
    ↓
attribute
    ↓
clothes_drafts
    ↓
confirmClothesDrafts
    ↓
clothes
```

属性识别图片优先级为：

1. `cleanImageUrl`
2. `cropImageUrl`
3. `originalImageUrl`

多件衣服会按 `asset` 逐件生成候选、裁剪、分割并单独识别属性。

### 当前已有衣服重新识别链路

已有衣服重新识别使用单品图，图片优先来自：

1. `cleanImageUrl`
2. `aiSegmentImageUrl`
3. `cropImageUrl`
4. `croppedImageUrl`
5. `manualCropImageUrl`

重新识别写回受 `recognitionAttemptToken` 保护。旧请求晚归时返回 `superseded`，不得覆盖新结果。

### 当前实现边界

- 上传识别和已有衣服重新识别当前存在两套 Prompt / schema，需要在阶段 1 统一高级字段 schema。
- `clothes_drafts`、`confirmClothesDrafts`、`getWardrobe` 都是手工 mapper。
- 新字段必须在草稿、确认入库、读取返回和重识别写回处显式接入，否则会丢失。
- `updateClothes` 当前通过白名单写入字段，不应允许客户端传入或修改 `aestheticFeatures`。

## 服装审美特征 V2

阶段 1 锁定 `AestheticFeaturesV1`。`version` 是数据 schema 版本，`promptVersion` 是识别 Prompt 版本，两者分离。

```ts
interface AestheticFeaturesV1 {
  version: 1;
  promptVersion: 'aesthetic-v1';

  fit:
    | 'fitted'
    | 'regular'
    | 'relaxed'
    | 'oversized'
    | 'unknown';

  length:
    | 'cropped'
    | 'short'
    | 'regular'
    | 'long'
    | 'extraLong'
    | 'unknown';

  silhouette:
    | 'straight'
    | 'boxy'
    | 'aLine'
    | 'xLine'
    | 'cocoon'
    | 'tapered'
    | 'wideLeg'
    | 'flare'
    | 'bodycon'
    | 'unknown';

  patternType:
    | 'solid'
    | 'stripe'
    | 'plaid'
    | 'floral'
    | 'graphic'
    | 'polkaDot'
    | 'animal'
    | 'abstract'
    | 'colorBlock'
    | 'other'
    | 'unknown';

  designElements: Array<
    | 'ruffle'
    | 'pleat'
    | 'lace'
    | 'cutout'
    | 'asymmetry'
    | 'hardware'
    | 'embroidery'
    | 'distressed'
    | 'layered'
    | 'bow'
    | 'puffSleeve'
    | 'sheer'
    | 'fringe'
    | 'belted'
  >;

  formalityLevel: 1 | 2 | 3 | 4 | 5 | null;

  confidence: {
    fit: 'high' | 'medium' | 'low';
    length: 'high' | 'medium' | 'low';
    silhouette: 'high' | 'medium' | 'low';
    patternType: 'high' | 'medium' | 'low';
    designElements: 'high' | 'medium' | 'low';
    formalityLevel: 'high' | 'medium' | 'low';
  };

  provider: string;
  model: string;
  recognizedAt: string;
}
```

字段原则：

- `fit` 表达松紧程度，只描述衣服本身的设计版型，不表达穿在某个人身上是否合身。
- `silhouette` 表达轮廓形状，不包含 `fitted`、`relaxed`、`oversized`。
- `provider`、`model`、`promptVersion`、`recognizedAt` 由系统写入，不由模型自由返回。
- `visualComplexity` 本阶段不作为模型直接持久字段。
- 不根据衣服照片推断用户身体、身材或敏感属性。

### silhouette 适用范围

`silhouette` 使用统一枚举，但必须按 `category` / `subcategory` 校验适用范围。

| 品类 | 可用值 |
| --- | --- |
| 上衣 | `straight`、`boxy`、`aLine` |
| 外套 | `straight`、`boxy`、`aLine`、`xLine`、`cocoon` |
| 裤装 | `straight`、`tapered`、`wideLeg`、`flare` |
| 半身裙 | `straight`、`aLine`、`xLine`、`bodycon`、`flare` |
| 连衣裙 | `straight`、`aLine`、`xLine`、`bodycon`、`cocoon` |
| 鞋和配饰 | `unknown` |

合法枚举但不适用于当前 `category` / `subcategory` 时，解析器降级为 `unknown`。

### length 品类解释

`length` 保留统一枚举，但 Prompt 和解析说明必须按品类解释。`length` 只表达该品类内部的相对长度，不根据真人身体比例推断。无法判断时使用 `unknown`。

| 值 | 上衣 | 外套 | 裤装 | 半身裙 | 连衣裙 |
| --- | --- | --- | --- | --- | --- |
| `cropped` | 露腰 / 明显短款 | 短外套 | 短裤 | 迷你裙 | 超短连衣裙 |
| `short` | 短款 | 短款外套 | 九分 / 短长裤 | 短裙 | 膝上短裙 |
| `regular` | 常规衣长 | 常规外套 | 常规裤长 | 及膝 / 中长 | 及膝到小腿 |
| `long` | 长款 | 中长 / 长外套 | 拖地感 | 长裙 | 长裙 |
| `extraLong` | 超长款 | 及踝外套 | 超长拖地 | 及踝裙 | 及踝长裙 |
| `unknown` | 无法判断 | 无法判断 | 无法判断 | 无法判断 | 无法判断 |

`category` / `subcategory` 优先于模型直觉；无法确定品类时，`length` 优先降级为 `unknown`。

### patternType

第一版为单值字符串，不使用数组。

- `colorBlock` 归入 `patternType`，不放入 `designElements`。
- logo、文字、人物印花统一为 `graphic`。
- 提花、迷彩、民族纹样第一版不单列，按视觉情况归入 `abstract`、`other` 或 `unknown`。

### designElements

第一版使用有限白名单，不允许自由文本。

| 值 | 定义 |
| --- | --- |
| `ruffle` | 荷叶边或明显褶边装饰 |
| `pleat` | 规则褶裥、百褶 |
| `lace` | 蕾丝装饰或蕾丝面料 |
| `cutout` | 镂空、挖空设计 |
| `asymmetry` | 明显不对称剪裁或结构 |
| `hardware` | 金属扣、链条、铆钉等硬件装饰 |
| `embroidery` | 刺绣图案或刺绣装饰 |
| `distressed` | 破洞、磨损、水洗做旧 |
| `layered` | 视觉上明确的叠层结构 |
| `bow` | 蝴蝶结装饰 |
| `puffSleeve` | 泡泡袖 |
| `sheer` | 透视、薄纱、半透明材质 |
| `fringe` | 流苏 |
| `belted` | 自带腰带、腰封或明显束带结构 |

每件衣服最多保存 4 项，未知设计不要创造自由文本。

### formalityLevel

`formalityLevel` 使用 1 到 5，无法判断时使用 `null`，禁止默认写中间值。

| 值 | 含义 |
| --- | --- |
| 1 | 非常休闲，例如居家、运动、拖鞋感单品 |
| 2 | 日常休闲，例如普通 T 恤、牛仔、休闲鞋 |
| 3 | 精致日常，例如有设计感但不正式的衬衫、半裙、连衣裙 |
| 4 | 通勤正式，例如西装外套、正式衬衫、通勤皮鞋 |
| 5 | 正式场合，例如礼服、宴会装、高正式度套装 |

AI 输出后必须做代码 clamp；category 可作为规则校正信号。

### colorPalette 扩展

沿用当前真实结构中的 `ratio`，不新增 `proportion`。

```ts
interface ColorInfo {
  name: string;
  hex?: string;
  ratio?: number;
  role?: 'primary' | 'secondary' | 'accent';
}
```

规则：

- 不新增 `primaryColor` / `secondaryColors` 顶层字段。
- 最多 3 色。
- `ratio` 使用 0 到 1。
- 有效比例可以归一化。
- `ratio` 缺失时不伪造。
- `hex` 缺失时不补假灰色。
- 至多一个 `primary`。
- `colors` mirror 继续由 `name` 生成。
- 老数据只有 `name` 时保持其他字段 `undefined`。

运行时从颜色值推导色相、冷暖、明度、饱和度、中性色、同色 / 邻近 / 互补关系，避免重复保存：

- `colorTemperature`
- `colorValue`
- `colorChroma`
- `primaryColor`
- `secondaryColors`

## 识别与降级规则

1. 高级审美字段失败不能阻断普通属性识别。
2. 枚举外值降级：
   - 字符串字段写 `unknown`。
   - `formalityLevel` 写 `null`。
   - `designElements` 过滤、去重，最多 4 项。
3. `confidence` 使用 `high` / `medium` / `low`，不视为真实概率。
4. 模型输出 confidence 只作为启发式信号。
5. 低 confidence 降级：
   - `fit` / `length` / `silhouette` / `patternType` 写 `unknown`。
   - `formalityLevel` 写 `null`。
   - `designElements` 写 `[]`。
6. 不允许自由文本进入 `designElements`。
7. 不根据衣服照片推断用户身材、身体或敏感属性。

## 重新识别合并规则

已有衣服重新识别按字段合并 `aestheticFeatures`：

- 新 `high` 覆盖旧值。
- 新 `medium` 可覆盖旧 `low` / `unknown`，也可更新旧 `medium`。
- 新 `low` / `unknown` / `null` 不覆盖已有有效值。
- 旧值不存在时允许写默认 `unknown` / `null`。
- `designElements` 整体合并或保留，去重后最多 4 项。
- `recognitionAttemptToken` 继续保护最终写回。
- 失败或旧请求晚归不修改现有高级属性。

用户手动保护 `colorPalette` 时，不覆盖整组颜色数据。高级字段当前不加入 `manualFields`。

## 写入边界

### 新上传草稿

- `clothes_drafts` 保存完整 normalized `aestheticFeatures`。
- 即使高级识别失败，也保存 `version` / `promptVersion` 和默认 `unknown` / `null`。
- 普通属性不能因高级字段失败而失败。

### 草稿确认入库

- `confirmClothesDrafts` 显式复制并 normalize `aestheticFeatures`。
- 保留 `provider` / `model` / `recognizedAt` / `confidence`。
- 不重新调用模型。

### 已有衣服重新识别

- AI 成功后写入或按字段合并 `aestheticFeatures`。
- 写回继续受 `recognitionAttemptToken` 保护。
- 失败、超时或旧请求晚归时，不修改已有 `aestheticFeatures`。

### updateClothes

- 不允许客户端写 `aestheticFeatures`。
- 普通编辑不得清空 `aestheticFeatures`。
- 当前阶段不做高级属性失效标记。

### getWardrobe

- 显式返回 normalized `aestheticFeatures`。
- 前端暂不展示、不编辑。
- 老衣服可以没有该字段。

### outfit snapshot

- 阶段 1 不修改 snapshot。
- 阶段 2 引入组合审美 evidence 时再处理。

## 旧衣服兼容策略

- 不全量 backfill。
- 新上传自动识别。
- 用户主动重新识别时补齐。
- 缺字段衣服不应天然低分。
- 阶段 2 对缺失维度降低该维度权重。
- 无字段时使用中性降级，而不是低分惩罚。
- 重新识别优先级后续可考虑收藏、穿过、推荐高频和最近上传衣服。
- 当前阶段不创建后台批量重识别任务。

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
已完成
```

内容：

- 建立本设计文档。
- 锁定产品原则。
- 锁定阶段边界。
- 设计文档 commit：`e3a9d82`。

### 阶段 1：服装审美特征 V2

状态：

```text
已完成
```

内容：

- 阶段 1 第一步“识别与写入边界审计”：已完成。
- 阶段 1 第二步“类型与 normalize 基础能力”：已完成。
- 阶段 1 第三步“新上传识别与草稿接入”：已完成。
- 阶段 1 第四步“正式衣服入库与返回链路”：已完成。
- 阶段 1 第五步“已有衣服重新识别高级审美属性”：已完成。
- 阶段 1 第六步“完整代码审计与闭环验证”：已完成。
- 阶段 1 最终闭环审计：通过。
- 完成日期：2026-06-26。
- 自动检查结论：P0 0；P1 0；P2 阻断项 0；typecheck 通过；lint 0 errors，68 existing warnings；相关 JS `node --check` 全部通过；helper 一致性 probe 通过；审计时工作区干净。
- 人工测试：待部署后执行。
- 确认字段枚举。
- 建立四份云函数本地 normalize helper。
- 修改识别 prompt。
- 新上传衣物写入 `aestheticFeatures`：已接入草稿、正式衣服入库和衣橱返回。
- 已有衣服重新识别写入 `aestheticFeatures`。
- 扩展 `colorPalette` 的 `role` / `ratio`。
- `getWardrobe` 和类型兼容。
- 旧衣服无字段时降级。
- 不开放用户编辑。
- 不全量 backfill。

已完成的新上传链路：

```text
processUploadImage
→ 属性识别 Prompt
→ AestheticFeaturesV1 normalize
→ clothes_drafts
→ confirmClothesDrafts
→ clothes
→ getWardrobe
```

已完成的已有衣服重新识别链路：

```text
recognizeClothAttributes
→ Prompt
→ normalize
→ effectiveCategory/effectiveSubcategory
→ confidence 字段级 merge
→ recognitionAttemptToken / transaction CAS
→ clothes
```

编辑保护：

- 客户端不能写 `aestheticFeatures`。
- 普通编辑不会清空该字段。
- 高级字段不进入 `manualFields`。
- 用户手动颜色受 `colorPalette` / `colors` / `color` alias group 保护。
- 高级属性暂不展示、不编辑。

#### 阶段 1 预计修改范围

必须修改候选：

- `packages/types/src/clothes.ts`
- `apps/miniapp/cloudfunctions/processUploadImage/services/wardrobeAssetPipeline.js`
- `apps/miniapp/cloudfunctions/recognizeClothAttributes/index.js`
- `apps/miniapp/cloudfunctions/confirmClothesDrafts/index.js`
- `apps/miniapp/cloudfunctions/getWardrobe/index.js`
- `apps/miniapp/cloudfunctions/updateClothes/index.js`
- `docs/personalized-aesthetic-recommendation-v2.md`

可能修改：

- `apps/miniapp/src/lib/cloud.ts`
- 与 `ColorInfo` 类型引用有关的文件

阶段 1 不修改：

- `generateOutfit`
- outfit snapshot
- 行为事件
- `learnedStyleProfile`
- 小搭点评
- 高级属性 UI
- Web / BFF
- 全量 backfill

#### 阶段 1 验收标准

- 新上传普通属性不退化。
- 新上传写入 `AestheticFeaturesV1`。
- 已有衣服重新识别可补齐高级字段。
- 枚举外值不入库。
- 高级识别失败不阻断入库。
- 老衣服仍可正常展示。
- 普通编辑不清空高级字段。
- UI 不展示高级字段。
- 旧 `colorPalette` 兼容。
- `recognitionAttemptToken` 仍有效。
- 高级字段不进入 `manualFields`。

#### 阶段 1 人工验收矩阵

- 纯色基础 T
- 宽松印花 T
- 短款修身上衣
- 阔腿裤
- 喇叭裤
- A 字裙
- 碎花连衣裙
- 西装外套
- 羽绒服
- 运动鞋
- 高跟鞋
- 复杂设计单品
- 模糊或遮挡图片

### 阶段 2：组合级审美引擎

内容：

- `AestheticCompatibility`
- 风格语法
- 调整天气 / 场景权重结构
- `aestheticScores`
- `aestheticEvidence`
- outfit snapshot 保存 evidence
- 旧衣物降级评分

#### 阶段 2 第一任务：组合级审美兼容引擎基础

- 状态：已完成，阶段 2 整体仍进行中。
- 引擎版本：`aesthetic-compat-v1`。
- 接入方式：影子模式，只在 `generateOutfit` 返回的推荐 outfit 上附加可选 `aestheticEvaluation`。
- 修改文件：
  - `apps/miniapp/cloudfunctions/generateOutfit/services/aestheticCompatibility.js`
  - `apps/miniapp/cloudfunctions/generateOutfit/services/aestheticCompatibility.test.js`
  - `apps/miniapp/cloudfunctions/generateOutfit/index.js`
  - `packages/types/src/outfit.ts`
  - `docs/personalized-aesthetic-recommendation-v2.md`
- 新增集合：无。
- 新增索引：无。
- 新增环境变量：无。
- 新增依赖：无。
- AI 调用：无。

评价结果结构：

```ts
type AestheticDimensionKey =
  | 'silhouetteBalance'
  | 'proportionBalance'
  | 'colorHarmony'
  | 'patternBalance'
  | 'formalityConsistency'
  | 'detailBalance';

type AestheticEvidencePolarity =
  | 'positive'
  | 'negative'
  | 'neutral';

interface AestheticEvidenceV1 {
  code: string;
  polarity: AestheticEvidencePolarity;
  strength: 1 | 2 | 3;
  itemIds: string[];
  data?: Record<string, string | number | boolean | null>;
}

interface AestheticDimensionEvaluationV1 {
  score: number | null;
  coverage: number;
  evidenceCodes: string[];
}

interface AestheticCompatibilityEvaluationV1 {
  version: 1;
  engineVersion: 'aesthetic-compat-v1';
  score: number | null;
  coverage: number;
  dimensions: Record<AestheticDimensionKey, AestheticDimensionEvaluationV1>;
  evidence: AestheticEvidenceV1[];
}
```

六个维度与权重：

| 维度 | 权重 | 当前规则 |
| --- | ---: | --- |
| `silhouetteBalance` | 25 | 上下装体量平衡、连衣裙独立轮廓、极端体量轻度负向 |
| `proportionBalance` | 15 | 短上衣 + 长下装层次、常规长度中性、极端长款叠加轻度负向 |
| `colorHarmony` | 25 | primary/首色、合法 hex、少量中性色名、单色/邻近色/中性色+强调色/可控对比/多主导色竞争 |
| `patternBalance` | 15 | 单图案焦点、同类图案呼应、多个明显强图案竞争 |
| `formalityConsistency` | 10 | 正式度差值 0-1 一致、2 可解释混搭、3-4 轻度负向 |
| `detailBalance` | 10 | 单一设计焦点、少量分布呼应、多件强设计与明显图案竞争 |

coverage 与总分：

- 仅 `score !== null` 的维度参与加权。
- `coverage = 有效维度原始权重之和 / 100`。
- 有效维度按当前有效权重重新归一化。
- `coverage < 0.25` 时总 `score` 返回 `null`。
- 维度分和总分均 clamp 到 `0..100`，总分四舍五入为整数。
- 缺失字段、`unknown`、`null`、空数组、非法 hex、非法 ratio、非法 category、非法 confidence、非法 formality、unsupported `aestheticFeatures.version` 均安全忽略，不扣分。
- `low` confidence 的高级字段不参与负向判断；当前实现中也不参与正向证据。
- 不推断用户身材、年龄、性别、身份、价格、品牌或社会价值。

结构化 evidence codes：

```text
SILHOUETTE_BALANCED_CONTRAST
SILHOUETTE_BALANCED_CONTINUITY
SILHOUETTE_EXTREME_VOLUME_STACK
PROPORTION_CLEAR_LAYERING
PROPORTION_BALANCED_LENGTH
PROPORTION_EXTREME_LENGTH_STACK
COLOR_MONOCHROMATIC
COLOR_ANALOGOUS
COLOR_NEUTRAL_ACCENT
COLOR_CONTROLLED_CONTRAST
COLOR_TOO_MANY_DOMINANT_HUES
PATTERN_SINGLE_FOCUS
PATTERN_COHERENT_REPEAT
PATTERN_COMPETING_FOCUS
FORMALITY_ALIGNED
FORMALITY_INTENTIONAL_MIX
FORMALITY_LARGE_GAP
DETAIL_SINGLE_FOCUS
DETAIL_BALANCED_DISTRIBUTION
DETAIL_COMPETING_FOCUS
```

影子模式边界：

- 不参与候选过滤。
- 不参与排序。
- 不写入 `scores.total`。
- 不覆盖 `styleUnity`、`preference` 等旧分数。
- 不改变 `excludedOutfitKeys`、`outfitKey`、`recommendationBatchId`。
- 不写 `snapshotItems`。
- 不写 `outfits`、`favorite_outfits`、`outfit_history`。
- `buildOutfitSaveData` 是显式持久化 mapper，当前未包含 `aestheticEvaluation`，因此不会因对象整体 spread 意外入库。
- 老衣服缺少 `aestheticFeatures` 时返回 `score: null` / `coverage: 0`，不会天然低分。

自动测试覆盖：

- 使用 Node 内置 `node:test`。
- 新增 30 个测试，覆盖空数组、旧衣服缺字段、轮廓、比例、图案、正式度、细节、颜色、unsupported version、item 顺序不变、输入不 mutate、分数范围、coverage 范围、evidence code 去重、itemIds 稳定排序、影子接入不改变 `scores.total` / `outfitKey` / `rankingScore`。

后续部署影响：

- 需要后续部署 `generateOutfit` 云函数后才会在真实小程序返回中出现 `aestheticEvaluation`。
- 阶段 1 的 `processUploadImage`、`confirmClothesDrafts`、`getWardrobe`、`updateClothes`、`recognizeClothAttributes` 仍待部署和 smoke test。
- 当前不需要数据库迁移、集合、索引、环境变量或包依赖变更。
- 下一任务暂记为：真实 shadow 样本采集方案与排名融合接入前审计；不要在未审计前把 `aestheticEvaluation.score` 接入正式排序。

#### 阶段 2 第二任务：影子评分分布离线校准与融合方案

- 状态：已完成，阶段 2 整体仍进行中。
- 校准报告：`docs/aesthetic-compatibility-calibration-v1.md`。
- fixture 版本：`aesthetic-compat-fixtures-v1`。
- fixture 总数：60。
- fixture 分组：positive 18、neutral 14、conflict 14、sparse 10、boundary 4。
- 校准工具：`apps/miniapp/cloudfunctions/generateOutfit/services/aestheticCompatibility.calibration.js`。
- 运行方式：
  - `node apps/miniapp/cloudfunctions/generateOutfit/services/aestheticCompatibility.calibration.js`
  - `node apps/miniapp/cloudfunctions/generateOutfit/services/aestheticCompatibility.calibration.js --json`
  - `node apps/miniapp/cloudfunctions/generateOutfit/services/aestheticCompatibility.calibration.js --markdown`
- 新增测试：`apps/miniapp/cloudfunctions/generateOutfit/services/aestheticCompatibility.calibration.test.js`。
- 本轮生产引擎调整：无。
- 不调整原因：60 个离线样本已满足宽区间校准门槛；未发现分布倒挂、越界、未知 evidence、重复 evidence、itemIds 未排序、顺序敏感或输入 mutate。

分布核心数据：

| 指标 | 数值 |
| --- | ---: |
| 样本总数 | 60 |
| score non-null | 52 |
| score null | 8 |
| score min / max | 62 / 86 |
| score mean | 73.46 |
| score median | 72 |
| coverage min / max | 0 / 1 |
| coverage mean | 0.8 |
| coverage median | 1 |

分组结果：

| 分组 | 数量 | score median | score range | coverage median |
| --- | ---: | ---: | --- | ---: |
| positive | 18 | 82 | 79-84 | 1 |
| neutral | 14 | 70 | 70-75 | 0.9 |
| conflict | 14 | 62 | 62-62 | 1 |
| sparse | 10 | 78 | 74-86 | 0 |
| boundary | 4 | 82 | 82-82 | 0.63 |

校准结论：

- positive median 高于 neutral median。
- neutral median 高于 conflict median。
- positive 与 conflict median 差值为 20，满足至少 12 分要求。
- positive median 为 82，不低于 78。
- conflict median 为 62，不高于 68。
- neutral median 为 70，位于建议区间。
- sparse 样本不会因缺字段被判低分；缺少有效覆盖时返回 `score: null`。
- coverage `<0.25` 时总分保持 `null`。
- 未出现 0 分或 100 分。
- 未发现大量单一分值饱和。
- low confidence 不产生负向证据。
- unsupported version 不产生有效高级证据。
- item 顺序变化结果完全一致。
- 输入对象未被修改。

六维覆盖与证据：

- 维度非空数：silhouetteBalance 49、proportionBalance 48、colorHarmony 50、patternBalance 50、formalityConsistency 48、detailBalance 39。
- 高频 evidence：`DETAIL_SINGLE_FOCUS` 22、`FORMALITY_ALIGNED` 21、`PROPORTION_CLEAR_LAYERING` 19、`SILHOUETTE_BALANCED_CONTRAST` 19、`COLOR_NEUTRAL_ACCENT` 18。
- 负向 evidence 各 14 次，主要来自 conflict 分层样本。
- 未知 evidence code：无。
- evidence code 重复：无。
- itemIds 未排序：无。

正式排名融合方案锁定为后续方案，不在本轮启用：

```text
enabled = aestheticEvaluation.score != null && coverage >= 0.50
centeredScore = clamp((score - 70) / 25, -1, 1)
reliability = clamp((coverage - 0.50) / 0.30, 0, 1)
aestheticDelta = centeredScore * reliability * 6
futureRankingScore = existingTotal + aestheticDelta
```

融合边界：

- coverage `<0.50` 时审美信号为 0。
- `aestheticDelta` 范围为 `-6..+6`。
- 不写回 `scores.total`。
- 不改变 hard constraints、候选资格、去重、`excludedOutfitKeys`、`outfitKey` 或 `recommendationBatchId`。
- 当原 `total` 相差超过 12 分时，审美增量不得逆转明显基础适配差距。
- 正式启用前必须完成真实 shadow 样本、阶段 1 云函数部署 smoke test、手动颜色保护检查和接口性能观察。

本轮仍不需要部署，不需要数据库迁移，不需要新集合、索引、环境变量或第三方依赖。

阶段 2 下一任务：

- 真实 shadow 样本采集方案与排名融合接入前审计。
- 暂不直接启用正式排名。

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

### 阶段进度

| 阶段 | 状态 |
| --- | --- |
| 阶段 0 | 已完成 |
| 阶段 1 | 已完成，待部署和人工 smoke test |
| 阶段 2 | 第一、第二任务已完成，整体进行中 |
| 阶段 3 | 未开始 |
| 阶段 4 | 未开始 |
| 阶段 5 | 未开始 |
| 阶段 6 | 未开始 |
| 阶段 7 | 未开始 |

阶段 1 代码完成不等于已经完成云端部署和人工验收。

## 阶段实施记录

### 阶段 0：设计和现状基线

- 状态：已完成
- 开始日期：2026-06-25
- 完成日期：2026-06-25
- commit：`e3a9d82`
- 修改文件：`docs/personalized-aesthetic-recommendation-v2.md`
- 新增字段：无
- 新增集合：无
- 新增索引：无
- 环境变量：无
- 部署云函数：无
- 数据迁移：无
- 自动检查：`git status --short`、`git branch --show-current`、`git log --oneline -5`、`git diff --stat`
- 人工测试：不适用，阶段 0 只建立设计文档
- 已知问题：无
- 后续事项：进入阶段 1 实施

### 阶段 1：服装审美特征 V2

- 状态：已完成
- 开始日期：2026-06-25
- 完成日期：2026-06-26
- commit：
  - `e3a9d82 docs: add personalized aesthetic recommendation v2`：V2 设计基线文档。
  - `9f8a0c6 docs: define aesthetic feature v1 schema`：V1 schema 定稿文档。
  - `0e0ece5 feat: add aesthetic feature v1 foundations`：类型、枚举和 normalize 基础能力。
  - `10d962e feat: recognize aesthetic features for upload drafts`：新上传 Prompt 与草稿接入。
  - `7f607b5 feat: persist aesthetic features to clothes`：正式 clothes 入库、返回和编辑保护。
  - `927cb15 feat: recognize aesthetic features for clothes`：已有衣服重新识别接入。
  - `3140fc3 fix: preserve draft color palette details`：colorPalette 确认入库修复。
- 审计状态：阶段 1 第一步“识别与写入边界审计”已完成；阶段 1 第二步“类型与 normalize 基础能力”已完成；阶段 1 第三步“新上传识别与草稿接入”已完成；阶段 1 第四步“正式衣服入库与返回链路”已完成；阶段 1 第五步“已有衣服重新识别高级审美属性”已完成；阶段 1 第六步“完整代码审计与闭环验证”已完成；阶段 1 最终闭环审计通过
- 业务文件修改：上传识别链路已接入本地 helper、Prompt、parser 与草稿 mapper；正式衣服确认入库、衣橱返回、普通编辑保护和已有衣服重新识别已接入
- 数据库修改：无
- 部署：待部署
- 修改文件：`packages/types/src/clothes.ts`、`apps/miniapp/cloudfunctions/processUploadImage/services/aestheticFeatures.js`、`apps/miniapp/cloudfunctions/processUploadImage/services/wardrobeAssetPipeline.js`、`apps/miniapp/cloudfunctions/confirmClothesDrafts/index.js`、`apps/miniapp/cloudfunctions/confirmClothesDrafts/aestheticFeatures.js`、`apps/miniapp/cloudfunctions/getWardrobe/index.js`、`apps/miniapp/cloudfunctions/getWardrobe/aestheticFeatures.js`、`apps/miniapp/cloudfunctions/updateClothes/index.js`、`apps/miniapp/cloudfunctions/recognizeClothAttributes/index.js`、`apps/miniapp/cloudfunctions/recognizeClothAttributes/aestheticFeatures.js`、`docs/personalized-aesthetic-recommendation-v2.md`
- 新增字段：`Clothing.aestheticFeatures?: AestheticFeaturesV1`、`ClothesDraft.aestheticFeatures?: AestheticFeaturesV1`；`ColorInfo.role?: 'primary' | 'secondary' | 'accent'`
- 新增集合：无
- 新增索引：无
- 环境变量：无
- package.json 依赖：未增加
- 部署云函数：`processUploadImage`、`confirmClothesDrafts`、`getWardrobe`、`updateClothes`、`recognizeClothAttributes`
- 数据迁移：无
- schema / prompt version：`version: 1`，`promptVersion: 'aesthetic-v1'`
- TypeScript 类型：新增 `AestheticConfidenceLevel`、`ClothingFit`、`ClothingLength`、`ClothingSilhouette`、`ClothingPatternType`、`ClothingDesignElement`、`AestheticFeatureConfidence`、`AestheticFeaturesV1`
- helper 放置：上传识别、草稿确认入库、衣橱返回与已有衣服重识别各使用本地 `aestheticFeatures.js`，未建立跨云函数共享目录，未从 `packages/types` 运行时 require
- normalize 规则：枚举白名单外降级；`confidence` 只接受 `high` / `medium` / `low`；字段 confidence 为 `low` 时写 `unknown` / `null` / `[]`；`formalityLevel` 只接受有限数字、四舍五入并 clamp 到 1-5；`silhouette` 按当前真实 `category/subcategory` 二次校验
- colorPalette normalize：最多 3 色；`name` 必须非空；`hex` 只保留合法 6 位并统一 `#RRGGBB`；`ratio` clamp 到 0-1；`role` 只接受 `primary` / `secondary` / `accent`；最多一个 primary，缺失时可把第一项设为 primary；仅当全部颜色都有有效 ratio 且总和大于 0 时归一化
- 上传 Prompt：已在 `processUploadImage` 的属性识别 Prompt 增加 V1 高级字段，模型只输出 `fit`、`length`、`silhouette`、`patternType`、`designElements`、`formalityLevel` 与逐字段 `confidence`；`version`、`promptVersion`、`provider`、`model`、`recognizedAt` 由代码写入
- colorPalette Prompt：沿用 `name/hex/ratio`，增加 `role`；要求最多 3 色、`ratio` 为 0-1、`role` 为 `primary` / `secondary` / `accent`、最多一个 primary，不新增 `proportion` / `primaryColor` / `secondaryColors` / `colorTemperature` / `colorValue` / `colorChroma`
- parser 接入：`wardrobeAssetPipeline` 在普通属性解析后使用本地 `normalizeAestheticFeaturesV1` 和 `normalizeColorPaletteV1`，高级字段缺失或非法时降级为默认 V1 对象，不阻断普通属性
- 草稿写入：`toDraftData` 显式保存完整 normalized `aestheticFeatures`，包括 `version`、`promptVersion`、`confidence`、`provider`、`model`、`recognizedAt`；同时保存 normalized `colorPalette`
- 新上传链路边界：已接入 `clothes_drafts.aestheticFeatures`、`confirmClothesDrafts` 正式入库和 `getWardrobe` 返回；尚未修改 UI / recommendation
- 正式衣服入库：`confirmClothesDrafts` 从 draft 显式读取 `aestheticFeatures`，使用本地 `normalizeAestheticFeaturesV1` 按 `category/subcategory` normalize；草稿字段缺失或损坏时写入默认 V1，不阻断确认入库；不重新调用 AI，不展开到 clothes 顶层，不加入 `manualFields`
- 阶段 1 第六步审计发现 P1：`confirmClothesDrafts` 曾在正式入库时忽略 `draft.colorPalette`，转而按 `draft.colors` 生成带 `#8A8A8A` 和伪比例的 palette，导致上传识别得到的 `hex`、`ratio`、`role` 丢失
- P1 修复方式：正式入库优先使用 `normalizeColorPaletteV1(draft.colorPalette)` 的非空结果；仅在 `draft.colorPalette` 缺失、不是数组或 normalize 后无合法颜色时，才用 `draft.colors` 的真实颜色名回退；fallback 不再生成假灰色、猜测 hex、平均 ratio 或伪精确比例；`colors` mirror 由最终 normalized `colorPalette.name` 生成
- 衣橱返回：`getWardrobe` 仅在正式衣服已有 `version: 1` 的 `aestheticFeatures` 时返回 normalized object；旧衣服无字段或不支持版本时省略该字段，不伪造已识别数据；分页、筛选、图片字段和 alias normalize 不变
- 普通编辑保护：`updateClothes` 在白名单处理前丢弃客户端传入的 `aestheticFeatures` 与 `aestheticFeatures.*` 字段；普通字段编辑保持局部 update，不清空数据库已有高级字段，不把高级字段加入 `manualFields`
- 类型消费端适配：`clothing-detail` 展示场景对缺失 `name/hex` 使用“未知颜色”文案兜底；`clothing-form` 表单初始化过滤 `name/hex` 均缺失的无效颜色项；继续保留 `ColorInfo.hex?` / `ratio?`
- 字段级 merge：先 normalize existing 和 incoming；普通字段按 `low < medium < high` 合并，incoming high 覆盖，incoming medium 可覆盖 existing low / unknown / null 或 existing medium，incoming low / unknown / null 不覆盖有效旧值；`designElements` 作为整体字段合并；只有采用 incoming 字段时 metadata 使用 incoming/meta
- 已有衣服重新识别 Prompt：`recognizeClothAttributes` 已在普通属性 JSON 中加入同一套 `aestheticFeatures` V1 schema；模型只输出 `fit`、`length`、`silhouette`、`patternType`、`designElements`、`formalityLevel` 与逐字段 `confidence`；明确不输出 `version`、`promptVersion`、`provider`、`model`、`recognizedAt`；安全边界要求只分析衣服本身，不推断身材、体型、年龄、身份或敏感属性
- 已有衣服重新识别 colorPalette：Prompt 沿用 `name/hex/ratio` 并增加 `role`；要求最多 3 色、`ratio` 为 0-1、`role` 为 `primary` / `secondary` / `accent`、最多一个 primary，不新增 `proportion` 或平行颜色字段；parser 统一使用 `normalizeColorPaletteV1`，不再为不确定颜色补假灰色或假比例
- 已有衣服重新识别 effective category：成功写回前仍在 transaction 内重读最新 `clothes`；若最新 `manualFields` 保护 `category/type` 或 `subcategory/subCategory/categoryName`，高级字段 normalize 使用数据库当前值；未保护且本次 AI 普通属性会写入时，使用本次 AI 值；因此 silhouette 按最终实际保留类别校验
- 已有衣服重新识别 merge：若旧衣服无 `aestheticFeatures.version = 1`，写入完整 normalized V1 或默认 V1；若已有 V1，则调用 `mergeAestheticFeaturesV1(existing, incoming, meta)` 按字段 confidence 合并。incoming high 覆盖，incoming medium 可覆盖旧 low / unknown / null 或旧 medium，incoming low / unknown / null 不覆盖旧有效值；`designElements` 作为整体字段按 confidence 替换或保留；只有字段真正采用 incoming 时 metadata 更新为本次 provider/model/recognizedAt/promptVersion
- 已有衣服重新识别 manualFields：高级字段不加入 `manualFields`，也不允许用户编辑；普通字段仍按现有 alias group 保护。若 `colorPalette/colors/color` 被保护，本次 AI 不覆盖 `colorPalette` 和 `colors` mirror，已有颜色完整保留；其他高级审美字段仍可按 merge 规则更新
- 已有衣服重新识别 attempt token/CAS：`recognitionAttemptToken`、`recognitionStartedAt`、`recognitionHeartbeatAt`、deleted 拒绝、stale attempt 接管、superseded、transaction CAS 均保持原链路；`aestheticFeatures` 与普通属性在同一个 token/CAS 保护的最终写回中提交，不在事务外单独更新
- 已有衣服重新识别降级：`raw.aestheticFeatures` 缺失、类型错误、枚举非法、confidence 非法、designElements 非法或 formalityLevel 非法时，普通属性仍继续 normalize 和写回；高级字段只降级为默认 V1 或按旧值安全 merge
- 本轮未改 `generateOutfit`、outfit snapshot、行为事件、learnedStyleProfile、高级属性 UI、Web/BFF、集合、索引或环境变量；不继续组合级推荐算法
- 自动检查：最终代码审计通过；P0 0；P1 0；P2 阻断项 0；审计开始与结束时工作区干净；`cmd /c pnpm --filter @starter-template/miniapp typecheck` 已通过；`cmd /c pnpm --filter @starter-template/miniapp lint` 为 0 errors，68 existing warnings；相关 JS `node --check` 全部通过；`git diff --check` 通过；临时 Node probe 已验证正式入库、返回降级、普通编辑保护、颜色兼容、helper 一致性和已有衣服重新识别 merge / CAS 行为
- 人工测试：待部署后执行
- 已知问题：推荐、snapshot 和行为体系尚未接入高级字段；高级属性 UI 暂不展示、不编辑；`getWardrobe` / `updateClothes` 其他旧字符串颜色兼容路径仍可能存在历史灰色 fallback，该问题不属于本次 draft → clothes 确认入库 P1，本轮不扩大范围处理
- 部署要求：不需要新集合；不需要新索引；不需要新环境变量；`package.json` 未增加依赖；需要重新构建小程序体验版；云函数部署后再做真实 smoke test
- 后续事项：部署阶段 1 的 5 个云函数，并完成真实小程序 smoke test；通过后开始阶段 2 组合级审美引擎

#### 阶段 1 最终字段方案

`AestheticFeaturesV1`：

- `version: 1`
- `promptVersion: aesthetic-v1`
- 字段：`fit`、`length`、`silhouette`、`patternType`、`designElements`、`formalityLevel`、`confidence`、`provider`、`model`、`recognizedAt`

`ColorInfo`：

```ts
interface ColorInfo {
  name: string;
  hex?: string;
  ratio?: number;
  role?: 'primary' | 'secondary' | 'accent';
}
```

颜色规则：

- 沿用 `ratio`。
- 不使用 `proportion`。
- 不新增平行顶层颜色字段。
- 不伪造缺失 `hex`。
- 不伪造 `ratio`。
- 最多一个 `primary`。
- 老颜色数据兼容。

#### 阶段 1 最终闭环审计

1. 四份 `aestheticFeatures.js` SHA-256 一致。
2. 上传与重新识别 Prompt 的高级 schema 一致。
3. TypeScript 类型与 runtime 一致。
4. 新上传颜色的 `name` / `hex` / `ratio` / `role` 从草稿到正式 clothes 完整保留。
5. `confirmClothesDrafts` 优先使用 normalized `draft.colorPalette`。
6. 仅 palette 缺失或非法时回退真实颜色名。
7. 确认入库链路不再生成 `#8A8A8A` 或假比例。
8. 老衣服缺少新字段时正常运行。
9. unsupported version 安全省略。
10. 高级字段失败不阻断普通识别和入库。
11. 重新识别低置信度不覆盖旧有效值。
12. attempt token、CAS、deleted 和 superseded 保护仍有效。
13. 未发现阶段 1 的 P0/P1 阻断项。

说明：`getWardrobe` / `updateClothes` 其他旧字符串颜色兼容路径仍可能存在历史灰色 fallback；该问题不属于本次 draft → clothes 确认入库 P1；本轮不扩大范围处理。

#### 阶段 1 部署清单

- `processUploadImage`
- `confirmClothesDrafts`
- `getWardrobe`
- `updateClothes`
- `recognizeClothAttributes`

部署说明：

- 不需要新集合。
- 不需要新索引。
- 不需要新环境变量。
- `package.json` 未增加依赖。
- 需要重新构建小程序体验版。
- 云函数部署后再做真实 smoke test。

#### 阶段 1 真实 smoke test

阶段 2 开始前建议测试：

1. 上传一张单件衣服图片。
2. 上传一张多件衣服图片。
3. 确认识别草稿能正常展示普通属性。
4. 确认入库成功。
5. 衣橱列表和详情正常读取。
6. 数据库中正式 clothes 保留：
   - `aestheticFeatures`
   - `colorPalette.name`
   - `colorPalette.hex`
   - `colorPalette.ratio`
   - `colorPalette.role`
7. 手动编辑颜色后保存。
8. 再执行属性重新识别。
9. 确认用户颜色未被覆盖。
10. 确认其他高级属性可按 confidence 更新。
11. 模糊或遮挡图片不阻断入库。
12. 老衣服无 `aestheticFeatures` 仍正常展示。

验收样本继续保留：

- 纯色基础 T
- 宽松印花 T
- 短款修身上衣
- 阔腿裤
- 喇叭裤
- A 字裙
- 碎花连衣裙
- 西装外套
- 羽绒服
- 运动鞋
- 高跟鞋
- 复杂设计单品
- 模糊或遮挡图片

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
11. 上传识别和已有衣服重识别的 Prompt / schema 漂移。
12. `clothes_drafts`、`confirmClothesDrafts`、`getWardrobe` 等手工 mapper 漏接新字段导致丢失。
13. `ratio` 与旧设计中的 `proportion` 命名混用造成数据不一致。

## 阶段 1 收口文档更新检查要求

阶段 1 已完成代码与最终闭环审计。本轮只更新本文档，不修改业务代码、不运行云函数、不提交 commit、不部署。

历史代码检查已在阶段 1 最终闭环审计中完成：

```bash
cmd /c pnpm --filter @starter-template/miniapp typecheck
cmd /c pnpm --filter @starter-template/miniapp lint
node --check apps/miniapp/cloudfunctions/processUploadImage/index.js
node --check apps/miniapp/cloudfunctions/processUploadImage/services/wardrobeAssetPipeline.js
node --check apps/miniapp/cloudfunctions/processUploadImage/services/aestheticFeatures.js
node --check apps/miniapp/cloudfunctions/confirmClothesDrafts/index.js
node --check apps/miniapp/cloudfunctions/confirmClothesDrafts/aestheticFeatures.js
node --check apps/miniapp/cloudfunctions/getWardrobe/index.js
node --check apps/miniapp/cloudfunctions/getWardrobe/aestheticFeatures.js
node --check apps/miniapp/cloudfunctions/updateClothes/index.js
node --check apps/miniapp/cloudfunctions/recognizeClothAttributes/index.js
node --check apps/miniapp/cloudfunctions/recognizeClothAttributes/aestheticFeatures.js
git diff --check
git status --short
git diff --stat
```

本文档收口后只需执行：

```bash
git status --short
git diff --stat
git diff -- docs/personalized-aesthetic-recommendation-v2.md
```

## 阶段 2 第三任务：真实 Shadow 样本采集与排名融合预演

- 状态：已完成代码、测试、文档与本地验证准备；阶段 2 整体仍进行中。
- 本轮新增 `aestheticRankingPreview.js`，实现正式融合公式的纯函数预演，不修改 `scores.total`。
- 审美增量公式：`centeredScore = clamp((score - 70) / 25, -1, 1)`；`reliability = clamp((coverage - 0.50) / 0.30, 0, 1)`；`aestheticDelta = centeredScore * reliability * 6`，并 clamp 到 `-6..+6`。
- `rankingScore = existingTotal + aestheticDelta` 只用于 shadow 预演。
- 12 分保护：排序比较时如果两个候选原 `scores.total` 差值 `> 12`，仍以原 total 较高者优先；只有差值 `<= 12` 才比较 shadow `rankingScore`；仍相同时回退原顺序。
- 本轮新增结构化脱敏日志，固定前缀 `[AESTHETIC_SHADOW_V1]`，包含 schema/engine/fusion version、sampleId、scene、候选数量、分数统计、排名变化和最多 8 个脱敏候选。
- 环境变量：`AESTHETIC_SHADOW_LOG_SAMPLE_RATE`，可选，默认 `0` 完全关闭；非法值按 `0`；`1` 仅用于短期人工 smoke test；`0.05` 可用于短期小流量观察。
- 日志不写数据库，不进入返回结构，不进入持久化 mapper，不改变生产排序、不改变候选过滤、不改变 hard constraints。
- 本轮新增 JSONL 分析 CLI：`node apps/miniapp/cloudfunctions/generateOutfit/services/aestheticShadowReport.js <日志文件> [--json|--markdown]`。
- CLI 支持纯 JSON、带前缀日志行和混杂云日志文本；非法行跳过并计数。
- 敏感字段防护覆盖 `_openid`、`openid`、`clothingIds`、`itemIds`、`outfitKey`、`imageUrl`、`fileID`、`city`、`latitude`、`longitude`、`userTitle`、`nickname`、`avatar`、`prompt`、`rawResult`、`avoidTags`。
- 下周真实采样流程见 `docs/aesthetic-shadow-sampling-v1.md`。
- 本轮新增 38 项 shadow 单元测试，并继续运行既有审美兼容与校准测试；最终检查结果以本任务提交前验证记录为准。
- 本轮需要部署包含 shadow telemetry 的 `generateOutfit` 后才能开始收集真实数据；当前没有真实 shadow 样本，不能写成已完成真实分布审计。
- 阶段 2 下一任务：下周收集真实 shadow 数据并完成正式融合决策；在此之前不启用 `rankingScore`，不实现个人偏好学习。
