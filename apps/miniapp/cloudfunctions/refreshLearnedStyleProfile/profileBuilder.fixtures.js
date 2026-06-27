const NOW = '2026-06-26T00:00:00.000Z';
const DAY_MS = 24 * 60 * 60 * 1000;

const FIXTURE_CATALOG = [
  'exposure only',
  'detail weak positive',
  'favorite positive',
  'unfavorite negative',
  'wear strong positive',
  'second wear stronger',
  'third wear capped',
  'favorite then unfavorite',
  'unfavorite then favorite',
  'multiple details',
  'recent favorite',
  'old favorite',
  'recent wear',
  'old wear',
  'refresh 30 day decay',
  'outside 180 day window',
  'invalid occurredAt',
  'future occurredAt',
  'unexposed refresh ignored',
  'exposed refresh weak negative',
  'same day refresh cap',
  'different batches independent',
  'missing batch id skipped',
  'low confidence ignored',
  'unknown values ignored',
  'duplicate outfit color deduped',
  'multi feature split',
  'color family mapping',
  'styleTags deduped',
  'formalityLevel extracted',
  'designElements extracted',
  'missing clothing ignored',
  'partial clothing missing',
  'unsupported aesthetic version',
  'insufficient data',
  'shadow ready',
  'scene below threshold omitted',
  'scene threshold emitted',
  'global context isolation',
  'input order deterministic',
];

function daysAgo(days) {
  return new Date(Date.parse(NOW) - days * DAY_MS).toISOString();
}

function daysFromNow(days) {
  return new Date(Date.parse(NOW) + days * DAY_MS).toISOString();
}

function event(overrides = {}) {
  return {
    schemaVersion: 1,
    eventId: 'evt-1',
    eventType: 'outfit_favorite',
    occurredAt: daysAgo(1),
    outfitKey: 'outfit-1',
    clothingIds: ['cloth-1'],
    context: { scene: 'work', source: 'today' },
    ...overrides,
  };
}

function clothing(overrides = {}) {
  return {
    _id: 'cloth-1',
    id: 'cloth-1',
    _openid: 'openid-a',
    category: 'top',
    status: 'active',
    colorPalette: [{ name: '黑色', hex: '#111111', role: 'primary' }],
    styleTags: ['clean', 'daily'],
    aestheticFeatures: {
      version: 1,
      promptVersion: 'aesthetic-v1',
      fit: 'regular',
      length: 'regular',
      silhouette: 'straight',
      patternType: 'solid',
      designElements: ['pleat'],
      formalityLevel: 3,
      confidence: {
        fit: 'high',
        length: 'high',
        silhouette: 'high',
        patternType: 'high',
        designElements: 'high',
        formalityLevel: 'high',
      },
      provider: 'fixture',
      model: 'fixture',
      recognizedAt: daysAgo(10),
    },
    ...overrides,
  };
}

function outfitKeyFor(index) {
  return `outfit-${index}`;
}

function clothingIdFor(index) {
  return `cloth-${index}`;
}

function readyScenario() {
  const events = [];
  const clothes = [];
  for (let index = 1; index <= 4; index += 1) {
    const clothingId = clothingIdFor(index);
    const outfitKey = outfitKeyFor(index);
    clothes.push(clothing({
      _id: clothingId,
      id: clothingId,
      colorPalette: [{ name: index % 2 === 0 ? 'blue' : 'black', role: 'primary' }],
      styleTags: [index % 2 === 0 ? 'smart' : 'clean'],
      aestheticFeatures: {
        ...clothing().aestheticFeatures,
        fit: index % 2 === 0 ? 'relaxed' : 'regular',
        silhouette: index % 2 === 0 ? 'boxy' : 'straight',
        formalityLevel: index % 2 === 0 ? 4 : 3,
      },
    }));
    events.push(event({
      eventId: `evt-exposure-${index}`,
      eventType: 'recommendation_exposure',
      occurredAt: daysAgo(10 - index),
      outfitKey,
      clothingIds: [clothingId],
      recommendationBatchId: 'batch-ready',
      context: { scene: 'work', source: 'today', position: index - 1, candidateCount: 4 },
    }));
    events.push(event({
      eventId: `evt-favorite-${index}`,
      eventType: 'outfit_favorite',
      occurredAt: daysAgo(8 - index),
      outfitKey,
      clothingIds: [clothingId],
      context: { scene: 'work', source: 'today' },
    }));
    events.push(event({
      eventId: `evt-wear-${index}`,
      eventType: 'outfit_wear',
      occurredAt: daysAgo(4 - index),
      outfitKey,
      clothingIds: [clothingId],
      context: { scene: index === 4 ? 'date' : 'work', source: 'today' },
    }));
  }
  return { events, clothes };
}

module.exports = {
  FIXTURE_CATALOG,
  NOW,
  clothing,
  clothingIdFor,
  daysAgo,
  daysFromNow,
  event,
  outfitKeyFor,
  readyScenario,
};
