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
      const normalizedBatch = normalizeBatch(batch, imagesRes.data || [], draftsRes.data || []);
      await repairBatchIfNeeded(event.batchId, batch, normalizedBatch);
      return ok({
        batch: toBatch(normalizedBatch),
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

function normalizeBatch(batch, images, drafts) {
  const draftImageIds = new Set(drafts.map((item) => item.sourceImageId).filter(Boolean));
  const totalImages = batch.totalImages || images.length || 0;
  const processedImages = Math.max(
    images.filter((item) => isImageProcessed(item) || draftImageIds.has(item._id)).length,
    draftImageIds.size,
  );
  const failedImages = images.filter((item) => item.status === 'failed' && !draftImageIds.has(item._id)).length;
  const emptyImages = images.filter((item) => item.status === 'empty').length;
  const totalDetectedClothes = drafts.length;
  const status = processedImages < totalImages
    ? 'processing'
    : totalDetectedClothes > 0
      ? (failedImages > 0 ? 'partial_success' : 'success')
      : failedImages === 0 && emptyImages > 0
        ? 'empty'
        : 'failed';

  return {
    ...batch,
    processedImages,
    totalDetectedClothes,
    status,
  };
}

async function repairBatchIfNeeded(batchId, current, next) {
  if (
    current.processedImages === next.processedImages
    && current.totalDetectedClothes === next.totalDetectedClothes
    && current.status === next.status
  ) {
    return;
  }

  await db.collection('upload_batches').doc(batchId).update({
    data: {
      processedImages: next.processedImages,
      totalDetectedClothes: next.totalDetectedClothes,
      status: next.status,
      updatedAt: new Date().toISOString(),
    },
  }).catch((error) => {
    console.warn('[createUploadBatch] repair batch stats failed', error);
  });
}

function isImageProcessed(item) {
  return ['detected', 'completed', 'success', 'empty', 'failed'].includes(item.status);
}

function toUploadImage(item) {
  return {
    id: item._id,
    batchId: item.batchId,
    userId: item.userId || item._openid,
    originalImageUrl: item.originalImageUrl,
    cloudFileId: item.cloudFileId,
    status: item.status || 'pending',
    detectStatus: item.detectStatus || item.aiRecognizeStatus || 'pending',
    segmentStatus: item.segmentStatus || item.cutoutStatus || 'not_started',
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
    displayImageUrl: item.displayImageUrl || item.croppedImageUrl || item.originalImageUrl,
    imageSourceType: item.imageSourceType || (item.croppedImageUrl ? 'ai_segment' : 'original'),
    aiSegmentImageUrl: item.aiSegmentImageUrl || '',
    manualCropImageUrl: item.manualCropImageUrl || '',
    detectStatus: item.detectStatus || item.aiRecognizeStatus || 'success',
    segmentStatus: item.segmentStatus || item.cutoutStatus || 'not_started',
    manualCropStatus: item.manualCropStatus || 'unsupported',
    type: item.type || 'other',
    categoryName: item.categoryName,
    color: item.color,
    colors: item.colors || (item.color ? [item.color] : []),
    material: item.material,
    style: item.style,
    styleTags: item.styleTags || (item.style ? [item.style] : []),
    seasonTags: item.seasonTags || [],
    confidence: item.confidence || 0,
    detectProvider: item.detectProvider || 'bailian',
    detectModel: item.detectModel || 'qwen3-vl-flash',
    segmentProvider: item.segmentProvider || 'aliyun_viapi',
    segmentModel: item.segmentModel || 'SegmentCloth',
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
