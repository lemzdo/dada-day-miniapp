const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AESTHETIC_SHADOW_LOG_PREFIX,
  buildAestheticShadowSample,
  buildCandidateHash,
  isAestheticShadowSampled,
  logAestheticShadowTelemetry,
  parseAestheticShadowSampleRate,
} = require('./aestheticShadowTelemetry');
const { buildAestheticRankingPreview } = require('./aestheticRankingPreview');

const FORBIDDEN_KEYS = [
  '_openid',
  'openid',
  'clothingIds',
  'itemIds',
  'outfitKey',
  'imageUrl',
  'fileID',
  'city',
  'latitude',
  'longitude',
  'userTitle',
  'nickname',
  'avatar',
  'prompt',
  'rawResult',
  'avoidTags',
];

function outfit(id, total, score, coverage, evidenceCodes = []) {
  return {
    outfitKey: id,
    clothingIds: [`${id}-top`, `${id}-bottom`],
    scores: { total },
    aestheticEvaluation: {
      score,
      coverage,
      evidence: evidenceCodes.map((code, index) => ({
        code,
        itemIds: [`${id}-secret-${index}`],
      })),
    },
  };
}

function extractJson(line) {
  assert.ok(line.startsWith(AESTHETIC_SHADOW_LOG_PREFIX));
  return JSON.parse(line.slice(AESTHETIC_SHADOW_LOG_PREFIX.length).trim());
}

function collectLog(fn) {
  const lines = [];
  fn((line) => lines.push(line));
  return lines;
}

test('sampleRate=0 does not output', () => {
  const lines = collectLog((logger) => {
    logAestheticShadowTelemetry({
      sampleRate: 0,
      seed: 'batch-1',
      outfits: [outfit('a', 80, 90, 0.8)],
      scene: 'work',
      logger,
    });
  });

  assert.deepEqual(lines, []);
});

test('sampleRate=1 outputs parseable single-line JSON', () => {
  const lines = collectLog((logger) => {
    logAestheticShadowTelemetry({
      sampleRate: 1,
      seed: 'batch-1',
      outfits: [outfit('a', 80, 90, 0.8)],
      scene: 'work',
      logger,
    });
  });

  assert.equal(lines.length, 1);
  assert.equal(lines[0].includes('\n'), false);
  const sample = extractJson(lines[0]);
  assert.equal(sample.schemaVersion, 1);
  assert.equal(sample.scene, 'work');
});

test('deterministic sampling is stable for same seed and rate', () => {
  assert.equal(isAestheticShadowSampled('same-seed', 0.25), isAestheticShadowSampled('same-seed', 0.25));
});

test('invalid rate is parsed as zero', () => {
  assert.equal(parseAestheticShadowSampleRate('bad'), 0);
  assert.equal(parseAestheticShadowSampleRate('-0.1'), 0);
  assert.equal(parseAestheticShadowSampleRate('1.1'), 0);
});

test('sample payload does not contain forbidden keys', () => {
  const sample = buildAestheticShadowSample({
    seed: 'batch-1',
    scene: 'date',
    outfits: [outfit('secret_outfit_key', 80, 90, 0.8, FORBIDDEN_KEYS)],
    preview: buildAestheticRankingPreview([outfit('secret_outfit_key', 80, 90, 0.8, FORBIDDEN_KEYS)]),
  });
  const json = JSON.stringify(sample);

  for (const key of FORBIDDEN_KEYS) {
    assert.equal(json.includes(`"${key}"`), false);
    assert.equal(json.includes('secret_outfit_key'), false);
    assert.equal(json.includes('secret-'), false);
  }
});

test('candidateHash is stable and hides source identity', () => {
  const first = buildCandidateHash(outfit('source-key', 80, 90, 0.8), 0);
  const second = buildCandidateHash(outfit('source-key', 70, 40, 0.8), 0);

  assert.equal(first, second);
  assert.equal(first.includes('source-key'), false);
});

test('candidates are capped at eight', () => {
  const outfits = Array.from({ length: 10 }, (_, index) => outfit(`o${index}`, 80 - index, 90, 0.8));
  const sample = buildAestheticShadowSample({
    seed: 'batch-1',
    scene: 'home',
    outfits,
    preview: buildAestheticRankingPreview(outfits),
  });

  assert.equal(sample.candidates.length, 8);
});

test('evidenceCodes are deduplicated and capped', () => {
  const evidenceCodes = Array.from({ length: 20 }, (_, index) => `CODE_${index}`).concat(['CODE_1']);
  const sample = buildAestheticShadowSample({
    seed: 'batch-1',
    scene: 'home',
    outfits: [outfit('a', 80, 90, 0.8, evidenceCodes)],
    preview: buildAestheticRankingPreview([outfit('a', 80, 90, 0.8, evidenceCodes)]),
  });

  assert.equal(sample.candidates[0].evidenceCodes.length, 12);
  assert.equal(new Set(sample.candidates[0].evidenceCodes).size, 12);
});

test('telemetry errors do not affect main flow', () => {
  assert.doesNotThrow(() => {
    logAestheticShadowTelemetry({
      sampleRate: 1,
      seed: 'batch-1',
      outfits: [outfit('a', 80, 90, 0.8)],
      logger: () => {
        throw new Error('logger failed');
      },
    });
  });
});

test('preview does not change production order or total', () => {
  const outfits = [
    outfit('a', 80, 95, 0.8),
    outfit('b', 79, 45, 0.8),
  ];
  const beforeOrder = outfits.map((entry) => entry.outfitKey);
  const beforeTotals = outfits.map((entry) => entry.scores.total);

  buildAestheticShadowSample({
    seed: 'batch-1',
    scene: 'home',
    outfits,
    preview: buildAestheticRankingPreview(outfits),
  });

  assert.deepEqual(outfits.map((entry) => entry.outfitKey), beforeOrder);
  assert.deepEqual(outfits.map((entry) => entry.scores.total), beforeTotals);
});
