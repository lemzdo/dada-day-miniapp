export type UploadWorkflowPhase = 'created' | 'uploading' | 'processing' | 'confirming';

export interface UploadWorkflowRefV2 {
  batchId: string;
  cloudImageIds: string[];
  phase: UploadWorkflowPhase;
  createdAt: number;
  updatedAt: number;
  needsServerVerification: boolean;
}

export interface UploadWorkflowEnvelopeV2 {
  schemaVersion: 2;
  refs: UploadWorkflowRefV2[];
}

export const UPLOAD_WORKFLOW_SCHEMA_VERSION: 2;
export const MAX_UPLOAD_WORKFLOW_REFS: 10;
export const MAX_IMAGE_REFS_PER_BATCH: 9;
export const UPLOAD_WORKFLOW_ORPHAN_AGE_MS: number;
export const TERMINAL_UPLOAD_STATUSES: Set<string>;

export function createUploadWorkflowEnvelope(refs?: unknown[]): UploadWorkflowEnvelopeV2;
export function upsertUploadWorkflowRef(
  envelope: UploadWorkflowEnvelopeV2 | null | undefined,
  input: Partial<UploadWorkflowRefV2> & { batchId: string; replaceCloudImageIds?: boolean },
  now?: number,
): { status: 'updated' | 'full' | 'invalid'; envelope: UploadWorkflowEnvelopeV2 };
export function removeUploadWorkflowRef(
  envelope: UploadWorkflowEnvelopeV2 | null | undefined,
  batchId: string,
): UploadWorkflowEnvelopeV2;
export function markUploadWorkflowTerminal(
  envelope: UploadWorkflowEnvelopeV2 | null | undefined,
  batchId: string,
  status: string,
): UploadWorkflowEnvelopeV2;
export function reconcileUploadWorkflowRefs(
  envelope: UploadWorkflowEnvelopeV2 | null | undefined,
  options?: {
    cloudAvailable?: boolean;
    now?: number;
    serverBatches?: Array<{ id?: string; _id?: string; status?: string }>;
  },
): { envelope: UploadWorkflowEnvelopeV2; removedBatchIds: string[]; retainedBatchIds: string[] };
