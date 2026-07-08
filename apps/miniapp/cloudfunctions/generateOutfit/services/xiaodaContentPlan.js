const XIAODA_CONTENT_PLAN_VERSION = 'xiaoda-content-plan-v1';

const SLOT_LABELS = {
  top: '上衣',
  bottom: '下装',
  skirt: '半裙',
  onepiece: '连衣裙',
  outerwear: '外套',
  shoes: '鞋子',
  accessory: '配饰',
  other: '单品',
};

const BENEFIT_LABELS = {
  indoor_relax: '在家活动更轻松',
  walkable: '走动和临时出门更方便',
  clean_daily: '日常穿着清楚省心',
  commute_polish: '通勤场景更利落',
  temperature_buffer: '温差变化时更好调整',
  soft_mood: '整体更柔和',
  clear_highlight: '有一处小重点',
  light_activity: '轻活动时不笨重',
  formal_training: '适合正式训练',
  hot_weather: '高温下更清爽',
  accent: '用小面积细节提气色',
};

const EMPTY_PHRASES = [
  '单品和单品很日常',
  '想再明确一点',
  '整体比较完整',
  '场景适配度比较高',
  '可以优化一下',
  '比较协调',
];

function buildXiaodaContentPlanV1(outfit = {}, context = {}) {
  const items = readPlanItems(outfit);
  const sceneIntent = readString(context.sceneIntent || outfit.sceneIntent) || inferSceneIntent(outfit.scene);
  const primaryBenefit = readString(context.primaryBenefit || outfit.primaryBenefit || outfit.primaryBenefitCode) || inferPrimaryBenefit(sceneIntent);
  const secondaryBenefit = readString(context.secondaryBenefit || outfit.secondaryBenefit);
  const observations = uniqueStrings([
    readString(context.observationFocus || outfit.observationFocus),
    primaryBenefit,
    secondaryBenefit,
    ...items.map((item) => `${item.role}:${item.displayName}`),
  ]).filter(Boolean).slice(0, 5);
  const basePlan = {
    version: XIAODA_CONTENT_PLAN_VERSION,
    sceneIntent,
    items,
    observations,
    primaryBenefit,
    secondaryBenefit: secondaryBenefit || undefined,
    suggestion: null,
  };
  return {
    ...basePlan,
    suggestion: buildSuggestion(basePlan, outfit, context),
  };
}

function buildXiaodaDefaultReviewV1(plan) {
  const rendered = renderXiaodaPlanTextV1(plan);
  const defaultDetailExplanation = normalizeVisibleText(plan?.defaultDetailExplanation);
  return {
    source: 'rule_default',
    reason: defaultDetailExplanation || rendered.bodyParagraphs.join(''),
    tip: rendered.suggestion?.text || '',
    contentPlanVersion: plan.version,
    sceneIntent: plan.sceneIntent,
    primaryBenefitCode: plan.primaryBenefit,
  };
}

function renderXiaodaPlanTextV1(plan) {
  const items = Array.isArray(plan?.items) ? plan.items : [];
  const core = items.filter((item) => item.role === 'core');
  const functional = items.filter((item) => item.role === 'functional');
  const optional = items.filter((item) => item.role === 'optional');
  const coreText = joinNames(core);
  const benefit = BENEFIT_LABELS[plan?.primaryBenefit] || '今天穿起来更省心';
  const bodyParagraphs = [];
  if (isHomeQuickOuting(plan, items)) {
    return {
      bodyParagraphs: [`${joinNamesWithAnd(items)}都偏日常，在家穿不费心，临时出门也不用重新换鞋。`],
      suggestion: plan?.suggestion ? { title: '可以试试', text: plan.suggestion.text } : null,
    };
  }
  if (coreText) {
    bodyParagraphs.push(`${joinNamesWithAnd(core)}可以直接成套穿，${benefit}。`);
  } else {
    bodyParagraphs.push(`这套信息不多，今天先按日常场景穿，${benefit}。`);
  }
  if (functional.length > 0) {
    bodyParagraphs.push(`${joinNames(functional)}主要负责天气或场景上的需要，不是为了凑件数。`);
  } else if (optional.length > 0) {
    bodyParagraphs.push(`${joinNames(optional)}只是加一点小细节，没有它也不影响这套成立。`);
  } else {
    bodyParagraphs.push(renderSecondObservation(plan, items));
  }
  return {
    bodyParagraphs,
    suggestion: plan?.suggestion ? { title: '可以试试', text: plan.suggestion.text } : null,
  };
}

function renderSecondObservation(plan, items) {
  const shoes = items.find((item) => item.slot === 'shoes');
  if (plan.primaryBenefit === 'walkable' && shoes) return `${shoes.displayName}方便临时出门，今天不用再换一双鞋。`;
  if (plan.primaryBenefit === 'formal_training' && shoes) return `${shoes.displayName}和运动单品一起承担训练用途，普通日常单品不会被当成专业装备。`;
  if (plan.primaryBenefit === 'hot_weather') return '高温时这套没有额外加外套，重点放在少层次和清爽度上。';
  if (plan.primaryBenefit === 'commute_polish') return '这套没有靠夸张细节撑场面，主要用清楚的单品关系服务通勤状态。';
  if (plan.primaryBenefit === 'soft_mood') return `${scenePrefix(plan)}穿会显得轻松一些，不靠额外外套或配饰撑效果。`;
  if (plan.primaryBenefit === 'clear_highlight') return '有图案或颜色重点的单品已经在这套里，其他部分简单一点就好。';
  return '现有单品已经能直接出门，不需要为了凑完整再加东西。';
}

function hasQualifiedAiReviewIncrementV1(aiComment, plan, fallbackReview) {
  const rejectReasons = [];
  const reason = normalizeVisibleText(aiComment?.reason || aiComment?.overallComment);
  const tip = normalizeVisibleText(aiComment?.tip || aiComment?.advice);
  const combined = `${reason}${tip}`;
  if (!reason) rejectReasons.push('missing_reason');
  if (containsEmptyPhrase(combined)) rejectReasons.push('empty_phrase');
  if (containsEnglishTypeLeak(combined)) rejectReasons.push('english_type_leak');
  if (!mentionsPlanFact(combined, plan)) rejectReasons.push('not_grounded');
  if (!hasInformationGain(reason, fallbackReview?.reason || renderXiaodaPlanTextV1(plan).bodyParagraphs.join(''))) {
    rejectReasons.push('no_information_gain');
  }
  const normalizedSuggestion = tip ? normalizeXiaodaSuggestionV1(tip, plan) : null;
  if (tip && !normalizedSuggestion) rejectReasons.push('invalid_suggestion');
  return {
    qualified: rejectReasons.length === 0,
    rejectReasons,
    aiComment: rejectReasons.length === 0
      ? {
          ...aiComment,
          reason,
          tip: normalizedSuggestion?.text || '',
          source: aiComment?.source || 'ai',
          contentPlanVersion: plan.version,
          sceneIntent: plan.sceneIntent,
          primaryBenefitCode: plan.primaryBenefit,
        }
      : null,
  };
}

function normalizeXiaodaSuggestionV1(value, plan) {
  const text = normalizeVisibleText(value);
  if (!text || containsEmptyPhrase(text) || containsEnglishTypeLeak(text)) return null;
  if (!/(带|拿|穿|换|留|收|减少|搭|放|选)/.test(text)) return null;
  if (!mentionsPlanFact(text, plan)) return null;
  return { text };
}

function readPlanItems(outfit) {
  const roleItems = Array.isArray(outfit.outfitItemRoles) ? outfit.outfitItemRoles : [];
  if (roleItems.length > 0) {
    return roleItems.map((item, index) => normalizePlanItem(item, index)).filter(Boolean);
  }
  const snapshots = [
    ...(Array.isArray(outfit.snapshotItems) ? outfit.snapshotItems : []),
    ...(Array.isArray(outfit.itemsSnapshot) ? outfit.itemsSnapshot : []),
    ...(Array.isArray(outfit.items) ? outfit.items : []),
  ];
  const seen = new Set();
  return snapshots.map((item, index) => {
    const id = readString(item.itemId || item.clothingId || item.id || item._id) || `item-${index}`;
    if (seen.has(id)) return null;
    seen.add(id);
    return normalizePlanItem({
      id,
      slot: item.category || item.type || 'other',
      role: 'core',
      displayName: item.name || item.subcategory || item.subCategory || item.category,
    }, index);
  }).filter(Boolean);
}

function normalizePlanItem(item, index) {
  if (!item || typeof item !== 'object') return null;
  const id = readString(item.id || item.itemId || item.clothingId) || `item-${index}`;
  const slot = normalizeSlot(item.slot || item.category || item.type);
  return {
    id,
    slot,
    role: ['core', 'functional', 'optional'].includes(item.role) ? item.role : 'core',
    displayName: toDisplayName(item.displayName || item.name || item.subcategory || item.subCategory, slot),
  };
}

function buildSuggestion(plan) {
  if (!plan.items.length) return null;
  const functional = plan.items.find((item) => item.role === 'functional');
  if (functional && (plan.primaryBenefit === 'temperature_buffer' || plan.secondaryBenefit === 'temperature_buffer')) {
    return { text: `如果进出室内温差明显，可以把${functional.displayName}拿在手边，需要时再穿。` };
  }
  const optional = plan.items.find((item) => item.role === 'optional');
  if (optional && plan.primaryBenefit === 'accent') {
    return { text: `想让重点更集中，可以只保留${optional.displayName}这一处点缀。` };
  }
  return null;
}

function inferSceneIntent(scene) {
  const raw = readString(scene).toLowerCase();
  if (raw === 'home' || raw === '居家') return 'home:clean_daily';
  if (raw === 'work' || raw === '上班') return 'work:polished';
  if (raw === 'date' || raw === '约会') return 'date:casual';
  if (raw === 'sport' || raw === 'sports' || raw === '运动') return 'sport:light_activity';
  return 'home:clean_daily';
}

function inferPrimaryBenefit(sceneIntent) {
  if (sceneIntent.includes('walk')) return 'walkable';
  if (sceneIntent.includes('layer')) return 'temperature_buffer';
  if (sceneIntent.includes('training')) return 'formal_training';
  if (sceneIntent.includes('light_activity')) return 'light_activity';
  if (sceneIntent.includes('soft')) return 'soft_mood';
  if (sceneIntent.includes('highlight')) return 'clear_highlight';
  if (sceneIntent.includes('indoor')) return 'indoor_relax';
  if (sceneIntent.includes('polished')) return 'commute_polish';
  return 'clean_daily';
}

function toDisplayName(value, slot) {
  const text = readString(value);
  if (!text || containsEnglishTypeLeak(text)) return SLOT_LABELS[slot] || '单品';
  return text;
}

function normalizeSlot(value) {
  const raw = readString(value).toLowerCase();
  if (['top', '上衣'].includes(raw)) return 'top';
  if (['bottom', '下装', '裤子'].includes(raw)) return 'bottom';
  if (['skirt', '半裙', '裙子'].includes(raw)) return 'skirt';
  if (['onepiece', 'dress', '连衣裙', '连体'].includes(raw)) return 'onepiece';
  if (['outerwear', 'coat', '外套'].includes(raw)) return 'outerwear';
  if (['shoes', 'shoe', '鞋子'].includes(raw)) return 'shoes';
  if (['accessory', '配饰'].includes(raw)) return 'accessory';
  return 'other';
}

function mentionsPlanFact(text, plan) {
  const facts = [
    ...(plan?.items || []).flatMap((item) => [item.displayName, SLOT_LABELS[item.slot]]),
    BENEFIT_LABELS[plan?.primaryBenefit],
    BENEFIT_LABELS[plan?.secondaryBenefit],
  ].filter(Boolean);
  return facts.some((fact) => fact && text.includes(fact));
}

function hasInformationGain(candidate, fallback) {
  const candidateTokens = meaningfulTokens(candidate);
  const fallbackTokens = new Set(meaningfulTokens(fallback));
  const newTokens = candidateTokens.filter((token) => !fallbackTokens.has(token));
  return candidate.length >= 28 && newTokens.length >= 2 && similarity(candidate, fallback) < 0.76;
}

function meaningfulTokens(text) {
  return uniqueStrings(normalizeVisibleText(text).split(/[，。；、\s]+/).filter((part) => part.length >= 2));
}

function containsEmptyPhrase(text) {
  return EMPTY_PHRASES.some((phrase) => text.includes(phrase));
}

function containsEnglishTypeLeak(text) {
  return /\b(category|subcategory|slot|top|bottom|shoes|outerwear|accessory|onepiece)\b/i.test(text);
}

function normalizeVisibleText(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, '').trim().slice(0, 180) : '';
}

function joinNames(items) {
  return items.map((item) => item.displayName).filter(Boolean).join('、');
}

function joinNamesWithAnd(items) {
  const names = items.map((item) => item.displayName).filter(Boolean);
  if (names.length <= 2) return names.join('和');
  return `${names.slice(0, -1).join('、')}和${names[names.length - 1]}`;
}

function isHomeQuickOuting(plan, items) {
  return readString(plan?.sceneIntent).startsWith('home:')
    && plan?.primaryBenefit === 'walkable'
    && items.some((item) => item.slot === 'top')
    && items.some((item) => item.slot === 'bottom' || item.slot === 'skirt')
    && items.some((item) => item.slot === 'shoes');
}

function scenePrefix(plan) {
  const intent = readString(plan?.sceneIntent);
  if (intent.startsWith('home:')) return '居家';
  if (intent.startsWith('work:')) return '上班';
  if (intent.startsWith('sport:')) return '运动';
  if (intent.startsWith('date:')) return '约会';
  return '日常';
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueStrings(values) {
  const result = [];
  const seen = new Set();
  for (const value of values || []) {
    const text = readString(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function similarity(left, right) {
  const a = new Set(Array.from(normalizeVisibleText(left)));
  const b = new Set(Array.from(normalizeVisibleText(right)));
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const char of a) {
    if (b.has(char)) shared += 1;
  }
  return shared / Math.max(a.size, b.size);
}

module.exports = {
  XIAODA_CONTENT_PLAN_VERSION,
  buildXiaodaContentPlanV1,
  buildXiaodaDefaultReviewV1,
  hasQualifiedAiReviewIncrementV1,
  normalizeXiaodaSuggestionV1,
  renderXiaodaPlanTextV1,
};
