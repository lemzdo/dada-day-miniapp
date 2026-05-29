const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const DELETED_STATUS = 'deleted';
const BAILIAN_BASE_URL = process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const AI_COMMENT_PROVIDER = process.env.AI_COMMENT_PROVIDER || 'aliyun-bailian';
const AI_COMMENT_MODEL = process.env.AI_COMMENT_MODEL || 'qwen-flash';
const AI_COMMENT_TIMEOUT_MS = Number(process.env.AI_COMMENT_TIMEOUT_MS || 5000);

exports.main = async (event = {}) => {
  try {
    const action = event.action || 'generate';
    if (action === 'detail') return ok(await getOutfitDetail(event));
    if (action === 'renameOutfit') return ok(await renameOutfit(event));
    if (action === 'favorite') return ok(await updateFavorite(event.id, Boolean(event.isFavorite), event.outfit));
    if (action === 'wear') return ok(await confirmWear(event.id, event.date, event.outfit));
    if (action === 'list') return ok(await listOutfits(event));
    if (action === 'saveFavoriteOutfit') return ok(await saveFavoriteOutfit(event.id, event.outfit, event.aiComment));
    if (action === 'removeFavoriteOutfit') return ok(await removeFavoriteOutfit(event.favoriteOutfitId || event.id, event.outfitKey));
    if (action === 'listFavoriteOutfits') return ok(await listFavoriteOutfits(event));
    if (action === 'addOutfitHistory') return ok(await addOutfitHistory(event));
    if (action === 'listOutfitHistory') return ok(await listOutfitHistory(event));
    if (action === 'aiComment') return ok(await generateAiComment(event));

    return ok(await generate(event));
  } catch (error) {
    console.error('[generateOutfit] failed', error);
    return fail(error);
  }
};

async function generate(event) {
  const { OPENID } = cloud.getWXContext();
  const inputScene = typeof event.scene === 'string' ? event.scene.trim() : '';
  const scene = inputScene || undefined;
  const targetDate = event.date || new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const recommendationBatchId = event.recommendationBatchId || createRecommendationBatchId(now);
  const clothesRes = await db.collection('clothes').where({ _openid: OPENID, status: 'active' }).limit(100).get();
  const clothes = clothesRes.data;
  const userRes = await db.collection('users').where({ _openid: OPENID }).limit(1).get();
  const recommendationProfile = normalizeRecommendationProfile(userRes.data[0] && userRes.data[0].styleProfile);
  const exclude = Array.isArray(event.excludeClothingIdSets) ? event.excludeClothingIdSets : [];
  const excludedOutfitKeys = readStringArray(event.excludedOutfitKeys);
  const weather = normalizeWeather(event.weather) || fallbackWeather();
  const recommendations = generateRuleRecommendations({
    clothes,
    scene,
    weather,
    recommendationProfile,
    excludeClothingIdSets: exclude,
    excludedOutfitKeys,
    maxResults: event.maxResults || 8,
  });
  const recommendationNotice = getRecommendationNotice(clothes, weather, recommendations.length);
  const debug = {
    inputScene,
    matchedScene: recommendations[0]?.matchedScene || '',
    candidateCount: recommendations.debug?.candidateCount ?? 0,
    filteredCandidateCount: recommendations.debug?.filteredCandidateCount ?? 0,
    excludedOutfitKeyCount: excludedOutfitKeys.length,
    limited: Boolean(recommendations.limited),
    exhausted: Boolean(recommendations.exhausted),
    generatedCount: recommendations.length,
  };

  console.log('[generateOutfit] generate', {
    inputScene,
    scene,
    candidateCount: debug.candidateCount,
    generatedCount: debug.generatedCount,
    firstOutfitId: recommendations[0] ? `recommend:${signature(recommendations[0].items.map((item) => item._id))}` : '',
    firstItemIds: recommendations[0]?.items.map((item) => item._id) || [],
  });

  if (recommendations.length === 0) {
    return {
      outfits: [],
      weather,
      recommendationNotice,
      recommendationBatchId,
      limited: Boolean(recommendations.limited),
      exhausted: true,
      debug: { ...debug, exhausted: true },
    };
  }

  const tempOutfits = recommendations.map((recommendation) =>
    toTempOutfit(recommendation, {
      openid: OPENID,
      scene,
      targetDate,
      timeOfDay: event.timeOfDay || 'all_day',
      weather,
      now,
      recommendationBatchId,
    }),
  );
  const outfits = [];
  for (const tempOutfit of tempOutfits) {
    const outfitRecord = await upsertOutfitByKey({
      openid: OPENID,
      base: tempOutfit,
      patch: {},
      now,
    });
    outfits.push({
      ...tempOutfit,
      id: outfitRecord._id,
      outfitId: outfitRecord._id,
      outfitKind: 'recommendation',
    });
  }
  const hydratedOutfits = await enrichOutfitsState(outfits, {
    openid: OPENID,
    targetDate,
    generatedAt: now,
    recommendationBatchId,
  });
  await saveOutfitExposures({
    openid: OPENID,
    outfits: hydratedOutfits,
    scene,
    batchId: recommendationBatchId,
    shownAt: now,
  });

  return {
    outfits: hydratedOutfits,
    weather,
    recommendationNotice,
    recommendationBatchId,
    limited: Boolean(recommendations.limited),
    exhausted: Boolean(recommendations.exhausted),
    debug,
  };
}

async function getOutfitDetail(event) {
  const source = event.source || event.type;
  if (source === 'favorite') return getFavoriteOutfitById(event.id);
  if (source === 'history') return getHistoryById(event.id);
  return getOutfit(event.id);
}

async function getOutfit(id) {
  const { OPENID } = cloud.getWXContext();
  if (!id) throw new Error('id is required');
  const outfit = await db.collection('outfits').doc(id).get();
  if (!outfit.data || outfit.data._openid !== OPENID) throw new Error('outfit not found');
  const clothes = await loadClothesByIds(OPENID, outfit.data.clothingIds || []);
  return enrichSingleOutfitState(toOutfit(outfit.data, clothes), { openid: OPENID });
}

async function renameOutfit(event) {
  const { OPENID } = cloud.getWXContext();
  const now = new Date().toISOString();
  const nextUserTitle = normalizeUserTitleInput(event.userTitle);
  validateUserTitle(nextUserTitle);

  const payload = normalizeOutfitPayload(event.outfit);
  let current = null;

  if (event.outfitId) {
    try {
      const res = await db.collection('outfits').doc(event.outfitId).get();
      if (res.data && res.data._openid === OPENID) current = res.data;
    } catch {
      current = null;
    }
  }

  const lookupKey = event.outfitKey || payload?.outfitKey || getOutfitKey(readBaseClothingIds(payload));
  if (!current && lookupKey) {
    current = await findOutfitByKey(OPENID, lookupKey);
  }

  if (!current && payload && readBaseClothingIds(payload).length > 0) {
    current = await upsertOutfitByKey({
      openid: OPENID,
      base: payload,
      patch: {},
      now,
    });
  }

  if (!current) throw new Error('outfit not found');

  const title = current.title || payload?.title || `${current.scene || payload?.scene || '今日'}搭配`;
  const displayTitle = getDisplayTitle({ userTitle: nextUserTitle, title }, `${current.scene || payload?.scene || '今日'}搭配`);
  const data = {
    userTitle: nextUserTitle,
    displayTitle,
    updatedAt: now,
  };

  await db.collection('outfits').doc(current._id).update({ data });

  const updated = {
    ...current,
    ...data,
    title,
  };
  const clothes = await loadClothesByIds(OPENID, updated.clothingIds || []);
  return enrichSingleOutfitState(toOutfit(updated, clothes), {
    openid: OPENID,
    targetDate: updated.targetDate || payload?.targetDate,
  });
}

async function updateFavorite(id, isFavorite, outfitPayload) {
  if (!isFavorite) {
    return removeFavoriteOutfit(id);
  }

  return saveFavoriteOutfit(id, outfitPayload);
}

async function confirmWear(id, date, outfitPayload) {
  return addOutfitHistory({
    id,
    outfit: outfitPayload,
    source: outfitPayload && outfitPayload.isFavorite ? 'favorite' : 'recommendation',
    sourceFavoriteOutfitId: outfitPayload && outfitPayload.isFavorite ? id : undefined,
    date,
  });
}

async function listOutfits(event) {
  if (event.isFavorite === true) return listFavoriteOutfits(event);
  if (shouldListWorn(event)) return listOutfitHistory(event);
  return listFavoriteOutfits(event);
}

async function generateAiComment(event) {
  const fallbackMessage = 'AI 点评暂时不可用，请稍后再试';
  const saveFailedMessage = '点评生成了，但保存失败';
  const incompleteMessage = '这套搭配信息不完整，暂时不能保存点评';

  try {
    const commentInput = await buildAiCommentInput(event, null);
    const now = new Date().toISOString();
    const aiComment = {
      ...(await callAiCommentModel(commentInput)),
      generatedAt: now,
    };

    let identity;
    try {
      identity = resolveAiReviewIdentity(event);
    } catch (error) {
      return {
        success: true,
        aiComment,
        saved: false,
        message: incompleteMessage,
        saveError: error && error.message ? error.message : 'missing_outfit_key',
      };
    }

    try {
      const savedReview = await upsertOutfitAiReview({
        ...identity,
        aiComment,
        now,
      });
      return {
        success: true,
        aiComment: normalizeAiComment(savedReview.aiComment) || aiComment,
        saved: true,
      };
    } catch {
      return {
        success: true,
        aiComment,
        saved: false,
        message: saveFailedMessage,
      };
    }
  } catch (error) {
    console.warn('[generateOutfit] aiComment fallback', error && error.message ? error.message : error);
    return { success: false, fallback: true, message: fallbackMessage };
  }
}

async function buildAiCommentInput(event, existing) {
  const clothes = existing ? await loadClothesByIds(existing._openid, existing.clothingIds || []) : [];
  return {
    weather: event.weather || existing?.weatherSnapshot || existing?.weather || null,
    scene: event.scene || existing?.scene || '',
    items: buildAiCommentItems(event.items, existing, clothes),
    scores: sanitizeScores(event.scores || existing?.scores || {}),
    reason: event.reason || existing?.reasoning || existing?.reason || '',
  };
}

function resolveAiReviewIdentity(event) {
  const { OPENID } = cloud.getWXContext();
  const payload = normalizeOutfitPayload(event.outfit);
  const clothingIds = uniqueStrings([
    ...readBaseClothingIds(payload),
    ...readClothingIdsFromItems(payload?.items),
    ...readClothingIdsFromItems(event.items),
    ...readClothingIdsFromSnapshotItems(payload?.snapshotItems),
    ...readClothingIdsFromSnapshotItems(payload?.itemsSnapshot),
  ]);
  const outfitKey = event.outfitKey || payload?.outfitKey || getOutfitKey(clothingIds);
  const scene = event.scene || payload?.scene || '';
  const eventOutfitId = typeof event.outfitId === 'string' && !isRecommendId(event.outfitId) ? event.outfitId : '';
  const payloadOutfitId = typeof payload?.outfitId === 'string' ? payload.outfitId : '';
  const payloadId = typeof payload?.id === 'string' && !isRecommendId(payload.id) ? payload.id : '';

  if (!outfitKey) throw new Error('missing_outfit_key');
  return {
    openid: OPENID,
    outfitKey,
    scene,
    outfitId: eventOutfitId || payloadOutfitId || payloadId || '',
  };
}

async function upsertOutfitAiReview({ openid, outfitKey, outfitId, scene, aiComment, now }) {
  const normalizedAiComment = normalizeAiComment(aiComment);
  if (!normalizedAiComment) throw new Error('invalid_ai_comment');

  const data = {
    _openid: openid,
    userId: openid,
    outfitKey,
    outfitId: outfitId || undefined,
    scene: scene || '',
    aiComment: {
      ...normalizedAiComment,
      generatedAt: normalizedAiComment.generatedAt || now,
    },
    generatedAt: normalizedAiComment.generatedAt || now,
    updatedAt: now,
  };

  const existing = await db.collection('outfit_ai_reviews')
    .where({ _openid: openid, outfitKey, scene: scene || '' })
    .limit(1)
    .get();
  const current = existing.data && existing.data[0];

  if (current) {
    await db.collection('outfit_ai_reviews').doc(current._id).update({ data });
    return { ...current, ...data };
  }

  const addData = {
    ...data,
    createdAt: now,
  };
  const addRes = await db.collection('outfit_ai_reviews').add({ data: addData });
  return { ...addData, _id: addRes._id };
}

function buildAiCommentItems(payloadItems, existing, clothes) {
  if (clothes.length > 0) {
    return clothes.map((item) => ({
      type: item.subcategory || item.subCategory || item.category || '',
      color: readColorText(item),
      style: readArray(item.styleTags).join(' / '),
      thickness: item.thickness || '',
      material: item.material || item.materialGuess || '',
    }));
  }

  if (Array.isArray(payloadItems)) {
    return payloadItems.map((item) => ({
      type: item.subcategory || item.subCategory || item.category || '',
      color: readColorText(item),
      style: readArray(item.styleTags).join(' / '),
      thickness: item.thickness || '',
      material: item.material || item.materialGuess || '',
    }));
  }

  return normalizeSnapshotItems(existing?.snapshotItems).map((item) => ({
    type: item.name || item.category || '',
    color: item.color || '',
    style: '',
    thickness: '',
    material: '',
  }));
}

async function callAiCommentModel(input) {
  if (AI_COMMENT_PROVIDER !== 'aliyun-bailian') {
    throw new Error(`unsupported_ai_comment_provider:${AI_COMMENT_PROVIDER}`);
  }

  const apiKey = process.env.BAILIAN_API_KEY || process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('BAILIAN_API_KEY is missing');

  const fetch = require('node-fetch');
  const response = await fetch(`${BAILIAN_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: AI_COMMENT_MODEL,
      messages: [
        { role: 'system', content: buildAiCommentSystemPrompt() },
        { role: 'user', content: JSON.stringify(input) },
      ],
      temperature: 0.45,
      max_tokens: 220,
      stream: false,
      response_format: { type: 'json_object' },
    }),
    timeout: AI_COMMENT_TIMEOUT_MS,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ai_comment_api_error_${response.status}:${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  const parsed = parseLooseJson(content);
  const normalized = normalizeAiComment(parsed);
  if (!normalized) throw new Error('invalid_ai_comment_json');
  return normalized;
}

function buildAiCommentSystemPrompt() {
  return [
    '你是穿搭小程序的短点评助手。',
    '只基于用户给出的结构化穿搭数据生成点评文案。',
    '不要重新选择衣服，不要修改分数，不要参与推荐算法。',
    '中文、年轻化、自然、简短，不要夸张营销腔。',
    '只输出 JSON，不要 Markdown，不要解释过程。',
    'JSON 格式：{"title":"string","reason":"string","styleTags":["string"],"tip":"string"}',
    'title 不超过 12 个中文字符；reason 不超过 80 个中文字符；styleTags 最多 3 个且每个不超过 6 个中文字符；tip 不超过 40 个中文字符。',
  ].join('\n');
}

function parseLooseJson(content) {
  const text = String(content || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
  try {
    return JSON.parse(text);
  } catch (error) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw error;
  }
}

function normalizeAiComment(value) {
  if (!value || typeof value !== 'object') return null;
  const title = limitText(value.title, 12);
  const reason = limitText(value.reason, 80);
  const tip = limitText(value.tip, 40);
  const styleTags = readStringArray(value.styleTags)
    .map((tag) => limitText(tag, 6))
    .filter(Boolean)
    .slice(0, 3);

  if (!title || !reason || !tip) return null;
  return { title, reason, styleTags, tip, generatedAt: value.generatedAt };
}

function limitText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
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

async function saveFavoriteOutfit(id, outfitPayload, aiCommentPayload) {
  const { OPENID } = cloud.getWXContext();
  const now = new Date().toISOString();
  const base = normalizeOutfitPayload(outfitPayload);
  const clothingIds = readBaseClothingIds(base);
  if (!base || clothingIds.length === 0) throw new Error('outfit payload is required');

  const outfitKey = getOutfitKey(clothingIds);
  const existing = await findFavoriteByKey(OPENID, outfitKey);
  const recordData = buildSnapshotRecordData(base, {
    aiComment: aiCommentPayload || base.aiComment,
    outfitKey,
    now,
    source: base.source === 'history' ? 'history' : 'recommendation',
  });

  if (existing) {
    await db.collection('favorite_outfits').doc(existing._id).update({
      data: {
        ...recordData,
        updatedAt: now,
        deletedAt: null,
      },
    });
    return enrichSingleOutfitState(toSnapshotOutfit({ ...existing, ...recordData, updatedAt: now, deletedAt: null }, 'favorite'), {
      openid: OPENID,
      targetDate: base.targetDate,
    });
  }

  const addData = {
    _openid: OPENID,
    userId: OPENID,
    ...recordData,
    createdAt: now,
    updatedAt: now,
  };
  const addRes = await db.collection('favorite_outfits').add({ data: addData });
  return enrichSingleOutfitState(toSnapshotOutfit({ ...addData, _id: addRes._id }, 'favorite'), {
    openid: OPENID,
    targetDate: base.targetDate,
  });
}

async function removeFavoriteOutfit(id, outfitKey) {
  const { OPENID } = cloud.getWXContext();
  if (!id && !outfitKey) throw new Error('favoriteOutfitId is required');
  let favorite = null;

  if (id) {
    try {
      const res = await db.collection('favorite_outfits').doc(id).get();
      if (res.data && res.data._openid === OPENID) favorite = res.data;
    } catch {
      favorite = null;
    }
  }

  if (!favorite && outfitKey) {
    favorite = await findFavoriteByKey(OPENID, outfitKey);
  }

  if (!favorite || favorite.deletedAt) {
    return { success: true, id, outfitKey, alreadyRemoved: true };
  }

  await db.collection('favorite_outfits').doc(favorite._id).remove();
  return { success: true, id: favorite._id, outfitKey: favorite.outfitKey };
}

async function listFavoriteOutfits(event) {
  const { OPENID } = cloud.getWXContext();
  const page = Math.max(Number(event.page || 1), 1);
  const pageSize = Math.min(Math.max(Number(event.pageSize || 10), 1), 50);
  const res = await db.collection('favorite_outfits')
    .where({ _openid: OPENID })
    .orderBy('createdAt', 'desc')
    .limit(500)
    .get();
  const list = (res.data || []).filter((item) => !item.deletedAt);
  const pageList = list.slice((page - 1) * pageSize, page * pageSize);
  const outfits = await enrichOutfitsState(pageList.map((item) => toSnapshotOutfit(item, 'favorite')), {
    openid: OPENID,
    targetDate: new Date().toISOString().slice(0, 10),
  });

  return {
    list: outfits,
    hasMore: page * pageSize < list.length,
    pagination: {
      total: list.length,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(list.length / pageSize)),
    },
  };
}

async function addOutfitHistory(event) {
  const { OPENID } = cloud.getWXContext();
  const now = new Date().toISOString();
  const base = normalizeOutfitPayload(event.outfit);
  const clothingIds = readBaseClothingIds(base);
  if (!base || clothingIds.length === 0) throw new Error('outfit payload is required');

  const source = event.source === 'favorite' ? 'favorite' : 'recommendation';
  const sourceFavoriteOutfitId = source === 'favorite'
    ? event.sourceFavoriteOutfitId || event.id || base.id
    : null;
  const targetDate = event.date || base.targetDate || now.slice(0, 10);
  const outfitKey = getOutfitKey(clothingIds);
  const existingTodayHistory = await findTodayHistoryByKey(OPENID, outfitKey, targetDate);
  if (existingTodayHistory) {
    return enrichSingleOutfitState(toSnapshotOutfit(existingTodayHistory, 'history'), {
      openid: OPENID,
      targetDate,
    });
  }
  const recordData = buildSnapshotRecordData(base, {
    aiComment: event.aiComment || base.aiComment,
    outfitKey,
    now,
    source,
  });
  const addData = {
    _openid: OPENID,
    userId: OPENID,
    ...recordData,
    source,
    sourceFavoriteOutfitId,
    wearDate: targetDate,
    targetDate,
    wornAt: now,
    createdAt: now,
  };

  const addRes = await db.collection('outfit_history').add({ data: addData });
  return enrichSingleOutfitState(toSnapshotOutfit({ ...addData, _id: addRes._id }, 'history'), {
    openid: OPENID,
    targetDate,
  });
}

async function listOutfitHistory(event) {
  const { OPENID } = cloud.getWXContext();
  const page = Math.max(Number(event.page || 1), 1);
  const pageSize = Math.min(Math.max(Number(event.pageSize || 10), 1), 50);
  const res = await db.collection('outfit_history')
    .where({ _openid: OPENID })
    .limit(500)
    .get();
  const list = (res.data || []).sort((a, b) => getHistorySortTime(b) - getHistorySortTime(a));
  const pageList = list.slice((page - 1) * pageSize, page * pageSize);
  const outfits = await enrichOutfitsState(pageList.map((item) => toSnapshotOutfit(item, 'history')), {
    openid: OPENID,
    targetDate: new Date().toISOString().slice(0, 10),
  });

  return {
    list: outfits,
    page,
    pageSize,
    hasMore: page * pageSize < list.length,
    pagination: {
      total: list.length,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(list.length / pageSize)),
    },
  };
}

function getHistorySortTime(item) {
  const value = item?.wornAt || item?.createdAt || '';
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function createRecommendationBatchId(now) {
  return `batch:${now}:${Math.random().toString(36).slice(2, 10)}`;
}

async function enrichOutfitsState(outfits, { openid, targetDate, generatedAt, recommendationBatchId }) {
  const keys = uniqueStrings(outfits.map((outfit) => outfit.outfitKey || getOutfitKey(outfit.clothingIds || [])));
  const [favoriteMap, historyMap, assetMap, aiReviewMap] = await Promise.all([
    findFavoritesByKeys(openid, keys),
    findTodayHistoryByKeys(openid, keys, targetDate),
    findOutfitsByKeys(openid, keys),
    findAiReviewsByKeys(openid, keys),
  ]);

  return outfits.map((outfit) => {
    const clothingIds = outfit.clothingIds || [];
    const outfitKey = outfit.outfitKey || getOutfitKey(clothingIds);
    const favorite = favoriteMap.get(outfitKey);
    const history = historyMap.get(outfitKey);
    const asset = assetMap.get(outfitKey);
    const scene = outfit.scene || asset?.scene || '';
    const aiReview = aiReviewMap.get(getAiReviewMapKey(outfitKey, scene));
    const title = outfit.title || asset?.title;
    const userTitle = readTitle(outfit.userTitle) || readTitle(asset?.userTitle) || undefined;
    const displayTitle = getDisplayTitle({ userTitle, title: title || outfit.displayTitle }, `${outfit.scene || asset?.scene || '今日'}搭配`);
    return {
      ...outfit,
      outfitId: outfit.outfitId || asset?._id || (outfit.outfitKind === 'recommendation' ? outfit.id : undefined),
      outfitKey,
      title,
      userTitle,
      displayTitle,
      isFavorite: Boolean(favorite),
      favoriteOutfitId: favorite?._id || undefined,
      favoritedAt: favorite?.createdAt || favorite?.favoritedAt || undefined,
      isWornToday: Boolean(history),
      todayHistoryId: history?._id || undefined,
      historyId: history?._id || outfit.historyId,
      lastWornAt: history?.wornAt || outfit.lastWornAt || outfit.wornAt,
      wornAt: outfit.wornAt || history?.wornAt,
      wornDate: outfit.wornDate || (history?.wornAt ? String(history.wornAt).slice(0, 10) : undefined),
      recommendationBatchId: outfit.recommendationBatchId || recommendationBatchId,
      generatedAt: outfit.generatedAt || generatedAt,
      aiComment: normalizeAiComment(aiReview?.aiComment) || normalizeAiComment(outfit.aiComment) || undefined,
    };
  });
}

async function enrichSingleOutfitState(outfit, { openid, targetDate }) {
  const enriched = await enrichOutfitsState([outfit], {
    openid,
    targetDate: targetDate || new Date().toISOString().slice(0, 10),
    generatedAt: outfit.generatedAt || outfit.createdAt || new Date().toISOString(),
    recommendationBatchId: outfit.recommendationBatchId,
  });
  return enriched[0];
}

async function findFavoritesByKeys(openid, outfitKeys) {
  const map = new Map();
  const keys = uniqueStrings(outfitKeys);
  if (!keys.length) return map;
  const res = await db.collection('favorite_outfits')
    .where({ _openid: openid, outfitKey: db.command.in(keys) })
    .limit(100)
    .get();
  for (const item of res.data || []) {
    if (item.deletedAt || !item.outfitKey) continue;
    const current = map.get(item.outfitKey);
    if (!current || getHistorySortTime(item) > getHistorySortTime(current)) {
      map.set(item.outfitKey, item);
    }
  }
  return map;
}

async function findOutfitsByKeys(openid, outfitKeys) {
  const map = new Map();
  const keys = uniqueStrings(outfitKeys);
  if (!keys.length) return map;
  const res = await db.collection('outfits')
    .where({ _openid: openid, outfitKey: db.command.in(keys) })
    .limit(100)
    .get();
  for (const item of res.data || []) {
    if (!item.outfitKey) continue;
    map.set(item.outfitKey, item);
  }
  return map;
}

async function findAiReviewsByKeys(openid, outfitKeys) {
  const map = new Map();
  const keys = uniqueStrings(outfitKeys);
  if (!keys.length) return map;
  const res = await db.collection('outfit_ai_reviews')
    .where({ _openid: openid, outfitKey: db.command.in(keys) })
    .limit(500)
    .get();
  for (const item of res.data || []) {
    if (!item.outfitKey) continue;
    const key = getAiReviewMapKey(item.outfitKey, item.scene || '');
    const current = map.get(key);
    if (!current || getAiReviewSortTime(item) > getAiReviewSortTime(current)) {
      map.set(key, item);
    }
  }
  return map;
}

function getAiReviewSortTime(item) {
  const value = item?.updatedAt || item?.generatedAt || item?.createdAt || '';
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function getAiReviewMapKey(outfitKey, scene) {
  return `${outfitKey}::${scene || ''}`;
}

async function findTodayHistoryByKeys(openid, outfitKeys, targetDate) {
  const map = new Map();
  const keys = uniqueStrings(outfitKeys);
  if (!keys.length) return map;
  const res = await db.collection('outfit_history')
    .where({ _openid: openid, outfitKey: db.command.in(keys) })
    .limit(500)
    .get();
  for (const item of res.data || []) {
    if (!item.outfitKey || !isHistoryOnDate(item, targetDate)) continue;
    const current = map.get(item.outfitKey);
    if (!current || getHistorySortTime(item) > getHistorySortTime(current)) {
      map.set(item.outfitKey, item);
    }
  }
  return map;
}

async function findTodayHistoryByKey(openid, outfitKey, targetDate) {
  const map = await findTodayHistoryByKeys(openid, [outfitKey], targetDate);
  return map.get(outfitKey) || null;
}

function isHistoryOnDate(item, targetDate) {
  const candidates = [item.wearDate, item.wornDate, item.targetDate, item.wornAt, item.createdAt].filter(Boolean);
  return candidates.some((value) => String(value).slice(0, 10) === targetDate);
}

async function saveOutfitExposures({ openid, outfits, scene, batchId, shownAt }) {
  const uniqueOutfits = [];
  const seen = new Set();
  for (const outfit of outfits || []) {
    const outfitKey = outfit.outfitKey || getOutfitKey(outfit.clothingIds || []);
    if (!outfitKey || seen.has(outfitKey)) continue;
    seen.add(outfitKey);
    uniqueOutfits.push(outfitKey);
  }

  for (const outfitKey of uniqueOutfits) {
    try {
      await db.collection('outfit_exposures').add({
        data: {
          _openid: openid,
          userId: openid,
          outfitKey,
          scene: scene || '',
          batchId,
          shownAt,
          createdAt: shownAt,
        },
      });
    } catch {
      // Exposure is best-effort telemetry and must not block recommendations.
    }
  }
}

function uniqueStrings(values) {
  return [...new Set((values || []).filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

async function getFavoriteOutfitById(id) {
  const { OPENID } = cloud.getWXContext();
  if (!id) throw new Error('id is required');
  const res = await db.collection('favorite_outfits').doc(id).get();
  if (!res.data || res.data._openid !== OPENID || res.data.deletedAt) throw new Error('favorite outfit not found');
  return enrichSingleOutfitState(toSnapshotOutfit(res.data, 'favorite'), { openid: OPENID });
}

async function getHistoryById(id) {
  const { OPENID } = cloud.getWXContext();
  if (!id) throw new Error('id is required');
  const res = await db.collection('outfit_history').doc(id).get();
  if (!res.data || res.data._openid !== OPENID) throw new Error('history record not found');
  return enrichSingleOutfitState(toSnapshotOutfit(res.data, 'history'), { openid: OPENID });
}

async function findFavoriteByKey(openid, outfitKey) {
  const res = await db.collection('favorite_outfits')
    .where({ _openid: openid, outfitKey })
    .limit(1)
    .get();
  return res.data[0] || null;
}

function buildSnapshotRecordData(base, { aiComment, outfitKey, now, source }) {
  const clothingIds = readBaseClothingIds(base);
  const itemsSnapshot = buildDetailedSnapshotItems(clothingIds, base);
  const reason = base.reasoning || base.reason || '';
  const normalizedAiComment = normalizeAiComment(aiComment);
  const fallbackTitle = `${base.scene || '今日'}搭配`;

  return {
    title: base.title || fallbackTitle,
    userTitle: readTitle(base.userTitle),
    displayTitle: getDisplayTitle(base, fallbackTitle),
    outfitId: base.outfitId || base.id,
    clothingIds,
    outfitKey,
    itemsSnapshot,
    snapshotItems: itemsSnapshot.map((item) => ({
      itemId: item.clothingId,
      name: item.name || item.category || '衣服',
      category: item.category || 'other',
      color: item.color || '',
      thumbnailUrl: item.displayImageUrl || item.imageUrl || '',
      isDeleted: Boolean(item.deletedAt),
    })),
    scene: base.scene,
    targetDate: base.targetDate,
    timeOfDay: base.timeOfDay || 'all_day',
    weather: base.weatherSnapshot || base.weather || fallbackWeather(),
    weatherSnapshot: base.weatherSnapshot || base.weather || fallbackWeather(),
    scores: sanitizeScores(base.scores || {}),
    scoreExplanations: Array.isArray(base.scoreExplanations) ? base.scoreExplanations : [],
    generationType: base.generationType || 'auto',
    source: source || base.source || 'recommendation',
    reason,
    reasoning: reason,
    ...(normalizedAiComment ? { aiComment: normalizedAiComment.generatedAt ? normalizedAiComment : { ...normalizedAiComment, generatedAt: now } } : {}),
  };
}

function buildDetailedSnapshotItems(clothingIds, base) {
  const snapshots = [
    ...normalizeDetailedSnapshotItems(base?.itemsSnapshot),
    ...normalizeDetailedSnapshotItems(base?.snapshotItems),
    ...normalizeDetailedPayloadItems(base?.items),
  ];
  const snapshotMap = new Map(snapshots.map((item) => [item.clothingId, item]));

  return clothingIds.map((id) => {
    const snapshot = snapshotMap.get(id);
    return {
      clothingId: id,
      itemId: id,
      type: snapshot?.type || snapshot?.category || 'other',
      category: snapshot?.category || 'other',
      color: snapshot?.color || '',
      style: snapshot?.style || '',
      thickness: snapshot?.thickness || '',
      material: snapshot?.material || '',
      imageUrl: snapshot?.imageUrl || snapshot?.displayImageUrl || '',
      displayImageUrl: snapshot?.displayImageUrl || snapshot?.imageUrl || '',
      name: snapshot?.name || snapshot?.category || '衣服',
      deletedAt: snapshot?.deletedAt || null,
    };
  });
}

function normalizeDetailedSnapshotItems(value) {
  return Array.isArray(value)
    ? value
        .map((item) => {
          const clothingId = item && (item.clothingId || item.itemId);
          if (!clothingId || typeof clothingId !== 'string') return null;
          return {
            clothingId,
            itemId: clothingId,
            type: item.type || item.subcategory || item.name || item.category || 'other',
            category: item.category || item.type || 'other',
            color: item.color || '',
            style: item.style || readArray(item.styleTags).join(' / '),
            thickness: item.thickness || '',
            material: item.material || '',
            imageUrl: item.imageUrl || item.thumbnailUrl || item.displayImageUrl || '',
            displayImageUrl: item.displayImageUrl || item.thumbnailUrl || item.imageUrl || '',
            name: item.name || item.subcategory || item.category || '衣服',
            deletedAt: item.deletedAt || (item.isDeleted ? new Date().toISOString() : null),
          };
        })
        .filter(Boolean)
    : [];
}

function normalizeDetailedPayloadItems(value) {
  return Array.isArray(value)
    ? value
        .filter((item) => item && typeof item.clothingId === 'string')
        .map((item) => ({
          clothingId: item.clothingId,
          itemId: item.clothingId,
          type: item.subcategory || item.category || 'other',
          category: item.category || 'other',
          color: readColorText(item),
          style: readArray(item.styleTags).join(' / '),
          thickness: item.thickness || '',
          material: item.material || item.materialGuess || '',
          imageUrl: item.imageUrl || '',
          displayImageUrl: item.displayImageUrl || item.imageUrl || '',
          name: item.name || item.subcategory || item.category || '衣服',
          deletedAt: item.deletedAt || (item.isDeleted ? new Date().toISOString() : null),
        }))
    : [];
}

function toSnapshotOutfit(item, kind) {
  const itemsSnapshot = buildDetailedSnapshotItems(item.clothingIds || [], {
    itemsSnapshot: item.itemsSnapshot,
    snapshotItems: item.snapshotItems,
    items: item.items,
  });
  const snapshotItems = itemsSnapshot.map((snapshot) => ({
    itemId: snapshot.clothingId,
    name: snapshot.name || snapshot.category || '衣服',
    category: snapshot.category || 'other',
    color: snapshot.color || '',
    thumbnailUrl: snapshot.displayImageUrl || snapshot.imageUrl || '',
    isDeleted: Boolean(snapshot.deletedAt),
  }));
  const deletedItemCount = itemsSnapshot.filter((snapshot) => snapshot.deletedAt).length;

  return {
    id: item._id,
    outfitId: item.outfitId || (kind === 'recommendation' ? item._id : undefined),
    userId: item._openid || item.userId,
    title: item.title,
    userTitle: readTitle(item.userTitle) || undefined,
    displayTitle: getDisplayTitle(item, `${item.scene || '今日'}搭配`),
    clothingIds: item.clothingIds || itemsSnapshot.map((snapshot) => snapshot.clothingId),
    outfitKey: item.outfitKey || getOutfitKey(item.clothingIds || []),
    outfitKind: kind,
    itemsSnapshot,
    snapshotItems,
    incomplete: deletedItemCount > 0,
    deletedItemCount,
    items: itemsSnapshot.map((snapshot) => ({
      clothingId: snapshot.clothingId,
      category: snapshot.category || 'other',
      subcategory: snapshot.name || snapshot.type || snapshot.category,
      imageUrl: snapshot.displayImageUrl || snapshot.imageUrl || '',
      colorPalette: snapshot.color ? [{ name: snapshot.color, hex: '' }] : [],
      isDeleted: Boolean(snapshot.deletedAt),
    })),
    scene: item.scene,
    targetDate: item.targetDate,
    timeOfDay: item.timeOfDay,
    weatherSnapshot: item.weatherSnapshot || item.weather,
    scores: sanitizeScores(item.scores || {}),
    scoreExplanations: item.scoreExplanations || [],
    generationType: item.generationType || 'auto',
    sourceItemId: item.sourceItemId,
    source: item.source || (kind === 'history' ? 'recommendation' : 'recommendation'),
    sourceFavoriteOutfitId: item.sourceFavoriteOutfitId || undefined,
    favoriteOutfitId: kind === 'favorite' ? item._id : item.favoriteOutfitId || item.sourceFavoriteOutfitId || undefined,
    isFavorite: kind === 'favorite',
    favoritedAt: kind === 'favorite' ? item.createdAt : undefined,
    wornAt: item.wornAt || undefined,
    wornDate: item.wornAt ? String(item.wornAt).slice(0, 10) : undefined,
    isWornToday: kind === 'history' && isHistoryOnDate(item, new Date().toISOString().slice(0, 10)),
    todayHistoryId: kind === 'history' && isHistoryOnDate(item, new Date().toISOString().slice(0, 10)) ? item._id : undefined,
    historyId: kind === 'history' ? item._id : undefined,
    lastWornAt: item.wornAt || undefined,
    recommendationBatchId: item.recommendationBatchId || undefined,
    generatedAt: item.generatedAt || undefined,
    styleTags: readSnapshotStyleTags(itemsSnapshot),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt || item.createdAt,
    reason: item.reason || item.reasoning,
    reasoning: item.reasoning || item.reason,
    aiComment: normalizeAiComment(item.aiComment) || undefined,
  };
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
  const aiComment = normalizeAiComment(base.aiComment || current?.aiComment);
  const title = base.title || current?.title || `${base.scene || current?.scene || '今日'}搭配`;
  const userTitle = readTitle(current?.userTitle) || readTitle(base.userTitle);

  return {
    title,
    userTitle,
    displayTitle: getDisplayTitle({ userTitle, title }, `${base.scene || current?.scene || '今日'}搭配`),
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
    recommendationBatchId: base.recommendationBatchId || current?.recommendationBatchId,
    generatedAt: base.generatedAt || current?.generatedAt,
    styleTags: readStringArray(base.styleTags).length ? readStringArray(base.styleTags) : readSnapshotStyleTags(snapshotItems),
    reason,
    reasoning: reason,
    ...(aiComment ? { aiComment } : {}),
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

function readClothingIdsFromItems(items) {
  return Array.isArray(items)
    ? items.map((item) => item && (item.clothingId || item.itemId)).filter((id) => typeof id === 'string' && id.trim())
    : [];
}

function readClothingIdsFromSnapshotItems(items) {
  return Array.isArray(items)
    ? items.map((item) => item && (item.clothingId || item.itemId)).filter((id) => typeof id === 'string' && id.trim())
    : [];
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
    id: payload.id,
    title: payload.title,
    clothingIds: Array.isArray(payload.clothingIds) ? payload.clothingIds : [],
    itemsSnapshot: Array.isArray(payload.itemsSnapshot) ? payload.itemsSnapshot : [],
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
    outfitKey: payload.outfitKey,
    outfitId: payload.outfitId,
    userTitle: payload.userTitle,
    displayTitle: payload.displayTitle,
    favoriteOutfitId: payload.favoriteOutfitId,
    todayHistoryId: payload.todayHistoryId,
    historyId: payload.historyId,
    lastWornAt: payload.lastWornAt,
    recommendationBatchId: payload.recommendationBatchId,
    generatedAt: payload.generatedAt,
    styleTags: readStringArray(payload.styleTags),
    aiComment: normalizeAiComment(payload.aiComment),
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
    outfitKey: getOutfitKey(clothingIds),
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
    favoriteOutfitId: undefined,
    todayHistoryId: undefined,
    historyId: undefined,
    lastWornAt: undefined,
    recommendationBatchId: context.recommendationBatchId,
    generatedAt: context.now,
    styleTags: uniqueStrings(recommendation.items.flatMap((item) => readArray(item.styleTags))),
    reasoning: recommendation.reasoning,
    createdAt: context.now,
    updatedAt: context.now,
  };

  return toOutfit(data, recommendation.items);
}

function generateRuleRecommendations({
  clothes,
  scene,
  weather,
  recommendationProfile,
  excludeClothingIdSets,
  excludedOutfitKeys,
  maxResults,
}) {
  const tempConfig = getTemperatureConfig(Number(weather.temp || weather.temperature || 22));
  const filtered = clothes
    .filter((item) => item && item._id)
    .filter((item) => matchesSeason(item, tempConfig))
    .filter((item) => matchesTemperature(item, tempConfig));
  const grouped = groupClothes(filtered);
  const combos = generateCandidateCombos(grouped);
  const excluded = new Set([
    ...(excludeClothingIdSets || []).filter(Array.isArray).map((ids) => signature(ids)),
    ...readStringArray(excludedOutfitKeys),
  ]);
  const limit = Math.min(Math.max(Number(maxResults || 8), 1), 8);

  const scored = combos
    .map((items) => scoreCandidate(items, { scene, tempConfig, weather, recommendationProfile }))
    .map((rec) => {
      const outfitKey = signature(rec.items.map((item) => item._id));
      return {
        ...rec,
        outfitKey,
        rankingScore: buildRankingScore(rec),
      };
    });
  const available = scored.filter((rec) => !excluded.has(rec.outfitKey));
  const sortedAvailable = available.slice().sort((a, b) => b.rankingScore - a.rankingScore);

  const results = [];
  const used = [];
  for (const rec of sortedAvailable) {
    if (results.length >= limit) break;
    const ids = rec.items.map((item) => item._id);
    const tooSimilar = used.some((existingIds) => overlapRatio(existingIds, ids) > 0.5);
    if (!tooSimilar) {
      results.push(rec);
      used.push(ids);
    }
  }

  if (results.length < limit) {
    for (const rec of sortedAvailable) {
      if (results.length >= limit) break;
      if (!results.some((item) => item.outfitKey === rec.outfitKey)) {
        results.push(rec);
      }
    }
  }

  results.debug = {
    candidateCount: scored.length,
    filteredCandidateCount: available.length,
  };
  results.limited = results.length < limit || available.length < limit;
  results.exhausted = available.length === 0 && excluded.size > 0;
  return results;
}

function buildRankingScore(rec) {
  const scores = rec.scores || {};
  const weather = Number(scores.weatherAdaptation || 0);
  const scene = Number(scores.sceneMatch || 0);
  const total = Number(scores.total || 0);
  const base = weather * 0.38 + scene * 0.32 + total * 0.3;
  const jitter = (Math.random() - 0.5) * 0.45;
  return base + jitter;
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
  const sceneMatchInfo = getSceneMatchInfo(scenes, context.scene);
  const sceneMatch = sceneMatchInfo.score;
  const freshness = scoreFreshness(items);
  const preference = scorePreference(items, styles, context.recommendationProfile);
  const warmth = scoreWarmth(items);
  const coolness = scoreCoolness(items);
  const fashion = round1((styleUnity * 0.7) + (avg(items.map((item) => Number(item.fashionScore || 0)).filter(Boolean)) || 7) * 0.3);
  const comfort = round1((weatherAdaptation * 0.7) + (coolness * 0.15) + (warmth * 0.15));
  const total = round1(
    weatherAdaptation * 0.25 +
    colorHarmony * 0.15 +
    styleUnity * 0.15 +
    sceneMatch * 0.3 +
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
    matchedScene: sceneMatchInfo.matchedScene,
    title: buildTitle(items, context.scene),
    scores,
    scoreExplanations: buildScoreExplanations(scores, context.tempConfig, context.scene),
    reasoning: buildFriendlyReasoning(context.scene, items, scores, context.tempConfig),
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

function getSceneMatchInfo(scenes, scene) {
  if (!scene) return { score: 7, matchedScene: '' };
  if (!scenes.length) return { score: 5, matchedScene: '' };
  if (scenes.includes(scene)) return { score: 9, matchedScene: scene };
  const related = {
    上班: ['开会', '正式', '通勤'],
    开会: ['上班', '正式', '通勤'],
    约会: ['聚会', '逛街'],
    逛街: ['约会', '出游', '日常'],
    出游: ['逛街', '运动', '日常'],
    居家: ['日常', '休闲'],
    运动: ['出游', '休闲'],
  };
  const matchedScene = scenes.find((item) => (related[scene] || []).includes(item)) || '';
  return matchedScene ? { score: 7, matchedScene } : { score: 5, matchedScene: '' };
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

function buildFriendlyReasoning(scene, items, scores, tempConfig) {
  if (!items.length) return buildTemplateReasoning(scene, items, scores, tempConfig);
  const style = getMainStyle(items);
  const sceneText = scene || '日常';
  const itemNames = items
    .map((item) => item.customName || item.subCategory || item.subcategory || item.category)
    .filter(Boolean)
    .slice(0, 2)
    .join('、');
  const opening =
    scores.sceneMatch >= 8
      ? `这套很贴合${sceneText}节奏，${style}感会显得自然又利落。`
      : `这套更偏轻松耐看的${style}感，用在${sceneText}也不突兀。`;
  const weatherText =
    scores.weatherAdaptation >= 8
      ? '厚薄和透气度都比较稳，今天穿起来会舒服一些。'
      : `${tempConfig.advice}，这套可以作为备选灵感。`;
  const colorText =
    scores.colorHarmony >= 8
      ? '配色干净，单品放在一起不会抢戏。'
      : '颜色有一点层次感，搭配时保持配饰简单会更清爽。';
  const itemText = itemNames ? `${itemNames}把整体气质撑起来，` : '';
  const variants = [
    `${itemText}${opening}${weatherText}`,
    `${opening}${colorText}`,
    `${itemText}${colorText}${weatherText}`,
  ];
  const index = Math.abs(
    signature(items.map((item) => item._id))
      .split('')
      .reduce((sum, char) => sum + char.charCodeAt(0), 0),
  ) % variants.length;
  return variants[index];
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

function readSnapshotStyleTags(items) {
  return uniqueStrings((items || []).flatMap((item) => String(item.style || '').split(/[,/，、\s]+/)));
}

function readStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()) : [];
}

function sameIdSet(a, b) {
  return signature(a) === signature(b);
}

function signature(ids) {
  return ids.slice().sort().join('_');
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
    outfitId: item.outfitId || item._id,
    userId: item._openid,
    title: item.title,
    userTitle: readTitle(item.userTitle) || undefined,
    displayTitle: getDisplayTitle(item, `${item.scene || '今日'}搭配`),
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
    favoriteOutfitId: item.favoriteOutfitId || undefined,
    favoritedAt: item.favoritedAt || undefined,
    wornAt: item.wornAt || undefined,
    wornDate: item.wornDate || undefined,
    isWornToday: Boolean(item.isWornToday) || item.wornDate === today,
    todayHistoryId: item.todayHistoryId || undefined,
    historyId: item.historyId || undefined,
    lastWornAt: item.lastWornAt || item.wornAt || undefined,
    recommendationBatchId: item.recommendationBatchId || undefined,
    generatedAt: item.generatedAt || undefined,
    styleTags: readSnapshotStyleTags(snapshotItems),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    reasoning: item.reasoning || item.reason,
    aiComment: normalizeAiComment(item.aiComment) || undefined,
  };
}

function normalizeUserTitleInput(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validateUserTitle(value) {
  if (!value) return;
  if (Array.from(value).length > 20) {
    throw new Error('穿搭名称最多 20 个字');
  }
}

function readTitle(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getDisplayTitle(outfit, fallback) {
  return readTitle(outfit?.displayTitle) || readTitle(outfit?.userTitle) || readTitle(outfit?.title) || fallback;
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
