const cloud = require('wx-server-sdk');
const {
  summarizeBatchAfterDraftDiscard,
} = require('./services/discardClothesDraftCore');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event = {}) => {
  try {
    const { OPENID } = cloud.getWXContext();
    const draftId = event.draftId || event.id;
    if (!draftId) throw new Error('draftId is required');

    const current = await db.collection('clothes_drafts').doc(draftId).get();
    if (!current.data || current.data._openid !== OPENID) throw new Error('draft not found');
    const draft = current.data;
    const batchId = draft.batchId;
    if (!batchId) {
      return ok({
        id: draftId,
        draftDiscarded: false,
        batchTerminal: false,
      });
    }

    const batchRes = await db.collection('upload_batches').doc(batchId).get();
    const batch = batchRes.data;
    if (!batch || batch._openid !== OPENID) throw new Error('batch not found');
    const batchStatus = normalizeUploadBatchStatus(batch.status);
    if (batchStatus === 'saved') throw new Error('saved batch cannot be changed');
    if (batchStatus === 'discarded') {
      return ok({
        id: draftId,
        draftDiscarded: draft.status === 'discarded',
        batchTerminal: true,
        batchStatus: 'discarded',
      });
    }

    if (draft.status === 'confirmed' || draft.status === 'saved' || draft.status === 'confirming') {
      return ok({
        id: draftId,
        draftDiscarded: false,
        batchTerminal: false,
      });
    }

    const now = nowIso();
    if (draft.status !== 'discarded') {
      await db.collection('clothes_drafts').doc(draftId).update({
        data: {
          selected: false,
          status: 'discarded',
          updatedAt: now,
        },
      });
    }

    const [draftsRes, imagesRes] = await Promise.all([
      db.collection('clothes_drafts').where({ batchId, _openid: OPENID }).get(),
      db.collection('upload_images').where({ batchId, _openid: OPENID }).get(),
    ]);
    const summary = summarizeBatchAfterDraftDiscard({
      targetDraftId: draftId,
      drafts: draftsRes.data || [],
      images: imagesRes.data || [],
    });

    if (summary.batchTerminal) {
      await db.collection('upload_batches').doc(batchId).update({
        data: {
          status: 'discarded',
          summaryMessage: '用户已舍弃本次识别',
          updatedAt: now,
        },
      });
    }

    return ok({
      id: draftId,
      draftDiscarded: true,
      batchTerminal: summary.batchTerminal,
      batchStatus: summary.batchStatus,
    });
  } catch (error) {
    console.error('[discardClothesDraft] failed', error);
    return fail(error);
  }
};

function normalizeUploadBatchStatus(rawStatus) {
  if (rawStatus === 'success' || rawStatus === 'partial_success' || rawStatus === 'completed') return 'ready';
  if (rawStatus === 'empty' || rawStatus === 'partial_failed') return 'failed';
  if (rawStatus === 'discarded') return 'discarded';
  if (rawStatus === 'saved') return 'saved';
  if (rawStatus === 'failed') return 'failed';
  return 'processing';
}

function nowIso() {
  return new Date().toISOString();
}

function ok(data) {
  return { code: 0, data, message: 'ok' };
}

function fail(error) {
  return { code: 1, data: null, message: error && error.message ? error.message : 'unknown error' };
}
