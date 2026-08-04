const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const {
  ALL_SENTENCE_CLUSTERS,
  CLAIM_CATALOG,
  DETAIL_SENTENCE_CLUSTERS,
  SAFE_FALLBACK_CLUSTERS,
  TODAY_SENTENCE_CLUSTERS,
  VOICE_BANK_VERSION,
  getLimitedRecommendationCopy,
  getVoiceBankInventory,
  renderSentenceCluster,
  sourceLevel,
} = require('./xiaodaVoiceBankV2');

const APPROVED_CATALOG_DIGEST = 'be12dbadac5dde0f9583c6f2d4b8b35afa5d0813be4aafbd43d940439096c2ac';
const BANNED = /有分寸|有准备感|不会太用力|认真出门感|穿着省事|视线有落点|记忆点|正式度|更完整|更统一|有层次|当前场景|适合今天|单品|组合|穿法|不算.{0,20}但也不会|虽然.{0,20}不过也不会|不会太.{0,20}又不会太/;
const SCENE_BOUNDARIES = {
  home: /下楼|拿快递|临时出门|户外鞋/,
  work: /会议|开会|开车|长距离步行|长路/,
  date: /吃饭|散步|逛街|下午到晚上|晚餐/,
  sport: /跑步|跳跃|球类|力量训练|折痕|颜色亮点/,
};

test('runtime exports only the 52 approved fixed Claims and no fallback bank', () => {
  assert.equal(VOICE_BANK_VERSION, 'xiaoda-fixed-claim-catalog-v2');
  assert.equal(CLAIM_CATALOG.length, 52);
  assert.equal(ALL_SENTENCE_CLUSTERS, CLAIM_CATALOG);
  assert.equal(SAFE_FALLBACK_CLUSTERS.length, 0);
  assert.equal(TODAY_SENTENCE_CLUSTERS.length, 49);
  assert.equal(DETAIL_SENTENCE_CLUSTERS.length, 52);
  assert.deepEqual(getVoiceBankInventory().scenes, { home: 13, work: 12, date: 15, sport: 12 });
});

test('fixed Claim ids and texts match the approved product table byte for byte', () => {
  const digest = crypto.createHash('sha256')
    .update(CLAIM_CATALOG.map((entry) => `${entry.claimId}|${entry.text}`).join('\n'))
    .digest('hex');
  assert.equal(digest, APPROVED_CATALOG_DIGEST);
  assert.equal(new Set(CLAIM_CATALOG.map((entry) => entry.claimId)).size, 52);
  assert.equal(new Set(CLAIM_CATALOG.map((entry) => entry.text)).size, 52);
  assert.equal(CLAIM_CATALOG.every((entry) => renderSentenceCluster(entry) === entry.text), true);
  assert.equal(renderSentenceCluster({ claimId: 'H01-04', text: 'NOT_APPROVED' }), CLAIM_CATALOG[3].text);
});

test('all Claims declare scene conditions facts source level and fixed user value', () => {
  for (const claim of CLAIM_CATALOG) {
    assert.match(claim.claimId, /^[HWDS]\d{2}-\d{2}$/);
    assert.ok(['home', 'work', 'date', 'sport'].includes(claim.scene));
    assert.ok(claim.requirements.length > 0, claim.claimId);
    assert.ok(claim.requiredFactIds.length > 0, claim.claimId);
    assert.ok(['A', 'B'].includes(claim.minimumEvidenceSource), claim.claimId);
    assert.ok(claim.userValue, claim.claimId);
    assert.equal(BANNED.test(claim.text), false, claim.claimId);
    assert.equal(SCENE_BOUNDARIES[claim.scene].test(claim.text), false, claim.claimId);
  }
});

test('strong functions are never supported by category or weak visual guesses', () => {
  assert.equal(sourceLevel('structured_ai', 0.91, true, 'color'), 'B');
  assert.equal(sourceLevel('structured_ai', 0.99, true, 'breathability'), 'C');
  assert.equal(sourceLevel('user', 0.70, true, 'breathability'), 'A');
  assert.equal(sourceLevel('structured_ai', 0.99, false, 'color'), 'C');
  assert.equal(sourceLevel('visual_inference', 0.91, true, 'pattern_visible'), 'B');
  assert.equal(sourceLevel('visual_inference', 0.60, true, 'pattern_visible'), 'C');
});

test('tightened core requirements and helper-only Claims are encoded in the Catalog', () => {
  const byId = Object.fromEntries(CLAIM_CATALOG.map((claim) => [claim.claimId, claim]));
  assert.equal(byId['H02-01'].requirements[0].allOf.includes('loose_fit'), true);
  assert.equal(byId['H02-01'].requirements[1].allOf.includes('loose_fit'), true);
  assert.equal(byId['H02-02'].requirements[0].allOf.includes('movement'), true);
  assert.equal(byId['S01-01'].requirements[0].allOf.includes('shoulder_mobility'), true);
  assert.equal(byId['S01-02'].requirements[0].allOf.includes('shoulder_mobility'), true);
  assert.equal(byId['S01-01'].requirements[1].minimumEvidenceByFact.pants, 'B');
  assert.equal(byId['S01-03'].requirements[0].minimumEvidenceByFact.pants, 'B');
  for (const id of ['W01-02', 'W01-03']) {
    assert.equal(byId[id].requirements.some((entry) => (
      entry.slot === 'outfit' && entry.allOf.includes('work_eligible')
    )), true, id);
  }
  assert.equal(byId['D01-05'].requirements.some((entry) => (
    entry.slot === 'outfit' && entry.allOf.includes('color_coordinated')
  )), true);
  assert.equal(byId['W01-04'].detailOnly, true);
  assert.equal(byId['D01-06'].detailOnly, true);
  for (const deletedId of ['W02-02', 'W04-02', 'S01-04', 'S02-04']) {
    assert.equal(byId[deletedId], undefined, deletedId);
  }
});

test('Limited copy branches structurally by scene and count', () => {
  assert.equal(getLimitedRecommendationCopy('home', 1), '适合在家穿的搭配不多，这次先给你这一套。');
  assert.equal(getLimitedRecommendationCopy('home', 2), '适合在家穿的搭配不多，这次先给你这几套。');
  assert.equal(getLimitedRecommendationCopy('work', 1), '适合上班穿的搭配不多，这次先给你这一套。');
  assert.equal(getLimitedRecommendationCopy('date', 2), '适合约会的搭配不多，这次先给你这几套。');
  assert.equal(getLimitedRecommendationCopy('sport', 2), '适合运动的衣服不多，这次先给你这几套。');
  assert.equal(getLimitedRecommendationCopy('sport', 0), '');
});
