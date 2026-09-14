# Local Data & Cache Architecture V1

- 状态：`APPROVED_FOR_PB04_IMPLEMENTATION`
- 定稿日期：2026-09-14
- 适用范围：搭搭day 微信小程序、CloudBase 业务数据与图片资产
- 平台约束：微信小程序 Local Storage 按用户、按小程序聚合 10 MB；本地文件缓存与 Local Storage 是不同容量域
- 前置证据：[PB-04 微信本地 Storage 10MB 容量专项审计](../qa/storage-10mb-audit.md)

本文是 PB-04 实施前的数据分层、真源、生命周期和容量合同。后续新增持久化默认拒绝；代码现状与本文冲突时，以本文的目标架构为准，并通过分期迁移收敛。

Miniapp 当前直接调用 Cloud Function，并由服务端 `OPENID` 隔离 CloudBase 数据；`apps/web` 的 BFF/Drizzle/PostgreSQL 是另一条可写数据平面，并没有与 CloudBase 建立同步或映射。本文据此指定 **CloudBase 为 miniapp 业务真源**。在另行完成迁移、同步或退役决策前，PostgreSQL 不能被当作同一用户数据的第二 canonical truth，客户端 cache 更不能掩盖两套后端的语义差异。

## 1. 架构结论

`CURRENT_ARCHITECTURE_PROBLEM=业务真源虽主要已在 CloudBase，但客户端仍把页面缓存、详情交接、状态同步和上传续作混放进 wx Storage；通用 pageCache 允许动态 key 持久化，TTL 只控制读取、不释放空间，同一 Outfit 又被 Detail draft、Detail page cache、Favorite/History 首页和 Today 快照重复保存。Local Storage 因而被当成第二业务数据库，而没有准入、owner、字节上限和统一失败语义。`

`TARGET_ARCHITECTURE=四层架构：L0 Runtime Memory 承担会话页面状态和请求缓存；L1 Miniapp Local Storage 只承担白名单化的最小恢复投影、短期 workflow reference 和未来有界待确认队列；L2 Local/Binary Asset Cache 只承担图片二进制，不写入 L1；L3 CloudBase 承担用户业务真源、跨设备历史、服务端缓存和云文件资产。`

`LOCAL_STORAGE_ROLE=受预算约束的恢复控制面，不是页面数据库、对象仓库、行为日志或图片仓库。`

核心决定：

1. 持久化默认 `DENY`，没有 registry 声明的 namespace 不得写 L1。
2. `pageCache` 不再作为通用 persisted cache；页面 query cache 进入 L0，确需跨会话的内容改为固定 key、裁剪字段的 bootstrap projection。
3. 同一 Outfit 使用统一引用，不在多个客户端模块保存完整 normalized Outfit。
4. Favorite 是云端关系状态，Worn/History 是云端事实事件；History 只有为保持历史语义而保存的云端 wear-time snapshot 才是合法 snapshot。
5. 上传的 batch、image、draft 状态以 CloudBase 为真源；L1 只保存当前 workflow reference，图片二进制只在 L2 或 Cloud Storage。
6. 缓存失败不得把已成功的登录、天气读取或云端业务 mutation 反转成失败。
7. L1 目标稳定态远低于 10 MB：`STEADY_STATE_TARGET<=384 KiB`，`LOCAL_STORAGE_SOFT_BUDGET=512 KiB`。

## 2. Source-of-truth 规则

`SOURCE_OF_TRUTH_RULES=`

1. 用户创建、编辑、收藏、穿着、上传确认等跨设备业务事实只允许由 L3 成为 canonical truth。
2. L1 记录必须能指向 L3 truth、可重新计算，或是尚未提交的短期 workflow reference；L1 记录绝不获得独立冲突解决权。
3. 同一概念只能有一个 canonical owner。projection 通过 `sourceVersion/revision` 判断陈旧，不能反向覆盖更新的 Cloud truth。
4. 用户明确编辑的内容优先于 AI 生成内容；Learned Profile 不得覆盖 Explicit Profile。
5. 云端 snapshot 只有在“未来源对象变化后仍须复现当时事实”时允许，例如穿着历史的 wear-time presentation。缓存命中不是保存完整 snapshot 的理由。
6. 图片元数据与图片二进制分离：可查询元数据在 L3 DB，canonical 二进制在 Cloud Storage；L2 仅保存可驱逐副本。
7. 服务端 cache 也不是业务真源，必须有 owner、identity、TTL、size bound 和 miss 后重算路径。

### 2.1 Outfit canonical identity

`CANONICAL_IDENTITY_MODEL=`

```text
OutfitCompositionIdentity = ownerScope + compositionKeyVersion + compositionKey
OutfitRevisionIdentity    = outfitId + outfitRevisionId
RecommendationOccurrence  = batchId + outfitKey + referenceId
MaterializedOutfit         = outfitId -> OutfitCompositionIdentity + currentRevisionId
FavoriteRelation           = favoriteId -> outfitId/outfitRevisionId
WearEvent                  = historyId -> outfitId/outfitRevisionId + immutable wear-time facts
```

- 当前 `outfitKey` 继续作为 PB-04 兼容 join key；目标 `compositionKey` 使用版本化、无歧义的 canonical clothing ID 编码或 hash，防止简单字符串拼接和未来算法变更造成误认。
- `outfitRevisionId` 冻结某一版 composition/presentation。它是 PB-11 的云端归一化目标，PB-04 不为此新增云集合。
- `batchId` 表示一次推荐发生，不是长期 Outfit identity；`referenceId` 是服务端签发/校验的用户域引用，不是业务真源。
- 已 materialize 的 Outfit 由 CloudBase `outfits`（或后续等价 canonical collection）拥有；临时推荐由 `recommendation_batches_v2` 的有界 envelope 恢复。
- Today、Detail、Favorite、Worn、History 都传递 `OutfitRef`，不得各自建立完整客户端 truth。

V1 `OutfitRef` 目标最小字段：

```ts
interface OutfitRefV1 {
  schemaVersion: 1;
  outfitKey: string;
  compositionKeyVersion?: string;
  outfitId?: string;
  outfitRevisionId?: string;
  batchId?: string;
  referenceId?: string;
  favoriteId?: string;
  historyId?: string;
  source: 'recommendation' | 'outfit' | 'favorite' | 'history';
}
```

`DETAIL_RECOVERY_MODEL=优先按 source-specific cloud ID 恢复；推荐详情使用 batchId+outfitKey+referenceId 从 recommendation_batches_v2 恢复；已保存 Outfit 使用 outfitId；Favorite/History 先解析关系记录再读取 canonical Outfit 或合法历史 snapshot。网络不可用时最多显示单一 bounded compact projection，并明确为只读离线内容，不把它升级为 truth。`

`HISTORY_RECOVERY_MODEL=historyId 是穿着事实 identity；CloudBase history record 持有 outfitId/outfitKey、穿着时间、满意度等事实，并可持有一份最小 immutable wear-time snapshot，以保证衣物改名/删除后历史仍可解释。客户端 History 列表只缓存 refs/列表投影，不保存 100 个完整 Outfit。`

`LOCAL_COMPACT_PROJECTION=固定 key 的最近一次 Today/Wardrobe bootstrap projection；只含 ref、展示标题、有限缩略图引用、必要状态、sourceRevision 和 expiresAt，不含 items/itemsSnapshot/snapshotItems 三套别名、AI evidence、原始 response、完整 scores 或重复 URL aliases。`

## 3. 四层架构

| 层 | ALLOWED_DATA | FORBIDDEN_DATA | LIFETIME | SIZE_POLICY | FAILURE_SEMANTICS |
| --- | --- | --- | --- | --- | --- |
| L0 Runtime Memory | React/Taro page state、in-flight request、dedupe map、session query cache、当前 recommendation cards、图片加载状态、诊断 ring buffer | 需要跨会话保证的唯一数据；无界 Map/数组 | 页面、登录 runtime 或 app process；离开 owner/切换账号即释放 | 每个 cache 必须有 entry cap/TTL；当前 image session cache 600 条可保留 | miss/eviction 只影响性能；不得影响业务结果 |
| L1 Miniapp Local Storage | 最小 auth resume、固定 bootstrap projection、last-known weather、当前 upload workflow ref、migration metadata、未来 bounded behavior pending queue | 完整 Outfit/Clothing 列表真源、动态 page key、图片/base64、无限事件、AI raw result、生产 diagnostics | 明确 TTL；用户/环境切换清 scope；terminal workflow 立即清 | registry allowlist；per-namespace maxEntries/maxBytes；高水位 384 KiB，软上限 512 KiB | cache 写失败 fail-open；关键恢复写失败显式降级，但不反转云端成功 |
| L2 Local/Binary Asset Cache | wx 临时选择文件、临时下载图、未来受管缩略图副本 | JSON 业务对象、唯一 canonical 图片、没有 index 的永久文件 | temp 到 upload/页面终点；managed cache 按 TTL/LRU 驱逐 | PB-04 中 app-managed persistent asset budget 为 0；未来启用前必须独立测量并登记 | temp 丢失仅影响该图片续作；云上传成功后本地失败不影响业务成功 |
| L3 Cloud Canonical Truth | users、clothes、outfits、favorite relations、history events/snapshots、upload records、behavior events、learned profiles、canonical copy、weather/server caches、Cloud Storage assets | 依赖客户端 Local Storage 才能解释的记录；无 owner/retention 的无限日志 | 按业务、隐私和 cache retention 合同 | DB/index/file 各自预算；server cache 必须 bounded/TTL；不受客户端 10 MB 设计驱动 | canonical write 失败才是业务失败；cache write fail-open；按 API 返回真实状态 |

## 4. 全项目 Persistence Map

说明：`L0/L1/L2/L3` 列描述目标 placement；`CROSS/OFFLINE` 分别表示跨会话是否需要、离线是否为产品硬要求。当前产品没有完整离线模式，`OFFLINE=GRACEFUL_ONLY` 表示允许 last-known/只读降级，而非离线业务提交。

| DATA | SOURCE_OF_TRUTH | OWNER | MEMORY (L0) | LOCAL_STORAGE (L1) | LOCAL_FILE (L2) | CLOUD_DB | CLOUD_FILE | RECOMPUTABLE | CROSS / OFFLINE | CURRENT_PLACEMENT -> TARGET_PLACEMENT |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| User/session | 微信身份 + CloudBase `users`；session 由 auth owner 签发 | Auth/User | 当前 auth context | 最小 resume credential/scope；不以 `openid` 作为授权证明 | NO | users/session metadata | avatar ref target | session 可续签；profile不可凭空重建 | YES / bootstrap only | `userId/openid/profile` 直写 -> versioned auth resume + compact profile cache |
| Clothing | CloudBase `clothes` | Wardrobe | 当前页/query | 默认 NO；可选固定 Wardrobe bootstrap projection | thumbnail temp/managed copy | clothes | canonical original/crop/clean/thumb | 用户编辑字段NO，projection YES | YES / graceful only | 多筛选完整 page cache -> L0 query + 单 fixed compact projection |
| Upload task | `upload_batches` + `upload_images` + `clothes_drafts` | Upload workflow | 当前 task list | 一个 current workflow ref | local temp paths before cloud accept | upload collections | source/intermediate/final assets | 状态NO，列表YES | terminal前YES / partial | 内存 task cache + 每batch image IDs -> 云 truth + 单 ref |
| Upload temporary images | 云上传前为 wx temp file；上传后为 Cloud Storage fileID | Upload asset | selection handles | 禁止 binary/base64；只可存 ref | TEMP_ONLY | upload_images metadata | source/intermediate assets | 上传前NO，上传后本地副本YES | 仅处理中 / partial | temp path + cloud file -> terminal/orphan lifecycle 明确化 |
| Wardrobe list | `clothes` 查询结果 | Wardrobe query | YES | 最多一份 fixed compact projection | thumbnails | clothes | referenced thumbnails | YES | NO / graceful only | 动态 filter page cache -> L0，必要时单 bootstrap |
| Recommendation batch | `recommendation_batches_v2` envelope；过期后可重算 | Recommendation | 当前批次 | 最近一批 compact bootstrap projection | thumbnails | 目标为 bounded server envelope | referenced clothing assets | YES | 可选 / graceful only | 当前无 retention server records + Today snapshot -> 48h occurrence + refs/projection |
| Candidate Pool | server candidate pool cache | Recommendation engine | server request memory | NO | NO | `recommendation_candidate_pools` | NO | YES | NO / NO | server cache 保留；禁止复制到 L1 |
| Outfit | CloudBase canonical Outfit / transient batch ref | Outfit domain | 当前 view model | ref only；最多随 bootstrap projection出现 | thumbnails | outfits / recommendation batch | referenced clothing assets | transient YES；用户标题等NO | YES / graceful only | 多份 normalized Outfit -> canonical ref |
| Outfit Detail | Outfit resolver 返回结果 | Detail page | page state/session cache | 最近一项 compact fallback可选，不设动态key | thumbnails | 解析 outfits/favorite/history/batch | referenced clothing assets | YES | NO / graceful only | dynamic pageCache + multi-alias draft -> L0 + ref resolver |
| Favorite | `favorite_outfits` relation；目标引用 canonical outfit | Favorite domain | status map/query | NO；bootstrap中仅boolean/id可选 | NO | favorite relation | NO | NO | YES / NO | 云 truth + full local list snapshot -> 云 truth + refs |
| Worn | 当日 `outfit_history` 事实 | History domain | status map | NO；bootstrap中仅status/id可选 | NO | outfit_history | NO | NO | YES / NO | 云 truth +本地复制状态 -> 云 truth + runtime overlay |
| History | `outfit_history` event +合法 wear-time snapshot | History domain | 当前分页 | 默认NO；如产品批准仅refs/list projection | thumbnails | history events/snapshots | referenced historical assets | 事实NO，query YES | YES / graceful only | 100个完整 Outfit cache -> L0 pagination/compact refs |
| Weather | weather provider response；CloudBase cache 是服务端可重建 cache | Weather | current request state | 单 last-known compact record | NO | `weather_cache` | NO | YES | 可选 / graceful only | 固定key但逻辑TTL -> bounded record +物理expiry |
| Profile | CloudBase `users` explicit profile | User/Profile | current form/view | compact bootstrap cache | avatar temp/managed copy | users | avatar asset | profile NO；cache YES | YES / graceful only | 无TTL full cache -> revisioned compact cache |
| Learned Profile | `learned_style_profiles` | Learning service | recommendation input copy | 默认NO；明确UI需求下仅存version/status summary | NO | learned_style_profiles | NO | 可由retained events重算 | YES / NO | cloud only 保持；不得混入 explicit profile |
| Behavior events | `outfit_behavior_events` after ack | Behavior ingestion | bounded send queue | 当前NO；未来可选pending queue only | NO | raw events + aggregates | NO | 未ack event NO；profile YES | pending可跨会话 / offline queue only | memory queue 50 -> PB-22 可启用 bounded durable queue |
| AI copy | canonical copy cache / Outfit AI review in CloudBase | AI copy service | current response | 仅随compact presentation的已发布短文案可选 | NO | canonical copy/review collections | NO | 可重算但有成本 | 由云端保证 / graceful only | 随多个 Outfit snapshot 重复 -> ref/version +云 canonical |
| Canonical copy | CloudBase canonical copy record | Recommendation copy | render overlay | 不单独持久；bootstrap可带一份display text | NO | canonical copy cache | NO | 条件性可重算 | YES / graceful only | 云端正确；清除本地重复 copies |
| Diagnostics | observability backend/DevTools capture | Runtime/QA | bounded ring | 生产禁止；显式acceptance固定短TTL | 临时导出可选 | server logs/telemetry | explicit QA export only | YES | NO / NO | 多个固定无TTL key -> memory/short-lived QA artifact |
| Image metadata | owning CloudBase document | Wardrobe/Upload | normalized view | 仅 compact display ref | local asset index（若启用） | clothes/drafts/upload_images | referenced files | 部分可重算 | YES / graceful only | 随 full snapshots 重复 -> canonical metadata +最小引用 |
| Image binary/assets | Cloud Storage canonical fileID | Asset pipeline | decoded/render handles | FORBIDDEN | temp/managed evictable copy | file metadata only | canonical binaries | 派生缩略图YES；用户原图NO | YES / cached offline optional | 当前主要云端且正确；补 terminal/orphan contract |

## 5. Local Storage 准入与 registry

`DEFAULT_POLICY=DENY_PERSISTENCE`

任何 L1 namespace 必须在代码 registry 中声明以下字段，缺一不可：

```ts
interface LocalStorageNamespaceContract {
  owner: string;
  classification: 'USER_CRITICAL' | 'WORKFLOW_REF' | 'BOOTSTRAP_CACHE' | 'PENDING_QUEUE' | 'MIGRATION_META';
  sourceOfTruth: string;
  crossSessionNeed: string;
  recomputable: boolean;
  ttlMs: number | null;
  staleIfErrorMs?: number;
  maxEntries: number;
  maxBytes: number;
  evictionPolicy: 'PROTECTED' | 'EXPIRE_THEN_LRU' | 'FIFO_ACKED' | 'TERMINAL_DELETE';
  migrationVersion: number;
}
```

写入规则：按用户和环境 scope；写前校验 schema/payload bytes；先物理清过期记录，再按本 namespace 驱逐；仍超上限则拒写。枚举/清理只能操作 registry allowlist，禁止 `clearStorage()`。

### 5.1 V1 allowlist 与容量合同

以下是目标 payload 字段估算后的 PB-04 V1 上限，不沿用现状完整对象 fixture 的 2.5625 MiB 方案。估算值需在实现阶段用 production-shaped 长 URL/中文文案和真机 `getStorageInfoSync()` 校准，但校准不得突破 512 KiB 全局软上限，除非另开架构决策。

| namespace | target payload | maxEntries | TTL / terminal | maxBytes | 估算依据 |
| --- | --- | ---: | --- | ---: | --- |
| `authResume:v2` | session/scope/version，不含完整 profile | 1 | session contract | 16 KiB | 少量 IDs/token metadata，预留 token 扩展 |
| `profileBootstrap:v2` | display/profile revision 的最小投影 | 1 | 24h；登录成功刷新 | 32 KiB | 当前 profile 字段裁剪后应为低 KiB |
| `weatherLastKnown:v2` | location bucket + weather + timestamps | 1 | fresh 10m；stale-if-error 24h；之后物理删 | 16 KiB | 单天气对象，无 forecast history |
| `todayBootstrap:v2` | 最多 8 个 OutfitRef +展示标题+有限 thumbnail refs | 1 | 6h fresh、同自然日 stale-if-error；input revision 变化立即删 | 96 KiB | 8卡 × 最多8个短引用，禁止 evidence/URL aliases |
| `wardrobeBootstrap:v2` | 最多 20 个 compact item refs | 1 | 30m 或 wardrobe revision 变化 | 96 KiB | ID/category/单 display image ref，不含识别 raw result |
| `uploadWorkflow:v2` | 当前 batchId + image refs + timestamps | 1 | 24h；terminal 立即删 | 32 KiB | 最多9图，只保存引用；云端任务列表负责恢复其它 batch |
| `behaviorPending:v1` | 未来 PB-22 未 ack 的最小事件 | 50 | maxAge 72h；ack 即删 | 64 KiB | 50 × 约0.7KiB + envelope；禁止图片/文案/raw result |
| `storageMeta:v2` | registry version、migration checkpoint、尺寸摘要 | 4 | version lifecycle | 16 KiB | 固定小记录 |

```text
DECLARED_NAMESPACE_CAPS = 368 KiB
NORMAL_STEADY_STATE_TARGET <= 384 KiB
GLOBAL_HIGH_WATER = 384 KiB
LOCAL_STORAGE_SOFT_BUDGET = 512 KiB
RESERVED_PLATFORM_HEADROOM >= 9.5 MiB of the documented 10 MiB aggregate
```

`behaviorPending:v1` 在 PB-22 启用前不得预创建或占用空间。未启用时目标常态约低于 320 KiB。512 KiB 软上限包含 registry/envelope/序列化差异和未知小型 SDK key 的余量，不代表要填满。

### 5.2 现有 placement 判定

| 当前数据 | 判定 | 目标动作 |
| --- | --- | --- |
| `outfitDetailDraft:*` | `OVER_PERSISTED + DUPLICATED` | 改为单 `OutfitRef` handoff；删除多 alias 完整快照 |
| `pageCache:outfitDetail:*` | `OVER_PERSISTED + SHOULD_BE_MEMORY` | 动态详情进 L0；仅保留可选单项 compact fallback |
| History cache | `OVER_PERSISTED` | 分页数据进 L0；若批准 bootstrap 只存 refs/list projection，不存100个完整 Outfit |
| `uploadBatchImages:*` | `TEMP_ONLY + DUPLICATED` | Cloud task 为真源；合并为单 current workflow ref，terminal/24h 清理 |
| weather | `CORRECT_PLACEMENT`，lifecycle/failure 不正确 | 保留单 compact record，物理 TTL/stale window，cache 写 fail-open |
| identity/session | `CORRECT_PLACEMENT`，authority/失败语义需修正 | 版本化最小 auth resume；不得以 local openid 作为服务端授权证据 |
| favorite/worn cache | 云 truth `CORRECT_PLACEMENT`；完整本地副本 `DUPLICATED` | L0 status overlay 或 bootstrap boolean/ref；mutation 成功以云端为准 |
| profile | `OVER_PERSISTED` | explicit profile 保持云 truth；L1 只存 revisioned compact bootstrap |
| diagnostics | `SHOULD_BE_MEMORY + TEMP_ONLY` | 生产禁写；显式 QA artifact 固定 key、短 TTL、启动清理 |

## 6. Cache 架构

`CACHE_MODEL=`

| cache type | owner layer | example | contract |
| --- | --- | --- | --- |
| `SESSION_CACHE` | L0 | page query、cloudResponseCache、outfit status、image readiness | process/session TTL + entry cap；退出/切账号清理 |
| `PERSISTED_CACHE` | L1 | Today/Wardrobe/Profile bootstrap、last weather | 固定 allowlist key；compact projection；物理 TTL；bytes/entries cap |
| `ASSET_CACHE` | L2 | 下载缩略图、wx temp selection | 独立 file index、TTL/LRU、terminal cleanup；不计入 L1 budget |
| `SERVER_CACHE` | L3 | weather cache、candidate pool、recommendation batch/canonical copy cache | user isolation、TTL、max bytes/records、miss 后重建、服务端清理 |

通用 `pageCache` 的目标是拆分并退役 persisted 能力：

- `RuntimeQueryCache`：纯 L0，为 Wardrobe/Favorite/History/Detail 查询服务。
- `BootstrapProjectionStore`：L1 固定 schema/固定 key，不接受任意 page key。
- `AssetCache`：L2 图片文件与独立 index。
- server cache client：只传 identity，不把服务端 payload 再镜像进 L1。

LRU 只用于确有多个 entry 的已登记 cache；它不是让错误 placement 继续存在的理由。固定单 entry projection 用覆盖和 TTL 即可。

### 6.1 L3 workflow/cache retention baseline

这些是 Target Architecture 的 lifecycle 下界/上界，不表示当前代码已经实现。物理回收由 CloudBase TTL index 或定时 GC 负责，不能只有 read-time miss。

| server data | usable lifetime | physical retention / bound | owner action |
| --- | --- | --- | --- |
| candidate pool | 10 min | expiry 后 24h 内物理删；单 assembled pool 256KiB、chunk data 240KiB | Recommendation cache owner |
| recommendation batch V2 | Today 当次恢复 + Detail reference | 48h 后物理删；每用户只保留 bounded recent occurrences | Recommendation occurrence owner |
| weather cache | provider freshness window | 过期 location record 24h 内删或覆盖 | Weather owner |
| copy job | 运行至 terminal | terminal 7d 内删；failed job 不无限累积 | Copy job owner |
| canonical copy / AI review | input/prompt/model version 有效期 | 30d inactive TTL；命中刷新不突破 per-user cap | AI derived-cache owner |
| upload batch/image/draft | active workflow | terminal 7d 后清 metadata；无引用 intermediate file 更早清 | Upload owner |
| raw behavior event | learned profile 输入 | 最长180d；聚合/删除合同由 PB-22/PB-33执行 | Learning/Data governance |

48h recommendation batch retention 大于本地 Today 同日 stale window，可保证合法 L1 reference 在使用期内仍有 L3 recovery owner。具体成本上限与 CloudBase TTL/index 部署证据在 PB-11/PB-12 冻结。

## 7. Upload 临时数据

`UPLOAD_TEMP_MODEL=`

| data | source of truth | recovery | terminal cleanup | orphan cleanup |
| --- | --- | --- | --- | --- |
| `uploadBatchImages` | 当前是 L1；目标为 `upload_batches/upload_images` | L1 只记 current batchId；重新打开从云端 task list 拉取 | saved/discarded/deleted/expired 立即删 ref | 启动检查 >24h ref；查询云状态后删本地 |
| upload task | CloudBase batch/image/draft 状态 | 按用户查询非 terminal task | terminal 后 server retention/cleanup policy | 服务端定时扫描 stuck/expired task |
| segmentation intermediate | Cloud function runtime / Cloud Storage temporary object | 不要求客户端恢复；stage 可服务端重试 | 成功生成 canonical crop/clean 后删除无引用 intermediate | 定时按 prefix、createdAt、DB reference sweep |
| confirmation draft | `clothes_drafts` + canonical draft assets | 客户端只持 draftId/batchId | confirm/discard 后标 terminal并按 retention 清理 | 服务端清理过期 draft；不可仅依赖客户端回访 |
| pre-upload selected image | wx temp file | 当前页面内重选；若 app 退出可失去 | upload accept/取消/页面终点 | app 启动不承诺恢复 OS temp file |

L2 当前没有 app-managed persistent file cache，PB-04 保持 `PERSISTED_ASSET_CACHE_BUDGET=0`。未来若为了离线缩略图启用 `saveFile`，必须先新增独立 ADR、真机容量测量、file registry、引用计数和 orphan sweep，不能借用 L1 registry 的 512 KiB。

## 8. Behavior Learning 未来合同

`BEHAVIOR_LEARNING_STORAGE_MODEL=`

- raw event：服务端 ack 后以 `outfit_behavior_events` 为真源；客户端不得保留无限日志。
- pending local queue：只有 PB-22 明确要求离线不丢事件时才启用；`maxEntries=50`、`maxBytes=64 KiB`、`maxAge=72h`，按 FIFO 批量发送，每批最多20条。
- ack/delete：服务端按 `eventId + owner` 幂等；客户端只删除已明确 ack/duplicate-accepted 的记录。永久 invalid 事件丢弃并只记聚合计数；暂时失败指数退避。
- offline behavior：业务操作仍以业务 API 成功为准；离线不可完成的 Favorite/Wear 不伪造行为事件。可独立发生的 exposure/detail 可排队，超龄或超上限按 FIFO 驱逐。
- cloud event/aggregate：raw events、retention、聚合和 deletion policy 在 L3；`learned_style_profiles` 是可重算服务端派生 truth。
- local summary：默认不保存完整 Learned Profile；若 UI 需要，只允许 `profileVersion/status/generatedAt/sourceRevision` 等小摘要进入 profile bootstrap budget。
- 禁止字段：图片、标题、城市、AI raw result、prompt、完整 Outfit、自由文本、跨用户标识继续不得进入行为 queue。

当前 50 条内存队列、单批20条、失败不写 L1 的实现与 V1 安全基线一致；PB-22 不得未经 registry 审查把它直接改为无限持久队列。

## 9. Failure semantics

`FAILURE_MODEL=`

| operation | failure behavior |
| --- | --- |
| CACHE write | 记录结构化诊断；清本 namespace expired/LRU 后最多 retry once；仍失败则 fail-open，返回原业务成功 |
| CACHE read/corruption | 删除该 allowlisted record，按 miss 处理；不得全盘 clear |
| TEMP/workflow ref write | 云端已接受时继续成功并标记“本机不可恢复”；云端未接受且本地文件也不可用时仅该图片显式失败/允许重选 |
| USER_CRITICAL auth resume write | 当前远端登录保持成功，runtime session 可继续；显式记录“下次需重新登录”的 recoverability 状态，不伪造成登录失败 |
| Cloud business write | 由 owning API 明确失败；不得用本地 optimistic snapshot 伪造成功 |
| Cloud truth success + local projection failure | 最终结果必须是业务成功；允许下一次 cache miss/reload |
| diagnostics write | 永远不能影响产品请求或 acceptance 之外的业务状态 |

quota recovery 顺序：物理删除 expired `BOOTSTRAP_CACHE/PENDING_QUEUE` 已 ack 项 -> LRU bootstrap projection -> legacy/diagnostics allowlist -> retry 当前非关键 L1 write 一次。不得驱逐 auth resume 或未 ack workflow/event，再次 quota 失败后停止，不无限 retry。

## 10. Migration model

`MIGRATION_MODEL=versioned + idempotent + allowlist-only + preserve-cloud-truth`

迁移入口以 `storageMeta:v2` 保存 checkpoint；每一步先写新 schema、校验可读，再删除明确列入 allowlist 的旧 key。中断后从 checkpoint 重跑，不使用 `clearStorage()`。

| legacy/current family | migration |
| --- | --- |
| `userId/openid/token/userProfileCache:v1` | 保留可用登录恢复信息，转换为 `authResume:v2/profileBootstrap:v2`；校验后删旧 profile；服务端仍重新验证身份 |
| `outfitDetailDraft:*` 多 aliases | 从最近有效记录提取 OutfitRef；最多保留一个 compact fallback；删除所有完整 aliases |
| `pageCache:outfitDetail:*` | 全部视为可重建 cache 删除；不迁移 full payload |
| Favorite/History page cache | 删除 full payload；不迁移100/10个完整 Outfit；首次打开重新请求 |
| Wardrobe filter page cache | 可从最新 active first page 生成单 compact bootstrap；其余删除 |
| Today old restore/home-light | 仅最新且 identity/schema 有效者转为 `todayBootstrap:v2`；旧版本、null marker 和重复 snapshot 删除 |
| `uploadBatchImages:*` | 合并成 current workflow refs并标 `needsServerVerification`；在线以云端 task status确认，terminal/超龄本地 key删除 |
| expired weather/profile cache | 有效且可裁剪则迁移；超 stale window 删除 |
| acceptance/performance/TTUI diagnostics | 生产启动按明确 key 删除；QA 环境按短 TTL 固定覆盖 |
| migration markers/old schemas | 只保留当前 checkpoint；完成后删除已列明旧 marker |

用户业务数据不依赖这些 L1 full snapshots：衣物、收藏、穿着历史、上传 task 已在云端。对云端状态不确定的 active upload 只删本地冗余 payload，不删除 CloudBase record/file。

## 11. 对上一版修复方案的判断

`IS_PREVIOUS_FIX_PLAN_OPTIMAL=PARTIAL`

| previous item | decision | reason |
| --- | --- | --- |
| Storage registry | `KEEP/MODIFY` | 保留，但升级为 deny-by-default placement registry，不只是 key 清单 |
| LRU | `MODIFY` | 只用于仍合法的多 entry cache；Detail/History 错层数据先移出 L1，不能靠 LRU 合法化 |
| TTL physical cleanup | `KEEP` | TTL 必须同时控制可见性和物理占用，并有启动/读/写清理 |
| quota retry | `MODIFY` | 只清 allowlisted可重建数据并 retry once；云端成功绝不因本地 retry 失败而失败 |
| snapshot compact/reference | `MODIFY` | reference-first；compact snapshot 仅限单一离线恢复投影或云端历史事实，不再多 alias |
| 2.5625 MiB budget | `DROP/REPLACE` | 数字基于保留当前 full History/Favorite/Detail payload；目标 placement 后不应继续为错误数据预留空间，改为512KiB软上限 |
| migration | `KEEP/MODIFY` | 必须 versioned/idempotent/allowlist，先 transform/验证再删，不只做一次性 sweep |

上一版正确识别了有界化、物理清理和失败恢复，但仍偏局部 cache 治理。Target Architecture 先移走错层数据，再对剩余少量 L1 数据使用 registry/TTL/budget。

## 12. 实施分期

### PHASE_1 — PB-04 直接关闭范围

1. 建立 deny-by-default L1 registry、byte estimator、scope 与512KiB全局预算。
2. 拆分 `pageCache`：页面查询改 L0；Today/Wardrobe/Profile/Weather 使用固定 compact projection。
3. Detail handoff 改传 `OutfitRef`，删除 multi-alias draft 与动态 persisted detail cache。
4. History/Favorite 不再持久化完整列表；上传 batch key 合并为 bounded current workflow ref。
5. 实现物理 TTL、namespace cap、选择性 eviction、quota retry once 和不反转业务成功的失败语义。
6. 运行 versioned allowlist migration，清理 duplicate/expired/diagnostic/orphan local records。
7. 自动化验证账号/环境切换、logout、schema upgrade、quota exception；真机验证 0/200、200/200 衣橱及长周期 Detail/History 后容量稳定。

PB-04 不要求在本期重塑 CloudBase favorite/history schema；可先使用现有 `outfits`、`favorite_outfits`、`outfit_history`、`recommendation_batches_v2` source-specific ID 解析，客户端统一 `OutfitRef` 即可关闭本地无界问题。

### PHASE_2 — PB-11 后续治理

1. 规范化 CloudBase Outfit/favorite/history 引用，减少云端非历史语义的重复 snapshot。
2. 完成 rename/edit/delete 后 snapshot/reference 一致性与跨会话 seen ledger。
3. 为 server recommendation batch/canonical copy/candidate pool 建立统一 retention job 与成本遥测。
4. 如确有产品收益，再设计 L2 managed thumbnail cache、独立预算和 orphan sweep。
5. 处理生产 pool-save、media URL freshness 和异常恢复 smoke。

### PHASE_3 — PB-22 Behavior Learning

1. 决定是否启用64KiB durable pending queue；保持 cloud ack 幂等和72h/50条边界。
2. 建立 raw event retention、聚合刷新、Learned Profile revision 与删除/重置路径。
3. Recommendation Input 只引用 gated learned profile version，不复制 raw events/profile 到 L1。
4. 以 shadow、bounded weight、解释 evidence、rollback 验证消费闭环。

## 13. PB-04 Definition of Done

`PB04_IMPLEMENTATION_SCOPE=只实现关闭客户端 Local Storage 架构风险所需的 registry、placement 收缩、bounded projection、failure semantics、migration 和验收；不借机完成 PB-11 云端归一化或 PB-22 学习闭环。`

PB-04 仅在以下全部满足时关闭：

1. L0-L3 owner/source-of-truth 规则被代码与测试执行，所有生产 L1 key 均在 registry。
2. 不再存在按 page/filter/outfit/batch 无界增长的业务对象持久化。
3. Outfit Detail 以统一 reference 恢复；客户端不存在多 alias 完整 Outfit truth。
4. persisted cache 同时有 TTL、物理删除、maxEntries、maxBytes 和 eviction policy。
5. upload temp/workflow 有 terminal cleanup、24h orphan policy 和云端恢复路径。
6. cache/quota failure 不会把登录、天气或已成功 Cloud mutation 反转为业务失败。
7. migration versioned、幂等、allowlist-only；身份、未完成 workflow 和云端用户数据不丢。
8. 目标 steady state <=384KiB，所有声明 namespace 总量不超过512KiB；真机 long-run 访问后总量回归稳定。
9. 真机记录 `keys/currentSize/limitSize`，覆盖 0/200、200/200、Detail LRU边界、History分页、上传中断、logout/账号切换和 quota 注入。
10. PB-22 任何 future local queue 必须遵守50条/64KiB/72h/ack-delete 合同，不能重新引入无限行为日志。

## 14. 明确不在本架构定稿实施

本文提交不修改业务代码、不执行迁移、不新增 LRU、不改 storage schema、不部署、不启用 PB-22。所有实现动作从后续 PB-04 implementation commit 开始，并按上述分期验收。

## 15. 决策摘要

```text
STATUS=APPROVED_FOR_PB04_IMPLEMENTATION
CURRENT_STORAGE_ARCHITECTURE_ASSESSMENT=Cloud truth 基本存在，但 L1 placement 混乱、完整对象重复、动态 key 无界、TTL 不回收、TEMP 无统一终点、quota failure 可污染业务成功；miniapp CloudBase 与 Web/PostgreSQL 还是未同步的平行数据面。
IS_PREVIOUS_FIX_PLAN_OPTIMAL=PARTIAL
WHY=registry、TTL、quota recovery、migration 方向正确；但必须先移出错层数据，LRU 不能保住 full Detail/History snapshots，2.5625MiB 旧预算也必须按 target projection 重算。
TARGET_ARCHITECTURE=L0 session runtime；L1 allowlisted recovery control plane；L2 binary/temp asset cache；L3 CloudBase canonical truth/server cache/Cloud Storage。
MAJOR_PLACEMENT_CHANGES=Detail/History/Favorite/page query 由 full persisted objects 改 L0 或 refs；Upload 动态 batch keys 改单 workflow ref；diagnostics 移出生产 L1；图片继续不进 L1。
WHAT_STAYS_IN_LOCAL_STORAGE=versioned auth resume、compact profile/weather/Today/Wardrobe bootstrap、一个 upload workflow ref、storage metadata，以及 PB-22 未来可选 bounded pending queue。
WHAT_MOVES_OUT=full Outfit drafts/state sync、dynamic persisted Detail/filter cache、full Favorite/History page payload、生产 diagnostics、任何 image binary/raw AI payload/unbounded event log。
WHAT_BECOMES_REFERENCE_ONLY=Outfit Detail handoff、Today cards 的 canonical identity、Favorite/Worn status、History list rows、Candidate Pool 和 image metadata linkage。
CACHE_STRATEGY=pageCache persisted 通用能力退役；拆为 L0 RuntimeQueryCache、L1 BootstrapProjectionStore、L2 AssetCache、L3 ServerCache。
OUTFIT_STRATEGY=PB-04 统一 OutfitRef 并复用现有 Cloud source IDs；PB-11 收敛 versioned composition + immutable OutfitRevision，Favorite 变 relation，History 变 event +最小合法 snapshot。
OUTFIT_PERSISTENCE_MODEL=CloudBase owns composition/materialized outfit/favorite/wear truth；L1 只保存固定 bounded projection，不保存多个完整 Outfit truth。
UPLOAD_STRATEGY=Cloud upload_batches/upload_images/clothes_drafts 为 workflow truth；本地只持当前 ref和wx temp file；terminal即时清，24h本地 orphan检查，云端定时GC元数据及无引用文件。
BEHAVIOR_LEARNING_FUTURE_CONTRACT=raw event在Cloud；可选pending queue最多50条/64KiB/72h，服务端逐事件ack/duplicate-accepted后删除；Learned Profile留Cloud且不覆盖Explicit Profile。
STORAGE_SOFT_BUDGET=steady state <=384KiB；global high-water 384KiB；global soft limit 512KiB；declared namespace caps 368KiB。
CAPACITY_MODEL=按目标 compact payload估算并以真机production-shaped数据校准；10MiB是hard constraint和安全边界，不是使用目标。
MIGRATION_MODEL=versioned、idempotent、allowlist-only、write-validate-delete、preserve cloud truth；禁止clearStorage。
PB04_IMPLEMENTATION_SCOPE=registry、placement收缩、bounded projection、物理TTL/eviction、quota failure isolation、安全migration、真机容量验收。
PB11_LATER_SCOPE=Cloud OutfitRevision/Favorite/History归一化、server cache retention/GC、rename/delete/reference一致性、可选L2 managed asset cache。
PB22_FUTURE_SCOPE=durable behavior queue（若需要）、raw event retention、learned profile自动刷新与受控推荐消费；不得扩大L1预算。
ARCHITECTURE_DOCUMENT=docs/architecture/local-data-and-cache.md
```

## 16. 仓库证据索引

- 当前 Local Storage inventory、增长模型和 fixture 测量：[storage-10mb-audit.md](../qa/storage-10mb-audit.md)
- 通用 persisted `pageCache` 双写及过期只 miss：[pageCache.ts](../../apps/miniapp/src/lib/pageCache.ts)
- Outfit normalized snapshot 三数组、多 identity alias：[outfitSnapshot.ts](../../apps/miniapp/src/utils/outfitSnapshot.ts)
- Today V2 compact projection：[todayV2Adapter.ts](../../apps/miniapp/src/pages/today/todayV2Adapter.ts)
- V2 Detail 通过 recommendation batch reference 回源：[generateOutfit/index.js](../../apps/miniapp/cloudfunctions/generateOutfit/index.js)
- Candidate Pool 10分钟 TTL 与256KiB记录预算：[candidatePool.js](../../apps/miniapp/cloudfunctions/generateOutfit/services/candidatePool.js)
- 当前行为队列50条、服务端事件最小化合同：[outfit-behavior-events-v1.md](../outfit-behavior-events-v1.md)
- Learned Profile 云端派生合同：[learned-style-profile-v1.md](../learned-style-profile-v1.md)
- Upload batch/draft/asset pipeline：[wardrobe-asset-pipeline-v2.md](../wardrobe-asset-pipeline-v2.md)
