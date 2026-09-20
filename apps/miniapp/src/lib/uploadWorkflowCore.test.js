const assert = require('node:assert/strict');
const test = require('node:test');
const {
  MAX_UPLOAD_WORKFLOW_REFS,
  UPLOAD_WORKFLOW_ORPHAN_AGE_MS,
  createUploadWorkflowEnvelope,
  markUploadWorkflowTerminal,
  reconcileUploadWorkflowRefs,
  upsertUploadWorkflowRef,
} = require('./uploadWorkflowCore');

test('upload workflow keeps a single bounded envelope without evicting active refs', () => {
  let envelope = createUploadWorkflowEnvelope();
  for (let index = 0; index < MAX_UPLOAD_WORKFLOW_REFS; index += 1) {
    const result = upsertUploadWorkflowRef(envelope, {
      batchId: `batch-${index}`,
      cloudImageIds: Array.from({ length: 12 }, (_, imageIndex) => `image-${index}-${imageIndex}`),
    }, 100 + index);
    assert.equal(result.status, 'updated');
    envelope = result.envelope;
  }
  assert.equal(envelope.refs.length, 10);
  assert.equal(envelope.refs[0].cloudImageIds.length, 9);

  const overflow = upsertUploadWorkflowRef(envelope, { batchId: 'batch-overflow' }, 1000);
  assert.equal(overflow.status, 'full');
  assert.deepEqual(overflow.envelope, envelope);
});

test('terminal upload removes its local ref immediately and idempotently', () => {
  const first = upsertUploadWorkflowRef(null, { batchId: 'batch-1' }, 100).envelope;
  const removed = markUploadWorkflowTerminal(first, 'batch-1', 'saved');
  assert.equal(removed.refs.length, 0);
  assert.deepEqual(markUploadWorkflowTerminal(removed, 'batch-1', 'saved'), removed);
});

test('orphan reconciliation keeps refs on network failure and removes confirmed stale refs', () => {
  const now = UPLOAD_WORKFLOW_ORPHAN_AGE_MS + 100;
  const envelope = upsertUploadWorkflowRef(null, { batchId: 'batch-1' }, 1).envelope;

  const offline = reconcileUploadWorkflowRefs(envelope, { cloudAvailable: false, now });
  assert.equal(offline.envelope.refs.length, 1);

  const online = reconcileUploadWorkflowRefs(envelope, {
    cloudAvailable: true,
    now,
    serverBatches: [{ id: 'batch-1', status: 'processing' }],
  });
  assert.equal(online.envelope.refs.length, 0);
  assert.deepEqual(online.removedBatchIds, ['batch-1']);
});

test('reconciliation removes terminal and missing cloud refs but retains active recent refs', () => {
  let envelope = createUploadWorkflowEnvelope();
  envelope = upsertUploadWorkflowRef(envelope, { batchId: 'active' }, 100).envelope;
  envelope = upsertUploadWorkflowRef(envelope, { batchId: 'terminal' }, 100).envelope;
  envelope = upsertUploadWorkflowRef(envelope, { batchId: 'missing' }, 100).envelope;
  const result = reconcileUploadWorkflowRefs(envelope, {
    now: 200,
    cloudAvailable: true,
    serverBatches: [
      { id: 'active', status: 'processing' },
      { id: 'terminal', status: 'discarded' },
    ],
  });
  assert.deepEqual(result.retainedBatchIds, ['active']);
  assert.deepEqual(new Set(result.removedBatchIds), new Set(['terminal', 'missing']));
});
