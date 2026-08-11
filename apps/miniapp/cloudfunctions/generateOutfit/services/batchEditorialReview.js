const {
  buildNaturalTodayCopyCandidates,
} = require('./recommendationNaturalLanguage');

const BATCH_EDITORIAL_REVIEW_VERSION = 'batch-editorial-review-v2';
const BATCH_EDITORIAL_PASS = 'PASS';
const BATCH_EDITORIAL_REJECT = 'REJECT';

const BATCH_EDITORIAL_FLAGS = Object.freeze({
  AVOIDABLE_EXACT_DUPLICATE: 'AVOIDABLE_EXACT_DUPLICATE',
  AVOIDABLE_INTENT_MONOTONY: 'AVOIDABLE_INTENT_MONOTONY',
  AVOIDABLE_OPENING_MONOTONY: 'AVOIDABLE_OPENING_MONOTONY',
  AVOIDABLE_ENDING_MONOTONY: 'AVOIDABLE_ENDING_MONOTONY',
  AVOIDABLE_TEMPLATE_NAME_SWAP: 'AVOIDABLE_TEMPLATE_NAME_SWAP',
  REPETITIVE_SENTENCE_FRAME: 'REPETITIVE_SENTENCE_FRAME',
});

const BATCH_EDITORIAL_WARNING_FLAGS = Object.freeze({
  EXACT_DUPLICATE_WITHOUT_UNUSED_EVIDENCE: 'EXACT_DUPLICATE_WITHOUT_UNUSED_EVIDENCE',
  TEMPLATE_CONCENTRATION_FROM_FACT_DISTRIBUTION: 'TEMPLATE_CONCENTRATION_FROM_FACT_DISTRIBUTION',
  OPENING_CONCENTRATION: 'OPENING_CONCENTRATION',
  ENDING_CONCENTRATION: 'ENDING_CONCENTRATION',
});

const REPETITIVE_FRAMES = Object.freeze([
  { id: 'x-pairs-y', pattern: /^[^，。；]{1,24}配(?:上|着)?[^，。；]{1,24}[，。]/u },
  { id: 'this-outfit', pattern: /这(?:套|身)/u },
  { id: 'enough', pattern: /就(?:好|够|行)/u },
  { id: 'more-convenient', pattern: /更方便/u },
]);

function selectBatchEditorialCandidates(models = []) {
  const list = Array.isArray(models) ? models : [];
  const pools = list.map((model) => buildNaturalTodayCopyCandidates(model));
  const selected = [];
  const usage = {
    text: new Map(),
    intent: new Map(),
    opening: new Map(),
    ending: new Map(),
    template: new Map(),
    dimension: new Map(),
    frame: new Map(),
    sceneEvidence: new Map(),
  };

  for (let index = 0; index < pools.length; index += 1) {
    const pool = pools[index];
    const previous = selected[index - 1] || null;
    const beforePrevious = selected[index - 2] || null;
    const unseenTextPool = pool.filter((entry) => countUsage(usage.text, entry.text) === 0);
    const novelPool = unseenTextPool.length > 0 ? unseenTextPool : pool;
    const underusedTemplatePool = novelPool.filter((entry) => countUsage(usage.template, entry.templateId) < 2);
    const editorialPool = underusedTemplatePool.length > 0
      && novelPool.every((entry) => countUsage(usage.template, entry.templateId) >= 2) === false
      && novelPool.some((entry) => countUsage(usage.template, entry.templateId) >= 2)
      ? underusedTemplatePool
      : novelPool;
    const candidate = editorialPool
      .map((entry) => ({ entry, score: editorialSelectionScore(entry, usage, previous, beforePrevious) }))
      .sort((left, right) => right.score - left.score
        || left.entry.candidateId.localeCompare(right.entry.candidateId))[0]?.entry || null;
    selected.push(candidate);
    if (candidate) recordUsage(usage, candidate);
  }

  return {
    version: BATCH_EDITORIAL_REVIEW_VERSION,
    selectedCandidateIds: selected.map((candidate) => candidate?.candidateId || ''),
    selectedCandidates: selected,
    candidatePools: pools,
  };
}

function reviewBatchEditorialNaturalness(plans = [], candidatePools = []) {
  const list = (Array.isArray(plans) ? plans : []).filter(Boolean);
  const pools = Array.isArray(candidatePools) ? candidatePools : [];
  const flags = [];
  const metrics = {
    cardCount: list.length,
    exactDuplicateCount: duplicateOverflow(list.map((plan) => normalizeSentence(plan.text))),
    distinctIntentCount: uniqueStrings(list.map((plan) => plan.messageIntent)).length,
    distinctOpeningCount: uniqueStrings(list.map((plan) => plan.openingFamily)).length,
    distinctEndingCount: uniqueStrings(list.map((plan) => plan.endingFamily)).length,
    distinctTemplateCount: uniqueStrings(list.map((plan) => plan.clauses?.[0]?.templateId)).length,
    frameCounts: Object.fromEntries(REPETITIVE_FRAMES.map((frame) => [
      frame.id,
      list.filter((plan) => frame.pattern.test(plan.text || '')).length,
    ])),
  };

  if (hasAvoidableDuplicate(list, pools)) flags.push(BATCH_EDITORIAL_FLAGS.AVOIDABLE_EXACT_DUPLICATE);
  if (hasAvoidableMonotony(list, pools, 'messageIntent', (candidate) => candidate.messageIntent)) {
    flags.push(BATCH_EDITORIAL_FLAGS.AVOIDABLE_INTENT_MONOTONY);
  }
  const openingConcentrated = hasAvoidableMonotony(list, pools, 'openingFamily', (candidate) => candidate.openingFamily);
  const endingConcentrated = hasAvoidableMonotony(list, pools, 'endingFamily', (candidate) => candidate.endingFamily);
  if (hasAvoidableTemplateNameSwap(list, pools)) flags.push(BATCH_EDITORIAL_FLAGS.AVOIDABLE_TEMPLATE_NAME_SWAP);

  const frameLimit = Math.max(2, Math.ceil(list.length * 0.5));
  if (REPETITIVE_FRAMES.some((frame) => metrics.frameCounts[frame.id] > frameLimit
    && hasAlternativeWithoutFrame(pools, frame.pattern))) {
    flags.push(BATCH_EDITORIAL_FLAGS.REPETITIVE_SENTENCE_FRAME);
  }

  const warningFlags = [];
  if (openingConcentrated) warningFlags.push(BATCH_EDITORIAL_WARNING_FLAGS.OPENING_CONCENTRATION);
  if (endingConcentrated) warningFlags.push(BATCH_EDITORIAL_WARNING_FLAGS.ENDING_CONCENTRATION);
  if (metrics.exactDuplicateCount > 0 && !flags.includes(BATCH_EDITORIAL_FLAGS.AVOIDABLE_EXACT_DUPLICATE)) {
    warningFlags.push(BATCH_EDITORIAL_WARNING_FLAGS.EXACT_DUPLICATE_WITHOUT_UNUSED_EVIDENCE);
  }
  if (maxFrequency(list.map((plan) => plan.clauses?.[0]?.templateId)) >= 3
    && !flags.includes(BATCH_EDITORIAL_FLAGS.AVOIDABLE_TEMPLATE_NAME_SWAP)) {
    warningFlags.push(BATCH_EDITORIAL_WARNING_FLAGS.TEMPLATE_CONCENTRATION_FROM_FACT_DISTRIBUTION);
  }

  return {
    version: BATCH_EDITORIAL_REVIEW_VERSION,
    result: flags.length > 0 ? BATCH_EDITORIAL_REJECT : BATCH_EDITORIAL_PASS,
    riskFlags: uniqueStrings(flags),
    warningFlags: uniqueStrings(warningFlags),
    metrics,
  };
}

function maxFrequency(values) {
  return Math.max(0, ...frequency(values).values());
}

function editorialSelectionScore(candidate, usage, previous, beforePrevious) {
  const total = Number(candidate?.valueAssessment?.total) || 0;
  const priority = Number(candidate?.priority) || 0;
  let score = total * 100 + priority;
  score -= countUsage(usage.intent, candidate.messageIntent) * 38;
  score -= countUsage(usage.opening, candidate.openingFamily) * 30;
  score -= countUsage(usage.ending, candidate.endingFamily) * 26;
  score -= countUsage(usage.text, candidate.text) * 900;
  score -= countUsage(usage.template, candidate.templateId) * 90;
  if (countUsage(usage.template, candidate.templateId) >= 2) score -= 360;
  score -= countUsage(usage.dimension, candidate.dimension) * 8;
  const sceneEvidenceKey = sceneEvidenceSignature(candidate);
  const sceneEvidenceReuse = countUsage(usage.sceneEvidence, sceneEvidenceKey);
  // Scene eligibility is valuable on an individual card, but repeating the same
  // boundary on most cards adds no new batch-level information. Keep it on a
  // small representative subset, then spend the remaining copy budget on
  // grounded relation messages. This is evidence selection, not synonym churn.
  score -= sceneEvidenceReuse * 150;
  if (sceneEvidenceReuse >= 2) score -= 240;
  if (candidate.dimension && candidate.dimension === previous?.dimension
    && candidate.dimension === beforePrevious?.dimension) score -= 45;
  for (const frame of REPETITIVE_FRAMES) {
    if (frame.pattern.test(candidate.text || '')) score -= countUsage(usage.frame, frame.id) * 65;
  }
  return score;
}

function recordUsage(usage, candidate) {
  increment(usage.text, candidate.text);
  increment(usage.intent, candidate.messageIntent);
  increment(usage.opening, candidate.openingFamily);
  increment(usage.ending, candidate.endingFamily);
  increment(usage.template, candidate.templateId);
  increment(usage.dimension, candidate.dimension);
  increment(usage.sceneEvidence, sceneEvidenceSignature(candidate));
  for (const frame of REPETITIVE_FRAMES) {
    if (frame.pattern.test(candidate.text || '')) increment(usage.frame, frame.id);
  }
}

function sceneEvidenceSignature(candidate) {
  return (Array.isArray(candidate?.authorizationIds) ? candidate.authorizationIds : [])
    .filter((value) => typeof value === 'string' && value.startsWith('eligibility:'))
    .sort()
    .join('|');
}

function hasAvoidableDuplicate(plans, pools) {
  const seen = new Set();
  return plans.some((plan, index) => {
    const text = normalizeSentence(plan.text);
    const duplicate = seen.has(text);
    const alternatives = pools[index] || [];
    const avoidable = duplicate && alternatives.some((candidate) => !seen.has(normalizeSentence(candidate.text)));
    seen.add(text);
    return avoidable;
  });
}

function normalizeSentence(value) {
  return typeof value === 'string' ? value.trim().replace(/[。！？!?]+$/u, '') : '';
}

function hasAvoidableMonotony(plans, pools, planKey, candidateReader) {
  if (plans.length < 4) return false;
  const counts = frequency(plans.map((plan) => plan?.[planKey]));
  const [dominantValue, dominantCount] = [...counts.entries()]
    .sort((left, right) => right[1] - left[1])[0] || ['', 0];
  const limit = Math.max(2, Math.ceil(plans.length * 0.5));
  if (!dominantValue || dominantCount <= limit) return false;
  return plans.some((plan, index) => plan?.[planKey] === dominantValue
    && (pools[index] || []).some((candidate) => candidateReader(candidate) !== dominantValue
      && isNotLowerValue(candidate, plan)));
}

function hasAvoidableTemplateNameSwap(plans, pools) {
  if (plans.length < 3) return false;
  const templates = plans.map((plan) => plan.clauses?.[0]?.templateId || '');
  const counts = frequency(templates);
  const limit = Math.max(3, Math.ceil(plans.length * 0.5));
  const repeated = new Set([...counts.entries()].filter(([, count]) => count > limit).map(([template]) => template));
  if (repeated.size === 0) return false;
  const selectedTexts = new Set(plans.map((plan) => normalizeSentence(plan.text)));
  return plans.some((plan, index) => repeated.has(plan.clauses?.[0]?.templateId || '')
    && (pools[index] || []).some((candidate) => candidate.templateId !== plan.clauses?.[0]?.templateId
      && !selectedTexts.has(normalizeSentence(candidate.text))
      && isNotLowerValue(candidate, plan)));
}

function isNotLowerValue(candidate, plan) {
  return Number(candidate?.valueAssessment?.total) >= Number(plan?.valueAssessment?.total);
}

function hasAlternativeWithoutFrame(pools, pattern) {
  return pools.some((pool) => (pool || []).some((candidate) => !pattern.test(candidate.text || '')));
}

function duplicateOverflow(values) {
  return [...frequency(values).values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
}

function frequency(values) {
  const counts = new Map();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return counts;
}

function increment(map, key) {
  if (key) map.set(key, countUsage(map, key) + 1);
}

function countUsage(map, key) {
  return key ? map.get(key) || 0 : 0;
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === 'string' && value))];
}

module.exports = {
  BATCH_EDITORIAL_FLAGS,
  BATCH_EDITORIAL_PASS,
  BATCH_EDITORIAL_REJECT,
  BATCH_EDITORIAL_REVIEW_VERSION,
  BATCH_EDITORIAL_WARNING_FLAGS,
  reviewBatchEditorialNaturalness,
  selectBatchEditorialCandidates,
};
