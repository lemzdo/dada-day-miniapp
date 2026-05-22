const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const ALLOWED_FIELDS = [
  'customName',
  'customCategory',
  'customTags',
  'category',
  'subcategory',
  'styleTags',
  'seasonTags',
  'sceneTags',
  'colorPalette',
  'material',
  'materialGuess',
  'thickness',
  'warmthScore',
  'coolnessScore',
  'fashionScore',
  'matchTips',
  'status',
  'brand',
  'purchaseDate',
  'displayImageUrl',
  'originalImageUrl',
  'cutoutStatus',
  'cutoutProvider',
  'cutoutError',
  'aiRecognizeStatus',
  'aiError',
];

exports.main = async (event = {}) => {
  try {
    const { OPENID } = cloud.getWXContext();
    if (!event.id) throw new Error('id is required');

    const collection = db.collection('clothes');
    const current = await collection.doc(event.id).get();
    if (!current.data || current.data._openid !== OPENID) throw new Error('clothing not found');

    const data = {};
    const input = event.data || {};
    const manualFields = new Set(Array.isArray(current.data.manualFields) ? current.data.manualFields : []);
    ALLOWED_FIELDS.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(input, field)) {
        data[field] = input[field];
        if (!['status', 'displayImageUrl', 'originalImageUrl', 'cutoutStatus', 'cutoutProvider', 'cutoutError', 'aiRecognizeStatus', 'aiError'].includes(field)) {
          manualFields.add(field);
        }
      }
    });
    data.manualFields = Array.from(manualFields);
    data.updatedAt = new Date().toISOString();

    await collection.doc(event.id).update({ data });
    const updated = await collection.doc(event.id).get();

    return ok(toClothing(updated.data));
  } catch (error) {
    console.error('[updateClothes] failed', error);
    return fail(error);
  }
};

function toClothing(item) {
  const originalImageUrl = getOriginalImage(item);
  const displayImageUrl = getDisplayImage(item);
  return {
    id: item._id,
    userId: item._openid,
    thumbnailUrl: item.thumbnailUrl,
    originalImageUrl,
    displayImageUrl,
    batchId: item.batchId,
    sourceImageId: item.sourceImageId,
    cropBox: item.cropBox,
    confidence: item.confidence || item.aiConfidence || 0,
    cutoutStatus: item.cutoutStatus || 'pending',
    cutoutProvider: item.cutoutProvider || 'none',
    cutoutError: item.cutoutError,
    aiRecognizeStatus: item.aiRecognizeStatus || 'pending',
    aiProvider: item.aiProvider,
    aiRawResult: item.aiRawResult,
    category: item.category || 'other',
    subcategory: item.subcategory,
    colorPalette: item.colorPalette || [],
    styleTags: item.styleTags || [],
    seasonTags: item.seasonTags || [],
    material: item.material,
    materialGuess: item.materialGuess,
    thickness: item.thickness,
    warmthScore: item.warmthScore || 0,
    coolnessScore: item.coolnessScore || 0,
    fashionScore: item.fashionScore || 0,
    sceneTags: item.sceneTags || [],
    matchTips: item.matchTips,
    aiStatus: item.aiStatus || 'recognized',
    aiConfidence: item.aiConfidence || 0,
    aiError: item.aiError,
    manualFields: item.manualFields || [],
    customName: item.customName,
    customCategory: item.customCategory,
    customTags: item.customTags || [],
    capacityCost: item.capacityCost || 1,
    status: item.status || 'active',
    brand: item.brand,
    purchaseDate: item.purchaseDate,
    usageCount: item.usageCount || 0,
    lastWornAt: item.lastWornAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function getOriginalImage(item) {
  return item.originalImageUrl || '';
}

function getDisplayImage(item) {
  return item.displayImageUrl || getOriginalImage(item);
}

function ok(data) {
  return { code: 0, data, message: 'ok' };
}

function fail(error) {
  return { code: 1, data: null, message: error && error.message ? error.message : 'unknown error' };
}
