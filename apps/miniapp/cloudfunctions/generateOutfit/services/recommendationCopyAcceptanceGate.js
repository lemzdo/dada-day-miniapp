const {
  getClaimById,
  sourceMeetsMinimum,
} = require('./xiaodaVoiceBankV2');

const COPY_ACCEPTANCE_PASS = 'PASS';
const COPY_ACCEPTANCE_REJECT = 'REJECT';

const COPY_RISK_FLAGS = Object.freeze({
  CLAIM_FACT_NOT_EVIDENCED: 'CLAIM_FACT_NOT_EVIDENCED',
  SENTENCE_FACT_NOT_EVIDENCED: 'SENTENCE_FACT_NOT_EVIDENCED',
  SUBJECT_NOT_IN_OUTFIT: 'SUBJECT_NOT_IN_OUTFIT',
  SLOT_ITEM_NOT_IN_OUTFIT: 'SLOT_ITEM_NOT_IN_OUTFIT',
  EVIDENCE_ITEM_NOT_IN_OUTFIT: 'EVIDENCE_ITEM_NOT_IN_OUTFIT',
  EVIDENCE_SOURCE_TOO_WEAK: 'EVIDENCE_SOURCE_TOO_WEAK',
  TODAY_DETAIL_EVIDENCE_REPEAT: 'TODAY_DETAIL_EVIDENCE_REPEAT',
  TODAY_DETAIL_VALUE_REPEAT: 'TODAY_DETAIL_VALUE_REPEAT',
  TODAY_DETAIL_CLAIM_REPEAT: 'TODAY_DETAIL_CLAIM_REPEAT',
  FIXED_CLAIM_TEXT_MISMATCH: 'FIXED_CLAIM_TEXT_MISMATCH',
  INVALID_COPY_CANDIDATE: 'INVALID_COPY_CANDIDATE',
  INVALID_COPY_PAIR: 'INVALID_COPY_PAIR',
});

const BANNED_LANGUAGE = /有分寸|有准备感|不会太用力|认真出门感|穿着省事|视线有落点|记忆点|正式度|更完整|更统一|有层次|当前场景|适合今天|单品|组合|穿法|不算.{0,20}但也不会|虽然.{0,20}不过也不会|不会太.{0,20}又不会太/;
const FORBIDDEN_SCENE_EXPANSION = Object.freeze({
  home: /下楼|拿快递|临时出门|户外鞋/,
  work: /会议|开会|开车|长距离步行|长路/,
  date: /吃饭|散步|逛街|下午到晚上|晚餐/,
  sport: /跑步|跳跃|球类|力量训练|折痕|颜色亮点/,
});

function evaluateRecommendationCopy(candidate, context = {}) {
  return inspectRecommendationCopy(candidate, context).result;
}

function evaluateRecommendationPair(pair, context = {}) {
  return inspectRecommendationPair(pair, context).result;
}

function inspectRecommendationCopy(candidateValue, contextValue = {}) {
  const candidate = normalizeCandidate(candidateValue);
  const context = normalizeContext(contextValue);
  if (!candidate || !context) {
    return reject([COPY_RISK_FLAGS.INVALID_COPY_CANDIDATE]);
  }

  const flags = [];
  const definition = getClaimById(candidate.claimId);
  if (!definition || definition.text !== candidate.text || definition.scene !== candidate.scene) {
    flags.push(COPY_RISK_FLAGS.FIXED_CLAIM_TEXT_MISMATCH);
  }
  if (BANNED_LANGUAGE.test(candidate.text)
    || FORBIDDEN_SCENE_EXPANSION[candidate.scene]?.test(candidate.text)) {
    flags.push(COPY_RISK_FLAGS.FIXED_CLAIM_TEXT_MISMATCH);
  }

  if (!isSubset(candidate.requiredFactIds, candidate.evidenceFactIds)) {
    flags.push(COPY_RISK_FLAGS.CLAIM_FACT_NOT_EVIDENCED);
  }
  if (!isSubset(candidate.sentenceRequiredFactIds, candidate.evidenceFactIds)) {
    flags.push(COPY_RISK_FLAGS.SENTENCE_FACT_NOT_EVIDENCED);
  }
  if (!hasRequiredRelationFacts(definition, candidate.requiredFactIds)) {
    flags.push(COPY_RISK_FLAGS.CLAIM_FACT_NOT_EVIDENCED);
  }

  for (const itemId of candidate.subjectItemIds) {
    if (!context.selectedOutfitItemIds.has(itemId)) flags.push(COPY_RISK_FLAGS.SUBJECT_NOT_IN_OUTFIT);
  }
  for (const itemId of Object.values(candidate.slotBindings)) {
    if (!context.selectedOutfitItemIds.has(itemId)) flags.push(COPY_RISK_FLAGS.SLOT_ITEM_NOT_IN_OUTFIT);
  }

  for (const factId of candidate.evidenceFactIds) {
    const parsed = parseItemFactId(factId);
    if (!parsed) {
      const relation = parseRelationFactId(factId);
      if (!relation) {
        flags.push(COPY_RISK_FLAGS.EVIDENCE_ITEM_NOT_IN_OUTFIT);
        continue;
      }
      inspectRelationEvidence({ factId, relation, candidate, context, definition, flags });
      continue;
    }
    if (!context.selectedOutfitItemIds.has(parsed.itemId)) {
      flags.push(COPY_RISK_FLAGS.EVIDENCE_ITEM_NOT_IN_OUTFIT);
      continue;
    }
    const record = context.factRecordsById.get(factId);
    const claimedRecord = candidate.evidenceSources.get(factId);
    if (!record || !claimedRecord || record.itemId !== parsed.itemId || record.fact !== parsed.fact
      || !sameEvidenceSource(record, claimedRecord)) {
      flags.push(COPY_RISK_FLAGS.CLAIM_FACT_NOT_EVIDENCED);
      continue;
    }
    if (!sourceMeetsMinimum(record, minimumEvidenceForFact(definition, parsed.fact))) {
      flags.push(COPY_RISK_FLAGS.EVIDENCE_SOURCE_TOO_WEAK);
    }
  }

  if (candidate.subjectItemIds.length === 0
    || candidate.evidenceFactIds.length === 0
    || candidate.requiredFactIds.length === 0
    || !candidate.text
    || !/[。！？!?]$/.test(candidate.text)) {
    flags.push(COPY_RISK_FLAGS.INVALID_COPY_CANDIDATE);
  }

  const unique = uniqueStrings(flags);
  return unique.length === 0 ? pass() : reject(unique);
}

function inspectRecommendationPair(pair, context = {}) {
  if (!isPlainObject(pair) || !pair.today) return reject([COPY_RISK_FLAGS.INVALID_COPY_PAIR]);
  const todayInspection = inspectRecommendationCopy(pair.today, context);
  if (!pair.detail) return todayInspection;
  const detailInspection = inspectRecommendationCopy(pair.detail, context);
  const flags = [...todayInspection.riskFlags, ...detailInspection.riskFlags];
  const today = normalizeCandidate(pair.today);
  const detail = normalizeCandidate(pair.detail);
  if (!today || !detail) return reject(uniqueStrings([...flags, COPY_RISK_FLAGS.INVALID_COPY_PAIR]));
  if (today.claimId === detail.claimId) flags.push(COPY_RISK_FLAGS.TODAY_DETAIL_CLAIM_REPEAT);
  if (today.userValue === detail.userValue) flags.push(COPY_RISK_FLAGS.TODAY_DETAIL_VALUE_REPEAT);
  if (today.evidenceFactIds.some((factId) => detail.evidenceFactIds.includes(factId))) {
    flags.push(COPY_RISK_FLAGS.TODAY_DETAIL_EVIDENCE_REPEAT);
  }
  const unique = uniqueStrings(flags);
  return unique.length === 0 ? pass() : reject(unique);
}

function normalizeCandidate(value) {
  if (!isPlainObject(value)) return null;
  const claimId = readString(value.claimId || value.sentenceClusterId);
  const definition = getClaimById(claimId);
  const text = readString(value.text);
  const scene = normalizeScene(value.scene || definition?.scene);
  const subjectItemIds = normalizeStringArray(value.subjectItemIds
    || (value.subjectItemId ? [value.subjectItemId] : []));
  const requiredFactIds = normalizeStringArray(value.requiredFactIds || value.requiredFacts || []);
  const evidenceFactIds = normalizeStringArray(value.evidenceFactIds || value.evidenceIds || []);
  const sentenceRequiredFactIds = normalizeStringArray(
    value.sentence?.requiredFactIds || value.sentenceRequiredFactIds || requiredFactIds,
  );
  const slotBindings = normalizeStringRecord(value.slotBindings);
  const evidenceSources = normalizeEvidenceSources(value.evidenceSources || []);
  if (!claimId || !text || !scene || !subjectItemIds || !requiredFactIds || !evidenceFactIds
    || !sentenceRequiredFactIds || !slotBindings || !evidenceSources) return null;
  return {
    claimId,
    text,
    scene,
    surface: readString(value.surface),
    action: readString(value.action || definition?.action),
    dimension: readString(value.dimension || definition?.dimension),
    userValue: readString(value.userValue || definition?.userValue),
    subjectItemIds,
    requiredFactIds,
    evidenceFactIds,
    sentenceRequiredFactIds,
    slotBindings,
    evidenceSources,
  };
}

function normalizeContext(value) {
  if (!isPlainObject(value)) return null;
  const scopes = isPlainObject(value.itemFactsById) ? value.itemFactsById : {};
  const providedIds = Object.prototype.hasOwnProperty.call(value, 'selectedOutfitItemIds')
    ? normalizeStringArray(value.selectedOutfitItemIds)
    : Object.keys(scopes);
  if (!providedIds) return null;
  const selectedOutfitItemIds = new Set(providedIds);
  const factRecordsById = new Map();
  const relationFactsById = new Map();
  for (const [itemId, rawScope] of Object.entries(scopes)) {
    if (!isPlainObject(rawScope)) return null;
    const records = Array.isArray(rawScope.factRecords) ? rawScope.factRecords : [];
    for (const rawRecord of records) {
      const record = normalizeFactRecord(rawRecord, itemId);
      if (!record) return null;
      factRecordsById.set(record.factId, record);
    }
  }
  if (Array.isArray(value.factRecords)) {
    for (const rawRecord of value.factRecords) {
      const parsed = parseItemFactId(rawRecord?.factId);
      const record = normalizeFactRecord(rawRecord, parsed?.itemId || '');
      if (!record) return null;
      factRecordsById.set(record.factId, record);
    }
  }
  if (Array.isArray(value.relationFacts)) {
    for (const rawRecord of value.relationFacts) {
      const record = normalizeRelationRecord(rawRecord);
      if (!record || relationFactsById.has(record.factId)) return null;
      relationFactsById.set(record.factId, record);
    }
  }
  return { selectedOutfitItemIds, factRecordsById, relationFactsById };
}

function minimumEvidenceForFact(definition, fact) {
  if (!definition) return 'A';
  for (const requirement of definition.requirements) {
    if (requirement.allOf.includes(fact) || requirement.anyOf.includes(fact)) {
      return requirement.minimumEvidenceByFact?.[fact] || requirement.minimumEvidenceLevel;
    }
  }
  return 'A';
}

function normalizeEvidenceSources(value) {
  if (!Array.isArray(value)) return null;
  const result = new Map();
  for (const raw of value) {
    const factId = readString(raw?.factId || raw?.relationFactId);
    const parsed = parseItemFactId(factId);
    const record = parsed
      ? normalizeFactRecord(raw, raw?.itemId || parsed.itemId)
      : normalizeRelationRecord(raw);
    if (!record || result.has(record.factId)) return null;
    result.set(record.factId, record);
  }
  return result;
}

function normalizeFactRecord(value, fallbackItemId) {
  if (!isPlainObject(value)) return null;
  const factId = readString(value.factId);
  const parsed = parseItemFactId(factId);
  const itemId = readString(value.itemId || fallbackItemId || parsed?.itemId);
  const fact = readString(value.fact || parsed?.fact);
  const source = readString(value.source).toLowerCase();
  const confidence = Number(value.confidence);
  if (!factId || !parsed || parsed.itemId !== itemId || parsed.fact !== fact
    || !source || !Number.isFinite(confidence)) return null;
  return {
    factId,
    itemId,
    fact,
    source,
    confidence,
    authorized: value.authorized !== false,
    ...(readString(value.sourceDetail) ? { sourceDetail: readString(value.sourceDetail) } : {}),
  };
}

function normalizeRelationRecord(value) {
  if (!isPlainObject(value)) return null;
  const factId = readString(value.relationFactId || value.factId);
  const parsed = parseRelationFactId(factId);
  const fact = readString(value.fact || parsed?.fact);
  const subjectItemIds = normalizeStringArray(value.subjectItemIds);
  const supportingFactIds = normalizeStringArray(value.supportingFactIds);
  const confidence = Number(value.confidence);
  if (!parsed || parsed.fact !== fact || !subjectItemIds || !supportingFactIds
    || subjectItemIds.length === 0 || supportingFactIds.length === 0 || !Number.isFinite(confidence)) return null;
  return {
    ...value,
    relationFactId: factId,
    factId,
    fact,
    subjectItemIds,
    supportingFactIds,
    source: readString(value.source),
    confidence,
    authorized: value.authorized !== false,
    sourceRule: readString(value.sourceRule),
    relationRule: readString(value.relationRule),
  };
}

function inspectRelationEvidence({ factId, relation, candidate, context, definition, flags }) {
  const record = context.relationFactsById.get(factId);
  const claimedRecord = candidate.evidenceSources.get(factId);
  if (!record || !claimedRecord || record.fact !== relation.fact || !sameRelationEvidence(record, claimedRecord)) {
    flags.push(COPY_RISK_FLAGS.CLAIM_FACT_NOT_EVIDENCED);
    return;
  }
  if (record.subjectItemIds.some((itemId) => !context.selectedOutfitItemIds.has(itemId))) {
    flags.push(COPY_RISK_FLAGS.SUBJECT_NOT_IN_OUTFIT);
  }
  const supports = record.supportingFactIds.map(parseItemFactId);
  if (supports.some((entry) => !entry || !context.selectedOutfitItemIds.has(entry.itemId))) {
    flags.push(COPY_RISK_FLAGS.EVIDENCE_ITEM_NOT_IN_OUTFIT);
    return;
  }
  if (supports.some((entry, index) => {
    const supportId = record.supportingFactIds[index];
    const supportRecord = context.factRecordsById.get(supportId);
    return !record.subjectItemIds.includes(entry.itemId)
      || !supportRecord
      || supportRecord.itemId !== entry.itemId
      || supportRecord.fact !== entry.fact;
  })) flags.push(COPY_RISK_FLAGS.CLAIM_FACT_NOT_EVIDENCED);

  if (relation.fact === 'work_eligible') {
    if (!['sceneEligibilityV3', 'sceneEvidenceV4'].includes(record.sourceRule) || record.authorized === false) {
      flags.push(COPY_RISK_FLAGS.EVIDENCE_SOURCE_TOO_WEAK);
    }
  } else if (relation.fact === 'color_coordinated') {
    const subjectSet = new Set(record.subjectItemIds);
    const supportItemSet = new Set(supports.map((entry) => entry?.itemId).filter(Boolean));
    if (record.relationRule !== 'same_normalized_color_group'
      || record.confidence < 0.8
      || record.subjectItemIds.length !== 2
      || supports.some((entry) => entry?.fact !== 'color')
      || subjectSet.size !== 2
      || supportItemSet.size !== 2
      || [...subjectSet].some((itemId) => !supportItemSet.has(itemId))) {
      flags.push(COPY_RISK_FLAGS.CLAIM_FACT_NOT_EVIDENCED);
    }
  } else {
    flags.push(COPY_RISK_FLAGS.CLAIM_FACT_NOT_EVIDENCED);
  }

  if (!definition?.requirements.some((requirement) => (
    requirement.slot === 'outfit'
    && [...requirement.allOf, ...requirement.anyOf].includes(relation.fact)
  ))) flags.push(COPY_RISK_FLAGS.CLAIM_FACT_NOT_EVIDENCED);
}

function hasRequiredRelationFacts(definition, requiredFactIds) {
  if (!definition) return false;
  return definition.requirements
    .filter((requirement) => requirement.slot === 'outfit')
    .every((requirement) => requirement.allOf.every((fact) => requiredFactIds.includes(`outfit:${fact}`))
      && (requirement.anyOf.length === 0 || requirement.anyOf.some((fact) => requiredFactIds.includes(`outfit:${fact}`))));
}

function sameEvidenceSource(left, right) {
  return left.factId === right.factId
    && left.itemId === right.itemId
    && left.fact === right.fact
    && left.source === right.source
    && left.confidence === right.confidence
    && left.authorized === right.authorized;
}

function sameRelationEvidence(left, right) {
  return left.factId === right.factId
    && left.fact === right.fact
    && left.sourceRule === right.sourceRule
    && left.relationRule === right.relationRule
    && left.confidence === right.confidence
    && left.authorized === right.authorized
    && arraysEqual(left.subjectItemIds, right.subjectItemIds)
    && arraysEqual(left.supportingFactIds, right.supportingFactIds);
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function parseItemFactId(value) {
  const match = /^item:([^:]+):([^:]+)$/.exec(readString(value));
  return match ? { itemId: match[1], fact: match[2] } : null;
}

function parseRelationFactId(value) {
  const match = /^outfit:([^:]+)$/.exec(readString(value));
  return match ? { fact: match[1] } : null;
}

function isSubset(left, right) {
  const allowed = new Set(right);
  return left.every((entry) => allowed.has(entry));
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return null;
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) return null;
    const text = readString(value[index]);
    if (!text || result.includes(text)) return null;
    result.push(text);
  }
  return result;
}

function normalizeStringRecord(value) {
  if (value === undefined) return {};
  if (!isPlainObject(value)) return null;
  const result = {};
  for (const [key, raw] of Object.entries(value)) {
    const normalizedKey = readString(key);
    const normalizedValue = readString(raw);
    if (!normalizedKey || !normalizedValue || Object.hasOwn(result, normalizedKey)) return null;
    result[normalizedKey] = normalizedValue;
  }
  return result;
}

function normalizeScene(value) {
  const text = readString(value).toLowerCase();
  return { home: 'home', 居家: 'home', work: 'work', 上班: 'work', 通勤: 'work', date: 'date', 约会: 'date', sport: 'sport', sports: 'sport', 运动: 'sport' }[text] || text;
}

function pass() {
  return { result: COPY_ACCEPTANCE_PASS, riskFlags: [] };
}

function reject(riskFlags) {
  return { result: COPY_ACCEPTANCE_REJECT, riskFlags: uniqueStrings(riskFlags) };
}

function uniqueStrings(values) {
  return [...new Set((values || []).filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

module.exports = {
  COPY_RISK_FLAGS,
  COPY_ACCEPTANCE_PASS,
  COPY_ACCEPTANCE_REJECT,
  evaluateRecommendationCopy,
  evaluateRecommendationPair,
  inspectRecommendationCopy,
  inspectRecommendationPair,
};
