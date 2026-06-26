# Outfit Behavior Events V1

本文档记录阶段 3 的穿搭行为事件采集方案。当前实现只采集事件，不计算 `learnedProfile`，不调整推荐分数，不改变生产排序。

## Schema

客户端只发送最小化事件：

```ts
{
  schemaVersion: 1;
  eventId: string;
  eventType:
    | 'recommendation_exposure'
    | 'outfit_detail_view'
    | 'outfit_favorite'
    | 'outfit_unfavorite'
    | 'outfit_wear'
    | 'recommendation_batch_refresh';
  clientOccurredAt?: string;
  outfitId?: string;
  outfitKey?: string;
  clothingIds?: string[];
  recommendationBatchId?: string;
  batchOutfitKeys?: string[];
  scoresSnapshot?: {
    total?: number;
    weatherAdaptation?: number;
    styleUnity?: number;
    freshness?: number;
    preference?: number;
  };
  aestheticSnapshot?: {
    engineVersion?: 'aesthetic-compat-v1';
    score?: number | null;
    coverage?: number;
    evidenceCodes?: string[];
  };
  context?: {
    scene?: 'home' | 'work' | 'date' | 'sport';
    temperatureBand?: string;
    conditionBucket?: string;
    source?: 'today' | 'detail' | 'favorites' | 'history' | 'other';
    position?: number;
    candidateCount?: number;
    trigger?: 'manual';
  };
}
```

服务端 canonical document 只保存：

```text
schemaVersion, eventType, eventId, occurredAt, clientOccurredAt,
outfitId, outfitKey, clothingIds, recommendationBatchId, batchOutfitKeys,
scoresSnapshot, aestheticSnapshot, context, _openid, createdAt
```

## Event Types

- `recommendation_exposure`：Today 页当前可见推荐卡片曝光。只记录可见卡，不记录隐藏候选；同一页面会话内同一 `pageSession + recommendationBatchId + outfitKey` 只记录一次。
- `outfit_detail_view`：穿搭详情页成功展示数据后记录。每个页面实例最多一次，加载失败不记录。
- `outfit_favorite`：收藏云端 mutation 成功后记录。
- `outfit_unfavorite`：取消收藏云端 mutation 成功后记录。
- `outfit_wear`：“穿它”写入历史成功后记录。重复穿着可以形成多条独立事件。
- `recommendation_batch_refresh`：用户主动点“换一批”且新批次成功切换后记录上一批。天气自动重生成不记录为该事件。

## Client Boundaries

采集 helper 位于 `apps/miniapp/src/lib/outfitBehavior.ts`，核心逻辑位于 `outfitBehaviorCore.js`。客户端策略：

- best-effort fire-and-forget，不展示采集失败 Toast。
- 内存队列最多 50 条，单次发送最多 20 条。
- 失败事件不写入本地 storage，不建立跨账号长期队列。
- 显式操作只在业务云函数成功并通过当前用户/页面有效性检查后记录。
- 曝光使用页面级 tracker 去重；新页面实例或新推荐批次可重新曝光。

## Server Isolation And Idempotency

云函数：`trackOutfitBehaviorEvents`

集合：`outfit_behavior_events`

服务端使用 `cloud.getWXContext().OPENID` 写入 `_openid`，忽略客户端传入的 `_openid`、`openid`、`occurredAt`、`createdAt` 和 `userId`。

数据库 `_id` 为：

```text
obv1_ + sha256(OPENID + "|" + eventId)
```

同一用户相同 `eventId` 重试只写一次；不同用户相同 `eventId` 不冲突。duplicate 写入按幂等成功统计，不让整批请求失败。

## Data Minimization

不采集：

- UI 文案、标题、衣物名称、图片 URL。
- 城市、GPS、精确温度、设备标识、IP。
- AI raw result、prompt、完整 outfit 对象。
- 用户昵称、头像、跨用户标识。
- 页面停留时长、普通滚动、快速滑动次数、任意自由文本。

数组会去重并稳定排序：`clothingIds` 最多 8 个，`batchOutfitKeys` 最多 8 个，`evidenceCodes` 最多 12 个。

## Collection And Indexes

本轮只提交代码和文档，不创建云端资源。部署前需要：

1. 创建 `outfit_behavior_events`。
2. 权限设置为仅云函数读写。
3. 创建查询索引：
   - `_openid ASC + occurredAt DESC`
   - `_openid ASC + eventType ASC + occurredAt DESC`
   - `_openid ASC + outfitKey ASC + occurredAt DESC`

幂等不依赖索引。阶段 4 聚合前需要上述索引支撑按用户、时间、事件类型和 outfitKey 查询。

## Deployment Steps

1. 创建集合并设置权限。
2. 在云开发控制台安装并部署 `trackOutfitBehaviorEvents`。
3. 重新构建并上传小程序体验版。
4. 执行下方 smoke test。
5. 确认事件只属于当前 `_openid`，且不包含禁止字段。

## Smoke Test

1. 打开 Today 页，首张推荐产生一次 `recommendation_exposure`。
2. 左右滑动，新卡片各产生一次 exposure。
3. 滑回旧卡片不重复。
4. 重新进入页面允许形成新的页面会话 exposure。
5. 进入详情产生一次 `outfit_detail_view`。
6. 详情重渲染不重复。
7. 收藏成功产生 `outfit_favorite`。
8. 取消收藏成功产生 `outfit_unfavorite`。
9. 收藏失败不产生事件。
10. “穿它”成功产生 `outfit_wear`。
11. 同一套再次穿产生第二条 wear。
12. 手动换一批成功产生 `recommendation_batch_refresh`。
13. 天气自动重生成不产生 batch refresh。
14. 换一批失败不产生事件。
15. 所有文档 `_openid` 正确。
16. 数据中没有图片、标题、城市和 raw result。
17. eventId 重试不会重复写入。
18. 旧衣服和缺 `aestheticEvaluation` 的搭配仍可采集。
19. 埋点云函数失败时主业务正常。
20. 查询索引可支持按用户时间和事件类型读取。

## Phase 4 Consumption

阶段 4 可以按当前用户聚合最近行为，作为 `learnedProfile` shadow 输入。当前事件是行为分析输入，不是交易审计日志；不能用于跨用户学习；上线后仍需先 shadow 观察，再决定权重和排序接入。
