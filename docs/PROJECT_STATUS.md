# PROJECT_STATUS.md - 搭一搭当前状态

> 最后更新：2026-06-23

## 项目概述

**搭搭 DAY** 是一个面向微信小程序用户的智能穿搭助手，帮助用户管理衣橱、获取每日穿搭推荐、记录穿搭历史。

当前状态：**MVP 功能基本完成，上线前最终检查阶段**

## 功能完成度

### 已完成功能 (~90%)

| 模块 | 功能 | 状态 |
|------|------|------|
| **用户** | 微信云开发登录 | ✅ 完成 |
| | 用户资料编辑（头像、昵称） | ✅ 完成 |
| | 风格画像管理 | ✅ 完成 |
| **衣橱** | 图片上传（多图批量） | ✅ 完成 |
| | AI 识别（品类、颜色、风格等） | ✅ 完成 |
| | Pipeline V2 图片处理 | ✅ 完成 |
| | 衣物列表、分页、分类筛选 | ✅ 完成 |
| | 衣物详情页 | ✅ 完成 |
| | 衣物编辑表单 | ✅ 完成 |
| | 单删/批量删除（含影响检查） | ✅ 完成 |
| | 容量统计显示 | ✅ 完成 |
| | 自定义细分类管理 | ✅ 完成 |
| | 自定义材质管理 | ✅ 完成 |
| **穿搭推荐** | 今日推荐页 | ✅ 完成 |
| | 场景切换（居家/通勤/约会/运动） | ✅ 完成 |
| | 天气适配 | ✅ 完成 |
| | 换一批灵感 | ✅ 完成 |
| | 收藏/取消收藏 | ✅ 完成 |
| | 确认穿着（穿它） | ✅ 完成 |
| | 穿搭详情页 | ✅ 完成 |
| | AI 点评生成 | ✅ 完成 |
| **收藏管理** | 收藏列表页 | ✅ 完成 |
| | 收藏重命名 | ✅ 完成 |
| | 移出收藏 | ✅ 完成 |
| **穿搭历史** | 日历视图 | ✅ 完成 |
| | 月度穿搭统计 | ✅ 完成 |
| | 按日期查看历史 | ✅ 完成 |
| **风格偏好** | 搭配倾向设置 | ✅ 完成 |
| | 风格标签选择（最多5个） | ✅ 完成 |
| | 版型偏好设置 | ✅ 完成 |
| | 冷热敏感设置 | ✅ 完成 |
| **其他** | 意见反馈提交 | ✅ 完成 |
| | 关于页面 | ✅ 完成 |

### 待优化功能 (~5%)

| 功能 | 状态 | 说明 |
|------|------|------|
| 天气获取 | 可用 | 已接入高德天气 API，需确认 AMAP_KEY 配置 |
| 分享功能 | 未实现 | 无分享卡片、分享文案生成 |
| 衣柜分析 | 未实现 | 无穿搭报告/风格分析页面 |
| 消息推送 | 未实现 | 无穿搭提醒推送能力 |

## 技术架构

### 小程序前端

```
Taro 4 + React 18 + Zustand + SCSS
```

- **状态管理**: Zustand (userStore, outfitStatusStore)
- **云函数调用**: lib/cloud.ts 统一封装，带缓存策略
- **缓存策略**: 多层缓存 (CloudResponseCache + UserStorage + PageCache)
- **样式**: SCSS，设计稿基准 750px

### 微信云开发后端

```
25 个云函数 + 7 个数据库集合
```

**云函数清单**:

| 云函数 | 用途 |
|--------|------|
| `login` | 微信登录、用户初始化 |
| `getWardrobe` | 衣橱列表查询 |
| `createUploadBatch` | 创建上传批次 |
| `createUploadImage` | 登记上传图片 |
| `processUploadImage` | Pipeline V2 图片处理 |
| `segmentClothImage` | 图片分割增强 |
| `recognizeClothAttributes` | 属性识别 |
| `confirmClothesDrafts` | 确认保存草稿 |
| `discardClothesDraft` | 丢弃草稿 |
| `discardUploadBatch` | 丢弃批次 |
| `updateClothes` | 更新衣物信息 |
| `deleteClothes` | 删除衣物 |
| `generateOutfit` | 穿搭推荐、收藏、历史 |
| `getWeather` | 天气获取（高德 API） |
| `getUserClothingSubcategories` | 获取自定义细分类 |
| `createUserClothingSubcategory` | 创建自定义细分类 |
| `getUserClothingMaterials` | 获取自定义材质 |
| `createUserClothingMaterial` | 创建自定义材质 |
| `archiveUserClothingMaterial` | 归档自定义材质 |
| `updateUserProfile` | 更新用户资料 |
| `submitFeedback` | 提交意见反馈 |
| `backfillClothesThumbnails` | 补填缩略图（运维） |
| `cleanupDeletedClothes` | 清理已删除衣物（定时） |

**数据库集合**:

| 集合 | 说明 |
|------|------|
| `users` | 用户信息、风格偏好、容量 |
| `clothes` | 衣物数据 |
| `upload_batches` | 上传批次 |
| `upload_images` | 上传图片记录 |
| `clothes_drafts` | 衣物草稿 |
| `outfits` | 穿搭方案、收藏 |
| `outfit_history` | 穿搭历史 |
| `favorite_outfits` | 收藏穿搭 |
| `outfit_ai_reviews` | AI 点评缓存 |
| `user_feedback` | 用户反馈 |
| `weather_cache` | 天气缓存 |
| `user_clothing_subcategories` | 用户自定义细分类 |
| `user_clothing_materials` | 用户自定义材质 |

## 上传链路现状 (Pipeline V2)

1. 前端在衣橱页选择 N 张图片，压缩后上传到微信云存储。
2. `createUploadBatch` 创建批次，`createUploadImage` 为每张原图登记记录。
3. 草稿确认页逐张调用 `processUploadImage`。
4. `processUploadImage` 调用 Pipeline V2：
   - Image Router 判断图片类型（真人/平铺/商品图）
   - 按路线执行检测、crop、分割、属性识别
   - 生成单件草稿，保留图片资产字段
5. 用户在草稿页编辑、重新处理或保存。
6. `confirmClothesDrafts` 将选中草稿保存到正式衣橱。

## 天气获取链路

1. `WeatherCard` 调用 `Taro.getLocation` 获取微信定位（gcj02 坐标）。
2. 调用 `getWeather` 云函数，传入经纬度。
3. 云函数调用高德 API：
   - 逆地理编码：经纬度 → adcode
   - 天气查询：adcode → 实时天气
4. 结果缓存到 `weather_cache` 集合（TTL 10分钟）。
5. 前端缓存到 Storage，用于下次快速加载。

**注意**: 需在云函数环境变量配置 `AMAP_KEY`（高德 Web 服务 Key）。

## 目录结构

```
apps/miniapp/
├── src/
│   ├── pages/               # 页面 (17个)
│   │   ├── today/           # 今日推荐 (TabBar)
│   │   ├── wardrobe/        # 衣橱 (TabBar)
│   │   ├── outfit-history/  # 穿搭日历 (TabBar)
│   │   ├── profile/         # 我的 (TabBar)
│   │   ├── clothing-detail/ # 衣物详情
│   │   ├── clothing-form/   # 衣物编辑
│   │   ├── outfit-detail/   # 穿搭详情
│   │   ├── favorite-outfits/# 收藏列表
│   │   ├── style-preferences/# 风格偏好
│   │   ├── upload-confirm/  # 上传确认
│   │   ├── upload-tasks/    # 上传任务
│   │   ├── feedback/        # 意见反馈
│   │   ├── about/           # 关于
│   │   └── about-detail/    # 关于详情
│   ├── components/          # 组件
│   │   ├── WeatherCard/     # 天气卡片
│   │   ├── ClothingGrid/    # 衣物网格
│   │   ├── ClothingEditForm/# 衣物编辑表单
│   │   └── SafeImage/       # 安全图片组件
│   ├── stores/              # Zustand 状态
│   │   ├── userStore.ts     # 用户状态
│   │   └── outfitStatusStore.ts # 穿搭状态
│   ├── lib/                 # 核心库
│   │   ├── cloud.ts         # 云函数调用封装
│   │   ├── cacheInvalidation.ts # 缓存失效
│   │   ├── userStorage.ts   # 用户存储
│   │   └── userPageCache.ts # 页面缓存
│   ├── hooks/               # React Hooks
│   │   ├── useAuthRuntime.ts # 认证运行时
│   │   └── useBoundUserFlow.ts # 用户流程绑定
│   ├── utils/               # 工具函数
│   │   ├── weather.ts       # 天气处理
│   │   ├── clothingLabels.ts # 衣物标签
│   │   └── outfitSnapshot.ts # 穿搭快照
│   ├── config/              # 配置
│   │   └── cloud.ts         # 云环境配置
│   ├── constants/           # 常量
│   │   └── recommendationProfile.ts # 推荐配置
│   ├── assets/              # 静态资源
│   │   ├── avatars/         # 默认头像
│   │   ├── scenes/          # 场景图标
│   │   └── brand/           # 品牌 Logo
│   ├── app.tsx              # 应用入口
│   └── app.config.ts        # 应用配置
└── cloudfunctions/          # 云函数 (25个)
```

## 上线前检查清单

### 高优先级

1. **类型检查**: `cmd /c pnpm --filter @starter-template/miniapp typecheck`
2. **云函数环境变量**: 确认所有必要变量已配置（见 `docs/cloudfunctions-env.md`）
3. **真机测试**: AI 识别准确率、缓存一致性、页面跳转状态同步
4. **图片加载**: 缩略图尺寸、CDN 配置
5. **边界情况**: 空衣橱提示、删除有历史记录的衣物、网络失败处理

### 中优先级

1. **天气 API**: 确认 `AMAP_KEY` 配置正确
2. **推荐去重**: 检查 generateOutfit 排除逻辑
3. **容量限制**: 确认用户容量上限设置

### 低优先级

1. 分享功能（Canvas 生成分享卡片）
2. 衣柜分析报告页面
3. 消息推送提醒

## 相关文档

- `docs/cloudfunctions-env.md` - 云函数环境变量配置
- `docs/WECHAT_CLOUD_MVP.md` - 微信云开发改造清单
- `docs/wardrobe-asset-pipeline-v2.md` - Pipeline V2 技术细节
- `docs/cloud-functions.md` - 云函数开发指南
- `AGENTS.md` - 项目长期上下文（面向 AI 编程工具）