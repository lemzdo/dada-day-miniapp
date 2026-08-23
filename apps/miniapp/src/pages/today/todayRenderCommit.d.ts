export interface TodayRenderCommitInput<TSnapshot extends { cards: unknown[] }> {
  canonicalSnapshot: TSnapshot;
  isOwner: () => boolean;
  hydrate: (snapshot: TSnapshot, traceContext?: TodayTraceContext) => Promise<{ cards: unknown[] } | null>;
  persistCanonical?: () => void;
  setCanonicalRef: (snapshot: TSnapshot) => void;
  setRenderState: (snapshot: TSnapshot) => void;
  assertRenderState?: (snapshot: TSnapshot) => boolean;
  traceContext?: TodayTraceContext;
}
export interface TodayTraceContext {
  generation: string | number;
  batchId?: string;
  trace: (stage: string, fields: Record<string, unknown>) => void;
}
export function commitCanonicalSnapshotForRender<TSnapshot extends { cards: unknown[] }>(input: TodayRenderCommitInput<TSnapshot>): Promise<TSnapshot | null>;
