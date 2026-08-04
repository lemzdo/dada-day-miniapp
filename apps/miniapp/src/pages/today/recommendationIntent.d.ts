export interface RecommendationIntentSignatureInput {
  userRuntimeKey?: string;
  sceneKey?: string;
  date?: string;
  timeOfDay?: string;
  weatherFingerprint?: string;
  wardrobeVersion?: string;
  profileVersion?: string;
  recommendationBatchId?: string;
  excludedOutfitKeys?: string[];
  requestKind?: string;
}

export interface RecommendationIntent {
  intentId: string;
  inputSignature: string;
  generation: number;
}

export interface RecommendationIntentRun<T> {
  intent: RecommendationIntent;
  promise: Promise<T>;
  joined: boolean;
}

export interface RecommendationIntentRegistry {
  activate(input: { intentId: string; inputSignature: string }): RecommendationIntent;
  getActive(): RecommendationIntent | null;
  isCurrent(intent: RecommendationIntent | null | undefined): boolean;
  reset(): void;
  run<T>(input: {
    intentId: string;
    inputSignature: string;
    execute: (intent: RecommendationIntent) => T | Promise<T>;
  }): RecommendationIntentRun<T>;
}

export function buildRecommendationInputSignature(input?: RecommendationIntentSignatureInput): string;
export function createRecommendationIntentRegistry(): RecommendationIntentRegistry;
