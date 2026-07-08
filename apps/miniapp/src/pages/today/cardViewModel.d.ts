import type { Outfit, OutfitItemSummary } from '@starter-template/types';

export interface OutfitCardViewModel {
  previewItems: OutfitItemSummary[];
  hiddenItemCount: number;
  layoutVariant: string;
  totalItemCount: number;
}

export function buildOutfitCardViewModel(outfit?: Partial<Outfit>): OutfitCardViewModel;
