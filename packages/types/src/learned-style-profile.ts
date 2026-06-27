export type LearnedStyleProfileStatus = 'insufficient_data' | 'shadow_ready';

export type LearnedStyleDimensionKey =
  | 'fit'
  | 'silhouette'
  | 'patternType'
  | 'designElement'
  | 'formalityLevel'
  | 'colorFamily'
  | 'styleTag';

export type LearnedStyleContextKey = 'home' | 'work' | 'date' | 'sport';

export interface LearnedPreferenceSignalV1 {
  value: string;
  score: number;
  confidence: number;
  supportWeight: number;
  positiveWeight: number;
  negativeWeight: number;
  distinctOutfitCount: number;
}

export interface LearnedPreferenceDimensionV1 {
  positive: LearnedPreferenceSignalV1[];
  negative: LearnedPreferenceSignalV1[];
  observedValueCount: number;
}

export type LearnedStyleProfileSliceV1 = Record<LearnedStyleDimensionKey, LearnedPreferenceDimensionV1>;

export interface LearnedStyleProfileSourceV1 {
  windowDays: 180;
  from: string;
  to: string;
  eventCount: number;
  eligibleEventCount: number;
  exposureCount: number;
  distinctOutfitCount: number;
  lastEventAt?: string;
  sourceDigest: string;
}

export interface LearnedStyleProfileQualityV1 {
  effectiveActionWeight: number;
  featureCoverage: number;
  contextCoverage: number;
  positiveActionCount: number;
  negativeActionCount: number;
  wearCount: number;
  repeatedWearCount: number;
}

export interface LearnedStyleProfileV1 {
  schemaVersion: 1;
  profileVersion: 'learned-style-v1';
  status: LearnedStyleProfileStatus;
  global: LearnedStyleProfileSliceV1;
  contexts: Partial<Record<LearnedStyleContextKey, LearnedStyleProfileSliceV1>>;
  source: LearnedStyleProfileSourceV1;
  quality: LearnedStyleProfileQualityV1;
  generatedAt: string;
}
