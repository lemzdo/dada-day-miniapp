const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const { attachAestheticEvaluation } = require('./services/aestheticCompatibility');
const { loadActiveWardrobe } = require('./services/loadActiveWardrobe');
const {
  logAestheticShadowTelemetry,
  parseAestheticShadowSampleRate,
} = require('./services/aestheticShadowTelemetry');
const {
  createAiReviewServiceError,
  getAiReviewInternalErrorCode,
  getSafeAiReviewMessage,
  isAiReviewServiceError,
  mapAiReviewErrorCode,
} = require('./services/aiReviewErrorPolicy');
const { buildStylistEvidenceV1 } = require('./services/stylistEvidence');
const {
  COPY_POLICY_VERSION,
  STYLIST_PROMPT_VERSION,
  STYLIST_REVIEW_VERSION,
  VOICE_POLICY_VERSION,
  buildRuleFallbackExplanationV2,
  buildStylistPromptV2,
  buildStylistReviewDocument,
  parseStylistExplanationJson,
  toLegacyAiComment,
  validateStylistExplanationV2,
} = require('./services/stylistExplanationV2');
const { compileRecommendationLanguageV3 } = require('./services/recommendationLanguageV3');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const DELETED_STATUS = 'deleted';
const AI_REVIEW_COLLECTION = 'outfit_ai_reviews';
const AI_COMMENT_PROMPT_VERSION = STYLIST_PROMPT_VERSION;
const BAILIAN_BASE_URL = process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const AI_COMMENT_PROVIDER = process.env.AI_COMMENT_PROVIDER || 'aliyun-bailian';
const AI_COMMENT_MODEL = process.env.AI_COMMENT_MODEL || 'qwen-flash';
const AI_COMMENT_TIMEOUT_MS = Number(process.env.AI_COMMENT_TIMEOUT_MS || 5000);
const AI_COMMENT_LEASE_TIMEOUT_MS = Math.max(AI_COMMENT_TIMEOUT_MS + 5000, 10000);
const AI_COMMENT_FORCE_COOLDOWN_MS = 5 * 1000;

exports.main = async (event = {}) => {
  const action = event.action || 'generate';
  try {
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
    if (action === 'getAiComment') return ok(await getAiComment(event));
    if (action === 'aiComment') return ok(await generateAiComment(event));

    return ok(await generate(event));
  } catch (error) {
    const isAiReviewAction = action === 'getAiComment' || action === 'aiComment';
    console.error(
      isAiReviewAction ? '[generateOutfit] aiReview failed' : '[generateOutfit] failed',
      isAiReviewAction ? { code: getAiReviewInternalErrorCode(error) } : error,
    );
    if (isAiReviewAction) {
      return fail(createSafeAiReviewClientError(mapAiReviewErrorCode(error)));
    }
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
  const clothes = await loadActiveWardrobe({ database: db, openid: OPENID });
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

  const tempOutfits = compileRecommendationLanguageV3({
    outfits: recommendations.map((recommendation) =>
      toTempOutfit(recommendation, {
        openid: OPENID,
        scene,
        targetDate,
        timeOfDay: event.timeOfDay || 'all_day',
        weather,
        now,
        recommendationBatchId,
      }),
    ),
    scene,
    weather,
  });
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
  logAestheticShadowTelemetry({
    sampleRate: parseAestheticShadowSampleRate(process.env.AESTHETIC_SHADOW_LOG_SAMPLE_RATE),
    seed: recommendationBatchId,
    outfits: hydratedOutfits,
    scene,
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

async function getAiComment(event) {
  const context = await buildAiCommentContext(event);
  const review = await readAiReview(context.reviewId);
  return buildAiReviewResponse(context, review, {
    cacheHit: isReadyAiReview(review, context),
    saved: false,
  });
}

async function generateAiComment(event) {
  let context = null;
  let lease = null;
  const startedAt = Date.now();

  try {
    context = await buildAiCommentContext(event);
    const forceRegenerate = event.forceRegenerate === true;
    lease = await acquireAiReviewLease(context, { forceRegenerate });

    if (lease.cacheHit || lease.inProgress || lease.cooldown) {
      return buildAiReviewResponse(context, lease.review, {
        cacheHit: Boolean(lease.cacheHit),
        saved: false,
        inProgress: Boolean(lease.inProgress),
        cooldown: Boolean(lease.cooldown),
        retryAfterMs: lease.retryAfterMs,
        errorCode: lease.inProgress ? 'AI_REVIEW_IN_PROGRESS' : lease.cooldown ? 'AI_REVIEW_COOLDOWN' : undefined,
      });
    }

    const aiComment = await callAiCommentModel(context.evidenceInput);
    const finishResult = await finishAiReviewSuccess(context, lease.generationToken, aiComment);
    const review = finishResult.review || await readAiReview(context.reviewId);
    return buildAiReviewResponse(context, review, {
      cacheHit: false,
      saved: finishResult.saved,
      inProgress: finishResult.superseded && review?.status === 'generating',
      superseded: finishResult.superseded,
    });
  } catch (error) {
    console.warn('[generateOutfit] aiComment fallback', {
      action: 'aiComment',
      durationMs: Date.now() - startedAt,
      reviewId: context ? shortHash(context.reviewId) : '',
      code: getAiReviewInternalErrorCode(error),
    });
    if (context && lease?.generationToken) {
      await finishAiReviewFailure(context, lease.generationToken).catch(() => false);
    }
    const review = context ? await readAiReview(context.reviewId).catch(() => null) : null;
    const errorCode = mapAiReviewErrorCode(error);
    return {
      ...buildAiReviewResponse(context, review, {
        cacheHit: false,
        saved: false,
        fallback: true,
        errorCode,
      }),
      success: false,
      message: getSafeAiReviewMessage(errorCode),
    };
  }
}

async function buildAiCommentContext(event) {
  const { OPENID } = cloud.getWXContext();
  const payload = normalizeOutfitPayload(event.outfit);
  const payloadIds = uniqueStrings([
    ...readBaseClothingIds(payload),
    ...readStringArray(event.clothingIds),
  ]);
  const requestedScene = normalizeAiCommentScene(event.scene || payload?.scene);
  const requestedOutfitKey = normalizeOutfitKey(event.outfitKey || payload?.outfitKey);
  const payloadOutfitKey = payloadIds.length > 0 ? getOutfitKey(payloadIds) : '';
  if (requestedOutfitKey && payloadOutfitKey && requestedOutfitKey !== payloadOutfitKey) {
    throw new Error('invalid_outfit_key');
  }

  const lookupOutfitKey = requestedOutfitKey || payloadOutfitKey;
  if (!lookupOutfitKey) throw new Error('outfit identity is required');

  const assetSource = await findAuthoritativeAiCommentAsset(OPENID, event, payload, lookupOutfitKey, requestedScene);
  const source = assetSource
    ? await buildAiCommentSourceFromOutfitAsset(OPENID, assetSource.asset, requestedScene, {
        useSnapshotItems: assetSource.kind === 'favorite' || assetSource.kind === 'history',
      })
    : await buildAiCommentSourceFromOwnedClothes(OPENID, payload, {
        outfitKey: lookupOutfitKey,
        scene: requestedScene,
        weather: event.weather,
        scores: event.scores,
        aestheticEvaluation: event.aestheticEvaluation,
        reason: event.reason,
      });
  if (!source.aestheticEvaluation && payload?.aestheticEvaluation) {
    source.aestheticEvaluation = payload.aestheticEvaluation;
  }
  if (!source.scene) throw new Error('scene is required');

  const evidenceInput = buildStylistEvidenceV1({
    outfit: {
      clothingIds: source.clothingIds,
      items: source.items,
      scene: source.scene,
      weatherSnapshot: source.weather,
      scores: source.scores,
      styleTags: source.styleTags,
      aestheticEvaluation: source.aestheticEvaluation,
    },
    scene: source.scene,
    weather: source.weather,
  });
  const inputHash = evidenceInput.inputDigest;
  const reviewId = getAiReviewId(OPENID, source.outfitKey, source.scene);

  return {
    openid: OPENID,
    reviewId,
    outfitKey: source.outfitKey,
    scene: source.scene,
    inputHash,
    inputDigest: evidenceInput.inputDigest,
    evidenceInput,
    evidenceVersion: evidenceInput.evidenceVersion,
    promptVersion: AI_COMMENT_PROMPT_VERSION,
    reviewVersion: STYLIST_REVIEW_VERSION,
    copyPolicyVersion: COPY_POLICY_VERSION,
    voicePolicyVersion: VOICE_POLICY_VERSION,
    provider: AI_COMMENT_PROVIDER,
    model: AI_COMMENT_MODEL,
  };
}

async function buildAiCommentSourceFromOutfitAsset(openid, asset, requestedScene, { useSnapshotItems = false } = {}) {
  const clothingIds = uniqueStrings(asset.clothingIds || []);
  const outfitKey = getOutfitKey(clothingIds);
  if (!outfitKey) throw new Error('outfit asset has no clothing ids');
  const scene = normalizeAiCommentScene(asset.scene || requestedScene);
  const clothes = useSnapshotItems ? [] : await loadClothesByIds(openid, clothingIds);
  const items = buildAiCommentItemsFromAsset(asset, clothes, { useSnapshotItems });
  if (!items.length) throw new Error('outfit asset has no comment items');

  return {
    outfitKey,
    scene,
    weather: normalizeWeather(asset.weatherSnapshot || asset.weather) || null,
    items,
    clothingIds,
    scores: sanitizeScores(asset.scores || {}),
    styleTags: readStringArray(asset.styleTags),
    aestheticEvaluation: asset.aestheticEvaluation,
    reason: normalizeAiCommentReason(asset.reasoning || asset.reason),
  };
}

async function buildAiCommentSourceFromOwnedClothes(openid, payload, fallback) {
  const clothingIds = uniqueStrings(readBaseClothingIds(payload));
  if (!clothingIds.length) throw new Error('clothing ids are required');
  const outfitKey = getOutfitKey(clothingIds);
  if (fallback.outfitKey && fallback.outfitKey !== outfitKey) throw new Error('invalid_outfit_key');

  const clothes = await loadClothesByIds(openid, clothingIds);
  assertOwnedClothes(clothingIds, clothes);
  const scene = normalizeAiCommentScene(fallback.scene || payload?.scene);

  return {
    outfitKey,
    scene,
    weather: normalizeWeather(fallback.weather || payload?.weatherSnapshot || payload?.weather) || null,
    items: buildAiCommentItemsFromClothes(clothes),
    clothingIds,
    scores: sanitizeScores(fallback.scores || payload?.scores || {}),
    styleTags: readStringArray(payload?.styleTags),
    aestheticEvaluation: fallback.aestheticEvaluation || payload?.aestheticEvaluation,
    reason: normalizeAiCommentReason(fallback.reason || payload?.reasoning || payload?.reason),
  };
}

function buildAiCommentItemsFromAsset(asset, clothes, { useSnapshotItems = false } = {}) {
  const clothesMap = new Map((clothes || []).map((item) => [item._id, item]));
  const snapshots = buildDetailedSnapshotItems(asset.clothingIds || [], {
    itemsSnapshot: asset.itemsSnapshot,
    snapshotItems: asset.snapshotItems,
    items: asset.items,
  });
  return snapshots
    .map((snapshot) => {
      const clothing = clothesMap.get(snapshot.clothingId);
      if (!useSnapshotItems && clothing && clothing.status !== DELETED_STATUS) {
        return buildAiCommentItemFromClothing(clothing);
      }
      return {
        id: snapshot.clothingId,
        type: limitText(snapshot.name || snapshot.type || snapshot.category, 24),
        color: limitText(snapshot.color, 24),
        style: limitText(snapshot.style, 48),
        thickness: limitText(snapshot.thickness, 24),
        material: limitText(snapshot.material, 24),
      };
    })
    .filter((item) => item.id)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function buildAiCommentItemsFromClothes(clothes) {
  return (clothes || [])
    .map(buildAiCommentItemFromClothing)
    .filter((item) => item.id)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function buildAiCommentItemFromClothing(item) {
  return {
    id: item._id,
    clothingId: item._id,
    category: item.category || '',
    subcategory: item.subcategory || item.subCategory || '',
    type: limitText(item.subcategory || item.subCategory || item.category || '', 24),
    color: limitText(readColorText(item), 24),
    colorPalette: Array.isArray(item.colorPalette) ? item.colorPalette : [],
    style: limitText(readArray(item.styleTags).join(' / '), 48),
    styleTags: readStringArray(item.styleTags),
    thickness: limitText(item.thickness || '', 24),
    material: limitText(item.material || item.materialGuess || '', 24),
    fit: item.fit,
    length: item.length,
    silhouette: item.silhouette,
    patternType: item.patternType,
    designElements: item.designElements,
    formalityLevel: item.formalityLevel,
    aestheticFeatures: item.aestheticFeatures,
  };
}

async function callAiCommentModel(input) {
  if (AI_COMMENT_PROVIDER !== 'aliyun-bailian') {
    throw createAiReviewServiceError('AI_REVIEW_PROVIDER_NOT_CONFIGURED');
  }

  const apiKey = process.env.BAILIAN_API_KEY || process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw createAiReviewServiceError('AI_REVIEW_PROVIDER_NOT_CONFIGURED');

  const fetch = require('node-fetch');
  const prompt = buildStylistPromptV2(input);
  const response = await fetch(`${BAILIAN_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: AI_COMMENT_MODEL,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      temperature: 0.3,
      max_tokens: 700,
      stream: false,
      response_format: { type: 'json_object' },
    }),
    timeout: AI_COMMENT_TIMEOUT_MS,
  });

  if (!response.ok) {
    const text = await response.text();
    throw createAiReviewServiceError(
      'AI_REVIEW_PROVIDER_UNAVAILABLE',
      new Error(`ai_comment_api_error_${response.status}:${text.slice(0, 200)}`),
    );
  }

  const data = await response.json();
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  try {
    const parsed = parseStylistExplanationJson(content);
    const explanation = validateStylistExplanationV2(parsed, input, {
      provider: AI_COMMENT_PROVIDER,
      model: AI_COMMENT_MODEL,
      generatedAt: new Date().toISOString(),
    });
    return toLegacyAiComment(explanation);
  } catch (error) {
    const fallback = buildRuleFallbackExplanationV2(input, {
      provider: AI_COMMENT_PROVIDER,
      model: AI_COMMENT_MODEL,
      generatedAt: new Date().toISOString(),
    });
    return toLegacyAiComment(fallback);
  }
}

function normalizeAiComment(value) {
  if (!value || typeof value !== 'object') return null;
  const title = limitText(value.title, 16);
  const reason = limitText(value.reason, 160);
  const tip = limitText(value.tip, 80);
  const styleTags = readStringArray(value.styleTags)
    .map((tag) => limitText(tag, 12))
    .filter(Boolean)
    .slice(0, 5);

  if (!reason || !tip) return null;
  return {
    title,
    reason,
    styleTags,
    tip,
    generatedAt: value.generatedAt,
    ...(value.reviewVersion ? { reviewVersion: value.reviewVersion } : {}),
    ...(value.promptVersion ? { promptVersion: value.promptVersion } : {}),
    ...(value.copyPolicyVersion ? { copyPolicyVersion: value.copyPolicyVersion } : {}),
    ...(value.voicePolicyVersion ? { voicePolicyVersion: value.voicePolicyVersion } : {}),
    ...(value.inputDigest ? { inputDigest: value.inputDigest } : {}),
    ...(value.source ? { source: value.source } : {}),
    ...(value.overallComment ? { overallComment: limitText(value.overallComment, 120) } : {}),
    ...(value.advice ? { advice: limitText(value.advice, 80) } : {}),
    ...(value.explanationV2 ? { explanationV2: value.explanationV2 } : {}),
  };
}

function normalizeAestheticEvaluationForStorage(value) {
  if (!value || typeof value !== 'object') return undefined;
  const score = value.score === null ? null : normalizeFiniteNumber(value.score);
  const coverage = normalizeFiniteNumber(value.coverage);
  const evidence = Array.isArray(value.evidence)
    ? value.evidence
        .filter((entry) => entry && typeof entry.code === 'string')
        .map((entry) => ({
          code: entry.code,
          polarity: ['positive', 'negative', 'neutral'].includes(entry.polarity) ? entry.polarity : 'neutral',
          strength: Math.max(1, Math.min(3, Math.round(Number(entry.strength) || 1))),
          itemIds: readStringArray(entry.itemIds).sort(),
          ...(entry.data && typeof entry.data === 'object' ? { data: sanitizePlainObject(entry.data) } : {}),
        }))
    : [];
  return {
    version: value.version || 1,
    engineVersion: value.engineVersion || 'aesthetic-compat-v1',
    score,
    coverage: coverage === null ? 0 : coverage,
    dimensions: value.dimensions && typeof value.dimensions === 'object' ? sanitizePlainObject(value.dimensions) : {},
    evidence,
  };
}

function sanitizePlainObject(value) {
  return JSON.parse(JSON.stringify(value, (_key, entry) => {
    if (typeof entry === 'number' && !Number.isFinite(entry)) return null;
    if (typeof entry === 'function' || typeof entry === 'undefined') return undefined;
    return entry;
  }));
}

async function findAuthoritativeAiCommentAsset(openid, event, payload, outfitKey, scene) {
  const detailSource = normalizeAiCommentDetailSource(event.detailSource || payload?.outfitKind);
  const detailId = normalizeOutfitKey(event.detailId || payload?.id);
  const collectionName = {
    recommendation: 'outfits',
    favorite: 'favorite_outfits',
    history: 'outfit_history',
  }[detailSource];

  if (collectionName && detailId) {
    const exact = await readDocumentOrNull(db.collection(collectionName).doc(detailId));
    if (!exact || exact._openid !== openid) throw new Error('outfit detail asset not found');
    assertAiCommentAssetIdentity(exact, outfitKey, scene);
    return { asset: exact, kind: detailSource };
  }

  const res = await db.collection('outfits')
    .where({ _openid: openid, outfitKey })
    .limit(100)
    .get();
  const candidates = (res.data || [])
    .filter((item) => !scene || normalizeAiCommentScene(item.scene) === scene)
    .sort(compareAiCommentAssets);
  return candidates[0] ? { asset: candidates[0], kind: 'recommendation' } : null;
}

function assertAiCommentAssetIdentity(asset, outfitKey, scene) {
  const assetOutfitKey = getOutfitKey(uniqueStrings(asset.clothingIds || []));
  if (!assetOutfitKey || assetOutfitKey !== outfitKey) throw new Error('outfit detail identity mismatch');
  if (scene && normalizeAiCommentScene(asset.scene) !== scene) throw new Error('outfit detail scene mismatch');
}

function compareAiCommentAssets(left, right) {
  const leftTime = Date.parse(left.updatedAt || left.createdAt || '') || 0;
  const rightTime = Date.parse(right.updatedAt || right.createdAt || '') || 0;
  if (leftTime !== rightTime) return rightTime - leftTime;
  return String(right._id || '').localeCompare(String(left._id || ''));
}

function normalizeAiCommentDetailSource(value) {
  return ['recommendation', 'favorite', 'history'].includes(value) ? value : '';
}

function assertOwnedClothes(expectedIds, clothes) {
  const expected = uniqueStrings(expectedIds);
  const returned = new Map((clothes || []).map((item) => [item._id, item]));
  if (returned.size !== expected.length) throw new Error('clothing ownership validation failed');
  for (const id of expected) {
    const item = returned.get(id);
    if (!item || item.status === DELETED_STATUS) throw new Error('clothing ownership validation failed');
  }
}

function normalizeAiCommentScene(value) {
  const normalized = limitText(value || '', 32);
  const alias = {
    home: '居家',
    work: '上班',
    date: '约会',
    sport: '运动',
    sports: '运动',
  }[normalized.toLowerCase()];
  const scene = alias || normalized;
  const allowed = ['上班', '开会', '出游', '约会', '逛街', '居家', '运动', '正式', '聚会'];
  if (scene && !allowed.includes(scene)) throw new Error('invalid scene');
  return scene;
}

function normalizeAiCommentReason(value) {
  return limitText(value || '', 160);
}

function normalizeOutfitKey(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getAiReviewId(openid, outfitKey, scene) {
  return sha256(`${openid}|${outfitKey}|${scene}`);
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function shortHash(value) {
  return String(value || '').slice(0, 10);
}

async function readAiReview(reviewId) {
  if (!reviewId) return null;
  try {
    return await readDocumentOrNull(db.collection(AI_REVIEW_COLLECTION).doc(reviewId));
  } catch (error) {
    throw createAiReviewServiceError('AI_REVIEW_STORAGE_UNAVAILABLE', error);
  }
}

async function readDocumentOrNull(ref) {
  try {
    const res = await ref.get();
    return res.data || null;
  } catch (error) {
    if (isDocumentNotFoundError(error)) return null;
    throw error;
  }
}

function isDocumentNotFoundError(error) {
  const message = error && (error.errMsg || error.message || String(error));
  return /document with _id .* does not exist/i.test(String(message || ''));
}

function isReadyAiReview(review, context) {
  return Boolean(
    review
      && review._openid === context.openid
      && review.outfitKey === context.outfitKey
      && review.scene === context.scene
      && review.status === 'ready'
      && review.inputHash === context.inputHash
      && review.promptVersion === context.promptVersion
      && review.reviewVersion === context.reviewVersion
      && review.copyPolicyVersion === context.copyPolicyVersion
      && review.voicePolicyVersion === context.voicePolicyVersion
      && normalizeAiComment(review.aiComment),
  );
}

function isAiReviewStale(review, context) {
  if (!review) return false;
  if (review._openid !== context.openid) return true;
  if (review.outfitKey !== context.outfitKey || review.scene !== context.scene) return true;
  if (review.status !== 'ready') return true;
  if (review.inputHash !== context.inputHash) return true;
  if (review.promptVersion !== context.promptVersion) return true;
  if (review.reviewVersion !== context.reviewVersion) return true;
  if (review.copyPolicyVersion !== context.copyPolicyVersion) return true;
  if (review.voicePolicyVersion !== context.voicePolicyVersion) return true;
  return !normalizeAiComment(review.aiComment);
}

function buildAiReviewResponse(context, review, options = {}) {
  const aiComment = normalizeAiComment(review?.aiComment) || normalizeAiComment(options.fallbackAiComment) || null;
  const ready = context && isReadyAiReview(review, context);
  const stale = context ? isAiReviewStale(review, context) : false;
  return {
    success: true,
    aiComment: ready || options.inProgress ? aiComment : options.fallbackAiComment ? normalizeAiComment(options.fallbackAiComment) : null,
    review: review
      ? {
          reviewId: review._id || context?.reviewId,
          outfitKey: review.outfitKey,
          scene: review.scene,
          inputHash: review.inputHash,
          inputDigest: review.inputDigest || review.inputHash,
          schemaVersion: review.schemaVersion,
          reviewVersion: review.reviewVersion,
          promptVersion: review.promptVersion,
          copyPolicyVersion: review.copyPolicyVersion,
          voicePolicyVersion: review.voicePolicyVersion,
          evidenceVersion: review.evidenceVersion,
          source: review.source,
          explanationV2: review.explanationV2,
          model: review.model,
          provider: review.provider,
          aiComment,
          status: review.status,
          generatedAt: review.generatedAt,
          updatedAt: review.updatedAt,
        }
      : undefined,
    reviewId: context?.reviewId || review?._id || '',
    generatedAt: review?.generatedAt || options.fallbackAiComment?.generatedAt,
    cacheHit: Boolean(options.cacheHit),
    saved: Boolean(options.saved),
    stale,
    inProgress: Boolean(options.inProgress),
    superseded: Boolean(options.superseded),
    cooldown: Boolean(options.cooldown),
    retryAfterMs: options.retryAfterMs,
    promptVersion: context?.promptVersion || review?.promptVersion || AI_COMMENT_PROMPT_VERSION,
    reviewVersion: context?.reviewVersion || review?.reviewVersion,
    copyPolicyVersion: context?.copyPolicyVersion || review?.copyPolicyVersion,
    voicePolicyVersion: context?.voicePolicyVersion || review?.voicePolicyVersion,
    inputDigest: context?.inputDigest || review?.inputDigest || review?.inputHash,
    source: review?.source || aiComment?.source,
    model: context?.model || review?.model || AI_COMMENT_MODEL,
    errorCode: options.errorCode,
  };
}

async function acquireAiReviewLease(context, { forceRegenerate }) {
  const now = new Date().toISOString();
  const generationToken = crypto.randomBytes(16).toString('hex');

  return runAiReviewTransaction(async (transaction) => {
      const ref = transaction.collection(AI_REVIEW_COLLECTION).doc(context.reviewId);
      const current = await readDocumentOrNull(ref);

      if (!forceRegenerate && isReadyAiReview(current, context)) {
        return { cacheHit: true, review: current };
      }

      if (
        current?.status === 'generating'
        && current.promptVersion === context.promptVersion
        && current.copyPolicyVersion === context.copyPolicyVersion
        && current.voicePolicyVersion === context.voicePolicyVersion
        && current.inputDigest === context.inputDigest
        && isActiveGenerationLease(current.generationStartedAt)
      ) {
        return { inProgress: true, review: current };
      }

      const retryAfterMs = forceRegenerate && isReadyAiReview(current, context)
        ? getAiCommentForceCooldownRemaining(current)
        : 0;
      if (retryAfterMs > 0) {
        return { cooldown: true, retryAfterMs, review: current };
      }

      const previousReview = current?.status === 'ready'
        ? buildPreviousAiReviewSnapshot(current)
        : current?.previousReview || null;

      const generatingData = {
        _openid: context.openid,
        userId: context.openid,
        outfitKey: context.outfitKey,
        scene: context.scene,
        inputHash: context.inputHash,
        inputDigest: context.inputDigest,
        schemaVersion: 3,
        reviewVersion: context.reviewVersion,
        promptVersion: context.promptVersion,
        copyPolicyVersion: context.copyPolicyVersion,
        voicePolicyVersion: context.voicePolicyVersion,
        evidenceVersion: context.evidenceVersion,
        provider: context.provider,
        model: context.model,
        status: 'generating',
        generationToken,
        generationStartedAt: now,
        updatedAt: now,
        previousReview,
      };

      if (current) {
        await ref.update({ data: generatingData });
      } else {
        await ref.set({
          data: {
            ...generatingData,
            createdAt: now,
          },
        });
      }

      return {
        acquired: true,
        generationToken,
        review: {
          ...current,
          ...generatingData,
          _id: context.reviewId,
        },
      };
  });
}

async function finishAiReviewSuccess(context, generationToken, aiComment) {
  const now = new Date().toISOString();
  return runAiReviewTransaction(async (transaction) => {
    const ref = transaction.collection(AI_REVIEW_COLLECTION).doc(context.reviewId);
    const current = await readDocumentOrNull(ref);
    if (!isCurrentAiReviewGeneration(current, context, generationToken)) {
      return { saved: false, superseded: true, review: current };
    }

    const explanation = aiComment.explanationV2 || buildRuleFallbackExplanationV2(context.evidenceInput, {
      provider: context.provider,
      model: context.model,
      generatedAt: aiComment.generatedAt || now,
    });
    const readyData = {
      ...buildStylistReviewDocument({
        context,
        explanation,
        now,
      }),
      generationToken: null,
      generationStartedAt: null,
      previousReview: null,
    };
    await ref.update({ data: readyData });
    return { saved: true, superseded: false, review: { ...current, ...readyData } };
  });
}

async function finishAiReviewFailure(context, generationToken) {
  const now = new Date().toISOString();
  return runAiReviewTransaction(async (transaction) => {
    const ref = transaction.collection(AI_REVIEW_COLLECTION).doc(context.reviewId);
    const current = await readDocumentOrNull(ref);
    if (!isCurrentAiReviewGeneration(current, context, generationToken)) {
      return { restored: false, superseded: true, review: current };
    }

    const previous = current.previousReview;
    const failureData = previous && normalizeAiComment(previous.aiComment)
      ? {
          status: 'ready',
          aiComment: previous.aiComment,
          inputHash: previous.inputHash,
          inputDigest: previous.inputDigest,
          schemaVersion: previous.schemaVersion,
          reviewVersion: previous.reviewVersion,
          promptVersion: previous.promptVersion,
          copyPolicyVersion: previous.copyPolicyVersion,
          evidenceVersion: previous.evidenceVersion,
          source: previous.source,
          explanationV2: previous.explanationV2,
          provider: previous.provider,
          model: previous.model,
          generatedAt: previous.generatedAt,
          updatedAt: previous.updatedAt || now,
        }
      : {
          status: 'failed',
          aiComment: null,
          generatedAt: null,
          updatedAt: now,
        };
    const settledData = {
      ...failureData,
      generationToken: null,
      generationStartedAt: null,
      previousReview: null,
    };
    await ref.update({ data: settledData });
    return { restored: Boolean(previous), superseded: false, review: { ...current, ...settledData } };
  });
}

function buildPreviousAiReviewSnapshot(review) {
  return {
    aiComment: normalizeAiComment(review.aiComment),
    inputHash: review.inputHash,
    inputDigest: review.inputDigest,
    schemaVersion: review.schemaVersion,
    reviewVersion: review.reviewVersion,
    promptVersion: review.promptVersion,
    copyPolicyVersion: review.copyPolicyVersion,
    evidenceVersion: review.evidenceVersion,
    source: review.source,
    explanationV2: review.explanationV2,
    provider: review.provider,
    model: review.model,
    generatedAt: review.generatedAt,
    updatedAt: review.updatedAt,
  };
}

function isCurrentAiReviewGeneration(review, context, generationToken) {
  return Boolean(
    review
      && review.status === 'generating'
      && review.generationToken === generationToken
      && review._openid === context.openid
      && review.outfitKey === context.outfitKey
      && review.scene === context.scene
      && (!review.inputDigest || review.inputDigest === context.inputDigest),
  );
}

function getAiCommentForceCooldownRemaining(review) {
  const generatedAt = Date.parse(review.generatedAt || review.updatedAt || '');
  if (!Number.isFinite(generatedAt)) return 0;
  return Math.max(0, AI_COMMENT_FORCE_COOLDOWN_MS - (Date.now() - generatedAt));
}

function isActiveGenerationLease(generationStartedAt) {
  const startedAt = Date.parse(generationStartedAt || '');
  return Number.isFinite(startedAt) && Date.now() - startedAt < AI_COMMENT_LEASE_TIMEOUT_MS;
}

function assertTransactionSupport() {
  if (typeof db.runTransaction !== 'function') {
    throw createAiReviewServiceError('AI_REVIEW_TRANSACTION_UNAVAILABLE');
  }
}

async function runAiReviewTransaction(callback) {
  assertTransactionSupport();
  try {
    return await db.runTransaction(callback, 3);
  } catch (error) {
    if (isAiReviewServiceError(error)) throw error;
    throw createAiReviewServiceError('AI_REVIEW_STORAGE_UNAVAILABLE', error);
  }
}

function createSafeAiReviewClientError(code) {
  const error = new Error(getSafeAiReviewMessage(code));
  error.aiReviewCode = code;
  return error;
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

async function loadClothesByIds(openid, ids, database = db) {
  if (!ids.length) return [];
  const res = await database.collection('clothes').where({ _openid: openid, _id: db.command.in(ids) }).limit(100).get();
  return res.data;
}

async function assertOutfitClothesAvailable(openid, clothingIds, database = db) {
  const expectedIds = uniqueStrings(clothingIds);
  const clothes = await loadClothesByIds(openid, expectedIds, database);
  const availableIds = new Set(
    clothes
      .filter((item) => item && item.status !== DELETED_STATUS)
      .map((item) => item._id),
  );
  if (expectedIds.some((id) => !availableIds.has(id))) {
    throw createBusinessError(
      'OUTFIT_CONTAINS_DELETED_CLOTHES',
      '这套搭配有衣物已移出衣橱，暂时不能继续使用',
    );
  }
}

async function runOutfitReferenceTransaction(callback) {
  if (typeof db.runTransaction !== 'function') {
    throw createBusinessError('OUTFIT_REFERENCE_TRANSACTION_UNAVAILABLE', '操作暂时不可用，请稍后再试');
  }
  try {
    return await db.runTransaction(callback, 3);
  } catch (error) {
    if (error && error.businessCode) throw error;
    throw createBusinessError('OUTFIT_REFERENCE_WRITE_FAILED', '操作暂时失败，请稍后再试');
  }
}

async function saveFavoriteOutfit(id, outfitPayload, aiCommentPayload) {
  const { OPENID } = cloud.getWXContext();
  const now = new Date().toISOString();
  const base = normalizeOutfitPayload(outfitPayload);
  const clothingIds = readBaseClothingIds(base);
  if (!base || clothingIds.length === 0) throw new Error('outfit payload is required');

  const outfitKey = getOutfitKey(clothingIds);
  const recordData = buildSnapshotRecordData(base, {
    aiComment: aiCommentPayload || base.aiComment,
    outfitKey,
    now,
    source: base.source === 'history' ? 'history' : 'recommendation',
  });
  const saved = await runOutfitReferenceTransaction(async (transaction) => {
    await assertOutfitClothesAvailable(OPENID, clothingIds, transaction);
    const existing = await findFavoriteByKey(OPENID, outfitKey, transaction);
    if (existing) {
      const data = { ...recordData, updatedAt: now, deletedAt: null };
      await transaction.collection('favorite_outfits').doc(existing._id).update({ data });
      return { ...existing, ...data };
    }

    const addData = {
      _openid: OPENID,
      userId: OPENID,
      ...recordData,
      createdAt: now,
      updatedAt: now,
    };
    const addRes = await transaction.collection('favorite_outfits').add({ data: addData });
    return { ...addData, _id: addRes._id };
  });
  return enrichSingleOutfitState(toSnapshotOutfit(saved, 'favorite'), {
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
  const startedAt = Date.now();
  const page = Math.max(Number(event.page || 1), 1);
  const pageSize = Math.min(Math.max(Number(event.pageSize || 10), 1), 50);
  const query = db.collection('favorite_outfits')
    .where({ _openid: OPENID });
  const [totalRes, pageRes] = await Promise.all([
    query.count(),
    query
      .orderBy('createdAt', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get(),
  ]);
  const pageList = (pageRes.data || []).filter((item) => !item.deletedAt);
  const outfits = await enrichOutfitsState(pageList.map((item) => toSnapshotOutfit(item, 'favorite')), {
    openid: OPENID,
    targetDate: new Date().toISOString().slice(0, 10),
  });

  console.log('[generateOutfit] listFavoriteOutfits', {
    page,
    pageSize,
    returned: outfits.length,
    total: totalRes.total,
    durationMs: Date.now() - startedAt,
  });

  return {
    list: outfits,
    hasMore: page * pageSize < totalRes.total,
    pagination: {
      total: totalRes.total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(totalRes.total / pageSize)),
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
  const recordData = buildSnapshotRecordData(base, {
    aiComment: event.aiComment || base.aiComment,
    outfitKey,
    now,
    source,
  });
  const saved = await runOutfitReferenceTransaction(async (transaction) => {
    await assertOutfitClothesAvailable(OPENID, clothingIds, transaction);
    const existing = await findTodayHistoryByKey(OPENID, outfitKey, targetDate, transaction);
    if (existing) return existing;

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
    const addRes = await transaction.collection('outfit_history').add({ data: addData });
    return { ...addData, _id: addRes._id };
  });
  return enrichSingleOutfitState(toSnapshotOutfit(saved, 'history'), {
    openid: OPENID,
    targetDate,
  });
}

async function listOutfitHistory(event) {
  const { OPENID } = cloud.getWXContext();
  const startedAt = Date.now();
  const page = Math.max(Number(event.page || 1), 1);
  const pageSize = Math.min(Math.max(Number(event.pageSize || 10), 1), 50);
  const query = db.collection('outfit_history')
    .where({ _openid: OPENID });
  const [totalRes, pageRes] = await Promise.all([
    query.count(),
    query
      .orderBy('wornAt', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get(),
  ]);
  const pageList = pageRes.data || [];
  const outfits = await enrichOutfitsState(pageList.map((item) => toSnapshotOutfit(item, 'history')), {
    openid: OPENID,
    targetDate: new Date().toISOString().slice(0, 10),
  });

  console.log('[generateOutfit] listOutfitHistory', {
    page,
    pageSize,
    returned: outfits.length,
    total: totalRes.total,
    durationMs: Date.now() - startedAt,
  });

  return {
    list: outfits,
    page,
    pageSize,
    hasMore: page * pageSize < totalRes.total,
    pagination: {
      total: totalRes.total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(totalRes.total / pageSize)),
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
  const [favoriteMap, historyMap, assetMap] = await Promise.all([
    findFavoritesByKeys(openid, keys),
    findTodayHistoryByKeys(openid, keys, targetDate),
    findOutfitsByKeys(openid, keys),
  ]);

  return outfits.map((outfit) => {
    const clothingIds = outfit.clothingIds || [];
    const outfitKey = outfit.outfitKey || getOutfitKey(clothingIds);
    const favorite = favoriteMap.get(outfitKey);
    const history = historyMap.get(outfitKey);
    const asset = assetMap.get(outfitKey);
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

async function findTodayHistoryByKeys(openid, outfitKeys, targetDate, database = db) {
  const map = new Map();
  const keys = uniqueStrings(outfitKeys);
  if (!keys.length) return map;
  const res = await database.collection('outfit_history')
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

async function findTodayHistoryByKey(openid, outfitKey, targetDate, database = db) {
  const map = await findTodayHistoryByKeys(openid, [outfitKey], targetDate, database);
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

async function findFavoriteByKey(openid, outfitKey, database = db) {
  const res = await database.collection('favorite_outfits')
    .where({ _openid: openid, outfitKey })
    .limit(1)
    .get();
  return res.data[0] || null;
}

function buildSnapshotRecordData(base, { aiComment, outfitKey, now, source }) {
  const clothingIds = readBaseClothingIds(base);
  const itemsSnapshot = buildDetailedSnapshotItems(clothingIds, base);
  const reason = base.reason || base.reasoning || '';
  const reasoning = base.reasoning || base.reason || '';
  const normalizedAiComment = normalizeAiComment(aiComment);
  const aestheticEvaluation = normalizeAestheticEvaluationForStorage(base.aestheticEvaluation);
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
      imageUrl: item.imageUrl || item.displayImageUrl || item.thumbnailUrl || '',
      displayImageUrl: item.displayImageUrl || item.imageUrl || item.thumbnailUrl || '',
      thumbnailUrl: item.thumbnailUrl || item.displayImageUrl || item.imageUrl || '',
      isDeleted: Boolean(item.deletedAt),
    })),
    scene: base.scene,
    targetDate: base.targetDate,
    timeOfDay: base.timeOfDay || 'all_day',
    weather: base.weatherSnapshot || base.weather || fallbackWeather(),
    weatherSnapshot: base.weatherSnapshot || base.weather || fallbackWeather(),
    scores: sanitizeScores(base.scores || {}),
    ...(aestheticEvaluation ? { aestheticEvaluation } : {}),
    scoreExplanations: Array.isArray(base.scoreExplanations) ? base.scoreExplanations : [],
    generationType: base.generationType || 'auto',
    source: source || base.source || 'recommendation',
    reason,
    reasoning,
    ...(base.reasonVersion ? { reasonVersion: base.reasonVersion } : {}),
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
      imageUrl: snapshot?.imageUrl || snapshot?.displayImageUrl || snapshot?.thumbnailUrl || '',
      displayImageUrl: snapshot?.displayImageUrl || snapshot?.imageUrl || snapshot?.thumbnailUrl || '',
      thumbnailUrl: snapshot?.thumbnailUrl || snapshot?.displayImageUrl || snapshot?.imageUrl || '',
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
            imageUrl: item.imageUrl || item.displayImageUrl || item.thumbnailUrl || '',
            displayImageUrl: item.displayImageUrl || item.imageUrl || item.thumbnailUrl || '',
            thumbnailUrl: item.thumbnailUrl || item.displayImageUrl || item.imageUrl || '',
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
          imageUrl: item.imageUrl || item.displayImageUrl || item.thumbnailUrl || '',
          displayImageUrl: item.displayImageUrl || item.imageUrl || item.thumbnailUrl || '',
          thumbnailUrl: item.thumbnailUrl || item.displayImageUrl || item.imageUrl || '',
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
    imageUrl: snapshot.imageUrl || snapshot.displayImageUrl || snapshot.thumbnailUrl || '',
    displayImageUrl: snapshot.displayImageUrl || snapshot.imageUrl || snapshot.thumbnailUrl || '',
    thumbnailUrl: snapshot.thumbnailUrl || snapshot.displayImageUrl || snapshot.imageUrl || '',
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
      imageUrl: snapshot.imageUrl || snapshot.displayImageUrl || snapshot.thumbnailUrl || '',
      displayImageUrl: snapshot.displayImageUrl || snapshot.imageUrl || snapshot.thumbnailUrl || '',
      thumbnailUrl: snapshot.thumbnailUrl || snapshot.displayImageUrl || snapshot.imageUrl || '',
      colorPalette: snapshot.color ? [{ name: snapshot.color, hex: '' }] : [],
      isDeleted: Boolean(snapshot.deletedAt),
    })),
    scene: item.scene,
    targetDate: item.targetDate,
    timeOfDay: item.timeOfDay,
    weatherSnapshot: item.weatherSnapshot || item.weather,
    scores: sanitizeScores(item.scores || {}),
    aestheticEvaluation: normalizeAestheticEvaluationForStorage(item.aestheticEvaluation),
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
    reasonVersion: item.reasonVersion,
    aiComment: normalizeAiComment(item.aiComment) || undefined,
  };
}

async function upsertOutfitByKey({ openid, existing, base, patch, now }) {
  const clothingIds = readBaseClothingIds(base);
  if (!base || clothingIds.length === 0) throw new Error('outfit payload is required');

  return runOutfitReferenceTransaction(async (transaction) => {
    await assertOutfitClothesAvailable(openid, clothingIds, transaction);

    const outfitKey = getOutfitKey(clothingIds);
    const current = existing || (await findOutfitByKey(openid, outfitKey, transaction));
    const data = buildOutfitSaveData(base, {
      outfitKey,
      now,
      patch,
      current,
    });

    if (current) {
      await transaction.collection('outfits').doc(current._id).update({ data });
      return { ...current, ...data };
    }

    const addData = {
      _openid: openid,
      ...data,
      createdAt: now,
    };
    const addRes = await transaction.collection('outfits').add({ data: addData });
    return { ...addData, _id: addRes._id };
  });
}

function buildOutfitSaveData(base, { outfitKey, now, patch, current }) {
  const weather = base.weatherSnapshot || base.weather || current?.weatherSnapshot || current?.weather || fallbackWeather();
  const reason = base.reason || base.reasoning || current?.reason || current?.reasoning || '';
  const reasoning = base.reasoning || base.reason || current?.reasoning || current?.reason || '';
  const clothingIds = readBaseClothingIds(base);
  const snapshotItems = buildSnapshotItems(clothingIds, base, current);
  const incomplete = snapshotItems.some((item) => item.isDeleted) || Boolean(current?.incomplete);
  const aiComment = normalizeAiComment(base.aiComment || current?.aiComment);
  const title = base.title || current?.title || `${base.scene || current?.scene || '今日'}搭配`;
  const userTitle = readTitle(current?.userTitle) || readTitle(base.userTitle);
  const aestheticEvaluation = normalizeAestheticEvaluationForStorage(base.aestheticEvaluation || current?.aestheticEvaluation);

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
    ...(aestheticEvaluation ? { aestheticEvaluation } : {}),
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
    reasoning,
    reasonVersion: base.reasonVersion || current?.reasonVersion,
    ...(aiComment ? { aiComment } : {}),
    updatedAt: now,
  };
}

async function findOutfitByKey(openid, outfitKey, database = db) {
  const res = await database.collection('outfits').where({ _openid: openid, outfitKey }).limit(1).get();
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
      imageUrl: snapshot?.imageUrl || snapshot?.displayImageUrl || snapshot?.thumbnailUrl || '',
      displayImageUrl: snapshot?.displayImageUrl || snapshot?.imageUrl || snapshot?.thumbnailUrl || '',
      thumbnailUrl: snapshot?.thumbnailUrl || snapshot?.displayImageUrl || snapshot?.imageUrl || '',
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
          imageUrl: item.imageUrl || item.displayImageUrl || item.thumbnailUrl || '',
          displayImageUrl: item.displayImageUrl || item.imageUrl || item.thumbnailUrl || '',
          thumbnailUrl: item.thumbnailUrl || item.displayImageUrl || item.imageUrl || '',
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
          imageUrl: item.imageUrl || item.displayImageUrl || item.thumbnailUrl || '',
          displayImageUrl: item.displayImageUrl || item.imageUrl || item.thumbnailUrl || '',
          thumbnailUrl: item.thumbnailUrl || item.displayImageUrl || item.imageUrl || '',
          isDeleted: Boolean(item.isDeleted),
        }))
    : [];
}

function snapshotFromClothing(item, fallback, itemId) {
  const displayImageUrl = getDisplayImage(item) || fallback?.displayImageUrl || fallback?.imageUrl || '';
  const thumbnailUrl = getThumbnailImage(item) || fallback?.thumbnailUrl || displayImageUrl;
  return {
    itemId,
    name: item?.customName || item?.subcategory || item?.subCategory || item?.category || fallback?.name || '衣服',
    category: item?.category || fallback?.category || 'other',
    color: readColorText(item) || fallback?.color || '',
    imageUrl: item?.imageUrl || fallback?.imageUrl || displayImageUrl,
    displayImageUrl,
    thumbnailUrl,
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
    aestheticEvaluation: payload.aestheticEvaluation,
    scoreExplanations: payload.scoreExplanations,
    generationType: payload.generationType,
    source: payload.source || 'recommend',
    reasoning: payload.reasoning,
    reason: payload.reason,
    outfitKey: payload.outfitKey,
    outfitId: payload.outfitId,
    outfitKind: payload.outfitKind,
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
    reasonVersion: payload.reasonVersion,
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

  return attachAestheticEvaluation(toOutfit(data, recommendation.items), recommendation.items);
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

function normalizeFiniteNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(number * 100) / 100;
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
      const displayImageUrl = getDisplayImage(clothing) || snapshot.displayImageUrl || snapshot.imageUrl || '';
      const thumbnailUrl = getThumbnailImage(clothing) || snapshot.thumbnailUrl || displayImageUrl;
      return {
        clothingId: snapshot.itemId,
        category: clothing?.category || snapshot.category || 'other',
        subcategory: clothing?.subcategory || snapshot.name,
        imageUrl: clothing?.imageUrl || snapshot.imageUrl || displayImageUrl || thumbnailUrl,
        displayImageUrl,
        thumbnailUrl,
        colorPalette: clothing?.colorPalette || [],
        isDeleted: Boolean(snapshot.isDeleted || !clothing),
      };
    }),
    scene: item.scene,
    targetDate: item.targetDate,
    timeOfDay: item.timeOfDay,
    weatherSnapshot: item.weatherSnapshot || item.weather,
    scores: sanitizeScores(item.scores || {}),
    aestheticEvaluation: normalizeAestheticEvaluationForStorage(item.aestheticEvaluation),
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
    reason: item.reason || item.reasoning,
    reasoning: item.reasoning || item.reason,
    reasonVersion: item.reasonVersion,
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
  return item.displayImageUrl
    || item.cleanImageUrl
    || item.aiSegmentImageUrl
    || item.cropImageUrl
    || item.croppedImageUrl
    || item.imageUrl
    || item.originalImageUrl
    || '';
}

function getThumbnailImage(item) {
  if (!item) return '';
  return item.thumbnailUrl || item.thumbImageUrl || getDisplayImage(item);
}

function ok(data) {
  return { code: 0, data, message: 'ok' };
}

function fail(error) {
  const errorCode = error && (error.businessCode || error.aiReviewCode);
  return {
    code: 1,
    data: errorCode ? { errorCode } : null,
    message: error && error.message ? error.message : 'unknown error',
  };
}

function createBusinessError(code, message) {
  const error = new Error(message);
  error.businessCode = code;
  return error;
}
