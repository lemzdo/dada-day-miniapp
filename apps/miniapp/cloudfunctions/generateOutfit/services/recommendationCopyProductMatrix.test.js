const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { CLAIM_CATALOG } = require('./xiaodaVoiceBankV2');
const { ELIGIBILITY_REASON_CATALOG } = require('./recommendationEligibilityReason');
const {
  buildSyntheticContractBatchSummaries,
  renderSnapshotReviewMarkdown,
  renderVoiceReviewMarkdown,
} = require('./recommendationCopyProductMatrix.fixture');

const QA_DIR = path.resolve(__dirname, '../../../../../docs/qa');
const VOICE_REVIEW_PATH = path.join(QA_DIR, 'xiaoda-voice-bank-v2-review.md');
const SNAPSHOT_REVIEW_PATH = path.join(QA_DIR, 'recommendation-copy-contract-v1-snapshots.md');

test('four synthetic Contract requests use one wardrobe weather and scene each', () => {
  const batches = buildSyntheticContractBatchSummaries();
  const expectedAccepted = { home: 4, work: 4, date: 1, sport: 4 };
  for (const scene of ['home', 'work', 'date', 'sport']) {
    const batch = batches[scene];
    assert.equal(batch.requestedCount, 4, scene);
    assert.equal(batch.acceptedCount, expectedAccepted[scene], scene);
    assert.equal(batch.finalApiCount, batch.acceptedCount, scene);
    assert.equal(batch.coreReasonAcceptedCount, batch.finalApiCount, scene);
    assert.equal(batch.copyAcceptedCount, batch.finalApiCount, scene);
    assert.equal(batch.copyHiddenCount, 0, scene);
    assert.equal(batch.coreReasonCoverageGapCount, 0, scene);
    assert.equal(batch.selections.every((entry) => entry.scene === scene), true, scene);
    assert.equal(batch.selections.every((entry) => JSON.stringify(entry.weather) === JSON.stringify(batch.sharedWeather)), true, scene);
    assert.equal(new Set(batch.selections.flatMap((entry) => entry.selectedOutfitItemIds)
      .map((id) => batch.wardrobe.some((item) => item.itemId === id))).has(false), false, scene);
  }
});

test('snapshot rows expose Claim evidence source confidence membership and optional detail', () => {
  const batches = buildSyntheticContractBatchSummaries();
  for (const batch of Object.values(batches)) {
    for (const selection of batch.selections) {
      assert.ok(Array.isArray(selection.selectedOutfitItemIds));
      assert.ok(Array.isArray(selection.selectedItems));
      assert.ok(Array.isArray(selection.subjectItemIds));
      assert.ok(Array.isArray(selection.requiredFactIds));
      assert.ok(Array.isArray(selection.evidenceFactIds));
      assert.ok(Array.isArray(selection.evidenceSources));
      assert.ok(Array.isArray(selection.coreEligibilityEvidence));
      assert.ok(['PASS', 'REJECT'].includes(selection.gateResult));
      assert.ok(['visible', 'hidden'].includes(selection.detailDisplay));
      if (selection.gateResult === 'PASS') {
        assert.ok(selection.todayReason);
        assert.ok(selection.coreEligibilityReason);
        assert.ok(selection.coreEligibilityReasonCode);
        assert.ok(selection.coreEligibilityEvidence.length > 0);
        assert.equal(selection.requiredFactIds.every((id) => selection.evidenceFactIds.includes(id)), true);
        assert.equal(selection.subjectItemIds.every((id) => selection.selectedOutfitItemIds.includes(id)), true);
        assert.equal(Object.values(selection.slotBindings).every((id) => selection.selectedOutfitItemIds.includes(id)), true);
        assert.equal(selection.evidenceSources.every((entry) => (
          entry.itemId
            ? selection.selectedOutfitItemIds.includes(entry.itemId)
            : Array.isArray(entry.subjectItemIds)
              && entry.subjectItemIds.every((id) => selection.selectedOutfitItemIds.includes(id))
        )), true);
      } else {
        assert.equal(selection.includedInFinalApiArray, false);
        assert.equal(selection.copyDisplay, 'hidden');
        assert.equal(selection.todayReason, '');
      }
    }
  }
});

test('all snapshot copy keeps a non-empty fact-bound eligibility reason', () => {
  for (const batch of Object.values(buildSyntheticContractBatchSummaries())) {
    for (const selection of batch.selections) {
      if (selection.todayReason) {
        assert.ok(selection.todayReason.trim());
        assert.ok(selection.coreEligibilityReasonCode);
      }
      if (selection.detailExplanation) assert.ok(selection.detailExplanation.trim());
    }
  }
});

test('both QA documents exactly match deterministic runtime renderers', () => {
  const voice = fs.readFileSync(VOICE_REVIEW_PATH, 'utf8');
  const snapshots = fs.readFileSync(SNAPSHOT_REVIEW_PATH, 'utf8');
  assert.equal(voice, renderVoiceReviewMarkdown());
  assert.equal(snapshots, renderSnapshotReviewMarkdown());
  for (const section of [
    '## P0 回归：穿搭资格与文案资格解耦',
    '## 事实授权矩阵',
    '## 基础资格理由 Catalog',
    '## 基础、增强与 relation',
    '## A. Synthetic Contract QA',
    '## B. Real-schema Replay',
    '## C. Saved Snapshot Compatibility',
    '## D. 376 → 285 → 当前测试迁移',
  ]) assert.equal(`${voice}\n${snapshots}`.includes(section), true, section);
  assert.match(snapshots, /HOME_HOT_SLEEVELESS_SHORTS/);
  assert.match(snapshots, /今天31℃，无袖上衣配短裤，宅家穿正合适，整身也不会显得厚重。/);
  assert.match(snapshots, /Today reason non-empty: true/);
  assert.match(snapshots, /旧收藏 \| true \| true \| false \| false \| false \| REJECT/);
  assert.match(snapshots, /repository recognition\/composition test schema; not production data/);
});

test('Voice review lists every fixed Claim once and no 128-row migration table', () => {
  const voice = fs.readFileSync(VOICE_REVIEW_PATH, 'utf8');
  const source = [
    voice,
    fs.readFileSync(SNAPSHOT_REVIEW_PATH, 'utf8'),
  ].join('\n');
  for (const reason of ELIGIBILITY_REASON_CATALOG) {
    assert.equal((source.match(new RegExp(`\\| ${reason.reasonCode} \\|`, 'g')) || []).length, 1, reason.reasonCode);
  }
  for (const claim of CLAIM_CATALOG) {
    assert.equal((source.match(new RegExp(`\\| ${claim.claimId} \\|`, 'g')) || []).length, 1, claim.claimId);
  }
  assert.equal(voice.includes('keep/rewrite/remove'), false);
  assert.equal(source.includes('128 条句库不参与选句'), true);
  assert.equal(source.includes('fallback 数量为 0'), true);
});
