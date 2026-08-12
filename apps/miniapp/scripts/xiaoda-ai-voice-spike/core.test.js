'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  BAD_SOURCE_PHRASES,
  MODEL_ALLOWLIST,
  buildPrompt,
  buildStylingBrief,
  parseBatchResponse,
  resolveModel,
  validateGeneratedItems,
} = require('./core');

function productionOutfit(overrides = {}) {
  return {
    outfitKey: 'top-1_bottom-1',
    scene: '居家',
    weatherSnapshot: { temp: 26, weather: '多云' },
    reason: BAD_SOURCE_PHRASES[0],
    presentationPlan: {
      primaryRelationCode: 'PATTERN_SOLID_BALANCE',
      factModel: {
        scene: 'home',
        primaryRelationCode: 'PATTERN_SOLID_BALANCE',
        items: [
          { itemId: 'top-1', role: 'top', category: 'top', canonicalSubtype: '印花T恤', normalizedColor: '蓝色', patternType: 'graphic', authorizedFactIds: ['item:top-1:pattern'] },
          { itemId: 'bottom-1', role: 'bottom', category: 'bottom', canonicalSubtype: '短裤', normalizedColor: '白色', authorizedFactIds: ['item:bottom-1:color'] },
        ],
        relations: [{ relationCode: 'PATTERN_SOLID_BALANCE', subjectItemIds: ['top-1', 'bottom-1'], evidenceFactIds: ['item:top-1:pattern', 'item:bottom-1:color'] }],
      },
    },
    xiaodaStyleInsight: {
      primary: { humanMeaning: BAD_SOURCE_PHRASES[1], overallMeaning: BAD_SOURCE_PHRASES[2] },
      allowedAestheticInferences: [{ code: 'CLEAR_FOCUS', label: '重点清楚' }],
    },
    ...overrides,
  };
}

test('brief uses structured facts and rejects deterministic Chinese contamination', () => {
  const brief = buildStylingBrief(productionOutfit(), { benchmarkId: 'home-b1-01', modelAlias: 'plus' });
  const serialized = JSON.stringify(brief);
  assert.equal(brief.garments.length, 2);
  assert.equal(brief.primaryStylingPoint.insightCode, 'PATTERN_SOLID_BALANCE');
  for (const phrase of BAD_SOURCE_PHRASES) assert.equal(serialized.includes(phrase), false);
});

test('brief relation and item binding fail closed', () => {
  const outfit = productionOutfit();
  outfit.presentationPlan.factModel.relations[0].subjectItemIds.push('invented');
  const brief = buildStylingBrief(outfit, { benchmarkId: 'binding' });
  assert.equal(brief.stylingRelations.length, 0);
  assert.equal(brief.primaryStylingPoint.insightCode, 'SIMPLE_EVERYDAY_COMBINATION');
});

test('weather semantic fingerprint ignores irrelevant degree changes', () => {
  const first = buildStylingBrief(productionOutfit({ weatherSnapshot: { temp: 26 } }), { benchmarkId: 'weather-a' });
  const second = buildStylingBrief(productionOutfit({ weatherSnapshot: { temp: 27 } }), { benchmarkId: 'weather-b' });
  assert.equal(first.cacheDependencies.weatherSemanticFingerprint, null);
  assert.equal(first.cacheDependencies.outfitFactFingerprint, second.cacheDependencies.outfitFactFingerprint);
});

test('scene and meaningful thermal changes alter reason dependencies', () => {
  const first = buildStylingBrief(productionOutfit({ weatherRelevant: true, weatherSnapshot: { temp: 22 } }), { benchmarkId: 'one' });
  const second = buildStylingBrief(productionOutfit({ weatherRelevant: true, weatherSnapshot: { temp: 30 } }), { benchmarkId: 'two' });
  assert.notEqual(first.cacheDependencies.weatherSemanticFingerprint, second.cacheDependencies.weatherSemanticFingerprint);
  const date = productionOutfit({ scene: '约会' });
  date.presentationPlan.factModel.scene = 'date';
  const third = buildStylingBrief(date, { benchmarkId: 'three' });
  assert.notEqual(first.reasonKey, third.reasonKey);
});

test('batch parser enforces exact ids and completeness', () => {
  assert.deepEqual(parseBatchResponse('{"items":[{"id":"a","reason":"自然一点"}]}', ['a']), [{ id: 'a', reason: '自然一点' }]);
  assert.throws(() => parseBatchResponse('{"items":[{"id":"a","reason":"x"},{"id":"a","reason":"y"}]}', ['a']), /DUPLICATE_ID/);
  assert.throws(() => parseBatchResponse('{"items":[]}', ['a']), /BATCH_COMPLETENESS/);
});

test('objective safety validator catches unsupported claims and scene drift', () => {
  const brief = buildStylingBrief(productionOutfit(), { benchmarkId: 'a' });
  const result = validateGeneratedItems([{ id: 'a', reason: '这套显高，也很适合约会。' }], [brief]);
  assert.equal(result.pass, false);
  assert.deepEqual(result.results[0].failures.sort(), ['SCENE_BINDING', 'UNSUPPORTED_CLAIM']);
});

test('scene validator does not confuse a sneaker name with the sport scene', () => {
  const brief = buildStylingBrief(productionOutfit(), { benchmarkId: 'a' });
  const result = validateGeneratedItems([{ id: 'a', reason: '白T恤和白运动鞋有颜色呼应。' }], [brief]);
  assert.equal(result.pass, true);
});

test('objective safety validator catches body and invented convenience synonyms', () => {
  const brief = buildStylingBrief(productionOutfit(), { benchmarkId: 'a' });
  const result = validateGeneratedItems([{ id: 'a', reason: '这样不压个子，也省得想别的搭配。' }], [brief]);
  assert.equal(result.pass, false);
  assert.deepEqual(result.results[0].forbiddenClaims.sort(), ['不压个子', '省得想']);
});

test('model selection is a closed allowlist', () => {
  assert.equal(resolveModel('plus'), MODEL_ALLOWLIST.plus);
  assert.equal(resolveModel('max'), MODEL_ALLOWLIST.max);
  assert.throws(() => resolveModel('qwen3.7-max'), /not allowed/);
});

test('prompt keeps stable prefix and simple JSON contract', () => {
  const prompt = buildPrompt();
  assert.match(prompt, /Xiaoda Today Voice Prototype/);
  assert.match(prompt, /Return JSON only/);
  assert.doesNotMatch(prompt, /current deterministic reason/i);
});
