const FORBIDDEN_HUMAN_COPY_TERMS = [
  '识别结果',
  '识别记录',
  '真实识别',
  '识别线索',
  '审美证据',
  '组合证据',
  '可观察线索',
  '详情页',
  '识别',
  '证据',
  '线索',
  '维度',
  '卡片',
  '详情',
  '输入',
  '输出',
  '候选',
  '覆盖率',
  '置信度',
  '权重',
  '观察点',
  '系统判断',
  '重点更清楚',
  '更容易读出来',
  'fallback',
  '快照',
  '模板',
  '字段',
  '克制',
  '稳定视觉重心',
  '稳定了视觉重心',
  '形成自然层次',
  '提升整体协调感',
  '强化视觉表现',
  '明显冲突',
  '基础单品',
  '延续休闲感',
  '更完整',
  '正式度接近',
  '视觉重量',
  '视觉关系',
  '色彩关系',
  '视觉重点',
  '完成度',
  '保持统一',
  '形成平衡',
  '增强层次',
  '整体有秩序',
  '主要观察点',
  '关系清楚',
];

const SENSITIVE_HUMAN_COPY_TERMS = [
  '显瘦',
  '遮肉',
  '显高',
  '拉长腿',
  '修饰身材',
  '显腿长',
  '体型',
  '年龄',
  '职业',
  '高级感',
  '贵气',
  '廉价',
  '品质好',
  '宝宝',
  '绝绝子',
  '拿捏',
];

function findHumanCopyPolicyViolations(value) {
  const text = normalizeText(value);
  if (!text) return [];
  return uniqueStrings([...FORBIDDEN_HUMAN_COPY_TERMS, ...SENSITIVE_HUMAN_COPY_TERMS]
    .filter((term) => text.includes(term)));
}

function assertHumanCopy(value, options = {}) {
  const text = normalizeText(value);
  if (!text) throw new Error('human_copy_policy_violation:empty');
  const violations = findHumanCopyPolicyViolations(text);
  if (violations.length > 0) {
    throw new Error(`human_copy_policy_violation:${violations.join(',')}`);
  }
  if (hasRepeatedSentenceParts(text)) {
    throw new Error('human_copy_policy_violation:repetition');
  }
  if (options.compareWith && isTooSimilar(text, options.compareWith)) {
    throw new Error('human_copy_policy_violation:similarity');
  }
  return text;
}

function hasRepeatedSentenceParts(value) {
  const parts = splitSentenceParts(value);
  const seen = new Set();
  for (const part of parts) {
    const key = normalizeComparable(part);
    if (!key) continue;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (hasAdjacentPhraseOverlap(parts[index], parts[index + 1])) return true;
  }
  return false;
}

function isTooSimilar(left, right, threshold = 0.72) {
  const a = normalizeComparable(left);
  const b = normalizeComparable(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 10 && b.includes(a)) return true;
  if (b.length >= 10 && a.includes(b)) return true;
  const gramsA = ngrams(a, 3);
  const gramsB = ngrams(b, 3);
  if (gramsA.size === 0 || gramsB.size === 0) return false;
  let overlap = 0;
  for (const gram of gramsA) {
    if (gramsB.has(gram)) overlap += 1;
  }
  return overlap / Math.min(gramsA.size, gramsB.size) >= threshold;
}

function splitSentenceParts(value) {
  return normalizeText(value)
    .split(/[，。！？；、,.!?;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function hasAdjacentPhraseOverlap(left, right) {
  const a = normalizeComparable(left);
  const b = normalizeComparable(right);
  if (!a || !b) return false;
  const max = Math.min(8, a.length, b.length);
  for (let length = max; length >= 3; length -= 1) {
    for (let index = 0; index <= a.length - length; index += 1) {
      const phrase = a.slice(index, index + length);
      if (b.includes(phrase)) return true;
    }
  }
  return false;
}

function ngrams(value, size) {
  const result = new Set();
  for (let index = 0; index <= value.length - size; index += 1) {
    result.add(value.slice(index, index + size));
  }
  return result;
}

function normalizeComparable(value) {
  return normalizeText(value).replace(/[\s，。！？；、,.!?;：“”"'（）()]/g, '');
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, '') : '';
}

function uniqueStrings(values) {
  const result = [];
  const seen = new Set();
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

module.exports = {
  FORBIDDEN_HUMAN_COPY_TERMS,
  SENSITIVE_HUMAN_COPY_TERMS,
  assertHumanCopy,
  findHumanCopyPolicyViolations,
  hasRepeatedSentenceParts,
  isTooSimilar,
};
