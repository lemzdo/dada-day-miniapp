const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const SEGMENT_TIMEOUT_MS = Number(process.env.SEGMENT_TIMEOUT_MS || 60000);
const OSS_REGION = normalizeOssRegion(process.env.ALIYUN_OSS_REGION || '');
const OSS_BUCKET = process.env.ALIYUN_OSS_BUCKET || '';
const OSS_URL_EXPIRES_SECONDS = Number(process.env.ALIYUN_OSS_URL_EXPIRES_SECONDS || 1800);
const OSS_USE_SIGNED_URL = process.env.ALIYUN_OSS_USE_SIGNED_URL !== 'false';
const SEGMENT_PROVIDER = 'aliyun_viapi';
const SEGMENT_MODEL = 'SegmentCloth';

exports.main = async (event = {}) => {
  try {
    const { OPENID } = cloud.getWXContext();
    const draftId = event.draftId;
    const clothingId = event.clothId || event.clothingId;

    if (draftId) return segmentDraft(draftId, OPENID);
    if (clothingId) return segmentClothing(clothingId, OPENID);
    throw new Error('draftId or clothingId is required');
  } catch (error) {
    console.error('[segmentClothImage] failed', error);
    return fail(error);
  }
};

function validateRequiredEnv() {
  getRequiredEnv('ALIYUN_ACCESS_KEY_ID');
  getRequiredEnv('ALIYUN_ACCESS_KEY_SECRET');
  getRequiredEnv('ALIYUN_OSS_BUCKET');
  getRequiredEnv('ALIYUN_OSS_REGION');
}

async function segmentDraft(draftId, openid) {
  const collection = db.collection('clothes_drafts');
  const currentRes = await collection.doc(draftId).get();
  const current = currentRes.data;
  if (!current || current._openid !== openid) throw new Error('draft not found');
  if (current.status !== 'pending') return ok(toDraft(current));

  const sourceFileID = current.originalImageUrl;
  await collection.doc(draftId).update({
    data: {
      segmentStatus: 'processing',
      segmentProvider: SEGMENT_PROVIDER,
      segmentModel: SEGMENT_MODEL,
      segmentError: '',
      updatedAt: nowIso(),
    },
  });

  const result = await runSegment({
    openid,
    sourceFileID,
    objectId: draftId,
    cloudPath: `wardrobe/${openid}/drafts/segment/${draftId}-${Date.now()}.png`,
  });

  if (!result.success) {
    await collection.doc(draftId).update({
      data: {
        segmentStatus: 'failed',
        segmentProvider: SEGMENT_PROVIDER,
        segmentModel: SEGMENT_MODEL,
        segmentError: result.errors.join('|'),
        segmentErrorMessage: result.errors.join('|'),
        errorMessage: result.errors.join('|'),
        displayImageUrl: current.originalImageUrl,
        imageSourceType: 'original',
        updatedAt: nowIso(),
      },
    });
    const updated = await collection.doc(draftId).get();
    return ok(toDraft(updated.data));
  }

  const data = {
    aiSegmentImageUrl: result.fileID,
    segmentStatus: 'success',
    segmentProvider: SEGMENT_PROVIDER,
    segmentModel: SEGMENT_MODEL,
    segmentError: '',
    updatedAt: nowIso(),
  };
  if (canAutoUseSegment(current)) {
    data.displayImageUrl = result.fileID;
    data.imageSourceType = 'ai_segment';
  }

  await collection.doc(draftId).update({ data });
  const updated = await collection.doc(draftId).get();
  return ok(toDraft(updated.data));
}

async function segmentClothing(clothingId, openid) {
  const collection = db.collection('clothes');
  const currentRes = await collection.doc(clothingId).get();
  const current = currentRes.data;
  if (!current || current._openid !== openid) throw new Error('clothing not found');

  const sourceFileID = getOriginalImage(current);
  await collection.doc(clothingId).update({
    data: {
      segmentStatus: 'processing',
      cutoutStatus: 'pending',
      segmentProvider: SEGMENT_PROVIDER,
      segmentModel: SEGMENT_MODEL,
      updatedAt: nowIso(),
    },
  });

  const result = await runSegment({
    openid,
    sourceFileID,
    objectId: clothingId,
    cloudPath: `wardrobe/${openid}/clothes/segment/${clothingId}-${Date.now()}.png`,
  });

  if (!result.success) {
    await markClothingSegmentFailed(collection, clothingId, sourceFileID, result.errors);
    const updated = await collection.doc(clothingId).get();
    return ok(toClothing(updated.data));
  }

  const data = {
    aiSegmentImageUrl: result.fileID,
    segmentStatus: 'success',
    cutoutStatus: 'success',
    segmentProvider: SEGMENT_PROVIDER,
    segmentModel: SEGMENT_MODEL,
    cutoutProvider: SEGMENT_PROVIDER,
    cutoutError: '',
    updatedAt: nowIso(),
  };
  if (canAutoUseSegment(current)) {
    data.displayImageUrl = result.fileID;
    data.imageSourceType = 'ai_segment';
  }

  await collection.doc(clothingId).update({ data });
  const updated = await collection.doc(clothingId).get();
  return ok(toClothing(updated.data));
}

async function runSegment({ openid, sourceFileID, objectId, cloudPath }) {
  const errors = [];
  try {
    validateRequiredEnv();
  } catch (error) {
    return { success: false, errors: [`env:${getErrorMessage(error)}`] };
  }

  let sourceBuffer;
  try {
    sourceBuffer = await downloadWechatCloudFile(sourceFileID);
  } catch (error) {
    const message = getErrorMessage(error);
    console.error('[segmentClothImage] download wechat cloud file failed', {
      sourceFileID,
      message,
    });
    return { success: false, errors: [`download:${message}`] };
  }

  let ossObjectKey = '';
  let imageUrl = '';
  try {
    ossObjectKey = `wardrobe/${openid}/viapi-source/${objectId}-${Date.now()}${getFileExt(sourceFileID)}`;
    imageUrl = await uploadBufferToOss({ buffer: sourceBuffer, objectKey: ossObjectKey });
  } catch (error) {
    const message = getErrorMessage(error);
    console.error('[segmentClothImage] upload source image to OSS failed', {
      sourceFileID,
      bufferSize: sourceBuffer.length,
      message,
    });
    return { success: false, errors: [`oss:${message}`] };
  }

  try {
    const viapiUrl = await retryOnce(() => callViapiSegment(imageUrl));
    const fileID = await saveRemoteImage({ remoteUrl: viapiUrl, cloudPath });
    return { success: true, fileID, errors: [] };
  } catch (error) {
    const normalized = normalizeViapiError(error);
    console.error('[segmentClothImage] VIAPI SegmentCloth failed', {
      requestId: normalized.requestId,
      code: normalized.code,
      message: normalized.message,
    });
    errors.push(`${SEGMENT_PROVIDER}:${normalized.code || 'unknown'}:${normalized.message}`);
    return { success: false, errors };
  } finally {
    await deleteOssObject(ossObjectKey);
  }
}

function createClient() {
  const accessKeyId = getRequiredEnv('ALIYUN_ACCESS_KEY_ID');
  const accessKeySecret = getRequiredEnv('ALIYUN_ACCESS_KEY_SECRET');
  const region = process.env.ALIYUN_VIAPI_REGION || 'cn-shanghai';

  const { RPCClient } = require('@alicloud/pop-core');
  return new RPCClient({
    accessKeyId,
    accessKeySecret,
    endpoint: `https://imageseg.${region}.aliyuncs.com`,
    apiVersion: '2019-12-30',
  });
}

async function callViapiSegment(imageUrl) {
  const client = createClient();
  console.log('[segmentClothImage] calling VIAPI SegmentCloth', {
    imageUrlType: getImageUrlType(imageUrl),
    imageUrlInfo: getImageUrlInfo(imageUrl),
  });
  const response = await client.request(SEGMENT_MODEL, { ImageURL: imageUrl }, { method: 'POST', timeout: SEGMENT_TIMEOUT_MS });
  console.log('[segmentClothImage] VIAPI response', {
    requestId: response && (response.RequestId || response.requestId),
  });
  const resultUrl = extractResultUrl(response);
  if (!resultUrl) throw new Error('SegmentCloth returned empty ImageURL');
  return resultUrl;
}

async function downloadWechatCloudFile(fileID) {
  if (!fileID || typeof fileID !== 'string' || !fileID.startsWith('cloud://')) {
    throw new Error('original image must be a WeChat cloud fileID');
  }
  const res = await cloud.downloadFile({ fileID });
  const buffer = res && res.fileContent;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('downloaded wechat cloud file is empty');
  }
  return buffer;
}

async function uploadBufferToOss({ buffer, objectKey }) {
  const client = createOssClient();
  const result = await client.put(objectKey, buffer, {
    headers: {
      'Content-Type': getContentType(objectKey),
      'x-oss-object-acl': OSS_USE_SIGNED_URL ? 'private' : 'public-read',
    },
  });
  const url = OSS_USE_SIGNED_URL ? getSignedStandardOssUrl(client, objectKey) : getStandardOssUrl(objectKey);
  console.log('[segmentClothImage] upload source image to OSS success', {
    bucket: OSS_BUCKET,
    region: OSS_REGION,
    objectKey,
    useSignedUrl: OSS_USE_SIGNED_URL,
    expiresSeconds: OSS_URL_EXPIRES_SECONDS,
    urlType: getImageUrlType(url),
    urlInfo: getImageUrlInfo(url),
    sdkUrlType: getImageUrlType(result && result.url),
  });
  return url;
}

function createOssClient() {
  const accessKeyId = process.env.ALIYUN_OSS_ACCESS_KEY_ID || getRequiredEnv('ALIYUN_ACCESS_KEY_ID');
  const accessKeySecret = process.env.ALIYUN_OSS_ACCESS_KEY_SECRET || getRequiredEnv('ALIYUN_ACCESS_KEY_SECRET');

  const OSS = require('ali-oss');
  return new OSS({
    accessKeyId,
    accessKeySecret,
    bucket: OSS_BUCKET,
    region: OSS_REGION,
    secure: true,
  });
}

function getStandardOssUrl(objectKey) {
  return `https://${getStandardOssHost()}/${encodeOssObjectKey(objectKey)}`;
}

function getSignedStandardOssUrl(client, objectKey) {
  const url = client.signatureUrl(objectKey, {
    expires: OSS_URL_EXPIRES_SECONDS,
  });
  return normalizeOssUrl(url);
}

function normalizeOssUrl(url) {
  const parsed = new URL(url);
  parsed.protocol = 'https:';
  parsed.host = getStandardOssHost();
  return parsed.toString();
}

async function deleteOssObject(objectKey) {
  if (!objectKey) return;

  try {
    const client = createOssClient();
    await client.delete(objectKey);
    console.log('[segmentClothImage] delete OSS transit object success', { objectKey });
  } catch (error) {
    console.warn('[segmentClothImage] delete OSS transit object failed', {
      objectKey,
      message: getErrorMessage(error),
    });
  }
}

async function saveRemoteImage({ remoteUrl, cloudPath }) {
  const fetch = require('node-fetch');
  const response = await fetch(remoteUrl, { timeout: SEGMENT_TIMEOUT_MS });
  if (!response.ok) throw new Error(`download_segment_result_failed_${response.status}`);
  const buffer = await response.buffer();
  const uploadRes = await cloud.uploadFile({ cloudPath, fileContent: buffer });
  console.log('[segmentClothImage] upload VIAPI result to wechat cloud success', {
    remoteUrlType: getImageUrlType(remoteUrl),
    cloudPath,
    fileID: uploadRes.fileID,
    bufferSize: buffer.length,
  });
  return uploadRes.fileID;
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

function extractResultUrl(response) {
  const element = response && response.Data && Array.isArray(response.Data.Elements)
    ? response.Data.Elements[0]
    : null;
  return (element && (element.ImageURL || element.ImageUrl))
    || (response && response.Data && (response.Data.ImageURL || response.Data.ImageUrl))
    || (response && response.ImageURL)
    || '';
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
    segmentProvider: item.segmentProvider || SEGMENT_PROVIDER,
    segmentModel: item.segmentModel || SEGMENT_MODEL,
    selected: item.selected !== false,
    status: item.status || 'pending',
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function toClothing(item) {
  const originalImageUrl = getOriginalImage(item);
  const displayImageUrl = getDisplayImage(item);
  return {
    id: item._id,
    userId: item._openid,
    originalImageUrl,
    displayImageUrl,
    imageSourceType: item.imageSourceType || 'original',
    aiSegmentImageUrl: item.aiSegmentImageUrl || '',
    manualCropImageUrl: item.manualCropImageUrl || '',
    segmentStatus: item.segmentStatus || item.cutoutStatus || 'not_started',
    segmentProvider: item.segmentProvider || SEGMENT_PROVIDER,
    segmentModel: item.segmentModel || SEGMENT_MODEL,
    cutoutStatus: item.cutoutStatus || item.segmentStatus || 'pending',
    cutoutProvider: item.cutoutProvider || item.segmentProvider || 'none',
    cutoutError: item.cutoutError || item.segmentError,
    aiRecognizeStatus: item.aiRecognizeStatus || item.detectStatus || 'pending',
    detectStatus: item.detectStatus || item.aiRecognizeStatus || 'pending',
    detectProvider: item.detectProvider || item.aiProvider,
    detectModel: item.detectModel,
    aiProvider: item.aiProvider || item.detectProvider,
    aiError: item.aiError,
    category: item.category || 'other',
    subcategory: item.subcategory || item.subCategory,
    subCategory: item.subCategory || item.subcategory,
    colors: item.colors || [],
    colorPalette: item.colorPalette || [],
    styleTags: item.styleTags || [],
    seasonTags: item.seasonTags || [],
    material: item.material,
    materialGuess: item.materialGuess,
    sceneTags: item.sceneTags || [],
    aiStatus: item.aiStatus || 'recognized',
    aiConfidence: item.aiConfidence || 0,
    confidence: item.confidence || item.aiConfidence || 0,
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

function getErrorMessage(error) {
  return error && error.message ? error.message : String(error || 'unknown error');
}

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) throw new Error(`${name} is required`);
  return String(value).trim();
}

function getOriginalImage(item) {
  return item.originalImageUrl || '';
}

function getDisplayImage(item) {
  return item.displayImageUrl || getOriginalImage(item);
}

function canAutoUseSegment(item) {
  const originalImageUrl = getOriginalImage(item);
  return (item.imageSourceType || 'original') === 'original'
    && (!item.displayImageUrl || item.displayImageUrl === originalImageUrl);
}

async function markClothingSegmentFailed(collection, clothingId, sourceFileID, errors) {
  const data = {
    displayImageUrl: sourceFileID,
    segmentStatus: 'failed',
    cutoutStatus: 'failed',
    segmentProvider: SEGMENT_PROVIDER,
    segmentModel: SEGMENT_MODEL,
    cutoutProvider: 'none',
    segmentError: errors.join('|'),
    cutoutError: errors.join('|'),
    updatedAt: nowIso(),
  };
  await collection.doc(clothingId).update({ data });
}

function normalizeViapiError(error) {
  return {
    requestId: error && (error.requestId || error.RequestId || error.requestid),
    code: error && (error.code || error.Code || error.name),
    message: getErrorMessage(error),
  };
}

function getImageUrlType(url) {
  if (typeof url !== 'string') return typeof url;
  if (url.startsWith('cloud://')) return 'wechat-cloud-fileID';
  if (OSS_BUCKET && url.startsWith(`https://${getStandardOssHost()}/`)) return 'standard-oss-url';
  if (/^https?:\/\//.test(url)) return 'http-url';
  return 'unknown';
}

function getImageUrlInfo(url) {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return { scheme: '', host: '', hasQuery: false };
  const parsed = new URL(url);
  return {
    scheme: parsed.protocol.replace(':', ''),
    host: parsed.host,
    pathnamePrefix: parsed.pathname.split('/').slice(0, 4).join('/'),
    hasQuery: Boolean(parsed.search),
  };
}

function getStandardOssHost() {
  return `${OSS_BUCKET}.${OSS_REGION}.aliyuncs.com`;
}

function normalizeOssRegion(region) {
  const value = String(region || '').trim().toLowerCase();
  if (!value) return 'oss-cn-shanghai';
  return value.startsWith('oss-') ? value : `oss-${value}`;
}

function encodeOssObjectKey(objectKey) {
  return objectKey
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function getFileExt(fileID) {
  const pathname = String(fileID || '').split('?')[0] || '';
  const match = pathname.match(/\.(jpe?g|png|webp|gif|bmp)$/i);
  return match ? match[0].toLowerCase() : '.jpg';
}

function getContentType(objectKey) {
  const ext = getFileExt(objectKey);
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.bmp') return 'image/bmp';
  return 'image/jpeg';
}

function nowIso() {
  return new Date().toISOString();
}

function ok(data) {
  return { code: 0, data, message: 'ok' };
}

function fail(error) {
  return { code: 1, data: null, message: getErrorMessage(error) };
}
