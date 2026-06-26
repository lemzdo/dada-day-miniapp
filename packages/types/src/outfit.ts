import type { ClothingCategory, SceneTag } from './clothes';
import type { WeatherSnapshot } from './weather';

// ============================================================
// 搭一搭 · 穿搭/历史/分析/分享 类型定义
// ============================================================

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'all_day';

export type GenerationType = 'auto' | 'manual' | 'from_single' | 'scene';

export type OutfitSource = 'recommend' | 'recommendation' | 'favorite' | 'history' | 'manual';

export type OutfitKind = 'recommendation' | 'favorite' | 'history';

export interface OutfitItemSummary {
  clothingId: string;
  category: ClothingCategory;
  subcategory?: string;
  imageUrl: string;
  displayImageUrl?: string;
  thumbnailUrl?: string;
  colorPalette?: { name: string; hex: string }[];
  isDeleted?: boolean;
}

export interface OutfitSnapshotItem {
  itemId: string;
  clothingId?: string;
  type?: string;
  name: string;
  category: ClothingCategory | string;
  color?: string;
  style?: string;
  thickness?: string;
  material?: string;
  imageUrl?: string;
  displayImageUrl?: string;
  deletedAt?: string | null;
  thumbnailUrl?: string;
  isDeleted: boolean;
}

export interface ScoreExplanation {
  dimension: string;
  score: number;
  text: string;
}

export interface OutfitAiComment {
  title: string;
  reason: string;
  styleTags: string[];
  tip: string;
  generatedAt?: string;
}

export type OutfitAiReviewStatus = 'ready' | 'generating' | 'failed';

export interface OutfitAiReview {
  reviewId: string;
  outfitKey: string;
  scene?: SceneTag | string;
  inputHash: string;
  promptVersion: string;
  model: string;
  aiComment: OutfitAiComment | null;
  status: OutfitAiReviewStatus;
  generatedAt?: string;
  updatedAt?: string;
}

export interface OutfitAiReviewResponse {
  success: boolean;
  aiComment?: OutfitAiComment | null;
  review?: OutfitAiReview;
  reviewId?: string;
  generatedAt?: string;
  cacheHit?: boolean;
  saved?: boolean;
  stale?: boolean;
  inProgress?: boolean;
  superseded?: boolean;
  cooldown?: boolean;
  retryAfterMs?: number;
  promptVersion?: string;
  model?: string;
  fallback?: boolean;
  message?: string;
}

export type AestheticDimensionKey =
  | 'silhouetteBalance'
  | 'proportionBalance'
  | 'colorHarmony'
  | 'patternBalance'
  | 'formalityConsistency'
  | 'detailBalance';

export type AestheticEvidencePolarity =
  | 'positive'
  | 'negative'
  | 'neutral';

export interface AestheticEvidenceV1 {
  code: string;
  polarity: AestheticEvidencePolarity;
  strength: 1 | 2 | 3;
  itemIds: string[];
  data?: Record<string, string | number | boolean | null>;
}

export interface AestheticDimensionEvaluationV1 {
  score: number | null;
  coverage: number;
  evidenceCodes: string[];
}

export interface AestheticCompatibilityEvaluationV1 {
  version: 1;
  engineVersion: 'aesthetic-compat-v1';
  score: number | null;
  coverage: number;
  dimensions: Record<AestheticDimensionKey, AestheticDimensionEvaluationV1>;
  evidence: AestheticEvidenceV1[];
}

export interface Outfit {
  id: string;
  userId: string;
  outfitId?: string;
  title?: string;
  userTitle?: string;
  displayTitle?: string;
  clothingIds: string[];
  outfitKey?: string;
  outfitKind?: OutfitKind;
  items?: OutfitItemSummary[];
  itemsSnapshot?: OutfitSnapshotItem[];
  snapshotItems?: OutfitSnapshotItem[];
  incomplete?: boolean;
  deletedItemCount?: number;
  scene?: SceneTag;
  targetDate?: string;
  timeOfDay?: TimeOfDay;
  weatherSnapshot?: WeatherSnapshot;
  scores?: OutfitScores;
  scoreExplanations?: ScoreExplanation[];
  generationType?: GenerationType;
  sourceItemId?: string;
  source?: OutfitSource;
  sourceFavoriteOutfitId?: string;
  favoritedAt?: string;
  favoriteOutfitId?: string;
  wornAt?: string;
  wornDate?: string;
  isFavorite?: boolean;
  isWornToday?: boolean;
  todayHistoryId?: string;
  historyId?: string;
  lastWornAt?: string;
  recommendationBatchId?: string;
  generatedAt?: string;
  styleTags?: string[];
  createdAt: string;
  updatedAt: string;
  reason?: string;
  reasoning?: string;
  aiComment?: OutfitAiComment;
  aestheticEvaluation?: AestheticCompatibilityEvaluationV1;
}

export interface OutfitScores {
  total?: number;
  weatherAdaptation?: number;
  styleUnity?: number;
  freshness?: number;
  preference?: number;
  fashion: number;
  comfort: number;
  warmth: number;
  coolness: number;
  sceneMatch: number;
  colorHarmony: number;
}

export interface RecommendRequest {
  date?: string;
  timeOfDay?: TimeOfDay;
  scene?: SceneTag;
  location?: { lat: number; lng: number };
  cityCode?: string;
  weather?: WeatherSnapshot;
  sourceItemId?: string;
  excludeClothingIdSets?: string[][];
  excludedOutfitKeys?: string[];
  maxResults?: number;
}

export interface RecommendResponse {
  outfits: Outfit[];
  weather: WeatherSnapshot;
  recommendationNotice?: string;
  recommendationBatchId?: string;
  limited?: boolean;
  exhausted?: boolean;
  debug?: {
    inputScene?: SceneTag | string;
    matchedScene?: SceneTag | string;
    candidateCount: number;
    generatedCount: number;
    filteredCandidateCount?: number;
    excludedOutfitKeyCount?: number;
    limited?: boolean;
    exhausted?: boolean;
  };
}

export interface OutfitHistory {
  id: string;
  userId: string;
  outfitId?: string;
  title?: string;
  userTitle?: string;
  displayTitle?: string;
  source?: 'recommendation' | 'favorite';
  sourceFavoriteOutfitId?: string;
  clothingIds: string[];
  itemsSnapshot?: OutfitSnapshotItem[];
  wearDate: string;
  wornAt?: string;
  timeOfDay?: TimeOfDay;
  scene?: SceneTag;
  weatherSnapshot?: WeatherSnapshot;
  satisfaction?: number;
  notes?: string;
  createdAt: string;
}

export interface HistoryCreateInput {
  outfitId?: string;
  clothingIds: string[];
  scene?: SceneTag;
  timeOfDay?: TimeOfDay;
}

export interface HistoryStats {
  totalDays: number;
  avgSatisfaction: number;
  topItems: string[];
}

export interface WardrobeAnalysis {
  id: string;
  userId: string;
  analysisDate: string;
  styleBreakdown: Record<string, number>;
  colorBreakdown: Record<string, number>;
  categoryCounts: Record<string, number>;
  topUsed: string[];
  unusedItems: string[];
  missingSuggestions: MissingItem[];
  overallScore?: number;
  createdAt: string;
}

export interface MissingItem {
  category: string;
  style: string;
  reason: string;
}

export type ShareType = 'friend' | 'moments' | 'image';

export interface ShareInput {
  type: ShareType;
}

export interface ShareResult {
  imageUrl?: string;
  shareConfig?: Record<string, unknown>;
}
