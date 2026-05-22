const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const SEGMENT_TIMEOUT_MS = Number(process.env.SEGMENT_TIMEOUT_MS || 15000);
const OSS_REGION = normalizeOssRegion(process.env.ALIYUN_OSS_REGION || 'cn-shanghai');
const OSS_BUCKET = process.env.ALIYUN_OSS_BUCKET;
const OSS_URL_EXPIRES_SECONDS = Number(process.env.ALIYUN_OSS_URL_EXPIRES_SECONDS || 900);
const OSS_USE_SIGNED_URL = process.env.ALIYUN_OSS_USE_SIGNED_URL === 'true';

const PROVIDERS = [
  { action: 'SegmentCloth', name: 'aliyun_viapi_segment_cloth' },
  { action: 'SegmentCommodity', name: 'aliyun_viapi_segment_commodity' },
  { action: 'SegmentCommonImage', name: 'aliyun_viapi_segment_common' },
];

exports.main = async (event = {}) => {
  try {
    const { OPENID } = cloud.getWXContext();
    const clothingId = event.clothId || event.clothingId;
    if (!clothingId) throw new Error('clothId is required');

    const collection = db.collection('clothes');
    const currentRes = await collection.doc(clothingId).get();
    const current = currentRes.data;
    if (!current || current._openid !== OPENID) throw new Error('clothing not found');

    const sourceFileID = getOriginalImage(current);
    const errors = [];
    console.log('[segmentClothImage] original cloud fileID', sourceFileID);

    let sourceBuffer;
    try {
      sourceBuffer = await downloadWechatCloudFile(sourceFileID);
    } catch (error) {
      const message = getErrorMessage(error);
      console.error('[segmentClothImage] download wechat cloud file failed', {
        sourceFileID,
        message,
      });
      await markCutoutFailed(collection, clothingId, sourceFileID, [`download:${message}`]);
      const updated = await collection.doc(clothingId).get();
      return ok(toClothing(updated.data));
    }

    let imageUrl;
    let ossObjectKey = '';
    try {
      ossObjectKey = `wardrobe/${OPENID}/viapi-source/${clothingId}-${Date.now()}${getFileExt(sourceFileID)}`;
      imageUrl = await uploadBufferToOss({
        buffer: sourceBuffer,
        objectKey: ossObjectKey,
      });
    } catch (error) {
      const message = getErrorMessage(error);
      console.error('[segmentClothImage] upload source image to OSS failed', {
        sourceFileID,
        bufferSize: sourceBuffer.length,
        message,
      });
      await markCutoutFailed(collection, clothingId, sourceFileID, [`oss:${message}`]);
      const updated = await collection.doc(clothingId).get();
      return ok(toClothing(updated.data));
    }

    try {
      for (const provider of PROVIDERS) {
        try {
          const viapiUrl = await retryOnce(() => callViapiSegment(provider.action, imageUrl));
          const fileID = await saveRemoteImage({
            remoteUrl: viapiUrl,
            cloudPath: `wardrobe/${OPENID}/clothes/cutout/${clothingId}-${Date.now()}.png`,
          });
          const data = {
            displayImageUrl: fileID,
            cutoutStatus: 'success',
            cutoutProvider: provider.name,
            cutoutError: '',
            updatedAt: new Date().toISOString(),
          };
          await collection.doc(clothingId).update({ data });
          const updated = await collection.doc(clothingId).get();
          return ok(toClothing(updated.data));
        } catch (error) {
          const normalized = normalizeViapiError(error);
          console.error('[segmentClothImage] VIAPI provider failed', {
            provider: provider.name,
            action: provider.action,
            requestId: normalized.requestId,
            code: normalized.code,
            message: normalized.message,
          });
          errors.push(`${provider.name}:${normalized.code || 'unknown'}:${normalized.message}`);
        }
      }
    } finally {
      await deleteOssObject(ossObjectKey);
    }

    await markCutoutFailed(collection, clothingId, sourceFileID, errors);
    const updated = await collection.doc(clothingId).get();
    return ok(toClothing(updated.data));
  } catch (error) {
    console.error('[segmentClothImage] failed', error);
    return fail(error);
  }
};

function createClient() {
  const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET;
  const region = process.env.ALIYUN_VIAPI_REGION || 'cn-shanghai';
  if (!accessKeyId || !accessKeySecret) throw new Error('ALIYUN_ACCESS_KEY_ID/SECRET is missing');

  const { RPCClient } = require('@alicloud/pop-core');
  return new RPCClient({
    accessKeyId,
    accessKeySecret,
    endpoint: `https://imageseg.${region}.aliyuncs.com`,
    apiVersion: '2019-12-30',
  });
}

async function callViapiSegment(action, imageUrl) {
  const client = createClient();
  console.log('[segmentClothImage] calling VIAPI', {
    action,
    imageUrlType: getImageUrlType(imageUrl),
    imageUrlInfo: getImageUrlInfo(imageUrl),
  });
  let response;
  try {
    response = await client.request(action, { ImageURL: imageUrl }, { method: 'POST', timeout: SEGMENT_TIMEOUT_MS });
  } catch (error) {
    const normalized = normalizeViapiError(error);
    console.error('[segmentClothImage] VIAPI request error', {
      action,
      imageUrlType: getImageUrlType(imageUrl),
      imageUrlInfo: getImageUrlInfo(imageUrl),
      requestId: normalized.requestId,
      code: normalized.code,
      message: normalized.message,
    });
    throw error;
  }
  console.log('[segmentClothImage] VIAPI response', {
    action,
    requestId: response && (response.RequestId || response.requestId),
  });
  const resultUrl = extractResultUrl(response);
  if (!resultUrl) throw new Error(`${action} returned empty ImageURL`);
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
  console.log('[segmentClothImage] download wechat cloud file success', {
    sourceFileID: fileID,
    bufferSize: buffer.length,
  });
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
  const accessKeyId = process.env.ALIYUN_OSS_ACCESS_KEY_ID || process.env.ALIYUN_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIYUN_OSS_ACCESS_KEY_SECRET || process.env.ALIYUN_ACCESS_KEY_SECRET;
  if (!accessKeyId || !accessKeySecret) throw new Error('ALIYUN_ACCESS_KEY_ID/SECRET is missing');
  if (!OSS_BUCKET) throw new Error('ALIYUN_OSS_BUCKET is missing');

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

function getErrorMessage(error) {
  return error && error.message ? error.message : String(error || 'unknown error');
}

function getOriginalImage(item) {
  return item.originalImageUrl || '';
}

function getDisplayImage(item) {
  return item.displayImageUrl || getOriginalImage(item);
}

async function markCutoutFailed(collection, clothingId, sourceFileID, errors) {
  const data = {
    displayImageUrl: sourceFileID,
    cutoutStatus: 'failed',
    cutoutProvider: 'none',
    cutoutError: errors.join('|'),
    updatedAt: new Date().toISOString(),
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

function ok(data) {
  return { code: 0, data, message: 'ok' };
}

function fail(error) {
  return { code: 1, data: null, message: getErrorMessage(error) };
}
