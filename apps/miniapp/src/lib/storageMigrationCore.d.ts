import type { OutfitRefV1 } from '@starter-template/types';
import type { UploadWorkflowRefV2 } from './uploadWorkflowCore';

export const STORAGE_MIGRATION_VERSION: 4;
export const LEGACY_PAGE_CACHE_PREFIX: string;
export const LEGACY_USER_STORAGE_PREFIX: string;
export const LEGACY_DIAGNOSTIC_KEYS: Set<string>;
export const LEGACY_DIRECT_KEYS: Set<string>;

export function buildPreAuthMigrationPlan(keys: string[]): {
  migrationVersion: 4;
  removeKeys: string[];
};
export function buildPostAuthMigrationPlan(
  entries: Array<{ key: string; value: unknown }>,
  userScope: string,
): {
  migrationVersion: 4;
  uploadRefs: UploadWorkflowRefV2[];
  outfitRefs: OutfitRefV1[];
  todaySnapshot: unknown;
  todayControl: Record<string, unknown>;
  removeAfterValidation: string[];
};
export function extractOutfitRef(value: unknown): OutfitRefV1 | null;
export function applyWriteValidateDelete(input: {
  writes: Array<() => { ok: boolean }>;
  validate?: () => boolean;
  remove: (key: string) => void;
  removeKeys: string[];
}): {
  status: 'write-failed' | 'validation-failed' | 'migrated';
  writeResults: Array<{ ok: boolean }>;
  removed: string[];
};
