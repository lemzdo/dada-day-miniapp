# 今日推荐候选池 V5

本轮只完成代码、测试和部署准备，未创建云端集合、索引或部署云函数。

## 执行模型

首次推荐或候选池失效时，`generateOutfit` 依次执行衣橱/档案读取、身份计算、候选组合、资格校验、评分、稳定排序，再把合格候选的轻量核心写入候选池并完成整批选择与卡片物化。

“换一批”携带当前 `recommendationBatchId` 与排除的 `outfitKey`。云函数加载同一用户、同一完整身份的候选池，只执行排除、整批选择、理由重水合和最终卡片物化；缺失、过期、损坏或身份不同则安全回退完整计算，并返回新的 `recommendationBatchId`。

身份哈希覆盖：用户哈希、按 `id + updatedAt` 排序的衣橱指纹、场景、天气模式与天气快照、偏好档案、时段和 `generateOutfit-recommendation-v5-20260720`。任何一项变化都不会复用旧池。

## 新集合与权限

创建集合 `recommendation_candidate_pools`，权限设为“仅云函数读写”。客户端不得直接读写。

文档字段：

| 字段 | 用途 |
| --- | --- |
| `candidatePoolId` | 当前 `recommendationBatchId` |
| `ownerHash` | 用户隔离用的 SHA-256 哈希，不保存明文用户标识 |
| `identity` | 完整复用身份的哈希与各指纹 |
| `candidates` | 仅 `itemIds`、`roleItemIds`、archetype、资格/风险摘要、reason codes、分数、选择签名和稳定排序身份 |
| `createdAtMs` / `expiresAtMs` | 读时过期判断与审计时间 |
| `expiresAt` | CloudBase TTL 原生日期字段 |

禁止写入衣物完整对象、图片 URL、完整 facts、页面卡片、文案对象和明文 openid。

创建索引：

1. 唯一复合索引：`ownerHash` 升序、`candidatePoolId` 升序。
2. TTL 索引：`expiresAt`，到期立即删除；TTL 周期由云数据库平台调度，不能假设精确到秒。

代码每次读取都会用 `expiresAtMs` 立即拒绝过期池，因此 TTL 调度延迟只影响物理清理，不会影响推荐正确性。若平台没有 TTL 索引，配置每日一次、仅云函数运行的清理任务，删除 `expiresAtMs < now` 的文档；读取侧校验仍必须保留。

## 部署顺序与烟测

1. 创建集合、权限与两条索引。
2. 部署 `generateOutfit`（无需新增 npm 依赖）。
3. 重新构建并上传小程序，确认“换一批”请求包含 `recommendationBatchId`。
4. 用同一用户验证首刷为 `full_compute`，三次续批为 `candidate_pool_hit`；修改衣物、偏好或天气后应为 `fallback_recompute`。

QA 只返回摘要：执行模式、候选池身份哈希、年龄、命中/失效原因、完整阶段耗时、重复推荐语组、fallback 数量和复用解释；不返回候选池内容或完整事实。
