import type {
  RecommendationCanonicalOverlayCopyV2,
  RecommendationHomeLightResponseV2,
  RecommendationStreamEventV1,
} from '@starter-template/types';

export interface ParsedSseFrame {
  event: string;
  data: RecommendationStreamEventV1 | Record<string, unknown> | null;
  raw: string;
}

export function createUtf8ChunkDecoder(): {
  push(value: string | ArrayBuffer | ArrayBufferView, final?: boolean): string;
  finish(): string;
};

export function parseFrame(frame: string): ParsedSseFrame | null;

export function createSseParser(options?: {
  onEvent?: (frame: ParsedSseFrame) => void;
  onMalformed?: (frame: ParsedSseFrame) => void;
}): {
  push(chunk: string | ArrayBuffer | ArrayBufferView): void;
  finish(): void;
};

export function createRecommendationStreamConsumer(options: {
  generation: string | number;
  isCurrent?: () => boolean;
  onRecommendationReady?: (
    response: RecommendationHomeLightResponseV2,
    event: Extract<RecommendationStreamEventV1, { type: 'recommendation.ready' }>,
  ) => void;
  onCanonicalCopy?: (
    copy: RecommendationCanonicalOverlayCopyV2,
    event: Extract<RecommendationStreamEventV1, { type: 'canonical.copy' }>,
  ) => void;
  onDiagnostic?: (event: Extract<RecommendationStreamEventV1, { type: 'diagnostic' }>) => void;
  onComplete?: (event: Extract<RecommendationStreamEventV1, { type: 'complete' }>) => void;
}): {
  handle(frame: ParsedSseFrame): { status: string; batchId?: string };
  getState(): { batchId: string; ready: boolean; complete: boolean; pendingCopyCount: number };
};
