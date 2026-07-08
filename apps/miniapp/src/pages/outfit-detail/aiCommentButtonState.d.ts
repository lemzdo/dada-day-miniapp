import type { Outfit } from '@starter-template/types';

export type AiCommentButtonState = 'idle' | 'loading' | 'success' | 'failed' | 'cooldown' | 'unavailable';

export interface AiCommentButtonBlockReason {
  state: AiCommentButtonState;
  debugReason: string;
  toast: string;
}

export function getAiCommentButtonBlockReason(input?: {
  outfit?: Outfit | null;
  authContext?: unknown;
  commentLoading?: boolean;
}): AiCommentButtonBlockReason | null;

export function getAiCommentButtonState(input?: {
  commentLoading?: boolean;
  fallbackFailed?: boolean;
  cooldown?: boolean;
  unavailable?: boolean;
  hasCanonical?: boolean;
}): {
  state: AiCommentButtonState;
  disabled: boolean;
  debugReason: string;
};
