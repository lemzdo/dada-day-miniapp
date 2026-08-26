interface RecommendationHttpCloud<TOptions = unknown, TResult = unknown> {
  callHTTPFunction?: (options: TOptions) => TResult;
}

interface RecommendationHttpTransport<TOptions = unknown, TResult = unknown> {
  source: 'wx.cloud' | 'taro.cloud';
  call: (options: TOptions) => TResult;
}

export function resolveRecommendationHttpTransport<TOptions = unknown, TResult = unknown>(input?: {
  nativeCloud?: RecommendationHttpCloud<TOptions, TResult> | null;
  frameworkCloud?: RecommendationHttpCloud<TOptions, TResult> | null;
}): RecommendationHttpTransport<TOptions, TResult> | null;
