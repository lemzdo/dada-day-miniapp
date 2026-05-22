# 搭一搭（d1d）— 下一步开发计划

> 生成时间：2026-05-18  
> 当前状态：Phase 1 完成 60%，衣服上传 + CRUD 已就绪，AI 识别待实现

---

## 推荐方案：两条并行路线

考虑到 AI 识别需要外部 API Key，而小程序 UI 可以独立完成，建议**双线并行**：

```
路线 A（后端核心）          路线 B（前端体验）
┌──────────────────┐      ┌──────────────────┐
│ AI 衣服识别        │      │ 小程序衣橱页面     │
│ SiliconFlow      │      │ 衣服列表/上传/详情  │
│ 预计 1-2 天       │      │ 预计 2-3 天       │
└──────────────────┘      └──────────────────┘
         │                          │
         └──────────┬───────────────┘
                    ▼
         ┌──────────────────┐
         │ 联调测试          │
         │ 端到端验证        │
         └──────────────────┘
```

---

## 路线 A：AI 衣服识别（后端核心）

### 前置条件
- [ ] SiliconFlow API Key（Qwen-VL-72B 模型）

### 任务清单

| # | 任务 | 文件/位置 | 说明 |
|---|------|----------|------|
| 1 | 安装依赖 | `packages/ai/package.json` | `openai` 或原生 fetch 调用 SiliconFlow |
| 2 | 实现 SiliconFlow Provider | `packages/ai/src/providers/siliconflow.ts` | 替换 throw Error，实现 recognizeClothing |
| 3 | 设计 Vision Prompt | `packages/ai/src/prompts/clothing-recognition.ts` | 要求输出 JSON Schema：category/color/style/season/material |
| 4 | 响应解析器 | `packages/ai/src/parsers/recognition.ts` | 解析 LLM 返回，映射到 Clothing 类型 |
| 5 | 接入上传流程 | `apps/web/src/app/api/v1/clothes/route.ts` | 上传后自动触发 AI 识别，更新数据库 |
| 6 | 容错机制 | 同上 | 识别失败时保留手动输入，记录 rawResult |

### 技术要点

**Prompt 设计（关键）**:
```typescript
const CLOTHING_RECOGNITION_PROMPT = `
分析这张衣服图片，返回严格 JSON：
{
  "category": "top|bottom|onepiece|shoes|accessory",
  "subcategory": "具体子类如 tshirt/jeans",
  "colors": [{"name": "颜色名", "hex": "#RRGGBB", "ratio": 0-1}],
  "styleTags": ["casual", "formal", "sporty"...],
  "seasonTags": ["spring", "summer", "autumn", "winter"],
  "material": "棉/涤纶/羊毛等",
  "sceneTags": ["work", "party", "sport", "daily"],
  "confidence": 0-1
}
`;
```

**识别流程**:
```
用户上传图片 → 保存本地 → 调用 SiliconFlow → 解析 JSON → 
更新 clothes 表（ai_raw_result + 解析字段）→ 返回完整 Clothing 数据
```

---

## 路线 B：小程序衣橱页面（前端体验）

### 任务清单

| # | 任务 | 文件/位置 | 说明 |
|---|------|----------|------|
| 1 | API 端点函数 | `packages/api/src/endpoints/clothes.ts` | getClothesList/getClothingById/createClothing 等 |
| 2 | 衣服列表组件 | `apps/miniapp/src/components/ClothingGrid/` | 网格展示，分类筛选 |
| 3 | 上传按钮 | `apps/miniapp/src/pages/wardrobe/index.tsx` | 调用 Taro.chooseImage + api.createClothing |
| 4 | 衣服详情页 | `apps/miniapp/src/pages/clothing-detail/` | 新页面，展示图片 + AI 识别结果 |
| 5 | 分类筛选 | `apps/miniapp/src/pages/wardrobe/index.tsx` | 顶部横滑分类，点击筛选 |
| 6 | 空状态优化 | 同上 | 无衣服时引导上传 |

### 页面结构

```
pages/
├── wardrobe/
│   ├── index.tsx          # 衣橱主页（列表 + 分类筛选 + 上传按钮）
│   └── index.scss
├── clothing-detail/
│   ├── index.tsx          # 衣服详情（图片大图 + 信息卡片 + 删除）
│   └── index.scss
└── clothing-form/
    ├── index.tsx          # 添加/编辑衣服（预留，AI 识别后可简化）
    └── index.scss
```

### API 端点函数示例

```typescript
// packages/api/src/endpoints/clothes.ts
export async function getClothesList(params: { category?: string; page?: number }) {
  return apiClient.get('/clothes', { params });
}

export async function createClothing(formData: FormData) {
  return apiClient.post('/clothes', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}
```

---

## 决策点：是否需要先 Mock AI？

| 方案 | 优点 | 缺点 | 推荐场景 |
|------|------|------|----------|
| **A. 直接接入 SiliconFlow** | 一步到位，真实数据 | 需要 API Key，有调用成本 | 已有 Key 或即将申请 |
| **B. 先 Mock AI 结果** | 不依赖外部，快速闭环 | 后续需替换，技术债 | 想先验证完整流程 |
| **C. 手动填写 + AI 辅助** | 用户可控，兜底方案 | 体验稍差 | 作为容错策略 |

**建议**：采用 A + C 结合——默认调用 AI，失败时允许用户手动填写。

---

## 路线 C：其他可选方向

如果上述两条线都不想走，还有以下选择：

### 选项 1：天气 API 接入（简单）
- 接入和风天气，替换 Mock 数据
- 1 小时左右完成

### 选项 2：穿搭推荐引擎（Phase 2 提前）
- 需要 DeepSeek API Key
- 实现规则粗排 + LLM 精排
- 工作量 2-3 天

### 选项 3：管理后台 Web 端
- 把 `apps/web` 首页改造成管理后台
- 衣服管理、用户管理、数据统计

---

## 执行建议

### 如果你现在就有 SiliconFlow API Key
1. **今天**：走路线 A，完成 AI 识别（预计 4-6 小时）
2. **明天**：走路线 B，完成小程序衣橱页面（预计 6-8 小时）
3. **后天**：联调测试，修复边界 case

### 如果你还没有 API Key
1. **今天**：走路线 B，先完成小程序 UI（用 Mock 数据）
2. **同时**：申请 SiliconFlow API Key（通常即时开通）
3. **明天**：接入 AI 识别，替换 Mock

### 如果你想最小成本验证
1. 只做路线 B 的前 3 项（列表 + 上传按钮 + 详情页）
2. AI 识别先返回固定 Mock 数据
3. 2 天内可演示完整上传 → 展示流程

---

## 需要我立即执行哪个？

请告诉我：
1. **你有 SiliconFlow API Key 吗？**（有 / 没有 / 马上申请）
2. **优先做哪条线？**（A 后端 / B 前端 / 其他）
3. **时间预期？**（今天完成 / 本周完成 / 不着急）

我可以立即开始编写代码。
