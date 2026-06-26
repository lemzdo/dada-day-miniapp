const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const {
  normalizeAestheticFeaturesV1,
  normalizeColorPaletteV1,
  mergeAestheticFeaturesV1,
  createDefaultAestheticFeaturesV1,
  AESTHETIC_PROMPT_VERSION,
} = require('./aestheticFeatures');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const BAILIAN_BASE_URL = process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const BAILIAN_MODEL = process.env.BAILIAN_ATTRIBUTE_MODEL || process.env.BAILIAN_MODEL || 'qwen3-vl-flash';
const QWEN_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || process.env.QWEN_TIMEOUT_MS || 20000);
const DELETED_STATUS = 'deleted';
const CLOTHING_NOT_ACTIVE = 'CLOTHING_NOT_ACTIVE';
const RECOGNITION_TRANSACTION_UNAVAILABLE = 'RECOGNITION_TRANSACTION_UNAVAILABLE';

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

exports.main = async (event = {}) => {
  try {
    const { OPENID } = cloud.getWXContext();
    const clothingId = event.clothId || event.clothingId;
    if (!clothingId) throw new Error('clothId is required');

    const collection = db.collection('clothes');
    const lease = await acquireRecognitionAttempt(collection, clothingId, OPENID);
    const current = lease.clothing;

    try {
      const singleClothImage = getSingleClothImage(current);
      const sourceImage = singleClothImage || getDisplayImage(current);
      const imageUrl = await getTempUrl(sourceImage);
      const heartbeat = await touchRecognitionHeartbeat(collection, clothingId, OPENID, lease.token);
      if (heartbeat.status === 'superseded') return ok(heartbeat);
      const result = await retryOnce(() => callQwenVl(imageUrl));
      const success = await finishRecognitionSuccess(collection, clothingId, OPENID, lease.token, result);
      return ok(toRecognitionAttemptResult(success));
    } catch (error) {
      const failure = await finishRecognitionFailure(collection, clothingId, OPENID, lease.token, error);
      return ok(toRecognitionAttemptResult(failure));
    }
  } catch (error) {
    console.error('[recognizeClothAttributes] failed', error);
    return fail(error);
  }
};

async function acquireRecognitionAttempt(collection, clothingId, openid) {
  if (typeof db.runTransaction !== 'function') throw new Error(RECOGNITION_TRANSACTION_UNAVAILABLE);
  const token = createAttemptToken();
  const now = new Date().toISOString();

  return db.runTransaction(async (transaction) => {
    const ref = transaction.collection('clothes').doc(clothingId);
    const currentRes = await ref.get();
    const current = currentRes.data;
    if (!current || current._openid !== openid) throw new Error('clothing not found');
    if (isDeletedClothing(current)) throw new Error(CLOTHING_NOT_ACTIVE);
    if (!getSingleClothImage(current) && (current.batchId || current.sourceImageId)) {
      throw new Error('当前使用的是原图，暂不支持单独重新识别这件衣服。你可以手动编辑信息。');
    }

    const data = {
      aiRecognizeStatus: 'pending',
      aiStatus: 'recognizing',
      aiProvider: 'bailian_qwen_vl',
      aiError: '',
      recognitionAttemptToken: token,
      recognitionStartedAt: now,
      recognitionHeartbeatAt: now,
      updatedAt: now,
    };

    await ref.update({ data });
    return { token, clothing: { ...current, ...data, _id: clothingId } };
  }, 3);
}

async function touchRecognitionHeartbeat(collection, clothingId, openid, token) {
  return updateRecognitionWithToken(collection, {
    clothingId,
    openid,
    token,
    patchBuilder: () => ({
      recognitionHeartbeatAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
  });
}

async function finishRecognitionSuccess(collection, clothingId, openid, token, result) {
  return updateRecognitionWithToken(collection, {
    clothingId,
    openid,
    token,
    patchBuilder: (current) => ({
      ...buildRecognizeUpdate(current, result),
      recognitionAttemptToken: '',
      recognitionHeartbeatAt: new Date().toISOString(),
    }),
  });
}

async function finishRecognitionFailure(collection, clothingId, openid, token, error) {
  return updateRecognitionWithToken(collection, {
    clothingId,
    openid,
    token,
    patchBuilder: (current) => ({
      aiRecognizeStatus: 'failed',
      detectStatus: 'failed',
      aiStatus: 'failed',
      aiError: getErrorMessage(error),
      recognitionAttemptToken: '',
      recognitionHeartbeatAt: new Date().toISOString(),
      stageStatus: {
        ...(current.stageStatus || {}),
        attribute: 'failed',
      },
      updatedAt: new Date().toISOString(),
    }),
  });
}

async function updateRecognitionWithToken(collection, { clothingId, openid, token, patchBuilder }) {
  return db.runTransaction(async (transaction) => {
    const ref = transaction.collection('clothes').doc(clothingId);
    const currentRes = await ref.get();
    const current = currentRes.data;
    if (!current || current._openid !== openid) throw new Error('clothing not found');
    if (isDeletedClothing(current) || current.recognitionAttemptToken !== token) {
      return { status: 'superseded' };
    }

    const data = patchBuilder(current);
    await ref.update({ data });
    return { status: 'updated', clothing: { ...current, ...data, _id: clothingId } };
  }, 3);
}

function toRecognitionAttemptResult(result) {
  if (result.status === 'superseded') return { status: 'superseded' };
  return toClothing(result.clothing);
}

async function callQwenVl(imageUrl) {
  if (!process.env.BAILIAN_API_KEY) throw new Error('BAILIAN_API_KEY is missing');
  const fetch = require('node-fetch');
  const response = await fetch(`${BAILIAN_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.BAILIAN_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: BAILIAN_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: buildPrompt() },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: 700,
      stream: false,
    }),
    timeout: QWEN_TIMEOUT_MS,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`bailian_api_error_${response.status}:${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  return normalizeResult(parseStrictJson(content));
}

function buildPrompt() {
  return [
    '你是一个穿搭小程序的衣服识别助手。请根据图片识别这件衣服/配饰的属性，并严格返回 JSON。',
    '要求：',
    '1. 只返回 JSON，不要输出 Markdown。',
    '2. 不要输出解释文字。',
    '3. 普通属性无法确定时，请使用“未知”或空数组；高级审美字段无法判断时使用 unknown/null/[]。',
    '4. 分数范围为 1-10，必须是数字。',
    '5. category 必须从以下选项中选择：上衣、外套、裤子、裙子、连衣裙、鞋子、包、帽子、配饰、其他',
    '6. seasonTags 只能从 春、夏、秋、冬 中选择。',
    '7. 输出字段必须完整。',
    '8. 只分析衣服本身，不推断用户身材、体型、年龄、身份或其他敏感属性。',
    `9. aestheticFeatures 使用 ${AESTHETIC_PROMPT_VERSION} schema；模型不得输出或决定 version、promptVersion、provider、model、recognizedAt，这些由服务端写入。`,
    'colorPalette/colors 要求：最多 3 色；颜色对象使用 name/hex/ratio/role；ratio 为 0 到 1；role 只能是 primary/secondary/accent；最多一个 primary；不确定 hex 或 ratio 时允许缺失；不得新增 proportion 或平行颜色字段；继续输出兼容的 colors。',
    'aestheticFeatures 要求：fit 只能是 fitted/regular/relaxed/oversized/unknown，只描述衣服自身剪裁松紧；length 只能是 cropped/short/regular/long/extraLong/unknown，按品类内部相对长度判断；silhouette 只能是 straight/boxy/aLine/xLine/cocoon/tapered/wideLeg/flare/bodycon/unknown，不适用写 unknown；patternType 只能是 solid/stripe/plaid/floral/graphic/polkaDot/animal/abstract/colorBlock/other/unknown，只输出一个主要图案类型；designElements 只能从 ruffle/pleat/lace/cutout/asymmetry/hardware/embroidery/distressed/layered/bow/puffSleeve/sheer/fringe/belted 中选择，最多 4 项，没有明显元素输出空数组；formalityLevel 为 1-5，无法判断输出 null，禁止默认写 3；confidence 每个字段只能是 high/medium/low，模糊、遮挡或无法判断时输出 low。',
    '返回 JSON 格式如下：',
    '{"category":"上衣","subCategory":"短袖T恤","colors":["白色"],"colorPalette":[{"name":"白色","hex":"#FFFFFF","ratio":0.85,"role":"primary"}],"material":"棉质","styleTags":["简约","休闲"],"seasonTags":["春","夏"],"thickness":"薄款","warmthScore":2,"coolnessScore":8,"fashionScore":7,"sceneTags":["日常","校园","通勤"],"matchTips":"适合搭配浅色牛仔裤、短裤或帆布鞋，整体清爽日常。","aestheticFeatures":{"fit":"regular","length":"regular","silhouette":"straight","patternType":"solid","designElements":[],"formalityLevel":2,"confidence":{"fit":"high","length":"medium","silhouette":"medium","patternType":"high","designElements":"high","formalityLevel":"medium"}}}',
  ].join('\n');
}

function buildRecognizeUpdate(current, result) {
  const manualFields = new Set(Array.isArray(current.manualFields) ? current.manualFields : []);
  const attributePatch = normalizeClothingAttributes(result);
  const writableAttributePatch = {};
  const now = new Date().toISOString();
  const data = {
    aiRecognizeStatus: 'success',
    detectStatus: 'success',
    aiStatus: 'recognized',
    aiProvider: 'bailian_qwen_vl',
    detectProvider: 'bailian',
    detectModel: BAILIAN_MODEL,
    aiRawResult: result.raw,
    aiRaw: result.raw,
    aiError: '',
    stageStatus: {
      ...(current.stageStatus || {}),
      attribute: 'success',
    },
    updatedAt: now,
  };

  Object.keys(attributePatch).forEach((field) => {
    if (!isManualFieldProtected(manualFields, field) && !isEmptyAttributeValue(attributePatch[field])) {
      writableAttributePatch[field] = attributePatch[field];
    }
  });

  Object.assign(data, writableAttributePatch, buildClothingAttributeMirrorPatch(writableAttributePatch));
  data.aestheticFeatures = buildAestheticFeaturesUpdate(current, result, writableAttributePatch, {
    provider: data.detectProvider,
    model: data.detectModel,
    recognizedAt: now,
  });

  setIfNotManual(data, manualFields, 'warmthScore', result.warmthScore);
  setIfNotManual(data, manualFields, 'coolnessScore', result.coolnessScore);
  setIfNotManual(data, manualFields, 'fashionScore', result.fashionScore);
  setIfNotManual(data, manualFields, 'sceneTags', result.sceneTags);
  setIfNotManual(data, manualFields, 'matchTips', result.matchTips);
  return data;
}

function normalizeResult(input) {
  const raw = input && typeof input === 'object' ? input : {};
  return {
    raw,
    category: readEnum(raw.category, ['上衣', '外套', '裤子', '裙子', '连衣裙', '鞋子', '包', '帽子', '配饰', '其他'], '其他'),
    subCategory: readString(raw.subCategory || raw.subcategory, '未知'),
    colorPalette: raw.colorPalette,
    colors: readStringArray(raw.colors),
    material: readString(raw.material, '未知'),
    styleTags: readStringArray(raw.styleTags),
    seasonTags: readStringArray(raw.seasonTags).filter((item) => ['春', '夏', '秋', '冬'].includes(item)),
    thickness: readString(raw.thickness, '未知'),
    warmthScore: readScore(raw.warmthScore),
    coolnessScore: readScore(raw.coolnessScore),
    fashionScore: readScore(raw.fashionScore),
    sceneTags: readStringArray(raw.sceneTags),
    matchTips: readString(raw.matchTips, ''),
    rawAestheticFeatures: raw.aestheticFeatures,
  };
}

async function getTempUrl(fileID) {
  if (typeof fileID === 'string' && /^https?:\/\//.test(fileID)) return fileID;
  const tempRes = await cloud.getTempFileURL({ fileList: [fileID] });
  const tempUrl = tempRes.fileList && tempRes.fileList[0] && tempRes.fileList[0].tempFileURL;
  if (!tempUrl) throw new Error('failed to get image temp url');
  return tempUrl;
}

async function retryOnce(task) {
  try {
    return await task();
  } catch (firstError) {
    try {
      return await task();
    } catch (secondError) {
      throw new Error(`${getErrorMessage(firstError)}; retry: ${getErrorMessage(secondError)}`);
    }
  }
}

function parseStrictJson(content) {
  const text = String(content || '').trim();
  return JSON.parse(text);
}

function setIfNotManual(data, manualFields, field, value) {
  if (isManualFieldProtected(manualFields, field) || value === undefined) return;
  data[field] = value;
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

function expandManualFields(manualFields) {
  const expanded = new Set();
  const fields = Array.isArray(manualFields) ? manualFields : Array.from(manualFields || []);
  fields.forEach((field) => {
    const group = getAliasGroupForField(field);
    if (group) {
      group.forEach((alias) => expanded.add(alias));
    } else if (field) {
      expanded.add(field);
    }
  });
  return expanded;
}

function isManualFieldProtected(manualFields, field) {
  return expandManualFields(manualFields).has(field);
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
    const colors = normalizeColorPaletteV1(value);
    return colors.length ? colors : undefined;
  }
  if (typeof value === 'string' && value.trim()) {
    const colors = normalizeColorPaletteV1([value.trim()]);
    return colors.length ? colors : undefined;
  }
  return undefined;
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

function buildAestheticFeaturesUpdate(current, result, writableAttributePatch, meta) {
  const effectiveCategory = getEffectiveAttribute(current, writableAttributePatch, 'category');
  const effectiveSubcategory = getEffectiveAttribute(current, writableAttributePatch, 'subcategory');
  const normalizeMeta = {
    ...meta,
    category: effectiveCategory,
    subcategory: effectiveSubcategory,
  };
  const rawAestheticFeatures = hasOwn(result, 'rawAestheticFeatures') ? result.rawAestheticFeatures : undefined;
  if (!hasAestheticFeaturesV1(current.aestheticFeatures)) {
    return rawAestheticFeatures === undefined
      ? createDefaultAestheticFeaturesV1(normalizeMeta)
      : normalizeAestheticFeaturesV1(rawAestheticFeatures, normalizeMeta);
  }

  const normalizedIncoming = rawAestheticFeatures === undefined
    ? createDefaultAestheticFeaturesV1(normalizeMeta)
    : normalizeAestheticFeaturesV1(rawAestheticFeatures, normalizeMeta);
  return mergeAestheticFeaturesV1(current.aestheticFeatures, normalizedIncoming, normalizeMeta);
}

function getEffectiveAttribute(current, writableAttributePatch, field) {
  if (hasOwn(writableAttributePatch, field) && !isEmptyAttributeValue(writableAttributePatch[field])) {
    return writableAttributePatch[field];
  }
  return readAliasValue(current, ATTRIBUTE_ALIAS_GROUPS[field]);
}

function hasAestheticFeaturesV1(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && value.version === 1;
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

function getAliasGroupForField(field) {
  return Object.keys(ATTRIBUTE_ALIAS_GROUPS)
    .map((key) => ATTRIBUTE_ALIAS_GROUPS[key])
    .find((group) => group.includes(field));
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

function readEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function readString(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function readStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()) : [];
}

function readScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? Math.min(10, Math.max(1, score)) : 1;
}

function toClothing(item) {
  const originalImageUrl = getOriginalImage(item);
  const displayImageUrl = getDisplayImage(item);
  const attributes = normalizeClothingAttributes(item);
  const mirrors = buildClothingAttributeMirrorPatch(attributes);
  return {
    id: item._id,
    userId: item._openid,
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
    cutoutStatus: item.cutoutStatus || 'pending',
    segmentStatus: item.segmentStatus || item.cutoutStatus || 'not_started',
    manualCropStatus: item.manualCropStatus || 'unsupported',
    cutoutProvider: item.cutoutProvider || 'none',
    cutoutError: item.cutoutError,
    aiRecognizeStatus: item.aiRecognizeStatus || 'pending',
    recognitionAttemptToken: item.recognitionAttemptToken || '',
    recognitionStartedAt: item.recognitionStartedAt,
    recognitionHeartbeatAt: item.recognitionHeartbeatAt,
    aiProvider: item.aiProvider,
    aiError: item.aiError,
    category: attributes.category || '其他',
    subcategory: attributes.subcategory,
    subCategory: mirrors.subCategory || attributes.subcategory,
    colors: mirrors.colors || [],
    colorPalette: attributes.colorPalette || [],
    styleTags: attributes.styleTags || [],
    seasonTags: attributes.seasonTags || [],
    material: attributes.material,
    materialGuess: mirrors.materialGuess || attributes.material,
    thickness: attributes.thickness,
    aestheticFeatures: hasAestheticFeaturesV1(item.aestheticFeatures)
      ? normalizeAestheticFeaturesV1(item.aestheticFeatures, {
        category: attributes.category,
        subcategory: attributes.subcategory,
        provider: item.aestheticFeatures.provider,
        model: item.aestheticFeatures.model,
        recognizedAt: item.aestheticFeatures.recognizedAt,
      })
      : undefined,
    warmthScore: item.warmthScore || 0,
    coolnessScore: item.coolnessScore || 0,
    fashionScore: item.fashionScore || 0,
    sceneTags: attributes.sceneTags || [],
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
  return item.cleanImageUrl
    || item.aiSegmentImageUrl
    || item.cropImageUrl
    || item.croppedImageUrl
    || item.displayImageUrl
    || item.imageUrl
    || item.manualCropImageUrl
    || getOriginalImage(item);
}

function getSingleClothImage(item) {
  if (item.cleanImageUrl && item.segmentStatus === 'success') return item.cleanImageUrl;
  if (item.aiSegmentImageUrl && item.segmentStatus === 'success') return item.aiSegmentImageUrl;
  if (item.cropImageUrl) return item.cropImageUrl;
  if (item.croppedImageUrl) return item.croppedImageUrl;
  if (item.manualCropImageUrl && item.manualCropStatus === 'success') return item.manualCropImageUrl;
  return '';
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

function getErrorMessage(error) {
  return error && error.message ? error.message : String(error || 'unknown error');
}

function createAttemptToken() {
  return crypto.randomBytes(16).toString('hex');
}

function isDeletedClothing(item) {
  return item && (item.status === DELETED_STATUS || item.isDeleted || item.deletedAt);
}

function ok(data) {
  return { code: 0, data, message: 'ok' };
}

function fail(error) {
  return { code: 1, data: null, message: getErrorMessage(error) };
}
