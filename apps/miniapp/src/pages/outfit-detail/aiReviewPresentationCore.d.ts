import type { OutfitAiComment } from '@starter-template/types';

export interface AiReviewPresentation {
  bodyParagraphs: string[];
  tags: string[];
  advice: string | null;
}

export function buildAiReviewPresentation(aiComment?: OutfitAiComment | null): AiReviewPresentation;
