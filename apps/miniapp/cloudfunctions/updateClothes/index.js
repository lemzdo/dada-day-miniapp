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
  'colors',
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
  'imageUrl',
  'originalImageUrl',
  'imageSourceType',
  'aiSegmentImageUrl',
  'manualCropImageUrl',
  'manualCropStatus',
  'segmentStatus',
  'segmentProvider',
  'segmentModel',
  'cutoutStatus',
  'cutoutProvider',
  'cutoutError',
  'aiRecognizeStatus',
  'detectStatus',
  'detectProvider',
  'detectModel',
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
        if (![
          'status',
          'displayImageUrl',
          'imageUrl',
          'originalImageUrl',
          'imageSourceType',
          'aiSegmentImageUrl',
          'manualCropImageUrl',
          'manualCropStatus',
          'segmentStatus',
          'segmentProvider',
          'segmentModel',
          'cutoutStatus',
          'cutoutProvider',
          'cutoutError',
          'aiRecognizeStatus',
          'detectStatus',
          'detectProvider',
          'detectModel',
          'aiError',
        ].includes(field)) {
          manualFields.add(field);
        }
      }
    });
    if (data.displayImageUrl && !data.imageUrl) {
      data.imageUrl = data.displayImageUrl;
    }
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
    imageUrl: item.imageUrl || displayImageUrl,
    originalImageUrl,
    displayImageUrl,
    imageSourceType: item.imageSourceType || 'original',
    aiSegmentImageUrl: item.aiSegmentImageUrl || '',
    manualCropImageUrl: item.manualCropImageUrl || '',
    batchId: item.batchId,
    sourceImageId: item.sourceImageId,
    cropBox: item.cropBox,
    confidence: item.confidence || item.aiConfidence || 0,
    cutoutStatus: item.cutoutStatus || item.segmentStatus || 'pending',
    segmentStatus: item.segmentStatus || item.cutoutStatus || 'not_started',
    manualCropStatus: item.manualCropStatus || 'unsupported',
    cutoutProvider: item.cutoutProvider || item.segmentProvider || 'none',
    segmentProvider: item.segmentProvider,
    segmentModel: item.segmentModel,
    cutoutError: item.cutoutError,
    aiRecognizeStatus: item.aiRecognizeStatus || item.detectStatus || 'pending',
    detectStatus: item.detectStatus || item.aiRecognizeStatus || 'pending',
    aiProvider: item.aiProvider || item.detectProvider,
    detectProvider: item.detectProvider || item.aiProvider,
    detectModel: item.detectModel,
    aiRawResult: item.aiRawResult,
    category: item.category || 'other',
    subcategory: item.subcategory,
    subCategory: item.subCategory || item.subcategory,
    colors: item.colors || [],
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
  return item.displayImageUrl
    || item.imageUrl
    || item.aiSegmentImageUrl
    || item.manualCropImageUrl
    || getOriginalImage(item);
}

function ok(data) {
  return { code: 0, data, message: 'ok' };
}

function fail(error) {
  return { code: 1, data: null, message: error && error.message ? error.message : 'unknown error' };
}
