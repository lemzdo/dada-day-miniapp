import type { ClothesDraft, UploadBatch, UploadImage } from '@starter-template/types';

export type UploadBatchViewStatus = 'processing' | 'ready' | 'failed' | 'saved' | 'discarded';
export type UploadConfirmPageState =
  | 'processing'
  | 'ready'
  | 'noneSelected'
  | 'empty'
  | 'failed'
  | 'saved'
  | 'discarded';

export interface UploadConfirmDerivedState {
  taskStatus: UploadBatchViewStatus;
  pageState: UploadConfirmPageState;
  batchProgress: {
    totalImages: number;
    processedImages: number;
    isBatchComplete: boolean;
  };
  totalImages: number;
  processedImages: number;
  recognizedCount: number;
  recognizedDrafts: ClothesDraft[];
  selectedDrafts: ClothesDraft[];
  savableDrafts: ClothesDraft[];
  discardedDrafts: ClothesDraft[];
  savedDrafts: ClothesDraft[];
  processingDrafts: ClothesDraft[];
  visibleDrafts: ClothesDraft[];
  selectableDraftCount: number;
  allSelectableDraftsSelected: boolean;
  showProcessingProgress: boolean;
  canEditDrafts: boolean;
  canDiscardBatch: boolean;
  canSave: boolean;
  saving: boolean;
}

export function buildUploadConfirmState(input?: {
  batch?: UploadBatch | null;
  images?: UploadImage[];
  drafts?: ClothesDraft[];
  saving?: boolean;
}): UploadConfirmDerivedState;

export function getProgressTitle(state: UploadConfirmDerivedState): string;
export function getProgressDesc(state: UploadConfirmDerivedState): string;
export function getSaveButtonText(state: UploadConfirmDerivedState): string;
export function getEmptyTitle(state: UploadConfirmDerivedState): string;
export function getEmptyDesc(state: UploadConfirmDerivedState, batch?: UploadBatch | null): string;
export function isSavableDraft(draft: ClothesDraft): boolean;
export function isDraftSelectable(draft: ClothesDraft): boolean;
export function isProcessingDraft(draft: ClothesDraft): boolean;
export function getSavableDraftImage(draft: ClothesDraft): string;
export function normalizeUploadBatchStatus(status?: string): UploadBatchViewStatus;
