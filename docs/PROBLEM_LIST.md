# 搭搭day Problem List / Master Backlog

> 最后校准：2026-09-24
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

## 1. V1 上线优化与验收顺序

| 顺序 | 条目 | 本阶段完成条件 |
| --- | --- | --- |
| 1 | PB-12 + PB-36 | 先核 CloudBase 真实查询与控制面，复现或排除 Favorite/History 异常；明确 Miniapp 与 Web 数据面的写入 owner。 |
| 2 | PB-34 | 完成 production-schema seeded wardrobe 的 0/200、接近满容量、200/200 产品规模 RC，并复用少量真实 ingestion 证据。 |
| 3 | PB-15 | 对非 Recommendation 关键 Cloud Runtime 做一次有界冷/暖体检，复用 PB-34、Upload 和 RC 请求。 |
| 4 | PB-03 | 按调用矩阵只处理已证明影响安全、正确性、成本或关键生产观测的缺口；统一框架迁移可后置。 |
| 5 | PB-11 | 关闭剩余 mutation、snapshot、stale response 和异常恢复的发布相关边界。 |
| 6 | PB-30 + PB-16 + PB-33 | 核对资源/部署合同，轮换受影响凭据，完成隐私告知和数据生命周期发布门禁。 |
| 7 | PB-29 | 在同一 release candidate 执行有限主链与异常 smoke，决定 `V1_RELEASE_READY=YES/NO`。 |

`BEFORE_NEW_FEATURE=NONE`

`NEXT_PRODUCT_GOAL=V1 release readiness`

`BEHAVIOR_LEARNING_POSITION=AFTER_INITIAL_RELEASE`：PB-08/PB-21/PB-22 保持产品路线 R0，但 R0 不表示 V1 技术发布 blocker。

## 2. Release Blockers

当前没有已经进入发布执行并正在阻止发布的独立 `TYPE=RELEASE_BLOCKER` 条目。

PB-03、PB-11、PB-12、PB-15、PB-16、PB-17、PB-29、PB-30、PB-33、PB-34、PB-36 的
`RELEASE_PRIORITY=REQUIRED`；正式发布前须关闭各自的 V1 门禁，PB-03 的长期治理可继续
保持 `PARTIAL`。未完成 V1 门禁即成为发布 blocker。

## 3. Pre-launch Required

- PB-12：CloudBase 集合、索引、权限、环境变量和生产配置远端核验。
- PB-03：只关闭调用矩阵已显示的密钥/Mock fallback/最小 AI 生产观测与成本边界；不要求全部迁入 AI Core。
- PB-16：轮换曾出现在诊断执行记录中的生产凭据，并验证旧凭据失效。
- PB-15：非 Recommendation 关键生产 Cloud Runtime 的有界冷/暖性能体检；仅对实测问题设修复门槛。
- PB-17：复用已通过的真实 Upload 主路径；失败/重试分支随 PB-29 的 RC 异常 smoke 闭合。
- PB-29：全产品主链真实环境 E2E 与 reopen/reload smoke。
- PB-30：关键 Cloud Function 资源规格进入可验证合同。
- PB-33：用户数据、行为事件、缓存和图片资产生命周期/隐私治理。
- PB-34：衣橱容量 V1 的 Web migration、部署和体验版 smoke。
- PB-36：确定 Miniapp CloudBase 与 Web/PostgreSQL 的数据 owner 和发布边界。

PB-04 已按 Storage 合同关闭；PB-18 已按正式 Detail 内容、操作、reload 与真实 UI smoke
关闭；PB-17 的 Upload 主路径已由 PB-04 真实 smoke 通过，失败/重试仍待 PB-29。PB-11 是
`TYPE=ENGINEERING_DEBT`，仍需在发布前关闭。PB-03 的特定安全/正确性/观测缺口纳入
发布门禁，但不要求为 V1 完成全项目 AI 框架迁移：其 `V1_DOD` 可单独验收关闭发布门禁，
PB-03 整体仍可因后续统一治理保持 `PARTIAL`。

## 4. Product Roadmap

### R0

- PB-08：Behavior-to-Recommendation Learning 父任务。
- PB-21：Learned Profile 自动更新生命周期。
- PB-22：Behavior → Recommendation 生产消费闭环。
- PB-23：个性化成熟度从 Level 1 向 Level 2/3 推进的状态指标。

### R1

- PB-20：Outfit-level 显式负反馈。
- PB-24：小搭深层点评的真实环境与个性化收口。

### R2

- PB-09：优秀穿搭组合资产化 / 个人穿搭库。

### R3

- 当前没有独立的短中期产品任务；严格 VTON 归入 Long-term。

## 5. Engineering Debt

- PB-03：共享 AI Core 仅覆盖 Recommendation first-card slice；其它调用需按风险收口。
- PB-05 / PB-28：首卡图片可见性证据尚未闭合，但不是当前故障结论。
- PB-06：图片资产语义与多页面真实可见性仍有兼容边界。
- PB-10：部署可复现已完成，CI 自动发布未实现。
- PB-11：持久快照、生产 pool-save、mutation/stale response 与跨会话去重边界；PB-04 的本地 Storage 合同已关闭。
- PB-15：非 Recommendation Cloud Runtime 尚无同等级业务性能证据；V1 做有界体检。
- PB-35：仓库级 CI 质量门禁未建立。
- PB-37：当前用户可见默认昵称/示例文案有“搭搭新朋友”“今日搭子”并存，需一次低优先级内容校准；未发现当前源码乱码证据。

## 6. Long-term

- PB-07：个人衣橱关系链 / 衣橱知识图谱。
- PB-13：用户真人 + 自己衣橱的静态 AI 效果预览。
- PB-14：严格虚拟试衣 VTON。

这些能力不是当前 Bug 或发布 blocker，不得抢在当前 R0 学习闭环之前。

## 7. Process Guardrails

- PB-27：miniapp `src → dist` freshness 规则。
- PB-31：Safe Copy 只允许 fail-open，不能回到正常路径提前退出。
- PB-32：Recommendation Runtime 2.2 当前冻结。

## 8. Closed / Superseded / Frozen

- PB-01：旧 Max vs Plus 原型被真实 Max control vs Flash race 取代。
- PB-02：Homepage AI Voice 生产化、缓存、HIT/MISS 与 Safe fallback 已关闭。
- PB-04：Local Storage placement/lifecycle/capacity/quota/migration 已由真实 DevTools smoke 关闭。
- PB-18：Today → V2 OutfitRef → 正式 Detail、Favorite/Worn、现有 AI 点评与 reload 已由真实 DevTools smoke 关闭。
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

### PB-03 AI Common Management / 共享 AI 调用基础设施

- `PROBLEM_ID=` PB-03
- `TITLE=` AI Common Management / 共享 AI 调用基础设施
- `ORIGINAL_SOURCE=` historical problem list + current repo
- `STATUS=` PARTIAL
- `TYPE=` ENGINEERING_DEBT
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` R1
- `RELEASE_PRIORITY=` REQUIRED
- `ORIGINAL_GOAL=` 统一 Task Registry、Provider Adapter、model routing、Prompt Registry/version、Validator、timeout/retry/fallback、latency/失败/token/cost telemetry 与 SecretProvider/key management。业务函数优先共享进程内 `@d1d/ai-core`，不通过同步远端 aiGateway Function 增加冷启动和网络 hop。
- `CURRENT_EVIDENCE=` `@d1d/ai-core` 已有 task registry、DashScope provider、deadline、错误归一化、validator 元数据、SecretProvider 抽象；只有 Recommendation first-card 主路径接入。Core `retry` 目前主要是 policy 元数据，通用 telemetry 默认 no-op；首卡 `rawResponse` 实际由 renderer 校验。上传 `estimatedCost` 固定为 0，Web 识别失败可 fallback 到 Mock 且按成功识别返回。线上密钥注入/轮换状态 UNKNOWN。
- `WHAT_IS_ALREADY_DONE=` Homepage Recommendation AI slice 已生产化并有独立性能/可见性证据；上传和点评各自有校验、错误状态或 fallback。源码未见活跃路径硬编码密钥。
- `WHAT_REMAINS=` V1 先核各生产函数的密钥只在服务端注入、provider/validation failure 与实际 retry 的语义；若 Web 识别入口随 V1 发布，核其 Mock fallback 是否误导用户。衣物识别/数字化等关键 path 需有最小 latency、provider/validation failure、token usage、estimated cost 记录与任务成本上限。全 task 的 prompt/model registry、统一 provider/SecretProvider 迁移和完整告警可后置。
- `V1_DOD=` 用部署配置和定向故障演练证明客户端不持有 secret、关键 AI 失败不会伪装成可信真实识别、失败/重试次数有界；关键 pipeline 能按 task/model/prompt version 追踪成功/失败、耗时、provider/validation failure、token 和估算成本（provider 不返回 usage 时明确 UNKNOWN 而非 0）。不要求所有 callsite 改成 AI Core。
- `USER_IMPACT=` 当前主链可用，但 Web Mock 成功语义、未计费调用与分散配置会影响识别可信度和生产成本判断；不能据此宣称线上已经泄漏或超预算。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` YES
- `PRELAUNCH_SCOPE=` 仅 V1_DOD；全量框架迁移仍属工程债。
- `DEPENDENCIES=` 各 AI task 的部署包和 secret 配置。
- `NEXT_ACTION=` 结合 PB-15 真实请求先核 V1 风险项；后续按 task 渐进迁入共享进程内 AI Core，禁止 Function → Gateway Function 的额外同步 RPC。

当前生产 AI callsite 矩阵（依据源码；线上配置与实际费用仍为 UNKNOWN）：

源码核对点：`packages/ai-core/src/{index,registry,telemetry}.js`、`packages/ai/src/providers/siliconflow.ts`、`apps/web/src/app/api/v1/clothes/route.ts`、`apps/miniapp/cloudfunctions/{processUploadImage,recognizeClothAttributes,segmentClothImage,generateOutfit}`；矩阵不把未接线 provider 当生产调用。

| CALLSITE / TASK | PROVIDER / MODEL_SOURCE | PROMPT_OWNER / VALIDATOR | TIMEOUT_RETRY / SECRET_SOURCE | TELEMETRY / AI_CORE_USED | 风险分类 |
| --- | --- | --- | --- | --- | --- |
| Web `clothes` upload recognition | SiliconFlow / 默认 Qwen2.5-VL-32B | `packages/ai` SiliconFlow prompt/JSON+默认值 | 无显式 timeout；结构化失败再请求；`SILICONFLOW_API_KEY` env | console 错误；无 token/cost/成功耗时；NO | CORRECTNESS、COST、OBSERVABILITY：SmartProvider 可 Mock fallback |
| Miniapp `processUploadImage` router/detection/attribute | Bailian 多模型 env/default；分割另用 Aitryon/VIAPI | `wardrobeAssetPipeline` 自有 prompt/JSON/bbox/属性校验 | AI 30s、最多一次 retry；Bailian/Aliyun env | stage 状态/耗时，`estimatedCost=0`，缺 usage；NO | COST、OBSERVABILITY、ENGINEERING_ONLY |
| `recognizeClothAttributes` | Bailian / attribute model env/default | 函数内 prompt/JSON+字段归一化 | 20s、retry 一次；`BAILIAN_API_KEY` env | 状态/model/error；缺 token/cost/耗时；NO | OBSERVABILITY、ENGINEERING_ONLY |
| `generateOutfit` AI commentary | Bailian / `XIAODA_AI_COMMENT_MODEL` | `stylistExplanationV2` prompt/业务 validator | 15s、最多三次尝试；Bailian/DashScope env | debug 有 attempts/validation/fallback；缺 token/cost/耗时；NO | COST、OBSERVABILITY |
| Recommendation first-card reason | DashScope / AI Core registry `qwen-flash` | voice contract + renderer validator | orchestrator deadline、retry=0；AI Core legacy env SecretProvider | usage 可读、独立耗时证据；Core 通用 telemetry no-op；YES | OBSERVABILITY：usage 未全量持久账本 |
| `segmentClothImage` | Aliyun VIAPI / `SegmentCloth` | 无文本 prompt；图片完整性 gate | 60s、retry 一次；Aliyun env | request/error；缺费用/耗时；NO | COST、OBSERVABILITY |
| shadow voice renderer（默认关闭） | DashScope / contract 或实验模型 | voice contract validator | 25s、无自动 retry；env | 返回 token/latency，生产持久化 UNKNOWN；NO | ENGINEERING_ONLY，启用时再核成本 |

未接线的 `packages/ai` provider exports 与手动 benchmark 脚本不计作当前生产调用点。矩阵给的是源代码边界，不能代替线上 provider failure rate 或真实 token/cost 观测。

### PB-04 微信本地 Storage 10MB 容量治理

- `PROBLEM_ID=` PB-04
- `TITLE=` 微信本地 Storage 10MB 容量治理
- `ORIGINAL_SOURCE=` historical problem list + current repo
- `STATUS=` CLOSED
- `AUDIT_STATUS=` CLOSED
- `TYPE=` CLOSED_HISTORY
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` NONE
- `RELEASE_PRIORITY=` NONE
- `ROOT_CAUSE=` `UNBOUNDED_CACHE + DUPLICATE_SNAPSHOTS + MISSING_EVICTION + MISSING_QUOTA_ERROR_HANDLING + WRONG_DATA_PLACEMENT`；另有 100 条完整 History 首页 payload 和 current scoped key migration 缺口。
- `CURRENT_EVIDENCE=` [PB-04 专项审计](qa/storage-10mb-audit.md) 已记录根因与 2026-09-20 实施/真实 smoke 证据：L1 steady-state production-shaped 模型 15.65 KiB，生产同形 Detail L0 cache 连续 20 个不同详情和 20 次重入均受 16 项上限约束且 L1 不增长；真实微信开发者工具从 3,852 KiB / 46 keys 迁移到 20 KiB / 7 keys 并稳定重启。最终真实 Upload → Digitize → Confirm → Wardrobe 使衣橱从 34/200 增至 37/200，Storage 为 19/7 → 29/9 → terminal 后 29 KiB / 8 keys，workflow/legacy batch refs 清零；手动 Detail×10 前后均为 29 KiB / 8 keys，legacy Detail families=0。PB-04 专项 39/39 通过，quota 注入覆盖 TEMP → expired → permitted CACHE、exactly-once retry、登录/天气 fail-open。
- `AFFECTED_STORAGE_FAMILIES=` userStorage outfit detail/upload/Today state；pageCache Wardrobe/Profile/Favorite/History/Detail；direct identity/profile/weather/diagnostic keys。
- `WHAT_IS_ALREADY_DONE=` [Local Data & Cache Architecture V1](architecture/local-data-and-cache.md) 的 PHASE_1 代码已落地：deny-by-default registry、384/512 KiB budget、L0 runtime cache、固定 compact bootstrap、OutfitRef、单 upload workflow envelope、物理 TTL/选择性驱逐、quota retry once、登录/天气 fail-open、按用户 migration namespace v2 / checkpoint v4 与 lifecycle cleanup；真实迁移和冷启动容量稳定性已验证。
- `WHAT_REMAINS=` PB-04 范围内无剩余事项。PB-18 V2 Detail renderer 已关闭；Favorite/History 归 PB-12；0/200、200/200 归 PB-34。
- `USER_IMPACT=` 已安装用户的旧重复快照可在冷启动迁移中释放，正常本地投影保持 20–29 KiB，Upload terminal cleanup 不丢衣物，Detail×10 不增加 bytes/keys。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` NO
- `BLOCKS_BEHAVIOR_LEARNING=` NO；后续本地状态仍必须遵守 PB-04 已冻结的 registry/budget/lifecycle 合同。
- `DEPENDENCIES=` NONE；PB-11、PB-12、PB-34 保持各自独立范围，PB-18 已关闭。
- `TARGET_CONTRACT=` L1 是恢复控制面而非业务数据库；steady state ≤384 KiB、global soft budget 512 KiB；Today/Wardrobe/Profile/Weather 只允许固定 compact projection，Detail/Favorite/History 传 OutfitRef，图片二进制只在 L2/Cloud Storage，Behavior pending queue 未来上限50条/64KiB/72h。
- `NEXT_ACTION=` 作为关闭历史保留；不得用页面问题重开 PB-04，除非出现新的直接 Storage regression 证据。

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
- `ORIGINAL_BENCHMARK_INTENT=` 约 60 张真实衣物图记录识别、裁切/分割结果、错误、耗时和质量分布，以检查事实资产与展示资产链；后续生成式展示资产是独立增强，不是现有入库事实来源。
- `IMAGE_REAL_BENCHMARK_DONE=` NO（当前 repo/artifacts/docs 未见这组真实图片样本及汇总报告；仓库外是否做过为 UNKNOWN）。PB-04 的一张真实图/三件衣物只证明主链成功，不等于约 60 图 benchmark。
- `V1_RELEASE_REQUIREMENT=` PB-29 在同一 RC 验证 Wardrobe/Today/Detail/Favorite/History 的真实图片连续性与坏图 fallback；约 60 图质量/耗时 benchmark 放 POST_LAUNCH，除非 RC 暴露图片正确性故障。
- `DOD=` V1 的图片事实来源与展示 fallback 在主链 smoke 中可见且错误不丢事实资产；后续专项 benchmark 留样本来源、结果/失败分类、耗时、版本和人工质量结论。
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
- `DEPENDENCIES=` PB-04 与 PB-18 已关闭；子项 PB-21、PB-22，信号增强 PB-20。
- `NEXT_ACTION=` 首次 V1 发布后启动 Behavior-to-Recommendation Learning Loop V1，先 shadow 对照再 gated rollout。

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
- `DEPENDENCIES=` PB-18 已提供 detail/identity 基础，后续依赖 PB-08 的行为语义。
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
- `WHAT_REMAINS=` PB-04 的 L1 storage registry/budget/TTL/lifecycle 已关闭；本项仍需核 rename 后 Favorite/History snapshot 同步、media URL 失效、生产 pool-save budget、跨会话 seen ledger，以及 mutation/stale response/异常恢复的真实 smoke。
- `USER_IMPACT=` 主路径通常 fresh load；边界情况下可能出现旧标题、旧临时 URL、恢复不一致或跨会话重复推荐。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` YES
- `DEPENDENCIES=` PB-04、PB-29、PB-12。
- `NEXT_ACTION=` 只对剩余 mutation、snapshot 和异常路径收集真实证据并修复，不重开 PB-04 或 Recommendation identity 架构。

### PB-12 Cloud Collections / Index / Permission / Env

- `PROBLEM_ID=` PB-12
- `TITLE=` Cloud Collections / Index / Permission / Env 远端核验
- `ORIGINAL_SOURCE=` historical problem list + current repo
- `STATUS=` OPEN
- `TYPE=` PRE_LAUNCH_REQUIRED
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` NONE
- `RELEASE_PRIORITY=` REQUIRED
- `CURRENT_EVIDENCE=` Deployment Contract v2 证明函数 artifact/依赖闭包，不证明业务集合、索引、权限、环境变量或触发器实际值。PB-04 closure attribution 中，Favorite 独立页一次 error 只可能由 `listFavoriteOutfits` 云查询/transport 触发；Worn 已在 history 事务成功边界返回，但同次 History 页面为空。两者均未在仓库专项测试复现，且发生在 OutfitRef Detail 恢复之前。
- `WHAT_IS_ALREADY_DONE=` 2026-09-02 的生产函数 remote artifact verify 为 26/26 PASS，配置要求已有文档。
- `WHAT_REMAINS=` 核对 `outfit_ai_reviews`、`outfit_behavior_events`、`learned_style_profiles`、Favorite/History 相关 collection/index/permission 与函数部署环境，以及 AMAP/Bailian/Aliyun/OSS 等远端配置；在同一发布候选重跑 Favorite → Worn → History → reopen/reload 并保留云函数错误码/查询结果。
- `ORIGINAL_RELEASE_SCOPE=` collections、真实查询字段对应 indexes、permission rules、环境变量、触发器、外部 HTTP provider 的生产网络/域名配置与业务查询验证；26/26 artifact verify 不覆盖这些控制面值。
- `DOD=` 留当前 RC 的脱敏远端 inventory、查询计划/索引与权限核对、配置存在性及网络可达性结果；对 Favorite/History 异常给实际错误码和数据查询证据，修复或排除后才关闭。
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
- `ROADMAP_PRIORITY=` NONE
- `RELEASE_PRIORITY=` REQUIRED
- `ORIGINAL_GOAL=` 对整个搭搭day Cloud Runtime 识别用户等待链的冷启动、暖调用、依赖装载、DB/Provider 扇出与资源风险；不是再测已冻结的 Recommendation。
- `CURRENT_EVIDENCE=` Recommendation/Homepage 性能专项 PASS；26 个函数 artifact 可启动不等于业务性能通过。[静态运行时审计](architecture/backend-runtime-audit.md) 与当前源码可确认拓扑，但非 Recommendation 冷/暖延迟和远端资源规格仍为 UNKNOWN。
- `WHAT_IS_ALREADY_DONE=` Recommendation Runtime 2.2 的 server/core/首卡性能已完成并冻结；登录/天气/衣橱有缓存，上传处理有 lease/幂等，确认入库有容量 lease 与 3-worker 上限。当前未发现需等待的同步 Function-to-Function RPC；上传是客户端跨独立部署单元的顺序编排。
- `WHAT_REMAINS=` 借 PB-34/Upload/RC 请求对 login、getWeather、getWardrobe、processUploadImage、confirmClothesDrafts，以及有用户入口时的 segmentClothImage、recognizeClothAttributes 采有界真实冷/暖样本；History/Profile 与 generateOutfit 非推荐 action 的用户等待结果纳入同次 RC 记录。只对实测慢点做窄范围归因。
- `DOD=` 每条关键路径记录当前入口、部署单元、HTTP/event/callable 合同、函数/共享模块拓扑、DB/Provider 调用、依赖与资源配置、一个可辨认冷样本和暖样本、端到端及函数耗时、成功/失败结果。无法辨认冷暖时标 UNKNOWN，不伪造 P95/SLA；无实测问题时结束体检，不扩成无限性能工程。
- `USER_IMPACT=` 非 Recommendation 链的生产延迟/资源风险未知，但不能据此宣称已故障。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` YES
- `PRELAUNCH_SCOPE=` 有界体检，不要求统一优化所有函数。
- `DEPENDENCIES=` PB-34、PB-29 的真实 RC 请求和 PB-30 资源清单。
- `NEXT_ACTION=` 复用下一轮 RC 请求采最小冷/暖证据；发现问题后只修受影响链路。

当前入口与调用拓扑（`UNKNOWN` 表示未取得真实远端/冷暖证据；静态路径见 [runtime audit](architecture/backend-runtime-audit.md)）：

| 用户路径 | CURRENT_ENTRY / DEPLOYMENT_UNIT | CALL_TOPOLOGY / 已有措施 | KNOWN_COLD_START_EVIDENCE / KNOWN_WARM_EVIDENCE | KNOWN_RUNTIME_ISSUE / ALREADY_OPTIMIZED |
| --- | --- | --- | --- | --- |
| Login | `userStore → loginWithCloud → login` callable | 单函数读/写 `users`，无 provider | UNKNOWN / UNKNOWN | ISSUE=UNKNOWN；OPTIMIZED=NO（无已知专项） |
| Weather | `WeatherCard → getCloudWeather → getWeather` callable | 客户端/服务端缓存；miss 时 `weather_cache → Amap` | UNKNOWN / UNKNOWN | ISSUE=UNKNOWN；OPTIMIZED=YES（双层 10 分钟缓存） |
| Wardrobe | 页面 → `getWardrobe` callable | 列表 count/分页/容量并行 DB 查询；客户端 15 秒缓存 | UNKNOWN / UNKNOWN | ISSUE=UNKNOWN（大衣橱真实分页未测）；OPTIMIZED=YES（capacityOnly/详情分流） |
| Upload/Digitize | Wardrobe → `createUploadBatch`/`createUploadImage`；Upload Confirm → `processUploadImage` callable | 客户端直传 Storage 后逐图调用；同函数内路由/检测/分割/属性识别，访问 Bailian/Aliyun 与多集合 | UNKNOWN / UNKNOWN | ISSUE=UNKNOWN（主路径通过，无延迟证据）；OPTIMIZED=YES（lease/幂等/质量 fallback） |
| 手动分割 | 页面 → `segmentClothImage` callable | 独立函数 → 图片读取/处理/存储 → Aliyun SegmentCloth | UNKNOWN / UNKNOWN | ISSUE=UNKNOWN（内部 provider 超时 60 秒）；OPTIMIZED=YES（attempt token/完整性 gate） |
| 手动重识别 | 页面 → `recognizeClothAttributes` callable | 独立函数 → 临时图 URL/事务 → Bailian Qwen | UNKNOWN / UNKNOWN | ISSUE=UNKNOWN（内部 AI 超时 20 秒）；OPTIMIZED=YES（token/heartbeat/一次重试） |
| Confirm | Upload Confirm → `confirmClothesDrafts` callable | 单函数容量 lease、查重及逐草稿 DB 写入，上限 3 worker；无 provider | UNKNOWN / UNKNOWN | ISSUE=UNKNOWN（数量相关扇出未测）；OPTIMIZED=YES（容量锁/并行上限） |

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
- `STATUS=` PARTIAL
- `TYPE=` PRE_LAUNCH_REQUIRED
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` NONE
- `RELEASE_PRIORITY=` REQUIRED
- `ORIGINAL_GOAL=` 在真实微信开发者工具中使用真实图片，从 Upload、Digitize、Confirm 到 Wardrobe 验证衣物确实入库且可见。
- `CURRENT_EVIDENCE=` [PB-04 真实 smoke](qa/storage-10mb-audit.md) 记录同一 develop CloudBase 用户、真实衣物图片和 UI 操作：一次图片识别 3 件，Confirm 后 Wardrobe 从 34/200 增至 37/200，新增衣物 UI 可见；没有用 fixture 替代。
- `WHAT_IS_ALREADY_DONE=` Upload → Digitize → Confirm → Wardrobe 主路径真实 PASS；失败/重试/幂等另有 targeted tests。
- `WHAT_REMAINS=` 原有 DoD 还含失败/重试真实验收，PB-04 的成功主路径不能证明这些分支；由 PB-29 在当前 release candidate 的有限 AI 失败/重试 smoke 中顺带闭合，不为形式重复上传 200 张或重跑同一旧版本。
- `DOD=` 真实图片完成上述四段，确认新增衣物在 Wardrobe 可见，并保存可审计记录；同时证明一次可恢复的失败/重试分支。主路径已满足，异常分支未完成。
- `USER_IMPACT=` 上传到衣橱的主链已有真实通过证据；这不代表当前发布候选或所有失败分支已验收。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` YES
- `DEPENDENCIES=` PB-29 保留最终发布候选复验。
- `NEXT_ACTION=` PB-29 复用主路径证据，并在同一 RC 异常矩阵中补失败/重试后关闭本项。

### PB-18 Detail 正式产品链恢复

- `PROBLEM_ID=` PB-18
- `TITLE=` Today → Detail 正式产品链恢复与长期恢复
- `ORIGINAL_SOURCE=` product journey audit + current repo
- `STATUS=` CLOSED
- `TYPE=` CLOSED_HISTORY
- `BUG_SEVERITY=` NONE
- `ROADMAP_PRIORITY=` NONE
- `RELEASE_PRIORITY=` NONE
- `CURRENT_EVIDENCE=` 2026-09-22 真实 DevTools smoke 已从 Today 进入 V2 OutfitRef 正式 Detail，验证 4 个单品、天气/场景/推荐理由、Favorite、Worn、真实 AI 点评、单品详情跳转、Today 回显、Detail 再进入及直接 reload；前后 storage 均为 19 KiB/7 keys，legacy detail keys 为 0。
- `DETAIL_ROUTE=` Today `openV2Detail` → `buildOutfitDetailUrl(OutfitRefV1)` → `pages/outfit-detail/index` → `detailV2` → V2 正式 view model → 既有正式 renderer。
- `DETAIL_DATA=` `detailV2` 以 `batchId + outfitKey + referenceId` 三重身份解析 immutable batch envelope，返回正式 items/status/context/copy 与可选 persisted `outfitId`；历史 V2 safe reason 可由服务端确定性恢复。
- `DETAIL_RENDERER=` V2 shell/placeholder 与生产 early return 已移除；V2 数据适配后复用同文件正式 Detail renderer，并显式覆盖 loading、not-found 与 remote-error。
- `DETAIL_PRODUCT_FUNCTIONS=` Favorite 与 Worn 使用 V2 canonical action 并同步 Today；现有 AI commentary 可从 immutable V2 envelope 解析，单品可进入 clothing-detail，reload/re-entry 可恢复同一 OutfitRef 状态。
- `IS_PLACEHOLDER_IN_PRODUCTION_PATH=` NO
- `PB18_ROOT_CAUSE_SCOPE=` c9532c8 新增的 V2 Detail shell/placeholder 和生产 early return 绕过了仍存在的正式 renderer；根因不在 Local Storage、OutfitRef identity 或 PB-12 远端列表异常。
- `WHAT_IS_ALREADY_DONE=` 保持 OutfitRef、immutable batch envelope、L0 16-entry bounded cache 与 PB-04 Storage 架构不变，完成 V2 正式 view model、基础内容、状态、交互、AI source resolution、safe-copy 恢复和真实环境验收。
- `WHAT_REMAINS=` 本项无。独立持久化 detail document 与 learned preference 驱动的更深个性化解释继续由 PB-24 管理；Favorite/History 独立远端查询异常继续由 PB-12 管理。
- `USER_IMPACT=` 用户从 Today 可获得正式搭配详情并完成收藏、穿着、AI 点评和单品查看；页面重进与直接 reload 均可恢复。
- `REGRESSION=` FIXED；修复未恢复 L1 完整 snapshots，未引入 Storage 或 HomeLight 回归。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` NO
- `DEPENDENCIES=` 无当前阻塞依赖；PB-12 与 PB-24 是独立后续边界。
- `NEXT_ACTION=` 保持本项关闭；先完成 V1 发布门禁，之后进入 PB-08/PB-21/PB-22 Behavior-to-Recommendation Learning Loop V1。

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
- `DEPENDENCIES=` PB-04 与 PB-18 已关闭；接 PB-21 自动刷新，并遵守 PB-32 冻结边界。
- `NEXT_ACTION=` 首次 V1 发布后作为下一产品 Goal 的最终闭环，先影子对照再小权重启用。
- `RELEASE_POSITION=` DO_AFTER_INITIAL_RELEASE；R0 是产品路线优先级，不是 V1 技术上线 blocker。

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
- `CURRENT_EVIDENCE=` Detail 有结构化 stylist/aesthetic evidence、主动 AI 点评、validator、rule fallback、版本化 digest、缓存与失效；2026-09-22 真实 DevTools smoke 已确认 V2 Detail 可生成并在 reload 后恢复现有 AI 点评。
- `WHAT_IS_ALREADY_DONE=` outfit-level analysis 和持久化 AI review 基础已存在，与 Homepage 一句话 reason 已分离；基础 Detail 产品链已由 PB-18 关闭。
- `PERSISTENCE_CONTRACT=` PERSISTED_COMMENTARY：现有 AI 点评写入 `outfit_ai_reviews`，真实 PB-18 smoke 证明首次生成和 reload 恢复；不得描述为仅前端 temporary state。独立 detail document 仍未完成，但不影响基础点评持久化结论。
- `DOD=` 后续仅验独立 detail asset 的版本/失效/恢复与 learned preference 驱动的解释增量；不重验或重开基础 Detail 可用性。
- `WHAT_REMAINS=` 独立持久化 detail document，以及 learned preference 进入个性化解释；不再把基础 Detail 可用性计入本项。
- `USER_IMPACT=` 用户已能获得生产可用的深点评；“为什么适合我”的长期个性化深度仍未完成。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` NO
- `DEPENDENCIES=` PB-22、`outfit_ai_reviews` 远端配置。
- `NEXT_ACTION=` 设计独立 detail asset 与 personalized explanation contract；保持“解释者不是选择器”，不改推荐分数。

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
- `ORIGINAL_GOAL=` 用同一真实 release candidate 证明主链可用、状态可恢复，并以有限异常矩阵覆盖真实上线风险。
- `WHAT_REMAINS=` 同一 release candidate 的 Login/Auth → 真实 Upload/Digitize/Confirm → Wardrobe → Today/Scene/Refresh → Detail → Favorite/Worn → History → reopen/reload/app restart 主链；另覆盖 AI timeout/failure、空衣橱、网络失败、重复点击、授权失败和 Favorite/Worn 状态一致性、History 恢复，以及 Wardrobe/Today/Detail/Favorite/History 的图片连续性和坏图 fallback。复用 PB-17 已取得的真实上传证据，但不得冒充当前 RC 全链 PASS。
- `DOD=` 每个矩阵场景记录环境/版本、操作、预期与实际结果、错误码和恢复结果；必要异常可用有限人工 smoke，不要求全部自动化。所有发布必需项关闭后，明确记录 `V1_RELEASE_READY=YES/NO`。
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
- `ORIGINAL_RELEASE_SCOPE=` deployment manifest、函数依赖闭包、memory/CPU/platform timeout/Node runtime 等资源规格与远端实际值一致；部署脚本保留配置不能代替只读比较。
- `DOD=` 推荐与 PB-15 指出的关键函数资源值进入 manifest/只读 remote compare，漂移会明确失败；网络/域名和业务集合配置由 PB-12 核。
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
- `CURRENT_EVIDENCE=` About 页面及“用户协议与隐私政策”入口已存在，文案已有图片用于识别、衣橱和推荐的说明；其中“合理范围内短期保留”缺确定期限，尚未与实际 AI/云存储处理方、注销和关联资产清理边界完整对齐。行为事件当前没有清理任务。
- `WHAT_IS_ALREADY_DONE=` 用户数据有 `_openid` 隔离；行为事件最小化，不发送图片、标题、城市或 raw result；删除衣物有快照资产保护；About/Privacy/Agreement 基础入口和图片用途说明已存在。
- `ORIGINAL_GOAL=` V1 用户能在使用前获得隐私政策、用户协议、图片用途和数据用途说明；服务端管理凭据，明确用户数据的保留与删除边界。
- `WHAT_REMAINS=` 明确保留期、删除/注销路径、缓存清理、行为/画像/图片资产生命周期；把现有 About/Privacy/Agreement、图片及数据用途说明与实际处理方和数据流对齐，核对前端包不含 AI key、AppSecret 或数据库 secret，并留发布验收证据。
- `DOD=` 文案与实际数据流一致，用户可在产品中查看；数据清单、保留/删除路径和关键权限可核验，客户端无服务端 secret。运营/法务对最终文案的批准是正式发布决策，不以代码存在代替。
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
- `CURRENT_EVIDENCE=` 代码/测试已完成 free=200 强制容量；自动模型覆盖 0/200 数据结构、199+1、201 拒绝、并发双批不超过 200、删除释放、伪造 premium 无效，但不是生产环境验收。release checklist 仍要求 Web/BFF、`005_wardrobe_capacity_v1.sql`、相关云函数和并发/边界 smoke。
- `WHAT_IS_ALREADY_DONE=` 容量 resolver、confirm gate、用户锁、Web transaction 和 200+ 件 recommendation pagination 已实现。
- `ORIGINAL_GOAL=` 将“规模测试”分成推荐算法、生产形状衣橱和完整 ingestion 三层；V1 需要产品在空、近满和满容量衣橱可用，并保持真实上传正确性，不要求手工上传 200 张图片。
- `SCALE_LEVEL_A=` DONE：Recommendation Core synthetic 30/100/300/500 衣物的 bounded search、eligibility、scoring、Oracle、reservoir 验证已有 [scaling contract](adr/0005-recommendation-scaling-contract.md) 和 [benchmark](performance/recommendation-baseline.md) 记录；这只证明算法级规模，不证明真实 CloudBase/客户端。
- `SCALE_LEVEL_B=` OPEN：按当前 production schema 脚本化构造 0/200、接近 200/200、200/200 衣橱，不经过 200 次 AI 识别；在同一 RC 走 CloudBase → Wardrobe → Today → Refresh → Detail，检查查询/分页/序列化、snapshot identity、推荐输入、图片及客户端体验，并采真实 `currentSize/limitSize/key count/namespace distribution`。自动容量模型不能替代此项。
- `SCALE_LEVEL_C=` OPEN（V1 最小闭环），完整 200 件 ingestion 压测 NOT_REQUIRED_FOR_V1：PB-04 已用少量真实图片证明 Upload → Digitize → Confirm → Wardrobe 可入库，但这批新衣进入真实 Recommendation 的证据未找到；PB-29 在当前 RC 用少量真实图补上传至推荐消费的闭环，并覆盖失败/重试。只有 B 或 RC 暴露 ingestion 特有规模故障时，才扩成有界批量 ingestion 测试。
- `WHAT_REMAINS=` 对 release candidate 执行 migration/部署；完成 Level B 的 0/200、近满、200/200 产品规模验收，并验证 199+1、199+2、删除释放、并发双批、伪造权益和 Web 第 201 件。0/200 与 200/200 同时采 `currentSize/limitSize/key count/namespace distribution`，作为 PB-04/PB-34 共用证据，不得把自动模型写成真实 RC smoke PASS。
- `DOD=` 有当前 schema 的 seed/清理方法、账号/环境/版本、数量与分页证据、Wardrobe/Today/Refresh/Detail 实测结果、推荐 identity 和本地 Storage 指标；边界容量规则在真实 RC 中通过，少量真实新衣可进入推荐输入，测试数据清理可追踪。完整 200 图上传不是 V1 DoD。
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

### PB-37 用户可见称呼与默认昵称一致性

- `PROBLEM_ID=` PB-37
- `TITLE=` 用户可见称呼与默认昵称一致性
- `OWNER=` 产品文案 / 用户资料展示
- `ROOT_PROBLEM=` 新用户默认昵称和示例在 Web、Miniapp 与本地 store 中不一致。
- `ORIGINAL_SOURCE=` 历史品牌/乱码核对 + 当前源码
- `STATUS=` OPEN
- `TYPE=` ENGINEERING_DEBT
- `BUG_SEVERITY=` P2
- `ROADMAP_PRIORITY=` R2
- `RELEASE_PRIORITY=` OPTIONAL
- `CURRENT_EVIDENCE=` 当前 `userStore` 与 Web 资料/登录默认昵称使用“搭搭新朋友”，Miniapp Profile 默认昵称与示例使用“今日搭子”；小程序可见导航/About 使用“搭搭day”。当前源码定向搜索未找到乱码地区字符串；`project.config.json` 的“搭一搭”是开发配置描述，不当作用户可见故障。
- `WHAT_IS_ALREADY_DONE=` 历史乱码未在当前可见源码中复现，记为 HISTORICAL_CLOSED；核心品牌“搭搭day”在主要界面可见。
- `WHAT_REMAINS=` 确定默认昵称及示例的内容规范，统一新用户/跨端资料展示和替代逻辑；做一次真实页面文案检查，只有实际乱码证据才另行修复。
- `DOD=` 新用户与既有默认昵称在 Profile、登录恢复和 Web 资料入口呈现一致，不覆盖用户自己设置的昵称；无当前用户可见乱码。
- `USER_IMPACT=` 当前可能看到不同默认称呼，不影响核心业务。
- `MUST_FIX_BEFORE_NEW_FEATURE=` NO
- `MUST_FIX_BEFORE_LAUNCH=` NO
- `DEPENDENCIES=` 品牌文案决策。
- `NEXT_ACTION=` 作为低优先级内容修正保留，不挤占 V1 发布门禁。

## 10. 去重与父子关系

- PB-08 是行为学习父任务；PB-21 负责 profile 自动更新，PB-22 负责 recommendation 消费，PB-23 只记录成熟度。任何一个子项存在都不能宣称学习闭环完成。
- PB-19 的“穿过功能”已完成；“穿过影响推荐”只在 PB-08/PB-22 跟踪，不再重复记 Bug。
- PB-05 是首卡自动验收父项，PB-28 只记录图片指标证据缺口。
- PB-06 是图片资产 Pipeline，PB-28 是首页图片可见性指标，两者不是同一问题。
- PB-13 是可接受的静态 AI 效果预览，PB-14 是严格 VTON，绝不合并。
- PB-10 是可复现/自动部署，PB-12 是云端业务配置验证，PB-30 是函数资源合同；三者相关但成功条件不同。
- PB-29 是发布前全链 E2E，PB-17 保留 Upload 专项，PB-24 保留 Detail 深点评专项。
- PB-18 已关闭生产 Today → Detail 的基础产品链恢复；PB-24 只负责独立 detail asset 与 learned preference 驱动的深点评收口。

## 11. 当前总账结论

- `BEFORE_NEW_FEATURE=NONE`
- `BEFORE_LAUNCH=PB-03(V1_DOD), PB-11, PB-12, PB-15, PB-16, PB-17, PB-29, PB-30, PB-33, PB-34, PB-36`
- `NEXT_PRODUCT_GOAL=V1 release readiness`
- `BEHAVIOR_LEARNING_RELEASE_BLOCKER=NO`
- `DO_AFTER_INITIAL_RELEASE=YES`
- `BEHAVIOR_LEARNING_POSITION=AFTER_INITIAL_RELEASE`
- `IF_NO_FIRST_TASK=PB-12/PB-36 CloudBase correctness 与数据 owner 核验`
- `CURRENT_PERSONALIZATION_LEVEL=LEVEL_1_STATIC_PROFILE`
- `PRODUCTION_RELEASE_READINESS=NOT_READY`
- `V1_RELEASE_READY=NO`（发布必需项和同一 RC 最终 E2E 仍未闭合）
