const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyWearabilityAndSceneEligibility,
  evaluateSceneEligibilityV3,
} = require('./sceneEligibilityV3');
const { SCENE_V4_FIXTURE_CATALOG: C } = require('./sceneEvidenceV4.fixtures');

test('legacy entry point delegates to the versioned Scene Evidence V4 contract', () => {
  const result = evaluateSceneEligibilityV3({ scene: 'home', items: [C.tshirt, C.shorts, C.casualShoe] });
  assert.equal(result.sceneEvidenceVersion, 'scene-evidence-v4');
  assert.match(result.sceneEvidenceFingerprint, /^[0-9a-f]{20}$/);
  assert.equal(result.canEnterScene, true);
});

test('work and date hard conflicts remain ahead of fit and explanation', () => {
  for (const scene of ['work', 'date']) {
    const result = evaluateSceneEligibilityV3({ scene, items: [C.shirt, C.tailoredPants, C.slipper] });
    assert.equal(result.eligible, false, scene);
    assert.equal(result.hardRejected, true, scene);
    assert.ok(result.sceneEvidence.some((entry) => entry.hardConflict), scene);
  }
});

test('ordinary casual outfits become negative or weak evidence instead of hard rejection', () => {
  const work = evaluateSceneEligibilityV3({ scene: 'work', items: [C.tshirt, C.shorts, C.sneaker] });
  const date = evaluateSceneEligibilityV3({ scene: 'date', items: [C.tshirt, C.shorts, C.sneaker] });
  const sport = evaluateSceneEligibilityV3({ scene: 'sport', items: [C.tshirt, C.shorts, C.sneaker] });
  assert.equal(work.eligible, true);
  assert.ok(work.warnings.includes('WORK_CASUAL_SHORTS_NEGATIVE'));
  assert.equal(date.eligible, true);
  assert.equal(sport.eligible, true);
  assert.ok(sport.acceptReasons.includes('SPORT_DAILY_LIGHT_SET'));
});

test('guard rejects only wearability or hard conflicts and preserves evidence diagnostics', () => {
  const candidates = [
    { items: [C.tshirt, C.shorts, C.sneaker], rankingScore: 8 },
    { items: [C.formalDress, C.highHeel], rankingScore: 8 },
  ];
  const result = applyWearabilityAndSceneEligibility(candidates, { scene: 'sport', weather: {} });
  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].rejectionStage, 'scene_hard_conflict');
  assert.equal(result.debug.sceneEvidenceVersion, 'scene-evidence-v4');
  assert.equal(result.debug.unmappedEligibilityPaths.length, 0);
});

test('onepiece admission no longer depends on a reason-code mapping', () => {
  const result = evaluateSceneEligibilityV3({ scene: 'home', items: [C.dress] });
  assert.equal(result.eligible, true);
  assert.equal(result.rejectReasons.includes('UNMAPPED_ELIGIBILITY_PATH'), false);
});
