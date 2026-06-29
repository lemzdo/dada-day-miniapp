# 衣橱容量权益 V1

## 产品规则

当前所有用户按 `free` 档执行，容量上限为 200 件正式有效衣服。`member=500`、`premium=1000` 只作为未来可信权益系统的档位预留，本轮不开放购买入口，也不展示付费能力。

服务端 resolver 是最终授权来源。客户端传入的 `membershipTier`、`plan`、`limit`、`capacityTotal`、`isVip`、`premium` 等字段不能提升容量。

## 档位

```ts
free = 200
member = 500
premium = 1000
```

当前 resolver 强制返回 `free/200`。未来接入支付或可信会员系统时，只替换 resolver 的可信来源。

## used 口径

`used` 只统计当前用户 `clothes` 中 `status='active'` 的正式衣服。`status='deleted'` 不计数，软删除成功后立即释放容量。`clothes_drafts`、上传批次、上传图片、处理中/失败/丢弃草稿、编辑和重新识别都不新增容量占用。

降级超限时不删除既有衣服，允许浏览、编辑、删除、重新识别和继续用于推荐，但禁止新增，直到 `used < limit`。`remaining = Math.max(0, limit - used)`。

## API 结构

`getWardrobe`、确认草稿成功响应、Web capacity/profile API 返回统一结构：

```json
{
  "plan": "free",
  "used": 0,
  "limit": 200,
  "remaining": 200,
  "canAdd": true
}
```

小程序云函数仍保留旧 `total` 字段兼容，但新逻辑优先读取 `limit`。

## 服务端 Gate

`confirmClothesDrafts` 在任何正式衣服写入、草稿 `confirming/confirmed/discarded` 状态改变前执行容量 gate：

1. 校验当前用户和 batch。
2. 获取用户文档上的容量租约锁。
3. 重新读取 selected drafts。
4. 排除已 confirmed、已存在 `sourceItemId`、同 id 已入库和无效草稿。
5. 实时统计 active clothes。
6. resolver 得到 `free/200`。
7. `used + requested > limit` 时整批拒绝，不写 clothes，不改变草稿状态。
8. 成功后才进入原确认流程。
9. 过程中 heartbeat，finally 按 owner 释放锁。

锁字段存于现有 `users` 文档：`wardrobeCapacityLockOwner`、`wardrobeCapacityLockAcquiredAt`、`wardrobeCapacityLockHeartbeatAt`、`wardrobeCapacityLockExpiresAt`。

活跃锁返回 `WARDROBE_CAPACITY_BUSY`。过期锁允许 stale takeover。释放时必须匹配 owner，旧 owner 不能清掉新 owner 的锁。

## Web/BFF

`POST /api/v1/clothes` 使用数据库事务和用户行锁：锁定当前用户、实时 count 当前用户 active clothes、resolver 得到 `free/200`、校验容量后创建。超限返回 `WARDROBE_CAPACITY_EXCEEDED`，事务回滚。

`capacityUsed` 保留兼容，但不是权威字段。

## generateOutfit

推荐入口不再只读取前 100 件 active clothes。`loadActiveWardrobe` 按 100 件分页连续读取，去重 `_id`，安全上限为 1000，保持原有 `createdAt desc` 查询语义，不改候选生成、评分、排序、`scores.total`、aesthetic shadow telemetry 或 Stylist Explanation V2。

## SQL Migration

新增 `database/migrations/005_wardrobe_capacity_v1.sql`，将 `users.capacity_total` 默认值改为 200，并将旧 free 用户中 `capacity_total IS NULL OR capacity_total = 50` 的兼容展示字段更新为 200。不修改历史 migration 作为唯一手段。

## 缓存失效

入库、删除、编辑、重新识别等衣橱变更后失效 wardrobe list/capacity、profile stats/capacity、today/recommendation、upload task 相关缓存，以及已有收藏/历史/详情相关缓存。未来套餐变化时也必须失效 capacity、wardrobe、profile、today/recommendation。

## 部署清单

本轮不部署。真实发布时需要部署云函数 `login`、`getWardrobe`、`confirmClothesDrafts`、`generateOutfit`，部署 Web/BFF，执行 `005_wardrobe_capacity_v1.sql`，重新构建小程序体验版。不需要新云集合、新云索引或新环境变量。

## Smoke Test

1. 新用户显示 0/200。
2. 旧 `capacityTotal=50` 用户登录后显示 200。
3. 199 件时确认 1 件成功。
4. 199 件时确认 2 件整批拒绝，草稿仍可操作。
5. 200 件时禁止新增。
6. 删除 1 件后立即可新增 1 件。
7. `deleted` 未物理清理也释放容量。
8. 编辑和重新识别不占新名额。
9. 同一确认请求重试不重复占容量。
10. 两个批次并发确认最终不超过 200。
11. busy 锁提示稍后重试。
12. stale 锁可恢复。
13. 客户端伪造 premium 无效。
14. Profile 和 Wardrobe 容量一致。
15. 上传确认显示 remaining。
16. 200 件推荐读取不漏后 100 件。
17. Web 第 201 件被拒绝。
18. Web 删除后释放容量。
19. `used > limit` 时已有衣服不受影响。
20. 不出现负 remaining。
