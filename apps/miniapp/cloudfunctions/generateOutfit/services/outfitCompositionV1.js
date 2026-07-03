const OUTFIT_COMPOSITION_VERSION = 'outfit-composition-v1';

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
  maxResults = 8,
  excludedOutfitKeys = [],
  excludeClothingIdSets = [],
  recommendationProfile = {},
} = {}) {
  const temp = readTemperature(weather);
  const tempBand = getTemperatureBand(temp);
  const normalizedScene = normalizeScene(scene);
  const excluded = new Set([
    ...(Array.isArray(excludeClothingIdSets) ? excludeClothingIdSets : []).filter(Array.isArray).map(signature),
    ...readStringArray(excludedOutfitKeys),
  ]);
  const groups = groupClothesByCapability(
    (Array.isArray(clothes) ? clothes : [])
      .filter((item) => item && item._id)
      .filter((item) => matchesTemperature(item, tempBand)),
  );
  const rawCandidates = [
    ...buildOnepieceCandidates(groups, { temp, tempBand, scene: normalizedScene }),
    ...buildSeparateCandidates(groups, { temp, tempBand, scene: normalizedScene }),
  ]
    .filter((candidate) => candidate.items.length >= 2 && candidate.items.length <= 5)
    .filter((candidate) => !excluded.has(signature(candidate.items.map((item) => item._id))));

  const scored = rawCandidates
    .map((candidate) => scoreCompositionCandidate(candidate, {
      scene: normalizedScene,
      temp,
      tempBand,
      weather,
      recommendationProfile,
    }))
    .filter((candidate) => candidate.sceneIntent)
    .sort(compareCandidates);

  const limit = Math.min(Math.max(Number(maxResults || 8), 1), 8);
  const results = diversifyCandidates(scored, limit);
  results.debug = {
    candidateCount: rawCandidates.length,
    filteredCandidateCount: scored.length,
  };
  results.limited = results.length < limit || scored.length < limit;
  results.exhausted = scored.length === 0 && excluded.size > 0;
  return results;
}

function buildOnepieceCandidates(groups, context) {
  const candidates = [];
  for (const dress of groups.onepiece) {
    for (const shoe of groups.shoes) {
      const base = withRoles([dress, shoe], { [dress._id]: ROLE.CORE, [shoe._id]: ROLE.CORE });
      candidates.push(createCandidate(base, 'onepiece_shoes'));
      for (const coat of chooseOuterwear(groups.outerwear, base, context)) {
        candidates.push(createCandidate(withRoles([dress, coat, shoe], {
          [dress._id]: ROLE.CORE,
          [coat._id]: ROLE.FUNCTIONAL,
          [shoe._id]: ROLE.CORE,
        }), 'onepiece_shoes_layered'));
      }
      for (const accessory of chooseAccessories(groups.accessory, base, context)) {
        candidates.push(createCandidate(withRoles([dress, shoe, accessory], {
          [dress._id]: ROLE.CORE,
          [shoe._id]: ROLE.CORE,
          [accessory._id]: ROLE.OPTIONAL,
        }), 'onepiece_shoes_accessory'));
      }
    }
  }
  return candidates;
}

function buildSeparateCandidates(groups, context) {
  const candidates = [];
  const bottoms = [...groups.bottom, ...groups.skirt];
  for (const top of groups.top) {
    for (const bottom of bottoms) {
      for (const shoe of groups.shoes) {
        const base = withRoles([top, bottom, shoe], {
          [top._id]: ROLE.CORE,
          [bottom._id]: ROLE.CORE,
          [shoe._id]: ROLE.CORE,
        });
        candidates.push(createCandidate(base, 'separates_shoes'));
        for (const coat of chooseOuterwear(groups.outerwear, base, context)) {
          candidates.push(createCandidate(withRoles([top, bottom, coat, shoe], {
            [top._id]: ROLE.CORE,
            [bottom._id]: ROLE.CORE,
            [coat._id]: ROLE.FUNCTIONAL,
            [shoe._id]: ROLE.CORE,
          }), 'separates_shoes_layered'));
        }
        for (const accessory of chooseAccessories(groups.accessory, base, context)) {
          candidates.push(createCandidate(withRoles([top, bottom, shoe, accessory], {
            [top._id]: ROLE.CORE,
            [bottom._id]: ROLE.CORE,
            [shoe._id]: ROLE.CORE,
            [accessory._id]: ROLE.OPTIONAL,
          }), 'separates_shoes_accessory'));
        }
      }
    }
  }
  return candidates;
}

function createCandidate(items, structureType) {
  return {
    compositionVersion: OUTFIT_COMPOSITION_VERSION,
    structureType,
    items,
    outfitItemRoles: items.map((item) => ({
      id: item._id,
      slot: item.outfitSlot,
      role: item.outfitRole,
      displayName: getDisplayName(item),
    })),
  };
}

function withRoles(items, roleById) {
  return items.map((item) => ({
    ...item,
    outfitSlot: normalizeCategory(item),
    outfitRole: roleById[item._id] || ROLE.CORE,
    capabilities: deriveItemCapabilitiesV1(item),
  }));
}

function chooseOuterwear(outerwear, baseItems, context) {
  if (context.tempBand === 'hot' || context.tempBand === 'warm') return [];
  const needsLayer = context.temp <= 20
    || (context.scene === 'work' && context.temp <= 24)
    || baseItems.some((item) => deriveItemCapabilitiesV1(item).includes('layering'));
  if (!needsLayer) return [];
  return outerwear
    .filter((item) => deriveItemCapabilitiesV1(item).includes('layering') || deriveItemCapabilitiesV1(item).includes('cold_weather') || context.scene === 'work')
    .sort((a, b) => scoreItemForScene(b, context.scene) - scoreItemForScene(a, context.scene))
    .slice(0, 6);
}

function chooseAccessories(accessories, baseItems, context) {
  const baseColors = new Set(baseItems.flatMap((item) => normalizeColors(item).map((color) => color.name)));
  return accessories
    .filter((item) => isReliable(item))
    .filter((item) => {
      const capabilities = deriveItemCapabilitiesV1(item);
      if (!capabilities.includes('accent')) return false;
      if (context.scene === 'home' || context.scene === 'sport') return false;
      const colors = normalizeColors(item).map((color) => color.name).filter(Boolean);
      return colors.some((color) => !baseColors.has(color)) || scoreItemForScene(item, context.scene) > 0;
    })
    .sort((a, b) => scoreItemForScene(b, context.scene) - scoreItemForScene(a, context.scene))
    .slice(0, 4);
}

function scoreCompositionCandidate(candidate, context) {
  const capabilities = new Set(candidate.items.flatMap((item) => deriveItemCapabilitiesV1(item)));
  const sceneIntent = chooseSceneIntent(capabilities, candidate, context);
  const primaryBenefit = choosePrimaryBenefit(sceneIntent, capabilities, candidate, context);
  const shoe = candidate.items.find((item) => item.outfitSlot === 'shoes');
  const shoePurpose = chooseShoePurpose(shoe, capabilities, context.scene);
  const observationFocus = chooseObservationFocus(candidate, context, shoePurpose);
  const score = scoreSceneIntent(sceneIntent, context.scene)
    + scoreWeatherFit(candidate, context)
    + candidate.items.reduce((sum, item) => sum + scoreItemForScene(item, context.scene), 0)
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
    const shoeCapabilities = shoe ? deriveItemCapabilitiesV1(shoe) : [];
    if (shoeCapabilities.includes('indoor')) return 'home:indoor_relax';
    if (capabilities.has('daily_outing') || capabilities.has('long_walk')) return 'home:quick_outing';
    return 'home:clean_daily';
  }
  if (scene === 'work') {
    if (candidate.items.some((item) => item.outfitRole === ROLE.FUNCTIONAL)) return 'work:layered';
    if (capabilities.has('commute') && capabilities.has('long_walk')) return 'work:walkable';
    if (capabilities.has('commute')) return 'work:polished';
    if (capabilities.has('daily_outing')) return 'work:relaxed';
    return '';
  }
  if (scene === 'date') {
    if (hasHighlightSignal(candidate.items)) return 'date:highlight';
    if (hasSoftSignal(candidate.items)) return 'date:soft';
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
  if (primaryBenefit !== 'temperature_buffer' && context.temp <= 20 && capabilities.has('layering')) return 'temperature_buffer';
  if (primaryBenefit !== 'walkable' && capabilities.has('long_walk')) return 'walkable';
  if (primaryBenefit !== 'hot_weather' && context.tempBand === 'hot') return 'hot_weather';
  return '';
}

function chooseShoePurpose(shoe, capabilities, scene) {
  if (!shoe) return '';
  const shoeCaps = deriveItemCapabilitiesV1(shoe);
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
  if (hasHighlightSignal(candidate.items)) return 'highlight';
  if (hasSoftSignal(candidate.items)) return 'softness';
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
  const passes = [
    (candidate) => !usedSceneIntents.has(candidate.sceneIntent) && !isTooSimilarToUsed(candidate, usedIds),
    (candidate) => !usedSceneIntents.has(candidate.sceneIntent),
    (candidate) => !usedBenefitKeys.has(benefitKey(candidate)) && !isTooSimilarToUsed(candidate, usedIds),
    (candidate) => !usedShoeKeys.has(shoeKey(candidate)) && !isTooSimilarToUsed(candidate, usedIds),
    (candidate) => !usedAngles.has(angleKey(candidate)) && !isTooSimilarToUsed(candidate, usedIds),
    (candidate) => !usedAngles.has(angleKey(candidate)),
    (candidate) => !isTooSimilarToUsed(candidate, usedIds),
    () => true,
  ];
  for (const pass of passes) {
    for (const candidate of candidates) {
      if (results.length >= limit) break;
      if (results.some((entry) => signature(entry.items.map((item) => item._id)) === signature(candidate.items.map((item) => item._id)))) continue;
      if (!pass(candidate)) continue;
      const selected = withDistinctObservationFocus(candidate, usedAngles);
      results.push(selected);
      usedIds.push(selected.items.map((item) => item._id));
      usedSceneIntents.add(selected.sceneIntent);
      usedBenefitKeys.add(benefitKey(selected));
      usedShoeKeys.add(shoeKey(selected));
      usedAngles.add(angleKey(selected));
    }
    if (results.length >= limit) break;
  }
  return results;
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
    walkable: 2.6,
    indoor_relax: 2.4,
    soft_mood: 2.2,
    clear_highlight: 2.1,
    light_activity: 2,
    hot_weather: 2,
    accent: 1.4,
    clean_daily: 1,
  };
  return scores[benefit] || 0;
}

function scoreItemForScene(item, scene) {
  const sceneTags = readStringArray(item.sceneTags);
  const text = itemText(item);
  let score = 0;
  if (sceneTags.includes(sceneLabel(scene)) || sceneTags.includes(scene)) score += 4;
  if (scene === 'work' && /通勤|上班|西裤|衬衫|乐福|西装|风衣|blazer|office|work/i.test(text)) score += 3;
  if (scene === 'date' && /约会|半裙|连衣裙|针织|单鞋|粉|红|亮|柔|甜|优雅/i.test(text)) score += 3;
  if (scene === 'home' && /居家|室内|家居|休闲|宽松/i.test(text)) score += 3;
  if (scene === 'sport' && /运动|训练|跑步|瑜伽|速干|training|running|sport/i.test(text)) score += 3;
  return score;
}

function deriveItemCapabilitiesV1(item) {
  const text = itemText(item);
  const category = normalizeCategory(item);
  const capabilities = new Set();
  if (/室内|居家|家居|home|indoor/i.test(text)) capabilities.add('indoor');
  if (/日常|休闲|T恤|牛仔|出游|逛街|daily|casual/i.test(text)) capabilities.add('daily_outing');
  if (/运动鞋|跑步鞋|徒步|走路|通勤鞋|乐福|sneaker|walking|running/i.test(text)) capabilities.add('long_walk');
  if (/通勤|上班|衬衫|西裤|乐福|西装|风衣|blazer|office|work/i.test(text)) capabilities.add('commute');
  if (/约会|半裙|连衣裙|针织|单鞋|粉|红|甜|优雅|date/i.test(text)) capabilities.add('date');
  if (/轻运动|运动鞋|瑜伽|散步|休闲运动|light/i.test(text)) capabilities.add('light_activity');
  if (/训练|跑步|速干|健身|瑜伽裤|跑步鞋|training|running|gym/i.test(text)) capabilities.add('formal_training');
  if (/短袖|短裤|背心|凉感|薄|棉|麻|透气|summer|hot/i.test(text)) capabilities.add('hot_weather');
  if (/厚|羊毛|羽绒|毛呢|保暖|冷|winter|coat|down/i.test(text)) capabilities.add('cold_weather');
  if (category === 'outerwear' || /外套|风衣|夹克|开衫|西装|layer|jacket|coat|cardigan/i.test(text)) capabilities.add('layering');
  if (category === 'accessory' || /包|帽|项链|耳环|腰带|配饰|亮色|红|金|银|accent/i.test(text)) capabilities.add('accent');
  if (category === 'shoes' && capabilities.size === 0) capabilities.add('daily_outing');
  if (category === 'top' || category === 'bottom' || category === 'skirt' || category === 'onepiece') capabilities.add('clean_daily');
  return Array.from(capabilities).sort();
}

function groupClothesByCapability(clothes) {
  const groups = { top: [], outerwear: [], bottom: [], skirt: [], onepiece: [], shoes: [], accessory: [], other: [] };
  for (const item of clothes) {
    const category = normalizeCategory(item);
    if (groups[category]) groups[category].push(item);
    else groups.other.push(item);
  }
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => getDisplayName(a).localeCompare(getDisplayName(b)) || String(a._id).localeCompare(String(b._id)));
  }
  return groups;
}

function normalizeCategory(item) {
  const text = itemText(item).toLowerCase();
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

function matchesTemperature(item, tempBand) {
  const capabilities = deriveItemCapabilitiesV1(item);
  if ((tempBand === 'hot' || tempBand === 'warm') && capabilities.includes('cold_weather') && normalizeCategory(item) === 'outerwear') return false;
  if ((tempBand === 'cold' || tempBand === 'cool') && capabilities.includes('hot_weather') && !capabilities.includes('layering')) return false;
  return true;
}

function hasSoftSignal(items) {
  return items.some((item) => /粉|白|米|针织|半裙|柔|甜|优雅|soft/i.test(itemText(item)));
}

function hasHighlightSignal(items) {
  return items.some((item) => /红|亮|印花|图案|金|银|highlight|print/i.test(itemText(item)));
}

function isReliable(item) {
  const confidence = normalizeConfidence(item.confidence ?? item.aiConfidence ?? item.recognitionConfidence);
  return confidence === null || confidence >= 0.55;
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

function readTemperature(weather) {
  const temp = Number(weather?.temp ?? weather?.temperature);
  return Number.isFinite(temp) ? temp : 22;
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
  deriveItemCapabilitiesV1,
};
