const crypto = require('crypto');

const { PRESENTATION_DIAGNOSTIC_KEY } = require('./recommendationPresentation');
const {
  buildPresentationFactModel,
  buildPresentationPlan,
  readPresentationPlan,
} = require('./presentationFactModel');
const {
  assertRecommendationCountContract,
  assertReturnedCardCount,
} = require('../shared/countContract');

const PRESENTATION_EVIDENCE_MODE = 'sanitized_v1';
const PRESENTATION_EVIDENCE_VERSION = 'presentation-evidence-v3';
const PRESENTATION_EVIDENCE_MAX_BYTES = 24 * 1024;
const PRESENTATION_HASH_LENGTH = 16;

function isPresentationEvidenceMode(value) {
  return value === PRESENTATION_EVIDENCE_MODE;
}

function buildPresentationEvidence({
  auditId,
  scene,
  selectedCandidates = [],
  presentationPlans = [],
  canonicalCards = [],
  finalCards = [],
  countContract,
  expectedCardCount,
  qaVersion = 'qa-batch-audit-v6-1-semantic-presentation',
} = {}) {
  const cards = Array.isArray(finalCards) && finalCards.length > 0
    ? finalCards
    : Array.isArray(canonicalCards) ? canonicalCards : [];
  const selected = Array.isArray(selectedCandidates) ? selectedCandidates : [];
  const plans = Array.isArray(presentationPlans) ? presentationPlans : [];
  const evidenceCountContract = countContract && typeof countContract === 'object'
    ? { ...countContract, candidatePoolId: null }
    : countContract;
  const result = {
    version: PRESENTATION_EVIDENCE_VERSION,
    auditId: safeAuditId(auditId),
    countContract: evidenceCountContract,
    shared: {
      scene: normalizeSceneCode(scene),
      planVersion: readSharedPlanVersion(plans, cards),
      copyContractVersion: readSharedCopyContractVersion(cards, plans, selected),
      qaVersion: safeCode(qaVersion) || null,
    },
    cards: cards.map((card, index) => buildCardEvidence({
      card,
      candidate: findMatchingEntry(selected, card, index),
      plan: findMatchingEntry(plans, card, index),
      canonicalCard: Array.isArray(canonicalCards) ? findMatchingEntry(canonicalCards, card, index) : null,
      scene,
      cardIndex: index,
    })),
  };

  const contract = result.countContract;
  assertRecommendationCountContract(contract);
  const expected = expectedCardCount === undefined ? contract.expectedCardCount : expectedCardCount;
  if (expected !== contract.expectedCardCount) throw new Error('presentation evidence expectedCardCount conflicts with count contract');
  try {
    assertReturnedCardCount(contract, result.cards.length);
  } catch (error) {
    throw new Error(`presentation evidence card count mismatch: ${error.message}`);
  }
  assertPresentationEvidenceSafe(result, collectSensitiveValues(selected, plans, canonicalCards, cards));
  return result;
}

function buildCardEvidence({ card, candidate, plan, canonicalCard, scene, cardIndex }) {
  const sourceCard = asObject(card);
  const selectedCandidate = asObject(candidate);
  const planSource = asObject(plan);
  const canonical = firstObject(canonicalCard, sourceCard);
  const presentationPlan = [sourceCard, canonical, planSource, selectedCandidate]
    .map(readPresentationPlan)
    .find(Boolean)
    || null;
  const factModel = presentationPlan?.factModel || buildPresentationFactModel({
    ...selectedCandidate,
    ...canonical,
    scene: scene || selectedCandidate.scene || canonical.scene,
  });
  const canonicalPlan = presentationPlan || buildPresentationPlan(factModel);
  const copyContract = firstObject(
    sourceCard.copyContract,
    planSource.copyContract,
    selectedCandidate.copyContract,
  );
  const contentPlan = firstObject(
    sourceCard.contentPlan,
    planSource.contentPlan,
    selectedCandidate.contentPlan,
  );
  const semanticPlan = presentationPlan || (factModel.items.length > 0 ? canonicalPlan : null);
  const diagnostic = firstObject(
    canonical[PRESENTATION_DIAGNOSTIC_KEY],
    sourceCard[PRESENTATION_DIAGNOSTIC_KEY],
    planSource[PRESENTATION_DIAGNOSTIC_KEY],
  );
  const itemRoles = factModel.items.map((item) => ({
    role: item.role,
    canonicalName: item.canonicalName || null,
    canonicalSubtype: item.canonicalSubtype || null,
    normalizedColor: item.normalizedColor || null,
  }));
  const diagnosticDifferentiators = toDifferentiators(diagnostic.selectedDifferentiator)
    .filter((entry) => entry.type === 'relation'
      && entry.relationCode
      && Array.isArray(entry.roles) && entry.roles.length > 0
      && Array.isArray(entry.authorizedValues) && entry.authorizedValues.length > 0);
  const selectedDifferentiator = diagnosticDifferentiators[0]
    || toDifferentiator(canonicalPlan.selectedDifferentiator)
    || null;
  const finalTitle = safeNarrative(readString(sourceCard.displayTitle || sourceCard.title || canonical.title));
  const fallbackReason = factModel.items.length > 0 ? canonicalPlan.reasonClaim?.text : '';
  const finalReason = safeNarrative(readString(
    sourceCard.copyContract?.todayReason
      || sourceCard.todayReason
      || sourceCard.reason
      || canonical.copyContract?.todayReason
      || canonical.reason
      || fallbackReason,
  ));
  const finalTags = safeTextArray(sourceCard.styleTags || canonical.styleTags);
  const contentPlanSummary = buildContentPlanSummary(contentPlan, semanticPlan);
  const copyContractSummary = buildCopyContractSummary(copyContract, semanticPlan);
  const canonicalFactSignatureHash = hashValue(
    canonicalPlan.presentationFactSignature || factModel.presentationFactSignature,
    'presentation-fact-v2',
  );
  const contentPlanFactSignatureHash = hashValue(contentPlan.presentationFactSignature, 'presentation-fact-v2');
  const copyContractFactSignatureHash = hashValue(copyContract.presentationFactSignature, 'presentation-fact-v2');
  const canonicalRelationCode = safeCode(canonicalPlan.primaryRelationCode
    || canonicalPlan.primaryRelation?.relationCode
    || factModel.primaryRelationCode) || null;
  const contentPlanRelationCode = safeCode(contentPlan.primaryRelationCode) || null;
  const copyContractRelationCode = safeCode(copyContract.primaryRelationCode) || null;
  const factSignaturesEqual = allEqualAndPresent([
    canonicalFactSignatureHash,
    contentPlanFactSignatureHash,
    copyContractFactSignatureHash,
  ]);
  const relationBindingStatus = compareRelationCodes([
    canonicalRelationCode,
    contentPlanRelationCode,
    copyContractRelationCode,
  ]);
  const relationCodesEqual = relationBindingStatus === 'NOT_APPLICABLE'
    ? null
    : relationBindingStatus === 'MATCH';
  const titleMatchesPlan = Boolean(presentationPlan && finalTitle && canonicalPlan.titleConcept && finalTitle === canonicalPlan.titleConcept);
  const reasonMatchesPlan = Boolean(presentationPlan && finalReason && canonicalPlan.reasonClaim?.text && finalReason === canonicalPlan.reasonClaim.text);

  if (presentationPlan) {
    if (finalTitle && finalTitle !== presentationPlan.titleConcept) {
      throw new Error('presentation evidence title is not bound to the production presentation plan');
    }
    if (finalReason && finalReason !== presentationPlan.reasonClaim?.text) {
      throw new Error('presentation evidence reason is not bound to the production presentation plan');
    }
  }

  return {
    cardAlias: `C${String(cardIndex + 1).padStart(2, '0')}`,
    outfitKeyHash: hashValue(
      selectedCandidate.outfitKey
        || sourceCard.outfitKey
        || canonical.outfitKey,
      'outfit-key-v1',
    ),
    presentationFactSignatureHash: canonicalFactSignatureHash,
    itemRoles,
    primaryRelationCode: canonicalRelationCode,
    availableDifferentiators: factModel.availableDifferentiators.map(toDifferentiator).filter(Boolean).slice(0, 4),
    selectedDifferentiator,
    binding: {
      canonicalFactSignatureHash,
      contentPlanFactSignatureHash,
      copyContractFactSignatureHash,
      factSignaturesEqual,
      canonicalRelationCode,
      contentPlanRelationCode,
      copyContractRelationCode,
      relationCodesEqual,
      relationBindingStatus,
      titleMatchesPlan,
      reasonMatchesPlan,
    },
    semanticBinding: {
      source: safeCode(canonicalPlan.source) || null,
      planVersion: safeCode(canonicalPlan.version) || null,
      todayAction: safeCode(canonicalPlan.todayAction) || null,
      todayDimension: safeCode(canonicalPlan.todayDimension) || null,
      todaySubjectCount: Array.isArray(canonicalPlan.todaySubjectItemIds) ? canonicalPlan.todaySubjectItemIds.length : 0,
      todayEvidenceFactIds: sanitizeEvidenceFactIds(canonicalPlan.todayEvidenceFactIds),
      detailAction: safeCode(canonicalPlan.detailAction) || null,
      detailDimension: safeCode(canonicalPlan.detailDimension) || null,
      detailSubjectCount: Array.isArray(canonicalPlan.detailSubjectItemIds) ? canonicalPlan.detailSubjectItemIds.length : 0,
      detailEvidenceFactIds: sanitizeEvidenceFactIds(canonicalPlan.detailEvidenceFactIds),
      detailDisplay: safeCode(canonicalPlan.detailDisplay) || null,
    },
    contentPlanSummary,
    copyContractSummary,
    reasonSemanticSkeleton: semanticPlan ? buildReasonSemanticSkeleton(semanticPlan) : '',
    titleSemanticSkeleton: semanticPlan ? buildTitleSemanticSkeleton(semanticPlan) : '',
    finalTitle,
    finalReason,
    finalTags,
  };
}

function buildReasonSemanticSkeleton(plan) {
  return [
    plan?.primaryRelationCode || plan?.primaryRelation?.relationCode || '',
    plan?.reasonClaim?.relationCode || '',
    plan?.scene || plan?.factModel?.scene || '',
    ...(Array.isArray(plan?.todayCopyPlan?.clauses)
      ? plan.todayCopyPlan.clauses.map((clause) => safeCode(clause?.templateId)).filter(Boolean)
      : []),
  ].join('|');
}

function buildTitleSemanticSkeleton(plan) {
  return [
    plan?.primaryRelationCode || plan?.primaryRelation?.relationCode || '',
    plan?.titleAction || '',
    plan?.titleDimension || '',
  ].join('|');
}

function sanitizeEvidenceFactIds(values) {
  return safeTextArray((Array.isArray(values) ? values : []).map((value) => {
    const parts = String(value || '').split(':').filter(Boolean);
    return parts.at(-1) || '';
  }));
}

function buildContentPlanSummary(plan, presentationPlan) {
  return {
    sceneIntent: safeCode(plan.sceneIntent) || null,
    primaryRelationCode: safeCode(plan.primaryRelationCode) || null,
    titleConcept: safeNarrative(presentationPlan?.titleConcept),
    reasonClaim: safeNarrative(presentationPlan?.reasonClaim?.text),
  };
}

function buildCopyContractSummary(contract, presentationPlan) {
  return {
    gateResult: safeCode(contract.gateResult) || null,
    copyDisplay: safeCode(contract.copyDisplay) || null,
    todayReasonSource: safeCode(contract.todayReasonSource) || null,
    primaryRelationCode: safeCode(contract.primaryRelationCode) || null,
    unsupportedClaimCount: Number.isFinite(Number(contract.unsupportedClaimCount))
      ? Math.max(0, Number(contract.unsupportedClaimCount))
      : Array.isArray(presentationPlan?.unsupportedClaims) ? presentationPlan.unsupportedClaims.length : 0,
  };
}

function toDifferentiators(value) {
  return (Array.isArray(value) ? value : [])
    .map(toDifferentiator)
    .filter(Boolean);
}

function toDifferentiator(value) {
  const source = asObject(value);
  const key = readString(source.key);
  const parts = key.split(':');
  const type = safeCode(parts.at(-1)) || safeCode(source.type);
  if (!type) return null;
  const role = safeCode(parts.length > 1 ? parts[0] : source.role) || null;
  const authorizedValues = Array.isArray(source.authorizedValues)
    ? source.authorizedValues.map((entry) => safeFactText(entry)).filter(Boolean)
    : [];
  const authorizedValue = safeFactText(source.value || source.authorizedValue) || authorizedValues[0] || '';
  if (!authorizedValue) return null;
  return {
    type,
    role,
    ...(type === 'relation' ? {
      relationCode: safeCode(source.relationCode) || null,
      roles: (Array.isArray(source.roles) ? source.roles : role ? [role] : [])
        .map((entry) => safeCode(entry)).filter(Boolean),
      authorizedValues,
    } : {}),
    authorizedValue,
  };
}

function readSharedPlanVersion(plans, cards) {
  const source = [...(Array.isArray(plans) ? plans : []), ...(Array.isArray(cards) ? cards : [])]
    .map(readPresentationPlan)
    .find(Boolean);
  return safeCode(source?.version) || null;
}

function readSharedCopyContractVersion(...groups) {
  for (const group of groups) {
    const entries = Array.isArray(group) ? group : [group];
    for (const entry of entries) {
      const source = asObject(entry?.copyContract || entry);
      const version = safeCode(source.copyContractVersion);
      if (version) return version;
    }
  }
  return null;
}

function allEqualAndPresent(values) {
  return Array.isArray(values)
    && values.length > 0
    && values.every((value) => value !== null && value !== undefined && value !== '')
    && values.every((value) => value === values[0]);
}

function compareRelationCodes(values) {
  const applicable = (Array.isArray(values) ? values : [])
    .filter((value) => value !== null && value !== undefined && value !== '');
  if (applicable.length === 0) return 'NOT_APPLICABLE';
  return applicable.every((value) => value === applicable[0]) ? 'MATCH' : 'MISMATCH';
}

function findMatchingEntry(entries, card, index) {
  const list = Array.isArray(entries) ? entries : [];
  const key = readString(card?.outfitKey);
  return (key ? list.find((entry) => readString(entry?.outfitKey) === key) : null) || list[index] || null;
}

function collectSensitiveValues(...groups) {
  return groups.flatMap((group) => (Array.isArray(group) ? group : []))
    .flatMap((entry) => [
      entry?.outfitKey,
      ...(Array.isArray(entry?.itemIds) ? entry.itemIds : []),
      ...(Array.isArray(entry?.clothingIds) ? entry.clothingIds : []),
      ...(Array.isArray(entry?.items) ? entry.items.map(readInternalId) : []),
    ])
    .filter((value) => typeof value === 'string' && value.length > 0);
}

function assertPresentationEvidenceSafe(value, sensitiveValues = []) {
  const forbiddenKeys = /^(?:openid|userId|clothingId|clothingIds|itemId|itemIds|ownerHash|candidatePoolId|recommendationBatchId|requestedCandidatePoolId)$/i;
  const sensitive = new Set(sensitiveValues.map(String));
  const visit = (current, key = '') => {
    if (forbiddenKeys.test(key) && !(key.toLowerCase() === 'candidatepoolid' && current === null)) {
      throw new Error(`presentation evidence contains forbidden key: ${key}`);
    }
    if (typeof current === 'string') {
      if (/https?:\/\/|file:\/\/|cloud:\/\/|[A-Za-z]:\\|^(?:[\\/]|\.\.?[\\/])|^(?:uploads?|tmp|var|home|Users|workspace)[\\/]/i.test(current)) {
        throw new Error('presentation evidence contains URL or path');
      }
      if (/(?:openid|userId|clothingId|itemId|ownerHash|candidatePoolId|recommendationBatchId)/i.test(current)) {
        throw new Error('presentation evidence contains forbidden identity text');
      }
      for (const raw of sensitive) {
        if (raw && current.includes(raw)) throw new Error('presentation evidence contains raw identity');
      }
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((entry) => visit(entry));
      return;
    }
    if (current && typeof current === 'object') {
      Object.entries(current).forEach(([childKey, childValue]) => visit(childValue, childKey));
    }
  };
  visit(value);
  return true;
}

function assertPresentationEvidenceBudget(value, maxBytes = PRESENTATION_EVIDENCE_MAX_BYTES) {
  const bytes = serializedBytes(value);
  if (bytes >= maxBytes) throw new Error(`presentation evidence exceeds ${maxBytes} bytes: ${bytes}`);
  return bytes;
}

function measurePresentationEvidence(value) {
  const source = asObject(value);
  const cards = Array.isArray(source.cards) ? source.cards : [];
  const pathBytes = [];
  const visit = (current, path) => {
    pathBytes.push({ path, bytes: serializedBytes(current) });
    if (Array.isArray(current)) {
      current.forEach((entry, index) => visit(entry, `${path}[${index}]`));
    } else if (current && typeof current === 'object') {
      Object.entries(current).forEach(([key, child]) => visit(child, `${path}.${key}`));
    }
  };
  visit(source, '$');
  return {
    totalBytes: serializedBytes(source),
    topLevelBytes: Object.fromEntries(Object.entries(source)
      .map(([key, child]) => [key, serializedBytes(child)])),
    cardBytes: cards.map((card, index) => ({
      cardAlias: card?.cardAlias || `C${String(index + 1).padStart(2, '0')}`,
      bytes: serializedBytes(card),
    })),
    duplicateFieldBytes: {
      presentationFactSignatureHash: serializedBytes(cards.map((card) => card?.presentationFactSignatureHash || null)),
      contentPlanFactSignatureHash: serializedBytes(cards.map((card) => card?.binding?.contentPlanFactSignatureHash || null)),
      copyContractFactSignatureHash: serializedBytes(cards.map((card) => card?.binding?.copyContractFactSignatureHash || null)),
      factModel: serializedBytes(cards.map((card) => card?.factModel || null)),
      availableDifferentiators: serializedBytes(cards.map((card) => card?.availableDifferentiators || [])),
      titleSemanticSkeleton: serializedBytes(cards.map((card) => card?.titleSemanticSkeleton || null)),
      reasonSemanticSkeleton: serializedBytes(cards.map((card) => card?.reasonSemanticSkeleton || null)),
      shared: serializedBytes(source.shared || null),
    },
    largestPaths: pathBytes.sort((left, right) => right.bytes - left.bytes).slice(0, 20),
  };
}

function serializedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function hashValue(value, domain = 'presentation-value-v1') {
  const text = readString(value);
  if (!text) return null;
  return crypto.createHash('sha256').update(`${domain}|${text}`, 'utf8').digest('hex').slice(0, PRESENTATION_HASH_LENGTH);
}

function safeAuditId(value) {
  return safeText(value, 80) || 'missing-audit-id';
}

function safeCode(value) {
  const text = readString(value);
  return /^[A-Za-z0-9:_+.-]{1,96}$/.test(text) ? text : '';
}

function safeNarrative(value) {
  return safeFactText(value, 320);
}

function safeFactText(value, maxLength = 96) {
  const text = readString(value);
  if (!text || text.length > maxLength
    || /https?:\/\/|file:\/\/|cloud:\/\/|[A-Za-z]:\\|^(?:[\\/]|\.\.?[\\/])|^(?:uploads?|tmp|var|home|Users|workspace)[\\/]/i.test(text)
    || /(?:openid|userId|clothingId|itemId|ownerHash|candidatePoolId|recommendationBatchId)/i.test(text)) return null;
  if (/(?:^|[_:-])(?:top|bottom|shoe|item|clothing|outfit)[-_]?\d+(?:$|[^A-Za-z0-9])/.test(text)) return null;
  return text;
}

function safeText(value, maxLength) {
  return safeFactText(value, maxLength);
}

function safeTextArray(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((entry) => safeNarrative(entry)).filter(Boolean))].slice(0, 8);
}

function normalizeSceneCode(value) {
  const scene = readString(value).toLowerCase();
  if (scene === 'home' || scene.includes('灞呭')) return 'home';
  if (scene === 'work' || scene.includes('涓婄彮') || scene.includes('閫氬嫟')) return 'work';
  if (scene === 'date' || scene.includes('绾︿細')) return 'date';
  if (scene === 'sport' || scene === 'sports' || scene.includes('杩愬姩')) return 'sport';
  return safeCode(scene) || null;
}

function readInternalId(value) {
  const id = value?._id || value?.id || value?.itemId || value?.clothingId;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : '';
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function firstObject(...values) {
  return values.find((value) => value && typeof value === 'object' && !Array.isArray(value)) || {};
}

module.exports = {
  PRESENTATION_EVIDENCE_MAX_BYTES,
  PRESENTATION_EVIDENCE_MODE,
  PRESENTATION_EVIDENCE_VERSION,
  assertPresentationEvidenceBudget,
  assertPresentationEvidenceSafe,
  buildPresentationEvidence,
  isPresentationEvidenceMode,
  measurePresentationEvidence,
  serializedBytes,
};
