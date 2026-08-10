const assert = require('node:assert/strict');
const test = require('node:test');

const { evaluateSceneEvidenceV4 } = require('./sceneEvidenceV4');
const { SCENE_V4_FIXTURE_CATALOG: C } = require('./sceneEvidenceV4.fixtures');

test('sport is frozen as daily light activity', () => {
  const result = evaluateSceneEvidenceV4({ scene: 'sport', items: [C.tshirt, C.shorts, C.sneaker] });
  assert.equal(result.eligible, true);
  assert.ok(result.acceptReasons.includes('SPORT_DAILY_LIGHT_SET'));
  assert.equal(result.acceptReasons.includes('SPORT_EXPLICIT_SET'), false);
});

test('explicit sport set outranks ordinary daily light activity', () => {
  const explicit = evaluateSceneEvidenceV4({ scene: 'sport', items: [C.sportTop, C.sportPants, C.sneaker] });
  const daily = evaluateSceneEvidenceV4({ scene: 'sport', items: [C.tshirt, C.shorts, C.sneaker] });
  assert.ok(explicit.acceptReasons.includes('SPORT_EXPLICIT_SET'));
  assert.ok(explicit.sceneFitScore > daily.sceneFitScore);
});

test('sweatshirt shorts and sport shoes are medium evidence rather than rejected apparel', () => {
  const result = evaluateSceneEvidenceV4({ scene: 'sport', items: [C.sweatshirt, C.shorts, C.sneaker] });
  assert.equal(result.eligible, true);
  assert.equal(result.hardRejected, false);
  assert.ok(result.acceptReasons.includes('SPORT_DAILY_LIGHT_SET'));
});

test('unsafe footwear and formal or special core are hard conflicts', () => {
  const footwear = evaluateSceneEvidenceV4({ scene: 'sport', items: [C.tshirt, C.shorts, C.highHeel] });
  const formal = evaluateSceneEvidenceV4({ scene: 'sport', items: [C.formalDress, C.dressShoe] });
  assert.equal(footwear.hardRejected, true);
  assert.ok(footwear.rejectReasons.includes('SPORT_FOOTWEAR_CONFLICT'));
  assert.equal(formal.hardRejected, true);
  assert.ok(formal.rejectReasons.includes('SPORT_FORMAL_SPECIAL_CONFLICT'));
});

test('ordinary non-sport dress is a negative signal, not a universal hard reject', () => {
  const result = evaluateSceneEvidenceV4({ scene: 'sport', items: [C.dress, C.sneaker] });
  assert.equal(result.eligible, true);
  assert.equal(result.hardRejected, false);
  assert.ok(result.warnings.includes('SPORT_NON_SPORT_DRESS_NEGATIVE'));
});
