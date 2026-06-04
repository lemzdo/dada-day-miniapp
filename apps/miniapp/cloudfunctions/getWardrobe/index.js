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
    
    if (event.subcategoryId) {
      filter.subcategoryId = event.subcategoryId;
    } else if (event.subcategory && event.subcategory !== 'all') {
      filter.subcategory = _.in(resolveSubcategoryValues(event.subcategory));
    }

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
    imageUrl: item.imageUrl || displayImageUrl,
    assetVersion: item.assetVersion || 'v1',
    originalImageUrl,
    normalizedImageUrl: item.normalizedImageUrl || originalImageUrl,
    cropImageUrl: item.cropImageUrl || item.croppedImageUrl || '',
    croppedImageUrl: item.croppedImageUrl || item.cropImageUrl || '',
    maskImageUrl: item.maskImageUrl || '',
    cleanImageUrl: item.cleanImageUrl || item.aiSegmentImageUrl || '',
    displayImageUrl,
    imageSourceType: normalizeImageSourceType(item),
    assetStatus: item.assetStatus || 'needs_review',
    qualityScore: item.qualityScore || 0,
    needsUserConfirm: item.needsUserConfirm !== false,
    confirmReasons: item.confirmReasons || [],
    bbox: item.bbox || item.cropBox,
    stageStatus: item.stageStatus,
    providerTrace: item.providerTrace || [],
    aiSegmentImageUrl: item.aiSegmentImageUrl || item.cleanImageUrl || '',
    manualCropImageUrl: item.manualCropImageUrl || '',
    batchId: item.batchId,
    sourceBatchId: item.sourceBatchId || item.batchId,
    sourceItemId: item.sourceItemId,
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
    subcategoryId: item.subcategoryId,
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
  return item.cleanImageUrl
    || item.aiSegmentImageUrl
    || item.cropImageUrl
    || item.croppedImageUrl
    || item.displayImageUrl
    || item.imageUrl
    || item.manualCropImageUrl
    || getOriginalImage(item);
}

function normalizeImageSourceType(item) {
  if (item.imageSourceType === 'clean' || item.imageSourceType === 'crop' || item.imageSourceType === 'original') {
    return item.imageSourceType;
  }
  if (item.imageSourceType === 'ai_segment') return 'clean';
  if (item.imageSourceType === 'manual_crop') return 'crop';
  if (item.cleanImageUrl || item.aiSegmentImageUrl) return 'clean';
  if (item.cropImageUrl || item.croppedImageUrl || item.manualCropImageUrl) return 'crop';
  return 'original';
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

function resolveSubcategoryValues(subcategory) {
  const map = {
    tshirt: ['tshirt', 'T恤', '短袖'],
    shirt: ['shirt', '衬衫', '长袖'],
    sweater: ['sweater', '毛衣', '针织'],
    hoodie: ['hoodie', '卫衣'],
    jacket: ['jacket', '夹克', '外套'],
    down_jacket: ['down_jacket', '羽绒服'],
    blazer: ['blazer', '西装'],
    vest: ['vest', '马甲'],
    jeans: ['jeans', '牛仔裤'],
    trousers: ['trousers', '裤子', '长裤'],
    shorts: ['shorts', '短裤'],
    skirt: ['skirt', '裙子'],
    leggings: ['leggings', '打底裤', '紧身裤'],
    dress: ['dress', '连衣裙'],
    suit_set: ['suit_set', '套装'],
    jumpsuit: ['jumpsuit', '连体裤'],
    sneakers: ['sneakers', '运动鞋'],
    heels: ['heels', '高跟鞋'],
    boots: ['boots', '靴子'],
    sandals: ['sandals', '凉鞋'],
    loafers: ['loafers', '乐福鞋'],
    flats: ['flats', '平底鞋'],
    hat: ['hat', '帽子'],
    scarf: ['scarf', '围巾'],
    necklace: ['necklace', '项链'],
    bag: ['bag', '包包', '包'],
    glasses: ['glasses', '眼镜'],
    belt: ['belt', '腰带'],
    watch: ['watch', '手表'],
    other: ['other', '其他'],
  };
  return map[subcategory] || [subcategory];
}

function ok(data) {
  return { code: 0, data, message: 'ok' };
}

function fail(error) {
  return { code: 1, data: null, message: error && error.message ? error.message : 'unknown error' };
}
