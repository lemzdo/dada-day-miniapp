const {
  buildRendererInputFromNarrativePlan,
} = require('./recommendationVoiceRendererShadowV2');

const RECOMMENDATION_SAFE_RENDERER_VERSION = 'recommendation-safe-renderer-v2.0';

function renderRecommendationSafeCopyV2(plan, recommendation = {}) {
  const input = buildRendererInputFromNarrativePlan(plan, recommendation);
  const semanticMode = readText(plan?.expressionStrategy?.semanticMode);
  const insightCode = readText(plan?.insights?.primary?.insightCode);
  const text = input.expressionMode === 'primary'
    ? renderPrimaryCopy(insightCode, input)
    : renderBaselineCopy(semanticMode, input, plan?.relevantContext);
  if (!text) throw new Error('SAFE_RENDERER_EMPTY_COPY');
  return {
    version: RECOMMENDATION_SAFE_RENDERER_VERSION,
    planId: plan.planId,
    planHash: plan.planHash,
    insightId: input.primary?.insightId || null,
    expressionMode: input.expressionMode,
    semanticMode,
    text,
    garments: input.garments.slice(),
    allowedClaims: input.allowedClaims.slice(),
  };
}

function renderRecommendationSafeCopyV2Safely(plan, recommendation = {}) {
  try {
    return {
      status: 'ready',
      copy: renderRecommendationSafeCopyV2(plan, recommendation),
    };
  } catch (error) {
    return {
      status: 'failed_open',
      errorCode: readErrorCode(error),
      copy: null,
    };
  }
}

function renderPrimaryCopy(insightCode, input) {
  const subjects = readArray(input?.primary?.subjectGarments);
  const names = joinNames(subjects.length > 0 ? subjects : input.garments);
  const first = subjects[0] || input.garments[0] || '这件单品';
  const templates = {
    PATTERN_FOCUS: `${first}是这套的图案重点，其他单品简单一些。`,
    DETAIL_FOCUS: `${first}是这套的细节重点，其他单品简单一些。`,
    COLOR_FOCUS: `${first}是这套的颜色重点，其他单品简单一些。`,
    COLOR_UNITY: `${names}颜色方向一致，放在一起很协调。`,
    SILHOUETTE_CONTRAST: `${names}一紧一松，轮廓对比很清楚。`,
    PROPORTION_LAYERING: `${names}有清楚的长短层次。`,
    WEATHER_LAYERING: `${names}层次清楚，适合当前温度。`,
    PREFERENCE_STYLE_MATCH: `${names}符合你已经确认的风格偏好。`,
    STYLE_UNITY: `${names}风格方向一致，搭在一起很自然。`,
    SCENE_HOME_RELAXED_STRUCTURE: `${names}组合轻松，放在居家场景很自然。`,
    SCENE_WORK_STRUCTURED_SET: `${names}组合完整，适合上班。`,
    SCENE_WORK_SIMPLE_ONEPIECE: `${names}简洁直接，适合上班。`,
    SCENE_SPORT_PURPOSE_SET: `${names}组合明确，适合运动。`,
    SCENE_SPORT_LIGHT_ACTIVITY: `${names}组合轻松，适合日常活动。`,
  };
  if (templates[insightCode]) return templates[insightCode];
  if (insightCode.startsWith('SCENE_') && readText(input.scene)) {
    return `${names}组合完整，适合${readText(input.scene)}。`;
  }
  return normalizeSentence(input?.primary?.meaning);
}

function renderBaselineCopy(semanticMode, input, context = {}) {
  const garments = readArray(input.garments);
  const names = joinNames(garments);
  if (semanticMode === 'simple_baseline' || garments.length === 1) {
    return `${garments[0] || '这件单品'}单独穿，简单直接。`;
  }
  if (semanticMode === 'scene_practicality') {
    const scene = sceneLabel(context?.scene);
    return scene
      ? `${names}组合简单，放在${scene}场景很自然。`
      : `${names}搭在一起简单自然。`;
  }
  if (semanticMode === 'weather_practicality') {
    return `${names}组合简单，按当前天气穿比较直接。`;
  }
  return `${names}搭在一起简单自然。`;
}

function normalizeSentence(value) {
  const text = readText(value);
  if (!text) return '';
  return /[。！？!?]$/.test(text) ? text : `${text}。`;
}

function joinNames(values) {
  const names = readArray(values).filter(Boolean);
  if (names.length <= 1) return names[0] || '这些单品';
  return `${names.slice(0, -1).join('、')}和${names.at(-1)}`;
}

function sceneLabel(value) {
  return ({
    home: '居家', '居家': '居家',
    work: '上班', '上班': '上班',
    date: '约会', '约会': '约会',
    sport: '运动', '运动': '运动',
  })[readText(value).toLowerCase()] || '';
}

function readErrorCode(error) {
  return readText(error?.businessCode || error?.code || error?.message || error?.name || 'SAFE_RENDERER_UNKNOWN')
    .slice(0, 80)
    .replace(/[^A-Z0-9_:.-]/gi, '_');
}

function readText(value) { return typeof value === 'string' ? value.trim() : ''; }
function readArray(value) { return Array.isArray(value) ? value : []; }

module.exports = {
  RECOMMENDATION_SAFE_RENDERER_VERSION,
  renderRecommendationSafeCopyV2,
  renderRecommendationSafeCopyV2Safely,
};
