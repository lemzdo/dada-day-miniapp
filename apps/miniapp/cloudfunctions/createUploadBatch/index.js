const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const RECOVERABLE_BATCH_LIMIT = 10;

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

    if (event.action === 'recoverable') {
      const limit = Math.max(1, Math.min(Number(event.limit || 1), RECOVERABLE_BATCH_LIMIT));
      const batchRes = await db.collection('upload_batches')
        .where({ _openid: OPENID })
        .orderBy('updatedAt', 'desc')
        .limit(RECOVERABLE_BATCH_LIMIT)
        .get();
      const list = [];

      for (const batch of batchRes.data || []) {
        const [imagesRes, draftsRes] = await Promise.all([
          db.collection('upload_images').where({ batchId: batch._id, _openid: OPENID }).get(),
          db.collection('clothes_drafts').where({ batchId: batch._id, _openid: OPENID }).get(),
        ]);
        const images = imagesRes.data || [];
        const drafts = draftsRes.data || [];
        const normalizedBatch = normalizeBatch(batch, images, drafts);
        await repairBatchIfNeeded(batch._id, batch, normalizedBatch);
        const task = toRecoverableBatch(normalizedBatch, images, drafts);
        if (task && list.length < limit) list.push(task);
        if (list.length >= limit) break;
      }

      return ok({ list });
    }

    const totalImages = Math.max(1, Number(event.totalImages || 0));
    const now = new Date().toISOString();
    const batch = {
      _openid: OPENID,
      userId: OPENID,
      totalImages,
      processedImages: 0,
      totalDetectedClothes: 0,
      status: 'processing',
      errorMessage: '',
      summaryMessage: '',
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
    status: normalizeUploadBatchStatus(item.status),
    errorMessage: item.errorMessage || '',
    summaryMessage: item.summaryMessage || '',
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function toRecoverableBatch(batch, images, drafts) {
  const status = normalizeUploadBatchStatus(batch.status);
  if (status !== 'processing' && status !== 'ready' && status !== 'failed') return null;

  const failedImages = images.filter((item) => item.status === 'failed').length;
  const successImages = images.filter((item) => item.status === 'detected' || item.status === 'completed' || item.status === 'success').length;
  const confirmableDrafts = drafts.filter((item) => item.status === 'pending');
  return {
    ...toBatch(batch),
    status,
    successImages,
    failedImages,
    draftCount: confirmableDrafts.length,
    recognizedCount: confirmableDrafts.length,
  };
}

function normalizeBatch(batch, images, drafts) {
  const preservedStatus = normalizeUploadBatchStatus(batch.status);
  if (preservedStatus === 'saved' || preservedStatus === 'discarded') {
    return {
      ...batch,
      status: preservedStatus,
      errorMessage: batch.errorMessage || '',
      summaryMessage: batch.summaryMessage || '',
    };
  }

  const draftImageIds = new Set(drafts.map((item) => item.sourceImageId).filter(Boolean));
  const totalImages = batch.totalImages || images.length || 0;
  const processedImages = Math.max(
    images.filter((item) => isImageProcessed(item) || draftImageIds.has(item._id)).length,
    draftImageIds.size,
  );
  const failedImages = images.filter((item) => item.status === 'failed' && !draftImageIds.has(item._id)).length;
  const emptyImages = images.filter((item) => item.status === 'empty').length;
  const confirmableDrafts = drafts.filter((item) => item.status === 'pending');
  const totalDetectedClothes = confirmableDrafts.length;
  const status = processedImages < totalImages
    ? 'processing'
    : totalDetectedClothes > 0
      ? 'ready'
      : 'failed';
  const summaryMessage = buildBatchSummaryMessage({
    status,
    failedImages,
    emptyImages,
    totalImages,
    totalDetectedClothes,
  });

  return {
    ...batch,
    processedImages,
    totalDetectedClothes,
    status,
    errorMessage: status === 'failed' ? summaryMessage : '',
    summaryMessage,
  };
}

async function repairBatchIfNeeded(batchId, current, next) {
  if (
    current.processedImages === next.processedImages
    && current.totalDetectedClothes === next.totalDetectedClothes
    && current.status === next.status
    && (current.errorMessage || '') === (next.errorMessage || '')
    && (current.summaryMessage || '') === (next.summaryMessage || '')
  ) {
    return;
  }

  await db.collection('upload_batches').doc(batchId).update({
    data: {
      processedImages: next.processedImages,
      totalDetectedClothes: next.totalDetectedClothes,
      status: next.status,
      errorMessage: next.errorMessage || '',
      summaryMessage: next.summaryMessage || '',
      updatedAt: new Date().toISOString(),
    },
  }).catch((error) => {
    console.warn('[createUploadBatch] repair batch stats failed', error);
  });
}

function isImageProcessed(item) {
  return ['detected', 'completed', 'success', 'empty', 'failed'].includes(item.status);
}

function normalizeUploadBatchStatus(rawStatus) {
  if (rawStatus === 'success' || rawStatus === 'partial_success' || rawStatus === 'completed') return 'ready';
  if (rawStatus === 'empty' || rawStatus === 'partial_failed') return 'failed';
  if (rawStatus === 'discarded') return 'discarded';
  if (rawStatus === 'saved') return 'saved';
  if (rawStatus === 'failed') return 'failed';
  return 'processing';
}

function buildBatchSummaryMessage(input) {
  if (input.status === 'processing') return '识别处理中';
  if (input.status === 'ready') {
    if (input.failedImages > 0) return `已识别 ${input.totalDetectedClothes} 件衣服，${input.failedImages} 张图片处理失败`;
    return `已识别 ${input.totalDetectedClothes} 件衣服`;
  }
  if (input.failedImages > 0) return `${input.failedImages} 张图片识别失败`;
  if (input.emptyImages > 0) return '未识别到可确认的衣服';
  if (input.totalImages === 0) return '暂无上传图片';
  return '识别失败';
}

function toUploadImage(item) {
  return {
    id: item._id,
    batchId: item.batchId,
    userId: item.userId || item._openid,
    assetVersion: item.assetVersion || 'v2',
    originalImageUrl: item.originalImageUrl,
    normalizedImageUrl: item.normalizedImageUrl || item.originalImageUrl,
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
    assetVersion: item.assetVersion || 'v1',
    batchId: item.batchId,
    sourceImageId: item.sourceImageId,
    itemIndex: item.itemIndex || 0,
    originalImageUrl: item.originalImageUrl,
    normalizedImageUrl: item.normalizedImageUrl || item.originalImageUrl,
    cropImageUrl: item.cropImageUrl || item.croppedImageUrl || '',
    croppedImageUrl: item.croppedImageUrl || item.cropImageUrl || '',
    maskImageUrl: item.maskImageUrl || '',
    cleanImageUrl: item.cleanImageUrl || item.aiSegmentImageUrl || '',
    displayImageUrl: getDraftDisplayImage(item),
    imageUrl: item.imageUrl || getDraftDisplayImage(item),
    imageSourceType: normalizeImageSourceType(item),
    assetStatus: item.assetStatus || inferAssetStatus(item),
    qualityScore: item.qualityScore || 0,
    needsUserConfirm: item.needsUserConfirm !== false,
    confirmReasons: item.confirmReasons || [],
    bbox: item.bbox || item.cropBox,
    cropBox: item.cropBox || item.bbox,
    stageStatus: item.stageStatus || {
      router: 'skipped',
      detection: item.detectStatus || item.aiRecognizeStatus || 'success',
      crop: item.cropImageUrl || item.croppedImageUrl ? 'success' : 'skipped',
      segment: item.segmentStatus || item.cutoutStatus || 'not_started',
      attribute: item.detectStatus || item.aiRecognizeStatus || 'success',
    },
    providerTrace: item.providerTrace || [],
    aiSegmentImageUrl: item.aiSegmentImageUrl || item.cleanImageUrl || '',
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

function getDraftDisplayImage(item) {
  return [
    item.cleanImageUrl,
    item.aiSegmentImageUrl,
    item.cropImageUrl,
    item.croppedImageUrl,
    item.displayImageUrl,
    item.imageUrl,
    item.manualCropImageUrl,
    item.originalImageUrl,
  ].find((value) => typeof value === 'string' && value.trim()) || '';
}

function normalizeImageSourceType(item) {
  if (item.imageSourceType === 'clean' || item.imageSourceType === 'crop' || item.imageSourceType === 'original') {
    return item.imageSourceType;
  }
  if (item.imageSourceType === 'ai_segment') return 'clean';
  if (item.imageSourceType === 'manual_crop') return 'crop';
  if (item.cleanImageUrl || item.aiSegmentImageUrl) return 'clean';
  if (item.cropImageUrl || item.croppedImageUrl || item.manualCropImageUrl) return 'crop';
  return 'original';
}

function inferAssetStatus(item) {
  if (item.cleanImageUrl || item.cropImageUrl || item.aiSegmentImageUrl || item.croppedImageUrl) return 'ready';
  return 'needs_review';
}

function ok(data) {
  return { code: 0, data, message: 'ok' };
}

function fail(error) {
  return { code: 1, data: null, message: error && error.message ? error.message : 'unknown error' };
}
