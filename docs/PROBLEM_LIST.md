# PROBLEM_LIST.md - 搭搭 day 当前存在的问题

> 最后更新：2026-05-22  
> 用途：记录还未解决的问题。

## Recommendation Runtime 2.2 Phase 1 baseline (2026-09-09)

- 当前 legacy 推荐核心按 `top × (bottom + skirt) × shoes + onepiece × shoes`
  物化候选；100 件 fixture 已产生 11,616 个候选，eligibility P50/P95 为
  2,769.220ms。300/500 件 count-only 估算分别为 311,904 / 1,442,400，
  worst-case 估算分别为 850,500 / 3,937,500；禁止把这些规模直接交给旧的
  full materialization。
- Candidate Pool 当前仍为 V2 compact cache，serializer 仅覆盖有限 role/slot；
  完整 outerwear/socks/gloves/scarf/hat/bag 等参与 outfit identity、eligibility
  和 scoring 的合同尚未建立，optional-item correctness 与 schema/version bump
  仍是风险。
- refresh no-repeat 依赖客户端 `seenOutfitKeysRef` 累积传入；服务端没有同一
  input identity 的 durable seen ledger。客户端状态丢失、并发 refresh 或跨端
  恢复仍可能重复展示。
- Candidate Pool save 仍以后台 Promise 启动并在 SSE response 后等待 tail，尚未
  按显式 foreground cache budget 做 save/fail-open 决策；pool 写入可能与首卡、
  required batch persistence 竞争资源。
- `prepareProductionRecommendationWork` 仍同步构建 cards1–7 renderer entries，
  且 card0 entry/fingerprint 存在首次 materialization 后的重建路径。

Phase 1 真实指标详见 `docs/performance/recommendation-baseline.md`。



| 顺序   | 需求                                                    | 优先级             | 当前判断                             |
| ------ | ------------------------------------------------------- | ------------------ | ------------------------------------ |
| **1**  | **AI Voice 原型验证：Max vs Plus**                      | P0                 | **现在立即做**                       |
| **2**  | **AI Voice 正式生产化 + 精细缓存**                      | P0                 | 原型通过后做                         |
| **3**  | **统一 AI Gateway / AI 调用基础设施**                   | P0/P1              | 与 Voice 正式集成一起落第一版        |
| **4**  | **Storage 10MB 容量治理**                               | P1                 | 已确认真实 Bug                       |
| **5**  | **图片首屏 first-visible 性能优化**                     | P1                 | 当前主要体验速度短板                 |
| **6**  | **图片资产 Pipeline：标准化、完整性检查、展示资产治理** | P1                 | 为现有推荐和以后 AI 效果图打基础     |
| **7**  | **个人衣橱关系链 / 衣橱知识图谱**                       | **P1，产品级重点** | 新增，长期壁垒很强                   |
| **8**  | **用户行为学习 + 个人推荐权重**                         | P1/P2              | 与关系链 V3 合并建设                 |
| **9**  | **优秀穿搭组合资产化 / 个人穿搭库**                     | P2                 | 与关系链自然衔接                     |
| **10** | **自动部署 / generateOutfit 发布可复现性**              | P2工程债           | 当前手动部署可用，但自动发布仍不可靠 |
| **11** | **缓存 mutation 失效、旧数据/异常路径最终收口**         | P2工程债           | 旧待办，需一次性审计确认剩余项       |
| **12** | **云端集合 / 索引 / 权限 / 环境变量发布核验**           | P2工程债           | 上线前必须完整闭环                   |
| **13** | **AI 真人穿搭效果预览**                                 | P2/P3              | 新增，值得做但不应现在抢主线         |
| **14** | **严格虚拟试衣 VTON**                                   | P3                 | 长期，不提前绑定架构                 |







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
