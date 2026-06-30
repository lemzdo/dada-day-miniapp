export function writeUploadTaskLocalCache<TBatch>(input: {
  authRuntimeKey: string;
  data: TBatch[];
  createdAt?: number;
  ttlMs?: number;
}): void;

export function getUploadTaskLocalCache<TBatch>(input?: {
  authRuntimeKey?: string;
  now?: number;
}): TBatch[] | null;

export function clearUploadTaskLocalCache(authRuntimeKey?: string): void;

export function removeUploadBatchFromLocalCache(input?: {
  authRuntimeKey?: string;
  batchId?: string;
  batchTerminal?: boolean;
}): void;

export function markUploadBatchTerminal(input?: {
  authRuntimeKey?: string;
  batchId?: string;
  status?: string;
}): void;

export function filterTerminalBatches<TBatch>(authRuntimeKey: string, batches: TBatch[]): TBatch[];

export function isUploadBatchLocallyTerminal(input?: {
  authRuntimeKey?: string;
  batchId?: string;
}): boolean;
