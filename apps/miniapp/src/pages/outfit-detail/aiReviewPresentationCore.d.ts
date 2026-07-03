import type { OutfitAiComment, XiaodaContentPlan } from '@starter-template/types';

export interface AiReviewPresentation {
  bodyParagraphs: string[];
  tags: string[];
  advice: string | null;
}

export function buildAiReviewPresentation(
  aiComment?: OutfitAiComment | null,
  contentPlan?: XiaodaContentPlan | null,
): AiReviewPresentation;
