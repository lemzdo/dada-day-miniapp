'use strict';

const CanonicalAssetKind = Object.freeze({ ORIGINAL: 'ORIGINAL', CROP: 'CROP', CLEAN: 'CLEAN', NORMALIZED: 'NORMALIZED', DISPLAY: 'DISPLAY', THUMBNAIL: 'THUMBNAIL' });
const AssetUsage = Object.freeze({ LIST: 'LIST', CARD: 'CARD', DETAIL: 'DETAIL', SNAPSHOT: 'SNAPSHOT' });
const AssetQualityStatus = Object.freeze({ VALID: 'VALID', NEEDS_REVIEW: 'NEEDS_REVIEW', INVALID: 'INVALID' });
const CompatProfile = Object.freeze({ TODAY_CARD: 'TODAY_CARD', SAVED_CARD: 'SAVED_CARD', DETAIL_THUMBNAIL: 'DETAIL_THUMBNAIL', DETAIL_DISPLAY: 'DETAIL_DISPLAY' });

const fields = {
  // imageUrl is a legacy presentation alias. It must never become a durable fact.
  ORIGINAL: ['originalImageUrl'],
  CROP: ['cropImageUrl', 'croppedImageUrl'],
  CLEAN: ['cleanImageUrl', 'aiSegmentImageUrl'],
  NORMALIZED: ['normalizedImageUrl'],
  DISPLAY: ['displayImageUrl', 'cleanImageUrl', 'normalizedImageUrl', 'cropImageUrl', 'croppedImageUrl', 'originalImageUrl', 'imageUrl'],
  THUMBNAIL: ['thumbnailUrl', 'displayImageUrl', 'cleanImageUrl', 'normalizedImageUrl', 'cropImageUrl', 'croppedImageUrl', 'originalImageUrl', 'imageUrl'],
};
const TEMP_QUERY = /(?:^|[?&])(?:x-amz-(?:signature|algorithm|credential|date|expires)|signature|sign|sig|expires|token)=/i;
const TEMP_HOST = /(?:^|[.-])(sign|signed|presign|presigned|temporary|temp)(?:[.-]|$)/i;

function nonEmpty(value) { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function isTemporaryHttpsUrl(value) {
  const url = nonEmpty(value);
  if (!url || !/^https:\/\//i.test(url)) return false;
  try { const parsed = new URL(url); return TEMP_QUERY.test(parsed.search) || TEMP_HOST.test(parsed.hostname); } catch { return false; }
}
function isStableAssetReference(value) {
  const ref = nonEmpty(value);
  return Boolean(ref && !isTemporaryHttpsUrl(ref) && (/^cloud:\/\//i.test(ref) || /^https:\/\//i.test(ref) || /^oss:\/\//i.test(ref) || /^s3:\/\//i.test(ref)));
}
function getStableOriginalReference(garment, options = {}) {
  const explicit = nonEmpty(options.originalReference || options.originalAssetRef);
  if (isStableAssetReference(explicit)) return explicit;
  const cloud = nonEmpty(garment && (garment.originalCloudFileId || garment.cloudFileId));
  if (cloud) return cloud;
  const original = nonEmpty(garment && garment.originalImageUrl);
  return isStableAssetReference(original) ? original : undefined;
}
function getStableFactReference(garment, options = {}) {
  const explicit = nonEmpty(options.factReference || options.originalAssetRef);
  if (isStableAssetReference(explicit)) return explicit;
  const original = getStableOriginalReference(garment, options);
  if (original) return original;
  // Durable source order intentionally excludes displayImageUrl, thumbnailUrl and imageUrl.
  for (const key of ['originalImageUrl', 'normalizedImageUrl', 'cleanImageUrl', 'aiSegmentImageUrl', 'cropImageUrl', 'croppedImageUrl']) {
    const value = nonEmpty(garment && garment[key]);
    if (isStableAssetReference(value)) return value;
  }
  return undefined;
}

function qualityStatus(garment) {
  if (!garment || garment.assetStatus === 'failed' || garment.qualityStatus === 'INVALID') return AssetQualityStatus.INVALID;
  if (garment.needsUserConfirm || garment.needsReview || garment.assetStatus === 'needs_review' || garment.qualityStatus === 'NEEDS_REVIEW') return AssetQualityStatus.NEEDS_REVIEW;
  if (garment.assetStatus === 'ready' || garment.assetStatus === 'VALID' || garment.qualityStatus === 'VALID') return AssetQualityStatus.VALID;
  if (typeof garment.qualityScore === 'number' && garment.qualityScore < 80) return AssetQualityStatus.NEEDS_REVIEW;
  return AssetQualityStatus.VALID;
}
function resolveKind(garment, kind, options = {}) {
  const keys = fields[kind];
  for (const key of keys) { const url = nonEmpty(garment && garment[key]); if (url) { const isTemporary = isTemporaryHttpsUrl(url); return { kind, url, field: key, isFact: !isTemporary && (kind === 'ORIGINAL' || kind === 'CROP' || kind === 'CLEAN' || kind === 'NORMALIZED'), isTemporary }; } }
  return undefined;
}
function adaptLegacyGarmentAssets(garment) {
  const source = garment || {};
  const assets = {};
  for (const kind of Object.keys(fields)) assets[kind] = resolveKind(source, kind);
  const originalReference = getStableOriginalReference(source);
  const factReference = getStableFactReference(source);
  return { ...source, assets, factReference, originalAssetRef: originalReference, qualityStatus: qualityStatus(source), assetVersion: nonEmpty(source.assetVersion) || 'legacy' };
}
function resolveGarmentAsset(garment, usage, options = {}) {
  const profilePriorities = {
    TODAY_CARD: ['displayImageUrl', 'thumbnailUrl', 'imageUrl'],
    SAVED_CARD: ['thumbnailUrl', 'imageUrl', 'displayImageUrl'],
    DETAIL_THUMBNAIL: ['thumbnailUrl', 'displayImageUrl', 'imageUrl'],
    DETAIL_DISPLAY: ['displayImageUrl', 'imageUrl', 'thumbnailUrl'],
  };
  const profile = options.compatProfile;
  if (profile && profilePriorities[profile]) {
    for (const field of profilePriorities[profile]) {
      const url = nonEmpty(garment && garment[field]);
      if (url) return { kind: field === 'thumbnailUrl' ? 'THUMBNAIL' : 'DISPLAY', url, field, usage, policy: 'compat', isFact: false, isTemporary: isTemporaryHttpsUrl(url), qualityStatus: qualityStatus(garment), factReference: getStableFactReference(garment, options) };
    }
  }
  const policy = options.compatPolicy || 'canonical';
  const priority = usage === 'LIST' ? ['THUMBNAIL', 'DISPLAY'] : usage === 'DETAIL' ? ['DISPLAY', 'NORMALIZED', 'CLEAN', 'CROP', 'ORIGINAL'] : usage === 'SNAPSHOT' ? ['DISPLAY', 'THUMBNAIL', 'ORIGINAL'] : ['DISPLAY', 'THUMBNAIL', 'NORMALIZED', 'CLEAN', 'CROP', 'ORIGINAL'];
  for (const kind of priority) { const result = resolveKind(garment, kind, options); if (result) return { ...result, usage, policy, qualityStatus: qualityStatus(garment), factReference: getStableFactReference(garment, options) }; }
  const factReference = getStableFactReference(garment, options);
  return { kind: 'DISPLAY', url: factReference, field: factReference ? 'factReference' : undefined, usage, policy, qualityStatus: qualityStatus(garment), factReference, isFact: false, isTemporary: false };
}
function normalizeGarmentAssetSnapshot(garment, options = {}) {
  const display = resolveGarmentAsset(garment, 'SNAPSHOT', options);
  const thumbnail = resolveKind(garment || {}, 'THUMBNAIL');
  const originalReference = getStableOriginalReference(garment || {}, options);
  const factReference = getStableFactReference(garment || {}, options);
  return { imageUrl: nonEmpty(garment && garment.imageUrl) || display.url || '', displayImageUrl: display.url || '', thumbnailUrl: thumbnail && thumbnail.url || display.url || '', originalImageUrl: originalReference || undefined, originalAssetRef: originalReference || undefined, factReference: factReference || undefined, assetVersion: nonEmpty(garment && garment.assetVersion) || 'legacy', qualityStatus: qualityStatus(garment), assets: adaptLegacyGarmentAssets(garment).assets };
}

module.exports = { CanonicalAssetKind, AssetUsage, AssetQualityStatus, CompatProfile, adaptLegacyGarmentAssets, resolveGarmentAsset, normalizeGarmentAssetSnapshot, isTemporaryHttpsUrl, isTemporarySignedHttpsUrl: isTemporaryHttpsUrl, isStableAssetReference, getStableOriginalReference, getStableFactReference, resolveStableFactReference: getStableFactReference };
