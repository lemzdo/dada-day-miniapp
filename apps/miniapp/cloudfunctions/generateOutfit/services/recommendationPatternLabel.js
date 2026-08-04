const PATTERN_LABELS = Object.freeze({
  stripe: '条纹',
  plaid: '格纹',
  check: '格纹',
  floral: '碎花',
  polkadot: '波点',
  polka_dot: '波点',
  animal: '动物纹',
  abstract: '抽象图案',
  colorblock: '拼色',
  graphic: '有图案的',
  print: '有图案的',
  printed: '有图案的',
  印花: '有图案的',
});

function mapPatternLabel(rawPattern) {
  const normalized = normalizePattern(rawPattern);
  return normalized ? PATTERN_LABELS[normalized] || null : null;
}

function normalizePattern(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/[\s-]+/g, '_').toLowerCase();
}

module.exports = {
  mapPatternLabel,
};
