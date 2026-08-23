export interface TodayRenderCommitInput<TSnapshot extends { cards: unknown[] }> {
  canonicalSnapshot: TSnapshot;
  isOwner: () => boolean;
  hydrate: (snapshot: TSnapshot) => Promise<{ cards: unknown[] } | null>;
  persistCanonical?: () => void;
  setCanonicalRef: (snapshot: TSnapshot) => void;
  setRenderState: (snapshot: TSnapshot) => void;
  assertRenderState?: (snapshot: TSnapshot) => boolean;
}
export function commitCanonicalSnapshotForRender<TSnapshot extends { cards: unknown[] }>(input: TodayRenderCommitInput<TSnapshot>): Promise<TSnapshot | null>;
