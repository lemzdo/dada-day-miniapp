const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event = {}) => {
  try {
    const { OPENID } = cloud.getWXContext();
    const page = Math.max(Number(event.page || 1), 1);
    const pageSize = Math.min(Math.max(Number(event.pageSize || 10), 1), 50);
    const status = event.status || 'active';
    const filter = { _openid: OPENID };

    if (event.id) filter._id = event.id;
    if (status) filter.status = status;
    if (event.category && event.category !== 'all') filter.category = _.in(resolveCategoryValues(event.category));

    const collection = db.collection('clothes');
    const [totalRes, listRes, activeCountRes, userRes] = await Promise.all([
      collection.where(filter).count(),
      collection
        .where(filter)
        .orderBy('createdAt', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get(),
      collection.where({ _openid: OPENID, status: 'active' }).count(),
      db.collection('users').where({ _openid: OPENID }).limit(1).get(),
    ]);
    const capacityTotal = userRes.data[0] && userRes.data[0].capacityTotal ? userRes.data[0].capacityTotal : 50;

    return ok({
      list: listRes.data.map(toClothing),
      pagination: {
        total: totalRes.total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(totalRes.total / pageSize)),
      },
      capacity: {
        total: capacityTotal,
        used: activeCountRes.total,
        remaining: Math.max(0, capacityTotal - activeCountRes.total),
      },
    });
  } catch (error) {
    console.error('[getWardrobe] failed', error);
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
  return item.displayImageUrl || getOriginalImage(item);
}

function resolveCategoryValues(category) {
  const map = {
    top: ['top', '上衣', '外套'],
    bottom: ['bottom', '裤子', '裙子'],
    onepiece: ['onepiece', '连衣裙'],
    shoes: ['shoes', '鞋子'],
    accessory: ['accessory', '包', '帽子', '配饰'],
    other: ['other', '其他'],
  };
  return map[category] || [category];
}

function ok(data) {
  return { code: 0, data, message: 'ok' };
}

function fail(error) {
  return { code: 1, data: null, message: error && error.message ? error.message : 'unknown error' };
}
