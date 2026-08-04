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
  const canonicalCopy = readCanonicalCopy(context.canonicalCopy || context.copyContract || outfit.copyContract);
  const observations = uniqueStrings([
    readString(context.observationFocus || outfit.observationFocus),
    primaryBenefit,
    secondaryBenefit,
    ...items.map((item) => `${item.role}:${item.displayName}`),
  ]).filter(Boolean).slice(0, 5);
  const detailExplanation = readCanonicalText(canonicalCopy.detailExplanation);
  return {
    version: XIAODA_CONTENT_PLAN_VERSION,
    sceneIntent,
    items,
    observations,
    primaryBenefit,
    secondaryBenefit: secondaryBenefit || undefined,
    suggestion: null,
    defaultCopy: canonicalCopy,
    defaultTodayReason: readCanonicalText(canonicalCopy.todayReason),
    defaultDetailExplanation: detailExplanation,
  };
}

function buildXiaodaDefaultReviewV1(plan) {
  const defaultDetailExplanation = readCanonicalText(
    plan?.defaultDetailExplanation ?? plan?.defaultCopy?.detailExplanation,
  );
  return {
    source: 'rule_default',
    reason: defaultDetailExplanation,
    tip: '',
    contentPlanVersion: plan.version,
    sceneIntent: plan.sceneIntent,
    primaryBenefitCode: plan.primaryBenefit,
  };
}

function renderXiaodaPlanTextV1(plan) {
  const detailExplanation = readCanonicalText(
    plan?.defaultDetailExplanation ?? plan?.defaultCopy?.detailExplanation,
  );
  return {
    bodyParagraphs: detailExplanation ? [detailExplanation] : [],
    suggestion: null,
  };
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

function readCanonicalCopy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...value };
}

function readCanonicalText(value) {
  return typeof value === 'string' ? value : '';
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
