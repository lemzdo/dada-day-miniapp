# PROBLEM_LIST.md - 搭搭 day 当前存在的问题

> 最后更新：2026-09-12
> 用途：记录还未解决的问题。

## Recommendation Runtime 2.2 状态（2026-09-10）

- 已解决旧 Core 的无界 O(N³) 候选物化：生产 bounded engine 在 30/100/300/500
  件 fixture 上最多完整验收与评分 768 个候选，reservoir 为 96；旧 500 件
  1,442,400（worst-case 3,937,500）仅保留为 count-only 风险基线。
- 已建立 Legacy Core 与 Small Full-Ensemble 双 Oracle；outerwear、功能性单品与
  accessory 均进入最终 identity、eligibility、score、evidence 和 materialization，
  Candidate Pool 已升级到 V3，旧 schema 安全 miss。
- 已实现显式、lazy、可测量、fail-open 的 cache-fill policy；未真实保存时始终
  返回 `candidatePoolId: null`，required batch persistence 先于可选 cache write。
- 已消除 card0 renderer entry 重建，并把 cards1–7 renderer preparation 与非首屏
  overlay 读取移出首卡同步路径。
- Production 6s 归因已覆盖 99.935% wall time，并证明每请求 Core、候选生成、完整
  eligibility 与 scoring 均只运行一次。主因是 `recommendationStream` 长期使用
  256MB / 0.2CPU 默认规格，而不是 Architecture 2.2 重复工作。
- 仅将规格提升到 1024MB / 0.8CPU 后，同 fingerprint、canonical HIT、Provider=0
  的五样本 `SERVER_RESPONSE_READY` P50 从 5,765.054ms 降到 1,661.491ms，
  `PURE_CORE_PROD` P50 从 5,001.287ms 降到 1,062.614ms；架构、搜索预算、质量与
  canonical correctness join 均未改变。服务端产品性能判定转为 PASS。
- 最终用户可见验收已补齐同一客户端 monotonic clock 下的请求、响应、state commit、
  `wx.nextTick + SelectorQuery` 首卡内容可见、首图 `onLoad` 与图片节点可见埋点；节点按
  batchId/outfitKey 和非零尺寸校验，UI 与业务行为不变。新窄验收器复用既有 DevTools
  automator 和 CLS audit，不清缓存、不修改服务端。
- DevTools watcher 已成功编译，但当前 automator 会话在普通进入与一次强制 reLaunch 后
  仍暴露旧 diagnostics bridge。两次均在发出样本请求前以
  `VISIBLE_TIMING_BRIDGE_UNAVAILABLE` 停止，按上限判定 `TEST_INFRA_BLOCKED`；没有有效
  warm 样本，不能判定产品 PASS 或 FAIL。当前正确语义为
  `PRODUCT_PERFORMANCE_RESULT=PENDING_MANUAL_ACCEPTANCE`，但不得要求用户人工计时；恢复
  DevTools 对 watcher bundle 的加载后，只需重新运行 3 样本自动验收。Architecture 2.2、
  1024MB/0.8CPU 服务规格与推荐服务端均继续冻结。
- Today `coldTtuiMs=3026` 属于不同请求/客户端计时边界，不能与最终服务端 response
  指标混用。CloudBase 在五请求中调度了两个新实例，严格 reused-warm 样本仅 3 个，
  已按采样上限如实保留该证据限制；其 `SERVER_RESPONSE_READY` 中位数为 1,398.155ms。
- 正常生产请求在尚未获得可审计的生产 pool-save stage、且未配置实测
  `RECOMMENDATION_CANDIDATE_POOL_SAVE_P95_MS` 时会
  正确跳过 pool fill；这保证 correctness，但会减少 pool HIT，必须在生产 smoke
  得到数据后配置预算。
- 同一活跃客户端/input identity 的连续换批已由累计 `excludedOutfitKeys` 验证
  48 套无重复；客户端状态丢失、并发跨端或重装后的 durable seen ledger 仍未实现，
  是独立的跨会话一致性风险。

真实指标与证据边界详见 `docs/performance/recommendation-baseline.md`。

## 当前交付 Goal

- `Homepage AI-First Reason`：AI-first critical path、1,605ms budget-aware wait、
  fallback taxonomy、模型竞速 runner，以及 real Today 的三样本 HIT/MISS 自动验收器已完成；
  MISS 仅允许在私有备份、精确身份复核、关联任务终态和 CAS 删除全部通过后清理一个缓存文档，
  页面 copy source/AI state 还必须与服务端决策一致。真实 Max/Fast 调用、生产部署和
  real Today HIT/MISS paint 验收仍待执行，因此本项尚未关闭。外部模型竞速两次均被执行
  环境以“需用户明确授权发送目标和内容”拒绝，当前标记 `TEST_INFRA_BLOCKED`；不得以
  stub 结果选模型或声称生产 PASS。



| 顺序   | 需求                                                    | 优先级             | 当前判断                             |
| ------ | ------------------------------------------------------- | ------------------ | ------------------------------------ |
| **1**  | **AI Voice 原型验证：Max vs Plus**                      | P0                 | **现在立即做**                       |
| **2**  | **AI Voice 正式生产化 + 精细缓存**                      | P0                 | 原型通过后做                         |
| **3**  | **统一 AI Gateway / AI 调用基础设施**                   | P0/P1              | 与 Voice 正式集成一起落第一版        |
| **4**  | **Storage 10MB 容量治理**                               | P1                 | 已确认真实 Bug                       |
| **5**  | **Today 首卡可见性自动验收（3 次 warm）**               | P1                 | TEST_INFRA_BLOCKED；待 DevTools 加载新 bridge |
| **6**  | **图片资产 Pipeline：标准化、完整性检查、展示资产治理** | P1                 | 为现有推荐和以后 AI 效果图打基础     |
| **7**  | **个人衣橱关系链 / 衣橱知识图谱**                       | **P1，产品级重点** | 新增，长期壁垒很强                   |
| **8**  | **用户行为学习 + 个人推荐权重**                         | P1/P2              | 与关系链 V3 合并建设                 |
| **9**  | **优秀穿搭组合资产化 / 个人穿搭库**                     | P2                 | 与关系链自然衔接                     |
| **10** | **自动部署 / generateOutfit 发布可复现性**              | P2工程债           | 当前手动部署可用，但自动发布仍不可靠 |
| **11** | **缓存 mutation 失效、旧数据/异常路径最终收口**         | P2工程债           | 旧待办，需一次性审计确认剩余项       |
| **12** | **云端集合 / 索引 / 权限 / 环境变量发布核验**           | P2工程债           | 上线前必须完整闭环                   |
| **13** | **AI 真人穿搭效果预览**                                 | P2/P3              | 新增，值得做但不应现在抢主线         |
| **14** | **严格虚拟试衣 VTON**                                   | P3                 | 长期，不提前绑定架构                 |
| **15** | **搭搭day 全项目 Cloud Runtime 性能体检**                | P1 工程专项        | Homepage AI-First Reason 交付后另行开展；本 Goal 不展开 |

## PRE_LAUNCH_SECURITY

- 上线前轮换曾被 CloudBase function detail 输出到执行记录的生产 API key / access
  token，并核对旧凭据已失效。当前只记录，不立即轮换，不阻塞开发；发布前必须关闭。







衣服上传流程：

上传图片
  ↓
创建 batch / sourceImage
  ↓
图片预处理
  ↓
Image Router
  ├─ 真人/模特穿着图
  │    ↓
  │  aitryon-parsing-v1 解析上衣/下装/裙子
  │    ↓ 失败
  │  VL bbox 兜底
  │    ↓
  │  配饰用 VL bbox 补充
  │
  └─ 非真人图
       ↓
     VL bbox 检测多件衣服/鞋包
       ↓
     bbox 失败则整图兜底 needs_review

统一进入：
  ↓
每件 item 单独 crop
  ↓
按品类调用 SegmentCloth / 商品分割
  ↓
生成 cleanImageUrl，失败则用 cropImageUrl
  ↓
基于 clean/crop 做属性识别
  ↓
qualityScore
  ↓
ready / needs_review / failed
  ↓
生成草稿
  ↓
用户确认
  ↓
保存正式衣柜

## Recommendation Runtime 2.2 Phase 2 性能进度（2026-09-09）

- hierarchical bounded-search 已完成真实生产 Core 的 30/100/300/500 full benchmark：500 件只进入 768 次完整 eligibility/scoring、96 个 reservoir entries，旧 legacy raw estimate 为 1,442,400；300→500 的组合阶段计数保持不变。
- Legacy Core Oracle、Small Full-Ensemble Exhaustive Oracle、home/work/date/sport、完整配饰 identity/evidence 和连续 5 次 refresh（48 套无重复且与 full recompute 等价）均已通过。
- Candidate Pool 已升级为 V3 full-ensemble cache schema；旧 V2 直接视为 cache miss，不做错误 hydrate。Pool 显式 cache-fill budget 与 runtime critical-path 收口属于 Phase 3。

## Recommendation Runtime 2.2 Phase 3/4 收口（2026-09-09）

- compact pool 本地实测 96 candidates、175,148 bytes（原执行对象 7,230,290
  bytes 的 2.42%），serialization P50/P95 约 1.462/1.462ms；CloudBase DB save
  不得由该数字推断。
- Runtime 已形成 `InputSnapshotService -> Cache Coordinator -> Recommendation Core
  -> Recommendation Result` 边界；Core 不再读取 user/wardrobe 或 candidate-pool DB，
  且输出收紧为六字段合同。HTTP/SSE、AI provider lifecycle、cache policy、required
  persistence 与 response assembly 仍由同一 deployment unit 内 Orchestrator 管理。
- 当前唯一架构真源为 `docs/architecture/recommendation-runtime.md`；五份 ADR 已记录
  runtime boundary、bounded search、full outfit、candidate-pool refresh 与 scaling 合同。
