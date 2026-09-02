export type RuntimeObservabilitySchemaVersion = 'first-card-runtime-observability/v1';
export type RuntimeFailureStage = 'admission' | 'ai_core' | 'credentials' | 'request' | 'http_response' | 'stream_read' | 'output_parse' | 'validation' | 'persistence' | 'runtime' | 'unknown';
export type RuntimeFailureCode = 'ADMISSION_FAILED' | 'AI_CORE_UNAVAILABLE' | 'CREDENTIALS_UNAVAILABLE' | 'REQUEST_FAILED' | 'PROVIDER_HTTP_ERROR' | 'PROVIDER_STREAM_ERROR' | 'NETWORK_ERROR' | 'PROVIDER_TIMEOUT' | 'REQUEST_ABORTED' | 'STREAM_READ_FAILED' | 'OUTPUT_INCOMPLETE' | 'OUTPUT_PARSE_FAILED' | 'VALIDATION_REJECTED' | 'PERSISTENCE_FAILED' | 'RUNTIME_FAILED' | 'UNKNOWN_FAILURE';
export type RuntimeFailureTriState = 'yes' | 'no' | 'unknown';
export type RuntimeRetryability = 'retryable' | 'not_retryable' | 'unknown';
export type RuntimeDeadlineSource = 'provider_timeout' | 'renderer_timeout' | 'unknown' | null;

export interface RuntimeFailureEnvelope {
  schemaVersion: RuntimeObservabilitySchemaVersion;
  failureId: string;
  auditId: string;
  attemptId: string | null;
  batchId: string | null;
  stage: RuntimeFailureStage;
  code: RuntimeFailureCode;
  retryability: RuntimeRetryability;
  providerIssue: RuntimeFailureTriState;
  businessRejected: RuntimeFailureTriState;
  deadline: { causedFailure: RuntimeFailureTriState; source: RuntimeDeadlineSource };
  provider: { name: string | null; model: string | null; httpStatus: number | null; requestId: string | null; errorCode: string | null };
  evidence: { exceptionType: string | null; networkCode: string | null; validatorCodes: string[] };
  elapsedFromHandlerMs: number | null;
}
export type FirstCardFailureEnvelopeV1 = RuntimeFailureEnvelope;
