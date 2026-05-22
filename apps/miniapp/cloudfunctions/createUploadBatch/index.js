const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event = {}) => {
  try {
    const { OPENID } = cloud.getWXContext();

    if (event.action === 'detail') {
      if (!event.batchId) throw new Error('batchId is required');
      const batch = await getOwnedDoc('upload_batches', event.batchId, OPENID);
      const [imagesRes, draftsRes] = await Promise.all([
        db.collection('upload_images').where({ batchId: event.batchId, _openid: OPENID }).orderBy('createdAt', 'asc').get(),
        db.collection('clothes_drafts').where({ batchId: event.batchId, _openid: OPENID }).orderBy('createdAt', 'asc').get(),
      ]);
      return ok({
        batch: toBatch(batch),
        images: imagesRes.data.map(toUploadImage),
        drafts: draftsRes.data.map(toDraft),
      });
    }

    const totalImages = Math.max(1, Number(event.totalImages || 0));
    const now = new Date().toISOString();
    const batch = {
      _openid: OPENID,
      userId: OPENID,
      totalImages,
      processedImages: 0,
      totalDetectedClothes: 0,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    const addRes = await db.collection('upload_batches').add({ data: batch });
    return ok(toBatch({ ...batch, _id: addRes._id }));
  } catch (error) {
    console.error('[createUploadBatch] failed', error);
    return fail(error);
  }
};

async function getOwnedDoc(collectionName, id, openid) {
  const res = await db.collection(collectionName).doc(id).get();
  if (!res.data || res.data._openid !== openid) throw new Error('not found');
  return res.data;
}

function toBatch(item) {
  return {
    id: item._id,
    userId: item.userId || item._openid,
    totalImages: item.totalImages || 0,
    processedImages: item.processedImages || 0,
    totalDetectedClothes: item.totalDetectedClothes || 0,
    status: item.status || 'pending',
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function toUploadImage(item) {
  return {
    id: item._id,
    batchId: item.batchId,
    userId: item.userId || item._openid,
    originalImageUrl: item.originalImageUrl,
    cloudFileId: item.cloudFileId,
    status: item.status || 'pending',
    detectedCount: item.detectedCount || 0,
    errorMessage: item.errorMessage,
    aiRawResult: item.aiRawResult,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function toDraft(item) {
  return {
    id: item._id,
    userId: item.userId || item._openid,
    batchId: item.batchId,
    sourceImageId: item.sourceImageId,
    originalImageUrl: item.originalImageUrl,
    croppedImageUrl: item.croppedImageUrl,
    cropBox: item.cropBox,
    type: item.type || 'other',
    categoryName: item.categoryName,
    color: item.color,
    colors: item.colors || (item.color ? [item.color] : []),
    material: item.material,
    style: item.style,
    confidence: item.confidence || 0,
    selected: item.selected !== false,
    status: item.status || 'pending',
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
