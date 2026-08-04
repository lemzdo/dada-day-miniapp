const assert = require('node:assert/strict');
const test = require('node:test');
const {
  MAX_ALTERNATIVES,
  MAX_ARCHETYPES,
  MAX_FINAL_CARDS,
  MAX_REJECTION_REASONS,
  QA_BATCH_AUDIT_VERSION,
  QA_BYTE_LIMIT,
  buildQaAuditSummaries,
  buildQaBatchAudit,
  buildQaGateSummary,
  fitQaBatchAuditToBudget,
  serializedBytes,
} = require('./qaBatchAudit');
const { adaptCompositionCandidate, hydrateCanonicalScore } = require('./canonicalCandidate');
const { isRecommendationQaAuditEnabled } = require('./qaAuditControl');

function makeCandidate(id, options = {}) {
  const item = {
    _id: id,
    category: 'top',
    outfitSlot: 'top',
    outfitRole: 'core',
    imageUrl: options.imageUrl || `https://example.test/${id}.jpg`,
    styleTags: ['casual'],
  };
  const candidate = adaptCompositionCandidate({
    outfitKey: `outfit-${id}`,
    items: [item],
  }, { scene: 'home', weather: {} });
  candidate.archetype = options.archetype || 'casual_core';
  candidate.eligibilityReason = { code: options.reasonCode || 'HOME_COMFORT', subjectItemIds: [id] };
  candidate.rankingScore = options.score ?? 10;
  hydrateCanonicalScore(candidate, { title: options.title || `title-${id}`, scores: { total: options.score ?? 10 } });
  return candidate;
}

function buildAudit(overrides = {}) {
  const accepted = overrides.accepted || [makeCandidate('item-01'), makeCandidate('item-02', { score: 8 })];
  const rejected = overrides.rejected || [{
    candidate: makeCandidate('item-03'),
    rejectReasons: ['WORK_INVALID_SHOE'],
  }];
  return buildQaAuditSummaries({
    auditId: 'rec_test_123',
    requestScene: 'work',
    responseScene: '上班',
    weatherMode: 'live',
    hasUsableWeather: true,
    weatherSnapshotPresent: true,
    temperatureBandApplied: true,
    cloudBuild: 'generateOutfit-diagnostics-v1-20260720',
    guardAcceptedCandidates: accepted,
    guardRejectedCandidates: rejected,
    selectedOutfits: overrides.selected || accepted.slice(0, 1),
    compiledOutfits: overrides.compiled || [{
      outfitKey: accepted[0]?.outfitKey,
      title: '完整标题不得出现在 QA',
      styleTags: ['casual', 'clean'],
    }],
    timings: { compositionMs: 3, totalMs: 9 },
  });
}

function makeFinalOutfit(candidate, options = {}) {
  const title = options.title || `title-${candidate.outfitKey}`;
  return {
    outfitKey: options.outfitKey || candidate.outfitKey,
    displayTitle: title,
    title,
    styleTags: options.styleTags || [],
    items: options.items || [{ itemId: candidate.itemIds[0], category: 'top' }],
    copyContract: {
      todayReason: options.reason || `reason-${candidate.outfitKey}`,
      coreEligibilityReasonCode: options.reasonCode || candidate.eligibilityReason?.code || 'HOME_COMFORT',
      ...(options.riskFlags ? { riskFlags: options.riskFlags } : {}),
    },
  };
}

test('QA v6 is a bounded anonymous summary with explicit execution counts', () => {
  const { clientAudit, serverSummary } = buildAudit();
  assert.equal(clientAudit.version, 'qa-batch-audit-v6-1-semantic-presentation');
  assert.equal(QA_BATCH_AUDIT_VERSION, 'qa-batch-audit-v6-1-semantic-presentation');
  assert.equal(clientAudit.auditId, 'rec_test_123');
  assert.equal(clientAudit.counts.candidate, 3);
  assert.equal(clientAudit.counts.generated, 3);
  assert.equal(clientAudit.counts.accepted, 2);
  assert.equal(clientAudit.counts.rejected, 1);
  assert.equal(clientAudit.counts.selected, 1);
  assert.equal(clientAudit.alternativeCandidateCount, clientAudit.alternativeCandidates.length);
  assert.ok(serializedBytes(clientAudit) < QA_BYTE_LIMIT);
  assert.ok(serializedBytes(serverSummary) < 16 * 1024);
  assert.deepEqual(Object.keys(clientAudit.finalCards[0]).sort(), [
    'archetype', 'consistency', 'itemAliases', 'presentationFactSignatureHash',
    'primaryRelationCode', 'reasonCode', 'reasonSemanticSkeleton', 'score',
    'semanticEquivalentGroupCount', 'tagSignature', 'titleSemanticSkeleton',
    'titleSignature', 'todayReason', 'unsupportedClaimCount', 'visibleTags',
    'visibleTitle',
  ]);
  assert.match(clientAudit.finalCards[0].itemAliases[0], /^I\d{2,}$/);
  assert.equal(clientAudit.finalCards[0].titleSignature.includes('完整标题'), false);
});

test('QA v6 does not contain candidates, URLs, identifiers, or facts', () => {
  const realId = 'private-item-real-id';
  const { clientAudit } = buildAudit({
    accepted: [makeCandidate(realId, { imageUrl: 'https://private.example/image.jpg' })],
    rejected: [],
  });
  const json = JSON.stringify(clientAudit);
  for (const forbidden of [
    realId,
    'https://private.example/image.jpg',
    'openid',
    'userId',
    'visibleFacts',
    'copyFacts',
    'displayFacts',
    'allCandidates',
    'acceptedCandidates',
    'rejectedCandidates',
  ]) {
    assert.equal(json.includes(forbidden), false, `${forbidden} must not be returned`);
  }
});

test('real-scale QA fixture stays inside all summary limits', () => {
  const itemCount = 31;
  const candidates = Array.from({ length: 1200 }, (_, index) => makeCandidate(
    `item-${String(index % itemCount).padStart(2, '0')}`,
    { score: 2000 - index, archetype: `archetype-${index % 9}` },
  ));
  const rejected = candidates.slice(0, 200).map((candidate, index) => ({
    candidate,
    rejectReasons: [index % 2 === 0 ? 'WORK_INVALID_SHOE' : 'WORK_HOME_DOMINANT'],
  }));
  const { clientAudit, serverSummary } = buildAudit({
    accepted: candidates,
    rejected,
    selected: candidates.slice(0, 8),
    compiled: candidates.slice(0, 8).map((candidate) => ({
      outfitKey: candidate.outfitKey,
      title: `title-${candidate.outfitKey}`,
      styleTags: ['casual'],
    })),
  });
  assert.equal(clientAudit.counts.candidate, 1400);
  assert.ok(serializedBytes(clientAudit) < 16 * 1024);
  assert.ok(serializedBytes(serverSummary) < 16 * 1024);
  assert.ok(clientAudit.finalCards.length <= MAX_FINAL_CARDS);
  assert.ok(clientAudit.alternativeCandidates.length <= MAX_ALTERNATIVES);
  assert.ok(clientAudit.rejectionReasonHistogram.length <= MAX_REJECTION_REASONS);
  assert.ok(clientAudit.archetypeHistogram.length <= MAX_ARCHETYPES);
});

test('truncation preserves the fixed authoritative QA gate summary and candidate counts', () => {
  const { clientAudit } = buildAudit();
  const alternativeCandidateCount = clientAudit.alternativeCandidates.length;
  const forcedLimit = serializedBytes(clientAudit) - 1;
  fitQaBatchAuditToBudget(clientAudit, forcedLimit);

  assert.equal(clientAudit.qaTruncated, true);
  assert.equal(clientAudit.qaGateSummary.qaTruncated, true);
  assert.equal(clientAudit.qaGateSummary.alternativeCandidateCount, alternativeCandidateCount);
  assert.equal(clientAudit.qaGateSummary.finalCardCount, clientAudit.finalCards.length);
  assert.equal(clientAudit.qaGateSummary.counts.selected, clientAudit.counts.selected);
  assert.equal(Object.hasOwn(clientAudit, 'alternativeCandidates'), false);
});

test('zero alternatives remain explicitly present after QA truncation', () => {
  const accepted = Array.from({ length: 8 }, (_, index) => makeCandidate(`selected-${index}`, { score: 100 - index }));
  const { clientAudit } = buildAudit({ accepted, selected: accepted, compiled: accepted.map((candidate) => ({
    outfitKey: candidate.outfitKey,
    title: `title-${candidate.outfitKey}`,
  })) });
  assert.equal(clientAudit.alternativeCandidateCount, 0);
  fitQaBatchAuditToBudget(clientAudit, serializedBytes(clientAudit) - 1);
  assert.equal(Object.hasOwn(clientAudit.qaGateSummary, 'alternativeCandidateCount'), true);
  assert.equal(clientAudit.qaGateSummary.alternativeCandidateCount, 0);
  assert.equal(Object.hasOwn(clientAudit, 'alternativeCandidates'), false);
});

for (const [gateStatus, qaGatePassed, blockReasons] of [
  ['passed', true, []],
  ['passed_with_warnings', true, []],
  ['failed', false, ['UNSUPPORTED_CLAIM']],
]) {
  test(`fixed QA gate summary preserves ${gateStatus}`, () => {
    const summary = buildQaGateSummary({
      version: QA_BATCH_AUDIT_VERSION,
      counts: { candidate: 8, generated: 8, accepted: 8, rejected: 0, selected: 8 },
      finalCards: Array.from({ length: 8 }, () => ({})),
      alternativeCandidateCount: 3,
      alternativeCandidates: Array.from({ length: 3 }, () => ({})),
      qaGatePassed,
      gateStatus,
      qaBlockReasons: blockReasons,
      duplicateCause: gateStatus === 'passed_with_warnings' ? 'FACT_EQUIVALENCE' : 'NONE',
      titleDuplicateWarningCount: gateStatus === 'passed_with_warnings' ? 2 : 0,
      unsupportedClaimCount: gateStatus === 'failed' ? 1 : 0,
      qaTruncated: true,
    });
    assert.equal(summary.gateStatus, gateStatus);
    assert.equal(summary.qaGatePassed, qaGatePassed);
    assert.deepEqual(summary.qaBlockReasons, blockReasons);
    assert.equal(summary.finalCardCount, 8);
    assert.equal(summary.alternativeCandidateCount, 3);
    assert.equal(summary.qaTruncated, true);
  });
}

test('QA helper returns no audit until request and server switches are both enabled', () => {
  assert.equal(isRecommendationQaAuditEnabled(false, 'true'), false);
  assert.equal(isRecommendationQaAuditEnabled(true, 'false'), false);
  assert.equal(isRecommendationQaAuditEnabled(true, 'true'), true);
});

test('standalone client QA builder retains the v6 contract', () => {
  const audit = buildQaBatchAudit({
    auditId: 'rec_contract',
    guardAcceptedCandidates: [makeCandidate('one')],
    selectedOutfits: [makeCandidate('one')],
  });
  assert.equal(audit.version, QA_BATCH_AUDIT_VERSION);
  assert.equal(Object.hasOwn(audit, 'requestIdentity'), false);
  assert.equal(Object.hasOwn(audit, 'topReuseHistogram'), false);
  assert.equal(Object.hasOwn(audit, 'titleSignatureHistogram'), false);
});

test('V6 QA keeps execution and count telemetry explicit instead of inferring it from final cards', () => {
  const { clientAudit, serverSummary } = buildQaAuditSummaries({
    auditId: 'rec_v6_execution',
    cloudBuild: 'generateOutfit-recommendation-v6-1-semantic-render-binding-fix-20260726',
    acceptedCandidates: [makeCandidate('one')],
    selectedOutfits: [makeCandidate('one')],
    counts: { generated: 480, candidate: 240, accepted: 120, rejected: 120, selected: 1 },
    rejectionReasonCounts: { SPORT_NON_SPORT_APPAREL: 360 },
    execution: {
      executionMode: 'candidate_pool_hit',
      candidatePoolIdentityHash: 'a'.repeat(64),
      candidatePoolAgeMs: 42,
      cacheHit: true,
      cacheMissReason: '',
      exclusionsAppliedCount: 8,
    },
  });

  assert.deepEqual(clientAudit.counts, { generated: 480, candidate: 240, accepted: 120, rejected: 120, selected: 1 });
  assert.equal(clientAudit.executionMode, 'candidate_pool_hit');
  assert.equal(clientAudit.cacheHit, true);
  assert.equal(clientAudit.exclusionsAppliedCount, 8);
  assert.equal(serverSummary.generated, 480);
  assert.equal(clientAudit.rejectionReasonHistogram[0].reason, 'SPORT_NON_SPORT_APPAREL');
});

test('QA audits the final visible card object, including title, tags, reason, and reuse', () => {
  const candidates = [makeCandidate('one'), makeCandidate('two')];
  const finalOutfits = candidates.map((candidate, index) => ({
    outfitKey: candidate.outfitKey,
    scene: 'work',
    displayTitle: `通勤上衣下装组合${index + 1}`,
    title: `通勤上衣下装组合${index + 1}`,
    styleTags: ['通勤', '通勤', '简约'],
    copyContract: {
      todayReason: `第${index + 1}套通勤理由。`,
      coreEligibilityReasonCode: 'WORK_BASELINE_PRESENTABLE',
    },
    snapshotItems: [{ itemId: 'shared-shirt', category: 'top' }],
  }));
  const { clientAudit } = buildQaAuditSummaries({
    selectedOutfits: candidates,
    finalOutfits,
    acceptedCandidates: candidates,
  });
  assert.equal(clientAudit.finalCards[0].visibleTitle, finalOutfits[0].displayTitle);
  assert.deepEqual(clientAudit.finalCards[0].visibleTags, ['通勤', '通勤', '简约']);
  assert.equal(clientAudit.finalCards[0].todayReason, finalOutfits[0].copyContract.todayReason);
  assert.equal(clientAudit.cardConsistencyFailures, 0);
  assert.equal(clientAudit.reuseExplanations[0].code, 'item_reuse_visible_batch');
});

test('canonical presentation QA blocks synthetic suffixes and normalized all-duplicate copy', () => {
  const candidates = [makeCandidate('one'), makeCandidate('two')];
  const finalOutfits = candidates.map((candidate, index) => ({
    outfitKey: candidate.outfitKey,
    displayTitle: `通勤衬衫（${index + 1}）`,
    styleTags: ['通勤'],
    copyContract: {
      todayReason: `今天适合通勤（${index + 1}）`,
      coreEligibilityReasonCode: 'WORK_BASELINE_PRESENTABLE',
    },
  }));
  const { clientAudit, serverSummary } = buildQaAuditSummaries({
    selectedOutfits: candidates,
    finalOutfits,
    acceptedCandidates: candidates,
  });
  assert.equal(clientAudit.exactTitleDuplicateGroups.length, 0);
  assert.equal(clientAudit.normalizedTitleDuplicateGroups[0].count, 2);
  assert.equal(clientAudit.normalizedReasonDuplicateGroups[0].count, 2);
  assert.equal(clientAudit.syntheticSuffixCount, 4);
  assert.equal(clientAudit.gateStatus, 'failed');
  assert.equal(clientAudit.qaGatePassed, false);
  assert.equal(clientAudit.duplicateCause, 'SYNTHETIC_VARIATION');
  assert.deepEqual(clientAudit.qaBlockReasons, ['SYNTHETIC_SUFFIX']);
  assert.deepEqual(serverSummary.qaBlockReasons, clientAudit.qaBlockReasons);
  assert.equal(serverSummary.gateStatus, 'failed');
});

test('identical canonical titles caused by equivalent facts pass with a warning', () => {
  const candidates = [makeCandidate('one'), makeCandidate('two')];
  const finalOutfits = candidates.map((candidate) => ({
    outfitKey: candidate.outfitKey,
    displayTitle: '轻运动T恤黑色短裤灰色运动鞋搭配',
    title: '轻运动T恤黑色短裤灰色运动鞋搭配',
    styleTags: ['运动'],
    items: [{
      itemId: candidate.itemIds[0],
      category: 'top',
      subcategory: 'tshirt',
      factRecords: [{ fact: 'subcategory', value: 'tshirt', authorized: true }],
    }],
    copyContract: {
      todayReason: '运动场景的有效事实理由',
      coreEligibilityReasonCode: 'SPORT_LIGHT_ACTIVITY_SET',
    },
  }));
  assert.doesNotThrow(() => buildQaAuditSummaries({
    selectedOutfits: candidates,
    finalOutfits,
    acceptedCandidates: candidates,
  }));
  const { clientAudit, serverSummary } = buildQaAuditSummaries({
    selectedOutfits: candidates,
    finalOutfits,
    acceptedCandidates: candidates,
  });
  assert.equal(clientAudit.exactTitleDuplicateGroups[0].count, 2);
  assert.equal(clientAudit.normalizedTitleDuplicateGroups[0].count, 2);
  assert.equal(clientAudit.syntheticSuffixCount, 0);
  assert.equal(clientAudit.availableDifferentiatorCount, 0);
  assert.equal(clientAudit.duplicateCause, 'FACT_EQUIVALENCE');
  assert.equal(clientAudit.titleDuplicateWarningCount, 2);
  assert.equal(clientAudit.gateStatus, 'passed_with_warnings');
  assert.equal(clientAudit.qaGatePassed, true);
  assert.deepEqual(clientAudit.qaBlockReasons, []);
  assert.equal(serverSummary.gateStatus, 'passed_with_warnings');
  assert.equal(serverSummary.duplicateCause, 'FACT_EQUIVALENCE');
});

test('available color or subtype facts make an all-duplicate title a QA failure', () => {
  const candidates = [makeCandidate('one'), makeCandidate('two')];
  const finalOutfits = candidates.map((candidate, index) => makeFinalOutfit(candidate, {
    title: '同一标题',
    reason: '上衣颜色关系相同但未在标题中表达。',
    items: [{
      itemId: candidate.itemIds[0],
      category: 'top',
      subcategory: 'tshirt',
      color: index === 0 ? 'black' : 'white',
      factRecords: [{ fact: 'color', value: index === 0 ? 'black' : 'white', authorized: true }],
    }],
  }));
  const { clientAudit } = buildQaAuditSummaries({
    selectedOutfits: candidates,
    finalOutfits,
    acceptedCandidates: candidates,
  });
  assert.ok(clientAudit.availableDifferentiatorCount > 0);
  assert.equal(clientAudit.duplicateCause, 'DIFFERENTIATOR_IGNORED');
  assert.equal(clientAudit.gateStatus, 'failed');
  assert.equal(clientAudit.qaGatePassed, false);
  assert.ok(clientAudit.qaBlockReasons.includes('DIFFERENTIATOR_IGNORED'));
});

test('different primary relations with relation-bearing reasons are not ignored', () => {
  const candidates = [makeCandidate('one'), makeCandidate('two')];
  const finalOutfits = candidates.map((candidate, index) => makeFinalOutfit(candidate, {
    title: '同一标题',
    reason: index === 0 ? '上衣与鞋子同色呼应。' : '上下装颜色层次清楚。',
    items: [{
      itemId: candidate.itemIds[0],
      category: index === 0 ? 'top' : 'bottom',
      subcategory: index === 0 ? 'tshirt' : 'shorts',
      factRecords: [{ fact: 'color', value: index === 0 ? 'black' : 'white', authorized: true }],
    }],
  }));
  const { clientAudit } = buildQaAuditSummaries({
    selectedOutfits: candidates,
    finalOutfits,
    acceptedCandidates: candidates,
  });
  assert.equal(clientAudit.duplicateCause, 'NONE');
  assert.equal(clientAudit.titleDuplicateWarningCount, 0);
  assert.equal(clientAudit.gateStatus, 'passed');
});

test('numeric title suffixes fail as synthetic variation', () => {
  const candidates = [makeCandidate('one'), makeCandidate('two')];
  const finalOutfits = candidates.map((candidate, index) => makeFinalOutfit(candidate, {
    title: `同一标题（${index + 1}）`,
    reason: `推荐理由（${index + 1}）`,
  }));
  const { clientAudit } = buildQaAuditSummaries({
    selectedOutfits: candidates,
    finalOutfits,
    acceptedCandidates: candidates,
  });
  assert.equal(clientAudit.duplicateCause, 'SYNTHETIC_VARIATION');
  assert.equal(clientAudit.syntheticSuffixCount, 4);
  assert.equal(clientAudit.gateStatus, 'failed');
});

test('repeated outfit keys fail even when titles are fact-equivalent', () => {
  const candidates = [makeCandidate('one'), makeCandidate('two')];
  candidates[1].outfitKey = candidates[0].outfitKey;
  const finalOutfits = candidates.map((candidate) => makeFinalOutfit(candidate, {
    title: '同一标题',
  }));
  const { clientAudit } = buildQaAuditSummaries({
    selectedOutfits: candidates,
    finalOutfits,
    acceptedCandidates: candidates,
  });
  assert.ok(clientAudit.qaBlockReasons.includes('DUPLICATE_OUTFIT_KEY'));
  assert.equal(clientAudit.gateStatus, 'failed');
});

test('repeated item sets fail even when outfit keys and titles differ', () => {
  const candidates = [makeCandidate('one'), makeCandidate('two')];
  const finalOutfits = candidates.map((candidate, index) => makeFinalOutfit(candidate, {
    title: `标题${index === 0 ? '甲' : '乙'}`,
    items: [{ itemId: 'same-item', category: 'top' }],
  }));
  const { clientAudit } = buildQaAuditSummaries({
    selectedOutfits: candidates,
    finalOutfits,
    acceptedCandidates: candidates,
  });
  assert.ok(clientAudit.qaBlockReasons.includes('DUPLICATE_ITEM_SET'));
  assert.equal(clientAudit.gateStatus, 'failed');
});

test('unique titles and unique item sets pass without warnings', () => {
  const candidates = [makeCandidate('one'), makeCandidate('two')];
  const finalOutfits = candidates.map((candidate, index) => makeFinalOutfit(candidate, {
    title: `标题${index === 0 ? '甲' : '乙'}`,
  }));
  const { clientAudit } = buildQaAuditSummaries({
    selectedOutfits: candidates,
    finalOutfits,
    acceptedCandidates: candidates,
  });
  assert.equal(clientAudit.titleDuplicateWarningCount, 0);
  assert.equal(clientAudit.duplicateCause, 'NONE');
  assert.equal(clientAudit.gateStatus, 'passed');
  assert.equal(clientAudit.qaGatePassed, true);
});

test('eligibility rejection audit is restricted to sport debug requests', () => {
  const base = {
    auditId: 'rec_sport_audit',
    sceneKey: 'sport',
    guardRejectedCandidates: [{
      candidate: makeCandidate('sport-rejected'),
      rejectionStage: 'scene_eligibility',
      rejectReasons: ['SPORT_NON_SPORT_APPAREL'],
    }],
    counts: { generated: 132, candidate: 132, accepted: 0, rejected: 132, selected: 0 },
  };
  assert.equal(Object.hasOwn(buildQaAuditSummaries({ ...base, eligibilityRejectionAuditEnabled: false }).clientAudit, 'eligibilityRejectionAudit'), false);
  const enabledAudit = buildQaAuditSummaries({ ...base, eligibilityRejectionAuditEnabled: true }).clientAudit;
  assert.equal(enabledAudit.eligibilityRejectionAudit.guardRejectedCount, 132);
  assert.deepEqual(enabledAudit.eligibilityRejectionAudit.rejectionReasonHistogram, { SPORT_NON_SPORT_APPAREL: 1 });
  assert.equal(Object.hasOwn(buildQaAuditSummaries({ ...base, sceneKey: 'work', eligibilityRejectionAuditEnabled: true }).clientAudit, 'eligibilityRejectionAudit'), false);
});
