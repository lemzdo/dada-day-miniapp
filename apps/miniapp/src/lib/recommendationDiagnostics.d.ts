export const CLIENT_RECOMMEND_LOG_MAX_BYTES: number;

export interface RecommendationLogPayload {
  auditId: string;
  [key: string]: unknown;
}

export function createRecommendationAuditId(seed?: string | number): string;
export function isRecommendationLifecycleLoggingEnabled(envVersion?: string): boolean;
export function serializedLogBytes(label: string, payload: RecommendationLogPayload): number;
export function logRecommendationEvent(
  label:
    | '[RecommendStart]'
    | '[RecommendResponse]'
    | '[RecommendDone]'
    | '[RecommendReject]'
    | '[RecommendError]'
    | '[RecommendationQA]'
    | '[RecommendationImagePerf]',
  payload: RecommendationLogPayload,
  logger?: Pick<Console, 'log' | 'info' | 'warn' | 'error'>,
): { label: string; payload: RecommendationLogPayload; bytes: number } | null;
export function buildRecommendationQaLogSummary(audit: unknown): RecommendationLogPayload | null;
