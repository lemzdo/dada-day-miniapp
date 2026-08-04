import type { RecommendationMissingFact, RecommendationMissingRole } from '@starter-template/types';

export const NO_MORE_NEW_OUTFITS_NOTICE: '这一轮暂时没有更多新搭配了。';
export const NEUTRAL_EMPTY_NOTICE: '这个场景暂时没找到合适的搭配，换个场景试试吧。';
export function getRecommendationEmptyStateCopy(missingRoles?: RecommendationMissingRole[], missingFacts?: RecommendationMissingFact[]): string;
