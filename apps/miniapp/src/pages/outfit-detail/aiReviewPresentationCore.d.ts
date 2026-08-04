import type { OutfitAiComment, OutfitReviewSource, XiaodaContentPlan } from '@starter-template/types';

export interface AiReviewPresentation {
  bodyParagraphs: string[];
  tags: string[];
  advice: string | null;
}

export interface AiReviewPresentationContext {
  copyContractVersion?: string;
  reviewSource?: OutfitReviewSource;
  enhanced?: boolean;
}

export function buildAiReviewPresentation(
  aiComment?: OutfitAiComment | null,
  contentPlan?: XiaodaContentPlan | null,
  context?: AiReviewPresentationContext,
): AiReviewPresentation;
