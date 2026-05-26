const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event = {}) => {
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
    await Promise.all(updates.map((draft) => updateDraftFromInput(draft, OPENID)));

    const draftRes = await db.collection('clothes_drafts').where({
      batchId,
      _openid: OPENID,
      status: 'pending',
      selected: true,
    }).get();
    if (!draftRes.data || draftRes.data.length === 0) {
      throw new Error('no confirmable drafts');
    }

    const created = [];
    for (const draft of draftRes.data) {
      const clothing = buildClothingFromDraft(draft, OPENID);
      const addRes = await db.collection('clothes').add({ data: clothing });
      await db.collection('clothes_drafts').doc(draft._id).update({
        data: {
          status: 'confirmed',
          clothingId: addRes._id,
          updatedAt: nowIso(),
        },
      });
      created.push(toClothing({ ...clothing, _id: addRes._id }));
    }

    await db.collection('clothes_drafts').where({
      batchId,
      _openid: OPENID,
      status: 'pending',
      selected: _.neq(true),
    }).update({
      data: { status: 'discarded', updatedAt: nowIso() },
    }).catch(() => undefined);

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
      count: created.length,
    });

    return ok({ list: created, count: created.length });
  } catch (error) {
    console.error('[confirmClothesDrafts] failed', error);
    return fail(error);
  }
};

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

function buildClothingFromDraft(draft, openid) {
  const now = nowIso();
  const color = draft.color || (Array.isArray(draft.colors) ? draft.colors[0] : '');
  const colors = Array.isArray(draft.colors) && draft.colors.length > 0 ? draft.colors : (color ? [color] : []);
  const styleTags = Array.isArray(draft.styleTags) && draft.styleTags.length > 0 ? draft.styleTags : (draft.style ? [draft.style] : []);
  const displayImageUrl = resolveDisplayImage(draft);
  const imageSourceType = resolveImageSourceType(draft, displayImageUrl);
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
    colorPalette: colors.map((name, index) => ({ name, hex: '#8A8A8A', ratio: index === 0 ? 1 : 0 })),
    styleTags,
    seasonTags: Array.isArray(draft.seasonTags) ? draft.seasonTags : [],
    sceneTags: [],
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
    sourceImageId: item.sourceImageId,
    assetVersion: item.assetVersion || 'v2',
    itemIndex: item.itemIndex || 0,
    originalImageUrl,
    normalizedImageUrl: item.normalizedImageUrl || originalImageUrl,
    cropImageUrl: item.cropImageUrl || item.croppedImageUrl || '',
    croppedImageUrl: item.croppedImageUrl || item.cropImageUrl || '',
    maskImageUrl: item.maskImageUrl || '',
    cleanImageUrl: item.cleanImageUrl || item.aiSegmentImageUrl || '',
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
  return { code: 1, data: null, message: error && error.message ? error.message : 'unknown error' };
}
