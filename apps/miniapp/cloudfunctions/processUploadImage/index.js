const cloud = require('wx-server-sdk');
const {
  getErrorMessage,
  runWardrobeAssetPipeline,
  toDraftData,
  toDraftResponse,
} = require('./services/wardrobeAssetPipeline');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const imageId = event.imageId || event.uploadImageId;
  const startedAt = Date.now();

  try {
    if (!imageId) throw new Error('imageId is required');

    const imageRes = await db.collection('upload_images').doc(imageId).get();
    const image = imageRes.data;
    if (!image || image._openid !== OPENID) throw new Error('upload image not found');

    const batchRes = await db.collection('upload_batches').doc(image.batchId).get();
    if (!batchRes.data || batchRes.data._openid !== OPENID) throw new Error('batch not found');
    const batchStatus = normalizeUploadBatchStatus(batchRes.data.status);
    if (batchStatus === 'saved') throw new Error('batch already saved');
    if (batchStatus === 'discarded') throw new Error('batch already discarded');

    const existingDraftsRes = await db.collection('clothes_drafts').where({ sourceImageId: imageId, _openid: OPENID }).get();
    const existingDrafts = existingDraftsRes.data || [];
    if (existingDrafts.length > 0) {
      await safeMarkImage(imageId, {
        status: 'detected',
        detectStatus: image.detectStatus === 'partial' ? 'partial' : 'success',
        segmentStatus: summarizeSegmentStatus(existingDrafts),
        detectedCount: existingDrafts.length,
        errorMessage: '',
        updatedAt: nowIso(),
      });
      const usedBatchFallback = await safeUpdateBatchAfterImage({
        batchId: image.batchId,
        openid: OPENID,
        imageBefore: image,
        status: 'detected',
        detectedCount: existingDrafts.length,
      });
      logImageProcessed({
        batchId: image.batchId,
        imageId,
        startedAt,
        assetCount: existingDrafts.length,
        mergedShoePairCount: 0,
        usedBatchFallback,
        reusedDrafts: true,
      });
      return ok({ imageId, drafts: existingDrafts.map(toDraftResponse) });
    }

    await markImage(imageId, {
      status: 'detecting',
      detectStatus: 'pending',
      segmentStatus: 'not_started',
      detectedCount: 0,
      errorMessage: '',
      updatedAt: nowIso(),
    });
    await db.collection('upload_batches').doc(image.batchId).update({
      data: { status: 'processing', updatedAt: nowIso() },
    });

    try {
      const pipelineResult = await runWardrobeAssetPipeline({
        cloud,
        openid: OPENID,
        image: { ...image, _id: imageId },
      });

      if (pipelineResult.assets.length === 0) {
        const noAssetError = getNoAssetErrorMessage(pipelineResult);
        const shouldMarkEmpty = !noAssetError;
        await markImage(imageId, {
          status: shouldMarkEmpty ? 'empty' : 'failed',
          detectStatus: shouldMarkEmpty ? 'success' : 'failed',
          segmentStatus: 'skipped',
          detectedCount: 0,
          errorMessage: noAssetError,
          aiRawResult: buildImageRawResult(pipelineResult),
          routerResult: pipelineResult.routerResult,
          updatedAt: nowIso(),
        });
        const usedBatchFallback = await safeUpdateBatchAfterImage({
          batchId: image.batchId,
          openid: OPENID,
          imageBefore: image,
          status: shouldMarkEmpty ? 'empty' : 'failed',
          detectedCount: 0,
        });
        logImageProcessed({
          batchId: image.batchId,
          imageId,
          startedAt,
          assetCount: 0,
          mergedShoePairCount: pipelineResult.mergedShoePairCount || 0,
          usedBatchFallback,
        });
        return ok({ imageId, drafts: [], emptyReason: pipelineResult.emptyReason, errorMessage: noAssetError });
      }

      const createdDrafts = [];
      try {
        for (const asset of pipelineResult.assets) {
          const draft = toDraftData(asset, OPENID);
          const addRes = await db.collection('clothes_drafts').add({ data: draft });
          createdDrafts.push(toDraftResponse({ ...draft, _id: addRes._id }));
        }
      } catch (error) {
        const message = getErrorMessage(error);
        console.error('[processUploadImage] create drafts failed', {
          batchId: image.batchId,
          imageId,
          createdCount: createdDrafts.length,
          message,
        });

        await safeMarkImage(imageId, {
          status: createdDrafts.length > 0 ? 'detected' : 'failed',
          detectStatus: createdDrafts.length > 0 ? 'partial' : 'failed',
          segmentStatus: summarizeSegmentStatus(createdDrafts),
          detectedCount: createdDrafts.length,
          errorMessage: message,
          aiRawResult: buildImageRawResult(pipelineResult),
          routerResult: pipelineResult.routerResult,
          updatedAt: nowIso(),
        });
        const usedBatchFallback = await safeUpdateBatchAfterImage({
          batchId: image.batchId,
          openid: OPENID,
          imageBefore: image,
          status: createdDrafts.length > 0 ? 'detected' : 'failed',
          detectedCount: createdDrafts.length,
        });
        logImageProcessed({
          batchId: image.batchId,
          imageId,
          startedAt,
          assetCount: pipelineResult.assets.length,
          createdDraftCount: createdDrafts.length,
          mergedShoePairCount: pipelineResult.mergedShoePairCount || 0,
          usedBatchFallback,
          errorMessage: message,
        });
        return ok({ imageId, drafts: createdDrafts, errorMessage: message });
      }

      const hasReviewDraft = createdDrafts.some((draft) => draft.assetStatus !== 'ready');
      const hasFailedStage = createdDrafts.some((draft) => (
        draft.stageStatus
        && Object.values(draft.stageStatus).some((status) => status === 'failed')
      ));

      await safeMarkImage(imageId, {
        status: 'detected',
        detectStatus: hasReviewDraft || hasFailedStage ? 'partial' : 'success',
        segmentStatus: summarizeSegmentStatus(createdDrafts),
        detectedCount: createdDrafts.length,
        errorMessage: pipelineResult.warnings.join('|'),
        aiRawResult: buildImageRawResult(pipelineResult),
        routerResult: pipelineResult.routerResult,
        updatedAt: nowIso(),
      });
      const usedBatchFallback = await safeUpdateBatchAfterImage({
        batchId: image.batchId,
        openid: OPENID,
        imageBefore: image,
        status: 'detected',
        detectedCount: createdDrafts.length,
      });

      console.log('[processUploadImage] pipeline v2 completed', {
        batchId: image.batchId,
        imageId,
        detectedCount: createdDrafts.length,
        reviewCount: createdDrafts.filter((draft) => draft.assetStatus !== 'ready').length,
        durationMs: Date.now() - startedAt,
        assetCount: pipelineResult.assets.length,
        mergedShoePairCount: pipelineResult.mergedShoePairCount || 0,
        usedBatchFallback,
      });

      return ok({ imageId, drafts: createdDrafts, warnings: pipelineResult.warnings });
    } catch (error) {
      const message = getErrorMessage(error);
      console.error('[processUploadImage] image failed', { imageId, message });
      await markImage(imageId, {
        status: 'failed',
        detectStatus: 'failed',
        segmentStatus: 'skipped',
        detectedCount: 0,
        errorMessage: message,
        updatedAt: nowIso(),
      });
      const usedBatchFallback = await safeUpdateBatchAfterImage({
        batchId: image.batchId,
        openid: OPENID,
        imageBefore: image,
        status: 'failed',
        detectedCount: 0,
      });
      logImageProcessed({
        batchId: image.batchId,
        imageId,
        startedAt,
        assetCount: 0,
        mergedShoePairCount: 0,
        usedBatchFallback,
        errorMessage: message,
      });
      return ok({ imageId, drafts: [], errorMessage: message });
    }
  } catch (error) {
    console.error('[processUploadImage] failed', error);
    return fail(error);
  }
};

async function refreshBatch(batchId, openid) {
  const imagesRes = await db.collection('upload_images').where({ batchId, _openid: openid }).get();
  const images = imagesRes.data || [];
  const draftsRes = await db.collection('clothes_drafts').where({ batchId, _openid: openid }).get();
  const drafts = draftsRes.data || [];
  const batchRes = await db.collection('upload_batches').doc(batchId).get();
  const currentBatch = batchRes.data || {};
  const preservedStatus = normalizeUploadBatchStatus(currentBatch.status);
  if (preservedStatus === 'saved' || preservedStatus === 'discarded') return;

  const draftImageIds = new Set(drafts.map((item) => item.sourceImageId).filter(Boolean));
  const processedImages = Math.max(
    images.filter((item) => isImageProcessed(item) || draftImageIds.has(item._id)).length,
    draftImageIds.size,
  );
  const failedImages = images.filter((item) => item.status === 'failed' && !draftImageIds.has(item._id)).length;
  const emptyImages = images.filter((item) => item.status === 'empty').length;
  const confirmableDrafts = drafts.filter((item) => item.status === 'pending');
  const totalDetectedClothes = confirmableDrafts.length;
  const totalImages = currentBatch.totalImages ? currentBatch.totalImages : images.length;
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

  await db.collection('upload_batches').doc(batchId).update({
    data: {
      processedImages,
      totalDetectedClothes,
      status,
      errorMessage: status === 'failed' ? summaryMessage : '',
      summaryMessage,
      updatedAt: nowIso(),
    },
  });
}

async function safeUpdateBatchAfterImage(input) {
  try {
    await updateBatchAfterImage(input);
    return false;
  } catch (error) {
    console.warn('[processUploadImage] local batch update failed, fallback to refreshBatch', {
      batchId: input.batchId,
      imageId: input.imageBefore && input.imageBefore._id,
      message: getErrorMessage(error),
    });
    await refreshBatch(input.batchId, input.openid);
    return true;
  }
}

async function updateBatchAfterImage({ batchId, openid, imageBefore, status, detectedCount }) {
  const batchRes = await db.collection('upload_batches').doc(batchId).get();
  const currentBatch = batchRes.data || {};
  if (currentBatch._openid !== openid) throw new Error('batch not found');
  const preservedStatus = normalizeUploadBatchStatus(currentBatch.status);
  if (preservedStatus === 'saved' || preservedStatus === 'discarded') return;

  const totalImages = Math.max(0, Number(currentBatch.totalImages || 0));
  const previousDetectedCount = Math.max(0, Number(imageBefore && imageBefore.detectedCount ? imageBefore.detectedCount : 0));
  const wasProcessed = isImageProcessed(imageBefore || {});
  const processedImages = Math.min(
    totalImages,
    Math.max(0, Number(currentBatch.processedImages || 0)) + (wasProcessed ? 0 : 1),
  );
  const totalDetectedClothes = Math.max(
    0,
    Number(currentBatch.totalDetectedClothes || 0) - previousDetectedCount + Math.max(0, Number(detectedCount || 0)),
  );
  const nextStatus = processedImages < totalImages
    ? 'processing'
    : totalDetectedClothes > 0
      ? 'ready'
      : 'failed';
  const summaryMessage = buildBatchSummaryMessage({
    status: nextStatus,
    failedImages: status === 'failed' ? 1 : 0,
    emptyImages: status === 'empty' ? 1 : 0,
    totalImages,
    totalDetectedClothes,
  });

  await db.collection('upload_batches').doc(batchId).update({
    data: {
      processedImages,
      totalDetectedClothes,
      status: nextStatus,
      errorMessage: nextStatus === 'failed' ? summaryMessage : '',
      summaryMessage,
      updatedAt: nowIso(),
    },
  });
}

async function markImage(imageId, data) {
  await db.collection('upload_images').doc(imageId).update({ data });
}

async function safeMarkImage(imageId, data) {
  try {
    await markImage(imageId, data);
  } catch (error) {
    console.error('[processUploadImage] update upload image failed after drafts were created', {
      imageId,
      message: getErrorMessage(error),
    });
  }
}

function summarizeSegmentStatus(drafts) {
  if (!drafts || drafts.length === 0) return 'skipped';
  if (drafts.some((draft) => draft.segmentStatus === 'processing' || draft.segmentStatus === 'queued')) return 'processing';
  if (drafts.every((draft) => draft.segmentStatus === 'success')) return 'success';
  if (drafts.some((draft) => draft.segmentStatus === 'success')) return 'partial';
  if (drafts.some((draft) => draft.segmentStatus === 'failed')) return 'failed';
  return 'skipped';
}

function buildImageRawResult(result) {
  return {
    assetVersion: process.env.ASSET_PIPELINE_VERSION || 'v2',
    router: result.routerResult,
    detection: result.detectionRaw,
    stageStatus: result.stageStatus,
    warnings: result.warnings,
    detectedCount: result.detectedCount || 0,
    rawDetectedCount: result.rawDetectedCount || 0,
    mergedShoePairCount: result.mergedShoePairCount || 0,
    emptyReason: result.emptyReason || '',
    hadDetectionError: Boolean(result.hadDetectionError),
    hadProviderError: Boolean(result.hadProviderError),
    hadPipelineError: Boolean(result.hadPipelineError),
    assetCount: result.assets.length,
    parsedAt: nowIso(),
  };
}

function logImageProcessed(input) {
  console.log('[processUploadImage] image processed', {
    batchId: input.batchId,
    imageId: input.imageId,
    durationMs: Date.now() - input.startedAt,
    assetCount: input.assetCount || 0,
    createdDraftCount: input.createdDraftCount,
    mergedShoePairCount: input.mergedShoePairCount || 0,
    usedBatchFallback: Boolean(input.usedBatchFallback),
    reusedDrafts: Boolean(input.reusedDrafts),
    errorMessage: input.errorMessage || '',
  });
}

function getNoAssetErrorMessage(result) {
  const reasons = [];
  if (result.hadPipelineError) reasons.push('pipeline_error');
  if (result.hadProviderError) reasons.push('provider_error');
  if (result.hadDetectionError) reasons.push('detection_error');
  if (result.emptyReason && result.emptyReason !== 'no_garment_detected') reasons.push(result.emptyReason);
  return Array.from(new Set(reasons)).join('|');
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

function nowIso() {
  return new Date().toISOString();
}

function ok(data) {
  return { code: 0, data, message: 'ok' };
}

function fail(error) {
  return { code: 1, data: null, message: getErrorMessage(error) };
}
