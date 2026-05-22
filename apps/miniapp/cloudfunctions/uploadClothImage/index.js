const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event = {}) => {
  try {
    const { OPENID } = cloud.getWXContext();
    if (!event.fileID) throw new Error('fileID is required');

    const now = new Date().toISOString();
    const category = event.category || '其他';
    const clothing = {
      _openid: OPENID,
      originalImageUrl: event.fileID,
      displayImageUrl: event.fileID,
      category,
      subCategory: '',
      subcategory: '',
      colors: [],
      colorPalette: [],
      styleTags: [],
      seasonTags: [],
      sceneTags: [],
      material: '未知',
      materialGuess: '未知',
      thickness: '未知',
      warmthScore: 0,
      coolnessScore: 0,
      fashionScore: 0,
      matchTips: '',
      cutoutStatus: 'pending',
      cutoutProvider: 'none',
      cutoutError: '',
      aiRecognizeStatus: 'pending',
      aiProvider: 'bailian_qwen_vl',
      aiError: '',
      aiStatus: 'pending',
      aiConfidence: 0,
      manualFields: [],
      capacityCost: 1,
      status: 'active',
      usageCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    const addRes = await db.collection('clothes').add({ data: clothing });
    return ok({
      clothId: addRes._id,
      clothingId: addRes._id,
      originalImageUrl: event.fileID,
      item: toClothing({ ...clothing, _id: addRes._id }),
    });
  } catch (error) {
    console.error('[uploadClothImage] failed', error);
    return fail(error);
  }
};

function toClothing(item) {
  const originalImageUrl = getOriginalImage(item);
  const displayImageUrl = getDisplayImage(item);
  return {
    id: item._id,
    userId: item._openid,
    originalImageUrl,
    displayImageUrl,
    cutoutStatus: item.cutoutStatus || 'pending',
    cutoutProvider: item.cutoutProvider || 'none',
    cutoutError: item.cutoutError,
    aiRecognizeStatus: item.aiRecognizeStatus || 'pending',
    aiProvider: item.aiProvider,
    aiError: item.aiError,
    category: item.category || '其他',
    subcategory: item.subcategory || item.subCategory,
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
    aiStatus: item.aiStatus || 'pending',
    aiConfidence: item.aiConfidence || 0,
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
