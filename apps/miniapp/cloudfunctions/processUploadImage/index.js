const cloud = require('wx-server-sdk');
const {
  getErrorMessage,
  runWardrobeAssetPipeline,
  toDraftData,
  toDraftResponse,
} = require('./services/wardrobeAssetPipeline');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const PROCESSING_STALE_MS = 2 * 60 * 1000;
const ACTIVE_PROCESSING_STATUSES = new Set(['detecting', 'processing']);
const COMPLETED_IMAGE_STATUSES = new Set(['detected', 'success', 'completed']);
const PROCESSABLE_IMAGE_STATUSES = new Set(['pending', 'failed', 'empty']);
const REUSABLE_DRAFT_STATUSES = new Set(['pending', 'confirmed']);
const PROTECTED_DRAFT_STATUSES = new Set(['confirmed', 'discarded', 'confirming']);

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const imageId = event.imageId || event.uploadImageId;
  const startedAt = Date.now();

  try {
    if (!imageId) throw new Error('imageId is required');

    const lease = await acquireImageProcessingLease(imageId, OPENID);
    if (lease.status === 'inProgress') {
      return ok({ success: true, status: 'inProgress', imageId, reused: false });
    }
    if (lease.status === 'superseded') {
      return ok({ success: true, status: 'superseded', imageId, reason: lease.reason });
    }
    if (lease.status === 'completed') {
      const reusableDrafts = await getReusableDrafts(imageId, OPENID);
      if (reusableDrafts.length === 0) {
        const reacquired = await acquireImageProcessingLease(imageId, OPENID, { allowCompletedWithoutDrafts: true });
        if (reacquired.status === 'inProgress') {
          return ok({ success: true, status: 'inProgress', imageId, reused: false });
        }
        if (reacquired.status === 'superseded') {
          return ok({ success: true, status: 'superseded', imageId, reason: reacquired.reason });
        }
        if (reacquired.status === 'completed') {
          return ok({ success: true, status: 'inProgress', imageId, reused: false, reason: 'completed_without_reusable_drafts' });
        }
        lease.status = reacquired.status;
        lease.image = reacquired.image;
        lease.batch = reacquired.batch;
        lease.processingToken = reacquired.processingToken;
      } else {
        logImageProcessed({
          batchId: lease.image && lease.image.batchId,
          imageId,
          startedAt,
          assetCount: reusableDrafts.length,
          mergedShoePairCount: 0,
          usedBatchFallback: false,
          reusedDrafts: true,
        });
        return ok({
          success: true,
          status: 'reused',
          imageId,
          drafts: reusableDrafts.map(toDraftResponse),
          reused: true,
        });
      }
    }
    if (lease.status === 'reused') {
      const reusableDrafts = await getReusableDrafts(imageId, OPENID);
      logImageProcessed({
        batchId: lease.image && lease.image.batchId,
        imageId,
        startedAt,
        assetCount: reusableDrafts.length,
        mergedShoePairCount: 0,
        usedBatchFallback: false,
        reusedDrafts: true,
      });
      return ok({
        success: true,
        status: 'reused',
        imageId,
        drafts: reusableDrafts.map(toDraftResponse),
        reused: true,
      });
    }

    const context = {
      imageId,
      openid: OPENID,
      token: lease.processingToken,
      batchId: lease.image.batchId,
    };
    const image = lease.image;

    try {
      const beforePipeline = await touchProcessingHeartbeat(context);
      if (!beforePipeline.owned) return ok(buildSupersededResult(imageId, beforePipeline.reason));

      const pipelineResult = await runWardrobeAssetPipeline({
        cloud,
        openid: OPENID,
        image: { ...image, _id: imageId },
      });

      const beforeDrafts = await touchProcessingHeartbeat(context);
      if (!beforeDrafts.owned) return ok(buildSupersededResult(imageId, beforeDrafts.reason));

      if (pipelineResult.assets.length === 0) {
        const noAssetError = getNoAssetErrorMessage(pipelineResult);
        const shouldMarkEmpty = !noAssetError;
        const markResult = await markImageWithToken(context, {
          status: shouldMarkEmpty ? 'empty' : 'failed',
          detectStatus: shouldMarkEmpty ? 'success' : 'failed',
          segmentStatus: 'skipped',
          detectedCount: 0,
          errorMessage: noAssetError,
          aiRawResult: buildImageRawResult(pipelineResult),
          routerResult: pipelineResult.routerResult,
          updatedAt: nowIso(),
        });
        if (!markResult.owned) return ok(buildSupersededResult(imageId, markResult.reason));
        await refreshBatch(image.batchId, OPENID);
        logImageProcessed({
          batchId: image.batchId,
          imageId,
          startedAt,
          assetCount: 0,
          mergedShoePairCount: pipelineResult.mergedShoePairCount || 0,
          usedBatchFallback: true,
        });
        return ok({
          success: true,
          status: shouldMarkEmpty ? 'empty' : 'failed',
          imageId,
          drafts: [],
          emptyReason: pipelineResult.emptyReason,
          errorMessage: noAssetError,
        });
      }

      const createdDrafts = [];
      try {
        for (const asset of pipelineResult.assets) {
          const owner = await assertProcessingOwner(context, { requireWritableBatch: true });
          if (!owner.owned) return ok(buildSupersededResult(imageId, owner.reason));
          const draft = await upsertDraftForAsset(asset, OPENID, context);
          if (draft.locked) {
            return ok({
              success: true,
              status: 'inProgress',
              imageId,
              drafts: createdDrafts,
              reused: false,
              reason: 'draft_locked',
            });
          }
          createdDrafts.push(draft);
        }
      } catch (error) {
        const message = getErrorMessage(error);
        console.error('[processUploadImage] create drafts failed', {
          batchId: image.batchId,
          imageId,
          createdCount: createdDrafts.length,
          message,
        });

        const markResult = await markImageWithToken(context, {
          status: createdDrafts.length > 0 ? 'detected' : 'failed',
          detectStatus: createdDrafts.length > 0 ? 'partial' : 'failed',
          segmentStatus: summarizeSegmentStatus(createdDrafts),
          detectedCount: createdDrafts.length,
          errorMessage: message,
          aiRawResult: buildImageRawResult(pipelineResult),
          routerResult: pipelineResult.routerResult,
          updatedAt: nowIso(),
        });
        if (!markResult.owned) return ok(buildSupersededResult(imageId, markResult.reason));
        await refreshBatch(image.batchId, OPENID);
        logImageProcessed({
          batchId: image.batchId,
          imageId,
          startedAt,
          assetCount: pipelineResult.assets.length,
          createdDraftCount: createdDrafts.length,
          mergedShoePairCount: pipelineResult.mergedShoePairCount || 0,
          usedBatchFallback: true,
          errorMessage: message,
        });
        return ok({
          success: true,
          status: createdDrafts.length > 0 ? 'detected' : 'failed',
          imageId,
          drafts: createdDrafts,
          errorMessage: message,
        });
      }

      const hasReviewDraft = createdDrafts.some((draft) => draft.assetStatus !== 'ready');
      const hasFailedStage = createdDrafts.some((draft) => (
        draft.stageStatus
        && Object.values(draft.stageStatus).some((status) => status === 'failed')
      ));

      const markResult = await markImageWithToken(context, {
        status: 'detected',
        detectStatus: hasReviewDraft || hasFailedStage ? 'partial' : 'success',
        segmentStatus: summarizeSegmentStatus(createdDrafts),
        detectedCount: createdDrafts.length,
        errorMessage: pipelineResult.warnings.join('|'),
        aiRawResult: buildImageRawResult(pipelineResult),
        routerResult: pipelineResult.routerResult,
        updatedAt: nowIso(),
      });
      if (!markResult.owned) return ok(buildSupersededResult(imageId, markResult.reason));
      await refreshBatch(image.batchId, OPENID);

      console.log('[processUploadImage] pipeline v2 completed', {
        batchId: image.batchId,
        imageId,
        detectedCount: createdDrafts.length,
        reviewCount: createdDrafts.filter((draft) => draft.assetStatus !== 'ready').length,
        durationMs: Date.now() - startedAt,
        assetCount: pipelineResult.assets.length,
        mergedShoePairCount: pipelineResult.mergedShoePairCount || 0,
        usedBatchFallback: true,
      });

      return ok({ success: true, status: 'detected', imageId, drafts: createdDrafts, warnings: pipelineResult.warnings });
    } catch (error) {
      const message = getErrorMessage(error);
      console.error('[processUploadImage] image failed', { imageId, message });
      const markResult = await markImageWithToken(context, {
        status: 'failed',
        detectStatus: 'failed',
        segmentStatus: 'skipped',
        detectedCount: 0,
        errorMessage: message,
        updatedAt: nowIso(),
      });
      if (!markResult.owned) return ok(buildSupersededResult(imageId, markResult.reason));
      await refreshBatch(image.batchId, OPENID);
      logImageProcessed({
        batchId: image.batchId,
        imageId,
        startedAt,
        assetCount: 0,
        mergedShoePairCount: 0,
        usedBatchFallback: true,
        errorMessage: message,
      });
      return ok({ success: true, status: 'failed', imageId, drafts: [], errorMessage: message });
    }
  } catch (error) {
    console.error('[processUploadImage] failed', error);
    return fail(error);
  }
};

async function acquireImageProcessingLease(imageId, openid, options = {}) {
  if (typeof db.runTransaction !== 'function') {
    throw new Error('process upload transaction unavailable');
  }

  const token = createProcessingToken();
  const now = nowIso();

  return db.runTransaction(async (transaction) => {
    const imageRef = transaction.collection('upload_images').doc(imageId);
    const imageRes = await imageRef.get();
    const image = imageRes.data;
    if (!image || image._openid !== openid) throw new Error('upload image not found');

    const batchRef = transaction.collection('upload_batches').doc(image.batchId);
    const batchRes = await batchRef.get();
    const batch = batchRes.data;
    if (!batch || batch._openid !== openid) throw new Error('batch not found');

    const batchStatus = normalizeUploadBatchStatus(batch.status);
    if (batchStatus === 'saved' || batchStatus === 'discarded') {
      return { status: 'superseded', reason: 'batch_finalized', image, batch };
    }

    const imageStatus = image.status || 'pending';
    if (COMPLETED_IMAGE_STATUSES.has(imageStatus) && !options.allowCompletedWithoutDrafts) {
      return { status: 'completed', image, batch };
    }

    if (ACTIVE_PROCESSING_STATUSES.has(imageStatus) && !isProcessingStale(image)) {
      return { status: 'inProgress', image, batch };
    }

    const canReprocessCompleted = options.allowCompletedWithoutDrafts && COMPLETED_IMAGE_STATUSES.has(imageStatus);
    if (!PROCESSABLE_IMAGE_STATUSES.has(imageStatus) && !ACTIVE_PROCESSING_STATUSES.has(imageStatus) && !canReprocessCompleted) {
      return { status: 'inProgress', image, batch };
    }

    const data = {
      status: 'processing',
      detectStatus: 'pending',
      segmentStatus: 'not_started',
      detectedCount: 0,
      errorMessage: '',
      processingToken: token,
      processingStartedAt: now,
      processingHeartbeatAt: now,
      processingAttempt: Math.max(0, Number(image.processingAttempt || 0)) + 1,
      updatedAt: now,
    };

    await imageRef.update({ data });
    await batchRef.update({ data: { status: 'processing', updatedAt: now } });
    return {
      status: 'acquired',
      image: { ...image, ...data, _id: imageId },
      batch,
      processingToken: token,
    };
  }, 3);
}

async function getReusableDrafts(imageId, openid) {
  const res = await db.collection('clothes_drafts').where({ sourceImageId: imageId, _openid: openid }).get();
  return (res.data || []).filter((draft) => REUSABLE_DRAFT_STATUSES.has(draft.status || 'pending'));
}

async function touchProcessingHeartbeat(context) {
  return updateImageWithToken(context, {
    processingHeartbeatAt: nowIso(),
    updatedAt: nowIso(),
  });
}

async function markImageWithToken(context, data) {
  return updateImageWithToken(context, data);
}

async function updateImageWithToken(context, patch) {
  return db.runTransaction(async (transaction) => {
    const imageRef = transaction.collection('upload_images').doc(context.imageId);
    const imageRes = await imageRef.get();
    const image = imageRes.data;
    const owner = validateProcessingOwner(image, context);
    if (!owner.owned) return owner;

    const batchRef = transaction.collection('upload_batches').doc(context.batchId);
    const batchRes = await batchRef.get();
    const batch = batchRes.data;
    if (!batch || batch._openid !== context.openid) return { owned: false, reason: 'batch_not_found' };
    const batchStatus = normalizeUploadBatchStatus(batch.status);
    if (batchStatus === 'saved' || batchStatus === 'discarded') {
      return { owned: false, reason: 'batch_finalized' };
    }

    await imageRef.update({ data: patch });
    return { owned: true, image: { ...image, ...patch }, batch };
  }, 3);
}

async function assertProcessingOwner(context, options = {}) {
  const imageRes = await db.collection('upload_images').doc(context.imageId).get();
  const owner = validateProcessingOwner(imageRes.data, context);
  if (!owner.owned) return owner;

  if (options.requireWritableBatch) {
    const batchRes = await db.collection('upload_batches').doc(context.batchId).get();
    const batch = batchRes.data;
    if (!batch || batch._openid !== context.openid) return { owned: false, reason: 'batch_not_found' };
    const batchStatus = normalizeUploadBatchStatus(batch.status);
    if (batchStatus === 'saved' || batchStatus === 'discarded') {
      return { owned: false, reason: 'batch_finalized' };
    }
  }

  return owner;
}

function validateProcessingOwner(image, context) {
  if (!image || image._openid !== context.openid) return { owned: false, reason: 'image_not_found' };
  if (image.processingToken !== context.token) return { owned: false, reason: 'token_mismatch' };
  if (!ACTIVE_PROCESSING_STATUSES.has(image.status || '')) return { owned: false, reason: 'status_changed' };
  return { owned: true, image };
}

async function upsertDraftForAsset(asset, openid, context) {
  const sourceAssetKey = normalizeSourceAssetKey(asset.sourceAssetKey);
  const draftId = `${context.imageId}_${sourceAssetKey}`;
  const ref = db.collection('clothes_drafts').doc(draftId);
  const existingRes = await ref.get().catch(() => null);
  const existing = existingRes && existingRes.data;

  if (existing && existing._openid !== openid) throw new Error('draft ownership mismatch');
  if (existing && PROTECTED_DRAFT_STATUSES.has(existing.status || 'pending')) {
    return { ...toDraftResponse(existing), locked: existing.status === 'confirming' };
  }

  const draft = toDraftData({
    ...asset,
    sourceAssetKey,
    processingToken: context.token,
  }, openid);
  const data = {
    ...draft,
    _openid: openid,
    sourceImageId: context.imageId,
    sourceAssetKey,
    processingToken: context.token,
    updatedAt: nowIso(),
  };
  if (!existing) data.createdAt = draft.createdAt || nowIso();
  else data.createdAt = existing.createdAt || draft.createdAt || nowIso();

  await ref.set({ data });
  return toDraftResponse({ ...data, _id: draftId });
}

function normalizeSourceAssetKey(value) {
  const raw = String(value || '').trim();
  const normalized = raw.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return normalized || 'asset-0';
}

function createProcessingToken() {
  return crypto.randomBytes(16).toString('hex');
}

function isProcessingStale(image) {
  const heartbeatAt = Date.parse(image.processingHeartbeatAt || image.processingStartedAt || image.updatedAt || '');
  return !Number.isFinite(heartbeatAt) || Date.now() - heartbeatAt >= PROCESSING_STALE_MS;
}

function buildSupersededResult(imageId, reason) {
  return {
    success: true,
    status: 'superseded',
    imageId,
    reason: reason || 'token_mismatch',
    drafts: [],
  };
}

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
