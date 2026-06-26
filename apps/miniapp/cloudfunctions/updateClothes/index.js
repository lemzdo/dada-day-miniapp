const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const ALLOWED_FIELDS = [
  'customName',
  'customCategory',
  'customTags',
  'category',
  'subcategory',
  'subcategoryId',
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
  'normalizedImageUrl',
  'cropImageUrl',
  'croppedImageUrl',
  'maskImageUrl',
  'cleanImageUrl',
  'imageSourceType',
  'assetVersion',
  'assetStatus',
  'qualityScore',
  'needsUserConfirm',
  'confirmReasons',
  'bbox',
  'stageStatus',
  'providerTrace',
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

const ATTRIBUTE_ALIAS_GROUPS = {
  category: ['category', 'type'],
  subcategory: ['subcategory', 'subCategory', 'categoryName'],
  colorPalette: ['colorPalette', 'colors', 'color'],
  material: ['material', 'materialGuess'],
  styleTags: ['styleTags', 'style'],
  seasonTags: ['seasonTags'],
  sceneTags: ['sceneTags'],
  thickness: ['thickness'],
};

const SYSTEM_FIELDS = [
  'status',
  'displayImageUrl',
  'imageUrl',
  'originalImageUrl',
  'normalizedImageUrl',
  'cropImageUrl',
  'croppedImageUrl',
  'maskImageUrl',
  'cleanImageUrl',
  'imageSourceType',
  'assetVersion',
  'assetStatus',
  'qualityScore',
  'needsUserConfirm',
  'confirmReasons',
  'bbox',
  'stageStatus',
  'providerTrace',
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

const PROTECTED_AESTHETIC_FIELD = 'aestheticFeatures';

const ATTRIBUTE_ALIAS_FIELDS = Object.keys(ATTRIBUTE_ALIAS_GROUPS)
  .reduce((fields, key) => fields.concat(ATTRIBUTE_ALIAS_GROUPS[key]), []);

exports.main = async (event = {}) => {
  try {
    const { OPENID } = cloud.getWXContext();
    if (!event.id) throw new Error('id is required');

    const collection = db.collection('clothes');
    const current = await collection.doc(event.id).get();
    if (!current.data || current.data._openid !== OPENID) throw new Error('clothing not found');

    const data = {};
    const input = removeProtectedAestheticFields(event.data || {});
    const manualFields = new Set(Array.isArray(current.data.manualFields) ? current.data.manualFields : []);
    ALLOWED_FIELDS.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(input, field)) {
        if (ATTRIBUTE_ALIAS_FIELDS.includes(field)) return;
        data[field] = input[field];
        if (!SYSTEM_FIELDS.includes(field)) {
          manualFields.add(field);
        }
      }
    });

    const attributePatch = normalizeClothingAttributes(input);
    Object.keys(attributePatch).forEach((field) => {
      if (!isEmptyAttributeValue(attributePatch[field])) {
        data[field] = attributePatch[field];
      }
    });

    if (Object.prototype.hasOwnProperty.call(data, 'material')) {
      data.material = await resolveMaterialNameForStorage(data.material, OPENID);
    }
    Object.assign(data, buildClothingAttributeMirrorPatch(data));

    getCanonicalManualFields(input).forEach((field) => manualFields.add(field));
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
  const attributes = normalizeClothingAttributes(item);
  const mirrors = buildClothingAttributeMirrorPatch(attributes);
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
    category: attributes.category || 'other',
    subcategory: attributes.subcategory,
    subCategory: mirrors.subCategory || attributes.subcategory,
    subcategoryId: item.subcategoryId,
    colors: mirrors.colors || [],
    colorPalette: attributes.colorPalette || [],
    styleTags: attributes.styleTags || [],
    seasonTags: attributes.seasonTags || [],
    material: attributes.material,
    materialGuess: mirrors.materialGuess || attributes.material,
    thickness: attributes.thickness,
    warmthScore: item.warmthScore || 0,
    coolnessScore: item.coolnessScore || 0,
    fashionScore: item.fashionScore || 0,
    sceneTags: attributes.sceneTags || [],
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

function removeProtectedAestheticFields(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.keys(input).reduce((result, field) => {
    if (isProtectedAestheticField(field)) return result;
    result[field] = input[field];
    return result;
  }, {});
}

function isProtectedAestheticField(field) {
  return field === PROTECTED_AESTHETIC_FIELD
    || field.startsWith(`${PROTECTED_AESTHETIC_FIELD}.`);
}

function normalizeClothingAttributes(input) {
  const source = input && typeof input === 'object' ? input : {};
  const colorValue = readAliasValue(source, ATTRIBUTE_ALIAS_GROUPS.colorPalette);

  return {
    category: readAliasValue(source, ATTRIBUTE_ALIAS_GROUPS.category),
    subcategory: readAliasValue(source, ATTRIBUTE_ALIAS_GROUPS.subcategory),
    colorPalette: normalizeColorPalette(colorValue),
    material: readAliasValue(source, ATTRIBUTE_ALIAS_GROUPS.material),
    thickness: readAliasValue(source, ATTRIBUTE_ALIAS_GROUPS.thickness),
    styleTags: normalizeTags(readAliasValue(source, ATTRIBUTE_ALIAS_GROUPS.styleTags)),
    seasonTags: normalizeTags(readAliasValue(source, ATTRIBUTE_ALIAS_GROUPS.seasonTags)),
    sceneTags: normalizeTags(readAliasValue(source, ATTRIBUTE_ALIAS_GROUPS.sceneTags)),
  };
}

function buildClothingAttributeMirrorPatch(canonicalPatch) {
  const patch = {};
  if (hasOwn(canonicalPatch, 'subcategory') && !isEmptyAttributeValue(canonicalPatch.subcategory)) {
    patch.subCategory = canonicalPatch.subcategory;
  }
  if (hasOwn(canonicalPatch, 'colorPalette') && !isEmptyAttributeValue(canonicalPatch.colorPalette)) {
    patch.colors = colorsFromColorPalette(canonicalPatch.colorPalette);
  }
  if (hasOwn(canonicalPatch, 'material') && !isEmptyAttributeValue(canonicalPatch.material)) {
    patch.materialGuess = canonicalPatch.material;
  }
  return patch;
}

function getCanonicalManualFields(input) {
  const fields = new Set();
  const source = input && typeof input === 'object' ? input : {};
  Object.keys(ATTRIBUTE_ALIAS_GROUPS).forEach((canonical) => {
    if (ATTRIBUTE_ALIAS_GROUPS[canonical].some((alias) => hasOwn(source, alias) && !isEmptyAttributeValue(source[alias]))) {
      fields.add(canonical);
    }
  });

  Object.keys(source).forEach((field) => {
    if (
      ALLOWED_FIELDS.includes(field)
      && !SYSTEM_FIELDS.includes(field)
      && !ATTRIBUTE_ALIAS_FIELDS.includes(field)
    ) {
      fields.add(field);
    }
  });
  return fields;
}

function readAliasValue(source, aliases) {
  for (const alias of aliases) {
    if (hasOwn(source, alias) && !isEmptyAttributeValue(source[alias])) {
      return source[alias];
    }
  }
  return undefined;
}

function normalizeColorPalette(value) {
  if (isEmptyAttributeValue(value)) return undefined;
  if (Array.isArray(value)) {
    const colors = value
      .map((item, index) => normalizeColorPaletteItem(item, index))
      .filter(Boolean);
    return colors.length ? colors : undefined;
  }
  if (typeof value === 'string' && value.trim()) {
    return [{ name: value.trim(), hex: '#8A8A8A', ratio: 1 }];
  }
  return undefined;
}

function normalizeColorPaletteItem(item, index) {
  if (typeof item === 'string' && item.trim()) {
    return {
      name: item.trim(),
      hex: '#8A8A8A',
      ratio: index === 0 ? 1 : 0,
    };
  }
  if (item && typeof item === 'object' && !isEmptyAttributeValue(item.name)) {
    return {
      ...item,
      name: String(item.name).trim(),
    };
  }
  return null;
}

function colorsFromColorPalette(colorPalette) {
  if (!Array.isArray(colorPalette)) return [];
  return colorPalette
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item.name === 'string') return item.name.trim();
      return '';
    })
    .filter(Boolean);
}

function normalizeTags(value) {
  if (isEmptyAttributeValue(value)) return undefined;
  if (Array.isArray(value)) {
    const tags = value
      .filter((item) => typeof item === 'string' && item.trim())
      .map((item) => item.trim());
    return tags.length ? tags : undefined;
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return undefined;
}

function isEmptyAttributeValue(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return !value.trim();
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function hasOwn(object, field) {
  return Object.prototype.hasOwnProperty.call(object, field);
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

async function resolveMaterialNameForStorage(value, userId) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';

  const standard = getStandardMaterialLabel(trimmed);
  if (standard) return standard;

  if (isLikelyMaterialUid(trimmed)) {
    try {
      const material = await db.collection('user_clothing_materials').doc(trimmed).get();
      if (material.data && material.data.userId === userId && material.data.status === 'active' && material.data.name) {
        return String(material.data.name).trim();
      }
    } catch {
      return '';
    }
    return '';
  }

  return trimmed;
}

function isLikelyMaterialUid(value) {
  if (/[\u4e00-\u9fa5]/.test(value)) return false;
  return /^[a-z0-9_-]{16,}$/i.test(value) || /^[a-f0-9]{24}$/i.test(value);
}

function getStandardMaterialLabel(value) {
  const lower = value.toLowerCase();
  const map = {
    '棉': '棉质',
    '棉质': '棉质',
    cotton: '棉质',
    '麻': '亚麻',
    '亚麻': '亚麻',
    linen: '亚麻',
    '丝绸': '丝绸',
    silk: '丝绸',
    '羊毛': '羊毛',
    wool: '羊毛',
    '皮革': '皮革',
    leather: '皮革',
    '牛仔': '牛仔',
    denim: '牛仔',
    '化纤': '化纤',
    chemical: '化纤',
    '混纺': '混纺',
    blend: '混纺',
    '羽绒': '羽绒',
    down: '羽绒',
    '针织': '针织',
    knit: '针织',
    '聚酯纤维': '聚酯纤维',
    polyester: '聚酯纤维',
    '莫代尔': '莫代尔',
    modal: '莫代尔',
    '醋酸': '醋酸',
    acetate: '醋酸',
    '灯芯绒': '灯芯绒',
    corduroy: '灯芯绒',
    '摇粒绒': '摇粒绒',
    fleece: '摇粒绒',
    '冰丝': '冰丝',
    icesilk: '冰丝',
    '羊绒': '羊绒',
    cashmere: '羊绒',
  };
  return map[value] || map[lower] || '';
}

function ok(data) {
  return { code: 0, data, message: 'ok' };
}

function fail(error) {
  return { code: 1, data: null, message: error && error.message ? error.message : 'unknown error' };
}
