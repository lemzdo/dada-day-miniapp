import type { ClothingCategory, SceneTag } from './clothes';
import type { WeatherSnapshot } from './weather';

// ============================================================
// 搭一搭 · 穿搭/历史/分析/分享 类型定义
// ============================================================

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'all_day';

export type GenerationType = 'auto' | 'manual' | 'from_single' | 'scene';

export type OutfitSource = 'recommend' | 'manual';

export interface OutfitItemSummary {
  clothingId: string;
  category: ClothingCategory;
  subcategory?: string;
  imageUrl: string;
  colorPalette?: { name: string; hex: string }[];
  isDeleted?: boolean;
}

export interface OutfitSnapshotItem {
  itemId: string;
  name: string;
  category: ClothingCategory | string;
  color?: string;
  thumbnailUrl?: string;
  isDeleted: boolean;
}

export interface ScoreExplanation {
  dimension: string;
  score: number;
  text: string;
}

export interface Outfit {
  id: string;
  userId: string;
  title?: string;
  clothingIds: string[];
  outfitKey?: string;
  items?: OutfitItemSummary[];
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
  favoritedAt?: string;
  wornAt?: string;
  wornDate?: string;
  isFavorite?: boolean;
  isWornToday?: boolean;
  createdAt: string;
  updatedAt: string;
  reason?: string;
  reasoning?: string;
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
  sourceItemId?: string;
  excludeClothingIdSets?: string[][];
}

export interface RecommendResponse {
  outfits: Outfit[];
  weather: WeatherSnapshot;
  recommendationNotice?: string;
}

export interface OutfitHistory {
  id: string;
  userId: string;
  outfitId?: string;
  clothingIds: string[];
  wearDate: string;
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
