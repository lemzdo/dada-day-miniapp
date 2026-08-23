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
  hasInFlight(): boolean;
  isCurrent(intent: RecommendationIntent | null | undefined): boolean;
  reset(): void;
  run<T>(input: {
    intentId: string;
    inputSignature: string;
    execute: (intent: RecommendationIntent) => T | Promise<T>;
  }): RecommendationIntentRun<T>;
}

export type RecommendationInputReadiness = 'deferred' | 'ready' | 'unavailable';
export interface RecommendationInputCoordinator {
  report(input: { inputIdentity: string; readiness?: RecommendationInputReadiness }): { dispatch: boolean; inputIdentity: string };
  reset(): void;
}

export function buildRecommendationInputSignature(input?: RecommendationIntentSignatureInput): string;
export function createRecommendationIntentRegistry(): RecommendationIntentRegistry;
export function createRecommendationInputCoordinator(): RecommendationInputCoordinator;
export function shouldPreserveRecommendationLifecycle(previousRuntimeKey: string | null, hasInFlight: boolean): boolean;
