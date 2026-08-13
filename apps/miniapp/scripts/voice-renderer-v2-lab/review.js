'use strict';

const crypto = require('node:crypto');

const REVIEW_VERSION = 'voice-renderer-v2-sol-review-v1';
const REVIEW_CRITERIA = Object.freeze([
  'meaningPreserved',
  'noNewReason',
  'noNewFact',
  'claimObedience',
  'naturalChinese',
  'personaConsistency',
  'baselineRestraint',
]);

function summarizeRuns(artifact) {
  assertCompleteArtifact(artifact);
  const caseIds = artifact.goldPlans.map((plan) => plan.caseId);
  const modelAliases = Object.keys(artifact.models);
  const models = Object.fromEntries(modelAliases.map((alias) => {
    const calls = artifact.calls.filter((call) => call.modelAlias === alias);
    const cases = Object.fromEntries(caseIds.map((caseId) => {
      const rows = calls.map((call) => rowForCase(call, caseId));
      const texts = rows.map((row) => row.output.text);
      const objectiveFailures = rows.flatMap((row) => row.check.failures);
      return [caseId, {
        repetitions: rows.length,
        uniqueTextCount: new Set(texts).size,
        exactRepeatStable: new Set(texts).size === 1,
        averagePairSimilarity: averagePairSimilarity(texts),
        automatedPassCount: rows.filter((row) => row.check.pass).length,
        automatedFailureCounts: countValues(objectiveFailures),
        averageLength: average(texts.map((text) => [...text].length)),
        outputs: rows.map((row) => ({
          repetition: row.call.repetition,
          planId: row.output.planId,
          insightId: row.output.insightId,
          text: row.output.text,
          automatedPass: row.check.pass,
          automatedFailures: row.check.failures.slice(),
        })),
      }];
    }));
    const caseRows = Object.values(cases);
    return [alias, {
      callCount: calls.length,
      outputCount: calls.flatMap((call) => call.outputs).length,
      automatedCasePasses: caseRows.reduce((sum, entry) => sum + entry.automatedPassCount, 0),
      automatedCaseFailures: caseRows.reduce((sum, entry) => sum + entry.repetitions - entry.automatedPassCount, 0),
      exactRepeatStableCases: caseRows.filter((entry) => entry.exactRepeatStable).length,
      cases,
    }];
  }));
  return {
    version: 'voice-renderer-v2-stability-summary-v1',
    sourceVersion: artifact.version,
    repetitions: artifact.repetitions,
    caseCount: artifact.goldPlans.length,
    models,
    manualReviewRequired: true,
  };
}

function buildBlindReview(artifact) {
  assertCompleteArtifact(artifact);
  const aliases = Object.keys(artifact.models);
  if (aliases.length !== 2 || !aliases.includes('max') || !aliases.includes('plus')) {
    throw new Error('BLIND_REVIEW_REQUIRES_MAX_PLUS');
  }
  const goldByCase = new Map(artifact.goldPlans.map((plan) => [plan.caseId, plan]));
  const entries = [];
  for (const caseId of goldByCase.keys()) {
    const gold = goldByCase.get(caseId);
    for (let repetition = 1; repetition <= artifact.repetitions; repetition += 1) {
      const max = outputFor(artifact, 'max', repetition, caseId);
      const plus = outputFor(artifact, 'plus', repetition, caseId);
      const maxFirst = blindMaxFirst(caseId, repetition, artifact.inputFingerprint);
      const candidates = maxFirst
        ? [{ label: 'A', text: max.text }, { label: 'B', text: plus.text }]
        : [{ label: 'A', text: plus.text }, { label: 'B', text: max.text }];
      entries.push({
        reviewId: `${caseId}:r${repetition}`,
        caseId,
        repetition,
        expressionMode: gold.expressionMode,
        goldMeaning: gold.primary?.meaning || '只允许诚实表达这是简单、日常的组合，不新增穿搭理由。',
        garments: gold.garments.slice(),
        allowedClaims: gold.allowedClaims.slice(),
        candidates,
        judgment: null,
      });
    }
  }
  return {
    review: {
      version: REVIEW_VERSION,
      sourceVersion: artifact.version,
      criteria: REVIEW_CRITERIA.slice(),
      instructions: 'Sol 逐句审阅 A/B；不得用自动分数替代中文判断。完成 judgment 后再运行 finalizeReview。',
      entries,
    },
    sealedModelMap: Object.fromEntries(entries.map((entry) => {
      const maxFirst = blindMaxFirst(entry.caseId, entry.repetition, artifact.inputFingerprint);
      return [entry.reviewId, maxFirst ? { A: 'max', B: 'plus' } : { A: 'plus', B: 'max' }];
    })),
  };
}

function finalizeReview(review, sealedModelMap) {
  if (review?.version !== REVIEW_VERSION || !Array.isArray(review.entries) || review.entries.length === 0) {
    throw new Error('REVIEW_INVALID');
  }
  const allowedOutcomes = new Set(['A', 'B', 'TIE', 'BOTH_FAIL']);
  const judgments = review.entries.map((entry) => {
    const judgment = entry.judgment;
    if (!judgment || !allowedOutcomes.has(judgment.outcome)) throw new Error(`REVIEW_INCOMPLETE:${entry.reviewId}`);
    for (const label of ['A', 'B']) {
      const evaluation = judgment[label];
      if (!evaluation || typeof evaluation.notes !== 'string') throw new Error(`REVIEW_EVALUATION:${entry.reviewId}:${label}`);
      for (const criterion of REVIEW_CRITERIA) {
        if (typeof evaluation[criterion] !== 'boolean') throw new Error(`REVIEW_CRITERION:${entry.reviewId}:${label}:${criterion}`);
      }
    }
    const mapping = sealedModelMap?.[entry.reviewId];
    if (!mapping) throw new Error(`REVIEW_MAP:${entry.reviewId}`);
    const outcome = judgment.outcome === 'A' || judgment.outcome === 'B'
      ? mapping[judgment.outcome].toUpperCase()
      : judgment.outcome;
    return {
      reviewId: entry.reviewId,
      caseId: entry.caseId,
      repetition: entry.repetition,
      outcome,
      max: judgment[mapping.A === 'max' ? 'A' : 'B'],
      plus: judgment[mapping.A === 'plus' ? 'A' : 'B'],
    };
  });
  return {
    version: 'voice-renderer-v2-sol-review-summary-v1',
    status: 'SOL_REVIEWED',
    judgmentCount: judgments.length,
    outcomeCounts: countValues(judgments.map((entry) => entry.outcome)),
    modelCriteria: Object.fromEntries(['max', 'plus'].map((alias) => [alias, Object.fromEntries(REVIEW_CRITERIA.map((criterion) => [
      criterion,
      {
        pass: judgments.filter((entry) => entry[alias][criterion]).length,
        fail: judgments.filter((entry) => !entry[alias][criterion]).length,
      },
    ]))])),
    judgments,
  };
}

function assertCompleteArtifact(artifact) {
  if (artifact?.status !== 'complete') throw new Error('ARTIFACT_NOT_COMPLETE');
  if (!Array.isArray(artifact.goldPlans) || !Array.isArray(artifact.calls)) throw new Error('ARTIFACT_INVALID');
  if (!Number.isInteger(artifact.repetitions) || artifact.repetitions < 1) throw new Error('ARTIFACT_REPETITIONS');
  const aliases = Object.keys(artifact.models || {});
  if (aliases.length === 0) throw new Error('ARTIFACT_MODELS');
  for (const alias of aliases) {
    const calls = artifact.calls.filter((call) => call.modelAlias === alias);
    if (calls.length !== artifact.repetitions) throw new Error(`ARTIFACT_CALL_COUNT:${alias}`);
    const repetitions = calls.map((call) => call.repetition).sort((left, right) => left - right);
    if (repetitions.some((value, index) => value !== index + 1)) throw new Error(`ARTIFACT_REPETITION_SEQUENCE:${alias}`);
    for (const call of calls) {
      if (call.outputs.length !== artifact.goldPlans.length || call.checks.length !== artifact.goldPlans.length) {
        throw new Error(`ARTIFACT_CASE_COUNT:${alias}:${call.repetition}`);
      }
    }
  }
}

function rowForCase(call, caseId) {
  const check = call.checks.find((entry) => entry.caseId === caseId);
  if (!check) throw new Error(`CHECK_MISSING:${call.modelAlias}:${call.repetition}:${caseId}`);
  const resolvedOutput = call.outputs.find((entry) => entry.caseId === caseId || entry.planId === check.planId);
  if (!resolvedOutput) throw new Error(`OUTPUT_MISSING:${call.modelAlias}:${call.repetition}:${caseId}`);
  return { output: resolvedOutput, check, call };
}

function outputFor(artifact, alias, repetition, caseId) {
  const call = artifact.calls.find((entry) => entry.modelAlias === alias && entry.repetition === repetition);
  if (!call) throw new Error(`CALL_MISSING:${alias}:${repetition}`);
  return rowForCase(call, caseId).output;
}

function blindMaxFirst(caseId, repetition, fingerprint) {
  return crypto.createHash('sha256').update(`${caseId}:${repetition}:${fingerprint}`).digest()[0] % 2 === 0;
}

function countValues(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function average(values) {
  return values.length === 0 ? 0 : Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function averagePairSimilarity(texts) {
  if (texts.length < 2) return 1;
  const similarities = [];
  for (let left = 0; left < texts.length; left += 1) {
    for (let right = left + 1; right < texts.length; right += 1) {
      similarities.push(characterBigramSimilarity(texts[left], texts[right]));
    }
  }
  return average(similarities);
}

function characterBigramSimilarity(left, right) {
  const bigrams = (text) => new Set([...String(text)].slice(0, -1).map((character, index, characters) => `${character}${characters[index + 1]}`));
  const a = bigrams(left);
  const b = bigrams(right);
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = [...a].filter((value) => b.has(value)).length;
  return Number((intersection / new Set([...a, ...b]).size).toFixed(4));
}

module.exports = { REVIEW_CRITERIA, REVIEW_VERSION, buildBlindReview, finalizeReview, summarizeRuns };
