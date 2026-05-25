const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event = {}) => {
  try {
    const { OPENID } = cloud.getWXContext();
    if (!event.batchId) throw new Error('batchId is required');
    if (!event.fileID && !event.originalImageUrl) throw new Error('fileID is required');

    const batchRes = await db.collection('upload_batches').doc(event.batchId).get();
    if (!batchRes.data || batchRes.data._openid !== OPENID) throw new Error('batch not found');

    const now = new Date().toISOString();
    const fileID = event.fileID || event.originalImageUrl;
    const image = {
      _openid: OPENID,
      userId: OPENID,
      batchId: event.batchId,
      originalImageUrl: fileID,
      cloudFileId: event.fileID || fileID,
      status: 'pending',
      detectStatus: 'pending',
      segmentStatus: 'not_started',
      detectedCount: 0,
      errorMessage: '',
      aiRawResult: {},
      createdAt: now,
      updatedAt: now,
    };

    const addRes = await db.collection('upload_images').add({ data: image });
    await db.collection('upload_batches').doc(event.batchId).update({
      data: { status: 'processing', updatedAt: now },
    });

    return ok(toUploadImage({ ...image, _id: addRes._id }));
  } catch (error) {
    console.error('[createUploadImage] failed', error);
    return fail(error);
  }
};

function toUploadImage(item) {
  return {
    id: item._id,
    batchId: item.batchId,
    userId: item.userId || item._openid,
    originalImageUrl: item.originalImageUrl,
    cloudFileId: item.cloudFileId,
    status: item.status || 'pending',
    detectStatus: item.detectStatus || 'pending',
    segmentStatus: item.segmentStatus || 'not_started',
    detectedCount: item.detectedCount || 0,
    errorMessage: item.errorMessage,
    aiRawResult: item.aiRawResult,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function ok(data) {
  return { code: 0, data, message: 'ok' };
}

function fail(error) {
  return { code: 1, data: null, message: error && error.message ? error.message : 'unknown error' };
}
