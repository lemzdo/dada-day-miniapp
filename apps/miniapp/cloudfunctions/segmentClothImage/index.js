const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const SEGMENT_TIMEOUT_MS = Number(process.env.SEGMENT_TIMEOUT_MS || 60000);
const OSS_REGION = normalizeOssRegion(process.env.OSS_REGION || process.env.ALIYUN_OSS_REGION || '');
const OSS_BUCKET = process.env.OSS_BUCKET || process.env.ALIYUN_OSS_BUCKET || '';
const OSS_URL_EXPIRES_SECONDS = Number(process.env.OSS_URL_EXPIRES_SECONDS || process.env.ALIYUN_OSS_URL_EXPIRES_SECONDS || 1800);
const OSS_USE_SIGNED_URL = getOssUseSignedUrl();
const SEGMENT_PROVIDER = 'aliyun_viapi';
const SEGMENT_MODEL = 'SegmentCloth';
const DELETED_STATUS = 'deleted';
const CLOTHING_NOT_ACTIVE = 'CLOTHING_NOT_ACTIVE';
const SEGMENT_TRANSACTION_UNAVAILABLE = 'SEGMENT_TRANSACTION_UNAVAILABLE';

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
  if (!OSS_BUCKET) getRequiredEnv('ALIYUN_OSS_BUCKET');
  if (!OSS_REGION) getRequiredEnv('ALIYUN_OSS_REGION');
}

async function segmentDraft(draftId, openid) {
  const collection = db.collection('clothes_drafts');
  const currentRes = await collection.doc(draftId).get();
  const current = currentRes.data;
  if (!current || current._openid !== openid) throw new Error('draft not found');
  if (current.status !== 'pending') return ok(toDraft(current));

  const cropResult = await ensureSingleItemCrop({
    collection,
    objectId: draftId,
    item: current,
    fallbackCloudPath: `wardrobe_uploads/crops/${current.batchId}/${current.sourceImageId || draftId}-${current.itemIndex || 0}-retry.jpg`,
  });
  const sourceFileID = cropResult.sourceFileID;
  await collection.doc(draftId).update({
    data: {
      segmentStatus: 'processing',
      cropImageUrl: cropResult.cropImageUrl || current.cropImageUrl || current.croppedImageUrl || '',
      croppedImageUrl: cropResult.cropImageUrl || current.croppedImageUrl || current.cropImageUrl || '',
      segmentProvider: SEGMENT_PROVIDER,
      segmentModel: SEGMENT_MODEL,
      segmentError: '',
      stageStatus: {
        ...(current.stageStatus || {}),
        crop: cropResult.cropStatus,
        segment: normalizeFinalStageStatus(current.stageStatus && current.stageStatus.segment),
      },
      updatedAt: nowIso(),
    },
  });

  if (!sourceFileID) {
    await collection.doc(draftId).update({
      data: {
        segmentStatus: 'failed',
        segmentProvider: SEGMENT_PROVIDER,
        segmentModel: SEGMENT_MODEL,
        segmentError: 'single crop image is required',
        segmentErrorMessage: 'single crop image is required',
        errorMessage: 'single crop image is required',
        cleanImageUrl: '',
        aiSegmentImageUrl: '',
        displayImageUrl: current.cropImageUrl || current.croppedImageUrl || current.originalImageUrl,
        imageUrl: current.cropImageUrl || current.croppedImageUrl || current.originalImageUrl,
        imageSourceType: current.cropImageUrl || current.croppedImageUrl ? 'crop' : 'original',
        assetStatus: 'needs_review',
        needsUserConfirm: true,
        stageStatus: {
          ...(current.stageStatus || {}),
          crop: cropResult.cropStatus,
          segment: 'failed',
        },
        updatedAt: nowIso(),
      },
    });
    const updated = await collection.doc(draftId).get();
    return ok(toDraft(updated.data));
  }

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
        cleanImageUrl: '',
        aiSegmentImageUrl: '',
        displayImageUrl: sourceFileID || current.originalImageUrl,
        imageUrl: sourceFileID || current.originalImageUrl,
        imageSourceType: sourceFileID && sourceFileID !== current.originalImageUrl ? 'crop' : 'original',
        assetStatus: 'needs_review',
        needsUserConfirm: true,
        stageStatus: {
          ...(current.stageStatus || {}),
          crop: cropResult.cropStatus,
          segment: 'failed',
        },
        updatedAt: nowIso(),
      },
    });
    const updated = await collection.doc(draftId).get();
    return ok(toDraft(updated.data));
  }

  const data = {
    cleanImageUrl: result.fileID,
    aiSegmentImageUrl: result.fileID,
    segmentStatus: 'success',
    segmentProvider: SEGMENT_PROVIDER,
    segmentModel: SEGMENT_MODEL,
    segmentError: '',
    assetStatus: current.assetStatus === 'failed' ? 'needs_review' : current.assetStatus || 'ready',
    qualityScore: Math.max(current.qualityScore || 0, 80),
    needsUserConfirm: current.needsUserConfirm === true && (current.qualityScore || 0) < 80,
    stageStatus: {
      ...(current.stageStatus || {}),
      crop: cropResult.cropStatus,
      segment: 'success',
    },
    updatedAt: nowIso(),
  };
  if (canAutoUseSegment(current)) {
    data.displayImageUrl = result.fileID;
    data.imageUrl = result.fileID;
    data.imageSourceType = 'clean';
  }

  await collection.doc(draftId).update({ data });
  const updated = await collection.doc(draftId).get();
  return ok(toDraft(updated.data));
}

async function segmentClothing(clothingId, openid) {
  const collection = db.collection('clothes');
  const lease = await acquireClothingSegmentAttempt(collection, clothingId, openid);
  const current = lease.clothing;

  const cropResult = await ensureSingleItemCrop({
    collection,
    objectId: clothingId,
    item: current,
    fallbackCloudPath: `wardrobe_uploads/crops/${current.batchId || 'clothes'}/${current.sourceImageId || clothingId}-${current.itemIndex || 0}-retry.jpg`,
    persistCropResult: false,
  });
  const sourceFileID = cropResult.sourceFileID;

  const heartbeat = await touchClothingSegmentHeartbeat(collection, {
    clothingId,
    openid,
    token: lease.token,
    cropResult,
  });
  if (heartbeat.status === 'superseded') return ok(heartbeat);

  if (!sourceFileID) {
    const failure = await finishClothingSegmentFailure(collection, {
      clothingId,
      openid,
      token: lease.token,
      errors: ['single crop image is required'],
    });
    return ok(toSegmentAttemptResult(failure));
  }

  const result = await runSegment({
    openid,
    sourceFileID,
    objectId: clothingId,
    cloudPath: `wardrobe/${openid}/clothes/segment/${clothingId}-${Date.now()}.png`,
  });

  if (!result.success) {
    const failure = await finishClothingSegmentFailure(collection, {
      clothingId,
      openid,
      token: lease.token,
      errors: result.errors,
    });
    return ok(toSegmentAttemptResult(failure));
  }

  const success = await finishClothingSegmentSuccess(collection, {
    clothingId,
    openid,
    token: lease.token,
    fileID: result.fileID,
    cropStatus: cropResult.cropStatus,
  });
  return ok(toSegmentAttemptResult(success));
}

async function acquireClothingSegmentAttempt(collection, clothingId, openid) {
  if (typeof db.runTransaction !== 'function') throw new Error(SEGMENT_TRANSACTION_UNAVAILABLE);
  const token = createAttemptToken();
  const now = nowIso();

  return db.runTransaction(async (transaction) => {
    const ref = transaction.collection('clothes').doc(clothingId);
    const currentRes = await ref.get();
    const current = currentRes.data;
    if (!current || current._openid !== openid) throw new Error('clothing not found');
    if (isDeletedClothing(current)) throw new Error(CLOTHING_NOT_ACTIVE);

    const data = {
      segmentStatus: 'processing',
      cutoutStatus: 'processing',
      segmentProvider: SEGMENT_PROVIDER,
      segmentModel: SEGMENT_MODEL,
      segmentError: '',
      cutoutError: '',
      segmentAttemptToken: token,
      segmentStartedAt: now,
      segmentHeartbeatAt: now,
      stageStatus: {
        ...(current.stageStatus || {}),
        segment: 'processing',
      },
      updatedAt: now,
    };

    await ref.update({ data });
    return { token, clothing: { ...current, ...data, _id: clothingId } };
  }, 3);
}

async function touchClothingSegmentHeartbeat(collection, { clothingId, openid, token, cropResult }) {
  return updateClothingSegmentWithToken(collection, {
    clothingId,
    openid,
    token,
    patchBuilder: (current) => {
      const cropImageUrl = cropResult.cropImageUrl || current.cropImageUrl || current.croppedImageUrl || '';
      const data = {
        segmentHeartbeatAt: nowIso(),
        segmentStatus: 'processing',
        cutoutStatus: 'processing',
        stageStatus: {
          ...(current.stageStatus || {}),
          crop: cropResult.cropStatus,
          segment: 'processing',
        },
        updatedAt: nowIso(),
      };
      if (cropImageUrl) {
        data.cropImageUrl = cropImageUrl;
        data.croppedImageUrl = cropImageUrl;
      }
      return data;
    },
  });
}

async function finishClothingSegmentSuccess(collection, { clothingId, openid, token, fileID, cropStatus }) {
  return updateClothingSegmentWithToken(collection, {
    clothingId,
    openid,
    token,
    patchBuilder: (current) => ({
      cleanImageUrl: fileID,
      aiSegmentImageUrl: fileID,
      displayImageUrl: fileID,
      imageUrl: fileID,
      imageSourceType: 'clean',
      assetStatus: current.assetStatus === 'failed' ? 'needs_review' : current.assetStatus || 'ready',
      qualityScore: Math.max(current.qualityScore || 0, 80),
      segmentStatus: 'success',
      cutoutStatus: 'success',
      segmentProvider: SEGMENT_PROVIDER,
      segmentModel: SEGMENT_MODEL,
      cutoutProvider: SEGMENT_PROVIDER,
      cutoutError: '',
      segmentError: '',
      segmentAttemptToken: '',
      segmentHeartbeatAt: nowIso(),
      stageStatus: {
        ...(current.stageStatus || {}),
        crop: cropStatus,
        segment: 'success',
      },
      updatedAt: nowIso(),
    }),
  });
}

async function finishClothingSegmentFailure(collection, { clothingId, openid, token, errors }) {
  const errorMessage = (errors || []).join('|') || 'segment failed';
  return updateClothingSegmentWithToken(collection, {
    clothingId,
    openid,
    token,
    patchBuilder: () => ({
      segmentStatus: 'failed',
      cutoutStatus: 'failed',
      segmentError: errorMessage,
      cutoutError: errorMessage,
      segmentAttemptToken: '',
      segmentHeartbeatAt: nowIso(),
      updatedAt: nowIso(),
    }),
  });
}

async function updateClothingSegmentWithToken(collection, { clothingId, openid, token, patchBuilder }) {
  return db.runTransaction(async (transaction) => {
    const ref = transaction.collection('clothes').doc(clothingId);
    const currentRes = await ref.get();
    const current = currentRes.data;
    if (!current || current._openid !== openid) throw new Error('clothing not found');
    if (isDeletedClothing(current) || current.segmentAttemptToken !== token) {
      return { status: 'superseded' };
    }

    const data = patchBuilder(current);
    await ref.update({ data });
    return { status: 'updated', clothing: { ...current, ...data, _id: clothingId } };
  }, 3);
}

function toSegmentAttemptResult(result) {
  if (result.status === 'superseded') return { status: 'superseded' };
  return toClothing(result.clothing);
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

async function ensureSingleItemCrop({ collection, objectId, item, fallbackCloudPath, persistCropResult = true }) {
  const existingCrop = item.cropImageUrl || item.croppedImageUrl || '';
  if (existingCrop) {
    return { sourceFileID: existingCrop, cropImageUrl: existingCrop, cropStatus: 'success' };
  }

  const bbox = item.bbox || item.cropBox;
  if (!bbox) {
    if (!item.batchId && !item.sourceImageId) {
      return { sourceFileID: getOriginalImage(item), cropImageUrl: '', cropStatus: 'skipped' };
    }
    return { sourceFileID: '', cropImageUrl: '', cropStatus: 'failed' };
  }

  try {
    const cropImageUrl = await cropCloudImage({
      originalImageUrl: getOriginalImage(item),
      bbox,
      cloudPath: fallbackCloudPath,
    });
    if (persistCropResult) {
      await collection.doc(objectId).update({
        data: {
          cropImageUrl,
          croppedImageUrl: cropImageUrl,
          displayImageUrl: item.displayImageUrl || cropImageUrl,
          imageSourceType: item.imageSourceType === 'clean' ? 'clean' : 'crop',
          updatedAt: nowIso(),
        },
      }).catch(() => undefined);
    }
    return { sourceFileID: cropImageUrl, cropImageUrl, cropStatus: 'success' };
  } catch (error) {
    console.warn('[segmentClothImage] crop before segment failed', {
      objectId,
      message: getErrorMessage(error),
    });
    if (!item.batchId && !item.sourceImageId) {
      return { sourceFileID: getOriginalImage(item), cropImageUrl: '', cropStatus: 'failed' };
    }
    return { sourceFileID: '', cropImageUrl: '', cropStatus: 'failed' };
  }
}

async function cropCloudImage({ originalImageUrl, bbox, cloudPath }) {
  const sourceBuffer = await downloadImageSource(originalImageUrl);
  const Jimp = require('jimp');
  const image = await Jimp.read(sourceBuffer);
  const cropBox = toPaddedPixelBox(normalizeBBox(bbox), image.bitmap.width, image.bitmap.height, 0.12);
  const cropped = image.clone().crop(cropBox.x, cropBox.y, cropBox.width, cropBox.height).quality(92);
  const buffer = await cropped.getBufferAsync(Jimp.MIME_JPEG);
  const uploadRes = await cloud.uploadFile({ cloudPath, fileContent: buffer });
  return uploadRes.fileID;
}

async function downloadImageSource(fileID) {
  if (fileID && typeof fileID === 'string' && /^https?:\/\//.test(fileID)) {
    const fetch = require('node-fetch');
    const response = await fetch(fileID, { timeout: SEGMENT_TIMEOUT_MS });
    if (!response.ok) throw new Error(`download_image_failed_${response.status}`);
    return response.buffer();
  }
  return downloadWechatCloudFile(fileID);
}

function normalizeBBox(value) {
  if (!value || typeof value !== 'object') throw new Error('bbox is required');
  const x = Number(value.x ?? value.left ?? 0);
  const y = Number(value.y ?? value.top ?? 0);
  const width = Number(value.width ?? ((value.right ?? value.x2 ?? 0) - x));
  const height = Number(value.height ?? ((value.bottom ?? value.y2 ?? 0) - y));
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new Error('bbox is invalid');
  }
  return {
    x: clamp01(x),
    y: clamp01(y),
    width: clamp01(width),
    height: clamp01(height),
  };
}

function toPaddedPixelBox(bbox, imageWidth, imageHeight, paddingRatio) {
  const x = bbox.x * imageWidth;
  const y = bbox.y * imageHeight;
  const width = bbox.width * imageWidth;
  const height = bbox.height * imageHeight;
  const padX = width * paddingRatio;
  const padY = height * paddingRatio;
  const left = Math.max(0, Math.floor(x - padX));
  const top = Math.max(0, Math.floor(y - padY));
  const right = Math.min(imageWidth, Math.ceil(x + width + padX));
  const bottom = Math.min(imageHeight, Math.ceil(y + height + padY));
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value)));
}

function getOssUseSignedUrl() {
  const value = process.env.OSS_USE_SIGNED_URL
    ?? process.env.ALIYUN_OSS_USE_SIGNED_URL
    ?? 'false';
  return String(value).trim().toLowerCase() === 'true';
}

function normalizeFinalStageStatus(value) {
  return value === 'success' || value === 'failed' || value === 'skipped' ? value : 'skipped';
}

function normalizeStageStatusMap(value) {
  const source = value || {};
  return {
    router: normalizeFinalStageStatus(source.router),
    detection: normalizeFinalStageStatus(source.detection),
    crop: normalizeFinalStageStatus(source.crop),
    segment: normalizeFinalStageStatus(source.segment),
    attribute: normalizeFinalStageStatus(source.attribute),
  };
}

function createClient() {
  const accessKeyId = getRequiredEnv('ALIYUN_ACCESS_KEY_ID');
  const accessKeySecret = getRequiredEnv('ALIYUN_ACCESS_KEY_SECRET');
  const region = process.env.ALIYUN_REGION || process.env.ALIYUN_VIAPI_REGION || 'cn-shanghai';
  const endpoint = process.env.ALIYUN_SEGMENT_CLOTH_ENDPOINT || `https://imageseg.${region}.aliyuncs.com`;

  const { RPCClient } = require('@alicloud/pop-core');
  return new RPCClient({
    accessKeyId,
    accessKeySecret,
    endpoint,
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
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID || process.env.ALIYUN_OSS_ACCESS_KEY_ID || getRequiredEnv('ALIYUN_ACCESS_KEY_ID');
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET || process.env.ALIYUN_OSS_ACCESS_KEY_SECRET || getRequiredEnv('ALIYUN_ACCESS_KEY_SECRET');

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
    assetVersion: item.assetVersion || 'v1',
    batchId: item.batchId,
    sourceImageId: item.sourceImageId,
    itemIndex: item.itemIndex || 0,
    originalImageUrl: item.originalImageUrl,
    normalizedImageUrl: item.normalizedImageUrl || item.originalImageUrl,
    cropImageUrl: item.cropImageUrl || item.croppedImageUrl || '',
    croppedImageUrl: item.croppedImageUrl || item.cropImageUrl || '',
    maskImageUrl: item.maskImageUrl || '',
    cleanImageUrl: item.cleanImageUrl || item.aiSegmentImageUrl || '',
    displayImageUrl: getDisplayImage(item),
    imageUrl: item.imageUrl || getDisplayImage(item),
    imageSourceType: normalizeImageSourceType(item),
    assetStatus: item.assetStatus || 'needs_review',
    qualityScore: item.qualityScore || 0,
    needsUserConfirm: item.needsUserConfirm !== false,
    confirmReasons: item.confirmReasons || [],
    bbox: item.bbox || item.cropBox,
    stageStatus: normalizeStageStatusMap(item.stageStatus),
    providerTrace: item.providerTrace || [],
    aiSegmentImageUrl: item.aiSegmentImageUrl || item.cleanImageUrl || '',
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
    assetVersion: item.assetVersion || 'v1',
    originalImageUrl,
    normalizedImageUrl: item.normalizedImageUrl || originalImageUrl,
    cropImageUrl: item.cropImageUrl || item.croppedImageUrl || '',
    croppedImageUrl: item.croppedImageUrl || item.cropImageUrl || '',
    maskImageUrl: item.maskImageUrl || '',
    cleanImageUrl: item.cleanImageUrl || item.aiSegmentImageUrl || '',
    displayImageUrl,
    imageUrl: item.imageUrl || displayImageUrl,
    imageSourceType: normalizeImageSourceType(item),
    assetStatus: item.assetStatus || 'needs_review',
    qualityScore: item.qualityScore || 0,
    needsUserConfirm: item.needsUserConfirm !== false,
    confirmReasons: item.confirmReasons || [],
    bbox: item.bbox || item.cropBox,
    stageStatus: normalizeStageStatusMap(item.stageStatus),
    providerTrace: item.providerTrace || [],
    aiSegmentImageUrl: item.aiSegmentImageUrl || item.cleanImageUrl || '',
    manualCropImageUrl: item.manualCropImageUrl || '',
    segmentStatus: item.segmentStatus || item.cutoutStatus || 'not_started',
    segmentAttemptToken: item.segmentAttemptToken || '',
    segmentStartedAt: item.segmentStartedAt,
    segmentHeartbeatAt: item.segmentHeartbeatAt,
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

function createAttemptToken() {
  return crypto.randomBytes(16).toString('hex');
}

function isDeletedClothing(item) {
  return item && (item.status === DELETED_STATUS || item.isDeleted || item.deletedAt);
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
  return item.cleanImageUrl
    || item.aiSegmentImageUrl
    || item.cropImageUrl
    || item.croppedImageUrl
    || item.displayImageUrl
    || item.imageUrl
    || item.manualCropImageUrl
    || getOriginalImage(item);
}

function canAutoUseSegment(item) {
  const originalImageUrl = getOriginalImage(item);
  return ['original', 'crop', 'ai_segment', 'manual_crop', undefined, ''].includes(item.imageSourceType)
    && !item.cleanImageUrl
    && (!item.displayImageUrl || item.displayImageUrl === originalImageUrl || item.displayImageUrl === item.cropImageUrl || item.displayImageUrl === item.croppedImageUrl);
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
