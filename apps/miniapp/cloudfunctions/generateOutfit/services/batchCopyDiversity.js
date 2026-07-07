const PHRASE_LIMITS = {
  '不用多想': 1,
  '不费心': 1,
  '临时出门': 2,
  '自然': 2,
  '日常': 3,
  '放在一起': 0,
};

const ANGLES = ['颜色呼应', '颜色对比', '场景适配', '天气适配', '风格统一', '单品关系', '方便程度'];

const REPLACEMENTS = {
  '不用多想': ['很直接', '不绕', '一眼能看懂'],
  '不费心': ['省事', '不折腾', '顺手'],
  '临时出门': ['短暂外出', '下楼走走', '附近走走'],
  '自然': ['顺眼', '不刻意', '轻松'],
  '日常': ['平时穿', '生活里', '常用'],
  '放在一起': ['组合起来', '搭起来', '接在一块'],
};

function applyBatchCopyDiversity(copies = []) {
  const counts = {};
  const usedAngles = new Set();
  return copies.map((copy, index) => {
    const next = { ...copy };
    next.angle = chooseAngle(copy.angle, usedAngles, index);
    usedAngles.add(next.angle);
    for (const phrase of Object.keys(PHRASE_LIMITS)) {
      next.todayReason = limitPhrase(next.todayReason, phrase, counts);
      next.detailExplanation = limitPhrase(next.detailExplanation, phrase, counts);
      next.aiExtraDefault = next.detailExplanation;
    }
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

function chooseAngle(angle, usedAngles, index) {
  if (angle && !usedAngles.has(angle)) return angle;
  return ANGLES.find((entry) => !usedAngles.has(entry)) || ANGLES[index % ANGLES.length];
}

module.exports = {
  PHRASE_LIMITS,
  applyBatchCopyDiversity,
};
