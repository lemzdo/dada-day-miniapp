const {
  XIAODA_PERSONA_VERSION,
  inspectXiaodaPersonaCopy,
} = require('./xiaodaPersonaContract');

const XIAODA_CONTENT_PLAN_VERSION = 'xiaoda-content-plan-v3';
const AI_COMMENTARY_INCREMENTAL_VALUE_GATE_VERSION = 'ai-commentary-incremental-value-gate-v1';

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
  const xiaodaStyleInsight = normalizeStyleInsight(
    context.xiaodaStyleInsight || outfit.xiaodaStyleInsight || canonicalCopy.xiaodaStyleInsight,
  );
  return {
    version: XIAODA_CONTENT_PLAN_VERSION,
    personaVersion: XIAODA_PERSONA_VERSION,
    sceneIntent,
    items,
    observations,
    primaryBenefit,
    secondaryBenefit: secondaryBenefit || undefined,
    suggestion: null,
    defaultCopy: canonicalCopy,
    defaultTodayReason: readCanonicalText(canonicalCopy.todayReason),
    defaultDetailExplanation: detailExplanation,
    xiaodaStyleInsight,
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
  if (inspectXiaodaPersonaCopy(combined).violations.includes('ALGORITHM_CHINESE')) {
    rejectReasons.push('algorithm_to_chinese_leakage');
  }
  if (!mentionsPlanFact(combined, plan)) rejectReasons.push('not_grounded');
  if (!mentionsPrimaryInsight(combined, plan)) rejectReasons.push('semantic_drift');
  const incrementalValueGate = evaluateAiCommentaryIncrementalValue({
    reason,
    plan,
    fallbackReason: fallbackReview?.reason || renderXiaodaPlanTextV1(plan).bodyParagraphs.join(''),
  });
  if (incrementalValueGate.result !== 'PASS') {
    rejectReasons.push('no_information_gain');
    rejectReasons.push('no_ai_incremental_value');
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
           incrementalValueGate,
         }
      : null,
  };
}

function evaluateAiCommentaryIncrementalValue({ reason, plan, fallbackReason } = {}) {
  const candidate = normalizeVisibleText(reason);
  const baselines = uniqueStrings([
    readCanonicalText(plan?.defaultTodayReason),
    readCanonicalText(plan?.defaultDetailExplanation),
    readCanonicalText(fallbackReason),
  ]);
  const reasons = [];
  if (candidate.length < 32) reasons.push('TOO_SHORT_FOR_DEEPER_COMMENTARY');
  if (baselines.some((baseline) => baseline && similarity(candidate, baseline) >= 0.76)) {
    reasons.push('REPHRASES_VISIBLE_COPY');
  }
  const baselineNgrams = new Set(baselines.flatMap((baseline) => characterNgrams(baseline, 3)));
  const newNgrams = characterNgrams(candidate, 3).filter((value) => !baselineNgrams.has(value));
  if (newNgrams.length < 6) reasons.push('INSUFFICIENT_NEW_EXPLANATION');
  const mentionedItems = (Array.isArray(plan?.items) ? plan.items : [])
    .filter((item) => itemFocusTerms(item).some((term) => candidate.includes(term)));
  if (mentionedItems.length < Math.min(2, (plan?.items || []).length)) reasons.push('INSUFFICIENT_GARMENT_CONTRIBUTION');
  if (!/(因为|所以|因此|让|把|少了|不会|没有|先|又|穿上|穿在)/u.test(candidate)) {
    reasons.push('MISSING_CAUSAL_STYLING_REASON');
  }
  return {
    version: AI_COMMENTARY_INCREMENTAL_VALUE_GATE_VERSION,
    result: reasons.length === 0 ? 'PASS' : 'REJECT',
    reasons,
    comparedSurfaces: baselines.length,
    newExplanationNgramCount: newNgrams.length,
  };
}

function normalizeXiaodaSuggestionV1(value, plan) {
  const text = normalizeVisibleText(value);
  if (!text || containsEmptyPhrase(text) || containsEnglishTypeLeak(text)) return null;
  if (/(换成|更换|替换|改成|另选|选一(?:双|件|条|个|只)|购买|买一)/.test(text)) return null;
  if (!/(带|拿|穿|留|收|减少|搭|放)/.test(text)) return null;
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

function mentionsPrimaryInsight(text, plan) {
  const code = readString(plan?.xiaodaStyleInsight?.primary?.code);
  if (!code) return true;
  const groups = [
    [/PATTERN|DESIGN_FOCUS/u, ['图案', '印花', '细节', '重点', '简单']],
    [/COLOR_FOCUS/u, ['颜色', '中性色', '重点', '清爽']],
    [/ECHO|CONTINUITY|SAME_COLOR|TONAL|NEARBY_COLOR|COLOR_CONTRAST|TWO_COLOR|QUIET_NEUTRAL/u, ['颜色', '同色', '呼应', '主色', '变化', '色彩', '色调', '基调', '统一', '衔接', '接近', '柔和', '对比', '点缀色', '明暗', '不抢眼']],
    [/SILHOUETTE/u, ['宽松', '收', '松紧', '线条', '利落']],
    [/PROPORTION/u, ['长短', '比例', '短', '长']],
    [/ONEPIECE/u, ['连衣裙', '一件式', '外套', '鞋']],
    [/FORMALITY|WORK_/u, ['利落', '得体', '正式', '上班', '通勤']],
    [/SPORT_/u, ['运动', '散步', '快走', '轻活动']],
    [/HOME_/u, ['在家', '下楼', '日常']],
    [/SIMPLE_EVERYDAY/u, ['简单', '日常', '省心']],
  ];
  const terms = groups.find(([pattern]) => pattern.test(code))?.[1] || [];
  return terms.some((term) => text.includes(term)) && preservesPrimaryInsightRoles(text, plan);
}

function preservesPrimaryInsightRoles(text, plan) {
  const primary = plan?.xiaodaStyleInsight?.primary;
  if (!/COLOR_FOCUS/u.test(readString(primary?.code))) return true;
  const focalItemId = uniqueStrings(primary?.subjectItemIds)[0];
  if (!focalItemId) return true;
  const otherItems = (Array.isArray(plan?.items) ? plan.items : [])
    .filter((item) => item?.id && item.id !== focalItemId);
  return !otherItems.some((item) => itemFocusTerms(item).some((term) => {
    const match = text.match(new RegExp(`${escapeRegExp(term)}(.{0,6})(?:焦点|亮点|颜色重点)`, 'u'));
    if (!match) return false;
    return !/(?:没有|没|未|不)/u.test(match[1] || '');
  }));
}

function itemFocusTerms(item) {
  const displayName = readString(item?.displayName);
  const terms = [normalizeVisibleText(displayName)];
  const garmentTerms = displayName.match(/阔腿裤|直筒裤|短裤|长裤|半裙|吊带裙|连衣裙|运动鞋|皮鞋|乐福鞋|T恤|衬衫|毛衣|卫衣|外套/giu) || [];
  terms.push(...garmentTerms.map(normalizeVisibleText));
  return uniqueStrings(terms);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeStyleInsight(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const normalizeEntry = (entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    return {
      rank: readString(entry.rank),
      code: readString(entry.code),
      intent: readString(entry.intent),
      dimension: readString(entry.dimension),
      relationCode: readString(entry.relationCode),
      source: readString(entry.source),
      subjectItemIds: uniqueStrings(entry.subjectItemIds),
      primaryObservation: readString(entry.primaryObservation),
      supportingRelation: readString(entry.supportingRelation),
      humanMeaning: readString(entry.humanMeaning),
      overallMeaning: readString(entry.overallMeaning),
      allowedAestheticInferences: Array.isArray(entry.allowedAestheticInferences)
        ? entry.allowedAestheticInferences.map((inference) => ({
            code: readString(inference?.code),
            label: readString(inference?.label),
          })).filter((inference) => inference.code && inference.label)
        : [],
    };
  };
  const primary = normalizeEntry(value.primary);
  if (!primary?.code) return null;
  return {
    version: readString(value.version),
    personaVersion: readString(value.personaVersion) || XIAODA_PERSONA_VERSION,
    primary,
    secondary: (Array.isArray(value.secondary) ? value.secondary : []).map(normalizeEntry).filter(Boolean).slice(0, 2),
    optional: (Array.isArray(value.optional) ? value.optional : []).map(normalizeEntry).filter(Boolean).slice(0, 3),
    forbiddenClaims: uniqueStrings(value.forbiddenClaims),
  };
}

function characterNgrams(value, size) {
  const characters = Array.from(normalizeVisibleText(value).replace(/[，。！？；、,.!?;\s]+/gu, ''));
  if (characters.length < size) return [];
  const values = [];
  for (let index = 0; index <= characters.length - size; index += 1) {
    values.push(characters.slice(index, index + size).join(''));
  }
  return uniqueStrings(values);
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
  AI_COMMENTARY_INCREMENTAL_VALUE_GATE_VERSION,
  XIAODA_CONTENT_PLAN_VERSION,
  buildXiaodaContentPlanV1,
  buildXiaodaDefaultReviewV1,
  evaluateAiCommentaryIncrementalValue,
  hasQualifiedAiReviewIncrementV1,
  normalizeXiaodaSuggestionV1,
  normalizeStyleInsight,
  renderXiaodaPlanTextV1,
};
