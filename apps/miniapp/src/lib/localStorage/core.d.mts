export interface StorageAdapter {
  keys(): string[];
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  remove(key: string): void;
  sizeBytes?(): number;
}

export interface StorageNamespaceContract {
  enabled: boolean;
  owner: string;
  classification: string;
  sourceOfTruth: string;
  crossSessionNeed: string;
  recomputable: boolean;
  ttlMs: number | null;
  staleIfErrorMs?: number;
  maxEntries: number;
  maxBytes: number;
  evictable: boolean;
  evictionPolicy: 'PROTECTED' | 'EXPIRE_THEN_LRU' | 'FIFO_ACKED' | 'TERMINAL_DELETE';
  migrationVersion: number;
}

export type StorageRegistry = Record<string, StorageNamespaceContract>;

export interface StorageWriteSuccess {
  ok: true;
  status: 'persisted';
  attempts: number;
  bytes: number;
}

export interface StorageWriteFailure {
  ok: false;
  status: 'rejected-unregistered' | 'persistence-error' | 'cache-skipped';
  reason: string;
  attempts: number;
  bytes: number;
  recoverability: 'memory-only' | 'recomputable';
}

export type StorageWriteResult = StorageWriteSuccess | StorageWriteFailure;

export interface StorageReadResult<T = unknown> {
  payload: T;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
}

export function utf8ByteLength(value: unknown): number;
export function serializedByteSize(value: unknown): number;
export function isQuotaError(error: unknown): boolean;
export function executeWriteWithQuotaRetry(options: {
  write: () => void;
  cleanup: () => void;
  quotaMatcher?: (error: unknown) => boolean;
}): { ok: true; attempts: number } | { ok: false; attempts: number; error: unknown; quota: boolean };

export function createStorageCore(options: {
  registry: StorageRegistry;
  adapter: StorageAdapter;
  onDiagnostic?: (event: { event: string; namespace: string; detail: unknown; at: number }) => void;
  now?: () => number;
  keyPrefix?: string;
  highWaterBytes?: number;
  softLimitBytes?: number;
}): {
  write(namespace: string, payload: unknown, options?: { scope?: string; entryId?: string; now?: number }): StorageWriteResult;
  read<T = unknown>(namespace: string, options?: { scope?: string; entryId?: string; now?: number }): StorageReadResult<T> | null;
  remove(namespace: string, options?: { scope?: string; entryId?: string }): boolean;
  cleanup(options?: { now?: number; aggressive?: boolean }): { removed: number; bytes: number };
};
