const OUTFIT_COMPOSITION_VERSION = 'outfit-composition-v1';
const { applyWearabilityAndSceneEligibility } = require('./sceneEligibilityV3');

const ROLE = {
  CORE: 'core',
  FUNCTIONAL: 'functional',
  OPTIONAL: 'optional',
};

const SCENE_INTENTS = {
  home: ['home:indoor_relax', 'home:quick_outing', 'home:clean_daily'],
  work: ['work:polished', 'work:relaxed', 'work:walkable', 'work:layered'],
  date: ['date:soft', 'date:highlight', 'date:casual'],
  sport: ['sport:training', 'sport:light_activity', 'sport:walk', 'sport:weather_ready'],
};

function buildOutfitCandidatesV1({
  clothes = [],
  scene,
  weather = {},
  weatherMode,
  maxResults = 8,
  excludedOutfitKeys = [],
  excludeClothingIdSets = [],
  recommendationProfile = {},
  guardCandidates = true,
  returnRawCandidates = false,
  itemFactsContext,
  compactCandidates = false,
} = {}) {
  const weatherContext = normalizeCompositionWeather(weather, weatherMode);
  const {
    hasUsableWeather,
    temperature: temp,
    temperatureBand: tempBand,
  } = weatherContext;
  const normalizedScene = normalizeScene(scene);
  const excluded = new Set([
    ...(Array.isArray(excludeClothingIdSets) ? excludeClothingIdSets : []).filter(Array.isArray).map(signature),
    ...readStringArray(excludedOutfitKeys),
  ]);
  const validClothes = (Array.isArray(clothes) ? clothes : [])
    .filter((item) => item && item._id);
  const candidateContext = {
    hasUsableWeather,
    temp,
    tempBand,
    scene: normalizedScene,
    itemFactsContext,
    compactCandidates,
  };
  const candidatesBeforeTemperatureFilter = buildRawCandidates(
    groupClothesByCapability(validClothes, candidateContext),
    candidateContext,
    normalizedScene,
    excluded,
  );
  const temperatureFilteredClothes = hasUsableWeather
    ? validClothes.filter((item) => matchesTemperature(item, tempBand, candidateContext))
    : validClothes;
  const rawCandidates = temperatureFilteredClothes.length === validClothes.length
    ? candidatesBeforeTemperatureFilter
    : buildRawCandidates(
        groupClothesByCapability(temperatureFilteredClothes, candidateContext),
        candidateContext,
        normalizedScene,
        excluded,
      );
  rawCandidates.debug = {
    candidateCount: rawCandidates.length,
    filteredCandidateCount: rawCandidates.length,
    weatherMode: weatherContext.weatherMode,
    hasUsableWeather,
    temperatureBandApplied: hasUsableWeather,
    temperatureFilterSkippedReason: hasUsableWeather ? '' : 'NO_USABLE_WEATHER',
    candidateCountBeforeTemperatureFilter: candidatesBeforeTemperatureFilter.length,
    candidateCountAfterTemperatureFilter: rawCandidates.length,
    limitedReason: rawCandidates.length === 0 ? getSceneLimitedReason(normalizedScene, rawCandidates, rawCandidates) : '',
  };
  if (returnRawCandidates) return rawCandidates;

  const guardResult = guardCandidates
      ? applyWearabilityAndSceneEligibility(rawCandidates, {
        scene: normalizedScene,
        weather: weatherContext.weather,
        recommendationProfile,
        itemFactsContext,
      })
    : { accepted: rawCandidates, rejected: [], debug: {} };
  const eligibleCandidates = guardResult.accepted;

  const scored = eligibleCandidates
    .map((candidate) => scoreCompositionCandidate(candidate, {
      scene: normalizedScene,
      temp,
      tempBand,
      hasUsableWeather,
      weather: weatherContext.weather,
        recommendationProfile,
        itemFactsContext,
    }))
    .filter((candidate) => candidate.sceneIntent)
    .sort(compareCandidates);

  const limit = Math.min(Math.max(Number(maxResults || 8), 1), 8);
  const results = diversifyCandidates(scored, limit);
  results.debug = {
    candidateCount: rawCandidates.length,
    filteredCandidateCount: scored.length,
    guardCandidateCount: guardResult.debug.guardCandidateCount ?? rawCandidates.length,
    guardAcceptedCount: guardResult.debug.guardAcceptedCount ?? eligibleCandidates.length,
    guardRejectedCount: guardResult.debug.guardRejectedCount ?? 0,
    weatherRejectedCount: guardResult.debug.weatherRejectedCount ?? 0,
    sceneRejectedCount: guardResult.debug.sceneRejectedCount ?? 0,
    weatherMode: weatherContext.weatherMode,
    hasUsableWeather,
    temperatureBandApplied: hasUsableWeather,
    temperatureFilterSkippedReason: hasUsableWeather ? '' : 'NO_USABLE_WEATHER',
    candidateCountBeforeTemperatureFilter: candidatesBeforeTemperatureFilter.length,
    candidateCountAfterTemperatureFilter: rawCandidates.length,
    eligibilityReasonCoverageGapCount: guardResult.debug.eligibilityReasonCoverageGapCount ?? 0,
    rejectReasonCounts: guardResult.debug.rejectReasonCounts || {},
    unmappedEligibilityPaths: guardResult.debug.unmappedEligibilityPaths || [],
    batchDiagnostics: results.batchDiagnostics,
    limitedReason: guardResult.debug.limitedReason || getSceneLimitedReason(normalizedScene, rawCandidates, scored) || results.batchDiagnostics?.limitedReason || '',
  };
  results.limited = results.length < limit || scored.length < limit;
  results.exhausted = scored.length === 0 && excluded.size > 0;
  return results;
}

function buildRawCandidates(groups, context, scene, excluded) {
  return [
    ...buildOnepieceCandidates(groups, context),
    ...buildSeparateCandidates(groups, context),
  ]
    .filter((candidate) => candidate.items.length >= (scene === 'home' ? 1 : 2) && candidate.items.length <= 5)
    .filter((candidate) => !excluded.has(signature(candidate.items.map((item) => item._id))));
}

function buildOnepieceCandidates(groups, context) {
  const candidates = [];
  for (const dress of groups.onepiece) {
    if (context.scene === 'home') {
      const indoorBase = withRoles([dress], { [dress._id]: ROLE.CORE }, context);
      candidates.push(createCandidate(indoorBase, 'onepiece_indoor'));
    }
    for (const shoe of coreShoesForScene(groups.shoes, context)) {
      const base = withRoles([dress, shoe], { [dress._id]: ROLE.CORE, [shoe._id]: ROLE.CORE }, context);
      candidates.push(createCandidate(base, 'onepiece_shoes'));
    }
  }
  return candidates;
}

function buildSeparateCandidates(groups, context) {
  const candidates = [];
  const bottoms = [...groups.bottom, ...groups.skirt];
  for (const top of groups.top) {
    for (const bottom of bottoms) {
      if (context.scene === 'home') {
        const indoorBase = withRoles([top, bottom], {
          [top._id]: ROLE.CORE,
          [bottom._id]: ROLE.CORE,
        }, context);
        candidates.push(createCandidate(indoorBase, 'separates_indoor'));
      }
      for (const shoe of coreShoesForScene(groups.shoes, context)) {
        const base = withRoles([top, bottom, shoe], {
          [top._id]: ROLE.CORE,
          [bottom._id]: ROLE.CORE,
          [shoe._id]: ROLE.CORE,
        }, context);
        candidates.push(createCandidate(base, 'separates_shoes'));
      }
    }
  }
  return candidates;
}

function coreShoesForScene(shoes, context) {
  const source = Array.isArray(shoes) ? shoes : [];
  if (context.scene !== 'home') return source;
  return source.filter((item) => isHomeQuickOutingShoe(item, context));
}

function isHomeQuickOutingShoe(item, context) {
  const text = getItemText(item, context).toLowerCase();
  if (/拖鞋|洞洞鞋|长靴|靴|高跟|slipper|crocs|boot|heel/.test(text)) return false;
  return /运动鞋|跑步鞋|休闲鞋|乐福|sneaker|running|trainer|loafer|walking/.test(text);
}

function createCandidate(items, structureType) {
  const compact = items.every((item) => item?._candidateRef === true);
  return {
    compositionVersion: OUTFIT_COMPOSITION_VERSION,
    structureType,
    items,
    outfitItemRoles: compact ? [] : items.map((item) => ({
      id: item._id,
      slot: item.outfitSlot,
      role: item.outfitRole,
      displayName: getDisplayName(item),
    })),
  };
}

function withRoles(items, roleById, context) {
  return items.map((item) => {
    const outfitSlot = getNormalizedCategory(item, context);
    const outfitRole = roleById[item._id] || ROLE.CORE;
    if (context?.compactCandidates) {
      return {
        _id: item._id,
        outfitSlot,
        outfitRole,
        _candidateRef: true,
      };
    }
    return {
      ...item,
      outfitSlot,
      outfitRole,
      capabilities: getItemCapabilities(item, context),
    };
  });
}

function scoreCompositionCandidate(candidate, context) {
  const capabilities = new Set(candidate.items.flatMap((item) => getItemCapabilities(item, context)));
  const sceneIntent = chooseSceneIntent(capabilities, candidate, context);
  const primaryBenefit = choosePrimaryBenefit(sceneIntent, capabilities, candidate, context);
  const shoe = candidate.items.find((item) => item.outfitSlot === 'shoes');
  const shoePurpose = chooseShoePurpose(shoe, capabilities, context.scene, context);
  const observationFocus = chooseObservationFocus(candidate, context, shoePurpose);
  const score = scoreSceneIntent(sceneIntent, context.scene)
    + scoreWeatherFit(candidate, context)
    + candidate.items.reduce((sum, item) => sum + scoreItemForScene(item, context.scene, context), 0)
    + scoreBenefit(primaryBenefit)
    + (candidate.items.some((item) => item.outfitRole === ROLE.OPTIONAL) ? 0.35 : 0);

  return {
    ...candidate,
    sceneIntent,
    primaryBenefit,
    secondaryBenefit: chooseSecondaryBenefit(primaryBenefit, capabilities, context),
    shoePurpose,
    observationFocus,
    rankingScore: Math.round(score * 100) / 100,
  };
}

function chooseSceneIntent(capabilities, candidate, context) {
  const scene = context.scene;
  if (scene === 'home') {
    const shoe = candidate.items.find((item) => item.outfitSlot === 'shoes');
    if (!shoe) return 'home:indoor_relax';
    const shoeCapabilities = shoe ? getItemCapabilities(shoe, context) : [];
    if (shoeCapabilities.includes('indoor')) return 'home:indoor_relax';
    if (capabilities.has('daily_outing') || capabilities.has('long_walk')) return 'home:quick_outing';
    return 'home:clean_daily';
  }
  if (scene === 'work') {
    if (candidate.items.some((item) => item.outfitRole === ROLE.FUNCTIONAL)) return 'work:layered';
    if (hasWorkRelaxedSignal(candidate.items, context) && capabilities.has('long_walk')) return 'work:walkable';
    if (hasWorkRelaxedSignal(candidate.items, context)) return 'work:relaxed';
    if (capabilities.has('commute')) return 'work:polished';
    return '';
  }
  if (scene === 'date') {
    if (hasHighlightSignal(candidate.items, context)) return 'date:highlight';
    if (hasSoftSignal(candidate.items, context)) return 'date:soft';
    if (capabilities.has('daily_outing')) return 'date:casual';
    return '';
  }
  if (scene === 'sport') {
    if (capabilities.has('formal_training')) return 'sport:training';
    if (capabilities.has('light_activity')) return 'sport:light_activity';
    if (capabilities.has('long_walk')) return 'sport:walk';
    if (candidate.items.some((item) => item.outfitRole === ROLE.FUNCTIONAL)) return 'sport:weather_ready';
    return '';
  }
  return 'home:clean_daily';
}

function isSceneEligible(candidate, scene) {
  if (scene === 'work') return isWorkEligible(candidate);
  if (scene === 'date') return isDateEligible(candidate);
  if (scene !== 'sport') return true;
  const coreApparel = candidate.items.filter((item) =>
    item.outfitRole === ROLE.CORE && ['top', 'bottom', 'skirt', 'onepiece'].includes(item.outfitSlot),
  );
  if (coreApparel.length === 0) return false;
  return coreApparel.every((item) => hasReliableSportSignal(item) && !isExplicitlyFormalWithoutSport(item));
}

function isWorkEligible(candidate) {
  const text = candidate.items.map(itemText).join(' ');
  const coreText = candidate.items
    .filter((item) => item.outfitRole === ROLE.CORE && item.outfitSlot !== 'shoes')
    .map(itemText)
    .join(' ');
  const hasPositive = /commute|formality|clean|structured|office|work|通勤|上班|衬衫|西裤|外套|利落|乐福|西装|风衣/i.test(text);
  if (!hasPositive) return false;
  if (/居家|家居|睡衣|拖鞋|短裤|沙滩|红色运动鞋/i.test(text) && !/衬衫|西裤|通勤|office|work|利落|structured|clean/i.test(coreText)) {
    return false;
  }
  return true;
}

function isDateEligible(candidate) {
  const text = candidate.items.map(itemText).join(' ');
  const coreText = candidate.items
    .filter((item) => item.outfitRole === ROLE.CORE)
    .map(itemText)
    .join(' ');
  const hasPositive = /soft|highlight|clean|date|约会|完整|裙|连衣裙|半裙|针织|柔|粉|甜|优雅|单鞋|亮/i.test(text);
  if (!hasPositive) return false;
  const onlyPlainDaily = /T恤|tee|短袖/i.test(coreText)
    && /短裤|shorts/i.test(coreText)
    && /运动鞋|sneaker/i.test(coreText)
    && !/约会|date|裙|针织|柔|粉|甜|优雅|亮|highlight|soft|clean/i.test(coreText);
  return !onlyPlainDaily;
}

function hasReliableSportSignal(item) {
  return /sport|sports|yoga|tennis|athletic|training|running|gym|运动|瑜伽|网球|训练|速干|跑步|健身|轻运动/i.test(itemText(item));
}

function isExplicitlyFormalWithoutSport(item) {
  if (hasReliableSportSignal(item)) return false;
  return /formal|office|work|blazer|suit|dress|skirt|heels|正装|正式|西装|衬衫|西裤|连衣裙|裙|高跟/i.test(itemText(item));
}

function hasWorkRelaxedSignal(items, context) {
  const text = items.map((item) => getItemText(item, context)).join(' ');
  return /牛仔|运动鞋|sneaker|daily|casual|休闲|日常/i.test(text)
    && /commute|通勤|上班|office|work|clean|利落/i.test(text);
}

function choosePrimaryBenefit(sceneIntent, capabilities, candidate, context) {
  if (sceneIntent === 'sport:training') return 'formal_training';
  if (sceneIntent === 'sport:light_activity') return 'light_activity';
  if (sceneIntent === 'sport:walk' || sceneIntent === 'work:walkable' || sceneIntent === 'home:quick_outing') return 'walkable';
  if (sceneIntent === 'work:layered' || candidate.items.some((item) => item.outfitRole === ROLE.FUNCTIONAL)) return 'temperature_buffer';
  if (sceneIntent === 'work:polished') return 'commute_polish';
  if (sceneIntent === 'date:soft') return 'soft_mood';
  if (sceneIntent === 'date:highlight') return 'clear_highlight';
  if (sceneIntent === 'date:casual' && capabilities.has('long_walk')) return 'walkable';
  if (sceneIntent === 'home:indoor_relax') return 'indoor_relax';
  if (context.tempBand === 'hot') return 'hot_weather';
  if (capabilities.has('accent')) return 'accent';
  return 'clean_daily';
}

function chooseSecondaryBenefit(primaryBenefit, capabilities, context) {
  if (context.hasUsableWeather && primaryBenefit !== 'temperature_buffer' && context.temp <= 20 && capabilities.has('layering')) return 'temperature_buffer';
  if (primaryBenefit !== 'walkable' && capabilities.has('long_walk')) return 'walkable';
  if (primaryBenefit !== 'hot_weather' && context.tempBand === 'hot') return 'hot_weather';
  return '';
}

function chooseShoePurpose(shoe, capabilities, scene, context) {
  if (!shoe) return '';
  const shoeCaps = getItemCapabilities(shoe, context);
  if (shoeCaps.includes('indoor')) return 'indoor';
  if (shoeCaps.includes('formal_training')) return 'training';
  if (shoeCaps.includes('long_walk')) return 'walkable';
  if (shoeCaps.includes('commute')) return 'commute';
  if (scene === 'date') return 'date';
  if (capabilities.has('daily_outing')) return 'daily_outing';
  return 'basic';
}

function chooseObservationFocus(candidate, context, shoePurpose = '') {
  if (candidate.items.some((item) => item.outfitRole === ROLE.OPTIONAL)) return 'accent';
  if (candidate.items.some((item) => item.outfitRole === ROLE.FUNCTIONAL)) return 'layering';
  if (context.tempBand === 'hot') return 'temperature';
  if (hasHighlightSignal(candidate.items, context)) return 'highlight';
  if (hasSoftSignal(candidate.items, context)) return 'softness';
  if (shoePurpose === 'walkable') return 'walkability';
  return candidate.structureType.includes('onepiece') ? 'onepiece' : 'base';
}

function diversifyCandidates(candidates, limit) {
  const results = [];
  const usedIds = [];
  const usedSceneIntents = new Set();
  const usedBenefitKeys = new Set();
  const usedShoeKeys = new Set();
  const usedAngles = new Set();
  const counts = createBatchCounts();
  const passes = [
    { relax: 'none', test: (candidate) => !usedSceneIntents.has(candidate.sceneIntent) && !isTooSimilarToUsed(candidate, usedIds) },
    { relax: 'none', test: (candidate) => !usedSceneIntents.has(candidate.sceneIntent) },
    { relax: 'none', test: (candidate) => !usedBenefitKeys.has(benefitKey(candidate)) && !isTooSimilarToUsed(candidate, usedIds) },
    { relax: 'none', test: (candidate) => !usedShoeKeys.has(shoeKey(candidate)) && !isTooSimilarToUsed(candidate, usedIds) },
    { relax: 'none', test: (candidate) => !usedAngles.has(angleKey(candidate)) && !isTooSimilarToUsed(candidate, usedIds) },
    { relax: 'none', test: (candidate) => !usedAngles.has(angleKey(candidate)) },
    { relax: 'archetype', test: (candidate) => !isTooSimilarToUsed(candidate, usedIds) },
    { relax: 'coreItems', test: (candidate) => !isTooSimilarToUsed(candidate, usedIds) },
  ];
  let limitedReason = '';
  for (const pass of passes) {
    for (const candidate of candidates) {
      if (results.length >= limit) break;
      if (results.some((entry) => signature(entry.items.map((item) => item._id)) === signature(candidate.items.map((item) => item._id)))) continue;
      if (!pass.test(candidate)) continue;
      if (!canUseWithBatchCaps(candidate, counts, pass.relax)) {
        if (!limitedReason) limitedReason = `relaxed_${pass.relax}_diversity`;
        continue;
      }
      const selected = withDistinctObservationFocus(candidate, usedAngles);
      results.push(selected);
      incrementBatchCounts(counts, selected);
      usedIds.push(selected.items.map((item) => item._id));
      usedSceneIntents.add(selected.sceneIntent);
      usedBenefitKeys.add(benefitKey(selected));
      usedShoeKeys.add(shoeKey(selected));
      usedAngles.add(angleKey(selected));
    }
    if (results.length >= limit) break;
  }
  results.batchDiagnostics = buildBatchDiagnostics(results, results.length < limit ? (limitedReason || 'limited_by_core_similarity') : '');
  return results;
}

function createBatchCounts() {
  return {
    top: {},
    bottom: {},
    shoes: {},
    archetype: {},
    sceneIntent: {},
  };
}

function canUseWithBatchCaps(candidate, counts, relax) {
  const relaxCore = relax === 'coreItems' || relax === 'all';
  const relaxArchetype = relax === 'archetype' || relaxCore;
  const relaxSceneIntent = false;
  if (!relaxCore) {
    if (wouldExceed(counts.top, slotId(candidate, 'top'), 3)) return false;
    if (wouldExceed(counts.bottom, slotId(candidate, 'bottom') || slotId(candidate, 'skirt') || slotId(candidate, 'onepiece'), 3)) return false;
    if (wouldExceed(counts.shoes, slotId(candidate, 'shoes'), 3)) return false;
  }
  if (!relaxArchetype && wouldExceed(counts.archetype, archetypeKey(candidate), 4)) return false;
  if (candidate.sceneIntent === 'home:quick_outing' && wouldExceed(counts.sceneIntent, candidate.sceneIntent, 2)) return false;
  if (!relaxSceneIntent && wouldExceed(counts.sceneIntent, candidate.sceneIntent, 3)) return false;
  return true;
}

function incrementBatchCounts(counts, candidate) {
  increment(counts.top, slotId(candidate, 'top'));
  increment(counts.bottom, slotId(candidate, 'bottom') || slotId(candidate, 'skirt') || slotId(candidate, 'onepiece'));
  increment(counts.shoes, slotId(candidate, 'shoes'));
  increment(counts.archetype, archetypeKey(candidate));
  increment(counts.sceneIntent, candidate.sceneIntent);
}

function buildBatchDiagnostics(results, limitedReason) {
  const counts = createBatchCounts();
  const angleCounts = {};
  for (const candidate of results) {
    incrementBatchCounts(counts, candidate);
    increment(angleCounts, candidate.observationFocus || 'base');
  }
  return {
    itemReuse: {
      top: counts.top,
      bottom: counts.bottom,
      shoes: counts.shoes,
    },
    archetypeCounts: counts.archetype,
    sceneIntentCounts: counts.sceneIntent,
    angleCounts,
    limitedReason: limitedReason || '',
  };
}

function slotId(candidate, slot) {
  return candidate.items.find((item) => item.outfitSlot === slot)?._id || '';
}

function archetypeKey(candidate) {
  return [candidate.structureType, candidate.primaryBenefit].filter(Boolean).join('|') || candidate.structureType || 'outfit';
}

function wouldExceed(counts, key, limit) {
  if (!key) return false;
  return (counts[key] || 0) + 1 > limit;
}

function increment(counts, key) {
  if (!key) return;
  counts[key] = (counts[key] || 0) + 1;
}

function getSceneLimitedReason(scene, rawCandidates, scored) {
  if (scored.length > 0) return '';
  if (scene === 'work' && rawCandidates.length === 0) return 'work_scene_eligible_no_candidate';
  if (scene === 'date' && rawCandidates.length === 0) return 'date_scene_eligible_no_candidate';
  if (scene === 'sport' && rawCandidates.length === 0) return 'sport_scene_eligible_no_candidate';
  return '';
}

function withDistinctObservationFocus(candidate, usedAngles) {
  if (!usedAngles.has(angleKey(candidate))) return candidate;
  for (const focus of observationFocusAlternates(candidate)) {
    const next = { ...candidate, observationFocus: focus };
    if (!usedAngles.has(angleKey(next))) return next;
  }
  return candidate;
}

function observationFocusAlternates(candidate) {
  const base = candidate.observationFocus || 'base';
  const hasSkirt = candidate.items.some((item) => item.outfitSlot === 'skirt');
  const hasBottom = candidate.items.some((item) => item.outfitSlot === 'bottom');
  const hasOnepiece = candidate.items.some((item) => item.outfitSlot === 'onepiece');
  return [
    hasOnepiece ? `${base}_onepiece` : '',
    hasSkirt ? `${base}_skirt` : '',
    hasBottom ? `${base}_bottom` : '',
    candidate.structureType ? `${base}_${candidate.structureType}` : '',
  ].filter(Boolean);
}

function benefitKey(candidate) {
  return [candidate.sceneIntent, candidate.primaryBenefit].join('|');
}

function shoeKey(candidate) {
  return [candidate.sceneIntent, candidate.primaryBenefit, candidate.shoePurpose].join('|');
}

function angleKey(candidate) {
  return [candidate.sceneIntent, candidate.primaryBenefit, candidate.shoePurpose, candidate.observationFocus].join('|');
}

function isTooSimilarToUsed(candidate, usedIds) {
  const ids = candidate.items.map((item) => item._id);
  return usedIds.some((existing) => overlapRatio(existing, ids) > 0.5);
}

function compareCandidates(a, b) {
  if (b.rankingScore !== a.rankingScore) return b.rankingScore - a.rankingScore;
  return signature(a.items.map((item) => item._id)).localeCompare(signature(b.items.map((item) => item._id)));
}

function scoreSceneIntent(sceneIntent, scene) {
  if (!sceneIntent) return -100;
  const family = sceneIntent.split(':')[0];
  return family === scene ? 8 : 0;
}

function scoreWeatherFit(candidate, context) {
  if (!context.hasUsableWeather) return 0;
  const hasOuterwear = candidate.items.some((item) => item.outfitSlot === 'outerwear');
  if ((context.tempBand === 'hot' || context.tempBand === 'warm') && hasOuterwear) return -20;
  if ((context.tempBand === 'cold' || context.tempBand === 'cool') && hasOuterwear) return 3;
  return 1;
}

function scoreBenefit(benefit) {
  const scores = {
    formal_training: 4,
    commute_polish: 3,
    temperature_buffer: 3,
    walkable: 1.8,
    indoor_relax: 3.2,
    soft_mood: 2.2,
    clear_highlight: 2.1,
    light_activity: 2,
    hot_weather: 2,
    accent: 1.4,
    clean_daily: 1,
  };
  return scores[benefit] || 0;
}

function scoreItemForScene(item, scene, context) {
  const sceneTags = readStringArray(item.sceneTags);
  const text = getItemText(item, context);
  let score = 0;
  if (sceneTags.includes(sceneLabel(scene)) || sceneTags.includes(scene)) score += 4;
  if (scene === 'work' && /通勤|上班|西裤|衬衫|乐福|西装|风衣|blazer|office|work/i.test(text)) score += 3;
  if (scene === 'work' && /短裤|居家|家居|睡衣|拖鞋|红色运动鞋/i.test(text)) score -= 6;
  if (scene === 'date' && /约会|半裙|连衣裙|针织|单鞋|粉|红|亮|柔|甜|优雅/i.test(text)) score += 3;
  if (scene === 'date' && /短裤|训练|速干|跑步|gym|training/i.test(text)) score -= 5;
  if (scene === 'home' && /居家|室内|家居|休闲|宽松/i.test(text)) score += 3;
  if (scene === 'sport' && /运动|训练|跑步|瑜伽|速干|training|running|sport/i.test(text)) score += 3;
  return score;
}

function deriveItemCapabilitiesV1(item, precomputed = {}) {
  const text = typeof precomputed.itemText === 'string' ? precomputed.itemText : itemText(item);
  const category = precomputed.normalizedCategory || normalizeCategory(item, text);
  const capabilities = new Set();
  if (/室内|居家|家居|home|indoor/i.test(text)) capabilities.add('indoor');
  if (/日常|休闲|T恤|牛仔|出游|逛街|daily|casual/i.test(text)) capabilities.add('daily_outing');
  if (/运动鞋|跑步鞋|徒步|走路|通勤鞋|乐福|sneaker|walking|running/i.test(text)) capabilities.add('long_walk');
  if (/通勤|上班|衬衫|西裤|乐福|西装|风衣|blazer|office|work/i.test(text)) capabilities.add('commute');
  if (/利落|clean|structured|直筒|挺括|简洁/i.test(text)) capabilities.add('structured');
  if (/约会|半裙|连衣裙|针织|单鞋|粉|红|甜|优雅|date/i.test(text)) capabilities.add('date');
  if (/轻运动|运动鞋|瑜伽|散步|休闲运动|light/i.test(text)) capabilities.add('light_activity');
  if (category === 'top' && /t恤|t-shirt|tee|背心|vest|卫衣|hoodie|sweatshirt/i.test(text)) capabilities.add('light_activity');
  if (category === 'bottom' && /束脚|jogger|运动裤|卫裤|sweatpants|training|sport|跑步|训练/i.test(text)) capabilities.add('light_activity');
  if (/训练|跑步|速干|健身|瑜伽裤|跑步鞋|training|running|gym/i.test(text)) capabilities.add('formal_training');
  if (/短袖|短裤|背心|凉感|薄|棉|麻|透气|summer|hot/i.test(text)) capabilities.add('hot_weather');
  if (/厚|羊毛|羽绒|毛呢|保暖|冷|winter|coat|down/i.test(text)) capabilities.add('cold_weather');
  if (category === 'outerwear' || /外套|风衣|夹克|开衫|西装|layer|jacket|coat|cardigan/i.test(text)) capabilities.add('layering');
  if (category === 'accessory' || /包|帽|项链|耳环|腰带|配饰|亮色|红|金|银|accent/i.test(text)) capabilities.add('accent');
  if (category === 'shoes' && capabilities.size === 0) capabilities.add('daily_outing');
  if (category === 'top' || category === 'bottom' || category === 'skirt' || category === 'onepiece') capabilities.add('clean_daily');
  return Array.from(capabilities).sort();
}

function groupClothesByCapability(clothes, context) {
  const groups = { top: [], outerwear: [], bottom: [], skirt: [], onepiece: [], shoes: [], accessory: [], other: [] };
  for (const item of clothes) {
    const category = getNormalizedCategory(item, context);
    if (!isHardValidCoreItem(item, category, context)) continue;
    if (groups[category]) groups[category].push(item);
    else groups.other.push(item);
  }
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => getDisplayName(a).localeCompare(getDisplayName(b)) || String(a._id).localeCompare(String(b._id)));
  }
  return groups;
}

function isHardValidCoreItem(item, category, context) {
  const text = getItemText(item, context).toLowerCase();
  const invalidOutdoorHomeShoe = category === 'shoes'
    && /长靴|靴|高跟|boot|heel/.test(text);
  if (context.scene === 'home' && invalidOutdoorHomeShoe) return false;

  if ((context.scene === 'work' || context.scene === 'date') && category === 'shoes'
    && /拖鞋|洞洞鞋|slipper|crocs/.test(text)) return false;

  if (context.scene === 'sport') {
    if (category === 'shoes') {
      return /运动鞋|跑步鞋|训练鞋|休闲运动鞋|sneaker|running|training|trainer/.test(text)
        && !/拖鞋|洞洞鞋|高跟|长靴|靴|slipper|crocs|heel|boot/.test(text);
    }
    if (category === 'top') {
      return /t恤|t-shirt|tee|背心|vest|卫衣|hoodie|sweatshirt|运动|训练|跑步|瑜伽|网球|sport|training|running|athletic|yoga|tennis/.test(text);
    }
    if (category === 'bottom') {
      return /短裤|shorts|束脚|jogger|运动裤|卫裤|sweatpants|training|sport|跑步|训练/.test(text);
    }
    if (category === 'onepiece') return /网球|运动|tennis|athletic/.test(text);
    if (category === 'skirt') return false;
  }
  return true;
}

function normalizeCategory(item, precomputedText = '') {
  const text = (typeof precomputedText === 'string' && precomputedText ? precomputedText : itemText(item)).toLowerCase();
  const raw = readString(item?.category).toLowerCase();
  if (raw === 'onepiece' || /连衣裙|连体|onepiece|dress|jumpsuit/.test(text)) return 'onepiece';
  if (raw === 'shoes' || /鞋|靴|sneaker|loafer|shoe|boots/.test(text)) return 'shoes';
  if (raw === 'accessory' || /包|帽|项链|耳环|腰带|配饰|accessory|bag|hat/.test(text)) return 'accessory';
  if (raw === 'bottom' && /裙|skirt/.test(text)) return 'skirt';
  if (raw === 'skirt') return 'skirt';
  if (raw === 'bottom' || /裤|半裙|下装|pants|trouser|jeans|skirt/.test(text)) return 'bottom';
  if (raw === 'outerwear' || /外套|风衣|夹克|开衫|西装|羽绒|coat|jacket|cardigan|blazer/.test(text)) return 'outerwear';
  if (raw === 'top' || /上衣|衬衫|T恤|针织|卫衣|shirt|tee|sweater/.test(text)) return 'top';
  return raw || 'other';
}

function createCompositionItemFacts(item, instrumentation) {
  recordMetric(instrumentation, 'compositionItemText');
  const text = itemText(item);
  const normalizedCategory = normalizeCategory(item, text);
  return {
    itemText: text,
    normalizedCategory,
    capabilities: deriveItemCapabilitiesV1(item, { itemText: text, normalizedCategory }),
  };
}

function recordMetric(instrumentation, name) {
  if (!instrumentation || typeof instrumentation !== 'object') return;
  const counters = instrumentation.counters && typeof instrumentation.counters === 'object'
    ? instrumentation.counters
    : instrumentation;
  counters[name] = (Number(counters[name]) || 0) + 1;
}

function getContextItemFacts(item, context) {
  const resolver = context?.itemFactsContext?.resolveItemFacts;
  return typeof resolver === 'function' ? resolver.call(context.itemFactsContext, item) : null;
}

function getItemCapabilities(item, context) {
  const facts = getContextItemFacts(item, context);
  return Array.isArray(facts?.capabilities) ? facts.capabilities : deriveItemCapabilitiesV1(item);
}

function getNormalizedCategory(item, context) {
  const facts = getContextItemFacts(item, context);
  return facts?.compositionFacts?.normalizedCategory || normalizeCategory(item);
}

function getItemText(item, context) {
  const facts = getContextItemFacts(item, context);
  return typeof facts?.compositionFacts?.itemText === 'string' ? facts.compositionFacts.itemText : itemText(item);
}

function matchesTemperature(item, tempBand, context) {
  const capabilities = getItemCapabilities(item, context);
  const category = getNormalizedCategory(item, context);
  if ((tempBand === 'hot' || tempBand === 'warm') && capabilities.includes('cold_weather') && category === 'outerwear') return false;
  if (Number(context?.temp) >= 26 && capabilities.includes('cold_weather') && !capabilities.includes('hot_weather')
    && ['top', 'bottom', 'onepiece', 'outerwear'].includes(category)) return false;
  if ((tempBand === 'cold' || tempBand === 'cool') && capabilities.includes('hot_weather') && !capabilities.includes('layering')) return false;
  return true;
}

function hasSoftSignal(items, context) {
  return items.some((item) => /粉|白|米|针织|半裙|柔|甜|优雅|soft/i.test(getItemText(item, context)));
}

function hasHighlightSignal(items, context) {
  return items.some((item) => /红|亮|印花|图案|金|银|highlight|print/i.test(getItemText(item, context)));
}

function normalizeConfidence(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value === 'high') return 0.9;
  if (value === 'medium') return 0.7;
  if (value === 'low') return 0.3;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return number > 1 ? number / 100 : number;
}

function normalizeCompositionWeather(weather, rawWeatherMode) {
  const source = weather && typeof weather === 'object' && !Array.isArray(weather) ? weather : {};
  const suppliedTemperature = source.temp ?? source.temperature;
  const temperature = Number.isFinite(suppliedTemperature) ? suppliedTemperature : null;
  const explicitMode = readString(rawWeatherMode || source.mode || source.weatherMode).toLowerCase();
  let weatherMode = ['live', 'cached', 'disabled', 'unavailable'].includes(explicitMode)
    ? explicitMode
    : temperature === null ? 'unavailable' : 'live';
  if (['live', 'cached'].includes(weatherMode) && temperature === null) weatherMode = 'unavailable';
  const hasUsableWeather = ['live', 'cached'].includes(weatherMode)
    && Number.isFinite(temperature);
  return {
    weatherMode,
    hasUsableWeather,
    temperature: hasUsableWeather ? temperature : null,
    temperatureBand: hasUsableWeather ? getTemperatureBand(temperature) : '',
    weather: hasUsableWeather
      ? {
          ...source,
          mode: weatherMode,
          weatherMode,
          temp: temperature,
          temperature,
        }
      : {
          mode: weatherMode,
          weatherMode,
          temp: null,
          temperature: null,
          humidity: null,
          weather: null,
          condition: null,
        },
  };
}

function getTemperatureBand(temp) {
  if (temp < 12) return 'cold';
  if (temp < 22) return 'cool';
  if (temp < 29) return 'mild';
  if (temp < 32) return 'warm';
  return 'hot';
}

function normalizeScene(value) {
  const raw = readString(value).toLowerCase();
  if (['home', '居家'].includes(raw)) return 'home';
  if (['work', '上班', '通勤', '正式'].includes(raw)) return 'work';
  if (['date', '约会'].includes(raw)) return 'date';
  if (['sport', 'sports', '运动'].includes(raw)) return 'sport';
  return raw || 'home';
}

function sceneLabel(scene) {
  return { home: '居家', work: '上班', date: '约会', sport: '运动' }[scene] || scene;
}

function getDisplayName(item) {
  return readString(item?.customName || item?.displayName || item?.subCategory || item?.subcategory || item?.name || item?.category) || '单品';
}

function normalizeColors(item) {
  if (Array.isArray(item?.colorPalette) && item.colorPalette.length > 0) return item.colorPalette;
  return readStringArray(item?.colors).map((name) => ({ name, hex: '' }));
}

function itemText(item) {
  return [
    item?.category,
    item?.subcategory,
    item?.subCategory,
    item?.customName,
    item?.name,
    item?.material,
    item?.thickness,
    ...readStringArray(item?.styleTags),
    ...readStringArray(item?.sceneTags),
    ...normalizeColors(item).map((color) => color.name),
  ].filter(Boolean).join(' ');
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()) : [];
}

function signature(ids) {
  return ids.slice().sort().join('_');
}

function overlapRatio(a, b) {
  const set = new Set(a);
  return b.filter((id) => set.has(id)).length / Math.max(b.length, 1);
}

module.exports = {
  OUTFIT_COMPOSITION_VERSION,
  SCENE_INTENTS,
  buildOutfitCandidatesV1,
  createCompositionItemFacts,
  deriveItemCapabilitiesV1,
  isSceneEligible,
};
