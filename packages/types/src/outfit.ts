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
  reviewVersion?: 'stylist-explanation-v2' | string;
  promptVersion?: 'stylist-prompt-v2' | string;
  copyPolicyVersion?: string;
  voicePolicyVersion?: string;
  inputDigest?: string;
  source?: 'ai' | 'rule_fallback' | string;
  explanationV2?: StylistExplanationV2;
  overallComment?: string;
  advice?: string;
  contentPlanVersion?: string;
  sceneIntent?: string;
  primaryBenefitCode?: string;
  reviewSource?: OutfitReviewSource;
  validatorRejectReasons?: string[];
}

export type OutfitItemRole = 'core' | 'functional' | 'optional';

export type OutfitReviewSource =
  | 'rule_default'
  | 'ai'
  | 'rule_fallback'
  | 'cached_ai'
  | 'cached_fallback'
  | string;

export interface XiaodaContentPlanItem {
  id: string;
  slot: string;
  role: OutfitItemRole;
  displayName: string;
}

export interface XiaodaContentPlanSuggestion {
  text: string;
}

export interface XiaodaDefaultCopy {
  todayReason: string;
  detailExplanation: string;
  aiExtraDefault: string;
  usedInsightCodes: string[];
  usedPhrases: string[];
  angle?: string;
}

export interface XiaodaContentPlan {
  version: string;
  sceneIntent: string;
  items: XiaodaContentPlanItem[];
  observations: string[];
  primaryBenefit: string;
  secondaryBenefit?: string;
  suggestion?: XiaodaContentPlanSuggestion | null;
  defaultCopy?: XiaodaDefaultCopy;
  defaultTodayReason?: string;
  defaultDetailExplanation?: string;
}

export interface OutfitCardViewModel {
  previewItems: OutfitItemSummary[];
  hiddenItemCount: number;
  layoutVariant: string;
  totalItemCount?: number;
}

export interface DetailNarrativeViewModel {
  defaultText: string;
  source: 'content_plan' | 'ai' | 'safe_fallback' | string;
  aiStatus: 'default' | 'success' | 'failed' | string;
}

export interface StylistExplanationPointV2 {
  text: string;
  evidenceCodes: string[];
}

export interface StylistExplanationV2 {
  schemaVersion: 2;
  reviewVersion: 'stylist-explanation-v2';
  promptVersion: 'stylist-prompt-v2';
  title: string;
  summary: string;
  strengths: StylistExplanationPointV2[];
  tradeoffs: StylistExplanationPointV2[];
  tip: StylistExplanationPointV2 | null;
  styleTags: string[];
  confidence: 'high' | 'medium' | 'low';
  evidenceCodes: string[];
  limitations: string[];
  source: 'ai' | 'rule_fallback';
  provider: string;
  model: string;
  generatedAt: string;
  inputDigest: string;
}

export type OutfitAiReviewStatus = 'ready' | 'generating' | 'failed';

export interface OutfitAiReviewRawSummary {
  providerReturned?: boolean;
  statusCode?: number;
  rawTextPreview?: string;
  parsedJson?: boolean;
  parseErrorCode?: string;
  fields?: {
    hasOverallComment: boolean;
    hasAdvice: boolean;
    overallCommentLength: number;
    adviceLength: number;
  };
  overallCommentPreview?: string;
  advicePreview?: string;
}

export interface OutfitAiReviewValidatorTraceEntry {
  check: string;
  pass: boolean;
  code?: string;
  detail?: string;
}

export interface OutfitAiReview {
  reviewId: string;
  outfitKey: string;
  scene?: SceneTag | string;
  inputHash: string;
  inputDigest?: string;
  schemaVersion?: number;
  reviewVersion?: 'stylist-explanation-v2' | string;
  promptVersion: string;
  copyPolicyVersion?: string;
  voicePolicyVersion?: string;
  evidenceVersion?: string;
  provider?: string;
  model: string;
  source?: 'ai' | 'rule_fallback' | string;
  explanationV2?: StylistExplanationV2;
  aiComment: OutfitAiComment | null;
  contentPlanVersion?: string;
  sceneIntent?: string;
  primaryBenefitCode?: string;
  reviewSource?: OutfitReviewSource;
  validatorRejectReasons?: string[];
  cacheReuseReason?: string;
  cacheable?: boolean;
  enhanced?: boolean;
  status: OutfitAiReviewStatus;
  generatedAt?: string;
  updatedAt?: string;
}

export interface OutfitAiReviewDebug {
  requestId?: string;
  action?: string;
  outfitKeyShort?: string;
  scene?: SceneTag | string;
  cacheDecision?: string;
  aiAttempted?: boolean;
  provider?: string;
  model?: string;
  providerConfigured?: boolean;
  providerRequestStarted?: boolean;
  providerRequestFinished?: boolean;
  providerStatus?: number;
  validatorResult?: string;
  validatorRejectReasons?: string[];
  validatorTrace?: OutfitAiReviewValidatorTraceEntry[];
  aiRawSummary?: OutfitAiReviewRawSummary;
  fallbackUsed?: boolean;
  fallbackReason?: string;
  saved?: boolean;
  errorCode?: string;
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
  reviewVersion?: string;
  copyPolicyVersion?: string;
  voicePolicyVersion?: string;
  inputDigest?: string;
  source?: 'ai' | 'rule_fallback' | string;
  reviewSource?: OutfitReviewSource;
  contentPlanVersion?: string;
  sceneIntent?: string;
  primaryBenefitCode?: string;
  validatorRejectReasons?: string[];
  cacheReuseReason?: string;
  model?: string;
  cacheable?: boolean;
  enhanced?: boolean;
  fallback?: boolean;
  errorCode?: string;
  message?: string;
  aiReviewDebug?: OutfitAiReviewDebug;
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
  reasonVersion?: string;
  outfitItemRoles?: XiaodaContentPlanItem[];
  contentPlan?: XiaodaContentPlan;
  contentPlanVersion?: string;
  cardViewModel?: OutfitCardViewModel;
  detailNarrativeViewModel?: DetailNarrativeViewModel;
  sceneIntent?: string;
  primaryBenefitCode?: string;
  reviewSource?: OutfitReviewSource;
  validatorRejectReasons?: string[];
  cacheReuseReason?: string;
  primaryDimension?: string;
  evidenceCodes?: string[];
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
    batchDiagnostics?: {
      itemReuse?: {
        top?: Record<string, number>;
        bottom?: Record<string, number>;
        shoes?: Record<string, number>;
      };
      archetypeCounts?: Record<string, number>;
      angleCounts?: Record<string, number>;
      sceneIntentCounts?: Record<string, number>;
      limitedReason?: string;
    };
    limitedReason?: string;
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
