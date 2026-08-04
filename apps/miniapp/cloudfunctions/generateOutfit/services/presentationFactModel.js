const PRESENTATION_FACT_MODEL_VERSION = 'presentation-fact-model-v2';
const PRESENTATION_PLAN_VERSION = 'presentation-plan-v2';

const ROLE_ORDER = Object.freeze(['onepiece', 'top', 'bottom', 'outerwear', 'shoes']);
const SCENE_LABELS = Object.freeze({
  home: '居家',
  work: '通勤',
  date: '约会',
  sport: '轻运动',
});
const COLOR_LABELS = Object.freeze([
  [/黑|black/i, '黑色'],
  [/白|white|ivory|cream/i, '白色'],
  [/灰|gray|grey/i, '灰色'],
  [/藏青|navy/i, '藏青色'],
  [/蓝|blue/i, '蓝色'],
  [/棕|brown|camel/i, '棕色'],
  [/米|beige|khaki/i, '米色'],
  [/红|red|burgundy/i, '红色'],
  [/绿|green/i, '绿色'],
  [/黄|yellow/i, '黄色'],
  [/紫|purple/i, '紫色'],
  [/粉|pink/i, '粉色'],
  [/橙|orange/i, '橙色'],
]);
const COLOR_SHORT_LABELS = Object.freeze({
  黑色: '黑',
  白色: '白',
  灰色: '灰',
  藏青色: '藏青',
  蓝色: '蓝',
  棕色: '棕',
  米色: '米',
  红色: '红',
  绿色: '绿',
  黄色: '黄',
  紫色: '紫',
  粉色: '粉',
  橙色: '橙',
});
const NEUTRAL_COLORS = new Set(['黑色', '白色', '灰色', '藏青色', '米色', '棕色']);
const RELATION_PRIORITY = Object.freeze([
  'SUBTYPE_FEATURE_PRINT',
  'SAME_COLOR_ALL_ROLES',
  'SAME_COLOR_TOP_BOTTOM',
  'COLOR_ECHO_TOP_SHOES',
  'TOP_ACCENT_WITH_NEUTRAL_BOTTOM',
  'DISTINCT_TOP_BOTTOM_COLOR',
  'SINGLE_COLOR_FALLBACK',
]);

function buildPresentationFactModel(selectedCandidate = {}) {
  const source = asObject(selectedCandidate);
  const scene = normalizeScene(source.scene || source.matchedScene);
  const sourceItems = readItems(source);
  const roleEntries = readRoleEntries(source);
  const items = roleEntries.length > 0
    ? roleEntries.map((entry) => buildItemFact(entry, findItem(sourceItems, entry), source))
    : sourceItems.map((item) => buildItemFact({
        id: readItemId(item),
        slot: item?.outfitSlot || item?.category,
        role: item?.outfitRole || 'core',
        displayName: item?.displayName,
      }, item, source));
  const normalizedItems = items
    .filter(Boolean)
    .sort((left, right) => roleIndex(left.role) - roleIndex(right.role) || left.canonicalSubtype.localeCompare(right.canonicalSubtype));
  const relations = buildRelations(normalizedItems);
  const semanticSignature = normalizedItems.length > 0
    ? stableSerialize({
        scene,
        items: normalizedItems.map(toSignatureItem),
        relations: relations.map((relation) => relation.relationCode),
      })
    : '';
  return {
    version: PRESENTATION_FACT_MODEL_VERSION,
    scene,
    items: normalizedItems.map(stripInternalItemFields),
    relations,
    semanticSignature,
    presentationFactSignature: semanticSignature,
    availableDifferentiators: relations.map(toDifferentiator),
    primaryRelationCode: relations[0]?.relationCode || null,
    unsupportedClaims: [],
  };
}

function buildPresentationPlan(model = {}) {
  const source = asObject(model);
  const primaryRelation = source.relations?.[0] || {
    relationCode: null,
    roles: [],
    authorizedValues: [],
  };
  const titleConcept = buildTitleConcept(source);
  const reasonClaim = buildReasonClaim(source, primaryRelation);
  return {
    version: PRESENTATION_PLAN_VERSION,
    factModel: source,
    presentationFactSignature: source.presentationFactSignature || '',
    primaryRelation,
    supportingFacts: source.items || [],
    titleConcept,
    reasonClaim,
    sceneConclusion: buildSceneConclusion(source.scene),
    unsupportedClaims: [],
  };
}

function assignPresentationDifferentiators(models = []) {
  const list = Array.isArray(models) ? models : [];
  return list.map((model) => {
    const available = Array.isArray(model?.availableDifferentiators) ? model.availableDifferentiators : [];
    return available[0] || null;
  });
}

function applyPresentationPlan(outfit, model, plan) {
  if (!outfit || typeof outfit !== 'object' || Array.isArray(outfit)) return outfit;
  const next = outfit;
  const reason = plan?.reasonClaim?.text || '';
  next.presentationPlan = plan && typeof plan === 'object' ? plan : buildPresentationPlan(model);
  next.title = plan?.titleConcept || next.title || '';
  next.displayTitle = next.title;
  next.reason = reason;
  next.reasoning = reason;
  if (next.copyContract && typeof next.copyContract === 'object' && !Array.isArray(next.copyContract)) {
    next.copyContract = {
      ...next.copyContract,
      todayReason: reason,
      detailExplanation: reason,
      todayReasonSource: 'presentation_plan',
      presentationFactSignature: model?.presentationFactSignature || '',
      primaryRelationCode: plan?.primaryRelation?.relationCode || null,
      unsupportedClaimCount: Array.isArray(plan?.unsupportedClaims) ? plan.unsupportedClaims.length : 0,
    };
  }
  if (next.contentPlan && typeof next.contentPlan === 'object' && !Array.isArray(next.contentPlan)) {
    next.contentPlan = {
      ...next.contentPlan,
      presentationFactSignature: model?.presentationFactSignature || '',
      primaryRelationCode: plan?.primaryRelation?.relationCode || null,
      defaultTodayReason: reason,
      defaultDetailExplanation: reason,
      defaultCopy: next.contentPlan.defaultCopy && typeof next.contentPlan.defaultCopy === 'object'
        ? { ...next.contentPlan.defaultCopy, todayReason: reason }
        : next.contentPlan.defaultCopy,
    };
  }
  return next;
}

function buildTitleConcept(model) {
  const items = Array.isArray(model?.items) ? model.items : [];
  const scene = normalizeScene(model?.scene);
  if (scene === 'sport') {
    const top = items.find((item) => item.role === 'top');
    const bottom = items.find((item) => item.role === 'bottom');
    const shoes = items.find((item) => item.role === 'shoes');
    const roleColors = [top?.normalizedColor, bottom?.normalizedColor, shoes?.normalizedColor].filter(Boolean);
    const uniqueColors = uniqueStrings(roleColors);
    const colorConcept = uniqueColors.length === 1
      ? `全${shortColor(uniqueColors[0])}`
      : top?.normalizedColor && bottom?.normalizedColor && top.normalizedColor === bottom.normalizedColor
        ? `${shortColor(top.normalizedColor)}${shoes?.normalizedColor && shoes.normalizedColor !== top.normalizedColor ? shortColor(shoes.normalizedColor) : ''}`
        : [top?.normalizedColor, bottom?.normalizedColor].filter(Boolean).map(shortColor).join('');
    const print = items.some((item) => item.visibleFeatureTags.includes('印花')) ? '印花' : '';
    return `${print}${colorConcept || '日常'}${SCENE_LABELS.sport}`;
  }
  const sceneLabel = SCENE_LABELS[scene] || '日常';
  const relationLabel = scene === 'sport' ? relationTitleLabel(model?.primaryRelationCode) : '';
  if (relationLabel) return `${sceneLabel}${relationLabel}`;
  const onepiece = items.find((item) => item.role === 'onepiece');
  if (onepiece?.canonicalSubtype) return `${sceneLabel}${onepiece.canonicalSubtype}组合`;
  const firstWearable = items.find((item) => item.role === 'top' || item.role === 'outerwear' || item.role === 'bottom');
  if (firstWearable?.canonicalSubtype) return `${sceneLabel}${firstWearable.canonicalSubtype}搭配`;
  return `${sceneLabel}搭配`;
}

function buildReasonClaim(model, relation) {
  const items = Array.isArray(model?.items) ? model.items : [];
  const byRole = new Map(items.map((item) => [item.role, item]));
  const top = byRole.get('top');
  const bottom = byRole.get('bottom');
  const shoes = byRole.get('shoes');
  const topName = top?.canonicalSubtype || top?.canonicalName || '上衣';
  const bottomName = bottom?.canonicalSubtype || bottom?.canonicalName || '下装';
  const shoesName = shoes?.canonicalSubtype || shoes?.canonicalName || '鞋子';
  const topColor = top?.normalizedColor || '';
  const bottomColor = bottom?.normalizedColor || '';
  const shoesColor = shoes?.normalizedColor || '';
  const sceneConclusion = buildSceneConclusion(model?.scene);
  let text;
  switch (relation.relationCode) {
    case 'SAME_COLOR_ALL_ROLES':
      text = `${topColor || '同色'}${topName}、${bottomName}和${shoesName}保持同色，整体统一，${sceneConclusion}。`;
      break;
    case 'COLOR_ECHO_TOP_SHOES':
      text = `${topColor || ''}${topName}与${shoesColor || ''}${shoesName}上下呼应，${bottomColor || ''}${bottomName}放在中间，${sceneConclusion}。`;
      break;
    case 'SUBTYPE_FEATURE_PRINT':
      text = `印花${stripFeature(topName)}作为上身重点，${bottomColor || ''}${bottomName}和${shoesColor || ''}${shoesName}让其余部分保持简洁，${sceneConclusion}。`;
      break;
    case 'TOP_ACCENT_WITH_NEUTRAL_BOTTOM':
      text = `${topColor || ''}${topName}和${bottomColor || ''}${bottomName}拉开颜色层次，${shoesColor || ''}${shoesName}收尾，${sceneConclusion}。`;
      break;
    case 'SAME_COLOR_TOP_BOTTOM':
      text = `${topColor || ''}${topName}与${bottomColor || ''}${bottomName}顺色衔接，${shoesColor || ''}${shoesName}形成对比，${sceneConclusion}。`;
      break;
    case 'DISTINCT_TOP_BOTTOM_COLOR':
      text = `${topColor || ''}${topName}搭配${bottomColor || ''}${bottomName}和${shoesColor || ''}${shoesName}，颜色关系清楚，${sceneConclusion}。`;
      break;
    default:
      text = `${topColor || ''}${topName}、${bottomColor || ''}${bottomName}和${shoesColor || ''}${shoesName}组合清楚，${sceneConclusion}。`;
      break;
  }
  return {
    relationCode: relation.relationCode,
    text: compactText(text),
    supportedBy: relation.authorizedValues.slice(),
  };
}

function buildRelations(items) {
  const relations = [];
  const byRole = new Map(items.map((item) => [item.role, item]));
  const top = byRole.get('top');
  const bottom = byRole.get('bottom');
  const shoes = byRole.get('shoes');
  const colored = [top, bottom, shoes].filter((item) => item?.normalizedColor);
  const push = (relationCode, roles, values) => {
    if (!roles.length || values.some((value) => !value)) return;
    relations.push({ relationCode, roles, authorizedValues: uniqueStrings(values) });
  };
  if (items.some((item) => item.visibleFeatureTags.includes('印花'))) {
    const patterned = items.find((item) => item.visibleFeatureTags.includes('印花'));
    push('SUBTYPE_FEATURE_PRINT', [patterned.role], [patterned.canonicalSubtype]);
  }
  if (items.length > 0 && colored.length === items.length
    && uniqueStrings(colored.map((item) => item.normalizedColor)).length === 1) {
    push('SAME_COLOR_ALL_ROLES', colored.map((item) => item.role), colored.map((item) => item.normalizedColor));
  }
  if (top?.normalizedColor && bottom?.normalizedColor && top.normalizedColor === bottom.normalizedColor) {
    push('SAME_COLOR_TOP_BOTTOM', ['top', 'bottom'], [top.normalizedColor, bottom.normalizedColor]);
  }
  if (top?.normalizedColor && shoes?.normalizedColor && top.normalizedColor === shoes.normalizedColor) {
    push('COLOR_ECHO_TOP_SHOES', ['top', 'shoes'], [top.normalizedColor, shoes.normalizedColor]);
  }
  if (top?.normalizedColor && bottom?.normalizedColor
    && top.normalizedColor !== bottom.normalizedColor
    && !NEUTRAL_COLORS.has(top.normalizedColor)
    && NEUTRAL_COLORS.has(bottom.normalizedColor)) {
    push('TOP_ACCENT_WITH_NEUTRAL_BOTTOM', ['top', 'bottom'], [top.normalizedColor, bottom.normalizedColor]);
  }
  if (top?.normalizedColor && bottom?.normalizedColor && top.normalizedColor !== bottom.normalizedColor) {
    push('DISTINCT_TOP_BOTTOM_COLOR', ['top', 'bottom'], [top.normalizedColor, bottom.normalizedColor]);
  }
  if (colored.length === 1) {
    const item = colored[0];
    push('SINGLE_COLOR_FALLBACK', [item.role], [item.normalizedColor]);
  }
  const order = new Map(RELATION_PRIORITY.map((value, index) => [value, index]));
  return relations.sort((left, right) => (order.get(left.relationCode) ?? 99) - (order.get(right.relationCode) ?? 99));
}

function buildItemFact(roleEntry, item, candidate) {
  const source = asObject(item || roleEntry);
  const role = normalizeRole(roleEntry?.slot || roleEntry?.category || source.outfitSlot || source.category || roleEntry?.role);
  if (!role) return null;
  const records = collectFactRecords(source, candidate, roleEntry);
  const authorizedRecords = records.filter(isAuthorizedRecord);
  const rawSubtype = [
    source.subcategory,
    source.subCategory,
    source.shoeType,
    source.type,
    source.name,
    roleEntry?.displayName,
  ].filter(isText).join(' ');
  const featureTags = readVisibleFeatureTags(authorizedRecords);
  const baseSubtype = canonicalSubtype(role, rawSubtype, authorizedRecords);
  const canonicalSubtypeValue = featureTags.includes('印花') && baseSubtype && !baseSubtype.includes('印花')
    ? `印花${baseSubtype}`
    : baseSubtype;
  const canonicalName = canonicalNameFor(role, baseSubtype, roleEntry, source);
  return {
    role,
    canonicalName,
    canonicalSubtype: canonicalSubtypeValue || canonicalName,
    visibleFeatureTags: featureTags,
    normalizedColor: extractAuthorizedColor(source, authorizedRecords),
  };
}

function collectFactRecords(item, candidate, roleEntry) {
  const id = readItemId(item) || readItemId(roleEntry);
  const sources = [
    item?.factRecords,
    item?.factEvidence,
    item?.factsWithSource,
    candidate?.visibleFacts?.itemFactsById?.[id]?.factRecords,
    candidate?.copyFacts?.itemFactsById?.[id]?.factRecords,
  ];
  const records = sources.flatMap((value) => Array.isArray(value) ? value : []);
  return dedupeRecords(records);
}

function extractAuthorizedColor(item, records) {
  const record = records.find((entry) => isAuthorizedRecord(entry)
    && ['color', 'basic_color'].includes(normalizeFact(entry))
    && isText(entry.value));
  if (record) return normalizeColor(record.value);
  const hasAuthorizedColorFact = records.some((entry) => isAuthorizedRecord(entry)
    && ['color', 'basic_color'].includes(normalizeFact(entry)));
  if (!hasAuthorizedColorFact) return '';
  return normalizeColor(readRawColor(item));
}

function readVisibleFeatureTags(records) {
  const tags = [];
  for (const record of records) {
    if (!isAuthorizedRecord(record)) continue;
    const fact = normalizeFact(record);
    const value = `${record.value || ''}`;
    if (fact === 'pattern_visible' && (record.value === true || /印花|print|graphic|floral|yes|true/i.test(value))) tags.push('印花');
  }
  return uniqueStrings(tags);
}

function canonicalSubtype(role, raw, records) {
  const factText = records
    .filter(isAuthorizedRecord)
    .map((record) => `${record.fact || record.factId || ''} ${record.value || ''}`)
    .join(' ');
  const text = `${String(raw || '')} ${factText}`.toLowerCase().replace(/[_-]+/g, ' ');
  const facts = new Set(records.filter(isAuthorizedRecord).map(normalizeFact));
  if (role === 'top') {
    if (/\u77ed\u8896\s*t\u6064/i.test(text) || facts.has('short_sleeve')) return '\u77ed\u8896T\u6064';
    if (/印花|print|graphic|floral/.test(text) || facts.has('pattern_visible')) {
      if (/t恤|tshirt|t_shirt|tee/.test(text) || facts.has('short_sleeve') || facts.has('sport_top')) return 'T恤';
    }
    if (/短袖\s*t恤|短袖t恤|tshirt|t_shirt|tee|t恤/.test(text) || facts.has('short_sleeve')) return /短袖/.test(text) ? '短袖T恤' : 'T恤';
    if (facts.has('sport_top')) return '运动上衣';
    if (/衬衫|衬衣|shirt|blouse/.test(text) || facts.has('shirt')) return '衬衫';
    if (/卫衣|hoodie|sweatshirt/.test(text)) return '卫衣';
    if (/针织|knit|sweater/.test(text)) return '针织上衣';
  }
  if (role === 'bottom') {
    if (/短裤|shorts|bermuda/.test(text) || facts.has('shorts')) return '短裤';
    if (/牛仔|jeans|denim/.test(text)) return '牛仔裤';
    if (/直筒|straight/.test(text) || facts.has('straight_cut')) return '直筒裤';
    if (/阔腿|wide.?leg/.test(text)) return '阔腿裤';
    if (/运动裤|jogger|sweatpants|sport/.test(text) || facts.has('sport_bottom')) return '运动裤';
    if (/半身裙|skirt|裙/.test(text)) return '半身裙';
  }
  if (role === 'onepiece' && /连衣裙|dress|onepiece/.test(text)) return '连衣裙';
  if (role === 'shoes') {
    if (/运动鞋|跑步鞋|训练鞋|sneaker|running|sport/.test(text) || facts.has('sport_shoe')) return '运动鞋';
    if (/帆布|canvas/.test(text)) return '帆布鞋';
    if (/乐福|loafer/.test(text)) return '乐福鞋';
    if (/凉鞋|sandal/.test(text)) return '凉鞋';
  }
  if (role === 'outerwear' && /外套|coat|jacket/.test(text)) return '外套';
  return cleanSubtype(raw, role);
}

function canonicalNameFor(role, subtype, roleEntry, item) {
  if (subtype) return subtype;
  const displayName = readText(roleEntry?.displayName || item?.customName || item?.name);
  return displayName || ({ top: '上衣', bottom: '下装', shoes: '鞋子', onepiece: '连衣裙', outerwear: '外套' }[role] || '单品');
}

function cleanSubtype(value, role) {
  const text = readText(value);
  if (!text) return '';
  const normalizedText = text.replace(/[_-]+/g, ' ');
  if (role === 'top' && /(?:^|\s)sport\s+top(?:\s|$)/i.test(normalizedText)) return '运动上衣';
  if (role === 'bottom' && /(?:^|\s)sport\s+(?:bottom|pants)(?:\s|$)/i.test(normalizedText)) return '运动裤';
  if (role === 'shoes' && /(?:^|\s)sport\s+sh(?:oe|oes)(?:\s|$)/i.test(normalizedText)) return '运动鞋';
  const roleWords = new RegExp(`(?:^|\\s)(?:${role}|上衣|下装|裤子|鞋子|shoes?|top|bottom)(?=\\s|$)`, 'gi');
  const styleWords = /简约|休闲|日常|校园|通勤|运动|甜美|复古|街头|优雅|pure|casual|daily|sport/gi;
  const cleaned = normalizedText.replace(roleWords, ' ').replace(styleWords, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned || /^(?:top|bottom|shoes?)$/i.test(cleaned)) return '';
  return cleaned.split(' ').filter(Boolean).slice(0, 2).join(' ');
}

function toDifferentiator(relation) {
  return {
    type: 'relation',
    relationCode: relation.relationCode,
    roles: relation.roles.slice(),
    authorizedValues: relation.authorizedValues.slice(),
    authorizedValue: relation.authorizedValues[0] || '',
  };
}

function toSignatureItem(item) {
  return {
    role: item.role,
    canonicalName: item.canonicalName,
    canonicalSubtype: item.canonicalSubtype,
    visibleFeatureTags: item.visibleFeatureTags,
    normalizedColor: item.normalizedColor,
  };
}

function stripInternalItemFields(item) {
  return toSignatureItem(item);
}

function relationTitleLabel(code) {
  return {
    SAME_COLOR_ALL_ROLES: '同色',
    SAME_COLOR_TOP_BOTTOM: '同色上下装',
    COLOR_ECHO_TOP_SHOES: '颜色呼应',
    SUBTYPE_FEATURE_PRINT: '印花重点',
    TOP_ACCENT_WITH_NEUTRAL_BOTTOM: '重点色',
    DISTINCT_TOP_BOTTOM_COLOR: '撞色',
    SINGLE_COLOR_FALLBACK: '单色',
  }[code] || '';
}

function buildSceneConclusion(scene) {
  return scene === 'sport' ? '适合日常轻运动' : `适合${SCENE_LABELS[scene] || '日常'}场景`;
}

function stripFeature(value) {
  return String(value || '').replace(/^印花/, '');
}

function shortColor(value) {
  return COLOR_SHORT_LABELS[value] || value.replace(/色$/, '');
}

function extractColorText(value) {
  return typeof value === 'string' ? value.trim() : typeof value?.name === 'string' ? value.name.trim() : typeof value?.color === 'string' ? value.color.trim() : '';
}

function normalizeColor(value) {
  const raw = extractColorText(value);
  if (!raw || /#[0-9a-f]{3,8}/i.test(raw) || /\d/.test(raw)) return '';
  return COLOR_LABELS.find(([pattern]) => pattern.test(raw))?.[1] || (/^[a-z][a-z -]{1,24}$/i.test(raw) ? raw.toLowerCase() : '');
}

function readRawColor(item) {
  return [item?.color, item?.colorName, ...(Array.isArray(item?.colors) ? item.colors : []), ...(Array.isArray(item?.colorPalette) ? item.colorPalette : [])]
    .map(extractColorText).find(Boolean) || '';
}

function normalizeFact(record) {
  const value = readText(record?.fact || record?.factId).toLowerCase();
  return value.replace(/^item:[^:]+:/, '');
}

function isAuthorizedRecord(record) {
  return Boolean(record && record.authorized !== false && (readText(record.fact || record.factId) || record.value));
}

function findItem(items, roleEntry) {
  const id = readItemId(roleEntry);
  return items.find((item) => readItemId(item) === id) || items.find((item) => normalizeRole(item?.outfitSlot || item?.category) === normalizeRole(roleEntry?.slot)) || null;
}

function readItems(source) {
  if (Array.isArray(source?.items) && source.items.length > 0) return source.items;
  if (Array.isArray(source?.snapshotItems) && source.snapshotItems.length > 0) return source.snapshotItems;
  return Array.isArray(source?.itemsSnapshot) ? source.itemsSnapshot : [];
}

function readRoleEntries(source) {
  return Array.isArray(source?.outfitItemRoles) ? source.outfitItemRoles : Array.isArray(source?.itemRoles) ? source.itemRoles : [];
}

function readItemId(value) {
  const id = value?._id || value?.id || value?.itemId || value?.clothingId;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : '';
}

function normalizeRole(value) {
  const raw = readText(value).toLowerCase();
  if (raw === 'skirt' || /半裙|裙子/.test(raw)) return 'bottom';
  if (/onepiece|dress|连衣裙/.test(raw)) return 'onepiece';
  if (/shoes?|shoe|鞋|靴/.test(raw)) return 'shoes';
  if (/outerwear|coat|jacket|外套/.test(raw)) return 'outerwear';
  if (/bottom|pants|下装|裤/.test(raw)) return 'bottom';
  if (/top|shirt|tee|t恤|上衣|卫衣/.test(raw)) return 'top';
  return raw;
}

function normalizeScene(value) {
  const raw = readText(value).toLowerCase();
  return { 居家: 'home', home: 'home', 上班: 'work', 通勤: 'work', work: 'work', 约会: 'date', date: 'date', 运动: 'sport', sport: 'sport', sports: 'sport' }[raw] || raw || 'home';
}

function readPresentationPlan(source) {
  const plan = source?.presentationPlan;
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return null;
  if (!plan.factModel || typeof plan.factModel !== 'object' || Array.isArray(plan.factModel)) return null;
  if (typeof plan.presentationFactSignature !== 'string') return null;
  return plan;
}

function roleIndex(role) {
  const index = ROLE_ORDER.indexOf(role);
  return index === -1 ? ROLE_ORDER.length : index;
}

function dedupeRecords(records) {
  const seen = new Set();
  return records.filter((record) => {
    const key = `${normalizeFact(record)}|${String(record?.value ?? '')}|${String(record?.source || '')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
}

function compactText(value) {
  return String(value || '').replace(/\s+/g, '').replace(/，+/g, '，').trim();
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter(isText).map((value) => value.trim()))];
}

function isText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function readText(value) {
  return isText(value) ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

module.exports = {
  PRESENTATION_FACT_MODEL_VERSION,
  PRESENTATION_PLAN_VERSION,
  assignPresentationDifferentiators,
  applyPresentationPlan,
  buildPresentationFactModel,
  buildPresentationPlan,
  readPresentationPlan,
  normalizeColor,
  normalizeScene,
};
