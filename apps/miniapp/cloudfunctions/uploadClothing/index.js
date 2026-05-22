const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event = {}) => {
  try {
    const { OPENID } = cloud.getWXContext();
    if (!event.fileID) throw new Error('fileID is required');

    const now = new Date().toISOString();
    const category = event.category || 'other';
    const clothing = {
      _openid: OPENID,
      originalImageUrl: event.fileID,
      displayImageUrl: event.fileID,
      category,
      colorPalette: [],
      styleTags: [],
      seasonTags: [],
      sceneTags: [],
      materialGuess: '',
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
    return ok(toClothing({ ...clothing, _id: addRes._id }));
  } catch (error) {
    console.error('[uploadClothing] failed', error);
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
    category: item.category || 'other',
    subcategory: item.subcategory,
    colorPalette: item.colorPalette || [],
    styleTags: item.styleTags || [],
    seasonTags: item.seasonTags || [],
    material: item.material,
    materialGuess: item.materialGuess,
    sceneTags: item.sceneTags || [],
    aiStatus: item.aiStatus || 'pending',
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
