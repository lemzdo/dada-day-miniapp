# PB-04 微信本地 Storage 10MB 容量专项审计

- 审计日期：2026-09-14；实施证据更新：2026-09-20
- 审计基线：`main@a8fa942`
- 审计范围：微信小程序本地数据缓存、相关生命周期及容量失败路径
- 审计边界：第 1-12 节保留 2026-09-14 根因快照；第 13-15 节记录 2026-09-20 实施与验收状态
- 结论：`PB04_STATUS=IMPLEMENTED_PARTIAL_DEVTOOLS_SMOKE`

## 1. 平台与审计口径

`STORAGE_SYSTEM=wx / Taro miniapp local data storage`

`LIMIT_SEMANTICS=同一微信用户、同一小程序的 aggregate storage 总量上限，不是单 key 上限`

`CURRENT_PLATFORM_CONTRACT=10 MB aggregate；storage 按微信用户和小程序隔离；本地数据缓存与文件缓存是不同系统`

仓库没有保存当前真机 `wx.getStorageInfoSync()` 的 `currentSize` / `limitSize` 证据。微信开发者
文档页面在本次审计环境中无法直接抓取；腾讯云官方 Storage 文档镜像明确给出“一个微信用户的
小程序 Storage 上限为 10 MB”，并列出 `wx.setStorage*`、`wx.getStorage*`、
`wx.removeStorage*`、`wx.clearStorage*` 这一组本地数据缓存 API：

- <https://intl.cloud.tencent.com/ind/document/product/1219/61746>

本仓库 miniapp 生产源码没有 `wx.saveFile`、`getSavedFileList`、`FileSystemManager` 等客户端
持久文件缓存调用，也没有把 base64 图片写入 Storage。Cloud Function 的 `downloadFile` 是服务端
处理路径，不计入客户端 10 MB Storage。因此 PB-04 不是图片文件缓存或 Web
`localStorage` / IndexedDB 问题。

容量审计按 `Buffer.byteLength(JSON.stringify(value), 'utf8')` 做确定性相对比较。这不是微信
DevTools 的真实 `currentSize`，只用于识别大户、重复系数和增长阶数；真机容量仍需在修复验收时
用 `wx.getStorageInfoSync()` 复核。

## 2. 当前 Storage 架构

当前有三条持久化路径：

1. 直接 `Taro.*StorageSync`：身份、profile、天气、验收/性能诊断和 migration marker。
2. `userStorage`：`d1d:userStorage:v1:<userScope>:<businessKey>`，做用户隔离，但只吞掉异常，
   没有预算、大小统计、TTL、entry 上限或 quota recovery。
3. `userPageCache -> pageCache`：`d1d:pageCache:<userScope>:<pageKey>`，记录 TTL 和 schemaVersion；
   过期只返回 miss，不物理删除。仅在命中无效 schema 或显式 mutation invalidation 时删除。

`cloudResponseCache`、`outfitStatusMap` 和 `uploadTaskLocalCache` 是进程内 `Map`，不占微信
Storage。其中 upload task 的内存缓存有 5 秒 TTL；不要与 `uploadBatchImages:<batchId>` 的
持久 Storage key 混淆。

## 3. Storage inventory

表中 `CURRENT_ENTRY_COUNT` 是代码可推导的上限或 `UNKNOWN`，不是用户设备实测。

| KEY_OR_PREFIX | WRITE / READ CALLSITE | OWNER / DATA / PURPOSE | 分类 | 生命周期与删除 | BOUNDED |
| --- | --- | --- | --- | --- | --- |
| `userId`、`openid` | `stores/userStore.ts:70-71, 94-95, 235-248, 325-343` | UserStore；身份字符串；本地启动和 user scope | A `USER_CRITICAL`（可重新登录获得，但运行上必须保护） | 登录覆盖；logout / 登录失败只删这两个 key；没有 quota recovery | YES：各 1 条 |
| `userProfileCache:v1` | `stores/userStore.ts:17, 67-85, 230-234, 325-343` | UserStore；完整 `CloudUserProfile`；本地身份/profile hydration | C `RECOMPUTABLE_CACHE`，含用户数据 | 登录覆盖；logout 和版本升级不删除；无 TTL | YES：1 条，但 payload 无字节上限 |
| `token` | `packages/api/src/client.ts:29, 193-198` | shared API client；Bearer token 读取 | A `USER_CRITICAL` | 当前 repo 没有写入或删除 callsite，属于潜在/兼容 key | UNKNOWN（当前不持续增长） |
| `d1d:lastWeather` | `lib/cloud.ts:156, 353-369, 1331-1352`；`components/WeatherCard/index.tsx:329-339` | 天气快照；离线/失败降级 | C `RECOMPUTABLE_CACHE` | 逻辑 TTL 10 分钟；过期读取不删除；force refresh 删除；固定覆盖 | YES：1 条 |
| `generateOutfit:acceptance-transport:v1` | `lib/cloud.ts:157-158, 747-773, 912-935` | 验收 transport 诊断 | D `TEMPORARY / DIAGNOSTIC` | acceptance 运行时覆盖；无 TTL/启动清理；正常产品请求通常不写 | YES：1 条，payload 无字节上限 |
| `generateOutfit:performance-ledger:v1` | 同上 | Recommendation performance artifact | D `TEMPORARY / DIAGNOSTIC` | diagnostics/acceptance 请求覆盖；无 TTL/启动清理 | YES：1 条，payload 无字节上限 |
| `today:performance-ledger:v1` | `lib/performance/todayPerformanceLedger.ts:4-8, 104-152, 292-293` | Today 性能账本，最多 5 次历史 | D `TEMPORARY / DIAGNOSTIC` | 仅诊断环境启用；数组限 5；没有生产启动清理 | YES：1 条、history 5 |
| `today:ttui-hard-invalid-acceptance:v1` | `pages/today/index.tsx:210-229` | DevTools 验收请求 | D `TEMPORARY / DIAGNOSTIC` | app 只读后删除；写入来自验收 runner | YES：1 条 |
| `d1d:migration:user-cache-isolation:v1:<environmentScope>` | `lib/legacyUserCacheCleanup.ts:6-9, 38-75, 90-101` | 一次性 migration marker | D `TEMPORARY / DIAGNOSTIC` | 每个 env/cloud scope 1 条；无 marker 版本清理 | 按环境 scope，代码无全局数量上限但 payload 极小 |
| `d1d:userStorage:v1:<scope>:wardrobeNeedsRefresh` / `detailNeedsRefresh` | `pages/wardrobe/index.tsx:317-320`；`pages/clothing-detail/index.tsx:167-170, 217`；`pages/clothing-form/index.tsx:143-144`；upload confirm `:616` | UI mutation refresh marker | B `BUSINESS_STATE`（短期一致性信号） | 部分路径消费删除；重复写覆盖；scope 退出不清理 | 每 scope 固定 2 条 |
| `...:pendingWardrobeNotice` | `pages/upload-confirm/uploadTerminalDiscardFlow.js:1-33, 80`；wardrobe `index.tsx:297-303` | 舍弃上传后的单次提示 | D `TEMPORARY` | wardrobe 消费删除；异常中断可残留；覆盖 | 每 scope 1 条 |
| `...:uploadBatchImages:<batchId>` | wardrobe `index.tsx:411-428`；upload-confirm `index.tsx:246-288`；discard flow `:36-83` | 每批最多 9 个 upload image ID，恢复处理队列 | B `BUSINESS_STATE`（短期工作流） | 正常处理完成/终态舍弃时删除；放弃页面、崩溃、长期未回访没有 TTL/startup sweep | **NO**：按 batchId 增长 |
| `...:outfitDetailDraft%3Arecommendation-copy-contract-v8:<id>` | `utils/outfitSnapshot.ts:17-18, 70-74, 131-141`；favorite `index.tsx:409-414`；detail `index.tsx:993-1001` | 完整 normalized `Outfit`，供详情页 handoff/fallback | C `RECOMPUTABLE_CACHE`，含用户收藏/穿搭快照 | 一个 outfit 按 `id/outfitId/favoriteOutfitId/recommend:<outfitKey>` 去重后写 1-4 份；**当前没有任何删除、TTL、LRU 或数量上限** | **NO** |
| `...:outfitStateSync` | `utils/outfitSnapshot.ts:18, 77-89`；favorite `index.tsx:413-414`；detail `index.tsx:997` | 完整 normalized `Outfit`，页面返回状态同步 | B `BUSINESS_STATE`（短期 handoff） | 正常消费立即删除；中断时保留；重复写覆盖 | 每 scope 1 条 |
| `...:today:outfitReturnSnapshot:recommendation-copy-contract-v8` | `utils/outfitSnapshot.ts:19, 91-119` | 旧 Today 返回快照兼容 | C `RECOMPUTABLE_CACHE` | 当前产品源码只读/patch/clear，没有创建路径；旧版本或 runner 可遗留；scope migration 不清当前 scoped key | 每 scope 1 条，但旧 payload 可能很大 |
| `...:today:recommendationInput:{wardrobeVersion,profileVersion,latestIdentity,context,hardInvalid}` | `lib/recommendationInputKeys.ts:1-5`；`recommendationMutationCoordinator.ts:87-165, 268-323` | 推荐输入身份、一致性版本、hard invalid marker | B `BUSINESS_STATE` | 固定 key 覆盖；hardInvalid 用写 `null` 而不是删除；logout 不清理 | 每 scope 5 条 |
| `...:d1d:today:v2:home-light` | `lib/recommendationInputKeys.ts:6`；Today `index.tsx:560-562, 764-766, 1229-1257, 1393-1421, 1483-1507`；`todayV2Adapter.ts:10-108` | 8 张 light card + batch core 的 Today 恢复快照 | C `RECOMPUTABLE_CACHE` | 固定 key 覆盖；wardrobe/profile mutation 写 `null`；无 TTL/字节上限 | 每 scope 1 条，cardCount 强制 1-8 |
| `d1d:pageCache:<scope>:wardrobe:first:v1:10:<category>:<subcategory>:active` | wardrobe `index.tsx:52-63, 157-162, 177-236, 895-909` | 每个筛选条件的首页 10 件完整 `Clothing` + capacity/pagination | C `RECOMPUTABLE_CACHE` | TTL 45 秒但到期不删除；wardrobe mutation 清整个 prefix | 条目数量无显式上限；受可达筛选组合间接约束 |
| `...:profile:{base,stats}:v1` | profile `index.tsx:55-58, 253-257, 685-700` | profile 基础信息与统计 | C `RECOMPUTABLE_CACHE` | TTL 30 分钟 / 2 分钟；到期不删除；profile/wardrobe/worn mutation 定向清理 | 每 scope 2 条 |
| `...:favorites:first:recommendation-copy-contract-v8:10` | favorite `index.tsx:36-50, 186-192, 622-632` | 首页 10 个完整 `Outfit` | C `RECOMPUTABLE_CACHE` | TTL 2 分钟；到期不删除；favorite/wardrobe mutation 清理 | 每 scope 1 条，10 outfits |
| `...:history:first:recommendation-copy-contract-v8:100` | history `index.tsx:25-40, 152-167, 177-183, 479-489` | 首页 **100 个完整 `Outfit`** | C `RECOMPUTABLE_CACHE` | TTL 2 分钟；到期不删除；worn/wardrobe mutation 清理 | 每 scope 1 条，100 outfits；单 payload 没有字节上限 |
| `...:outfitDetail:recommendation-copy-contract-v8:<source>:<detailId>:<scene>` | detail `index.tsx:100-101, 159-182, 531-539, 1043-1058` | 去掉少量状态字段后仍保存完整 normalized `Outfit` | C `RECOMPUTABLE_CACHE` | TTL 5 分钟但到期不删除；只有相关 mutation 清 prefix | **NO**：按 source/detailId/scene 增长 |

## 4. 量化证据

### 4.1 当前真实用户占用

- `CURRENT_ENTRY_COUNT=UNKNOWN`
- `CURRENT_TOTAL_BYTES=UNKNOWN`
- 原因：repo 没有当前真机 Storage dump、`currentSize`、key size 分布或生产遥测。
- 不用 fixture 数字冒充真实用户占用。

### 4.2 可重复测量

执行了两个只读、确定性 Node 序列化测量，没有创建测试基础设施或修改源码。

1. `MEASURED_DETERMINISTIC_REPO_FIXTURE`
   - fixture：`recommendationScalingFixtures.buildWorstCaseWardrobe(200)`；200 来自 Wardrobe
     Capacity V1 正式 free 上限。
   - 单件 fixture：平均 352 bytes，P95 359 bytes。
   - 200 件对象本身合计 70,390 bytes。
   - 当前真正写入的 wardrobe first-page 10 件 record：3,813 bytes。
   - 限制：该 scaling fixture 没有生产图片 URL 和全部识别 evidence，因此不能代表生产衣物 P95。

2. `ESTIMATED_FROM_REPO_FIXTURE_AND_CURRENT_NORMALIZER_FIELDS`
   - fixture：`recommendationLanguageV3.fixtures.graphicTeeHome`，再按
     `utils/outfitSnapshot.ts:29-59, 164-261` 的当前重复字段构造 normalized snapshot。
   - 原始 outfit：1,541 bytes；normalized outfit：4,038 bytes（约 2.62 倍）。
   - 单个 detail page-cache record：4,345 bytes。
   - history first page 100 outfits：396,705 bytes。
   - favorites first page 10 outfits：39,875 bytes。
   - Today V2 8 张 light cards：5,305 bytes。
   - 限制：fixture 的图片 URL 为空或很短，属于低载荷估算；真实 URL、AI evidence、标题和
     snapshot 字段会增大结果。

### 4.3 增长模型

| Family | GROWTH_MODEL | MAX_BOUND | BOUND_ENFORCED_BY_CODE |
| --- | --- | --- | --- |
| 固定身份/profile/weather/Today/诊断 key | `O(1)` / user scope | 固定 key 数；部分 payload 无 byte bound | PARTIAL |
| history first-page | `O(min(历史数, 100))` | 100 个完整 Outfit | YES（entry count），NO（bytes） |
| favorites first-page | `O(min(收藏数, 10))` | 10 个完整 Outfit | YES（entry count），NO（bytes） |
| wardrobe first-page family | `O(访问过的筛选组合 × 10 件衣物)` | 没有 namespace entry/byte bound | NO |
| `uploadBatchImages:<batchId>` | `O(中断或放弃的 batch 数)` | 每 batch 9 IDs；batch key 数无上限 | NO |
| outfit detail page cache | `O(访问过的不同 source/detailId/scene)` | 无 | NO |
| outfit detail draft | `O(访问过的不同 outfit × 1..4 aliases)` | 无 | NO |

当前 fixture 下，每个独立 outfit 同时产生 detail page cache，再由 detail draft 保存 2、3、4 个
alias 时，分别约增加 12,421、16,459、20,497 bytes。忽略其它 key，10 MiB 对应约 844、637、
511 个不同已访问 outfit。这个数字只证明容量最终必然可达，不是生产用户的“到限时间”；由于
fixture 缺少真实长 URL/evidence，实际达到上限可能更早。没有足够事件频率证据，
`TIME_TO_LIMIT_ESTIMATE=UNKNOWN`。

## 5. 无界增长源

### 5.1 完整 outfit detail draft 多别名复制

- `GROWTH_SOURCE=outfitDetailDraft:*`
- `TRIGGER=从收藏/推荐详情保存或更新不同 outfit`
- `DATA_ADDED_PER_TRIGGER=1 个 normalized Outfit 被写入 1-4 个 alias key`
- `REMOVAL_PATH=NONE`
- `UNBOUNDED=YES`
- `USER_ACTION_TO_TRIGGER=持续浏览不同收藏/推荐详情并产生状态更新`
- `TIME_TO_LIMIT_ESTIMATE=UNKNOWN；fixture 模型为约 511-844 个不同 outfit（叠加 detail page cache）`

### 5.2 动态 outfit detail page cache

- `GROWTH_SOURCE=d1d:pageCache:<scope>:outfitDetail:*`
- `TRIGGER=加载不同 source/detailId/scene 的详情`
- `DATA_ADDED_PER_TRIGGER=约 1 个完整 normalized Outfit record`
- `REMOVAL_PATH=wardrobe mutation、部分详情相关 mutation 的 prefix clear`
- `UNBOUNDED=YES；TTL 到期不删除`
- `USER_ACTION_TO_TRIGGER=持续查看不同详情且不发生会触发全 prefix 清理的 mutation`
- `TIME_TO_LIMIT_ESTIMATE=UNKNOWN`

### 5.3 abandoned upload batch IDs

- `GROWTH_SOURCE=uploadBatchImages:<batchId>`
- `TRIGGER=每次成功上传一批图片后进入确认页`
- `DATA_ADDED_PER_TRIGGER=最多 9 个 image ID + 1 个动态 key`
- `REMOVAL_PATH=处理完成或终态舍弃`
- `UNBOUNDED=YES（异常退出/长期不回访时）`
- `USER_ACTION_TO_TRIGGER=重复创建上传批次后中断`
- `TIME_TO_LIMIT_ESTIMATE=UNKNOWN；单条很小，不是首要大户`

### 5.4 过期 page cache 不物理回收

`pageCache.ts:155-157` 在 record 过期且 `allowExpired=false` 时只返回 miss；所有生产调用都使用
默认值，没有调用 `allowExpired`。因此 TTL 只控制可用性，不控制占用。动态 key family 的历史
record 会持续留在 Storage，直到恰好发生对应 prefix invalidation。

## 6. 数据分类与保留边界

### A. USER_CRITICAL

- `userId`、`openid`、未来可能存在的 `token`。
- 这些值可通过远端登录重新获得，不是不可恢复的业务真相，但当前启动/鉴权路径依赖它们，必须
  在 eviction 中设为受保护项。
- 用户衣物、收藏、历史、穿搭点评等权威数据不在微信 Storage，而在 CloudBase / BFF 数据层。

### B. BUSINESS_STATE

- 推荐输入 version/context/hard-invalid、refresh marker、短期 `outfitStateSync`、上传处理中 image IDs。
- 需要短期持久化以保证一致性或续作，但应有短 TTL、固定数量或可从服务端恢复的冷启动策略。

### C. RECOMPUTABLE_CACHE

- user profile snapshot、weather、Today V2、Wardrobe/Profile/Favorite/History/Detail page cache、
  outfit detail draft、旧 Today restore snapshot。
- 丢失后可以重新登录、重新请求或从 CloudBase 中恢复。它们是 eviction 第一优先级，不应以完整
  重复快照无界增长。

### D. TEMPORARY / DIAGNOSTIC

- acceptance transport、performance artifacts、Today ledger、TTUI acceptance request、migration
  marker、pending notice。
- 诊断数据不应长期占用生产 Storage；生产禁写仍需配套启动清除旧诊断 key。

禁止采用 `clearStorage()`：它会把受保护身份和短期业务状态与缓存一起清空。

## 7. 当前容量治理

| 治理能力 | 状态 | 证据 / 缺口 |
| --- | --- | --- |
| 用户隔离 namespace | IMPLEMENTED | `userStorage`、`userPageCache` 绑定 `userScope` |
| legacy global key cleanup | PARTIAL | app 启动清旧 default pageCache 和少量旧 key/prefix，并写 marker；不清当前 scoped 动态 key和其它版本 key |
| TTL | PARTIAL | pageCache 记录 TTL，weather 读时检查 10 分钟；过期项不主动删除 |
| LRU | MISSING | 微信 Storage 任何 namespace 都无 LRU |
| max entries | PARTIAL | history=100、favorite=10、Today cards<=8、ledger history=5；动态 detail/upload/filter key 无上限 |
| max bytes / namespace budget | MISSING | `getStorageInfoSync()` 只用于枚举 key，从不读取 `currentSize/limitSize` |
| global soft limit / reserved headroom | MISSING | 无高水位或安全余量 |
| pre-write size check / eviction | MISSING | 所有持久化直接 `setStorageSync` |
| stale startup sweep | MISSING | 只执行一次 legacy migration，不扫 current expired records |
| version cleanup | PARTIAL | pageCache schema mismatch 在读取该 key 时删除；没有 namespace 版本清单或主动 sweep |
| namespace cleanup | PARTIAL | mutation 有 prefix invalidation；logout 不清当前 user page/userStorage namespace |
| logout / reset cleanup | MISSING | logout 只删 `userId` 和 `openid` |
| retry after quota error | MISSING | 没有识别 quota error、evict cache、retry once |
| quota observability | MISSING | 没有写失败分类、currentSize、key count/bytes 统计 |

## 8. quota failure 行为

1. `userStorage` 与 `pageCache`：catch 后 `console.warn` 并返回成功形态。
   - 页面内存状态通常继续工作；reopen/reload 时缓存或状态恢复丢失。
   - 调用者无法知道持久化失败，无法清可重建缓存后重试。
2. 登录：profile cache 写失败被吞掉，但紧随其后的 `userId`、`openid` 写入没有 try/catch
   （`userStore.ts:230-242`）。即使远端 login 已成功，quota exception 仍进入登录失败分支，删除身份并
   将 auth 状态置为 failed。
3. 天气：`writeLocalWeatherCache` 的 `setStorageSync` 没有 try/catch（`cloud.ts:353-365`）。真实
   weather 已返回后仍可能因本地写失败让整个 `getCloudWeather` reject；WeatherCard 把它显示为
   天气服务失败/降级。
4. strict acceptance / diagnostics：部分写入 catch 后跳过；strict V2 路径的两个写入没有 catch。
   主要影响验收，不是普通用户业务路径。

`FAILURE_MODE=部分静默 cache miss + 登录假失败 + 天气假失败；没有无限 retry`

`USER_VISIBLE_IMPACT=重启后 Today/Detail/Favorite/History 恢复退化；满额时登录可失败，天气可错误降级并提示刷新失败`

`DATA_LOSS_RISK=云端衣物/收藏/历史不丢；未落盘的短期页面状态、上传队列提示和本地快照可能丢失。无证据表明 PB-04 会删除云端用户数据。`

## 9. 根因分类

- `ROOT_A=UNBOUNDED_CACHE`：确认；动态 outfit detail cache/draft 和 abandoned upload batch key。
- `ROOT_B=DUPLICATE_SNAPSHOTS`：确认；同一 normalized Outfit 按 1-4 aliases 保存，并与 detail
  page cache、favorite/history full object cache 重复。
- `ROOT_C=OVERSIZED_PAYLOAD`：部分确认；history 首页一次保存 100 个完整 Outfit，且所有完整
  Outfit cache 无 byte bound。当前没有证据证明某个单 key 已经达到平台上限。
- `ROOT_D=LEGACY_KEY_LEAK`：未确认旧全局 key 仍在增长；已有一次性清理。但当前 scoped 旧
  version / abandoned key 没有通用 migration，属于残余迁移风险。
- `ROOT_E=MISSING_EVICTION`：确认；无 LRU、namespace entry/byte cap 或 pre-write eviction。
- `ROOT_F=MISSING_QUOTA_ERROR_HANDLING`：确认；没有 quota 分类/清缓存/retry，且登录、天气会被
  本地 cache write 反向判为业务失败。
- `ROOT_G=WRONG_DATA_PLACEMENT`：确认；可重建的完整 outfit/profile/history/detail 快照占据同步
  Storage，动态详情 handoff 应优先保存 canonical ID 或单一 compact snapshot。
- `ROOT_H=ALREADY_FIXED / HISTORICAL_ONLY`：否。

`ROOT_CAUSE=UNBOUNDED_CACHE + DUPLICATE_SNAPSHOTS + MISSING_EVICTION + MISSING_QUOTA_ERROR_HANDLING + WRONG_DATA_PLACEMENT；另有大粒度 full-object cache 和 migration 缺口。`

## 10. 与 PB-11 / PB-34 的关系

### PB-11

共同根因是 local page/detail cache 生命周期不完整。PB-11 已证明 wardrobe mutation 的定向
invalidation，但 PB-04 证明 TTL 没有物理回收、详情动态 key 无界、logout/version/quota 异常路径
未收口。PB-04 应负责统一 Storage lifecycle 与预算；Favorite/History rename 后 snapshot 同步等
语义问题仍留在 PB-11，不能借本审计直接修复。

### PB-34

free=200 不会把 200 件衣物一次写入本地：Wardrobe page cache 当前只保存每个筛选的前 10 件，
确定性 fixture 中该 record 为 3,813 bytes。因此没有证据支持“200 件衣服本身直接撞 10 MB”。

但容量从旧 50 提高到 200 会增加可达筛选组合、推荐组合、收藏/历史和不同详情访问数量；当前
增长源按“访问过的 outfit/筛选/batch”而不是只按衣物数增长。PB-34 发布 smoke 必须加入
`getStorageInfoSync()` 起止值和 200 件边界下的详情/历史浏览回归；PB-04 预算修复应先于正式发布。

## 11. 推荐修复方向（本轮不实施）

| 方案 | BENEFIT | RISK | MIGRATION_COST | USER_DATA_RISK | RECOMMENDED |
| --- | --- | --- | --- | --- | --- |
| 统一 registry + per-namespace byte/entry budget | 所有 key 有 owner、分类、payload estimator 和 hard cap | 需要覆盖 direct/wrapper 两条旧路径 | MEDIUM | LOW（先只驱逐 C/D） | YES |
| global soft limit + reserved headroom | 在平台 hard quota 前主动治理 | 设备报告单位/序列化估算需真机校准 | LOW-MEDIUM | LOW | YES |
| Cache LRU + 物理 TTL 删除 | 动态 detail/filter key 可稳定在界内 | access timestamp 会增加少量写入 | MEDIUM | LOW | YES |
| namespace max-entry count | 比纯 byte budget 更容易证明无界增长已关闭 | 上限过小会降低命中率 | LOW | LOW | YES |
| 启动 stale/version sweep | 清理已安装用户的 expired/current legacy key | sweep 必须白名单，不能扫 A/B | MEDIUM | MEDIUM | YES |
| 写前估算并先驱逐，quota 后只 retry once | 避免第一次 hard failure；消除无限 retry 风险 | 大 value 的估算成本和同步卡顿 | MEDIUM | LOW | YES |
| 保存 canonical ID / 单一 compact detail snapshot | 移除 1-4 份完整 Outfit alias，显著降低增长斜率 | 离线详情需明确 fallback | MEDIUM | LOW | YES |
| history/favorite/page cache 缩字段 | 去掉重复 snapshot/evidence/URL aliases | 字段裁剪必须有展示合同测试 | MEDIUM | LOW | YES |
| 删除重复 detail draft + page cache 层 | 单一 owner，避免同一 outfit 多层复制 | 需验证所有推荐/收藏/历史入口 | MEDIUM | LOW | YES |
| production 禁写诊断并清旧 key | 减少 D 类占用 | 不能影响 DevTools acceptance | LOW | NONE | YES |
| 新建 CloudBase 存储替代这些 cache | 没必要：权威衣物/收藏/历史已在云端 | 增加远端模型和延迟 | HIGH | MEDIUM | NO；复用现有云端真源 |
| `clearStorage()` | 实现简单 | 清掉身份与短期工作流，制造登出/恢复问题 | LOW | HIGH | **NO** |

## 12. Storage Budget V1（建议）

这是修复设计预算，不是当前已实现合同：

| 类别 | 建议软预算 | 依据 |
| --- | ---: | --- |
| `USER_CRITICAL_BUDGET` | 64 KiB | 当前只有少量身份/token/profile bootstrap 字段；远低于该值，并为 token/profile 扩展留余量 |
| `BUSINESS_STATE_BUDGET` | 256 KiB | 当前 B 类是小 marker/version/context/最多 9 个 batch IDs；要求短 TTL 和 entry cap 后应保持很小 |
| `CACHE_BUDGET` | 2 MiB | fixture 中固定大户约为 history 0.378 MiB + favorite 0.038 MiB + Today/wardrobe/detail 样本约 0.013 MiB；2 MiB 超过该约 0.43 MiB 基线 4 倍，可容纳 bounded detail LRU 和真实较长 URL |
| `TEMP_BUDGET` | 256 KiB | D 类均应固定覆盖/禁生产写；仅为验收 artifact 和 migration marker 留空间 |
| `RESERVED_HEADROOM` | 7.4375 MiB | 10 MiB - 上述 2.5625 MiB；约 74% 保留，吸收 fixture 对真实 URL/evidence 的低估、平台序列化差异与第三方 SDK 未登记 key |

配套门槛：

- `GLOBAL_SOFT_LIMIT=2.5625 MiB`（分类预算之和，写 A 类前也先驱逐 C/D）。
- `CACHE_HIGH_WATER=2 MiB`；任何 cache write 都不得突破。
- detail draft 必须变成单 canonical entry 或 IDs-only；detail page cache 必须有 TTL 物理删除和
  max-entry LRU。
- budget 数值需用真实体验版 `getStorageInfoSync()` 与代表性 production-shaped payload 复核后冻结；
  本报告的建议值刻意不把可用 10 MB 当目标占满。

## 13. 状态与门禁

`PB04_STATUS=IMPLEMENTED_PARTIAL_DEVTOOLS_SMOKE`

代码级关闭门槛已完成：registry、容量上限、物理 TTL/驱逐、quota retry once、L0/L1 placement、
OutfitRef、上传 workflow ref、版本化迁移和失败隔离均已落地并通过自动化检查。Favorite/History 的
现象已归因到 CloudBase 列表查询/真实发布环境 smoke，而不是移除 L1 snapshot 后的 PB-04 回归；
0/200、200/200 真实发布边界归 PB-34。PB-04 仍不标记 `CLOSED`，因为真实 Upload/Confirm 和
Detail×N UI/Storage 集中 smoke 尚未完成。

`CURRENT_REPRODUCIBILITY=代码级确定性增长模型 + deterministic quota fault injection + 微信开发者工具真实 migration/重启容量采集；没有物理填满 10 MB 的 hard-quota 撞限复现，也不要求该复现`

`MIGRATION_REQUIRED=YES`：需要白名单迁移/启动 sweep 清理已安装用户的 expired page cache、重复
detail aliases、abandoned upload keys 和旧诊断 key；不能无差别 clearStorage。

`BLOCKS_BEHAVIOR_LEARNING=YES`：学习事件和 learned profile 当前是云端数据，不直接占这 10 MB；
但学习闭环会鼓励并依赖更多 refresh、detail、favorite、wear/history 和长期使用，正好增加现有
动态 detail draft/page cache 的触发次数。在预算、eviction 和 quota recovery 完成前继续扩展长期
行为链会放大已确认 P1 风险，也会让后续新增本地状态缺少准入合同。

`MUST_FIX_BEFORE_LAUNCH=YES`

## 14. 修复验收证据要求

1. registry 列出所有生产 key、owner、分类、TTL、max entries 和 max bytes。
2. 200 件衣橱边界下采集真实 `keys/currentSize/limitSize`，对每个 namespace 输出 byte 分布。
3. 连续访问超过 detail LRU 上限后总量稳定，expired key 被物理删除。
4. 模拟 quota exception：先清 C/D、只 retry once；登录和天气远端成功不能被 cache write 反向判失败。
5. migration 只删白名单 C/D；保留身份与进行中的必要 B 类状态；失败可在下次启动幂等重试。
6. logout、账号/环境切换、版本升级和 wardrobe mutation 均有 Storage lifecycle 测试。
7. PB-34 smoke 记录 0/200、200/200、history/detail 浏览前后真实 `currentSize`。

## 15. 2026-09-20 实施结果

### 15.1 已落地的边界

- `localStorage/registry.ts` 是生产 L1 deny-by-default 清单；高水位 384 KiB、全局软上限 512 KiB。
- `localStorage/core.mjs` 对 UTF-8 bytes、namespace entries/bytes、物理 TTL、选择性驱逐和 quota
  retry exactly once 执行统一合同；quota 恢复固定按 TEMP、expired、permitted CACHE 顺序清理，
  `authResume:v2` 与未终态 `uploadWorkflow:v2` 不参与普通 cache 驱逐。
- 通用 `pageCache` 与 `userStorage` 已变为进程内 L0；动态 Wardrobe filter、Detail、Favorite、History
  不再向微信 Storage 写完整页面对象。
- L1 只保留版本化 auth/profile/weather/Today/Wardrobe bootstrap、单个 upload workflow envelope 和
  migration meta。Detail 导航统一使用 `OutfitRefV1`，重启后从 CloudBase source identity 回源。
- 上传恢复最多 10 个 active refs、每 ref 最多 9 个 cloud image IDs；terminal 立即移除，超过 24h
  必须先查询云端状态，网络失败保留本地 ref。Confirm 成功路径会在返回 Wardrobe 前同时清理
  workflow ref、legacy/runtime batch ref 和短时 upload task cache，避免 terminal 批次回流。
- migration namespace v2 / checkpoint v4 按 allowlist、用户 scope 和版本执行；Today 快照/控制状态/有效 OutfitRef 与 upload refs
  均先写新 envelope、回读校验，再删除旧 key；不使用 `clearStorage()`。
- 登录和天气先提交远端业务成功，再尝试本地 projection；本地写失败只影响下次恢复，不反转本次成功。
- 旧 `legacyUserCacheCleanup` 已退役；剩余直接 Storage API 仅存在于 gateway、migration 和显式开发/验收
  diagnostic fixed keys，生产默认路径不把诊断账本当业务缓存。

### 15.2 自动化容量证据

production-shaped workload 使用长 cloud URL、中文文案、Today 8 卡、Wardrobe 20 项、10 个上传 refs
与迁移 meta，结果如下：

| 场景 | UTF-8 序列化占用 |
| --- | ---: |
| 冷启动 | 0 bytes |
| 正常 steady state | 16,027 bytes / 15.65 KiB |
| 连续 20 次不同 Detail 导航后 | 16,027 bytes / 15.65 KiB |
| History 流程后 | 16,027 bytes / 15.65 KiB |
| 10 个上传 workflow refs 后 | 25,796 bytes / 25.19 KiB |
| migration meta 后 | 26,129 bytes / 25.52 KiB |

Detail 模型使用生产同形 `outfitDetail:<scope>` namespace 和
`v2:<batch>:<outfit>:<reference>` key：20 个不同 Detail 后 L0 保持 16-entry cap，随后 20 次同/不同
Detail 重入仍为 16 项，L1 始终为 16,027 bytes。该模型证明 Detail/History 不再线性增加 L1，并远低于
384 KiB steady-state 目标；它与下一节的微信 DevTools `currentSize` 采集相互独立，前者验证负载模型，
后者验证真实迁移和运行时容量。

### 15.3 已通过检查

- `pnpm --filter @starter-template/miniapp typecheck`：通过。
- PB-04 专项：39/39 通过，覆盖 deny-by-default、UTF-8 cap、TTL 物理删除、namespace/global budget、
  quota retry exactly once、TEMP → expired → permitted CACHE 清理顺序、登录/天气 fail-open、
  OutfitRef、上传 orphan、migration 和容量稳定性。
- quota fault injection 同时覆盖首次失败后重试成功、重试仍失败、CACHE/TEMP fail-open、
  USER_CRITICAL/BUSINESS `persistence-error`、`LOGIN_REMOTE_SUCCESS_LOCAL_FAIL` 和
  `WEATHER_REMOTE_SUCCESS_CACHE_FAIL`；没有新增 production debug API。
- miniapp 全部 `*.test.js`：1764/1764 通过。

### 15.4 微信开发者工具真实证据

- SDK 3.16.0、Local Storage 上限 10,240 KiB。迁移前真实运行态为 3,852 KiB / 46 keys；其中旧
  scene snapshots 29 keys / 3,674,311 bytes，旧 return snapshot 115,786 bytes，detail drafts
  36,746 bytes。该分布直接验证了第 5 节的重复快照与动态 key 根因。
- checkpoint v4 首次冷启动后降为 20 KiB / 7 keys；L1 registry keys 6，旧 scene/return、旧
  userStorage/pageCache 和 obsolete recommendation dirty key 均为 0。再次页面 relaunch 仍为
  20 KiB / 7 keys，证明 allowlist migration 幂等且没有清空身份数据。
- Today 可见 8 张卡；Wardrobe 与 Today 重入后 Storage 保持 28-29 KiB / 8 keys，legacy families=0。
  一次 Favorite 与 Worn 操作后页面分别显示“已收藏”“今天穿过”，容量仅从 20 KiB 增至 29 KiB；
  真实冷启动后仍为 29 KiB，后续页面重入为 28 KiB，没有回到迁移前的线性增长。
- 自动化进入 Outfit Detail 的真实 page stack 已观察到；但连续 Detail×N 过程中微信 automator 在详情
  初始化阶段出现超时，未取得完整 N 次通过证据。该工具时序问题不等同于业务通过或业务失败。
- Favorite 独立页本次进入 error state，Worn 后 History 仍为空态；因此云端闭环验收未通过，不能用
  Today 的局部按钮状态替代 Favorite/History 真源验证。

### 15.5 Favorite / Worn / History 回归归因

- `FAVORITE_ERROR_REPRODUCIBLE=NO`；页面只在 `listFavoriteOutfits` 抛错时进入 error，发生在
  OutfitRef 创建和 Detail 跳转之前。9de9760 未修改 Favorite 云函数查询或详情 materialization，
  `ERROR_LAYER=cloud query/transport`，`REGRESSION_INTRODUCED_BY_9de9760=NO`。
- `WORN_PERSISTED=YES`、`HISTORY_RECORD_CREATED=YES`：Today 只有在 `confirmWearV2` 等待
  `addOutfitHistory` 事务成功后才显示“今天穿过”，同日重复记录也会返回既有 history。
- `HISTORY_QUERY_RETURNS_RECORD=UNPROVEN_IN_OBSERVED_SMOKE`、`UI_RENDER=NO_IN_OBSERVED_SMOKE`；
  History 首次鉴权、重入和下拉均强制查云端，空态发生在 Detail OutfitRef 之前。实现与专项测试中
  `OUTFIT_REF_RESOLVES=YES`，且 9de9760 未修改 wear/history 云链，故 `PB04_REGRESSION=NO`。
- 这两项真实环境异常归 PB-12 的 Cloud collection/index/permission/env 与发布候选查询 smoke；它们
  不是 PB-19 已知的 Worn → Recommendation 学习缺口，也不通过恢复 L1 完整 snapshot 规避。

### 15.6 尚缺的关闭证据

- Upload/Confirm 仍需用户在微信原生媒体选择器中选择一次真实图片，随后采集 upload start、confirm、
  terminal cleanup、restart 的 `currentSize/limitSize/key count/namespaces`，并确认 Wardrobe 出现衣物、
  `uploadWorkflow:v2` terminal ref 消失、`uploadBatchImages:*` 为 0、重启无 orphan。
- Product Detail 已有页面栈进入证据，自动化 harness 在初始化阶段 timeout；还需一次集中手动 Detail×N
  确认 UI 正常打开，并复核真实 `currentSize/key count/namespaces` 不随次数增长。工具 timeout 不判产品失败。
- Favorite/History 需在 PB-12 发布候选 smoke 中复核 Cloud 查询；不再把该环境问题误记为 PB-04
  未解释 regression。
- PB-34 的 0/200、200/200 真实容量验收与 PB-04 复用同一组 Storage 采集，但不阻塞当前有界性结论；
  自动容量模型和 20–29 KiB 真实 steady state 不能冒充 PB-34 发布验收。
- `PB04_STATUS` 保持 `IMPLEMENTED_PARTIAL_DEVTOOLS_SMOKE`，关闭门槛只剩真实 Upload/Confirm 与
  Detail×N UI/Storage smoke；quota、Favorite regression attribution、Worn/History attribution 已关闭。
