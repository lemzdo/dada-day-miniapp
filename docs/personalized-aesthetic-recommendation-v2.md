# 搭搭day 个性化审美穿搭推荐 V2

本文档是“搭搭day 个性化审美穿搭推荐 V2”的唯一设计和实施基线。后续每完成一个阶段，都应在本文档中更新已完成内容、实际修改文件、数据库变化、部署要求、测试要求、未完成事项和 commit hash，不再为每个小阶段新建重复文档。

截至 2026-06-25，阶段 0 已完成，阶段 1 进入实施前审计与字段定稿。本轮只更新本文档，不修改业务代码、类型、云函数、数据库或其他文档，不提交，不部署。

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
进行中
```

内容：

- 阶段 1 第一步“识别与写入边界审计”：已完成。
- 本轮未修改业务代码。
- 下一步：实施字段类型、Prompt、解析、草稿与正式衣服写入闭环。
- 确认字段枚举。
- 修改识别 prompt。
- 新上传衣物写入 `aestheticFeatures`。
- 已有衣服重新识别写入 `aestheticFeatures`。
- 扩展 `colorPalette` 的 `role` / `ratio`。
- `getWardrobe` 和类型兼容。
- 旧衣服无字段时降级。
- 不开放用户编辑。
- 不全量 backfill。

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

- 状态：进行中
- 开始日期：2026-06-25
- 完成日期：未完成
- commit：未提交
- 审计状态：阶段 1 第一步“识别与写入边界审计”已完成
- 业务文件修改：无
- 数据库修改：无
- 部署：无
- 修改文件：`docs/personalized-aesthetic-recommendation-v2.md`
- 新增字段：本轮只定稿，未实施
- 新增集合：无
- 新增索引：无
- 环境变量：无
- 部署云函数：无
- 数据迁移：无
- 自动检查：开始前 `git status --short` 干净；完成后需执行 `git status --short` 和 `git diff --stat`
- 人工测试：未执行，本轮只更新文档
- 已知问题：上传识别和重识别存在两套 Prompt / schema；手工 mapper 必须显式接入新字段
- 后续事项：阶段 1 第二步——实现类型、识别 schema 和 normalize 基础能力

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

## 本轮检查要求

本轮只修改本文档，不运行 typecheck / lint，不提交 commit，不继续阶段 1 第二步。

完成后执行：

```bash
git status --short
git diff --stat
```
