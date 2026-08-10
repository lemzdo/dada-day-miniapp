const { findHumanCopyPolicyViolations } = require('./humanCopyPolicy');
const {
  BENEFIT_SLOTS,
  DETAIL_RELATION_SLOTS,
  NATURAL_LANGUAGE_PLAN_VERSION,
  RELATION_SLOTS,
  SCENE_VALUE_SLOTS,
  joinClauses,
} = require('./recommendationNaturalLanguage');

const COPY_NATURALNESS_GATE_VERSION = 'copy-naturalness-gate-v1';
const COPY_NATURALNESS_PASS = 'PASS';
const COPY_NATURALNESS_REJECT = 'REJECT';

const COPY_NATURALNESS_FLAGS = Object.freeze({
  INVALID_PLAN: 'INVALID_PLAN',
  INVALID_SLOT_ORDER: 'INVALID_SLOT_ORDER',
  UNKNOWN_TEMPLATE: 'UNKNOWN_TEMPLATE',
  MISSING_PROVENANCE: 'MISSING_PROVENANCE',
  RELATION_BINDING_MISMATCH: 'RELATION_BINDING_MISMATCH',
  SCENE_BINDING_MISMATCH: 'SCENE_BINDING_MISMATCH',
  BENEFIT_WITHOUT_NEW_EVIDENCE: 'BENEFIT_WITHOUT_NEW_EVIDENCE',
  DUPLICATE_INFORMATION: 'DUPLICATE_INFORMATION',
  MECHANICAL_SCENE_RESTATEMENT: 'MECHANICAL_SCENE_RESTATEMENT',
  GENERIC_EDITORIAL_TAIL: 'GENERIC_EDITORIAL_TAIL',
  SYSTEM_CHECKLIST_TONE: 'SYSTEM_CHECKLIST_TONE',
  LANGUAGE_POLICY_VIOLATION: 'LANGUAGE_POLICY_VIOLATION',
  TEXT_COMPOSITION_MISMATCH: 'TEXT_COMPOSITION_MISMATCH',
});

const EDITORIAL_TAILS = /(?:配色简洁|整体协调|更显质感|整体更完整|整体利落|画面清爽|视觉重点清楚|整体更清楚)[。！]?$/u;
const MECHANICAL_SCENE = /适合(?:居家|通勤|约会|日常|运动|轻运动).{0,4}(?:场景)?/u;
const SYSTEM_CHECKLIST_TONE = /(?:已经配齐|已经配上|唯一有明确事实|已经配成上下装|已经配成一身)/u;
const SCENE_SEMANTIC_TOKENS = Object.freeze({
  home: Object.freeze(['宅家', '居家']),
  work: Object.freeze(['通勤', '上班']),
  date: Object.freeze(['约会']),
  sport: Object.freeze(['轻运动']),
});

function evaluateCopyNaturalness(planValue) {
  const plan = normalizePlan(planValue);
  if (!plan) return reject([COPY_NATURALNESS_FLAGS.INVALID_PLAN]);
  const flags = [];
  const allowedPatterns = plan.surface === 'detail'
    ? ['relation']
    : ['relation', 'relation>scene_value', 'relation>scene_value>benefit'];
  if (!allowedPatterns.includes(plan.compositionPattern)) flags.push(COPY_NATURALNESS_FLAGS.INVALID_SLOT_ORDER);
  if (plan.text !== joinClauses(plan.clauses)) flags.push(COPY_NATURALNESS_FLAGS.TEXT_COMPOSITION_MISMATCH);
  if (EDITORIAL_TAILS.test(plan.text)) flags.push(COPY_NATURALNESS_FLAGS.GENERIC_EDITORIAL_TAIL);
  if (MECHANICAL_SCENE.test(plan.text)) flags.push(COPY_NATURALNESS_FLAGS.MECHANICAL_SCENE_RESTATEMENT);
  if (SYSTEM_CHECKLIST_TONE.test(plan.text)) flags.push(COPY_NATURALNESS_FLAGS.SYSTEM_CHECKLIST_TONE);
  if (findHumanCopyPolicyViolations(plan.text).length > 0) flags.push(COPY_NATURALNESS_FLAGS.LANGUAGE_POLICY_VIOLATION);

  const informationKeys = new Set();
  const usedEvidence = new Set();
  for (const clause of plan.clauses) {
    if (!isKnownTemplate(plan.surface, clause)) flags.push(COPY_NATURALNESS_FLAGS.UNKNOWN_TEMPLATE);
    if (!clause.templateId || !clause.informationKey || !clause.source
      || clause.subjectItemIds.length === 0
      || clause.evidenceFactIds.length + clause.authorizationIds.length === 0) {
      flags.push(COPY_NATURALNESS_FLAGS.MISSING_PROVENANCE);
    }
    if (informationKeys.has(clause.informationKey)) flags.push(COPY_NATURALNESS_FLAGS.DUPLICATE_INFORMATION);
    informationKeys.add(clause.informationKey);
    if (clause.relationCode !== plan.relationCode) flags.push(COPY_NATURALNESS_FLAGS.RELATION_BINDING_MISMATCH);
    if (clause.scene !== plan.scene) flags.push(COPY_NATURALNESS_FLAGS.SCENE_BINDING_MISMATCH);
    if (clause.slot === 'scene_value' && (clause.source !== 'core_eligibility' || clause.authorizationIds.length === 0)) {
      flags.push(COPY_NATURALNESS_FLAGS.MECHANICAL_SCENE_RESTATEMENT);
    }
    if (clause.slot === 'benefit') {
      const newEvidence = clause.evidenceFactIds.filter((factId) => !usedEvidence.has(factId));
      if (newEvidence.length === 0 || clause.source !== 'core_eligibility_benefit') {
        flags.push(COPY_NATURALNESS_FLAGS.BENEFIT_WITHOUT_NEW_EVIDENCE);
      }
      const sceneClause = plan.clauses.find((entry) => entry.slot === 'scene_value');
      const sceneTokens = SCENE_SEMANTIC_TOKENS[plan.scene] || [];
      if (sceneClause && sceneTokens.some((token) => sceneClause.text.includes(token) && clause.text.includes(token))) {
        flags.push(COPY_NATURALNESS_FLAGS.DUPLICATE_INFORMATION);
      }
    }
    clause.evidenceFactIds.forEach((factId) => usedEvidence.add(factId));
  }
  return flags.length > 0 ? reject(flags) : pass();
}

function normalizePlan(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const surface = value.surface === 'today' || value.surface === 'detail' ? value.surface : '';
  const scene = readString(value.scene);
  const relationCode = readString(value.relationCode);
  const compositionPattern = readString(value.compositionPattern);
  const text = readString(value.text);
  const clauses = Array.isArray(value.clauses) ? value.clauses.map(normalizeClause).filter(Boolean) : [];
  if (value.version !== NATURAL_LANGUAGE_PLAN_VERSION || !surface || !scene || !relationCode || !text || clauses.length === 0) return null;
  return { surface, scene, relationCode, compositionPattern, text, clauses };
}

function normalizeClause(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const slot = readString(value.slot);
  const templateId = readString(value.templateId);
  const text = readString(value.text);
  if (!slot || !templateId || !text) return null;
  return {
    slot,
    templateId,
    text,
    informationKey: readString(value.informationKey),
    subjectItemIds: uniqueStrings(value.subjectItemIds),
    evidenceFactIds: uniqueStrings(value.evidenceFactIds),
    authorizationIds: uniqueStrings(value.authorizationIds),
    relationCode: readString(value.relationCode),
    scene: readString(value.scene),
    source: readString(value.source),
  };
}

function isKnownTemplate(surface, clause) {
  if (clause.slot === 'relation') {
    const bank = surface === 'detail' ? DETAIL_RELATION_SLOTS : RELATION_SLOTS;
    return Object.values(bank).some((entry) => entry.id === clause.templateId);
  }
  if (clause.slot === 'scene_value') {
    return Object.values(SCENE_VALUE_SLOTS).some((entry) => entry.id === clause.templateId);
  }
  if (clause.slot === 'benefit') {
    return BENEFIT_SLOTS.some((entry) => entry.id === clause.templateId);
  }
  return false;
}

function pass() {
  return { version: COPY_NATURALNESS_GATE_VERSION, result: COPY_NATURALNESS_PASS, riskFlags: [] };
}

function reject(flags) {
  return { version: COPY_NATURALNESS_GATE_VERSION, result: COPY_NATURALNESS_REJECT, riskFlags: uniqueStrings(flags) };
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(readString).filter(Boolean))];
}

module.exports = {
  COPY_NATURALNESS_FLAGS,
  COPY_NATURALNESS_GATE_VERSION,
  COPY_NATURALNESS_PASS,
  COPY_NATURALNESS_REJECT,
  evaluateCopyNaturalness,
};
