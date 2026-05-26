const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event = {}) => {
  try {
    const { OPENID } = cloud.getWXContext();
    const batchId = event.batchId || event.id;
    if (!batchId) throw new Error('batchId is required');

    const batchRes = await db.collection('upload_batches').doc(batchId).get();
    const batch = batchRes.data;
    if (!batch || batch._openid !== OPENID) throw new Error('batch not found');

    const status = normalizeUploadBatchStatus(batch.status);
    if (status === 'saved') throw new Error('saved batch cannot be discarded');
    if (status === 'discarded') {
      return ok({ id: batchId, status: 'discarded' });
    }

    const now = nowIso();
    await db.collection('upload_batches').doc(batchId).update({
      data: {
        status: 'discarded',
        summaryMessage: '用户已舍弃本次识别',
        updatedAt: now,
      },
    });

    await db.collection('clothes_drafts').where({
      batchId,
      _openid: OPENID,
      status: 'pending',
    }).update({
      data: {
        selected: false,
        status: 'discarded',
        updatedAt: now,
      },
    }).catch(() => undefined);

    return ok({ id: batchId, status: 'discarded' });
  } catch (error) {
    console.error('[discardUploadBatch] failed', error);
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
