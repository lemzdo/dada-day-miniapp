const DERIVED_FACTS_VERSION = 'candidate-derived-facts-v1';
const ROLE_KEYS = Object.freeze(['top', 'bottom', 'onepiece', 'outerwear', 'shoes']);

function createCandidateDerivedFacts({
  itemFactRefs = [],
  itemFactRecords = [],
  roleItemIds = {},
  archetype = '',
  selectionSignatures = {},
  instrumentation,
} = {}) {
  const startedAt = Date.now();
  const records = Array.isArray(itemFactRecords) ? itemFactRecords : [];
  if (records.length === 0 || records.some((record) => (
    !record?.sourceItem
    || !record.visibleFactItem
    || !record.wearabilityClassification
    || !record.sceneEligibilityItemFacts
  ))) return null;

  const sourceItems = records.map((record) => record.sourceItem);
  const visibleFactRefs = records.map((record) => record.visibleFactItem);
  const normalizedColors = sourceItems.flatMap((item) => normalizeColors(item));
  const styles = sourceItems.flatMap((item) => readArray(item.styleTags));
  const scenes = sourceItems.flatMap((item) => readArray(item.sceneTags));
  const seasons = sourceItems.map((item) => readArray(item.seasonTags));
  const thicknesses = sourceItems.map(getThicknessValue);
  const materials = sourceItems.map((item) => item.material);
  const preferenceText = buildPreferenceText(sourceItems);

  const derivedFacts = {
    version: DERIVED_FACTS_VERSION,
    visibleFactRefs,
    visibleFactsView: { items: visibleFactRefs },
    factRecordsView: visibleFactRefs.map((item) => item?.factRecords || []),
    weatherFacts: records.map((record) => record.wearabilityClassification),
    sceneFacts: records.map((record) => record.sceneEligibilityItemFacts),
    normalizedColors,
    styles,
    scenes,
    seasons,
    thicknesses,
    materials,
    preferenceText,
    warmth: scoreWarmthFromItems(sourceItems),
    coolness: scoreCoolnessFromItems(sourceItems),
    freshnessUsagePenalties: sourceItems.map((item) => Math.min(Number(item.usageCount || 0), 10) * 0.25),
    lastWornAtValues: sourceItems.map((item) => item.lastWornAt),
    fashionScores: sourceItems.map((item) => Number(item.fashionScore || 0)),
    itemSignature: selectionSignatures.itemSignature || '',
    roleSignature: ROLE_KEYS.map((role) => roleItemIds[role] || '').join('|'),
    archetype,
    existingSelectionSignatures: selectionSignatures,
  };
  recordMetric(instrumentation, 'createCandidateDerivedFacts');
  recordMetric(instrumentation, 'deriveCandidateWarmth');
  recordMetric(instrumentation, 'deriveCandidateCoolness');
  recordTiming(instrumentation, 'derivedFactsMs', Date.now() - startedAt);
  return derivedFacts;
}

function buildPreferenceText(items) {
  return items
    .flatMap((item) => [
      item.category,
      item.subcategory,
      item.subCategory,
      item.material,
      item.customName,
      ...(item.colors || []),
      ...readArray(item.styleTags),
      ...readArray(item.sceneTags),
      ...normalizeColors(item).map((color) => color.name),
    ])
    .filter(Boolean)
    .join(' ');
}

function scoreWarmthFromItems(items) {
  return Math.max(1, Math.min(10, round1(avg(items.map((item) => Number(item.warmthScore || 0) || inferWarmth(item))))));
}

function scoreCoolnessFromItems(items) {
  return Math.max(1, Math.min(10, round1(avg(items.map((item) => Number(item.coolnessScore || 0) || inferCoolness(item))))));
}

function getThicknessValue(item) {
  const warmthScore = Number(item.warmthScore || 0);
  if (warmthScore > 0) return Math.min(3, Math.max(1, warmthScore / 3.3));
  const text = `${item.thickness || ''} ${item.subcategory || ''} ${item.subCategory || ''} ${item.material || ''}`;
  if (['厚', '羽绒', '羊毛', 'down_jacket', 'sweater', 'coat'].some((hint) => text.includes(hint))) return 3;
  if (['薄', '短袖', '背心', 'tshirt', 'vest', 'shorts', 'sandals'].some((hint) => text.includes(hint))) return 1;
  return 2;
}

function inferWarmth(item) {
  const text = `${item.thickness || ''} ${item.subcategory || ''} ${item.subCategory || ''} ${item.material || ''}`;
  let score = 5;
  if (['羽绒', '羊毛', '针织', '皮革', 'down_jacket', 'jacket', 'sweater', 'boots'].some((hint) => text.includes(hint))) score += 2.5;
  if (['短袖', '薄', 'tshirt', 'shorts', 'sandals'].some((hint) => text.includes(hint))) score -= 2;
  return score;
}

function inferCoolness(item) {
  const text = `${item.thickness || ''} ${item.subcategory || ''} ${item.subCategory || ''} ${item.material || ''}`;
  let score = 5;
  if (['棉', '麻', '丝绸', '短袖', '薄', 'tshirt', 'shirt', 'shorts', 'skirt', 'sandals'].some((hint) => text.includes(hint))) score += 2;
  if (['羽绒', '羊毛', '厚', 'down_jacket', 'jacket', 'sweater', 'boots'].some((hint) => text.includes(hint))) score -= 2;
  return score;
}

function normalizeColors(item) {
  if (Array.isArray(item.colorPalette) && item.colorPalette.length > 0) return item.colorPalette;
  return readArray(item.colors).map((name) => ({ name, hex: '' }));
}

function readArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function avg(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round1(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10) / 10;
}

function recordMetric(instrumentation, name) {
  if (!instrumentation || typeof instrumentation !== 'object') return;
  const counters = instrumentation.counters && typeof instrumentation.counters === 'object'
    ? instrumentation.counters
    : instrumentation;
  counters[name] = (Number(counters[name]) || 0) + 1;
}

function recordTiming(instrumentation, name, duration) {
  if (!instrumentation || typeof instrumentation !== 'object') return;
  const timings = instrumentation.timings && typeof instrumentation.timings === 'object'
    ? instrumentation.timings
    : (instrumentation.timings = {});
  timings[name] = (Number(timings[name]) || 0) + Math.max(0, Number(duration) || 0);
}

module.exports = {
  DERIVED_FACTS_VERSION,
  createCandidateDerivedFacts,
};
