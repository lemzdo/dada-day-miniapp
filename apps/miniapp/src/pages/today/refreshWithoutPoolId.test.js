const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('client refresh without recommendationBatchId sends excludedOutfitKeys but no batch id', () => {
  const todaySource = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');

  assert.match(
    todaySource,
    /typeof previousRecommendationBatchId === 'string' && previousRecommendationBatchId\.length > 0/,
    'should only include recommendationBatchId when it is non-empty string'
  );

  assert.match(
    todaySource,
    /const excludedOutfitKeys = getSeenOutfitKeysForScene\(selectedSceneKeyRef\.current\)/,
    'should always include all accumulated excludedOutfitKeys for the scene identity'
  );
  assert.match(todaySource, /\n {8}excludedOutfitKeys,\n/);
});

test('client stores undefined when response has no recommendationBatchId', () => {
  const todaySource = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');

  assert.match(
    todaySource,
    /setRecommendationBatchId\(data\.recommendationBatchId \?\? nextOutfits\[0\]\?\.recommendationBatchId\)/,
    'should set recommendationBatchId without empty string fallback'
  );

  assert.match(
    todaySource,
    /recommendationBatchIdRef\.current = data\.recommendationBatchId \?\? nextOutfits\[0\]\?\.recommendationBatchId/,
    'should update ref without empty string fallback'
  );
});

test('client initial state uses undefined not empty string for recommendationBatchId', () => {
  const todaySource = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');

  assert.match(
    todaySource,
    /useState<string \| undefined>\(undefined\)/,
    'should initialize recommendationBatchId state with undefined'
  );

  assert.match(
    todaySource,
    /useRef<string \| undefined>\(undefined\)/,
    'should initialize recommendationBatchIdRef with undefined'
  );
});

test('client refresh flow does not show error when recommendationBatchId is missing', () => {
  const todaySource = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');

  const refreshSection = todaySource.match(/async function handleRefresh\(\)[\s\S]*?\n {2}\}/);
  assert.ok(refreshSection, 'should find handleRefresh function');

  const refreshCode = refreshSection[0];
  assert.doesNotMatch(
    refreshCode,
    /if.*recommendationBatchId.*error|throw.*recommendationBatchId|setError.*recommendationBatchId/,
    'should not throw error or set error when recommendationBatchId is missing'
  );
});

test('client fetchRecommendations accepts response without recommendationBatchId', () => {
  const todaySource = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');

  const fetchSection = todaySource.match(/async function fetchRecommendations\([\s\S]*?\n {2}\}\s*\n/);
  assert.ok(fetchSection, 'should find fetchRecommendations function');

  const fetchCode = fetchSection[0];
  assert.doesNotMatch(
    fetchCode,
    /if.*!.*recommendationBatchId.*throw|throw.*missing.*recommendationBatchId/,
    'should not require recommendationBatchId in response'
  );
});

test('TodayRestoreSnapshot type allows undefined recommendationBatchId', () => {
  const todaySource = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');

  assert.match(
    todaySource,
    /recommendationBatchId: string \| undefined;/,
    'TodayRestoreSnapshot should allow undefined recommendationBatchId'
  );
});
