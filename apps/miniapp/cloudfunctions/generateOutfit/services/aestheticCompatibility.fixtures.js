const FIXTURE_VERSION = 'aesthetic-compat-fixtures-v1';

function clothing(id, category, overrides = {}) {
  return {
    _id: id,
    category,
    subcategory: overrides.subcategory || category,
    colorPalette: clone(overrides.colorPalette || []),
    aestheticFeatures: overrides.noFeatures
      ? undefined
      : {
          version: overrides.version === undefined ? 1 : overrides.version,
          promptVersion: 'aesthetic-v1',
          fit: overrides.fit || 'unknown',
          length: overrides.length || 'unknown',
          silhouette: overrides.silhouette || 'unknown',
          patternType: overrides.patternType || 'unknown',
          designElements: clone(overrides.designElements || []),
          formalityLevel: overrides.formalityLevel ?? null,
          confidence: {
            fit: overrides.fitConfidence || overrides.confidence || 'high',
            length: overrides.lengthConfidence || overrides.confidence || 'high',
            silhouette: overrides.silhouetteConfidence || overrides.confidence || 'high',
            patternType: overrides.patternConfidence || overrides.confidence || 'high',
            designElements: overrides.designConfidence || overrides.confidence || 'high',
            formalityLevel: overrides.formalityConfidence || overrides.confidence || 'high',
          },
          provider: 'fixture',
          model: 'fixture-v1',
          recognizedAt: '2026-06-26T00:00:00.000Z',
        },
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fixture(id, group, description, items, expectations) {
  return {
    id,
    group,
    description,
    items: clone(items),
    expectations: {
      evidenceAny: [],
      evidenceNone: [],
      ...expectations,
    },
  };
}

function positiveFixture(id, description, items, evidenceAny = []) {
  return fixture(id, 'positive', description, items, {
    scoreBand: [78, 95],
    minCoverage: 0.5,
    evidenceAny,
    evidenceNone: ['SILHOUETTE_EXTREME_VOLUME_STACK', 'PATTERN_COMPETING_FOCUS', 'FORMALITY_LARGE_GAP', 'DETAIL_COMPETING_FOCUS'],
  });
}

function neutralFixture(id, description, items, evidenceAny = []) {
  return fixture(id, 'neutral', description, items, {
    scoreBand: [66, 80],
    minCoverage: 0.5,
    evidenceAny,
    evidenceNone: ['PATTERN_COMPETING_FOCUS', 'FORMALITY_LARGE_GAP', 'DETAIL_COMPETING_FOCUS'],
  });
}

function conflictFixture(id, description, items, evidenceAny = []) {
  return fixture(id, 'conflict', description, items, {
    scoreBand: [55, 68],
    minCoverage: 0.5,
    evidenceAny,
    evidenceNone: [],
  });
}

function sparseFixture(id, description, items, expectations = {}) {
  return fixture(id, 'sparse', description, items, {
    scoreBand: [null, null],
    minCoverage: 0,
    maxCoverage: 0.49,
    ...expectations,
  });
}

function boundaryFixture(id, description, items, expectations = {}) {
  return fixture(id, 'boundary', description, items, {
    scoreBand: [null, null],
    minCoverage: 0,
    ...expectations,
  });
}

function top(id, overrides) {
  return clothing(id, 'top', overrides);
}

function bottom(id, overrides) {
  return clothing(id, 'bottom', overrides);
}

function shoes(id, overrides) {
  return clothing(id, 'shoes', overrides);
}

function onepiece(id, overrides) {
  return clothing(id, 'onepiece', overrides);
}

function color(name, hex, ratio, role) {
  return { name, hex, ratio, role };
}

function positiveItems(prefix, overrides = {}) {
  return [
    top(`${prefix}-top`, {
      fit: overrides.topFit || 'fitted',
      length: overrides.topLength || 'cropped',
      patternType: overrides.topPattern || 'solid',
      designElements: overrides.topDesign || ['ruffle'],
      formalityLevel: overrides.topFormality || 3,
      colorPalette: overrides.topColor || [color('black', '#111111', 0.6, 'primary')],
    }),
    bottom(`${prefix}-bottom`, {
      fit: overrides.bottomFit || 'regular',
      length: overrides.bottomLength || 'long',
      silhouette: overrides.bottomSilhouette || 'wideLeg',
      patternType: overrides.bottomPattern || 'solid',
      designElements: overrides.bottomDesign || [],
      formalityLevel: overrides.bottomFormality || 3,
      colorPalette: overrides.bottomColor || [color('red', '#cc3333', 0.5, 'primary')],
    }),
    shoes(`${prefix}-shoe`, {
      patternType: 'solid',
      formalityLevel: overrides.shoeFormality || 3,
      colorPalette: overrides.shoeColor || [color('white', '#f7f7f7', 0.2, 'primary')],
    }),
  ];
}

function neutralItems(prefix, overrides = {}) {
  return [
    top(`${prefix}-top`, {
      fit: overrides.topFit || 'regular',
      length: overrides.topLength || 'regular',
      silhouette: overrides.topSilhouette || 'straight',
      patternType: overrides.topPattern || 'solid',
      designElements: overrides.topDesign || [],
      formalityLevel: overrides.topFormality || 2,
      colorPalette: overrides.topColor || [color('blue', '#3355aa', 0.5, 'primary')],
    }),
    bottom(`${prefix}-bottom`, {
      fit: overrides.bottomFit || 'regular',
      length: overrides.bottomLength || 'regular',
      silhouette: overrides.bottomSilhouette || 'straight',
      patternType: overrides.bottomPattern || 'solid',
      designElements: overrides.bottomDesign || [],
      formalityLevel: overrides.bottomFormality || 4,
      colorPalette: overrides.bottomColor || [color('yellow', '#d2b43f', 0.4, 'primary')],
    }),
    shoes(`${prefix}-shoe`, {
      patternType: 'solid',
      formalityLevel: overrides.shoeFormality || 3,
      colorPalette: overrides.shoeColor || [color('white', '#eeeeee', 0.2, 'primary')],
    }),
  ];
}

function conflictItems(prefix, overrides = {}) {
  return [
    top(`${prefix}-top`, {
      fit: overrides.topFit || 'oversized',
      length: overrides.topLength || 'extraLong',
      silhouette: overrides.topSilhouette || 'boxy',
      patternType: overrides.topPattern || 'graphic',
      designElements: overrides.topDesign || ['hardware', 'cutout'],
      formalityLevel: overrides.topFormality || 1,
      colorPalette: overrides.topColor || [color('red', '#cc3333', 0.7, 'primary')],
    }),
    bottom(`${prefix}-bottom`, {
      fit: overrides.bottomFit || 'relaxed',
      length: overrides.bottomLength || 'extraLong',
      silhouette: overrides.bottomSilhouette || 'wideLeg',
      patternType: overrides.bottomPattern || 'plaid',
      designElements: overrides.bottomDesign || ['distressed', 'lace'],
      formalityLevel: overrides.bottomFormality || 5,
      colorPalette: overrides.bottomColor || [color('green', '#33aa33', 0.7, 'primary')],
    }),
    shoes(`${prefix}-shoe`, {
      patternType: overrides.shoePattern || 'animal',
      designElements: overrides.shoeDesign || ['hardware'],
      formalityLevel: overrides.shoeFormality || 1,
      colorPalette: overrides.shoeColor || [color('blue', '#3333cc', 0.7, 'primary')],
    }),
  ];
}

const positive = [
  positiveFixture('positive-fitted-wide-leg', 'fitted top with wide-leg bottom', positiveItems('p01'), ['SILHOUETTE_BALANCED_CONTRAST']),
  positiveFixture('positive-oversized-tapered', 'oversized top with tapered bottom', positiveItems('p02', { topFit: 'oversized', bottomSilhouette: 'tapered' }), ['SILHOUETTE_BALANCED_CONTRAST']),
  positiveFixture('positive-relaxed-bodycon', 'relaxed top with bodycon bottom', positiveItems('p03', { topFit: 'relaxed', bottomSilhouette: 'bodycon' }), ['SILHOUETTE_BALANCED_CONTRAST']),
  positiveFixture('positive-cropped-long', 'cropped top and long bottom', positiveItems('p04'), ['PROPORTION_CLEAR_LAYERING']),
  positiveFixture('positive-single-pattern-focus', 'single stripe focus with solids', positiveItems('p05', { topPattern: 'stripe' }), ['PATTERN_SINGLE_FOCUS']),
  positiveFixture('positive-monochromatic-blue', 'monochromatic blue palette', positiveItems('p06', { topColor: [color('blue', '#3355cc', 0.6, 'primary')], bottomColor: [color('navy', '#1d3f88', 0.5, 'primary')], shoeColor: [color('blue', '#2948aa', 0.2, 'primary')] }), ['COLOR_MONOCHROMATIC']),
  positiveFixture('positive-analogous-blue-cyan', 'analogous blue and cyan palette', positiveItems('p07', { topColor: [color('blue', '#3355cc', 0.6, 'primary')], bottomColor: [color('cyan', '#33aacc', 0.5, 'primary')], shoeColor: [] }), ['COLOR_ANALOGOUS']),
  positiveFixture('positive-neutral-accent-red', 'neutral base with red accent', positiveItems('p08'), ['COLOR_NEUTRAL_ACCENT']),
  positiveFixture('positive-formality-aligned-office', 'aligned formality across outfit', positiveItems('p09', { topFormality: 4, bottomFormality: 4, shoeFormality: 4 }), ['FORMALITY_ALIGNED']),
  positiveFixture('positive-single-design-focus', 'one design focus item', positiveItems('p10', { topDesign: ['bow'] }), ['DETAIL_SINGLE_FOCUS']),
  positiveFixture('positive-onepiece-clean-line', 'one-piece dress with complete line', [onepiece('p11-dress', { fit: 'regular', length: 'long', silhouette: 'aLine', patternType: 'floral', designElements: ['belted'], formalityLevel: 3, colorPalette: [color('black', '#111111', 0.7, 'primary')] }), shoes('p11-shoe', { patternType: 'solid', formalityLevel: 3, colorPalette: [color('red', '#cc3333', 0.3, 'primary')] })], ['SILHOUETTE_BALANCED_CONTINUITY']),
  positiveFixture('positive-controlled-contrast', 'controlled two-color contrast', positiveItems('p12', { topColor: [color('blue', '#3355cc', 0.6, 'primary')], bottomColor: [color('orange', '#cc7733', 0.35, 'primary')], shoeColor: [] }), ['COLOR_CONTROLLED_CONTRAST']),
  positiveFixture('positive-outerwear-layering', 'outerwear-like top and slim lower layer', positiveItems('p13', { topFit: 'relaxed', bottomFit: 'fitted', bottomSilhouette: 'tapered', topLength: 'short' }), ['SILHOUETTE_BALANCED_CONTRAST']),
  positiveFixture('positive-flare-balance', 'fitted upper with flare lower silhouette', positiveItems('p14', { bottomSilhouette: 'flare' }), ['SILHOUETTE_BALANCED_CONTRAST']),
  positiveFixture('positive-floral-single-focus', 'single floral focus with quiet base', positiveItems('p15', { topPattern: 'floral' }), ['PATTERN_SINGLE_FOCUS']),
  positiveFixture('positive-pleat-focus', 'single pleat detail focus', positiveItems('p16', { topDesign: ['pleat'] }), ['DETAIL_SINGLE_FOCUS']),
  positiveFixture('positive-cream-accent-green', 'cream neutral with green accent', positiveItems('p17', { topColor: [{ name: 'cream', ratio: 0.6, role: 'primary' }], bottomColor: [color('green', '#338855', 0.4, 'primary')], shoeColor: [] }), ['COLOR_NEUTRAL_ACCENT']),
  positiveFixture('positive-high-coverage-all-dimensions', 'high coverage positive sample', positiveItems('p18', { topPattern: 'stripe', topDesign: ['ruffle'], topFormality: 3, bottomFormality: 3 }), ['PATTERN_SINGLE_FOCUS']),
];

const neutral = [
  neutralFixture('neutral-regular-straight', 'regular straight daily outfit', neutralItems('n01'), ['FORMALITY_INTENTIONAL_MIX']),
  neutralFixture('neutral-regular-lengths', 'regular length combination', neutralItems('n02'), ['PROPORTION_BALANCED_LENGTH']),
  neutralFixture('neutral-formality-gap-two', 'formality gap two as mix', neutralItems('n03'), ['FORMALITY_INTENTIONAL_MIX']),
  neutralFixture('neutral-multi-solid-no-clear-positive', 'multiple solids without strong positive color', neutralItems('n04'), []),
  neutralFixture('neutral-coherent-repeat-stripe', 'coherent repeated stripe pattern', neutralItems('n05', { topPattern: 'stripe', bottomPattern: 'stripe' }), ['PATTERN_COHERENT_REPEAT']),
  neutralFixture('neutral-light-details-distributed', 'light details distributed', neutralItems('n06', { topDesign: ['pleat'], bottomDesign: ['belted'] }), ['DETAIL_BALANCED_DISTRIBUTION']),
  neutralFixture('neutral-daily-no-strong-structure', 'reasonable daily outfit', neutralItems('n07'), []),
  neutralFixture('neutral-onepiece-regular-length', 'regular one-piece daily outfit', [onepiece('n08-dress', { fit: 'regular', length: 'regular', silhouette: 'straight', patternType: 'solid', formalityLevel: 3, colorPalette: [color('blue', '#3355aa', 0.7, 'primary')] }), shoes('n08-shoe', { patternType: 'solid', formalityLevel: 3, colorPalette: [color('yellow', '#d2b43f', 0.3, 'primary')] })], ['PROPORTION_BALANCED_LENGTH']),
  neutralFixture('neutral-same-pattern-repeat', 'same light pattern repeat', neutralItems('n09', { topPattern: 'plaid', bottomPattern: 'plaid' }), ['PATTERN_COHERENT_REPEAT']),
  neutralFixture('neutral-regular-blue-yellow', 'regular blue yellow contrast', neutralItems('n10'), []),
  neutralFixture('neutral-minimal-details', 'minimal details with regular proportions', neutralItems('n11', { topDesign: ['belted'] }), ['DETAIL_SINGLE_FOCUS']),
  neutralFixture('neutral-formality-gap-two-alt', 'another formality gap two mix', neutralItems('n12', { topFormality: 1, bottomFormality: 3, shoeFormality: 2 }), ['FORMALITY_INTENTIONAL_MIX']),
  neutralFixture('neutral-straight-silhouette', 'straight silhouette continuity', neutralItems('n13', { topFit: 'relaxed', bottomSilhouette: 'straight' }), ['SILHOUETTE_BALANCED_CONTINUITY']),
  neutralFixture('neutral-no-prominent-focus', 'ordinary matching without prominent focus', neutralItems('n14'), []),
];

const conflict = [
  conflictFixture('conflict-extreme-volume-stack', 'two extreme volume garments', conflictItems('c01'), ['SILHOUETTE_EXTREME_VOLUME_STACK']),
  conflictFixture('conflict-extra-long-stack', 'multiple extra-long garments', conflictItems('c02'), ['PROPORTION_EXTREME_LENGTH_STACK']),
  conflictFixture('conflict-competing-patterns', 'different strong patterns compete', conflictItems('c03'), ['PATTERN_COMPETING_FOCUS']),
  conflictFixture('conflict-competing-dominant-hues', 'multiple dominant hues compete', conflictItems('c04'), ['COLOR_TOO_MANY_DOMINANT_HUES']),
  conflictFixture('conflict-formality-large-gap', 'large formality gap', conflictItems('c05'), ['FORMALITY_LARGE_GAP']),
  conflictFixture('conflict-strong-details-patterns', 'strong details and patterns compete', conflictItems('c06'), ['DETAIL_COMPETING_FOCUS']),
  conflictFixture('conflict-many-visual-centers', 'many visual centers compete', conflictItems('c07'), ['DETAIL_COMPETING_FOCUS']),
  conflictFixture('conflict-graphic-floral-animal', 'graphic floral animal competition', conflictItems('c08', { topPattern: 'graphic', bottomPattern: 'floral', shoePattern: 'animal' }), ['PATTERN_COMPETING_FOCUS']),
  conflictFixture('conflict-red-green-blue', 'red green blue dominant colors', conflictItems('c09'), ['COLOR_TOO_MANY_DOMINANT_HUES']),
  conflictFixture('conflict-boxy-wideleg', 'boxy top with wide leg bottom', conflictItems('c10'), ['SILHOUETTE_EXTREME_VOLUME_STACK']),
  conflictFixture('conflict-cutout-distressed', 'cutout and distressed focus conflict', conflictItems('c11'), ['DETAIL_COMPETING_FOCUS']),
  conflictFixture('conflict-formal-casual-gap', 'formal casual gap', conflictItems('c12', { topFormality: 5, bottomFormality: 1, shoeFormality: 1 }), ['FORMALITY_LARGE_GAP']),
  conflictFixture('conflict-pattern-color-detail', 'pattern color and detail conflict', conflictItems('c13', { topColor: [color('magenta', '#cc33aa', 0.7, 'primary')], bottomColor: [color('lime', '#77cc33', 0.7, 'primary')], shoeColor: [color('blue', '#3333cc', 0.7, 'primary')] }), ['COLOR_TOO_MANY_DOMINANT_HUES']),
  conflictFixture('conflict-long-volume-pattern', 'long volume pattern conflict', conflictItems('c14'), ['PROPORTION_EXTREME_LENGTH_STACK']),
];

const sparse = [
  sparseFixture('sparse-legacy-no-features', 'legacy garments without aesthetic features', [top('s01-top', { noFeatures: true }), bottom('s01-bottom', { noFeatures: true })]),
  sparseFixture('sparse-single-color-only', 'only valid color dimension', [top('s02-top', { noFeatures: true, colorPalette: [color('black', '#111111', 0.7, 'primary')] }), bottom('s02-bottom', { noFeatures: true, colorPalette: [color('red', '#cc3333', 0.3, 'primary')] })], { scoreBand: [86, 86], minCoverage: 0.25, maxCoverage: 0.25, evidenceAny: ['COLOR_NEUTRAL_ACCENT'] }),
  sparseFixture('sparse-all-low-confidence', 'all fields low confidence', [top('s03-top', { confidence: 'low', fit: 'oversized', patternType: 'graphic', colorPalette: [color('red', '#cc3333', 0.7, 'primary')] }), bottom('s03-bottom', { confidence: 'low', silhouette: 'wideLeg', patternType: 'floral', colorPalette: [color('green', '#33aa33', 0.3, 'primary')] })], { scoreBand: [null, null], minCoverage: 0, maxCoverage: 0.25 }),
  sparseFixture('sparse-no-legal-hex', 'missing legal hex colors', [top('s04-top', { colorPalette: [{ name: 'mystery' }] }), bottom('s04-bottom', { category: 'bottom', colorPalette: [{ name: 'unknown' }] })]),
  sparseFixture('sparse-unsupported-version', 'unsupported aesthetic feature version', [top('s05-top', { version: 2, fit: 'fitted' }), bottom('s05-bottom', { version: 2, silhouette: 'wideLeg' })]),
  sparseFixture('sparse-unknown-null-empty', 'unknown null and empty arrays', [top('s06-top', { fit: 'unknown', length: 'unknown', silhouette: 'unknown', patternType: 'unknown', designElements: [], formalityLevel: null }), bottom('s06-bottom', { fit: 'unknown', length: 'unknown', silhouette: 'unknown', patternType: 'unknown', designElements: [], formalityLevel: null })]),
  sparseFixture('sparse-single-shoe', 'single shoe only', [shoes('s07-shoe', { fit: 'oversized', silhouette: 'wideLeg', patternType: 'solid' })]),
  sparseFixture('sparse-empty-items', 'empty item list', []),
  sparseFixture('sparse-null-undefined-items', 'null and undefined entries', [null, undefined]),
  sparseFixture('sparse-onepiece-only', 'single one-piece provides one valid dimension', [onepiece('s10-dress', { fit: 'regular', silhouette: 'aLine' })], { scoreBand: [78, 78], minCoverage: 0.25, maxCoverage: 0.25, evidenceAny: ['SILHOUETTE_BALANCED_CONTINUITY'] }),
];

const boundary = [
  boundaryFixture('boundary-order-variant', 'same input should be order invariant', positiveItems('b01'), { scoreBand: [78, 95], minCoverage: 0.5 }),
  boundaryFixture('boundary-duplicate-id', 'duplicate item id is deduped', [top('b02-top', { patternType: 'stripe' }), top('b02-top', { patternType: 'stripe' }), bottom('b02-bottom', { patternType: 'solid' })], { scoreBand: [68, 82], minCoverage: 0.25, evidenceAny: ['PATTERN_SINGLE_FOCUS'] }),
  boundaryFixture('boundary-invalid-ratio', 'invalid ratio is ignored safely', positiveItems('b03', { topColor: [color('black', '#111111', 9, 'primary')], bottomColor: [color('red', '#cc3333', -1, 'primary')] }), { scoreBand: [78, 95], minCoverage: 0.5, evidenceAny: ['COLOR_NEUTRAL_ACCENT'] }),
  boundaryFixture('boundary-invalid-hex-category', 'invalid hex and category are ignored safely', [clothing('b04-top', 'tops?', { fit: 'fitted', colorPalette: [{ name: 'mystery', hex: '#zzzzzz' }] }), clothing('b04-bottom', 'garment?', { silhouette: 'wideLeg', colorPalette: [{ name: 'unknown', hex: 'blue' }] })], { scoreBand: [null, null], minCoverage: 0, maxCoverage: 0.24 }),
];

const aestheticCompatibilityFixtures = [
  ...positive,
  ...neutral,
  ...conflict,
  ...sparse,
  ...boundary,
];

module.exports = {
  FIXTURE_VERSION,
  aestheticCompatibilityFixtures,
};
