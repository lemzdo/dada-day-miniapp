const { buildOutfitCopyFacts, colorTermsForFacts } = require('./outfitCopyFacts');

const ERROR_CODES = {
  UNSUPPORTED_FACT: 'UNSUPPORTED_FACT',
  COLOR_ALIAS_ALLOWED: 'COLOR_ALIAS_ALLOWED',
  GENERIC_STYLE_COPY: 'GENERIC_STYLE_COPY',
  ADVICE_NOT_GROUNDED: 'ADVICE_NOT_GROUNDED',
  UNSUPPORTED_REPLACEMENT_ADVICE: 'UNSUPPORTED_REPLACEMENT_ADVICE',
  NO_INFORMATION_GAIN: 'NO_INFORMATION_GAIN',
};

const COLOR_TERMS = ['米白色', '米白', '米色', '白色', '米色系', '白色系', '军绿色', '军绿', '绿色', '绿色系', '低饱和色', '灰色', '灰色系', '黑色', '黑色系', '紫色'];
const FIELD_CLAIMS = [
  { term: '牛仔', field: 'material' },
  { term: '皮质', field: 'material' },
  { term: '印花', field: 'pattern' },
  { term: '宽松版型', field: 'fit' },
  { term: '街头感', field: 'style' },
  { term: '透气', field: 'material' },
  { term: '亲肤', field: 'material' },
  { term: '舒适自在', field: 'fit' },
];
const GENERIC_STYLE_TERMS = ['主线', '清楚的亮点', '亮点已经落在', '更稳', '保持简单', '单品和单品', '想再明确一点'];

function validateCopyAgainstFacts(text, factsOrInput = {}) {
  const facts = factsOrInput.allowedFacts ? factsOrInput : buildOutfitCopyFacts(factsOrInput);
  const value = normalizeText(text);
  const trace = [];
  const rejectReasons = new Set();
  const allowedColorTerms = new Set(colorTermsForFacts(facts));
  const rawColors = new Set((facts.items || []).map((item) => item.rawColor).filter(Boolean));

  for (const term of COLOR_TERMS) {
    if (!value.includes(term)) continue;
    if (allowedColorTerms.has(term)) {
      if (!rawColors.has(term)) {
        trace.push({ code: ERROR_CODES.COLOR_ALIAS_ALLOWED, term, pass: true });
      }
    } else {
      trace.push({ code: ERROR_CODES.UNSUPPORTED_FACT, term, pass: false });
      rejectReasons.add(ERROR_CODES.UNSUPPORTED_FACT);
    }
  }

  for (const claim of FIELD_CLAIMS) {
    if (!value.includes(claim.term)) continue;
    if (facts.fieldsPresent?.[claim.field]) {
      trace.push({ code: `${claim.field}_FIELD_ALLOWED`, term: claim.term, pass: true });
    } else {
      trace.push({ code: ERROR_CODES.UNSUPPORTED_FACT, term: claim.term, pass: false });
      rejectReasons.add(ERROR_CODES.UNSUPPORTED_FACT);
    }
  }

  const generic = GENERIC_STYLE_TERMS.filter((term) => value.includes(term));
  if (generic.length > 0) {
    for (const term of generic) trace.push({ code: ERROR_CODES.GENERIC_STYLE_COPY, term, pass: false });
    rejectReasons.add(ERROR_CODES.GENERIC_STYLE_COPY);
  }

  return {
    ok: rejectReasons.size === 0,
    rejectReasons: Array.from(rejectReasons),
    trace,
  };
}

function normalizeText(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, '') : '';
}

module.exports = {
  ERROR_CODES,
  validateCopyAgainstFacts,
};
