const BENEFIT_LABELS = {
  indoor_relax: '在家活动更轻松',
  walkable: '走动和临时出门更方便',
  clean_daily: '日常穿着清楚省心',
  commute_polish: '通勤场景更利落',
  temperature_buffer: '温差变化时更好调整',
  soft_mood: '整体更柔和',
  clear_highlight: '有一个明确的小重点',
  light_activity: '轻活动时不笨重',
  formal_training: '适合正式训练',
  hot_weather: '高温下更清爽',
  accent: '用小面积细节提气色',
};

const SLOT_LABELS = {
  top: '上衣',
  bottom: '下装',
  skirt: '半裙',
  onepiece: '连衣裙',
  outerwear: '外套',
  shoes: '鞋子',
  accessory: '配饰',
  other: '单品',
};

const EMPTY_PHRASES = ['衣物之间太泛', '想再清楚一点', '整体比较完整', '场景适配度比较高'];

function buildAiReviewPresentation(aiComment, contentPlan) {
  const fallback = buildContentPlanPresentation(contentPlan);
  if (!aiComment || typeof aiComment !== 'object') {
    return fallback;
  }
  if (isFallbackAiComment(aiComment)) {
    return fallback;
  }

  const explanation = aiComment.explanationV2 && typeof aiComment.explanationV2 === 'object'
    ? aiComment.explanationV2
    : null;

  if (explanation && explanation.schemaVersion === 2) {
    return choosePresentation(buildV2Presentation(aiComment, explanation), fallback, contentPlan);
  }
  if (explanation && explanation.schemaVersion === 3) {
    return choosePresentation(buildV3Presentation(explanation), fallback, contentPlan);
  }

  if (contentPlan?.defaultDetailExplanation) {
    return fallback;
  }

  const bodyParagraphs = uniqueText([aiComment.reason]).map((text) => normalizeText(text, 120)).filter(Boolean);
  return choosePresentation({
    bodyParagraphs,
    tags: [],
    advice: normalizeText(aiComment.tip, 120) || null,
  }, fallback, contentPlan);
}

function choosePresentation(candidate, fallback, contentPlan) {
  if (!hasQualifiedContent(candidate, contentPlan, fallback)) return fallback;
  return candidate;
}

function isFallbackAiComment(aiComment) {
  return aiComment.source === 'rule_fallback'
    || aiComment.source === 'cached_fallback'
    || aiComment.reviewSource === 'rule_fallback'
    || aiComment.reviewSource === 'cached_fallback'
    || aiComment.explanationV2?.source === 'rule_fallback'
    || aiComment.explanationV2?.source === 'cached_fallback';
}

function hasQualifiedContent(candidate, contentPlan, fallback) {
  const body = (candidate?.bodyParagraphs || []).join('');
  const advice = candidate?.advice || '';
  const text = `${body}${advice}`;
  if (!body) return false;
  if (EMPTY_PHRASES.some((phrase) => text.includes(phrase))) return false;
  if (/\b(category|subcategory|slot|top|bottom|shoes|outerwear|accessory|onepiece)\b/i.test(text)) return false;
  if (contentPlan && !mentionsPlanFact(text, contentPlan)) return false;
  if (fallback?.bodyParagraphs?.length && normalizeComparable(body) === normalizeComparable(fallback.bodyParagraphs.join(''))) return false;
  return true;
}

function buildV3Presentation(explanation) {
  return {
    bodyParagraphs: uniqueText([explanation.overallComment]).map((text) => normalizeText(text, 120)).filter(Boolean),
    tags: [],
    advice: normalizeText(explanation.advice, 120) || null,
  };
}

function buildV2Presentation(aiComment, explanation) {
  const advice = chooseAdvice(explanation);
  const bodySource = [
    explanation.summary,
    ...readPoints(explanation.strengths),
  ].filter((text) => normalizeComparable(text) !== normalizeComparable(advice));

  const bodyParagraphs = uniqueText(bodySource)
    .map((text) => normalizeText(text, 120))
    .filter(Boolean)
    .slice(0, 4);
  return {
    bodyParagraphs,
    tags: [],
    advice: normalizeText(advice, 120) || null,
  };
}

function chooseAdvice(explanation) {
  const tipText = normalizeText(explanation.tip && explanation.tip.text, 120);
  if (tipText) return tipText;
  return normalizeText(readPoints(explanation.tradeoffs)[0], 120);
}

function readPoints(points) {
  return Array.isArray(points) ? points.map((point) => point && point.text).filter(Boolean) : [];
}

function uniqueText(value) {
  const list = Array.isArray(value) ? value : [value];
  const result = [];
  const seen = new Set();
  for (const entry of list) {
    const text = normalizeText(entry, 180);
    const key = normalizeComparable(text);
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function normalizeText(value, maxLength) {
  const text = typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim()
    : '';
  if (!text) return '';
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

function normalizeComparable(value) {
  return normalizeText(value, 200).replace(/[。！？!?,，\s]/g, '');
}

function emptyPresentation() {
  return {
    bodyParagraphs: [],
    tags: [],
    advice: null,
  };
}

function buildContentPlanPresentation(contentPlan) {
  if (!contentPlan || typeof contentPlan !== 'object') return emptyPresentation();
  const defaultDetailExplanation = normalizeText(contentPlan.defaultDetailExplanation, 180);
  if (defaultDetailExplanation) {
    return {
      bodyParagraphs: [defaultDetailExplanation],
      tags: [],
      advice: normalizeText(contentPlan.defaultCopy?.aiExtraDefault, 120) === normalizeText(defaultDetailExplanation, 120)
        ? null
        : normalizeText(contentPlan.suggestion?.text, 120) || null,
    };
  }
  const items = Array.isArray(contentPlan.items) ? contentPlan.items : [];
  const core = items.filter((item) => item.role === 'core');
  const functional = items.filter((item) => item.role === 'functional');
  const optional = items.filter((item) => item.role === 'optional');
  const benefit = BENEFIT_LABELS[contentPlan.primaryBenefit] || '今天穿起来更省心';
  const bodyParagraphs = [];
  const coreText = joinNames(core);
  bodyParagraphs.push(coreText ? `${coreText}组合起来不复杂，${benefit}。` : `这套信息比较基础，${benefit}。`);
  if (functional.length > 0) {
    bodyParagraphs.push(`${joinNames(functional)}主要负责天气或场景上的需要，不是为了凑件数。`);
  } else if (optional.length > 0) {
    bodyParagraphs.push(`${joinNames(optional)}只是加一点小细节，没有它也不影响这套成立。`);
  } else {
    bodyParagraphs.push(renderSecondObservation(contentPlan, items));
  }
  return {
    bodyParagraphs,
    tags: [],
    advice: normalizeText(contentPlan.suggestion?.text, 120) || null,
  };
}

function renderSecondObservation(contentPlan, items) {
  const shoes = items.find((item) => item.slot === 'shoes');
  if (contentPlan.primaryBenefit === 'walkable' && shoes) return `${shoes.displayName}负责走动时的稳定感，场景价值比多加一件配饰更明确。`;
  if (contentPlan.primaryBenefit === 'formal_training' && shoes) return `${shoes.displayName}和运动单品一起承担训练用途，普通日常单品不会被当成专业装备。`;
  if (contentPlan.primaryBenefit === 'hot_weather') return '高温时这套没有额外加外套，重点放在少层次和清爽度上。';
  if (contentPlan.primaryBenefit === 'commute_polish') return '这套没有靠夸张细节撑场面，主要用清楚的单品关系服务通勤状态。';
  if (contentPlan.primaryBenefit === 'soft_mood') return `${scenePrefix(contentPlan)}穿会显得轻松一些，不靠额外外套或配饰撑效果。`;
  if (contentPlan.primaryBenefit === 'clear_highlight') return '有图案或颜色重点的单品已经在这套里，其他部分少加复杂元素就好。';
  return '这套成立的关键是已有衣物关系直接，不需要为了完整感再硬加单品。';
}

function scenePrefix(contentPlan) {
  const intent = normalizeText(contentPlan?.sceneIntent, 40);
  if (intent.startsWith('home:')) return '居家';
  if (intent.startsWith('work:')) return '上班';
  if (intent.startsWith('sport:')) return '运动';
  if (intent.startsWith('date:')) return '约会';
  return '日常';
}

function mentionsPlanFact(text, contentPlan) {
  const facts = [
    ...(contentPlan.items || []).flatMap((item) => [item.displayName, SLOT_LABELS[item.slot]]),
    BENEFIT_LABELS[contentPlan.primaryBenefit],
    BENEFIT_LABELS[contentPlan.secondaryBenefit],
  ].filter(Boolean);
  return facts.some((fact) => text.includes(fact));
}

function joinNames(items) {
  return items.map((item) => normalizeText(item.displayName, 32)).filter(Boolean).join('、');
}

module.exports = {
  buildAiReviewPresentation,
};
