'use strict';

const crypto = require('node:crypto');
const v1 = require('../xiaoda-ai-voice-spike/core');
const PERSONA = require('../../cloudfunctions/generateOutfit/services/xiaodaPersonaContract');

const PROMPT_VERSION = 'xiaoda-today-voice-v2-dev4';
const BRIEF_SCHEMA_VERSION = 'xiaoda-styling-brief-v2';
const VOICE_INSIGHT_VERSION = 'xiaoda-voice-insight-v1';
const MODEL_ALLOWLIST = Object.freeze({ plus: 'qwen3.7-plus' });
const FORBIDDEN_CLAIMS = v1.FORBIDDEN_CLAIMS;

const PROMPT_COMPONENTS = Object.freeze({
  systemPersona: '小搭是熟悉用户衣橱、懂搭配、自然有判断但不过度点评的朋友型私人穿搭顾问。不是算法解释器、导购、时尚杂志编辑或营销账号。',
  rules: '方案和 primary styling point 已定，只回答今天这身为何可穿；绝不重新挑选、重排、评分或增删衣物。每个 id 的 reason 必须非空。每个形容或效果判断必须直接来自 primary/supporting 的 userFacingMeaning 或 allowedJudgments；garment 只有 name、color、pattern、fit、shape 事实，不得扩写穿法。allowedJudgments 为空时，只能从与 userFacingMeaning 直接匹配的“干净、统一、不显乱”中选择，不新增精神、轻盈、温和、有型或干练。delivery 只分 primary、weak 或 omit。weak 必须说明整身感受，不能只翻译关系；omit 只复述已知衣物与场景事实。天气原句只能报授权事实，不宣称保暖或适合。',
  forbiddenLanguage: '禁止颜色连贯、张弛有度、轻盈、温和、有型、运动感更完整、敞开穿、清爽打底、精神等未授权效果词；禁止算法编辑腔及同义词：视觉焦点、自己的重点、落点、把感觉收得、上下呼应、相互呼应、连成一线、下半身完整、挨在一起、松紧有度、长度错落、层次清晰、收尾、层次结构、着装要求、色调协调、色环、作为背景、舒服、舒适、柔和；禁止身形比例、未授权材质/保暖/天气判断、购买建议、便利性、报告术语、营销流行语、重新推荐或暗示不存在的衣物。',
  goodExamples: 'GOOD：印花上衣已经够醒目，下装简单一点，整身不会显乱。红Polo配白短裤，颜色鲜明但看着清爽。白上衣和白鞋放一起，整身更干净统一。松紧轮廓一紧一松，但不写身形有型。内外有层次，不补开合。白衬衫配黑长裤，上班穿得体。今天偏冷又有风，这套是运动上衣配运动长裤。',
  badExamples: 'BAD：印花上衣有自己的重点，亮色落在上身，灰色下装把感觉收得自然。\nBAD：上下装相互呼应、连成一线，长度错落，层次结构清晰。\nBAD：这套色调协调、松紧有度，符合着装要求。',
  schema: '只返回 JSON（exact IDs）：{"items":[{"id":"<exact input id>","reason":"..."}]}。每个 brief 必须恰好一个 item，id 必须逐字匹配输入，不得使用 Markdown，不得添加其他字段。',
  repeatedInstructions: '',
});

const PRIORITY = Object.freeze({
  SUBTYPE_FEATURE_PRINT: 4,
  PATTERN_SINGLE_FOCUS: 4,
  PATTERN_SOLID_BALANCE: 4,
  DETAIL_SINGLE_FOCUS: 4,
  SILHOUETTE_BALANCED_CONTRAST: 4,
  PROPORTION_CLEAR_LAYERING: 4,
  STRUCTURE_ONEPIECE_OUTERWEAR: 4,
  TOP_ACCENT_WITH_NEUTRAL_BOTTOM: 4,
  STRUCTURE_ONEPIECE_SHOES: 3,
  FORMALITY_ALIGNED: 3,
  COLOR_ECHO_TOP_SHOES: 2,
  COLOR_ECHO_BOTTOM_SHOES: 2,
  COLOR_ANALOGOUS: 2,
  SAME_COLOR_TOP_BOTTOM: 2,
  SAME_COLOR_ALL_ROLES: 2,
  NEUTRAL_COLOR_BRIDGE: 1,
  DISTINCT_TOP_BOTTOM_COLOR: 1,
  STRUCTURE_TOP_BOTTOM: 1,
  SIMPLE_EVERYDAY_COMBINATION: 1,
});

const SEMANTICS = Object.freeze({
  SUBTYPE_FEATURE_PRINT: ['pattern', 'a printed detail gives the outfit its visual focus', 'the print is the clearest point of interest'],
  PATTERN_SINGLE_FOCUS: ['pattern', 'one pattern leads while the other pieces stay quiet', 'one pattern carries the look'],
  PATTERN_SOLID_BALANCE: ['pattern', 'a solid piece balances the pattern', 'the solid piece keeps the pattern focused'],
  DETAIL_SINGLE_FOCUS: ['pattern', 'one garment detail provides the visual focus', 'one detail leads while the rest stays simple'],
  SILHOUETTE_BALANCED_CONTRAST: ['shape', 'the garment shapes create an intentional contrast', 'the shapes give the outfit a clear balance'],
  PROPORTION_CLEAR_LAYERING: ['shape', 'the garment lengths create a readable layer relation', 'the layers have a clear proportion'],
  STRUCTURE_ONEPIECE_OUTERWEAR: ['structure', 'the outer layer adds a deliberate layer to the one-piece garment', 'the outer layer gives the one-piece look structure'],
  TOP_ACCENT_WITH_NEUTRAL_BOTTOM: ['color', 'the upper garment provides the color focus while the bottom stays neutral', 'the top is the color focus'],
  STRUCTURE_ONEPIECE_SHOES: ['structure', 'the shoes complete the one-piece outfit', 'the shoes finish the one-piece look'],
  FORMALITY_ALIGNED: ['formality', 'the garments have compatible formality', 'the pieces suit the formality of work'],
  COLOR_ECHO_TOP_SHOES: ['color', 'the upper garment and shoes repeat a color family', 'the top and shoes echo each other'],
  COLOR_ECHO_BOTTOM_SHOES: ['color', 'the lower garment and shoes repeat a color family', 'the bottom and shoes echo each other'],
  COLOR_ANALOGOUS: ['color', 'neighboring color families keep the palette coordinated', 'the colors stay close and coordinated'],
  SAME_COLOR_TOP_BOTTOM: ['color', 'the upper and lower garments share a color family', 'the top and bottom share a color family'],
  SAME_COLOR_ALL_ROLES: ['color', 'the garments share a color family across the outfit', 'the outfit keeps one color family'],
  NEUTRAL_COLOR_BRIDGE: ['color', 'quiet colors connect the garments without another strong focus', 'neutral color keeps the look connected'],
  DISTINCT_TOP_BOTTOM_COLOR: ['color', 'the upper and lower garments use distinct but compatible colors', 'the top and bottom have clear color contrast'],
  STRUCTURE_TOP_BOTTOM: ['structure', 'the upper and lower garments form a straightforward combination', 'the pieces make a clear combination'],
  SIMPLE_EVERYDAY_COMBINATION: ['structure', 'the garments make a simple everyday combination', 'the outfit stays simple and usable'],
});

const text = (value) => (typeof value === 'string' ? value.trim() : '');
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}
const sha256 = (value) => crypto.createHash('sha256').update(stableStringify(value)).digest('hex');

function weatherOf(outfit = {}) {
  const weather = outfit.weatherDependency || {};
  if (weather.weatherRelevant !== true) return { weatherRelevant: false };
  const facts = weather.evidenceFactIds || weather.supportingFactIds || [];
  if (weather.evidenceAuthorized !== true || !facts.length) return { weatherRelevant: false, weatherEvidenceGap: true };
  return {
    weatherRelevant: true,
    thermalBand: text(weather.thermalBand),
    rainRelevant: weather.rainRelevant === true,
    windRelevant: weather.windRelevant === true,
  };
}

function relationFrom(raw) {
  const relationCode = text(raw.relationCode || raw.code);
  return {
    insightCode: text(raw.insightCode || raw.code || relationCode),
    relationType: relationCode,
    subjectItemIds: Array.isArray(raw.subjectItemIds) ? raw.subjectItemIds : [],
    supportingFacts: raw.evidenceFactIds || raw.supportingFactIds || raw.supportingFacts || [],
  };
}

function selectVoiceInsight(insight = {}, scene) {
  const candidates = [];
  const source = insight.xiaodaStyleInsight || {};
  for (const entry of [source.primary, source.secondary, source.optional]) {
    if (entry) candidates.push(relationFrom({ ...entry, relationCode: entry.relationCode || entry.code, evidenceFactIds: entry.evidenceFactIds || entry.supportingFacts }));
  }
  for (const relation of insight.stylingRelations || []) candidates.push(relationFrom(relation));
  const normalizedScene = v1.normalizeScene(scene || insight.scene);
  const valid = candidates
    .filter((candidate) => Object.prototype.hasOwnProperty.call(PRIORITY, candidate.relationType))
    .filter((candidate) => candidate.relationType !== 'FORMALITY_ALIGNED' || normalizedScene === 'work')
    .map((candidate) => {
      const [dimension, semanticPoint, userFacingMeaning] = SEMANTICS[candidate.relationType];
      return { ...candidate, priority: PRIORITY[candidate.relationType], dimension, semanticPoint, userFacingMeaning };
    })
    .sort((a, b) => b.priority - a.priority);
  if (!valid.length) return { delivery: 'omit', version: VOICE_INSIGHT_VERSION };
  const selected = valid[0];
  return { ...selected, delivery: selected.priority >= 3 ? 'primary' : 'weak', version: VOICE_INSIGHT_VERSION, evidenceFactIds: selected.supportingFacts };
}

function normalizeGarment(item = {}) {
  return {
    itemId: text(item.itemId || item.id),
    role: text(item.role || item.category),
    name: text(item.subcategory || item.canonicalSubtype || item.name),
    color: text(item.canonicalColorFamily || item.normalizedColor || item.color),
    pattern: text(item.pattern || item.patternType),
    styleFacts: Array.isArray(item.styleFacts) ? item.styleFacts : [],
    formality: text(item.formality),
    fit: text(item.fit),
    shape: text(item.shape || item.silhouette),
    importance: text(item.importance || (item.optional === true ? 'optional' : 'core')) || 'core',
    evidenceFactIds: item.authorizedFactIds || item.evidenceFactIds || [],
  };
}

function buildStylingBriefV2(outfit = {}, options = {}) {
  const garments = (outfit.garments || outfit.items || []).map(normalizeGarment)
    .filter((item) => item.itemId)
    .sort((a, b) => String(a.role).localeCompare(String(b.role)) || a.itemId.localeCompare(b.itemId));
  const aliases = Object.fromEntries(garments.map((item, index) => [`g${index + 1}`, item.itemId]));
  const reverseAliases = Object.fromEntries(Object.entries(aliases).map(([alias, id]) => [id, alias]));
  const selected = selectVoiceInsight({ ...outfit, scene: outfit.scene }, outfit.scene);
  const allowedJudgments = (outfit.xiaodaStyleInsight?.allowedAestheticInferences || outfit.allowedJudgments || [])
    .map((entry) => (typeof entry === 'string' ? entry : entry?.label || entry?.code)).filter(Boolean);
  const point = selected.delivery === 'omit' ? null : {
    code: selected.insightCode,
    relationType: selected.relationType,
    subjectAliases: selected.subjectItemIds.map((id) => reverseAliases[id]).filter(Boolean),
    semanticPoint: selected.semanticPoint,
    userFacingMeaning: selected.userFacingMeaning,
    allowedJudgments,
  };
  const supporting = (outfit.stylingRelations || [])
    .map((relation) => selectVoiceInsight({ stylingRelations: [relation], scene: outfit.scene }, outfit.scene))
    .filter((candidate) => candidate.delivery !== 'omit' && candidate.relationType !== selected.relationType && candidate.dimension !== selected.dimension)
    .sort((a, b) => b.priority - a.priority)
    .find((candidate) => candidate.subjectItemIds.every((id) => reverseAliases[id]));
  const weather = weatherOf(outfit);
  const model = {
    id: options.benchmarkId || outfit.id,
    briefSchemaVersion: BRIEF_SCHEMA_VERSION,
    delivery: selected.delivery,
    scene: v1.normalizeScene(outfit.scene),
    ...(weather.weatherRelevant ? { meaningfulWeather: weather } : {}),
    garments: garments.map((item) => ({ alias: reverseAliases[item.itemId], role: item.role, name: item.name, color: item.color, pattern: item.pattern, fit: item.fit, shape: item.shape })),
    primaryStylingPoint: point,
    ...(supporting ? { supportingPoint: { code: supporting.insightCode, relationType: supporting.relationType, subjectAliases: supporting.subjectItemIds.map((id) => reverseAliases[id]), semanticPoint: supporting.semanticPoint, userFacingMeaning: supporting.userFacingMeaning } } : {}),
    inferenceBoundary: { noNewGarments: true, noUnsupportedClaims: true },
  };
  return {
    ...model,
    provenance: { aliases, primaryEvidenceFactIds: selected.evidenceFactIds || [], sourceVersions: { stylingInsight: outfit.xiaodaStyleInsight?.version || VOICE_INSIGHT_VERSION, voiceInsight: VOICE_INSIGHT_VERSION, persona: PERSONA.XIAODA_PERSONA_VERSION } },
    cacheDependencies: buildReasonCacheIdentity(outfit, { selected }),
  };
}

function toModelBrief(brief) {
  const model = { ...brief };
  delete model.provenance;
  delete model.cacheDependencies;
  return model;
}
function buildReasonCacheIdentity(outfit = {}, { selected = {}, modelAlias = 'plus' } = {}) {
  if (!MODEL_ALLOWLIST[modelAlias]) throw new Error('model alias is not allowed');
  const garments = (outfit.items || outfit.garments || []).map(normalizeGarment)
    .map((item) => ({ id: item.itemId, role: item.role, color: item.color }))
    .sort((a, b) => a.role.localeCompare(b.role) || a.id.localeCompare(b.id));
  const weather = weatherOf(outfit);
  return {
    outfitFingerprint: sha256(garments),
    primaryInsightFingerprint: sha256({ code: selected.relationType, subjects: selected.subjectItemIds, evidence: selected.evidenceFactIds }),
    scene: v1.normalizeScene(outfit.scene),
    weatherFingerprint: weather.weatherRelevant ? sha256(weather) : null,
    voiceInsightVersion: VOICE_INSIGHT_VERSION,
    briefVersion: BRIEF_SCHEMA_VERSION,
    personaVersion: PERSONA.XIAODA_PERSONA_VERSION,
    promptVersion: PROMPT_VERSION,
    model: MODEL_ALLOWLIST[modelAlias],
    locale: 'zh-CN',
  };
}

function validateBriefBinding(brief) {
  const failures = [];
  const aliases = brief?.provenance?.aliases || {};
  const ids = new Set((brief?.garments || []).map((garment) => garment.alias));
  const values = Object.values(aliases);
  if (!brief?.id || brief.briefSchemaVersion !== BRIEF_SCHEMA_VERSION || !['home', 'work', 'date', 'sport'].includes(brief.scene) || !['primary', 'weak', 'omit'].includes(brief.delivery)) failures.push('CONTRACT');
  if (values.length !== ids.size || new Set(values).size !== values.length || Object.keys(aliases).some((alias) => !ids.has(alias)) || values.some((value) => !value)) failures.push('ALIAS_BINDING');
  for (const point of [brief.primaryStylingPoint, brief.supportingPoint]) if (point?.subjectAliases?.some((alias) => !ids.has(alias))) failures.push('INSIGHT_BINDING');
  if (brief.delivery !== 'omit' && !brief.provenance?.primaryEvidenceFactIds?.length) failures.push('PROVENANCE');
  return { pass: failures.length === 0, failures };
}

function validateModelBrief(brief) {
  const failures = [];
  const walk = (value) => { if (!value || typeof value !== 'object') return; for (const key of Object.keys(value)) { if (['reason', 'reasoning', 'humanMeaning', 'source'].includes(key)) failures.push('FORBIDDEN_SOURCE_KEY'); walk(value[key]); } };
  walk(brief);
  return { pass: failures.length === 0, failures: [...new Set(failures)] };
}

function validateGeneratedOutput(raw, ids, briefs = []) {
  let parsed;
  try { parsed = raw && typeof raw === 'object' ? raw : JSON.parse(String(raw).trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '')); } catch { return { pass: false, failures: ['OUTPUT_PARSE'], results: [], automaticOnly: true }; }
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const results = items.map((item) => {
    const reason = text(item.reason);
    const brief = briefs.find((entry) => entry.id === item.id);
    const violations = reason
      ? PERSONA.inspectXiaodaPersonaCopy(reason, {
        allowedClaims: brief?.primaryStylingPoint?.allowedJudgments || [],
      }).violations || []
      : [];
    return {
      id: item.id,
      personaViolations: violations,
      failures: [...(reason ? [] : ['EMPTY_REASON']), ...(violations.length ? ['PERSONA'] : [])],
    };
  });
  const failures = items.length !== ids.length || new Set(items.map((item) => item.id)).size !== items.length || ids.some((id) => !items.find((item) => item.id === id)) ? ['BATCH_COMPLETENESS'] : [];
  return { pass: !failures.length && results.every((result) => !result.failures.length), failures, results, automaticOnly: true };
}

function buildPrompt() {
  return [
    ['Persona', PROMPT_COMPONENTS.systemPersona],
    ['Rules', PROMPT_COMPONENTS.rules],
    ['Forbidden language', PROMPT_COMPONENTS.forbiddenLanguage],
    ['Good examples', PROMPT_COMPONENTS.goodExamples],
    ['Bad examples', PROMPT_COMPONENTS.badExamples],
    ['Schema', PROMPT_COMPONENTS.schema],
  ].filter(([, content]) => content).map(([heading, content]) => `## ${heading}\n${content}`).join('\n\n');
}

module.exports = {
  ALGORITHM_PHRASES: [],
  BRIEF_SCHEMA_VERSION,
  FORBIDDEN_CLAIMS,
  MODEL_ALLOWLIST,
  PROMPT_COMPONENTS,
  PERSONA_VERSION: PERSONA.XIAODA_PERSONA_VERSION,
  PROMPT_VERSION,
  VOICE_INSIGHT_VERSION,
  buildPrompt,
  buildReasonCacheIdentity,
  buildStylingBriefV2,
  selectVoiceInsight,
  toModelBrief,
  validateBriefBinding,
  validateModelBrief,
  validateGeneratedOutput,
};
