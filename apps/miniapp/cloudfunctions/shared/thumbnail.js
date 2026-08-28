'use strict';

const { adaptLegacyGarmentAssets, isStableAssetReference } = require('@d1d/garment-assets');

const THUMBNAIL_MAX_SIZE = 360;
const THUMBNAIL_QUALITY = 76;

function resolveThumbnailSource(item) {
  const adapted = adaptLegacyGarmentAssets(item || {});
  for (const kind of ['CLEAN', 'DISPLAY', 'CROP', 'ORIGINAL']) {
    const candidate = adapted.assets && adapted.assets[kind];
    if (candidate && isStableAssetReference(candidate.url)) return candidate.url;
  }
  return '';
}

function isDurableReference(value) {
  return isStableAssetReference(value);
}

async function createThumbnail({ cloud, item, cloudPath }) {
  const sourceImageUrl = resolveThumbnailSource(item);
  if (!sourceImageUrl) throw new Error('thumbnail source image is empty');
  const sourceBuffer = await downloadImageSource({ cloud, fileID: sourceImageUrl });
  const Jimp = require('jimp');
  const image = await Jimp.read(sourceBuffer);
  image.scaleToFit(THUMBNAIL_MAX_SIZE, THUMBNAIL_MAX_SIZE).quality(THUMBNAIL_QUALITY);
  const buffer = await image.getBufferAsync(Jimp.MIME_JPEG);
  const uploadRes = await cloud.uploadFile({ cloudPath, fileContent: buffer });
  if (!uploadRes.fileID) throw new Error('thumbnail upload returned empty fileID');
  return uploadRes.fileID;
}

async function ensureThumbnail({ cloud, item, existingThumbnail, cloudPath }) {
  if (isStableAssetReference(existingThumbnail)) return existingThumbnail;
  return createThumbnail({ cloud, item, cloudPath });
}

async function downloadImageSource({ cloud, fileID }) {
  if (/^https?:\/\//i.test(fileID)) {
    const fetch = require('node-fetch');
    const response = await fetch(fileID, { timeout: getImageFetchTimeoutMs() });
    if (!response.ok) throw new Error(`download_image_failed_${response.status}`);
    return response.buffer();
  }
  const res = await cloud.downloadFile({ fileID });
  const buffer = res && res.fileContent;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('downloaded image is empty');
  return buffer;
}

function getImageFetchTimeoutMs() {
  return Number(process.env.IMAGE_FETCH_TIMEOUT_MS || process.env.AI_TIMEOUT_MS || 30000);
}

module.exports = { createThumbnail, ensureThumbnail, resolveThumbnailSource, isDurableReference };
