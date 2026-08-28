'use strict';

const { loadDeployPackage } = require('./deployPackageResolver');

// The asset package is deliberately resolved at runtime: local cloud-function
// tests can run before the workspace package has been staged, while deployed
// functions receive it as a vendor dependency.
let assetApi = null;
try {
  assetApi = loadDeployPackage('@d1d/garment-assets', ['..', 'vendor', 'garment-assets']);
} catch (_) {
  assetApi = null;
}

const TEMP_URL = /[?&](?:x-amz-[^=]+|expires|signature|token|sig)=/i;

function usable(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function temporaryUrl(value) {
  return /^https:\/\//i.test(value) && TEMP_URL.test(value);
}

function resolveAsset(garment, usage = 'SNAPSHOT') {
  // Do not let presentation aliases (notably imageUrl) become durable fact
  // references. The shared package is given a sanitized source for its
  // durable-reference calculation; display resolution still uses the source
  // garment below and may legitimately fall back to temporary URLs.
  const durableSource = garment && typeof garment === 'object'
    ? { ...garment, imageUrl: undefined, displayImageUrl: undefined, thumbnailUrl: undefined }
    : {};
  const normalized = typeof assetApi?.normalizeGarmentAssetSnapshot === 'function'
    ? assetApi.normalizeGarmentAssetSnapshot(durableSource)
    : null;
  const resolved = typeof assetApi?.resolveGarmentAsset === 'function'
    ? assetApi.resolveGarmentAsset(garment || {}, usage)
    : null;
  const source = resolved && typeof resolved === 'object' ? resolved : garment || {};
  const pick = (...values) => values.map(usable).find(Boolean) || '';
  const original = pick(normalized?.originalImageUrl, garment?.originalImageUrl, garment?.originalCloudFileId, garment?.cloudFileId);
  const fact = pick(normalized?.factReference, garment?.normalizedImageUrl, garment?.cleanImageUrl, garment?.aiSegmentImageUrl, garment?.cropImageUrl, garment?.croppedImageUrl);
  const display = pick(source.display, source.displayImageUrl, source.url, garment?.displayImageUrl, normalized?.displayImageUrl, garment?.cleanImageUrl, garment?.aiSegmentImageUrl, garment?.croppedImageUrl, garment?.imageUrl, original);
  const thumbnail = pick(garment?.thumbnailUrl, normalized?.thumbnailUrl, source.thumbnail, source.thumbnailUrl, display);
  const safeFact = temporaryUrl(fact) ? '' : fact;
  const safeOriginal = temporaryUrl(original) ? '' : original;
  return {
    originalImageUrl: safeOriginal,
    originalAssetRef: safeOriginal,
    factImageUrl: safeFact,
    factReference: safeFact,
    displayImageUrl: display,
    thumbnailUrl: thumbnail,
    assetVersion: pick(normalized?.assetVersion, source.assetVersion, source.version, garment?.assetVersion) || 'legacy',
  };
}

function applySnapshotAsset(item, garment) {
  const asset = resolveAsset(garment || item, 'SNAPSHOT');
  return {
    ...item,
    ...asset,
    // Keep the historical reader contract. imageUrl is a presentation-safe
    // fallback and never replaces the durable original/fact references.
    imageUrl: usable(item?.imageUrl) || asset.displayImageUrl || asset.thumbnailUrl,
  };
}

module.exports = { applySnapshotAsset, resolveAsset, temporaryUrl };
