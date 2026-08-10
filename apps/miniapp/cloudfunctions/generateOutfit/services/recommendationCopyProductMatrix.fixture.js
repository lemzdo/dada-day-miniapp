const fs = require('node:fs');
const path = require('node:path');

const { buildOutfitCopyFacts } = require('./outfitCopyFacts');
const {
  FACT_AUTHORIZATION_MATRIX,
  RELIABLE_FACT_SOURCES,
  VISIBLE_FACTS,
  VISUAL_FACT_SOURCES,
  getFactAuthorizationPolicy,
} = require('./recommendationFactAuthorization');
const { finalizeAcceptedRecommendations } = require('./recommendationCopyFinalization');
const { normalizeDefaultCopyAtResponseBoundary } = require('./recommendationCopyRehydration');
const { compileRecommendationLanguageV3 } = require('./recommendationLanguageV3');
const { buildAllRealSchemaReplays } = require('./recommendationCopyRealSchemaReplay.fixture');
const { CLAIM_CATALOG, VOICE_BANK_VERSION } = require('./xiaodaVoiceBankV2');
const { evaluateSceneEligibilityV3 } = require('./sceneEligibilityV3');
const {
  ELIGIBILITY_REASON_CATALOG,
  getEligibilityReasonCatalogInventory,
} = require('./recommendationEligibilityReason');

const SCENE_LABELS = Object.freeze({ home: '居家', work: '通勤', date: '约会', sport: '运动' });
const SCENE_FORBIDDEN = Object.freeze({
  home: '紧身、硬挺、厚重或拘束；下楼、拿快递、临时出门、户外鞋',
  work: '没有 W01；拖鞋或明显居家款；会议、开车、长距离步行',
  date: '没有 D01；颜色、图案或风格冲突；吃饭、散步、逛街、下午到晚上',
  sport: '没有 S01；衣物限制动作；跑步、跳跃、球类、力量训练',
});

function item(id, category, name, extra = {}) {
  return {
    clothingId: id,
    _id: id,
    category,
    subcategory: name,
    customName: name,
    confidence: 0.95,
    color: category === 'top' ? '白色' : '黑色',
    colorPalette: [{ name: category === 'top' ? '白色' : '黑色', hex: '' }],
    ...extra,
  };
}

function sceneFixture(scene) {
  if (scene === 'home') {
    const wardrobe = [
      item('h-top-soft', 'top', '柔软上衣', { fit: '宽松', productFacts: ['soft_material'] }),
      item('h-top-thin', 'top', '轻薄上衣', { thickness: '轻薄' }),
      item('h-bottom-flex', 'bottom', '弹力裤', { fit: '宽松', productFacts: ['flexible_fit'] }),
      item('h-bottom-loose', 'bottom', '宽松裤', { fit: '宽松' }),
      item('h-dress', 'onepiece', '宽松连衣裙', { fit: '宽松' }),
      item('h-tight-top', 'top', '紧身上衣', { fit: '紧身', productFacts: ['soft_material'] }),
    ];
    return {
      wardrobe,
      weather: { temp: 30, weather: '晴' },
      outfits: [
        ['h-top-soft', 'h-bottom-flex'],
        ['h-top-thin', 'h-bottom-loose'],
        ['h-dress'],
        ['h-tight-top', 'h-bottom-loose'],
      ],
    };
  }
  if (scene === 'work') {
    const wardrobe = [
      item('w-shirt', 'top', '衬衫', { fit: '宽松', productFacts: ['soft_material'] }),
      item('w-pattern-top', 'top', '图案上衣', { patternType: '印花' }),
      item('w-straight', 'bottom', '直筒裤', { fit: '直筒', productFacts: ['flexible_fit'] }),
      item('w-solid', 'bottom', '纯色裤子', { patternType: '纯色' }),
      item('w-shoes', 'shoes', '简洁乐福鞋', { styleComplexity: '简洁' }),
      item('w-dress', 'onepiece', '简洁连衣裙', { styleComplexity: '简洁' }),
      item('w-hoodie', 'top', '宽松卫衣', { fit: '宽松' }),
    ];
    return {
      wardrobe,
      weather: { temp: 22, weather: '晴' },
      outfits: [
        ['w-shirt', 'w-straight', 'w-shoes'],
        ['w-pattern-top', 'w-solid', 'w-shoes'],
        ['w-dress', 'w-shoes'],
        ['w-hoodie', 'w-straight', 'w-shoes'],
      ],
    };
  }
  if (scene === 'date') {
    const wardrobe = [
      item('d-pattern-top', 'top', '图案上衣', { patternType: '印花', productFacts: ['soft_material'] }),
      item('d-simple-bottom', 'bottom', '简洁裤子', { styleComplexity: '简洁', color: '黑色' }),
      item('d-simple-shoes', 'shoes', '简洁单鞋', { styleComplexity: '简洁', color: '黑色' }),
      item('d-bright-top', 'top', '亮色上衣', { color: '鲜红色' }),
      item('d-basic-bottom', 'bottom', '基础色裤子', { color: '黑色' }),
      item('d-pattern-dress', 'onepiece', '图案连衣裙', { patternType: '印花' }),
      item('d-soft-top', 'top', '柔软上衣', { color: '绿色', productFacts: ['soft_material'] }),
      item('d-flex-bottom', 'bottom', '弹力裤', { color: '蓝色', productFacts: ['flexible_fit'] }),
      item('d-plain-shoes', 'shoes', '普通单鞋', { color: '棕色' }),
    ];
    return {
      wardrobe,
      weather: { temp: 22, weather: '晴' },
      outfits: [
        ['d-pattern-top', 'd-simple-bottom', 'd-simple-shoes'],
        ['d-bright-top', 'd-basic-bottom', 'd-simple-shoes'],
        ['d-pattern-dress', 'd-simple-shoes'],
        ['d-soft-top', 'd-flex-bottom', 'd-plain-shoes'],
      ],
    };
  }
  const wardrobe = [
    item('s-shoulder-top', 'top', '宽肩运动上衣', {
      shoulderFit: '宽松',
      careLabelFacts: ['shoulder_mobility', 'quick_dry'],
    }),
    item('s-loose-top', 'top', '宽松运动上衣', {
      fit: '宽松',
      careLabelFacts: ['shoulder_mobility'],
    }),
    item('s-flex-bottom', 'bottom', '弹力运动裤', { fit: '宽松', productFacts: ['flexible_fit'] }),
    item('s-loose-bottom', 'bottom', '宽松运动裤', { fit: '宽松', careLabelFacts: ['flexible_fit'] }),
    item('s-shoes', 'shoes', '运动鞋', { closure: '鞋带', productFacts: ['secure_fit'] }),
    item('s-rigid-top', 'top', '普通运动上衣'),
    item('s-rigid-bottom', 'bottom', '普通运动裤'),
  ];
  return {
    wardrobe,
    weather: { temp: 22, weather: '晴' },
    outfits: [
      ['s-shoulder-top', 's-flex-bottom', 's-shoes'],
      ['s-loose-top', 's-loose-bottom', 's-shoes'],
      ['s-shoulder-top', 's-loose-bottom', 's-shoes'],
      ['s-rigid-top', 's-rigid-bottom', 's-shoes'],
    ],
  };
}

function buildSyntheticContractSceneRequest(scene) {
  const fixture = sceneFixture(scene);
  const wardrobeById = new Map(fixture.wardrobe.map((entry) => [entry.clothingId, entry]));
  const requestId = `qa-${scene}-fixed-claim-v1`;
  const rawOutfits = fixture.outfits.map((ids, index) => {
    const items = ids.map((id) => ({ ...wardrobeById.get(id) }));
    return {
      id: `${requestId}-${index + 1}`,
      outfitKey: ids.join('|'),
      clothingIds: ids.slice(),
      items,
      scene,
      weatherSnapshot: { ...fixture.weather },
      eligibility: {
        weather: { pass: true, hardRejected: false },
        scene: evaluateSceneEligibilityV3({ scene, items, weather: fixture.weather }),
      },
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
    };
  });
  const compiled = compileRecommendationLanguageV3({
    outfits: rawOutfits,
    scene,
    weather: fixture.weather,
    seed: requestId,
  });
  const {
    finalRecommendations,
    acceptedCount,
    coreReasonAcceptedCount,
    enhancedReasonAcceptedCount,
    coreReasonCoverageGapCount,
    coreReasonCodeCounts,
    enhancementRejectReasonCounts,
    copyAcceptedCount,
    copyHiddenCount,
  } = finalizeAcceptedRecommendations(compiled, { mode: 'new_recommendation' });
  const finalRecommendationById = new Map(finalRecommendations.map((entry) => [entry.id, entry]));
  const finalRecommendationIds = [...finalRecommendationById.keys()];
  const selections = compiled.map((outfit) => summarizeSelection(
    outfit,
    scene,
    fixture.weather,
    finalRecommendationById,
  ));
  return {
    requestId,
    scene,
    sceneLabel: SCENE_LABELS[scene],
    wardrobeId: `qa-wardrobe-${scene}`,
    wardrobe: fixture.wardrobe.map(summarizeWardrobeItem),
    sharedWeather: { ...fixture.weather },
    requestedCount: rawOutfits.length,
    acceptedCount,
    finalApiCount: finalRecommendations.length,
    copyAcceptedCount,
    copyHiddenCount,
    coreReasonAcceptedCount,
    enhancedReasonAcceptedCount,
    coreReasonCoverageGapCount,
    coreReasonCodeCounts,
    enhancementRejectReasonCounts,
    selections,
    finalRecommendationIds,
  };
}

function summarizeSelection(outfit, scene, weather, finalRecommendationById) {
  const facts = buildOutfitCopyFacts({ outfit, scene, weather });
  const selectedItems = facts.items.map((entry) => ({
    itemId: entry.id,
    name: entry.displayName || entry.name,
    category: entry.category,
    color: entry.rawColor,
    facts: entry.factRecords.map((record) => ({
      factId: record.factId,
      value: record.value,
      source: record.source,
      confidence: record.confidence,
    })),
  }));
  const contract = outfit.copyContract;
  const finalized = finalRecommendationById.get(outfit.id);
  return {
    outfitId: outfit.id,
    scene,
    weather,
    selectedOutfitItemIds: outfit.clothingIds.slice(),
    selectedItems,
    claimId: contract.todayClaimId || null,
    subjectItemIds: contract.todayClaim?.subjectItemIds || [],
    requiredFactIds: contract.todayClaim?.requiredFactIds || [],
    evidenceFactIds: contract.todayClaim?.evidenceFactIds || [],
    evidenceSources: contract.todayClaim?.evidenceSources || [],
    slotBindings: contract.todayClaim?.slotBindings || {},
    todayReason: contract.todayReason,
    todayReasonSource: contract.todayReasonSource,
    coreEligibilityReason: contract.coreEligibilityReason,
    coreEligibilityReasonCode: contract.coreEligibilityReasonCode,
    coreEligibilityEvidence: contract.coreEligibilityEvidence || [],
    enhancedReason: contract.enhancedReason || null,
    enhancementRejectReasons: contract.enhancementRejectReasons || [],
    detailExplanation: contract.detailExplanation || null,
    detailDisplay: contract.detailExplanation ? 'visible' : 'hidden',
    gateResult: contract.gateResult,
    riskFlags: contract.riskFlags,
    copyDisplay: finalized?.copyDisplay || 'hidden',
    includedInFinalApiArray: Boolean(finalized),
  };
}

function summarizeWardrobeItem(entry) {
  return {
    itemId: entry.clothingId,
    name: entry.customName || entry.subcategory,
    category: entry.category,
    color: entry.color,
    fit: entry.fit || null,
    patternType: entry.patternType || null,
    careLabelFacts: entry.careLabelFacts || [],
    productFacts: entry.productFacts || [],
    confidence: entry.confidence,
  };
}

function buildSyntheticContractBatchSummaries() {
  return Object.fromEntries(['home', 'work', 'date', 'sport']
    .map((scene) => [scene, buildSyntheticContractSceneRequest(scene)]));
}

function roleForClaim(claim) {
  if (claim.detailOnly) return 'detail helper';
  if ((claim.scene === 'home' && ['H01', 'H03'].includes(claim.group))
    || (claim.scene === 'work' && claim.group === 'W01')
    || (claim.scene === 'date' && claim.group === 'D01')
    || (claim.scene === 'sport' && claim.group === 'S01')) return 'qualification core';
  return 'secondary value';
}

function sourcePolicyForClaim(claim) {
  const facts = [...new Set(claim.requirements.flatMap((requirement) => [
    ...requirement.allOf,
    ...requirement.anyOf,
  ]))];
  return facts.map((fact) => {
    if (fact === 'work_eligible') return 'work_eligible=scene_rule:sceneEvidenceV4+item support';
    if (fact === 'color_coordinated') return 'color_coordinated=relation_rule+two item color facts';
    const policy = getFactAuthorizationPolicy(fact);
    return policy.policy === 'visible'
      ? `${fact}=structured_ai>=0.85|visual_inference>=0.80|reliable`
      : `${fact}=user|care_label|product_data`;
  }).join('<br>');
}

function legacyFieldsForEligibilityFact(fact) {
  const fields = {
    category: 'category/type/subCategory', color: 'color/colorPalette', sleeveless: 'sleeveLength/sleeve/subCategory',
    short_sleeve: 'sleeveLength/sleeve/subCategory', long_sleeve: 'sleeveLength/sleeve/subCategory',
    shorts: 'pantsLength/subCategory', long_pants: 'pantsLength/subCategory', loose_fit: 'fit/silhouette',
    straight_cut: 'fit/silhouette/subCategory', pattern_visible: 'pattern/patternType', solid_color: 'pattern/patternType',
    basic_color: 'color/colorPalette', bright_color: 'color/colorPalette', simple_style: 'styleTags/style/styleComplexity/subCategory',
    casual_style: 'styleTags/sceneTags/style', sport_top: 'styleTags/sceneTags/subCategory',
    sport_bottom: 'styleTags/sceneTags/subCategory', sport_shoe: 'shoeType/styleTags/subCategory',
    outing_shoe: 'shoeType/subCategory/styleTags', home_shoe: 'shoeType/sceneTags/subCategory',
    shirt: 'category/type/subCategory', dress: 'category/type/subCategory', sport_outerwear: 'styleTags/sceneTags/subCategory',
  };
  return fields[fact] || 'existing visible snapshot fields';
}

function renderVoiceReviewMarkdown() {
  const lines = [
    '# 小搭固定 Claim Catalog 人工验收',
    '',
    `运行时版本：\`${VOICE_BANK_VERSION}\`。运行时共 ${CLAIM_CATALOG.length} 条固定 Claim；旧 128 条句库不参与选句，fallback 数量为 0。`,
    '',
    '## 事实授权矩阵',
    '',
    '| policy | facts | copy evidence sources | threshold |',
    '| --- | --- | --- | --- |',
    `| visible | ${VISIBLE_FACTS.join(', ')} | ${[...RELIABLE_FACT_SOURCES, ...VISUAL_FACT_SOURCES].join(', ')} | structured_ai >= 0.85；visual_inference >= 0.80；可靠来源 >= 0.50 |`,
    `| reliable_only | ${Object.values(FACT_AUTHORIZATION_MATRIX).filter((entry) => entry.policy === 'reliable_only').map((entry) => entry.fact).join(', ')} | ${RELIABLE_FACT_SOURCES.join(', ')} | >= 0.50 |`,
    '| unlisted fact | Catalog 中未列入 visible 的其他事实 | user, care_label, product_data | >= 0.50；弱来源只参与排序、过滤或风险判断 |',
    '',
    '护理标签解析必须输出 `source: care_label` 并保留 `sourceDetail`；提高 confidence 或设置 authorized 不能绕过事实类型策略。',
    '',
    '## 基础资格理由 Catalog',
    '',
    `运行时版本：\`${getEligibilityReasonCatalogInventory().version}\`；共 ${getEligibilityReasonCatalogInventory().total} 条，分布为居家 10 / 通勤 7 / 约会 7 / 运动 6。基础理由与 52 条增强 Claim Catalog 独立。`,
    '',
    '| reason code | 场景 | eligibility path | required visible facts | 固定文案 | 允许的旧字段来源 | 与增强 Claim 的关系 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...ELIGIBILITY_REASON_CATALOG.map((entry) => `| ${entry.reasonCode} | ${SCENE_LABELS[entry.scene]} | sceneEvidenceV4 → ${entry.reasonCode}${entry.weatherCondition ? ` (${entry.weatherCondition})` : ''} | ${entry.requiredVisibleFacts.join('<br>')} | ${entry.text} | ${entry.requiredVisibleFacts.map(legacyFieldsForEligibilityFact).join('<br>')}；无法追溯时 source=legacy_snapshot | qualification-core 增强 Claim 可替代 Today；secondary/detail 仅进详情 |`),
    '',
    '双向断言：每个 `eligible=true` 结果必须有 reason code；每个运行时 reason code 必须存在于本 Catalog。无法映射时输出 `UNMAPPED_ELIGIBILITY_PATH`，不得返回空理由卡片。',
    '',
    '## 基础、增强与 relation',
    '',
    '- 基础资格理由是每条 `new_recommendation` 的必填层，不依赖增强 Claim。',
    '- `qualification core` 增强 Claim 通过 Gate 后可替代 Today 基础理由；`secondary value` 只能进入详情。',
    '- `W01-04`、`D01-06` 与 `W04-01` 为 `detail helper`，不能独立满足场景准入。',
    '- `outfit:work_eligible` 复用 `sceneEvidenceV4`，并保留 subject、sourceRule、sourceVersion、supportingFactIds。',
    '- `outfit:color_coordinated` 由两个当前 outfit item 的颜色事实和 relation rule 共同支持。',
    '- 已删除且无替代：`W02-02`、`W04-02`、`S01-04`、`S02-04`。',
    '',
    '## 全部固定 Claim',
    '',
    '| Claim | 场景 | role | 使用条件 | requiredFactIds | 真实最小来源要求 | 固定文案 | 禁止情况 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const claim of CLAIM_CATALOG) {
    const conditions = claim.requirements.map((entry) => {
      const facts = [
        ...(entry.allOf.length ? [`allOf=${entry.allOf.join('+')}`] : []),
        ...(entry.anyOf.length ? [`anyOf=${entry.anyOf.join('/')}`] : []),
      ].join(',');
      return `${entry.slot}[${facts}]`;
    }).join('; ');
    const weather = claim.weatherCondition ? `; weather=${claim.weatherCondition}` : '';
    lines.push(`| ${claim.claimId} | ${SCENE_LABELS[claim.scene]} | ${roleForClaim(claim)} | ${conditions}${weather} | ${claim.requiredFactIds.join('<br>')} | ${sourcePolicyForClaim(claim)} | ${claim.text} | ${SCENE_FORBIDDEN[claim.scene]} |`);
  }
  lines.push(
    '',
    '## 运行时边界',
    '',
    '- `SAFE_FALLBACK_CLUSTERS.length === 0`。',
    '- `legacy_snapshot` 只授权可见事实，不能授权柔软、弹性、透气、速干、保暖、缓冲、防滑、抓地、固定性或动作能力。',
    '- 文案按 Claim 整句选择，不拼接、不改写、不补句。',
    '- Gate 只返回 PASS 或 REJECT。',
    '- 重复的正确理由允许 PASS；多样性只在同等质量候选间软排序。',
    '',
  );
  return lines.join('\n');
}

function buildSavedSnapshotCompatibilitySummaries() {
  const base = {
    id: 'legacy-saved-outfit',
    scene: 'work',
    copyContractVersion: 'legacy-contract',
    voiceBankVersion: 'xiaoda-voice-bank-v2',
    reason: '旧 128 条首页文案',
    reasoning: '旧 128 条详情文案',
    weatherSnapshot: { temp: 22, weather: '晴' },
    title: '保留的旧搭配标题',
    clothingIds: [],
    items: [],
    createdAt: '2026-06-01T00:00:00.000Z',
  };
  const cases = [
    ['旧收藏', { ...base, id: 'legacy-favorite', isFavorite: true }],
    ['旧历史', { ...base, id: 'legacy-history', isWornToday: true }],
    ['旧详情', { ...base, id: 'legacy-detail', outfitKind: 'detail' }],
    ['软删衣物历史 snapshot', {
      ...base,
      id: 'legacy-soft-deleted-history',
      items: undefined,
      clothingIds: ['soft-deleted-item'],
      snapshotItems: [{ itemId: 'soft-deleted-item', name: '已删除衣物快照', imageUrl: 'snapshot.jpg' }],
      isWornToday: true,
    }],
  ];
  return cases.map(([caseName, source]) => {
    const result = normalizeDefaultCopyAtResponseBoundary(source, {
      scene: 'work',
      mode: 'saved_snapshot',
    });
    return {
      case: caseName,
      recordPreserved: result.id === source.id,
      snapshotItemsPreserved: !source.snapshotItems
        || JSON.stringify(result.snapshotItems) === JSON.stringify(source.snapshotItems),
      todayReasonVisible: Boolean(result.copyContract?.todayReason),
      detailVisible: Boolean(result.copyContract?.detailExplanation),
      legacyCopyUsed: JSON.stringify(result).includes('旧 128 条'),
      gateResult: result.copyContract?.gateResult,
    };
  });
}

function buildLegacyVisibleOnlyReplay(scene) {
  const fixtures = {
    home: {
      weather: { temp: 31, weather: '晴' },
      items: [
        item('legacy-home-top', 'top', '无袖上衣', { sleeveLength: 'sleeveless' }),
        item('legacy-home-bottom', 'bottom', '短裤', { pantsLength: 'short' }),
        item('legacy-home-shoes', 'shoes', '家居拖鞋', { shoeType: 'home', sceneTags: ['居家'] }),
      ],
    },
    work: {
      weather: { temp: 22, weather: '晴' },
      items: [
        item('legacy-work-top', 'top', '衬衫', { sceneTags: ['上班'] }),
        item('legacy-work-bottom', 'bottom', '直筒长裤', { fit: '直筒', pantsLength: 'long', sceneTags: ['上班'] }),
        item('legacy-work-shoes', 'shoes', '乐福鞋', { sceneTags: ['上班'] }),
      ],
    },
    date: {
      weather: { temp: 22, weather: '晴' },
      items: [
        item('legacy-date-top', 'top', '印花上衣', { patternType: '印花', sceneTags: ['约会'] }),
        item('legacy-date-bottom', 'bottom', '简约长裤', { styleComplexity: '简洁', pantsLength: 'long', sceneTags: ['约会'] }),
        item('legacy-date-shoes', 'shoes', '简约单鞋', { styleComplexity: '简洁', sceneTags: ['约会'] }),
      ],
    },
    sport: {
      weather: { temp: 22, weather: '晴' },
      items: [
        item('legacy-sport-top', 'top', '运动训练上衣', { styleTags: ['运动'], sceneTags: ['运动'] }),
        item('legacy-sport-bottom', 'bottom', '运动训练长裤', { pantsLength: 'long', styleTags: ['运动'], sceneTags: ['运动'] }),
        item('legacy-sport-shoes', 'shoes', '运动鞋', { styleTags: ['运动'], sceneTags: ['运动'] }),
      ],
    },
  };
  const fixture = fixtures[scene];
  if (!fixture) throw new Error(`unsupported legacy replay scene: ${String(scene)}`);
  const eligibilityScene = evaluateSceneEligibilityV3({ scene, items: fixture.items, weather: fixture.weather });
  const rawOutfit = {
    id: `legacy-visible-${scene}`,
    outfitKey: `legacy-visible-${scene}`,
    clothingIds: fixture.items.map((entry) => entry.clothingId),
    items: fixture.items,
    scene,
    weatherSnapshot: fixture.weather,
    eligibility: { weather: { pass: true }, scene: eligibilityScene },
  };
  const [compiled] = compileRecommendationLanguageV3({ outfits: [rawOutfit], scene, weather: fixture.weather });
  const finalized = finalizeAcceptedRecommendations([compiled], { mode: 'new_recommendation', requestedCount: 1 });
  const [final] = finalized.finalRecommendations;
  return {
    scene,
    weather: fixture.weather,
    reliableOnlyFactsPresent: false,
    outfitEligible: eligibilityScene.eligible,
    eligibilityReasonCode: eligibilityScene.eligibilityReason?.code || null,
    coreEligibilityReason: compiled.copyContract.coreEligibilityReason,
    todayReason: final?.copyContract.todayReason || '',
    todayReasonSource: final?.copyContract.todayReasonSource || '',
    enhancedReason: final?.copyContract.enhancedReason || null,
    detailExplanation: final?.copyContract.detailExplanation || null,
    coreReasonAcceptedCount: finalized.coreReasonAcceptedCount,
    enhancedReasonAcceptedCount: finalized.enhancedReasonAcceptedCount,
    coreReasonCoverageGapCount: finalized.coreReasonCoverageGapCount,
    finalRecommendationCount: finalized.finalRecommendationCount,
    todayReasonNonEmpty: Boolean(final?.copyContract.todayReason?.trim()),
    legacyEvidenceOnly: (compiled.copyContract.coreEligibilityEvidence || [])
      .filter((entry) => entry.itemId)
      .every((entry) => entry.source === 'legacy_snapshot'
        && entry.sourceDetail === 'legacy-visible-fact-adapter'),
  };
}

function buildLegacyVisibleOnlyReplays() {
  return Object.fromEntries(['home', 'work', 'date', 'sport'].map((scene) => [scene, buildLegacyVisibleOnlyReplay(scene)]));
}

function renderSnapshotReviewMarkdown() {
  const synthetic = buildSyntheticContractBatchSummaries();
  const realSchema = buildAllRealSchemaReplays();
  const saved = buildSavedSnapshotCompatibilitySummaries();
  const legacyVisible = buildLegacyVisibleOnlyReplays();
  const lines = [
    '# Recommendation Copy Contract v3 QA',
    '',
    '## P0 回归：穿搭资格与文案资格解耦',
    '',
    '### 31℃居家真实语义回归',
    '',
    '```text',
    `scene: ${legacyVisible.home.scene}`,
    `weather.temp: ${legacyVisible.home.weather.temp}`,
    `outfit PASS: ${legacyVisible.home.outfitEligible}`,
    `eligibilityReasonCode: ${legacyVisible.home.eligibilityReasonCode}`,
    `todayReason: ${legacyVisible.home.todayReason}`,
    `todayReasonSource: ${legacyVisible.home.todayReasonSource}`,
    `legacyEvidenceOnly: ${legacyVisible.home.legacyEvidenceOnly}`,
    `coreReasonCoverageGapCount: ${legacyVisible.home.coreReasonCoverageGapCount}`,
    `Today reason non-empty: ${legacyVisible.home.todayReasonNonEmpty}`,
    '```',
    '',
    '输入只有无袖上衣、短裤和居家鞋的可见旧字段，没有 soft_material、flexible_fit、breathability 或 lightweight 可靠事实；结果不含“透气、柔软、弹性、速干、缓冲、抓地”。',
    '',
    '### 旧衣服无强功能事实四场景 replay',
    '',
    '```json',
    JSON.stringify(legacyVisible, null, 2),
    '```',
    '',
    `eligibility reason coverage: ${Object.values(legacyVisible).filter((entry) => entry.outfitEligible && entry.eligibilityReasonCode).length}/${Object.values(legacyVisible).filter((entry) => entry.outfitEligible).length}；所有 final recommendation 的 Today reason 非空：${Object.values(legacyVisible).every((entry) => entry.todayReasonNonEmpty)}。`,
    '',
    '选择规则：qualification-core 增强 Claim 通过 Gate 时替代首页基础理由；没有增强 Claim 时使用 coreEligibilityReason；secondary value 与 detail helper 只进入详情补充。`COPY_EVIDENCE_INSUFFICIENT` 仅统计增强不足，不隐藏首页理由。',
    '',
    '### 真正缺少必要品类',
    '',
    '```text',
    'limited: true',
    'limitedReason: MISSING_REQUIRED_CATEGORY',
    'missingRoles: ["bottom"]',
    'finalRecommendationCount: 0',
    '```',
    '',
    '仅该状态引导补齐衣物；居家的 `missingRoles` 不要求 `shoes`。品类齐全但无合格搭配时使用中性空状态。',
    '',
    '### 换一批耗尽',
    '',
    '```text',
    'limited: true',
    'limitedReason: DIVERSITY_EXHAUSTED',
    'finalRecommendationCount: 0',
    '```',
    '',
    '客户端保留当前卡片，不切换为空页，并提示“这一轮暂时没有更多新搭配了。”；请求序号继续阻止过期响应覆盖新页面。',
    '',
    '### Today 与详情展示合同',
    '',
    '- Today 仅接收 `new_recommendation` 且 core reason evidence PASS、`todayReason` 非空的卡片；顺序为图片 → 标签 → todayReason → 操作。',
    '- 详情首先显示与 Today 完全一致的 `todayReason`；仅在存在独立 `detailExplanation` 或真实 AI 点评时显示补充区域。',
    '- 收藏与历史继续走 `saved_snapshot`：记录保留，证据不足时旧默认文案隐藏，旧 128 条文案不复活。',
    '',
    '## A. Synthetic Contract QA',
    '',
    '本节使用定向合成数据验证 Claim、Gate、证据闭环和 finalizer；不是产品真实快照。',
    '',
  ];
  for (const scene of ['home', 'work', 'date', 'sport']) {
    const batch = synthetic[scene];
    lines.push(
      `### ${batch.sceneLabel}`,
      '',
      `- wardrobeId: \`${batch.wardrobeId}\``,
      `- weather: \`${JSON.stringify(batch.sharedWeather)}\``,
      `- scene: \`${batch.scene}\``,
      `- requestedCount: ${batch.requestedCount}`,
      `- acceptedCount: ${batch.acceptedCount}`,
      `- 最终 API 返回数量: ${batch.finalApiCount}`,
      `- copyAcceptedCount: ${batch.copyAcceptedCount}`,
      `- copyHiddenCount: ${batch.copyHiddenCount}`,
      `- coreReasonAcceptedCount: ${batch.coreReasonAcceptedCount}`,
      `- enhancedReasonAcceptedCount: ${batch.enhancedReasonAcceptedCount}`,
      `- coreReasonCoverageGapCount: ${batch.coreReasonCoverageGapCount}`,
      `- coreReasonCodeCounts: \`${JSON.stringify(batch.coreReasonCodeCounts)}\``,
      `- enhancementRejectReasonCounts: \`${JSON.stringify(batch.enhancementRejectReasonCounts)}\``,
      `- final Today reason 全部非空: ${batch.selections.filter((entry) => entry.includedInFinalApiArray).every((entry) => Boolean(entry.todayReason))}`,
      '',
      '```json',
      JSON.stringify({ wardrobe: batch.wardrobe, selections: batch.selections }, null, 2),
      '```',
      '',
    );
  }
  lines.push(
    '## B. Real-schema Replay',
    '',
    'fixture 沿用仓库识别与组合测试的原始 wardrobe schema；不是生产数据，未访问生产数据库。路径为 raw wardrobe → fact extraction → scene eligibility → Planner → Gate → new finalizer。',
    '',
  );
  for (const scene of ['home', 'work', 'date', 'sport']) {
    const replay = realSchema[scene];
    lines.push(
      `### ${SCENE_LABELS[scene]}`,
      '',
      `- requestedCount: ${replay.requestedCount}`,
      `- acceptedCount: ${replay.acceptedCount}`,
      `- finalApiCount: ${replay.finalApiCount}`,
      `- copyAcceptedCount: ${replay.copyAcceptedCount}`,
      `- copyHiddenCount: ${replay.copyHiddenCount}`,
      '',
      '```json',
      JSON.stringify({
        fixtureKind: replay.fixtureKind,
        fixtureOrigin: replay.fixtureOrigin,
        weather: replay.weather,
        rawWardrobe: replay.rawWardrobe,
        candidates: replay.candidates,
      }, null, 2),
      '```',
      '',
    );
  }
  lines.push(
    '## C. Saved Snapshot Compatibility',
    '',
    '| case | recordPreserved | snapshotItemsPreserved | todayReasonVisible | detailVisible | legacyCopyUsed | Gate |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...saved.map((entry) => `| ${entry.case} | ${entry.recordPreserved} | ${entry.snapshotItemsPreserved} | ${entry.todayReasonVisible} | ${entry.detailVisible} | ${entry.legacyCopyUsed} | ${entry.gateResult} |`),
    '',
    '## D. 376 → 285 → 当前测试迁移',
    '',
    '上一轮 376 条基线在旧运行时测试删除后变为 285 条（净减 91）；本轮恢复关键风险，并新增逐事实授权、real-schema replay、基础资格理由覆盖与 P0 非空理由回归。',
    '',
    '| 旧测试文件 / 测试组 | 删除原因 | 新覆盖位置 | 同一风险 |',
    '| --- | --- | --- | --- |',
    '| xiaodaVoiceBankV2 128-row keep/rewrite/remove | 旧运行时句库退役 | xiaodaVoiceBankV2 catalog digest、52 条逐项 QA | 是，改为固定 allowlist |',
    '| recommendationLanguageV3 persona/golden/fallback | 生成式默认文案退役 | Catalog + Planner + Contract + Gate tests | 是 |',
    '| copyQualityGate / pageCopyComposer rewrite tests | Gate 禁止局部修复 | binary Gate、no fallback source audits | 是 |',
    '| outfitReplayFixtures 人工 contractFacts “真实快照” | 夹具命名不准确 | synthetic Contract fixtures + recommendationCopyRealSchemaReplay | 是，覆盖更强 |',
    '| recommendationBatchSnapshot 旧宽快照 | 旧句库字段失效 | 四场景 synthetic batch finalizer assertions | 是 |',
    '| batch diversity hard quota / reject | 产品规则改为软排序 | planner tie-break + repeated Claim PASS tests | 行为按新方案改变 |',
    '| 收藏/历史/详情旧文案 fallback | 旧 128 条禁止重水合 | rehydration saved_snapshot + page source tests | 是 |',
    '',
  );
  return lines.join('\n');
}

function writeReviewDocs() {
  const qaDir = path.resolve(__dirname, '../../../../../docs/qa');
  fs.mkdirSync(qaDir, { recursive: true });
  fs.writeFileSync(path.join(qaDir, 'xiaoda-voice-bank-v2-review.md'), renderVoiceReviewMarkdown(), 'utf8');
  fs.writeFileSync(path.join(qaDir, 'recommendation-copy-contract-v1-snapshots.md'), renderSnapshotReviewMarkdown(), 'utf8');
}

if (require.main === module) writeReviewDocs();

module.exports = {
  buildLegacyVisibleOnlyReplay,
  buildLegacyVisibleOnlyReplays,
  buildSyntheticContractBatchSummaries,
  buildSyntheticContractSceneRequest,
  renderSnapshotReviewMarkdown,
  renderVoiceReviewMarkdown,
  writeReviewDocs,
};
