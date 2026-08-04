const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const { deriveConfirmableSceneTags } = require('./shared/sceneEligibilityFacts');

function loadConfirmInternals() {
  const originalLoad = Module._load;
  Module._load = function loadWithCloudStub(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'test',
        init() {},
        database() { return { command: { in: (values) => values } }; },
        getWXContext() { return { OPENID: 'test-openid' }; },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  try {
    delete require.cache[require.resolve('./index.js')];
    return require('./index.js').__test;
  } finally {
    Module._load = originalLoad;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
}

test('confirmed clothing derives persisted sceneTags through the shared scene fact parser', () => {
  const { buildClothingFromDraft } = loadConfirmInternals();
  const draft = {
    _id: 'draft-training-shoes',
    batchId: 'batch-1',
    sourceImageId: 'source-1',
    itemIndex: 0,
    originalImageUrl: 'cloud://source.jpg',
    type: 'shoes',
    categoryName: '训练鞋',
    styleTags: [],
    seasonTags: [],
    material: '合成材质',
    thickness: '',
    confidence: 0.9,
    aestheticFeatures: {
      fit: 'regular', length: 'regular', silhouette: 'unknown', patternType: 'solid', designElements: [],
      formalityLevel: null,
      confidence: { fit: 'high', length: 'high', silhouette: 'high', patternType: 'high', designElements: 'high', formalityLevel: 'high' },
    },
  };
  const clothing = buildClothingFromDraft(draft, 'test-openid');
  const expected = deriveConfirmableSceneTags({
    category: clothing.category,
    subcategory: clothing.subcategory,
    subCategory: clothing.subCategory,
    type: clothing.type,
    styleTags: clothing.styleTags,
    sceneTags: [],
    material: clothing.material,
    thickness: clothing.thickness,
    aestheticFeatures: clothing.aestheticFeatures,
  });

  assert.deepEqual(clothing.sceneTags, expected);
  assert.deepEqual(clothing.sceneTags, ['运动']);
});
