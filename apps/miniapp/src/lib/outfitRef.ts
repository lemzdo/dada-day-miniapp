import type { HomeLightCardV2, Outfit, OutfitRefV1 } from '@starter-template/types';

type RouteParams = Record<string, string | undefined>;

export function createRecommendationOutfitRef(
  batchId: string,
  card: Pick<HomeLightCardV2, 'outfitKey' | 'referenceId'>,
): OutfitRefV1 | null {
  const outfitKey = normalizeId(card.outfitKey);
  const referenceId = normalizeId(card.referenceId);
  const normalizedBatchId = normalizeId(batchId);
  if (!outfitKey || !referenceId || !normalizedBatchId) return null;
  return {
    schemaVersion: 1,
    source: 'recommendation',
    outfitKey,
    batchId: normalizedBatchId,
    referenceId,
  };
}

export function createOutfitRef(
  outfit: Outfit,
  source: OutfitRefV1['source'],
): OutfitRefV1 | null {
  const relationId = normalizeId(outfit.id);
  const outfitId = normalizeId(outfit.outfitId);
  const outfitKey = normalizeId(outfit.outfitKey) || outfitId || relationId;
  if (!outfitKey) return null;

  if (source === 'history') {
    const historyId = normalizeId(outfit.historyId) || relationId;
    if (!historyId) return null;
    return {
      schemaVersion: 1,
      source,
      outfitKey,
      historyId,
      ...(outfitId ? { outfitId } : {}),
    };
  }

  if (source === 'favorite') {
    const favoriteId = normalizeId(outfit.favoriteOutfitId) || relationId;
    if (!favoriteId) return null;
    return {
      schemaVersion: 1,
      source,
      outfitKey,
      favoriteId,
      ...(outfitId ? { outfitId } : {}),
    };
  }

  const canonicalOutfitId = outfitId || relationId;
  if (!canonicalOutfitId) return null;
  return {
    schemaVersion: 1,
    source,
    outfitKey,
    outfitId: canonicalOutfitId,
  };
}

export function buildOutfitDetailUrl(ref: OutfitRefV1): string {
  const params: Array<[string, string | number | undefined]> = [
    ['refVersion', ref.schemaVersion],
    ['source', ref.source],
    ['outfitKey', ref.outfitKey],
    ['compositionKeyVersion', ref.compositionKeyVersion],
    ['outfitId', ref.outfitId],
    ['outfitRevisionId', ref.outfitRevisionId],
    ['batchId', ref.batchId],
    ['referenceId', ref.referenceId],
    ['favoriteId', ref.favoriteId],
    ['historyId', ref.historyId],
  ];
  const query = params
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== '')
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join('&');
  return `/pages/outfit-detail/index?${query}`;
}

export function readOutfitRefFromRoute(params: RouteParams): OutfitRefV1 | null {
  if (params.refVersion !== '1') return null;
  const source = normalizeSource(params.source);
  const outfitKey = decodeRouteValue(params.outfitKey);
  if (!source || !outfitKey) return null;

  const ref: OutfitRefV1 = {
    schemaVersion: 1,
    source,
    outfitKey,
    ...optionalField('compositionKeyVersion', params.compositionKeyVersion),
    ...optionalField('outfitId', params.outfitId),
    ...optionalField('outfitRevisionId', params.outfitRevisionId),
    ...optionalField('batchId', params.batchId),
    ...optionalField('referenceId', params.referenceId),
    ...optionalField('favoriteId', params.favoriteId),
    ...optionalField('historyId', params.historyId),
  };
  return isResolvableOutfitRef(ref) ? ref : null;
}

export function isResolvableOutfitRef(ref: OutfitRefV1): boolean {
  if (!normalizeId(ref.outfitKey)) return false;
  if (ref.source === 'recommendation') {
    return Boolean(normalizeId(ref.batchId) && normalizeId(ref.referenceId));
  }
  if (ref.source === 'favorite') return Boolean(normalizeId(ref.favoriteId));
  if (ref.source === 'history') return Boolean(normalizeId(ref.historyId));
  return Boolean(normalizeId(ref.outfitId));
}

export function getOutfitRefIdentity(ref: OutfitRefV1): string {
  const sourceId = ref.source === 'recommendation'
    ? `${ref.batchId ?? ''}:${ref.referenceId ?? ''}`
    : ref.source === 'favorite'
      ? ref.favoriteId ?? ''
      : ref.source === 'history'
        ? ref.historyId ?? ''
        : ref.outfitId ?? '';
  return `outfit-ref-v1:${ref.source}:${sourceId}:${ref.outfitKey}`;
}

export function getOutfitRefResolverId(ref: OutfitRefV1): string | null {
  if (ref.source === 'favorite') return normalizeId(ref.favoriteId);
  if (ref.source === 'history') return normalizeId(ref.historyId);
  return normalizeId(ref.outfitId);
}

function optionalField<Key extends keyof OutfitRefV1>(key: Key, value: string | undefined): Partial<OutfitRefV1> {
  const decoded = decodeRouteValue(value);
  return decoded ? { [key]: decoded } as Partial<OutfitRefV1> : {};
}

function decodeRouteValue(value: string | undefined): string {
  if (!value) return '';
  try {
    return normalizeId(decodeURIComponent(value));
  } catch {
    return '';
  }
}

function normalizeId(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSource(value: string | undefined): OutfitRefV1['source'] | null {
  return value === 'recommendation' || value === 'outfit' || value === 'favorite' || value === 'history'
    ? value
    : null;
}
