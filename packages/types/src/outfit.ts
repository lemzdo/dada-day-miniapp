import type { ClothingCategory, SceneTag } from './clothes';
import type { WeatherMode, WeatherSnapshot } from './weather';

// ============================================================
// 搭一搭 · 穿搭/历史/分析/分享 类型定义
// ============================================================

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'all_day';

export type GenerationType = 'auto' | 'manual' | 'from_single' | 'scene';

export type OutfitSource = 'recommend' | 'recommendation' | 'favorite' | 'history' | 'manual';

export type OutfitKind = 'recommendation' | 'favorite' | 'history';

export interface RecommendationCopyEvidenceCarrier {
  confidence?: number;
  recognitionConfidence?: number;
  aiConfidence?: number;
  factConfidence?: number;
  factSource?: RecommendationFactSource;
  factSources?: Record<string, RecommendationFactSource>;
  factConfidences?: Record<string, number>;
  factEvidence?: RecommendationEvidenceFact[];
  factRecords?: RecommendationEvidenceFact[];
  factsWithSource?: RecommendationEvidenceFact[];
  contractFacts?: string[];
  userFacts?: string[];
  careLabelFacts?: string[];
  productFacts?: string[];
  structuredAiFacts?: string[];
  visualFacts?: string[];
  fit?: string;
  silhouette?: string;
  shoulderFit?: string;
  shoulderLine?: string;
  sleeveLength?: string;
  sleeve?: string;
  pantsLength?: string;
  patternType?: string;
  styleComplexity?: string;
  thickness?: string;
  material?: string;
  neckline?: string;
  collar?: string;
  closure?: string;
  shoeClosure?: string;
  shoeType?: string;
  materialGuess?: string;
  userEdited?: boolean;
  fieldSource?: string;
  styleTags?: string[];
  sceneTags?: string[];
  aestheticFeatures?: Record<string, unknown>;
  functionalFeatures?: Record<string, unknown>;
}

export interface OutfitItemSummary extends RecommendationCopyEvidenceCarrier {
  clothingId: string;
  category: ClothingCategory;
  subcategory?: string;
  imageUrl: string;
  displayImageUrl?: string;
  thumbnailUrl?: string;
  colorPalette?: { name: string; hex: string }[];
  isDeleted?: boolean;
}

export interface OutfitSnapshotItem extends RecommendationCopyEvidenceCarrier {
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
  advice?: string | null;
  partial?: boolean;
  adviceRejectReasons?: string[];
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

export type RecommendationSpeechAction =
  | 'home_rest'
  | 'home_movement'
  | 'home_temperature'
  | 'work_fit'
  | 'work_comfort'
  | 'work_temperature'
  | 'work_reminder'
  | 'date_coordination'
  | 'date_comfort'
  | 'date_temperature'
  | 'sport_movement'
  | 'sport_temperature'
  | 'sport_function'
  | 'sport_shoes';

export type RecommendationFactSource =
  | 'user'
  | 'care_label'
  | 'product_data'
  | 'structured_ai'
  | 'visual_inference'
  | 'legacy_snapshot'
  | 'scene_rule'
  | 'relation_rule';

export interface RecommendationEvidenceFact {
  factId: string;
  itemId: string;
  fact: string;
  value: unknown;
  source: RecommendationFactSource;
  confidence: number;
  authorized?: boolean;
  sourceDetail?: string;
}

export interface RecommendationRelationFact {
  relationFactId: string;
  factId: string;
  fact: string;
  subjectItemIds: string[];
  supportingFactIds: string[];
  source: 'scene_rule' | 'relation_rule';
  sourceRule?: string;
  relationRule?: string;
  confidence: number;
  authorized?: boolean;
}

export type RecommendationEligibilityEvidence = RecommendationEvidenceFact | RecommendationRelationFact;

export interface RecommendationEligibilityReason {
  code: string;
  family?: string;
  qualityTier?: number;
  isGenericFallback?: boolean;
  subjectItemIds: string[];
  supportingFactIds: string[];
  relationFactIds: string[];
  sourceRule: string;
  sourceRuleReasons: string[];
  evidence: RecommendationEligibilityEvidence[];
  catalogVersion?: string;
  text?: string;
  catalogOrder?: number;
}

export interface RecommendationEligibilityReasonCandidate extends RecommendationEligibilityReason {
  family: string;
  qualityTier: number;
  isGenericFallback: boolean;
  text: string;
  catalogOrder: number;
}

export interface RecommendationReasonSelectionDebug {
  reasonCandidates: Array<Pick<RecommendationEligibilityReasonCandidate, 'code' | 'family' | 'qualityTier' | 'text'> & { matched: boolean }>;
  selectedReasonCode: string;
  selectedReasonFamily: string;
  selectedReasonQualityTier: number;
  selectionBasis: string;
  sameQualityAlternativeCodes: string[];
  batchRepeatCount: number;
}

export interface RecommendationEligibilityDiagnostic {
  outfitKey?: string;
  selectedOutfitItemIds: string[];
  eligibilityReasonCode: string;
  subjectItemIds: string[];
  supportingFactIds: string[];
  relationFactIds: string[];
  sourceRule: string;
  sourceRuleReasons: string[];
}

export interface RecommendationNarrativeClaim {
  claimId: string;
  scene: 'home' | 'work' | 'date' | 'sport';
  action: RecommendationSpeechAction;
  dimension: string;
  subjectItemIds: string[];
  requiredFactIds: string[];
  evidenceFactIds: string[];
  evidenceSources: Array<Partial<RecommendationRelationFact> & Pick<RecommendationEvidenceFact, 'factId' | 'source' | 'confidence'>>;
  slotBindings: Record<string, string>;
  userValue: string;
  priority: number;
}

export interface RecommendationItemFactScope {
  category: ClothingCategory | string;
  displayName: string;
  copyLabel: string;
  facts: string[];
  evidenceFactIds: string[];
  factRecords: RecommendationEvidenceFact[];
}

export type RecommendationLimitedReason =
  | 'WARDROBE_SPARSE'
  | 'MISSING_REQUIRED_CATEGORY'
  | 'SCENE_ELIGIBLE_FEW'
  | 'WEATHER_ELIGIBLE_FEW'
  | 'DIVERSITY_EXHAUSTED'
  | 'COPY_EVIDENCE_INSUFFICIENT'
  | 'ATTRIBUTE_INCOMPLETE';

export type RecommendationMissingRole = 'top' | 'bottom' | 'onepiece' | 'shoes';
export type RecommendationMissingFact = 'sport_activity_top' | 'sport_activity_bottom' | 'sport_stable_shoe';

export interface RecommendationCopyContract {
  copyContractVersion: 'recommendation-copy-contract-v3';
  voiceBankVersion: 'xiaoda-fixed-claim-catalog-v2';
  gateResult: 'PASS' | 'REJECT';
  copyDisplay?: 'visible' | 'hidden';
  todayReason: string;
  todayReasonSource?: 'core_eligibility' | 'enhanced_qualification_core' | 'presentation_plan' | '';
  coreEligibilityReason: string;
  coreEligibilityReasonCode: string;
  coreEligibilityEvidence: RecommendationEligibilityEvidence[];
  coreEligibilitySubjectItemIds: string[];
  coreEligibilitySupportingFactIds: string[];
  coreEligibilityRelationFactIds: string[];
  coreEligibilitySourceRule: string;
  coreEligibilitySourceRuleReasons: string[];
  enhancedReason?: string;
  enhancementRejectReasons: string[];
  todayClaim: RecommendationNarrativeClaim | null;
  todayClaimId: string;
  todayAction: RecommendationSpeechAction | null;
  todayDimension: string | null;
  todayEvidenceIds: string[];
  todayRequiredFactIds: string[];
  todayEvidenceSources: Array<Pick<RecommendationEvidenceFact, 'factId' | 'itemId' | 'source' | 'confidence'>>;
  todaySentenceClusterId: string;
  todaySubjectItemId: string;
  todaySubjectItemIds: string[];
  todaySlotBindings: Record<string, string>;
  detailExplanation?: string;
  detailClaim: RecommendationNarrativeClaim | null;
  detailClaimId: string;
  detailAction: RecommendationSpeechAction | null;
  detailDimension: string | null;
  detailEvidenceIds: string[];
  detailRequiredFactIds: string[];
  detailEvidenceSources: Array<Pick<RecommendationEvidenceFact, 'factId' | 'itemId' | 'source' | 'confidence'>>;
  detailSentenceClusterId: string;
  detailSubjectItemId: string;
  detailSubjectItemIds: string[];
  detailSlotBindings: Record<string, string>;
  riskFlags: string[];
  qualification: { qualified: boolean; reasons: string[] };
  presentationFactSignature?: string;
  primaryRelationCode?: string | null;
  unsupportedClaimCount?: number;
}

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
  detailExplanation?: string;
  aiExtraDefault?: string;
  usedInsightCodes?: string[];
  usedPhrases?: string[];
  angle?: string;
  copyContractVersion?: RecommendationCopyContract['copyContractVersion'];
  voiceBankVersion?: RecommendationCopyContract['voiceBankVersion'];
  todayClaim?: RecommendationNarrativeClaim | null;
  todayClaimId?: string;
  todayAction?: RecommendationCopyContract['todayAction'];
  todayDimension?: RecommendationCopyContract['todayDimension'];
  todayEvidenceIds?: string[];
  todayRequiredFactIds?: string[];
  todayEvidenceSources?: RecommendationCopyContract['todayEvidenceSources'];
  todaySentenceClusterId?: string;
  todaySubjectItemId?: string;
  todaySubjectItemIds?: string[];
  todaySlotBindings?: Record<string, string>;
  detailClaim?: RecommendationNarrativeClaim | null;
  detailClaimId?: string;
  detailAction?: RecommendationCopyContract['detailAction'];
  detailDimension?: RecommendationCopyContract['detailDimension'];
  detailEvidenceIds?: string[];
  detailRequiredFactIds?: string[];
  detailEvidenceSources?: RecommendationCopyContract['detailEvidenceSources'];
  detailSentenceClusterId?: string;
  detailSubjectItemId?: string;
  detailSubjectItemIds?: string[];
  detailSlotBindings?: Record<string, string>;
  riskFlags?: string[];
  qualification?: RecommendationCopyContract['qualification'];
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
  defaultText?: string;
  source?: 'copy_contract' | 'content_plan' | 'ai' | 'safe_fallback' | string;
  aiStatus?: 'default' | 'success' | 'failed' | string;
}

export interface StylistExplanationPointV2 {
  text: string;
  evidenceCodes: string[];
}

export interface StylistExplanationV2 {
  schemaVersion: 2 | 3;
  reviewVersion: 'stylist-explanation-v2' | string;
  promptVersion: 'stylist-prompt-v2' | string;
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
  overallComment?: string;
  advice?: string | null;
  partial?: boolean;
  adviceRejectReasons?: string[];
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
  partial?: boolean;
  adviceRejectReasons?: string[];
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
  aiReviewVersion?: string;
  partial?: boolean;
  adviceRejectReasons?: string[];
  retainedPrevious?: boolean;
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
  weatherMode?: WeatherMode;
  eligibility?: {
    weather?: { pass?: boolean; hardRejected?: boolean; [key: string]: unknown };
    scene?: {
      eligible?: boolean;
      hardRejected?: boolean;
      eligibilityReason?: RecommendationEligibilityReason;
      [key: string]: unknown;
    };
    penalty?: number;
  };
  eligibilityReason?: RecommendationEligibilityReason;
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
  copyContract?: RecommendationCopyContract;
  copyContractVersion?: RecommendationCopyContract['copyContractVersion'];
  voiceBankVersion?: RecommendationCopyContract['voiceBankVersion'];
  todayClaim?: RecommendationNarrativeClaim | null;
  todayClaimId?: string;
  todayAction?: RecommendationCopyContract['todayAction'];
  todayDimension?: RecommendationCopyContract['todayDimension'];
  todayEvidenceIds?: string[];
  todayRequiredFactIds?: string[];
  todayEvidenceSources?: RecommendationCopyContract['todayEvidenceSources'];
  todaySentenceClusterId?: string;
  todaySubjectItemId?: string;
  todaySubjectItemIds?: string[];
  todaySlotBindings?: Record<string, string>;
  todayReasonSource?: RecommendationCopyContract['todayReasonSource'];
  coreEligibilityReason?: string;
  coreEligibilityReasonCode?: string;
  coreEligibilityEvidence?: RecommendationEligibilityEvidence[];
  coreEligibilitySubjectItemIds?: string[];
  coreEligibilitySupportingFactIds?: string[];
  coreEligibilityRelationFactIds?: string[];
  coreEligibilitySourceRule?: string;
  coreEligibilitySourceRuleReasons?: string[];
  enhancedReason?: string;
  enhancementRejectReasons?: string[];
  detailClaim?: RecommendationNarrativeClaim | null;
  detailClaimId?: string;
  detailAction?: RecommendationCopyContract['detailAction'];
  detailDimension?: RecommendationCopyContract['detailDimension'];
  detailEvidenceIds?: string[];
  detailRequiredFactIds?: string[];
  detailEvidenceSources?: RecommendationCopyContract['detailEvidenceSources'];
  detailSentenceClusterId?: string;
  detailSubjectItemId?: string;
  detailSubjectItemIds?: string[];
  detailSlotBindings?: Record<string, string>;
  riskFlags?: string[];
  copyGateResult?: 'PASS' | 'REJECT';
  copyRiskFlags?: string[];
  copyDisplay?: 'visible' | 'hidden';
  defaultCopyHidden?: boolean;
  copyFinalizationMode?: 'new_recommendation' | 'saved_snapshot';
  qualification?: RecommendationCopyContract['qualification'];
  outfitItemRoles?: XiaodaContentPlanItem[];
  contentPlan?: XiaodaContentPlan;
  contentPlanVersion?: string;
  cardViewModel?: OutfitCardViewModel;
  detailNarrativeViewModel?: DetailNarrativeViewModel;
  sceneIntent?: string;
  primaryBenefitCode?: string;
  reviewSource?: OutfitReviewSource;
  enhanced?: boolean;
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

export type RecommendationPresentationEvidenceMode = 'sanitized_v1';

export interface RecommendationPresentationItemRoleEvidence {
  role: string | null;
  canonicalName: string | null;
  canonicalSubtype: string | null;
  normalizedColor: string | null;
}

export interface RecommendationPresentationDifferentiatorEvidence {
  type: string;
  role: string | null;
  authorizedValue: string;
  relationCode?: string | null;
  roles?: string[];
  authorizedValues?: string[];
}

export interface RecommendationPresentationContentPlanSummary {
  sceneIntent: string | null;
  primaryRelationCode: string | null;
  titleConcept: string | null;
  reasonClaim: string | null;
}

export interface RecommendationPresentationCopyContractSummary {
  gateResult: string | null;
  copyDisplay: string | null;
  todayReasonSource: string | null;
  primaryRelationCode: string | null;
  unsupportedClaimCount: number;
}

export interface RecommendationPresentationBindingEvidence {
  canonicalFactSignatureHash: string | null;
  contentPlanFactSignatureHash: string | null;
  copyContractFactSignatureHash: string | null;
  factSignaturesEqual: boolean;
  canonicalRelationCode: string | null;
  contentPlanRelationCode: string | null;
  copyContractRelationCode: string | null;
  relationCodesEqual: boolean;
  titleMatchesPlan: boolean;
  reasonMatchesPlan: boolean;
}

export interface RecommendationPresentationEvidenceCard {
  cardAlias: string;
  outfitKeyHash: string | null;
  presentationFactSignatureHash: string | null;
  itemRoles: RecommendationPresentationItemRoleEvidence[];
  primaryRelationCode: string | null;
  availableDifferentiators: RecommendationPresentationDifferentiatorEvidence[];
  selectedDifferentiator: RecommendationPresentationDifferentiatorEvidence | null;
  binding: RecommendationPresentationBindingEvidence;
  contentPlanSummary: RecommendationPresentationContentPlanSummary;
  copyContractSummary: RecommendationPresentationCopyContractSummary;
  reasonSemanticSkeleton: string;
  titleSemanticSkeleton: string;
  finalTitle: string | null;
  finalReason: string | null;
  finalTags: string[];
}

export interface RecommendationPresentationEvidence {
  version: 'presentation-evidence-v3';
  auditId: string;
  countContract: RecommendationCountContract;
  shared: {
    scene: string | null;
    planVersion: string | null;
    copyContractVersion: string | null;
    qaVersion: string | null;
  };
  cards: RecommendationPresentationEvidenceCard[];
}

export interface RecommendationCountContract {
  requestedBatchSize: number;
  expectedCardCount: number;
  returnedCardCount: number;
  remainingUniqueBeforeConsume: number;
  remainingUniqueAfterConsume: number;
  tailBatchAuthorized: boolean;
  poolExhaustedAfterConsume: boolean;
  executionMode: 'full_compute' | 'candidate_pool_hit' | 'fallback_recompute';
  candidatePoolId: string | null;
}

export interface RecommendationPresentationEvidenceStatus {
  status: 'omitted_over_budget' | 'not_applicable_empty_batch';
  countContract?: RecommendationCountContract;
  version: 'presentation-evidence-v3';
  actualBytes: number;
  limitBytes: number;
}

export interface RecommendRequest {
  date?: string;
  timeOfDay?: TimeOfDay;
  scene?: SceneTag;
  location?: { lat: number; lng: number };
  cityCode?: string;
  weather?: WeatherSnapshot;
  weatherMode?: WeatherMode;
  sourceItemId?: string;
  excludeClothingIdSets?: string[][];
  excludedOutfitKeys?: string[];
  /** Reuse this short-lived, user-isolated candidate pool for a next batch. */
  recommendationBatchId?: string;
  maxResults?: number;
  debugRecommendationAudit?: boolean;
  presentationEvidenceMode?: RecommendationPresentationEvidenceMode;
  auditId?: string;
  /** Client-side trigger descriptor (e.g. 'initial', 'refresh', 'scene'). Used by the cloud function to distinguish initial_request from refresh_without_pool_id. */
  trigger?: string;
}

export interface RecommendationDiagnosticsTimings {
  dataLoadMs: number;
  identityMs: number;
  candidatePoolLoadMs: number;
  candidatePoolSaveMs: number;
  candidatePoolPlanMs?: number;
  candidatePoolSerializationMs?: number;
  candidatePoolChunkWriteMs?: number;
  candidatePoolValidationMs?: number;
  candidatePoolManifestWriteMs?: number;
  poolManifestLoadMs: number;
  poolChunksLoadMs: number;
  poolHydrateMs: number;
  exclusionMs: number;
  compositionMs: number;
  canonicalizeMs: number;
  eligibilityMs: number;
  scoringMs: number;
  batchSelectionMs: number;
  cardCompilationMs: number;
  qaAuditMs: number;
  snapshotUpsertMs: number;
  enrichMs: number;
  exposureMs: number;
  serializationMs: number;
  totalMs: number;
}

export interface CandidatePoolPhaseTiming {
  clock: 'process.hrtime.bigint';
  totalWallMs: number;
  accountedWallMs: number;
  unaccountedWallMs: number;
  wrapperWallMs?: number;
  wrapperDeltaMs?: number;
  phaseWallMs: {
    poolInputMaterialization: number;
    objectCloneNormalization: number;
    dictionaryChunkBuild: number;
    jsonSerialization: number;
    checksumHash: number;
    byteSizeStatistics: number;
    chunkTaskCreation: number;
    chunkRemoteWriteWall: number;
    promiseJoin: number;
    localValidation: number;
    manifestBuild: number;
    manifestWrite: number;
    cleanupTelemetryAssembly: number;
    otherRealStage: number;
  };
  parallelOperationMs: {
    chunkRemoteWriteCumulative: number;
  };
}

export interface RecommendationResponseBytes {
  outfitsBytes: number;
  debugBytes: number;
  qaBytes: number;
  totalDataBytes: number;
  eligibilityRejectionAuditBytes?: number;
}

export interface EligibilityRejectionAuditRoleSnapshot {
  category: string;
  subtype: string;
  sportFacts: Record<string, boolean>;
}

export interface EligibilityRejectionAuditSample {
  sampleIndex: number;
  rejectionStage: string;
  rejectionCodes: string[];
  top: EligibilityRejectionAuditRoleSnapshot;
  bottom: EligibilityRejectionAuditRoleSnapshot;
  shoes: EligibilityRejectionAuditRoleSnapshot;
  roleCompleteness: boolean;
  weather: {
    mode: string;
    temperatureBucket: string;
    precipitationPresent: boolean;
  };
}

export interface EligibilityRejectionAuditCategoryDistribution {
  top: {
    categories: Record<string, number>;
    subtypes: Record<string, number>;
  };
  bottom: {
    categories: Record<string, number>;
    subtypes: Record<string, number>;
  };
  shoes: {
    categories: Record<string, number>;
    subtypes: Record<string, number>;
  };
  roleCompleteness: {
    complete: number;
    incomplete: number;
  };
  sportFactCounts: Record<string, number>;
  safeSportCandidate: {
    exists: boolean;
    count: number;
  };
}

export interface EligibilityRejectionAudit {
  version: string;
  generatedCount: number;
  guardEnteredCount: number;
  guardAcceptedCount: number;
  guardRejectedCount: number;
  rejectionStageHistogram: Record<string, number>;
  rejectionReasonHistogram: Record<string, number>;
  rejectionReasonCombinationHistogram: Record<string, number>;
  categoryDistribution: EligibilityRejectionAuditCategoryDistribution;
  samples: EligibilityRejectionAuditSample[];
  truncated: boolean;
  serializedBytes: number;
}

export interface RecommendationQaGateSummary {
  version: string;
  counts: {
    candidate: number;
    generated: number;
    accepted: number;
    rejected: number;
    selected: number;
  };
  finalCardCount: number;
  alternativeCandidateCount: number;
  qaGatePassed: boolean;
  gateStatus: 'passed' | 'passed_with_warnings' | 'failed';
  qaBlockReasons: string[];
  duplicateCause: string;
  placeholderTitleCount: number;
  syntheticSuffixCount: number;
  availableDifferentiatorCount: number;
  titleDuplicateWarningCount: number;
  unsupportedClaimCount: number;
  tagSceneMismatchCount: number;
  cardConsistencyFailures: number;
  qaTruncated: boolean;
}

export interface RecommendationQaBatchAudit {
  version: string;
  auditId: string;
  cloudBuild: string;
  executionMode?: 'full_compute' | 'candidate_pool_hit' | 'fallback_recompute';
  countContract?: RecommendationCountContract | null;
  candidatePoolIdentityHash?: string;
  candidatePoolAgeMs?: number;
  cacheHit?: boolean;
  cacheMissReason?: string;
  counts?: {
    candidate?: number;
    generated?: number;
    accepted?: number;
    rejected?: number;
    selected?: number;
  };
  exclusionsAppliedCount?: number;
  requestedExcludedCount?: number;
  actualExcludedCandidateCount?: number;
  remainingCandidateCount?: number;
  /** Candidate pool persist status from tryPersistCandidatePool. */
  candidatePoolSaveStatus?: string;
  /** Detailed reason accompanying candidatePoolSaveStatus. */
  candidatePoolSaveReason?: string | null;
  /** Serialized candidate pool payload size in bytes. */
  candidatePoolSerializedBytes?: number;
  /** Number of storage chunks written. */
  candidatePoolChunkCount?: number;
  candidatePoolManifestBytes?: number;
  candidatePoolChunksBytes?: number;
  candidatePoolChunkWriteTimings?: Array<{
    chunkIndex: number;
    documentBytes: number;
    elapsedMs: number;
    ok: boolean;
  }>;
  candidatePoolMaxActiveChunkWrites?: number;
  candidatePoolValidationReadCount?: number;
  candidatePoolValidationMode?: string;
  candidatePoolCleanupAttempted?: boolean;
  candidatePoolCleanupDeletedCount?: number;
  candidatePoolCleanupFailedCount?: number;
  candidatePoolPhaseTiming?: CandidatePoolPhaseTiming | null;
  exactTitleDuplicateGroups?: Array<Record<string, unknown>>;
  normalizedTitleDuplicateGroups?: Array<Record<string, unknown>>;
  titleTokenDuplicateGroups?: Array<Record<string, unknown>>;
  placeholderTitleCount?: number;
  syntheticSuffixCount?: number;
  presentationFactSignatureHash?: string | null;
  primaryRelationCode?: string | null;
  unsupportedClaimCount?: number;
  reasonSemanticSkeleton?: string;
  titleSemanticSkeleton?: string;
  semanticEquivalentGroupCount?: number;
  qaGatePassed?: boolean;
  qaBlockReasons?: string[];
  tagSceneMismatchCount?: number;
  cardConsistencyFailures?: number;
  /** Whether the response exposes a recommendationBatchId to the client. */
  recommendationBatchIdPresent?: boolean;
  /** Length of the exposed recommendationBatchId string. */
  recommendationBatchIdLength?: number;
  /** Whether the request carried a recommendationBatchId to reuse. */
  requestedCandidatePoolIdPresent?: boolean;
  /** Length of the requested recommendationBatchId string. */
  requestedCandidatePoolIdLength?: number;
  reuseExplanations?: Array<Record<string, unknown>>;
  exactReasonDuplicateGroups?: Array<{
    sentenceHash?: string;
    count?: number;
    factSignatureCount?: number;
    allowed?: boolean;
    explanation?: string;
  }>;
  normalizedReasonDuplicateGroups?: Array<Record<string, unknown>>;
  timings: RecommendationDiagnosticsTimings;
  responseBytes: RecommendationResponseBytes;
  qaTruncated: boolean;
  qaGateSummary: RecommendationQaGateSummary;
  eligibilityRejectionAudit?: EligibilityRejectionAudit;
  [key: string]: unknown;
}

export interface RecommendResponse {
  outfits: Outfit[];
  countContract: RecommendationCountContract;
  sceneKey: string;
  scene: string;
  weather?: WeatherSnapshot;
  weatherMode?: WeatherMode;
  recommendationNotice?: string;
  recommendationBatchId?: string;
  missingRoles?: RecommendationMissingRole[];
  missingFacts?: RecommendationMissingFact[];
  limited?: boolean;
  exhausted?: boolean;
  meta?: {
    auditId?: string;
    cloudBuildVersion: string;
    reasonCatalogVersion: string;
    aiReviewVersion: string;
  };
  qaBatchAudit?: RecommendationQaBatchAudit;
  debug?: {
    auditId?: string;
    inputScene?: SceneTag | string;
    matchedScene?: SceneTag | string;
    candidateCount: number;
    generatedCount: number;
    requestedCount?: number;
    weatherMode?: WeatherMode;
    cloudBuildVersion?: string;
    executionMode?: 'full_compute' | 'candidate_pool_hit' | 'fallback_recompute';
    candidatePoolIdentityHash?: string;
    candidatePoolAgeMs?: number;
    cacheHit?: boolean;
    cacheMissReason?: string;
    exclusionsAppliedCount?: number;
    requestedExcludedCount?: number;
    actualExcludedCandidateCount?: number;
    remainingCandidateCount?: number;
    reasonCatalogVersion?: string;
    aiReviewVersion?: string;
    acceptedCount?: number;
    outfitAcceptedCount?: number;
    coreReasonAcceptedCount?: number;
    enhancedReasonAcceptedCount?: number;
    coreReasonCoverageGapCount?: number;
    coreReasonCodeCounts?: Record<string, number>;
    enhancementRejectReasonCounts?: Record<string, number>;
    outfitRejectedCount?: number;
    copyAcceptedCount?: number;
    copyHiddenCount?: number;
    copyRejectedCount?: number;
    copyRejectReasonCounts?: Record<string, number>;
    finalRecommendationCount?: number;
    filteredCandidateCount?: number;
    excludedOutfitKeyCount?: number;
    guardCandidateCount?: number;
    guardAcceptedCount?: number;
    guardRejectedCount?: number;
    weatherRejectedCount?: number;
    sceneRejectedCount?: number;
    eligibilityReasonCoverageGapCount?: number;
    rejectReasonCounts?: Record<string, number>;
    unmappedEligibilityPaths?: Array<{
      selectedOutfitItemIds: string[];
      scene: string;
      sourceRule: string;
      sourceRuleReasons: string[];
      visibleFactsByItem: Record<string, string[]>;
    }>;
    eligibilityReasonDiagnostics?: {
      afterGuard?: RecommendationEligibilityDiagnostic[];
      afterSelection?: RecommendationEligibilityDiagnostic[];
      beforeFinalization?: RecommendationEligibilityDiagnostic[];
    };
    reasonSelection?: RecommendationReasonSelectionDebug[];
    missingRoles?: RecommendationMissingRole[];
    missingFacts?: RecommendationMissingFact[];
    copyDiagnosticReason?: 'COPY_EVIDENCE_INSUFFICIENT' | null;
    countContract?: RecommendationCountContract;
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
      limitedReason?: RecommendationLimitedReason;
    };
    limitedReason?: RecommendationLimitedReason | null;
    timings?: RecommendationDiagnosticsTimings;
    responseBytes?: RecommendationResponseBytes;
    qaTruncated?: boolean;
    qaBatchAudit?: Record<string, unknown>;
    qaBatchAuditJsonBytes?: number;
    presentationEvidence?: RecommendationPresentationEvidence;
    presentationEvidenceStatus?: RecommendationPresentationEvidenceStatus;
    /** Candidate pool persist status from tryPersistCandidatePool: saved | write_failed | write_timeout | undefined when no persist attempt was made. */
    candidatePoolSaveStatus?: string;
    /** Detailed reason accompanying candidatePoolSaveStatus (e.g. exceeds_storage_budget, database_error). */
    candidatePoolSaveReason?: string | null;
    /** Serialized candidate pool payload size in bytes (0 when not persisted). */
    candidatePoolSerializedBytes?: number;
    /** Number of storage chunks written (0 when not persisted). */
    candidatePoolChunkCount?: number;
    candidatePoolSerializationMs?: number;
    candidatePoolChunkWriteTimings?: Array<{
      chunkIndex: number;
      documentBytes: number;
      elapsedMs: number;
      ok: boolean;
    }>;
    candidatePoolMaxActiveChunkWrites?: number;
    candidatePoolValidationReadCount?: number;
    candidatePoolValidationMode?: string;
    candidatePoolManifestBytes?: number;
    candidatePoolChunksBytes?: number;
    candidatePoolCleanupAttempted?: boolean;
    candidatePoolCleanupDeletedCount?: number;
    candidatePoolCleanupFailedCount?: number;
    candidatePoolPhaseTiming?: CandidatePoolPhaseTiming | null;
    /** Whether the response exposes a recommendationBatchId to the client. */
    recommendationBatchIdPresent?: boolean;
    /** Length of the exposed recommendationBatchId string (0 when absent). */
    recommendationBatchIdLength?: number;
    /** Whether the request carried a recommendationBatchId to reuse. */
    requestedCandidatePoolIdPresent?: boolean;
    /** Length of the requested recommendationBatchId string (0 when absent). */
    requestedCandidatePoolIdLength?: number;
    exactTitleDuplicateGroups?: Array<Record<string, unknown>>;
    normalizedTitleDuplicateGroups?: Array<Record<string, unknown>>;
    exactReasonDuplicateGroups?: Array<Record<string, unknown>>;
    normalizedReasonDuplicateGroups?: Array<Record<string, unknown>>;
    syntheticSuffixCount?: number;
    placeholderTitleCount?: number;
    qaGatePassed?: boolean;
    qaBlockReasons?: string[];
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
