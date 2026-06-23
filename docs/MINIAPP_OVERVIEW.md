# 搭搭 DAY 小程序架构概览

> 最后更新：2026-06-23

## 项目定位

**搭搭 DAY** 是一个面向微信小程序用户的智能穿搭助手，帮助用户：
- 管理个人衣橱（上传、识别、编辑、删除）
- 获取每日穿搭推荐（基于衣橱、天气、场景、偏好）
- 记录穿搭历史（日历视图、月度统计）
- 收藏喜欢的搭配方案

产品定位：轻量、日常、可信赖的私人衣橱与穿搭决策工具，不是电商导购。

## 技术栈

### 前端

| 技术 | 版本 | 说明 |
|------|------|------|
| Taro | 4.x | 多端框架，当前仅编译微信小程序 |
| React | 18.x | UI 框架 |
| Zustand | 5.x | 状态管理 |
| SCSS | - | 样式，设计稿基准 750px |
| TypeScript | 5.x | 类型检查，strict 模式 |

### 后端

| 技术 | 说明 |
|------|------|
| 微信云开发 | 云函数 + 云数据库 + 云存储 |
| 高德 API | 天气获取（逆地理编码 + 天气查询） |
| 百炼 API | AI 视觉识别（图片路由、检测、属性识别） |
| 阿里云 VIAPI | 图片分割增强 |
| OSS | 图片中转存储 |

## 核心架构

### 状态管理

```
stores/
├── userStore.ts          # 用户认证、资料、偏好
│   ├── authStatus        # 'initializing' | 'authenticated' | 'anonymous' | 'failed'
│   ├── userId / openid   # 用户标识
│   ├── nickname          # 昵称
│   ├── avatarUrl         # 头像
│   ├── recommendationProfile # 风格偏好
│   └── capacityTotal/Used # 容量
│
└── outfitStatusStore.ts  # 穿搭状态同步
│   └── statuses          # Map<outfitKey, OutfitStatus>
│   └── isFavorite        # 收藏状态
│   └── isWornToday       # 今日穿着状态
│   └── favoriteOutfitId  # 收藏 ID
│   └── todayHistoryId    # 历史 ID
```

### 缓存策略

三层缓存，确保数据一致性和快速加载：

```
1. CloudResponseCache    # 云函数响应缓存（内存）
   - TTL: 15s~10min（按接口类型）
   - 用户隔离：基于 authContext.userScope
   - 竞态处理：inflight request 合并

2. UserPageCache         # 页面数据缓存（Storage）
   - TTL: 2min~30min
   - 用户隔离：基于 openid + authEpoch
   - 首屏快速加载

3. UserStorage           # 业务状态缓存（Storage）
   - 跨页面状态同步
   - 刷新信号传递
```

### 云函数调用封装

`lib/cloud.ts` 统一封装所有云函数调用：

```typescript
// 基础调用
async function callCloudFunction<T>(name: string, data: Record<string, unknown>): Promise<T>

// 带缓存调用
async function callCachedCloudFunction<T>(
  name: string,
  data: Record<string, unknown>,
  ttlMs: number,
  scope: CloudCacheScope,
): Promise<T>

// 缓存失效
function clearCloudCache(prefixes: string[], scopeTypes: Array<'user' | 'device'>)
```

## 页面结构

### TabBar 页面（4个）

| 页面 | 路径 | 核心功能 |
|------|------|----------|
| 今日推荐 | `pages/today/index` | 天气卡片、场景切换、穿搭推荐、收藏、穿它 |
| 衣橱 | `pages/wardrobe/index` | 衣物列表、分类筛选、上传入口、批量管理 |
| 穿搭日历 | `pages/outfit-history/index` | 日历视图、月度统计、按日期查看历史 |
| 我的 | `pages/profile/index` | 用户资料、风格画像、衣橱状态、功能入口 |

### 详情/辅助页面（13个）

| 页面 | 路径 | 来源页面 |
|------|------|----------|
| 衣物详情 | `pages/clothing-detail/index` | 衣橱 |
| 衣物编辑 | `pages/clothing-form/index` | 衣物详情 |
| 穿搭详情 | `pages/outfit-detail/index` | 今日推荐、收藏、历史 |
| 收藏列表 | `pages/favorite-outfits/index` | 我的 |
| 风格偏好 | `pages/style-preferences/index` | 我的 |
| 上传确认 | `pages/upload-confirm/index` | 衣橱（上传后） |
| 上传任务 | `pages/upload-tasks/index` | 衣橱（多批次） |
| 意见反馈 | `pages/feedback/index` | 我的 |
| 关于 | `pages/about/index` | 我的 |
| 关于详情 | `pages/about-detail/index` | 关于 |

## 核心流程

### 上传衣物流程

```
1. 用户选择图片（最多9张）
   └── Taro.chooseMedia + compressImageForUpload

2. 上传到云存储
   └── wx.cloud.uploadFile → fileID

3. 创建批次 + 登记图片
   └── createUploadBatch + createUploadImage

4. 跳转草稿确认页
   └── upload-confirm/index

5. 逐张处理图片
   └── processUploadImage（Pipeline V2）
       ├── Image Router（判断图片类型）
       ├── 检测（VL bbox）
       ├── Crop（裁剪单件）
       ├── Segment（分割增强）
       └── Attribute（属性识别）

6. 用户确认保存
   └── confirmClothesDrafts → clothes 集合
```

### 穿搭推荐流程

```
1. 获取天气
   └── WeatherCard → Taro.getLocation → getWeather

2. 选择场景
   └── 居家/通勤/约会/运动

3. 生成推荐
   └── generateOutfit 云函数
       ├── 查询衣橱（active clothes）
       ├── 读取用户偏好（recommendationProfile）
       ├── 规则引擎匹配
       └── 返回推荐列表（最多8套）

4. 用户操作
   ├── 换一批（excludeOutfitKeys）
   ├── 收藏（saveFavoriteOutfit）
   ├── 穿它（addOutfitHistory）
   └── 查看详情（outfit-detail）
```

### 天气获取流程

```
1. 前端获取位置
   └── Taro.getLocation({ type: 'gcj02' })

2. 调用云函数
   └── getWeather({ latitude, longitude })

3. 云函数处理
   ├── 逆地理编码：高德 /v3/geocode/regeo → adcode
   ├── 天气查询：高德 /v3/weather/weatherInfo → 实时天气
   └── 缓存写入：weather_cache 集合（TTL 10min）

4. 前端缓存
   └── Storage: WEATHER_CACHE_KEY

5. 推荐引擎使用
   └── toWeatherSnapshot → RecommendationWeatherFingerprint
```

## 组件设计

### WeatherCard

天气胶囊组件，负责：
- 定位权限检查
- 天气获取和缓存
- 天气变化通知（触发推荐刷新）

### ClothingGrid

衣物网格组件，支持：
- 普通模式：点击跳转详情
- 选择模式：长按进入批量管理
- 加载状态、空状态

### ClothingEditForm

衣物编辑表单，字段：
- 图片展示
- 自定义名称、品牌、标签
- 分类、细分类
- 颜色、材质、厚度
- 风格标签、场景标签、季节标签

### SafeImage

安全图片组件，处理：
- 加载失败重试
- 空图占位
- 懒加载

## 数据模型

### Clothing（衣物）

```typescript
interface Clothing {
  id: string;
  userId: string;
  category: ClothingCategory;  // top/bottom/onepiece/shoes/accessory
  subcategory?: string;
  subcategoryId?: string;
  customName?: string;
  customCategory?: string;
  brand?: string;
  customTags?: string[];
  
  // 图片资产
  imageUrl: string;
  originalImageUrl?: string;
  cropImageUrl?: string;
  cleanImageUrl?: string;
  displayImageUrl?: string;
  thumbnailUrl?: string;
  
  // AI 识别结果
  colors?: string[];
  colorPalette?: ColorPaletteItem[];
  material?: string;
  materialGuess?: string;
  thickness?: string;
  styleTags?: string[];
  sceneTags?: string[];
  seasonTags?: string[];
  
  // AI 处理状态
  aiStatus?: 'pending' | 'recognizing' | 'success' | 'failed';
  aiRecognizeStatus?: 'pending' | 'processing' | 'success' | 'failed';
  
  // 状态
  status: 'active' | 'archived' | 'deleted';
  deletedAt?: string;
  
  // 统计
  wearCount?: number;
  lastWornAt?: string;
  
  createdAt: string;
  updatedAt: string;
}
```

### Outfit（穿搭）

```typescript
interface Outfit {
  id: string;
  outfitId?: string;
  outfitKey?: string;
  userId: string;
  
  // 组成
  clothingIds: string[];
  items?: OutfitItem[];
  snapshotItems?: OutfitSnapshotItem[];
  
  // 上下文
  scene?: SceneTag;
  date?: string;
  timeOfDay?: string;
  weatherSnapshot?: WeatherSnapshot;
  
  // 推荐信息
  reason?: string;
  reasoning?: string;
  scores?: OutfitScores;
  recommendationBatchId?: string;
  
  // AI 点评
  aiComment?: OutfitAiComment;
  
  // 状态
  outfitKind?: 'recommendation' | 'favorite' | 'history';
  isFavorite?: boolean;
  favoriteOutfitId?: string;
  favoritedAt?: string;
  isWornToday?: boolean;
  todayHistoryId?: string;
  wornAt?: string;
  wornDate?: string;
  
  // 标题
  title?: string;
  displayTitle?: string;
  userTitle?: string;
  
  createdAt: string;
  updatedAt: string;
}
```

### RecommendationProfile（风格偏好）

```typescript
interface RecommendationProfile {
  genderPreference: 'male_style' | 'female_style' | 'neutral_style' | 'all' | 'unknown';
  styleTags: string[];       // 最多5个
  fitPreference: 'loose' | 'regular' | 'slim' | 'oversize' | 'unknown';
  colorPreference?: string[];
  avoidTags?: string[];
  temperatureSensitivity: 'cold_sensitive' | 'normal' | 'heat_sensitive';
}
```

## 上线前检查

### 必检项

1. **类型检查**
   ```bash
   cmd /c pnpm --filter @starter-template/miniapp typecheck
   ```

2. **云函数环境变量**
   - `AMAP_KEY`（天气）
   - `BAILIAN_API_KEY`（AI识别）
   - `ALIYUN_ACCESS_KEY_ID` / `SECRET`（分割）
   - `OSS_REGION` / `OSS_BUCKET`

3. **真机测试**
   - 上传图片完整流程
   - AI 识别准确率
   - 推荐生成和操作
   - 天气获取（需真机定位）
   - 页面跳转状态同步

4. **边界情况**
   - 空衣橱提示
   - 删除有历史记录的衣物
   - 网络失败处理
   - 定位权限拒绝

### 可选优化

- 分享卡片生成
- 衣柜分析报告
- 消息推送提醒

## 相关文档

- `docs/PROJECT_STATUS.md` - 项目状态和功能清单
- `docs/WECHAT_CLOUD_MVP.md` - 云开发改造清单
- `docs/cloudfunctions-env.md` - 云函数环境变量
- `docs/wardrobe-asset-pipeline-v2.md` - Pipeline V2 技术细节
- `AGENTS.md` - 项目长期上下文