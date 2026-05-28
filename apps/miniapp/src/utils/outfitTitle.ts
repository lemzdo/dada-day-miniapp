import type { Outfit } from '@starter-template/types';

type OutfitTitleLike = Pick<Outfit, 'displayTitle' | 'userTitle' | 'title'>;

export function getOutfitDisplayTitle(outfit: OutfitTitleLike | null | undefined, fallback = '') {
  return readTitle(outfit?.displayTitle) || readTitle(outfit?.userTitle) || readTitle(outfit?.title) || fallback;
}

function readTitle(value: string | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}
