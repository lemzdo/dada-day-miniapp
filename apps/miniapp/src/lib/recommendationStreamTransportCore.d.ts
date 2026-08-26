import type { RecommendationV2Request } from './cloud';

export function buildRecommendationStreamTransportInput(
  params: RecommendationV2Request,
  generation: string | number,
  runtimeVersion: string,
): Record<string, unknown>;
