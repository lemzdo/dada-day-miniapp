'use strict';

// Deliberately conservative physical checks. These values reject only images
// that cannot be useful as a garment asset; semantic completeness is deferred.
const MIN_DIMENSION = 2;
const MIN_VISIBLE_PIXELS = 4;
const TINY_CONTENT_COVERAGE = 0.002;
const BLANK_CONTENT_COVERAGE = 0.0001;
const ALPHA_VISIBLE = 8;
const BACKGROUND_DISTANCE = 12;

async function checkSegmentationIntegrity(buffer, options = {}) {
  const result = {
    status: 'VALID',
    valid: true,
    reasons: [],
    checks: {
      decode: 'NOT_AVAILABLE',
      dimensions: 'NOT_AVAILABLE',
      nonEmpty: 'NOT_AVAILABLE',
      alphaCoverage: 'NOT_AVAILABLE',
      visibleCoverage: 'NOT_AVAILABLE',
      contentBoundingBox: 'NOT_AVAILABLE',
      blank: 'NOT_AVAILABLE',
      tinySubject: 'NOT_AVAILABLE',
    },
  };
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return fail(result, 'empty_output', 'INVALID');

  let image;
  try {
    const Jimp = options.Jimp || require('jimp');
    image = await Jimp.read(buffer);
    result.checks.decode = 'PASS';
  } catch (error) {
    return fail(result, `decode_failed:${error && error.message ? error.message : 'invalid_image'}`, 'INVALID');
  }

  const width = Number(image && image.bitmap && image.bitmap.width);
  const height = Number(image && image.bitmap && image.bitmap.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < MIN_DIMENSION || height < MIN_DIMENSION) {
    return fail(result, 'invalid_dimensions', 'INVALID');
  }
  result.width = width;
  result.height = height;
  result.checks.dimensions = 'PASS';

  const data = image.bitmap.data;
  if (!data || data.length < width * height * 4) return fail(result, 'empty_pixels', 'INVALID');
  let visible = 0;
  let alphaVisible = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  const corner = pixelAt(data, width, 0, 0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = pixelAt(data, width, x, y);
      if (pixel.a >= ALPHA_VISIBLE) alphaVisible += 1;
      const isVisible = pixel.a >= ALPHA_VISIBLE
        && (corner.a < ALPHA_VISIBLE || pixel.a < 250 || colorDistance(pixel, corner) >= BACKGROUND_DISTANCE);
      if (!isVisible) continue;
      visible += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  const total = width * height;
  const alphaCoverage = alphaVisible / total;
  const visibleCoverage = visible / total;
  result.alphaCoverage = alphaCoverage;
  result.visibleCoverage = visibleCoverage;
  result.checks.nonEmpty = visible >= MIN_VISIBLE_PIXELS ? 'PASS' : 'FAIL';
  result.checks.alphaCoverage = 'PASS';
  result.checks.visibleCoverage = visible >= MIN_VISIBLE_PIXELS ? 'PASS' : 'FAIL';

  if (maxX < 0) return fail(result, 'blank_or_transparent', 'INVALID');
  const bboxCoverage = ((maxX - minX + 1) * (maxY - minY + 1)) / total;
  result.contentBoundingBox = { x: minX / width, y: minY / height, width: (maxX - minX + 1) / width, height: (maxY - minY + 1) / height };
  result.contentBboxCoverage = bboxCoverage;
  result.checks.contentBoundingBox = 'PASS';
  if (visibleCoverage <= BLANK_CONTENT_COVERAGE) return fail(result, 'blank_or_transparent', 'INVALID');
  result.checks.blank = 'PASS';
  if (visibleCoverage <= TINY_CONTENT_COVERAGE || bboxCoverage <= TINY_CONTENT_COVERAGE) {
    result.checks.tinySubject = 'FAIL';
    return fail(result, 'tiny_subject', 'NEEDS_REVIEW');
  }
  result.checks.tinySubject = 'PASS';
  return result;
}

function pixelAt(data, width, x, y) {
  const offset = (y * width + x) * 4;
  return { r: data[offset], g: data[offset + 1], b: data[offset + 2], a: data[offset + 3] };
}

function colorDistance(left, right) {
  return Math.max(Math.abs(left.r - right.r), Math.abs(left.g - right.g), Math.abs(left.b - right.b));
}

function fail(result, reason, status) {
  result.status = status;
  result.valid = false;
  result.reasons.push(reason);
  return result;
}

module.exports = {
  BLANK_CONTENT_COVERAGE,
  TINY_CONTENT_COVERAGE,
  checkSegmentationIntegrity,
};
