import type {
  RecommendationCanonicalOverlayCopyV2,
  RecommendationCanonicalOverlayV2,
} from '@starter-template/types';
import type { TodayV2Snapshot } from './todayV2Adapter';

export const CANONICAL_COPY_REFRESH_OFFSETS_MS: readonly number[];

export function applyCanonicalCopyOverlay(
  snapshot: TodayV2Snapshot | null,
  overlay: RecommendationCanonicalOverlayV2,
): {
  snapshot: TodayV2Snapshot | null;
  applied: RecommendationCanonicalOverlayCopyV2[];
};

export function runBoundedCanonicalCopyRefresh(options: {
  batchId: string;
  read: (batchId: string) => Promise<RecommendationCanonicalOverlayV2>;
  isCurrent: () => boolean;
  apply: (overlay: RecommendationCanonicalOverlayV2) => void;
  onAvailable?: (overlay: RecommendationCanonicalOverlayV2) => void;
  offsetsMs?: readonly number[];
  sleep?: (delayMs: number) => Promise<void>;
  now?: () => number;
}): Promise<{
  status: 'stale' | 'ready' | 'bounded_complete';
  attempts: number;
  observedCount?: number;
}>;
