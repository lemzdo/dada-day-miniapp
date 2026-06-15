import { buildAuthRuntimeKey } from '@/lib/userRuntimeScope';
import {
  getActiveAuthContext,
  isAuthContextCurrent,
  type ActiveAuthContext,
} from '@/stores/userStore';

export interface OutfitStatusPatch {
  outfitKey: string;
  isFavorite?: boolean;
  favoriteOutfitId?: string;
  isWornToday?: boolean;
  todayHistoryId?: string;
  wornAt?: string;
  wornDate?: string;
  userTitle?: string;
  displayTitle?: string;
  title?: string;
  updatedAt?: number;
}

type OutfitStatusValueKey = Exclude<keyof OutfitStatusPatch, 'outfitKey' | 'updatedAt'>;

const OUTFIT_STATUS_VALUE_KEYS: OutfitStatusValueKey[] = [
  'isFavorite',
  'favoriteOutfitId',
  'isWornToday',
  'todayHistoryId',
  'wornAt',
  'wornDate',
  'userTitle',
  'displayTitle',
  'title',
];

const outfitStatusMap = new Map<string, OutfitStatusPatch>();
let currentOutfitStatusRuntimeKey: string | null = null;

export function setOutfitStatus(patch: OutfitStatusPatch, authContext?: ActiveAuthContext | null): void {
  if (!resolveOutfitStatusRuntimeKey(authContext)) return;

  const nextUpdatedAt = patch.updatedAt ?? Date.now();
  const current = outfitStatusMap.get(patch.outfitKey);

  if (current?.updatedAt !== undefined && nextUpdatedAt < current.updatedAt) {
    return;
  }

  const next: OutfitStatusPatch = {
    ...(current ?? { outfitKey: patch.outfitKey }),
    outfitKey: patch.outfitKey,
    updatedAt: nextUpdatedAt,
  };

  for (const key of OUTFIT_STATUS_VALUE_KEYS) {
    assignDefinedField(next, patch, key);
  }

  outfitStatusMap.set(patch.outfitKey, next);
}

export function setOutfitStatuses(patches: OutfitStatusPatch[], authContext?: ActiveAuthContext | null): void {
  if (!resolveOutfitStatusRuntimeKey(authContext)) return;
  patches.forEach((patch) => setOutfitStatus(patch, authContext));
}

export function getOutfitStatus(outfitKey: string, authContext?: ActiveAuthContext | null): OutfitStatusPatch | undefined {
  if (!resolveOutfitStatusRuntimeKey(authContext)) return undefined;

  const patch = outfitStatusMap.get(outfitKey);
  return patch ? { ...patch } : undefined;
}

export function applyOutfitStatus<T extends { outfitKey?: string }>(
  outfit: T,
  authContext?: ActiveAuthContext | null,
): T {
  if (!resolveOutfitStatusRuntimeKey(authContext)) return outfit;
  if (!outfit.outfitKey) return outfit;

  const patch = outfitStatusMap.get(outfit.outfitKey);
  if (!patch) return outfit;

  const next: T & Partial<OutfitStatusPatch> = { ...outfit };
  for (const key of OUTFIT_STATUS_VALUE_KEYS) {
    assignDefinedField(next, patch, key);
  }

  return next;
}

export function applyOutfitStatuses<T extends { outfitKey?: string }>(
  outfits: T[],
  authContext?: ActiveAuthContext | null,
): T[] {
  if (!resolveOutfitStatusRuntimeKey(authContext)) return outfits;
  return outfits.map((outfit) => applyOutfitStatus(outfit, authContext));
}

export function clearOutfitStatus(outfitKey: string, authContext?: ActiveAuthContext | null): void {
  if (!resolveOutfitStatusRuntimeKey(authContext)) return;
  outfitStatusMap.delete(outfitKey);
}

export function clearAllOutfitStatuses(): void {
  outfitStatusMap.clear();
}

function assignDefinedField(
  target: Partial<OutfitStatusPatch>,
  source: OutfitStatusPatch,
  key: OutfitStatusValueKey,
): void {
  switch (key) {
    case 'isFavorite':
      if (source.isFavorite !== undefined) target.isFavorite = source.isFavorite;
      break;
    case 'favoriteOutfitId':
      if (source.favoriteOutfitId !== undefined) target.favoriteOutfitId = source.favoriteOutfitId;
      break;
    case 'isWornToday':
      if (source.isWornToday !== undefined) target.isWornToday = source.isWornToday;
      break;
    case 'todayHistoryId':
      if (source.todayHistoryId !== undefined) target.todayHistoryId = source.todayHistoryId;
      break;
    case 'wornAt':
      if (source.wornAt !== undefined) target.wornAt = source.wornAt;
      break;
    case 'wornDate':
      if (source.wornDate !== undefined) target.wornDate = source.wornDate;
      break;
    case 'userTitle':
      if (source.userTitle !== undefined) target.userTitle = source.userTitle;
      break;
    case 'displayTitle':
      if (source.displayTitle !== undefined) target.displayTitle = source.displayTitle;
      break;
    case 'title':
      if (source.title !== undefined) target.title = source.title;
      break;
  }
}

function resolveOutfitStatusRuntimeKey(authContext?: ActiveAuthContext | null): string | null {
  if (authContext !== undefined) {
    if (!authContext || !isAuthContextCurrent(authContext)) return null;
    return syncOutfitStatusRuntimeKey(buildAuthRuntimeKey(authContext));
  }

  const activeAuthContext = getActiveAuthContext();
  if (!activeAuthContext) return null;
  return syncOutfitStatusRuntimeKey(buildAuthRuntimeKey(activeAuthContext));
}

function syncOutfitStatusRuntimeKey(runtimeKey: string) {
  if (currentOutfitStatusRuntimeKey !== runtimeKey) {
    outfitStatusMap.clear();
    currentOutfitStatusRuntimeKey = runtimeKey;
  }

  return runtimeKey;
}
