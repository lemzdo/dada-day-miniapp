const RELIABLE_FACT_SOURCES = Object.freeze(['user', 'care_label', 'product_data']);
const VISUAL_FACT_SOURCES = Object.freeze(['structured_ai', 'visual_inference', 'legacy_snapshot']);

const VISIBLE_FACTS = Object.freeze([
  'category',
  'color',
  'basic_color',
  'bright_color',
  'pattern_visible',
  'solid_color',
  'sleeveless',
  'short_sleeve',
  'long_sleeve',
  'shorts',
  'long_pants',
  'loose_fit',
  'not_fitted',
  'straight_cut',
  'shirt',
  'dress',
  'pants',
  'shoe_laces',
  'fixed_strap',
  'simple_style',
  'casual_style',
  'thin_outerwear',
  'sport_outerwear',
  'sport_top',
  'sport_bottom',
  'sport_shoe',
  'outing_shoe',
  'home_shoe',
]);

const RELIABLE_ONLY_FACTS = Object.freeze([
  'soft_material',
  'flexible_fit',
  'waist_not_tight',
  'movement',
  'shoulder_mobility',
  'breathability',
  'quick_dry',
  'warmth',
  'soft_sole',
  'cushioning',
  'anti_slip',
  'grip',
  'secure_fit',
  'wrinkle_risk',
]);

const VISIBLE_FACT_SET = new Set(VISIBLE_FACTS);
const RELIABLE_ONLY_FACT_SET = new Set(RELIABLE_ONLY_FACTS);
const RELIABLE_SOURCE_SET = new Set(RELIABLE_FACT_SOURCES);
const VISUAL_SOURCE_SET = new Set(VISUAL_FACT_SOURCES);
const SOURCE_RANK = Object.freeze({ A: 2, B: 1, C: 0 });

const FACT_AUTHORIZATION_MATRIX = Object.freeze(Object.fromEntries([
  ...VISIBLE_FACTS.map((fact) => [fact, Object.freeze({
    fact,
    policy: 'visible',
    allowedSources: Object.freeze([...RELIABLE_FACT_SOURCES, ...VISUAL_FACT_SOURCES]),
  })]),
  ...RELIABLE_ONLY_FACTS.map((fact) => [fact, Object.freeze({
    fact,
    policy: 'reliable_only',
    allowedSources: RELIABLE_FACT_SOURCES,
  })]),
]));

function getFactAuthorizationPolicy(factValue) {
  const fact = normalizeFact(factValue);
  return FACT_AUTHORIZATION_MATRIX[fact] || Object.freeze({
    fact,
    policy: 'reliable_only',
    allowedSources: RELIABLE_FACT_SOURCES,
  });
}

function factEvidenceLevel(record = {}) {
  const fact = normalizeFact(record.fact || parseFactName(record.factId));
  const source = normalizeSource(record.source);
  const confidence = normalizeConfidence(record.confidence);
  if (!fact || record.authorized === false) return 'C';
  if (RELIABLE_SOURCE_SET.has(source)) return confidence >= 0.5 ? 'A' : 'C';
  if (!VISIBLE_FACT_SET.has(fact) || !VISUAL_SOURCE_SET.has(source)) return 'C';
  if (source === 'structured_ai') return confidence >= 0.85 ? 'B' : 'C';
  if (source === 'legacy_snapshot') return confidence >= 0.8 ? 'B' : 'C';
  return confidence >= 0.8 ? 'B' : 'C';
}

function factSourceMeetsMinimum(record, minimumLevel) {
  return SOURCE_RANK[factEvidenceLevel(record)] >= SOURCE_RANK[minimumLevel || 'A'];
}

function factCanInformEligibility(record = {}) {
  const source = normalizeSource(record.source);
  const confidence = normalizeConfidence(record.confidence);
  if (record.authorized === false) return false;
  if (RELIABLE_SOURCE_SET.has(source)) return confidence >= 0.5;
  if (source === 'structured_ai') return confidence >= 0.85;
  if (source === 'visual_inference') return confidence >= 0.8;
  if (source === 'legacy_snapshot') {
    return VISIBLE_FACT_SET.has(normalizeFact(record.fact || parseFactName(record.factId)))
      && confidence >= 0.8;
  }
  return false;
}

function isReliableOnlyFact(fact) {
  return RELIABLE_ONLY_FACT_SET.has(normalizeFact(fact));
}

function normalizeFact(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeSource(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeConfidence(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}

function parseFactName(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  const itemMatch = /^item:[^:]+:([^:]+)$/.exec(text);
  if (itemMatch) return itemMatch[1];
  const outfitMatch = /^outfit:([^:]+)$/.exec(text);
  return outfitMatch ? outfitMatch[1] : '';
}

module.exports = {
  FACT_AUTHORIZATION_MATRIX,
  RELIABLE_FACT_SOURCES,
  RELIABLE_ONLY_FACTS,
  VISIBLE_FACTS,
  VISUAL_FACT_SOURCES,
  factCanInformEligibility,
  factEvidenceLevel,
  factSourceMeetsMinimum,
  getFactAuthorizationPolicy,
  isReliableOnlyFact,
};
