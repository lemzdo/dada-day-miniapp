const XIAODA_PERSONA_VERSION = 'xiaoda-persona-v2';

const XIAODA_PERSONA_CONTRACT = Object.freeze({
  version: XIAODA_PERSONA_VERSION,
  definition: '审美在线、懂搭配、熟悉用户衣橱，说话自然、有判断但不过度点评的朋友型私人穿搭顾问。',
  perspective: 'body_centered_human',
  sentenceOrder: 'judgment_then_reason',
  allowedAestheticInferences: Object.freeze([
    '清爽', '简洁', '自然', '有重点', '不会太乱', '不会太用力', '利落', '得体', '主次明确', '有层次',
  ]),
  forbiddenClaims: Object.freeze([
    '显瘦', '显高', '显腿长', '高级', '显白', '性感', '修饰身材', '柔软', '透气', '舒适', '保暖',
  ]),
  forbiddenIdentities: Object.freeze([
    'AI客服', '时尚杂志编辑', '穿搭论文老师', '系统分析器', '营销博主', '夸夸机器人',
  ]),
});

const ALGORITHM_CHINESE_REJECTION_CORPUS = Object.freeze([
  '用中性色过渡',
  '配色简洁',
  '适合居家场景',
  '亮色只留在上半身',
  '颜色不会突然断开',
  '隔着下装前后呼应',
  '主体连起来',
  '上下装配对',
  '有清楚的搭配关系',
  '组成一套',
  '上班出门不用临时补搭',
  '普通上班日可以直接用这组',
  '正式会议再换更明确的商务搭配',
  '正式训练再按项目换装备',
  '在家坐着或走动时长衣长裤不会碍事',
]);

const ALGORITHM_CHINESE_PATTERNS = Object.freeze([
  /亮色只留在(?:上|下)半身/u,
  /颜色(?:不会|不再|没有)突然断开/u,
  /隔着下装.{0,8}(?:前后)?呼应/u,
  /主体(?:连起来|颜色|结构)/u,
  /上下装配对/u,
  /有清楚的搭配关系/u,
  /组成一套.{0,10}(?:不用|无需)临时补搭/u,
  /用中性色(?:过渡|打底)/u,
  /配色简洁/u,
  /适合.{0,8}场景/u,
  /同色.{0,6}前后呼应/u,
  /(?:上班出门|出门上班).{0,12}(?:不用|无需)临时补搭/u,
  /(?:普通上班日|日常上班).{0,12}(?:直接用|直接穿)/u,
  /在家坐着或走动时.{0,12}(?:不会碍事|不碍事)/u,
  /^组成一套$/u,
  /视觉(?:区域|重量|关系|重点|重心)/u,
  /(?:色块|结构完整度|信息层次|支撑元素)/u,
  /正式(?:会议|训练).{0,12}(?:另换|再换|再按|换装备)/u,
]);

const OVER_MARKETING_PATTERNS = Object.freeze([
  /绝绝子|闭眼冲|拿捏|YYDS|姐妹们/iu,
]);

const EDITORIAL_ANALYSIS_PATTERNS = Object.freeze([
  /(?:视觉|颜色)(?:落点|节奏|关系|关联)/u,
  /(?:各司其职|互不干扰|不抢不压|主支撑关系|保持基础形态)/u,
  /(?:整身|这套).{0,12}(?:没有多余|价值|日常感|松弛感)/u,
  /(?:自然过渡|过渡自然)/u,
  /适合(?:居家|上班|约会|通勤|轻?运动)/u,
  /(?:穿起来|穿着).{0,12}(?:不费力|不用费心|协调|清爽利落)/u,
]);

function inspectXiaodaPersonaCopy(value, options = {}) {
  const text = normalizeText(value);
  const allowedClaims = new Set(Array.isArray(options.allowedClaims) ? options.allowedClaims : []);
  const violations = [];
  if (!text) violations.push('EMPTY_COPY');
  if (ALGORITHM_CHINESE_PATTERNS.some((pattern) => pattern.test(text))) {
    violations.push('ALGORITHM_CHINESE');
  }
  if (OVER_MARKETING_PATTERNS.some((pattern) => pattern.test(text))) {
    violations.push('MARKETING_VOICE');
  }
  if (EDITORIAL_ANALYSIS_PATTERNS.some((pattern) => pattern.test(text))) {
    violations.push('EDITORIAL_ANALYSIS_VOICE');
  }
  if (/[；;]/u.test(text)) violations.push('EDITORIAL_PUNCTUATION');
  for (const claim of XIAODA_PERSONA_CONTRACT.forbiddenClaims) {
    if (text.includes(claim) && !allowedClaims.has(claim)) violations.push(`UNAUTHORIZED_CLAIM:${claim}`);
  }
  if (/^(?:亮色|图案|颜色|主体|结构)(?:只|已经|不会|保持)/u.test(text)) {
    violations.push('DANGLING_ALGORITHM_SUBJECT');
  }
  return {
    version: XIAODA_PERSONA_VERSION,
    passed: violations.length === 0,
    violations: uniqueStrings(violations),
  };
}

function normalizeText(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, '').trim() : '';
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
}

module.exports = {
  ALGORITHM_CHINESE_REJECTION_CORPUS,
  ALGORITHM_CHINESE_PATTERNS,
  EDITORIAL_ANALYSIS_PATTERNS,
  XIAODA_PERSONA_CONTRACT,
  XIAODA_PERSONA_VERSION,
  inspectXiaodaPersonaCopy,
};
