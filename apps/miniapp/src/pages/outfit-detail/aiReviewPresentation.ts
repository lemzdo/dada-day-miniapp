import type { OutfitAiComment, XiaodaContentPlan } from '@starter-template/types';
import {
  buildAiReviewPresentation as buildAiReviewPresentationCore,
  type AiReviewPresentation,
  type AiReviewPresentationContext,
} from './aiReviewPresentationCore';

export type { AiReviewPresentation, AiReviewPresentationContext };

export function buildAiReviewPresentation(
  aiComment?: OutfitAiComment | null,
  contentPlan?: XiaodaContentPlan | null,
  context?: AiReviewPresentationContext,
): AiReviewPresentation {
  return buildAiReviewPresentationCore(aiComment, contentPlan, context);
}
