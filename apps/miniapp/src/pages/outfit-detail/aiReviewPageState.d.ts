export type AiReviewPageState = 'idle' | 'loading' | 'success' | 'partial' | 'failed' | 'failed_retained';

export interface AiReviewPageStateInput {
  loading?: boolean;
  success?: boolean;
  partial?: boolean;
  failed?: boolean;
  retainedPrevious?: boolean;
  hasContent?: boolean;
}

export function getAiReviewPageState(input?: AiReviewPageStateInput): {
  state: AiReviewPageState;
  buttonText: string;
  disabled: boolean;
  message: string;
};
