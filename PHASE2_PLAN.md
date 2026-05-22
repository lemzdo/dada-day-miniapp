# 搭一搭（d1d）— Phase 2 穿搭推荐开发计划

> 制定日期：2026-05-18
> 预计工期：3-4 周（1 人全职）
> 前置条件：Phase 1 已完成（数据库、衣橱 CRUD、AI 识别 Mock 可用）

---

## 一、Phase 2 目标

实现"今日穿搭推荐"完整功能链路：

```
用户偏好 + 天气数据 + 衣橱数据
        ↓
   推荐算法（规则引擎）
        ↓
   推荐结果展示（今日页面）
        ↓
   用户交互（换一套 / 收藏 / 确认穿着 / 分享）
        ↓
   穿搭历史记录
```

**核心交付物**：
1. 穿搭推荐 BFF API（后端）
2. 今日页面完整交互（小程序前端）
3. 穿搭历史记录功能
4. 穿搭详情页

---

## 二、现状盘点

### 已有基础（无需新建）

| 层级 | 状态 | 说明 |
|------|------|------|
| 数据库表 | ✅ 完备 | `outfits`、`outfit_history`、`share_records`、`wardrobe_analyses` 4 张表已建好 |
| TypeScript 类型 | ✅ 完备 | `Outfit`、`RecommendRequest`、`RecommendResponse`、`OutfitScores` 等全部已定义 |
| 衣橱数据 | ✅ 可用 | `getClothesList` API 可获取用户全部衣服（含 category/styleTags/seasonTags/sceneTags） |
| 用户偏好 | 🟡 部分 | `userStore.preferredStyles` 已定义但未被任何页面消费 |
| 天气 API | 🟡 Mock | `/api/v1/weather/current` 和 `forecast` 已有但返回 Mock 数据 |
| 今日页面 | 🔴 空壳 | 仅有 WeatherCard + 空状态占位，无任何推荐逻辑 |

### 需要新建

| 层级 | 待建内容 | 估算工作量 |
|------|----------|-----------|
| Repository | `outfit.ts`（穿搭方案 CRUD + 历史） | 1 天 |
| BFF API | 推荐接口 + 穿搭 CRUD + 历史接口 | 2-3 天 |
| 推荐算法 | 基于规则的穿搭匹配引擎 | 2-3 天 |
| 前端 API 客户端 | `packages/api/src/outfit.ts` | 0.5 天 |
| 今日页面（小程序） | 推荐卡片、场景选择、换一套、确认穿着 | 3-4 天 |
| 穿搭详情页 | 搭配方案详情、评分展示、收藏 | 1-2 天 |
| 穿搭历史页 | 历史列表、满意度评价 | 1-2 天 |

---

## 三、任务分解

### Step 2.1 — Outfit Repository（数据访问层）

**目的**：为穿搭方案和历史记录提供数据库操作方法

**输入**：已有的 Drizzle Schema（`outfits`、`outfit_history` 表）

**输出**：`apps/web/src/lib/db/repositories/outfit.ts`

**具体方法**：

```
// 穿搭方案
createOutfit(data) → OutfitRow
getOutfitById(id) → OutfitRow | null
getOutfitsByUser(userId, filters) → { list, total, page, pageSize }
getOutfitsByDate(userId, date) → OutfitRow[]
updateOutfit(id, data) → OutfitRow | null
deleteOutfit(id) → boolean
toggleFavorite(id) → OutfitRow | null
markAsWorn(id) → OutfitRow | null

// 穿搭历史
createHistory(data) → HistoryRow
getHistoryByUser(userId, filters) → { list, total, page, pageSize }
getHistoryByDate(userId, date) → HistoryRow | null
updateHistorySatisfaction(id, satisfaction) → HistoryRow | null
getHistoryStats(userId) → HistoryStats
```

**依赖**：无

---

### Step 2.2 — 穿搭推荐算法（规则引擎）

**目的**：根据天气、场景、用户偏好，从衣橱中智能匹配穿搭组合

**输入**：
- 用户衣橱数据（clothes 列表，含 category/styleTags/seasonTags/sceneTags/colorPalette）
- 天气数据（温度、天气状况）
- 用户偏好（preferredStyles）
- 推荐参数（scene, timeOfDay, date）

**输出**：`apps/web/src/lib/recommend/engine.ts`

**算法设计**：

```
1. 数据准备
   ├── 获取用户全部 active 衣服
   ├── 获取当天天气（温度、天气状况）
   └── 获取用户偏好风格

2. 衣服筛选
   ├── 季节过滤：根据当前月份/温度筛选 seasonTags 匹配的衣服
   ├── 场景过滤：根据 scene 参数筛选 sceneTags 匹配的衣服
   ├── 风格过滤：根据 preferredStyles 筛选 styleTags 匹配的衣服
   └── 温度适配：根据温度范围推荐合适材质/厚度

3. 穿搭组合
   ├── 按品类分组：top / bottom / onepiece / shoes / accessory
   ├── 组合生成：
   │   ├── onepiece + shoes + accessory
   │   ├── top + bottom + shoes + accessory
   │   └── top + bottom（简约搭配）
   ├── 颜色协调：检查 colorPalette 的色彩搭配评分
   └── 风格统一：优先选择 styleTags 一致的组合

4. 评分排序
   ├── 时尚度（fashion）：风格统一性 + 颜色协调性
   ├── 舒适度（comfort）：材质 + 季节适配
   ├── 保暖度（warmth）/ 清凉度（coolness）：温度匹配
   ├── 场景匹配（sceneMatch）：场景标签匹配度
   └── 色彩和谐（colorHarmony）：颜色搭配评分

5. 去重 & 输出
   ├── 排除最近 3 天已穿过的组合
   ├── 返回 Top 3 推荐
   └── 每套附带评分和推荐理由
```

**依赖**：Step 2.1（需要 Repository 获取衣服数据）

---

### Step 2.3 — 穿搭 BFF API

**目的**：提供穿搭推荐、CRUD、历史的 HTTP 接口

**输入**：Step 2.1（Repository）+ Step 2.2（推荐引擎）

**输出**：以下 API 路由文件

| 方法 | 路径 | 文件 | 说明 |
|------|------|------|------|
| POST | `/api/v1/outfits/recommend` | `outfits/recommend/route.ts` | 生成穿搭推荐 |
| GET | `/api/v1/outfits` | `outfits/route.ts` | 穿搭列表（分页/筛选） |
| GET | `/api/v1/outfits/[id]` | `outfits/[id]/route.ts` | 穿搭详情 |
| PUT | `/api/v1/outfits/[id]` | `outfits/[id]/route.ts` | 更新穿搭（收藏/标题等） |
| DELETE | `/api/v1/outfits/[id]` | `outfits/[id]/route.ts` | 删除穿搭 |
| POST | `/api/v1/outfits/[id]/wear` | `outfits/[id]/wear/route.ts` | 确认穿着（写入历史） |
| GET | `/api/v1/outfit-history` | `outfit-history/route.ts` | 穿搭历史列表 |
| PUT | `/api/v1/outfit-history/[id]` | `outfit-history/[id]/route.ts` | 评价历史（满意度） |

**推荐 API 请求/响应示例**：

```typescript
// POST /api/v1/outfits/recommend
// Request Body:
{
  "date": "2026-05-18",          // 可选，默认今天
  "timeOfDay": "morning",         // 可选，默认 all_day
  "scene": "daily",               // 可选，场景
  "cityCode": "101020100"         // 可选，城市编码（用于天气）
}

// Response:
{
  "code": 0,
  "data": {
    "outfits": [
      {
        "id": "uuid",
        "title": "休闲日常搭配",
        "clothingIds": ["uuid1", "uuid2", "uuid3"],
        "items": [
          { "clothingId": "uuid1", "category": "top", "imageUrl": "...", "customName": "白T恤" },
          { "clothingId": "uuid2", "category": "bottom", "imageUrl": "...", "customName": "牛仔裤" },
          { "clothingId": "uuid3", "category": "shoes", "imageUrl": "..." }
        ],
        "scene": "daily",
        "scores": {
          "fashion": 8,
          "comfort": 9,
          "warmth": 7,
          "sceneMatch": 9,
          "colorHarmony": 8
        },
        "scoreExplanations": [
          { "dimension": "fashion", "score": 8, "text": "休闲风格统一，简约大方" }
        ],
        "reasoning": "根据今天 22°C 的天气，推荐轻薄透气的棉质上衣搭配牛仔裤"
      }
    ],
    "weather": {
      "temperature": 22,
      "condition": "晴",
      "city": "上海"
    }
  }
}
```

**依赖**：Step 2.1 + Step 2.2

---

### Step 2.4 — 前端 API 客户端

**目的**：为小程序提供穿搭相关的 API 调用函数

**输入**：Step 2.3 的 API 接口定义

**输出**：`packages/api/src/outfit.ts`

**具体函数**：

```typescript
// 推荐相关
getRecommend(params: RecommendRequest) → RecommendResponse
refreshRecommend(params: RecommendRequest) → RecommendResponse  // 换一套

// 穿搭 CRUD
getOutfitList(params) → PaginatedList<Outfit>
getOutfitDetail(id: string) → Outfit
updateOutfit(id: string, data) → Outfit
deleteOutfit(id: string) → void
toggleOutfitFavorite(id: string) → Outfit

// 穿着确认
confirmWear(outfitId: string, data) → OutfitHistory

// 历史相关
getHistoryList(params) → PaginatedList<OutfitHistory>
rateHistory(historyId: string, satisfaction: number) → OutfitHistory
getHistoryStats() → HistoryStats
```

**依赖**：Step 2.3

---

### Step 2.5 — 今日页面（小程序）

**目的**：实现穿搭推荐的核心用户交互页面

**输入**：Step 2.4（API 客户端）+ 已有的 WeatherCard 组件

**输出**：重写 `apps/miniapp/src/pages/today/index.tsx`

**页面结构设计**：

```
┌─────────────────────────────┐
│  📍 上海  ·  22°C 晴        │  ← WeatherCard（已有）
│  适合穿轻薄透气的衣服        │     新增：穿衣建议文案
├─────────────────────────────┤
│  场景选择器（横滑标签）      │  ← 新增：日常/工作/约会/运动/派对
│  [日常] [工作] [约会] ...    │
├─────────────────────────────┤
│  今日穿搭推荐                │
│  ┌───────────────────────┐  │
│  │  ┌────┐ ┌────┐ ┌────┐│  │  ← OutfitCard 组件（新增）
│  │  │上衣│ │下装│ │鞋子││  │     展示搭配的衣服组合
│  │  └────┘ └────┘ └────┘│  │
│  │  休闲日常搭配           │  │
│  │  ⭐ 8.5  时尚·舒适·百搭 │  │  ← 评分标签
│  │  "根据今天天气推荐..."  │  │  ← 推荐理由
│  │                       │  │
│  │  [换一套]  [收藏] [穿] │  │  ← 操作按钮
│  └───────────────────────┘  │
├─────────────────────────────┤
│  更多推荐                    │
│  ┌─────────┐ ┌─────────┐   │  ← 推荐列表（横向滑动）
│  │ 方案 2  │ │ 方案 3  │   │
│  └─────────┘ └─────────┘   │
└─────────────────────────────┘
```

**交互流程**：

```
进入页面
  ↓
自动加载：天气 + 推荐穿搭（默认场景 = daily）
  ↓
展示推荐卡片（OutfitCard）
  ↓
用户操作：
  ├── [换一套] → 调用 refreshRecommend，展示新推荐
  ├── [收藏] → 调用 toggleOutfitFavorite，更新 UI
  ├── [穿它] → 调用 confirmWear → 弹出成功提示 → 标记为已穿
  ├── 点击衣服 → 跳转衣服详情
  ├── 切换场景 → 重新请求推荐
  └── 下拉刷新 → 重新加载天气 + 推荐
```

**新增组件**：

| 组件 | 路径 | 说明 |
|------|------|------|
| `OutfitCard` | `components/OutfitCard/index.tsx` | 穿搭推荐卡片（核心组件） |
| `SceneSelector` | `components/SceneSelector/index.tsx` | 场景选择横滑标签 |
| `ScoreTags` | `components/ScoreTags/index.tsx` | 评分标签展示 |

**依赖**：Step 2.4

---

### Step 2.6 — 穿搭详情页

**目的**：展示穿搭方案的完整信息，支持收藏、编辑、分享

**输入**：Step 2.4（API 客户端）

**输出**：`apps/miniapp/src/pages/outfit-detail/index.tsx`

**页面结构**：

```
┌─────────────────────────────┐
│  ← 穿搭详情          [···]  │  ← 导航栏 + 更多操作
├─────────────────────────────┤
│  ┌───────────────────────┐  │
│  │   搭配展示区域         │  │  ← 衣服图片网格/拼图
│  │   上衣 + 下装 + 鞋子   │  │
│  └───────────────────────┘  │
├─────────────────────────────┤
│  休闲日常搭配                │  ← 标题
│  📅 2026-05-18 · 日常       │  ← 日期 + 场景
├─────────────────────────────┤
│  搭配评分                    │
│  时尚 ████████░░ 8           │
│  舒适 █████████░ 9           │  ← 评分条
│  保暖 ███████░░░ 7           │
│  场景 █████████░ 9           │
├─────────────────────────────┤
│  推荐理由                    │
│  "根据今天 22°C 的天气..."   │
├─────────────────────────────┤
│  包含单品                    │
│  ┌────┐ 白T恤    [查看]     │  ← 单品列表
│  ┌────┐ 牛仔裤   [查看]     │
│  ┌────┐ 运动鞋   [查看]     │
├─────────────────────────────┤
│  [❤️ 收藏]  [✅ 确认穿着]    │  ← 底部操作栏
└─────────────────────────────┘
```

**依赖**：Step 2.4 + Step 2.5

---

### Step 2.7 — 穿搭历史页

**目的**：查看历史穿搭记录，支持满意度评价

**输入**：Step 2.4（API 客户端）

**输出**：`apps/miniapp/src/pages/outfit-history/index.tsx`

**页面结构**：

```
┌─────────────────────────────┐
│  穿搭记录                    │
├─────────────────────────────┤
│  统计卡片                    │
│  ┌──────┐ ┌──────┐ ┌──────┐│
│  │ 28天 │ │ 4.2★ │ │ 12套 ││  ← 穿搭天数/平均满意度/总套数
│  └──────┘ └──────┘ └──────┘│
├─────────────────────────────┤
│  5月18日 · 日常 · 晴 22°C   │
│  ┌────┐ ┌────┐ ┌────┐      │
│  │上衣│ │下装│ │鞋子│  ⭐⭐⭐⭐│  ← 满意度评价
│  └────┘ └────┘ └────┘      │
├─────────────────────────────┤
│  5月17日 · 工作 · 多云 20°C  │
│  ┌────┐ ┌────┐ ┌────┐      │
│  │衬衫│ │西裤│ │皮鞋│  ⭐⭐⭐⭐⭐│
│  └────┘ └────┘ └────┘      │
└─────────────────────────────┘
```

**依赖**：Step 2.4

---

### Step 2.8 — 注册新页面 + 路由配置

**目的**：在 app.config.ts 中注册新页面，配置跳转

**输入**：Step 2.5 ~ 2.7 创建的页面

**输出**：修改 `apps/miniapp/src/app.config.ts`

**新增页面**：
```typescript
pages: [
  'pages/today/index',           // 已有
  'pages/wardrobe/index',        // 已有
  'pages/profile/index',         // 已有
  'pages/index/index',           // 已有
  'pages/clothing-detail/index', // 已有
  'pages/clothing-form/index',   // 已有
  'pages/outfit-detail/index',   // 新增
  'pages/outfit-history/index',  // 新增
]
```

**依赖**：Step 2.6 + Step 2.7

---

## 四、执行计划（时间线）

```
Week 1（第 1-5 天）
├── Day 1-2:  Step 2.1 Outfit Repository
├── Day 2-3:  Step 2.2 推荐算法（规则引擎）
└── Day 3-5:  Step 2.3 穿搭 BFF API

Week 2（第 6-10 天）
├── Day 6:    Step 2.4 前端 API 客户端
├── Day 6-7:  Step 2.5a 新增组件（OutfitCard / SceneSelector / ScoreTags）
├── Day 7-10: Step 2.5b 今日页面完整交互
└── Day 10:   联调测试（推荐 API + 今日页面）

Week 3（第 11-15 天）
├── Day 11-12: Step 2.6 穿搭详情页
├── Day 13-14: Step 2.7 穿搭历史页
├── Day 14:    Step 2.8 注册新页面 + 路由配置
└── Day 15:    集成测试 + Bug 修复

Week 4（第 16-20 天）
├── Day 16-18: 体验优化（动画、加载态、错误处理）
├── Day 19:    边界情况处理（空衣橱、网络异常、无推荐结果）
└── Day 20:    最终测试 + 代码整理
```

---

## 五、技术要点与注意事项

### 5.1 推荐算法关键逻辑

**温度-衣物映射表**：

| 温度范围 | 推荐品类 | 材质建议 |
|----------|----------|----------|
| < 5°C | 厚外套 + 毛衣 + 保暖裤 | 羊毛、羽绒、加绒 |
| 5-15°C | 外套 + 长袖 + 长裤 | 棉、牛仔、针织 |
| 15-22°C | 薄外套/卫衣 + 长裤 | 棉、涤纶 |
| 22-28°C | 短袖/薄衫 + 短裤/薄裤 | 棉、亚麻 |
| > 28°C | 背心/短裤 | 透气面料 |

**颜色搭配规则**（简化版）：

| 规则 | 说明 |
|------|------|
| 同色系 | 色相接近的颜色搭配，安全百搭 |
| 中性色 + 亮色 | 黑白灰 + 一个亮色点缀 |
| 互补色 | 色轮对立色，大胆时尚 |
| 三色原则 | 全身不超过 3 个主要颜色 |

### 5.2 性能考虑

- 推荐算法在服务端执行，不在小程序端
- 衣服数据量 < 200 件时，规则引擎足够快（< 100ms）
- 推荐结果缓存：同一天 + 同场景 + 同天气，缓存 1 小时
- 图片使用缩略图（thumbnailUrl），减少加载量

### 5.3 用户体验

- 首次进入今日页面，如果衣橱为空，引导去添加衣服
- 如果推荐结果不足 3 套，展示已有结果 + "添加更多衣服获得更好推荐"提示
- "换一套"按钮有冷却时间（1 秒），防止频繁请求
- 确认穿着后，今日页面标记为"已选择今日穿搭"

### 5.4 已知问题修复（顺手处理）

| 问题 | 位置 | 修复方案 |
|------|------|----------|
| 上传时分类硬编码为 top | `wardrobe/index.tsx` 第 98 行 | 上传前弹出分类选择 |
| 删除 API 未接入 | `wardrobe/index.tsx` 第 141 行 | 调用 deleteClothing API |
| 容量数据硬编码 | `wardrobe/index.tsx` 第 28 行 | 从 userStore 读取 |
| token 未持久化 | `stores/userStore.ts` | 使用 Taro.setStorageSync |

---

## 六、风险与应对

| 风险 | 概率 | 影响 | 应对措施 |
|------|------|------|----------|
| 推荐结果质量不佳 | 中 | 高 | 先用规则引擎，后续迭代接入 AI（DeepSeek） |
| 天气 API 不可用 | 中 | 中 | 天气数据降级为基于月份/城市的默认值 |
| 衣橱数据不足 | 高 | 中 | 衣服 < 5 件时提示添加，不展示推荐 |
| 小程序性能 | 低 | 中 | 图片懒加载 + 分页 + 缓存 |

---

## 七、Phase 2 完成标准

- [ ] Step 2.1 Outfit Repository 全部方法实现并测试通过
- [ ] Step 2.2 推荐算法能根据天气/场景/偏好生成合理搭配
- [ ] Step 2.3 穿搭 BFF API 全部端点实现并测试通过
- [ ] Step 2.4 前端 API 客户端全部函数实现
- [ ] Step 2.5 今日页面完整交互（推荐/换一套/收藏/确认穿着）
- [ ] Step 2.6 穿搭详情页（评分展示/单品列表/操作）
- [ ] Step 2.7 穿搭历史页（列表/满意度评价/统计）
- [ ] Step 2.8 新页面注册 + 路由配置
- [ ] 已知问题修复（分类选择/删除接入/容量数据/token 持久化）
- [ ] 端到端测试：添加衣服 → 今日推荐 → 确认穿着 → 查看历史

---

## 八、Phase 3 预告（后续规划）

Phase 2 完成后，Phase 3 将聚焦：

1. **衣柜智能分析**：风格分布、颜色分布、使用率分析、缺失单品建议
2. **分享功能**：生成穿搭分享图、朋友圈文案
3. **提醒功能**：每日穿搭提醒、天气变化提醒
4. **风格偏好设置**：引导用户选择偏好风格，优化推荐精准度
5. **AI 推荐升级**：接入 DeepSeek 大模型，提供更智能的穿搭建议和文案

---

> 本文档应作为 Phase 2 开发的指导文件。每个 Step 完成后，在 PROJECT_STATUS.md 中更新进度。
