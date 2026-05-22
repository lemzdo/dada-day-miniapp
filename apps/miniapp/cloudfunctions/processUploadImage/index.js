const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const BAILIAN_BASE_URL = process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const BAILIAN_MODEL = process.env.BAILIAN_MODEL || 'qwen3-vl-flash';
const QWEN_TIMEOUT_MS = Number(process.env.QWEN_TIMEOUT_MS || 20000);

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

    await markImage(imageId, { status: 'processing', errorMessage: '', updatedAt: nowIso() });
    await db.collection('upload_batches').doc(image.batchId).update({
      data: { status: 'processing', updatedAt: nowIso() },
    });

    try {
      const sourceFileID = image.cloudFileId || image.originalImageUrl;
      const [imageUrl, sourceBuffer] = await Promise.all([
        getTempUrl(sourceFileID),
        downloadCloudFile(sourceFileID),
      ]);
      const aiResult = await retryOnce(() => callQwenVl(imageUrl));
      const items = normalizeItems(aiResult);
      if (items.length === 0) throw new Error('no clothing items detected');

      const createdDrafts = [];
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const crop = await cropItem(sourceBuffer, item.cropBox);
        const croppedImageUrl = crop.buffer
          ? await saveCrop(OPENID, imageId, index, crop.buffer)
          : sourceFileID;

        const draft = buildDraft({
          openid: OPENID,
          batchId: image.batchId,
          imageId,
          originalImageUrl: sourceFileID,
          croppedImageUrl,
          item: { ...item, cropBox: crop.cropBox || item.cropBox },
        });
        const addRes = await db.collection('clothes_drafts').add({ data: draft });
        createdDrafts.push(toDraft({ ...draft, _id: addRes._id }));
      }

      await markImage(imageId, {
        status: 'completed',
        detectedCount: createdDrafts.length,
        errorMessage: '',
        aiRawResult: aiResult,
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
      max_tokens: 900,
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
    'Return: {"items":[{"type":"top|bottom|onepiece|shoes|accessory|other","categoryName":"string","colors":["string"],"material":"string","style":"string","cropBox":{"x":0,"y":0,"width":100,"height":100},"confidence":0.9}]}',
    'cropBox must use pixel coordinates based on the original image.',
    'If uncertain, still return the best item candidates with lower confidence.',
  ].join('\n');
}

function normalizeItems(input) {
  const rawItems = Array.isArray(input && input.items) ? input.items : [];
  return rawItems
    .map((item) => {
      const type = normalizeType(item.type || item.category);
      const colors = readStringArray(item.colors);
      return {
        type,
        categoryName: readString(item.categoryName || item.subcategory || item.category, type),
        colors,
        color: colors[0] || '',
        material: readString(item.material, ''),
        style: readString(item.style || (Array.isArray(item.styleTags) ? item.styleTags[0] : ''), ''),
        cropBox: normalizeCropBox(item.cropBox || item.bbox),
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

function normalizeCropBox(value) {
  if (!value || typeof value !== 'object') return undefined;
  const box = {
    x: Number(value.x),
    y: Number(value.y),
    width: Number(value.width || value.w),
    height: Number(value.height || value.h),
  };
  if (!Number.isFinite(box.x) || !Number.isFinite(box.y) || !Number.isFinite(box.width) || !Number.isFinite(box.height)) {
    return undefined;
  }
  if (box.width <= 0 || box.height <= 0) return undefined;
  return box;
}

async function cropItem(sourceBuffer, cropBox) {
  if (!cropBox) return { buffer: null, cropBox: undefined };

  try {
    const sharp = require('sharp');
    const image = sharp(sourceBuffer);
    const metadata = await image.metadata();
    const sourceWidth = metadata.width || 0;
    const sourceHeight = metadata.height || 0;
    const box = resolveCropBox(cropBox, sourceWidth, sourceHeight);
    if (!box) return { buffer: null, cropBox };

    const buffer = await image
      .extract({ left: box.x, top: box.y, width: box.width, height: box.height })
      .jpeg({ quality: 90 })
      .toBuffer();
    return { buffer, cropBox: box };
  } catch (error) {
    console.warn('[processUploadImage] crop failed, use original image', {
      message: getErrorMessage(error),
      cropBox,
    });
    return { buffer: null, cropBox };
  }
}

function resolveCropBox(cropBox, sourceWidth, sourceHeight) {
  if (sourceWidth <= 0 || sourceHeight <= 0) return undefined;
  const normalized = cropBox.x <= 1 && cropBox.y <= 1 && cropBox.width <= 1 && cropBox.height <= 1;
  const raw = normalized
    ? {
      x: cropBox.x * sourceWidth,
      y: cropBox.y * sourceHeight,
      width: cropBox.width * sourceWidth,
      height: cropBox.height * sourceHeight,
    }
    : cropBox;

  const x = Math.max(0, Math.floor(raw.x));
  const y = Math.max(0, Math.floor(raw.y));
  const maxWidth = sourceWidth - x;
  const maxHeight = sourceHeight - y;
  const width = Math.min(maxWidth, Math.max(1, Math.round(raw.width)));
  const height = Math.min(maxHeight, Math.max(1, Math.round(raw.height)));
  if (width <= 0 || height <= 0) return undefined;
  return { x, y, width, height };
}

async function saveCrop(openid, imageId, index, buffer) {
  const cloudPath = `wardrobe_uploads/crops/${openid}/${imageId}-${index + 1}-${Date.now()}.jpg`;
  const uploadRes = await cloud.uploadFile({ cloudPath, fileContent: buffer });
  return uploadRes.fileID;
}

function buildDraft({ openid, batchId, imageId, originalImageUrl, croppedImageUrl, item }) {
  const now = nowIso();
  return {
    _openid: openid,
    userId: openid,
    batchId,
    sourceImageId: imageId,
    originalImageUrl,
    croppedImageUrl,
    cropBox: item.cropBox,
    type: item.type,
    categoryName: item.categoryName,
    color: item.color || '',
    colors: item.colors || [],
    material: item.material || '',
    style: item.style || '',
    confidence: item.confidence,
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
  const processedImages = images.filter((item) => item.status === 'completed' || item.status === 'failed').length;
  const failedImages = images.filter((item) => item.status === 'failed').length;
  const totalDetectedClothes = images.reduce((sum, item) => sum + Number(item.detectedCount || 0), 0);
  const batchRes = await db.collection('upload_batches').doc(batchId).get();
  const totalImages = batchRes.data && batchRes.data.totalImages ? batchRes.data.totalImages : images.length;
  const status = processedImages < totalImages
    ? 'processing'
    : failedImages === 0
      ? 'completed'
      : failedImages === totalImages
        ? 'failed'
        : 'partial_failed';

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

async function getTempUrl(fileID) {
  if (typeof fileID === 'string' && /^https?:\/\//.test(fileID)) return fileID;
  const tempRes = await cloud.getTempFileURL({ fileList: [fileID] });
  const tempUrl = tempRes.fileList && tempRes.fileList[0] && tempRes.fileList[0].tempFileURL;
  if (!tempUrl) throw new Error('failed to get image temp url');
  return tempUrl;
}

async function downloadCloudFile(fileID) {
  if (!fileID || typeof fileID !== 'string' || !fileID.startsWith('cloud://')) return Buffer.alloc(0);
  const res = await cloud.downloadFile({ fileID });
  if (!Buffer.isBuffer(res.fileContent) || res.fileContent.length === 0) throw new Error('downloaded cloud file is empty');
  return res.fileContent;
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
    croppedImageUrl: item.croppedImageUrl,
    cropBox: item.cropBox,
    type: item.type || 'other',
    categoryName: item.categoryName,
    color: item.color,
    colors: item.colors || (item.color ? [item.color] : []),
    material: item.material,
    style: item.style,
    confidence: item.confidence || 0,
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

function ok(data) {
  return { code: 0, data, message: 'ok' };
}

function fail(error) {
  return { code: 1, data: null, message: getErrorMessage(error) };
}
