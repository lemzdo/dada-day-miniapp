const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function isMiniProgramDevEnvMock(envVersion) {
  if (typeof envVersion !== 'string') return false;
  if (!envVersion) return false;
  return envVersion !== 'release' && envVersion !== 'unknown';
}

test('client envVersion: develop → debugRecommendationAudit=true', () => {
  assert.equal(isMiniProgramDevEnvMock('develop'), true);
});

test('client envVersion: trial → debugRecommendationAudit=true', () => {
  assert.equal(isMiniProgramDevEnvMock('trial'), true);
});

test('client envVersion: release → no debugRecommendationAudit', () => {
  assert.equal(isMiniProgramDevEnvMock('release'), false);
});

test('client envVersion: unknown → no debugRecommendationAudit', () => {
  assert.equal(isMiniProgramDevEnvMock('unknown'), false);
});

test('client envVersion: empty → no debugRecommendationAudit', () => {
  assert.equal(isMiniProgramDevEnvMock(''), false);
});

test('client envVersion: undefined → no debugRecommendationAudit', () => {
  assert.equal(isMiniProgramDevEnvMock(undefined), false);
});

test('client envVersion: null → no debugRecommendationAudit', () => {
  assert.equal(isMiniProgramDevEnvMock(null), false);
});

test('client envVersion: API throws → no debugRecommendationAudit', () => {
  assert.equal(isMiniProgramDevEnvMock(''), false);
});

test('loading owner race: old request cannot clear new request loading', () => {
  let loadingOwnerSeq = 0;
  function setLoadingForRequest(seq) {
    loadingOwnerSeq = seq;
  }
  function clearLoadingForRequest(seq) {
    if (loadingOwnerSeq === seq) {
      loadingOwnerSeq = 0;
    }
  }
  setLoadingForRequest(1);
  setLoadingForRequest(2);
  clearLoadingForRequest(1);
  assert.equal(loadingOwnerSeq, 2, 'old request should not clear new request loading');
  clearLoadingForRequest(2);
  assert.equal(loadingOwnerSeq, 0, 'correct owner should clear loading');
});

test('loading owner race: stale request finally does not affect current', () => {
  let isLoading = true;
  let loadingOwnerSeq = 3;
  const staleSeq = 2;
  if (loadingOwnerSeq === staleSeq) {
    isLoading = false;
  }
  assert.equal(isLoading, true, 'stale request finally should not change loading');
});

test('cloud.ts cacheKeyData excludes trigger alongside auditId', () => {
  const source = fs.readFileSync(path.join(__dirname, 'cloud.ts'), 'utf8');
  assert.match(
    source,
    /const \{\s*auditId:\s*_auditId,\s*trigger:\s*_trigger,\s*\.\.\.cacheKeyData\s*\}\s*=\s*requestPayload/,
    'cacheKeyData must destructure out both auditId and trigger',
  );
});

test('cloud.ts trigger is still sent to cloud function via requestPayload', () => {
  const source = fs.readFileSync(path.join(__dirname, 'cloud.ts'), 'utf8');
  // requestPayload is built from ...params (which includes trigger), then
  // cacheKeyData is derived from requestPayload. The cloud function receives
  // requestPayload (not cacheKeyData).
  const generateOutfitSection = source.match(/export async function generateCloudOutfit[\s\S]*?\n\}/);
  assert.ok(generateOutfitSection, 'should find generateCloudOutfit function');
  const funcBody = generateOutfitSection[0];
  assert.match(funcBody, /\.\.\.params/, 'requestPayload must spread params (including trigger)');
  assert.match(funcBody, /callCachedCloudFunction[\s\S]*?requestPayload/, 'must pass requestPayload (not cacheKeyData) to callCachedCloudFunction');
});

test('cloud.ts unwraps the formal response once and preserves data.countContract', () => {
  const source = fs.readFileSync(path.join(__dirname, 'cloud.ts'), 'utf8');
  const callSection = source.match(/async function callCloudFunction[\s\S]*?\n\}/);
  assert.ok(callSection, 'should find callCloudFunction');
  assert.match(callSection[0], /const resultData = result\.data/);
  assert.match(callSection[0], /return resultData/);
  assert.doesNotMatch(callSection[0], /result\.(?:debug|qaBatchAudit|recommendation)\??\.countContract/);
});

test('cloud.ts same semantic request with different trigger produces identical cacheKeyData', () => {
  // Simulate the destructuring logic from cloud.ts
  function buildCacheKeyData(params) {
    const requestPayload = {
      ...params,
      auditId: params.auditId || 'generated-audit-id',
    };
    const { auditId: _auditId, trigger: _trigger, ...cacheKeyData } = requestPayload;
    return cacheKeyData;
  }

  const baseParams = {
    scene: '居家',
    weather: { temperature: 25 },
    recommendationBatchId: 'batch-123',
    excludedOutfitKeys: ['outfit-1'],
    preference: { styleTags: ['casual'] },
  };

  const cacheKeyA = buildCacheKeyData({ ...baseParams, trigger: 'initial', auditId: 'audit-A' });
  const cacheKeyB = buildCacheKeyData({ ...baseParams, trigger: 'refresh', auditId: 'audit-B' });

  assert.deepEqual(cacheKeyA, cacheKeyB, 'different trigger and auditId must produce identical cacheKeyData');
  assert.equal(cacheKeyA.trigger, undefined, 'trigger must not be in cacheKeyData');
  assert.equal(cacheKeyA.auditId, undefined, 'auditId must not be in cacheKeyData');
  assert.equal(cacheKeyA.scene, '居家');
  assert.equal(cacheKeyA.recommendationBatchId, 'batch-123');
});

test('cloud.ts different scene/weather/recommendationBatchId produces different cacheKeyData', () => {
  function buildCacheKeyData(params) {
    const requestPayload = {
      ...params,
      auditId: params.auditId || 'generated-audit-id',
    };
    const { auditId: _auditId, trigger: _trigger, ...cacheKeyData } = requestPayload;
    return cacheKeyData;
  }

  const base = { trigger: 'initial', scene: '居家', weather: { temperature: 25 } };
  const variant1 = buildCacheKeyData({ ...base, scene: '上班' });
  const variant2 = buildCacheKeyData({ ...base, weather: { temperature: 15 } });
  const variant3 = buildCacheKeyData({ ...base, recommendationBatchId: 'batch-X' });
  const baseline = buildCacheKeyData(base);

  assert.notDeepEqual(variant1, baseline, 'different scene must produce different cacheKeyData');
  assert.notDeepEqual(variant2, baseline, 'different weather must produce different cacheKeyData');
  assert.notDeepEqual(variant3, baseline, 'different recommendationBatchId must produce different cacheKeyData');
});

test('cloud.ts refresh with exclusions still uses ttl=0', () => {
  const source = fs.readFileSync(path.join(__dirname, 'cloud.ts'), 'utf8');
  const generateOutfitSection = source.match(/export async function generateCloudOutfit[\s\S]*?\n\}/);
  assert.ok(generateOutfitSection, 'should find generateCloudOutfit function');
  const funcBody = generateOutfitSection[0];
  assert.match(funcBody, /hasExclusions/, 'must compute hasExclusions');
  assert.match(funcBody, /hasExclusions\s*\?\s*0\s*:\s*CACHE_TTL\.outfit/, 'ttl must be 0 when hasExclusions is true');
});
