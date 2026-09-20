import Taro from '@tarojs/taro';
import type { OutfitRefV1, ResolvedWeatherResponse } from '@starter-template/types';
import {
  bootstrapProjectionStore,
  readLocalStorage,
  writeLocalStorage,
} from '@/lib/localStorage';
import {
  STORAGE_MIGRATION_VERSION,
  applyWriteValidateDelete,
  buildPostAuthMigrationPlan,
  buildPreAuthMigrationPlan,
} from './storageMigrationCore';
import { createUploadWorkflowEnvelope } from './uploadWorkflowCore';
import type { TodayBootstrapControl, TodayBootstrapEnvelope } from './todayBootstrapStore';
import { readTodayV2Snapshot, type TodayV2Snapshot } from '@/pages/today/todayV2Adapter';

const PRE_AUTH_META_ID = 'pre-auth';

export function runPreAuthStorageMigration() {
  const existing = bootstrapProjectionStore.readStorageMeta(PRE_AUTH_META_ID);
  if (existing?.completedVersion === STORAGE_MIGRATION_VERSION) return { status: 'already-complete' } as const;

  const plan = buildPreAuthMigrationPlan(getStorageKeys());
  const removed: string[] = [];
  plan.removeKeys.forEach((key) => {
    if (safeRemove(key)) removed.push(key);
  });
  bootstrapProjectionStore.writeStorageMeta({
    checkpoint: 'pre-auth-complete',
    completedVersion: STORAGE_MIGRATION_VERSION,
    updatedAt: new Date().toISOString(),
    sizeSummary: readStorageSizeSummary(),
  }, PRE_AUTH_META_ID);
  return { status: 'migrated', removed } as const;
}

export function runPostAuthStorageMigration(userScope: string) {
  const postAuthMetaId = buildPostAuthMetaId(userScope);
  const existing = bootstrapProjectionStore.readStorageMeta(postAuthMetaId);
  if (existing?.completedVersion === STORAGE_MIGRATION_VERSION) return { status: 'already-complete' } as const;

  const entries = getStorageKeys().map((key) => ({ key, value: safeRead(key) }));
  const plan = buildPostAuthMigrationPlan(entries, userScope);
  const currentUpload = readLocalStorage<ReturnType<typeof createUploadWorkflowEnvelope>>('uploadWorkflow:v2', {
    scope: userScope,
  })?.payload;
  const uploadEnvelope = createUploadWorkflowEnvelope([
    ...(currentUpload?.refs ?? []),
    ...plan.uploadRefs,
  ]);
  const currentToday = normalizeTodayBootstrap(
    bootstrapProjectionStore.readTodayBootstrap<unknown>({ scope: userScope }),
  );
  const migratedSnapshot = readTodayV2Snapshot(() => plan.todaySnapshot);
  const migratedControl = sanitizeTodayControl(plan.todayControl);
  const todayEnvelope = mergeTodayBootstrap(
    currentToday,
    migratedSnapshot,
    migratedControl,
    plan.outfitRefs,
  );
  const shouldWriteToday = migratedSnapshot !== null
    || Object.keys(migratedControl).length > 0
    || plan.outfitRefs.length > 0;
  const writes: Array<() => { ok: boolean }> = [];
  if (uploadEnvelope.refs.length > 0) {
    writes.push(() => writeLocalStorage('uploadWorkflow:v2', uploadEnvelope, { scope: userScope }));
  }
  if (shouldWriteToday) {
    writes.push(() => bootstrapProjectionStore.writeTodayBootstrap(todayEnvelope, { scope: userScope }));
  }

  const migration = applyWriteValidateDelete({
    writes,
    validate: () => {
      if (uploadEnvelope.refs.length > 0) {
        const persisted = readLocalStorage<ReturnType<typeof createUploadWorkflowEnvelope>>('uploadWorkflow:v2', {
          scope: userScope,
        })?.payload;
        const uploadValid = uploadEnvelope.refs.every((ref) => persisted?.refs.some((item) => item.batchId === ref.batchId));
        if (!uploadValid) return false;
      }
      if (!shouldWriteToday) return true;
      const persistedToday = normalizeTodayBootstrap(
        bootstrapProjectionStore.readTodayBootstrap<unknown>({ scope: userScope }),
      );
      return JSON.stringify(persistedToday) === JSON.stringify(todayEnvelope);
    },
    remove: (key) => { safeRemove(key); },
    removeKeys: plan.removeAfterValidation,
  });
  if (migration.status !== 'migrated') return migration;

  migrateLegacyWeather();
  removeDirectLegacyBootstrapKeys();
  bootstrapProjectionStore.writeStorageMeta({
    checkpoint: 'post-auth-complete',
    completedVersion: STORAGE_MIGRATION_VERSION,
    updatedAt: new Date().toISOString(),
    sizeSummary: readStorageSizeSummary(),
  }, postAuthMetaId);
  return { status: 'migrated', removed: migration.removed, outfitRefs: plan.outfitRefs } as const;
}

function normalizeTodayBootstrap(value: unknown): TodayBootstrapEnvelope<TodayV2Snapshot> {
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.schemaVersion === 2 && record.control && typeof record.control === 'object') {
      return value as TodayBootstrapEnvelope<TodayV2Snapshot>;
    }
    const snapshot = readTodayV2Snapshot(() => value);
    if (snapshot) return { schemaVersion: 2, snapshot, control: {} };
  }
  return { schemaVersion: 2, control: {} };
}

function sanitizeTodayControl(value: Record<string, unknown>): Partial<TodayBootstrapControl> {
  const next: Partial<TodayBootstrapControl> = {};
  if (value.recommendationContext && typeof value.recommendationContext === 'object') {
    next.recommendationContext = value.recommendationContext;
  }
  if (typeof value.latestIdentity === 'string' && value.latestIdentity.trim()) {
    next.latestIdentity = value.latestIdentity.trim();
  }
  if (typeof value.wardrobeVersion === 'number'
    && Number.isFinite(value.wardrobeVersion)
    && value.wardrobeVersion >= 0) {
    next.wardrobeVersion = value.wardrobeVersion;
  }
  if (typeof value.profileVersion === 'number'
    && Number.isFinite(value.profileVersion)
    && value.profileVersion >= 0) {
    next.profileVersion = value.profileVersion;
  }
  if (value.hardInvalid && typeof value.hardInvalid === 'object') {
    next.hardInvalid = value.hardInvalid;
  }
  return next;
}

function mergeTodayBootstrap(
  current: TodayBootstrapEnvelope<TodayV2Snapshot>,
  snapshot: TodayV2Snapshot | null,
  control: Partial<TodayBootstrapControl>,
  refs: OutfitRefV1[],
): TodayBootstrapEnvelope<TodayV2Snapshot> {
  const legacyOutfitRefs = dedupeOutfitRefs([
    ...(current.control.legacyOutfitRefs ?? []),
    ...refs,
  ]).slice(0, 16);
  return {
    schemaVersion: 2,
    ...(snapshot ? { snapshot } : current.snapshot ? { snapshot: current.snapshot } : {}),
    control: {
      ...current.control,
      ...control,
      ...(legacyOutfitRefs.length > 0 ? { legacyOutfitRefs } : {}),
    },
  };
}

function dedupeOutfitRefs(refs: OutfitRefV1[]) {
  const map = new Map<string, OutfitRefV1>();
  refs.forEach((ref) => {
    const identity = [
      ref.source,
      ref.outfitKey,
      ref.outfitId,
      ref.favoriteId,
      ref.historyId,
      ref.batchId,
      ref.referenceId,
    ].filter(Boolean).join('|');
    if (identity) map.set(identity, ref);
  });
  return [...map.values()];
}

function buildPostAuthMetaId(userScope: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < userScope.length; index += 1) {
    hash ^= userScope.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `post-auth-${(hash >>> 0).toString(36)}`;
}

function migrateLegacyWeather() {
  if (bootstrapProjectionStore.readWeatherLastKnown({ allowStale: true })) return;
  const legacy = safeRead('d1d:lastWeather') as ResolvedWeatherResponse | null;
  if (legacy && typeof legacy === 'object' && legacy.weather?.weather) {
    const result = bootstrapProjectionStore.writeWeatherLastKnown(legacy);
    if (!result.ok) return;
  }
  safeRemove('d1d:lastWeather');
}

function removeDirectLegacyBootstrapKeys() {
  if (bootstrapProjectionStore.readAuthResume()) {
    safeRemove('userId');
    safeRemove('openid');
  }
  if (bootstrapProjectionStore.readProfileBootstrap()) safeRemove('userProfileCache:v1');
}

function getStorageKeys(): string[] {
  try {
    return Taro.getStorageInfoSync().keys ?? [];
  } catch {
    return [];
  }
}

function safeRead(key: string): unknown {
  try { return Taro.getStorageSync(key) as unknown; } catch { return null; }
}

function safeRemove(key: string): boolean {
  try {
    Taro.removeStorageSync(key);
    return true;
  } catch (error) {
    console.warn('[storageMigration] remove failed', { key, error });
    return false;
  }
}

function readStorageSizeSummary() {
  try {
    const info = Taro.getStorageInfoSync();
    return { currentSizeKiB: info.currentSize, limitSizeKiB: info.limitSize };
  } catch {
    return {};
  }
}
