'use strict';

const MODELS = Object.freeze({ max: 'qwen3.7-max', flash: 'qwen3.7-flash' });
const PROMPT_VARIANTS = Object.freeze(['current', 'compressed']);
const GENERATION_PARAMETERS = Object.freeze({ temperature: 0.3, top_p: 0.8, max_tokens: 1200, stream: false, enable_thinking: false });
const PERSONA_FAILURE_TERMS = [
  '算法', '模型判断', '候选', '主洞察', '次要洞察', '视觉焦点', '视觉结构', '色彩关系',
  '轮廓关系', '搭配公式', '编辑感', '高级感拉满', '氛围感拉满', '绝绝子', '拿捏',
];
const UNSUPPORTED_FACT_TERMS = [
  '显瘦', '显高', '显腿长', '显白', '修饰身材', '遮肉', '透气', '保暖', '舒适', '柔软',
  '省心', '不用想', '百搭', '显精神',
];
const CASE_VALIDATION = Object.freeze({
  'primary-pattern-focus': { required: [['条纹', '图案', '花纹'], ['简单', '重点', '不乱']], forbidden: ['修身', '阔腿', '松紧', '轮廓'] },
  'primary-silhouette-contrast': { required: [['修身', '一紧一松'], ['阔腿', '轮廓']], forbidden: ['条纹', '图案', '同色'] },
  'primary-monochromatic': { required: [['蓝色', '藏青'], ['同色', '统一', '颜色']], forbidden: ['修身', '阔腿', '图案'] },
  'scene-primary-work-structure': { required: [['衬衫', '西装长裤'], ['上班', '通勤']], forbidden: ['天气', '保暖', '修身'] },
  'weak-formality-only': { required: [['简单', '日常', '基础', '直接']], forbidden: [] },
  'sparse-low-confidence-pattern': { required: [['简单', '日常', '基础', '直接']], forbidden: ['图案重点', '印花重点', '呼应'] },
  'sparse-basic-no-evidence': { required: [['简单', '日常', '基础', '直接']], forbidden: [] },
  'competing-pattern-and-silhouette': { required: [['条纹', '图案'], ['简单', '重点', '不乱']], forbidden: ['一紧一松', '轮廓对比', '松紧', '平衡'] },
});

function buildRequest({ model, promptVariant, input }) {
  if (!MODELS[model]) throw new Error('MODEL_NOT_ALLOWED');
  if (!PROMPT_VARIANTS.includes(promptVariant)) throw new Error('PROMPT_VARIANT_NOT_ALLOWED');
  const compressed = promptVariant === 'compressed';
  const user = compressed ? JSON.stringify([{ id: '1', m: input.primary?.meaning || null, g: input.garments.slice() }]) : JSON.stringify([input]);
  return { model: MODELS[model], ...GENERATION_PARAMETERS, messages: [{ role: 'system', content: buildSystemPrompt(promptVariant) }, { role: 'user', content: user }], ...(compressed ? { response_format: { type: 'json_object' } } : {}) };
}

function buildSystemPrompt(variant) {
  if (variant === 'compressed') return [
    '你是小搭，像熟悉用户衣橱的朋友，表达自然、克制、有判断。穿搭和语义已由 Narrative Plan 决定，你只负责改写，不能重新搭配。',
    '每项 m 是唯一获准表达的意思；m=null 时只诚实说这套简单日常。g 是可用衣物名。不得增加第二个分析点、理由、事实、效果或衣物。',
    '禁止推断身体效果、体感、材质、天气、偏好或便利性；禁止算法腔、报告腔、杂志腔、营销流行语。通常一句，最多两句短句。',
    '只返回 JSON 对象：{"copies":[{"id":"原样复制输入id","text":"中文文案"}]}。不得增加字段、Markdown 或解释。',
  ].join('\n');
  return [
    '你是小搭，一位熟悉用户现有衣橱的朋友型私人穿搭顾问。自然、有判断、克制，不是杂志编辑、算法解说员或营销账号。',
    '穿搭方案和语义已经由 Gold Narrative Plan 决定。你只负责把既定意思说成自然中文，不重新搭配。',
    '只能表达 primary.meaning 和 allowedClaims，不得新增理由、事实、效果或衣物；primary 为 null 时诚实描述简单日常。',
    '禁止身体效果、体感、材质、天气、偏好、便利性推断；禁止算法腔、报告腔、杂志腔和营销流行语。通常一句，最多两句。',
    '只返回 JSON 数组，每项且只能有 planId、insightId、text。',
  ].join('\n');
}

function parseAndValidate(raw, promptVariant, input, caseId) {
  const text = typeof raw === 'string' ? raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '') : '';
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('OUTPUT_PARSE'); }
  let output;
  if (promptVariant === 'compressed') {
    if (!parsed || Array.isArray(parsed) || !Array.isArray(parsed.copies) || parsed.copies.length !== 1) throw new Error('OUTPUT_CONTRACT');
    const copy = parsed.copies[0];
    if (!copy || Object.keys(copy).sort().join(',') !== 'id,text' || copy.id !== '1' || typeof copy.text !== 'string') throw new Error('OUTPUT_CONTRACT');
    output = { planId: input.planId, insightId: input.primary?.insightId || null, text: copy.text.trim() };
  } else {
    if (!Array.isArray(parsed) || parsed.length !== 1) throw new Error('OUTPUT_CONTRACT');
    const value = parsed[0];
    if (!value || Object.keys(value).sort().join(',') !== 'insightId,planId,text' || value.planId !== input.planId || value.insightId !== (input.primary?.insightId || null) || typeof value.text !== 'string') throw new Error('OUTPUT_CONTRACT');
    output = { planId: value.planId, insightId: value.insightId, text: value.text.trim() };
  }
  const failures = [];
  if (!output.text || output.text.length > 72) failures.push('TEXT_LENGTH');
  if (output.text.split(/[。！？!?]/).map((part) => part.trim()).filter(Boolean).length > 2) failures.push('TOO_MANY_SENTENCES');
  if (PERSONA_FAILURE_TERMS.some((term) => output.text.includes(term))) failures.push('PERSONA_OR_EDITORIAL_LANGUAGE');
  if (UNSUPPORTED_FACT_TERMS.some((term) => output.text.includes(term))) failures.push('UNSUPPORTED_FACT');
  if (!input.garments.some((garment) => output.text.includes(garment))) failures.push('GARMENT_GROUNDING');
  if (input.expressionMode === 'baseline' && !['简单', '日常', '基础', '直接', '普通', '利落'].some((term) => output.text.includes(term))) failures.push('BASELINE_RESTRAINT');
  const policy = CASE_VALIDATION[caseId];
  if (!policy) throw new Error('CASE_VALIDATION_NOT_FOUND');
  for (const group of policy.required) if (!group.some((term) => output.text.includes(term))) failures.push('MEANING_NOT_PRESERVED');
  if (policy.forbidden.some((term) => output.text.includes(term))) failures.push('NEW_REASON_OR_SECONDARY');
  return {
    canonicalCopy: output.text,
    contractPass: true,
    validatorPass: failures.length === 0,
    factualViolation: failures.includes('UNSUPPORTED_FACT'),
    personaNaturalness: !failures.includes('PERSONA_OR_EDITORIAL_LANGUAGE'),
    validatorFailures: [...new Set(failures)],
  };
}

module.exports = { CASE_VALIDATION, GENERATION_PARAMETERS, MODELS, PROMPT_VARIANTS, buildRequest, buildSystemPrompt, parseAndValidate };
