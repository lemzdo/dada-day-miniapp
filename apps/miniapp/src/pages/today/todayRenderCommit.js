/**
 * Shared canonical -> render commit boundary. All writes are deliberately
 * injected so an owner loss during hydration can be tested as zero writes.
 */
async function commitCanonicalSnapshotForRender({
  canonicalSnapshot,
  isOwner,
  hydrate,
  persistCanonical,
  setCanonicalRef,
  setRenderState,
  assertRenderState,
}) {
  if (!isOwner()) return null;
  const hydratedLight = await hydrate(canonicalSnapshot);
  if (!isOwner() || !hydratedLight) return null;
  const renderSnapshot = { ...canonicalSnapshot, cards: hydratedLight.cards };
  if (assertRenderState && !assertRenderState(renderSnapshot)) return null;
  setCanonicalRef(canonicalSnapshot);
  persistCanonical?.();
  setRenderState(renderSnapshot);
  return renderSnapshot;
}

module.exports = { commitCanonicalSnapshotForRender };
