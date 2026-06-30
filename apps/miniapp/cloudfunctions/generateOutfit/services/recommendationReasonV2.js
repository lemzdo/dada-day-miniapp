const RECOMMENDATION_REASON_VERSION = 'recommendation-reason-v2';

const DIMENSION_ORDER = ['silhouette', 'proportion', 'color', 'pattern', 'formality', 'detail', 'style', 'weather', 'scene'];
const CATEGORY_ORDER = ['top', 'bottom', 'skirt', 'onepiece', 'outerwear', 'shoes', 'accessory', 'other'];
const UNSAFE_BODY_LANGUAGE = /显瘦|遮肉|身材|腿长|腰线|肉感/g;

function buildReasonCandidates(outfitContext = {}) {
  const items = normalizeItems(readItems(outfitContext));
  const candidates = [];
  const aesthetic = outfitContext.aestheticEvaluation || {};
  const coverage = finiteNumber(aesthetic.coverage, 0);
  const evidence = Array.isArray(aesthetic.evidence) && coverage >= 0.25 ? aesthetic.evidence : [];

  for (const entry of evidence) {
    const dimension = mapEvidenceDimension(entry.dimension, entry.code);
    if (!dimension) continue;
    const relatedItems = resolveEvidenceItems(entry, items);
    const candidate = buildEvidenceCandidate({ entry, dimension, items: relatedItems.length ? relatedItems : items });
    if (candidate) candidates.push(candidate);
  }

  addFactCandidates(candidates, items, outfitContext);

  return uniqueCandidates(candidates)
    .sort(compareCandidates)
    .map((candidate) => ({
      ...candidate,
      reason: normalizeCardReason(candidate.reason),
      reasoning: sanitizeText(candidate.reasoning || candidate.reason, 90),
    }));
}

function compileRecommendationReasonsV2({ outfits = [], scene, weather } = {}) {
  if (!Array.isArray(outfits) || outfits.length === 0) return [];

  const usedDimensions = new Set();
  const usedCodes = new Set();
  const usedReasons = new Set();

  return outfits.map((outfit, index) => {
    const context = {
      ...outfit,
      scene: outfit.scene || scene,
      weatherSnapshot: outfit.weatherSnapshot || outfit.weather || weather,
    };
    const candidates = buildReasonCandidates(context);
    const primary = choosePrimaryCandidate(candidates, usedDimensions, usedCodes, usedReasons) || buildFallbackCandidate(context, index);
    const detailCandidates = chooseDetailCandidates(candidates, primary, 2);
    const reason = ensureUniqueReason(primary.reason, usedReasons, context, index);
    const reasoning = buildDetailReasoning(primary, detailCandidates, context);
    const evidenceCodes = uniqueStrings([
      primary.code,
      ...(primary.evidenceCodes || []),
      ...detailCandidates.flatMap((candidate) => [candidate.code, ...(candidate.evidenceCodes || [])]),
    ]).filter(Boolean);

    usedDimensions.add(primary.dimension);
    if (primary.code) usedCodes.add(primary.code);
    usedReasons.add(reason);

    return stripNonFinite({
      ...outfit,
      reasonVersion: RECOMMENDATION_REASON_VERSION,
      reason,
      reasoning,
      primaryDimension: primary.dimension,
      evidenceCodes,
    });
  });
}

function choosePrimaryCandidate(candidates, usedDimensions, usedCodes, usedReasons) {
  return candidates.find((candidate) => !usedDimensions.has(candidate.dimension) && !usedReasons.has(candidate.reason))
    || candidates.find((candidate) => candidate.code && !usedCodes.has(candidate.code) && !usedReasons.has(candidate.reason))
    || candidates.find((candidate) => !usedReasons.has(candidate.reason))
    || candidates[0]
    || null;
}

function chooseDetailCandidates(candidates, primary, limit) {
  const selected = [];
  const usedDimensions = new Set([primary.dimension]);
  const usedReasons = new Set([primary.reason]);
  for (const candidate of candidates) {
    if (selected.length >= limit) break;
    if (usedDimensions.has(candidate.dimension) || usedReasons.has(candidate.reason)) continue;
    selected.push(candidate);
    usedDimensions.add(candidate.dimension);
    usedReasons.add(candidate.reason);
  }
  for (const candidate of candidates) {
    if (selected.length >= limit) break;
    if (candidate === primary || usedReasons.has(candidate.reason)) continue;
    selected.push(candidate);
    usedReasons.add(candidate.reason);
  }
  return selected;
}

function buildDetailReasoning(primary, detailCandidates, context) {
  const parts = [primary.reasoning || primary.reason, ...detailCandidates.map((candidate) => candidate.reasoning || candidate.reason)]
    .map((text) => sanitizeText(text, 58))
    .filter(Boolean);
  if (parts.length < 2) {
    const fallback = buildFallbackCandidate(context, 0);
    if (!parts.includes(fallback.reasoning)) parts.push(fallback.reasoning);
  }
  const joined = parts.slice(0, 3).join('；');
  return sanitizeText(joined.endsWith('。') ? joined : `${joined}。`, 150);
}

function ensureUniqueReason(reason, usedReasons, context, index) {
  const cleanReason = normalizeCardReason(reason);
  if (!usedReasons.has(cleanReason)) return cleanReason;
  const items = normalizeItems(readItems(context));
  const label = items[index % Math.max(items.length, 1)]?.name || items[0]?.name || '单品组合';
  const alternate = normalizeCardReason(`${label}这组线索更突出`);
  if (!usedReasons.has(alternate)) return alternate;
  return sanitizeText(`${alternate}${index + 1}`, 44);
}

function buildEvidenceCandidate({ entry, dimension, items }) {
  const code = readString(entry.code);
  const strength = finiteNumber(entry.strength, 1);
  const itemNames = summarizeItemNames(items);
  const colors = uniqueStrings(items.flatMap((item) => item.colors));
  const styles = uniqueStrings(items.flatMap((item) => item.styleTags));
  const patternItem = items.find((item) => item.patternType);
  const detailItem = items.find((item) => item.designElements.length > 0);

  if (dimension === 'silhouette') {
    return candidate(dimension, code, strength, '廓形对比让线条更有层次', `${itemNames}的轮廓关系比较清楚，视觉层次不会挤在一起`);
  }
  if (dimension === 'proportion') {
    return candidate(dimension, code, strength, '长短比例让层次更清楚', `${itemNames}形成了明确的长短层次，详情页里比卡片理由多一层比例说明`);
  }
  if (dimension === 'color' && colors.length > 0) {
    return candidate(dimension, code, strength, `${colors.slice(0, 2).join('和')}配色更集中`, `${colors.slice(0, 3).join('、')}这些颜色有真实识别记录，整体色彩关系更容易读出来`);
  }
  if (dimension === 'pattern' && patternItem) {
    return candidate(dimension, code, strength, `${patternItem.name}的图案成为重点`, `${patternItem.name}带来图案焦点，其余单品可以围绕这个视觉重点展开`);
  }
  if (dimension === 'formality') {
    return candidate(dimension, code, strength, '几件单品正式度更一致', `${itemNames}的正式度落在相近区间，放到对应场合里不容易跳脱`);
  }
  if (dimension === 'detail' && detailItem) {
    return candidate(dimension, code, strength, `${detailItem.name}的细节更有记忆点`, `${detailItem.name}的设计细节是真实识别线索，可以作为这套的视觉记忆点`);
  }
  if (dimension === 'detail') {
    return candidate(dimension, code, strength, '细节分布让重点更清楚', `${itemNames}的细节分布比较克制，视觉重点不会互相抢`);
  }
  if (styles.length > 0) {
    return candidate('style', code, strength, `${styles[0]}风格线索更集中`, `${styles.slice(0, 2).join('、')}来自单品标签，整体风格指向比较明确`);
  }
  return null;
}

function addFactCandidates(candidates, items, context) {
  if (items.length === 0) return;
  const colors = uniqueStrings(items.flatMap((item) => item.colors));
  if (colors.length > 0) {
    candidates.push(candidate('color', 'FACT_COLOR', 1.2, `${colors.slice(0, 2).join('和')}颜色关系很清楚`, `${colors.slice(0, 3).join('、')}来自衣物识别结果，卡片先讲颜色，详情再补充组合层次`));
  }

  const silhouetteItems = items.filter((item) => item.fit || item.silhouette);
  if (silhouetteItems.length > 0) {
    candidates.push(candidate('silhouette', 'FACT_SILHOUETTE', 1.1, `${summarizeItemNames(silhouetteItems)}轮廓线索明确`, `${summarizeItemNames(silhouetteItems)}有可用的版型或廓形信息，适合用来判断整体线条`));
  }

  const lengthItems = items.filter((item) => item.length);
  if (lengthItems.length > 0) {
    candidates.push(candidate('proportion', 'FACT_PROPORTION', 1, `${summarizeItemNames(lengthItems)}长短层次明确`, `${summarizeItemNames(lengthItems)}带有长度信息，能补充说明这套的比例层级`));
  }

  const patternItem = items.find((item) => item.patternType);
  if (patternItem) {
    candidates.push(candidate('pattern', 'FACT_PATTERN', 1, `${patternItem.name}的图案更抓眼`, `${patternItem.name}有图案类型记录，视觉焦点来自真实单品信息`));
  }

  const detailItem = items.find((item) => item.designElements.length > 0);
  if (detailItem) {
    candidates.push(candidate('detail', 'FACT_DETAIL', 1, `${detailItem.name}的细节有亮点`, `${detailItem.name}记录了${detailItem.designElements[0]}细节，可以作为小范围重点`));
  }

  const formalityItems = items.filter((item) => Number.isFinite(item.formalityLevel));
  if (formalityItems.length >= 2) {
    candidates.push(candidate('formality', 'FACT_FORMALITY', 1, '正式度线索落在相近区间', `${summarizeItemNames(formalityItems)}都有正式度记录，场合感更容易保持一致`));
  }

  const styles = uniqueStrings(items.flatMap((item) => item.styleTags));
  if (styles.length > 0) {
    candidates.push(candidate('style', 'FACT_STYLE', 0.9, `${styles[0]}风格线索很明确`, `${styles.slice(0, 2).join('、')}来自单品标签，能帮这套形成稳定气质`));
  }

  const weather = context.weatherSnapshot || context.weather || {};
  const temp = finiteNumber(weather.temp ?? weather.temperature, null);
  const weatherItems = items.filter((item) => item.thickness || item.material);
  if (temp !== null && weatherItems.length > 0) {
    candidates.push(candidate('weather', 'FACT_WEATHER', 0.8, `${summarizeItemNames(weatherItems)}照顾到温度`, `${summarizeItemNames(weatherItems)}带有厚薄或材质记录，可作为天气适配的补充说明`));
  }

  const scene = readString(context.scene);
  const sceneItems = items.filter((item) => item.sceneTags.length > 0 || item.styleTags.length > 0);
  if (scene && sceneItems.length > 0) {
    candidates.push(candidate('scene', 'FACT_SCENE', 0.7, `${summarizeItemNames(sceneItems)}更贴近当前场景`, `${summarizeItemNames(sceneItems)}有风格或场景标签，能支撑当前使用场景`));
  }
}

function buildFallbackCandidate(context, index) {
  const items = normalizeItems(readItems(context));
  const names = summarizeItemNames(items);
  const styles = uniqueStrings(items.flatMap((item) => item.styleTags));
  if (styles.length > 0) return candidate('style', `FALLBACK_STYLE_${index}`, 0, `${styles[0]}风格线索保留得清楚`, `${styles[0]}来自单品标签，详情里先按可确认的风格信息解释`);
  if (items.length > 0) return candidate('style', `FALLBACK_ITEMS_${index}`, 0, `${names}组合信息完整`, `${names}来自当前推荐的真实单品，先保留这组可确认的搭配依据`);
  return candidate('style', `FALLBACK_LEGACY_${index}`, 0, '这套保留了原有推荐信息', '这套来自旧推荐快照，详情继续展示原有推荐依据，不补写无法确认的衣物事实');
}

function candidate(dimension, code, strength, reason, reasoning) {
  return {
    dimension,
    code,
    evidenceCodes: code && !code.startsWith('FACT_') && !code.startsWith('FALLBACK_') ? [code] : [],
    strength,
    reason,
    reasoning,
  };
}

function uniqueCandidates(candidates) {
  const result = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || !candidate.dimension || !candidate.reason) continue;
    const key = `${candidate.dimension}:${candidate.code || ''}:${candidate.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

function compareCandidates(a, b) {
  const strengthDiff = finiteNumber(b.strength, 0) - finiteNumber(a.strength, 0);
  if (strengthDiff !== 0) return strengthDiff;
  const dimensionDiff = DIMENSION_ORDER.indexOf(a.dimension) - DIMENSION_ORDER.indexOf(b.dimension);
  if (dimensionDiff !== 0) return dimensionDiff;
  return String(a.code || '').localeCompare(String(b.code || ''));
}

function readItems(context) {
  return context.items || context.itemsSnapshot || context.snapshotItems || [];
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((source, index) => normalizeItem(source, index))
    .filter(Boolean)
    .sort((a, b) => {
      const categoryDiff = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
      if (categoryDiff !== 0) return categoryDiff;
      return a.id.localeCompare(b.id);
    });
}

function normalizeItem(source, index) {
  if (!source || typeof source !== 'object') return null;
  const id = readString(source.clothingId || source.itemId || source.id || source._id) || `item-${index}`;
  const features = source.aestheticFeatures && typeof source.aestheticFeatures === 'object' ? source.aestheticFeatures : {};
  return {
    id,
    name: readString(source.subcategory || source.type || source.name || source.category) || '单品',
    category: normalizeCategory(source.category || source.type),
    colors: readColors(source),
    material: readString(source.material || source.materialGuess),
    thickness: readString(source.thickness),
    styleTags: uniqueStrings(source.styleTags),
    sceneTags: uniqueStrings(source.sceneTags),
    fit: readString(features.fit || source.fit),
    silhouette: readString(features.silhouette || source.silhouette),
    length: readString(features.length || source.length),
    patternType: readString(features.patternType || source.patternType),
    designElements: uniqueStrings(features.designElements || source.designElements),
    formalityLevel: finiteNumber(features.formalityLevel ?? source.formalityLevel, null),
  };
}

function readColors(source) {
  const palette = Array.isArray(source.colorPalette) ? source.colorPalette : [];
  const colors = palette.map((entry) => readString(entry?.name || entry?.color || entry)).filter(Boolean);
  const fallback = readString(source.color);
  if (fallback) colors.push(fallback);
  return uniqueStrings(colors);
}

function resolveEvidenceItems(entry, items) {
  const ids = new Set(uniqueStrings(entry.itemIds));
  if (ids.size === 0) return [];
  return items.filter((item) => ids.has(item.id));
}

function mapEvidenceDimension(dimension, code) {
  const raw = `${dimension || ''} ${code || ''}`;
  if (/silhouette/i.test(raw)) return 'silhouette';
  if (/proportion/i.test(raw)) return 'proportion';
  if (/color/i.test(raw)) return 'color';
  if (/pattern/i.test(raw)) return 'pattern';
  if (/formality/i.test(raw)) return 'formality';
  if (/detail/i.test(raw)) return 'detail';
  return '';
}

function summarizeItemNames(items) {
  const names = uniqueStrings(items.map((item) => item.name)).slice(0, 2);
  return names.length > 0 ? names.join('和') : '这组单品';
}

function sanitizeText(value, maxLength) {
  const text = readString(value)
    .replace(UNSAFE_BODY_LANGUAGE, '')
    .replace(/\s+/g, '')
    .replace(/；；+/g, '；')
    .replace(/。。+/g, '。');
  if (!text) return '';
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

function normalizeCardReason(value) {
  const text = sanitizeText(value, 44);
  if (!text || text.length >= 20) return text;
  return sanitizeText(`${text}，整体重点更清楚`, 44);
}

function stripNonFinite(value) {
  if (Array.isArray(value)) return value.map(stripNonFinite);
  if (!value || typeof value !== 'object') {
    return Number.isFinite(value) || typeof value !== 'number' ? value : null;
  }
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = stripNonFinite(entry);
  }
  return result;
}

function normalizeCategory(value) {
  const raw = readString(value).toLowerCase();
  if (CATEGORY_ORDER.includes(raw)) return raw;
  return 'other';
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueStrings(value) {
  const list = Array.isArray(value) ? value : [];
  const result = [];
  const seen = new Set();
  for (const entry of list) {
    const text = readString(entry);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

module.exports = {
  RECOMMENDATION_REASON_VERSION,
  buildReasonCandidates,
  compileRecommendationReasonsV2,
};
