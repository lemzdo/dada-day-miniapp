const { sanitizeCopyObject } = require('./copyQualityGate');

const BANNED_DEFAULT_PHRASES = ['主线', '清楚的亮点', '亮点已经落在', '更稳', '保持简单', '单品和单品', '想再明确一点', '放在一起', '不用多想', '不费心', '有呼应', '压住一点', '压下来一点', '不至于太淡', '不会太飘', '能确认的主要', '颜色接近', '深浅变化', '上下分区', '不全是浅色', '适合今天', '当前场景穿'];

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
  let detailAngle = '';
  let detailNoExtraInfo = false;

  if (codes.has('pattern_competition')) {
    usedInsightCodes.push('pattern_competition');
    selectedAngle = selectedAngle || '单品关系';
    todayReason = `${joinItemNames([top, bottom])}都有图案，其他部分收简单一点，画面不容易乱。`;
    detailAngle = '场景适配';
    detailExplanation = `${joinItemNames([top, bottom])}同时带图案，视线会先落在上衣和下装。${sceneSentence(facts)}`;
  } else if (codes.has('color_echo') && codes.has('color_contrast') && top && bottom && shoes) {
    usedInsightCodes.push('color_echo', 'color_contrast');
    selectedAngle = selectedAngle || '颜色关系';
    todayReason = `${itemLabel(top)}和${itemLabel(shoes)}能接上，${itemLabel(bottom)}让这套多一点落点。`;
    const second = chooseSecondDetail({ facts, codes, top, bottom, shoes, todayAngle: selectedAngle });
    detailAngle = second.angle;
    detailNoExtraInfo = second.noExtraInfo;
    detailExplanation = second.text;
  } else if (codes.has('color_echo') && top && shoes) {
    usedInsightCodes.push('color_echo');
    selectedAngle = selectedAngle || '颜色关系';
    todayReason = `${itemLabel(top)}和${itemLabel(shoes)}能接上，整套看起来更连贯。`;
    const second = chooseSecondDetail({ facts, codes, top, bottom, shoes, todayAngle: selectedAngle });
    detailAngle = second.angle;
    detailNoExtraInfo = second.noExtraInfo;
    detailExplanation = second.text;
  } else if (codes.has('color_contrast') && top && bottom) {
    usedInsightCodes.push('color_contrast');
    selectedAngle = selectedAngle || '颜色关系';
    todayReason = `${itemLabel(top)}先把上半身提亮，${itemLabel(bottom)}把整套收住一点。`;
    const second = chooseSecondDetail({ facts, codes, top, bottom, shoes, todayAngle: selectedAngle });
    detailAngle = second.angle;
    detailNoExtraInfo = second.noExtraInfo;
    detailExplanation = second.text;
  } else if (codes.has('scene_fit_home')) {
    usedInsightCodes.push('scene_fit_home');
    selectedAngle = selectedAngle || '场景适配';
    todayReason = `${joinItemNames([top, bottom])}组合简单，居家场景里不会过分正式。`;
    detailAngle = shoes ? '单品作用' : '方便程度';
    detailExplanation = shoes
      ? `${plainItemLabel(shoes)}让这套可以从家里直接走到楼下，不需要重新换一身。`
      : `${joinItemNames([top, bottom])}都偏轻便，在家活动不会累赘，坐着或走动都轻松。`;
  } else if (codes.has('weather_fit')) {
    usedInsightCodes.push('weather_fit');
    selectedAngle = selectedAngle || '天气厚薄';
    todayReason = `${weatherText(facts)}穿这套厚薄压力不大，出门前不用再大改。`;
    detailAngle = '单品组合';
    detailExplanation = `${joinItemNames([top, bottom, shoes])}都不是很难搭的单品，按这个温度穿比较省事。`;
  } else {
    selectedAngle = selectedAngle || fallbackAngle(batchIndex);
    todayReason = `${joinItemNames([top, bottom, shoes])}关系直接，今天穿起来不绕。`;
    detailAngle = selectedAngle === '场景适配' ? '单品组合' : '场景适配';
    detailNoExtraInfo = true;
    detailExplanation = `${joinItemNames([top, bottom, shoes])}组合起来比较轻松，先按这套穿也不容易出错。`;
  }

  todayReason = cleanSentence(removeBanned(todayReason));
  detailExplanation = cleanSentence(removeBanned(detailExplanation, { allowTemporaryOuting: true }));
  if (!detailAngle || detailAngle === selectedAngle) {
    const second = chooseSecondDetail({ facts, codes, top, bottom, shoes, todayAngle: selectedAngle });
    detailAngle = second.angle;
    detailNoExtraInfo = second.noExtraInfo;
    detailExplanation = cleanSentence(removeBanned(second.text, { allowTemporaryOuting: true }));
  }
  return sanitizeCopyObject({
    todayReason,
    detailExplanation,
    aiExtraDefault: detailExplanation,
    usedInsightCodes: uniqueStrings(usedInsightCodes),
    usedPhrases: collectUsedPhrases(`${todayReason}${detailExplanation}`),
    angle: selectedAngle,
    detailAngle,
    detailNoExtraInfo,
  }, { items });
}

function chooseSecondDetail({ facts, codes, top, bottom, shoes, todayAngle }) {
  const choices = [];
  if (codes.has('scene_fit_home') || displayScene(facts) === '居家') {
    choices.push({
      angle: '场景适配',
      text: shoes
        ? `居家穿不需要太正式，${plainItemLabel(shoes)}让这套可以从家里直接走到楼下，附近走走也不用重新换。`
        : `居家穿不需要太正式，${joinItemNames([top, bottom])}在家活动也不累赘，坐着或走动都轻松。`,
    });
  }
  if (codes.has('light_outing') && shoes) {
    choices.push({
      angle: '单品作用',
      text: `${plainItemLabel(shoes)}让这套可以从家里直接走到楼下，不需要重新换一身。`,
    });
  }
  if (codes.has('weather_fit')) {
    choices.push({
      angle: '天气厚薄',
      text: `${weatherText(facts)}对厚薄要求不极端，${joinItemNames([top, bottom])}这样穿不会太闷。`,
    });
  }
  if (codes.has('daily_casual')) {
    choices.push({
      angle: '单品组合',
      text: `${joinItemNames([top, bottom, shoes])}都是生活里常会穿到的单品，组合起来不挑安排。`,
    });
  }
  const selected = choices.find((choice) => choice.angle !== todayAngle) || choices[0];
  if (selected) return { ...selected, noExtraInfo: false };
  return {
    angle: todayAngle === '场景适配' ? '单品组合' : '场景适配',
    text: `${joinItemNames([top, bottom, shoes])}组合起来比较轻松，先按这套穿也不容易出错。`,
    noExtraInfo: true,
  };
}

function itemLabel(item) {
  if (!item) return '单品';
  const color = shortColor(item.rawColor);
  if (color && (item.name || '').includes(color)) return item.name;
  const separator = color && /^[A-Za-z0-9]/.test(item.name || '') ? ' ' : '';
  return `${color}${separator}${item.name}`;
}

function plainItemLabel(item) {
  return item?.name || '单品';
}

function shortColor(color) {
  return color === '米白色' ? '米白' : color || '';
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
    '有呼应': '颜色接近',
    '压住一点': '收住一些',
    '压下来一点': '收住一些',
    '不至于太淡': '多一点落点',
    '不会太飘': '有颜色落点',
    '颜色接近': '能接上',
    '深浅变化': '明暗关系',
    '上下分区': '上下关系',
    '不全是浅色': '多一点落点',
    '适合今天': '今天穿起来省事',
    '当前场景穿': '这样穿',
    '能确认的主要': '',
  }[phrase] || '';
}

function cleanSentence(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return /[。！？]$/.test(text) ? text : `${text}。`;
}

function collectUsedPhrases(text) {
  return ['不用多想', '不费心', '临时出门', '自然', '日常', '放在一起', '有呼应', '不至于太淡', '不会太飘', '颜色接近', '深浅变化', '上下分区', '不全是浅色', '适合今天']
    .filter((phrase) => text.includes(phrase));
}

function fallbackAngle(index) {
  return ['颜色关系', '单品组合', '场景适配', '天气厚薄', '风格统一', '鞋子收尾', '方便程度'][Math.abs(index) % 7];
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
