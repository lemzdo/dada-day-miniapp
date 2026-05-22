// ============================================================
// 搭一搭 · Mock AI Provider
// 用于开发测试或 API 不可用时
// ============================================================

import type {
  AIService,
  RecognizeInput,
  RecognizeOutput,
  RecommendInput,
  RecommendOutput,
  AnalyzeInput,
  AnalyzeOutput,
  CopywriteInput,
  CopywriteOutput,
} from '@starter-template/types';

// 模拟颜色库
const MOCK_COLORS = [
  { name: '黑色', hex: '#1a1a1a', ratio: 0.6 },
  { name: '白色', hex: '#f5f5f5', ratio: 0.3 },
  { name: '灰色', hex: '#808080', ratio: 0.1 },
];

const CATEGORY_MAP: Record<string, { sub: string; styles: string[]; scenes: string[] }> = {
  top: {
    sub: 'tshirt',
    styles: ['casual', '休闲', '街头'],
    scenes: ['daily', '日常休闲', '运动健身'],
  },
  bottom: {
    sub: 'jeans',
    styles: ['casual', '休闲', '经典'],
    scenes: ['daily', '日常休闲', '工作'],
  },
  onepiece: {
    sub: 'dress',
    styles: ['elegant', '正式', '优雅'],
    scenes: ['party', '正式场合', '约会'],
  },
  shoes: {
    sub: 'sneakers',
    styles: ['sporty', '运动', '休闲'],
    scenes: ['sport', '运动健身', '日常休闲'],
  },
  accessory: {
    sub: 'bag',
    styles: ['fashion', '时尚', '百搭'],
    scenes: ['daily', '日常休闲', '旅行'],
  },
  other: {
    sub: 'unknown',
    styles: ['casual', '休闲'],
    scenes: ['daily', '日常休闲'],
  },
};

// 模拟识别（基于 hint 或随机）
function mockRecognize(input: RecognizeInput): RecognizeOutput {
  const category = (input.hint ?? 'top') as RecognizeOutput['category'];
  const info = CATEGORY_MAP[category];

  return {
    category,
    subcategory: info?.sub ?? 'unknown',
    colors: MOCK_COLORS,
    styleTags: info?.styles ?? ['casual'],
    seasonTags: ['spring', 'summer', 'autumn'],
    material: '棉',
    sceneTags: info?.scenes ?? ['daily'],
    confidence: 0.75,
    bbox: {
      x: 0.18,
      y: 0.12,
      width: 0.64,
      height: 0.76,
      confidence: 0.72,
      coordinateType: 'normalized',
    },
    thickness: 'regular',
  };
}

// ── Mock Provider ────────────────────────────────────────────

export const mockProvider: AIService = {
  async recognizeClothing(input: RecognizeInput): Promise<RecognizeOutput> {
    // 模拟网络延迟
    await new Promise((resolve) => setTimeout(resolve, 800));
    return mockRecognize(input);
  },

  async *recognizeClothingStream(input: RecognizeInput): AsyncGenerator<RecognizeOutput> {
    await new Promise((resolve) => setTimeout(resolve, 300));
    yield mockRecognize(input);
  },

  async recommendOutfits(_input: RecommendInput): Promise<RecommendOutput> {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return {
      outfits: [
        {
          id: 'mock-outfit-1',
          clothingIds: [],
          title: '休闲日常搭配',
          scene: 'daily',
          scores: {
            overall: 8.5,
            color: 8,
            style: 9,
            weather: 8,
          },
          explanations: ['简约而不简单', '适合日常休闲场合'],
        },
      ],
    };
  },

  async *recommendOutfitsStream(_input: RecommendInput): AsyncGenerator<RecommendOutput> {
    await new Promise((resolve) => setTimeout(resolve, 300));
    yield {
      outfits: [
        {
          id: 'mock-outfit-1',
          clothingIds: [],
          title: '休闲日常搭配',
          scene: 'daily',
          scores: {
            overall: 8.5,
            color: 8,
            style: 9,
            weather: 8,
          },
          explanations: ['简约而不简单', '适合日常休闲场合'],
        },
      ],
    };
  },

  async analyzeWardrobe(_input: AnalyzeInput): Promise<AnalyzeOutput> {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return {
      styleBreakdown: { casual: 60, formal: 20, sporty: 20 },
      colorBreakdown: { black: 40, white: 30, blue: 30 },
      categoryCounts: { top: 10, bottom: 5, shoes: 3 },
      topUsed: [],
      unusedItems: [],
      missingSuggestions: [
        {
          category: 'accessory',
          reason: '缺少配饰来提升整体搭配感',
          examples: ['帽子', '手表', '围巾'],
        },
      ],
      overallScore: 75,
    };
  },

  async generateCopywrite(_input: CopywriteInput): Promise<CopywriteOutput> {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return {
      title: '今日穿搭',
      content: '简约而不简单，舒适又时尚',
      hashtags: ['#OOTD', '#日常穿搭', '#时尚'],
    };
  },
};
