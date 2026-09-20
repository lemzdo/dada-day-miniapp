import { bootstrapProjectionStore } from './localStorage';
import type { ActiveAuthContext } from '@/stores/userStore';
import type { OutfitRefV1 } from '@starter-template/types';

export interface TodayBootstrapControl {
  recommendationContext?: unknown;
  latestIdentity?: string;
  wardrobeVersion?: number;
  profileVersion?: number;
  hardInvalid?: unknown;
  legacyOutfitRefs?: OutfitRefV1[];
}

export interface TodayBootstrapEnvelope<TSnapshot = unknown> {
  schemaVersion: 2;
  snapshot?: TSnapshot;
  control: TodayBootstrapControl;
}

export function readTodayBootstrapEnvelope<TSnapshot>(
  authContext: ActiveAuthContext,
): TodayBootstrapEnvelope<TSnapshot> {
  const value = bootstrapProjectionStore.readTodayBootstrap<unknown>({ scope: authContext.userScope });
  if (isEnvelope(value)) return value as TodayBootstrapEnvelope<TSnapshot>;
  // Compatibility with the first PB-04 implementation and pre-migration V2
  // light snapshots: wrap them without creating a second persisted copy.
  if (value && typeof value === 'object') {
    return { schemaVersion: 2, snapshot: value as TSnapshot, control: {} };
  }
  return { schemaVersion: 2, control: {} };
}

export function readTodayBootstrapSnapshot<TSnapshot>(authContext: ActiveAuthContext) {
  return readTodayBootstrapEnvelope<TSnapshot>(authContext).snapshot ?? null;
}

export function writeTodayBootstrapSnapshot<TSnapshot>(
  authContext: ActiveAuthContext,
  snapshot: TSnapshot | null,
) {
  const current = readTodayBootstrapEnvelope<TSnapshot>(authContext);
  const next: TodayBootstrapEnvelope<TSnapshot> = {
    ...current,
    ...(snapshot === null ? {} : { snapshot }),
    control: current.control,
  };
  if (snapshot === null) delete next.snapshot;
  return bootstrapProjectionStore.writeTodayBootstrap(next, { scope: authContext.userScope });
}

export function patchTodayBootstrapControl(
  authContext: ActiveAuthContext,
  patch: Partial<TodayBootstrapControl>,
) {
  const current = readTodayBootstrapEnvelope(authContext);
  const control = { ...current.control, ...patch };
  for (const key of Object.keys(control) as Array<keyof TodayBootstrapControl>) {
    if (control[key] === undefined || control[key] === null) delete control[key];
  }
  return bootstrapProjectionStore.writeTodayBootstrap({
    ...current,
    control,
  }, { scope: authContext.userScope });
}

function isEnvelope(value: unknown): value is TodayBootstrapEnvelope {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 2
    && Boolean(record.control)
    && typeof record.control === 'object'
    && !Array.isArray(record.control);
}
