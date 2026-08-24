export interface RecommendationCoordinatorRun<T> {
  identity: string;
  requestKey: string;
  joined: boolean;
  source: 'ready' | 'in-flight' | 'prebuild-in-flight' | 'prebuild' | 'full-compute';
  promise: Promise<T>;
}

export interface RecommendationCoordinatorCore<TRequest, TResult> {
  acquire(input: { identity: string; requestKey?: string; request: TRequest; mode?: 'today' | 'prebuild' }): RecommendationCoordinatorRun<TResult>;
  getLatestIdentity(): string | null;
  invalidateAndPrebuild(input: { identity: string; requestKey?: string; request: TRequest }): RecommendationCoordinatorRun<TResult>;
  isLatest(identity: string): boolean;
  reset(): void;
  setLatestIdentity(identity: string): string;
}

export function createRecommendationCoordinatorCore<TRequest, TResult>(options: {
  execute: (request: TRequest, context: { identity: string; mode: 'today' | 'prebuild' }) => TResult | Promise<TResult>;
}): RecommendationCoordinatorCore<TRequest, TResult>;
