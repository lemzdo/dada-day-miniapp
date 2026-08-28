export type MediaPrewarmAssetResolver<T> = (garment: T) => string;
export type MediaPrewarmLoader = (source: string) => Promise<boolean> | boolean;
export function prewarmResolvedGarments<T>(
  garments: T[],
  resolveAsset: MediaPrewarmAssetResolver<T>,
  preload: MediaPrewarmLoader,
): Promise<{ requested: number; warmed: number }>;
