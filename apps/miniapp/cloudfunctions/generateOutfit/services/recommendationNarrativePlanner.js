const {
  CLAIM_CATALOG,
  sourceMeetsMinimum,
} = require('./xiaodaVoiceBankV2');
const {
  factCanInformEligibility,
  factEvidenceLevel,
} = require('./recommendationFactAuthorization');
const {
  cloneEligibilityReason,
  validateEligibilityReason,
} = require('./recommendationEligibilityReason');

const SPEECH_ACTIONS = Object.freeze([...new Set(CLAIM_CATALOG.map((entry) => entry.action))]);
const ALLOWED_ACTION_PAIRS = Object.freeze(Object.fromEntries(SPEECH_ACTIONS.map((action) => [
  action,
  Object.freeze(SPEECH_ACTIONS.filter((candidate) => candidate !== action)),
])));

const MAJOR_SLOTS = new Set(['top', 'bottom', 'outerwear', 'onepiece']);
const HOME_CONFLICT_FACTS = new Set(['tight_fit', 'restrictive', 'stiff', 'heavy', 'home_conflict']);
const DATE_CONFLICT_FACTS = new Set(['color_conflict', 'pattern_conflict', 'style_conflict']);
const SPORT_CONFLICT_FACTS = new Set(['tight_fit', 'restrictive', 'stiff', 'heavy']);

function planRecommendationNarrative(input = {}) {
  const source = asObject(input);
  const facts = asObject(source.facts);
  const scene = normalizeScene(source.scene || facts.scene?.normalized || facts.scene?.raw);
  const weather = readWeather(source.weather, facts.weather);
  const itemFactsById = normalizeItemFactsById(facts);
  const relationFacts = normalizeRelationFacts(facts.relationFacts);
  const explicitEligibilityReason = asObject(source.eligibilityReason);
  const selectedOutfitItemIds = uniqueStrings(asArray(facts.items)
    .map((item) => item?.id || item?.clothingId || item?.itemId));
  const eligibilityReason = validateEligibilityReason(explicitEligibilityReason, {
    scene,
    weather,
    selectedOutfitItemIds,
  })
    ? cloneEligibilityReason(explicitEligibilityReason)
    : null;
  const eligibleClaims = CLAIM_CATALOG
    .filter((entry) => entry.scene === scene)
    .filter((entry) => weatherMatches(entry.weatherCondition, weather))
    .map((entry) => resolveClaim(entry, itemFactsById, relationFacts))
    .filter(Boolean);
  const qualification = eligibilityReason
    ? { qualified: true, reasons: [] }
    : source.eligibilityEvaluated === true || Object.keys(explicitEligibilityReason).length > 0
      ? { qualified: false, reasons: ['CORE_REASON_COVERAGE_GAP'] }
      : qualifyScene(scene, eligibleClaims, itemFactsById, weather);
  const batchContext = asObject(source.batchContext);
  const usedClaimIds = new Set(uniqueStrings(batchContext.usedClaimIds));

  const ranked = eligibleClaims.slice().sort((left, right) =>
    compareClaims(left, right, usedClaimIds));
  const todayClaim = qualification.qualified
    ? ranked.find(isQualificationCoreClaim) || null
    : null;
  const detailClaim = qualification.qualified
    ? ranked.find((claim) => !isQualificationCoreClaim(claim)
      && (!todayClaim || isIndependentDetailClaim(todayClaim, claim))) || null
    : null;

  return {
    plannerVersion: 'recommendation-narrative-planner-fixed-claims-v1',
    scene,
    sceneTone: scene,
    qualification,
    eligibilityReason,
    eligibleClaims,
    todayClaim,
    todayAction: todayClaim?.action || null,
    todayDimension: todayClaim?.dimension || null,
    todayEvidenceIds: todayClaim?.evidenceFactIds.slice() || [],
    detailClaim,
    detailAction: detailClaim?.action || null,
    detailDimension: detailClaim?.dimension || null,
    detailEvidenceIds: detailClaim?.evidenceFactIds.slice() || [],
    unsupportedClaims: collectWeakFacts(itemFactsById),
  };
}

function isQualificationCoreClaim(claim) {
  if (!claim || claim.detailOnly) return false;
  return (claim.scene === 'home' && ['H01', 'H03'].includes(claim.group))
    || (claim.scene === 'work' && claim.group === 'W01')
    || (claim.scene === 'date' && claim.group === 'D01')
    || (claim.scene === 'sport' && claim.group === 'S01');
}

function resolveClaim(definition, itemFactsById, relationFacts) {
  const subjectItemIds = [];
  const requiredFactIds = [];
  const evidenceSources = [];
  const slotBindings = {};

  for (const requirement of definition.requirements) {
    const matches = resolveRequirement(requirement, itemFactsById, relationFacts);
    if (!matches) return null;
    const itemIds = uniqueStrings(matches.flatMap((match) => match.subjectItemIds || [match.itemId]));
    if (itemIds.length === 0) return null;
    if (requirement.slot !== 'outfit') slotBindings[requirement.slot] = itemIds[0];
    subjectItemIds.push(...itemIds);
    for (const match of matches) {
      requiredFactIds.push(match.record.factId);
      evidenceSources.push({
        ...match.record,
        factId: match.record.factId,
        ...(match.itemId ? { itemId: match.itemId } : {}),
      });
    }
  }

  const evidenceFactIds = uniqueStrings(requiredFactIds);
  return {
    claimId: definition.claimId,
    scene: definition.scene,
    group: definition.group,
    action: definition.action,
    dimension: definition.dimension,
    subjectItemIds: uniqueStrings(subjectItemIds),
    requiredFactIds: evidenceFactIds.slice(),
    evidenceFactIds: evidenceFactIds.slice(),
    evidenceSources: dedupeEvidenceSources(evidenceSources),
    slotBindings,
    userValue: definition.userValue,
    priority: definition.priority,
    detailOnly: definition.detailOnly,
    weatherCondition: definition.weatherCondition,
    text: definition.text,
    sentence: {
      text: definition.text,
      requiredFactIds: evidenceFactIds.slice(),
    },
  };
}

function resolveRequirement(requirement, itemFactsById, relationFacts) {
  if (requirement.slot === 'outfit') return matchRelationRequirement(requirement, relationFacts);
  const candidates = itemsForRequirement(requirement.slot, itemFactsById);
  if (requirement.slot === 'main') {
    if (candidates.length === 0) return null;
    const allMatches = candidates
      .map((item) => matchItemRequirement(item, requirement))
      .filter(Boolean);
    return allMatches.length === candidates.length ? allMatches.flat() : null;
  }
  for (const item of candidates) {
    const matches = matchItemRequirement(item, requirement);
    if (matches) return matches;
  }
  return null;
}

function matchItemRequirement(item, requirement) {
  const matches = [];
  for (const fact of requirement.allOf) {
    const record = bestFactRecord(
      item,
      fact,
      minimumEvidenceLevelForFact(requirement, fact),
    );
    if (!record) return null;
    matches.push({ itemId: item.id, record });
  }
  if (requirement.anyOf.length > 0) {
    let selected = null;
    for (const fact of requirement.anyOf) {
      const record = bestFactRecord(
        item,
        fact,
        minimumEvidenceLevelForFact(requirement, fact),
      );
      if (record && (!selected || compareFactRecords(record, selected) < 0)) selected = record;
    }
    if (!selected) return null;
    matches.push({ itemId: item.id, record: selected });
  }
  return matches;
}

function minimumEvidenceLevelForFact(requirement, fact) {
  return requirement.minimumEvidenceByFact?.[fact] || requirement.minimumEvidenceLevel;
}

function matchRelationRequirement(requirement, relationFacts) {
  const matches = [];
  for (const fact of requirement.allOf) {
    const record = relationFacts.find((entry) => entry.fact === fact && relationMeetsMinimum(entry, requirement.minimumEvidenceLevel));
    if (!record) return null;
    matches.push({ subjectItemIds: record.subjectItemIds, record });
  }
  if (requirement.anyOf.length > 0) {
    const record = requirement.anyOf
      .map((fact) => relationFacts.find((entry) => entry.fact === fact && relationMeetsMinimum(entry, requirement.minimumEvidenceLevel)))
      .filter(Boolean)
      .sort((left, right) => right.confidence - left.confidence)[0];
    if (!record) return null;
    matches.push({ subjectItemIds: record.subjectItemIds, record });
  }
  return matches;
}

function relationMeetsMinimum(record, minimumLevel) {
  if (!record.authorized || !record.subjectItemIds.length || !record.supportingFactIds.length) return false;
  if (record.fact === 'work_eligible') return minimumLevel === 'A'
    && ['sceneEligibilityV3', 'sceneEvidenceV4'].includes(record.sourceRule);
  if (record.fact === 'color_coordinated') return record.relationRule === 'same_normalized_color_group'
    && record.confidence >= 0.8;
  return false;
}

function bestFactRecord(item, fact, minimumLevel) {
  return item.factRecords
    .filter((record) => record.fact === fact)
    .filter((record) => sourceMeetsMinimum(record, minimumLevel))
    .slice()
    .sort(compareFactRecords)[0] || null;
}

function compareFactRecords(left, right) {
  const levelScore = { A: 2, B: 1, C: 0 };
  const sourceDifference = (levelScore[factEvidenceLevel(right)] || 0)
    - (levelScore[factEvidenceLevel(left)] || 0);
  return sourceDifference || right.confidence - left.confidence || left.factId.localeCompare(right.factId);
}

function itemsForRequirement(slot, itemFactsById) {
  const values = Object.values(itemFactsById);
  if (slot === 'main') return values.filter((item) => MAJOR_SLOTS.has(item.category));
  return values.filter((item) => item.category === slot);
}

function qualifyScene(scene, eligibleClaims, itemFactsById, weather) {
  const groups = new Set(eligibleClaims.filter((claim) => !claim.detailOnly).map((claim) => claim.group));
  const values = Object.values(itemFactsById);
  const majorItems = values.filter((item) => MAJOR_SLOTS.has(item.category));
  const shoes = values.filter((item) => item.category === 'shoes');
  const reasons = [];

  if (scene === 'home') {
    if (!groups.has('H01') && !groups.has('H03')) reasons.push('HOME_CORE_CLAIM_MISSING');
    if (majorItems.some((item) => hasAnyStrongFact(item, HOME_CONFLICT_FACTS))) reasons.push('HOME_RESTRICTIVE_ITEM');
  } else if (scene === 'work') {
    if (!groups.has('W01')) reasons.push('WORK_W01_MISSING');
    if (shoes.some((item) => hasStrongFact(item, 'home_shoe'))) reasons.push('WORK_SHOE_CONFLICT');
    if (majorItems.some((item) => hasStrongFact(item, 'home_conflict'))) reasons.push('WORK_HOMEWEAR_CONFLICT');
  } else if (scene === 'date') {
    if (!groups.has('D01')) reasons.push('DATE_D01_MISSING');
    if (shoes.length === 0 || !shoes.some((item) => hasStrongFact(item, 'outing_shoe'))) reasons.push('DATE_SHOE_MISSING');
    if (majorItems.some((item) => hasAnyStrongFact(item, DATE_CONFLICT_FACTS))) reasons.push('DATE_COORDINATION_CONFLICT');
  } else if (scene === 'sport') {
    if (!groups.has('S01')) reasons.push('SPORT_S01_MISSING');
    if (shoes.length === 0 || !shoes.some((item) => hasStrongFact(item, 'sport_shoe'))) reasons.push('SPORT_SHOE_MISSING');
    if (majorItems.some((item) => hasAnyStrongFact(item, SPORT_CONFLICT_FACTS))) reasons.push('SPORT_MOVEMENT_CONFLICT');
  } else {
    reasons.push('UNSUPPORTED_SCENE');
  }

  if (weather.band === 'hot' && majorItems.some((item) => hasStrongFact(item, 'heavy'))) {
    reasons.push('WEATHER_THICKNESS_CONFLICT');
  }
  return { qualified: reasons.length === 0, reasons };
}

function hasAnyStrongFact(item, facts) {
  return [...facts].some((fact) => hasStrongFact(item, fact));
}

function hasStrongFact(item, fact) {
  return item.factRecords.some((record) => record.fact === fact && factCanInformEligibility(record));
}

function compareClaims(left, right, usedClaimIds) {
  const relevance = right.priority - left.priority;
  if (relevance) return relevance;
  const confidence = averageConfidence(right.evidenceSources) - averageConfidence(left.evidenceSources);
  if (confidence) return confidence;
  const unused = Number(usedClaimIds.has(left.claimId)) - Number(usedClaimIds.has(right.claimId));
  if (unused) return unused;
  return left.claimId.localeCompare(right.claimId);
}

function isIndependentDetailClaim(today, candidate) {
  if (candidate.claimId === today.claimId) return false;
  if (candidate.userValue === today.userValue) return false;
  if (candidate.evidenceFactIds.some((factId) => today.evidenceFactIds.includes(factId))) return false;
  if (today.claimId === 'H02-02' && candidate.group === 'H01') return false;
  return true;
}

function normalizeItemFactsById(facts) {
  const rawScopes = asObject(facts.itemFactsById);
  const items = asArray(facts.items);
  const result = {};
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const id = readString(item.id || item.clothingId || item.itemId);
    if (!id) continue;
    const scope = asObject(rawScopes[id]);
    result[id] = {
      id,
      category: normalizeCategory(item.slot || item.category || scope.category),
      factRecords: normalizeFactRecords(scope.factRecords || item.factRecords, id),
    };
  }
  for (const [id, scopeValue] of Object.entries(rawScopes)) {
    if (result[id]) continue;
    const scope = asObject(scopeValue);
    result[id] = {
      id,
      category: normalizeCategory(scope.category),
      factRecords: normalizeFactRecords(scope.factRecords, id),
    };
  }
  return result;
}

function normalizeFactRecords(value, itemId) {
  return asArray(value).map((entry) => {
    const source = asObject(entry);
    const fact = readString(source.fact || parseFactName(source.factId));
    const confidence = Number(source.confidence);
    if (!fact || !readString(source.source) || !Number.isFinite(confidence)) return null;
    return {
      factId: readString(source.factId) || `item:${itemId}:${fact}`,
      itemId,
      fact,
      value: source.value,
      source: readString(source.source).toLowerCase(),
      confidence,
      authorized: source.authorized !== false,
      ...(readString(source.sourceDetail) ? { sourceDetail: readString(source.sourceDetail) } : {}),
    };
  }).filter(Boolean);
}

function normalizeRelationFacts(value) {
  return asArray(value).map((entry) => {
    const source = asObject(entry);
    const factId = readString(source.relationFactId || source.factId);
    const fact = readString(source.fact || parseRelationFactName(factId));
    const confidence = Number(source.confidence);
    const subjectItemIds = uniqueStrings(source.subjectItemIds);
    const supportingFactIds = uniqueStrings(source.supportingFactIds);
    if (!/^outfit:[^:]+$/.test(factId) || !fact || !Number.isFinite(confidence)
      || subjectItemIds.length === 0 || supportingFactIds.length === 0) return null;
    return {
      ...source,
      relationFactId: factId,
      factId,
      fact,
      subjectItemIds,
      supportingFactIds,
      source: readString(source.source),
      confidence,
      authorized: source.authorized !== false,
      sourceRule: readString(source.sourceRule),
      relationRule: readString(source.relationRule),
    };
  }).filter(Boolean);
}

function collectWeakFacts(itemFactsById) {
  return uniqueStrings(Object.values(itemFactsById).flatMap((item) => item.factRecords
    .filter((record) => factEvidenceLevel(record) === 'C')
    .map((record) => record.fact)));
}

function dedupeEvidenceSources(values) {
  const result = [];
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value.factId)) continue;
    seen.add(value.factId);
    result.push(value);
  }
  return result;
}

function readWeather(primary, fallback) {
  const value = asObject(primary);
  const backup = asObject(fallback);
  const tempValue = value.temp ?? value.temperature ?? backup.temp ?? backup.temperature;
  const mode = readString(
    value.mode
      || value.weatherMode
      || backup.mode
      || backup.weatherMode
      || backup.raw?.mode
      || backup.raw?.weatherMode,
  ).toLowerCase();
  const temperatureAllowed = !mode || ['live', 'cached'].includes(mode);
  const hasTemperature = tempValue !== null && tempValue !== undefined && tempValue !== '';
  const temp = temperatureAllowed && hasTemperature ? Number(tempValue) : Number.NaN;
  const condition = readString(value.condition || value.weather || backup.condition || backup.weather).toLowerCase();
  if (!Number.isFinite(temp)) return { temp: null, condition: '', humid: false, band: 'no_weather' };
  const humid = /humid|muggy|闷热|潮湿/.test(condition);
  let band = 'mild';
  if (Number.isFinite(temp) && temp >= 28) band = 'hot';
  else if (Number.isFinite(temp) && temp <= 10) band = 'cold';
  else if (Number.isFinite(temp) && temp <= 17) band = 'cool';
  return { temp, condition, humid, band };
}

function weatherMatches(condition, weather) {
  if (!condition) return true;
  if (condition === 'humid_hot') return weather.humid && weather.band === 'hot';
  if (condition === 'hot') return weather.band === 'hot' && !weather.humid;
  return weather.band === condition;
}

function averageConfidence(values) {
  if (!values.length) return 0;
  return values.reduce((sum, entry) => sum + Number(entry.confidence || 0), 0) / values.length;
}

function normalizeScene(value) {
  const text = readString(value).toLowerCase();
  return { home: 'home', 居家: 'home', work: 'work', 上班: 'work', 通勤: 'work', date: 'date', 约会: 'date', sport: 'sport', sports: 'sport', 运动: 'sport' }[text] || text;
}

function normalizeCategory(value) {
  const text = readString(value).toLowerCase();
  if (/top|shirt|tee|t恤|上衣|衬衫|卫衣/.test(text)) return 'top';
  if (/onepiece|dress|连衣裙/.test(text)) return 'onepiece';
  if (/bottom|pants|trouser|下装|裤|半身裙/.test(text)) return 'bottom';
  if (/shoe|sneaker|鞋|靴/.test(text)) return 'shoes';
  if (/outer|coat|jacket|外套|夹克|风衣/.test(text)) return 'outerwear';
  return text;
}

function parseFactName(value) {
  const parts = readString(value).split(':');
  return parts.length === 3 && parts[0] === 'item' ? parts[2] : '';
}

function parseRelationFactName(value) {
  const match = /^outfit:([^:]+)$/.exec(readString(value));
  return match ? match[1] : '';
}

function uniqueStrings(values) {
  return [...new Set(asArray(values).map(readString).filter(Boolean))];
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

module.exports = {
  ALLOWED_ACTION_PAIRS,
  SPEECH_ACTIONS,
  planRecommendationNarrative,
};
