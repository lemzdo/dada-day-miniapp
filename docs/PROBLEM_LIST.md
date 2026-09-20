# 搭搭day Problem List / Master Backlog

> 最后校准：2026-09-14
>
> 本文件是全项目唯一 Master Problem / Backlog 总账。产品主链状态快照见
> `docs/product/product-main-journey-status.md`；具体发布动作见
> `docs/release-checklist-core-stability.md`。其它文档不得建立平行总账。

## 0. 使用规则

后续 session 必须优先读取：

1. `AGENTS.md`
2. `docs/PROBLEM_LIST.md`
3. `docs/product/product-main-journey-status.md`

状态只允许 `OPEN`、`PARTIAL`、`NOT_STARTED`、`CLOSED`、`SUPERSEDED`、`FROZEN`、`UNKNOWN`。

- `OPEN`：已确认、尚未解决的问题或任务。
- `PARTIAL`：主体已有，但关键闭环仍缺失。
- `NOT_STARTED`：规划存在，尚无真正产品实现。
- `CLOSED`：原问题已经解决并有当前证据。
- `SUPERSEDED`：原任务被后续方案或更精确条目取代。
- `FROZEN`：已经完成并冻结；无新回归证据不得重开。
- `UNKNOWN`：当前证据不足，禁止猜测。

类型只允许 `BUG`、`RELEASE_BLOCKER`、`PRE_LAUNCH_REQUIRED`、`PRODUCT_ROADMAP`、
`ENGINEERING_DEBT`、`LONG_TERM`、`PROCESS_GUARDRAIL`、`CLOSED_HISTORY`。

优先级必须分开：

- `BUG_SEVERITY=P0/P1/P2/NONE`：只表示现有缺陷严重度。
- `ROADMAP_PRIORITY=R0/R1/R2/R3/NONE`：只表示产品/工程路线顺序。
- `RELEASE_PRIORITY=BLOCKER/REQUIRED/OPTIONAL/NONE`：只表示发布门禁。

`REQUIRED` 表示开发可以继续，但正式发布前必须关闭；只有当前已阻止发布执行的事项才标记
`BLOCKER`。缺少验收证据不等于已证明发生产品故障。历史聊天只能作为线索，状态必须以当前
repo、已提交证据和明确的远端验收记录为准。

## 1. 当前执行顺序

| 顺序 | 条目 | 为什么现在做 |
| --- | --- | --- |
| 1 | PB-04 微信本地 Storage 10MB 容量治理 | 当前唯一应挡在新产品开发前的真实 P1 Bug；继续增加本地状态会扩大 quota failure 风险。 |
| 2 | PB-08 / PB-21 / PB-22 Behavior-to-Recommendation Learning Loop V1 | PB-04 关闭后立即进入；这是唯一 `ROADMAP_PRIORITY=R0` 的产品主链 Goal。 |
| 3 | PB-29 全产品真实环境 E2E | 正式发布前验证 Upload 到 reopen/reload 的完整业务链，不能由 artifact contract 替代。 |
| 4 | PB-12 / PB-30 CloudBase 控制面与资源合同 | 核对集合、索引、权限、环境变量及 1024MB/0.8CPU 等关键资源配置。 |
| 5 | PB-16 / PB-33 / PB-34 安全、数据治理与容量发布执行 | 属于上线前必须关闭的操作门禁，不阻塞当前普通开发。 |

`BEFORE_NEW_FEATURE=PB-04`

`NEXT_PRODUCT_GOAL=Behavior-to-Recommendation Learning Loop V1`

## 2. Release Blockers

当前没有已经进入发布执行并正在阻止发布的独立 `TYPE=RELEASE_BLOCKER` 条目。

PB-04、PB-11、PB-12、PB-16、PB-17、PB-29、PB-30、PB-33、PB-34 的
`RELEASE_PRIORITY=REQUIRED`；若正式发布时仍未关闭，它们即成为发布 blocker。

## 3. Pre-launch Required

- PB-12：CloudBase 集合、索引、权限、环境变量和生产配置远端核验。
- PB-16：轮换曾出现在诊断执行记录中的生产凭据，并验证旧凭据失效。
- PB-17：真实微信 Upload → Digitize → Confirm → Wardrobe E2E。
- PB-29：全产品主链真实环境 E2E 与 reopen/reload smoke。
- PB-30：关键 Cloud Function 资源规格进入可验证合同。
- PB-33：用户数据、行为事件、缓存和图片资产生命周期/隐私治理。
- PB-34：衣橱容量 V1 的 Web migration、部署和体验版 smoke。

PB-04 是 `TYPE=BUG`，PB-11 是 `TYPE=ENGINEERING_DEBT`，但两者也必须在发布前关闭。

## 4. Product Roadmap

### R0

- PB-08：Behavior-to-Recommendation Learning 父任务。
- PB-21：Learned Profile 自动更新生命周期。
- PB-22：Behavior → Recommendation 生产消费闭环。
- PB-23：个性化成熟度从 Level 1 向 Level 2/3 推进的状态指标。

### R1

- PB-18：Detail 持久化与长期恢复合同。
- PB-20：Outfit-level 显式负反馈。
- PB-24：小搭深层点评的真实环境与个性化收口。

### R2

- PB-09：优秀穿搭组合资产化 / 个人穿搭库。

### R3

- 当前没有独立的短中期产品任务；严格 VTON 归入 Long-term。

## 5. Engineering Debt

- PB-03：统一 AI Gateway 仅完成 Recommendation first-card slice。
- PB-05 / PB-28：首卡图片可见性证据尚未闭合，但不是当前故障结论。
- PB-06：图片资产语义与多页面真实可见性仍有兼容边界。
- PB-10：部署可复现已完成，CI 自动发布未实现。
- PB-11：本地 storage/media cache、持久快照、生产 pool-save 与跨会话去重边界。
- PB-15：非 Recommendation Cloud Runtime 尚无同等级业务性能证据。
- PB-35：仓库级 CI 质量门禁未建立。

## 6. Long-term

- PB-07：个人衣橱关系链 / 衣橱知识图谱。
- PB-13：用户真人 + 自己衣橱的静态 AI 效果预览。
- PB-14：严格虚拟试衣 VTON。

这些能力不是当前 Bug 或发布 blocker，不得抢在 PB-04 和 R0 学习闭环之前。

## 7. Process Guardrails

- PB-27：miniapp `src → dist` freshness 规则。
- PB-31：Safe Copy 只允许 fail-open，不能回到正常路径提前退出。
- PB-32：Recommendation Runtime 2.2 当前冻结。

## 8. Closed / Superseded / Frozen

- PB-01：旧 Max vs Plus 原型被真实 Max control vs Flash race 取代。
- PB-02：Homepage AI Voice 生产化、缓存、HIT/MISS 与 Safe fallback 已关闭。
- PB-19：旧 Worn PARTIAL 合并项已拆解；功能闭环完成，学习部分由 PB-08/PB-22 管理。
- PB-25：历史白屏 / SDK timeout 按不可复现环境噪音关闭。
- PB-26：REFRESH_UI_001 已由真实换批证据关闭。
- PB-27、PB-31、PB-32：作为长期 guardrail / frozen contract 保留。

## 9. 全量条目

### PB-01 AI Voice 原型验证 / 模型竞速

- `PROBLEM_ID=` PB-01
- `TITLE=` AI Voice 原型验证 / 模型竞速
- `ORIGINAL_SOURCE=` historical problem list
- `STATUS=` SUPERSEDED
- `TYPE=` CLOSED_HISTORY
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` NONE
- `RELEASE_PRIORITY=` NONE
- `CURRENT_EVIDENCE=` 已完成真实 Max control vs Flash race；当前生产 renderer 为 `qwen-flash + compressed-v2 production-4`。
- `WHAT_IS_ALREADY_DONE=` 使用同一计划、prompt、parser 和 validator 对照真实模型，生产选择已落定。
- `WHAT_REMAINS=` 仅保留历史实验记录。
- `USER_IMPACT=` 无当前影响。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` NO
- `DEPENDENCIES=` `docs/performance/recommendation-baseline.md`、`docs/architecture/recommendation-runtime.md`。
- `NEXT_ACTION=` 无新回归证据不得重开模型竞速。

### PB-02 AI Voice 正式生产化 + 精细缓存

- `PROBLEM_ID=` PB-02
- `TITLE=` AI Voice 正式生产化 + 精细缓存
- `ORIGINAL_SOURCE=` historical problem list + current repo
- `STATUS=` CLOSED
- `TYPE=` CLOSED_HISTORY
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` NONE
- `RELEASE_PRIORITY=` NONE
- `CURRENT_EVIDENCE=` Canonical HIT 与 deterministic MISS 的 AI reason first-visible 均为 100%；正文可见最大值分别为 2030.8ms 与 2531.4ms，`SAFE_DEADLINE_RATE=0%`。
- `WHAT_IS_ALREADY_DONE=` 生产模型、provider path、canonical cache、Safe Copy fallback、可见性验收均完成。
- `WHAT_REMAINS=` 图片可见性证据单列 PB-28，不属于本项未完成。
- `USER_IMPACT=` Homepage AI 理由可稳定优先展示。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` NO
- `DEPENDENCIES=` `docs/qa/homepage-ai-first-reason-acceptance.md`。
- `NEXT_ACTION=` 作为关闭历史保留。

### PB-03 统一 AI Gateway / AI 调用基础设施

- `PROBLEM_ID=` PB-03
- `TITLE=` 统一 AI Gateway / AI 调用基础设施
- `ORIGINAL_SOURCE=` historical problem list + current repo
- `STATUS=` PARTIAL
- `TYPE=` ENGINEERING_DEBT
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` R1
- `RELEASE_PRIORITY=` OPTIONAL
- `CURRENT_EVIDENCE=` `@d1d/ai-core` 已覆盖 task registry、provider、deadline、错误归一化、validator、telemetry；Recommendation first-card 已接入统一入口。
- `WHAT_IS_ALREADY_DONE=` Homepage Recommendation AI slice 已生产化。
- `WHAT_REMAINS=` Upload、standalone recognition、stylist commentary、segmentation 等仍有直接 provider 调用；secret/provider/prompt/retry policy 未全项目统一。
- `USER_IMPACT=` 当前主链可用，主要风险是配置漂移、故障语义和 secret 生命周期不一致。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` NO
- `DEPENDENCIES=` 各 AI task 的部署包和 secret 配置。
- `NEXT_ACTION=` 按 task 逐步迁移，禁止引入 Function → Gateway Function 的额外同步 RPC。

### PB-04 微信本地 Storage 10MB 容量治理

- `PROBLEM_ID=` PB-04
- `TITLE=` 微信本地 Storage 10MB 容量治理
- `ORIGINAL_SOURCE=` historical problem list + current repo
- `STATUS=` PARTIAL
- `AUDIT_STATUS=` IMPLEMENTED_PARTIAL_DEVTOOLS_SMOKE
- `TYPE=` BUG
- `BUG_SEVERITY=` P1
- `ROADMAP_PRIORITY=` NONE
- `RELEASE_PRIORITY=` REQUIRED
- `ROOT_CAUSE=` `UNBOUNDED_CACHE + DUPLICATE_SNAPSHOTS + MISSING_EVICTION + MISSING_QUOTA_ERROR_HANDLING + WRONG_DATA_PLACEMENT`；另有 100 条完整 History 首页 payload 和 current scoped key migration 缺口。
- `CURRENT_EVIDENCE=` [PB-04 专项审计](qa/storage-10mb-audit.md) 已记录根因与 2026-09-20 实施证据：L1 steady-state production-shaped 模型 15.65 KiB，连续 20 次 Detail 与 History 后不增长，10 个 upload refs + migration meta 后 25.52 KiB；真实微信开发者工具从 3,852 KiB / 46 keys 迁移到 20 KiB / 7 keys，第二次 relaunch 保持稳定，局部 Favorite/Worn 与页面重入后为 28-29 KiB / 8 keys 且 legacy families=0；PB-04 专项 37/37、miniapp Node tests 351/351 通过。
- `AFFECTED_STORAGE_FAMILIES=` userStorage outfit detail/upload/Today state；pageCache Wardrobe/Profile/Favorite/History/Detail；direct identity/profile/weather/diagnostic keys。
- `WHAT_IS_ALREADY_DONE=` [Local Data & Cache Architecture V1](architecture/local-data-and-cache.md) 的 PHASE_1 代码已落地：deny-by-default registry、384/512 KiB budget、L0 runtime cache、固定 compact bootstrap、OutfitRef、单 upload workflow envelope、物理 TTL/选择性驱逐、quota retry once、登录/天气 fail-open、按用户 migration namespace v2 / checkpoint v4 与 lifecycle cleanup；真实迁移和冷启动容量稳定性已验证。
- `WHAT_REMAINS=` 完成真实 Upload/Confirm；消除或澄清 Detail automator 超时并跑 Detail×N；排查本次 Favorite 独立页 error 与 Worn 后 History 空态，再完成同一链路冷启动/重入；发布候选覆盖 0/200、200/200 与 quota 注入。未通过前不得标记 CLOSED。
- `USER_IMPACT=` 已安装用户的旧重复快照可在冷启动迁移中释放，正常本地投影保持远低于平台上限，且 cache 写失败不再反转登录/天气成功。当前剩余风险是 Upload、Favorite、Worn/History 与 Detail 长链尚无同一 release candidate 的完整真源闭环证据，而不是已观察到的新 Storage 线性增长。
- `MUST_FIX_BEFORE_NEW_FEATURE=` YES
- `MUST_FIX_BEFORE_LAUNCH=` YES
- `BLOCKS_BEHAVIOR_LEARNING=` YES；学习数据本身在云端，但闭环会提高 refresh/detail/favorite/wear/history 和长期使用频率，直接放大当前按已访问 outfit 增长的本地 cache 风险。
- `DEPENDENCIES=` PB-11 共用 local cache lifecycle 根因；PB-34 的 200 件容量不会一次写满 Storage，但会增加可达筛选/组合/详情，发布 smoke 必须加入 Storage 起止量证据。
- `TARGET_CONTRACT=` L1 是恢复控制面而非业务数据库；steady state ≤384 KiB、global soft budget 512 KiB；Today/Wardrobe/Profile/Weather 只允许固定 compact projection，Detail/Favorite/History 传 OutfitRef，图片二进制只在 L2/Cloud Storage，Behavior pending queue 未来上限50条/64KiB/72h。
- `NEXT_ACTION=` 执行真实 DevTools 集中 smoke 并回写 `currentSize/limitSize`；通过后再将 PB-04 标记 CLOSED。不得用 fixture 结果替代真机证据，也不得使用 `clearStorage()`。

### PB-05 Today 首卡可见性自动验收

- `PROBLEM_ID=` PB-05
- `TITLE=` Today 首卡可见性自动验收
- `ORIGINAL_SOURCE=` historical problem list + current repo
- `STATUS=` PARTIAL
- `TYPE=` ENGINEERING_DEBT
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` R2
- `RELEASE_PRIORITY=` OPTIONAL
- `CURRENT_EVIDENCE=` AI reason/content 自动验收 PASS；同轮 `FIRST_CARD_IMAGE_VISIBLE=NOT_EVALUATED_THIS_RUN`。
- `WHAT_IS_ALREADY_DONE=` 请求、state commit、节点可见和正文计时已经自动关联。
- `WHAT_REMAINS=` 若要宣称“完整首卡可见性 PASS”，需补真实图片 load/node visibility 样本。
- `USER_IMPACT=` 没有证据表明图片故障；当前只是图片指标未完成评估。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` NO
- `DEPENDENCIES=` PB-28、真实微信运行环境。
- `NEXT_ACTION=` 作为可选证据补测，不重开 Homepage 性能专项。

### PB-06 图片资产 Pipeline

- `PROBLEM_ID=` PB-06
- `TITLE=` 图片资产 Pipeline 标准化、完整性与展示治理
- `ORIGINAL_SOURCE=` historical problem list + current repo
- `STATUS=` PARTIAL
- `TYPE=` ENGINEERING_DEBT
- `BUG_SEVERITY=` P2
- `ROADMAP_PRIORITY=` R1
- `RELEASE_PRIORITY=` OPTIONAL
- `CURRENT_EVIDENCE=` Upload 到 clothes 主链已完成；`@d1d/garment-assets` 定义 asset/usage 语义，Today、Detail、Favorite、History 使用统一 resolver。
- `WHAT_IS_ALREADY_DONE=` crop/clean/thumbnail、deterministic integrity gate、prewarm 与 fallback 已有实现和测试。
- `WHAT_REMAINS=` legacy image aliases、normalized 生产链、media cache scope/TTL、broken asset 降级和多页面真实微信可见性仍需收口。
- `USER_IMPACT=` 正常路径可显示；边界情况下可能出现 fallback 不一致或临时 URL 失效。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` NO
- `DEPENDENCIES=` PB-11、PB-17、PB-29。
- `NEXT_ACTION=` 发布 smoke 覆盖 Wardrobe/Today/Detail/Favorite/History 图片连续性，再决定是否清 legacy alias。

### PB-07 个人衣橱关系链 / 衣橱知识图谱

- `PROBLEM_ID=` PB-07
- `TITLE=` 个人衣橱关系链 / 衣橱知识图谱
- `ORIGINAL_SOURCE=` historical problem list + product journey audit
- `STATUS=` NOT_STARTED
- `TYPE=` LONG_TERM
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` R2
- `RELEASE_PRIORITY=` OPTIONAL
- `CURRENT_EVIDENCE=` 当前只有 request-time relation fact、aesthetic compatibility 和 scene evidence。
- `WHAT_IS_ALREADY_DONE=` 推荐能临时计算组合关系。
- `WHAT_REMAINS=` 持久化 clothing-to-clothing edge、个人 co-occurrence、compatibility edge 和 learned relation。
- `USER_IMPACT=` 当前推荐可用，但不会积累个人衣物关系资产。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` NO
- `DEPENDENCIES=` PB-08/PB-22 的行为质量与关系失效语义。
- `NEXT_ACTION=` 学习闭环稳定后再设计 shadow edge；不得把 Candidate Pool 当知识图谱。

### PB-08 用户行为学习 + 个人推荐权重

- `PROBLEM_ID=` PB-08
- `TITLE=` Behavior-to-Recommendation Learning 父任务
- `ORIGINAL_SOURCE=` historical problem list + product journey audit
- `STATUS=` PARTIAL
- `TYPE=` PRODUCT_ROADMAP
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` R0
- `RELEASE_PRIORITY=` OPTIONAL
- `CURRENT_EVIDENCE=` exposure、detail、favorite/unfavorite、wear、manual refresh 可记录；learned profile builder 可生成 shadow 画像。
- `WHAT_IS_ALREADY_DONE=` 行为 schema、幂等写入、用户隔离、时间衰减、质量门控和 profile persistence 已有代码/测试。
- `WHAT_REMAINS=` 高置信事件质量、自动 refresh、Recommendation Input、受控权重、解释 evidence、回滚/重置。
- `USER_IMPACT=` 系统记录行为，但推荐不会因此更懂用户。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` NO
- `DEPENDENCIES=` PB-04 先关闭；子项 PB-21、PB-22，信号增强 PB-20。
- `NEXT_ACTION=` PB-04 后启动 Behavior-to-Recommendation Learning Loop V1，先 shadow 对照再 gated rollout。

### PB-09 优秀穿搭组合资产化 / 个人穿搭库

- `PROBLEM_ID=` PB-09
- `TITLE=` 优秀穿搭组合资产化 / 个人穿搭库
- `ORIGINAL_SOURCE=` historical problem list + product journey audit
- `STATUS=` NOT_STARTED
- `TYPE=` PRODUCT_ROADMAP
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` R2
- `RELEASE_PRIORITY=` OPTIONAL
- `CURRENT_EVIDENCE=` Favorite 是收藏状态、History 是穿着记录、Candidate Pool 是推荐缓存；三者都不是独立个人搭配库。
- `WHAT_IS_ALREADY_DONE=` canonical outfit、收藏快照和历史快照提供基础数据。
- `WHAT_REMAINS=` 长期 outfit asset、标签/分组、库内筛选、再次使用和组合维护边界。
- `USER_IMPACT=` 用户能找回收藏/历史，但不能经营自己的长期穿搭库。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` NO
- `DEPENDENCIES=` PB-18 的 detail/identity 恢复合同，PB-08 的行为语义。
- `NEXT_ACTION=` 学习闭环稳定后定义 Personal Outfit Library V1。

### PB-10 自动部署 / generateOutfit 发布可复现性

- `PROBLEM_ID=` PB-10
- `TITLE=` 自动部署 / generateOutfit 发布可复现性
- `ORIGINAL_SOURCE=` historical problem list + current repo
- `STATUS=` PARTIAL
- `TYPE=` ENGINEERING_DEBT
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` R2
- `RELEASE_PRIORITY=` OPTIONAL
- `CURRENT_EVIDENCE=` canonical artifact、manifest/hash、依赖闭包、isolated boot、Active wait、远端下载验证已完成；2026-09-02 为 26/26 remote verify。
- `WHAT_IS_ALREADY_DONE=` 手动执行 `pnpm cloud:deploy` 的 reproducible deployment 已 PASS。
- `WHAT_REMAINS=` 仓库无 CI workflow；fully automated deployment 未实现。
- `USER_IMPACT=` 当前可可靠手动发布，但依赖操作者触发。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` NO
- `DEPENDENCIES=` PB-12/PB-30 的控制面与资源核验。
- `NEXT_ACTION=` 后续把 canonical command 接入受控 CI；不回退到 DevTools/source deploy。

### PB-11 Cache Mutation / 旧数据 / 异常路径收口

- `PROBLEM_ID=` PB-11
- `TITLE=` Cache Mutation / 旧数据 / 异常路径收口
- `ORIGINAL_SOURCE=` historical problem list + current repo
- `STATUS=` PARTIAL
- `TYPE=` ENGINEERING_DEBT
- `BUG_SEVERITY=` P2
- `ROADMAP_PRIORITY=` R1
- `RELEASE_PRIORITY=` REQUIRED
- `CURRENT_EVIDENCE=` wardrobe mutation → hard invalid → fresh snapshot → new identity 已证明；Candidate Pool V3 有 owner/TTL/checksum/fail-open 防护。
- `WHAT_IS_ALREADY_DONE=` edit、re-identify、delete、upload confirm、stale request、partial pool write 和用户隔离的主要合同已有测试。
- `WHAT_REMAINS=` local storage/media cache 无统一 quota/TTL；rename 后部分 Favorite/History snapshot 同步、生产 pool-save budget、跨会话 seen ledger 和异常恢复 smoke 仍未闭合。
- `USER_IMPACT=` 主路径通常 fresh load；边界情况下可能出现旧标题、旧临时 URL、恢复不一致或跨会话重复推荐。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` YES
- `DEPENDENCIES=` PB-04、PB-29、PB-12。
- `NEXT_ACTION=` PB-04 中先收 local cache lifecycle；其余按真实 smoke 缺口处理，不重开 Recommendation identity 架构。

### PB-12 Cloud Collections / Index / Permission / Env

- `PROBLEM_ID=` PB-12
- `TITLE=` Cloud Collections / Index / Permission / Env 远端核验
- `ORIGINAL_SOURCE=` historical problem list + current repo
- `STATUS=` OPEN
- `TYPE=` PRE_LAUNCH_REQUIRED
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` NONE
- `RELEASE_PRIORITY=` REQUIRED
- `CURRENT_EVIDENCE=` Deployment Contract v2 证明函数 artifact/依赖闭包，不证明业务集合、索引、权限、环境变量或触发器实际值。
- `WHAT_IS_ALREADY_DONE=` 2026-09-02 的生产函数 remote artifact verify 为 26/26 PASS，配置要求已有文档。
- `WHAT_REMAINS=` 核对 `outfit_ai_reviews`、`outfit_behavior_events`、`learned_style_profiles`、相关索引/权限，以及 AMAP/Bailian/Aliyun/OSS 等远端配置。
- `USER_IMPACT=` 配置缺失会使相应业务在真实环境失败，但当前 repo 不能证明远端错误或正确。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` YES
- `DEPENDENCIES=` release environment、PB-30、PB-34。
- `NEXT_ACTION=` 发布候选版本上执行只读 inventory + 最小业务 smoke 并留证。

### PB-13 AI 真人穿搭效果预览

- `PROBLEM_ID=` PB-13
- `TITLE=` AI 真人穿搭效果预览
- `ORIGINAL_SOURCE=` historical problem list + product journey audit
- `STATUS=` NOT_STARTED
- `TYPE=` LONG_TERM
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` R2
- `RELEASE_PRIORITY=` OPTIONAL
- `CURRENT_EVIDENCE=` person parsing/crop/segmentation 用于上传识别，不存在“用户真人 + 自己衣橱”静态合成产品链。
- `WHAT_IS_ALREADY_DONE=` 衣物资产分割可作为未来输入基础。
- `WHAT_REMAINS=` 用户入口、合成 pipeline、结果持久化、质量/安全门禁。
- `USER_IMPACT=` 当前没有真人穿搭预览能力。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` NO
- `DEPENDENCIES=` 图片资产质量、用户授权与隐私、独立图像生成方案。
- `NEXT_ACTION=` 不在当前主线实施，并与严格 VTON 保持独立。

### PB-14 严格虚拟试衣 VTON

- `PROBLEM_ID=` PB-14
- `TITLE=` 严格虚拟试衣 VTON
- `ORIGINAL_SOURCE=` historical problem list + product journey audit
- `STATUS=` NOT_STARTED
- `TYPE=` LONG_TERM
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` R3
- `RELEASE_PRIORITY=` OPTIONAL
- `CURRENT_EVIDENCE=` 当前没有 person + garment virtual try-on pipeline。
- `WHAT_IS_ALREADY_DONE=` segmentation/parsing 只是输入处理，不构成 VTON。
- `WHAT_REMAINS=` 模型、姿态/遮挡、服装保持、质量、安全、成本和产品交互全链。
- `USER_IMPACT=` 当前不支持严格虚拟试衣。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` NO
- `DEPENDENCIES=` 长期图像生成基础设施与隐私合同。
- `NEXT_ACTION=` 长期保留，不提前绑定架构。

### PB-15 全项目 Cloud Runtime 性能体检

- `PROBLEM_ID=` PB-15
- `TITLE=` 全项目 Cloud Runtime 性能体检
- `ORIGINAL_SOURCE=` historical problem list + current repo
- `STATUS=` PARTIAL
- `TYPE=` ENGINEERING_DEBT
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` R2
- `RELEASE_PRIORITY=` OPTIONAL
- `CURRENT_EVIDENCE=` Recommendation/Homepage 性能专项 PASS；26 个函数 artifact 可启动不等于业务性能通过。
- `WHAT_IS_ALREADY_DONE=` Recommendation Runtime 2.2 的 server/core/首卡性能已完成并冻结。
- `WHAT_REMAINS=` Upload、Digitize、Wardrobe、History、Profile 等用户等待链没有同等级真实样本；当前也没有新慢路径回归证据。
- `USER_IMPACT=` 非 Recommendation 链的生产延迟/资源风险未知，但不能据此宣称已故障。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` NO
- `DEPENDENCIES=` 真实环境样本与独立性能审计授权。
- `NEXT_ACTION=` 仅在发布 smoke 或观测发现现实慢路径后做窄范围 profiling，不制造全量工程。

### PB-16 PRE_LAUNCH_SECURITY

- `PROBLEM_ID=` PB-16
- `TITLE=` 生产凭据上线前轮换
- `ORIGINAL_SOURCE=` historical problem list + release checklist
- `STATUS=` OPEN
- `TYPE=` PRE_LAUNCH_REQUIRED
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` NONE
- `RELEASE_PRIORITY=` REQUIRED
- `CURRENT_EVIDENCE=` 生产 API key/access token 曾被 CloudBase function detail 输出到诊断执行记录；当前决定是开发期不轮换、正式上线前轮换。
- `WHAT_IS_ALREADY_DONE=` Git 中未发现真实 secret 被提交；风险已登记。
- `WHAT_REMAINS=` 轮换所有受影响凭据，更新远端 secret/env，并验证旧凭据失效。
- `USER_IMPACT=` 开发期不影响功能；未轮换上线会形成凭据泄露风险。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` YES
- `DEPENDENCIES=` 生产账号权限、PB-12 配置核验。
- `NEXT_ACTION=` 在正式发布窗口执行轮换与失效验证，不在普通开发提交中泄露值。

### PB-17 真实微信 Upload E2E

- `PROBLEM_ID=` PB-17
- `TITLE=` 真实微信 Upload E2E
- `ORIGINAL_SOURCE=` product journey audit + current repo
- `STATUS=` OPEN
- `TYPE=` PRE_LAUNCH_REQUIRED
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` NONE
- `RELEASE_PRIORITY=` REQUIRED
- `CURRENT_EVIDENCE=` Upload/Digitize/Confirm/Wardrobe 有单元与合同证据，但 repo 没有已提交的真实微信完整 Upload E2E 证据；artifact audit 明确未调用业务函数。
- `WHAT_IS_ALREADY_DONE=` 主链代码判为 IMPLEMENTED，失败/重试/幂等有 targeted tests。
- `WHAT_REMAINS=` 真实微信或真机验证上传、处理、草稿确认、入衣橱、失败与重试，并保存证据。
- `USER_IMPACT=` 当前不是已知 Bug；只是正式环境主链缺少最终证明。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` YES
- `DEPENDENCIES=` PB-12、PB-29、发布候选小程序。
- `NEXT_ACTION=` 并入 PB-29 的全链 smoke，但保留 Upload 专项结果。

### PB-18 Detail PARTIAL

- `PROBLEM_ID=` PB-18
- `TITLE=` Detail 持久化与长期恢复
- `ORIGINAL_SOURCE=` product journey audit + current repo
- `STATUS=` PARTIAL
- `TYPE=` PRODUCT_ROADMAP
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` R1
- `RELEASE_PRIORITY=` OPTIONAL
- `CURRENT_EVIDENCE=` Today → Detail、canonical identity、完整衣物、Favorite/Worn 和主动深点评可用；V2 明确 `persistedDetailDocumentReady: false`。
- `WHAT_IS_ALREADY_DONE=` batch envelope/snapshot 可展示，AI review 有版本、digest、cache 和失败保留旧内容。
- `WHAT_REMAINS=` 独立 detail document、跨入口/reload 长期恢复合同，以及与 learned preference 的解释连接。
- `USER_IMPACT=` 当前可以查看详情；长期或跨入口恢复仍依赖 batch/snapshot 兼容路径。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` NO
- `DEPENDENCIES=` canonical outfit identity、snapshot version、PB-24。
- `NEXT_ACTION=` 先定义 detail persistence/re-entry 合同，不重做页面视觉。

### PB-19 Worn PARTIAL（历史合并项拆分）

- `PROBLEM_ID=` PB-19
- `TITLE=` Worn 功能闭环与学习闭环拆分
- `ORIGINAL_SOURCE=` product journey audit
- `STATUS=` SUPERSEDED
- `TYPE=` CLOSED_HISTORY
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` NONE
- `RELEASE_PRIORITY=` NONE
- `CURRENT_EVIDENCE=` 点击穿过 → `outfit_history` 持久化 → History/reload 已成立；Worn → Recommendation 未实现。
- `WHAT_IS_ALREADY_DONE=` Worn 产品功能闭环已完成。
- `WHAT_REMAINS=` 学习消费不再归本项，统一由 PB-08/PB-22 管理。
- `USER_IMPACT=` 用户可记录并找回穿着；推荐不会因穿过自动改变。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` NO
- `DEPENDENCIES=` PB-08、PB-22。
- `NEXT_ACTION=` 禁止再把“写入 History”误写成“推荐已经学习”。

### PB-20 Outfit-level Explicit Negative Feedback

- `PROBLEM_ID=` PB-20
- `TITLE=` Outfit-level Explicit Negative Feedback
- `ORIGINAL_SOURCE=` product journey audit + current repo
- `STATUS=` NOT_STARTED
- `TYPE=` PRODUCT_ROADMAP
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` R1
- `RELEASE_PRIORITY=` OPTIONAL
- `CURRENT_EVIDENCE=` 当前 `user_feedback` 是通用意见，未绑定 canonical outfit identity，也不进入推荐。
- `WHAT_IS_ALREADY_DONE=` 通用文本/图片反馈可提交，favorite/unfavorite 行为事件可记录。
- `WHAT_REMAINS=` “不喜欢/不适合/不想穿/少推荐这种”等结构化、可撤销、场景化负反馈及其聚合消费。
- `USER_IMPACT=` 用户无法直接教系统减少某类搭配。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` NO
- `DEPENDENCIES=` PB-08/PB-22 的画像生命周期和 canonical identity。
- `NEXT_ACTION=` 学习闭环接通后实现 2～4 个高置信原因，避免先造无消费方 telemetry。

### PB-21 Learned Profile Shadow 自动更新

- `PROBLEM_ID=` PB-21
- `TITLE=` Learned Profile Shadow 自动更新
- `ORIGINAL_SOURCE=` product journey audit + current repo
- `STATUS=` PARTIAL
- `TYPE=` PRODUCT_ROADMAP
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` R0
- `RELEASE_PRIORITY=` OPTIONAL
- `CURRENT_EVIDENCE=` `refreshLearnedStyleProfile` 能按当前用户聚合并幂等持久化 global/context shadow profile。
- `WHAT_IS_ALREADY_DONE=` 时间衰减、重复信号饱和、质量门控、source digest、用户隔离和安全返回已有测试。
- `WHAT_REMAINS=` 事件/调度触发、增量刷新、生命周期、观测、失败重试、回滚/重置和产品入口。
- `USER_IMPACT=` 正常使用不会自动得到更新后的画像。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` NO
- `DEPENDENCIES=` PB-08；事件质量与 profile version。
- `NEXT_ACTION=` 设计可幂等、可退化的自动 refresh policy，继续保持 shadow 不直接改排名。

### PB-22 Behavior → Recommendation Learning Loop

- `PROBLEM_ID=` PB-22
- `TITLE=` Behavior → Recommendation Learning Loop
- `ORIGINAL_SOURCE=` product journey audit + current repo
- `STATUS=` NOT_STARTED
- `TYPE=` PRODUCT_ROADMAP
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` R0
- `RELEASE_PRIORITY=` OPTIONAL
- `CURRENT_EVIDENCE=` Recommendation Input Snapshot 不读取 `learned_style_profiles`；eligibility、scoring、ranking 均不消费行为画像。
- `WHAT_IS_ALREADY_DONE=` 行为采集和 shadow aggregation 提供了前置基础。
- `WHAT_REMAINS=` 输入合同/version、quality gate、bounded weight、解释 evidence、shadow comparison、rollout 与 rollback。
- `USER_IMPACT=` 收藏、穿过、详情和换一批不会让下一次推荐产生可解释变化。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` NO
- `DEPENDENCIES=` PB-04 先关闭，PB-21 自动刷新；PB-32 冻结边界。
- `NEXT_ACTION=` 作为下一产品 Goal 的最终闭环，先影子对照再小权重启用。

### PB-23 Personalization Level

- `PROBLEM_ID=` PB-23
- `TITLE=` 当前个性化成熟度
- `ORIGINAL_SOURCE=` product journey audit
- `STATUS=` PARTIAL
- `TYPE=` PRODUCT_ROADMAP
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` R0
- `RELEASE_PRIORITY=` OPTIONAL
- `CURRENT_EVIDENCE=` `CURRENT_PERSONALIZATION_LEVEL=LEVEL_1_STATIC_PROFILE`；静态 profile 被推荐消费，行为和 learned profile 未被消费。
- `WHAT_IS_ALREADY_DONE=` 手工偏好、衣橱、天气和场景进入当前推荐输入。
- `WHAT_REMAINS=` Level 2 需要行为实际影响推荐；Level 3 需要长期聚合、稳定画像和可解释学习闭环。
- `USER_IMPACT=` 当前推荐能按明确偏好工作，但不会随着长期使用自动进化。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` NO
- `DEPENDENCIES=` PB-08/PB-21/PB-22。
- `NEXT_ACTION=` 作为 maturity indicator，不单独开发；随父任务更新等级。

### PB-24 Deep Xiaoda Commentary

- `PROBLEM_ID=` PB-24
- `TITLE=` 小搭深层点评
- `ORIGINAL_SOURCE=` product journey audit + current repo
- `STATUS=` PARTIAL
- `TYPE=` PRODUCT_ROADMAP
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` R1
- `RELEASE_PRIORITY=` OPTIONAL
- `CURRENT_EVIDENCE=` Detail 有结构化 stylist/aesthetic evidence、主动 AI 点评、validator、rule fallback、版本化 digest、缓存与失效。
- `WHAT_IS_ALREADY_DONE=` outfit-level analysis 和持久化 AI review 基础已存在，与 Homepage 一句话 reason 已分离。
- `WHAT_REMAINS=` 真实环境 Detail smoke、独立 detail asset，以及 learned preference 进入个性化解释。
- `USER_IMPACT=` 用户能获得更深解释，但生产可用性与“为什么适合我”的个性化深度尚未全部证明。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` NO
- `DEPENDENCIES=` PB-18、PB-22、`outfit_ai_reviews` 远端配置。
- `NEXT_ACTION=` 先做窄 smoke 和 persistence contract；保持“解释者不是选择器”，不改推荐分数。

### PB-25 Homepage White Screen / SDK Timeout

- `PROBLEM_ID=` PB-25
- `TITLE=` Homepage White Screen / SDK Timeout
- `ORIGINAL_SOURCE=` chat history
- `STATUS=` CLOSED
- `TYPE=` CLOSED_HISTORY
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` NONE
- `RELEASE_PRIORITY=` NONE
- `CURRENT_EVIDENCE=` 历史 fresh build 白屏后以 fresh bundle 复验不可复现；最新 Homepage 生产验收通过。
- `WHAT_IS_ALREADY_DONE=` 按环境噪音关闭，当前无 repo 回归证据。
- `WHAT_REMAINS=` 无。
- `USER_IMPACT=` 无当前已知影响。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` NO
- `DEPENDENCIES=` PB-27 freshness guardrail。
- `NEXT_ACTION=` 仅在新 correlated evidence 出现时新开回归项。

### PB-26 REFRESH_UI_001

- `PROBLEM_ID=` PB-26
- `TITLE=` 换一批看起来没变化
- `ORIGINAL_SOURCE=` chat history
- `STATUS=` CLOSED
- `TYPE=` CLOSED_HISTORY
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` NONE
- `RELEASE_PRIORITY=` NONE
- `CURRENT_EVIDENCE=` 三次真实 refresh 返回不同 batch、不同 first outfitKey，界面实际换衣；同一活跃客户端连续 48 套无重复。
- `WHAT_IS_ALREADY_DONE=` Refresh 用户可见链路与当前 identity 已验收。
- `WHAT_REMAINS=` 跨会话 seen ledger 属于 PB-11，不重开本项。
- `USER_IMPACT=` 原历史症状已消失。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` NO
- `DEPENDENCIES=` PB-32 frozen runtime。
- `NEXT_ACTION=` 保留关闭证据。

### PB-27 Miniapp Build Freshness Guardrail

- `PROBLEM_ID=` PB-27
- `TITLE=` Miniapp Build Freshness Guardrail
- `ORIGINAL_SOURCE=` chat history + current repo
- `STATUS=` FROZEN
- `TYPE=` PROCESS_GUARDRAIL
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` NONE
- `RELEASE_PRIORITY=` NONE
- `CURRENT_EVIDENCE=` DevTools“编译”不会执行 Taro source build；旧 dist 会制造假回归或假通过。
- `WHAT_IS_ALREADY_DONE=` 已形成 watcher alive 等待 `src → dist`，watcher absent 执行 `build:weapp` 的固定规则。
- `WHAT_REMAINS=` 每次 miniapp 真实验收持续执行并确认新产物进入 dist。
- `USER_IMPACT=` 避免用户验收到旧代码。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` NO
- `DEPENDENCIES=` miniapp 构建与 DevTools 流程。
- `NEXT_ACTION=` 永久保留，不作为产品 Bug。

### PB-28 Homepage Image Visible Metric

- `PROBLEM_ID=` PB-28
- `TITLE=` Homepage Image Visible Metric
- `ORIGINAL_SOURCE=` chat history + release checklist
- `STATUS=` PARTIAL
- `TYPE=` ENGINEERING_DEBT
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` R2
- `RELEASE_PRIORITY=` OPTIONAL
- `CURRENT_EVIDENCE=` 最新 Flash HIT/MISS 中图片 `onLoad` 未触发，image visible 为 null；AI reason/content 已 PASS。
- `WHAT_IS_ALREADY_DONE=` 图片与正文指标已分开，未把 null 误报为 PASS 或 failure。
- `WHAT_REMAINS=` 补一次真实 image load/node visibility 证据，或明确正式 release contract 不要求该自动指标。
- `USER_IMPACT=` 目前不能由 null 推断用户看不到图片。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` NO
- `DEPENDENCIES=` PB-05、PB-29。
- `NEXT_ACTION=` 在全产品 E2E 中顺带收集，不单独升级为 blocker。

### PB-29 全产品上线前 E2E

- `PROBLEM_ID=` PB-29
- `TITLE=` 全产品上线前真实环境 E2E
- `ORIGINAL_SOURCE=` chat history + product journey audit + current repo
- `STATUS=` OPEN
- `TYPE=` PRE_LAUNCH_REQUIRED
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` NONE
- `RELEASE_PRIORITY=` REQUIRED
- `CURRENT_EVIDENCE=` 单元/合同和局部 Recommendation 生产验收充分，但没有当前 HEAD 的 Upload → History → reopen/reload 全链真实环境证据。
- `WHAT_IS_ALREADY_DONE=` Recommendation/Homepage/Refresh 局部生产验收已通过，主链代码状态已审计。
- `WHAT_REMAINS=` Upload、Digitize、Confirm、Wardrobe、Today、Scene、Refresh、Detail、Favorite、Worn、History、reopen/reload 的同一 release candidate smoke。
- `USER_IMPACT=` 这是证据缺口，不代表已知全链故障；上线前不验证会放大集成风险。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` YES
- `DEPENDENCIES=` PB-12、PB-16、PB-17、PB-30、PB-34 与 release candidate。
- `NEXT_ACTION=` 建立一次可复现、留证的真实环境 checklist，不替代模块单测。

### PB-30 Cloud Function Resource Contract

- `PROBLEM_ID=` PB-30
- `TITLE=` Cloud Function Resource Contract
- `ORIGINAL_SOURCE=` chat history + current repo
- `STATUS=` PARTIAL
- `TYPE=` PRE_LAUNCH_REQUIRED
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` NONE
- `RELEASE_PRIORITY=` REQUIRED
- `CURRENT_EVIDENCE=` Recommendation 生产性能依赖 1024MB/0.8CPU；manifest 没有 memory/cpu/timeout 字段，deploy 保留远端配置但不读取、比较或强制。
- `WHAT_IS_ALREADY_DONE=` `recommendationStream` staging config 写入 1024MB，但没有 0.8CPU；真实生产资源提升后性能 PASS。
- `WHAT_REMAINS=` 0.8CPU 及关键资源值进入 manifest/remote verify gate；其他 CPU-sensitive function 也没有同类合同。
- `USER_IMPACT=` 远端配置漂移可让正确代码重新出现显著延迟。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` YES
- `DEPENDENCIES=` PB-10 canonical deploy、PB-12 remote config inventory。
- `NEXT_ACTION=` 扩展 deployment contract 的资源字段与只读 remote compare，避免上传时意外覆盖。

### PB-31 Safe Copy / Fallback Normal-path Exit

- `PROBLEM_ID=` PB-31
- `TITLE=` Safe Copy / Fallback Normal-path Exit
- `ORIGINAL_SOURCE=` chat history + current repo
- `STATUS=` FROZEN
- `TYPE=` PROCESS_GUARDRAIL
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` NONE
- `RELEASE_PRIORITY=` NONE
- `CURRENT_EVIDENCE=` Safe Copy 只允许 deadline/provider/validation failure；HIT/MISS 的 `SAFE_DEADLINE_RATE=0%`。
- `WHAT_IS_ALREADY_DONE=` 正常路径不再通过 Safe Copy 提前退出，failure taxonomy 和 provider error normalization 有测试。
- `WHAT_REMAINS=` 无当前缺口；维持 fail-open 合同。
- `USER_IMPACT=` AI 异常时仍有安全文案，正常请求优先真实 AI 理由。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` NO
- `DEPENDENCIES=` PB-02、PB-32。
- `NEXT_ACTION=` 无新回归证据不得扩大 fallback 或重开优化。

### PB-32 Recommendation Runtime 2.2

- `PROBLEM_ID=` PB-32
- `TITLE=` Recommendation Runtime 2.2
- `ORIGINAL_SOURCE=` chat history + current repo
- `STATUS=` FROZEN
- `TYPE=` PROCESS_GUARDRAIL
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` NONE
- `RELEASE_PRIORITY=` NONE
- `CURRENT_EVIDENCE=` bounded search、Candidate Pool V3、runtime boundary、scaling、correctness、server performance 和 refresh 已完成。
- `WHAT_IS_ALREADY_DONE=` `InputSnapshotService → Cache Coordinator → Recommendation Core → Result` 合同冻结；完整 generateOutfit 集合 105 files、887/887 PASS。
- `WHAT_REMAINS=` 无当前架构缺口。
- `USER_IMPACT=` 推荐主链当前稳定，服务端性能 PASS。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` NO
- `DEPENDENCIES=` `docs/architecture/recommendation-runtime.md`。
- `NEXT_ACTION=` 只接受新的真实回归；PB-22 通过输入扩展和外围融合实现，不重调 beam/reservoir/Core。

### PB-33 数据生命周期与隐私治理

- `PROBLEM_ID=` PB-33
- `TITLE=` 用户数据、行为事件、缓存与图片资产生命周期
- `ORIGINAL_SOURCE=` current repo
- `STATUS=` OPEN
- `TYPE=` PRE_LAUNCH_REQUIRED
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` NONE
- `RELEASE_PRIORITY=` REQUIRED
- `CURRENT_EVIDENCE=` release checklist 仍列“数据生命周期与隐私合规”；行为事件当前没有清理任务，仅建议聚合稳定后制定约 180 天保留策略。
- `WHAT_IS_ALREADY_DONE=` 用户数据有 `_openid` 隔离；行为事件最小化，不发送图片、标题、城市或 raw result；删除衣物有快照资产保护。
- `WHAT_REMAINS=` 明确保留期、删除/注销路径、缓存清理、行为/画像/图片资产生命周期、用户告知与发布验收。
- `USER_IMPACT=` 不影响当前开发功能，但上线后涉及用户控制、隐私和长期存储成本。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` YES
- `DEPENDENCIES=` PB-04、PB-12、PB-16、PB-21。
- `NEXT_ACTION=` 发布前形成最小数据清单、保留/删除合同和验证步骤，不在本项实现业务新功能。

### PB-34 衣橱容量 V1 发布执行

- `PROBLEM_ID=` PB-34
- `TITLE=` 衣橱容量 V1 migration、部署与 smoke
- `ORIGINAL_SOURCE=` current repo
- `STATUS=` OPEN
- `TYPE=` PRE_LAUNCH_REQUIRED
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` NONE
- `RELEASE_PRIORITY=` REQUIRED
- `CURRENT_EVIDENCE=` 代码/测试已完成 free=200 强制容量；release checklist 仍要求 Web/BFF、`005_wardrobe_capacity_v1.sql`、相关云函数和并发/边界 smoke。
- `WHAT_IS_ALREADY_DONE=` 容量 resolver、confirm gate、用户锁、Web transaction 和 200+ 件 recommendation pagination 已实现。
- `WHAT_REMAINS=` 对 release candidate 执行 migration/部署，并验证 199+1、199+2、200、删除释放、并发双批、伪造权益和 Web 第 201 件。
- `USER_IMPACT=` 未正确发布时，代码中的容量合同可能与真实数据库/前后端不一致。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` YES
- `DEPENDENCIES=` PB-12、PB-29。
- `NEXT_ACTION=` 纳入正式发布 runbook，执行后把证据回写本项和 release checklist。

### PB-35 仓库级 CI 质量门禁

- `PROBLEM_ID=` PB-35
- `TITLE=` 仓库级 CI 质量门禁
- `ORIGINAL_SOURCE=` current repo
- `STATUS=` NOT_STARTED
- `TYPE=` ENGINEERING_DEBT
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` R2
- `RELEASE_PRIORITY=` OPTIONAL
- `CURRENT_EVIDENCE=` 仓库未发现 `.github/workflows` 或等价 CI pipeline；质量命令和大量 tests 存在，但依赖人工执行。
- `WHAT_IS_ALREADY_DONE=` pnpm workspace、typecheck/lint/test 与 Cloud deployment contract 命令已定义。
- `WHAT_REMAINS=` 选择稳定的必跑集合、CI 环境、缓存、失败门禁和 artifact/report 保存。
- `USER_IMPACT=` 不直接改变产品体验，但人工漏跑会提高回归进入 main 的概率。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` NO
- `DEPENDENCIES=` 先校准可稳定执行的命令和耗时预算。
- `NEXT_ACTION=` 在不阻塞 R0 产品开发的前提下建立最小 PR/main quality gate。

### PB-36 Miniapp CloudBase 与 Web/PostgreSQL 数据面关系未收敛

- `PROBLEM_ID=` PB-36
- `TITLE=` Miniapp CloudBase 与 Web/PostgreSQL 数据面关系未收敛
- `ORIGINAL_SOURCE=` PB-04 Local Data & Cache Architecture V1 implementation review
- `STATUS=` NOT_STARTED
- `TYPE=` ENGINEERING_DEBT
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` R1
- `RELEASE_PRIORITY=` REQUIRED
- `CURRENT_EVIDENCE=` miniapp 直接调用 Cloud Function，并以 CloudBase 的 OPENID/集合记录作为用户业务真源；`apps/web` 同时通过 BFF、Drizzle 和 PostgreSQL 提供可写 clothes/outfits/history 数据模型。仓库内没有两套数据面的 owner 映射、双写、同步、迁移或退役合同。
- `WHAT_IS_ALREADY_DONE=` PB-04 明确 L1 不能掩盖两套后端差异，并暂定 CloudBase 为 miniapp canonical truth；Web/PostgreSQL 未纳入 PB-04 客户端 Storage 修复范围。
- `WHAT_REMAINS=` 决定 Web/PostgreSQL 是管理/镜像、未来迁移目标还是应退役的数据面；定义 user identity mapping、write owner、冲突策略、迁移/回滚、审计和发布顺序。
- `USER_IMPACT=` 当前 miniapp 主链不依赖 PostgreSQL，短期无直接体验回归；若后续 Web 管理、数据分析或迁移同时写入而无合同，可能出现跨端数据不一致和错误 canonical truth。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` YES
- `DEPENDENCIES=` PB-12 CloudBase 控制面、PB-29 全链 E2E；若选择迁移到 PostgreSQL，需单独 migration/rollback 方案。
- `NEXT_ACTION=` 产出数据面 ADR，逐领域列出 CloudBase/PostgreSQL 表或集合、读写 owner、同步方向和退役条件；未定稿前禁止新增跨数据面双写。

## 10. 去重与父子关系

- PB-08 是行为学习父任务；PB-21 负责 profile 自动更新，PB-22 负责 recommendation 消费，PB-23 只记录成熟度。任何一个子项存在都不能宣称学习闭环完成。
- PB-19 的“穿过功能”已完成；“穿过影响推荐”只在 PB-08/PB-22 跟踪，不再重复记 Bug。
- PB-05 是首卡自动验收父项，PB-28 只记录图片指标证据缺口。
- PB-06 是图片资产 Pipeline，PB-28 是首页图片可见性指标，两者不是同一问题。
- PB-13 是可接受的静态 AI 效果预览，PB-14 是严格 VTON，绝不合并。
- PB-10 是可复现/自动部署，PB-12 是云端业务配置验证，PB-30 是函数资源合同；三者相关但成功条件不同。
- PB-29 是发布前全链 E2E，PB-17 保留 Upload 专项，PB-24 保留 Detail 深点评专项。

## 11. 当前总账结论

- `BEFORE_NEW_FEATURE=PB-04`
- `BEFORE_LAUNCH=PB-04, PB-11, PB-12, PB-16, PB-17, PB-29, PB-30, PB-33, PB-34`
- `NEXT_PRODUCT_GOAL=Behavior-to-Recommendation Learning Loop V1`
- `CAN_START_BEHAVIOR_LEARNING_NOW=NO`
- `IF_NO_FIRST_TASK=PB-04 微信本地 Storage 10MB 容量治理`
- `CURRENT_PERSONALIZATION_LEVEL=LEVEL_1_STATIC_PROFILE`
- `PRODUCTION_RELEASE_READINESS=NOT_READY`
