const BANNED_DEFAULT_PHRASES = ['主线', '清楚的亮点', '亮点已经落在', '更稳', '保持简单', '单品和单品', '想再明确一点', '放在一起', '不用多想', '不费心'];

function composePageCopy({ facts = {}, insights = [], batchIndex = 0, angle } = {}) {
  const items = Array.isArray(facts.items) ? facts.items : [];
  const top = findSlot(items, 'top') || items[0];
  const bottom = findSlot(items, 'bottom') || findSlot(items, 'outerwear') || items[1];
  const shoes = findSlot(items, 'shoes');
  const codes = new Set(insights.map((entry) => entry.code));
  const usedInsightCodes = [];
  let todayReason = '';
  let detailExplanation = '';
  let selectedAngle = angle || '';

  if (codes.has('pattern_competition')) {
    usedInsightCodes.push('pattern_competition');
    selectedAngle = selectedAngle || '单品关系';
    todayReason = `${joinItemNames([top, bottom])}都有图案，整套会更热闹，其他部分简单一点更顺。`;
    detailExplanation = `${joinItemNames([top, bottom])}同时带图案，重点会比较多。${sceneSentence(facts)}`;
  } else if (codes.has('color_echo') && codes.has('color_contrast') && top && bottom && shoes) {
    usedInsightCodes.push('color_echo', 'color_contrast');
    selectedAngle = selectedAngle || '颜色呼应';
    todayReason = `${itemLabel(top)}和${itemLabel(shoes)}有呼应，${itemLabel(bottom)}让整套不至于太淡。`;
    detailExplanation = `${itemLabel(top)}和${itemLabel(shoes)}前后呼应，${itemLabel(bottom)}把颜色压下来一点。${sceneLead(facts)}这套不显得刻意，临时出门也顺。`;
  } else if (codes.has('color_echo') && top && shoes) {
    usedInsightCodes.push('color_echo');
    selectedAngle = selectedAngle || '颜色呼应';
    todayReason = `${itemLabel(top)}和${itemLabel(shoes)}有呼应，整套看起来更连贯。`;
    detailExplanation = `${itemLabel(top)}和${itemLabel(shoes)}前后接上了颜色，其他单品只要不抢戏，这套就容易成立。${sceneSentence(facts)}`;
  } else if (codes.has('color_contrast') && top && bottom) {
    usedInsightCodes.push('color_contrast');
    selectedAngle = selectedAngle || '颜色对比';
    todayReason = `${itemLabel(bottom)}把${itemLabel(top)}的颜色压住一点，整套不会太飘。`;
    detailExplanation = `${itemLabel(top)}负责上半身的颜色，${itemLabel(bottom)}把色调往下收。${sceneSentence(facts)}`;
  } else if (codes.has('scene_fit_home')) {
    usedInsightCodes.push('scene_fit_home');
    selectedAngle = selectedAngle || '场景适配';
    todayReason = `${joinItemNames([top, bottom])}组合简单，居家场景里不会过分正式。`;
    detailExplanation = `${joinItemNames([top, bottom])}是能确认的主要单品，组合关系直接。${sceneLead(facts)}整体偏轻松，附近走走也不突兀。`;
  } else if (codes.has('weather_fit')) {
    usedInsightCodes.push('weather_fit');
    selectedAngle = selectedAngle || '天气适配';
    todayReason = `${weatherText(facts)}穿这套厚薄压力不大，出门前不用再大改。`;
    detailExplanation = `${weatherText(facts)}对厚薄要求不极端，${joinItemNames([top, bottom, shoes])}可以先按当前场景穿。`;
  } else {
    selectedAngle = selectedAngle || fallbackAngle(batchIndex);
    todayReason = `${joinItemNames([top, bottom, shoes])}关系直接，今天穿起来不绕。`;
    detailExplanation = `${joinItemNames([top, bottom, shoes])}是这套能确认的主要关系。${sceneSentence(facts)}`;
  }

  todayReason = cleanSentence(removeBanned(todayReason));
  detailExplanation = cleanSentence(removeBanned(detailExplanation, { allowTemporaryOuting: true }));
  return {
    todayReason,
    detailExplanation,
    aiExtraDefault: detailExplanation,
    usedInsightCodes: uniqueStrings(usedInsightCodes),
    usedPhrases: collectUsedPhrases(`${todayReason}${detailExplanation}`),
    angle: selectedAngle,
  };
}

function itemLabel(item) {
  if (!item) return '单品';
  const color = shortColor(item.rawColor);
  if (color && (item.name || '').includes(color)) return item.name;
  const separator = color && /^[A-Za-z0-9]/.test(item.name || '') ? ' ' : '';
  return `${color}${separator}${item.name}`;
}

function shortColor(color) {
  return color === '米白色' ? '米白' : color || '';
}

function sceneLead(facts) {
  const scene = displayScene(facts);
  return scene ? `放在${scene}场景里，` : '';
}

function sceneSentence(facts) {
  const scene = displayScene(facts);
  return scene ? `${scene}场景里，这套不会显得突兀。` : '日常场景里，这套不会显得突兀。';
}

function displayScene(facts) {
  const normalized = facts.scene?.normalized;
  const raw = facts.scene?.raw;
  if (normalized && !/^[a-z_:-]+$/i.test(normalized)) return normalized;
  return /^[a-z_:-]+$/i.test(raw || '') ? '' : raw;
}

function weatherText(facts) {
  return facts.weather?.text || '当前天气';
}

function joinItemNames(items) {
  return uniqueStrings((items || []).filter(Boolean).map(itemLabel)).slice(0, 3).join('和') || '这几件单品';
}

function removeBanned(text, options = {}) {
  let result = String(text || '');
  for (const phrase of BANNED_DEFAULT_PHRASES) {
    result = result.split(phrase).join(replacementFor(phrase, options));
  }
  return result;
}

function replacementFor(phrase) {
  return {
    '放在一起': '组合起来',
    '不用多想': '很直接',
    '不费心': '省事',
    '更稳': '更顺',
    '保持简单': '少加复杂元素',
    '单品和单品': '衣物之间',
    '想再明确一点': '想再清楚一点',
    '主线': '重点',
    '清楚的亮点': '明确的小重点',
    '亮点已经落在': '重点已经在',
  }[phrase] || '';
}

function cleanSentence(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return /[。！？]$/.test(text) ? text : `${text}。`;
}

function collectUsedPhrases(text) {
  return ['不用多想', '不费心', '临时出门', '自然', '日常', '放在一起']
    .filter((phrase) => text.includes(phrase));
}

function fallbackAngle(index) {
  return ['颜色呼应', '颜色对比', '场景适配', '天气适配', '风格统一', '单品关系', '方便程度'][Math.abs(index) % 7];
}

function findSlot(items, slot) {
  return (items || []).find((item) => item.slot === slot);
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
  BANNED_DEFAULT_PHRASES,
  composePageCopy,
};
