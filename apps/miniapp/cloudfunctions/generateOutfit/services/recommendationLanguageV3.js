const {
  XIAODA_CONTENT_PLAN_VERSION,
  buildXiaodaContentPlanV1,
} = require('./xiaodaContentPlan');
const { buildOutfitCopyFacts } = require('./outfitCopyFacts');
const { buildSupportedOutfitInsights } = require('./supportedOutfitInsights');
const { planRecommendationNarrative } = require('./recommendationNarrativePlanner');
const { buildRecommendationCopyContract } = require('./recommendationCopyContract');
const { buildRecommendationCopyInput } = require('./pageCopyComposer');
const {
  appendBatchCopySelection,
  createBatchCopyConstraints,
} = require('./batchCopyDiversity');
const { buildOutfitCardViewModel } = require('./outfitCardViewModel');
const { resolveRealAiReviewSource } = require('./recommendationReviewProvenance');
const { applyPresentationPlan, readPresentationPlan } = require('./presentationFactModel');

const RECOMMENDATION_REASON_VERSION_V3 = 'recommendation-reason-v3';
const CATEGORY_ORDER = ['top', 'outerwear', 'onepiece', 'bottom', 'skirt', 'shoes', 'accessory', 'other'];
const DIMENSION_PRIORITY = {
  pattern: 0,
  color: 1,
  silhouette: 2,
  proportion: 3,
  formality: 4,
  detail: 5,
  style: 6,
  scene: 7,
  weather: 8,
};
const STYLE_ALLOWLIST = ['休闲', '简约', '运动', '通勤', '甜美', '复古', '街头', '优雅'];
const PATTERN_TAGS = {
  graphic: '印花',
  floral: '印花',
  print: '印花',
  printed: '印花',
  stripe: '条纹',
  striped: '条纹',
  plaid: '格纹',
  check: '格纹',
  solid: '纯色',
  plain: '纯色',
};
const FIT_TAGS = {
  relaxed: '宽松',
  loose: '宽松',
  oversized: '宽松',
  straight: '利落',
  clean: '利落',
  fitted: '修身',
  slim: '修身',
  layered: '层次',
};
const SCENE_LABELS = {
  home: '居家',
  work: '上班',
  date: '约会',
  sport: '运动',
  sports: '运动',
};

function compileRecommendationLanguageV3(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const { outfits = [], scene, weather, seed, batchContext, instrumentation } = source;
  if (!Array.isArray(outfits) || outfits.length === 0) return [];
  for (let index = 0; index < outfits.length; index += 1) {
    recordMetric(instrumentation, 'compileCandidateTags');
    recordMetric(instrumentation, 'compileTodayReason');
    recordMetric(instrumentation, 'compileCopyContract');
  }
  const plans = planBatchCopyV3(outfits.map((value) => {
    const outfit = isPlainObject(value) ? value : {};
    return {
      outfit,
      scene: scene ?? outfit.scene,
      weather: weather ?? outfit.weatherSnapshot ?? outfit.weather,
      seed,
      batchContext,
    };
  }));
  return plans.map(buildCompiledOutfitV3);
}

function buildCompiledOutfitV3(plan) {
  const canonical = plan.copyContract;
  const outfit = { ...plan.outfit };
  delete outfit._canonicalCandidate;
  const aiReviewSource = resolveRealAiReviewSource(outfit);
  const preserveAiReview = Boolean(aiReviewSource);
  const aiComment = preserveAiReview
    ? outfit.aiComment
    : {
        overallComment: canonical.detailExplanation,
        advice: '',
        contentPlanVersion: plan.contentPlan.version,
        sceneIntent: plan.contentPlan.sceneIntent,
        primaryBenefitCode: plan.contentPlan.primaryBenefit,
        reviewSource: 'rule_default',
      };

  return {
    ...outfit,
    ...(plan.presentationPlan?.titleConcept
      ? { title: plan.presentationPlan.titleConcept, displayTitle: plan.presentationPlan.titleConcept }
      : {}),
    eligibilityReason: plan.narrativePlan.eligibilityReason,
    reasonVersion: RECOMMENDATION_REASON_VERSION_V3,
    copyContract: canonical,
    copyContractVersion: canonical.copyContractVersion,
    voiceBankVersion: canonical.voiceBankVersion,
    reason: canonical.todayReason,
    reasoning: canonical.detailExplanation,
    todayClaim: canonical.todayClaim,
    todayClaimId: canonical.todayClaimId,
    todayAction: canonical.todayAction,
    todayDimension: canonical.todayDimension,
    todayEvidenceIds: canonical.todayEvidenceIds,
    todayRequiredFactIds: canonical.todayRequiredFactIds,
    todayEvidenceSources: canonical.todayEvidenceSources,
    todaySentenceClusterId: canonical.todaySentenceClusterId,
    todaySubjectItemId: canonical.todaySubjectItemId,
    todaySubjectItemIds: canonical.todaySubjectItemIds,
    todaySlotBindings: canonical.todaySlotBindings,
    todayReasonSource: canonical.todayReasonSource,
    coreEligibilityReason: canonical.coreEligibilityReason,
    coreEligibilityReasonCode: canonical.coreEligibilityReasonCode,
    coreEligibilityEvidence: canonical.coreEligibilityEvidence,
    coreEligibilitySubjectItemIds: canonical.coreEligibilitySubjectItemIds,
    coreEligibilitySupportingFactIds: canonical.coreEligibilitySupportingFactIds,
    coreEligibilityRelationFactIds: canonical.coreEligibilityRelationFactIds,
    coreEligibilitySourceRule: canonical.coreEligibilitySourceRule,
    coreEligibilitySourceRuleReasons: canonical.coreEligibilitySourceRuleReasons,
    enhancedReason: canonical.enhancedReason,
    enhancementRejectReasons: canonical.enhancementRejectReasons,
    detailClaim: canonical.detailClaim,
    detailClaimId: canonical.detailClaimId,
    detailAction: canonical.detailAction,
    detailDimension: canonical.detailDimension,
    detailEvidenceIds: canonical.detailEvidenceIds,
    detailRequiredFactIds: canonical.detailRequiredFactIds,
    detailEvidenceSources: canonical.detailEvidenceSources,
    detailSentenceClusterId: canonical.detailSentenceClusterId,
    detailSubjectItemId: canonical.detailSubjectItemId,
    detailSubjectItemIds: canonical.detailSubjectItemIds,
    detailSlotBindings: canonical.detailSlotBindings,
    riskFlags: canonical.riskFlags,
    qualification: canonical.qualification,
    cardViewModel: buildOutfitCardViewModel(outfit),
    detailNarrativeViewModel: {
      defaultText: canonical.detailExplanation,
      source: 'copy_contract',
      aiStatus: 'default',
    },
    reviewSource: preserveAiReview ? aiReviewSource : 'rule_default',
    contentPlanVersion: plan.contentPlan.version,
    contentPlan: plan.contentPlan,
    presentationPlan: plan.presentationPlan || outfit.presentationPlan,
    sceneIntent: plan.contentPlan.sceneIntent,
    primaryBenefitCode: plan.contentPlan.primaryBenefit,
    validatorRejectReasons: canonical.riskFlags,
    cacheReuseReason: '',
    primaryDimension: canonical.todayDimension,
    primaryInsightCode: plan.supportedCopyInsights[0]?.code || '',
    evidenceCodes: uniqueStrings([
      ...canonical.todayEvidenceIds,
      ...canonical.detailEvidenceIds,
    ]),
    styleTags: deriveDisplayTagsV3(plan.facts),
    aiComment,
  };
}

function extractOutfitFactsV3(input = {}, context = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const items = normalizeItems(readItems(source));
  const scene = normalizeScene(context.scene || source.scene);
  const weather = context.weather || source.weatherSnapshot || source.weather || {};
  const scores = sanitizeScores(source.scores);
  const aesthetic = sanitizeAesthetic(source.aestheticEvaluation);
  const categories = uniqueStrings(items.map((item) => item.slot)).sort();
  const colorFamilies = uniqueStrings(items.flatMap((item) => item.colors.map(classifyColorFamily))).filter(Boolean).sort();
  const styleTags = uniqueStrings(items.flatMap((item) => item.styleTags)).sort();

  return stripNonFinite({
    items,
    outfit: {
      itemCount: items.length,
      categories,
      colorFamilies,
      styleTags,
    },
    context: {
      scene,
      temperatureBand: getTemperatureBand(weather),
      conditionBucket: getConditionBucket(weather),
    },
    scores,
    aesthetic,
  });
}

function deriveOutfitInsightsV3(facts = {}) {
  const items = Array.isArray(facts.items) ? facts.items : [];
  const insights = [];
  addPatternInsights(insights, items);
  addColorInsights(insights, items);
  addSilhouetteInsights(insights, items);
  addFormalityInsights(insights, items);
  addDetailInsights(insights, items);
  addStyleInsights(insights, items);
  addSceneInsights(insights, facts, items);
  addWeatherInsights(insights, facts, items);
  return uniqueInsights(insights).sort(compareInsights);
}

function planBatchCopyV3(outfitPlans = []) {
  const plans = [];
  let batchConstraints = createBatchCopyConstraints();
  for (let index = 0; index < outfitPlans.length; index += 1) {
    const entry = outfitPlans[index] || {};
    const candidate = Object.prototype.hasOwnProperty.call(entry, 'outfit') ? entry.outfit : entry;
    const outfit = isPlainObject(candidate) ? candidate : {};
    const scene = entry.scene ?? outfit.scene;
    const weather = entry.weather ?? outfit.weatherSnapshot ?? outfit.weather;
    const canonicalCandidate = outfit._canonicalCandidate;
    const facts = canonicalCandidate?.displayFacts || extractOutfitFactsV3(outfit, { scene, weather });
    const explicitContractFacts = collectExplicitContractFacts(outfit);
    const copyFacts = canonicalCandidate?.copyFacts || buildOutfitCopyFacts({
      outfit,
      scene,
      weather,
      contractFacts: explicitContractFacts,
    });
    const supportedCopyInsights = buildSupportedOutfitInsights(copyFacts);
    normalizeSceneGroundingForContract(copyFacts, supportedCopyInsights, scene);
    const plannerInput = {
      facts: copyFacts,
      insights: supportedCopyInsights,
      scene,
      weather,
      wearabilityFacts: outfit.wearabilityFacts || outfit.eligibility?.weather,
      eligibilityReason: outfit.eligibilityReason || outfit.eligibility?.scene?.eligibilityReason,
      eligibilityEvaluated: Boolean(outfit.eligibility?.scene),
    };
    const contractSeed = buildStableContractSeed(entry, outfit, index);
    const attempts = [];
    const retryBatchContext = mergePlannerBatchContext(entry.batchContext, batchConstraints);
    let narrativePlan = null;
    let contractInput = null;
    let copyContract = null;
    for (let attempt = 0; attempt < 1; attempt += 1) {
      narrativePlan = planRecommendationNarrative({ ...plannerInput, batchContext: retryBatchContext });
      const compiledAttempt = compilePlannedContract({
        copyFacts,
        supportedCopyInsights,
        scene,
        weather,
        narrativePlan,
        eligibilityReason: narrativePlan.eligibilityReason,
        batchConstraints,
        contractSeed: `${contractSeed}:attempt:${attempt}`,
        batchIndex: index,
      });
      contractInput = compiledAttempt.contractInput;
      copyContract = compiledAttempt.copyContract;
      attempts.push({
        todayAction: narrativePlan.todayAction,
        detailAction: narrativePlan.detailAction,
        riskFlags: copyContract.riskFlags.slice(),
      });
      break;
    }
    let contentPlan = buildXiaodaContentPlanV1(outfit, {
      sceneIntent: outfit.sceneIntent,
      primaryBenefit: outfit.primaryBenefit,
      secondaryBenefit: outfit.secondaryBenefit,
      observationFocus: outfit.observationFocus,
      canonicalCopy: copyContract,
    });
    const presentationPlan = readPresentationPlan(outfit);
    if (presentationPlan) {
      const semanticPresentation = {
        ...outfit,
        copyContract,
        contentPlan,
      };
      applyPresentationPlan(semanticPresentation, presentationPlan.factModel, presentationPlan);
      copyContract = semanticPresentation.copyContract;
      contentPlan = semanticPresentation.contentPlan;
    }
    plans.push({
      outfit,
      facts,
      copyFacts,
      supportedCopyInsights,
      narrativePlan,
      contractInput,
      copyContract,
      contentPlan,
      presentationPlan,
      batchConstraints,
      batchIndex: index,
      copyPlanAttempts: attempts,
    });
    if (copyContract.riskFlags.length === 0) {
      batchConstraints = appendAcceptedContractSelection(batchConstraints, copyContract);
    }
  }
  return plans;
}

function compilePlannedContract({
  copyFacts,
  supportedCopyInsights,
  scene,
  weather,
  narrativePlan,
  eligibilityReason,
  batchConstraints,
  contractSeed,
  batchIndex,
}) {
  const structuralInput = buildRecommendationCopyInput({
    facts: copyFacts,
    insights: supportedCopyInsights,
    scene,
    weather,
    narrativePlan,
    batchConstraints,
    seed: contractSeed,
    diagnostics: { batchIndex },
  });
  const contractInput = structuralInput
    ? { ...structuralInput, narrativePlan: structuralInput.plan, eligibilityReason }
    : { facts: {}, insights: [], scene, weather, narrativePlan, eligibilityReason, batchConstraints, seed: contractSeed };
  return {
    contractInput,
    copyContract: buildRecommendationCopyContract(contractInput),
  };
}

function appendAcceptedContractSelection(constraints, canonical) {
  const withToday = appendBatchCopySelection(constraints, {
    claimId: canonical.todayClaimId,
  });
  return appendBatchCopySelection(withToday, {
    claimId: canonical.detailClaimId,
  });
}

function mergePlannerBatchContext(input, constraints) {
  const source = isPlainObject(input) ? input : {};
  return {
    ...source,
    usedClaimIds: uniqueStrings([
      ...(Array.isArray(source.usedClaimIds) ? source.usedClaimIds : []),
      ...constraints.usedClaimIds,
    ]),
    blockedClaimKeys: uniqueStrings(source.blockedClaimKeys),
  };
}

function normalizeSceneGroundingForContract(facts, insights, scene) {
  const canonicalScene = normalizeContractScene(scene || facts.scene?.raw || facts.scene?.normalized);
  if (!canonicalScene) return;
  facts.allowedFacts = uniqueStrings((facts.allowedFacts || []).map((fact) => (
    fact.startsWith('scene:') ? `scene:${canonicalScene}` : fact
  )));
  for (const insightEntry of insights) {
    if (!Array.isArray(insightEntry.requiredFacts)) continue;
    insightEntry.requiredFacts = uniqueStrings(insightEntry.requiredFacts.map((fact) => (
      fact.startsWith('scene:') ? `scene:${canonicalScene}` : fact
    )));
  }
}

function normalizeContractScene(value) {
  const scene = readString(value).toLowerCase();
  if (['home', '居家', '家庭'].includes(scene)) return 'home';
  if (['work', 'office', '工作', '上班', '通勤'].includes(scene)) return 'work';
  if (['date', '约会'].includes(scene)) return 'date';
  if (['sport', 'sports', '运动'].includes(scene)) return 'sport';
  if (['outing', '出行', '出门', '休闲'].includes(scene)) return 'outing';
  return '';
}

function collectExplicitContractFacts(outfit = {}) {
  const sources = [
    outfit,
    outfit.wearabilityFacts,
    outfit.sceneEligibilityFacts,
    outfit.eligibility?.weather,
    outfit.eligibility?.scene,
  ];
  const facts = [];
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    facts.push(...readStringArray(source.contractFacts));
    facts.push(...readStringArray(source.availableFacts));
  }
  const acceptReasons = readStringArray(outfit.eligibility?.scene?.acceptReasons);
  if (acceptReasons.includes('WORK_POLISHED_SIGNAL')) facts.push('formality');
  if (acceptReasons.includes('SPORT_APPAREL')) facts.push('movement');
  return uniqueStrings(facts);
}

function readStringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];
}

function buildStableContractSeed(entry, outfit, index) {
  const identity = outfit.id
    || outfit._id
    || outfit.outfitKey
    || (Array.isArray(outfit.clothingIds) ? outfit.clothingIds.join('|') : '')
    || `batch-index:${index}`;
  return stableSerialize({
    requestSeed: entry.seed ?? '',
    batchContext: entry.batchContext ?? '',
    outfitIdentity: identity,
  });
}

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
}

function renderRecommendationCopyV3(plan) {
  const canonical = readCanonicalContract(plan);
  return {
    reasonVersion: RECOMMENDATION_REASON_VERSION_V3,
    reason: canonical.todayReason,
    reasoning: canonical.detailExplanation,
    aiComment: {
      overallComment: canonical.detailExplanation,
      advice: '',
    },
  };
}

function renderTodayReasonV3(plan) {
  return readCanonicalContract(plan).todayReason;
}

function renderDetailReasoningV3(plan) {
  return readCanonicalContract(plan).detailExplanation;
}

function renderStylistFallbackCopyV3(plan) {
  const canonical = readCanonicalContract(plan);
  return {
    overallComment: canonical.detailExplanation,
    advice: '',
  };
}

function readCanonicalContract(plan) {
  const canonical = plan?.copyContract;
  if (!canonical || typeof canonical !== 'object' || Array.isArray(canonical)) {
    return { todayReason: '', detailExplanation: '' };
  }
  return {
    todayReason: typeof canonical.todayReason === 'string' ? canonical.todayReason : '',
    detailExplanation: typeof canonical.detailExplanation === 'string' ? canonical.detailExplanation : '',
  };
}

function deriveDisplayTagsV3(facts = {}) {
  const tags = [scenePrimaryTag(facts.context?.scene)];
  const items = Array.isArray(facts.items) ? facts.items : [];
  const styleCounts = new Map();
  for (const item of items) {
    for (const tag of uniqueStrings(item.styleTags)) {
      styleCounts.set(tag, (styleCounts.get(tag) || 0) + 1);
    }
  }
  const supportedStyles = [...styleCounts.entries()]
    .filter(([tag, count]) => STYLE_ALLOWLIST.includes(tag) && count >= 2)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([tag]) => tag);
  tags.push(...supportedStyles);

  const patterned = items.filter((item) => PATTERN_TAGS[String(item.patternType || '').toLowerCase()]);
  const hasPatternRelation = patterned.length === 1
    && items.some((item) => item.id !== patterned[0]?.id && isSimplePattern(item.patternType));
  if (hasPatternRelation) tags.push(PATTERN_TAGS[String(patterned[0]?.patternType || '').toLowerCase()]);

  const top = findSlot(items, 'top');
  const bottom = findSlot(items, 'bottom') || findSlot(items, 'skirt');
  const fitTag = top && bottom
    && FIT_TAGS[String(top.fit || top.silhouette || '').toLowerCase()]
    && FIT_TAGS[String(top.fit || top.silhouette || '').toLowerCase()]
      === FIT_TAGS[String(bottom.fit || bottom.silhouette || '').toLowerCase()]
    ? FIT_TAGS[String(top.fit || top.silhouette || '').toLowerCase()]
    : '';
  if (fitTag) tags.push(fitTag);

  return uniqueStrings(tags).filter(Boolean).slice(0, 3);
}

function scenePrimaryTag(scene) {
  const normalized = readString(scene);
  if (normalized === '居家') return '居家';
  if (normalized === '上班') return '通勤';
  if (normalized === '约会') return '约会';
  if (normalized === '运动') return '运动';
  return '';
}

function addPatternInsights(insights, items) {
  const patterned = items.filter((item) => isPatterned(item.patternType));
  if (patterned.length >= 2) {
    insights.push(insight('PATTERN_COMPETITION', 'pattern', 2, patterned.map((item) => item.slot), { patternedItems: patterned.map(toFactRef) }));
    return;
  }
  if (patterned.length === 1) {
    const patternItem = patterned[0];
    const solidItems = items.filter((item) => item.id !== patternItem.id && isSimplePattern(item.patternType));
    if (solidItems.length > 0) {
      insights.push(insight('PATTERN_FOCUS_WITH_SIMPLE_BOTTOM', 'pattern', 3, [patternItem.slot, ...solidItems.map((item) => item.slot)], {
        patternItem: toFactRef(patternItem),
        supportItems: solidItems.map(toFactRef),
      }));
    }
    insights.push(insight('PATTERN_SINGLE_FOCUS', 'pattern', 2, [patternItem.slot], { patternItem: toFactRef(patternItem) }));
  }
}

function addColorInsights(insights, items) {
  const colors = uniqueStrings(items.flatMap((item) => item.colors));
  if (colors.length === 0) return;
  const lightCount = colors.filter(isLightColor).length;
  const neutralCount = colors.filter(isNeutralColor).length;
  const accentColors = colors.filter((color) => !isNeutralColor(color));
  if (colors.length >= 3 && accentColors.length >= 3) {
    insights.push(insight('COLOR_TOO_MANY_COMPETING_ACCENTS', 'color', 1, items.map((item) => item.slot), { colors }));
  }
  if (colors.length >= 2 && lightCount === colors.length) {
    insights.push(insight('COLOR_SOFT_HARMONY', 'color', 3, items.map((item) => item.slot), { colors }));
  }
  if (neutralCount >= 2 && lightCount >= 1) {
    insights.push(insight('COLOR_LIGHT_NEUTRAL_BALANCE', 'color', 3, items.map((item) => item.slot), { colors }));
  }
  if (neutralCount >= 1 && accentColors.length === 1) {
    insights.push(insight('COLOR_NEUTRAL_BALANCES_ACCENT', 'color', 3, items.map((item) => item.slot), { colors, accentColor: accentColors[0] }));
  }
  if (colors.some(isDarkColor) && colors.some(isLightColor)) {
    insights.push(insight('COLOR_CLEAR_LIGHT_DARK_CONTRAST', 'color', 2, items.map((item) => item.slot), { colors }));
  }
  if (accentColors.length === 1) {
    insights.push(insight('COLOR_SINGLE_ACCENT', 'color', 2, items.map((item) => item.slot), { colors, accentColor: accentColors[0] }));
  }
}

function addSilhouetteInsights(insights, items) {
  const top = findSlot(items, 'top') || findSlot(items, 'outerwear');
  const bottom = findSlot(items, 'bottom') || findSlot(items, 'skirt');
  if (!top || !bottom) return;
  if (isRelaxed(top.fit || top.silhouette) && isClean(bottom.fit || bottom.silhouette)) {
    insights.push(insight('SILHOUETTE_TOP_RELAXED_BOTTOM_CLEAN', 'silhouette', 3, [top.slot, bottom.slot], { top: toFactRef(top), bottom: toFactRef(bottom) }));
  }
  if (isRelaxed(top.fit || top.silhouette) && isRelaxed(bottom.fit || bottom.silhouette)) {
    insights.push(insight('SILHOUETTE_RELAXED_BALANCE', 'silhouette', 2, [top.slot, bottom.slot], { top: toFactRef(top), bottom: toFactRef(bottom) }));
  }
  if (isClean(top.fit || top.silhouette) && isClean(bottom.fit || bottom.silhouette)) {
    insights.push(insight('SILHOUETTE_UNIFIED', 'silhouette', 2, [top.slot, bottom.slot], { top: toFactRef(top), bottom: toFactRef(bottom) }));
  }
  if (isShort(top.length) && isLong(bottom.length)) {
    insights.push(insight('PROPORTION_SHORT_TOP_LONG_BOTTOM', 'proportion', 3, [top.slot, bottom.slot], { top: toFactRef(top), bottom: toFactRef(bottom) }));
  } else if (top.length && bottom.length) {
    insights.push(insight('PROPORTION_LAYERED_BALANCE', 'proportion', 2, [top.slot, bottom.slot], { top: toFactRef(top), bottom: toFactRef(bottom) }));
  }
}

function addFormalityInsights(insights, items) {
  const levels = items.map((item) => item.formalityLevel).filter(Number.isFinite);
  if (levels.length < 2) return;
  const max = Math.max(...levels);
  const min = Math.min(...levels);
  if (max - min <= 1) insights.push(insight('FORMALITY_ALIGNED', 'formality', 3, items.map((item) => item.slot), { levels }));
  if (max <= 2) insights.push(insight('FORMALITY_CASUAL_BALANCE', 'formality', 2, items.map((item) => item.slot), { levels }));
  if (max >= 3 && min <= 1) insights.push(insight('FORMALITY_SOFTENED_BY_CASUAL_ITEM', 'formality', 3, items.map((item) => item.slot), { levels }));
  if (max - min >= 3) insights.push(insight('FORMALITY_CONFLICT', 'formality', 2, items.map((item) => item.slot), { levels }));
}

function addDetailInsights(insights, items) {
  const detailed = items.filter((item) => item.designElements.length > 0);
  if (detailed.length === 1) insights.push(insight('DETAIL_SINGLE_FOCUS', 'detail', 2, [detailed[0].slot], { item: toFactRef(detailed[0]), details: detailed[0].designElements }));
  if (detailed.length === 2) insights.push(insight('DETAIL_BALANCED', 'detail', 1, detailed.map((item) => item.slot), { items: detailed.map(toFactRef) }));
  if (detailed.length > 2) insights.push(insight('DETAIL_COMPETITION', 'detail', 1, detailed.map((item) => item.slot), { items: detailed.map(toFactRef) }));
}

function addStyleInsights(insights, items) {
  const tags = uniqueStrings(items.flatMap((item) => item.styleTags));
  const casualCount = tags.filter((tag) => ['休闲', '运动'].includes(tag)).length;
  for (const tag of tags) {
    const count = items.filter((item) => item.styleTags.includes(tag)).length;
    if (count >= 2) insights.push(insight('STYLE_COHERENT', 'style', 2, items.filter((item) => item.styleTags.includes(tag)).map((item) => item.slot), { style: tag }));
  }
  if (casualCount > 0 || items.some((item) => /T恤|卫衣|牛仔|短裤|运动鞋/.test(item.name))) {
    insights.push(insight('STYLE_CASUAL_EASY', 'style', 2, items.map((item) => item.slot), { styles: tags }));
  }
}

function addSceneInsights(insights, facts, items) {
  const scene = facts.context?.scene;
  if (scene === '居家') insights.push(insight('SCENE_HOME_EASY', 'scene', 1, items.map((item) => item.slot), { scene }));
  if (scene === '上班') insights.push(insight('SCENE_WORK_CLEAN', 'scene', 1, items.map((item) => item.slot), { scene }));
  if (scene === '约会') insights.push(insight('SCENE_DATE_SOFT', 'scene', 1, items.map((item) => item.slot), { scene }));
  if (scene === '运动') insights.push(insight('SCENE_SPORT_ACTIVE', 'scene', 1, items.map((item) => item.slot), { scene }));
}

function addWeatherInsights(insights, facts, items) {
  const band = facts.context?.temperatureBand;
  if (!band) return;
  const weatherItems = items.filter((item) => item.thickness || item.material);
  if (band === 'mild') insights.push(insight('WEATHER_MILD_COMFORT', 'weather', weatherItems.length ? 2 : 1, weatherItems.map((item) => item.slot), { band }));
  if (weatherItems.length >= 2) insights.push(insight('WEATHER_THICKNESS_MATCH', 'weather', 1, weatherItems.map((item) => item.slot), { band }));
  if (['cool', 'cold'].includes(band) && weatherItems.length > 0) insights.push(insight('WEATHER_LAYERING_MATCH', 'weather', 1, weatherItems.map((item) => item.slot), { band }));
}

function insight(code, dimension, strength, subjectSlots, facts) {
  return {
    code,
    dimension,
    strength: Math.max(1, Math.min(3, Math.round(Number(strength) || 1))),
    polarity: code.includes('CONFLICT') || code.includes('COMPETITION') ? 'negative' : 'positive',
    subjectSlots: uniqueStrings(subjectSlots).sort(compareCategory),
    facts: facts || {},
  };
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item, index) => normalizeItem(item, index))
    .filter(Boolean)
    .sort((a, b) => {
      const categoryDiff = compareCategory(a.slot, b.slot);
      if (categoryDiff !== 0) return categoryDiff;
      return a.id.localeCompare(b.id);
    });
}

function normalizeItem(source, index) {
  if (!source || typeof source !== 'object') return null;
  const features = source.aestheticFeatures && typeof source.aestheticFeatures === 'object' ? source.aestheticFeatures : {};
  const confidence = normalizeConfidence(source.confidence ?? source.aiConfidence ?? source.recognitionConfidence);
  const advancedReliable = confidence === null || confidence >= 0.55;
  const slot = normalizeCategory(source.category || source.type);
  const colors = readColors(source);
  const patternType = advancedReliable ? normalizeKnown(features.patternType || source.patternType) : '';
  const fit = advancedReliable ? normalizeKnown(features.fit || source.fit) : '';
  const length = advancedReliable ? normalizeKnown(features.length || source.length) : '';
  const silhouette = advancedReliable ? normalizeKnown(features.silhouette || source.silhouette) : '';
  return {
    id: readString(source.clothingId || source.itemId || source.id || source._id) || `item-${index}`,
    slot,
    category: slot,
    subcategory: readString(source.subcategory || source.subCategory || source.type || source.name),
    name: readString(source.subcategory || source.subCategory || source.name || source.type || source.category) || defaultItemName(slot),
    colors,
    primaryColor: colors[0] || '',
    fit,
    length,
    silhouette,
    patternType,
    designElements: advancedReliable ? uniqueStrings([...(toArray(features.designElements)), ...(toArray(source.designElements))]).sort() : [],
    formalityLevel: advancedReliable ? normalizeFiniteNumber(features.formalityLevel ?? source.formalityLevel) : null,
    styleTags: uniqueStrings(toArray(source.styleTags || source.style)).filter((tag) => STYLE_ALLOWLIST.includes(tag) || ['印花'].includes(tag)).sort(),
    material: advancedReliable ? normalizeKnown(source.material || source.materialGuess) : '',
    thickness: advancedReliable ? normalizeKnown(source.thickness) : '',
    confidence,
  };
}

function readItems(source) {
  return source.items || source.itemsSnapshot || source.snapshotItems || [];
}

function readColors(source) {
  const colors = [];
  const palette = Array.isArray(source.colorPalette) ? source.colorPalette : [];
  for (const entry of palette) {
    const color = typeof entry === 'string' ? entry : readString(entry?.name || entry?.color);
    if (isKnown(color)) colors.push(color);
  }
  const fallback = readString(source.color);
  if (isKnown(fallback)) colors.push(fallback);
  return uniqueStrings(colors).sort();
}

function sanitizeScores(scores = {}) {
  return {
    weatherAdaptation: normalizeFiniteNumber(scores.weatherAdaptation),
    styleUnity: normalizeFiniteNumber(scores.styleUnity),
    freshness: normalizeFiniteNumber(scores.freshness),
    preference: normalizeFiniteNumber(scores.preference),
  };
}

function sanitizeAesthetic(value = {}) {
  return {
    score: value.score === null ? null : normalizeFiniteNumber(value.score),
    coverage: normalizeFiniteNumber(value.coverage) ?? 0,
    evidence: Array.isArray(value.evidence)
      ? value.evidence.map((entry) => ({
          code: readString(entry?.code),
          dimension: readString(entry?.dimension),
          polarity: readString(entry?.polarity),
          strength: Math.max(1, Math.min(3, Math.round(Number(entry?.strength) || 1))),
        })).filter((entry) => entry.code)
      : [],
  };
}

function compareInsights(a, b) {
  const priorityDiff = (DIMENSION_PRIORITY[a.dimension] ?? 99) - (DIMENSION_PRIORITY[b.dimension] ?? 99);
  if (priorityDiff !== 0) return priorityDiff;
  const strengthDiff = b.strength - a.strength;
  if (strengthDiff !== 0) return strengthDiff;
  return a.code.localeCompare(b.code);
}

function uniqueInsights(values) {
  const result = [];
  const seen = new Set();
  for (const value of values) {
    if (!value || !value.code || seen.has(value.code)) continue;
    seen.add(value.code);
    result.push(value);
  }
  return result;
}

function findSlot(items, slot) {
  return (items || []).find((item) => item.slot === slot);
}

function toFactRef(item) {
  return item ? {
    slot: item.slot,
    name: item.name,
    colors: item.colors,
    patternType: item.patternType,
  } : {};
}

function defaultItemName(slot) {
  return {
    top: '上衣',
    bottom: '下装',
    skirt: '半裙',
    onepiece: '连衣裙',
    outerwear: '外套',
    shoes: '鞋子',
    accessory: '配饰',
  }[slot] || '单品';
}

function normalizeCategory(value) {
  const raw = readString(value).toLowerCase();
  if (CATEGORY_ORDER.includes(raw)) return raw;
  if (/top|shirt|tee|上衣|衬衫|T恤|卫衣|针织/.test(raw)) return 'top';
  if (/bottom|pants|trouser|jeans|下装|裤/.test(raw)) return 'bottom';
  if (/skirt|裙/.test(raw)) return 'skirt';
  if (/shoe|sneaker|鞋/.test(raw)) return 'shoes';
  if (/outer|coat|jacket|外套|西装/.test(raw)) return 'outerwear';
  return 'other';
}

function compareCategory(a, b) {
  return (CATEGORY_ORDER.indexOf(a) === -1 ? 99 : CATEGORY_ORDER.indexOf(a))
    - (CATEGORY_ORDER.indexOf(b) === -1 ? 99 : CATEGORY_ORDER.indexOf(b));
}

function normalizeScene(value) {
  const raw = readString(value);
  return SCENE_LABELS[raw.toLowerCase()] || raw;
}

function getTemperatureBand(weather) {
  const temp = normalizeFiniteNumber(weather?.temp ?? weather?.temperature);
  if (temp === null) return '';
  if (temp < 12) return 'cold';
  if (temp < 22) return 'cool';
  if (temp <= 28) return 'mild';
  return 'hot';
}

function getConditionBucket(weather) {
  const text = readString(weather?.conditionBucket || weather?.weather || weather?.condition).toLowerCase();
  if (/雨|rain/.test(text)) return 'rain';
  if (/雪|snow/.test(text)) return 'snow';
  if (/晴|sun|clear/.test(text)) return 'clear';
  if (/云|阴|cloud|overcast/.test(text)) return 'cloudy';
  return text ? 'other' : '';
}

function classifyColorFamily(color) {
  if (isLightColor(color)) return 'light';
  if (isDarkColor(color)) return 'dark';
  if (isNeutralColor(color)) return 'neutral';
  return 'accent';
}

function isLightColor(color) {
  return /白|米|浅|灰白|奶|杏|粉|cream|white|light|pink/i.test(color || '');
}

function isDarkColor(color) {
  return /黑|深|藏青|navy|black|dark/i.test(color || '');
}

function isNeutralColor(color) {
  return /黑|白|灰|米|卡其|棕|牛仔|beige|gray|grey|black|white|khaki|brown/i.test(color || '');
}

function isPatterned(value) {
  const text = readString(value).toLowerCase();
  return Boolean(text && !isSimplePattern(text));
}

function isSimplePattern(value) {
  const text = readString(value).toLowerCase();
  return !text || ['solid', 'plain', 'none', '纯色', '无'].includes(text);
}

function isRelaxed(value) {
  return /relaxed|loose|oversized|宽松/.test(readString(value).toLowerCase());
}

function isClean(value) {
  return /straight|clean|slim|regular|利落|直筒|修身/.test(readString(value).toLowerCase());
}

function isShort(value) {
  return /short|短/.test(readString(value).toLowerCase());
}

function isLong(value) {
  return /long|长/.test(readString(value).toLowerCase());
}

function normalizeKnown(value) {
  const text = readString(value);
  return isKnown(text) ? text : '';
}

function isKnown(value) {
  const text = readString(value).toLowerCase();
  return Boolean(text && !['unknown', 'null', 'undefined', 'none', '其他', '未知'].includes(text));
}

function normalizeConfidence(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value === 'high') return 0.9;
  if (value === 'medium') return 0.7;
  if (value === 'low') return 0.3;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return number > 1 ? number / 100 : number;
}

function normalizeFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(/[,/，、\s]+/);
  return [];
}

function recordMetric(instrumentation, name) {
  if (!instrumentation || typeof instrumentation !== 'object') return;
  const counters = instrumentation.counters && typeof instrumentation.counters === 'object'
    ? instrumentation.counters
    : instrumentation;
  counters[name] = (Number(counters[name]) || 0) + 1;
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

function stripNonFinite(value) {
  if (Array.isArray(value)) return value.map(stripNonFinite);
  if (!value || typeof value !== 'object') {
    return typeof value === 'number' && !Number.isFinite(value) ? null : value;
  }
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    const clean = stripNonFinite(entry);
    if (clean !== undefined) result[key] = clean;
  }
  return result;
}

module.exports = {
  RECOMMENDATION_REASON_VERSION_V3,
  XIAODA_CONTENT_PLAN_VERSION,
  compileRecommendationLanguageV3,
  deriveDisplayTagsV3,
  deriveOutfitInsightsV3,
  extractOutfitFactsV3,
  planBatchCopyV3,
  renderDetailReasoningV3,
  renderRecommendationCopyV3,
  renderStylistFallbackCopyV3,
  renderTodayReasonV3,
};
