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

export function setOutfitStatus(patch: OutfitStatusPatch): void {
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

export function setOutfitStatuses(patches: OutfitStatusPatch[]): void {
  patches.forEach(setOutfitStatus);
}

export function getOutfitStatus(outfitKey: string): OutfitStatusPatch | undefined {
  const patch = outfitStatusMap.get(outfitKey);
  return patch ? { ...patch } : undefined;
}

export function applyOutfitStatus<T extends { outfitKey?: string }>(outfit: T): T {
  if (!outfit.outfitKey) return outfit;

  const patch = outfitStatusMap.get(outfit.outfitKey);
  if (!patch) return outfit;

  const next: T & Partial<OutfitStatusPatch> = { ...outfit };
  for (const key of OUTFIT_STATUS_VALUE_KEYS) {
    assignDefinedField(next, patch, key);
  }

  return next;
}

export function applyOutfitStatuses<T extends { outfitKey?: string }>(outfits: T[]): T[] {
  return outfits.map(applyOutfitStatus);
}

export function clearOutfitStatus(outfitKey: string): void {
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
