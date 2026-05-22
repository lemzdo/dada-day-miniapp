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

    const updates = Array.isArray(event.drafts) ? event.drafts : [];
    await Promise.all(updates.map((draft) => updateDraftFromInput(draft, OPENID)));

    const draftRes = await db.collection('clothes_drafts').where({
      batchId,
      _openid: OPENID,
      status: 'pending',
      selected: true,
    }).get();

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
  const fields = ['type', 'categoryName', 'color', 'colors', 'material', 'style', 'selected'];
  fields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(input, field)) data[field] = input[field];
  });
  await db.collection('clothes_drafts').doc(input.id).update({ data });
}

function buildClothingFromDraft(draft, openid) {
  const now = nowIso();
  const color = draft.color || (Array.isArray(draft.colors) ? draft.colors[0] : '');
  const colors = Array.isArray(draft.colors) && draft.colors.length > 0 ? draft.colors : (color ? [color] : []);
  return {
    _openid: openid,
    userId: openid,
    batchId: draft.batchId,
    sourceImageId: draft.sourceImageId,
    originalImageUrl: draft.originalImageUrl,
    displayImageUrl: draft.croppedImageUrl || draft.originalImageUrl,
    cropBox: draft.cropBox,
    category: draft.type || 'other',
    subcategory: draft.categoryName || '',
    subCategory: draft.categoryName || '',
    colors,
    colorPalette: colors.map((name, index) => ({ name, hex: '#8A8A8A', ratio: index === 0 ? 1 : 0 })),
    styleTags: draft.style ? [draft.style] : [],
    seasonTags: [],
    sceneTags: [],
    material: draft.material || '',
    materialGuess: draft.material || '',
    aiRecognizeStatus: 'success',
    aiProvider: 'bailian_qwen_vl',
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

function toClothing(item) {
  const originalImageUrl = item.originalImageUrl || '';
  const displayImageUrl = item.displayImageUrl || originalImageUrl;
  return {
    id: item._id,
    userId: item.userId || item._openid,
    batchId: item.batchId,
    sourceImageId: item.sourceImageId,
    originalImageUrl,
    displayImageUrl,
    cropBox: item.cropBox,
    confidence: item.confidence || item.aiConfidence || 0,
    cutoutStatus: item.cutoutStatus || 'success',
    cutoutProvider: item.cutoutProvider || 'crop_box',
    aiRecognizeStatus: item.aiRecognizeStatus || 'success',
    aiProvider: item.aiProvider,
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

function ok(data) {
  return { code: 0, data, message: 'ok' };
}

function fail(error) {
  return { code: 1, data: null, message: error && error.message ? error.message : 'unknown error' };
}
