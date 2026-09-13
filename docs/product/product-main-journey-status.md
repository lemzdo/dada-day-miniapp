# 搭搭day 产品主链当前状态

> 状态日期：2026-09-13
>
> 适用范围：当前 `main` 中从衣物上传到下一次推荐的产品主链。
>
> 判定口径：只有用户入口、真实数据流、持久化、下游消费和主链可达性都成立，才标记为 `IMPLEMENTED`。

## 1. 当前产品目标

搭搭day 是一个把个人衣橱数字化，并结合天气、场景、明确偏好和长期行为帮助用户完成日常穿搭决策的私人助手。当前核心用户价值是：用户能把真实衣物放入衣橱，获得可执行的搭配，收藏或记录穿着，并在未来逐步得到更符合个人偏好的推荐。

## 2. 当前用户主链

```text
Upload
  → Digitize
  → Confirm
  → Wardrobe
  → Today
  → Detail
  → Favorite / Worn
  → History
  → Feedback / Behavior Events
  → Learned Profile (shadow only)
  -X→ Next Recommendation
```

当前链路已经完成“上传 → 衣橱 → 推荐 → 查看/收藏/穿着 → 历史”的使用闭环。断点位于最后一段：行为可以记录、学习画像可以手动生成 shadow 结果，但 learned profile 不会自动刷新，也没有进入 Recommendation Input Snapshot、eligibility、scoring 或 ranking。因此产品当前还不能兑现“用得越久，下一次越懂我”。

## 3. 主链状态表

| 编号 | 环节 | STATUS | BLOCKING_LEVEL | 当前结论 |
| --- | --- | --- | --- | --- |
| A | 上传衣物 | IMPLEMENTED | NONE | 可选图/拍摄、上传并创建任务。 |
| B | AI 数字化 / 识别 | IMPLEMENTED | NONE | 图片处理、路由、裁切/分割、属性识别、质量状态和降级链存在。 |
| C | 用户确认 / 编辑 | IMPLEMENTED | NONE | 可修改、舍弃、重试并确认写入正式衣物。 |
| D | 入衣橱 | IMPLEMENTED | NONE | 正式 clothing、可用图片资产和 Wardrobe 查询链成立。 |
| E | 衣橱管理 | IMPLEMENTED | NONE | 查看、筛选、编辑、软删除和重新识别可用。 |
| F | Today 推荐输入 | IMPLEMENTED | NONE | mutation 后 hard-invalid；下一次 Today 重读衣橱，旧 pool identity 不会命中。 |
| G | Today 用户体验 | IMPLEMENTED | NONE | 初始推荐、场景、换一批、首卡和 AI 理由已经形成稳定入口。 |
| H | Detail | PARTIAL | P1 | 完整展示和深点评可用，但 V2 尚无独立持久化 detail document。 |
| I | 收藏 | IMPLEMENTED | NONE | Today、Detail、收藏列表共享 canonical outfit identity 并可持久恢复。 |
| J | 穿过 | PARTIAL | P1 | 穿着与历史可持久化，但不会直接改变下一次推荐输入或排序。 |
| K | History | IMPLEMENTED | NONE | 保存 outfit 快照，可在原衣物变化或删除后恢复主要信息。 |
| L | 显式反馈 | PARTIAL | P1 | 有通用意见反馈，但没有 outfit 级“不喜欢/不适合/不想穿”学习入口。 |
| M | 隐式行为 | PARTIAL | P1 | 六类事件可记录；覆盖不完整，且当前只是 telemetry/shadow 输入。 |
| N | 用户画像 / Learned Profile | PARTIAL | P1 | 可从行为生成并持久化 shadow profile，但没有自动刷新或产品入口。 |
| O | 推荐闭环 | NOT_STARTED | P0 | learned profile 未进入推荐输入、打分或排序。 |

### A. 上传衣物

- `STATUS=IMPLEMENTED`
- `USER_ENTRY=` Wardrobe 页“添加衣物”，调用系统选图/拍摄。
- `CORE_FILES=` `apps/miniapp/src/pages/wardrobe/index.tsx`；`apps/miniapp/cloudfunctions/createUploadBatch/index.js`；`apps/miniapp/cloudfunctions/createUploadImage/index.js`。
- `DATA_SOURCE=` 用户本地图片、`upload_batches`、`upload_images`。
- `DATA_WRITE=` 上传 batch、source image 与客户端上传任务缓存。
- `DOWNSTREAM_CONSUMER=` upload-confirm 页面和 `processUploadImage`。
- `TEST_EVIDENCE=` upload task 测试、`uploadConfirmState.test.js`。
- `KNOWN_GAP=` 仓库证据未包含一次新的真实微信端全链 E2E；当前未发现代码主链断点。
- `USER_IMPACT=` 用户能够创建识别任务并进入确认流程。
- `BLOCKING_LEVEL=NONE`

### B. AI 数字化 / 识别

- `STATUS=IMPLEMENTED`
- `USER_ENTRY=` upload-confirm 自动处理或用户重试。
- `CORE_FILES=` `apps/miniapp/src/pages/upload-confirm/index.tsx`；`apps/miniapp/cloudfunctions/processUploadImage/index.js`；`apps/miniapp/cloudfunctions/processUploadImage/services/wardrobeAssetPipeline.js`。
- `DATA_SOURCE=` source image、原图/临时 URL 和图片处理状态。
- `DATA_WRITE=` router、detection、crop、segment、attributes、quality 状态和可展示图片 URL 写入 draft。
- `DOWNSTREAM_CONSUMER=` upload-confirm 的草稿列表与确认操作。
- `TEST_EVIDENCE=` segmentation、thumbnail、artifact contract 等测试。
- `KNOWN_GAP=` 外部 provider 失败时会进入 fallback 或 `needs_review`；这是可降级边界，不是已知断链。
- `USER_IMPACT=` 正常结果可直接确认，低质量结果会明确要求人工检查。
- `BLOCKING_LEVEL=NONE`

### C. 用户确认 / 编辑

- `STATUS=IMPLEMENTED`
- `USER_ENTRY=` upload-confirm 页的编辑、舍弃、重试和确认保存。
- `CORE_FILES=` `apps/miniapp/src/pages/upload-confirm/index.tsx`；`apps/miniapp/cloudfunctions/confirmClothesDrafts/index.js`。
- `DATA_SOURCE=` `clothes_drafts` 和用户修正后的字段。
- `DATA_WRITE=` 更新选中 draft、将未选 draft 标记为 discarded、确认后写入 `clothes`。
- `DOWNSTREAM_CONSUMER=` Wardrobe 查询和 Recommendation Input Snapshot。
- `TEST_EVIDENCE=` `uploadConfirmState.test.js`、`uploadTerminalDiscardFlow.test.js`、confirmClothesDrafts 测试。
- `KNOWN_GAP=` 未发现明确主链断点。
- `USER_IMPACT=` 用户能在入库前纠正 AI，而不是被迫接受识别结果。
- `BLOCKING_LEVEL=NONE`

### D. 入衣橱

- `STATUS=IMPLEMENTED`
- `USER_ENTRY=` upload-confirm 确认保存后返回 Wardrobe。
- `CORE_FILES=` `apps/miniapp/cloudfunctions/confirmClothesDrafts/index.js`；`apps/miniapp/src/pages/wardrobe/index.tsx`。
- `DATA_SOURCE=` confirmed draft。
- `DATA_WRITE=` 正式 `clothes` 记录、图片资产字段、属性、质量与状态。
- `DOWNSTREAM_CONSUMER=` `getWardrobe`、Wardrobe UI、Recommendation Input Snapshot。
- `TEST_EVIDENCE=` wardrobe capacity 与 confirmation 测试。
- `KNOWN_GAP=` clean image 不可用时会保留 crop/original fallback，需要用户理解质量状态。
- `USER_IMPACT=` 新衣确认后能在衣橱看到并成为推荐数据源。
- `BLOCKING_LEVEL=NONE`

### E. 衣橱管理

- `STATUS=IMPLEMENTED`
- `USER_ENTRY=` Wardrobe 列表、clothing-detail、clothing-form。
- `CORE_FILES=` `apps/miniapp/src/pages/wardrobe/index.tsx`；`apps/miniapp/src/pages/clothing-detail/index.tsx`；`apps/miniapp/src/pages/clothing-form/index.tsx`。
- `DATA_SOURCE=` active `clothes`、分类和子分类。
- `DATA_WRITE=` 编辑字段、软删除状态、重新识别结果。
- `DOWNSTREAM_CONSUMER=` Wardrobe UI、推荐失效协调器，以及收藏/历史的快照兼容逻辑。
- `TEST_EVIDENCE=` wardrobe 测试、`recommendationMutationArchitecture.test.js`。
- `KNOWN_GAP=` 还没有衣物关系图谱等长期派生资产；不影响当前管理主链。
- `USER_IMPACT=` 用户能查看、筛选、编辑、删除和重新识别衣物。
- `BLOCKING_LEVEL=NONE`

### F. Today 推荐输入

- `STATUS=IMPLEMENTED`
- `USER_ENTRY=` 用户完成新增/编辑/删除后再次进入 Today。
- `CORE_FILES=` `apps/miniapp/src/lib/recommendationMutationCoordinator.ts`；`apps/miniapp/src/lib/cacheInvalidation.ts`；`apps/miniapp/cloudfunctions/generateOutfit/runtime/inputSnapshotService.js`；`apps/miniapp/cloudfunctions/generateOutfit/services/candidatePool.js`。
- `DATA_SOURCE=` 每次新请求读取 active `clothes`、天气和静态 `users.styleProfile`。
- `DATA_WRITE=` bump wardrobe input version、hard-invalid marker、清除本地 Today snapshot，并生成包含 `wardrobeFingerprint` 的新 candidate identity。
- `DOWNSTREAM_CONSUMER=` Recommendation Core、candidate pool identity 和最终推荐。
- `TEST_EVIDENCE=` `inputSnapshotService.test.js`、`recommendationCacheCoordinator.test.js`、mutation architecture 测试。
- `KNOWN_GAP=` 没有独立命名或持久化的 Clothing Fact Index；当前等价能力是 request-scope active-clothes 派生快照与 wardrobe fingerprint。它不是跨端实时 push invalidation。
- `USER_IMPACT=` 正常 mutation 成功后，下一次进入 Today 会强制 fresh load；新衣理论上从这次请求开始即可参与候选搜索。衣橱 fingerprint 改变会使旧 candidate pool 返回 `identity_changed`，不会因旧 pool 长期排除新衣。
- `BLOCKING_LEVEL=NONE`

### G. Today 用户体验

- `STATUS=IMPLEMENTED`
- `USER_ENTRY=` Today tab。
- `CORE_FILES=` `apps/miniapp/src/pages/today/index.tsx` 及 Recommendation V2 adapter/consumer。
- `DATA_SOURCE=` Recommendation V2 snapshot、天气、场景和版本 identity。
- `DATA_WRITE=` canonical Today snapshot、页面状态，以及收藏/穿过 mutation。
- `DOWNSTREAM_CONSUMER=` 首卡、换一批、Detail、Favorite、Worn。
- `TEST_EVIDENCE=` 当前冻结的真实生产验收：Canonical HIT 与 deterministic MISS 的 AI first visible 均为 100%，正文可见最大值小于 3 秒；Refresh 已 PASS。
- `KNOWN_GAP=` V2 与 legacy 兼容路径仍共存，但当前没有证据表明它阻断主链。
- `USER_IMPACT=` 用户能按场景获得推荐、换一批，并先看到可用的首卡 AI 理由。
- `BLOCKING_LEVEL=NONE`

### H. Detail

- `STATUS=PARTIAL`
- `USER_ENTRY=` 从 Today 推荐卡进入 outfit-detail。
- `CORE_FILES=` `apps/miniapp/src/pages/today/index.tsx`；`apps/miniapp/src/pages/outfit-detail/index.tsx`；`apps/miniapp/cloudfunctions/generateOutfit/index.js`。
- `DATA_SOURCE=` V2 immutable batch envelope、canonical outfit、衣物快照与 copy overlay。
- `DATA_WRITE=` 本地 detail draft/cache；主动 AI 深点评写入 `outfit_ai_reviews`。
- `DOWNSTREAM_CONSUMER=` 完整搭配展示、AI 深点评、Favorite 和 Worn。
- `TEST_EVIDENCE=` `outfitDetailV2.test.js`、`aiReviewPageState.test.js`、`aiReviewPresentation.test.js`。
- `KNOWN_GAP=` V2 返回 `persistedDetailDocumentReady: false`；页面可展示，但 Detail 尚未成为完整、独立持久化的产品资产。
- `USER_IMPACT=` 用户能看衣物构成和深层点评，但跨入口长期复用仍依赖 batch/snapshot 与兼容路径。
- `BLOCKING_LEVEL=P1`

### I. 收藏

- `STATUS=IMPLEMENTED`
- `USER_ENTRY=` Today、outfit-detail 和 favorite-outfits。
- `CORE_FILES=` `apps/miniapp/src/pages/today/index.tsx`；`apps/miniapp/src/pages/outfit-detail/index.tsx`；`apps/miniapp/src/pages/favorite-outfits/index.tsx`；`apps/miniapp/cloudfunctions/generateOutfit/index.js`。
- `DATA_SOURCE=` V2 `batchId + outfitKey + referenceId` 或兼容 snapshot clothing IDs。
- `DATA_WRITE=` `favorite_outfits` 与本地 canonical status/cache patch。
- `DOWNSTREAM_CONSUMER=` Today、Detail、收藏列表和行为事件。
- `TEST_EVIDENCE=` favorite saved-snapshot、status/cache 测试。
- `KNOWN_GAP=` 跨页最终一致性仍依赖 status/list refresh，但共享身份和持久数据链成立。
- `USER_IMPACT=` 收藏后可再次查看，Today、Detail 与收藏列表能识别同一套 outfit。
- `BLOCKING_LEVEL=NONE`

### J. 穿过

- `STATUS=PARTIAL`
- `USER_ENTRY=` Today 或 outfit-detail 的“穿它”。
- `CORE_FILES=` `apps/miniapp/src/pages/today/index.tsx`；`apps/miniapp/src/pages/outfit-detail/index.tsx`；`apps/miniapp/cloudfunctions/generateOutfit/index.js`；`apps/miniapp/src/lib/cacheInvalidation.ts`。
- `DATA_SOURCE=` V2 immutable payload 或 outfit snapshot。
- `DATA_WRITE=` `outfit_history`、本地 worn status 和 `outfit_wear` 行为事件。
- `DOWNSTREAM_CONSUMER=` History、Profile 缓存和手动 learned-profile shadow 聚合。
- `TEST_EVIDENCE=` history 与 behavior schema 测试。
- `KNOWN_GAP=` worn mutation 会刷新 status/history/profile，但不会把行为或 learned preference 放入下一次 recommendation input，也不会直接改变 ranking。
- `USER_IMPACT=` 用户能记录“今天穿了什么”，但系统不会因此在下一次推荐中自动减少重复或强化偏好。
- `BLOCKING_LEVEL=P1`

### K. History

- `STATUS=IMPLEMENTED`
- `USER_ENTRY=` Profile 中的穿搭日历/历史入口。
- `CORE_FILES=` `apps/miniapp/src/pages/outfit-history/index.tsx`；`apps/miniapp/cloudfunctions/generateOutfit/index.js`。
- `DATA_SOURCE=` `outfit_history`。
- `DATA_WRITE=` clothing IDs、`itemsSnapshot`/`snapshotItems`、天气、理由、分数、审美 evidence 和 AI review 等 outfit 快照。
- `DOWNSTREAM_CONSUMER=` 历史列表、历史 Detail 和恢复展示。
- `TEST_EVIDENCE=` `savedSnapshotPresentation.test.js`、history cache/status 测试。
- `KNOWN_GAP=` 页面会尝试以当前衣物补充信息；原衣物删除时依赖 snapshot 与 `isDeleted` 语义。
- `USER_IMPACT=` 历史不是临时 UI 数据；原衣物变化后仍可恢复主要 outfit 信息。
- `BLOCKING_LEVEL=NONE`

### L. 显式反馈

- `STATUS=PARTIAL`
- `USER_ENTRY=` Profile → feedback 页面。
- `CORE_FILES=` `apps/miniapp/src/pages/feedback/index.tsx`；`apps/miniapp/src/lib/cloud.ts`；`apps/miniapp/cloudfunctions/submitFeedback/index.js`。
- `DATA_SOURCE=` 用户选择的反馈类型、文本、图片和联系方式。
- `DATA_WRITE=` `user_feedback`。
- `DOWNSTREAM_CONSUMER=` 人工/后台问题处理；Recommendation 不消费。
- `TEST_EVIDENCE=` submitFeedback 与 cloud contract 测试。
- `KNOWN_GAP=` 没有绑定 canonical outfit identity 的“不喜欢”“不适合”“不想穿”“跳过原因”等结构化信号。
- `USER_IMPACT=` 用户可以提意见，但不能直接教会系统哪些搭配不适合自己。
- `BLOCKING_LEVEL=P1`

### M. 隐式行为

- `STATUS=PARTIAL`
- `USER_ENTRY=` Today、Detail 和 Favorite 操作成功边界的 best-effort 埋点。
- `CORE_FILES=` `apps/miniapp/src/lib/outfitBehavior.ts`；`apps/miniapp/cloudfunctions/trackOutfitBehaviorEvents/index.js`；`apps/miniapp/cloudfunctions/trackOutfitBehaviorEvents/eventSchema.js`。
- `DATA_SOURCE=` exposure、detail view、favorite、unfavorite、wear、manual batch refresh。
- `DATA_WRITE=` `_openid` 隔离且按 `eventId` 幂等的 `outfit_behavior_events`。
- `DOWNSTREAM_CONSUMER=` `refreshLearnedStyleProfile` shadow 聚合。
- `TEST_EVIDENCE=` `outfitBehaviorCore.test.js`、`eventSchema.test.js`。
- `KNOWN_GAP=` scene selection、频繁选择、细粒度跳过原因等信号未完整覆盖；事件当前不直接影响推荐。
- `USER_IMPACT=` 用户行为有数据沉淀基础，但不会立即让推荐变得更懂用户。
- `BLOCKING_LEVEL=P1`

### N. 用户画像 / Learned Profile

- `STATUS=PARTIAL`
- `USER_ENTRY=` 没有常规用户入口；当前只能由云函数/控制台手动刷新。
- `CORE_FILES=` `apps/miniapp/cloudfunctions/refreshLearnedStyleProfile/index.js`；`apps/miniapp/cloudfunctions/refreshLearnedStyleProfile/profileBuilder.js`；`apps/miniapp/cloudfunctions/refreshLearnedStyleProfile/profilePersistence.js`；`docs/learned-style-profile-v1.md`。
- `DATA_SOURCE=` 当前用户的 `outfit_behavior_events` 与关联 `clothes`。
- `DATA_WRITE=` `learned_style_profiles` 的 global/context shadow profile、quality 和 source metadata。
- `DOWNSTREAM_CONSUMER=` 当前没有 Today、Profile、favorite、wear 或 `generateOutfit` 自动消费方。
- `TEST_EVIDENCE=` `profileBuilder.test.js`、`profilePersistence.test.js`。
- `KNOWN_GAP=` 不自动刷新、不展示、不进入 recommendation input；真实行为只能形成手动 shadow 产物。
- `USER_IMPACT=` 系统具备推断画像的底层算法，但用户正常使用不会自动得到这份画像的效果。
- `BLOCKING_LEVEL=P1`

### O. 推荐闭环

- `STATUS=NOT_STARTED`
- `USER_ENTRY=` 无用户可见入口或自动链路。
- `CORE_FILES=` `apps/miniapp/cloudfunctions/generateOutfit/runtime/inputSnapshotService.js`；`docs/learned-style-profile-v1.md`；`docs/personalized-aesthetic-recommendation-v2.md`。
- `DATA_SOURCE=` 当前 Recommendation Input Snapshot 读取衣橱、天气和静态 `styleProfile`，不读取 `learned_style_profiles`。
- `DATA_WRITE=` 没有 learned profile → recommendation version/input 的写回。
- `DOWNSTREAM_CONSUMER=` eligibility、scoring、ranking 均未消费 learned profile。
- `TEST_EVIDENCE=` input snapshot 测试反向证明输入合同不含 learned profile；现有设计文档明确标记未接入排序。
- `KNOWN_GAP=` 行为 → 聚合 → 自动刷新 → Input Snapshot → scoring/ranking → 个性化 evidence 整条生产链未闭合。
- `USER_IMPACT=` 收藏、穿过、查看或换一批后，下一次推荐不会因为这些历史行为产生可解释变化。
- `BLOCKING_LEVEL=P0`

## 4. 当前已完成核心能力

- 用户可以完成选图/拍摄、上传任务创建、AI 数字化、人工确认和正式入衣橱。
- Wardrobe 支持查看、筛选、编辑、删除和重新识别；mutation 后下一次 Today 会 fresh load，旧 candidate pool 不会按旧衣橱 identity 命中。
- Today 的初始推荐、场景切换、换一批、首卡与 AI 一句话理由已经可用，并通过当前冻结的生产验收。
- 收藏在 Today、Detail、收藏列表之间有统一业务身份和持久化结果。
- 穿着历史保存 outfit snapshot，不依赖临时页面状态，可恢复主要搭配信息。
- Detail 已具备结构化审美 evidence、主动深点评、版本化缓存和失效能力，但仍属于 partial product asset。
- 行为事件与 learned-profile shadow 聚合已经具备代码和测试基础，为后续闭环提供了起点。

## 5. 当前产品断点

### P0：行为学习没有进入下一次推荐

- `ROOT_PROBLEM=` learned profile 不在 Recommendation Input Snapshot 中，eligibility、scoring 和 ranking 均不消费。
- `USER_VISIBLE_SYMPTOM=` 用户收藏、穿过、查看详情或换一批后，下一次推荐没有可解释的个性化变化。
- `WHY_IT_MATTERS=` “越用越懂我”是私人衣橱助手区别于一次性搭配生成器的核心承诺。
- `DEPENDENCIES=` 行为事件生产稳定性、自动/增量画像刷新、输入版本、受控权重、冷启动与回滚、个性化 evidence。
- `BLOCKING_LEVEL=P0`

### P1：显式负反馈没有进入推荐域

- `ROOT_PROBLEM=` 当前 feedback 是通用问题反馈，没有 canonical outfit identity 和结构化“不喜欢/不适合/不想穿”语义。
- `USER_VISIBLE_SYMPTOM=` 用户能提交意见，却不能直接告诉系统“以后少给我这种搭配”。
- `WHY_IT_MATTERS=` 仅靠曝光、详情、收藏和穿着难以区分“没看见”“暂时不需要”和“明确不喜欢”。
- `DEPENDENCIES=` outfit-level feedback schema、canonical identity、幂等事件、learned-profile 聚合。
- `BLOCKING_LEVEL=P1`

### P1：Learned Profile 仍是手动 shadow 产物

- `ROOT_PROBLEM=` 聚合云函数存在，但没有由事件、用户入口或调度自动触发，也没有产品可见状态。
- `USER_VISIBLE_SYMPTOM=` 即使用户积累了足够行为，画像也不会在正常使用过程中自动更新并生效。
- `WHY_IT_MATTERS=` 没有稳定、可追溯的画像生命周期，就无法安全连接生产排序。
- `DEPENDENCIES=` refresh policy、幂等/并发、quality gate、profile version、可观测性与用户控制。
- `BLOCKING_LEVEL=P1`

### P1/P2：已可用但尚未完全产品化的边界

- Detail 可展示并生成深点评，但 V2 尚无独立持久化 detail document。
- Worn 可以持久化并进入 History/行为事件，但不会直接影响下一次推荐。
- 隐式事件未覆盖全部场景选择、跳过原因和细粒度负反馈。
- 上传链有单元/合同证据，但本次范围未重新做真实微信端 E2E 或云端部署验证。

## 6. 当前个性化等级

`CURRENT_PERSONALIZATION_LEVEL=LEVEL_1_STATIC_PROFILE`

证据：

- 手工维护的静态 style/recommendation profile 会进入 Recommendation Input Snapshot。
- 收藏、取消收藏、穿过、详情查看、曝光和换一批可以形成行为事件，但事件本身不影响推荐。
- learned profile 只能手动生成 shadow 结果，不自动刷新，也不被 Recommendation Runtime 读取。

因此当前不是 `LEVEL_2_BEHAVIOR_AWARE`：系统虽记录部分行为，但没有“用于推荐”。更不是 `LEVEL_3_LEARNING_LOOP`：长期聚合、稳定画像、自动更新和后续推荐变化尚未形成生产闭环。

## 7. 长期能力状态

### 衣物关系链 / 知识图谱

`STATUS=NOT_STARTED`

当前 recommendation 内存在组合时计算的 relation fact、审美 compatibility 和 scene evidence，但没有 clothing-to-clothing 持久关系、outfit co-occurrence graph、个人 compatibility edge 或 learned relationship。不能把一次推荐中的组合证据表述为个人衣橱知识图谱。

### 真人穿搭效果图

`STATUS=NOT_STARTED`

上传 Pipeline 支持真人/模特图解析、衣物裁切和分割，可作为未来资产基础；当前没有 person image + garment 的虚拟试衣、重建或静态穿搭合成输出链。衣物分割不等于 VTO。

### 小搭深层点评

`STATUS=PARTIAL`

Detail 已有结构化 `aestheticEvaluation` / stylist evidence、主动 AI 深点评、版本化 digest、缓存复用与失效。它与 Homepage 一句话 AI Reason 是不同链路。当前缺口是 V2 detail 持久化文档未完成，且 learned preference 未进入个性化 explanation；审美 shadow evidence 也不等于已经改变 recommendation ranking。

## 8. 下一阶段候选 Goal

### 1. 行为学习推荐闭环 V1

- `GOAL_NAME=` Behavior-to-Recommendation Learning Loop V1
- `PRODUCT_VALUE=` 让已有收藏、穿着、详情和换批行为第一次真正改变后续推荐。
- `ROOT_PROBLEM=` learned profile 只停留在手动 shadow，不进入生产输入和排序。
- `CURRENT_STATE=` 事件 schema、持久化和 profile builder 已有；自动刷新、输入合同、权重融合和 explanation 尚无。
- `EXPECTED_USER_CHANGE=` 用户积累足够行为后，下一次推荐在可控范围内更贴近其稳定偏好，并能说明使用了哪些偏好证据。
- `DEPENDENCIES=` 事件生产质量审计、profile quality gate、自动/增量 refresh、InputSnapshot schema/version、ranking guardrail、回滚开关和离线/影子对照。
- `SCOPE=` 仅接已有高置信信号；先 shadow 对比，再小权重 gated rollout；提供不使用/重置学习偏好的控制；不改 Recommendation Runtime 2.2 的 bounded-search 架构。
- `RISK=` 错误强化、反馈回路偏置、冷启动误判、输入版本与缓存身份不一致。
- `WHY_NOW=` 上传、衣橱、推荐、收藏、穿着和历史已经可用，主价值链唯一 P0 正是最后一跳。
- `NOT_INCLUDED=` 衣物知识图谱、群体协同学习、VTO、模型更换、首页性能优化。
- `ESTIMATED_COMPLEXITY=L`

### 2. Outfit 级显式反馈 V1

- `GOAL_NAME=` Outfit-level Explicit Feedback V1
- `PRODUCT_VALUE=` 让用户用最低成本表达“不喜欢/不适合/今天不想穿”，提供高置信负信号。
- `ROOT_PROBLEM=` 通用 feedback 不绑定 outfit，也不进入 recommendation 域。
- `CURRENT_STATE=` canonical outfit identity 和行为事件基础存在，但缺少反馈交互、schema、聚合与消费。
- `EXPECTED_USER_CHANGE=` 用户能直接纠正一次不合适推荐，并在后续结果中看到同类搭配减少。
- `DEPENDENCIES=` Goal 1 的 learned-profile 生命周期和推荐消费边界。
- `SCOPE=` 2～4 个可解释原因、canonical identity、幂等写入、撤销、事件聚合和最低限度 UI。
- `RISK=` 反馈入口打扰、负信号过强、场景性拒绝被误学为长期偏好。
- `WHY_NOW=` 这是闭环中最缺失的高质量信号，但单独采集而不消费只会再造一层 telemetry。
- `NOT_INCLUDED=` 通用客服反馈重构、自由文本 NLP、跨用户模型。
- `ESTIMATED_COMPLEXITY=M`

### 3. 个人衣橱关系链基础 V1

- `GOAL_NAME=` Personal Wardrobe Relationship Graph V1
- `PRODUCT_VALUE=` 从“每次临时组合”升级为可积累的个人衣物搭配知识，形成差异化资产。
- `ROOT_PROBLEM=` 当前 relation/evidence 是 request-time 计算，没有长期 outfit co-occurrence、成功组合或衣物关系资产。
- `CURRENT_STATE=` 已有 canonical outfit、收藏、穿着历史、审美 evidence 和 clothing snapshot，可作为边数据来源。
- `EXPECTED_USER_CHANGE=` 系统能记住哪些个人衣物经常一起被接受/穿着，并用于解释、复用和候选优先级。
- `DEPENDENCIES=` Goal 1 的行为质量与反馈语义、关系版本、删除/编辑后的边失效策略。
- `SCOPE=` 仅当前用户、可解释 edge、从收藏/穿着/明确反馈派生，先作为 shadow evidence。
- `RISK=` 稀疏数据、关系固化导致推荐变窄、衣物 mutation 后脏边。
- `WHY_NOW=` 它是闭环之后最有产品差异化价值的长期方向，且现有 outfit/history 数据可复用。
- `NOT_INCLUDED=` 全局时尚知识图谱、协同过滤、外部商品图谱、VTO。
- `ESTIMATED_COMPLEXITY=L`

## 9. 推荐下一 Goal

`RECOMMENDED_NEXT_GOAL=Behavior-to-Recommendation Learning Loop V1`

- `WHY_THIS_FIRST=` 它直接修复唯一 P0，并把已有事件、收藏、穿着、历史和 learned-profile shadow 投资转化为用户能感知的价值。范围应从已有高置信信号开始，通过 quality gate、shadow 对比、小权重和回滚开关控制风险。
- `WHY_NOT_GOAL_2=` 显式反馈很重要，但在 learned profile 和 recommendation consumer 尚未连通时先做，只会新增一类无法生效的数据。
- `WHY_NOT_GOAL_3=` 知识图谱有长期差异化价值，但数据语义和学习消费边界尚未稳定；现在建设会把未验证的行为偏差固化成关系资产。

## 10. 冻结项

- `Recommendation Runtime 2.2 = CURRENT / FROZEN`
- `Homepage renderer = qwen-flash + compressed-v2 production-4`
- `Homepage AI First Reason = Canonical HIT 100% AI first visible；deterministic MISS 100%；CONTENT_VISIBLE max < 3s`
- `Server performance = PASS`
- `Refresh / 换一批 = PASS`

无直接阻断 Upload、Wardrobe、Feedback 主链的新证据时，不重新打开 bounded search、beam、reservoir、candidate-pool 性能、模型竞速、SSE 或首屏毫秒级优化。

## 11. 后续 session 使用方式

后续讨论产品状态、Roadmap 或下一阶段 Goal 时，优先读取本文件、`AGENTS.md` 和 `docs/PROBLEM_LIST.md`。本文件记录当前 repo 的产品主链事实；不要用旧聊天、旧阶段进度表或“代码文件存在”覆盖这里的判定。

如果后续实现改变了 A～O 任一状态，应同步更新：状态、数据写入、下游消费、测试证据、已知缺口和个性化等级。部署或真实验收没有证据时，使用 `UNKNOWN` 或明确写出证据边界，不把“代码完成”表述为“生产已完成”。
