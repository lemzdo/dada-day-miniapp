const assert = require('node:assert/strict');
const test = require('node:test');
const { commitCanonicalSnapshotForRender } = require('./todayRenderCommit');

function canonicalSnapshot() {
  return { batchId: 'batch-1', cards: [{ items: [{ clothingId: 'top-1', displayImageUrl: 'cloud://cloud1/top.png' }] }] };
}

for (const pathName of ['Full Compute', 'Refresh', 'Snapshot Restore']) {
  test(`${pathName} superseded during delayed hydration performs zero writes`, async () => {
    let owner = true;
    let release;
    const hydration = new Promise((resolve) => { release = resolve; });
    let refWrites = 0;
    let storageWrites = 0;
    let renderWrites = 0;
    const pending = commitCanonicalSnapshotForRender({
      canonicalSnapshot: canonicalSnapshot(),
      isOwner: () => owner,
      hydrate: async () => hydration,
      setCanonicalRef: () => { refWrites += 1; },
      persistCanonical: () => { storageWrites += 1; },
      setRenderState: () => { renderWrites += 1; },
    });
    owner = false;
    release({ cards: [{ items: [{ clothingId: 'top-1', displayImageUrl: 'https://cloud1.tcb.qcloud.la/top.png?sig=ok' }] }] });
    assert.equal(await pending, null);
    assert.deepEqual([refWrites, storageWrites, renderWrites], [0, 0, 0]);
  });
}

test('cloud render candidate is rejected by the invariant before any write', async () => {
  let writes = 0;
  const result = await commitCanonicalSnapshotForRender({
    canonicalSnapshot: canonicalSnapshot(),
    isOwner: () => true,
    hydrate: async (snapshot) => snapshot,
    assertRenderState: (snapshot) => !snapshot.cards[0].items[0].displayImageUrl.startsWith('cloud://'),
    setCanonicalRef: () => { writes += 1; },
    persistCanonical: () => { writes += 1; },
    setRenderState: () => { writes += 1; },
  });
  assert.equal(result, null);
  assert.equal(writes, 0);
});
