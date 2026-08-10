const test = require('node:test');
const assert = require('node:assert/strict');

const { SCENES, auditFinalTodayCopy } = require('./today-copy-naturalness-acceptance');

function outfit(scene, index, todayReason = `白色上衣和灰色下装都是中性色，${scene === 'home' ? '宅家' : '当天'}可以直接这样穿。`) {
  const topId = `${scene}-top-${index}`;
  const bottomId = `${scene}-bottom-${index}`;
  return {
    scene,
    clothingIds: [topId, bottomId],
    copyContractVersion: 'recommendation-copy-contract-v4',
    copyContract: {
      copyContractVersion: 'recommendation-copy-contract-v4',
      todayReason,
      unsupportedClaimCount: 0,
      naturalnessGateVersion: 'copy-naturalness-gate-v1',
      naturalnessGateResult: 'PASS',
      naturalnessRiskFlags: [],
      todayCopyProvenance: {
        text: todayReason,
        clauses: [{
          slot: 'relation',
          subjectItemIds: [topId, bottomId],
          evidenceFactIds: [`item:${topId}:color`, `item:${bottomId}:color`],
        }],
      },
    },
  };
}

test('real Today audit requires four scenes and compares final UI text with public DTO canonical copy', () => {
  assert.deepEqual(SCENES, ['home', 'work', 'date', 'sport']);
  for (const scene of SCENES) {
    const outfits = Array.from({ length: 4 }, (_, index) => outfit(scene, index));
    const uiCards = outfits.map((entry, index) => ({ index, todayReason: entry.copyContract.todayReason }));
    const result = auditFinalTodayCopy(scene, { outfits }, uiCards);
    assert.equal(result.passed, true, scene);
    assert.equal(result.samples.length, 4);
  }
});

test('real Today audit rejects stale editorial copy and UI binding drift independently', () => {
  const outfits = Array.from({ length: 4 }, (_, index) => outfit('home', index));
  outfits[0] = outfit('home', 0, '白色短袖T恤与灰色短裤用中性色过渡，适合居家场景，配色简洁。');
  const uiCards = outfits.map((entry, index) => ({ index, todayReason: index === 1 ? '页面读了旧 reason' : entry.copyContract.todayReason }));
  const result = auditFinalTodayCopy('home', { outfits }, uiCards);
  assert.equal(result.passed, false);
  assert.ok(result.failures.includes('editorial_copy:0'));
  assert.ok(result.failures.includes('ui_binding:1'));
});

test('real Today audit rejects scene semantics repeated across composed slots', () => {
  const repeated = '白色短袖T恤和灰色短裤都是中性色，日常轻运动可以直接这样穿，下装和运动鞋符合这次轻运动的需要。';
  const outfits = Array.from({ length: 4 }, (_, index) => outfit('sport', index, index === 0 ? repeated : undefined));
  const uiCards = outfits.map((entry, index) => ({ index, todayReason: entry.copyContract.todayReason }));
  const result = auditFinalTodayCopy('sport', { outfits }, uiCards);
  assert.equal(result.passed, false);
  assert.ok(result.failures.includes('repeated_scene_semantics:0'));
});
