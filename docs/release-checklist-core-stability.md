# 搭搭day 近期核心改造部署与人工测试清单

本文档用于集中整理近期核心稳定性改造的部署与人工测试事项。范围覆盖缓存失效、天气刷新、AI 点评、删除引用修复、上传识别幂等、已有衣服重新处理 attempt token，以及衣物属性 alias / normalize 收口。

约定：

- 本文只描述部署与验收，不代表已经部署到云端。
- “需要部署云函数”指该 commit 修改了云函数代码，或部署后才能生效。
- “需要建集合 / 配权限”只列云数据库层面的新增集合、权限或云端核对项。
- “人工测试”指需要在体验版或真机环境按清单验证。

## 一、改造 commit 清单

| 时间顺序 | Commit | Message | 所属阶段 | 需要部署云函数 | 需要建集合 / 配权限 | 需要人工测试 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `10552ac` | `feat: isolate user runtime caches` | mutation cache / 用户运行时缓存隔离 | 否 | 否 | 是 |
| 2 | `fcb83ff` | `fix: reset core pages on user session change` | mutation cache / 切换账号核心页面重置 | 否 | 否 | 是 |
| 3 | `0697dbb` | `fix: invalidate user flows on session change` | mutation cache / 用户 flow 失效 | 否 | 否 | 是 |
| 4 | `e8d630b` | `chore: remove legacy global user caches` | mutation cache / 移除旧全局缓存 | 否 | 否 | 是 |
| 5 | `27388af` | `fix: guard mutations across user sessions` | mutation cache / mutation 防跨账号晚归 | 否 | 否 | 是 |
| 6 | `cb73e5c` | `fix: invalidate caches after user mutations` | mutation cache / 用户操作后失效 | 否 | 否 | 是 |
| 7 | `2359ff5` | `fix: complete mutation cache invalidation` | mutation cache / 失效收口 | 否 | 否 | 是 |
| 8 | `29cd2d3` | `fix: refresh outfits on meaningful weather changes` | Today 天气实质变化刷新 | 否 | 否 | 是 |
| 9 | `0eb2d1e` | `feat: persist outfit AI reviews` | AI 点评持久化与重新点评 | 是：`generateOutfit` | 是：创建 `outfit_ai_reviews` 并配置权限 | 是 |
| 10 | `9358eb5` | `codex删除衣物半成品` | 删除衣物引用完整性与快照资产安全（半成品） | 是：`deleteClothes`、`cleanupDeletedClothes`、`generateOutfit` | 否；需要核对 clothes tombstone/repair 字段写入 | 是 |
| 11 | `db84ade` | `fix: complete deleted clothing repair safety` | 删除衣物引用完整性与快照资产安全（补修收口） | 是：`deleteClothes`、`cleanupDeletedClothes` | 否；`_openid + _id` 查询索引作为云端验证项 | 是 |
| 12 | `3f9b69a` | `fix: make upload image processing idempotent` | 上传识别并发幂等 | 是：`processUploadImage` | 否；新增 `upload_images` / `clothes_drafts` 字段写入 | 是 |
| 13 | `0ab0b6e` | `fix: guard clothing reprocessing attempts` | 已有衣服重新识别 / 重新分割 attempt token | 是：`segmentClothImage`、`recognizeClothAttributes` | 否；新增 clothes attempt token 字段写入 | 是 |
| 14 | `8bca539` | `fix: normalize clothing attribute aliases` | 衣物属性 alias / normalize 收口 | 是：`updateClothes`、`recognizeClothAttributes`、`getWardrobe` | 否；不 backfill | 是 |
| 15 | 本次提交 | `feat: capture outfit behavior events` | 个性化审美推荐 V2 阶段 3 行为事件采集 | 是：`trackOutfitBehaviorEvents` | 是：创建 `outfit_behavior_events`、设置仅云函数访问、创建 3 个索引 | 是 |
| 16 | 本次提交 | `feat: build learned style profile shadow` | 个性化审美推荐 V2 阶段 4 learnedProfile shadow 聚合基础 | 是：`refreshLearnedStyleProfile` | 是：创建 `learned_style_profiles`、设置仅云函数访问 | 是 |

阶段合并说明：

- mutation cache 是一组连续收口 commit，不需要部署云函数，但需要重新构建并上传小程序体验版。
- 删除衣物安全由 `9358eb5` 半成品和 `db84ade` 补修组成，部署时按最终代码部署即可；人工测试需要覆盖半成品可能遗留的 repair 接管场景。
- 属性 alias / normalize 第一阶段只规范后续写入和返回，不迁移历史数据、不删除 legacy 字段。

## 二、需要部署的云函数清单

优先级按依赖与风险排序。

| 优先级 | 云函数 | 来源改造阶段 | 部署原因 | 是否需要云端安装依赖 | `wx-server-sdk` 是否固定 | 部署后核心场景 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `generateOutfit` | AI reviews；删除衣物安全 | 新增 AI 点评持久化读写；推荐/详情需避开 deleted 衣物引用 | 是 | 是，`3.0.4` | 推荐生成、穿搭详情、AI 点评读取/重评、删除衣物后推荐不再引用 |
| 2 | `deleteClothes` | 删除衣物安全 | 删除时写 tombstone，修复 outfits/favorites/history 引用，保护快照资产 | 是 | 是，`3.0.4` | 删除衣物、引用修复分页、旧 worker 晚归、失败重试 |
| 3 | `cleanupDeletedClothes` | 删除衣物安全 | 接管 pending/failed/stale repair，清理可删除资产 | 是 | 是，`3.0.4` | cleanup 接管 repair、7 天后快照仍可看、共享 URL 不误删 |
| 4 | `processUploadImage` | 上传识别并发幂等 | 使用 `processingToken` 和稳定 `draftId` 防并发重复 AI 与晚归写入 | 是 | 否，当前为 `latest` | 同 imageId 并发、stale 接管、多件衣服 draftId、batch discarded |
| 5 | `segmentClothImage` | 已有衣服重新分割 attempt token | 重新分割用 `segmentAttemptToken` 防 A/B 晚归覆盖 | 是 | 否，当前为 `latest` | 连续点击重新分割、失败晚归不覆盖成功图、deleted 拒绝 |
| 6 | `recognizeClothAttributes` | 重新识别 attempt token；属性 alias | 重新识别用 token 防晚归；AI 写入 canonical 并保护 manual alias | 是 | 否，当前为 `latest` | 连续点击重新识别、手动字段保护、deleted 拒绝、superseded 返回 |
| 7 | `updateClothes` | 属性 alias normalize | 用户编辑保存时写 canonical 并同步必要 mirror | 是 | 否，当前为 `latest` | 编辑 subcategory/colorPalette/material 后 mirror 正确 |
| 8 | `getWardrobe` | 属性 alias normalize | 衣橱列表/详情返回 canonical + mirror | 是 | 否，当前为 `latest` | 衣橱列表、衣物详情、历史 legacy 字段兼容返回 |
| 9 | `trackOutfitBehaviorEvents` | 行为事件采集阶段 3 | 接收推荐曝光、详情、收藏、取消收藏、穿它、手动换一批事件 | 是 | 是，`3.0.4` | 行为事件写入、用户隔离、幂等、失败隔离 |
| 10 | `refreshLearnedStyleProfile` | learnedProfile shadow 阶段 4 | 手动刷新当前用户 learnedProfile，写入 shadow 集合，不接入推荐排序 | 是 | 是，`3.0.4` | insufficient/shadow_ready、digest 幂等、用户隔离、缺失衣物容错 |

必须一起部署的组合：

- `deleteClothes` + `cleanupDeletedClothes` + `generateOutfit`：删除引用修复、推荐过滤和快照安全需要协议一致。
- `segmentClothImage` + `recognizeClothAttributes`：已有衣服后处理入口共用 attempt token/superseded 行为，建议同批部署。
- `updateClothes` + `getWardrobe` + `recognizeClothAttributes`：属性 alias 规则需要编辑、AI 写入、读取返回三端一致。
- `processUploadImage` 与小程序体验版：上传页依赖稳定 draftId / processing 状态展示，云函数和前端需同批验证。

## 三、云数据库 / 权限清单

### AI 点评

- 需要创建集合：`outfit_ai_reviews`。
- 权限：客户端不可直接读写，仅云函数访问。
- 不需要新环境变量。
- 当前按确定性 `_id` 读写，暂不需要额外索引。
- 关键写入字段包括：`_openid`、`outfitKey`、`scene`、`inputHash`、`promptVersion`、`model`、`aiComment`、`status`、`generationToken`、`generatedAt`、`updatedAt`、`previousReadyReview`。

### 行为事件

- 需要创建集合：`outfit_behavior_events`。
- 权限：客户端不可直接读写，仅云函数访问。
- 幂等不依赖唯一索引，云函数使用确定性 `_id = obv1_ + sha256(OPENID + "|" + eventId)`。
- 建议索引：
  - `_openid ASC + occurredAt DESC`
  - `_openid ASC + eventType ASC + occurredAt DESC`
  - `_openid ASC + outfitKey ASC + occurredAt DESC`
- 当前不实现清理任务；建议阶段 4 聚合稳定后再制定 180 天左右原始事件保留策略。

### Learned Profile Shadow

- 需要创建集合：`learned_style_profiles`。
- 权限：客户端不可直接读写，仅云函数访问。
- 每个用户一个文档：`_id = lspv1_ + sha256(OPENID)`，不包含明文 OPENID。
- 文档中仍保存服务端 `_openid` 用于隔离和审计。
- 当前按确定性 `_id` 读写，暂不新增索引。
- 不建立跨用户查询、排行榜或群体统计索引。
- 暂不让 `generateOutfit`、Today、Profile 或偏好页读取该集合。

### 删除修复

- 不新增集合。
- 新增 tombstone / repair 字段写入 `clothes`：
  - `referenceRepairStatus`
  - `referenceRepairStage`
  - `referenceRepairCursor`
  - `referenceRepairToken`
  - `referenceRepairHeartbeatAt`
  - `referenceRepairUpdatedAt`
  - `referenceRepairFoundReferences`
  - `referenceRepairErrorCode`
  - `preserveSnapshotAssets`
- 是否需要 `_openid + _id` 查询索引：云端验证项，不在本文断言一定需要。
- 需要人工核对 deleted tombstone 不会在 `cloud.deleteFile` 部分失败时提前物理清掉。

### 上传处理

- 不新增集合。
- 新增 `upload_images` 字段：
  - `processingToken`
  - `processingStartedAt`
  - `processingHeartbeatAt`
  - `processingAttempt`
- 新增 `clothes_drafts` 字段：
  - `sourceAssetKey`
  - `processingToken`
- 需要云端验证旧数据在缺少这些字段时仍能重新处理或安全失败。

### 衣服后处理

- 不新增集合。
- 新增 `clothes` 字段：
  - `segmentAttemptToken`
  - `segmentStartedAt`
  - `segmentHeartbeatAt`
  - `recognitionAttemptToken`
  - `recognitionStartedAt`
  - `recognitionHeartbeatAt`
- 这些字段用于防连续点击和旧请求晚归覆盖。

### 属性 alias

- 不新增字段。
- 不 backfill。
- 不删除 legacy 字段。
- 只规范后续写入和返回：
  - canonical：`category`、`subcategory`、`colorPalette`、`material`、`thickness`、`styleTags`、`seasonTags`、`sceneTags`
  - mirror：`subCategory`、`colors`、`materialGuess`

## 四、部署顺序建议

1. 创建 `outfit_ai_reviews` 集合并设置权限为仅云函数访问。
2. 部署基础读取/写入相关云函数：`getWardrobe`、`updateClothes`。这样衣橱读写先具备 alias normalize 能力。
3. 部署 `generateOutfit`。AI 点评与 deleted 衣物过滤相关逻辑先就位。
4. 部署删除相关云函数：`deleteClothes`、`cleanupDeletedClothes`。二者必须同批部署，避免 tombstone/repair 协议不一致。
5. 部署上传处理云函数：`processUploadImage`。部署后重点看依赖安装和 `wx-server-sdk` 版本。
6. 部署衣服后处理云函数：`segmentClothImage`、`recognizeClothAttributes`。二者建议同批部署。
7. 创建 `outfit_behavior_events`，设置仅云函数访问，并创建 3 个行为查询索引。
8. 部署 `trackOutfitBehaviorEvents`。
9. 创建 `learned_style_profiles`，设置仅云函数访问。
10. 部署 `refreshLearnedStyleProfile`，先只通过云函数控制台或手动调用验证。
11. 小程序重新构建并上传体验版。mutation cache、weather refresh、AI 点评入口、删除/上传/后处理页面交互和行为采集都需要前端新包。
12. 按“部署后烟测清单”先跑 10-15 项 smoke，再按模块跑完整人工测试。

协议一致性提醒：

- 仅部署小程序而不部署 `generateOutfit`，AI 点评持久化和重新点评不会完整生效。
- 仅部署 `deleteClothes` 而不部署 `cleanupDeletedClothes`，stale/failed repair 接管能力不完整。
- 仅部署 `recognizeClothAttributes` 而不部署 `updateClothes/getWardrobe`，AI 写入、手动编辑、读取返回的 alias 规则会不一致。
- 仅部署 `processUploadImage` 而不上传新版小程序，用户可能无法看到新的 processing/draft 状态语义。
- 仅上传新版小程序而不部署 `trackOutfitBehaviorEvents`，行为采集会 best-effort 失败，但不应影响推荐、收藏、穿它或详情。
- 部署 `refreshLearnedStyleProfile` 后仍不得让推荐读取 `learned_style_profiles`；本阶段只是 shadow 聚合验证。

## 五、统一人工测试清单

### 缓存 mutation

| 测试步骤 | 预期结果 | 关联云函数 / 页面 |
| --- | --- | --- |
| 收藏页取消收藏一套穿搭，再回 Today 和详情页查看 | Today 卡片、详情页收藏状态一致变为未收藏 | `generateOutfit`；`pages/favorite-outfits`、`pages/today`、`pages/outfit-detail` |
| 收藏页重命名收藏穿搭，再进入 Today / 详情 / 历史 | 标题在三处一致更新，无旧缓存标题 | `generateOutfit`；收藏页、Today、详情、历史 |
| 在上传确认页舍弃上传批次 | 只刷新可恢复任务列表，不重拉衣服列表 | `discardUploadBatch`；`pages/upload-confirm`、`pages/upload-tasks` |
| 确认草稿入库 | 衣橱列表、profile 统计、Today 推荐均刷新 | `confirmClothesDrafts`、`getWardrobe`、`generateOutfit`；上传确认、衣橱、我的、Today |
| 修改头像昵称 | profile 更新，但 Today 推荐不重新生成 | `updateUserProfile`；我的、Today |
| 修改推荐偏好 | profile 更新，Today 推荐缓存失效并按偏好刷新 | `updateUserProfile`/偏好保存；风格偏好、Today |

### 天气刷新

| 测试步骤 | 预期结果 | 关联云函数 / 页面 |
| --- | --- | --- |
| 从缓存天气切到实时天气，温度仍在同一推荐温区且 condition bucket 不变 | 只更新当前天气显示，不重新生成推荐 | `getWeather`、`generateOutfit`；`WeatherCard`、Today |
| 实时天气跨温区，例如 18 度变 29 度 | Today 静默重新拉推荐，不长时间卡 loading | `getWeather`、`generateOutfit`；Today |
| 晴转雨、雨转雪等 condition bucket 变化 | 推荐静默重生成，天气胶囊更新 | `getWeather`、`generateOutfit`；Today |
| 手动刷新天气，分别制造 unchanged / refreshed / failed | 展示对应提示，不误触发重复 loading | `getWeather`；`WeatherCard`、Today |
| 天气刷新同时点“换一批”或切换场景 | 请求晚归不覆盖新状态，loading 能收起 | `generateOutfit`；Today |

### 行为事件采集

| 测试步骤 | 预期结果 | 关联云函数 / 页面 |
| --- | --- | --- |
| 打开 Today 页并看到首张推荐 | 产生 1 条 `recommendation_exposure` | `trackOutfitBehaviorEvents`；Today |
| 左右滑动到新推荐卡再滑回旧卡 | 新卡各 1 条 exposure，旧卡不重复 | `trackOutfitBehaviorEvents`；Today Swiper |
| 重新进入 Today 页 | 新页面会话可再次记录当前卡 exposure | `trackOutfitBehaviorEvents`；Today |
| 进入穿搭详情 | 成功展示后产生 1 条 `outfit_detail_view`，重渲染不重复 | `trackOutfitBehaviorEvents`；详情 |
| Today 或详情收藏成功 | 产生 `outfit_favorite`；失败不产生 | `generateOutfit`、`trackOutfitBehaviorEvents`；Today、详情 |
| Today、详情或收藏页取消收藏成功 | 产生 `outfit_unfavorite`；失败不产生 | `generateOutfit`、`trackOutfitBehaviorEvents`；Today、详情、收藏 |
| Today 或详情点击“穿它”成功 | 产生 `outfit_wear`；同一套再次真实成功可产生第二条 | `generateOutfit`、`trackOutfitBehaviorEvents`；Today、详情 |
| 手动点击“换一批”并成功切换 | 产生 `recommendation_batch_refresh`，记录上一批最多 8 个 outfitKey | `generateOutfit`、`trackOutfitBehaviorEvents`；Today |
| 天气自动重生成推荐 | 不产生 `recommendation_batch_refresh` | `getWeather`、`generateOutfit`；Today |
| 人为让埋点云函数失败 | 主业务无 Toast、无新增 loading，原操作仍成功 | `trackOutfitBehaviorEvents`；Today、详情、收藏 |
| 检查事件文档 | `_openid` 为当前用户；无图片、标题、城市、raw result、openid 伪造字段 | `outfit_behavior_events` |

### Learned Profile Shadow

| 测试步骤 | 预期结果 | 关联云函数 / 页面 |
| --- | --- | --- |
| 创建 `learned_style_profiles` 并部署 `refreshLearnedStyleProfile` 后，对没有足够行为的当前用户手动调用刷新 | 返回 `insufficient_data`，只写或更新当前用户 shadow 文档 | `refreshLearnedStyleProfile` |
| 当前用户产生足够 exposure/detail/favorite/wear 行为后再次刷新 | 返回 `shadow_ready`，`eligibleEventCount`、`distinctOutfitCount`、`effectiveActionWeight` 和 `featureCoverage` 达标 | `refreshLearnedStyleProfile`、`outfit_behavior_events` |
| 相同数据连续刷新两次 | 第二次返回 `unchanged: true`，不因 `generatedAt` 不同重复写入 | `refreshLearnedStyleProfile`、`learned_style_profiles` |
| 新增一条有效行为后刷新 | `sourceDigest` 改变并更新 profile | `refreshLearnedStyleProfile` |
| 构造只有 exposure 的行为 | 不产生负偏好 | `refreshLearnedStyleProfile` |
| 同一 outfit 重复 wear | 第二次 wear 权重大于第一次，第三次及以后封顶 | `refreshLearnedStyleProfile` |
| 手动换一批但对应 batch 中没有曝光 | 不产生 refresh 负向 | `refreshLearnedStyleProfile` |
| 同一 batch 中已曝光 outfit 被手动换一批 | 只产生极弱负向，且同一自然日最多 3 次有效贡献 | `refreshLearnedStyleProfile` |
| 不同 scene 行为混合 | 只有达标 scene 输出 context，未达标 scene 不用全局画像伪装 | `refreshLearnedStyleProfile` |
| 删除或缺失部分衣物后刷新 | 函数不失败，可解析衣物继续参与学习 | `refreshLearnedStyleProfile`、`clothes` |
| 切换账号后刷新 | 只读取当前 `_openid` 的事件和衣物，不串账号 | `refreshLearnedStyleProfile` |
| 检查 profile 文档和云函数返回 | 不含原始 eventId、outfitKey、clothingIds、衣物详情或完整画像返回 | `learned_style_profiles`、`refreshLearnedStyleProfile` |
| 刷新后查看推荐结果 | 推荐排序、`scores.total`、收藏、穿它和曝光逻辑完全不变 | `generateOutfit`、Today、详情 |

### AI 点评

| 测试步骤 | 预期结果 | 关联云函数 / 页面 |
| --- | --- | --- |
| 首次进入穿搭详情并触发点评 | 生成点评并写入 `outfit_ai_reviews` | `generateOutfit`；`pages/outfit-detail` |
| 首次点击 AI 点评 | 生成 `reviewVersion=stylist-explanation-v2` 的点评，返回 `title/reason/styleTags/tip` | `generateOutfit`；`pages/outfit-detail` |
| 检查 `outfit_ai_reviews` 文档 | 保存 `inputDigest`、`evidenceVersion`、`promptVersion`、`source` 和 `explanationV2`，不含图片 URL、定位或 learnedProfile | `generateOutfit` |
| 退出后再次进入同一详情 | `reviewVersion` 和 `inputDigest` 一致时复用已持久化点评，不重复生成 | `generateOutfit`；详情 |
| 修改穿搭输入、场景、天气、scores 或 aesthetic evidence 后触发点评 | `inputDigest` 改变并生成新 V2，不复用旧事实点评 | `generateOutfit`；详情 |
| 点击重新点评 | force refresh 不复用同 digest 旧点评，点评内容或生成时间更新，旧内容在失败时可保留 | `generateOutfit`；详情 |
| 30 秒内连续点重新点评 | 命中 cooldown，前端提示或保持旧点评 | `generateOutfit`；详情 |
| 两个页面并发触发同一点评 | 只生成一次，另一侧看到 in-progress/cache 结果 | `generateOutfit`；详情 |
| 模拟旧请求晚归 | 旧 generationToken 或 digest 不匹配时不覆盖新 V2 结果 | `generateOutfit` |
| 模拟模型 malformed JSON | 使用 grounded rule fallback，输出仍引用真实 evidence code | `generateOutfit` |
| 低 coverage 或 score=null | 点评语气谨慎，不输出整体审美优劣结论 | `generateOutfit` |
| 构造旧 V1 点评记录后主动点击点评 | 按当前输入升级生成 V2，不做全量迁移、不删除旧数据 | `generateOutfit` |
| 检查点评内容 | 不虚构颜色、材质、版型、天气或场景；不出现身材、年龄、职业、身份推断 | `generateOutfit`；详情 |
| 从收藏入口 / 历史入口进入详情 | 可见同一套穿搭对应点评 | `generateOutfit`；收藏、历史、详情 |
| 切换账号后进入同一 outfitKey | 点评按 `_openid` 隔离，不串账号 | `generateOutfit`；登录态、详情 |
| 模型失败或网络失败 | 保留旧点评，不把 ready 点评清空 | `generateOutfit`；详情 |
| 点评前后查看推荐列表 | 推荐顺序、`scores.total`、收藏、穿它、重命名和详情基础加载不变 | `generateOutfit`；Today、详情 |

### 删除衣物安全

| 测试步骤 | 预期结果 | 关联云函数 / 页面 |
| --- | --- | --- |
| 准备 501+ 条 outfits/favorite/history 引用同一衣物并删除 | 分页修复完整，所有引用都被移除或保留安全快照 | `deleteClothes`、`cleanupDeletedClothes`、`generateOutfit`；衣橱、收藏、历史 |
| 删除时中断 repair，再运行 cleanup | cleanup 接管 pending/failed/stale repair 并继续推进 | `cleanupDeletedClothes` |
| 模拟旧 worker 晚归 | 不覆盖新 repair 状态，不回退 cursor/foundReferences | `deleteClothes`、`cleanupDeletedClothes` |
| 删除后打开 Today / 详情尝试收藏或确认穿着该衣物 | 不再允许引用 deleted 衣物 | `generateOutfit`、`deleteClothes`；Today、详情 |
| 删除 7 天后查看历史 / 收藏快照图 | 快照图仍可见 | `cleanupDeletedClothes`；历史、收藏、详情 |
| 多条记录共享同一 fileID/URL | 不误删仍被引用的共享 URL | `cleanupDeletedClothes` |
| 模拟 `cloud.deleteFile` 部分失败 | 不提前删除 clothes tombstone，保留可重试状态 | `cleanupDeletedClothes` |

### 上传识别幂等

| 测试步骤 | 预期结果 | 关联云函数 / 页面 |
| --- | --- | --- |
| 同一个 imageId 并发调用 `processUploadImage` 两次 | 只有一个 token 拥有写入权，AI 不重复跑或重复结果不落库 | `processUploadImage`；上传确认 |
| 人为制造 stale processing 后再次处理 | 新请求可接管，`processingAttempt` 增加 | `processUploadImage` |
| 旧请求晚归 | 不写草稿、不覆盖状态 | `processUploadImage` |
| 一张图识别多件衣服 | `draftId` 基于 `imageId + sourceAssetKey` 稳定 | `processUploadImage`；上传确认 |
| image 状态 detected 但只剩 discarded 草稿 | 可重新处理并补齐 pending 草稿 | `processUploadImage` |
| batch 已 discarded 后旧请求晚归 | 不新增 pending 草稿 | `processUploadImage`、`discardUploadBatch` |
| 部分草稿写失败后重试 | 重试补齐缺失草稿，不重复已有草稿 | `processUploadImage` |

### 已有衣服重新处理

| 测试步骤 | 预期结果 | 关联云函数 / 页面 |
| --- | --- | --- |
| 对同一衣服连续点击重新分割 | 后一次 token 生效，前一次晚归 superseded | `segmentClothImage`；衣物详情、衣橱 |
| 人为制造 A/B 两个分割请求晚归顺序反转 | B 成功后 A 不覆盖成功图 | `segmentClothImage` |
| 分割失败请求晚归到成功之后 | 不覆盖成功图和成功状态 | `segmentClothImage` |
| 连续点击属性识别 | 后一次 token 生效，旧请求 superseded | `recognizeClothAttributes`；衣物详情 |
| 识别期间手动编辑颜色 / 材质 / 厚薄 | AI 晚归不覆盖 manualFields 保护字段 | `recognizeClothAttributes`、`updateClothes` |
| 对 deleted 衣服调用重新分割/识别 | 返回拒绝或 superseded，不写新状态 | `segmentClothImage`、`recognizeClothAttributes` |
| superseded 后回到详情/衣橱刷新 | 页面不卡住，状态可恢复到最新成功或待处理 | `segmentClothImage`、`recognizeClothAttributes`、`getWardrobe` |

### 属性 alias

| 测试步骤 | 预期结果 | 关联云函数 / 页面 |
| --- | --- | --- |
| 编辑 `subcategory` 并保存 | `subcategory` 为 canonical，`subCategory` mirror 同步 | `updateClothes`、`getWardrobe`；衣物表单、详情 |
| 编辑 `colorPalette` 并保存 | `colorPalette` 保留，`colors` mirror 同步为颜色名数组 | `updateClothes`、`getWardrobe` |
| 编辑 `material` 并保存 | `material` 为 canonical，`materialGuess` mirror 同步 | `updateClothes`、`getWardrobe` |
| 调用 `getWardrobe` 列表和详情 | 返回 canonical + mirror，不破坏 legacy 数据读取 | `getWardrobe`；衣橱、详情 |
| 手动字段来自 legacy alias，例如 `color` / `style` / `materialGuess` | 重新识别不覆盖对应 canonical group | `recognizeClothAttributes`、`updateClothes` |

## 六、部署后烟测清单

每次部署后建议先跑以下 17 项：

1. 打开 Today，确认天气卡和推荐列表正常加载。
2. Today 收藏一套搭配，再取消收藏，确认状态即时一致。
3. 手动刷新天气一次，确认没有卡住 loading。
4. 进入穿搭详情，触发 AI 点评，退出后再进入确认复用。
5. 检查 `outfit_ai_reviews`，确认有 `reviewVersion=stylist-explanation-v2` 和 `inputDigest`。
6. 相同输入再次点击 AI 点评，确认直接复用且不再次调用模型。
7. 点击重新点评，确认 force refresh 不复用旧 digest 结果。
8. 模拟 malformed JSON，确认 fallback 正常且仍有 `title/reason/styleTags/tip`。
9. 检查点评文案，不出现身材、年龄、职业、身份推断，不虚构颜色、材质或设计元素。
10. 确认 AI 点评前后推荐顺序和 `scores.total` 完全不变。
11. 上传一张衣物图，进入上传确认页，确认草稿能出现。
12. 对同一上传图片快速触发两次处理，确认不出现重复草稿。
13. 确认一个草稿入库，确认衣橱和我的统计更新。
14. 编辑新入库衣物的子品类、颜色、材质，保存后重新打开确认字段存在。
15. 对已有衣服点击重新分割，确认图片状态最终稳定。
16. 对已有衣服点击重新识别，期间手动改颜色，确认 AI 不覆盖。
17. 删除一件被收藏/历史引用的衣物，确认历史/收藏快照仍可打开，Today 不再推荐 deleted 衣物。

## 七、未完成 / 后续优化

- 雨雪/风力/湿度/UV 真正参与推荐。
- `manualFields` 历史 backfill。
- Web/BFF 字段同步。
- `upload_batches` 状态机收敛。
- 数据生命周期与隐私合规。
- 自动化测试。
- lint warning 收口。
