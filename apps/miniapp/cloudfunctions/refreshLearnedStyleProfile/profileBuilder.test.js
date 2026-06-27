const assert = require('node:assert/strict');
const test = require('node:test');

const {
  FIXTURE_CATALOG,
  NOW,
  clothing,
  clothingIdFor,
  daysAgo,
  daysFromNow,
  event,
  outfitKeyFor,
  readyScenario,
} = require('./profileBuilder.fixtures');

const {
  buildLearnedStyleProfile,
  calculateEventWeight,
  extractLearnableFeatures,
} = require('./profileBuilder');

function signal(profile, dimension, side, value) {
  return profile.global[dimension][side].find((item) => item.value === value);
}

function allSignals(profile) {
  const items = [];
  for (const dimension of Object.values(profile.global)) {
    items.push(...dimension.positive, ...dimension.negative);
  }
  return items;
}

test('fixture catalog covers at least 36 deterministic samples', () => {
  assert.equal(FIXTURE_CATALOG.length >= 36, true);
  assert.equal(new Set(FIXTURE_CATALOG).size, FIXTURE_CATALOG.length);
});

test('empty events produce insufficient serializable profile', () => {
  const profile = buildLearnedStyleProfile({ events: [], clothes: [], now: NOW });

  assert.equal(profile.schemaVersion, 1);
  assert.equal(profile.profileVersion, 'learned-style-v1');
  assert.equal(profile.status, 'insufficient_data');
  assert.equal(profile.source.eventCount, 0);
  assert.equal(profile.quality.effectiveActionWeight, 0);
  assert.doesNotThrow(() => JSON.stringify(profile));
});

test('exposure only counts exposure without negative preference', () => {
  const profile = buildLearnedStyleProfile({
    now: NOW,
    clothes: [clothing()],
    events: [
      event({
        eventType: 'recommendation_exposure',
        eventId: 'evt-exposure',
        recommendationBatchId: 'batch-1',
        context: { source: 'today', position: 0, candidateCount: 1 },
      }),
    ],
  });

  assert.equal(profile.source.exposureCount, 1);
  assert.equal(profile.source.eligibleEventCount, 0);
  assert.equal(allSignals(profile).length, 0);
});

test('detail favorite and unfavorite weights have the expected priority', () => {
  assert.equal(calculateEventWeight({ eventType: 'outfit_detail_view', occurredAt: NOW }, { now: NOW }), 0.5);
  assert.equal(calculateEventWeight({ eventType: 'outfit_favorite', occurredAt: NOW }, { now: NOW }), 2);
  assert.equal(calculateEventWeight({ eventType: 'outfit_unfavorite', occurredAt: NOW }, { now: NOW }), -2.5);
});

test('wear weight increases for repeated wear and caps on the third wear', () => {
  const first = calculateEventWeight({ eventType: 'outfit_wear', occurredAt: NOW }, { now: NOW, wearIndex: 1 });
  const second = calculateEventWeight({ eventType: 'outfit_wear', occurredAt: NOW }, { now: NOW, wearIndex: 2 });
  const third = calculateEventWeight({ eventType: 'outfit_wear', occurredAt: NOW }, { now: NOW, wearIndex: 3 });
  const fourth = calculateEventWeight({ eventType: 'outfit_wear', occurredAt: NOW }, { now: NOW, wearIndex: 4 });

  assert.equal(first, 4);
  assert.equal(second, 5.5);
  assert.equal(third, 7);
  assert.equal(fourth, 7);
});

test('time decay follows event half lives and skips invalid or old events', () => {
  const recent = calculateEventWeight({ eventType: 'outfit_favorite', occurredAt: NOW }, { now: NOW });
  const old = calculateEventWeight({ eventType: 'outfit_favorite', occurredAt: daysAgo(120) }, { now: NOW });
  const outside = calculateEventWeight({ eventType: 'outfit_favorite', occurredAt: daysAgo(181) }, { now: NOW });
  const invalid = calculateEventWeight({ eventType: 'outfit_favorite', occurredAt: 'not-a-date' }, { now: NOW });
  const future = calculateEventWeight({ eventType: 'outfit_favorite', occurredAt: daysFromNow(2) }, { now: NOW });

  assert.equal(recent, 2);
  assert.equal(Number(old.toFixed(3)), 1);
  assert.equal(outside, null);
  assert.equal(invalid, null);
  assert.equal(future, 2);
});

test('extractLearnableFeatures filters low confidence and unknown aesthetic values', () => {
  const features = extractLearnableFeatures(clothing({
    aestheticFeatures: {
      ...clothing().aestheticFeatures,
      fit: 'unknown',
      silhouette: 'straight',
      patternType: 'unknown',
      designElements: ['pleat'],
      formalityLevel: 3,
      confidence: {
        fit: 'high',
        length: 'high',
        silhouette: 'low',
        patternType: 'high',
        designElements: 'medium',
        formalityLevel: 'high',
      },
    },
  }));

  assert.deepEqual(features.fit, []);
  assert.deepEqual(features.silhouette, []);
  assert.deepEqual(features.patternType, []);
  assert.deepEqual(features.designElement, ['pleat']);
  assert.deepEqual(features.formalityLevel, ['3']);
});

test('extractLearnableFeatures maps color families and cleans style tags', () => {
  const features = extractLearnableFeatures(clothing({
    colorPalette: [
      { name: 'secondary red', hex: '#ff0000', role: 'secondary' },
      { name: 'navy', role: 'primary' },
    ],
    styleTags: [' clean ', 'clean', 'this tag is far too long to be accepted as a compact style tag'],
    style: 'smart',
  }));

  assert.deepEqual(features.colorFamily, ['navy']);
  assert.deepEqual(features.styleTag, ['clean', 'smart']);
});

test('per outfit feature values are deduped and event weight is split by dimension', () => {
  const profile = buildLearnedStyleProfile({
    now: NOW,
    clothes: [
      clothing({ _id: 'cloth-a', id: 'cloth-a', colorPalette: [{ name: 'black', role: 'primary' }], styleTags: ['clean'] }),
      clothing({ _id: 'cloth-b', id: 'cloth-b', colorPalette: [{ name: 'black', role: 'primary' }], styleTags: ['clean', 'smart'] }),
    ],
    events: [
      event({
        eventType: 'outfit_favorite',
        eventId: 'evt-fav',
        occurredAt: NOW,
        outfitKey: 'outfit-ab',
        clothingIds: ['cloth-b', 'cloth-a'],
      }),
    ],
  });

  assert.equal(signal(profile, 'colorFamily', 'positive', 'black').supportWeight, 2);
  assert.equal(signal(profile, 'styleTag', 'positive', 'clean').supportWeight, 1);
  assert.equal(signal(profile, 'styleTag', 'positive', 'smart').supportWeight, 1);
});

test('refresh only applies weak negative feedback to exposed outfits and respects same day cap', () => {
  const events = [
    event({
      eventId: 'evt-exposure',
      eventType: 'recommendation_exposure',
      recommendationBatchId: 'batch-1',
      outfitKey: 'outfit-1',
      clothingIds: ['cloth-1'],
      context: { source: 'today', position: 0, candidateCount: 1 },
    }),
    event({
      eventId: 'evt-favorite',
      eventType: 'outfit_favorite',
      occurredAt: NOW,
      recommendationBatchId: 'batch-1',
      outfitKey: 'outfit-1',
      clothingIds: ['cloth-1'],
    }),
    ...[1, 2, 3, 4].map((index) => event({
      eventId: `evt-refresh-${index}`,
      eventType: 'recommendation_batch_refresh',
      occurredAt: NOW,
      recommendationBatchId: 'batch-1',
      batchOutfitKeys: ['outfit-1', 'hidden-outfit'],
      clothingIds: [],
      outfitKey: undefined,
      context: { trigger: 'manual', scene: 'work', candidateCount: 2 },
    })),
  ];

  const profile = buildLearnedStyleProfile({ now: NOW, clothes: [clothing()], events });
  const black = signal(profile, 'colorFamily', 'positive', 'black');

  assert.equal(profile.source.eligibleEventCount, 4);
  assert.equal(black.positiveWeight, 2);
  assert.equal(Number(black.negativeWeight.toFixed(1)), 0.6);
  assert.equal(signal(profile, 'colorFamily', 'negative', 'other'), undefined);
});

test('missing clothing skips that item without failing the whole outfit', () => {
  const profile = buildLearnedStyleProfile({
    now: NOW,
    clothes: [clothing({ _id: 'cloth-1', id: 'cloth-1' })],
    events: [event({ eventId: 'evt-fav', clothingIds: ['missing', 'cloth-1'] })],
  });

  assert.equal(profile.source.eligibleEventCount, 1);
  assert.ok(signal(profile, 'fit', 'positive', 'regular'));
});

test('unsupported aesthetic version does not block color or style learning', () => {
  const profile = buildLearnedStyleProfile({
    now: NOW,
    clothes: [clothing({ aestheticFeatures: { ...clothing().aestheticFeatures, version: 2 } })],
    events: [event({ eventId: 'evt-fav', occurredAt: NOW })],
  });

  assert.equal(signal(profile, 'fit', 'positive', 'regular'), undefined);
  assert.ok(signal(profile, 'colorFamily', 'positive', 'black'));
  assert.ok(signal(profile, 'styleTag', 'positive', 'clean'));
});

test('ready scenario meets global gates and emits only qualified scene contexts', () => {
  const scenario = readyScenario();
  const profile = buildLearnedStyleProfile({ ...scenario, now: NOW });

  assert.equal(profile.status, 'shadow_ready');
  assert.equal(profile.source.eligibleEventCount, 8);
  assert.equal(profile.source.distinctOutfitCount, 4);
  assert.equal(profile.quality.effectiveActionWeight >= 8, true);
  assert.equal(profile.quality.featureCoverage >= 0.35, true);
  assert.ok(profile.contexts.work);
  assert.equal(profile.contexts.date, undefined);
});

test('scores confidence ranges maximum item counts and ordering are deterministic', () => {
  const clothes = Array.from({ length: 7 }, (_, index) => clothing({
    _id: clothingIdFor(index),
    id: clothingIdFor(index),
    styleTags: [`style-${index}`],
  }));
  const events = clothes.map((item, index) => event({
    eventId: `evt-${index}`,
    outfitKey: outfitKeyFor(index),
    clothingIds: [item._id],
    eventType: 'outfit_wear',
  }));

  const first = buildLearnedStyleProfile({ now: NOW, clothes, events });
  const second = buildLearnedStyleProfile({ now: NOW, clothes: [...clothes].reverse(), events: [...events].reverse() });

  assert.deepEqual(first, second);
  assert.equal(first.global.styleTag.positive.length, 5);
  for (const item of allSignals(first)) {
    assert.equal(item.score >= -1 && item.score <= 1, true);
    assert.equal(item.confidence >= 0 && item.confidence <= 1, true);
    assert.equal(Number.isFinite(item.supportWeight), true);
  }
});

test('quality metrics include context coverage repeated wear and stable digest', () => {
  const profile = buildLearnedStyleProfile({
    now: NOW,
    clothes: [clothing()],
    events: [
      event({ eventId: 'evt-wear-1', eventType: 'outfit_wear', occurredAt: daysAgo(2) }),
      event({ eventId: 'evt-wear-2', eventType: 'outfit_wear', occurredAt: daysAgo(1) }),
    ],
  });

  assert.equal(profile.quality.wearCount, 2);
  assert.equal(profile.quality.repeatedWearCount, 1);
  assert.equal(profile.quality.contextCoverage, 1);
  assert.match(profile.source.sourceDigest, /^[a-f0-9]{16}$/);
});

test('buildLearnedStyleProfile does not mutate inputs and never emits NaN or Infinity', () => {
  const scenario = readyScenario();
  const before = JSON.stringify(scenario);
  const profile = buildLearnedStyleProfile({ ...scenario, now: NOW });
  const encoded = JSON.stringify(profile);

  assert.equal(JSON.stringify(scenario), before);
  assert.equal(encoded.includes('NaN'), false);
  assert.equal(encoded.includes('Infinity'), false);
});
