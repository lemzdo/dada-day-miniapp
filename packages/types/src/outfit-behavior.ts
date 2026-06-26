export type OutfitBehaviorEventType =
  | 'recommendation_exposure'
  | 'outfit_detail_view'
  | 'outfit_favorite'
  | 'outfit_unfavorite'
  | 'outfit_wear'
  | 'recommendation_batch_refresh';

export interface OutfitBehaviorScoresSnapshotV1 {
  total?: number;
  weatherAdaptation?: number;
  styleUnity?: number;
  freshness?: number;
  preference?: number;
}

export interface OutfitBehaviorAestheticSnapshotV1 {
  engineVersion?: 'aesthetic-compat-v1';
  score?: number | null;
  coverage?: number;
  evidenceCodes?: string[];
}

export interface OutfitBehaviorContextV1 {
  scene?: 'home' | 'work' | 'date' | 'sport';
  temperatureBand?: string;
  conditionBucket?: string;
  source?: 'today' | 'detail' | 'favorites' | 'history' | 'other';
  position?: number;
  candidateCount?: number;
  trigger?: 'manual';
}

export interface OutfitBehaviorEventInputV1 {
  schemaVersion: 1;
  eventId: string;
  eventType: OutfitBehaviorEventType;
  clientOccurredAt?: string;
  outfitId?: string;
  outfitKey?: string;
  clothingIds?: string[];
  recommendationBatchId?: string;
  batchOutfitKeys?: string[];
  scoresSnapshot?: OutfitBehaviorScoresSnapshotV1;
  aestheticSnapshot?: OutfitBehaviorAestheticSnapshotV1;
  context?: OutfitBehaviorContextV1;
}

export interface TrackOutfitBehaviorEventsRequestV1 {
  events: OutfitBehaviorEventInputV1[];
}

export interface TrackOutfitBehaviorEventResultV1 {
  index: number;
  eventId?: string;
  eventType?: OutfitBehaviorEventType;
  status: 'accepted' | 'duplicate' | 'rejected' | 'failed';
  reason?: string;
}

export interface TrackOutfitBehaviorEventsResponseV1 {
  accepted: number;
  duplicate: number;
  rejected: number;
  failed: number;
  results: TrackOutfitBehaviorEventResultV1[];
}
