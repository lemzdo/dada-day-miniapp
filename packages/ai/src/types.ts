// ============================================================
// 搭一搭 · AI 抽象层 — 统一接口定义
// ============================================================

import type {
  AiRecognitionResult,
  ClothingCategory,
  ClothingSubcategory,
  Material,
  SceneTag,
  Season,
  StyleTag,
  ColorInfo,
} from '@starter-template/types';

import type {
  Outfit,
  OutfitScores,
  RecommendRequest,
  ScoreExplanation,
  WardrobeAnalysis,
} from '@starter-template/types';

// ── 能力标识 ──

export type AICapability =
  | 'vision:recognize'
  | 'text:recommend'
  | 'text:analyze'
  | 'text:copywrite';

// ── 供应商 ──

export type AIProvider = 'siliconflow' | 'deepseek' | 'dashscope' | 'openai';

export interface ProviderConfig {
  provider: AIProvider;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

// ── 识别输入输出 ──

export interface RecognizeInput {
  imageUrl: string;
}

export interface RecognizeOutput {
  result: AiRecognitionResult;
  rawResponse?: string;
}

// ── 推荐输入输出 ──

export interface RecommendInput {
  recommendRequest: RecommendRequest;
  closetItems: RecommendClosetItem[];
  weatherSnapshot: {
    temp: number;
    humidity: number;
    weather: string;
    wind: number;
    uv: number;
  };
  userProfile: {
    preferredStyles: StyleTag[];
    historyItemIds: string[];
  };
}

export interface RecommendClosetItem {
  id: string;
  imageUrl: string;
  category: ClothingCategory;
  subcategory?: ClothingSubcategory;
  colorPalette?: ColorInfo[];
  styleTags?: StyleTag[];
  seasonTags?: Season[];
  material?: Material;
  sceneTags?: SceneTag[];
  usageCount: number;
}

export interface RecommendOutput {
  outfits: RecommendedOutfit[];
}

export interface RecommendedOutfit {
  clothingIds: string[];
  title: string;
  scores: OutfitScores;
  explanations: ScoreExplanation[];
}

// ── 分析输入输出 ──

export interface AnalyzeInput {
  closetItems: RecommendClosetItem[];
  historySummary: {
    totalDays: number;
    topItemIds: string[];
  };
}

export interface AnalyzeOutput {
  missingSuggestions: { category: string; style: string; reason: string }[];
  unusedAlerts: { clothingId: string; daysUnused: number }[];
  summary: string;
}

// ── 文案输入输出 ──

export interface CopywriteInput {
  outfitTitle?: string;
  scores: OutfitScores;
  weather: string;
  scene?: string;
}

export interface CopywriteOutput {
  text: string;
}

// ── AIService 统一接口 ──

export interface AIService {
  /** 识别衣服图片 */
  recognizeClothing(input: RecognizeInput): Promise<RecognizeOutput>;

  /** 生成穿搭推荐 */
  recommendOutfit(input: RecommendInput): Promise<RecommendOutput>;

  /** 分析衣柜 */
  analyzeWardrobe(input: AnalyzeInput): Promise<AnalyzeOutput>;

  /** 生成分享文案 */
  generateCopywrite(input: CopywriteInput): Promise<CopywriteOutput>;
}

// ── Provider 注册 ──

export interface ProviderEntry {
  provider: AIProvider;
  model: string;
  priority: number;
}

export interface CapabilityConfig {
  capability: AICapability;
  providers: ProviderEntry[];
  cacheTTL: number;
}
