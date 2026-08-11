const { findHumanCopyPolicyViolations } = require('./humanCopyPolicy');
const { inspectXiaodaPersonaCopy } = require('./xiaodaPersonaContract');
const {
  DECISION_VALUE_CATEGORIES,
  COMPOSED_MESSAGE_DEFINITIONS,
  DETAIL_MESSAGE_DEFINITIONS,
  NATURAL_LANGUAGE_PLAN_VERSION,
  RELATION_MESSAGE_DEFINITIONS,
  SCENE_MESSAGE_DEFINITIONS,
  XIAODA_STYLE_MESSAGE_DEFINITIONS,
  joinClauses,
} = require('./recommendationNaturalLanguage');

const COPY_NATURALNESS_GATE_VERSION = 'copy-naturalness-gate-v3';
const COPY_NATURALNESS_PASS = 'PASS';
const COPY_NATURALNESS_REJECT = 'REJECT';
const DECISION_VALUE_GATE_VERSION = 'decision-value-gate-v1';
const DECISION_VALUE_PASS = 'PASS';
const DECISION_VALUE_REJECT = 'REJECT';

const DECISION_VALUE_FLAGS = Object.freeze({
  INVALID_PLAN: 'INVALID_PLAN',
  LOW_VALUE_FINAL_REASON: 'LOW_VALUE_FINAL_REASON',
});

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
  NO_INCREMENTAL_INFORMATION: 'NO_INCREMENTAL_INFORMATION',
  LOW_VALUE_FINAL_REASON: 'LOW_VALUE_FINAL_REASON',
  LANGUAGE_POLICY_VIOLATION: 'LANGUAGE_POLICY_VIOLATION',
  TEXT_COMPOSITION_MISMATCH: 'TEXT_COMPOSITION_MISMATCH',
  MESSAGE_INTENT_MISMATCH: 'MESSAGE_INTENT_MISMATCH',
  INVALID_VALUE_ASSESSMENT: 'INVALID_VALUE_ASSESSMENT',
  KNOWN_LOW_VALUE_SENTENCE: 'KNOWN_LOW_VALUE_SENTENCE',
  XIAODA_PERSONA_VIOLATION: 'XIAODA_PERSONA_VIOLATION',
});

const EDITORIAL_TAILS = /(?:配色简洁|整体协调|更显质感|整体更完整|整体利落|画面清爽|视觉重点清楚|整体更清楚)[。！]?$/u;
const MECHANICAL_SCENE = /适合(?:居家|通勤|约会|日常|运动|轻运动).{0,4}(?:场景)?|(?:宅家时|日常通勤|约会时|日常轻运动)可以直接这样穿/u;
const SYSTEM_CHECKLIST_TONE = /(?:已经配齐|已经配上|唯一有明确事实|已经配成上下装|已经配成一身)/u;
const KNOWN_LOW_VALUE_SENTENCE = /(?:印花已经是这身的重点|其他单品沿用.+就好|组成一套.+不用临时补搭|这套(?:结构|活动结构).*(?:方便|轻便)|这套有清楚的搭配关系|用同色呼应|在家穿不会裹得太多)/u;
function evaluateCopyNaturalness(planValue) {
  const plan = normalizePlan(planValue);
  if (!plan) return reject([COPY_NATURALNESS_FLAGS.INVALID_PLAN]);
  const flags = [];
  const allowedPatterns = plan.surface === 'detail' ? ['detail_message'] : ['natural_message'];
  if (!allowedPatterns.includes(plan.compositionPattern)) flags.push(COPY_NATURALNESS_FLAGS.INVALID_SLOT_ORDER);
  if (plan.text !== joinClauses(plan.clauses)) flags.push(COPY_NATURALNESS_FLAGS.TEXT_COMPOSITION_MISMATCH);
  if (EDITORIAL_TAILS.test(plan.text)) flags.push(COPY_NATURALNESS_FLAGS.GENERIC_EDITORIAL_TAIL);
  if (MECHANICAL_SCENE.test(plan.text)) flags.push(COPY_NATURALNESS_FLAGS.MECHANICAL_SCENE_RESTATEMENT);
  if (SYSTEM_CHECKLIST_TONE.test(plan.text)) flags.push(COPY_NATURALNESS_FLAGS.SYSTEM_CHECKLIST_TONE);
  if (KNOWN_LOW_VALUE_SENTENCE.test(plan.text)) flags.push(COPY_NATURALNESS_FLAGS.KNOWN_LOW_VALUE_SENTENCE);
  if (findHumanCopyPolicyViolations(plan.text).length > 0) flags.push(COPY_NATURALNESS_FLAGS.LANGUAGE_POLICY_VIOLATION);
  if (!inspectXiaodaPersonaCopy(plan.text).passed) flags.push(COPY_NATURALNESS_FLAGS.XIAODA_PERSONA_VIOLATION);

  if (plan.clauses.length !== 1) flags.push(COPY_NATURALNESS_FLAGS.INVALID_SLOT_ORDER);
  const informationKeys = new Set();
  for (const clause of plan.clauses) {
    const definition = findTemplateDefinition(plan.surface, clause);
    if (!definition) flags.push(COPY_NATURALNESS_FLAGS.UNKNOWN_TEMPLATE);
    if (definition?.incrementalInformation !== true) flags.push(COPY_NATURALNESS_FLAGS.NO_INCREMENTAL_INFORMATION);
    if (!clause.templateId || !clause.informationKey || !clause.source
      || clause.subjectItemIds.length === 0
      || clause.evidenceFactIds.length + clause.authorizationIds.length === 0) {
      flags.push(COPY_NATURALNESS_FLAGS.MISSING_PROVENANCE);
    }
    if (informationKeys.has(clause.informationKey)) flags.push(COPY_NATURALNESS_FLAGS.DUPLICATE_INFORMATION);
    informationKeys.add(clause.informationKey);
    if (clause.relationCode !== plan.relationCode) flags.push(COPY_NATURALNESS_FLAGS.RELATION_BINDING_MISMATCH);
    if (clause.scene !== plan.scene) flags.push(COPY_NATURALNESS_FLAGS.SCENE_BINDING_MISMATCH);
    if (clause.messageIntent !== plan.messageIntent || clause.messageIntent !== definition?.intent) {
      flags.push(COPY_NATURALNESS_FLAGS.MESSAGE_INTENT_MISMATCH);
    }
    if (['core_eligibility', 'evidence_composition'].includes(clause.source)
      && clause.authorizationIds.length === 0) {
      flags.push(COPY_NATURALNESS_FLAGS.MECHANICAL_SCENE_RESTATEMENT);
    }
    if (!isValidValueAssessment(clause.valueAssessment)
      || !sameValueAssessment(clause.valueAssessment, plan.valueAssessment)) {
      flags.push(COPY_NATURALNESS_FLAGS.INVALID_VALUE_ASSESSMENT);
    }
  }
  if (plan.surface === 'today' && evaluateNormalizedDecisionValue(plan).result !== DECISION_VALUE_PASS) {
    flags.push(COPY_NATURALNESS_FLAGS.LOW_VALUE_FINAL_REASON);
  }
  return flags.length > 0 ? reject(flags) : pass();
}

function evaluateDecisionValue(planValue) {
  const plan = normalizePlan(planValue);
  if (!plan) return rejectDecisionValue([DECISION_VALUE_FLAGS.INVALID_PLAN], []);
  return evaluateNormalizedDecisionValue(plan);
}

function evaluateNormalizedDecisionValue(plan) {
  const clauses = plan.clauses.map((clause) => {
    const definition = findTemplateDefinition(plan.surface, clause);
    return {
      slot: clause.slot,
      templateId: clause.templateId,
      messageIntent: clause.messageIntent,
      category: isValidValueAssessment(clause.valueAssessment)
        ? definition?.decisionValue || DECISION_VALUE_CATEGORIES.FACTUAL_BUT_LOW_VALUE
        : DECISION_VALUE_CATEGORIES.FACTUAL_BUT_LOW_VALUE,
    };
  });
  const categories = uniqueStrings(clauses.map((clause) => clause.category));
  const meaningfulCategories = new Set([
    DECISION_VALUE_CATEGORIES.MEANINGFUL_RELATION,
    DECISION_VALUE_CATEGORIES.MEANINGFUL_SCENE_EVIDENCE,
    DECISION_VALUE_CATEGORIES.MEANINGFUL_BENEFIT,
  ]);
  if (categories.some((category) => meaningfulCategories.has(category))) {
    return {
      version: DECISION_VALUE_GATE_VERSION,
      result: DECISION_VALUE_PASS,
      riskFlags: [],
      categories,
      clauses,
    };
  }
  return rejectDecisionValue([DECISION_VALUE_FLAGS.LOW_VALUE_FINAL_REASON], clauses);
}

function normalizePlan(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const surface = value.surface === 'today' || value.surface === 'detail' ? value.surface : '';
  const scene = readString(value.scene);
  const relationCode = readString(value.relationCode);
  const compositionPattern = readString(value.compositionPattern);
  const text = readString(value.text);
  const clauses = Array.isArray(value.clauses) ? value.clauses.map(normalizeClause).filter(Boolean) : [];
  const messageIntent = readString(value.messageIntent);
  const valueAssessment = normalizeValueAssessment(value.valueAssessment);
  if (value.version !== NATURAL_LANGUAGE_PLAN_VERSION || !surface || !scene || !relationCode
    || !messageIntent || !text || clauses.length === 0 || !valueAssessment) return null;
  return { surface, scene, relationCode, messageIntent, valueAssessment, compositionPattern, text, clauses };
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
    messageIntent: readString(value.messageIntent),
    text,
    informationKey: readString(value.informationKey),
    subjectItemIds: uniqueStrings(value.subjectItemIds),
    evidenceFactIds: uniqueStrings(value.evidenceFactIds),
    authorizationIds: uniqueStrings(value.authorizationIds),
    relationCode: readString(value.relationCode),
    scene: readString(value.scene),
    source: readString(value.source),
    valueAssessment: normalizeValueAssessment(value.valueAssessment),
  };
}

function findTemplateDefinition(surface, clause) {
  const xiaodaDefinition = XIAODA_STYLE_MESSAGE_DEFINITIONS.find((entry) => entry.id === clause.templateId);
  if (xiaodaDefinition) return xiaodaDefinition;
  const bank = surface === 'detail'
    ? DETAIL_MESSAGE_DEFINITIONS
    : [...RELATION_MESSAGE_DEFINITIONS, ...SCENE_MESSAGE_DEFINITIONS, ...COMPOSED_MESSAGE_DEFINITIONS];
  return bank.find((entry) => entry.id === clause.templateId) || null;
}

function normalizeValueAssessment(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const normalized = {
    factAvailable: value.factAvailable === true,
    userValue: Number(value.userValue),
    novelInformation: Number(value.novelInformation),
    sceneRelevance: Number(value.sceneRelevance),
    naturalExpressibility: Number(value.naturalExpressibility),
    total: Number(value.total),
  };
  return Object.values(normalized).every((entry) => typeof entry === 'boolean' || Number.isFinite(entry))
    ? normalized : null;
}

function isValidValueAssessment(value) {
  return Boolean(value?.factAvailable === true
    && value.userValue >= 2
    && value.novelInformation >= 2
    && value.naturalExpressibility >= 2
    && value.total === 2 + value.userValue + value.novelInformation
      + value.sceneRelevance + value.naturalExpressibility);
}

function sameValueAssessment(left, right) {
  return JSON.stringify(left || null) === JSON.stringify(right || null);
}

function pass() {
  return { version: COPY_NATURALNESS_GATE_VERSION, result: COPY_NATURALNESS_PASS, riskFlags: [] };
}

function reject(flags) {
  return { version: COPY_NATURALNESS_GATE_VERSION, result: COPY_NATURALNESS_REJECT, riskFlags: uniqueStrings(flags) };
}

function rejectDecisionValue(flags, clauses) {
  return {
    version: DECISION_VALUE_GATE_VERSION,
    result: DECISION_VALUE_REJECT,
    riskFlags: uniqueStrings(flags),
    categories: uniqueStrings(clauses.map((clause) => clause.category)),
    clauses,
  };
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
  DECISION_VALUE_CATEGORIES,
  DECISION_VALUE_FLAGS,
  DECISION_VALUE_GATE_VERSION,
  DECISION_VALUE_PASS,
  DECISION_VALUE_REJECT,
  evaluateDecisionValue,
  evaluateCopyNaturalness,
};
