export type RecommendationVisibleTimingFailureReason =
  | 'CONTENT_SELECTOR_EMPTY'
  | 'CONTENT_IDENTITY_MISMATCH'
  | 'CONTENT_ZERO_SIZE'
  | 'IMAGE_ONLOAD_NOT_FIRED'
  | 'IMAGE_SELECTOR_EMPTY'
  | 'IMAGE_ZERO_SIZE'
  | 'STALE_SEQ'
  | 'STALE_BATCH'
  | 'MISSING_AUDIT_ID';

export interface RecommendationVisibleTimingIdentity {
  batchId: string;
  outfitKey: string;
}

export interface RecommendationVisibleTimingSnapshot {
  auditId: string;
  seq: number;
  sceneKey: string;
  trigger?: string;
  batchId?: string;
  outfitKey?: string;
  requestStart: number;
  clientResponseReceivedMs?: number;
  stateCommitMs?: number;
  contentVisibleMs?: number;
  imageLoadMs?: number;
  imageVisibleMs?: number;
  complete: boolean;
}

export interface RecommendationVisibleTimingRecorder {
  create(input: { auditId: string; seq: number; sceneKey: string; trigger?: string; requestStart: number }): unknown;
  response(input: RecommendationVisibleTimingIdentity & { auditId: string; at?: number }): boolean;
  commit(identity: RecommendationVisibleTimingIdentity, at?: number): boolean;
  content(identity: RecommendationVisibleTimingIdentity, at?: number): boolean;
  imageLoad(identity: RecommendationVisibleTimingIdentity, at?: number): boolean;
  imageVisible(identity: RecommendationVisibleTimingIdentity, at?: number): boolean;
  reportFailure(
    identity: Partial<RecommendationVisibleTimingIdentity> & { auditId?: string },
    stage: string,
    reason: RecommendationVisibleTimingFailureReason,
    fields?: Record<string, unknown>,
  ): false;
  getByBatch(batchId: string): unknown | null;
  read(): RecommendationVisibleTimingSnapshot[];
  reset(): void;
}

export const FAILURE_REASONS: Readonly<Record<RecommendationVisibleTimingFailureReason, RecommendationVisibleTimingFailureReason>>;

export function classifyVisibleNode(input: {
  stage: 'content' | 'image';
  node: { width?: number; height?: number; dataset?: Record<string, unknown> } | null;
  expected: RecommendationVisibleTimingIdentity;
  current?: Partial<RecommendationVisibleTimingIdentity> | null;
}): { ok: true } | { ok: false; reason: RecommendationVisibleTimingFailureReason };

export function createRecommendationVisibleTimingRecorder(options?: {
  now?: () => number;
  emit?: (label: string, payload: RecommendationVisibleTimingSnapshot & Record<string, unknown>) => void;
  schedule?: (callback: () => void, delay: number) => unknown;
  cancel?: (handle: unknown) => void;
  imageLoadTimeoutMs?: number;
  maxHistory?: number;
}): RecommendationVisibleTimingRecorder;
