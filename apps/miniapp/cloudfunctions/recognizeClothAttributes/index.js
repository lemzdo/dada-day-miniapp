const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const BAILIAN_BASE_URL = process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const BAILIAN_MODEL = process.env.BAILIAN_ATTRIBUTE_MODEL || process.env.BAILIAN_MODEL || 'qwen3-vl-flash';
const QWEN_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || process.env.QWEN_TIMEOUT_MS || 20000);

exports.main = async (event = {}) => {
  try {
    const { OPENID } = cloud.getWXContext();
    const clothingId = event.clothId || event.clothingId;
    if (!clothingId) throw new Error('clothId is required');

    const collection = db.collection('clothes');
    const currentRes = await collection.doc(clothingId).get();
    const current = currentRes.data;
    if (!current || current._openid !== OPENID) throw new Error('clothing not found');

    const singleClothImage = getSingleClothImage(current);
    if (!singleClothImage && (current.batchId || current.sourceImageId)) {
      throw new Error('当前使用的是原图，暂不支持单独重新识别这件衣服。你可以手动编辑信息。');
    }

    await collection.doc(clothingId).update({
      data: {
        aiRecognizeStatus: 'pending',
        aiStatus: 'recognizing',
        aiProvider: 'bailian_qwen_vl',
        aiError: '',
        updatedAt: new Date().toISOString(),
      },
    });

    try {
      const sourceImage = singleClothImage || getDisplayImage(current);
      const imageUrl = await getTempUrl(sourceImage);
      const result = await retryOnce(() => callQwenVl(imageUrl));
      const updateData = buildRecognizeUpdate(current, result);
      await collection.doc(clothingId).update({ data: updateData });
      const updated = await collection.doc(clothingId).get();
      return ok(toClothing(updated.data));
    } catch (error) {
      await collection.doc(clothingId).update({
        data: {
          aiRecognizeStatus: 'failed',
          detectStatus: 'failed',
          aiStatus: 'failed',
          aiError: getErrorMessage(error),
          stageStatus: {
            ...(current.stageStatus || {}),
            attribute: 'failed',
          },
          updatedAt: new Date().toISOString(),
        },
      });
      const updated = await collection.doc(clothingId).get();
      return ok(toClothing(updated.data));
    }
  } catch (error) {
    console.error('[recognizeClothAttributes] failed', error);
    return fail(error);
  }
};

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
      max_tokens: 300,
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
    '3. 如果无法确定，请使用“未知”或空数组。',
    '4. 分数范围为 1-10，必须是数字。',
    '5. category 必须从以下选项中选择：上衣、外套、裤子、裙子、连衣裙、鞋子、包、帽子、配饰、其他',
    '6. seasonTags 只能从 春、夏、秋、冬 中选择。',
    '7. 输出字段必须完整。',
    '返回 JSON 格式如下：',
    '{"category":"上衣","subCategory":"短袖T恤","colors":["白色"],"material":"棉质","styleTags":["简约","休闲"],"seasonTags":["春","夏"],"thickness":"薄款","warmthScore":2,"coolnessScore":8,"fashionScore":7,"sceneTags":["日常","校园","通勤"],"matchTips":"适合搭配浅色牛仔裤、短裤或帆布鞋，整体清爽日常。"}',
  ].join('\n');
}

function buildRecognizeUpdate(current, result) {
  const manualFields = new Set(Array.isArray(current.manualFields) ? current.manualFields : []);
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
    updatedAt: new Date().toISOString(),
  };

  setIfNotManual(data, manualFields, 'category', result.category);
  setIfNotManual(data, manualFields, 'subCategory', result.subCategory);
  setIfNotManual(data, manualFields, 'subcategory', result.subCategory);
  setIfNotManual(data, manualFields, 'colors', result.colors);
  setIfNotManual(data, manualFields, 'colorPalette', result.colors.map((name, index) => ({
    name,
    hex: '#8A8A8A',
    ratio: index === 0 ? 1 : 0,
  })));
  setIfNotManual(data, manualFields, 'material', result.material);
  setIfNotManual(data, manualFields, 'materialGuess', result.material);
  setIfNotManual(data, manualFields, 'styleTags', result.styleTags);
  setIfNotManual(data, manualFields, 'seasonTags', result.seasonTags);
  setIfNotManual(data, manualFields, 'thickness', result.thickness);
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
  if (manualFields.has(field) || value === undefined) return;
  data[field] = value;
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

function ok(data) {
  return { code: 0, data, message: 'ok' };
}

function fail(error) {
  return { code: 1, data: null, message: getErrorMessage(error) };
}
