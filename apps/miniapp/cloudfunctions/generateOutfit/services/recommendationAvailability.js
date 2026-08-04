const MISSING_ROLE_ORDER = ['top', 'bottom', 'onepiece', 'shoes'];
const MISSING_FACT_ORDER = ['sport_activity_top', 'sport_activity_bottom', 'sport_stable_shoe'];

function getMissingRequiredRoles(clothes, scene) {
  const categories = new Set((Array.isArray(clothes) ? clothes : [])
    .filter((item) => item && item._id)
    .map(normalizeCategory));
  const hasTop = categories.has('top');
  const hasBottom = categories.has('bottom');
  const hasOnepiece = categories.has('onepiece');
  const missing = [];

  if (!hasOnepiece && !(hasTop && hasBottom)) {
    if (!hasTop) missing.push('top');
    if (!hasBottom) missing.push('bottom');
    if (!hasTop && !hasBottom) missing.push('onepiece');
  }
  if (normalizeScene(scene) !== 'home' && !categories.has('shoes')) missing.push('shoes');
  return MISSING_ROLE_ORDER.filter((role) => missing.includes(role));
}

function getMissingRequiredFacts(clothes, scene) {
  if (normalizeScene(scene) !== 'sport') return [];
  const items = Array.isArray(clothes) ? clothes.filter((item) => item && item._id) : [];
  const textFor = (item) => [item.category, item.subcategory, item.subCategory, item.customName, item.type,
    ...(Array.isArray(item.sceneTags) ? item.sceneTags : []), ...(Array.isArray(item.styleTags) ? item.styleTags : [])]
    .filter(Boolean).join(' ').toLowerCase();
  const hasActivityTop = items.some((item) => normalizeCategory(item) === 'top'
    && /t恤|t-shirt|tee|背心|vest|卫衣|hoodie|sweatshirt|运动|训练|跑步|瑜伽|sport|training|running|athletic|yoga/.test(textFor(item)));
  const hasActivityBottom = items.some((item) => normalizeCategory(item) === 'bottom'
    && /束脚|jogger|运动裤|卫裤|sweatpants|运动短裤|训练短裤|training|sport|running|athletic|跑步|训练/.test(textFor(item)));
  const hasStableSportShoe = items.some((item) => {
    const text = textFor(item);
    return normalizeCategory(item) === 'shoes'
      && /运动鞋|跑步鞋|训练鞋|休闲运动鞋|sneaker|trainer|running|training/.test(text)
      && !/拖鞋|洞洞鞋|高跟|长靴|slipper|crocs|heel|boot/.test(text);
  });
  const missing = [];
  if (!hasActivityTop) missing.push('sport_activity_top');
  if (!hasActivityBottom) missing.push('sport_activity_bottom');
  if (!hasStableSportShoe) missing.push('sport_stable_shoe');
  return MISSING_FACT_ORDER.filter((fact) => missing.includes(fact));
}

function resolveRecommendationAvailability(input = {}) {
  const requestedCount = toCount(input.requestedCount);
  const finalRecommendationCount = toCount(input.finalRecommendationCount);
  const missingRoles = normalizeMissingRoles(input.missingRoles);
  const missingFacts = normalizeMissingFacts(input.missingFacts);
  const candidateCount = toCount(input.candidateCount);
  const guardAcceptedCount = toCount(input.guardAcceptedCount);
  const weatherRejectedCount = toCount(input.weatherRejectedCount);
  const generatedCount = toCount(input.generatedCount);
  const excludedOutfitKeyCount = toCount(input.excludedOutfitKeyCount);
  const copyHiddenCount = toCount(input.copyHiddenCount);
  const limited = finalRecommendationCount < requestedCount;

  let limitedReason = null;
  if (limited && missingRoles.length > 0) {
    limitedReason = 'MISSING_REQUIRED_CATEGORY';
  } else if (limited && finalRecommendationCount === 0 && excludedOutfitKeyCount > 0) {
    limitedReason = 'DIVERSITY_EXHAUSTED';
  } else if (limited) {
    const weatherAcceptedCount = Math.max(candidateCount - weatherRejectedCount, 0);
    if (candidateCount > 0 && weatherAcceptedCount < requestedCount) {
      limitedReason = 'WEATHER_ELIGIBLE_FEW';
    } else if (candidateCount > 0 && guardAcceptedCount < requestedCount) {
      limitedReason = 'SCENE_ELIGIBLE_FEW';
    } else if (generatedCount < requestedCount) {
      limitedReason = 'DIVERSITY_EXHAUSTED';
    } else {
      limitedReason = 'SCENE_ELIGIBLE_FEW';
    }
  }

  return {
    limited,
    limitedReason,
    missingRoles,
    missingFacts,
    exhausted: finalRecommendationCount === 0 && limitedReason === 'DIVERSITY_EXHAUSTED',
    copyDiagnosticReason: copyHiddenCount > 0 ? 'COPY_EVIDENCE_INSUFFICIENT' : null,
  };
}

function getPartialRecommendationNotice(count) {
  if (count === 1) return '这次先给你找到一套合适的。';
  if (count === 2) return '这次先给你找到两套合适的。';
  if (count > 2) return '这次先给你找到这几套合适的。';
  return '';
}

function normalizeCategory(item) {
  const raw = readString(item?.category).toLowerCase();
  const text = [item?.category, item?.subcategory, item?.subCategory, item?.customName]
    .map(readString)
    .join(' ')
    .toLowerCase();
  if (raw === 'onepiece' || /连衣裙|连体|onepiece|dress|jumpsuit/.test(text)) return 'onepiece';
  if (raw === 'shoes' || /鞋|靴|sneaker|loafer|shoe|boots/.test(text)) return 'shoes';
  if (raw === 'bottom' || raw === 'skirt' || /裤|半裙|下装|pants|trouser|jeans|skirt/.test(text)) return 'bottom';
  if (raw === 'outerwear' || /外套|风衣|夹克|开衫|西装|羽绒|coat|jacket|cardigan|blazer/.test(text)) return 'outerwear';
  if (raw === 'top' || /上衣|衬衫|t恤|针织|卫衣|shirt|tee|sweater/.test(text)) return 'top';
  return raw || 'other';
}

function normalizeScene(value) {
  const scene = readString(value).toLowerCase();
  if (['home', '居家'].includes(scene)) return 'home';
  if (['work', '上班', '通勤'].includes(scene)) return 'work';
  if (['date', '约会'].includes(scene)) return 'date';
  if (['sport', 'sports', '运动'].includes(scene)) return 'sport';
  return scene || 'home';
}

function normalizeMissingRoles(value) {
  const roles = Array.isArray(value) ? value.filter((role) => MISSING_ROLE_ORDER.includes(role)) : [];
  return MISSING_ROLE_ORDER.filter((role) => roles.includes(role));
}

function normalizeMissingFacts(value) {
  const facts = Array.isArray(value) ? value.filter((fact) => MISSING_FACT_ORDER.includes(fact)) : [];
  return MISSING_FACT_ORDER.filter((fact) => facts.includes(fact));
}

function toCount(value) {
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(Math.floor(count), 0) : 0;
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

module.exports = {
  getMissingRequiredRoles,
  getMissingRequiredFacts,
  getPartialRecommendationNotice,
  resolveRecommendationAvailability,
};
