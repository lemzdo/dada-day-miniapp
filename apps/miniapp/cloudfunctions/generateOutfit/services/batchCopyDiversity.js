const PHRASE_LIMITS = {
  '不用多想': 1,
  '不费心': 1,
  '临时出门': 2,
  '自然': 2,
  '日常': 3,
  '有呼应': 2,
  '不至于太淡': 0,
  '不会太飘': 0,
  '压住一点': 0,
  '压下来一点': 0,
  '放在一起': 0,
};

const ANGLES = ['颜色关系', '场景适配', '天气厚薄', '单品组合', '鞋子收尾', '风格统一', '方便程度'];
const COLOR_ANGLES = new Set(['颜色呼应', '颜色对比', '颜色关系']);

const REPLACEMENTS = {
  '不用多想': ['很直接', '不绕', '一眼能看懂'],
  '不费心': ['省事', '不折腾', '顺手'],
  '临时出门': ['短暂外出', '下楼走走', '附近走走'],
  '自然': ['顺眼', '不刻意', '轻松'],
  '日常': ['平时穿', '生活里', '常用'],
  '有呼应': ['颜色接近', '颜色能接上', '颜色有联系'],
  '不至于太淡': ['多一点层次', '不全是浅色', '多一点变化'],
  '不会太飘': ['更有落点', '不显得轻飘', '更好落在日常里'],
  '压住一点': ['收住一些', '带出一点对比', '加一点分量'],
  '压下来一点': ['收住一些', '带出一点对比', '加一点分量'],
  '放在一起': ['组合起来', '搭起来', '接在一块'],
};

const STRUCTURE_REWRITES = [
  ({ first, second, third }) => `${first}和${second}颜色接近，${third}让这套多一点层次。`,
  ({ first, second, third }) => `${third}带出一点对比，${first}和${second}负责把颜色接上。`,
  ({ first, third }) => `${first}先把上半身提亮，${third}让整套不只停在浅色。`,
  ({ first, second, third }) => `${second}收在脚下，和${first}接得上，${third}让画面更完整。`,
  ({ first, second, third }) => `${first}、${third}和${second}都是常用单品，今天穿起来不绕。`,
  ({ first, second, third }) => `${first}配${third}偏轻松，${second}让临时出门更方便。`,
];

function applyBatchCopyDiversity(copies = []) {
  const counts = {};
  const usedAngles = new Set();
  const angleCounts = {};
  const structureCounts = {};
  return copies.map((copy, index) => {
    const next = { ...copy };
    next.angle = chooseAngle(copy.angle, usedAngles, angleCounts, index);
    usedAngles.add(next.angle);
    angleCounts[next.angle] = (angleCounts[next.angle] || 0) + 1;
    for (const phrase of Object.keys(PHRASE_LIMITS)) {
      next.todayReason = limitPhrase(next.todayReason, phrase, counts);
      next.detailExplanation = limitPhrase(next.detailExplanation, phrase, counts);
      next.aiExtraDefault = next.detailExplanation;
    }
    next.todayReason = diversifyStructure(next.todayReason, structureCounts, index);
    next.usedPhrases = Object.keys(PHRASE_LIMITS).filter((phrase) => `${next.todayReason}${next.detailExplanation}`.includes(phrase));
    return next;
  });
}

function limitPhrase(text, phrase, counts) {
  let result = String(text || '');
  while (result.includes(phrase)) {
    const used = counts[phrase] || 0;
    const limit = PHRASE_LIMITS[phrase] || 0;
    if (used < limit) {
      counts[phrase] = used + 1;
      const marker = `__KEEP_PHRASE_${Object.keys(PHRASE_LIMITS).indexOf(phrase)}_${used}__`;
      result = result.replace(phrase, marker);
      continue;
    }
    result = result.replace(phrase, nextReplacement(phrase, used));
  }
  return result.replace(/__KEEP_PHRASE_(\d+)_(\d+)__/g, (_, phraseIndex) => Object.keys(PHRASE_LIMITS)[Number(phraseIndex)] || '');
}

function nextReplacement(phrase, index) {
  const replacements = REPLACEMENTS[phrase] || [''];
  return replacements[Math.abs(index) % replacements.length] || '';
}

function chooseAngle(angle, usedAngles, angleCounts, index) {
  const normalized = normalizeAngle(angle);
  if (normalized && canUseAngle(normalized, angleCounts) && !usedAngles.has(normalized)) return normalized;
  const required = ['场景适配', '天气厚薄', '单品组合'].find((entry) => !usedAngles.has(entry));
  if (required) return required;
  return ANGLES.find((entry) => canUseAngle(entry, angleCounts) && !usedAngles.has(entry))
    || ANGLES.find((entry) => canUseAngle(entry, angleCounts))
    || ANGLES[index % ANGLES.length];
}

function normalizeAngle(angle) {
  if (COLOR_ANGLES.has(angle)) return '颜色关系';
  if (angle === '天气适配') return '天气厚薄';
  if (angle === '单品关系') return '单品组合';
  return angle || '';
}

function canUseAngle(angle, angleCounts) {
  if (angle === '颜色关系') return (angleCounts[angle] || 0) < 3;
  if (angle === '鞋子收尾') return (angleCounts[angle] || 0) < 2;
  return true;
}

function diversifyStructure(text, structureCounts, index) {
  const current = String(text || '');
  const signature = sentenceSignature(current);
  const used = structureCounts[signature] || 0;
  if (used < 2) {
    structureCounts[signature] = used + 1;
    return current;
  }
  const parts = readColorEchoParts(current);
  if (!parts) {
    structureCounts[signature] = used + 1;
    return current;
  }
  const variantIndex = signature === 'color-close-layer'
    ? ((index + used) % (STRUCTURE_REWRITES.length - 1)) + 1
    : (index + used + 1) % STRUCTURE_REWRITES.length;
  const rewritten = STRUCTURE_REWRITES[variantIndex](parts);
  const nextSignature = sentenceSignature(rewritten);
  structureCounts[nextSignature] = (structureCounts[nextSignature] || 0) + 1;
  return rewritten;
}

function sentenceSignature(text) {
  if (/颜色接近，.+让这套多一点层次/.test(String(text || ''))) return 'color-close-layer';
  return String(text || '')
    .replace(/[^，。！？]+?(T恤|运动鞋|阔腿裤|短裤|短袖|卫衣|牛仔裤|下装|上衣|鞋子)/g, 'ITEM')
    .replace(/[。！？].*$/g, '')
    .replace(/\s+/g, '');
}

function readColorEchoParts(text) {
  const match = String(text || '').match(/^(.+?)和(.+?)(?:有呼应|颜色接近|颜色能接上|颜色有联系)，(.+?)(?:让|把|带|加|多|不)/);
  if (!match) return null;
  return {
    first: match[1],
    second: match[2],
    third: match[3],
  };
}

module.exports = {
  PHRASE_LIMITS,
  applyBatchCopyDiversity,
};
