# Scene Evidence V4 产品合同

## 1. 冻结边界

Scene Evidence V4 是 `generateOutfit` 的四场景基础判断合同，版本为 `scene-evidence-v4`。推荐链固定为：

```text
Composition Validity
→ Wearability
→ Scene Hard Conflict
→ Scene Evidence
→ Scene Fit Score
→ Overall Ranking
→ Explanation
```

三个产品问题必须独立：

- `CAN_ENTER_SCENE`：只由组合合法性、穿着安全性和场景硬冲突决定。
- `HOW_GOOD_FOR_SCENE`：只消费 Scene Evidence V4，输出 `sceneFitScore`。
- `WHY_RECOMMENDED`：从已命中的证据中选择可表达理由；理由缺失或变化不得改变准入与分数。

`UNMAPPED_ELIGIBILITY_PATH` 不再是正常候选淘汰条件。reason code、Voice Bank、展示标题和 presentation metadata 都不是场景准入输入。

## 2. 单一 Evidence Registry

所有场景判断统一注册在 `sceneEvidenceRegistryV4.js`。每条证据包含：`id`、`scene`、`evidenceFamily`、`requiredFacts`、`authorization`、`severity`、`explanationValue`、`rankingContribution`、`hardConflict`、`version`。

severity 只允许：

- `HARD_CONFLICT`
- `STRONG_POSITIVE`
- `MEDIUM_POSITIVE`
- `WEAK_POSITIVE`
- `NEGATIVE_SIGNAL`

同一 semantic family 只保留绝对贡献最大的命中，并受 `FAMILY_CAPS` 约束；同色、颜色协调、基础色呼应等同族证据不能重复叠分。`sceneFitScore` 使用现有推荐合同可兼容的 0–10 标尺：以 5 为中性基线，按 family cap 汇总贡献后截断到 0–10。最终总分明确消费该分数，天气惩罚仍独立保留。

## 3. 四场景定义与矩阵

### Home：普通居家与短距离临时外出

| 类型 | 规则 |
| --- | --- |
| Hard | 正式西装核心、商务/礼服/高跟鞋、正式礼服、Lolita、Cosplay、舞台服、专业训练及特殊用途核心 |
| Strong | 可靠宽松、休闲或简洁核心组合 |
| Medium | 简单 onepiece；普通上衣与下装组合；温度与袖长/裤长形成可靠支持 |
| Weak | 短袖/无袖与短裤；普通颜色协调 |
| Optional | 默认抑制帽子、太阳镜、正式包、宴会包和无必要造型配饰，只移除 optional item |

Home 不是睡衣专属，也不是“什么都能穿”。普通运动鞋只支持临时外出，不是室内必需。合法 onepiece 不依赖文案映射即可准入。

### Work：普通日常通勤与常规办公室

| 类型 | 规则 |
| --- | --- |
| Hard | 睡衣/家居服、家居拖鞋、Cosplay、舞台服、泳装、专业训练、明确特殊用途核心 |
| Strong | 衬衫/结构上衣/合适针织 + 长裤 + 外出鞋；简洁 onepiece + 外出鞋 |
| Medium | 普通上衣/Polo + 长裤 + 外出鞋；完整核心中的 clean sneaker 支持 |
| Weak | 完整的普通核心组合；`WORK_BASELINE_PRESENTABLE` 只表达完整度 |
| Negative | T恤或卫衣 + 短裤；过强运动结构；普通单品的明确 home 场景信号；复杂/高装饰风格（含未作为硬冲突处理的 Lolita） |
| Optional | 抑制明确 home-only 配饰 |

T恤、短裤、卫衣和普通运动鞋不会仅因品类被 hard reject。过于随意是降序信号，不是准入否决。

### Date：普通约会、吃饭、逛街、电影与日常见面

| 类型 | 规则 |
| --- | --- |
| Hard | 睡衣/家居服、家居拖鞋、Cosplay、舞台服、泳装、专业训练与特殊用途核心 |
| Strong | 图案主体 + 简洁支持；亮色主体 + 中性支持；可靠 simple style unity；匹配用户偏好的 Lolita |
| Medium | onepiece + 外出鞋；具有简洁搭配意图的完整组合 |
| Weak | canonical color coordination；`DATE_COLOR_COORDINATED` 永久为弱证据 |
| Negative | 未匹配偏好的 Lolita（较强降序）；home 信号；运动主导；正式主体与运动配角冲突；没有搭配意图的 T恤短裤 |
| Optional | 抑制专业训练和特殊用途配饰 |

Date 判断“搭配意图”，不强制正式，也不生成“性感、高级、气质”等未经授权承诺。普通 onepiece + 合适鞋不依赖 catalog reason 才能准入。

### Sport：日常轻运动

| 类型 | 规则 |
| --- | --- |
| Hard | 商务/礼服皮鞋、高跟、拖鞋、家居鞋；西装核心、正式礼服、Lolita、Cosplay、舞台服及特殊用途核心 |
| Strong | 明确 sport top + sport bottom + sport shoe；sport onepiece + sport shoe；天气与运动层次匹配 |
| Medium | 普通 T恤/卫衣/运动上衣 + 活动下装 + 运动鞋 |
| Weak | 简单活动结构 + 普通闭合鞋 |
| Negative | 牛仔、厚重层次、普通非运动裙装、非运动外套、过正式上衣、复杂造型 |
| Optional | 抑制无必要造型配饰和正式包；只影响 optional item |

Sport 冻结为散步、快走、普通轻活动和轻度户外活动，不承诺跑步、健身房、瑜伽、球类或徒步专项能力。普通 T恤不会被派生为 `sport_top`；它只可参与日常轻运动的中/弱证据。

## 4. 事实标准化合同

- category/subcategory：先映射到受控 canonical category，再基于可靠 subtype 设置事实。
- color：读取结构化 `colorPalette`，映射 canonical color family；复合色使用明确 token 顺序，`灰蓝` 归 blue、`浅绿` 归 green，禁止模糊 contains 误判为 gray。
- pattern：仅从受控 pattern 字段与明确 style tag 映射生成，保留原始字段、canonical fact 和 mapping rule provenance。
- sport：普通 T恤与明确 sport-tagged/受控运动 subtype 分离；只有可靠字段产生 explicit sport apparel。
- special style：formal、homewear、sleepwear、lolita、cosplay、performance、sport、casual、special-purpose 仅由受控 category/subcategory/styleTags/sceneTags 产生；缺字段不是负面事实。

不新增无法追溯来源的 AI 推断字段。

## 5. Core 与 Optional 政策

当前 Candidate Pool V2 继续只生成既有核心组合，不创建 `top × bottom × shoe × bag × accessory × outerwear` 笛卡尔积。V4 已提供独立 optional policy registry，未来组合器接入 optional item 时必须先调用同一策略：

- core hard conflict：拒绝整个候选。
- optional conflict：只 suppress 对应 optional item，保留合理 core outfit。
- outerwear、bag、hat、sunglasses、accessory 的 fixture 已覆盖分类与 suppress/keep 边界；正式 outerwear 与普通 outerwear 分开处理。

## 6. Fixture 与架构不变量

Synthetic catalog 使用生产 schema 形状覆盖 43 个服装/鞋/特殊款/optional/颜色图案类别族。每条 hard、positive、negative registry branch 均有命中与不命中样本。

测试永久锁定：

1. explanation 缺失不改变 eligibility。
2. presentation/copy 修改不改变 `sceneFitScore`。
3. sparse attribute 不自动 hard reject。
4. weak evidence 不升级为 hard admission。
5. negative signal 只降序。
6. optional conflict 只移除 optional。
7. core hard conflict 必定 reject。
8. semantic family 不重复叠分。
9. scene score 确定且版本化。
10. scene penalty 进入最终 ranking。
11. reason code mapping 不决定 `CAN_ENTER_SCENE`。
12. Candidate Pool V2 候选规模与消费语义不缩减。
13. Wearability hard contract 保持独立且不回退。

## 7. 版本、缓存与 provenance

- `sceneEvidenceVersion`: `scene-evidence-v4`
- `sceneEvidenceFingerprint`: 对 registry 产品字段进行稳定序列化后生成的 SHA-256 前 20 位。
- Candidate Pool engine identity 包含 fingerprint，旧 V3 pool 自动 miss，不使用 `clearStorage`。
- candidate persistence、response meta/debug、copy evidence provenance 和 snapshot relation 均携带可识别的 V4 版本或指纹。
- 修改 registry 产品字段必须产生新 fingerprint；改变冻结边界必须发布新主版本，而不是静默覆盖 V4。

## 8. 新增场景规范

新增 `gym`、`running`、`travel`、`party`、`interview` 等场景时：

1. 新建独立 scene contract，定义范围与不承诺能力。
2. 只在 registry 增加该 scene 的 hard/positive/negative evidence。
3. 为每个 branch 增加正反 fixture，并补 optional policy。
4. 复用 canonical facts、family cap、score、admission 和 explanation 边界。
5. 通过版本/fingerprint 失效依赖缓存。
6. 禁止修改 `CAN_ENTER_SCENE / HOW_GOOD_FOR_SCENE / WHY_RECOMMENDED` 的底层边界来迁就新场景。

## 9. Future Attribute Gap

以下能力若未来需要更精细判断，必须先补可靠、可追溯的结构化属性，再增加 evidence；V4 不从自由文本猜测：

- 鞋底抓地、缓震、稳定、包裹等专项运动能力。
- 面料透气、速干、防水、防晒的可靠商品或护理标签来源。
- 活动强度、时长、路面、室内外及专项运动类型。
- dress code、公司文化、会议级别等通勤上下文。
- 约会主题、场地正式度和用户明确风格意图。
- optional item 的容量、功能、佩戴必要性与天气防护作用。

在这些属性到位前，缺失信息保持 unknown，不转成负面事实，不生成专项能力承诺。
