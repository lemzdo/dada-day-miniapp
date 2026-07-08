const LOW_QUALITY_COPY_PHRASES = [
  '常见单品',
  '常用单品',
  '穿起来不绕',
  '组合起来不复杂',
  '多一点层次',
  '更有层次',
  '出门前不用大改',
  '少量点',
  '颜色重点的单品已经在这里',
  '其他部分少加复杂元素',
  '整套不会太飘',
  '不至于太淡',
  '放在一起',
  '能确认的主要组合',
  '已有单品本身',
  '不需要强行',
];

const FACTUAL_REWRITES = [
  ['多一点层次', '不全是同一种颜色'],
  ['更有层次', '有深浅变化'],
  ['不至于太淡', '不全是浅色'],
  ['不会太飘', '有颜色落点'],
  ['放在一起', '搭在一起'],
  ['穿起来不绕', '可以直接成套穿'],
  ['出门前不用大改', '不需要临时整套重换'],
  ['少量点', '保留一个小重点'],
];

const FALLBACK_REQUIRED_PHRASES = [
  '常见单品',
  '常用单品',
  '穿起来不绕',
  '组合起来不复杂',
  '出门前不用大改',
  '少量点',
  '颜色重点的单品已经在这里',
  '其他部分少加复杂元素',
];

function sanitizeUserFacingCopy(value, context = {}) {
  const original = typeof value === 'string' ? value : '';
  const fallback = cleanSentence(context.fallback);
  if (requiresGroundedFallback(original)) return fallback || buildGroundedFallback(context);
  const text = cleanSentence(applyFactualRewrites(original));
  if (!text) return fallback || buildGroundedFallback(context);
  if (containsLowQualityCopy(text)) return fallback || buildGroundedFallback(context);
  return text;
}

function containsLowQualityCopy(value) {
  const text = String(value || '');
  return LOW_QUALITY_COPY_PHRASES.some((phrase) => text.includes(phrase));
}

function buildGroundedFallback(context = {}) {
  const names = readItemNames(context.items);
  if (names.length >= 3) return cleanSentence(`${names[0]}、${names[1]}和${names[2]}可以直接成套穿`);
  if (names.length >= 2) return cleanSentence(`${names[0]}和${names[1]}可以直接成套穿`);
  if (names.length === 1) return cleanSentence(`${names[0]}是这套里的主要单品`);
  if (context.scene) return cleanSentence(`${context.scene}场景里先按这套穿`);
  return '这套先按现有单品直接穿。';
}

function applyFactualRewrites(value) {
  let result = typeof value === 'string' ? value : '';
  for (const [from, to] of FACTUAL_REWRITES) {
    result = result.split(from).join(to);
  }
  return result;
}

function requiresGroundedFallback(value) {
  const text = String(value || '');
  return FALLBACK_REQUIRED_PHRASES.some((phrase) => text.includes(phrase));
}

function sanitizeCopyObject(copy = {}, context = {}) {
  const fallback = copy.detailExplanation || copy.todayReason || context.fallback || '';
  const todayReason = sanitizeUserFacingCopy(copy.todayReason, {
    ...context,
    fallback: context.todayFallback || fallback,
  });
  const detailExplanation = sanitizeUserFacingCopy(copy.detailExplanation, {
    ...context,
    fallback: context.detailFallback || todayReason || fallback,
  });
  return {
    ...copy,
    todayReason,
    detailExplanation,
    aiExtraDefault: sanitizeUserFacingCopy(copy.aiExtraDefault || detailExplanation, {
      ...context,
      fallback: detailExplanation,
    }),
    usedPhrases: Array.isArray(copy.usedPhrases)
      ? copy.usedPhrases.filter((phrase) => !LOW_QUALITY_COPY_PHRASES.includes(phrase))
      : [],
  };
}

function readItemNames(items) {
  return uniqueStrings((Array.isArray(items) ? items : [])
    .map((item) => item && (item.displayName || item.name || item.subcategory || item.subCategory || item.category))
    .filter(Boolean))
    .slice(0, 3);
}

function cleanSentence(value) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!text) return '';
  return /[。！？!?]$/.test(text) ? text : `${text}。`;
}

function uniqueStrings(values) {
  const result = [];
  const seen = new Set();
  for (const value of values || []) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

module.exports = {
  LOW_QUALITY_COPY_PHRASES,
  applyFactualRewrites,
  containsLowQualityCopy,
  requiresGroundedFallback,
  sanitizeCopyObject,
  sanitizeUserFacingCopy,
};
