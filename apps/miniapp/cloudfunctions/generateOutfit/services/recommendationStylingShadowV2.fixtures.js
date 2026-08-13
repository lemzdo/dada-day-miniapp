const { evaluateAestheticCompatibility } = require('./aestheticCompatibility');
const { evaluateSceneEvidenceV4 } = require('./sceneEvidenceV4');

function item(id, category, fields = {}) {
  return {
    _id: id,
    category,
    subcategory: fields.subcategory || category,
    colorPalette: fields.colorPalette || [],
    styleTags: fields.styleTags || [],
    sceneTags: fields.sceneTags || [],
    material: fields.material || '',
    thickness: fields.thickness || '',
    aestheticFeatures: fields.withoutAesthetic === true ? undefined : {
      version: 1,
      promptVersion: 'aesthetic-v1',
      fit: fields.fit || 'unknown',
      length: fields.length || 'unknown',
      silhouette: fields.silhouette || 'unknown',
      patternType: fields.patternType || 'unknown',
      designElements: fields.designElements || [],
      formalityLevel: fields.formalityLevel ?? null,
      confidence: {
        fit: fields.fitConfidence || 'high',
        length: fields.lengthConfidence || 'high',
        silhouette: fields.silhouetteConfidence || 'high',
        patternType: fields.patternConfidence || 'high',
        designElements: fields.designConfidence || 'high',
        formalityLevel: fields.formalityConfidence || 'high',
      },
      provider: 'fixture',
      model: 'fixture-v1',
      recognizedAt: '2026-08-12T00:00:00.000Z',
    },
  };
}

const fixtures = Object.freeze([
  fixture({
    id: 'primary-pattern-focus',
    scene: 'date',
    items: [
      item('pattern-top', 'top', { patternType: 'stripe' }),
      item('solid-bottom', 'bottom', { patternType: 'solid' }),
    ],
    expected: { materiality: 'material', competition: 'single', primary: 'PATTERN_FOCUS' },
  }),
  fixture({
    id: 'primary-silhouette-contrast',
    scene: 'home',
    items: [
      item('fitted-top', 'top', { fit: 'fitted' }),
      item('wide-bottom', 'bottom', { silhouette: 'wideLeg' }),
    ],
    expected: { materiality: 'material', competition: 'single', primary: 'SILHOUETTE_CONTRAST' },
  }),
  fixture({
    id: 'primary-monochromatic',
    scene: 'work',
    items: [
      item('blue-top', 'top', { colorPalette: [{ name: 'blue', hex: '#3366cc', role: 'primary' }] }),
      item('navy-bottom', 'bottom', { colorPalette: [{ name: 'navy', hex: '#1f3b82', role: 'primary' }] }),
    ],
    expected: { materiality: 'material', competition: 'single', primary: 'COLOR_UNITY' },
  }),
  fixture({
    id: 'weak-formality-only',
    scene: 'home',
    items: [
      item('formal-top', 'top', { formalityLevel: 3 }),
      item('formal-bottom', 'bottom', { formalityLevel: 4 }),
    ],
    expected: { materiality: 'weak', competition: 'none', primary: null },
  }),
  fixture({
    id: 'sparse-low-confidence-pattern',
    scene: 'home',
    items: [
      item('stripe-top', 'top', { patternType: 'stripe', patternConfidence: 'low' }),
      item('floral-bottom', 'bottom', { patternType: 'floral', patternConfidence: 'low' }),
    ],
    expected: { materiality: 'none', competition: 'none', primary: null },
  }),
  fixture({
    id: 'weak-analogous-color',
    scene: 'home',
    items: [
      item('blue-top-weak', 'top', { colorPalette: [{ name: 'blue', hex: '#3366cc', role: 'primary' }] }),
      item('green-bottom-weak', 'bottom', { colorPalette: [{ name: 'green', hex: '#33aa66', role: 'primary' }] }),
    ],
    expected: { materiality: 'weak', competition: 'none', primary: null },
  }),
  fixture({
    id: 'sparse-competing-pattern-limitation',
    scene: 'date',
    items: [
      item('stripe-top-conflict', 'top', { patternType: 'stripe' }),
      item('floral-bottom-conflict', 'bottom', { patternType: 'floral' }),
    ],
    expected: { materiality: 'none', competition: 'none', primary: null },
  }),
  fixture({
    id: 'sparse-basic-no-evidence',
    scene: 'home',
    items: [
      item('basic-top', 'top', { withoutAesthetic: true }),
      item('basic-bottom', 'bottom', { withoutAesthetic: true }),
    ],
    expected: { materiality: 'none', competition: 'none', primary: null },
  }),
  fixture({
    id: 'competing-pattern-and-silhouette',
    scene: 'date',
    items: [
      item('pattern-fitted-top', 'top', { patternType: 'stripe', fit: 'fitted' }),
      item('solid-wide-bottom', 'bottom', { patternType: 'solid', silhouette: 'wideLeg' }),
    ],
    expected: {
      materiality: 'material',
      competition: 'competing',
      primary: 'PATTERN_FOCUS',
      secondary: ['SILHOUETTE_CONTRAST'],
    },
  }),
  fixture({
    id: 'color-distant-accidental-weak', scene: 'home',
    items: [
      item('red-top-distant', 'top', { colorPalette: [{ name: 'red', hex: '#cc2222', role: 'primary' }] }),
      item('red-shoe-distant', 'shoes', { colorPalette: [{ name: 'red', hex: '#cc2222', role: 'primary' }] }),
    ], expected: { materiality: 'weak', competition: 'none', primary: null, unselected: ['COLOR_UNITY'] },
  }),
  fixture({
    id: 'color-white-top-white-shoe-weak', scene: 'home',
    items: [
      item('white-top', 'top', { colorPalette: [{ name: 'white', hex: '#ffffff', role: 'primary' }] }),
      item('white-shoe', 'shoes', { colorPalette: [{ name: 'white', hex: '#ffffff', role: 'primary' }] }),
    ], expected: { materiality: 'weak', competition: 'none', primary: null },
  }),
  fixture({
    id: 'color-three-core-unity-material', scene: 'work',
    items: [
      item('navy-top-core', 'top', { colorPalette: [{ name: 'navy', hex: '#1f3b82', role: 'primary' }] }),
      item('blue-bottom-core', 'bottom', { colorPalette: [{ name: 'blue', hex: '#3366cc', role: 'primary' }] }),
      item('indigo-outerwear-core', 'outerwear', { colorPalette: [{ name: 'indigo', hex: '#304080', role: 'primary' }] }),
    ], expected: { materiality: 'material', competition: 'single', primary: 'COLOR_UNITY' },
  }),
  fixture({
    id: 'color-neutral-coexist-weak', scene: 'home',
    items: [
      item('black-top-neutral', 'top', { colorPalette: [{ name: 'black', hex: '#111111', role: 'primary' }] }),
      item('white-bottom-neutral', 'bottom', { colorPalette: [{ name: 'white', hex: '#ffffff', role: 'primary' }] }),
    ], expected: { materiality: 'weak', competition: 'none', primary: null },
  }),
  fixture({
    id: 'color-low-contrast-weak', scene: 'home',
    items: [
      item('beige-top-low', 'top', { colorPalette: [{ name: 'beige', hex: '#3366cc', role: 'primary' }] }),
      item('cream-bottom-low', 'bottom', { colorPalette: [{ name: 'cream', hex: '#33aa66', role: 'primary' }] }),
    ], expected: { materiality: 'weak', competition: 'none', primary: null },
  }),
  fixture({
    id: 'competing-pattern-and-color', scene: 'date',
    items: [
      item('striped-red-top', 'top', { patternType: 'stripe', colorPalette: [{ name: 'red', hex: '#cc2222', role: 'primary' }] }),
      item('red-bottom-color', 'bottom', { colorPalette: [{ name: 'red', hex: '#cc2222', role: 'primary' }] }),
    ], expected: { materiality: 'material', competition: 'competing', primary: 'PATTERN_FOCUS', secondary: ['COLOR_UNITY'] },
  }),
  fixture({
    id: 'competing-silhouette-and-scene', scene: 'work', includeSceneEvidence: true,
    items: [
      item('fitted-shirt-scene', 'top', { subcategory: 'shirt', fit: 'fitted', withoutAesthetic: false }),
      item('wide-pants-scene', 'bottom', { subcategory: 'pants', silhouette: 'wideLeg', styleTags: ['simple'] }),
      item('business-shoe-scene', 'shoes', { subcategory: 'business shoe', styleTags: ['formal'], withoutAesthetic: true }),
    ], expected: { materiality: 'material', competition: 'competing', primary: 'SILHOUETTE_CONTRAST', secondary: ['SCENE_WORK_STRUCTURED_SET'] },
  }),
  fixture({
    id: 'competing-color-and-scene', scene: 'work', includeSceneEvidence: true,
    items: [
      item('blue-shirt-scene', 'top', { subcategory: 'shirt', colorPalette: [{ name: 'blue', hex: '#3366cc', role: 'primary' }], withoutAesthetic: true }),
      item('navy-pants-scene', 'bottom', { subcategory: 'pants', colorPalette: [{ name: 'navy', hex: '#1f3b82', role: 'primary' }], withoutAesthetic: true }),
      item('business-shoe-scene2', 'shoes', { subcategory: 'business shoe', styleTags: ['formal'], withoutAesthetic: true }),
    ], expected: { materiality: 'material', competition: 'competing', primary: 'COLOR_UNITY', secondary: ['SCENE_WORK_STRUCTURED_SET'] },
  }),
  fixture({
    id: 'duplicate-pattern-insights', scene: 'date', includeSceneEvidence: true,
    items: [
      item('stripe-top-duplicate', 'top', { patternType: 'stripe' }),
      item('solid-bottom-duplicate', 'bottom', { patternType: 'solid' }),
    ], expected: { materiality: 'material', competition: 'single', primary: 'PATTERN_FOCUS' },
  }),
  fixture({
    id: 'three-material-only-one-secondary', scene: 'date', includeSceneEvidence: true,
    items: [
      item('stripe-fitted-top', 'top', { patternType: 'stripe', fit: 'fitted', colorPalette: [{ name: 'red', hex: '#cc2222', role: 'primary' }] }),
      item('solid-wide-bottom', 'bottom', { patternType: 'solid', silhouette: 'wideLeg', colorPalette: [{ name: 'red', hex: '#cc2222', role: 'primary' }] }),
      item('red-outerwear-material', 'outerwear', { colorPalette: [{ name: 'red', hex: '#cc2222', role: 'primary' }] }),
    ], expected: { materiality: 'material', competition: 'competing', primary: 'PATTERN_FOCUS', secondary: ['SILHOUETTE_CONTRAST'], unselected: ['COLOR_UNITY'] },
  }),
  fixture({
    id: 'scene-primary-work-structure',
    scene: 'work',
    includeSceneEvidence: true,
    items: [
      item('shirt', 'top', { subcategory: 'shirt', styleTags: ['simple', 'commute'], withoutAesthetic: true }),
      item('tailored-pants', 'bottom', { subcategory: 'pants', styleTags: ['simple'], withoutAesthetic: true }),
      item('business-shoe', 'shoes', { subcategory: 'business shoe', styleTags: ['formal'], withoutAesthetic: true }),
    ],
    expected: { materiality: 'material', competition: 'single', primary: 'SCENE_WORK_STRUCTURED_SET' },
  }),
  fixture({
    id: 'scene-weak-work-complete',
    scene: 'work',
    includeSceneEvidence: true,
    items: [
      item('unknown-top', 'top', { subcategory: 'unknown top', withoutAesthetic: true }),
      item('unknown-bottom', 'bottom', { subcategory: 'unknown bottom', withoutAesthetic: true }),
      item('unknown-shoe', 'shoes', { subcategory: 'unknown shoe', withoutAesthetic: true }),
    ],
    expected: { materiality: 'weak', competition: 'none', primary: null },
  }),
  fixture({
    id: 'sparse-with-wearability-limitation',
    scene: 'home',
    weather: { mode: 'live', temp: 27 },
    weatherEligibility: {
      pass: true,
      rejectReasons: [],
      warningReasons: ['WARM_WEATHER_HEAVY_COMBO'],
      evidence: [{ itemId: 'warm-top', reason: 'warm_weather_heavy_combo' }],
    },
    items: [
      item('warm-top', 'top', { subcategory: 'warm top', withoutAesthetic: true }),
      item('warm-bottom', 'bottom', { subcategory: 'warm bottom', withoutAesthetic: true }),
    ],
    expected: { materiality: 'none', competition: 'none', primary: null },
  }),
]);

function fixture(input) {
  return Object.freeze({
    id: input.id,
    scene: input.scene,
    weather: input.weather || { mode: 'unavailable' },
    recommendationProfile: input.recommendationProfile || {},
    weatherEligibility: input.weatherEligibility || null,
    includeSceneEvidence: input.includeSceneEvidence === true,
    items: Object.freeze(input.items),
    expected: Object.freeze(input.expected),
  });
}

function materializeFixture(fixtureInput) {
  const aestheticEvaluation = evaluateAestheticCompatibility(fixtureInput.items);
  const sceneEligibility = fixtureInput.includeSceneEvidence
    ? evaluateSceneEvidenceV4({
        scene: fixtureInput.scene,
        items: fixtureInput.items,
        weather: fixtureInput.weather,
        recommendationProfile: fixtureInput.recommendationProfile,
      })
    : emptySceneEligibility();
  return {
    outfitKey: fixtureInput.items.map((entry) => entry._id).sort().join('_'),
    itemIds: fixtureInput.items.map((entry) => entry._id),
    items: fixtureInput.items,
    scene: fixtureInput.scene,
    weather: fixtureInput.weather,
    aestheticEvaluation,
    sceneEligibility,
    weatherEligibility: fixtureInput.weatherEligibility || {
      pass: true,
      rejectReasons: [],
      warningReasons: [],
      evidence: [],
    },
  };
}

function emptySceneEligibility() {
  return {
    eligible: true,
    hardRejected: false,
    sceneStrength: 'none',
    sceneEvidence: [],
    sceneEvidenceVersion: 'fixture-none',
    sceneEvidenceFingerprint: 'fixture-none',
  };
}

module.exports = {
  materializeFixture,
  recommendationStylingShadowV2Fixtures: fixtures,
};
