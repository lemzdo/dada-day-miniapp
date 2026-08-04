const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const CONFIRM_CONCURRENCY = 3;
const {
  normalizeAestheticFeaturesV1,
  normalizeColorPaletteV1,
} = require('./aestheticFeatures');
const {
  buildWardrobeCapacity,
  resolveWardrobeEntitlement,
} = require('./services/wardrobeCapacity');
const {
  WARDROBE_CAPACITY_EXCEEDED,
  buildCapacityExceededResult,
  buildHeartbeatPatch,
  buildLockPatch,
  buildReleasePatch,
  createCapacityBusyError,
  createCapacityExceededError,
  createLockOwner,
  getDraftsThatNeedNewClothes,
  resolveLockState,
  shouldReleaseCapacityLock,
} = require('./services/capacityGate');
const { deriveConfirmableSceneTags } = require('./shared/sceneEligibilityFacts');

exports.main = async (event = {}) => {
  const startedAt = Date.now();
  try {
    const { OPENID } = cloud.getWXContext();
    const batchId = event.batchId;
    if (!batchId) throw new Error('batchId is required');

    const batchRes = await db.collection('upload_batches').doc(batchId).get();
    if (!batchRes.data || batchRes.data._openid !== OPENID) throw new Error('batch not found');
    const batchStatus = normalizeUploadBatchStatus(batchRes.data.status);
    if (batchStatus === 'discarded') throw new Error('batch already discarded');
    if (batchStatus === 'saved') return ok({ list: [], count: 0, batchStatus: 'saved' });

    const updates = Array.isArray(event.drafts) ? event.drafts : [];
    const selectedIds = getSelectedIds(event, updates);
    const selectedIdSet = new Set(selectedIds);
    const beforeDraftsRes = await db.collection('clothes_drafts').where({ batchId, _openid: OPENID }).get();
    const draftTotal = beforeDraftsRes.data ? beforeDraftsRes.data.length : 0;

    console.log('[confirmClothesDrafts] request', {
      batchId,
      selectedIds,
      draftTotal,
      payloadDraftCount: updates.length,
    });

    if (selectedIds.length === 0) {
      throw new Error('no confirmable drafts');
    }

    const capacityLease = await acquireWardrobeCapacityLease(OPENID);
    try {
      const capacityGate = await assertConfirmCapacity({
        openid: OPENID,
        batchId,
        selectedIds,
      });

    await mapWithConcurrency(updates, CONFIRM_CONCURRENCY, (draft) => updateDraftFromInput(draft, OPENID));

    const draftRes = await db.collection('clothes_drafts').where({ batchId, _openid: OPENID }).get();
    const allDrafts = draftRes.data || [];
    const confirmableDrafts = allDrafts.filter((draft) => (
      draft.status === 'pending'
      && selectedIdSet.has(draft._id)
    ));
    const discardedDrafts = allDrafts.filter((draft) => (
      draft.status === 'pending'
      && !selectedIdSet.has(draft._id)
    ));

    console.log('[confirmClothesDrafts] filter result', {
      batchId,
      selectedIds,
      draftTotal: allDrafts.length,
      filteredSaveCount: confirmableDrafts.length,
      discardedCount: discardedDrafts.length,
      requestedCapacityCount: capacityGate.requested,
    });

    if (confirmableDrafts.length === 0) {
      throw new Error('no confirmable drafts');
    }

    await heartbeatWardrobeCapacityLease(capacityLease).catch(() => false);
    const confirmResults = await mapWithConcurrency(
      confirmableDrafts,
      CONFIRM_CONCURRENCY,
      (draft) => confirmSingleDraft(OPENID, draft),
    );
    await heartbeatWardrobeCapacityLease(capacityLease).catch(() => false);
    const created = confirmResults
      .filter((item) => item && item.clothing)
      .map((item) => item.clothing);
    const actualCreatedCount = confirmResults.filter((item) => item && item.created).length;
    const skippedDuplicateCount = confirmResults.filter((item) => item && item.duplicate).length;
    const failedCount = confirmResults.filter((item) => item && item.failed).length;

    await Promise.all(discardedDrafts.map((draft) => (
      db.collection('clothes_drafts').doc(draft._id).update({
        data: {
          selected: false,
          status: 'discarded',
          updatedAt: nowIso(),
        },
      }).catch(() => undefined)
    )));

    const remainingDraftRes = await db.collection('clothes_drafts').where({
      batchId,
      _openid: OPENID,
      status: 'pending',
    }).get();
    const remainingPendingCount = remainingDraftRes.data ? remainingDraftRes.data.length : 0;
    if (created.length > 0 && remainingPendingCount === 0) {
      await db.collection('upload_batches').doc(batchId).update({
        data: {
          status: 'saved',
          errorMessage: '',
          summaryMessage: `已保存 ${created.length} 件衣服到衣柜`,
          updatedAt: nowIso(),
        },
      });
    }

    console.log('[confirmClothesDrafts] confirmed', {
      batchId,
      selectedIds,
      draftTotal: allDrafts.length,
      filteredSaveCount: confirmableDrafts.length,
      actualCreatedCount,
      returnedCount: created.length,
      skippedDuplicateCount,
      failedCount,
      durationMs: Date.now() - startedAt,
      concurrency: CONFIRM_CONCURRENCY,
    });

    if (created.length === 0 && failedCount > 0) {
      throw new Error('confirm drafts failed');
    }

    const finalCapacity = await getCurrentWardrobeCapacity(OPENID);

    return ok({
      list: created,
      count: created.length,
      skippedDuplicateCount,
      actualCreatedCount,
      failedCount,
      capacity: finalCapacity,
    });
    } finally {
      await releaseWardrobeCapacityLease(capacityLease).catch(() => undefined);
    }
  } catch (error) {
    console.error('[confirmClothesDrafts] failed', error);
    return fail(error);
  }
};

function getSelectedIds(event, updates) {
  const rawIds = Array.isArray(event.selectedIds)
    ? event.selectedIds
    : updates
      .filter((draft) => draft && draft.status !== 'discarded' && draft.checked !== false && draft.selected !== false)
      .map((draft) => draft.id);

  return Array.from(new Set(
    rawIds
      .filter((id) => typeof id === 'string')
      .map((id) => id.trim())
      .filter(Boolean),
  ));
}

async function findExistingClothing(openid, draft) {
  const bySourceRes = await db.collection('clothes').where({
    _openid: openid,
    sourceItemId: draft._id,
  }).limit(1).get();
  if (bySourceRes.data && bySourceRes.data[0]) return bySourceRes.data[0];

  const byDocId = await db.collection('clothes').doc(draft._id).get().catch(() => null);
  if (byDocId && byDocId.data && byDocId.data._openid === openid) return byDocId.data;

  return null;
}

async function assertConfirmCapacity({ openid, batchId, selectedIds }) {
  const draftRes = await db.collection('clothes_drafts').where({ batchId, _openid: openid }).get();
  const allDrafts = draftRes.data || [];
  const existingClothes = await loadExistingClothesForDraftIds(openid, selectedIds);
  const draftsNeedingClothes = getDraftsThatNeedNewClothes({
    drafts: allDrafts,
    selectedIds,
    existingClothes,
  });
  const requested = draftsNeedingClothes.length;
  const capacity = await getCurrentWardrobeCapacity(openid);

  if (capacity.used + requested > capacity.limit) {
    const result = buildCapacityExceededResult({ capacity, requested });
    throw createCapacityExceededError(result);
  }

  return {
    capacity,
    requested,
  };
}

async function loadExistingClothesForDraftIds(openid, selectedIds) {
  if (!selectedIds.length) return [];
  const queryLimit = Math.min(selectedIds.length, 100);
  const sourceRes = await db.collection('clothes').where({
    _openid: openid,
    sourceItemId: _.in(selectedIds),
  }).limit(queryLimit).get();
  const docRes = await db.collection('clothes').where({
    _openid: openid,
    _id: _.in(selectedIds),
  }).limit(queryLimit).get();
  const map = new Map();
  for (const item of [...(sourceRes.data || []), ...(docRes.data || [])]) {
    if (item && item._id) map.set(item._id, item);
  }
  return Array.from(map.values());
}

async function getCurrentWardrobeCapacity(openid) {
  const [activeCountRes, userRes] = await Promise.all([
    db.collection('clothes').where({ _openid: openid, status: 'active' }).count(),
    db.collection('users').where({ _openid: openid }).limit(1).get(),
  ]);
  const entitlement = resolveWardrobeEntitlement(userRes.data && userRes.data[0]);
  return buildWardrobeCapacity({ used: activeCountRes.total, ...entitlement });
}

async function acquireWardrobeCapacityLease(openid) {
  const owner = createLockOwner();
  const user = await findUserDocument(openid);
  if (!user) throw new Error('user not found');

  const result = await mutateUserLock(user._id, (current) => {
    const lockState = resolveLockState(current, owner);
    if (lockState.action === 'busy') return { busy: true };
    return {
      data: buildLockPatch(owner),
      action: lockState.action,
    };
  });

  if (!result || result.busy) throw createCapacityBusyError();
  return {
    userId: user._id,
    owner,
  };
}

async function heartbeatWardrobeCapacityLease(lease) {
  if (!lease) return false;
  const result = await mutateUserLock(lease.userId, (current) => {
    if (!shouldReleaseCapacityLock(current, lease.owner)) return { skipped: true };
    return { data: buildHeartbeatPatch(lease.owner) };
  });
  return Boolean(result && !result.skipped);
}

async function releaseWardrobeCapacityLease(lease) {
  if (!lease) return false;
  const result = await mutateUserLock(lease.userId, (current) => {
    if (!shouldReleaseCapacityLock(current, lease.owner)) return { skipped: true };
    return { data: buildReleasePatch() };
  });
  return Boolean(result && !result.skipped);
}

async function findUserDocument(openid) {
  const res = await db.collection('users').where({ _openid: openid }).limit(1).get();
  return res.data && res.data[0] ? res.data[0] : null;
}

async function mutateUserLock(userId, resolvePatch) {
  if (typeof db.runTransaction === 'function') {
    return db.runTransaction(async (transaction) => {
      const users = transaction.collection('users');
      const currentRes = await users.doc(userId).get();
      const current = currentRes.data;
      if (!current) throw new Error('user not found');
      const patch = resolvePatch(current);
      if (!patch || patch.busy || patch.skipped) return patch;
      await users.doc(userId).update({ data: patch.data });
      return patch;
    });
  }

  const users = db.collection('users');
  const currentRes = await users.doc(userId).get();
  const current = currentRes.data;
  if (!current) throw new Error('user not found');
  const patch = resolvePatch(current);
  if (!patch || patch.busy || patch.skipped) return patch;
  await users.doc(userId).update({ data: patch.data });
  return patch;
}

async function confirmSingleDraft(openid, draft) {
  const startedAt = Date.now();
  try {
    const existing = await findExistingClothing(openid, draft);
    if (existing) {
      await markDraftConfirmed(draft._id, existing._id);
      return {
        clothing: toClothing(existing),
        duplicate: true,
        created: false,
        failed: false,
      };
    }

    const reserved = await reserveDraftForConfirm(draft._id, openid);
    if (!reserved) {
      const existingAfterReserve = await findExistingClothing(openid, draft);
      return {
        clothing: existingAfterReserve ? toClothing(existingAfterReserve) : null,
        duplicate: true,
        created: false,
        failed: false,
      };
    }

    const clothing = buildClothingFromDraft(draft, openid);
    const thumbnailUrl = await createThumbnailForClothing(clothing, draft._id).catch((error) => {
      console.warn('[confirmClothesDrafts] create thumbnail failed', {
        draftId: draft._id,
        imageUrl: resolveThumbnailSourceImage(clothing),
        message: getErrorMessage(error),
      });
      return '';
    });
    if (thumbnailUrl) clothing.thumbnailUrl = thumbnailUrl;
    await db.collection('clothes').doc(draft._id).set({ data: clothing });
    await markDraftConfirmed(draft._id, draft._id);

    console.log('[confirmClothesDrafts] draft confirmed', {
      draftId: draft._id,
      durationMs: Date.now() - startedAt,
      created: true,
      thumbnailCreated: Boolean(thumbnailUrl),
    });

    return {
      clothing: toClothing({ ...clothing, _id: draft._id }),
      duplicate: false,
      created: true,
      failed: false,
    };
  } catch (error) {
    const message = getErrorMessage(error);
    console.warn('[confirmClothesDrafts] draft confirm failed', {
      draftId: draft && draft._id,
      durationMs: Date.now() - startedAt,
      message,
    });
    await releaseDraftConfirmReservation(draft._id, openid, message).catch(() => undefined);
    return {
      clothing: null,
      duplicate: false,
      created: false,
      failed: true,
      errorMessage: message,
    };
  }
}

async function reserveDraftForConfirm(draftId, openid) {
  const res = await db.collection('clothes_drafts').where({
    _id: draftId,
    _openid: openid,
    status: 'pending',
  }).update({
    data: {
      selected: true,
      status: 'confirming',
      updatedAt: nowIso(),
    },
  });

  return getUpdatedCount(res) > 0;
}

async function releaseDraftConfirmReservation(draftId, openid, message) {
  await db.collection('clothes_drafts').where({
    _id: draftId,
    _openid: openid,
    status: 'confirming',
  }).update({
    data: {
      status: 'pending',
      selected: true,
      errorMessage: message || '',
      updatedAt: nowIso(),
    },
  });
}

function getUpdatedCount(res) {
  if (!res) return 0;
  if (res.stats && typeof res.stats.updated === 'number') return res.stats.updated;
  if (typeof res.updated === 'number') return res.updated;
  return 0;
}

async function markDraftConfirmed(draftId, clothingId) {
  await db.collection('clothes_drafts').doc(draftId).update({
    data: {
      selected: true,
      status: 'confirmed',
      clothingId,
      updatedAt: nowIso(),
    },
  });
}

async function updateDraftFromInput(input, openid) {
  if (!input || !input.id) return;
  const current = await db.collection('clothes_drafts').doc(input.id).get().catch(() => null);
  if (!current || !current.data || current.data._openid !== openid || current.data.status !== 'pending') return;

  const data = { updatedAt: nowIso() };
  const fields = [
    'assetVersion',
    'originalImageUrl',
    'normalizedImageUrl',
    'cropImageUrl',
    'croppedImageUrl',
    'maskImageUrl',
    'cleanImageUrl',
    'imageUrl',
    'assetStatus',
    'qualityScore',
    'needsUserConfirm',
    'confirmReasons',
    'bbox',
    'cropBox',
    'itemIndex',
    'stageStatus',
    'providerTrace',
    'type',
    'categoryName',
    'color',
    'colors',
    'material',
    'thickness',
    'style',
    'styleTags',
    'seasonTags',
    'selected',
    'displayImageUrl',
    'imageSourceType',
    'aiSegmentImageUrl',
    'manualCropImageUrl',
    'manualCropStatus',
  ];
  fields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(input, field)) data[field] = input[field];
  });

  if (data.imageSourceType === 'original') data.displayImageUrl = current.data.originalImageUrl;
  if (data.imageSourceType === 'clean') data.displayImageUrl = current.data.cleanImageUrl || input.cleanImageUrl || current.data.aiSegmentImageUrl || current.data.originalImageUrl;
  if (data.imageSourceType === 'crop') data.displayImageUrl = current.data.cropImageUrl || input.cropImageUrl || current.data.croppedImageUrl || current.data.manualCropImageUrl || current.data.originalImageUrl;
  if (data.imageSourceType === 'ai_segment') data.displayImageUrl = current.data.aiSegmentImageUrl || current.data.cleanImageUrl || input.aiSegmentImageUrl || current.data.originalImageUrl;
  if (data.imageSourceType === 'manual_crop') data.displayImageUrl = current.data.manualCropImageUrl || input.manualCropImageUrl || current.data.originalImageUrl;

  await db.collection('clothes_drafts').doc(input.id).update({ data });
}

async function mapWithConcurrency(items, limit, worker) {
  const source = Array.isArray(items) ? items : [];
  const results = new Array(source.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, Number(limit) || 1), source.length || 1);

  async function runWorker() {
    while (nextIndex < source.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(source[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results;
}

function buildClothingFromDraft(draft, openid) {
  const now = nowIso();
  const color = draft.color || (Array.isArray(draft.colors) ? draft.colors[0] : '');
  const draftColors = normalizeDraftColors(draft.colors, color);
  const colorPalette = normalizeDraftColorPalette(draft.colorPalette, draftColors);
  const colors = colorPalette.length > 0 ? colorsFromColorPalette(colorPalette) : draftColors;
  const styleTags = Array.isArray(draft.styleTags) && draft.styleTags.length > 0 ? draft.styleTags : (draft.style ? [draft.style] : []);
  const displayImageUrl = resolveDisplayImage(draft);
  const imageSourceType = resolveImageSourceType(draft, displayImageUrl);
  const aestheticFeatures = normalizeDraftAestheticFeatures(draft, now);
  const sceneTags = deriveConfirmableSceneTags({
    category: draft.type || 'other',
    subcategory: draft.categoryName || '',
    subCategory: draft.categoryName || '',
    type: draft.type || 'other',
    styleTags,
    sceneTags: Array.isArray(draft.sceneTags) ? draft.sceneTags : [],
    material: draft.material || '',
    thickness: draft.thickness || '',
    fit: draft.fit || '',
    sleeveLength: draft.sleeveLength || '',
    length: draft.length || '',
    footwearType: draft.footwearType || draft.shoeType || '',
    aestheticFeatures,
    capabilities: draft.capabilities || [],
  });
  return {
    _openid: openid,
    userId: openid,
    assetVersion: draft.assetVersion || 'v2',
    batchId: draft.batchId,
    sourceImageId: draft.sourceImageId,
    itemIndex: draft.itemIndex || 0,
    originalImageUrl: draft.originalImageUrl,
    normalizedImageUrl: draft.normalizedImageUrl || draft.originalImageUrl,
    cropImageUrl: draft.cropImageUrl || draft.croppedImageUrl || '',
    croppedImageUrl: draft.croppedImageUrl || draft.cropImageUrl || '',
    maskImageUrl: draft.maskImageUrl || '',
    cleanImageUrl: draft.cleanImageUrl || draft.aiSegmentImageUrl || '',
    imageUrl: displayImageUrl,
    displayImageUrl,
    imageSourceType,
    assetStatus: draft.assetStatus || 'needs_review',
    qualityScore: draft.qualityScore || 0,
    needsUserConfirm: draft.needsUserConfirm !== false,
    confirmReasons: draft.confirmReasons || [],
    sourceBatchId: draft.batchId,
    sourceItemId: draft._id,
    bbox: draft.bbox || draft.cropBox || null,
    cropBox: draft.cropBox || draft.bbox || null,
    stageStatus: draft.stageStatus || null,
    providerTrace: draft.providerTrace || [],
    aiSegmentImageUrl: draft.aiSegmentImageUrl || draft.cleanImageUrl || '',
    manualCropImageUrl: draft.manualCropImageUrl || '',
    category: draft.type || 'other',
    subcategory: draft.categoryName || '',
    subCategory: draft.categoryName || '',
    type: draft.type || 'other',
    categoryName: draft.categoryName || '',
    colors,
    colorPalette,
    aestheticFeatures,
    styleTags,
    seasonTags: Array.isArray(draft.seasonTags) ? draft.seasonTags : [],
    sceneTags,
    material: draft.material || '',
    materialGuess: draft.material || '',
    thickness: draft.thickness || '',
    aiRecognizeStatus: draft.detectStatus || 'success',
    detectStatus: draft.detectStatus || 'success',
    cutoutStatus: draft.segmentStatus || 'not_started',
    segmentStatus: draft.segmentStatus || 'not_started',
    manualCropStatus: draft.manualCropStatus || 'unsupported',
    aiProvider: draft.detectProvider || 'bailian',
    detectProvider: draft.detectProvider || 'bailian',
    detectModel: draft.detectModel || 'qwen3-vl-flash',
    segmentProvider: draft.segmentProvider || 'aliyun_viapi',
    segmentModel: draft.segmentModel || 'SegmentCloth',
    aiRawResult: draft.aiRawResult || null,
    aiStatus: 'recognized',
    aiConfidence: draft.confidence || 0,
    confidence: draft.confidence || 0,
    manualFields: [],
    capacityCost: 1,
    status: 'active',
    usageCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function resolveDisplayImage(draft) {
  return draft.cleanImageUrl
    || draft.cropImageUrl
    || draft.displayImageUrl
    || draft.imageUrl
    || draft.aiSegmentImageUrl
    || draft.croppedImageUrl
    || draft.manualCropImageUrl
    || draft.originalImageUrl
    || '';
}

function resolveThumbnailSourceImage(item) {
  return item.displayImageUrl
    || item.cleanImageUrl
    || item.aiSegmentImageUrl
    || item.cropImageUrl
    || item.croppedImageUrl
    || item.imageUrl
    || item.manualCropImageUrl
    || '';
}

async function createThumbnailForClothing(item, draftId) {
  const sourceImageUrl = resolveThumbnailSourceImage(item);
  if (!sourceImageUrl) return '';

  const sourceBuffer = await downloadImageSource(sourceImageUrl);
  const Jimp = require('jimp');
  const image = await Jimp.read(sourceBuffer);
  image.scaleToFit(360, 360).quality(76);
  const buffer = await image.getBufferAsync(Jimp.MIME_JPEG);
  const cloudPath = `wardrobe_uploads/thumbnails/${item.batchId || 'confirmed'}/${draftId}.jpg`;
  const uploadRes = await cloud.uploadFile({ cloudPath, fileContent: buffer });
  if (!uploadRes.fileID) throw new Error('thumbnail upload returned empty fileID');
  return uploadRes.fileID;
}

async function downloadImageSource(fileID) {
  if (fileID && typeof fileID === 'string' && /^https?:\/\//.test(fileID)) {
    const fetch = require('node-fetch');
    const response = await fetch(fileID, { timeout: getImageFetchTimeoutMs() });
    if (!response.ok) throw new Error(`download_image_failed_${response.status}`);
    return response.buffer();
  }
  if (!fileID || typeof fileID !== 'string' || !fileID.startsWith('cloud://')) {
    throw new Error('image must be a WeChat cloud fileID or http url');
  }
  const res = await cloud.downloadFile({ fileID });
  const buffer = res && res.fileContent;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('downloaded image is empty');
  }
  return buffer;
}

function getImageFetchTimeoutMs() {
  return Number(process.env.IMAGE_FETCH_TIMEOUT_MS || process.env.AI_TIMEOUT_MS || 30000);
}

function resolveImageSourceType(draft, displayImageUrl) {
  if (draft.imageSourceType === 'clean' && (draft.cleanImageUrl || draft.aiSegmentImageUrl)) return 'clean';
  if (draft.imageSourceType === 'crop' && (draft.cropImageUrl || draft.croppedImageUrl || draft.manualCropImageUrl)) return 'crop';
  if (displayImageUrl === draft.cleanImageUrl && draft.cleanImageUrl) return 'clean';
  if (displayImageUrl === draft.cropImageUrl && draft.cropImageUrl) return 'crop';
  if (draft.imageSourceType === 'ai_segment' && draft.aiSegmentImageUrl) return 'ai_segment';
  if (draft.imageSourceType === 'manual_crop' && draft.manualCropImageUrl) return 'manual_crop';
  if (displayImageUrl === draft.aiSegmentImageUrl && draft.aiSegmentImageUrl) return 'ai_segment';
  if (displayImageUrl === draft.manualCropImageUrl && draft.manualCropImageUrl) return 'manual_crop';
  return 'original';
}

function toClothing(item) {
  const originalImageUrl = item.originalImageUrl || '';
  const displayImageUrl = item.displayImageUrl || originalImageUrl;
  return {
    id: item._id,
    userId: item.userId || item._openid,
    batchId: item.batchId,
    sourceBatchId: item.sourceBatchId || item.batchId,
    sourceItemId: item.sourceItemId,
    sourceImageId: item.sourceImageId,
    assetVersion: item.assetVersion || 'v2',
    itemIndex: item.itemIndex || 0,
    originalImageUrl,
    normalizedImageUrl: item.normalizedImageUrl || originalImageUrl,
    cropImageUrl: item.cropImageUrl || item.croppedImageUrl || '',
    croppedImageUrl: item.croppedImageUrl || item.cropImageUrl || '',
    maskImageUrl: item.maskImageUrl || '',
    cleanImageUrl: item.cleanImageUrl || item.aiSegmentImageUrl || '',
    thumbnailUrl: item.thumbnailUrl || '',
    imageUrl: item.imageUrl || displayImageUrl,
    displayImageUrl,
    imageSourceType: item.imageSourceType || 'original',
    assetStatus: item.assetStatus || 'needs_review',
    qualityScore: item.qualityScore || 0,
    needsUserConfirm: item.needsUserConfirm !== false,
    confirmReasons: item.confirmReasons || [],
    bbox: item.bbox || item.cropBox,
    stageStatus: item.stageStatus,
    providerTrace: item.providerTrace || [],
    aiSegmentImageUrl: item.aiSegmentImageUrl || '',
    manualCropImageUrl: item.manualCropImageUrl || '',
    confidence: item.confidence || item.aiConfidence || 0,
    cutoutStatus: item.cutoutStatus || item.segmentStatus || 'not_started',
    segmentStatus: item.segmentStatus || item.cutoutStatus || 'not_started',
    manualCropStatus: item.manualCropStatus || 'unsupported',
    aiRecognizeStatus: item.aiRecognizeStatus || item.detectStatus || 'success',
    detectStatus: item.detectStatus || item.aiRecognizeStatus || 'success',
    aiProvider: item.aiProvider || item.detectProvider,
    detectProvider: item.detectProvider || item.aiProvider,
    detectModel: item.detectModel,
    segmentProvider: item.segmentProvider,
    segmentModel: item.segmentModel,
    aiRawResult: item.aiRawResult,
    category: item.category || 'other',
    subcategory: item.subcategory || item.subCategory,
    subCategory: item.subCategory || item.subcategory,
    colors: item.colors || [],
    colorPalette: item.colorPalette || [],
    aestheticFeatures: item.aestheticFeatures,
    styleTags: item.styleTags || [],
    seasonTags: item.seasonTags || [],
    material: item.material,
    materialGuess: item.materialGuess,
    thickness: item.thickness,
    sceneTags: item.sceneTags || [],
    aiStatus: item.aiStatus || 'recognized',
    aiConfidence: item.aiConfidence || 0,
    manualFields: item.manualFields || [],
    customTags: item.customTags || [],
    capacityCost: item.capacityCost || 1,
    status: item.status || 'active',
    usageCount: item.usageCount || 0,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function normalizeDraftAestheticFeatures(draft, fallbackRecognizedAt) {
  return normalizeAestheticFeaturesV1(draft && draft.aestheticFeatures, {
    category: draft && (draft.type || draft.category),
    subcategory: draft && (draft.categoryName || draft.subCategory || draft.subcategory),
    provider: draft && (draft.aestheticFeatures && draft.aestheticFeatures.provider || draft.detectProvider || draft.aiProvider),
    model: draft && (draft.aestheticFeatures && draft.aestheticFeatures.model || draft.detectModel),
    recognizedAt: draft && (draft.aestheticFeatures && draft.aestheticFeatures.recognizedAt || draft.updatedAt || fallbackRecognizedAt),
  });
}

function normalizeDraftColorPalette(rawColorPalette, fallbackColors) {
  const normalized = normalizeColorPaletteV1(rawColorPalette);
  if (normalized.length > 0) return normalized;
  return normalizeColorPaletteV1(fallbackColors);
}

function normalizeDraftColors(value, fallbackColor) {
  const colors = Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : [];
  if (colors.length > 0) return colors;
  return typeof fallbackColor === 'string' && fallbackColor.trim() ? [fallbackColor.trim()] : [];
}

function colorsFromColorPalette(colorPalette) {
  return Array.isArray(colorPalette)
    ? colorPalette
      .map((item) => item && typeof item.name === 'string' ? item.name.trim() : '')
      .filter(Boolean)
    : [];
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeUploadBatchStatus(rawStatus) {
  if (rawStatus === 'success' || rawStatus === 'partial_success' || rawStatus === 'completed') return 'ready';
  if (rawStatus === 'empty' || rawStatus === 'partial_failed') return 'failed';
  if (rawStatus === 'discarded') return 'discarded';
  if (rawStatus === 'saved') return 'saved';
  if (rawStatus === 'failed') return 'failed';
  return 'processing';
}

function ok(data) {
  return { code: 0, data, message: 'ok' };
}

function fail(error) {
  if (error && error.businessCode === WARDROBE_CAPACITY_EXCEEDED && error.capacityResult) {
    return { code: 1, data: error.capacityResult, message: error.message };
  }
  if (error && error.businessCode) {
    return {
      code: 1,
      data: {
        ok: false,
        code: error.businessCode,
      },
      message: error.message || 'unknown error',
    };
  }
  return { code: 1, data: null, message: error && error.message ? error.message : 'unknown error' };
}

function getErrorMessage(error) {
  return error && error.message ? error.message : String(error || 'unknown error');
}

if (process.env.NODE_ENV === 'test') {
  exports.__test = { buildClothingFromDraft };
}
