const { adaptLegacyVisibleFactItem } = require('./recommendationEligibilityFacts');

const PRESENTATION_FACT_MODEL_VERSION = 'presentation-fact-model-v3';
const PRESENTATION_FACT_MODEL_BUILD = 'presentation-fact-model-20260805-r2';
const PRESENTATION_PLAN_VERSION = 'presentation-plan-v3';
const PRESENTATION_PLAN_SOURCE = 'presentation_plan';

const ROLE_ORDER = Object.freeze(['onepiece', 'top', 'bottom', 'outerwear', 'shoes']);
const SCENE_LABELS = Object.freeze({
  home: '居家',
  work: '通勤',
  date: '约会',
  sport: '轻运动',
});
const COLOR_LABELS = Object.freeze([
  [/黑|black/i, '黑色'],
  [/白|white|ivory|cream/i, '白色'],
  [/灰|gray|grey/i, '灰色'],
  [/藏青|navy/i, '藏青色'],
  [/蓝|blue/i, '蓝色'],
  [/棕|brown|camel/i, '棕色'],
  [/米|beige|khaki/i, '米色'],
  [/红|red|burgundy/i, '红色'],
  [/绿|green/i, '绿色'],
  [/黄|yellow/i, '黄色'],
  [/紫|purple/i, '紫色'],
  [/粉|pink/i, '粉色'],
  [/橙|orange/i, '橙色'],
]);
const COLOR_SHORT_LABELS = Object.freeze({
  黑色: '黑',
  白色: '白',
  灰色: '灰',
  藏青色: '藏青',
  蓝色: '蓝',
  棕色: '棕',
  米色: '米',
  红色: '红',
  绿色: '绿',
  黄色: '黄',
  紫色: '紫',
  粉色: '粉',
  橙色: '橙',
});
const NEUTRAL_COLORS = new Set(['黑色', '白色', '灰色', '藏青色', '米色', '棕色']);
const RELATION_PRIORITY = Object.freeze([
  'SUBTYPE_FEATURE_PRINT',
  'PATTERN_SOLID_BALANCE',
  'SAME_COLOR_ALL_ROLES',
  'SAME_COLOR_TOP_BOTTOM',
  'COLOR_ECHO_TOP_SHOES',
  'COLOR_ECHO_ONEPIECE_SHOES',
  'COLOR_ECHO_BOTTOM_SHOES',
  'TOP_ACCENT_WITH_NEUTRAL_BOTTOM',
  'NEUTRAL_COLOR_BRIDGE',
  'DISTINCT_TOP_BOTTOM_COLOR',
  'SINGLE_COLOR_FALLBACK',
  'STRUCTURE_ONEPIECE_OUTERWEAR',
  'STRUCTURE_ONEPIECE_SHOES',
  'STRUCTURE_TOP_BOTTOM',
]);

function buildPresentationFactModel(selectedCandidate = {}) {
  const source = asObject(selectedCandidate);
  const scene = normalizeScene(source.scene || source.matchedScene);
  const sourceItems = readItems(source);
  const roleEntries = readRoleEntries(source);
  const items = roleEntries.length > 0
    ? roleEntries.map((entry) => buildItemFact(entry, findItem(sourceItems, entry), source))
    : sourceItems.map((item) => buildItemFact({
        id: readItemId(item),
        slot: item?.outfitSlot || item?.category,
        role: item?.outfitRole || 'core',
        displayName: item?.displayName,
      }, item, source));
  const normalizedItems = items
    .filter(Boolean)
    .sort((left, right) => roleIndex(left.role) - roleIndex(right.role) || left.canonicalSubtype.localeCompare(right.canonicalSubtype));
  const relations = buildRelations(normalizedItems);
  const semanticSignature = normalizedItems.length > 0
    ? stableSerialize({
        scene,
        items: normalizedItems.map(toSignatureItem),
        relations: relations.map((relation) => relation.relationCode),
      })
    : '';
  return {
    version: PRESENTATION_FACT_MODEL_VERSION,
    scene,
    items: normalizedItems.map(stripInternalItemFields),
    relations,
    semanticSignature,
    presentationFactSignature: semanticSignature,
    availableDifferentiators: relations.map(toDifferentiator),
    primaryRelationCode: relations[0]?.relationCode || null,
    unsupportedClaims: Array.isArray(source.unsupportedClaims) ? source.unsupportedClaims.slice() : [],
  };
}

function buildPresentationPlan(model = {}, options = {}) {
  const source = asObject(model);
  const requestedDifferentiator = Object.prototype.hasOwnProperty.call(options, 'selectedDifferentiator')
    ? cloneDifferentiator(options.selectedDifferentiator)
    : cloneDifferentiator(source.availableDifferentiators?.[0]);
  const primaryRelation = findDifferentiatorRelation(source, requestedDifferentiator) || source.relations?.[0] || {
    relationCode: null,
    roles: [],
    authorizedValues: [],
    subjectItemIds: [],
    evidenceFactIds: [],
  };
  // A FACT_EQUIVALENCE group may supply a differentiator selected from its
  // representative model. Rebind all identity-bearing fields to this model's
  // relation while preserving the selected semantic relation and copy text.
  const selectedDifferentiator = primaryRelation.relationCode
    ? toDifferentiator(primaryRelation)
    : requestedDifferentiator;
  const detailDifferentiator = (Array.isArray(source.availableDifferentiators)
    ? source.availableDifferentiators : [])
    .find((entry) => differentiatorSignature(entry) !== differentiatorSignature(selectedDifferentiator || primaryRelation));
  const detailRelation = findDifferentiatorRelation(source, detailDifferentiator);
  const titleConcept = buildTitleConcept(source);
  const reasonClaim = buildReasonClaim(source, primaryRelation);
  const detailClaim = detailRelation ? buildDetailClaim(source, detailRelation) : null;
  const todayMetadata = buildSurfaceMetadata(source, primaryRelation);
  const detailMetadata = detailRelation ? buildSurfaceMetadata(source, detailRelation) : emptySurfaceMetadata();
  return {
    version: PRESENTATION_PLAN_VERSION,
    planId: PRESENTATION_PLAN_VERSION,
    source: PRESENTATION_PLAN_SOURCE,
    factModel: source,
    presentationFactSignature: source.presentationFactSignature || '',
    primaryRelation,
    primaryRelationCode: primaryRelation.relationCode || null,
    supportingFacts: source.items || [],
    titleConcept,
    todayReason: reasonClaim.text,
    detailExplanation: detailClaim?.text || '',
    detailDisplay: detailClaim?.text ? 'visible' : 'hidden',
    todayAction: todayMetadata.action,
    todayDimension: todayMetadata.dimension,
    todaySubjectItemIds: todayMetadata.subjectItemIds,
    todayEvidenceFactIds: todayMetadata.evidenceFactIds,
    detailAction: detailMetadata.action,
    detailDimension: detailMetadata.dimension,
    detailSubjectItemIds: detailMetadata.subjectItemIds,
    detailEvidenceFactIds: detailMetadata.evidenceFactIds,
    selectedDifferentiator,
    availableDifferentiators: (Array.isArray(source.availableDifferentiators)
      ? source.availableDifferentiators : []).map(cloneDifferentiator).filter(Boolean),
    // Contract: candidates available before the batch selects one differentiator.
    availableDifferentiatorCount: Array.isArray(source.availableDifferentiators)
      ? source.availableDifferentiators.length : 0,
    reasonClaim,
    detailClaim,
    sceneConclusion: buildSceneConclusion(source.scene),
    unsupportedClaims: Array.isArray(source.unsupportedClaims) ? source.unsupportedClaims.slice() : [],
  };
}

function assignPresentationDifferentiators(models = []) {
  const list = Array.isArray(models) ? models : [];
  const groups = new Map();
  list.forEach((model, index) => {
    const signature = model?.presentationFactSignature || `missing:${index}`;
    if (!groups.has(signature)) groups.set(signature, { model, indexes: [] });
    groups.get(signature).indexes.push(index);
  });
  const representatives = [...groups.values()].map((entry) => entry.model);
  const occurrenceCounts = new Map();
  for (const model of representatives) {
    const signatures = new Set((Array.isArray(model?.availableDifferentiators)
      ? model.availableDifferentiators : []).map(differentiatorSignature).filter(Boolean));
    for (const signature of signatures) {
      occurrenceCounts.set(signature, (occurrenceCounts.get(signature) || 0) + 1);
    }
  }
  const assigned = Array(list.length).fill(null);
  const usedDifferentiatorSignatures = new Set();
  for (const group of groups.values()) {
    const available = Array.isArray(group.model?.availableDifferentiators)
      ? group.model.availableDifferentiators : [];
    const selected = available
      .map((entry, index) => ({
        entry,
        index,
        alreadyUsed: usedDifferentiatorSignatures.has(differentiatorSignature(entry)),
        occurrenceCount: occurrenceCounts.get(differentiatorSignature(entry)) || Number.MAX_SAFE_INTEGER,
      }))
      .sort((left, right) => Number(left.alreadyUsed) - Number(right.alreadyUsed)
        || left.occurrenceCount - right.occurrenceCount
        || left.index - right.index)[0]?.entry || null;
    const selectedSignature = differentiatorSignature(selected);
    if (selectedSignature) usedDifferentiatorSignatures.add(selectedSignature);
    for (const index of group.indexes) assigned[index] = cloneDifferentiator(selected);
  }
  return assigned;
}

function applyPresentationPlan(outfit, model, plan) {
  if (!outfit || typeof outfit !== 'object' || Array.isArray(outfit)) return outfit;
  const next = outfit;
  const canonicalPlan = plan && typeof plan === 'object' ? plan : buildPresentationPlan(model);
  const reason = canonicalPlan.todayReason || canonicalPlan.reasonClaim?.text || '';
  const detail = canonicalPlan.detailExplanation || '';
  const todayEvidenceSources = buildPresentationEvidenceSources(canonicalPlan.todayEvidenceFactIds);
  const detailEvidenceSources = buildPresentationEvidenceSources(canonicalPlan.detailEvidenceFactIds);
  const todaySlotBindings = buildSlotBindings(model, canonicalPlan.todaySubjectItemIds);
  const detailSlotBindings = buildSlotBindings(model, canonicalPlan.detailSubjectItemIds);
  next.presentationPlan = canonicalPlan;
  next.source = PRESENTATION_PLAN_SOURCE;
  next.title = canonicalPlan.titleConcept || next.title || '';
  next.displayTitle = next.title;
  next.todayReason = reason;
  next.detailExplanation = detail;
  next.detailDisplay = canonicalPlan.detailDisplay;
  next.reason = reason;
  next.reasoning = detail || reason;
  next.todayReasonSource = PRESENTATION_PLAN_SOURCE;
  next.primaryRelationCode = canonicalPlan.primaryRelationCode;
  next.selectedDifferentiator = cloneDifferentiator(canonicalPlan.selectedDifferentiator);
  Object.assign(next, buildSurfacePatch(canonicalPlan, {
    todayEvidenceSources,
    detailEvidenceSources,
    todaySlotBindings,
    detailSlotBindings,
  }));
  const existingContract = asObject(next.copyContract);
  next.copyContract = {
    ...existingContract,
    ...buildSurfacePatch(canonicalPlan, {
      todayEvidenceSources,
      detailEvidenceSources,
      todaySlotBindings,
      detailSlotBindings,
    }),
    todayReason: reason,
    detailExplanation: detail,
    detailDisplay: canonicalPlan.detailDisplay,
    todayReasonSource: PRESENTATION_PLAN_SOURCE,
    source: PRESENTATION_PLAN_SOURCE,
    presentationPlanVersion: canonicalPlan.version,
    presentationFactSignature: model?.presentationFactSignature || '',
    primaryRelationCode: canonicalPlan.primaryRelationCode,
    selectedDifferentiator: cloneDifferentiator(canonicalPlan.selectedDifferentiator),
    unsupportedClaimCount: Array.isArray(canonicalPlan.unsupportedClaims) ? canonicalPlan.unsupportedClaims.length : 0,
  };
  const existingContentPlan = asObject(next.contentPlan);
  const existingDefaultCopy = asObject(existingContentPlan.defaultCopy);
  next.contentPlan = {
    ...existingContentPlan,
    ...buildSurfacePatch(canonicalPlan, {
      todayEvidenceSources,
      detailEvidenceSources,
      todaySlotBindings,
      detailSlotBindings,
    }),
    source: PRESENTATION_PLAN_SOURCE,
    presentationPlanVersion: canonicalPlan.version,
    presentationFactSignature: model?.presentationFactSignature || '',
    primaryRelationCode: canonicalPlan.primaryRelationCode,
    selectedDifferentiator: cloneDifferentiator(canonicalPlan.selectedDifferentiator),
    detailDisplay: canonicalPlan.detailDisplay,
    defaultTodayReason: reason,
    defaultDetailExplanation: detail,
    defaultCopy: {
      ...existingDefaultCopy,
      todayReason: reason,
      detailExplanation: detail,
    },
  };
  next.detailNarrativeViewModel = {
    ...asObject(next.detailNarrativeViewModel),
    defaultText: detail,
    source: PRESENTATION_PLAN_SOURCE,
    aiStatus: detail ? 'default' : 'hidden',
  };
  delete next.enhancedReason;
  delete next.copyContract.enhancedReason;
  return next;
}

function buildTitleConcept(model) {
  const items = Array.isArray(model?.items) ? model.items : [];
  const scene = normalizeScene(model?.scene);
  if (scene === 'sport') {
    const top = items.find((item) => item.role === 'top');
    const bottom = items.find((item) => item.role === 'bottom');
    const shoes = items.find((item) => item.role === 'shoes');
    const roleColors = [top?.normalizedColor, bottom?.normalizedColor, shoes?.normalizedColor].filter(Boolean);
    const uniqueColors = uniqueStrings(roleColors);
    const colorConcept = uniqueColors.length === 1
      ? `全${shortColor(uniqueColors[0])}`
      : top?.normalizedColor && bottom?.normalizedColor && top.normalizedColor === bottom.normalizedColor
        ? `${shortColor(top.normalizedColor)}${shoes?.normalizedColor && shoes.normalizedColor !== top.normalizedColor ? shortColor(shoes.normalizedColor) : ''}`
        : [top?.normalizedColor, bottom?.normalizedColor].filter(Boolean).map(shortColor).join('');
    const print = items.some((item) => item.visibleFeatureTags.includes('印花')) ? '印花' : '';
    return `${print}${colorConcept || '日常'}${SCENE_LABELS.sport}`;
  }
  const sceneLabel = SCENE_LABELS[scene] || '日常';
  const relationLabel = scene === 'sport' ? relationTitleLabel(model?.primaryRelationCode) : '';
  if (relationLabel) return `${sceneLabel}${relationLabel}`;
  const onepiece = items.find((item) => item.role === 'onepiece');
  if (onepiece?.canonicalSubtype) return `${sceneLabel}${onepiece.canonicalSubtype}组合`;
  const firstWearable = items.find((item) => item.role === 'top' || item.role === 'outerwear' || item.role === 'bottom');
  if (firstWearable?.canonicalSubtype) return `${sceneLabel}${firstWearable.canonicalSubtype}搭配`;
  return `${sceneLabel}搭配`;
}

function buildReasonClaim(model, relation) {
  const items = Array.isArray(model?.items) ? model.items : [];
  const byRole = new Map(items.map((item) => [item.role, item]));
  const top = byRole.get('top');
  const bottom = byRole.get('bottom');
  const onepiece = byRole.get('onepiece');
  const outerwear = byRole.get('outerwear');
  const shoes = byRole.get('shoes');
  const topName = top?.canonicalSubtype || top?.canonicalName || '上衣';
  const bottomName = bottom?.canonicalSubtype || bottom?.canonicalName || '下装';
  const onepieceName = onepiece?.canonicalSubtype || onepiece?.canonicalName || '连衣裙';
  const outerwearName = outerwear?.canonicalSubtype || outerwear?.canonicalName || '外套';
  const shoesName = shoes?.canonicalSubtype || shoes?.canonicalName || '鞋子';
  const topColor = top?.normalizedColor || '';
  const bottomColor = bottom?.normalizedColor || '';
  const onepieceColor = onepiece?.normalizedColor || '';
  const shoesColor = shoes?.normalizedColor || '';
  const sceneConclusion = buildSceneConclusion(model?.scene);
  const sceneBenefit = buildSceneBenefit(model, relation);
  const finish = `${sceneConclusion}，${sceneBenefit}。`;
  let text;
  switch (relation.relationCode) {
    case 'SAME_COLOR_ALL_ROLES':
      text = `${joinChineseLabels(relation.roles.map((role) => relationItemLabel(model, role, '单品')))}同色统一，${finish}`;
      break;
    case 'COLOR_ECHO_TOP_SHOES':
      text = `${topColor || ''}${topName}与${shoesColor || ''}${shoesName}用同色呼应，${finish}`;
      break;
    case 'COLOR_ECHO_ONEPIECE_SHOES':
      text = `${onepieceColor || ''}${onepieceName}与${shoesColor || ''}${shoesName}用同色呼应，${finish}`;
      break;
    case 'COLOR_ECHO_BOTTOM_SHOES':
      text = `${bottomColor || ''}${bottomName}与${shoesColor || ''}${shoesName}用同色呼应，${finish}`;
      break;
    case 'SUBTYPE_FEATURE_PRINT':
      text = `${relationItemLabel(model, relation.roles?.[0], '印花单品')}的印花是视觉重点，${finish}`;
      break;
    case 'PATTERN_SOLID_BALANCE':
      text = `${relationItemLabel(model, relation.roles?.[0], '印花单品')}配${relationItemLabel(model, relation.roles?.[1], '纯色单品')}，${finish}`;
      break;
    case 'TOP_ACCENT_WITH_NEUTRAL_BOTTOM':
      text = `${topColor || ''}${topName}配${bottomColor || ''}${bottomName}，亮色突出重点，${finish}`;
      break;
    case 'SAME_COLOR_TOP_BOTTOM':
      text = `${topColor || ''}${topName}与${bottomColor || ''}${bottomName}顺色衔接，${finish}`;
      break;
    case 'DISTINCT_TOP_BOTTOM_COLOR':
      text = `${topColor || ''}${topName}与${bottomColor || ''}${bottomName}用不同颜色区分，${finish}`;
      break;
    case 'NEUTRAL_COLOR_BRIDGE':
      text = `${relationItemLabel(model, relation.roles?.[0], '单品')}与${relationItemLabel(model, relation.roles?.[1], '单品')}用中性色过渡，${finish}`;
      break;
    case 'STRUCTURE_ONEPIECE_OUTERWEAR':
      text = `${onepieceName}配${outerwearName}叠出内外层次，${finish}`;
      break;
    case 'STRUCTURE_ONEPIECE_SHOES':
      text = `${onepieceName}配${shoesName}衔接裙装与鞋履，${finish}`;
      break;
    case 'STRUCTURE_TOP_BOTTOM':
      text = `${topName}配${bottomName}组成上下装，轮廓清楚，${finish}`;
      break;
    default:
      text = `${relationItemLabel(model, items[0]?.role, '当前单品')}是视觉重点，${finish}`;
      break;
  }
  return {
    relationCode: relation.relationCode,
    text: compactText(text),
    supportedBy: relation.authorizedValues.slice(),
    semanticSkeleton: relation.semanticSkeleton || '',
    todayExpressionIntent: relation.todayExpressionIntent || '',
  };
}

function buildDetailClaim(model, relation) {
  const items = Array.isArray(model?.items) ? model.items : [];
  const byRole = new Map(items.map((item) => [item.role, item]));
  const label = (role, fallback) => {
    const item = byRole.get(role);
    return `${item?.normalizedColor || ''}${item?.canonicalSubtype || item?.canonicalName || fallback}`;
  };
  const top = label('top', '上衣');
  const bottom = label('bottom', '下装');
  const onepiece = label('onepiece', '连衣裙');
  const outerwear = label('outerwear', '外套');
  const shoes = label('shoes', '鞋子');
  const patternedRole = relation.roles?.[0];
  const patterned = label(patternedRole, '单品');
  let text = '';
  switch (relation.relationCode) {
    case 'SAME_COLOR_ALL_ROLES':
      text = `${joinChineseLabels(relation.roles.map((role) => label(role, '单品')))}延续同一色系，视觉连贯感更强。`;
      break;
    case 'SAME_COLOR_TOP_BOTTOM':
      text = `${top}与${bottom}延续同一色系，上下装的色块衔接更顺。`;
      break;
    case 'COLOR_ECHO_TOP_SHOES':
      text = `${top}和${shoes}用同色落下呼应点，整体更有连贯感。`;
      break;
    case 'COLOR_ECHO_ONEPIECE_SHOES':
      text = `${onepiece}和${shoes}用同色落下呼应点，裙装到鞋履的视觉更连贯。`;
      break;
    case 'COLOR_ECHO_BOTTOM_SHOES':
      text = `${bottom}和${shoes}用同色落下呼应点，下装到鞋履的视觉更连贯。`;
      break;
    case 'TOP_ACCENT_WITH_NEUTRAL_BOTTOM':
      text = `${top}以亮色形成视觉重点，${bottom}用中性色承接，配色主次更清楚。`;
      break;
    case 'DISTINCT_TOP_BOTTOM_COLOR':
      text = `${top}与${bottom}用不同颜色拉开区分，配色层次更清楚。`;
      break;
    case 'SUBTYPE_FEATURE_PRINT':
      text = `${patterned}的印花提供视觉重点，其他单品不必再增加复杂信息。`;
      break;
    case 'PATTERN_SOLID_BALANCE':
      text = `${patterned}用印花吸引视线，${label(relation.roles?.[1], '纯色单品')}用纯色留出空间，画面更易保持清楚。`;
      break;
    case 'NEUTRAL_COLOR_BRIDGE':
      text = `${label(relation.roles?.[0], '单品')}与${label(relation.roles?.[1], '单品')}用不同中性色过渡，视觉层次更自然。`;
      break;
    case 'STRUCTURE_ONEPIECE_OUTERWEAR':
      text = `${onepiece}放在内层，${outerwear}补出外层变化，穿搭层次更完整。`;
      break;
    case 'STRUCTURE_ONEPIECE_SHOES':
      text = `${onepiece}与${shoes}从裙装延续到鞋履，收尾更完整。`;
      break;
    case 'STRUCTURE_TOP_BOTTOM':
      text = `${top}与${bottom}从上到下分区清楚，整体轮廓更利落。`;
      break;
    case 'SINGLE_COLOR_FALLBACK':
      text = `${patterned}的颜色作为视觉锚点，其他单品更容易保持克制。`;
      break;
    default:
      break;
  }
  return text ? {
    relationCode: relation.relationCode,
    text: compactText(text),
    supportedBy: relation.authorizedValues.slice(),
  } : null;
}

function buildRelations(items) {
  const relations = [];
  const byRole = new Map(items.map((item) => [item.role, item]));
  const top = byRole.get('top');
  const bottom = byRole.get('bottom');
  const onepiece = byRole.get('onepiece');
  const outerwear = byRole.get('outerwear');
  const shoes = byRole.get('shoes');
  const colored = [onepiece, top, bottom, outerwear, shoes].filter((item) => item?.normalizedColor);
  const push = (relationCode, roles, values) => {
    if (!roles.length || values.some((value) => !value)) return;
    const subjectItems = roles.map((role) => byRole.get(role)).filter(Boolean);
    if (subjectItems.length !== roles.length || subjectItems.some((item) => !item.itemId)) return;
    const evidenceFactIds = uniqueStrings(subjectItems.flatMap((item) => item.authorizedFactIds || []));
    if (evidenceFactIds.length === 0) return;
    relations.push({
      relationCode,
      roles,
      authorizedValues: uniqueStrings(values),
      subjectItemIds: uniqueStrings(subjectItems.map((item) => item.itemId)),
      evidenceFactIds,
      semanticSkeleton: relationSemanticSkeleton(relationCode, roles),
      todayExpressionIntent: relationExpressionIntent(relationCode),
    });
  };
  const patterned = items.find((item) => item.visibleFeatureTags.includes('印花'));
  const solid = items.find((item) => item.role !== patterned?.role && item.visibleFeatureTags.includes('纯色'));
  if (patterned) {
    push('SUBTYPE_FEATURE_PRINT', [patterned.role], [patterned.canonicalSubtype]);
  }
  if (patterned && solid) {
    push('PATTERN_SOLID_BALANCE', [patterned.role, solid.role], [patterned.canonicalSubtype, solid.canonicalSubtype]);
  }
  if (colored.length >= 2 && colored.length === items.length
    && uniqueStrings(colored.map((item) => item.normalizedColor)).length === 1) {
    push('SAME_COLOR_ALL_ROLES', colored.map((item) => item.role), colored.map((item) => item.normalizedColor));
  }
  if (top?.normalizedColor && bottom?.normalizedColor && top.normalizedColor === bottom.normalizedColor) {
    push('SAME_COLOR_TOP_BOTTOM', ['top', 'bottom'], [top.normalizedColor, bottom.normalizedColor]);
  }
  if (top?.normalizedColor && shoes?.normalizedColor && top.normalizedColor === shoes.normalizedColor) {
    push('COLOR_ECHO_TOP_SHOES', ['top', 'shoes'], [top.normalizedColor, shoes.normalizedColor]);
  }
  if (onepiece?.normalizedColor && shoes?.normalizedColor && onepiece.normalizedColor === shoes.normalizedColor) {
    push('COLOR_ECHO_ONEPIECE_SHOES', ['onepiece', 'shoes'], [onepiece.normalizedColor, shoes.normalizedColor]);
  }
  if (bottom?.normalizedColor && shoes?.normalizedColor && bottom.normalizedColor === shoes.normalizedColor) {
    push('COLOR_ECHO_BOTTOM_SHOES', ['bottom', 'shoes'], [bottom.normalizedColor, shoes.normalizedColor]);
  }
  if (top?.normalizedColor && bottom?.normalizedColor
    && top.normalizedColor !== bottom.normalizedColor
    && !NEUTRAL_COLORS.has(top.normalizedColor)
    && NEUTRAL_COLORS.has(bottom.normalizedColor)) {
    push('TOP_ACCENT_WITH_NEUTRAL_BOTTOM', ['top', 'bottom'], [top.normalizedColor, bottom.normalizedColor]);
  }
  if (top?.normalizedColor && bottom?.normalizedColor && top.normalizedColor !== bottom.normalizedColor) {
    push('DISTINCT_TOP_BOTTOM_COLOR', ['top', 'bottom'], [top.normalizedColor, bottom.normalizedColor]);
  }
  const neutralPair = firstItemPair(colored, (left, right) => left.normalizedColor !== right.normalizedColor
    && NEUTRAL_COLORS.has(left.normalizedColor)
    && NEUTRAL_COLORS.has(right.normalizedColor));
  if (neutralPair) {
    push('NEUTRAL_COLOR_BRIDGE', neutralPair.map((item) => item.role), neutralPair.map((item) => item.normalizedColor));
  }
  if (colored.length === 1) {
    const item = colored[0];
    push('SINGLE_COLOR_FALLBACK', [item.role], [item.normalizedColor]);
  }
  if (onepiece && outerwear) {
    push('STRUCTURE_ONEPIECE_OUTERWEAR', ['onepiece', 'outerwear'], [onepiece.canonicalSubtype, outerwear.canonicalSubtype]);
  }
  if (onepiece && shoes) {
    push('STRUCTURE_ONEPIECE_SHOES', ['onepiece', 'shoes'], [onepiece.canonicalSubtype, shoes.canonicalSubtype]);
  }
  if (top && bottom) {
    push('STRUCTURE_TOP_BOTTOM', ['top', 'bottom'], [top.canonicalSubtype, bottom.canonicalSubtype]);
  }
  const order = new Map(RELATION_PRIORITY.map((value, index) => [value, index]));
  return relations.sort((left, right) => (order.get(left.relationCode) ?? 99) - (order.get(right.relationCode) ?? 99));
}

function buildItemFact(roleEntry, item, candidate) {
  const source = asObject(item || roleEntry);
  const role = normalizeRole(roleEntry?.slot || roleEntry?.category || source.outfitSlot || source.category || roleEntry?.role);
  if (!role) return null;
  const records = collectFactRecords(source, candidate, roleEntry);
  const authorizedRecords = records.filter(isAuthorizedRecord);
  const rawSubtype = firstCanonicalSubtypeSource(role, [
    source.subcategory,
    source.subCategory,
    source.shoeType,
    source.type,
    source.customName,
    source.name,
    roleEntry?.displayName,
    source.category,
  ]);
  const featureTags = readVisibleFeatureTags(authorizedRecords);
  const baseSubtype = canonicalSubtype(role, rawSubtype, authorizedRecords);
  const canonicalSubtypeValue = featureTags.includes('印花') && baseSubtype && !baseSubtype.includes('印花')
    ? `印花${baseSubtype}`
    : baseSubtype;
  const canonicalName = canonicalNameFor(role, baseSubtype, roleEntry, source);
  const itemId = readItemId(source) || readItemId(roleEntry);
  return {
    itemId,
    role,
    canonicalName,
    canonicalSubtype: canonicalSubtypeValue || canonicalName,
    visibleFeatureTags: featureTags,
    normalizedColor: extractAuthorizedColor(source, authorizedRecords),
    authorizedFactIds: uniqueStrings(authorizedRecords.map((record) => readAuthorizedFactId(record, itemId))),
  };
}

function collectFactRecords(item, candidate, roleEntry) {
  const id = readItemId(item) || readItemId(roleEntry);
  const adapted = adaptLegacyVisibleFactItem({ ...item, _id: id || item?._id });
  const sources = [
    item?.factRecords,
    item?.factEvidence,
    item?.factsWithSource,
    adapted?.factRecords,
    candidate?.visibleFacts?.itemFactsById?.[id]?.factRecords,
    candidate?.copyFacts?.itemFactsById?.[id]?.factRecords,
  ];
  const records = sources.flatMap((value) => Array.isArray(value) ? value : []);
  return dedupeRecords(records);
}

function extractAuthorizedColor(item, records) {
  const record = records.find((entry) => isAuthorizedRecord(entry)
    && ['color', 'basic_color'].includes(normalizeFact(entry))
    && isText(entry.value));
  if (record) return normalizeColor(record.value);
  const hasAuthorizedColorFact = records.some((entry) => isAuthorizedRecord(entry)
    && ['color', 'basic_color'].includes(normalizeFact(entry)));
  if (!hasAuthorizedColorFact) return '';
  return normalizeColor(readRawColor(item));
}

function readVisibleFeatureTags(records) {
  const tags = [];
  for (const record of records) {
    if (!isAuthorizedRecord(record)) continue;
    const fact = normalizeFact(record);
    const value = `${record.value || ''}`;
    if (fact === 'pattern_visible' && (record.value === true || /印花|print|graphic|floral|yes|true/i.test(value))) tags.push('印花');
    if (fact === 'solid_color' && (record.value === true || /纯色|solid|plain|yes|true/i.test(value))) tags.push('纯色');
  }
  return uniqueStrings(tags);
}

function canonicalSubtype(role, raw, records) {
  const factText = records
    .filter(isAuthorizedRecord)
    .map((record) => `${record.fact || record.factId || ''} ${record.value || ''}`)
    .join(' ');
  const text = `${String(raw || '')} ${factText}`.toLowerCase().replace(/[_-]+/g, ' ');
  const facts = new Set(records.filter(isAuthorizedRecord).map(normalizeFact));
  if (role === 'top') {
    if (/\u77ed\u8896\s*t\u6064/i.test(text) || facts.has('short_sleeve')) return '\u77ed\u8896T\u6064';
    if (/印花|print|graphic|floral/.test(text) || facts.has('pattern_visible')) {
      if (/t恤|tshirt|t_shirt|tee/.test(text) || facts.has('short_sleeve') || facts.has('sport_top')) return 'T恤';
    }
    if (/短袖\s*t恤|短袖t恤|tshirt|t_shirt|tee|t恤/.test(text) || facts.has('short_sleeve')) return /短袖/.test(text) ? '短袖T恤' : 'T恤';
    if (facts.has('sport_top')) return '运动上衣';
    if (/衬衫|衬衣|shirt|blouse/.test(text) || facts.has('shirt')) return '衬衫';
    if (/卫衣|hoodie|sweatshirt/.test(text)) return '卫衣';
    if (/针织|knit|sweater/.test(text)) return '针织上衣';
  }
  if (role === 'bottom') {
    if (/短裤|shorts|bermuda/.test(text) || facts.has('shorts')) return '短裤';
    if (/牛仔|jeans|denim/.test(text)) return '牛仔裤';
    if (/直筒|straight/.test(text) || facts.has('straight_cut')) return '直筒裤';
    if (/阔腿|wide.?leg/.test(text)) return '阔腿裤';
    if (/运动裤|jogger|sweatpants|sport/.test(text) || facts.has('sport_bottom')) return '运动裤';
    if (/半身裙|skirt|裙/.test(text)) return '半身裙';
  }
  if (role === 'onepiece') {
    if (/吊带裙|slip\s*dress/.test(text)) return '吊带裙';
    if (/背心裙|pinafore/.test(text)) return '背心裙';
    if (/连衣裙|dress|onepiece/.test(text)) return '连衣裙';
  }
  if (role === 'shoes') {
    if (/运动鞋|跑步鞋|训练鞋|sneaker|running|sport/.test(text) || facts.has('sport_shoe')) return '运动鞋';
    if (/帆布|canvas/.test(text)) return '帆布鞋';
    if (/乐福|loafer/.test(text)) return '乐福鞋';
    if (/凉鞋|sandal/.test(text)) return '凉鞋';
  }
  if (role === 'outerwear' && /外套|coat|jacket/.test(text)) return '外套';
  return cleanSubtype(raw, role);
}

function canonicalNameFor(role, subtype, roleEntry, item) {
  if (subtype) return subtype;
  const displayName = dedupeCanonicalTokens(readText(roleEntry?.displayName || item?.customName || item?.name));
  return displayName || ({ top: '上衣', bottom: '下装', shoes: '鞋子', onepiece: '连衣裙', outerwear: '外套' }[role] || '单品');
}

function cleanSubtype(value, role) {
  const text = readText(value);
  if (!text) return '';
  const normalizedText = dedupeCanonicalTokens(text.replace(/[_-]+/g, ' '));
  if (role === 'top' && /(?:^|\s)sport\s+top(?:\s|$)/i.test(normalizedText)) return '运动上衣';
  if (role === 'bottom' && /(?:^|\s)sport\s+(?:bottom|pants)(?:\s|$)/i.test(normalizedText)) return '运动裤';
  if (role === 'shoes' && /(?:^|\s)sport\s+sh(?:oe|oes)(?:\s|$)/i.test(normalizedText)) return '运动鞋';
  const roleWords = new RegExp(`(?:^|\\s)(?:${role}|上衣|下装|裤子|鞋子|shoes?|top|bottom)(?=\\s|$)`, 'gi');
  const styleWords = /简约|休闲|日常|校园|通勤|运动|甜美|复古|街头|优雅|pure|casual|daily|sport/gi;
  const cleaned = normalizedText.replace(roleWords, ' ').replace(styleWords, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned || /^(?:top|bottom|shoes?)$/i.test(cleaned)) return '';
  return dedupeCanonicalTokens(cleaned.split(' ').filter(Boolean).slice(0, 2).join(' '));
}

function firstCanonicalSubtypeSource(role, values) {
  const generic = new Set({
    top: ['top', '上衣'],
    bottom: ['bottom', '下装', '裤子'],
    shoes: ['shoe', 'shoes', '鞋', '鞋子'],
    onepiece: ['onepiece', 'dress'],
    outerwear: ['outerwear'],
  }[role] || []);
  const candidates = uniqueStrings(values).map(dedupeCanonicalTokens).filter(Boolean);
  return candidates.find((value) => !generic.has(semanticTokenKey(value))) || candidates[0] || '';
}

function dedupeCanonicalTokens(value) {
  let text = readText(value).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const tokens = text.split(' ').filter(Boolean);
  text = tokens.filter((token, index) => index === 0
    || semanticTokenKey(token) !== semanticTokenKey(tokens[index - 1])).join(' ');
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const compact = text.replace(/\s+/g, '');
    if (compact.length < 4 || compact.length % 2 !== 0) break;
    const midpoint = compact.length / 2;
    const left = compact.slice(0, midpoint);
    const right = compact.slice(midpoint);
    if (semanticTokenKey(left) !== semanticTokenKey(right)) break;
    text = left;
  }
  return text;
}

function semanticTokenKey(value) {
  return readText(value).toLowerCase().replace(/[\s·._-]+/g, '');
}

function readAuthorizedFactId(record, itemId) {
  const factId = readText(record?.factId);
  if (factId) return factId;
  const fact = normalizeFact(record);
  return itemId && fact ? `item:${itemId}:${fact}` : '';
}

function relationItemLabel(model, role, fallback) {
  const item = (Array.isArray(model?.items) ? model.items : []).find((entry) => entry.role === role);
  return `${item?.normalizedColor || ''}${item?.canonicalSubtype || item?.canonicalName || fallback}`;
}

function joinChineseLabels(values) {
  const labels = uniqueStrings(values);
  if (labels.length <= 1) return labels[0] || '';
  if (labels.length === 2) return `${labels[0]}与${labels[1]}`;
  return `${labels.slice(0, -1).join('、')}和${labels.at(-1)}`;
}

function firstItemPair(items, predicate) {
  for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < items.length; rightIndex += 1) {
      const left = items[leftIndex];
      const right = items[rightIndex];
      if (left && right && predicate(left, right)) return [left, right];
    }
  }
  return null;
}

function relationSemanticSkeleton(relationCode, roles) {
  return `${uniqueStrings(roles).join('+')}>${relationCode.toLowerCase()}`;
}

function relationExpressionIntent(relationCode) {
  return {
    SUBTYPE_FEATURE_PRINT: 'visible_print_focus',
    PATTERN_SOLID_BALANCE: 'pattern_and_solid_relation',
    SAME_COLOR_ALL_ROLES: 'same_color_whole_outfit',
    SAME_COLOR_TOP_BOTTOM: 'same_color_top_bottom',
    COLOR_ECHO_TOP_SHOES: 'top_shoes_color_echo',
    COLOR_ECHO_ONEPIECE_SHOES: 'onepiece_shoes_color_echo',
    COLOR_ECHO_BOTTOM_SHOES: 'bottom_shoes_color_echo',
    TOP_ACCENT_WITH_NEUTRAL_BOTTOM: 'accent_and_neutral_relation',
    NEUTRAL_COLOR_BRIDGE: 'neutral_color_bridge',
    DISTINCT_TOP_BOTTOM_COLOR: 'distinct_top_bottom_color',
    SINGLE_COLOR_FALLBACK: 'visible_color_anchor',
    STRUCTURE_ONEPIECE_OUTERWEAR: 'onepiece_outerwear_structure',
    STRUCTURE_ONEPIECE_SHOES: 'onepiece_shoes_structure',
    STRUCTURE_TOP_BOTTOM: 'top_bottom_structure',
  }[relationCode] || '';
}

function toDifferentiator(relation) {
  return {
    type: 'relation',
    relationCode: relation.relationCode,
    roles: relation.roles.slice(),
    authorizedValues: relation.authorizedValues.slice(),
    authorizedValue: relation.authorizedValues[0] || '',
    subjectItemIds: Array.isArray(relation.subjectItemIds) ? relation.subjectItemIds.slice() : [],
    evidenceFactIds: Array.isArray(relation.evidenceFactIds) ? relation.evidenceFactIds.slice() : [],
    semanticSkeleton: relation.semanticSkeleton || '',
    todayExpressionIntent: relation.todayExpressionIntent || '',
  };
}

function toSignatureItem(item) {
  return {
    role: item.role,
    canonicalName: item.canonicalName,
    canonicalSubtype: item.canonicalSubtype,
    visibleFeatureTags: item.visibleFeatureTags,
    normalizedColor: item.normalizedColor,
  };
}

function stripInternalItemFields(item) {
  return {
    ...toSignatureItem(item),
    itemId: item.itemId || '',
    authorizedFactIds: Array.isArray(item.authorizedFactIds) ? item.authorizedFactIds.slice() : [],
  };
}

function cloneDifferentiator(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    ...value,
    roles: Array.isArray(value.roles) ? value.roles.slice() : [],
    authorizedValues: Array.isArray(value.authorizedValues) ? value.authorizedValues.slice() : [],
    subjectItemIds: Array.isArray(value.subjectItemIds) ? value.subjectItemIds.slice() : [],
    evidenceFactIds: Array.isArray(value.evidenceFactIds) ? value.evidenceFactIds.slice() : [],
  };
}

function differentiatorSignature(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return stableSerialize({
    type: value.type || (value.relationCode ? 'relation' : ''),
    relationCode: value.relationCode || '',
    roles: Array.isArray(value.roles) ? value.roles : [],
    authorizedValues: Array.isArray(value.authorizedValues) ? value.authorizedValues : [],
  });
}

function findDifferentiatorRelation(model, differentiator) {
  if (!differentiator?.relationCode) return null;
  return (Array.isArray(model?.relations) ? model.relations : [])
    .find((relation) => relation.relationCode === differentiator.relationCode
      && differentiatorSignature(relation) === differentiatorSignature(differentiator))
    || (Array.isArray(model?.relations) ? model.relations : [])
      .find((relation) => relation.relationCode === differentiator.relationCode)
    || null;
}

function buildSurfaceMetadata(model, relation) {
  const relationCode = relation?.relationCode || null;
  const isPatternRelation = ['SUBTYPE_FEATURE_PRINT', 'PATTERN_SOLID_BALANCE'].includes(relationCode);
  const isStructureRelation = /^STRUCTURE_/.test(relationCode || '');
  const action = isPatternRelation
    ? 'highlight_pattern'
    : isStructureRelation
      ? 'explain_structure_relation'
    : relationCode === 'SINGLE_COLOR_FALLBACK'
      ? 'identify_color_anchor'
      : relationCode ? 'explain_color_relation' : null;
  const dimension = isPatternRelation ? 'pattern' : isStructureRelation ? 'structure' : relationCode ? 'color' : null;
  const subjectItemIds = uniqueStrings(Array.isArray(relation?.subjectItemIds)
    ? relation.subjectItemIds
    : (Array.isArray(relation?.roles) ? relation.roles : []).map((role) => (
      (Array.isArray(model?.items) ? model.items : []).find((item) => item.role === role)?.itemId
    )));
  const evidenceFactIds = uniqueStrings(Array.isArray(relation?.evidenceFactIds)
    ? relation.evidenceFactIds
    : []);
  return { action, dimension, subjectItemIds, evidenceFactIds };
}

function emptySurfaceMetadata() {
  return { action: null, dimension: null, subjectItemIds: [], evidenceFactIds: [] };
}

function buildPresentationEvidenceSources(factIds) {
  return uniqueStrings(factIds).map((factId) => ({ factId, source: PRESENTATION_PLAN_SOURCE }));
}

function buildSlotBindings(model, subjectItemIds) {
  const allowedIds = new Set(uniqueStrings(subjectItemIds));
  return Object.fromEntries((Array.isArray(model?.items) ? model.items : [])
    .filter((item) => item.itemId && allowedIds.has(item.itemId))
    .map((item) => [item.role, item.itemId]));
}

function buildSurfacePatch(plan, {
  todayEvidenceSources = [],
  detailEvidenceSources = [],
  todaySlotBindings = {},
  detailSlotBindings = {},
} = {}) {
  const todaySubjectItemIds = uniqueStrings(plan?.todaySubjectItemIds);
  const detailSubjectItemIds = uniqueStrings(plan?.detailSubjectItemIds);
  const todayEvidenceFactIds = uniqueStrings(plan?.todayEvidenceFactIds);
  const detailEvidenceFactIds = uniqueStrings(plan?.detailEvidenceFactIds);
  return {
    todayClaim: null,
    todayClaimId: '',
    todayAction: plan?.todayAction || null,
    todayDimension: plan?.todayDimension || null,
    todayEvidenceIds: todayEvidenceFactIds,
    todayEvidenceFactIds,
    todayRequiredFactIds: todayEvidenceFactIds,
    todayEvidenceSources,
    todaySentenceClusterId: null,
    todaySubjectItemId: todaySubjectItemIds[0] || '',
    todaySubjectItemIds,
    todaySlotBindings,
    detailClaim: null,
    detailClaimId: '',
    detailAction: plan?.detailAction || null,
    detailDimension: plan?.detailDimension || null,
    detailEvidenceIds: detailEvidenceFactIds,
    detailEvidenceFactIds,
    detailRequiredFactIds: detailEvidenceFactIds,
    detailEvidenceSources,
    detailSentenceClusterId: null,
    detailSubjectItemId: detailSubjectItemIds[0] || '',
    detailSubjectItemIds,
    detailSlotBindings,
    enhancedReason: undefined,
  };
}

function relationTitleLabel(code) {
  return {
    SAME_COLOR_ALL_ROLES: '同色',
    SAME_COLOR_TOP_BOTTOM: '同色上下装',
    COLOR_ECHO_TOP_SHOES: '颜色呼应',
    SUBTYPE_FEATURE_PRINT: '印花重点',
    TOP_ACCENT_WITH_NEUTRAL_BOTTOM: '重点色',
    DISTINCT_TOP_BOTTOM_COLOR: '撞色',
    SINGLE_COLOR_FALLBACK: '单色',
  }[code] || '';
}

function buildSceneConclusion(scene) {
  return scene === 'sport' ? '适合日常轻运动' : `适合${SCENE_LABELS[scene] || '日常'}场景`;
}

function buildSceneBenefit(model, relation) {
  const scene = model?.scene;
  const items = Array.isArray(model?.items) ? model.items : [];
  const colors = uniqueStrings(items.map((item) => item.normalizedColor).filter(Boolean));
  if (scene === 'home') return colors.length <= 2 ? '配色简洁' : '视觉重点清楚';
  if (scene === 'work') return '整体利落';
  if (scene === 'date') return relation?.relationCode && relation.relationCode.includes('COLOR')
    ? '配色有呼应，整体更完整'
    : '层次清楚，整体更完整';
  if (scene === 'sport') {
    const authorizedFacts = new Set(items.flatMap((item) => item.authorizedFactIds || []));
    const hasShortSleeve = [...authorizedFacts].some((factId) => /:short_sleeve$/.test(factId));
    const hasShorts = [...authorizedFacts].some((factId) => /:shorts$/.test(factId));
    const hasSportShoes = [...authorizedFacts].some((factId) => /:sport_shoe$/.test(factId));
    if (hasShortSleeve && hasShorts && hasSportShoes) return '组合简洁';
    return '画面清爽';
  }
  return '整体更清楚';
}

function shortColor(value) {
  return COLOR_SHORT_LABELS[value] || value.replace(/色$/, '');
}

function extractColorText(value) {
  return typeof value === 'string' ? value.trim() : typeof value?.name === 'string' ? value.name.trim() : typeof value?.color === 'string' ? value.color.trim() : '';
}

function normalizeColor(value) {
  const raw = extractColorText(value);
  if (!raw || /#[0-9a-f]{3,8}/i.test(raw) || /\d/.test(raw)) return '';
  return COLOR_LABELS.find(([pattern]) => pattern.test(raw))?.[1] || (/^[a-z][a-z -]{1,24}$/i.test(raw) ? raw.toLowerCase() : '');
}

function readRawColor(item) {
  return [item?.color, item?.colorName, ...(Array.isArray(item?.colors) ? item.colors : []), ...(Array.isArray(item?.colorPalette) ? item.colorPalette : [])]
    .map(extractColorText).find(Boolean) || '';
}

function normalizeFact(record) {
  const value = readText(record?.fact || record?.factId).toLowerCase();
  return value.replace(/^item:[^:]+:/, '');
}

function isAuthorizedRecord(record) {
  return Boolean(record && record.authorized !== false && (readText(record.fact || record.factId) || record.value));
}

function findItem(items, roleEntry) {
  const id = readItemId(roleEntry);
  return items.find((item) => readItemId(item) === id) || items.find((item) => normalizeRole(item?.outfitSlot || item?.category) === normalizeRole(roleEntry?.slot)) || null;
}

function readItems(source) {
  if (Array.isArray(source?.items) && source.items.length > 0) return source.items;
  if (Array.isArray(source?.snapshotItems) && source.snapshotItems.length > 0) return source.snapshotItems;
  return Array.isArray(source?.itemsSnapshot) ? source.itemsSnapshot : [];
}

function readRoleEntries(source) {
  return Array.isArray(source?.outfitItemRoles) ? source.outfitItemRoles : Array.isArray(source?.itemRoles) ? source.itemRoles : [];
}

function readItemId(value) {
  const id = value?._id || value?.id || value?.itemId || value?.clothingId;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : '';
}

function normalizeRole(value) {
  const raw = readText(value).toLowerCase();
  if (raw === 'skirt' || /半裙|裙子/.test(raw)) return 'bottom';
  if (/onepiece|dress|连衣裙/.test(raw)) return 'onepiece';
  if (/shoes?|shoe|鞋|靴/.test(raw)) return 'shoes';
  if (/outerwear|coat|jacket|外套/.test(raw)) return 'outerwear';
  if (/bottom|pants|下装|裤/.test(raw)) return 'bottom';
  if (/top|shirt|tee|t恤|上衣|卫衣/.test(raw)) return 'top';
  return raw;
}

function normalizeScene(value) {
  const raw = readText(value).toLowerCase();
  return { 居家: 'home', home: 'home', 上班: 'work', 通勤: 'work', work: 'work', 约会: 'date', date: 'date', 运动: 'sport', sport: 'sport', sports: 'sport' }[raw] || raw || 'home';
}

function readPresentationPlan(source) {
  const plan = source?.presentationPlan;
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return null;
  if (!plan.factModel || typeof plan.factModel !== 'object' || Array.isArray(plan.factModel)) return null;
  if (typeof plan.presentationFactSignature !== 'string') return null;
  return plan;
}

function roleIndex(role) {
  const index = ROLE_ORDER.indexOf(role);
  return index === -1 ? ROLE_ORDER.length : index;
}

function dedupeRecords(records) {
  const seen = new Set();
  return records.filter((record) => {
    const key = `${normalizeFact(record)}|${String(record?.value ?? '')}|${String(record?.source || '')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
}

function compactText(value) {
  return String(value || '').replace(/\s+/g, '').replace(/，+/g, '，').trim();
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter(isText).map((value) => value.trim()))];
}

function isText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function readText(value) {
  return isText(value) ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

module.exports = {
  PRESENTATION_FACT_MODEL_BUILD,
  PRESENTATION_FACT_MODEL_VERSION,
  PRESENTATION_PLAN_VERSION,
  assignPresentationDifferentiators,
  applyPresentationPlan,
  buildPresentationFactModel,
  buildPresentationPlan,
  readPresentationPlan,
  normalizeColor,
  normalizeScene,
};
