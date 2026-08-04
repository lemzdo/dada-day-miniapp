const ELIGIBILITY_REJECTION_AUDIT_VERSION = 'eligibility-rejection-audit-v1';
const MAX_ELIGIBILITY_REJECTION_SAMPLES = 12;
const QA_BYTE_LIMIT = 16 * 1024;
const ROLE_KEYS = Object.freeze(['top', 'bottom', 'shoes']);
const SPORT_FACT_KEYS = Object.freeze([
  'isTshirtLike',
  'isShorts',
  'isSportShoe',
  'isCleanSneaker',
  'isHomeShoe',
  'isSlipperLike',
  'isCrocsLike',
  'isSportDress',
  'isNormalDress',
  'isSkirtLike',
  'sportApparelEvidence',
  'sportCompatibleTop',
  'sportBottomEvidence',
  'invalidSportShoe',
  'hasSportSignal',
  'hasSportVisibleFact',
  'suitableSportShoe',
]);
const SUBTYPE_RULES = Object.freeze({
  top: [
    ['tshirt', (fact) => fact.isTshirtLike],
    ['sport_dress', (fact) => fact.isSportDress],
    ['formal', (fact) => fact.isFormalLike],
    ['warm', (fact) => fact.isWarmTop],
  ],
  bottom: [
    ['shorts', (fact) => fact.isShorts],
    ['long_pants', (fact) => fact.isLongPants],
    ['warm', (fact) => fact.isWarmBottom],
  ],
  shoes: [
    ['sport_shoe', (fact) => fact.isSportShoe],
    ['clean_sneaker', (fact) => fact.isCleanSneaker],
    ['home_shoe', (fact) => fact.isHomeShoe],
    ['slipper', (fact) => fact.isSlipperLike],
    ['crocs', (fact) => fact.isCrocsLike],
    ['boots', (fact) => fact.isBootLike],
  ],
});

function buildEligibilityRejectionAudit({
  enabled = false,
  sceneKey = '',
  generatedCount = 0,
  guardEnteredCount = 0,
  guardAcceptedCount = 0,
  guardRejectedCount = 0,
  guardAcceptedCandidates = [],
  guardRejectedCandidates = [],
  weatherMode = 'disabled',
  weather,
  weatherSnapshot,
} = {}) {
  if (enabled !== true || sceneKey !== 'sport') return undefined;

  const acceptedEntries = normalizeCandidateEntries(guardAcceptedCandidates);
  const rejectedEntries = normalizeRejectedEntries(guardRejectedCandidates);
  const rejectedCandidates = rejectedEntries.map((entry) => entry.candidate);
  const allCandidates = [...acceptedEntries, ...rejectedCandidates];
  const samples = buildSamples(rejectedEntries, weatherMode, weather, weatherSnapshot);
  const audit = {
    version: ELIGIBILITY_REJECTION_AUDIT_VERSION,
    generatedCount: safeCount(generatedCount),
    guardEnteredCount: safeCount(guardEnteredCount),
    guardAcceptedCount: safeCount(guardAcceptedCount),
    guardRejectedCount: safeCount(guardRejectedCount),
    rejectionStageHistogram: buildStageHistogram(rejectedEntries),
    rejectionReasonHistogram: buildReasonHistogram(rejectedEntries),
    rejectionReasonCombinationHistogram: buildCombinationHistogram(rejectedEntries),
    categoryDistribution: buildCategoryDistribution(rejectedCandidates, allCandidates, acceptedEntries),
    samples: samples.values,
    truncated: rejectedEntries.length > samples.values.length,
    serializedBytes: 0,
  };
  setSerializedBytes(audit);
  return audit;
}

function fitEligibilityRejectionAuditToBudget(
  audit,
  byteLimit = QA_BYTE_LIMIT,
  measure = serializedBytes,
  measureAudit = serializedBytes,
) {
  if (!audit || typeof audit !== 'object') return audit;
  const samples = Array.isArray(audit.samples) ? audit.samples : [];
  while (measure(audit) >= byteLimit && samples.length > 0) {
    samples.pop();
    audit.truncated = true;
    setSerializedBytes(audit, measureAudit);
  }
  if (measure(audit) >= byteLimit) audit.truncated = true;
  setSerializedBytes(audit, measureAudit);
  return audit;
}

function normalizeCandidateEntries(candidates) {
  return (Array.isArray(candidates) ? candidates : []).filter((candidate) => candidate && typeof candidate === 'object');
}

function normalizeRejectedEntries(entries) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && typeof entry === 'object' && entry.candidate && typeof entry.candidate === 'object')
    .map((entry) => ({
      candidate: entry.candidate,
      rejectionStage: normalizeStage(entry.rejectionStage),
      rejectReasons: uniqueCodes(entry.rejectReasons),
    }));
}

function buildSamples(entries, weatherMode, weather, weatherSnapshot) {
  const seen = new Set();
  const sorted = entries
    .map((entry) => {
      const roleSnapshots = buildRoleSnapshots(entry.candidate);
      const codes = entry.rejectReasons.slice().sort();
      const combination = codes.join('+');
      const tuple = ROLE_KEYS.map((role) => `${role}:${roleSnapshots[role].category}:${roleSnapshots[role].subtype}`).join('|');
      return {
        entry,
        roleSnapshots,
        combination,
        tuple,
        sortKey: `${combination}|${tuple}|${stableCandidateKey(entry.candidate)}`,
      };
    })
    .sort((left, right) => left.sortKey.localeCompare(right.sortKey));
  const values = [];
  for (const candidate of sorted) {
    const groupKey = `${candidate.combination}|${candidate.tuple}`;
    if (seen.has(groupKey)) continue;
    seen.add(groupKey);
    values.push({
      sampleIndex: values.length,
      rejectionStage: candidate.entry.rejectionStage,
      rejectionCodes: candidate.combination ? candidate.combination.split('+') : [],
      top: candidate.roleSnapshots.top,
      bottom: candidate.roleSnapshots.bottom,
      shoes: candidate.roleSnapshots.shoes,
      roleCompleteness: isRoleComplete(candidate.entry.candidate),
      weather: buildWeatherSnapshot(weatherMode, weather, weatherSnapshot),
    });
    if (values.length >= MAX_ELIGIBILITY_REJECTION_SAMPLES) break;
  }
  return { values };
}

function buildStageHistogram(entries) {
  return buildCountObject(entries.map((entry) => entry.rejectionStage));
}

function buildReasonHistogram(entries) {
  return buildCountObject(entries.flatMap((entry) => entry.rejectReasons));
}

function buildCombinationHistogram(entries) {
  return buildCountObject(entries.map((entry) => entry.rejectReasons.slice().sort().join('+')));
}

function buildCategoryDistribution(rejectedCandidates, allCandidates, acceptedEntries) {
  return {
    top: buildRoleDistribution(rejectedCandidates, 'top'),
    bottom: buildRoleDistribution(rejectedCandidates, 'bottom'),
    shoes: buildRoleDistribution(rejectedCandidates, 'shoes'),
    roleCompleteness: buildRoleCompletenessDistribution(rejectedCandidates),
    sportFactCounts: buildSportFactCounts(allCandidates),
    safeSportCandidate: {
      exists: acceptedEntries.some((candidate) => isSafeSportCandidate(candidate)),
      count: acceptedEntries.filter((candidate) => isSafeSportCandidate(candidate)).length,
    },
  };
}

function buildRoleDistribution(candidates, role) {
  const categoryCounts = {};
  const subtypeCounts = {};
  for (const candidate of candidates) {
    const fact = findRoleFact(candidate, role);
    const category = fact ? normalizeCategory(fact.category, role) : 'missing';
    const subtype = fact ? normalizeSubtype(role, fact) : 'missing';
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    subtypeCounts[subtype] = (subtypeCounts[subtype] || 0) + 1;
  }
  return {
    categories: sortCountObject(categoryCounts),
    subtypes: sortCountObject(subtypeCounts),
  };
}

function buildRoleCompletenessDistribution(candidates) {
  const result = { complete: 0, incomplete: 0 };
  for (const candidate of candidates) result[isRoleComplete(candidate) ? 'complete' : 'incomplete'] += 1;
  return result;
}

function buildSportFactCounts(candidates) {
  const result = Object.fromEntries(SPORT_FACT_KEYS.map((key) => [key, 0]));
  for (const candidate of candidates) {
    for (const fact of candidateFacts(candidate)) {
      const values = buildSportFacts(fact);
      for (const key of SPORT_FACT_KEYS) if (values[key]) result[key] += 1;
    }
  }
  return result;
}

function buildRoleSnapshots(candidate) {
  return Object.fromEntries(ROLE_KEYS.map((role) => {
    const fact = findRoleFact(candidate, role);
    return [role, {
      category: fact ? normalizeCategory(fact.category, role) : 'missing',
      subtype: fact ? normalizeSubtype(role, fact) : 'missing',
      sportFacts: buildSportFacts(fact),
    }];
  }));
}

function buildSportFacts(fact) {
  return Object.fromEntries(SPORT_FACT_KEYS.map((key) => {
    if (!fact) return [key, false];
    if (key === 'hasSportSignal') return [key, Array.isArray(fact.sportSignals) && fact.sportSignals.length > 0];
    if (key === 'hasSportVisibleFact') {
      return [key, readStringArray(fact.visibleFacts).some((value) => ['sport_top', 'sport_bottom', 'sport_shoe'].includes(value))];
    }
    if (key === 'suitableSportShoe') {
      return [key, fact.category === 'shoes' && !fact.invalidSportShoe
        && (fact.isSportShoe || readStringArray(fact.visibleFacts).includes('sport_shoe'))];
    }
    return [key, Boolean(fact[key])];
  }));
}

function findRoleFact(candidate, role) {
  const facts = candidateFacts(candidate);
  const roleId = candidate?.roleItemIds?.[role];
  if (roleId) {
    const byId = facts.find((fact) => readString(fact.itemId) === String(roleId));
    if (byId) return byId;
  }
  return facts.find((fact) => normalizeCategory(fact.category, role) === role) || null;
}

function candidateFacts(candidate) {
  const facts = candidate?.derivedFacts?.sceneFacts
    || candidate?.sceneEligibility?.itemFacts
    || candidate?.eligibility?.scene?.itemFacts;
  return Array.isArray(facts) ? facts.filter((fact) => fact && typeof fact === 'object') : [];
}

function isRoleComplete(candidate) {
  const hasTop = Boolean(findRoleFact(candidate, 'top'));
  const hasBottom = Boolean(findRoleFact(candidate, 'bottom'));
  const hasOnepiece = Boolean(findRoleFact(candidate, 'onepiece'));
  const hasShoes = Boolean(findRoleFact(candidate, 'shoes'));
  return hasShoes && ((hasTop && hasBottom) || hasOnepiece);
}

function isSafeSportCandidate(candidate) {
  const top = findRoleFact(candidate, 'top');
  const bottom = findRoleFact(candidate, 'bottom');
  const shoes = findRoleFact(candidate, 'shoes');
  return Boolean(top?.isTshirtLike && bottom?.isShorts && shoes
    && !shoes.invalidSportShoe
    && (shoes.isSportShoe || readStringArray(shoes.visibleFacts).includes('sport_shoe')));
}

function normalizeCategory(value, fallback) {
  const category = readString(value).toLowerCase();
  return ['top', 'bottom', 'shoes'].includes(category) ? category : fallback;
}

function normalizeSubtype(role, fact) {
  const rule = (SUBTYPE_RULES[role] || []).find(([, matches]) => matches(fact));
  return rule ? rule[0] : 'other';
}

function buildWeatherSnapshot(mode, weather, weatherSnapshot) {
  const rawTemperature = weather?.temp ?? weather?.temperature ?? weatherSnapshot?.temp;
  return {
    mode: safeText(mode, 24) || 'unavailable',
    temperatureBucket: temperatureBucket(rawTemperature),
    precipitationPresent: hasPrecipitation(weather, weatherSnapshot),
  };
}

function temperatureBucket(value) {
  const temperature = Number(value);
  if (!Number.isFinite(temperature)) return 'unknown';
  if (temperature >= 29) return 'hot';
  if (temperature >= 26) return 'warm';
  if (temperature >= 22) return 'mild';
  return 'cool';
}

function hasPrecipitation(weather, weatherSnapshot) {
  const value = weather?.precipitation ?? weather?.precipitationPresent
    ?? weather?.rainfall ?? weather?.rain ?? weatherSnapshot?.precipitation;
  if (value === true) return true;
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function stableCandidateKey(candidate) {
  const ids = Array.isArray(candidate?.itemIds) ? candidate.itemIds : [];
  return ids.map(String).sort().join('|') || safeText(candidate?.selectionSignatures?.itemSignature, 96);
}

function normalizeStage(value) {
  return ['role_precondition', 'scene_eligibility', 'wearability_guard', 'weather_guard', 'validator', 'acceptance'].includes(value)
    ? value
    : 'unknown';
}

function uniqueCodes(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim()))];
}

function buildCountObject(values) {
  const counts = {};
  for (const value of values) {
    const key = safeText(value, 96);
    if (key) counts[key] = (counts[key] || 0) + 1;
  }
  return sortCountObject(counts);
}

function sortCountObject(counts) {
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function setSerializedBytes(audit, measure = serializedBytes) {
  for (let index = 0; index < 4; index += 1) audit.serializedBytes = measure(audit);
}

function serializedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function safeCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}

function safeText(value, limit) {
  return typeof value === 'string' ? value.slice(0, limit) : '';
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readStringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];
}

module.exports = {
  ELIGIBILITY_REJECTION_AUDIT_VERSION,
  MAX_ELIGIBILITY_REJECTION_SAMPLES,
  buildEligibilityRejectionAudit,
  fitEligibilityRejectionAuditToBudget,
  serializedBytes,
};
