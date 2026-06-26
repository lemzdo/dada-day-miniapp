const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  analyzeAestheticShadowLines,
  formatAestheticShadowMarkdown,
  formatAestheticShadowText,
  parseAestheticShadowLine,
} = require('./aestheticShadowReport');

const fixturePath = path.join(__dirname, 'aestheticShadowReport.fixtures.jsonl');

test('parses plain JSON lines', () => {
  const sample = parseAestheticShadowLine('{"schemaVersion":1,"candidates":[]}');

  assert.equal(sample.schemaVersion, 1);
});

test('parses prefixed log lines', () => {
  const sample = parseAestheticShadowLine('[AESTHETIC_SHADOW_V1] {"schemaVersion":1,"candidates":[]}');

  assert.equal(sample.schemaVersion, 1);
});

test('skips unrelated log lines', () => {
  assert.equal(parseAestheticShadowLine('[cloud] unrelated log'), null);
});

test('invalid lines are counted without crashing', () => {
  const report = analyzeAestheticShadowLines(['not json']);

  assert.equal(report.samples.validSamples, 0);
  assert.equal(report.samples.invalidLines, 1);
});

test('fixture statistics are deterministic', () => {
  const first = analyzeAestheticShadowLinesFromFixture();
  const second = analyzeAestheticShadowLinesFromFixture();

  assert.deepEqual(first, second);
  assert.equal(first.samples.totalLines, 10);
  assert.equal(first.samples.validSamples, 8);
  assert.equal(first.samples.invalidLines, 2);
  assert.equal(first.samples.sceneDistribution.work, 2);
});

test('top1 change statistics are reported', () => {
  const report = analyzeAestheticShadowLinesFromFixture();

  assert.equal(report.ranking.batchesWithChanges, 3);
  assert.equal(report.ranking.topChangedCount, 2);
  assert.equal(report.ranking.maxMove, 1);
});

test('delta distribution is reported', () => {
  const report = analyzeAestheticShadowLinesFromFixture();

  assert.equal(report.ranking.deltaCounts.positive > 0, true);
  assert.equal(report.ranking.deltaCounts.negative > 0, true);
  assert.equal(report.ranking.deltaStats.min, -6);
  assert.equal(report.ranking.deltaStats.max, 6);
});

test('12 point protection violations are detected', () => {
  const report = analyzeAestheticShadowLines([
    JSON.stringify({
      schemaVersion: 1,
      candidates: [
        { candidateHash: 'high', originalRank: 1, previewRank: 2, existingTotal: 90, aestheticScore: 45, coverage: 0.8, aestheticDelta: -6, rankingScore: 84 },
        { candidateHash: 'low', originalRank: 2, previewRank: 1, existingTotal: 77, aestheticScore: 95, coverage: 0.8, aestheticDelta: 6, rankingScore: 83 },
      ],
    }),
  ]);

  assert.equal(report.safety.protectionViolations, 1);
});

test('coverage gate violations are detected', () => {
  const report = analyzeAestheticShadowLines([
    JSON.stringify({
      schemaVersion: 1,
      candidates: [
        { candidateHash: 'bad', originalRank: 1, previewRank: 1, existingTotal: 80, aestheticScore: 95, coverage: 0.49, aestheticDelta: 1, rankingScore: 81 },
      ],
    }),
  ]);

  assert.equal(report.safety.coverageGateViolations, 1);
});

test('sensitive field anomalies are detected without exposing values', () => {
  const report = analyzeAestheticShadowLines([
    JSON.stringify({
      schemaVersion: 1,
      openid: 'secret-user',
      candidates: [
        { candidateHash: 'safe', originalRank: 1, previewRank: 1, existingTotal: 80, aestheticScore: 80, coverage: 0.8, aestheticDelta: 2.4, rankingScore: 82.4 },
      ],
    }),
  ]);

  assert.equal(report.safety.sensitiveFieldHits.openid, 1);
  assert.equal(JSON.stringify(report).includes('secret-user'), false);
});

test('JSON output can be parsed', () => {
  const report = analyzeAestheticShadowLinesFromFixture();
  const parsed = JSON.parse(JSON.stringify(report));

  assert.equal(parsed.samples.validSamples, 8);
});

test('Markdown output has required sections', () => {
  const markdown = formatAestheticShadowMarkdown(analyzeAestheticShadowLinesFromFixture());

  assert.ok(markdown.includes('## Samples'));
  assert.ok(markdown.includes('## Aesthetic Scores'));
  assert.ok(markdown.includes('## Ranking Impact'));
  assert.ok(markdown.includes('## Safety Checks'));
  assert.ok(markdown.includes('## Recommendation'));
});

test('text output is deterministic', () => {
  const report = analyzeAestheticShadowLinesFromFixture();

  assert.equal(formatAestheticShadowText(report), formatAestheticShadowText(report));
});

function analyzeAestheticShadowLinesFromFixture() {
  const fs = require('node:fs');
  return analyzeAestheticShadowLines(fs.readFileSync(fixturePath, 'utf8').split(/\r?\n/));
}
