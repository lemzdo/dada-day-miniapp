import type { Outfit } from '@starter-template/types';

export function getCurrentBatchOutfitKeys(outfits: Outfit[] | undefined): string[];
export function buildSceneIdentityKey(sceneKey: string | undefined, identityHash: string | undefined): string;
export function mergeSeenOutfitKeys(previousKeys: string[] | undefined, nextOutfitsOrKeys: Outfit[] | string[] | undefined): string[];
