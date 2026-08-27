export declare const CanonicalAssetKind: { readonly ORIGINAL: 'ORIGINAL'; readonly CROP: 'CROP'; readonly CLEAN: 'CLEAN'; readonly NORMALIZED: 'NORMALIZED'; readonly DISPLAY: 'DISPLAY'; readonly THUMBNAIL: 'THUMBNAIL' };
export type CanonicalAssetKind = (typeof CanonicalAssetKind)[keyof typeof CanonicalAssetKind];
export declare const AssetUsage: { readonly LIST: 'LIST'; readonly CARD: 'CARD'; readonly DETAIL: 'DETAIL'; readonly SNAPSHOT: 'SNAPSHOT' };
export type AssetUsage = (typeof AssetUsage)[keyof typeof AssetUsage];
export declare const AssetQualityStatus: { readonly VALID: 'VALID'; readonly NEEDS_REVIEW: 'NEEDS_REVIEW'; readonly INVALID: 'INVALID' };
export type AssetQualityStatus = (typeof AssetQualityStatus)[keyof typeof AssetQualityStatus];
export declare const CompatProfile: { readonly TODAY_CARD: 'TODAY_CARD'; readonly SAVED_CARD: 'SAVED_CARD'; readonly DETAIL_THUMBNAIL: 'DETAIL_THUMBNAIL'; readonly DETAIL_DISPLAY: 'DETAIL_DISPLAY' };
export type CompatProfile = (typeof CompatProfile)[keyof typeof CompatProfile];
export interface GarmentLike { [key: string]: unknown; imageUrl?: string; cropImageUrl?: string; croppedImageUrl?: string; aiSegmentImageUrl?: string; displayImageUrl?: string; thumbnailUrl?: string; originalImageUrl?: string; cleanImageUrl?: string; normalizedImageUrl?: string; cloudFileId?: string; assetVersion?: string; qualityScore?: number; needsUserConfirm?: boolean; needsReview?: boolean; assetStatus?: string; qualityStatus?: AssetQualityStatus | string; }
export interface GarmentAssetReference { kind: CanonicalAssetKind; url?: string; field?: string; usage?: AssetUsage; policy?: string; isFact?: boolean; isTemporary?: boolean; factReference?: string; qualityStatus?: AssetQualityStatus; }
export interface GarmentAssetSnapshot { imageUrl: string; displayImageUrl: string; thumbnailUrl: string; originalImageUrl?: string; originalAssetRef?: string; factReference?: string; assetVersion: string; qualityStatus: AssetQualityStatus; assets: Record<CanonicalAssetKind, GarmentAssetReference | undefined>; }
export declare function adaptLegacyGarmentAssets<T extends GarmentLike>(garment: T): T & { assets: Record<CanonicalAssetKind, GarmentAssetReference | undefined>; factReference?: string; originalAssetRef?: string; qualityStatus: AssetQualityStatus; assetVersion: string };
export declare function resolveGarmentAsset(garment: GarmentLike, usage: AssetUsage, options?: { compatPolicy?: string; compatProfile?: CompatProfile; factReference?: string; originalAssetRef?: string }): GarmentAssetReference;
export declare function normalizeGarmentAssetSnapshot(garment: GarmentLike, options?: { factReference?: string; originalAssetRef?: string }): GarmentAssetSnapshot;
export declare function isTemporaryHttpsUrl(value: unknown): boolean;
export declare const isTemporarySignedHttpsUrl: typeof isTemporaryHttpsUrl;
export declare function isStableAssetReference(value: unknown): boolean;
export declare function getStableOriginalReference(garment: GarmentLike, options?: { originalReference?: string; originalAssetRef?: string }): string | undefined;
export declare function getStableFactReference(garment: GarmentLike, options?: { factReference?: string; originalAssetRef?: string }): string | undefined;
export declare const resolveStableFactReference: typeof getStableFactReference;
