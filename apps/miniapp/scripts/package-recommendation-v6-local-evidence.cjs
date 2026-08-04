'use strict';

// Produces an honest, repeatable local-contract evidence bundle when a
// DevTools automation endpoint is unavailable. It never invents device
// requests, screenshots, or timing measurements; those belong to the V6 E2E
// runner and are explicitly marked as not executed here.

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const timestamp = process.argv[2] || new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const outputDir = path.join(ROOT, 'artifacts', 'recommendation-v6-e2e', timestamp);
const tests = [
  'apps/miniapp/cloudfunctions/generateOutfit/services/outfitCompositionV1.test.js',
  'apps/miniapp/cloudfunctions/generateOutfit/services/recommendationLanguageV3.test.js',
  'apps/miniapp/cloudfunctions/generateOutfit/services/recommendationEligibilityReason.test.js',
  'apps/miniapp/cloudfunctions/generateOutfit/services/buildVersions.test.js',
  'apps/miniapp/cloudfunctions/generateOutfit/services/weatherFailureContract.test.js',
  'apps/miniapp/cloudfunctions/generateOutfit/services/candidatePool.test.js',
  'apps/miniapp/cloudfunctions/generateOutfit/services/recommendationP0Regression.test.js',
  'apps/miniapp/cloudfunctions/generateOutfit/services/recommendationAvailability.test.js',
  'apps/miniapp/cloudfunctions/generateOutfit/services/recommendationBatchSnapshot.test.js',
  'apps/miniapp/src/pages/today/recommendationEligibilityPresentation.test.js',
  'apps/miniapp/src/lib/recommendationDiagnostics.test.js',
  'apps/miniapp/src/utils/outfitContextText.test.js',
  'apps/miniapp/scripts/recommendation-v6-e2e.test.js',
];

function collectTests(dir) {
  return fs.readdirSync(dir, { recursive: true })
    .filter((entry) => String(entry).endsWith('.test.js'))
    .map((entry) => path.relative(ROOT, path.join(dir, entry)));
}

const testRuns = [
  { name: 'v6-contract', files: tests },
  { name: 'generate-outfit-services', files: collectTests(path.join(ROOT, 'apps/miniapp/cloudfunctions/generateOutfit/services')) },
  { name: 'miniapp-client', files: collectTests(path.join(ROOT, 'apps/miniapp/src')) },
];

const matrix = [
  ['home-weather-disabled-four-batches', 'outfitCompositionV1 + recommendationP0Regression'],
  ['work-initial-and-three-refreshes', 'recommendationP0Regression candidate-pool refresh'],
  ['date-initial-and-refresh', 'recommendationLanguageV3 batch reason facts'],
  ['sport-qualified-light-activity', 'outfitCompositionV1 light sport'],
  ['sport-missing-suitable-shoe', 'recommendationAvailability missing facts'],
  ['27c-deterministic-cloud-integration', 'outfitCompositionV1 27 degree regression'],
  ['weather-ui-success-and-failure-contract', 'weatherFailureContract'],
  ['rapid-home-work-date', 'recommendation-v6-e2e selector contract'],
  ['today-detail-return-snapshot', 'recommendationBatchSnapshot'],
  ['pool-invalidation-weather-wardrobe-preference', 'candidatePool identity'],
].map(([name, coverage]) => ({ name, status: 'pending', coverage }));

function write(name, content) {
  fs.writeFileSync(path.join(outputDir, name), content, 'utf8');
}

fs.mkdirSync(outputDir, { recursive: true });
const results = testRuns.map((run) => {
  const result = childProcess.spawnSync(process.execPath, ['--test', ...run.files], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120000,
  });
  return {
    name: run.name,
    status: result.status,
    output: `${result.stdout || ''}${result.stderr || ''}`,
  };
});
const combined = results.map((result) => `# ${result.name}\n${result.output}`).join('\n');
const passed = results.every((result) => result.status === 0);
for (const entry of matrix) entry.status = passed ? 'local_contract_passed' : 'local_contract_failed';

write('local-contract-tests.txt', combined);
write('requests.jsonl', '');
write('sanitized-lifecycle.jsonl', '');
write('cards.jsonl', '');
write('matrix.json', `${JSON.stringify(matrix, null, 2)}\n`);
write('environment.json', `${JSON.stringify({
  evidenceMode: 'local-contract',
  cloudBuildVersion: 'generateOutfit-recommendation-v6-1-semantic-render-binding-fix-20260726',
  qaVersion: 'qa-batch-audit-v6-1-semantic-presentation',
  externalE2E: {
    executed: false,
    reason: 'MINIPROGRAM_AUTOMATOR_PATH is unavailable and no DevTools automation process is running',
  },
  testRuns: results.map((result) => ({ name: result.name, exitCode: result.status })),
}, null, 2)}\n`);
write('summary.md', [
  '# Recommendation V6 local-contract evidence',
  '',
  `- local contract tests: ${passed ? 'PASS' : 'FAIL'} (${testRuns.map((run) => run.files.length).join(' + ')} files)`,
  '- cloud build: generateOutfit-recommendation-v6-1-semantic-render-binding-fix-20260726',
  '- QA schema: qa-batch-audit-v6-1-semantic-presentation',
  '- device E2E: NOT EXECUTED (no automator endpoint; no requests/cards/screenshots were fabricated)',
  '- performance targets: NOT MEASURED on an undeployed cloud/device runtime',
  '',
  'The executable selector-driven runner is apps/miniapp/scripts/recommendation-v6-e2e.cjs.',
].join('\n') + '\n');
write('manual-review.md', 'No V6 screenshot was created: a running DevTools automation endpoint was unavailable.\n');
fs.copyFileSync(path.join(__dirname, 'recommendation-v6-e2e.cjs'), path.join(outputDir, 'recommendation-v6-e2e.cjs'));

if (!passed) process.exitCode = results.find((result) => result.status !== 0)?.status || 1;
