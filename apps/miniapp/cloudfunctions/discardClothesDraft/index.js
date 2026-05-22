const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event = {}) => {
  try {
    const { OPENID } = cloud.getWXContext();
    const draftId = event.draftId || event.id;
    if (!draftId) throw new Error('draftId is required');

    const current = await db.collection('clothes_drafts').doc(draftId).get();
    if (!current.data || current.data._openid !== OPENID) throw new Error('draft not found');

    await db.collection('clothes_drafts').doc(draftId).update({
      data: {
        selected: false,
        status: 'discarded',
        updatedAt: new Date().toISOString(),
      },
    });

    return ok({ id: draftId });
  } catch (error) {
    console.error('[discardClothesDraft] failed', error);
    return fail(error);
  }
};

function ok(data) {
  return { code: 0, data, message: 'ok' };
}

function fail(error) {
  return { code: 1, data: null, message: error && error.message ? error.message : 'unknown error' };
}
