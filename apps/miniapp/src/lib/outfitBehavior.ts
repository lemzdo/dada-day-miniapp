import { trackCloudOutfitBehaviorEvents } from '@/lib/cloud';
import type {
  Outfit,
  OutfitBehaviorEventInputV1,
  OutfitBehaviorEventType,
} from '@starter-template/types';
import * as core from './outfitBehaviorCore';

interface CreateEventIdOptions {
  pageSessionId?: string;
  eventType: OutfitBehaviorEventType;
  idempotencyKey?: string;
  nowMs?: number;
  sequence?: number;
}

interface ExposureTracker {
  pageSessionId: string;
  buildExposureEvent(input: {
    outfit: Outfit;
    recommendationBatchId?: string;
    position: number;
    candidateCount: number;
    context?: Record<string, unknown>;
  }): OutfitBehaviorEventInputV1 | null;
  buildBatchRefreshEvent(input: {
    previousRecommendationBatchId?: string;
    previousOutfits: Outfit[];
    scene?: string;
    trigger: string;
  }): OutfitBehaviorEventInputV1 | null;
}

type Queue = {
  enqueue: (event: OutfitBehaviorEventInputV1 | null | undefined) => void;
  flush: () => Promise<void>;
  size: () => number;
};

const behaviorQueue = core.createOutfitBehaviorQueue({
  sender: (events: OutfitBehaviorEventInputV1[]) => trackCloudOutfitBehaviorEvents(events),
}) as Queue;

export function createOutfitBehaviorEventId(options: CreateEventIdOptions) {
  return (core.createOutfitBehaviorEventId as (input: CreateEventIdOptions) => string)(options);
}

export function buildOutfitBehaviorSnapshot(outfit: Outfit) {
  return core.buildOutfitBehaviorSnapshot(outfit) as Partial<OutfitBehaviorEventInputV1>;
}

export function createOutfitBehaviorExposureTracker(options?: { pageSessionId?: string }) {
  return core.createOutfitExposureTracker(options) as ExposureTracker;
}

export function trackOutfitBehaviorEvent(event: OutfitBehaviorEventInputV1 | null | undefined) {
  try {
    behaviorQueue.enqueue(event);
    void behaviorQueue.flush().catch(() => undefined);
  } catch {
    // Best-effort behavior collection must not affect UI flows.
  }
}

export function trackOutfitBehaviorEvents(events: OutfitBehaviorEventInputV1[]) {
  try {
    for (const event of events) behaviorQueue.enqueue(event);
    void behaviorQueue.flush().catch(() => undefined);
  } catch {
    // Best-effort behavior collection must not affect UI flows.
  }
}

export function getOutfitBehaviorQueueSize() {
  return behaviorQueue.size();
}
