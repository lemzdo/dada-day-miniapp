import { resolveGarmentAsset as resolveCanonicalGarmentAsset } from '@d1d/garment-assets';
import { preloadImageSession } from './imageSessionCache';

export type GarmentAssetUsage = 'LIST' | 'CARD' | 'DETAIL' | 'SNAPSHOT';
export type GarmentAssetCompatProfile = 'TODAY_CARD' | 'SAVED_CARD' | 'DETAIL_THUMBNAIL' | 'DETAIL_DISPLAY';

type UnknownGarment = Record<string, unknown>;

function legacySource(garment: UnknownGarment, usage: GarmentAssetUsage, profile?: GarmentAssetCompatProfile): string {
  const candidates = profile === 'TODAY_CARD'
    ? [garment.displayImageUrl, garment.thumbnailUrl, garment.imageUrl, garment.originalImageUrl]
    : profile === 'SAVED_CARD'
      ? [garment.thumbnailUrl, garment.imageUrl, garment.displayImageUrl, garment.originalImageUrl]
      : profile === 'DETAIL_THUMBNAIL'
        ? [garment.thumbnailUrl, garment.displayImageUrl, garment.imageUrl, garment.originalImageUrl]
        : profile === 'DETAIL_DISPLAY'
          ? [garment.displayImageUrl, garment.imageUrl, garment.thumbnailUrl, garment.originalImageUrl]
          : usage === 'DETAIL'
            ? [garment.displayImageUrl, garment.imageUrl, garment.thumbnailUrl, garment.originalImageUrl]
            : [garment.thumbnailUrl, garment.displayImageUrl, garment.imageUrl, garment.originalImageUrl];
  return candidates.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim() || '';
}

function extractAssetUrl(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  const source = value as Record<string, unknown>;
  for (const key of ['url', 'src', 'displayUrl', 'assetUrl', 'displayImageUrl']) {
    if (typeof source[key] === 'string' && source[key].trim()) return source[key].trim();
  }
  if (source.asset && typeof source.asset === 'object') return extractAssetUrl(source.asset);
  return '';
}

/** Single client boundary for canonical garment asset resolution.
 * The package owns priority; the legacy fallback keeps old DTOs renderable.
 */
export function resolveGarmentAsset(
  garment: UnknownGarment | null | undefined,
  usage: GarmentAssetUsage,
  options: { compatProfile?: GarmentAssetCompatProfile } = {},
): string {
  if (!garment) return '';
  try {
    const resolved = (resolveCanonicalGarmentAsset as unknown as (input: UnknownGarment, use: GarmentAssetUsage, opts?: { compatProfile?: GarmentAssetCompatProfile; compatPolicy: 'compat' }) => unknown)(garment, usage, {
      compatProfile: options.compatProfile,
      compatPolicy: 'compat',
    });
    return extractAssetUrl(resolved) || legacySource(garment, usage, options.compatProfile);
  } catch {
    return legacySource(garment, usage, options.compatProfile);
  }
}

/** Callable prewarm boundary for future P3 integration. Intentionally opt-in. */
export async function prewarmGarmentAssets(
  garments: Array<UnknownGarment | null | undefined>,
  usage: GarmentAssetUsage = 'CARD',
): Promise<{ requested: number; warmed: number }> {
  const sources = garments.map((garment) => resolveGarmentAsset(garment, usage)).filter(Boolean);
  const results = await Promise.all(sources.map((source) => preloadImageSession(source)));
  return { requested: sources.length, warmed: results.filter(Boolean).length };
}

export const MEDIA_PREWARM_NEXT = true as const;
export const THUMBNAIL_PIPELINE_NEXT = true as const;
