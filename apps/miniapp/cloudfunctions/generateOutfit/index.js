const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const DELETED_STATUS = 'deleted';

exports.main = async (event = {}) => {
  try {
    const action = event.action || 'generate';
    if (action === 'detail') return ok(await getOutfit(event.id));
    if (action === 'favorite') return ok(await updateFavorite(event.id, Boolean(event.isFavorite), event.outfit));
    if (action === 'wear') return ok(await confirmWear(event.id, event.date, event.outfit));
    if (action === 'list') return ok(await listOutfits(event));

    return ok(await generate(event));
  } catch (error) {
    console.error('[generateOutfit] failed', error);
    return fail(error);
  }
};

async function generate(event) {
  const { OPENID } = cloud.getWXContext();
  const scene = event.scene || '居家';
  const targetDate = event.date || new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const clothesRes = await db.collection('clothes').where({ _openid: OPENID, status: 'active' }).limit(100).get();
  const clothes = clothesRes.data;
  const userRes = await db.collection('users').where({ _openid: OPENID }).limit(1).get();
  const recommendationProfile = normalizeRecommendationProfile(userRes.data[0] && userRes.data[0].styleProfile);
  const exclude = Array.isArray(event.excludeClothingIdSets) ? event.excludeClothingIdSets : [];
  const weather = normalizeWeather(event.weather) || fallbackWeather();
  const recommendations = generateRuleRecommendations({
    clothes,
    scene,
    weather,
    recommendationProfile,
    excludeClothingIdSets: exclude,
    maxResults: 3,
  });
  const recommendationNotice = getRecommendationNotice(clothes, weather, recommendations.length);

  if (recommendations.length === 0) {
    return { outfits: [], weather, recommendationNotice };
  }

  const outfits = recommendations.map((recommendation) =>
    toTempOutfit(recommendation, {
      openid: OPENID,
      scene,
      targetDate,
      timeOfDay: event.timeOfDay || 'all_day',
      weather,
      now,
    }),
  );
  return { outfits: outfits.slice(0, 3), weather, recommendationNotice };
}

async function getOutfit(id) {
  const { OPENID } = cloud.getWXContext();
  if (!id) throw new Error('id is required');
  const outfit = await db.collection('outfits').doc(id).get();
  if (!outfit.data || outfit.data._openid !== OPENID) throw new Error('outfit not found');
  const clothes = await loadClothesByIds(OPENID, outfit.data.clothingIds || []);
  return toOutfit(outfit.data, clothes);
}

async function updateFavorite(id, isFavorite, outfitPayload) {
  const now = new Date().toISOString();
  if (!isFavorite) {
    const outfit = await assertOutfitOwner(id);
    await db.collection('outfits').doc(id).update({
      data: { isFavorite: false, favoritedAt: null, updatedAt: now },
    });
    return toOutfit(
      { ...outfit, isFavorite: false, favoritedAt: null, updatedAt: now },
      await loadClothesByIds(outfit._openid, outfit.clothingIds || []),
    );
  }

  return saveFavoriteOutfit(id, outfitPayload);
}

async function confirmWear(id, date, outfitPayload) {
  const { OPENID } = cloud.getWXContext();
  const now = new Date().toISOString();
  const targetDate = date || now.slice(0, 10);
  const saved = await saveWornOutfit(id, outfitPayload, targetDate);

  const ids = saved.clothingIds || [];
  if (!saved._alreadyWornToday) {
    await Promise.all(
      ids.map((clothingId) =>
        db.collection('clothes').doc(clothingId).update({
          data: { usageCount: db.command.inc(1), wearCount: db.command.inc(1), lastWornAt: now, updatedAt: now },
        }).catch((error) => {
          console.warn('[generateOutfit] skip usage update for missing clothing', {
            clothingId,
            message: error && error.message ? error.message : String(error || 'unknown error'),
          });
        }),
      ),
    );

    await db.collection('feedback').add({
      data: {
        _openid: OPENID,
        type: 'wear_confirm',
        outfitId: saved.id,
        clothingIds: ids,
        wearDate: targetDate,
        scene: saved.scene,
        source: 'recommend',
        createdAt: now,
      },
    });
  }

  delete saved._alreadyWornToday;

  return saved;
}

async function listOutfits(event) {
  const { OPENID } = cloud.getWXContext();
  const page = Math.max(Number(event.page || 1), 1);
  const pageSize = Math.min(Math.max(Number(event.pageSize || 10), 1), 50);
  const filter = { _openid: OPENID };
  if (event.isFavorite === true) filter.isFavorite = true;

  const collection = db.collection('outfits');
  const listRes = await collection
    .where(filter)
    .orderBy('createdAt', 'desc')
    .limit(500)
    .get();
  const filteredList = shouldListWorn(event)
    ? listRes.data.filter((item) => item.wornAt)
    : listRes.data;
  const pageList = filteredList.slice((page - 1) * pageSize, page * pageSize);
  const allIds = Array.from(new Set(pageList.flatMap((item) => item.clothingIds || [])));
  const clothes = await loadClothesByIds(OPENID, allIds);
  const clothesMap = new Map(clothes.map((item) => [item._id, item]));

  return {
    list: pageList.map((outfit) =>
      toOutfit(
        outfit,
        (outfit.clothingIds || []).map((id) => clothesMap.get(id)).filter(Boolean),
      ),
    ),
    pagination: {
      total: filteredList.length,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(filteredList.length / pageSize)),
    },
  };
}

function shouldListWorn(event) {
  return event.wornOnly === true;
}

async function assertOutfitOwner(id) {
  const { OPENID } = cloud.getWXContext();
  if (!id) throw new Error('id is required');
  const res = await db.collection('outfits').doc(id).get();
  if (!res.data || res.data._openid !== OPENID) throw new Error('outfit not found');
  return res.data;
}

async function loadClothesByIds(openid, ids) {
  if (!ids.length) return [];
  const res = await db.collection('clothes').where({ _openid: openid, _id: db.command.in(ids) }).limit(100).get();
  return res.data;
}

async function saveFavoriteOutfit(id, outfitPayload) {
  const { OPENID } = cloud.getWXContext();
  const now = new Date().toISOString();
  const existing = id && !isRecommendId(id) ? await assertOutfitOwner(id) : null;
  const base = existing || normalizeOutfitPayload(outfitPayload);
  const saved = await upsertOutfitByKey({
    openid: OPENID,
    existing,
    base,
    patch: {
      isFavorite: true,
      favoritedAt: now,
    },
    now,
  });

  const clothes = await loadClothesByIds(OPENID, saved.clothingIds || []);
  return toOutfit(saved, clothes);
}

async function saveWornOutfit(id, outfitPayload, targetDate) {
  const { OPENID } = cloud.getWXContext();
  const now = new Date().toISOString();
  const existing = id && !isRecommendId(id) ? await assertOutfitOwner(id) : null;
  const base = existing || normalizeOutfitPayload(outfitPayload);
  const outfitKey = getOutfitKey(readBaseClothingIds(base));
  const savedBefore = existing || (await findOutfitByKey(OPENID, outfitKey));
  const alreadyWornToday = Boolean(savedBefore && savedBefore.wornDate === targetDate);
  const saved = await upsertOutfitByKey({
    openid: OPENID,
    existing,
    base,
    patch: {
      wornAt: now,
      wornDate: targetDate,
      isWornToday: true,
    },
    now,
  });

  const clothes = await loadClothesByIds(OPENID, saved.clothingIds || []);
  return { ...toOutfit(saved, clothes), _alreadyWornToday: alreadyWornToday };
}

async function upsertOutfitByKey({ openid, existing, base, patch, now }) {
  const clothingIds = readBaseClothingIds(base);
  if (!base || clothingIds.length === 0) throw new Error('outfit payload is required');

  const outfitKey = getOutfitKey(clothingIds);
  const current = existing || (await findOutfitByKey(openid, outfitKey));
  const data = buildOutfitSaveData(base, {
    outfitKey,
    now,
    patch,
    current,
  });

  if (current) {
    await db.collection('outfits').doc(current._id).update({ data });
    return { ...current, ...data };
  }

  const addData = {
    _openid: openid,
    ...data,
    createdAt: now,
  };
  const addRes = await db.collection('outfits').add({ data: addData });
  return { ...addData, _id: addRes._id };
}

function buildOutfitSaveData(base, { outfitKey, now, patch, current }) {
  const weather = base.weatherSnapshot || base.weather || current?.weatherSnapshot || current?.weather || fallbackWeather();
  const reason = base.reasoning || base.reason || current?.reasoning || current?.reason || '';
  const clothingIds = readBaseClothingIds(base);
  const snapshotItems = buildSnapshotItems(clothingIds, base, current);
  const incomplete = snapshotItems.some((item) => item.isDeleted) || Boolean(current?.incomplete);

  return {
    title: base.title || current?.title || `${base.scene || current?.scene || '今日'}搭配`,
    clothingIds,
    outfitKey,
    snapshotItems,
    incomplete,
    deletedItemCount: snapshotItems.filter((item) => item.isDeleted).length,
    scene: base.scene || current?.scene,
    targetDate: base.targetDate || current?.targetDate,
    timeOfDay: base.timeOfDay || current?.timeOfDay || 'all_day',
    weather,
    weatherSnapshot: weather,
    scores: sanitizeScores(base.scores || current?.scores || {}),
    scoreExplanations: Array.isArray(base.scoreExplanations) ? base.scoreExplanations : current?.scoreExplanations || [],
    generationType: base.generationType || current?.generationType || 'auto',
    source: base.source || current?.source || 'recommend',
    isFavorite: patch.isFavorite ?? Boolean(current?.isFavorite),
    favoritedAt: patch.favoritedAt !== undefined ? patch.favoritedAt : current?.favoritedAt || null,
    wornAt: patch.wornAt !== undefined ? patch.wornAt : current?.wornAt || null,
    wornDate: patch.wornDate !== undefined ? patch.wornDate : current?.wornDate || null,
    isWornToday: patch.isWornToday ?? Boolean(current?.isWornToday),
    reason,
    reasoning: reason,
    updatedAt: now,
  };
}

async function findOutfitByKey(openid, outfitKey) {
  const res = await db.collection('outfits').where({ _openid: openid, outfitKey }).limit(1).get();
  return res.data[0] || null;
}

function readBaseClothingIds(base) {
  return base && Array.isArray(base.clothingIds) ? base.clothingIds : [];
}

function buildSnapshotItems(clothingIds, base, current) {
  const snapshots = [
    ...normalizeSnapshotItems(current?.snapshotItems),
    ...normalizeSnapshotItems(base?.snapshotItems),
    ...normalizePayloadItems(base?.items),
  ];
  const snapshotMap = new Map(snapshots.map((item) => [item.itemId, item]));

  return clothingIds.map((id) => {
    const snapshot = snapshotMap.get(id);
    return {
      itemId: id,
      name: snapshot?.name || snapshot?.category || '衣服',
      category: snapshot?.category || 'other',
      color: snapshot?.color || '',
      thumbnailUrl: snapshot?.thumbnailUrl || '',
      isDeleted: Boolean(snapshot?.isDeleted),
    };
  });
}

function normalizeSnapshotItems(value) {
  return Array.isArray(value)
    ? value
        .filter((item) => item && typeof item.itemId === 'string')
        .map((item) => ({
          itemId: item.itemId,
          name: item.name || item.category || '衣服',
          category: item.category || 'other',
          color: item.color || '',
          thumbnailUrl: item.thumbnailUrl || '',
          isDeleted: Boolean(item.isDeleted),
        }))
    : [];
}

function normalizePayloadItems(value) {
  return Array.isArray(value)
    ? value
        .filter((item) => item && typeof item.clothingId === 'string')
        .map((item) => ({
          itemId: item.clothingId,
          name: item.subcategory || item.category || '衣服',
          category: item.category || 'other',
          color: readColorText(item),
          thumbnailUrl: item.imageUrl || '',
          isDeleted: Boolean(item.isDeleted),
        }))
    : [];
}

function snapshotFromClothing(item, fallback, itemId) {
  return {
    itemId,
    name: item?.customName || item?.subcategory || item?.subCategory || item?.category || fallback?.name || '衣服',
    category: item?.category || fallback?.category || 'other',
    color: readColorText(item) || fallback?.color || '',
    thumbnailUrl: getDisplayImage(item) || fallback?.thumbnailUrl || '',
    isDeleted: Boolean(item?.status === DELETED_STATUS || fallback?.isDeleted),
  };
}

function getOutfitKey(clothingIds) {
  return signature(clothingIds);
}

function normalizeOutfitPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  return {
    title: payload.title,
    clothingIds: Array.isArray(payload.clothingIds) ? payload.clothingIds : [],
    snapshotItems: Array.isArray(payload.snapshotItems) ? payload.snapshotItems : [],
    items: Array.isArray(payload.items) ? payload.items : [],
    scene: payload.scene,
    targetDate: payload.targetDate,
    timeOfDay: payload.timeOfDay,
    weatherSnapshot: payload.weatherSnapshot,
    weather: payload.weather,
    scores: payload.scores,
    scoreExplanations: payload.scoreExplanations,
    generationType: payload.generationType,
    source: payload.source || 'recommend',
    reasoning: payload.reasoning,
    reason: payload.reason,
  };
}

function isRecommendId(id) {
  return typeof id === 'string' && id.startsWith('recommend:');
}

function toTempOutfit(recommendation, context) {
  const clothingIds = recommendation.items.map((item) => item._id);
  const itemMap = new Map(recommendation.items.map((item) => [item._id, item]));
  const snapshotItems = clothingIds.map((id) => snapshotFromClothing(itemMap.get(id), null, id));
  const data = {
    _id: `recommend:${signature(clothingIds)}`,
    _openid: context.openid,
    title: recommendation.title,
    clothingIds,
    snapshotItems,
    incomplete: false,
    deletedItemCount: 0,
    scene: context.scene,
    targetDate: context.targetDate,
    timeOfDay: context.timeOfDay,
    weatherSnapshot: context.weather,
    scores: recommendation.scores,
    scoreExplanations: recommendation.scoreExplanations,
    generationType: 'auto',
    source: 'recommend',
    isFavorite: false,
    isWornToday: false,
    reasoning: recommendation.reasoning,
    createdAt: context.now,
    updatedAt: context.now,
  };

  return toOutfit(data, recommendation.items);
}

function generateRuleRecommendations({ clothes, scene, weather, recommendationProfile, excludeClothingIdSets, maxResults }) {
  const tempConfig = getTemperatureConfig(Number(weather.temp || weather.temperature || 22));
  const filtered = clothes
    .filter((item) => item && item._id)
    .filter((item) => matchesSeason(item, tempConfig))
    .filter((item) => matchesTemperature(item, tempConfig));
  const grouped = groupClothes(filtered);
  const combos = generateCandidateCombos(grouped);
  const excluded = new Set((excludeClothingIdSets || []).filter(Array.isArray).map((ids) => signature(ids)));

  const scored = combos
    .map((items) => scoreCandidate(items, { scene, tempConfig, weather, recommendationProfile }))
    .filter((rec) => !excluded.has(signature(rec.items.map((item) => item._id))))
    .sort((a, b) => b.scores.total - a.scores.total);

  const results = [];
  const used = [];
  for (const rec of scored) {
    if (results.length >= Math.min(Math.max(Number(maxResults || 3), 1), 3)) break;
    const ids = rec.items.map((item) => item._id);
    const tooSimilar = used.some((existingIds) => overlapRatio(existingIds, ids) > 0.5);
    if (!tooSimilar) {
      results.push(rec);
      used.push(ids);
    }
  }

  return results;
}

function getRecommendationNotice(clothes, weather, recommendationCount) {
  const activeClothes = clothes.filter((item) => item && item._id);
  if (activeClothes.length < 3) {
    return '衣柜单品还不够，先上传几件衣服，我再帮你搭配。';
  }

  const tempConfig = getTemperatureConfig(Number(weather.temp || weather.temperature || 22));
  const groups = groupClothes(activeClothes);
  const missing = [];
  const hasUpperChoice = groups.top.length > 0 || groups.onepiece.length > 0;
  const hasBottomChoice = groups.bottom.length > 0 || groups.skirt.length > 0 || groups.onepiece.length > 0;

  if (!hasUpperChoice) missing.push('上衣');
  if (!hasBottomChoice) missing.push('下装');
  if (groups.shoes.length === 0) missing.push('鞋子');
  if (tempConfig.targetThickness >= 2 && groups.outerwear.length === 0) missing.push('外套');

  if (missing.length > 0) {
    return `还缺少${missing.join('、')}，推荐结果可能不完整。`;
  }

  if (recommendationCount === 0) {
    return '暂时没有合适搭配，换个场景或多上传几件衣服再试试。';
  }

  return '';
}

function getTemperatureConfig(temp) {
  if (temp < 5) {
    return {
      range: 'freezing',
      seasons: ['winter', '冬'],
      targetThickness: 3,
      advice: '天气寒冷，优先选择保暖外套和长下装',
    };
  }
  if (temp < 15) {
    return {
      range: 'cold',
      seasons: ['winter', 'autumn', '冬', '秋'],
      targetThickness: 2.6,
      advice: '天气偏冷，外套和长裤会更稳妥',
    };
  }
  if (temp < 20) {
    return {
      range: 'cool',
      seasons: ['spring', 'autumn', '春', '秋'],
      targetThickness: 2.1,
      advice: '天气凉爽，薄外套或卫衣更合适',
    };
  }
  if (temp < 26) {
    return {
      range: 'mild',
      seasons: ['spring', 'autumn', '春', '秋'],
      targetThickness: 1.7,
      advice: '温度适中，穿着自由度较高',
    };
  }
  if (temp < 32) {
    return {
      range: 'warm',
      seasons: ['summer', 'spring', '夏', '春'],
      targetThickness: 1.2,
      advice: '天气偏热，轻薄透气会更舒服',
    };
  }
  return {
    range: 'hot',
    seasons: ['summer', '夏'],
    targetThickness: 1,
    advice: '天气炎热，建议选择短袖、短下装和清爽鞋款',
  };
}

function matchesSeason(item, tempConfig) {
  const seasons = readArray(item.seasonTags);
  if (seasons.length === 0) return true;
  return seasons.some((season) => tempConfig.seasons.includes(season));
}

function matchesTemperature(item, tempConfig) {
  const thickness = getThicknessValue(item);
  if ((tempConfig.range === 'hot' || tempConfig.range === 'warm') && thickness >= 2.8) return false;
  if ((tempConfig.range === 'freezing' || tempConfig.range === 'cold') && thickness <= 1.1) return false;
  return true;
}

function groupClothes(clothes) {
  const groups = { top: [], outerwear: [], bottom: [], skirt: [], onepiece: [], shoes: [], accessory: [], other: [] };
  for (const item of clothes) {
    const category = normalizeCategory(item);
    if (category === 'top' && isOuterwear(item)) groups.outerwear.push(item);
    else if (category === 'bottom' && isSkirt(item)) groups.skirt.push(item);
    else if (groups[category]) groups[category].push(item);
    else groups.other.push(item);
  }
  return groups;
}

function generateCandidateCombos(groups) {
  const combos = [];
  if (groups.shoes.length === 0) return combos;

  for (const top of groups.top.slice(0, 6)) {
    for (const bottom of groups.bottom.slice(0, 6)) {
      for (const shoe of groups.shoes.slice(0, 4)) {
        combos.push([top, bottom, shoe]);
      }
    }
  }

  for (const top of groups.top.slice(0, 5)) {
    for (const bottom of groups.bottom.slice(0, 5)) {
      for (const coat of groups.outerwear.slice(0, 4)) {
        for (const shoe of groups.shoes.slice(0, 3)) {
          combos.push([top, bottom, coat, shoe]);
        }
      }
    }
  }

  for (const dress of groups.onepiece.slice(0, 5)) {
    for (const coat of groups.outerwear.slice(0, 4)) {
      for (const shoe of groups.shoes.slice(0, 4)) {
        combos.push([dress, coat, shoe]);
      }
    }
  }

  for (const top of groups.top.slice(0, 6)) {
    for (const skirt of groups.skirt.slice(0, 5)) {
      for (const shoe of groups.shoes.slice(0, 4)) {
        combos.push([top, skirt, shoe]);
      }
    }
  }

  return combos.slice(0, 100);
}

function scoreCandidate(items, context) {
  const colors = items.flatMap((item) => normalizeColors(item));
  const styles = items.flatMap((item) => readArray(item.styleTags));
  const scenes = items.flatMap((item) => readArray(item.sceneTags));
  const weatherAdaptation = scoreWeather(items, context.tempConfig);
  const colorHarmony = scoreColorHarmony(colors, context.recommendationProfile.colorPreference);
  const styleUnity = scoreStyleUnity(styles, context.recommendationProfile.styleTags);
  const sceneMatch = scoreSceneMatch(scenes, context.scene);
  const freshness = scoreFreshness(items);
  const preference = scorePreference(items, styles, context.recommendationProfile);
  const warmth = scoreWarmth(items);
  const coolness = scoreCoolness(items);
  const fashion = round1((styleUnity * 0.7) + (avg(items.map((item) => Number(item.fashionScore || 0)).filter(Boolean)) || 7) * 0.3);
  const comfort = round1((weatherAdaptation * 0.7) + (coolness * 0.15) + (warmth * 0.15));
  const total = round1(
    weatherAdaptation * 0.3 +
    colorHarmony * 0.2 +
    styleUnity * 0.2 +
    sceneMatch * 0.15 +
    freshness * 0.1 +
    preference * 0.05,
  );
  const scores = sanitizeScores({
    total,
    weatherAdaptation,
    styleUnity,
    freshness,
    preference,
    fashion,
    comfort,
    warmth,
    coolness,
    sceneMatch,
    colorHarmony,
  });

  return {
    items,
    title: buildTitle(items, context.scene),
    scores,
    scoreExplanations: buildScoreExplanations(scores, context.tempConfig, context.scene),
    reasoning: buildTemplateReasoning(context.scene, items, scores, context.tempConfig),
  };
}

function scoreWeather(items, tempConfig) {
  const seasonScore = items.every((item) => readArray(item.seasonTags).length === 0)
    ? 7
    : round1((items.filter((item) => matchesSeason(item, tempConfig)).length / Math.max(items.length, 1)) * 10);
  const thicknessDiff = Math.abs(avg(items.map(getThicknessValue)) - tempConfig.targetThickness);
  const thicknessScore = Math.max(2, round1(10 - thicknessDiff * 2.5));
  const warmthOrCoolness = tempConfig.targetThickness >= 2 ? scoreWarmth(items) : scoreCoolness(items);
  return round1(seasonScore * 0.35 + thicknessScore * 0.35 + warmthOrCoolness * 0.3);
}

function scoreColorHarmony(colors, preferredColors) {
  if (colors.length === 0) return 5;
  const families = colors.map((color) => classifyColor(color.hex || color.name || ''));
  const neutralCount = families.filter((family) => family === 'neutral').length;
  const nonNeutral = new Set(families.filter((family) => family !== 'neutral'));
  let score = 6;
  if (neutralCount >= 1 && nonNeutral.size <= 2) score = 9;
  else if (nonNeutral.size === 0) score = 8;
  else if (nonNeutral.size <= 2) score = 7;
  else if (nonNeutral.size >= 4) score = 4;

  const colorText = colors.map((color) => color.name).join(' ');
  if ((preferredColors || []).some((color) => colorText.includes(color))) score += 0.7;
  return Math.min(10, round1(score));
}

function scoreStyleUnity(styles, preferredStyles) {
  if (styles.length === 0) return preferredStyles.length > 0 ? 5 : 7;
  const uniqueCount = new Set(styles).size;
  const unity = uniqueCount === 1 ? 9 : uniqueCount === 2 ? 8 : uniqueCount === 3 ? 6.5 : 5;
  if (!preferredStyles.length) return unity;
  const matchRatio = styles.filter((style) => preferredStyles.includes(style)).length / Math.max(styles.length, 1);
  return round1(unity * 0.65 + (5 + matchRatio * 5) * 0.35);
}

function scoreSceneMatch(scenes, scene) {
  if (!scene) return 7;
  if (!scenes.length) return 5;
  if (scenes.includes(scene)) return 9;
  const related = {
    上班: ['开会', '正式', '通勤'],
    开会: ['上班', '正式', '通勤'],
    约会: ['聚会', '逛街'],
    逛街: ['约会', '出游', '日常'],
    出游: ['逛街', '运动', '日常'],
    居家: ['日常', '休闲'],
    运动: ['出游', '休闲'],
  };
  return scenes.some((item) => (related[scene] || []).includes(item)) ? 7 : 5;
}

function scoreFreshness(items) {
  const usagePenalty = avg(items.map((item) => Math.min(Number(item.usageCount || 0), 10) * 0.25));
  const recentPenalty = items.filter((item) => item.lastWornAt && isWithinDays(item.lastWornAt, 7)).length * 1.2;
  return Math.max(3, round1(9 - usagePenalty - recentPenalty));
}

function scorePreference(items, styles, profile) {
  const text = items
    .flatMap((item) => [
      item.category,
      item.subcategory,
      item.subCategory,
      item.material,
      item.customName,
      ...(item.colors || []),
      ...readArray(item.styleTags),
      ...readArray(item.sceneTags),
      ...normalizeColors(item).map((color) => color.name),
    ])
    .filter(Boolean)
    .join(' ');
  const styleMatches = styles.filter((style) => profile.styleTags.includes(style)).length;
  const colorMatches = profile.colorPreference.filter((color) => text.includes(color)).length;
  const avoidMatches = profile.avoidTags.filter((tag) => text.includes(tag)).length;
  return Math.max(1, Math.min(10, round1(6 + styleMatches * 1.2 + colorMatches * 0.8 - avoidMatches * 1.5)));
}

function scoreWarmth(items) {
  return Math.max(1, Math.min(10, round1(avg(items.map((item) => Number(item.warmthScore || 0) || inferWarmth(item))))));
}

function scoreCoolness(items) {
  return Math.max(1, Math.min(10, round1(avg(items.map((item) => Number(item.coolnessScore || 0) || inferCoolness(item))))));
}

function inferWarmth(item) {
  const text = `${item.thickness || ''} ${item.subcategory || ''} ${item.subCategory || ''} ${item.material || ''}`;
  let score = 5;
  if (['羽绒', '羊毛', '针织', '皮革', 'down_jacket', 'jacket', 'sweater', 'boots'].some((hint) => text.includes(hint))) score += 2.5;
  if (['短袖', '薄', 'tshirt', 'shorts', 'sandals'].some((hint) => text.includes(hint))) score -= 2;
  return score;
}

function inferCoolness(item) {
  const text = `${item.thickness || ''} ${item.subcategory || ''} ${item.subCategory || ''} ${item.material || ''}`;
  let score = 5;
  if (['棉', '麻', '丝绸', '短袖', '薄', 'tshirt', 'shirt', 'shorts', 'skirt', 'sandals'].some((hint) => text.includes(hint))) score += 2;
  if (['羽绒', '羊毛', '厚', 'down_jacket', 'jacket', 'sweater', 'boots'].some((hint) => text.includes(hint))) score -= 2;
  return score;
}

function getThicknessValue(item) {
  const warmthScore = Number(item.warmthScore || 0);
  if (warmthScore > 0) return Math.min(3, Math.max(1, warmthScore / 3.3));
  const text = `${item.thickness || ''} ${item.subcategory || ''} ${item.subCategory || ''} ${item.material || ''}`;
  if (['厚', '羽绒', '羊毛', 'down_jacket', 'sweater', 'coat'].some((hint) => text.includes(hint))) return 3;
  if (['薄', '短袖', '背心', 'tshirt', 'vest', 'shorts', 'sandals'].some((hint) => text.includes(hint))) return 1;
  return 2;
}

function buildTitle(items, scene) {
  const hasDress = items.some((item) => normalizeCategory(item) === 'onepiece');
  const style = getMainStyle(items);
  if (hasDress) return `${scene || '今日'}连衣裙搭配`;
  return `${scene || '今日'}${style}搭配`;
}

function buildScoreExplanations(scores, tempConfig, scene) {
  return [
    { dimension: 'total', score: scores.total, text: `综合评分 ${scores.total}，按天气、配色、风格、场景、新鲜感和偏好加权。` },
    { dimension: 'weatherAdaptation', score: scores.weatherAdaptation, text: `${tempConfig.advice}，天气适配 ${scores.weatherAdaptation} 分。` },
    { dimension: 'colorHarmony', score: scores.colorHarmony, text: scores.colorHarmony >= 8 ? '配色协调耐看。' : '配色可用，建议控制颜色数量。' },
    { dimension: 'styleUnity', score: scores.styleUnity, text: scores.styleUnity >= 8 ? '整体风格统一。' : '风格有混搭感。' },
    { dimension: 'sceneMatch', score: scores.sceneMatch, text: `适配${scene || '当前'}场景。` },
    { dimension: 'freshness', score: scores.freshness, text: '结合使用次数和最近穿着记录计算。' },
    { dimension: 'preference', score: scores.preference, text: '结合风格、颜色偏好和避雷标签计算。' },
  ];
}

function buildTemplateReasoning(scene, items, scores, tempConfig) {
  const names = items
    .map((item) => item.customName || item.subCategory || item.subcategory || item.category)
    .slice(0, 3)
    .join('、');
  const colorText = scores.colorHarmony >= 8 ? '配色干净' : '配色有层次';
  const temperatureText = scores.weatherAdaptation >= 8 ? '今天穿着也舒服' : tempConfig.advice;
  return `${names}，适合${scene || '日常'}；${colorText}，${temperatureText}。`;
}

function normalizeWeather(weather) {
  if (!weather || typeof weather !== 'object') return null;
  const temp = Number(weather.temp ?? weather.temperature);
  if (Number.isNaN(temp)) return null;
  return {
    temp,
    humidity: Number(weather.humidity || 65),
    weather: weather.weather || weather.condition || '多云',
    wind: Number(weather.wind || 3),
    uv: Number(weather.uv || 4),
  };
}

function normalizeCategory(item) {
  const category = item.category;
  if (resolveCategoryValues('top').includes(category)) return 'top';
  if (resolveCategoryValues('bottom').includes(category)) return 'bottom';
  if (resolveCategoryValues('onepiece').includes(category)) return 'onepiece';
  if (resolveCategoryValues('shoes').includes(category)) return 'shoes';
  if (resolveCategoryValues('accessory').includes(category)) return 'accessory';
  return 'other';
}

function isOuterwear(item) {
  const text = `${item.category || ''} ${item.subcategory || ''} ${item.subCategory || ''} ${item.customName || ''}`;
  return ['jacket', 'down_jacket', 'blazer', 'coat', 'trench', 'cardigan', '外套', '夹克', '西装', '羽绒服'].some((hint) => text.includes(hint));
}

function isSkirt(item) {
  const text = `${item.subcategory || ''} ${item.subCategory || ''} ${item.customName || ''}`;
  return text.includes('skirt') || text.includes('裙');
}

function getMainStyle(items) {
  const styles = items.flatMap((item) => readArray(item.styleTags));
  return styles.find(Boolean) || '日常';
}

function normalizeColors(item) {
  if (Array.isArray(item.colorPalette) && item.colorPalette.length > 0) return item.colorPalette;
  return readArray(item.colors).map((name) => ({ name, hex: '' }));
}

function readColorText(item) {
  if (!item) return '';
  const colors = normalizeColors(item).map((color) => color.name).filter(Boolean);
  return colors.join(' / ');
}

function classifyColor(value) {
  if (!value) return 'neutral';
  if (['黑', '白', '灰', '米', '棕'].some((name) => value.includes(name))) return 'neutral';
  if (!value.startsWith('#') || value.length < 7) return 'vivid';

  const r = parseInt(value.slice(1, 3), 16) / 255;
  const g = parseInt(value.slice(3, 5), 16) / 255;
  const b = parseInt(value.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const s = max === min ? 0 : l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
  if (s < 0.15 || l < 0.15 || l > 0.85) return 'neutral';

  let h = 0;
  if (max === r) h = ((g - b) / (max - min)) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  h = Math.round(h * 60);
  if (h < 0) h += 360;
  if (h < 60 || h >= 300) return 'warm';
  if (h >= 180 && h < 300) return 'cool';
  return 'vivid';
}

function readArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function sameIdSet(a, b) {
  return signature(a) === signature(b);
}

function signature(ids) {
  return ids.slice().sort().join('|');
}

function overlapRatio(a, b) {
  const set = new Set(a);
  return b.filter((id) => set.has(id)).length / Math.max(b.length, 1);
}

function avg(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round1(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10) / 10;
}

function sanitizeScores(scores) {
  return {
    total: normalizeScore(scores.total),
    weatherAdaptation: normalizeScore(scores.weatherAdaptation),
    styleUnity: normalizeScore(scores.styleUnity),
    freshness: normalizeScore(scores.freshness),
    preference: normalizeScore(scores.preference),
    fashion: normalizeScore(scores.fashion),
    comfort: normalizeScore(scores.comfort),
    warmth: normalizeScore(scores.warmth),
    coolness: normalizeScore(scores.coolness),
    sceneMatch: normalizeScore(scores.sceneMatch),
    colorHarmony: normalizeScore(scores.colorHarmony),
  };
}

function normalizeScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(10, round1(score)));
}

function isWithinDays(dateText, days) {
  const time = new Date(dateText).getTime();
  if (Number.isNaN(time)) return false;
  return Date.now() - time <= days * 24 * 60 * 60 * 1000;
}

function pickOutfitItems(clothes, excludeSets, recommendationProfile) {
  const byCategory = (category) => clothes.filter((item) => resolveCategoryValues(category).includes(item.category));
  const combos = [
    [first(byCategory('top')), first(byCategory('bottom')), first(byCategory('shoes'))],
    [first(byCategory('onepiece')), first(byCategory('shoes')), first(byCategory('accessory'))],
    [first(byCategory('top')), first(byCategory('bottom')), first(byCategory('accessory'))],
  ]
    .map((items) => items.filter(Boolean))
    .filter((items) => items.length >= 2);

  const available = combos
    .map((items) => ({ items, score: scorePreferenceMatch(items, recommendationProfile) }))
    .sort((a, b) => b.score - a.score)
    .find(({ items }) => {
      const ids = items.map((item) => item._id).sort().join(',');
      return !excludeSets.some((set) => Array.isArray(set) && set.slice().sort().join(',') === ids);
    });

  return available ? available.items : [];
}

function first(items) {
  return items[0] || null;
}

function normalizeRecommendationProfile(styleProfile) {
  const profile = styleProfile || {};
  const recommendationProfile = profile.recommendationProfile || {};
  return {
    genderPreference: readEnum(recommendationProfile.genderPreference, ['male_style', 'female_style', 'neutral_style', 'all', 'unknown'], 'unknown'),
    styleTags: Array.isArray(recommendationProfile.styleTags)
      ? recommendationProfile.styleTags
      : Array.isArray(profile.preferredStyles)
        ? profile.preferredStyles
        : [],
    fitPreference: readEnum(recommendationProfile.fitPreference, ['loose', 'regular', 'slim', 'oversize', 'unknown'], 'unknown'),
    colorPreference: Array.isArray(recommendationProfile.colorPreference) ? recommendationProfile.colorPreference : [],
    avoidTags: Array.isArray(recommendationProfile.avoidTags) ? recommendationProfile.avoidTags : [],
    temperatureSensitivity: readEnum(recommendationProfile.temperatureSensitivity, ['cold_sensitive', 'normal', 'heat_sensitive'], 'normal'),
  };
}

function scorePreferenceMatch(items, profile) {
  const text = items
    .flatMap((item) => [
      item.category,
      item.subcategory,
      item.material,
      item.customName,
      ...(item.styleTags || []),
      ...(item.sceneTags || []),
      ...(item.colorPalette || []).map((color) => color.name),
    ])
    .filter(Boolean)
    .join(' ');

  let score = 0;
  score += countMatches(text, profile.styleTags) * 2;
  score += countMatches(text, profile.colorPreference) * 1.2;
  score -= countMatches(text, profile.avoidTags) * 1.5;
  score += scoreFitPreference(text, profile.fitPreference);
  // Recommendation direction only. This is not the user's gender identity
  // and must never exclude clothing; it only nudges ranking.
  score += scoreGenderPreference(text, profile.genderPreference);
  return score;
}

function scoreGenderPreference(text, preference) {
  if (preference === 'unknown' || preference === 'all') return 0;
  const maleHints = ['工装', '街头', '运动', '美式复古', '中性', '简约'];
  const femaleHints = ['甜美', '甜酷', '优雅', '法式', '韩系', '日系'];
  const neutralHints = ['中性', '极简', 'Clean Fit', '简约', '休闲'];
  const hints =
    preference === 'male_style'
      ? maleHints
      : preference === 'female_style'
        ? femaleHints
        : neutralHints;
  return hints.some((hint) => text.includes(hint)) ? 0.8 : 0;
}

function scoreFitPreference(text, preference) {
  if (preference === 'unknown') return 0;
  const hints = {
    loose: ['宽松', '休闲'],
    regular: ['合身', '简约', '通勤'],
    slim: ['修身', '优雅'],
    oversize: ['Oversize', '宽松', '街头'],
  };
  return (hints[preference] || []).some((hint) => text.includes(hint)) ? 0.6 : 0;
}

function countMatches(text, tags) {
  return (tags || []).filter((tag) => text.includes(tag)).length;
}

function readEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function buildReasoning(scene, items) {
  const names = items.map((item) => item.customName || item.subcategory || item.category).join('、');
  return `${names} 组合干净实用，适合${scene}场景。`;
}

function toOutfit(item, clothes) {
  const today = new Date().toISOString().slice(0, 10);
  const clothingIds = item.clothingIds || [];
  const clothesMap = new Map((clothes || []).map((clothing) => [clothing._id, clothing]));
  const snapshotMap = new Map(normalizeSnapshotItems(item.snapshotItems).map((snapshot) => [snapshot.itemId, snapshot]));
  const snapshotItems = clothingIds.map((id) => snapshotFromClothing(clothesMap.get(id), snapshotMap.get(id), id));
  const deletedItemCount = snapshotItems.filter((snapshot) => snapshot.isDeleted || !clothesMap.has(snapshot.itemId)).length;
  const incomplete = Boolean(item.incomplete) || deletedItemCount > 0;

  return {
    id: item._id,
    userId: item._openid,
    title: item.title,
    clothingIds,
    outfitKey: item.outfitKey || getOutfitKey(clothingIds),
    snapshotItems,
    incomplete,
    deletedItemCount,
    items: snapshotItems.map((snapshot) => {
      const clothing = clothesMap.get(snapshot.itemId);
      return {
        clothingId: snapshot.itemId,
        category: clothing?.category || snapshot.category || 'other',
        subcategory: clothing?.subcategory || snapshot.name,
        imageUrl: getDisplayImage(clothing) || snapshot.thumbnailUrl || '',
        colorPalette: clothing?.colorPalette || [],
        isDeleted: Boolean(snapshot.isDeleted || !clothing),
      };
    }),
    scene: item.scene,
    targetDate: item.targetDate,
    timeOfDay: item.timeOfDay,
    weatherSnapshot: item.weatherSnapshot || item.weather,
    scores: sanitizeScores(item.scores || {}),
    scoreExplanations: item.scoreExplanations || [],
    generationType: item.generationType || 'auto',
    sourceItemId: item.sourceItemId,
    source: item.source || 'recommend',
    isFavorite: Boolean(item.isFavorite),
    favoritedAt: item.favoritedAt || undefined,
    wornAt: item.wornAt || undefined,
    wornDate: item.wornDate || undefined,
    isWornToday: Boolean(item.isWornToday) || item.wornDate === today,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    reasoning: item.reasoning || item.reason,
  };
}

function fallbackWeather() {
  return {
    city: '上海',
    temp: 22,
    feelsLike: 20,
    humidity: 65,
    weather: '多云',
    wind: 3,
    windDir: '东南风',
    uv: 4,
  };
}

function resolveCategoryValues(category) {
  const map = {
    top: ['top', '上衣', '外套'],
    bottom: ['bottom', '裤子', '裙子'],
    onepiece: ['onepiece', '连衣裙'],
    shoes: ['shoes', '鞋子'],
    accessory: ['accessory', '包', '帽子', '配饰'],
    other: ['other', '其他'],
  };
  return map[category] || [category];
}

function getDisplayImage(item) {
  if (!item) return '';
  return item.displayImageUrl || item.originalImageUrl || '';
}

function ok(data) {
  return { code: 0, data, message: 'ok' };
}

function fail(error) {
  return { code: 1, data: null, message: error && error.message ? error.message : 'unknown error' };
}
