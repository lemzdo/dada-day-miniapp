function buildSupportedOutfitInsights(facts = {}) {
  const items = Array.isArray(facts.items) ? facts.items : [];
  const insights = [];
  const top = findSlot(items, 'top') || items[0];
  const bottom = findSlot(items, 'bottom');
  const outerwear = findSlot(items, 'outerwear');
  const shoes = findSlot(items, 'shoes');
  const contrastItem = bottom || outerwear;
  const patterned = items.filter((item) => item.patternType && !['solid', 'plain', 'none'].includes(String(item.patternType).toLowerCase()));

  if (patterned.length >= 2) {
    insights.push(insight({
      code: 'pattern_competition',
      text: `${patterned.map(displayItem).join('和')}都有图案`,
      requiredFacts: patterned.map((item) => `pattern:${item.patternType}`),
      subjectItemIds: patterned.map((item) => item.id),
      strength: 2,
    }));
  }

  if (top && shoes && hasColorRelation(top, shoes)) {
    insights.push(insight({
      code: 'color_echo',
      text: `${displayItem(top)}和${displayItem(shoes)}颜色有呼应`,
      requiredFacts: [`color:${top.rawColor}`, `color:${shoes.rawColor}`],
      subjectItemIds: [top.id, shoes.id],
      strength: 3,
    }));
  }

  if (contrastItem && top && contrastItem.rawColor && top.rawColor && !hasColorRelation(contrastItem, top)) {
    insights.push(insight({
      code: 'color_contrast',
      text: `${displayItem(contrastItem)}提供颜色对比`,
      requiredFacts: [`color:${contrastItem.rawColor}`, `color:${top.rawColor}`],
      subjectItemIds: [contrastItem.id, top.id],
      strength: 2,
    }));
  }

  if (facts.scene?.normalized === '居家' || facts.scene?.raw === '居家') {
    insights.push(insight({
      code: 'scene_fit_home',
      text: '组合适合居家场景',
      requiredFacts: ['scene:居家'],
      subjectItemIds: items.map((item) => item.id),
      strength: 2,
    }));
  }

  if ((facts.scene?.normalized === '居家' || facts.scene?.raw === '居家') && shoes) {
    insights.push(insight({
      code: 'light_outing',
      text: `${displayItem(shoes)}让临时出门也顺`,
      requiredFacts: ['scene:居家', `item:${shoes.id}:${shoes.name}`],
      subjectItemIds: [shoes.id],
      strength: 1,
    }));
  }

  const temp = Number(facts.weather?.temp);
  if (Number.isFinite(temp) && temp >= 18 && temp <= 26) {
    insights.push(insight({
      code: 'weather_fit',
      text: '当前天气厚薄压力不大',
      requiredFacts: [`weather:${facts.weather.text}`],
      subjectItemIds: items.map((item) => item.id),
      strength: 1,
    }));
  }

  if (items.some(isDailyCasualItem)) {
    insights.push(insight({
      code: 'daily_casual',
      text: 'T恤、裤子或运动鞋偏日常',
      requiredFacts: items.filter(isDailyCasualItem).map((item) => `item:${item.id}:${item.name}`),
      subjectItemIds: items.filter(isDailyCasualItem).map((item) => item.id),
      strength: 1,
    }));
  }

  return dedupe(insights);
}

function insight({ code, text, requiredFacts, subjectItemIds, strength }) {
  return {
    code,
    text,
    requiredFacts: uniqueStrings(requiredFacts),
    subjectItemIds: uniqueStrings(subjectItemIds),
    strength: Math.max(1, Math.min(3, Math.round(Number(strength) || 1))),
    pageSuitability: ['today', 'detail'],
  };
}

function hasColorRelation(left, right) {
  const leftTerms = new Set([left.rawColor, ...(left.colorAliases || [])].filter(Boolean));
  return [right.rawColor, ...(right.colorAliases || [])].some((term) => leftTerms.has(term));
}

function isDailyCasualItem(item) {
  return /T恤|tee|裤|运动鞋|卫衣|短袖/i.test(item.name || '') || item.slot === 'shoes';
}

function displayItem(item) {
  return `${item.rawColor || ''}${item.name}`;
}

function findSlot(items, slot) {
  return items.find((item) => item.slot === slot);
}

function dedupe(insights) {
  const seen = new Set();
  return insights.filter((entry) => {
    if (!entry.code || seen.has(entry.code)) return false;
    seen.add(entry.code);
    return true;
  });
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
  buildSupportedOutfitInsights,
};
