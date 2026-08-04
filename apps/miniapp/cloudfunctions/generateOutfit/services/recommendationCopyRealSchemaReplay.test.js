const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { CLAIM_CATALOG } = require('./xiaodaVoiceBankV2');
const {
  REPLAY_SCENES,
  buildAllRealSchemaReplays,
} = require('./recommendationCopyRealSchemaReplay.fixture');

test('real-schema replay runs raw wardrobe through eligibility Planner Gate and new finalizer', () => {
  const approved = new Set(CLAIM_CATALOG.map((claim) => claim.text));
  const replays = buildAllRealSchemaReplays();
  for (const scene of REPLAY_SCENES) {
    const replay = replays[scene];
    assert.equal(replay.fixtureKind, 'real-schema replay');
    assert.match(replay.fixtureOrigin, /not production data/);
    assert.ok(replay.requestedCount > 0, scene);
    assert.ok(replay.acceptedCount > 0, scene);
    assert.equal(replay.finalApiCount, replay.acceptedCount, scene);
    assert.equal(replay.candidates.every((candidate) => candidate.sceneEligibility), true, scene);
    for (const candidate of replay.candidates) {
      assert.equal(candidate.includedInFinalApiArray, true, `${scene}:${candidate.outfitId}`);
      assert.equal(candidate.copyDisplay, candidate.gateResult === 'PASS' ? 'visible' : 'hidden');
      if (candidate.gateResult === 'PASS') assert.ok(approved.has(candidate.todayReason), scene);
    }
  }
});

test('real-schema raw wardrobe never injects Contract shortcuts', () => {
  const replays = buildAllRealSchemaReplays();
  for (const replay of Object.values(replays)) {
    const raw = JSON.stringify(replay.rawWardrobe);
    assert.equal(raw.includes('contractFacts'), false, replay.scene);
    assert.equal(raw.includes('"authorized":true'), false, replay.scene);
    assert.equal(raw.includes('"confidence":0.95'), false, replay.scene);
  }
});

test('real-schema sport selects S01-01 from complete reliable movement evidence', () => {
  const sport = buildAllRealSchemaReplays().sport;
  const allowedDetailCopy = new Set(CLAIM_CATALOG
    .filter((claim) => claim.scene === 'sport' && ['S02', 'S03'].includes(claim.group))
    .map((claim) => claim.text));

  assert.ok(sport.candidates.length > 0);
  for (const candidate of sport.candidates) {
    assert.equal(candidate.gateResult, 'PASS');
    assert.equal(candidate.claimId, 'S01-01');
    assert.equal(
      candidate.detailExplanation === null || allowedDetailCopy.has(candidate.detailExplanation),
      true,
    );
  }
});

test('weak structured functional facts remain visible to risk analysis but never support copy', () => {
  const replays = buildAllRealSchemaReplays();
  const rejectedWeakFacts = Object.values(replays).flatMap((replay) => replay.candidates)
    .flatMap((candidate) => candidate.rejectedWeakFunctionalFacts);
  assert.ok(rejectedWeakFacts.some((factId) => factId.endsWith(':breathability')));
  assert.ok(rejectedWeakFacts.some((factId) => factId.endsWith(':cushioning')));
  for (const replay of Object.values(replays)) {
    for (const candidate of replay.candidates) {
      const evidence = new Set(candidate.extractedFacts
        .filter((record) => record.evidenceLevel !== 'C')
        .map((record) => record.factId));
      assert.equal(candidate.rejectedWeakFunctionalFacts.some((factId) => evidence.has(factId)), false);
    }
  }
});

test('replay fixture source proves the complete in-memory path', () => {
  const source = fs.readFileSync(path.join(__dirname, 'recommendationCopyRealSchemaReplay.fixture.js'), 'utf8');
  for (const call of [
    'buildOutfitCandidatesV1(',
    'extractOutfitFactsV3(',
    'compileRecommendationLanguageV3(',
    "finalizeAcceptedRecommendations(compiled, { mode: 'new_recommendation' })",
  ]) assert.equal(source.includes(call), true, call);
});
