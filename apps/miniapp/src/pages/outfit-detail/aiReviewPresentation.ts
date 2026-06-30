import type { OutfitAiComment } from '@starter-template/types';
import {
  buildAiReviewPresentation as buildAiReviewPresentationCore,
  type AiReviewPresentation,
} from './aiReviewPresentationCore';

export type { AiReviewPresentation };

export function buildAiReviewPresentation(aiComment?: OutfitAiComment | null): AiReviewPresentation {
  return buildAiReviewPresentationCore(aiComment);
}
