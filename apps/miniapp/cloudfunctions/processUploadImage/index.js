const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const BAILIAN_BASE_URL = process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const QWEN_TIMEOUT_MS = Number(process.env.QWEN_TIMEOUT_MS || 30000);

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const imageId = event.imageId || event.uploadImageId;

  try {
    if (!imageId) throw new Error('imageId is required');

    const imageRes = await db.collection('upload_images').doc(imageId).get();
    const image = imageRes.data;
    if (!image || image._openid !== OPENID) throw new Error('upload image not found');

    const batchRes = await db.collection('upload_batches').doc(image.batchId).get();
    if (!batchRes.data || batchRes.data._openid !== OPENID) throw new Error('batch not found');

    const existingDraftsRes = await db.collection('clothes_drafts').where({ sourceImageId: imageId, _openid: OPENID }).get();
    const existingDrafts = existingDraftsRes.data || [];
    if (existingDrafts.length > 0) {
      await safeMarkImage(imageId, {
        status: 'detected',
        detectStatus: image.detectStatus === 'partial' ? 'partial' : 'success',
        segmentStatus: image.segmentStatus || 'queued',
        detectedCount: existingDrafts.length,
        errorMessage: '',
        updatedAt: nowIso(),
      });
      await refreshBatch(image.batchId, OPENID);
      return ok({ imageId, drafts: existingDrafts.map(toDraft) });
    }

    await markImage(imageId, {
      status: 'detecting',
      detectStatus: 'pending',
      segmentStatus: 'not_started',
      errorMessage: '',
      updatedAt: nowIso(),
    });
    await db.collection('upload_batches').doc(image.batchId).update({
      data: { status: 'processing', updatedAt: nowIso() },
    });

    try {
      const sourceFileID = image.cloudFileId || image.originalImageUrl;
      const imageUrl = await getTempUrl(sourceFileID);
      const detectModel = getRequiredEnv('BAILIAN_MODEL');
      const raw = await retryOnce(() => callQwenVl(imageUrl, detectModel));
      const items = normalizeItems(raw);
      const aiRawResult = buildAiRawResult({ model: detectModel, raw, items });

      if (items.length === 0) {
        await markImage(imageId, {
          status: 'empty',
          detectStatus: 'success',
          segmentStatus: 'not_started',
          detectedCount: 0,
          errorMessage: '',
          aiRawResult,
          updatedAt: nowIso(),
        });
        await refreshBatch(image.batchId, OPENID);
        return ok({ imageId, drafts: [] });
      }

      const createdDrafts = [];
      try {
        for (let index = 0; index < items.length; index += 1) {
          const item = items[index];
          const draft = buildDraft({
            openid: OPENID,
            batchId: image.batchId,
            imageId,
            originalImageUrl: sourceFileID,
            detectModel,
            item,
          });
          const addRes = await db.collection('clothes_drafts').add({ data: draft });
          createdDrafts.push(toDraft({ ...draft, _id: addRes._id }));
        }
      } catch (error) {
        const message = getErrorMessage(error);
        console.error('[processUploadImage] create drafts failed', {
          batchId: image.batchId,
          imageId,
          createdCount: createdDrafts.length,
          message,
        });

        await safeMarkImage(imageId, {
          status: createdDrafts.length > 0 ? 'detected' : 'failed',
          detectStatus: createdDrafts.length > 0 ? 'partial' : 'failed',
          segmentStatus: createdDrafts.length > 0 ? 'queued' : 'not_started',
          detectedCount: createdDrafts.length,
          errorMessage: message,
          aiRawResult,
          updatedAt: nowIso(),
        });
        await refreshBatch(image.batchId, OPENID);
        return ok({ imageId, drafts: createdDrafts, errorMessage: message });
      }

      await safeMarkImage(imageId, {
        status: 'detected',
        detectStatus: 'success',
        segmentStatus: 'queued',
        detectedCount: createdDrafts.length,
        errorMessage: '',
        aiRawResult,
        updatedAt: nowIso(),
      });
      await refreshBatch(image.batchId, OPENID);

      console.log('[processUploadImage] completed', {
        batchId: image.batchId,
        imageId,
        detectedCount: createdDrafts.length,
      });

      return ok({ imageId, drafts: createdDrafts });
    } catch (error) {
      const message = getErrorMessage(error);
      console.error('[processUploadImage] image failed', { imageId, message });
      await markImage(imageId, {
        status: 'failed',
        detectStatus: 'failed',
        segmentStatus: 'not_started',
        detectedCount: 0,
        errorMessage: message,
        updatedAt: nowIso(),
      });
      await refreshBatch(image.batchId, OPENID);
      return ok({ imageId, drafts: [], errorMessage: message });
    }
  } catch (error) {
    console.error('[processUploadImage] failed', error);
    return fail(error);
  }
};

async function callQwenVl(imageUrl, model) {
  const apiKey = getRequiredEnv('BAILIAN_API_KEY');
  const fetch = require('node-fetch');
  const response = await fetch(`${BAILIAN_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
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
      max_tokens: 1200,
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
  return parseJson(content);
}

function buildPrompt() {
  return [
    'You are a wardrobe recognition assistant for a WeChat mini program.',
    'Return strict JSON only. Do not return Markdown or explanations.',
    'Detect independent clothing items in the image. Do not treat a full outfit/person as one item.',
    'Split tops, bottoms, dresses, shoes, bags, hats and accessories into separate items.',
    'Do not crop or edit the image. Only describe candidate clothing items.',
    'Return: {"items":[{"type":"top|bottom|onepiece|shoes|accessory|other","categoryName":"string","colors":["string"],"material":"string","styleTags":["string"],"seasonTags":["spring|summer|autumn|winter"],"confidence":0.9}]}',
    'If uncertain, still return the best item candidates with lower confidence.',
  ].join('\n');
}

function normalizeItems(input) {
  const rawItems = Array.isArray(input && input.items) ? input.items : [];
  return rawItems
    .map((item) => {
      const type = normalizeType(item.type || item.category);
      const colors = readStringArray(item.colors);
      const styleTags = readStringArray(item.styleTags || item.styles || (item.style ? [item.style] : []));
      const seasonTags = normalizeSeasonTags(item.seasonTags || item.seasons);
      return {
        type,
        categoryName: readString(item.categoryName || item.subcategory || item.category, type),
        colors,
        color: colors[0] || '',
        material: readString(item.material, ''),
        style: styleTags[0] || '',
        styleTags,
        seasonTags,
        confidence: normalizeConfidence(item.confidence),
        raw: item,
      };
    })
    .filter((item) => item.type);
}

function normalizeType(value) {
  const text = String(value || '').toLowerCase();
  const map = {
    top: 'top',
    shirt: 'top',
    tshirt: 'top',
    coat: 'top',
    jacket: 'top',
    bottom: 'bottom',
    pants: 'bottom',
    trousers: 'bottom',
    skirt: 'bottom',
    onepiece: 'onepiece',
    dress: 'onepiece',
    shoes: 'shoes',
    shoe: 'shoes',
    bag: 'accessory',
    accessory: 'accessory',
    accessories: 'accessory',
    hat: 'accessory',
  };
  return map[text] || (['top', 'bottom', 'onepiece', 'shoes', 'accessory', 'other'].includes(text) ? text : 'other');
}

function normalizeSeasonTags(value) {
  const allowed = new Set(['spring', 'summer', 'autumn', 'winter']);
  return readStringArray(value).filter((item) => allowed.has(item));
}

function buildDraft({ openid, batchId, imageId, originalImageUrl, detectModel, item }) {
  const now = nowIso();
  return {
    _openid: openid,
    userId: openid,
    batchId,
    sourceImageId: imageId,
    originalImageUrl,
    displayImageUrl: originalImageUrl,
    imageSourceType: 'original',
    aiSegmentImageUrl: '',
    manualCropImageUrl: '',
    detectStatus: 'success',
    segmentStatus: 'queued',
    manualCropStatus: 'unsupported',
    type: item.type,
    categoryName: item.categoryName,
    color: item.color || '',
    colors: item.colors || [],
    material: item.material || '',
    style: item.style || '',
    styleTags: item.styleTags || [],
    seasonTags: item.seasonTags || [],
    confidence: item.confidence,
    detectProvider: 'bailian',
    detectModel,
    segmentProvider: 'aliyun_viapi',
    segmentModel: 'SegmentCloth',
    selected: true,
    status: 'pending',
    aiRawResult: item.raw,
    createdAt: now,
    updatedAt: now,
  };
}

async function refreshBatch(batchId, openid) {
  const imagesRes = await db.collection('upload_images').where({ batchId, _openid: openid }).get();
  const images = imagesRes.data || [];
  const draftsRes = await db.collection('clothes_drafts').where({ batchId, _openid: openid }).get();
  const drafts = draftsRes.data || [];
  const draftImageIds = new Set(drafts.map((item) => item.sourceImageId).filter(Boolean));
  const processedImages = Math.max(
    images.filter((item) => isImageProcessed(item) || draftImageIds.has(item._id)).length,
    draftImageIds.size,
  );
  const failedImages = images.filter((item) => item.status === 'failed' && !draftImageIds.has(item._id)).length;
  const emptyImages = images.filter((item) => item.status === 'empty').length;
  const totalDetectedClothes = drafts.length;
  const batchRes = await db.collection('upload_batches').doc(batchId).get();
  const totalImages = batchRes.data && batchRes.data.totalImages ? batchRes.data.totalImages : images.length;
  const status = processedImages < totalImages
    ? 'processing'
    : totalDetectedClothes > 0
      ? (failedImages > 0 ? 'partial_success' : 'success')
      : failedImages === 0 && emptyImages > 0
        ? 'empty'
        : 'failed';

  await db.collection('upload_batches').doc(batchId).update({
    data: {
      processedImages,
      totalDetectedClothes,
      status,
      updatedAt: nowIso(),
    },
  });
}

async function markImage(imageId, data) {
  await db.collection('upload_images').doc(imageId).update({ data });
}

async function safeMarkImage(imageId, data) {
  try {
    await markImage(imageId, data);
  } catch (error) {
    console.error('[processUploadImage] update upload image failed after drafts were created', {
      imageId,
      message: getErrorMessage(error),
    });
  }
}

function isImageProcessed(item) {
  return ['detected', 'completed', 'success', 'empty', 'failed'].includes(item.status);
}

function buildAiRawResult({ model, raw, items }) {
  return {
    provider: 'bailian',
    model,
    raw,
    items,
    parsedAt: nowIso(),
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

function parseJson(content) {
  const text = String(content || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
  return JSON.parse(text);
}

function readString(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function readStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()) : [];
}

function normalizeConfidence(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return num <= 1 ? Math.round(num * 100) : Math.min(100, Math.round(num));
}

function toDraft(item) {
  return {
    id: item._id,
    userId: item.userId || item._openid,
    batchId: item.batchId,
    sourceImageId: item.sourceImageId,
    originalImageUrl: item.originalImageUrl,
    displayImageUrl: item.displayImageUrl || item.originalImageUrl,
    imageSourceType: item.imageSourceType || 'original',
    aiSegmentImageUrl: item.aiSegmentImageUrl || '',
    manualCropImageUrl: item.manualCropImageUrl || '',
    detectStatus: item.detectStatus || 'success',
    segmentStatus: item.segmentStatus || 'not_started',
    manualCropStatus: item.manualCropStatus || 'unsupported',
    type: item.type || 'other',
    categoryName: item.categoryName,
    color: item.color,
    colors: item.colors || (item.color ? [item.color] : []),
    material: item.material,
    style: item.style,
    styleTags: item.styleTags || (item.style ? [item.style] : []),
    seasonTags: item.seasonTags || [],
    confidence: item.confidence || 0,
    detectProvider: item.detectProvider || 'bailian',
    detectModel: item.detectModel || '',
    segmentProvider: item.segmentProvider || 'aliyun_viapi',
    segmentModel: item.segmentModel || 'SegmentCloth',
    selected: item.selected !== false,
    status: item.status || 'pending',
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function nowIso() {
  return new Date().toISOString();
}

function getErrorMessage(error) {
  return error && error.message ? error.message : String(error || 'unknown error');
}

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) throw new Error(`${name} is required`);
  return String(value).trim();
}

function ok(data) {
  return { code: 0, data, message: 'ok' };
}

function fail(error) {
  return { code: 1, data: null, message: getErrorMessage(error) };
}
