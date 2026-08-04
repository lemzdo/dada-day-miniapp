const { buildOutfitCandidatesV1 } = require('./outfitCompositionV1');
const { buildOutfitCopyFacts } = require('./outfitCopyFacts');
const { extractOutfitFactsV3, compileRecommendationLanguageV3 } = require('./recommendationLanguageV3');
const { finalizeAcceptedRecommendations } = require('./recommendationCopyFinalization');
const { factEvidenceLevel, RELIABLE_ONLY_FACTS } = require('./recommendationFactAuthorization');

const REPLAY_SCENES = Object.freeze(['home', 'work', 'date', 'sport']);
const SHARED_PROFILE = Object.freeze({
  styleTags: [],
  colorPreference: [],
  avoidTags: [],
  fitPreference: 'unknown',
  genderPreference: 'unknown',
  temperatureSensitivity: 'normal',
});

function rawItem(id, category, subcategory, extra = {}) {
  return {
    _id: id,
    _openid: 'qa-anonymous-openid',
    category,
    subcategory,
    customName: subcategory,
    imageUrl: `cloud://qa/${id}.jpg`,
    styleTags: [],
    sceneTags: [],
    seasonTags: ['春秋'],
    colorPalette: [{ name: '黑色', hex: '#111111', ratio: 1 }],
    confidence: 0.88,
    aiConfidence: 0.88,
    status: 'active',
    usageCount: 0,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...extra,
  };
}

function buildRawWardrobe(scene) {
  if (scene === 'home') {
    return [
      rawItem('raw-home-top', 'top', '宽松家居上衣', {
        fit: '宽松',
        sceneTags: ['居家'],
        styleTags: ['休闲'],
        structuredAiFacts: ['breathability'],
      }),
      rawItem('raw-home-bottom', 'bottom', '宽松家居长裤', {
        fit: '宽松',
        sceneTags: ['居家'],
        styleTags: ['休闲'],
      }),
      rawItem('raw-home-shoes', 'shoes', '室内拖鞋', {
        sceneTags: ['居家'],
        styleTags: ['居家'],
      }),
    ];
  }
  if (scene === 'work') {
    return [
      rawItem('raw-work-shirt', 'top', '白色衬衫', {
        colorPalette: [{ name: '白色', hex: '#F5F5F2', ratio: 1 }],
        fit: '常规',
        patternType: '纯色',
        styleComplexity: '简洁',
        sceneTags: ['通勤', '上班'],
        styleTags: ['简约'],
        structuredAiFacts: ['wrinkle_risk'],
      }),
      rawItem('raw-work-bottom', 'bottom', '黑色直筒裤', {
        fit: '直筒',
        patternType: '纯色',
        styleComplexity: '简洁',
        sceneTags: ['通勤', '上班'],
        styleTags: ['简约'],
      }),
      rawItem('raw-work-shoes', 'shoes', '黑色乐福鞋', {
        styleComplexity: '简洁',
        sceneTags: ['通勤', '上班'],
        styleTags: ['简约'],
      }),
    ];
  }
  if (scene === 'date') {
    return [
      rawItem('raw-date-top', 'top', '印花上衣', {
        colorPalette: [{ name: '红色', hex: '#B64043', ratio: 0.65 }],
        patternType: '印花',
        styleComplexity: '明显图案',
        sceneTags: ['约会'],
        styleTags: ['甜美'],
        structuredAiFacts: ['soft_material'],
      }),
      rawItem('raw-date-bottom', 'bottom', '黑色直筒裤', {
        fit: '直筒',
        patternType: '纯色',
        styleComplexity: '简洁',
        sceneTags: ['约会'],
        styleTags: ['简约'],
      }),
      rawItem('raw-date-shoes', 'shoes', '黑色单鞋', {
        styleComplexity: '简洁',
        sceneTags: ['约会'],
        styleTags: ['简约'],
      }),
    ];
  }
  return [
    rawItem('raw-sport-top', 'top', '运动训练上衣', {
      fit: '常规',
      sceneTags: ['运动', '训练'],
      styleTags: ['运动'],
      careLabelFacts: [{ fact: 'shoulder_mobility', confidence: 0.91, parsedFrom: 'care_label_ocr' }],
      structuredAiFacts: ['breathability', 'quick_dry'],
    }),
    rawItem('raw-sport-bottom', 'bottom', '运动长裤', {
      fit: '常规',
      sceneTags: ['运动', '训练'],
      styleTags: ['运动'],
      careLabelFacts: [{ fact: 'flexible_fit', confidence: 0.9, parsedFrom: 'care_label_ocr' }],
    }),
    rawItem('raw-sport-shoes', 'shoes', '系带运动鞋', {
      closure: '鞋带',
      sceneTags: ['运动', '训练'],
      styleTags: ['运动'],
      structuredAiFacts: ['cushioning', 'grip'],
    }),
  ];
}

function weatherForScene(scene) {
  return scene === 'home'
    ? { temp: 24, weather: '多云' }
    : { temp: 22, weather: '晴' };
}

function buildRealSchemaReplay(scene) {
  if (!REPLAY_SCENES.includes(scene)) throw new Error(`unsupported replay scene: ${String(scene)}`);
  const wardrobe = buildRawWardrobe(scene);
  const weather = weatherForScene(scene);
  const candidates = buildOutfitCandidatesV1({
    clothes: wardrobe,
    scene,
    weather,
    weatherMode: 'live',
    maxResults: 4,
    excludedOutfitKeys: [],
    excludeClothingIdSets: [],
    recommendationProfile: SHARED_PROFILE,
  });
  const rawOutfits = candidates.map((candidate, index) => ({
    id: `real-schema-${scene}-${index + 1}`,
    outfitKey: candidate.outfitKey,
    clothingIds: candidate.items.map((item) => item._id),
    items: candidate.items.map((item) => ({ ...item })),
    scene,
    weatherSnapshot: { ...weather },
    eligibility: candidate.eligibility,
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
  }));
  const extracted = rawOutfits.map((outfit) => ({
    structured: extractOutfitFactsV3(outfit, { scene, weather }),
    copy: buildOutfitCopyFacts({ outfit, scene, weather }),
  }));
  const compiled = compileRecommendationLanguageV3({ outfits: rawOutfits, scene, weather });
  const finalized = finalizeAcceptedRecommendations(compiled, { mode: 'new_recommendation' });
  const finalById = new Map(finalized.finalRecommendations.map((outfit) => [outfit.id, outfit]));
  return {
    fixtureKind: 'real-schema replay',
    fixtureOrigin: 'repository recognition/composition test schema; not production data',
    scene,
    weather,
    rawWardrobe: wardrobe.map((item) => ({ ...item })),
    requestedCount: rawOutfits.length,
    acceptedCount: finalized.acceptedCount,
    finalApiCount: finalized.finalRecommendations.length,
    copyAcceptedCount: finalized.copyAcceptedCount,
    copyHiddenCount: finalized.copyHiddenCount,
    candidates: compiled.map((outfit, index) => summarizeCandidate(
      outfit,
      extracted[index],
      rawOutfits[index],
      finalById,
    )),
  };
}

function summarizeCandidate(outfit, extracted, rawOutfit, finalById) {
  const factRecords = Object.values(extracted.copy.itemFactsById || {})
    .flatMap((entry) => entry.factRecords || []);
  return {
    outfitId: outfit.id,
    selectedOutfitItemIds: outfit.clothingIds || [],
    rawItemFields: (rawOutfit.items || []).map((item) => Object.keys(item).sort()),
    extractedFacts: factRecords.map((record) => ({
      factId: record.factId,
      source: record.source,
      confidence: record.confidence,
      evidenceLevel: factEvidenceLevel(record),
    })),
    rejectedWeakFunctionalFacts: factRecords
      .filter((record) => RELIABLE_ONLY_FACTS.includes(record.fact) && factEvidenceLevel(record) === 'C')
      .map((record) => record.factId),
    sceneEligibility: rawOutfit.eligibility?.scene || null,
    relationFacts: extracted.copy.relationFacts || [],
    claimId: outfit.copyContract.todayClaimId || null,
    todayReason: outfit.copyContract.todayReason,
    detailExplanation: outfit.copyContract.detailExplanation || null,
    detailDisplay: outfit.copyContract.detailExplanation ? 'visible' : 'hidden',
    gateResult: outfit.copyContract.gateResult,
    riskFlags: outfit.copyContract.riskFlags,
    copyDisplay: finalById.get(outfit.id)?.copyDisplay || 'hidden',
    includedInFinalApiArray: finalById.has(outfit.id),
  };
}

function buildAllRealSchemaReplays() {
  return Object.fromEntries(REPLAY_SCENES.map((scene) => [scene, buildRealSchemaReplay(scene)]));
}

module.exports = {
  REPLAY_SCENES,
  buildAllRealSchemaReplays,
  buildRawWardrobe,
  buildRealSchemaReplay,
};
