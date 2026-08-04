process.env.NODE_ENV = 'test';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  finalizeFullComputeAfterPoolPersist,
  createRecommendationSceneContract,
  createRecommendationDiagnostics,
} = require('./index.js').__test;

function createTestOutfits() {
  return [{
    outfitKey: 'test_outfit_key_1',
    items: [{
      _id: 'clothing_1',
      category: 'top',
      subcategory: 'shirt',
      color: 'blue',
      styleTags: ['casual'],
      displayImageUrl: 'https://example.com/clothing_1.jpg',
    }, {
      _id: 'clothing_2',
      category: 'bottom',
      subcategory: 'pants',
      color: 'black',
      styleTags: ['casual'],
      displayImageUrl: 'https://example.com/clothing_2.jpg',
    }],
    scores: { total: 85 },
    eligibility: true,
    eligibilityReason: { code: 'MATCH', text: '测试搭配' },
    title: '测试穿搭',
    reasoning: '测试理由',
    sceneEligibility: { eligible: true },
    visibleFacts: [],
    itemIds: ['clothing_1', 'clothing_2'],
  }];
}

function createTestQaResult() {
  return {
    summaries: [],
    valid: true,
  };
}

function buildBaseInput(overrides = {}) {
  const sceneContract = createRecommendationSceneContract('home');
  const diagnostics = createRecommendationDiagnostics();
  diagnostics.auditId = 'test_audit_id';
  return {
    diagnostics,
    baseRecommendationBatchId: 'pool_base_001',
    cacheMissReason: '',
    sceneContract,
    qaResult: createTestQaResult(),
    rejectionReasonCounts: {},
    outfits: createTestOutfits(),
    weatherSnapshot: undefined,
    weatherMode: 'mock',
    recommendationNotice: '',
    missingRoles: [],
    missingFacts: [],
    limited: false,
    exhausted: false,
    debug: {
      auditId: diagnostics.auditId,
      candidateCount: 10,
      generatedCount: 10,
      acceptedCount: 10,
      rejectedCount: 0,
      selectedCount: 1,
      limitedReason: '',
      cloudBuildVersion: 'test_version',
      executionMode: 'full_compute',
      candidatePoolIdentityHash: 'test_hash',
      candidatePoolAgeMs: 0,
      cacheHit: false,
      cacheMissReason: '',
      exclusionsAppliedCount: 0,
      timings: diagnostics.timings,
      responseBytes: {},
    },
    meta: {
      auditId: diagnostics.auditId,
      cloudBuildVersion: 'test_version',
      reasonCatalogVersion: 1,
      aiReviewVersion: 1,
    },
    ...overrides,
  };
}

test('production persist-result finalization path: oversized pool is chunk-saved', () => {
  const input = buildBaseInput();
  input.diagnostics.candidatePoolSaveStatus = 'saved';
  input.diagnostics.candidatePoolSaveReason = null;
  input.diagnostics.candidatePoolSerializedBytes = 300000;
  input.diagnostics.candidatePoolChunkCount = 3;

  const result = finalizeFullComputeAfterPoolPersist(input);

  assert.ok(result.response, 'should return response');
  assert.equal(typeof result.response, 'object', 'response should be object');
  assert.ok(Array.isArray(result.response.outfits), 'outfits should be array');
  assert.equal(result.response.outfits.length, 1, 'outfits should have 1 item');
  assert.equal(result.response.debug.executionMode, 'full_compute', 'executionMode should be full_compute');
  assert.equal(result.response.debug.candidatePoolSaveStatus, 'saved', 'candidatePoolSaveStatus should be saved');
  assert.equal(result.response.debug.candidatePoolSaveReason, null, 'candidatePoolSaveReason should be null');
  assert.equal(result.response.debug.candidatePoolSerializedBytes, 300000, 'serializedBytes should match');
  assert.equal(result.response.debug.candidatePoolChunkCount, 3, 'chunkCount should match');
  assert.equal(result.response.debug.recommendationBatchIdPresent, true, 'recommendationBatchIdPresent should be true');
  assert.equal(result.response.recommendationBatchId, 'pool_base_001');
  assert.equal(result.recommendationBatchId, 'pool_base_001');
});

test('production persist-result finalization path: write_failed', () => {
  const input = buildBaseInput();
  input.diagnostics.candidatePoolSaveStatus = 'write_failed';
  input.diagnostics.candidatePoolSaveReason = 'database_error';
  input.diagnostics.candidatePoolSerializedBytes = 50000;
  input.diagnostics.candidatePoolChunkCount = 1;

  const result = finalizeFullComputeAfterPoolPersist(input);

  assert.ok(result.response, 'should return response');
  assert.ok(Array.isArray(result.response.outfits), 'outfits should be array');
  assert.equal(result.response.outfits.length, 1, 'outfits should have 1 item');
  assert.equal(result.response.debug.candidatePoolSaveStatus, 'write_failed', 'candidatePoolSaveStatus should be write_failed');
  assert.equal(result.response.debug.candidatePoolSaveReason, 'database_error', 'saveReason should match');
  assert.equal(result.response.debug.recommendationBatchIdPresent, false, 'recommendationBatchIdPresent should be false');
  assert.equal(result.response.debug.cacheMissReason, 'candidate_pool_not_saved', 'cacheMissReason should be canonical');
  assert.ok(!('recommendationBatchId' in result.response), 'response should not have recommendationBatchId');
  assert.equal(result.recommendationBatchId, undefined, 'returned batch id should be undefined');
  assert.equal(result.cacheMissReason, 'candidate_pool_not_saved', 'cacheMissReason should be canonical candidate_pool_not_saved');
});

test('production persist-result finalization path: write_timeout', () => {
  const input = buildBaseInput();
  input.diagnostics.candidatePoolSaveStatus = 'write_timeout';
  input.diagnostics.candidatePoolSaveReason = 'database_timeout';
  input.diagnostics.candidatePoolSerializedBytes = 50000;
  input.diagnostics.candidatePoolChunkCount = 1;

  const result = finalizeFullComputeAfterPoolPersist(input);

  assert.ok(result.response, 'should return response');
  assert.ok(Array.isArray(result.response.outfits), 'outfits should be array');
  assert.equal(result.response.outfits.length, 1, 'outfits should have 1 item');
  assert.equal(result.response.debug.candidatePoolSaveStatus, 'write_timeout', 'candidatePoolSaveStatus should be write_timeout');
  assert.equal(result.response.debug.candidatePoolSaveReason, 'database_timeout', 'saveReason should match');
  assert.equal(result.response.debug.recommendationBatchIdPresent, false, 'recommendationBatchIdPresent should be false');
  assert.equal(result.response.debug.cacheMissReason, 'candidate_pool_not_saved', 'cacheMissReason should be canonical');
  assert.ok(!('recommendationBatchId' in result.response), 'response should not have recommendationBatchId');
  assert.equal(result.recommendationBatchId, undefined, 'returned batch id should be undefined');
  assert.equal(result.cacheMissReason, 'candidate_pool_not_saved', 'cacheMissReason should be canonical candidate_pool_not_saved');
});

test('production persist-result finalization path: saved', () => {
  const testPoolId = 'pool_test_001';
  const input = buildBaseInput({ baseRecommendationBatchId: testPoolId });
  input.diagnostics.candidatePoolSaveStatus = 'saved';
  input.diagnostics.candidatePoolSaveReason = null;
  input.diagnostics.candidatePoolSerializedBytes = 50000;
  input.diagnostics.candidatePoolChunkCount = 1;
  input.cacheMissReason = 'initial_request';
  input.debug.cacheMissReason = 'initial_request';

  const result = finalizeFullComputeAfterPoolPersist(input);

  assert.ok(result.response, 'should return response');
  assert.ok(Array.isArray(result.response.outfits), 'outfits should be array');
  assert.equal(result.response.outfits.length, 1, 'outfits should have 1 item');
  assert.equal(result.response.recommendationBatchId, testPoolId, 'recommendationBatchId should match pool id');
  assert.equal(result.response.debug.candidatePoolSaveStatus, 'saved', 'candidatePoolSaveStatus should be saved');
  assert.equal(result.response.debug.recommendationBatchIdPresent, true, 'recommendationBatchIdPresent should be true');
  assert.equal(result.response.debug.recommendationBatchIdLength, testPoolId.length, 'recommendationBatchIdLength should match');
  assert.equal(result.recommendationBatchId, testPoolId, 'returned batch id should match');
  assert.equal(result.cacheMissReason, 'initial_request', 'cacheMissReason should preserve original miss reason when save succeeds');
});
